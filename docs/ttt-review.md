# Tic Tac Toe — AI Grouch (Oscar) Review

**Reviewer:** Oscar (ai-grouch)  
**Scope:** `src/games/ttt.ts`, `src/screens/TttTable.tsx`, Tic Tac Toe wiring in `src/App.tsx`, host-side transitions in `src/state/room.ts`, the shared `Action`/`TttState` types, and the shared results/sound behavior reached by Tic Tac Toe.  
**Baseline:** `main` @ `d160de5` (as supplied). The full Vitest suite passed **1398/1398** tests across **66** files; `npx tsc -b --noEmit` was clean. `ls src/games/ttt*` found only `src/games/ttt.ts`; there is no Tic Tac Toe test file.

---

### Executive verdict

**needs changes** — the ordinary two-player UI path is compact and mostly correct, but the host-side Tic Tac Toe action boundary is not actually authoritative: malformed cell values can mutate the board outside its nine legal cells, and any connected guest can invoke the round-advance action without being the host. Those are real state-machine defects, not theoretical style objections. Playability is decent on the happy path, with a deliberate four-second round pause and established active-seat treatment, but the game has no direct tests, rejected actions are silent, and its win sounds are also used for draws and losers. The full suite and TypeScript check are green, but they provide no meaningful direct assurance for this game.

### Blocking issues

#### 1. `tttPlay` accepts out-of-range and non-integer cells

- **severity:** blocking
- **evidence:** `src/state/room.ts:376-399` checks `t.board[cell] !== null`, but never checks that `cell` is an integer in `[0, 8]`. It then assigns `board[cell] = seatIdx`. `Action` exposes the unvalidated runtime payload as `{ type: 'tttPlay'; cell: number }` in `src/types.ts:189`. The UI buttons only emit `0..8`, but `src/App.tsx:734-736` accepts guest actions and passes them directly to `hostApply`, which broadcasts whatever `applyAction` returns.
- **why it breaks:** a stale, buggy, or crafted PeerJS client can submit `cell: 9`, `-1`, `1.5`, `NaN`, or a large value. For `9`, the copied array grows to length 10 and gains a mark that `checkWin` never considers; for `-1` or `1.5`, JavaScript creates a non-board property while the turn still advances. The canonical state is no longer a nine-cell Tic Tac Toe board. A sequence of such accepted actions can consume turns without placing legal marks and can leave the game unable to reach the intended draw condition. Host authority is only useful if the host validates the action domain, not merely the actor's turn.
- **what would change my mind:** a host-side guard such as `Number.isInteger(cell) && cell >= 0 && cell < 9` that rejects every malformed value before board mutation, backed by tests for negative, fractional, `NaN`, `9`, and very large values.

#### 2. Any guest can skip the required round-result pause and advance state

- **severity:** blocking
- **evidence:** `src/state/room.ts:401-413` implements `tttAdvanceRound(state)` without a `by` parameter or any actor check. `applyAction` dispatches `tttAdvanceRound` at lines 198-199. In `src/App.tsx:734-736`, every guest action is passed to `hostApply(action, guestId)` with no host-only filter. The host's intended four-second reveal is a timer in `src/App.tsx:4544-4553`; the table itself has no advance button.
- **why it breaks:** once a round is over, a connected guest can send `{type: 'tttAdvanceRound'}` through the existing PeerJS action channel. The host accepts it immediately, clearing the winning line and starting the next round before the four-second human-readable pause, or moving straight to results if the match has reached three wins. This violates the repository's host-authoritative rule and makes a visible state-changing animation/reveal cancellable by an untrusted client. It is also an easy stale-client race: the action is not tied to the timer that owns the transition.
- **what would change my mind:** make round advancement host-only (for example, keep it out of guest-dispatchable actions or enforce the host identity in the host action path), and add a regression test proving a guest action cannot advance a finished round before the host-controlled pause.

### Major concerns

#### 1. The game engine has zero direct test coverage

- **severity:** major
- **evidence:** `ls src/games/ttt*` returned only `src/games/ttt.ts`; no `*.test.ts` or `*.spec.ts` exists for Tic Tac Toe. The engine contains all critical rules in `checkWin`, `isDraw`, and `decideTttMove`, while host transitions live in `tttPlay`/`tttAdvanceRound` in `src/state/room.ts`.
- **impact:** the green full suite can stay green while win-line indexing, draw detection, occupied-cell rejection, turn authorization, best-of-five progression, malformed action handling, or bot move selection regresses. The two blocking findings above are exactly the kind of bugs a small state-transition test would catch.
- **suggested fix:** add beside-code Vitest coverage for the pure engine and host transitions. Include all eight win lines, no false positives, full-board draws, occupied/out-of-turn/finished rejection, invalid cell bounds, alternating starters, first-to-three results transition, and bot win/block/center/corner behavior. Add at least one serialized action/state case because this state crosses PeerJS.

#### 2. Invalid actions are silent no-ops

- **severity:** major
- **evidence:** `tttPlay` returns the unchanged room for the wrong screen, finished round, occupied cell, or wrong actor (`src/state/room.ts:376-381`). `dispatch` and guest action handling in `src/App.tsx:710-713`/`734-736` do not expose an outcome or notice. `TttTable` has no error/notice prop or rejection feedback.
- **impact:** a stale client, a guest clicking just as the opponent claims a square, or a malformed action looks exactly like a dead button or network stall. The prompt says “Pick a square.”, but a rejected attempt gives the player no explanation and no recovery signal. The normal disabled UI reduces frequency; it does not remove the reachable network race.
- **suggested fix:** return a structured action outcome or add a transient local rejection notice. At minimum, distinguish “not your turn,” “square already occupied,” “round over,” and malformed input, while continuing to keep the canonical state host-owned.

#### 3. Victory cues are played for draws and for losing clients

- **severity:** major
- **evidence:** `TttTable.tsx:44-46` plays `round-win` whenever `roundOver` transitions, including the draw branch (`src/state/room.ts:384-395` where `winLine` is empty). Shared `src/screens/Results.tsx:62-66` unconditionally plays `game-win` on mount, even when `winner.id !== localSeatId`.
- **impact:** a drawn round announces a win, and the losing Tic Tac Toe player hears a victory cue on the match results screen. The visual copy correctly distinguishes “You take it!” from the opponent, so the audio contradicts the UI's state. Sound is part of the game's feedback language; a semantically false cue is a playability bug, not decorative polish.
- **suggested fix:** play a draw-specific or neutral round cue when there is no `winLine`; gate `game-win` on the local player being the winner and use a loser/neutral cue otherwise. Add winner, loser, and draw sound regression tests.

#### 4. Bot pacing reuses the generic 900 ms action gap without a Tic Tac Toe-specific check

- **severity:** major
- **evidence:** `src/App.tsx:180` defines `BASE_MS = 900`; `runTttBot` at lines 4482-4490 waits exactly `BASE_MS * pace` once, computes a move, and submits it. Tic Tac Toe has a visible mark sound (`drawn-x`/`drawn-circle`) and a visible four-second result pause, but no game-specific move-duration estimator or hold tied to the mark animation. The repository's `CLAUDE.md` explicitly says not to inherit a shared pacing constant without checking it, and says a sound cut short or overlapped by the next action is a bug.
- **impact:** with two players there is only one bot action between human turns, so this is not the multi-bot “full table” failure seen in party games; the architecture is therefore less risky than it would be for an N-player game. However, the code provides no evidence that 900 ms is longer than the actual mark sound/paint interval, and it starts the next bot move based on a generic timer rather than a known animation duration. A short asset or slow client can make the mark feel rushed or its audio overlap with the next event.
- **suggested fix:** measure the registered `drawn-x`/`drawn-circle` assets and either set a TTT-specific human-paced delay or expose/use a pure duration estimate. Re-check the full nine-move bot-vs-bot path, not only one isolated bot action; document why the resulting interval is readable and does not clip the sound.

### Minor concerns and nits

- `checkWin` and `isDraw` accept arbitrary array lengths and indices. That is fine for internal pure calls with the fixed nine-cell invariant, but it makes the missing action-boundary validation more dangerous: once a malformed board is admitted, these helpers do not repair or reject it.
- `TttTable` uses `t.over` to disable cells while the round state also has `t.roundOver`; these currently move together in the engine, but the duplicated flags create an invariant worth asserting in tests.
- `status` is populated in `TttState` initialization and transitions but is not rendered by `TttTable`; it is effectively dead state for this game and can drift from the visible copy.
- There is no `DealIntro`, which is defensible rather than a defect: Tic Tac Toe is a board game, and the closest sibling `Connect4Table.tsx` also does not force a card-deal animation into its opening.
- The table does match the sibling board-game active-seat card treatment (`TttTable.tsx:116-132` mirrors `Connect4Table.tsx:118-134`), so the missing convention is not turn highlighting; it is feedback for rejected actions and correct sound semantics.
- Framework/runtime behavior I did not verify: actual browser paint timing and the encoded duration of the imported MP3 sound assets. The pacing concern is therefore a code-level risk and a required manual check, not a claim of a measured audio clip failure.

### What the code gets right

- **The normal win and draw logic is simple and correct by inspection.** `checkWin` enumerates the eight legal lines; `tttPlay` checks the just-placed player's line before declaring a draw; a winning move takes precedence over a full-board draw.
- **Normal occupied-square and turn validation is present.** `t.board[cell] !== null` rejects ordinary repeated clicks, and `seatIdx !== state.turnIdx` prevents a player from taking the other seat's turn. The missing bounds check is the boundary defect, not evidence that the happy-path checks are useless.
- **Host-side canonical mutation is the right shape.** Guests submit intents, `applyAction` mutates the host's plain `RoomState`, and `hostApply` broadcasts the result. The problem is that one action lacks proper host-only authorization and another lacks payload validation; the overall architecture is sound.
- **Best-of-five progression is coherent.** Wins increment only on a line, draws do not increment either score, starters alternate after non-match rounds, and a player reaching three wins moves to results after the round-result pause.
- **The bot strategy has the expected useful priorities.** `decideTttMove` takes an immediate win, then blocks the opponent, then takes center, then a corner, then any remaining square. It never intentionally chooses an occupied square because it builds its candidate list from null cells.
- **The UI makes the main state legible.** It disables occupied and non-turn cells, highlights the winning line, shows “Your move” versus the other player's move, and gives a clear “Pick a square.”/“is thinking…” prompt. The fixed per-cell rotations add visual character without affecting rule state.
- **The round pause is a good instinct.** The host waits `ROUND_PAUSE_MS = 4000` before calling `tttAdvanceRound`, explicitly preserving the winning line instead of racing immediately into the next board. The authorization hole is serious, but the intended sequencing is correct.
- **The existing baseline is healthy but not game evidence.** `npm test` passed all 1398 existing tests and TypeScript passed cleanly. That verifies repository-wide wiring and compilation, not Tic Tac Toe rules, because no TTT test file is present.

### Best next moves

1. **Harden the host action boundary first:** reject every `tttPlay` cell except integers `0..8`, and make `tttAdvanceRound` host/timer-only. Add tests that exercise guest-originated malformed and premature actions.
2. **Add `src/games/ttt.test.ts` (and room transition tests if the repository convention permits) before changing strategy.** Cover every win line, draw, occupied/out-of-turn/finished moves, alternating starters, first-to-three, and all malformed cell values.
3. **Make rejection observable** through the existing app feedback path instead of treating unchanged state as a successful click.
4. **Correct the sound contract:** neutral/draw round cue, winner-only `game-win`, and a manual check of mark-sound duration versus bot delay.
5. **Run one manual two-browser session:** human vs bot, bot opening and responding, every result type (win, loss, draw), the final third win, stale/duplicate click behavior, and the full bot-vs-bot nine-move sequence.

### Codebase review addendum

- **systemic risks:** The legacy `RoomState` action channel accepts primitive payloads from PeerJS and communicates rejection by returning unchanged state. Tic Tac Toe exposes both halves of that risk: an unbounded numeric payload can enter canonical state, and an action with no player argument can perform a privileged transition. Audit the same pattern in Connect 4 and the other legacy games.
- **hotspots worth manual inspection:** `src/App.tsx` `onAction`/`hostApply`, the shared `Results.tsx` sound effect, the timer-owned `tttAdvanceRound` transition, and all legacy action handlers that index arrays directly from network-provided numbers.
- **repeated anti-patterns:** generic result audio is applied without checking winner identity; no-op rejection is the only error channel; shared bot pacing is reused by default; and state fields such as `over`, `roundOver`, and `status` have overlapping or unused responsibilities.
- **areas healthier than expected:** TTT's core rules are not over-abstracted; the eight-line win check is readable; normal turn/occupied validation, alternating starters, host broadcasting, active-seat styling, winning-line rendering, and the explicit result pause all follow sensible conventions. The engine is much easier to reason about than the surrounding monolithic `App.tsx` wiring.

#### Test case completeness matrix

| Area | Status |
|---|---|
| All three horizontal win lines | ❌ missing direct TTT test |
| All three vertical win lines | ❌ missing direct TTT test |
| Both diagonal win lines | ❌ missing direct TTT test |
| No false win / partial line | ❌ missing direct TTT test |
| Full-board draw with no winner | ❌ missing direct TTT test |
| Win takes precedence over full-board draw | ❌ missing direct TTT test |
| Occupied-square rejection | ❌ missing direct TTT test |
| Out-of-turn / unknown-seat rejection | ❌ missing direct TTT test |
| Finished-round rejection | ❌ missing direct TTT test |
| Invalid cell: negative, 9+, fractional, `NaN` | ❌ missing — would catch Blocking #1 |
| Turn alternation after legal move | ❌ missing direct TTT test |
| Immediate bot win selection | ❌ missing engine test |
| Bot blocks immediate opponent win | ❌ missing engine test |
| Bot center/corner/fallback selection | ❌ missing engine test |
| First-to-three score increment | ❌ missing room transition test |
| Draw does not increment score | ❌ missing room transition test |
| Alternating starter after a draw | ❌ missing room transition test |
| Results transition after third win | ❌ missing room transition test |
| Host-only/timer-only round advancement | ❌ missing — would catch Blocking #2 |
| Serialized PeerJS action/state round-trip | ❌ missing |
| Rejected action visible to initiating player | ❌ missing |
| Active-seat and winning-line rendering | ❌ missing component test |
| Winner/loser/draw sound semantics | ❌ missing — would catch Major #3 |
| Bot pacing against mark sound and full game | ❌ missing timing/manual coverage |
| Full existing Vitest suite | ✅ 66 files, 1398/1398 tests passed |
| TypeScript build check | ✅ `npx tsc -b --noEmit` passed |

**Coverage limitation:** I cannot run the app in a browser here. The playability findings are grounded in the rendered code, shared sibling conventions, and host scheduling paths; browser paint timing, PeerJS interaction timing, and actual MP3 duration still require a manual two-browser session.

#### Test command evidence

`ls src/games/ttt*`:

```text
src/games/ttt.ts
```

This confirms the requested absence of a Tic Tac Toe test file; the command exited with code 0 because the engine file exists.

Full suite — `npm test`:

```text
> pips@0.0.0 test
> vitest run


 RUN  v4.1.10 /opt/data/pips-ai-player/pips


 Test Files  66 passed (66)
      Tests  1398 passed (1398)
   Start at  20:06:39
   Duration  69.22s (transform 5.86s, setup 0ms, import 12.54s, tests 16.19s, environment 33ms)
```

TypeScript — `npx tsc -b --noEmit`:

```text
[no output; exit code 0]
```
