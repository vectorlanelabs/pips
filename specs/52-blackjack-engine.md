# Spec 52 — Blackjack card engine

Part of the Blackjack + Texas Hold'em charter (`CHARTER.md`), milestone M0.
Engine only: no React, no screens, no wiring. Mirrors
`src/card-games/rummy/` (`state.ts` + `rules.ts` + `bot.ts` split,
`HostSession`/`TurnState`/`applyAction`/`runBotTurn` from `src/engine/`,
`Zone`/`Card`/`createStandardDeck`/`shuffleDeck`/`dealCards` from
`src/card-engine/`) exactly. Read `src/card-games/rummy/state.ts` and
`rules.ts` before writing anything — this spec assumes those conventions.

## Files you own
- `src/card-games/blackjack/state.ts`
- `src/card-games/blackjack/state.test.ts`
- `src/card-games/blackjack/hand-value.ts` (pure card-value math)
- `src/card-games/blackjack/hand-value.test.ts`
- `src/card-games/blackjack/rules.ts`
- `src/card-games/blackjack/rules.test.ts`
- `src/card-games/blackjack/bot.ts`
- `src/card-games/blackjack/bot.test.ts`

Do not touch any other file. Do not run `git`.

## Locked design (do not improvise any of this)

**Table:** 2-6 seats, `BLACKJACK_MIN_SEATS = 2`, `BLACKJACK_MAX_SEATS = 6`.
No dealer seat in `seatOrder` — the dealer is host-simulated state, not a
player. Every seated player starts with **1000 chips**, set once at
`createBlackjackGame` and never replenished automatically.

**Shoe:** `createStandardDeck({ numberOfDecks: 6 })` (312 cards) shuffled
once at game creation and re-shuffled (fresh 312-card shoe) at the START
of any round where the remaining shoe would have fewer than `0.25 * 312 =
78` cards left before that round's deal — check before dealing, never
reshuffle mid-round. The shoe lives host-only (outside `HostSession`),
exactly like Rummy's `stock: Zone` field on `BlackjackSession` — only a
count is ever public.

**Betting:** `BLACKJACK_MIN_BET = 10`, `BLACKJACK_MAX_BET = 500`. A round
begins in a `'betting'` phase: every seated player with `chips >=
BLACKJACK_MIN_BET` must submit a `PLACE_BET` action (10-500 inclusive, and
never more than their current chip count) before the round can deal. A
seat with `chips < BLACKJACK_MIN_BET` is automatically marked
`sittingOut: true` for that round (skips betting and dealing, keeps its
seat) rather than being removed from `seatOrder`.

**Deal:** two cards to each betting-in player (both face-up to everyone —
no private information asymmetry needed since every hand competes only
against the dealer, not each other), then two to the dealer: the first
card face-up (`dealerUpCard`), the second face-down (`dealerHoleCard`,
present in public state as a card but flagged so client code knows not to
render its face — see "Hole card visibility" below).

**Hole card visibility — this is host-authoritative state, not a screens
concern, but get the shape right here:** `BlackjackPublicState.dealerHand`
is `Card[]` containing BOTH dealt dealer cards always (this game has no
concept of a card only some players may see — unlike Rummy's private
hands, nobody's *hand* is secret here, only whether the second dealer
card has been "revealed" yet). Add a separate public boolean
`dealerHoleRevealed: boolean` (false until the dealer plays its hand).
Screens will grey out / card-back the second card while this is false;
the engine must never let dealer-hand VALUE calculations happening in
game logic be gated on this flag (the host always knows the true value –
`dealerHoleRevealed` is purely a rendering signal carried in public
state, exactly the same pattern as any other "reveal at the right
moment" flag elsewhere in this codebase).

**Player actions, in `seatOrder` (skipping `sittingOut` seats), one seat
at a time via the shared `TurnState`/`advanceTurn` pattern:**
- `HIT`: draw one card from the shoe onto the current hand (or current
  split-hand, see below). Auto-advances to `STAND` behavior if the
  resulting total is 21 or a bust (>21) — i.e. the engine, not the
  player, ends that hand's turn the instant it can't take more actions.
- `STAND`: end this hand's turn without further action.
- `DOUBLE`: legal only as the FIRST action on a hand with exactly 2
  cards and enough chips to double the bet on that hand. Doubles the bet
  on that hand, draws exactly one card, then the hand auto-stands
  (whether or not it busts).
- `SPLIT`: legal only as the FIRST action on a hand with exactly 2 cards
  of the same rank, and enough chips to match the original bet on the
  new hand. Splits into two independent hands, each getting one of the
  original two cards plus one freshly drawn card; each hand is then
  played to completion (hit/stand/double, but **not a second split** —
  one split per round, max 2 resulting hands, per the charter's locked
  non-goal) before moving to the next. Split aces: deal exactly one card
  to each and auto-stand both immediately (no further hits) — the
  standard rule, prevents the edge case of chained aces-into-21 combos
  this v1 doesn't need to handle.
- `INSURANCE`: legal only when `dealerUpCard` is an Ace and only before
  any player has taken a HIT/STAND/DOUBLE/SPLIT action this round (i.e.
  offered once, at the very start of the action phase, to every
  betting-in seat in the same seat-order pass — model this as its own
  phase, `'insurance'`, between `'dealing'` and `'acting'`, that every
  eligible seat must resolve (insure or decline) before `'acting'`
  begins). Costs exactly half that seat's original bet (deduct
  immediately from chips), resolved at payout: pays 2:1 if the dealer's
  full hand turns out to be a natural blackjack, otherwise the insurance
  stake is simply lost (independent of how the main hand resolves).

**Dealer play:** after every seated hand is done (stood, busted,
doubled-and-drawn, or split-hands completed), reveal the hole card
(`dealerHoleRevealed = true`), then the dealer hits while its total is
16 or below and STANDS on 17 or higher **including soft 17** (a soft-17
total never draws further — the simpler, locked ruleset; see
`hand-value.ts`'s `isSoft` below for what "soft" means).

**Payout, resolved once per player hand, in this exact order of
precedence:**
1. Player hand busts (>21): lose that hand's bet. No dealer comparison.
2. Player has a natural blackjack (exactly 2 cards, value 21 — only
   possible on an unsplit original hand, since split hands both start
   with a rank-matched pair which can only total 21 via two aces, and a
   split-aces 21 does NOT count as a natural blackjack per standard
   rule — pays even money, not 3:2): if dealer does NOT also have a
   natural blackjack, pay 3:2 (bet back + 1.5x bet). If dealer ALSO has
   a natural blackjack, push (bet returned, no gain/loss).
3. Dealer busts (>21) and the player hand didn't (checked above): pay
   1:1 (bet back + 1x bet).
4. Compare totals: player total > dealer total -> pay 1:1. Player total
   < dealer total -> lose the bet. Equal -> push (bet returned).

**Chips are the single running mutable number per seat, updated
immediately on: bet placement (deduct), insurance (deduct), double
(deduct the extra), and round settlement (credit per payout above).**
`BlackjackPublicState` carries `chips: Record<string, number>`, always
current.

**Round end / next round:** once every hand is settled, phase becomes
`'roundOver'` with a public `roundResults` summary (see state shape
below). A `START_NEXT_ROUND` action (any seated player may trigger it —
same "anyone can advance" convention as Rummy's `START_NEXT_ROUND`)
clears hands/bets/results, re-checks the reshuffle threshold, and deals
a fresh betting phase. No match/game "winner" concept — Blackjack is
open-ended per the charter (players leave whenever, via wiring not this
spec); this engine has no game-end condition to detect, unlike Hold'em.

## State shape (`state.ts`)

```ts
export type BlackjackPhase = 'betting' | 'insurance' | 'acting' | 'dealerPlay' | 'roundOver'

export interface BlackjackHand {
  id: string                 // stable per-hand id (survives a split producing 2 new ids from 1 parent)
  cards: Card[]
  bet: number
  doubled: boolean
  isSplitHand: boolean
  fromSplitOf: string | null // original hand id this was split from, else null
  done: boolean               // stood / busted / doubled-and-resolved / split-ace-locked
  result: 'blackjack' | 'win' | 'push' | 'lose' | null // set at settlement, null until roundOver
}

export interface BlackjackPublicState {
  turn: TurnState<BlackjackPhase>       // playerOrder = seatOrder filtered to non-sittingOut seats for the CURRENT round's acting phase (see rules.ts note below on why turn.playerOrder is rebuilt per round, not fixed like Rummy's)
  seatOrder: string[]                    // fixed table seat order, stable across rounds
  chips: Record<string, number>
  bets: Record<string, number>           // this round's original bet per seat (0 if sitting out)
  sittingOut: Record<string, boolean>
  hands: Record<string, BlackjackHand[]> // per-seat, length 1 normally, 2 after a split
  activeHandIndex: Record<string, number> // which of hands[seat] is currently being played
  insuranceBets: Record<string, number>  // 0 if none taken
  dealerHand: Card[]
  dealerHoleRevealed: boolean
  shoeCount: number
  roundNumber: number
  roundResults: Record<string, { handIndex: number; result: BlackjackHand['result']; chipDelta: number }[]> | null
  cardBack: string
}
```

No `BlackjackPrivateState` content is needed (nothing is hidden per-seat)
— use `Record<string, Record<string, never>>` for `privateStates` so
`HostSession`'s generic shape still applies uniformly (matches how the
codebase always keeps the private/public split even when a game has
thin private state; do not skip creating `HostSession` just because
private state is empty — every consumer, sync code included, expects the
shape).

`BlackjackSession { session: HostSession<...>; shoe: Card[]; rng: () =>
number }` — same shape as `RummySession`.

## Actions (`rules.ts`)

```ts
export type BlackjackAction =
  | { type: 'PLACE_BET'; amount: number }
  | { type: 'TAKE_INSURANCE' }
  | { type: 'DECLINE_INSURANCE' }
  | { type: 'HIT' }
  | { type: 'STAND' }
  | { type: 'DOUBLE' }
  | { type: 'SPLIT' }
  | { type: 'START_NEXT_ROUND' }
```

Validate every action against `BlackjackPublicState.turn.phase` and, for
`HIT`/`STAND`/`DOUBLE`/`SPLIT`, against whose turn it actually is
(`currentPlayer(turn)`), same as Rummy's phase/turn gating. `PLACE_BET`/
`TAKE_INSURANCE`/`DECLINE_INSURANCE` are NOT single-current-player
actions — every eligible seat acts once per round in seat order, but a
seat that hasn't acted yet doesn't block a DIFFERENT eligible seat from
acting first if action order doesn't matter for betting/insurance
(unlike HIT/STAND, which must respect the single acting seat for the
"one seat's turn to hit/stand" flow). Model betting/insurance as
"every seat not yet resolved may act, order-independent" (track via a
`Record<string, boolean>` "has this seat bet/insured yet" rather than
forcing `TurnState` rotation through a phase with no real turn order) —
document this deviation with a one-line comment; it's the correct
mechanic here, not a shortcut around `TurnState`.

## `hand-value.ts`

Pure functions, no engine/HostSession dependency:
- `cardValue(rank: Rank): number` — 2-10 face value, J/Q/K = 10, A = 11
  (soft) or 1 (hard), resolved by `handValue` below.
- `handValue(cards: Card[]): { total: number; soft: boolean }` — best
  legal total <= 21 counting aces as 11 where possible, else all aces
  as 1; `soft` is true iff at least one ace is still being counted as
  11 in the returned total (i.e. total would exceed 21 if that ace were
  11→ actually means: soft = an ace is counted as 11 in this total).
- `isBust(cards: Card[]): boolean`
- `isNaturalBlackjack(cards: Card[]): boolean` — exactly 2 cards,
  `handValue(cards).total === 21`.

## `bot.ts`

Fixed basic-strategy `BlackjackBotStrategy` (a `BotStrategy` per
`src/engine/bot.ts`'s generic shape) used identically for every bot seat,
documented as the charter's locked v1 simplification:
- Betting: always bet the table minimum (10).
- Insurance: always decline.
- Acting: `HIT` while `handValue(hand.cards).total < 17`, else `STAND`.
  Never `DOUBLE`, never `SPLIT` (even on a splittable pair) — the bot
  strategy function must not even consider those actions, per the
  charter's documented simplification, so this is a real behavioral
  constraint to test, not just "the bot happens not to").
- `START_NEXT_ROUND`: bots never trigger this themselves (mirrors any
  sibling game's "advance" convention where wiring, not bots, calls it —
  confirm this against Rummy's bot.ts and match it).

## Tests to write (required, not exhaustive — add more as needed)

- Shoe: 6-deck creation is 312 cards; reshuffle triggers exactly when
  remaining < 78 before a deal, never mid-round; a full round's card
  draws never exceed the shoe.
- `hand-value.ts`: hard totals, soft totals (A+6 = soft 17, A+6+10 =
  hard 17), bust detection, natural blackjack detection (incl. that a
  split-aces 21 is NOT flagged as natural via the round-settlement path
  — test this through `rules.ts`, not just the pure function, since
  `isNaturalBlackjack` alone can't know about split provenance).
- Betting: below-min and above-max bets rejected; bet exceeding chips
  rejected; a seat with insufficient chips is auto-`sittingOut` and
  skipped for dealing.
- Insurance: only offered when up-card is Ace; correct 2:1 payout only
  when dealer has natural blackjack; insurance loss is independent of
  the main hand's own result (a hand can win its main bet while still
  losing its insurance stake).
- Split: same-rank-only; second card drawn per new hand; one split max
  (attempting to split a split-hand rejected); split aces get exactly
  one card each and auto-stand; correct bet deduction (matches original
  bet on the new hand).
- Double: only as first action on a 2-card hand; correct bet doubling
  and exactly-one-card draw; auto-stand regardless of resulting total.
- Dealer play: hits through 16, stands on hard AND soft 17; hole card
  reveal timing (`dealerHoleRevealed` false until every player hand is
  done, true after).
- Payout precedence: bust-before-blackjack-check ordering (a player who
  busts never gets blackjack payout even in a contrived state), dealer-
  bust vs player-bust simultaneously (impossible in practice since
  dealer only plays after all players resolve, but confirm the payout
  function's precedence order is still followed if called with a busted
  player hand), push cases (18 vs 18, and blackjack vs blackjack).
- Full round integration test: multi-seat (3+) round from bet through
  payout with at least one split, one double, one bust, one push,
  asserting final `chips` values arithmetically by hand.
- Bot strategy: never emits DOUBLE/SPLIT actions even when profitable/
  legal; always bets the minimum; hits below 17 / stands 17+ including
  a soft-17 bot hand (bot has no special soft-17 handling beyond the
  plain `< 17` check — confirm this is intentional per the spec, i.e.
  bot stands on soft 17 same as hard, which is a DIFFERENT decision
  from the dealer's forced-hit-through-16 rule; they are not required
  to match since one is a strategy choice and the other is the fixed
  house rule).
- Wire-safety: run `assertWireSafe` (or the same JSON-round-trip check
  Rummy's tests use) over a representative mid-game `BlackjackPublicState`.

## Verification commands (must all be clean before reporting done)
```
npx tsc -b --noEmit
npx vitest run src/card-games/blackjack
```
Report actual output, not "should pass." If either command fails, fix it
before reporting — do not report done with a red suite or red tsc.

## Honest-failure escape hatch
If any locked decision above turns out to be internally inconsistent
once you're implementing it (not just "hard to implement" — genuinely
contradictory), stop and report exactly what's contradictory instead of
silently resolving it your own way. Everything else in this spec is
final.
