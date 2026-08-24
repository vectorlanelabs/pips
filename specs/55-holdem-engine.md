# Spec 55 — Texas Hold'em card engine

Part of the Blackjack + Texas Hold'em charter (`CHARTER.md`), milestone
M3. Engine only — no React, no screens, no wiring. Mirrors the same
conventions as `src/card-games/blackjack/` and `src/card-games/rummy/`
(`HostSession`/`TurnState`/`applyAction`/`runBotTurn` from `src/engine/`,
`Zone`/`Card`/`createStandardDeck`/`shuffleDeck`/`dealCards` from
`src/card-engine/`). Read `src/card-games/blackjack/state.ts` and
`rules.ts` before writing anything — same file-split shape applies here
(state.ts / hand evaluator / rules.ts / bot.ts), and this spec's own
"nothing gets left behind" testing bar (spec 52's post-hoc payout bug —
see `docs/DEVLOG.md` cycle 5 — is required reading before you write a
single payout line in this spec: **every chip-moving branch must have a
test that hand-traces a full chip trajectory from a known starting stack
to a known final stack**, not just a per-action delta).

## Files you own
- `src/card-games/holdem/state.ts`
- `src/card-games/holdem/state.test.ts`
- `src/card-games/holdem/hand-eval.ts` (pure 7-card hand evaluator)
- `src/card-games/holdem/hand-eval.test.ts`
- `src/card-games/holdem/rules.ts`
- `src/card-games/holdem/rules.test.ts`
- `src/card-games/holdem/bot.ts`
- `src/card-games/holdem/bot.test.ts`

Do not touch any other file. Do not run `git`.

## Locked design

**Table:** 2-8 seats, `HOLDEM_MIN_SEATS = 2`, `HOLDEM_MAX_SEATS = 8`.
Every seated player starts with **1000 chips**, set once at
`createHoldemGame` and never replenished. `HOLDEM_SMALL_BLIND = 5`,
`HOLDEM_BIG_BLIND = 10`, fixed for the whole session (no escalation —
this is a cash-game-style table, not a tournament, per the charter).

**Deck:** single standard 52-card deck (`createStandardDeck()`),
shuffled fresh at the start of EVERY hand (not reused across hands — no
"shoe" concept here, unlike Blackjack).

**Dealer button / blinds:** a `buttonSeat: string` (a playerId) rotates
to the next NON-ELIMINATED seat (in `seatOrder`, wrapping) at the start
of every new hand. Small blind = the next non-eliminated seat after the
button; big blind = the next one after that (heads-up/2-player special
case: the button IS the small blind, and the other player is the big
blind — this is the standard heads-up rule, get it right, it's a common
off-by-one). Blinds are POSTED (forced bets) before any cards are dealt
— deduct immediately from chips into the pot, same escrow pattern as
Blackjack's bets (and same discipline: **write the chip-trajectory
tests BEFORE trusting any settlement code**, per this spec's opening
note). A blind that exceeds a seat's remaining chips is posted as an
all-in for whatever they have (a legal, standard short-stack blind).

**Deal:** 2 hole cards to each seated (non-eliminated, non-sitting-out)
player, dealt in one pass per player (not alternating single cards like
some physical-table conventions — this codebase's existing `dealCards`
helper deals a player's full allotment in one call, matching Rummy/
Blackjack's own dealing code; don't overthink this into a multi-pass
loop no other game here uses).

**Streets, in order:** `preflop` (betting starts left of the big blind
— i.e. next seat after BB, wrapping to the button/SB/BB last since they
already posted) -> `flop` (3 community cards, betting starts with the
first non-folded seat left of the button) -> `turn` (1 community card,
same betting-order rule as flop) -> `river` (1 community card, same) ->
`showdown`. A street ends the instant every non-folded, non-all-in
player has acted and all active bets are matched (standard "action is
closed" condition — see below for the exact rule). If only one player
remains un-folded at any point (everyone else folded), the hand ends
immediately awarding them the entire pot — skip straight to a
`handOver` phase, no further streets dealt, no showdown needed (board
cards already dealt stay dealt but no further ones are drawn).

**Betting actions (`HoldemAction`):**
```ts
export type HoldemAction =
  | { type: 'FOLD' }
  | { type: 'CHECK' }
  | { type: 'CALL' }
  | { type: 'BET'; amount: number }    // only legal when no bet exists yet this street; amount = total chips being put in this action (not incremental)
  | { type: 'RAISE'; amount: number }  // only legal when a bet already exists this street; amount = the new TOTAL bet-to amount for this street (e.g. facing a bet of 20, "raise to 50" is `{type:'RAISE', amount:50}`), not the increment
  | { type: 'START_NEXT_HAND' }
```
No separate `ALL_IN` action type — going all-in is just a `BET`/`CALL`/
`RAISE` for exactly the player's remaining chips (validated the same
way any other amount is, just capped at what they have). This keeps the
action surface small and matches how the UI naturally works (a bet-size
control that can't exceed your stack).

**Min-raise rule (standard NLHE, get this exactly right):** the minimum
legal raise-to amount is `currentBetThisStreet + max(lastRaiseIncrement,
bigBlind)`, where `lastRaiseIncrement` starts at the big blind amount
preflop (since posting the BB itself counts as the initial "bet" for
increment purposes) and updates to the size of each subsequent full
raise's increment. A player going all-in for LESS than the minimum
legal raise is allowed (short-stack all-in), but this does **not**
reopen betting for players who have already acted and merely face a
call — i.e., a player who already called or checked earlier this street
may NOT re-raise in response to a short all-in raise that didn't meet
the minimum increment; they may only call, fold, or (if there's a
larger separate raise for them to respond to) act on THAT — implement
this via a `lastFullRaiseAmount` (or equivalent) tracked field, and a
per-seat `canReraise`/`actedSinceLastFullRaise` style tracking so this
is enforced, not just documented. Get this right; it's the single most
commonly-botched rule in amateur poker engines and this spec calls it
out explicitly so it isn't missed.

**Side pots:** when one or more players are all-in for less than others'
total contribution this hand, split the pot into a main pot (capped at
the smallest all-in total contribution, shared by everyone who put in at
least that much) and one side pot per higher all-in tier, each side pot
only contestable by players who contributed at least that tier's
threshold. At showdown, award each pot (main, then each side pot in
ascending order) separately to the best hand among that pot's eligible
contestants — a player who is all-in for less can only win pots up to
their own contribution tier, never a side pot built from chips they
didn't put in. Implement this as a genuine, testable function (e.g.
`computeSidePots(contributions: Record<string, number>, foldedIds: Set<string>): { amount: number; eligiblePlayerIds: string[] }[]`)
with its own dedicated tests covering: no all-ins (single pot), one
all-in short of the table, two different all-in tiers, an all-in player
who then wins nothing because everyone else folded to the side-pot
level (they still win the main pot they were eligible for).

**Hand evaluator (`hand-eval.ts`):** given a player's 2 hole cards + the
board's community cards (3-5 of them depending on street — for
preflop-all-in-runout purposes you always evaluate at 7 cards once all 5
board cards are known), return the best possible 5-card hand rank
across all `C(7,5)=21` combinations. Standard hand hierarchy (highest
to lowest): straight flush, four of a kind, full house, flush, straight,
three of a kind, two pair, pair, high card. Handle the wheel (A-2-3-4-5
straight, ace low) as a valid straight (the lowest one). Export a
comparable rank type (e.g. `{ category: number; tiebreakers: number[] }`
or a single packed comparable number) plus a comparison function so two
hands can be ranked against each other and ties (split pots) are
detected exactly (equal category AND equal tiebreakers-in-order = a
tie, split that pot evenly among the tied winners — handle an odd chip
remainder by giving it to the first tied player in `seatOrder` order,
deterministic, no randomness).

**Bust / elimination:** a seated player who reaches 0 chips at the end
of a hand (after that hand's payouts) is eliminated — removed from
future dealing (tracked via an `eliminated: Record<string, boolean>`
field, NOT removed from `seatOrder` itself, matching how Blackjack
tracks `sittingOut` without shrinking `seatOrder`). The game ends
(`gameOverWinnerId` set) the instant only one non-eliminated seat
remains with chips > 0. Do not deal a new hand once this condition is
true.

## State shape (`state.ts`)

```ts
export type HoldemStreet = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'handOver'

export interface HoldemPlayerHandState {
  cards: Card[]           // always length 2 once dealt this hand, [] before dealt / after fold+reveal-not-needed
  folded: boolean
  allIn: boolean
  totalContributedThisHand: number   // across all streets, for side-pot math
  betThisStreet: number              // resets to 0 at the start of each new street
}

export interface HoldemPublicState {
  turn: TurnState<HoldemStreet>       // playerOrder = seats still able to act THIS STREET (folded/all-in seats excluded from rotation but not from the hand)
  seatOrder: string[]                  // fixed table seat order
  chips: Record<string, number>
  eliminated: Record<string, boolean>
  buttonSeat: string
  smallBlindSeat: string
  bigBlindSeat: string
  hands: Record<string, HoldemPlayerHandState>
  board: Card[]                        // 0, 3, 4, or 5 cards depending on street
  pot: number                           // total chips in the middle this hand (all streets combined)
  currentBetThisStreet: number
  lastFullRaiseIncrement: number
  handNumber: number
  handOver: boolean
  handResults: { winners: { playerId: string; amount: number }[]; potBreakdown: { amount: number; eligiblePlayerIds: string[]; winnerIds: string[] }[] } | null
  gameOverWinnerId: string | null
  cardBack: string
}
```
No private per-seat data lives in `HostSession`'s public half — hole
cards ARE private (unlike Blackjack). Use `HoldemPrivateState { hand:
Card[] }` (mirrors Rummy's private-hand pattern, NOT Blackjack's
no-privacy shape) and `deriveSnapshot`-style per-seat delivery — this is
the one place Hold'em genuinely differs from Blackjack's wiring shape;
note it clearly in your report so the screens/wiring specs (56/57) get
this right from the start instead of copying Blackjack's single-
broadcast pattern by reflex.

## Actions / validation (`rules.ts`)
Validate against `turn.phase` (the current street) and `currentPlayer
(turn) === playerId` for FOLD/CHECK/CALL/BET/RAISE (these ARE strictly
turn-ordered, unlike Blackjack's betting/insurance phases — Hold'em has
no order-independent-action phase at all, every street is a normal
turn rotation). `START_NEXT_HAND` follows the same "any seated,
non-eliminated player may trigger it once `handOver`" convention as
Blackjack's `START_NEXT_ROUND`.

## `bot.ts`
A documented, non-GTO heuristic (per the charter's "bot never bluffs"-
spirited simplification):
- Preflop: a simple starting-hand strength tier (e.g. pairs and A/K/Q
  high cards call/raise a small fixed amount over the current bet;
  everything else folds to any bet beyond the big blind, checks/calls
  the big blind itself for free). Keep this simple and DETERMINISTIC
  from the two hole cards' ranks/suited-ness — no randomness in the
  decision itself (randomness already exists in the deal).
- Postflop: evaluate current hand strength via `hand-eval.ts` against
  the current board; check/call if the hand is at least a pair or has
  reasonable equity (define a concrete, simple threshold — document it
  precisely, e.g. "at least a made pair, or 4+ cards to a flush/straight
  with 2+ streets left"), otherwise fold to any bet (check if there's
  nothing to call). Never bluffs (never bets/raises with a weak hand).
- Bot never triggers `START_NEXT_HAND` itself (matches Blackjack's
  bot convention — wiring, not bots, advances rounds... except spec 57
  will decide whether Hold'em's "next hand" is human-clicked like
  Blackjack's or automatic; for the ENGINE, just don't have the bot
  strategy function ever emit this action, regardless of which wiring
  approach is chosen later).

## Tests to write (required, not exhaustive)
- Hand evaluator: every hand category correctly identified and ranked,
  including the wheel straight, a flush beating a straight, kicker
  comparisons within the same category (two pairs of the same rank,
  different kickers), and exact ties (split pot detected).
- Side pots: the four scenarios listed above under "Side pots", each
  with hand-computed expected pot amounts and eligible-player sets.
- Blinds: heads-up button-is-SB special case; a short-stack forced
  all-in blind; blind posting correctly escrows chips into `pot`.
- Betting: min-raise enforcement (a raise below the legal minimum
  rejected, exact minimum accepted), the short-all-in-doesn't-reopen-
  action rule (a concrete scenario: player A bets, B calls, C goes
  all-in for less than a full raise, does A or B get to re-raise? No —
  confirm this exact rule with a test, not just documentation),
  action closing correctly advancing to the next street only once
  every live player has matched the bet or folded/is all-in.
- **Full hand chip-trajectory tests (the "nothing gets left behind"
  requirement from this spec's opening note)**: at least 3 full hands
  played end-to-end from a known starting chip distribution, through
  blinds/betting/showdown (or an early all-fold win), asserting every
  seat's FINAL chip count by hand-computed arithmetic — not just that
  `pot` reached some intermediate value. Include at least one hand with
  a side pot and one hand that ends by everyone folding to one player
  pre-showdown.
- Elimination: a seat reaching exactly 0 chips is marked eliminated and
  excluded from the next hand's dealing/blinds/button rotation;
  `gameOverWinnerId` set correctly when only one seat has chips left.
- Bot strategy: deterministic preflop tier behavior, postflop fold/call
  threshold behavior, never emits `START_NEXT_HAND`.
- Wire-safety: a representative mid-hand `HoldemPublicState` (with a
  side pot in progress) round-trips through JSON losslessly.

## Verification commands (must all be clean before reporting done)
```
npx tsc -b --noEmit
npx vitest run src/card-games/holdem
```
Report actual output. Fix before reporting if either is red.

## Honest-failure escape hatch
If any locked decision above is genuinely internally contradictory once
implementing, stop and report the exact contradiction instead of
silently resolving it. This spec is unusually detailed on purpose
(side pots and min-raise rules are the two places amateur poker
engines most often go wrong) — if something here doesn't compile
logically, that's worth flagging precisely, not smoothing over.
