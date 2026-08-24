# Yahtzee — AI Grouch (Oscar) Review

**Date:** 2026-08-24  
**Reviewer:** Oscar (ai-grouch), run via Bartowski  
**Scope:** `src/games/yahtzee.ts`, `src/games/yahtzee.test.ts`, `src/screens/YahtzeeTable.tsx`, Yahtzee wiring and bot pacing in `src/App.tsx`, host-side Yahtzee transitions in `src/state/room.ts`, Yahtzee types, rules copy, shared dice animation/sound behavior, and the established sibling turn treatment in `TttTable.tsx` and `Connect4Table.tsx`.

**Baseline:** `main` @ `d160de5` as supplied. No git operations were performed. The requested targeted test and TypeScript check were run against the repository and are reproduced verbatim below.

---

### Executive verdict

**needs changes** — the scoring primitives are unusually well covered and the ordinary host-side turn flow is coherent, but the review found a real authoritative-boundary hole: a malformed network action can add arbitrary category keys to a scorecard and eventually satisfy the 13-category completion test. The table is playable on the happy path, and the 2-second bot cadence is substantially more defensible than the old shared 900ms pacing, but Yahtzee still skips the sibling turn-highlight treatment and exposes no meaningful feedback for rejected/stale actions. The main release risk is not the basic category arithmetic; it is unvalidated serialized input and a test suite that does not exercise the room state machine that actually enforces playability.

### Blocking issues

none

### Major concerns

#### 1. Runtime category validation is missing at the host authority boundary

- **severity:** major
- **evidence:** `src/types.ts:176-188` describes `yahtzeeScore.category` as `YCategory`, but that is only a TypeScript compile-time constraint. `src/state/room.ts:350-365` checks only `y.cards[by]?.[category] !== undefined`, calls `scoreCategory`, and then writes `[category]: points` into the canonical card. `scoreCategory` falls through to `0` for an unknown category (`src/games/yahtzee.ts:43-69`). `src/App.tsx:700-707` applies the action and broadcasts the result without a runtime schema check.
- **impact:** a normal UI cannot generate the payload, but a stale, buggy, or manually crafted PeerJS client can send distinct strings such as `"bogus1"` through `"bogus13"`. Each is accepted as a zero-valued card key; after 13 such actions, `Object.keys(cards[s.id]).length >= 13` makes `allDone` true and sends the room to results. The host is supposed to be authoritative for validation and canonical state; here the host trusts a type annotation that does not exist on the wire. The same gap also lets an invalid category be recorded mid-game, corrupting the scorecard and preventing the legitimate category from being selected later.
- **what would change my mind:** a runtime guard that rejects unless `Y_CATEGORIES.includes(category)` and a regression test proving an invalid serialized category leaves the room unchanged and cannot advance completion.

#### 2. Yahtzee omits the established active-seat treatment from the scorecard

- **severity:** major
- **evidence:** `src/screens/YahtzeeTable.tsx:158-184` renders seat names and score cells but never derives an active scorecard column or applies active-seat styling. The only live affordance is a yellow category button when `isMyTurn` (`:232-247`). `src/screens/TttTable.tsx:114-132` and `src/screens/Connect4Table.tsx:116-134`, the closest sibling board-game tables, explicitly compute `isActive` and change the seat card background, text color, and shadow.
- **impact:** with several seats, the player rail gives no persistent visual answer to “whose turn is it?”; the user must infer it from the separate throw banner and find the one enabled score cell among the columns. This is especially weak while bots take consecutive turns, when the scorecard is the main shared table view. It violates the repository’s own stated convention that new games match established turn highlighting, rather than merely being functional.
- **suggested fix:** highlight the active seat’s scorecard header and/or full score column using the same active-seat color treatment as the sibling tables, while retaining the current yellow select-a-category affordance for the local player.

#### 3. Rejected actions are indistinguishable from dead buttons or network failure

- **severity:** major
- **evidence:** `yahtzeeRoll`, `yahtzeeToggleHold`, and `yahtzeeScore` in `src/state/room.ts:332-370` return the original room for wrong phase, wrong actor, no dice, exhausted rolls, unknown die IDs, and filled categories. `hostApply` in `src/App.tsx:700-707` broadcasts whatever state comes back, and `dispatch` (`:710-713`) has no action-result or error channel. `YahtzeeTable.tsx` disables the obvious normal-path controls, but it has no notice for a stale click or rejected remote intent.
- **impact:** a player whose tab is one update behind can click a category or die and see nothing happen, with no explanation that the category was already filled, the turn moved, or the action was rejected. This is a reachable multiplayer condition, not just a malicious-input case. The result is a silent failure at the exact point where a scorecard decision matters.
- **suggested fix:** return a structured accepted/rejected result or thread a transient host notice to the initiating seat. At minimum, surface “turn changed,” “category already filled,” and “no rolls left” rather than treating every no-op as success.

#### 4. The Joker rule is implemented as a house variant but not explained to players

- **severity:** major
- **evidence:** `scoreCategory` sets `joker` when the roll is five of a kind, `card.yahtzee` is merely defined (including `0`), and the matching upper box is defined (`src/games/yahtzee.ts:34-35`). The tests intentionally lock in that a zeroed Yahtzee box still enables lower-box Joker scoring (`src/games/yahtzee.test.ts:118-122`). The rules overlay (`src/data/rules.ts:28-45`) explains the 50-point Yahtzee and the upper bonus, but says nothing about Joker scoring or what happens after a zeroed Yahtzee box. The table only says “+100 each extra” (`YahtzeeTable.tsx:170`).
- **impact:** the code may be a deliberate variant, but a player cannot infer why five equal dice can score 25/30/40 in a lower box after the Yahtzee box is filled, or why the same behavior remains after a zero. If standard Yahtzee rules are intended, the zero-box behavior is suspect; if this is an explicit house rule, the UI currently hides a material scoring rule. Either way, the implementation and product contract are not aligned.
- **suggested fix:** decide and document the intended rule. Add the Joker condition, zero-box behavior, and +100 bonus to the rules overlay, then keep engine tests and copy in lockstep. If the standard rule is intended, change the predicate and regression tests accordingly.

### Minor concerns and nits

- **Test gap, core room flow:** `src/games/yahtzee.test.ts` has 47 tests, but those are overwhelmingly pure scoring and bot-decision tests. The room-level tests in `src/state/room.test.ts` cover the +100 bonus path, not the full Yahtzee turn lifecycle. There is no direct coverage for initial roll, exactly three rolls, held-die preservation, score locking, wrong-seat rejection, round advancement, all 13 categories being filled, final winner selection, or malformed actions.
- **Input bounds are assumed rather than defended:** `scoreCategory` accepts arbitrary `number[]` and treats values outside 1–5 as face 6 in `multisetKey` for bot search. The engine normally creates valid dice, so this is not a normal-play bug, but exported pure functions and serialized state have no explicit invariant test for exactly five values in the 1–6 range.
- **Unknown die IDs produce a new but unchanged state:** `yahtzeeToggleHold` maps every die and returns a new room even when `dieId` is absent. That can create needless broadcasts and renders for malformed/stale input. It is limited blast radius, but a no-op should be a no-op.
- **Tie policy is implicit:** `yahtzeeScore` sorts descending and chooses the first seat on equal totals. The rules say “highest grand total wins” but do not explain ties; the deterministic seat-order choice is defensible, but the UI/copy should state the policy or model a tie.
- **The scorecard is horizontally scrollable rather than responsive at eight seats:** `overflowX: auto` is a reasonable fallback, but the active column is not pinned or highlighted, making a full eight-seat table harder to read.
- **No DealIntro is appropriate here:** Yahtzee is a dice game, not a card deal. The omission is defensible; forcing a card-oriented deal animation would be cargo cult rather than a sibling-pattern match.
- **No confirmed animation/sound race:** `YAHTZEE_ACTION_MS` is 2000ms, and the bot waits 1200ms between hold decisions and rerolls/scoring. That is materially safer than bare `BASE_MS`; the visible dice animation and registered dice/bank sounds have room to land by inspection. This should remain a per-game constant rather than being regressed to the shared 900ms cadence.

### What the code gets right

- **All 13 category formulas are clear and mostly correct.** Upper boxes sum only the matching face; three/four of a kind use all five dice; full house and straight detection correctly tolerate duplicates where appropriate; chance sums all dice; Yahtzee is exactly five equal values.
- **The 35-point upper bonus is separated correctly from the card.** `upperTotal` ignores lower boxes and `grandTotal` adds 35 only at 63 or above. The room-level Yahtzee bonus is kept in `bonuses` and added exactly once when the seat score is recomputed.
- **Second-Yahtzee bonus handling is covered better than the surrounding legacy games.** `src/state/room.test.ts` checks first Yahtzee, a zeroed Yahtzee box, non-Yahtzee rolls, accumulation, and no double counting. The distinction between `=== 50` for the +100 bonus and `!== undefined` for the tested Joker behavior is deliberate, even though the rule needs documentation.
- **The ordinary three-roll/hold/score flow is straightforward.** The host checks screen and seat ownership; a turn starts with three rolls, rerolls only unheld dice, permits scoring after any roll, clears dice, resets rolls, and advances the turn after scoring. Filled categories are locked in the normal typed path.
- **Host-side randomization is in the right place.** `yahtzeeRoll` rolls on the host in `src/state/room.ts`; clients submit intents and render the resulting plain serializable state. No React or screen dependency leaks into the game engine module.
- **Bot hold decisions are not a superficial heuristic for medium/hard.** The expected-value search enumerates weighted dice multisets, memoizes by dice multiset and rolls remaining, and incorporates upper-bonus pressure for hard mode. The tests cover depth-sensitive holding, straight pursuit, Yahtzee holds, difficulty differences, and bonus awareness.
- **Bot pacing is consciously game-specific.** The comment beside `YAHTZEE_ACTION_MS` documents why 2000ms was chosen, and a full multi-bot table does not collapse into the old 900ms rapid-fire pattern. Stale-key checks occur before each state-changing step, and holding all dice avoids an unnecessary no-op reroll.
- **Dice interaction follows sibling affordances.** `Die` exposes an accessible label, held dice remain visually selected, and `partitionDiceOrder` moves held dice as a group only on the next roll instead of jumping them during a hold click. Sound calls use the central registry rather than ad hoc audio paths.
- **The targeted tests and TypeScript check are genuinely green.** This is useful evidence for the pure engine and wiring, not proof that the room state machine or browser playability is complete.

### Best next moves

1. Add a runtime `YCategory` guard at the host boundary and test invalid category payloads, including the 13-invalid-key completion attack; reject unknown die IDs without broadcasting an unchanged state.
2. Add room-level tests for every Yahtzee transition: first/second/third roll, holds, wrong seat, exhausted rolls, category lock, all 13 rounds, winner/tie policy, and serialized malformed actions.
3. Resolve and document the Joker/zeroed-Yahtzee rule, including the +100 bonus, in the rules overlay and regression tests.
4. Add active-seat styling to the scorecard columns, matching `TttTable.tsx` and `Connect4Table.tsx`.
5. Add a visible rejection/notice path for stale or invalid actions, then run one manual multi-seat session with a human plus several bots to verify that the table remains understandable and that dice/sounds are not overlapped.

### Codebase review addendum

- **systemic risks:** The legacy `RoomState` path relies on TypeScript action unions as if they were runtime schemas. PeerJS transports data, not types. Yahtzee makes the consequence especially clear because an arbitrary category key is persisted and counted toward match completion. The same audit should be applied to the other legacy games’ numeric/string action payloads.
- **hotspots worth manual inspection:** `hostApply`/guest action deserialization in `src/App.tsx`; all `applyAction` branches in `src/state/room.ts`; shared no-op rejection behavior; and `Results.tsx`, whose generic winner sound currently plays `game-win` for every local player, including a loser.
- **repeated anti-patterns:** rejected actions return the old state with no reason; compile-time unions stand in for runtime validation; and legacy screens are inconsistent about active-seat highlighting. These are not Yahtzee-specific design preferences.
- **areas healthier than expected:** the scoring module is compact rather than over-abstracted, the bot search has real memoized expected-value logic, host ownership is explicit, and the Yahtzee bonus has meaningful room-level regression tests. The principal missing evidence is the transition layer between those good pure functions and the live multiplayer table.

#### Test case completeness matrix

| Area | Status |
|---|---|
| Upper categories (ones through sixes) | ✅ covered, representative cases |
| Three/four of a kind scoring | ✅ covered |
| Full house valid/invalid shapes | ✅ covered |
| Small/large straight and duplicates | ✅ covered |
| Yahtzee and chance | ✅ covered |
| Upper 63-point bonus | ✅ covered |
| Yahtzee +100 bonus and accumulation | ✅ covered in `src/state/room.test.ts` |
| Joker with Yahtzee 50 | ✅ covered |
| Joker with Yahtzee 0 / intended house rule | ⚠️ behavior covered, product rule undocumented |
| Initial roll and exactly three-roll limit | ❌ missing — room transition untested |
| Hold/unhold and held dice surviving rerolls | ❌ missing |
| Wrong-seat roll/hold/score rejection | ❌ missing |
| Score before first roll / after no dice | ❌ missing |
| Exhausted-roll score selection | ❌ missing |
| Filled-category lock | ❌ missing |
| All 13 categories and round advancement | ❌ missing |
| Final winner and tie behavior | ❌ missing |
| Invalid category at serialized host boundary | ❌ missing — would catch Major #1 |
| Invalid/unknown die ID | ❌ missing |
| Bot hold strategy and difficulty differences | ✅ covered substantially |
| Full-table bot pacing and sound/animation sequencing | ❌ no automated coverage; code-path inspection only |
| Active-seat scorecard rendering | ❌ missing |
| Rejected-action player feedback | ❌ missing |
| Targeted Yahtzee Vitest command | ✅ 47/47 passed |
| TypeScript build check | ✅ passed with exit code 0 |

**Coverage limitation:** I cannot run the app in a browser in this review. Playability conclusions about active-column visibility, stale-action feedback, and full-table pacing are grounded in the rendered code and sibling conventions; they still deserve a manual multi-seat browser session before release.

#### Test command evidence

Targeted Yahtzee tests:

```text
RUN  v4.1.10 /opt/data/pips-ai-player/pips


 Test Files  1 passed (1)
      Tests  47 passed (47)
   Start at  20:06:39
   Duration  3.66s (transform 203ms, setup 0ms, import 248ms, tests 3.10s, environment 0ms)
```

TypeScript:

```text
npx tsc -b --noEmit

(exit code 0; no output)
```
