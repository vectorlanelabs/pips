# Farkle — AI Grouch (Oscar) Review

**Date:** 2026-08-24  
**Reviewer:** Oscar (ai-grouch), run via Bartowski  
**Scope:** `src/games/farkle.ts`, `src/games/farkle.test.ts`, `src/screens/FarkleTable.tsx`, Farkle action/state handling in `src/state/room.ts`, host/bot wiring in `src/App.tsx`, shared dice animation/sound behavior, Farkle rules copy, and the shared results screen.

**Baseline:** checkout on `main` @ `d160de5`. The targeted Farkle test passed **8/8** and TypeScript was clean. The full Vitest suite did **not** pass: **1397/1398** tests passed because an unrelated Scrabble bot test timed out. No browser session was run.

---

### Executive verdict

**needs changes** — the Farkle state machine is compact and, by inspection, the normal scoring, bank, bust, hot-dice, opening-threshold, and final-round paths are coherent. The problem is not a confirmed ordinary-play engine corruption; it is that the game's core rules have only eight tests, all for one final-round helper, while the bot pacing is a direct reuse of the shared `BASE_MS` rhythm despite a project rule that explicitly requires per-game human-speed scrutiny at a full table. The targeted test and typecheck are green, but that is weak evidence for Farkle correctness, and the full repository test baseline is currently red for an unrelated Scrabble timeout.

### Blocking issues

none

### Major concerns

#### 1. The Farkle rules and room transitions are effectively untested

- **severity:** major
- **evidence:** `src/games/farkle.test.ts` imports only `tookFinalTurn` and contains eight assertions covering its `finalRound`/`triggerSeatIndex` guards and a few cyclic-index examples. There are no tests for `scoreSelection`, `bestSubset`, `hasAnyScore`, `decideFarkleBot`, or any Farkle handler in `src/state/room.ts`.
- **impact:** the most failure-prone parts of the game — singles, triples through six-of-a-kind, straights, three pairs, invalid mixed selections, hot dice, opening entry, lost turn totals, match completion, host authorization, and bot decisions — can regress while the requested Farkle test remains green. The current eight tests prove only a helper used for scoreboard subtitles; they do not prove that a player can actually play Farkle.
- **suggested fix:** add beside-code tests for every scoring shape and for each room action transition. Include explicit malformed/out-of-turn action tests, opening-score rejection/acceptance, farkle loss, hot dice, crossing the winning score, final-lap completion after both bank and bust, and tie behavior. Add deterministic `Math.random` control or injectable rolls for state tests.

#### 2. Bot pacing is not demonstrated to meet the repository's top playability standard

- **severity:** major
- **evidence:** `runFarkleBot` in `src/App.tsx:4407-4441` waits `BASE_MS` (900ms) before every roll, only `BASE_MS * 0.6` (540ms) before the selection sequence, and another 540ms before banking or rolling again. The loop performs every `farkleToggle` for a chosen subset synchronously, then immediately schedules the next action. `BASE_MS` is a shared default, while `CLAUDE.md` explicitly says a new game must not inherit it without checking human pace and must be judged with the maximum number of bots.
- **impact:** at the advertised eight-seat maximum, a human can face up to seven consecutive bot turns, each made of multiple state broadcasts (roll, several toggles, then another roll/bank). A 540ms gap is enough to clear the current `useDiceAnimation` flicker (420ms), so I found no confirmed animation race in this code path, but there is no measurement or duration estimator for the complete Farkle action rhythm or sound assets. The implementation therefore does not establish that a full table remains readable rather than becoming a fast-forward sequence. This is exactly the failure mode the project standards prioritize.
- **suggested fix:** define Farkle-specific action pacing based on a human-turn observation, not the shared constant. Hold the next host action against the actual dice animation and sound duration, and test a full table with seven bots between human turns. If selecting several dice is represented as one visible decision, consider one consolidated host action or a deliberate pause that lets the changed selection register before the next roll.

#### 3. The host silently broadcasts rejected actions, leaving stale or invalid clients with no feedback

- **severity:** major
- **evidence:** `hostApply` in `src/App.tsx:700-707` always assigns, renders, and broadcasts the return value of `applyAction`, even when a Farkle handler returns the unchanged state. `farkleRoll`, `farkleToggle`, `farkleBank`, and `farkleEndTurn` all reject wrong-phase, wrong-seat, invalid-selection, or invalid-opening-score actions by returning `state` (`src/state/room.ts:236-323`). `FarkleTable` has no notice/error channel; it only disables controls for the local happy path.
- **impact:** a stale guest or a race against a bot sees a button press that does nothing and receives no explanation. For example, a guest can submit `farkleBank` just as the host has advanced the turn; the host silently re-broadcasts the old state, making the action indistinguishable from a dead button or connection failure. Normal controls reduce exposure, but host authority still needs an observable rejection path for stale network actions and debugging.
- **suggested fix:** make action application return a structured accepted/rejected result, or add a transient host/guest notice for rejected actions. At minimum, surface “not your turn,” “select scoring dice,” and “reach 500 to open” when a locally initiated action is rejected, rather than treating an unchanged state as success.

### Minor concerns and nits

- **Test gap:** `scoreSelection` has no direct coverage for all documented rule rows: single 1/5, triples, four/five/six of a kind, three pairs, straight, empty selection, and mixed scoring/non-scoring selections. `bestSubset` has no test for its stated “ties broken toward fewer dice” invariant.
- **Test gap:** `decideFarkleBot` is untested at zero score, below opening threshold, already-open players, winning-score banking, each difficulty, no-score rolls, and hot-dice rolls. Its `seatBanked > 0` proxy for “already open” should be covered explicitly.
- **Host validation gap:** `farkleToggle` accepts any numeric `dieId` and simply returns the same array if it is absent. This is harmless for the current UI but should be covered as a no-op, along with duplicate/stale IDs, because the host is the authoritative action validator.
- `FarkleState.rolling` exists but is never used by the Farkle engine or table. It does not currently break play because animation is local and state is broadcast immediately, but it is a misleading state field that could invite a future race-prone implementation.
- `rollDie` and `rollDice` use `Math.random()` directly. That is consistent with the legacy `room.ts` games and host ownership keeps the result authoritative, so this is not a current correctness defect; deterministic testability would still improve with an injectable random source.
- The game has no `DealIntro`, which is defensible: Farkle is a dice game and the closest sibling, Yahtzee, also has no card-deal intro. Adding a card-oriented deal animation would be cargo culting the convention rather than matching its reason.
- The Farkle table does apply the established active-seat treatment to the player rail and uses registered sound names. The main visual copy is concise and consistent with the sibling dice table; these are not issues.
- Final-round ties are resolved by stable seat order after sorting equal scores. The rules say “highest score wins” but do not define a tie-breaker; either document that house rule or test/handle ties explicitly.

### What the code gets right

- **The documented scoring implementation is internally coherent.** Singles of 1 and 5 score independently; triples use 1,000 for ones and face × 100 otherwise; four/five/six of a kind double the triple value each time; six-die straights and three pairs score 1,500. `scoreSelection` rejects a selection containing a non-scoring die, which matches the rules copy.
- **Subset selection is simple and bounded.** `bestSubset` exhaustively checks the at-most-six-die power set, returns the highest valid score, and applies the documented fewer-dice tie break. There is no unnecessary abstraction or unbounded search.
- **The host owns the canonical Farkle state and random rolls.** Guest actions are sent to the host, `applyAction` checks the active seat in every Farkle handler, and only the host broadcasts the resulting plain serializable `RoomState`. This matches the repository's authority boundary.
- **Banking and opening behavior agree between UI and host.** The table disables Bank until the active player has a positive table total and either already has a score or has reached the 500 opening threshold; `farkleBank` repeats the same checks host-side instead of trusting the client.
- **Farkle detection and loss accounting are clear.** A roll with no scoring subset increments the seat's `farkles`, records the turn total as `lost`, logs the bust, and leaves the player in an explicit `farkle` state until `End turn` advances play.
- **Hot dice and final-round progression are handled in the right places.** Selecting all six scoring dice resets the kept pool and rolls six new dice. Crossing 10,000 sets a trigger seat, and both bank and bust paths call the shared final-round completion check, avoiding the common bug where a final-round bust skips match completion.
- **The table's local animation/sound sequencing is thoughtful.** `useDiceAnimation` gives a new roll seven 60ms flicker frames; Farkle delays the local bust cue by 420ms and auto-advances after 1.8s. The table suppresses opponent/bot sound spam, and the active seat card uses the established sibling highlight treatment.
- **The targeted test and TypeScript check passed.** That verifies the test file itself and the compile-time wiring. It does not compensate for the missing rules/transition coverage, and the full suite's unrelated failure must remain visible in release reporting.

### Best next moves

1. Add a real `src/state/room.test.ts` or Farkle-focused room test module alongside the relevant code, plus comprehensive `src/games/farkle.test.ts` coverage for scoring, subsets, bot decisions, and final-round behavior.
2. Test the advertised game boundary: a full eight-seat table with seven bots, measuring time from one human turn to the next and checking that dice animation and registered sounds are not overlapped or skipped. Replace shared `BASE_MS`/`0.6` pacing with a Farkle-specific measured schedule if needed.
3. Make rejected Farkle actions observable to the initiating player and add tests proving wrong-seat, invalid-selection, below-opening, stale-ID, and wrong-phase actions do not mutate canonical state.
4. Add explicit tests/documentation for final-round ties and confirm the one-seat start policy against the landing copy that advertises Farkle as 2–8 players.
5. Re-run the targeted test, `npx tsc -b --noEmit`, and the full suite after the changes; separately investigate the existing Scrabble timeout before treating the repository baseline as green.

### Codebase review addendum

- **systemic risks:** The legacy `RoomState` action path communicates rejection by returning the old state, and the shared `hostApply` broadcasts that unchanged state without an outcome. Farkle exposes the resulting silent-failure problem, but the same boundary exists for the other legacy games. Primitive action payloads and direct `Math.random()` calls also make deterministic transition testing harder than it needs to be.
- **hotspots worth manual inspection:** `App.tsx`'s shared `runBotsIfNeeded` scheduler and `BASE_MS`; `room.ts`'s action handlers for all legacy games; `useSound`'s fire-and-forget audio creation; and any screen whose visible state is animated locally while the host advances canonical state immediately.
- **repeated anti-patterns:** Core room handlers have no direct tests for several games; rejected actions are no-ops with no user-facing outcome; and shared bot pacing is easy to inherit without a per-game human-speed budget. These are systemic review targets, not reasons to claim Farkle has a confirmed scoring defect.
- **areas healthier than expected:** Farkle's rule code is small and readable, the six-die exhaustive subset search is appropriately bounded, host-side seat checks are present, and the UI has better-than-average attention to active-turn styling and local dice/bust sequencing. The final-round helper has useful cyclic tests even though the rest of the game is not covered.

#### Test case completeness matrix

| Area | Status |
|---|---|
| Single 1 and single 5 scoring | ❌ missing |
| Three/four/five/six of a kind | ❌ missing |
| Straight 1–6 | ❌ missing |
| Three pairs | ❌ missing |
| Mixed scoring and non-scoring selection rejection | ❌ missing |
| Empty selection rejection | ❌ missing |
| `bestSubset` maximum-score selection | ❌ missing |
| `bestSubset` fewer-dice tie break | ❌ missing |
| Farkle detection and turn-total loss | ❌ missing |
| Hot dice reset and reroll | ❌ missing |
| Opening threshold rejection at 499 | ❌ missing |
| Opening threshold acceptance at 500 | ❌ missing |
| Banking after a player is already open | ❌ missing |
| Host/out-of-turn action authorization | ❌ missing |
| Invalid/stale die ID handling | ❌ missing |
| Final-round trigger after crossing 10,000 | ❌ missing |
| Final-round completion after bank | ❌ missing |
| Final-round completion after bust/end turn | ❌ missing |
| Final-round cyclic helper | ✅ 8 assertions |
| Final-round tie behavior | ❌ missing / rule unspecified |
| Bot no-score, opening, bank, win, and difficulty decisions | ❌ missing |
| Farkle bot pacing and full-table sequencing | ❌ missing |
| Local dice animation/bust sound sequencing | ❌ missing |
| Targeted Farkle Vitest command | ✅ 1 file, 8/8 tests passed |
| TypeScript build check | ✅ `npx tsc -b --noEmit` passed |
| Full Vitest suite | ⚠️ 65 files passed, 1 failed; 1397/1398 tests passed due to Scrabble timeout |

**Coverage limitation:** I cannot run the app in a browser in this review. The pacing, audio, stale-action, and visual claims are grounded in the rendered code and shared sibling conventions; a manual two-browser, full-table session is still required before release.

#### Test command evidence

Targeted Farkle command:

```text
RUN  v4.1.10 /opt/data/pips-ai-player/pips


 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  20:06:55
   Duration  732ms (transform 79ms, setup 0ms, import 117ms, tests 24ms, environment 0ms)
```

TypeScript:

```text
npx tsc -b --noEmit

(exit code 0; no output)
```

Full suite:

```text
> pips@0.0.0 test
> vitest run


 RUN  v4.1.10 /opt/data/pips-ai-player/pips

 ❯ src/board-games/scrabble/bot.test.ts (6 tests | 1 failed) 10339ms
     × at easy, bot sometimes picks lower-scoring candidates 9129ms

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 FAIL  src/board-games/scrabble/bot.test.ts > Scrabble bot word search > at easy, bot sometimes picks lower-scoring candidates
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".

 Test Files  1 failed | 65 passed (66)
      Tests  1 failed (1)
   Start at  20:07:55
   Duration  38.36s (transform 2.94s, setup 0ms, import 4.77s, tests 22.75s, environment 10ms)
```
