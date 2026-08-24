# Spec 56 — Texas Hold'em screens

Part of the Blackjack + Texas Hold'em charter (`CHARTER.md`), milestone
M4. Screens only — no `App.tsx`/`Landing.tsx`/route wiring (spec 57).
The engine (spec 55/55b, landed) is `src/card-games/holdem/{state,rules,
bot,hand-eval}.ts` — read it before writing any screen code, especially
the privacy model: `HoldemPublicState.hands[seatId].cards` is EMPTY for
every seat during active betting and only gets populated (revealed) for
non-folded seats once `handOver` at a real showdown. A seat's own hole
cards come from `HoldemPrivateState.hand` instead, delivered only to
that seat.

Closest sibling: `src/screens/Blackjack{Room,Table,RulesOverlay}.tsx` +
`src/components/BlackjackCard.tsx` (read these in full first — matching
their visual/interaction language is the default per CLAUDE.md's
pattern-matching rule) — but with one structural difference this spec
locks explicitly: **Blackjack has no private information, Hold'em does.**
For the private-hand rendering split specifically, mirror
`src/screens/RummyTable.tsx`'s pattern instead (read it too): the local
player's own hand comes from a private `hand: Card[]` prop rendered
face-up; every other seat renders a fixed-back pair (2 cards, since
hold'em hole cards are always exactly 2) via `CardBack`, with real cards
substituted in only once `publicState.hands[seatId].cards` is populated
(showdown reveal).

## Files you own
- `src/components/HoldemBoard.tsx` — renders `publicState.board: Card[]`
  (0/3/4/5 cards) using `PlayingCard` directly (no hidden/revealed
  ambiguity for community cards — they're either dealt face-up or not
  dealt yet, nothing to hide).
- `src/screens/HoldemRoom.tsx`
- `src/screens/HoldemTable.tsx` (+ `.css` only if that matches
  `BlackjackTable`'s actual convention — check first, don't guess)
- `src/screens/HoldemRulesOverlay.tsx`

Do not touch any engine file, any Blackjack file, or
`App.tsx`/`Landing.tsx`/`route.ts` (spec 57's job). Do not run `git`.

## Locked design

**HoldemRoom** (mirrors `BlackjackRoom.tsx`'s prop shape, adapted):
```ts
interface HoldemRoomProps {
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
Import `HOLDEM_MIN_SEATS`/`HOLDEM_MAX_SEATS` (2-8) from
`../card-games/holdem/state` for seat-count slots and Start/Add-bot
gating, same pattern as every sibling room. Reuse `CardBackPicker`. One
line of copy near the seat list should mention the stakes: small
blind 5 / big blind 10, 1000 starting chips (exact wording yours, keep
terse like Blackjack's equivalent line).

**HoldemBoard**: a row of up to 5 `PlayingCard` instances (`size='hand'`
or whichever existing size reads best in a horizontal row — don't
invent a new `PlayingCard` size, same constraint as Blackjack's spec).
Empty/not-yet-dealt slots (fewer than 5 board cards) should NOT render
placeholder card-backs — the board simply has fewer cards showing
before the flop/turn/river land, matching how a real table looks (no
face-down community cards ever exist in hold'em).

**HoldemTable** — the core screen. Sections top-to-bottom:
1. **Board + pot**: `HoldemBoard` centered, with the current `pot`
   total shown prominently nearby (a real-money-feel number, this is
   the single most important piece of shared state players glance at
   repeatedly).
2. **Seat rail**: every seat in `seatOrder` (local player included,
   labeled "You"), wrapping grid mirroring Blackjack's seat-tile
   pattern. Each tile shows: name + seat color, chip stack, current
   `betThisStreet` (their live wager this street, not their total
   contribution), and status badges — `folded` (dim/grey the whole
   tile, per this spec's own new design since no sibling precedent
   exists — reasonable default: reduced opacity + a small "Folded"
   chip-style badge), `all-in` (a distinct badge, different color from
   folded), `eliminated` (seat shown but clearly inert — same dimming
   treatment as folded, plus an "Out" badge, distinguishable from a
   mid-hand fold). The LOCAL seat's tile additionally shows its own 2
   hole cards (from the private `hand` prop) face-up via `PlayingCard`.
   Every OTHER non-folded, non-eliminated seat shows 2 face-down
   `CardBack`s (`design={publicState.cardBack}`) UNLESS
   `publicState.hands[seatId].cards.length > 0` (a genuine showdown
   reveal), in which case render those real cards face-up instead — a
   folded seat shows neither (no cards at all, or an empty/collapsed
   card area, since folded hands are never revealed).
3. **Action area** (local seat only, gated on `currentPlayer(turn) ===
   localPlayerId && turn.phase` being one of `preflop|flop|turn|river`):
   - Fold / Check / Call / Bet / Raise buttons, gated exactly against
     the engine's real validation (cross-check against `rules.ts`
     before shipping, same requirement as Blackjack's spec): Check only
     when `currentBetThisStreet <= myBetThisStreet`; Call only when
     there's a positive amount to call (show the exact call amount on
     the button, e.g. "Call 40"); Bet only when `currentBetThisStreet
     === 0`; Raise only when `currentBetThisStreet > 0` AND
     `publicState.reRaiseEligible[localPlayerId]` is true (if it's
     false, show why via a disabled-button hint, e.g. "Only a short
     all-in has happened since your last action").
   - **Bet/raise sizing control**: this codebase has no slider
     precedent (confirmed — Blackjack's bet stepper only spans
     10-500 in steps of 10, too narrow a pattern for a range that needs
     to span roughly the big blind up to a player's entire stack).
     Build a `<input type="range">` bet-size slider (min = the legal
     minimum bet/raise-to amount per the engine's own rule, max = the
     local player's `chips[localPlayerId] + their current
     betThisStreet` i.e. their max possible bet-to amount, step = 1)
     paired with a numeric readout, PLUS 3 quick-preset buttons: "½
     pot", "Pot", "All in" (computed from `publicState.pot` and the
     player's stack, clamped to legal min/max) — this is the standard
     poker-app sizing UX and there's no reason to reinvent something
     worse. Style it with this codebase's established chunky-border/
     drop-shadow visual language (4px `var(--ink)` borders, `0 Npx 0
     var(--ink)` box-shadows, `--coral`/`--yellow` accents — grep an
     existing screen for the exact values and match them, don't
     eyeball new ones).
   - Any other phase / not the local seat's turn: a status line
     ("Waiting for {name}…"), matching Blackjack's tone.
4. **Hand-over banner** (when `publicState.handOver`): show
   `handResults` — winner(s) and amounts per `potBreakdown` (handle a
   split pot legibly: "You and {name} split the pot, 150 each" style
   copy, not just a raw list), a "Deal next hand" button (any seat may
   click it, dispatches `START_NEXT_HAND`, human-initiated — same
   deliberate departure from Rummy's auto-advance timer that Blackjack
   locked in spec 54, for the same reason: let a human actually read
   the result before the next hand starts), and a "Leave table" button.
   If `publicState.gameOverWinnerId` is set (only one player has chips
   left), show a distinct final "{name} wins the table!" state instead
   of a "Deal next hand" button — the game is over, only "Leave table"
   makes sense here.

**DealIntro**: per the research already done for this spec, there is NO
distinct "dealing" phase in `HoldemStreet` — hole cards are dealt as
part of entering a fresh `preflop`. Key the intro trigger off the SAME
edge-transition pattern Blackjack's (already-fixed) deal intro uses,
adapted: track `prevPhaseRef` and fire when `prevPhaseRef.current ===
'handOver' && publicState.turn.phase === 'preflop'` (a genuinely new
hand just started), deduped by `publicState.handNumber` (not
`roundNumber` — Hold'em's field is named `handNumber`) via an
`introShownForHandRef`. Do NOT key it off `phase === 'preflop'` alone —
that's also true on every render during an already-dealt preflop
street, and would either miss the intro or replay it on unrelated
re-renders. `others` = every other non-eliminated seat with `handSize:
2` (hole cards are always exactly 2 once dealt, unlike Blackjack's
variable count); `yourHandSize` = 2 once the local player has hole
cards (check the private `hand` prop's length, not any public field).

**Sound**: reuse existing `SoundName` values only, same v1-simplification
rule as Blackjack: `'shuffle'` (new hand starts), `'card-draw'` (a new
street's board cards land), `'card-play'` (any other player's action),
`'round-win'` (local player wins a pot at handOver), `'error'` (local
player's hand loses at handOver, OR an action is rejected). Do NOT add
new `SoundName` values or audio assets.

**HoldemRulesOverlay**: same shape as `BlackjackRulesOverlay`/any
sibling — summarize: 1000 starting chips, blinds 5/10, no-limit betting,
side pots for multiple all-ins, min-raise rule (in plain terms: "a raise
must be at least as large as the previous bet or raise"), showdown
reveals only contesting (non-folded) hands. Terse, matching existing
tone.

## Do NOT
- Add a `HoldemResults.tsx` screen — same reasoning as Blackjack: no
  fixed "game over" screen needed beyond the in-table `handOver`/
  `gameOverWinnerId` banners already described.
- Touch the engine files, `App.tsx`, `Landing.tsx`, `route.ts`, or any
  other game's files.
- Add any new dependency, new `SoundName`, or new audio asset.
- Add abstractions or defensive code beyond what's described here.
- Render or log a value from `publicState.hands[otherSeatId].cards`
  anywhere except the specific reveal condition described above
  (`cards.length > 0`, meaning a genuine showdown reveal already
  happened server-side) — the engine's whole privacy fix (see
  `docs/DEVLOG.md` cycle 6) is worthless if the UI finds another way to
  surface hidden data, so do not add any debug/dev-only card display
  that bypasses this.

## Required manual checks (no dedicated test file expected — screens/
wiring code convention in this repo)
Before reporting done, state in your report that you:
- Cross-checked every action button's enabled condition against
  `rules.ts`'s actual validators (Fold/Check/Call/Bet/Raise, including
  the `reRaiseEligible` gate on Raise).
- Confirmed the bet-size slider's computed min/max can never produce a
  value the validator would reject (trace through: does your min ever
  fall below the engine's actual minimum legal bet/raise-to amount in
  ANY reachable state, e.g. after a big earlier raise?).
- Confirmed no code path renders another seat's hole cards before
  `publicState.hands[seatId].cards` is naturally populated by the
  engine's own showdown-reveal logic.

## Verify before reporting
Run, in the working directory
(`/Users/charlie/Desktop/Projects/pips/.claude/worktrees/poker-blackjack-loop`):
```
npx tsc -b --noEmit
npx vitest run
npm run build
```
Expected: tsc clean, full suite unchanged (screens add no new tests
here), build succeeds. Report all three commands' real final output.

## Honest-failure escape hatch
If a locked decision here is genuinely contradictory once implementing,
stop and report the exact contradiction rather than quietly working
around it.
