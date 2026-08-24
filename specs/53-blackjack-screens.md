# Spec 53 — Blackjack screens

Part of the Blackjack + Texas Hold'em charter (`CHARTER.md`), milestone M1.
Screens only — no `App.tsx`/`Landing.tsx`/route wiring (that's spec 54).
The engine (spec 52, landed) is `src/card-games/blackjack/{state,rules,
bot,hand-value}.ts` — read it before writing any screen code.

Siblings read and matched, per CLAUDE.md's pattern-matching rule:
`src/screens/RummyRoom.tsx` (N-seat lobby shape), `src/screens/
RummyTable.tsx` + `Phase10Table.tsx` (opponent-rail-of-seats layout,
turn-gating via enabled/hint helper-function pairs, `DealIntro` wiring
keyed off `roundNumber`), `src/components/PlayingCard.tsx` / `CardBack.tsx`,
`src/hooks/useSound.ts`. One deliberate, stated departure from every
sibling: **no `BlackjackResults.tsx` screen** — Blackjack has no match
winner (it's open-ended per the charter's non-goals; players bet round
after round until they choose to leave), so there is no "game end" state
to show a Results screen for. Round outcomes are shown as an inline
summary banner on the Table screen itself (see "Round-over banner"
below), with a "Deal next round" button and a persistent "Leave table"
button — this is the correct shape for this game, not a shortcut.

## Files you own
- `src/components/BlackjackCard.tsx` (+ `.css` if needed) — thin wrapper
  choosing between `PlayingCard` (face up) and `CardBack` (face down),
  used for the dealer's hole card before/after reveal.
- `src/screens/BlackjackRoom.tsx`
- `src/screens/BlackjackTable.tsx` (+ `BlackjackTable.css` if the project
  convention is a dedicated stylesheet per table screen — check whether
  `RummyTable.tsx` uses inline styles or a `.css` file and match that
  exact convention, don't introduce a new one)
- `src/screens/BlackjackRulesOverlay.tsx`
- `src/hooks/useSound.ts` — ONLY to reuse existing `SoundName` values
  (see "Sound" below), do not add new sound names or new audio assets.

Do not touch any other file, including the engine files (read-only) or
`App.tsx`/`Landing.tsx`/`route.ts` (spec 54's job). Do not run `git`.

## Locked design

**BlackjackRoom** (mirrors `RummyRoom.tsx` exactly, same prop shape
adapted to Blackjack):
```ts
interface BlackjackRoomProps {
  code: string
  localName: string
  isHost: boolean
  seats: { name: string; isBot: boolean; isHost: boolean }[]
  notice?: string | null
  cardBack: string
  onSelectCardBack: (id: string) => void
  onAddHouseBot: () => void
  onStartGame: () => void
  onLeave: () => void
}
```
Import `BLACKJACK_MIN_SEATS`/`BLACKJACK_MAX_SEATS` from
`../card-games/blackjack/state` for the seat-count slots and the Start/
Add-bot disabled thresholds, exactly like Rummy imports its own
constants. Reuse `CardBackPicker` (already extracted, used by Rummy/
Solitaire) for the card-back picker. Table copy should mention the
$10-500 bet range and 1000 starting chips somewhere in the room (a
one-line note near the seat list, matching how other lobbies surface
their core rule quirks) — exact wording is yours, keep it terse.

**BlackjackCard** (`size: 'faceUp' | 'faceDown'`, plus whatever `rank`/
`suit`/`design` props it needs): when `faceUp`, renders `PlayingCard`
with `size='hand'`; when `faceDown`, renders `CardBack` with
`size='hand'`... **check first**: if `PlayingCard`'s `size` union
doesn't include `'hand'` as applicable outside a fanned rack context (it
does per the Explore report, sizes are `'hand'|'meld'|'discard'|
'tableau'`), use `'hand'` for player/dealer cards laid out in a row
(not a fan) — if visually a flat row reads better with a different
existing size, use that one instead, but do NOT invent a new size value
on `PlayingCard` itself; add sizing via wrapper CSS on `BlackjackCard`
if the existing sizes don't fit well.

**BlackjackTable** — the core screen. Sections top-to-bottom:
1. **Dealer area**: "Dealer" label, dealer's `dealerHand` cards rendered
   via `BlackjackCard` — `dealerHand[0]` always `faceUp`, `dealerHand[1]`
   `faceDown` until `dealerHoleRevealed`, everything from index 2
   onward (dealer's hit cards) always `faceUp` (they're only drawn after
   the reveal anyway). Show the dealer's total (`handValue` from the
   engine's `hand-value.ts` — import and use it directly, it's a pure
   function, no reason to reimplement) once `dealerHoleRevealed`, else
   show only the up-card's own value or nothing (don't leak the hidden
   total).
2. **Seat rail**: every seat in `seatOrder` (including the local player,
   distinguished with a "You" label/highlight like other games use),
   wrapping grid same as Rummy's `.rummy-opp-rail` pattern. Each seat
   tile shows: name + seat color, chip count, this round's bet (or
   "sitting out" if `sittingOut[seatId]`), and its hand(s) — normally 1,
   2 after a split, rendered as sub-rows so a split is visually obvious
   (a light divider or side-by-side layout, not stacked ambiguously).
   Each hand shows its cards (`BlackjackCard`, all `faceUp` — no hidden
   info on player hands per spec 52), a running total via `handValue`,
   and once `roundResults` is non-null, a result badge per hand (win/
   lose/push/blackjack, colored consistent with this codebase's win/
   loss color conventions — check an existing result-badge color choice,
   e.g. Rummy's or Battleship's hit/miss coloring, and reuse the same
   green/red/neutral hues rather than picking new ones).
3. **Action area** (only rendered for the LOCAL seat, gated on phase +
   whose action it is):
   - `betting` phase, local seat hasn't bet yet and isn't sitting out: a
     bet-amount stepper (−/+ buttons stepping by 10, clamped [10, 500],
     default 50, respecting `chips[localSeatId]` as an upper bound too)
     plus a "Place bet" button dispatching `PLACE_BET`. Once bet,
     show "Bet placed: N — waiting on others" instead.
   - `insurance` phase, local seat in `turn.playerOrder` and hasn't
     resolved yet (`!hasResolvedInsurance[localSeatId]`): "Dealer shows
     an Ace" prompt with "Insurance ($X)" / "No insurance" buttons
     (`TAKE_INSURANCE`/`DECLINE_INSURANCE`), where X is the correct half-
     bet amount.
   - `acting` phase, `currentPlayer(turn) === localSeatId`: Hit/Stand
     always available (gated only by `!currentHand.done`); Double shown
     only when `currentHand.cards.length === 2 && !currentHand.doubled
     && chips[localSeatId] >= currentHand.bet`; Split shown only when
     `currentHand.cards.length === 2 && !currentHand.isSplitHand &&
     cards[0].rank === cards[1].rank && chips[localSeatId] >=
     currentHand.bet`. Mirror Rummy/Phase10's enabled-fn + hint-fn pair
     pattern — a disabled button still shows why (e.g. "Not enough
     chips to double") rather than just being inertly greyed out.
   - Any other phase / not the local seat's turn: no action controls,
     just a status line ("Waiting for {name}…", "Dealer is playing…",
     etc., matching the terse status-line tone used elsewhere e.g.
     Scrabble's status block).
4. **Round-over banner** (only when `turn.phase === 'roundOver'`):
   summarizes the local seat's own hand(s) result(s) and chip delta
   plainly ("You won 100" / "You busted, -50" / "Push" / one line per
   hand if split), a "Deal next round" button (any seat may click it,
   dispatches `START_NEXT_ROUND` — matches the "anyone can advance"
   convention already established for Rummy's round-advance), and a
   "Leave table" button that's this game's substitute for a Results
   screen's exit path (calls a prop, e.g. `onLeaveTable`, wired by spec
   54 back to the shelf).

**DealIntro**: shown once per `roundNumber` (the same `useRef` guard
pattern as `RummyTable`/`Phase10Table` — read exactly how they key it
and copy it, don't reinvent). `others` = every OTHER seat with their
current hand's card count as `handSize` (0 before the deal completes,
naturally); `yourHandSize` = local seat's card count. Because
Blackjack's deal happens all-at-once right when the last bet lands (not
progressively), it's fine for the intro to just play once betting
completes each round even though hand sizes are already known at that
point — this is the same shape as other games' post-deal intro, not a
new problem to solve.

**Sound**: reuse existing `SoundName` values only, semantically close
enough for v1 (documented simplification, revisit only if live play in
spec 54 makes a specific gap feel bad):
- `'shuffle'` — new round starts / a reshuffle happens.
- `'card-draw'` — a HIT, or the initial deal.
- `'card-play'` — STAND/DOUBLE/SPLIT/insurance decisions (any other
  player action).
- `'round-win'` — local seat's hand result is `'win'` or `'blackjack'`
  at `roundOver`.
- `'error'` — local seat's hand result is `'lose'` at `roundOver`, OR
  an action is rejected (`outcome.ok === false`) — same dual use
  `'error'` already gets in other games for "invalid action" vs a loss
  outcome; check how an existing game overloads one sound name for two
  semantically-different-but-both-negative events and match that
  precedent rather than agonizing over it.
Do NOT add any new `SoundName` union member or touch `src/assets/
sounds/`.

**BlackjackRulesOverlay**: same shape as any sibling's rules overlay
(a dismissible modal/panel triggered from a "Rules" button in both Room
and Table headers) — summarize: starting chips (1000), bet range
(10-500), blackjack pays 3:2, dealer stands on all 17s including soft,
one split max / no resplit / no double-after-split, insurance offered
only vs a dealer Ace and pays 2:1. Keep the copy tone terse/plain like
existing rules overlays (check one for tone — e.g. `RummyRulesOverlay`
— and match it, this is not the place for marketing language).

## Do NOT
- Add a `BlackjackResults.tsx` screen or any "match winner"/game-over
  concept — this game doesn't have one, see above.
- Touch the engine files, `App.tsx`, `Landing.tsx`, `route.ts`, or any
  other game's files.
- Add any new dependency, new `SoundName`, or new audio asset.
- Add abstractions or defensive code beyond what's described here.

## Required manual checks (no dedicated test file expected — this
repo's convention is that screens/wiring code doesn't get its own
`*.test.ts`, matching every prior card game's screens spec)
Before reporting done, mentally trace (and state in your report) that:
- Every action button's enabled condition matches the engine's own
  validator logic in `rules.ts` (e.g. don't show "Double" as enabled
  when `rules.ts` would reject it) — cross-check each gating condition
  against the actual validator, not just this spec's prose.
- A split hand's two sub-hands are each independently gated/playable
  via `activeHandIndex[seatId]`, not both at once.
- The round-over banner and Deal-next-round button appear for every
  seat, not just whoever triggered the last action.

## Verify before reporting
Run, in the working directory
(`/Users/charlie/Desktop/Projects/pips/.claude/worktrees/poker-blackjack-loop`):
```
npx tsc -b --noEmit
npx vitest run
npm run build
```
Expected: tsc clean, full suite still green at the same count as before
your change (screens add no new tests here, matching convention — if
`npm run build` fails for any reason, that's a real blocker, fix it
before reporting). Report all three commands' real final output.

## Honest-failure escape hatch
If a locked decision here turns out to be genuinely contradictory once
implementing (e.g. an existing component's prop type truly cannot
support what's asked), stop and report the contradiction precisely
instead of quietly working around it.
