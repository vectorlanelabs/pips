# Battleship — AI Grouch (Oscar) Review

**Date:** 2026-08-24  
**Reviewer:** Oscar (ai-grouch), run via Bartowski  
**Scope:** `src/board-games/battleship/` (state, rules, bot, both test files), `src/screens/Battleship{Room,Table,Results,RulesOverlay}.tsx`, `BattleshipTable.css`, Battleship wiring and bot scheduling in `src/App.tsx`, plus the shared sound/turn conventions and the Battleship specs/docs.

**Baseline:** `main` @ `d160de5`. The targeted Battleship suite and TypeScript check were run from the repository root; exact output is included below.

---

### Resolution (2026-08-24)

All Blocking and Minor findings, and every Major finding except adjacency, are fixed on `fix/review-tier1-rummy-wahoo-ttt` (commit `8198a9d`) and independently verified (`tsc -b --noEmit` clean, `npm run build` clean, full suite green). One item is **open, pending a game-rule decision, not a bug**:

- **Major #4 (ship-adjacency / "no-touch" rule):** whether ships may be placed touching is genuinely unspecified — see [deferred.md](deferred.md) for the two options. Left unimplemented either way pending that decision.

Do not remove this file until that item is resolved.

---

### Executive verdict

**needs changes** — the core engine is compact, host-owned, and substantially correct on normal standard/streak play, and the 42 tests are real tests rather than an empty smoke screen. But free-for-all bot pacing has a confirmed sound/animation race: the loop's buffer is conditionally skipped in exactly the variant where repeated shots are expected, so the next bot shot starts every 900ms despite 1.968s/3.672s/5.664s shot sounds. Results also play `game-win` for the loser, and rejected actions disappear silently. The adversarial `oscar.test.ts` is useful, but it deliberately codifies one host-authority vulnerability as a passing test instead of making the suite fail until the invariant is fixed.

### Blocking issues

#### 1. Free-for-all bot shots outrun their own sound effects

- **severity:** blocking
- **evidence:** `src/App.tsx:2279-2302` waits `BASE_MS` before each bot action, then adds the result-specific `SHOT_SOUND_BUFFER_MS` only when `currentPlayer(newPs.turn) === botId` (`:2298-2300`). In `free`, `rules.ts:92-94` always calls `extraTurn`, which leaves `currentIndex` unchanged. If the human is the first player, `currentPlayer()` remains the human for the entire free-for-all; the buffer condition is therefore false after every bot shot. The next iteration waits only `BASE_MS = 900`ms. `ffprobe` reports the registered assets at 1.968s (`ship-miss`), 3.672s (`ship-hit`), and 5.664s (`ship-sunk`).
- **why it breaks:** in free mode a house bot fires repeatedly while the human also fires. A hit sound is still playing when the next shot's sound is created roughly 900ms later; a sunk sound can be overlapped by several later shots. The UI's effect in `BattleshipTable.tsx:187-198` creates a fresh `Audio` for every state change, so this is not merely a timer comment mismatch: the listener hears stacked/cut-off feedback and cannot follow the table. `CLAUDE.md` makes human-speed bot pacing and uncut sound a top-priority correctness requirement.
- **what would change my mind:** make free-mode chaining use the same result-specific hold (or another verified duration estimator) independent of the vestigial turn pointer, then demonstrate a free bot trace with at least a hit and a sink where the next action is held until the corresponding sound/visible event has completed.

### Major concerns

#### 1. The loser hears a victory cue on the results screen

- **severity:** major
- **evidence:** `src/screens/BattleshipResults.tsx:40-42` runs `play('game-win')` unconditionally on mount. The component computes `isLocalWinner` at `:46`, so the local winner is known but is not used to gate the sound. `App.tsx:5100-5112` renders the same results component for both peers.
- **impact:** both players hear a sound that semantically says “you won”; the losing player hears it while the visual headline says `<opponent> sank your whole fleet!`. This contradicts the result UI and the repository's established sound-language expectations.
- **suggested fix:** gate `game-win` on `publicState.winnerId === localPlayerId`; use a loser cue if the sound registry has one, or remain silent. Add a regression test or component-level test for both local winner and local loser.

#### 2. Rejected actions are silent and indistinguishable from a dead button/network stall

- **severity:** major
- **evidence:** `rules.ts:22-25` and `:39-49` return useful rejection reasons, but host wiring discards them at `App.tsx:2245-2250` and `:2358-2366` (`if (!result.outcome.ok) return`). `BattleshipTable` does render a `notice` banner (`:325-327`), yet App passes only `error` as that prop (`:5125-5127`); no action rejection is put into `error` or a Battleship notice state. The guest path sends an intent without a local pending/rejection state.
- **impact:** stale/out-of-turn clicks, duplicate shots, or a race between two clients produce no explanation. The controls normally disable many invalid actions, but the host validator still has reachable failure paths, and remote/stale tabs can hit them. “Nothing happened” is a broken recovery experience for a game whose rules are otherwise explicit.
- **suggested fix:** thread the validator reason into a transient Battleship notice/error channel for the initiating player, or add an action-result protocol that reports rejection without mutating canonical state. Do not pretend a rejected action succeeded.

#### 3. The engine does not enforce participant membership

- **severity:** major
- **evidence:** `validateBattleshipAction` indexes `placedReady[playerId]` and writes `privateStates[playerId]` without first checking that `playerId` is one of `publicState.turn.playerOrder` (`rules.ts:22-35`). `src/board-games/battleship/oscar.test.ts:202-215` explicitly demonstrates that `applyBattleshipAction(game, 'mallory', PLACE_FLEET)` returns `ok: true` and injects a `mallory` readiness/private-state entry. App's PeerJS callback does guard the guest ID at `App.tsx:2245-2247`, so this is not a demonstrated remote exploit through the current callback; it is an unguarded authoritative engine boundary that relies on every caller maintaining that security precondition.
- **impact:** any future host caller, replay path, or test harness that forwards an untrusted player ID can mutate canonical state for a phantom participant. The engine's own host-authority contract is weaker than its tests and API suggest, and `Object.values(placedReady).every(Boolean)` can be influenced by that injected key.
- **suggested fix:** reject unless `playerId` is exactly one of the two IDs in `turn.playerOrder`; add the negative test as a failing regression expectation rather than documenting acceptance as current behavior. Keep the App-side guest guard as defense in depth.

#### 4. Placement rules do not define or test adjacency behavior

- **severity:** major if “ships may not touch” is intended; otherwise a specification gap
- **evidence:** `validFleet` checks board length, ship IDs, exact counts, and straight contiguous geometry (`state.ts:149-171`), but never checks neighboring cells belonging to another ship. The placement UI uses `fits`, which only checks occupancy (`state.ts:99-101`), so touching fleets are accepted and easy to create. Neither the overlay (`BattleshipRulesOverlay.tsx:1-34`) nor the module spec states a no-touch rule.
- **impact:** a fleet with one ship directly adjacent to another is accepted. If the intended Battleship house rule is the common “ships cannot touch” rule, both host validation and the client preview violate the invariant. If touching is intentionally legal, this is not a code defect—but the review scope's adjacency requirement is currently unspecified and untested.
- **suggested fix:** decide and document the rule. For no-touch play, reject orthogonal/diagonal contact in `validFleet`, make `fits`/preview use the same predicate, and add adjacent and diagonal-contact tests. For touch-legal play, state that explicitly in the rules overlay and add an acceptance test so the behavior is deliberate.

### Minor concerns and nits

- **`oscar.test.ts` is not a superficial pass, but one of its strongest probes is inverted.** Its leak and cell-type tests exercise meaningful paths. However, the unauthorized-player case asserts `ok === true` and labels the behavior as a dependency on App callers. That is valuable evidence of a vulnerability, not a regression guard; it will stay green while the defect remains.
- **Test fixture duplication is growing.** `battleship.test.ts` and `oscar.test.ts` each duplicate `emptyBoard`, `emptyMarks`, `place`, `fleetA`, `fleetB`, and battle construction. This is not a correctness bug, but fixture drift can make adversarial tests exercise a subtly different setup from the main suite.
- **The table keeps dead props:** `localName` and `onOpenRules` are explicitly voided in `BattleshipTable.tsx:138-139`; App passes `onOpenRules={() => {}}` (`App.tsx:5131`) even though the table owns its overlay. Remove the misleading prop when the shared contract no longer needs it.
- **`randomFleet` uses rejection sampling with no attempt bound** (`state.ts:126-146`). The current UI supplies a valid partial board and the bot starts from empty, so I found no normal-path hang. A malformed or nearly saturated base can loop indefinitely; either validate the helper's precondition or cover the accepted input domain explicitly.
- **`BattleshipTable` plays opponent and bot shots to both clients** (`:187-198`), which is defensible for Battleship feedback, but makes the free-mode pacing defect especially visible. The real sound files are currently placeholders, as `docs/battleship.md:79-82` notes; placeholder status does not excuse overlapping playback.
- **No DealIntro is defensible.** Battleship is a board placement/battle game, not a card-deal game, and the closest board-game siblings do not require a card-oriented intro. The omission is not a defect merely because `CLAUDE.md` names DealIntro as a card/table convention.
- **Turn highlighting is present as a central chip but not as a sibling-style player rail.** Unlike `TttTable.tsx:116-125` and `Connect4Table.tsx:118-126`, Battleship has no seat rail to highlight. I therefore do not call this a confirmed violation; the status chip and disabled enemy grid make the active actor legible.

### What the code gets right

- **The standard rules path is coherent.** Bounds and integer validation are explicit (`rules.ts:44-49`), repeat shots are rejected, hit/miss/sunk state is separated correctly, plain hits do not reveal `shipId`, and a sink appends the true cells only at the terminal ship event (`:56-73`).
- **Win detection is correctly tied to the target's full board.** `allSunk` requires every declared ship to be present and fully hit (`state.ts:122-124`); the terminal shot sets `stage: 'over'` and `winnerId` without advancing the turn (`rules.ts:73-86`). The tests cover score 5, final reveal, and no post-game shots in free mode.
- **Fleet validation catches the important shape failures.** It rejects short/missing ships, wrong IDs, row wraps, gaps, diagonals, extra cells, and malformed array lengths. `shipCellsAt` correctly distinguishes horizontal row overflow from vertical bottom overflow.
- **Hidden information is handled correctly on the normal path.** The public state carries only hit/miss grids and sunk reveals; the private state carries each player's own board. The no-leak tests check both viewers before and after a sink and exercise JSON serializability.
- **Host authority is correctly implemented in App's network callback.** `onAction` checks that the PeerJS sender is the currently admitted opponent before applying the action (`App.tsx:2245-2249`), and only successful outcomes replace the session and broadcast a new snapshot. The engine-side membership gap is the remaining boundary weakness, not evidence that the current guest callback applies arbitrary senders.
- **Streak semantics are implemented and tested.** A hit or sink uses `extraTurn`, a miss uses `advanceTurn`, and the tests drive both immediate repeat shots and out-of-turn rejection.
- **The bot strategy does not peek.** It uses only public hits and sunk reveals, targets unresolved orthogonal neighbors, deduplicates candidates, respects board edges, and falls back to unfired cells. The full standard, streak, and free bot matches terminate within the tested shot bound.
- **The main test suite is not vacuous.** Both requested files ran: 42 tests passed. `oscar.test.ts` is adversarial and finds real boundary behavior; its weakness is that the unauthorized-player finding is asserted as an expected current behavior rather than enforced as a rejection.

### Best next moves

1. Fix the free-mode bot scheduler so its post-shot hold is keyed to `lastShot.result`, not `currentPlayer()`, and verify a hit/sink trace against the measured sound durations.
2. Fix winner-only results audio and surface rejected action reasons to the player who submitted the action.
3. Enforce participant membership inside `validateBattleshipAction`; change the Oscar authorization test to require rejection.
4. Decide the adjacency rule explicitly, then align host validation, client preview, rules copy, and tests.
5. Strengthen coverage around UI/action boundaries: results winner/loser audio, rejected-action notices, free-mode pacing, and placement adjacency. A manual two-browser session should cover standard, streak, free, rematch, disconnect, and stale-click paths.

### Codebase review addendum

- **systemic risks:** The game has the right host/private-state architecture, but action validation and user-facing error reporting are split across layers with no structured rejection feedback. The `applyAction` contract preserves the old session on rejection, which is safe for state integrity but makes silent no-ops easy to ship. The free-mode bot bug also shows why pacing conditions must be expressed in game semantics rather than inferred from a turn pointer that a variant intentionally makes vestigial.
- **hotspots worth manual inspection:** `App.tsx` bot scheduling and all `SHOT_SOUND_BUFFER_MS` gates; `BattleshipResults.tsx` and sibling results sound behavior; `validateBattleshipAction` participant checks; `deriveSnapshot` callers; and every new variant's action-rejection path.
- **repeated anti-patterns:** Generic `game-win` on results without winner gating appears in sibling result screens too; no-op rejection is a shared App pattern; and the table prop contract contains intentionally dead callbacks. These are broader codebase issues, but Battleship inherits them in a player-visible way.
- **areas healthier than expected:** The engine is plain-data and correctly layered; no client receives an unsunk opponent board; the core hit/sink/win invariants are easy to follow; variants are deliberately centralized in the validator; and the bot's targeting logic is modest rather than pretending to be a full probability solver.

#### Test case completeness matrix

| Area | Status |
|---|---|
| `shipCellsAt` bounds and horizontal/vertical geometry | ✅ covered |
| `fits` overlap behavior for client placement | ✅ covered directly, but only occupancy—not adjacency |
| Exact fleet composition, counts, IDs, board length | ✅ covered |
| Contiguous straight ships / row-wrap rejection | ✅ covered |
| Orthogonal/diagonal adjacency policy | ❌ unspecified and untested — see Major #4 |
| `randomFleet` determinism and valid output | ✅ covered |
| `randomFleet` partial-board/base edge behavior | ⚠️ happy path only |
| Setter-only fleet placement and duplicate placement | ✅ covered |
| Host-side participant membership | ❌ missing — Oscar test currently asserts the vulnerability |
| Placement → battle transition | ✅ covered |
| FIRE stage, turn, integer/range, repeat-cell rejection | ✅ covered |
| Standard miss/hit/sunk resolution | ✅ covered |
| Sunk reveal and score increment | ✅ covered |
| All-five win and no post-game shots | ✅ covered |
| Streak hit/sink extra turn and miss handoff | ✅ covered |
| Free arbitrary interleaving and shot counter | ✅ covered |
| Bot placement, target selection, edge handling, full matches | ✅ covered |
| Free-mode sound/animation pacing against actual asset durations | ❌ missing — would catch Blocking #1 |
| Rejected-action notice / stale-client feedback | ❌ missing — would catch Major #2 |
| Winner-only results audio | ❌ missing — would catch Major #1 |
| Snapshot hidden-board/no-leak behavior | ✅ covered in both test files |
| JSON serialization and revision flow | ✅ covered |
| Full requested Battleship Vitest slice | ✅ 2 files, 42/42 tests passed |
| TypeScript build check | ✅ passed with no output |

**Coverage limitation:** I cannot run the app in a browser in this review. Playability findings are grounded in the rendered code, measured sound durations, App scheduling, and sibling conventions; a manual two-browser session is still required to verify the complete visual/audio experience, especially free-for-all overlap and stale-action feedback.

#### Test command evidence

Targeted Battleship command:

```text
RUN  v4.1.10 /opt/data/pips-ai-player/pips


 Test Files  2 passed (2)
      Tests  42 passed (42)
   Start at  20:07:45
   Duration  2.89s (transform 1.03s, setup 0ms, import 1.26s, tests 262ms, environment 0ms)
```

TypeScript:

```text
(exit code 0; no output)
```

Command run:

```text
npx tsc -b --noEmit
```
