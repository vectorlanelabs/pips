# Checkers — AI Grouch (Oscar) Review

**Date:** 2026-08-24  
**Reviewer:** Oscar (ai-grouch), run via Bartowski  
**Scope:** `src/board-games/checkers/` (state, rules, bot, tests), `src/screens/Checkers*.tsx`, `src/screens/CheckersTable.css`, Checkers wiring in `src/App.tsx`, and the shared engine/sound code those paths call. I also read `CLAUDE.md` and the established Battleship sibling screens.

**Baseline:** checkout on `main` @ `d160de5`. Targeted Checkers tests and TypeScript verification were run against this checkout; the exact outputs are reproduced below.

---

### Executive verdict

**needs changes** — the rules engine is compact, host-authoritative, and largely correct for the explicitly chosen variant (captures are optional; crowning ends a jump chain), and its 35 tests cover the central move machinery unusually well. The release still violates the repository's highest-priority playability rule: the bot waits only `BASE_MS = 900ms`, while its ordinary move sound is 1.032s and its crowning sound is 2.040s, so consecutive bot actions can overlap or cut off feedback. The results screen also tells the loser they won acoustically, and rejected moves disappear without explanation. Those are concrete player-facing defects, not style complaints. The remaining risk is test coverage around the host/UI boundary, where the current green suite cannot protect the behavior that actually makes a remote game usable.

### Blocking issues

#### 1. Checkers bot pacing cuts off or overlaps its own sounds

- **severity:** blocking
- **evidence:** `src/App.tsx:180` defines `BASE_MS = 900`; `runCheckersBot` waits exactly that amount before each bot action (`src/App.tsx:2916-2929`). The bot broadcasts every jump in a multi-jump chain separately. The registered assets are `checker-moving.mp3`, `checker-jumping-over.mp3`, and `king-me.mp3` (`src/hooks/useSound.ts:26-28, 78-80`). Measured with `ffprobe` from the repository: move = `1.032000s`, jump = `0.624000s`, crown = `2.040000s`.
- **why it breaks:** after a normal bot move, the next bot action can begin 132ms before `checker-move` finishes. A move that crowns plays `checker-move` and `king-me` together, then the next action starts 900ms later while the 2.04s crown cue is still playing. In a chained capture, the jump sound fits, but the next link is still only 900ms away and the policy is not coupled to the actual event duration. This directly violates `CLAUDE.md`: sounds must not be cut short or overlapped, and visible state-changing events must finish before bot logic advances. A human watching a bot chain sees rapid state changes with audio from multiple moves stacked on top of one another.
- **what would change my mind:** use Checkers-specific pacing based on the actual move/crown event duration (or a pure duration estimator, as `DealIntro` does), and add a timing/sequence test or equivalent instrumentation proving the next action is not scheduled before the prior move's animation/sound budget. A manual full-table session with a crown and a multi-jump should show each event landing distinctly.

### Major concerns

#### 1. Invalid or stale moves fail silently

- **severity:** major
- **evidence:** `validateCheckersAction` returns useful reasons such as `not your turn`, `must continue the chain`, and `not a legal move` (`src/board-games/checkers/rules.ts:47-73`). But both host paths discard rejected outcomes: the PeerJS host returns immediately in `onAction` (`src/App.tsx:2867-2875`), and the local host dispatch does the same (`src/App.tsx:2987-2997`). A guest merely sends the intent. `CheckersTable` displays `notice`, but App supplies only the generic `error` state (`src/App.tsx:5330-5340`), never the validator reason.
- **impact:** a stale guest view, a race after an opponent move, or a malformed client action produces no visible response. The player clicks a highlighted destination and sees nothing if the state changed before the action arrived; that is indistinguishable from a dead button or a broken connection. The engine's reason strings exist, so throwing them away is an avoidable usability regression.
- **suggested fix:** surface a short local notice for rejected host actions and add a host-to-guest rejection/error message for remote intents. Clear the notice on the next accepted action. Do not broadcast rejected state, but do not make rejection indistinguishable from success.

#### 2. Results play the winner cue for both winner and loser

- **severity:** major
- **evidence:** `CheckersResults` runs `useEffect(() => { play('game-win') }, [])` unconditionally (`src/screens/CheckersResults.tsx:40-42`). The component separately computes `isLocalWinner` and renders either `You take it!` or `${winnerName} takes it!` (`:46-50`).
- **impact:** both clients hear a victory cue when the match results mount. The losing client therefore receives audio that contradicts its visible result. This is the same semantic error the shared results pattern already exhibits in sibling screens; Checkers copied it instead of fixing the game-specific winner/loser distinction. Sound is part of the game's feedback language, not decoration.
- **suggested fix:** gate `game-win` on `publicState.matchWinnerId === localPlayerId`; provide a loser cue if the registry has one, or remain silent. Add a component-level regression test for both local-winner and local-loser mounts.

#### 3. Core end-to-end host/UI behavior has no tests

- **severity:** major
- **evidence:** `checkers.test.ts` has 35 focused engine/bot tests, but no test covers `checkersDispatch`, the PeerJS `onAction` path, `runCheckersBot`, the automatic `NEXT_GAME` timeout, `CheckersTable` rendering, or `CheckersResults` audio. The tests construct sessions directly with `buildGame`, bypassing App wiring and the notice/error path.
- **impact:** the suite can stay green while the actual game silently drops rejected actions, races sound timing, or plays the wrong result cue. The current test count is healthy for pure rules but is not evidence that a human can complete a two-browser match. It also does not protect the repository's explicit bot-speed and animation-sequencing requirements.
- **suggested fix:** keep the pure rule tests, then add focused UI/wiring tests or a deterministic harness for: rejected host and guest actions, a bot move followed by a second bot action, crown timing, game-end auto-advance, and winner/loser results behavior. One manual two-browser run remains necessary for PeerJS and real audio behavior.

### Minor concerns and nits

- The rules deliberately implement an **optional-capture variant**, and the overlay says so. That is consistent with `specs/20-checkers-module.md` and is not a defect. It should not be silently changed to mandatory capture without changing the stated rules and tests.
- The first-turn status copy says “captures are optional, but a jump must keep jumping while it can.” This is accurate for the implemented variant, but it is shown only for game 1's first turn; a player reopening Rules has to rely on the overlay for the same explanation.
- `CheckersTable` accepts `onOpenRules` and immediately discards it with `void onOpenRules` (`src/screens/CheckersTable.tsx:49`), while also owning the rules modal locally. That is harmless today but is dead prop plumbing and makes the component contract misleading.
- The rules overlay closes on backdrop click but does not visibly establish focus management or Escape handling. This is an accessibility limitation, not a confirmed game-state bug.
- `CheckersRoom` marks “Add house bot” disabled at two seats and “Start game” disabled below two seats, which is good; however, failed clipboard writes are swallowed while the UI still says “Copied!”. This is inherited room-pattern behavior and not Checkers-specific, but it is worth fixing centrally.
- No deal intro is appropriate here: Checkers is a board game with no card deal or shuffle event. The omission is defensible rather than a forced convention violation.
- There is no board-piece movement animation in `CheckersTable.css`; the pieces simply render at their new cells. That avoids an animation race, but it also means the sound is the only temporal cue for a move, making the pacing defect more noticeable.

### What the code gets right

- **Move geometry is correct and safely bounded.** `capturesFrom` and `movesFrom` calculate row/column coordinates and check both row and column bounds, avoiding the classic flat-index wraparound at columns 0 and 7. The edge tests exercise this directly.
- **The engine preserves host authority.** `validateCheckersAction` checks stage, current player, piece ownership, square bounds, and chain ownership before producing canonical state. Guests submit intents; the host applies and broadcasts the result. Checkers state remains plain serializable data.
- **Capture and non-capture legality matches the declared variant.** A simple diagonal move remains legal when a capture is available, and a capture removes exactly the jumped piece. The tests explicitly assert this rather than accidentally relying on UI filtering.
- **Multi-jump handling is coherent.** `chainCell` locks the same piece, holds the turn number, requires another capture, and advances only when the chain ends. A fresh king does not continue a chain after crowning, which is deliberate and documented in the spec and tests.
- **Promotion, kings, and terminal detection are implemented cleanly.** Men promote on the correct far row; kings move/capture in all four diagonal directions; a game ends on no pieces or no legal moves; the match ends at the configured target of three wins.
- **The bot respects capture preference and chain continuation.** It gathers all captures across its pieces, otherwise simple moves, and uses the session RNG. The bot tests cover chained continuation, simple movement, and capture preference.
- **Round and match transitions are sensible.** `NEXT_GAME` flips the starter, resets the board and per-game fields, carries the score, and is rejected after `over`. App's 4-second round pause gives the game-end result time to be seen before the next board appears.
- **The screen follows several sibling conventions well.** It has the shared header/wordmark, connection strip, code chip, sound and turn-sound toggles, active-turn scoreboard fill, Rules/Leave controls, and the established two-seat room/results shape. The sound registry entries are present and correctly mapped to existing assets.
- **Verification is genuinely green.** The requested Checkers slice ran 35 tests, and `npx tsc -b --noEmit` exited 0. That is meaningful evidence for engine correctness and wiring types, but not a substitute for UI/browser coverage.

### Best next moves

1. Replace Checkers' inherited `BASE_MS` bot delay with a measured Checkers event budget. At minimum, wait for the longest sound triggered by the move (`king-me` on a crown); preferably expose a pure estimator and test it. Re-test a crown and a multi-jump with a bot.
2. Make rejected MOVE outcomes visible to the initiating player, including a remote rejection path for guests. Preserve the validator reasons rather than discarding them.
3. Fix `CheckersResults` winner-only audio and add winner/loser regression tests.
4. Add UI/wiring coverage around the host action path, bot loop, automatic round advance, stale intents, and results. Then do one manual two-browser match, including a bot crown, multi-jump, deadlock win, and best-of-five completion.
5. Keep the current rules variant explicit in both tests and copy; do not “repair” optional captures into mandatory captures without a product decision.

### Codebase review addendum

- **systemic risks:** Shared App-level bot pacing is still a dangerous default for new games. `BASE_MS` is appropriate only when measured against the specific game's sounds and visible events; Checkers demonstrates why a single inherited constant is not a guarantee. Shared results screens/components also have a recurring winner-only audio assumption that must be audited rather than copied.
- **hotspots worth manual inspection:** `App.tsx`'s action rejection and PeerJS error plumbing for every engine game; bot loops that emit multiple state-changing actions within one turn; result screens that call `game-win` without checking the local winner; and any game with audio longer than its bot delay.
- **repeated anti-patterns:** validator reasons are computed and then dropped at the App boundary; results sound is treated as mount-only generic feedback; per-game bot timing is inherited without an asset-duration check. These are more important than Checkers' small dead-prop issue.
- **areas healthier than expected:** the Checkers pure engine is less sloppy than the UI boundary. It has explicit invariants, no React imports in the board-game module, no hidden state, robust coordinate bounds, deterministic bot RNG injection, and tests for the tricky crowning/multi-jump behavior. I found no confirmed engine defect in diagonal geometry, promotion, chain locking, terminal detection, or wire serialization.

#### Test case completeness matrix

| Area | Status |
|---|---|
| Opening board shape, dark squares, 12 pieces per seat | ✅ covered |
| Man movement direction for both seats | ✅ covered |
| Column 0/7 edge wrapping | ✅ covered |
| Out-of-range/non-integer/NaN squares | ✅ covered |
| Occupied landing / own-piece jump rejection | ✅ covered |
| Optional capture variant | ✅ covered |
| Mandatory-capture rule | ✅ intentionally not applicable — product/spec says captures are optional |
| Capture removal and landing | ✅ covered |
| Multi-jump lock, continuation, and turn handoff | ✅ covered |
| Promotion by simple move | ✅ covered |
| Promotion by jump ends chain | ✅ covered |
| King movement and captures in all directions | ✅ covered |
| Win by removing last piece | ✅ covered |
| Win by leaving opponent with no legal move | ✅ covered |
| Match target, `over`, and rejected post-match actions | ✅ covered |
| `NEXT_GAME` reset and starter alternation | ✅ covered |
| Non-seated `NEXT_GAME` rejection | ⚠️ validator has the check; no direct test |
| Bot capture preference and chain continuation | ✅ covered |
| Bot no-legal-move behavior | ⚠️ precondition assumed; no direct test |
| Bot pacing against sound/animation durations | ❌ missing — would catch Blocking #1 |
| Host rejection surfaced to local player | ❌ missing — would catch Major #1 |
| Guest rejection/error path | ❌ missing — would catch Major #1 |
| PeerJS snapshot/action integration | ❌ missing |
| Automatic game-end `NEXT_GAME` scheduling | ❌ missing |
| Checkers table selection/destination rendering | ❌ missing |
| Winner-only results sound | ❌ missing — would catch Major #2 |
| Cross-screen completion of a full match | ❌ missing |
| JSON wire safety after moves | ✅ covered |
| Requested Checkers Vitest slice | ✅ 1 file, 35/35 tests passed |
| TypeScript build check | ✅ `npx tsc -b --noEmit` passed |

**Coverage limitation:** I cannot run the app in a browser in this review environment. The sound-duration and silent-rejection findings are grounded in the source, asset measurements, and shared wiring; PeerJS behavior, browser audio scheduling, and the complete visual playability path still require a manual two-browser run.

#### Test command evidence

Targeted Checkers tests:

```text
RUN  v4.1.10 /opt/data/pips-ai-player/pips


 Test Files  1 passed (1)
      Tests  35 passed (35)
   Start at  20:12:01
   Duration  352ms (transform 128ms, setup 0ms, import 154ms, tests 23ms, environment 0ms)
```

TypeScript:

```text
npx tsc -b --noEmit

(exit code 0; no output)
```
