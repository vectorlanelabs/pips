# Connect 4 — AI Grouch (Oscar) Review

**Date:** 2026-08-24  
**Reviewer:** Oscar (ai-grouch), run via Bartowski  
**Scope:** `src/games/connect4.ts`, `src/games/connect4.test.ts`, Connect 4 state transitions in `src/state/room.ts` and `src/state/room.test.ts`, `src/screens/Connect4Table.tsx`, Connect 4 wiring and bot scheduling in `src/App.tsx`, shared results/sound behavior, and the project standards in `CLAUDE.md`.

**Baseline:** `main` @ `d160de5`. Targeted Connect 4 tests and TypeScript verification were run against this checkout; no browser session was run.

---

### Executive verdict

**needs changes** — the Connect 4 rules engine is compact and, on the normal UI path, gets gravity, line detection, turn ownership, full-column rejection, draws, round alternation, and first-to-three scoring right. The release issues are in the edges around that engine: rejected network/stale actions are silent, the bot reuses a 900 ms shared delay despite a 1.032 s drop sound and can start the win cue concurrently with the drop cue, and the direct engine tests do not cover the authoritative room transition path or several meaningful board invariants. The two-player seat cap means the multi-bot consecutive-action hazard does not apply to this particular game, but that does not excuse the sound overlap or the unobservable failure path.

### Blocking issues

none

### Major concerns

#### 1. Invalid or stale column actions fail silently

- **severity:** major
- **evidence:** `src/state/room.ts:417-424` returns the unchanged room for the wrong screen, a finished round, an out-of-range column, a non-current seat, or a full column. `src/App.tsx:700-712` treats that unchanged state as an ordinary dispatch result and broadcasts nothing special; `Connect4Table.tsx:82-88` has no notice/error state. The normal UI disables full columns and non-turn cells, but the host still receives stale guest actions and the state boundary has no player-visible rejection channel.
- **impact:** after a race or stale remote click, the player sees the same board and no explanation. A full-column click is intentionally disabled locally, but if the board changes between render and click, the action is simply discarded. That reads as a dead button or broken connection rather than “that column filled” or “it is no longer your turn,” which is especially damaging in PeerJS multiplayer where state can arrive asynchronously.
- **suggested fix:** make action application return a structured accepted/rejected result, or add a transient host-broadcast/local notice for rejected Connect 4 actions. Keep the host authoritative; surface the reason without trusting client state.

#### 2. Bot timing overlaps Connect 4 sound cues

- **severity:** major
- **evidence:** `src/App.tsx:180` defines `BASE_MS = 900`, and `runConnect4Bot` (`:4493-4501`) waits exactly `BASE_MS * botPace` before playing. The actual `piece-drop.mp3` is **1.032 seconds** (`ffprobe`), so the default bot gap is shorter than the sound. In `src/screens/Connect4Table.tsx:36-45`, the same board update can satisfy both `discCount > p.discCount` and `!p.roundOver && c.roundOver`, causing `play('piece-drop')` and `play('round-win')` to start together on a winning move.
- **impact:** a winning bot move (and a winning human move) can cut/overlap the drop and round-win feedback instead of letting the physical action land before the result cue. For a bot, the next bot action is not possible in Connect 4's two-player game until the human moves, so this is not the full-table consecutive-bot failure described in `CLAUDE.md`; it is still a concrete violation of the repository's explicit “sounds must not be cut short” rule and makes the most important move's audio ambiguous. The 900 ms delay is also not sound-safe at default pace.
- **suggested fix:** use a Connect 4-specific delay based on the measured drop duration plus margin, and sequence the round-win cue after the drop sound (or suppress the ordinary drop cue on a terminal move and let the result cue represent it). Add a timing/component regression test or a small pure event-selection helper so terminal moves cannot emit overlapping cues.

#### 3. Authoritative room transitions are only partially tested

- **severity:** major
- **evidence:** `src/state/room.ts:417-455` is the host-authoritative implementation that validates `by`, column bounds, turn order, full columns, wins, draws, round scores, and results transition. The direct `src/games/connect4.test.ts` file has only six tests for helpers and the bot; the room path is covered separately by five Connect 4 tests in `src/state/room.test.ts`, but those tests do not exercise every terminal geometry or malformed authoritative state/action boundary. In particular, there is no room-level test for a horizontal, diagonal, and vertical win each being awarded through `applyAction`, no post-win action rejection, and no result/round-advance rejection outside `roundOver`.
- **impact:** the tests can stay green while a wiring regression in `connect4Play` stops calling `checkWin`, advances the wrong turn, awards a draw as a win, or allows `connect4AdvanceRound` to reset a live board. The game is not just the pure helper; this room function is the canonical state crossing PeerJS.
- **suggested fix:** add room-level tests for all four line orientations (including a diagonal that depends on gravity), a full-column action, wrong actor, out-of-range values, action after round end, draw then alternating starter, and first-to-three results. Assert immutability/no-op behavior and exact winner/score/turn state.

### Minor concerns and nits

- `decideConnect4Move` is deliberately shallow: it takes an immediate win, blocks an immediate win, then chooses a center-biased move that avoids a one-move reply. That is a defensible casual-game bot, but it is not a strategic Connect 4 player and can make obvious long-horizon blunders. This is a playability limitation, not a correctness defect.
- The engine functions assume a 42-cell board and valid integer coordinates. That matches the host-created state and the typed callers, so I am not calling it a bug; if these helpers are intended as public defensive APIs, add explicit board-shape/coordinate contracts rather than silently indexing malformed arrays.
- `checkWin` returns the entire contiguous line, not just four cells. The UI highlights all five-or-more connected discs, which is reasonable and is covered by the existing test. Do not “fix” that into exactly four without a product decision.
- Connect 4 correctly has no `DealIntro`: it is a board game with no cards or shuffled opening state. The omission is a justified deviation from the card-game convention, not a missing animation.
- The table does match the closest sibling board game, `TttTable.tsx`, for active-seat highlighting, “Your move” treatment, `useTurnStartSound`, round pause, and the board/seat layout. The copy is consistent with the established “first to three” tone.
- The round pause is a real four-second host-side gate (`src/App.tsx:4555-4564`), so the winning line is not immediately erased. I found no confirmed animation race in the board itself; the confirmed sequencing issue is audio.

### What the code gets right

- **Gravity and full-column handling are correct on the canonical path.** `lowestOpenRow` scans bottom-to-top and returns `-1` for a full column; `connect4Play` checks bounds, turn identity, round state, and the full-column result before mutating a copied board.
- **Win detection covers the required geometries.** `checkWin` scans horizontal, vertical, and both diagonal directions from the newly placed disc, extending in both signs, and returns a contiguous line. The direct tests cover horizontal, vertical, both diagonal slopes, longer lines, short lines, and an opponent's line.
- **Draw detection is ordered correctly.** `connect4Play` computes `draw = !winLine && isBoardFull(board)`, so a winning final disc is a win rather than an incorrectly reported draw.
- **Turn/player authority is enforced host-side.** `connect4Play` derives the seat index from `by` and requires it to equal `state.turnIdx`; the client only dispatches an intent. Column range and full-column checks also happen in the host reducer, satisfying the project's authoritative-state rule.
- **Round and match progression is coherent.** A win increments only the winning seat, updates seat scores, marks `roundOver`, and sets `pendingWinnerId` once a player reaches three wins. A non-final draw alternates the starter; a final round advances to the shared results screen after the pause.
- **The board UI has useful feedback.** It previews the landing cell on hover, disables unavailable cells, highlights the winning line, marks the active seat, uses the registered `piece-drop`/`round-win`/turn-start sounds, and keeps the winning line visible during the pause.
- **The bot has stale-state protection at the right boundary.** `runConnect4Bot` waits before reading current state and checks `stale(key)` before acting, preventing a delayed bot from applying a move to a different turn or game.
- **The implementation is simple rather than over-abstracted.** The engine is plain data/functions, serializable room state is preserved, and there is no unnecessary React coupling in `src/games/connect4.ts`.
- **The requested checks are green.** The targeted file ran 6/6 tests, and `npx tsc -b --noEmit` exited 0. That validates compilation and the helper slice, but it is not evidence that browser playability or every room transition is covered.

### Best next moves

1. Add a Connect 4-specific action-result/notice path so host-side rejections are visible, especially for stale turns and newly filled columns.
2. Separate terminal sound sequencing from ordinary disc-drop feedback and replace the shared 900 ms bot wait with a measured Connect 4 action delay.
3. Expand `src/state/room.test.ts` with all win orientations, terminal/draw/advance guards, and malformed/wrong-actor actions; retain the existing pure engine tests.
4. Run one manual two-browser session covering bot-vs-human pacing, a full-column race, all terminal outcomes, a draw, round alternation, and the third-win results transition. The app was not run in a browser for this review.

### Codebase review addendum

- **systemic risks:** The older `RoomState` action architecture communicates rejection by returning the old state, with no structured reason. That is a recurring source of silent multiplayer failures; Connect 4 exposes it in a small, easy-to-reproduce form. Shared bot timing is another systemic hotspot: `BASE_MS` is explicitly documented as unsafe for some games, yet Connect 4 inherits it without a game-specific sound-duration check.
- **hotspots worth manual inspection:** `hostApply` and all legacy `applyAction` branches for silent no-ops; `runBotsIfNeeded`/`BASE_MS` for per-game pacing; `Results.tsx` for winner-only sound semantics; and the PeerJS guest action path under delayed state delivery.
- **repeated anti-patterns:** Primitive action payloads with rejection represented only as unchanged state; shared timing constants reused across games with different animations/sounds; direct effect-based sound decisions that can emit multiple cues for one state transition.
- **areas healthier than expected:** Connect 4's core rules are substantially cleaner than a typical generated board-game implementation. Host authorization, immutable board updates, win-before-draw ordering, explicit round/match state, sibling-style active-turn rendering, and stale bot checks all line up with the repository's conventions.

#### Test case completeness matrix

| Area | Status |
|---|---|
| `lowestOpenRow` empty, stacked, and full column | ✅ covered in `connect4.test.ts` |
| Horizontal win detection | ✅ covered in helper test; ❌ not covered through `applyAction` |
| Vertical win detection | ✅ covered in helper test; ❌ not covered through `applyAction` |
| Both diagonal slopes | ✅ covered in helper test; ❌ not covered through `applyAction` |
| Longer-than-four contiguous line | ✅ covered |
| Short line / opponent line rejection | ✅ covered |
| Immediate bot win | ✅ covered |
| Immediate bot block | ✅ covered |
| Center preference / unsafe-reply fallback | ✅ covered |
| Host wrong-player rejection | ✅ covered in `room.test.ts` |
| Out-of-range column rejection | ✅ covered in `room.test.ts` |
| Full-column rejection through room reducer | ✅ covered in `room.test.ts` |
| Post-round move rejection | ✅ covered in `room.test.ts` |
| Draw detection and non-final round reset | ✅ covered in `room.test.ts` |
| Starter alternation after draw | ✅ covered in `room.test.ts` |
| Third win → `pendingWinnerId` → results | ✅ covered in `room.test.ts` |
| `connect4AdvanceRound` rejection while live | ❌ missing |
| Malformed board shape / malformed action at authoritative boundary | ❌ missing; typed normal callers do not cover it |
| Rejected-action player notice | ❌ missing — would catch Major #1 |
| Terminal drop/win sound sequencing | ❌ missing — would catch Major #2 |
| Bot pacing against actual sound duration | ❌ missing — would catch Major #2 |
| Browser multiplayer / delayed guest action behavior | ❌ not exercised |
| Targeted Connect 4 engine suite | ✅ 1 file, 6/6 passed |
| TypeScript build check | ✅ `npx tsc -b --noEmit` passed |

**Coverage limitation:** I cannot run the app in a browser in this review environment. Playability findings are grounded in the rendered code, sibling conventions, the host bot scheduler, and measured local sound durations; one manual two-browser session is still required before release.

#### Test command evidence

Targeted Connect 4 tests:

```text
RUN  v4.1.10 /opt/data/pips-ai-player/pips


 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  20:06:22
   Duration  196ms (transform 36ms, setup 0ms, import 50ms, tests 6ms, environment 0ms)
EXIT 0
```

TypeScript:

```text

EXIT 0
```

The command run was:

```text
npx tsc -b --noEmit
```
