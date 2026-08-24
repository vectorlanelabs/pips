# Spec 55b — Fix three severe Hold'em betting-flow bugs (spec 55 follow-up)

The lead reviewed spec 55's implementation by reading the actual code
(not just trusting the "63 passed" report) and found three real,
code-confirmed bugs in the core betting/turn-progression logic in
`src/card-games/holdem/rules.ts`, plus a vacuous-test problem in the
exact test category this spec's own opening note warned about. Fix all
four. This is not optional polish — the current engine cannot correctly
play a single realistic multi-player hand.

## Bug 1: `isActionClosed` has no "has this player acted" tracking

```ts
function isActionClosed(publicState: HoldemPublicState): boolean {
  const acting = getActingSeats(publicState)
  if (acting.length <= 1) return true
  const currentBet = publicState.currentBetThisStreet
  for (const seatId of acting) {
    if (publicState.hands[seatId].betThisStreet !== currentBet) return false
  }
  return true
}
```
This checks only that every acting seat's `betThisStreet` equals the
current bet — it never checks whether that seat has actually taken a
voluntary action yet this street. Concrete failure, traced by hand:
3 players postflop (current bet 0, everyone's `betThisStreet` reset to
0 at street start). P1 (first to act) checks. `betThisStreet` is
unchanged by a check (still 0 for all three). `isActionClosed` is
called right after this single check and finds every acting seat's
`betThisStreet` (0) equal to `currentBetThisStreet` (0) — and
incorrectly reports the street CLOSED after just one player's check,
skipping P2 and P3 entirely. The identical defect skips the big blind's
mandatory preflop option: once every other player has called the big
blind, the BB's own (already-posted, never-yet-voluntarily-acted-on)
bet trivially matches `currentBetThisStreet`, so the street closes
before the BB ever gets to act.

**Fix:** add `actedThisStreet: Record<string, boolean>` to
`HoldemPublicState` (and `HoldemPlayerHandState` is NOT the right place
for it — put it at the public-state level, one flat record, since it's
reset per-street for every seat, not per-hand). Reset every seat's
entry to `false` at the start of every new street, including preflop
(the blind posts do NOT count as having acted — this is what fixes the
BB-option bug). Set `actedThisStreet[playerId] = true` inside every one
of the FOLD/CHECK/CALL/BET/RAISE handlers, for whichever seat just
acted. Change `isActionClosed` to require, for every seat in
`getActingSeats(publicState)`: `actedThisStreet[seatId] === true &&
hands[seatId].betThisStreet === currentBetThisStreet`. Also update
`startNewHand`/`createHoldemGame`'s initial preflop state to initialize
`actedThisStreet` with every seat `false` (blinds posted, nobody has
"acted" yet) and `advanceStreet` to reset it to all-`false` for the new
street.

## Bug 2: fold's turn-index wraparound is wrong when the LAST-positioned player folds

```ts
const currentIndex = publicState.turn.currentIndex
const newPlayerOrder = publicState.turn.playerOrder.filter((id) => id !== playerId)
if (newPlayerOrder.length > 0) {
  const newIndex = Math.min(currentIndex, newPlayerOrder.length - 1)
  newTurn = { ...publicState.turn, playerOrder: newPlayerOrder, currentIndex: newIndex }
}
```
The folding player is always the current actor (already validated
earlier: `currentPlayer(publicState.turn) !== playerId` rejects
otherwise), so `currentIndex` is their own index in the OLD array. When
they're removed, the correct new current index is `currentIndex %
newPlayerOrder.length` (this correctly wraps to 0 when the folder was
at the last index of the old array) — NOT `Math.min(currentIndex,
newPlayerOrder.length - 1)`, which clamps instead of wraps and points at
the WRONG player whenever the folder was the last-positioned seat in
`playerOrder`. Trace: `playerOrder=[A,B,C,D]`, currentIndex=3 (D is
folding, D is last). Correct next actor is A (wrap to old index 0).
`newPlayerOrder=[A,B,C]` (length 3). Correct: `3 % 3 = 0` → A. Current
(buggy) code: `Math.min(3, 2) = 2` → C, which is wrong (skips A and B
entirely, hands the turn to C a second/incorrect time).

**Fix:** replace the index computation with `newIndex = currentIndex %
newPlayerOrder.length` (guard `newPlayerOrder.length > 0` first, as the
existing code already does before computing an index).

## Bug 3: all-in runout freezes the hand instead of auto-dealing remaining streets to showdown

When a street's action closes (via the corrected `isActionClosed` from
Bug 1) because every remaining live player is either folded or all-in
(0 or 1 seats left who can still act), the current code calls
`advanceStreet()` exactly ONCE (dealing exactly one street's worth of
board cards) and returns. If the resulting street is not yet
`showdown` AND the new street's acting-seat count is still `<= 1`
(because everyone left is all-in), there is no player who can ever
submit another action — `currentPlayer(turn)` on an empty or
single-but-already-all-in `playerOrder` means no valid action will ever
arrive, and the hand is stuck forever at that street with the board
never completing and showdown never happening. This is the standard
poker "all-in runout" scenario (e.g., a preflop all-in call with one or
more players covered) and it is extremely common, not a rare edge case.

**Fix:** wherever the code currently does "check `isActionClosed` ->
`advanceStreet` once -> maybe deal board cards -> return" (this pattern
is duplicated after FOLD, CHECK, CALL, BET, and RAISE — refactor it into
one shared helper function used by all five, rather than fixing it in
five places separately), change it to a LOOP: after advancing to a new
street and dealing its board cards, check whether the new street's
acting-seat count (via `getActingSeats` against the new state) is `<=
1` and the street is not yet `showdown`. If so, keep advancing
(dealing each remaining street's cards with NO betting in between,
exactly as real poker does when everyone left is all-in) until reaching
`showdown`, then call `conductShowdown` once, at the end. If the new
street's acting-seat count is `> 1` (there's real betting still
possible), stop looping and return that state normally (the common,
non-all-in case, unchanged from today). Write this as one clearly-named
helper (e.g. `advanceUntilActionOrShowdown`) called from all five action
handlers instead of five copies of ad-hoc inline logic — this is not
just a bug fix, it's also the right refactor given the same buggy
pattern is currently duplicated five times.

## Bug 4: the "full hand chip trajectory" tests are vacuous — this is the exact failure this spec warned about

Your own test file contains this comment, left in the shipped code:
```ts
// Actually this is getting complex without running through actual game flow
// Let me simplify and just verify the chip math makes sense
```
followed by a test that only checks `createHoldemGame`'s INITIAL state
(chip totals immediately after blinds are posted, before any action is
ever taken) — never actually playing FOLD/CHECK/CALL/BET/RAISE through
to a real settlement. This is precisely the "credited a vacuous test as
proof" failure this spec's opening section demanded you avoid, quoting
the Blackjack payout bug it was written in direct response to. It also
means Bugs 1-3 above went completely undetected by 63 "passing" tests.

**Required fix:** replace these tests with REAL ones that dispatch
actual actions through `applyHoldemAction` in sequence and assert:
1. A genuine 3-player hand where every player CHECKS around on the flop
   (no bets) — assert the engine does NOT advance to the turn until
   all 3 have checked (this directly tests the Bug 1 fix: assert the
   street is still `'flop'` after only 1 or 2 of the 3 have checked,
   and only becomes `'turn'` after the 3rd check).
2. A genuine 3-handed preflop sequence where everyone just calls the big
   blind (no raises) — assert the engine does NOT advance to the flop
   until the BIG BLIND has explicitly acted (check or raise) even
   though their bet already numerically matches — this directly tests
   the BB-option fix. Have the BB check to close the street, then
   assert the street becomes `'flop'` and 3 board cards are dealt.
3. A genuine all-in-preflop-runout: one player goes all-in preflop, one
   or two others call all-in (or call with enough chips to cover, but
   for this test make everyone who's still live end up all-in so no
   more betting is possible), assert the engine automatically deals out
   flop, turn, and river with no further actions required, reaches
   `showdown`/`handOver`, and produces a `handResults` with correct pot
   award(s) — hand-compute the exact expected final chip counts for
   this scenario from the known starting stacks and bet amounts, and
   assert against those exact numbers (not just a conservation total).
4. A fold-in-last-position scenario: construct a betting round where
   the CURRENTLY-ACTING player (whoever `currentPlayer(turn)` is) is at
   the LAST index of `turn.playerOrder`, have them fold, and assert the
   turn correctly wraps to the FIRST player in the remaining order (not
   an incorrect clamped index) — this directly tests the Bug 2 fix.
5. Keep (but don't rely solely on) a real full-hand-to-showdown test
   with a genuine side pot, asserting exact final chip counts for every
   seat computed by hand from the starting stacks, blinds, and bets —
   this is the category the spec originally asked for and it must
   actually drive real actions through `applyHoldemAction`, not just
   inspect `createHoldemGame`'s initial output.

## Files you own
- `src/card-games/holdem/state.ts` (add `actedThisStreet` field)
- `src/card-games/holdem/rules.ts` (all 4 fixes above)
- `src/card-games/holdem/rules.test.ts` (replace vacuous tests per Bug 4)
- `src/card-games/holdem/state.test.ts` (update if `actedThisStreet`'s
  initial shape needs its own coverage)

Do not touch `hand-eval.ts`, `hand-eval.test.ts`, `bot.ts`, or
`bot.test.ts` — those were reviewed separately and are correct as-is.
Do not touch any other file. Do not run `git`.

## Verify before reporting
Run, in the working directory
(`/Users/charlie/Desktop/Projects/pips/.claude/worktrees/poker-blackjack-loop`):
```
npx tsc -b --noEmit
npx vitest run src/card-games/holdem
npx vitest run
```
Expected: tsc clean, all Hold'em tests passing (more than the current
63 — you're both fixing real bugs and replacing vacuous tests with real
ones), full suite green. Report the ACTUAL final output of all three
commands verbatim.

## Critical instruction on trust
Before reporting done, for EACH of the 4 new/replaced tests described
above, confirm in your report that you watched it FAIL against the
pre-fix code (temporarily reverting your fix, or reasoning precisely
about why the old code would fail it) before confirming it passes
against the fixed code. A test that never demonstrably would have
caught the bug it's named for is not evidence of anything — this is
exactly how the last set of tests failed to catch these exact 3 bugs
while still reporting "all green."

## If stuck
After 3 failed attempts at any ONE of the 4 fixes, stop and report
precisely which one, what you tried, and what's still wrong. A
truthful partial report is far more valuable than a confident false
"all green" — this spec exists specifically because that happened once
already on this same file.

## Report format
- Files changed
- For each of the 4 bugs: the fix applied, and confirmation the
  corresponding new/replaced test fails against the OLD code and passes
  against the NEW code
- tsc real output
- vitest (holdem-only) real output
- vitest (full suite) real output
- Anything you're still unsure about
