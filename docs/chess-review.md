# Chess — AI Grouch (Oscar) Review

**Reviewer:** Oscar (ai-grouch), run via Bartowski  
**Scope:** `src/board-games/chess/` (state, rules, bot, tests), `src/screens/ChessTable.tsx`, `ChessRoom.tsx`, `ChessResults.tsx`, `ChessRulesOverlay.tsx`, Chess wiring and bot/PeerJS dispatch in `src/App.tsx`, and the shared PeerJS/sync boundary used by Chess.  
**Baseline:** `main` @ `d160de5`, with `chess.js` `^1.4.0` as a runtime dependency.

I read the Chess engine, bot, test file, all Chess screens and styles, the Chess App callers, and the relevant sync/PeerJS boundary in full. The closest board-game sibling inspected for interaction and turn treatment was Checkers (`CheckersTable.tsx`, `CheckersRoom.tsx`, `CheckersResults.tsx`).

---

### Executive verdict

**needs changes** — the rules boundary is sensibly small and delegates the hard chess work to `chess.js`, and the targeted suite is green, but the shipped UI has two real release-quality failures: rejected actions disappear without feedback, and the results screen plays the winner sound for both players (and the table has already played it once on the stage transition). The implementation covers ordinary legality, castling, en passant, promotion, checkmate, stalemate, the advertised draw conditions, host-side authorization, and wire-safe FEN state. The remaining risk is not that the wrapper tried to reimplement chess incorrectly; it is that the wrapper/UI boundary treats failure and outcome feedback as if they did not matter.

### Blocking issues

none

### Major concerns

#### 1. Invalid or stale actions are silently discarded

- **severity:** major
- **evidence:** `src/App.tsx:3334-3340` applies a guest action and returns immediately when `result.outcome.ok` is false; `src/App.tsx:3442-3450` does the same for a host-local action. `validateChessAction` has useful rejection reasons (`not your turn`, `illegal move`, `not in play stage`, and so on), but neither caller displays or sends them. The network layer (`src/net/peer.ts:91-93`) has a `reject` primitive, but Chess never uses it for rejected actions.
- **impact:** a stale tab, a second click during a move update, or a manually crafted action produces no state change and no explanation. On the host this looks like a dead button; for a guest the action simply vanishes at the host. The player can remain staring at an old board while believing the move was accepted, especially around promotion or a simultaneous draw/turn transition. That violates the established table convention of surfacing `notice` banners and makes the otherwise good validator operationally opaque.
- **suggested fix:** preserve the validator's reason and show it in the existing `notice` banner for host-local actions; for guests, send a rejection response scoped to the action (or a transient error message) without tearing down the room. Add tests at the dispatch/network boundary that a rejected action leaves the session unchanged and becomes visible to the initiating player.

#### 2. Results audio says both players won, and the winner hears it twice

- **severity:** major
- **evidence:** `src/screens/ChessResults.tsx:47-48` unconditionally runs `play('game-win')` on mount. `src/screens/ChessTable.tsx:118-121` also plays `game-win` whenever `publicState.stage` changes to `over`. `App.tsx:5457-5468` then replaces the table with `ChessResults` for both players.
- **impact:** a loser hears a victory cue, contradicting the correctly rendered `You win!` / opponent-wins result. The winner gets one cue from the table transition and another from the results mount. Draws also play `game-win` even though no one won. This is a semantic feedback bug, not cosmetic polish; sound is part of the game's result language and the repository's own standards explicitly reject cut, overlapped, or misleading sound behavior.
- **suggested fix:** choose the result sound from `publicState.outcome` and `localPlayerId`: winner-only `game-win`, a draw-appropriate cue or silence for draws, and a loser cue/silence for the other player. Centralize the stage/result transition so the cue is emitted exactly once, then add winner, loser, resignation, checkmate, and draw regression coverage.

#### 3. Bot action pacing is not coupled to the visible move animation or sound duration

- **severity:** major
- **evidence:** `src/App.tsx:3369-3387` waits the shared `BASE_MS` before computing and applying the bot move. Chess's visible piece animation is `320ms` (`src/screens/ChessTable.css:115-121`); the move sound is played on the same accepted-state effect (`ChessTable.tsx:107-117`). There is no Chess-specific duration estimator or sound-duration hold, and `BASE_MS` is inherited rather than checked against the full event sequence.
- **impact:** this is not a confirmed rapid-fire failure for the current two-seat game: there can be only one bot and the 900ms shared delay is longer than the 320ms CSS slide. It is nevertheless a real robustness gap against the stated standard. The host schedules the next bot turn from state, not from completion of the client's animation/audio, and the sound registry's actual clip duration is not represented in the pacing contract. A future change to the shared delay, sound, or animation can race the board immediately, and the current code has no test that protects the invariant.
- **suggested fix:** define a Chess move pacing constant or pure estimator that accounts for the 320ms move animation and the registered move/result sound, then schedule the next bot action from that contract. Add a timing test or at least a documented invariant test; do not treat a generic `BASE_MS` as evidence of human pacing.

### Minor concerns and nits

- `ChessTable.tsx:71` discards `onOpenRules` with `void onOpenRules`; the Rules button works through local state, so this is dead prop plumbing rather than a dead visible button. Remove the unused prop or wire one owner consistently.
- `ChessRoom.tsx:5` imports `BattleshipTable.css` for the lobby's generic variant classes. It works if those classes remain global, but it creates an unexplained styling dependency and makes a Chess lobby fragile to Battleship CSS changes.
- `ChessTable.tsx:113-115` uses `checker-jump` for every capture and `king-me` for every promotion. The registry has no chess-specific move sounds, so reuse is defensible, but a capture sound named for checkers is misleading product vocabulary and should not be expanded without a deliberate sound decision.
- `ChessResults` has no special result sound for draw or resignation, compounding the unconditional `game-win` issue.
- The rules overlay says “Full standard rules” while the implementation relies on the exact `chess.js` draw semantics. The wrapper currently distinguishes threefold, fifty-move, and insufficient-material correctly by inspection, but the project should pin and document the library behavior if automatic 75-move/variant interpretation is a product requirement; I did not assert behavior not verified from the installed library contract.
- The no-cancel promotion overlay is a small usability trap: once a destination is tapped, the player must choose one of four pieces. This is not a correctness bug because every offered choice is legal and the overlay is reachable only after a legal promotion destination.
- No DealIntro is appropriate here. Chess is a board game with no deal/shuffle event, and the inspected Checkers sibling likewise does not force a card-oriented intro.

### What the code gets right

- **The engine does not reimplement chess legality.** `validateChessAction` constructs `new Chess(publicState.fen)` and delegates move validation and state mutation to `chess.js`. It catches the library's throwing illegal-input behavior and also handles a possible `null` result instead of letting malformed coordinates crash the host.
- **Host authority is correctly placed.** Turn ownership, seat membership, color/FEN consistency, and all action validation happen in the host-side validator before a new canonical state is broadcast. The wire state is plain data: FEN plus explicit serializable outcome/turn metadata; private state is an empty record.
- **The wrapper preserves important move semantics.** SAN, origin/destination, check status, castling rights, en passant capture, and promotion are taken from the post-move `chess.js` result/FEN rather than reconstructed by hand.
- **End conditions are handled in a sensible order.** Checkmate and stalemate are distinguished before draw checks; threefold is reported separately; insufficient material is separated from the fifty-move clock. The tests cover all advertised outcome kinds, including Fool's Mate, stalemate, threefold, K+N vs K, and a halfmove clock at 100.
- **Draw-offer state transitions are unusually well defended.** Offers are restricted to the current player, the other player alone can accept/decline, a second offer is rejected, moves clear an offer, and resign/accept clear it on game end. The tests explicitly cover post-resignation accept/decline rejection and unseated IDs.
- **The board UI is genuinely driven by the canonical FEN.** `ChessTable` uses `chess.js` read-only for rendering and legal destination hints, while every actual move goes through `onMove`; it resets selection/promotion when turn or stage changes.
- **Promotion, castling, en passant, and check feedback are playable on the happy path.** The UI exposes all four promotion choices, shows check in status text, and animates accepted moves once via a move signature. The sibling turn-start sound treatment is present through `useTurnStartSound` and the shared sound toggles.
- **The bot strategies are bounded in scope and legal by construction.** Easy weights captures and passes promotion through as a queen; Normal performs a transparent depth-2 material search with explicit checkmate/stalemate handling. Tests verify legal moves, capture preference, promotion, black replies, and avoiding a known stalemate.
- **The test suite is not vacuous.** The targeted file ran 42 tests, including real FEN assertions and JSON round-trip/wire-safety checks. The full repository suite is also green, and TypeScript is clean. That is meaningful evidence for the engine/wrapper, though it does not cover React rendering or PeerJS behavior.

### Best next moves

1. Fix result feedback first: emit exactly one outcome sound, with winner/loser/draw semantics, and add component-level regression tests.
2. Thread rejected-action reasons into Chess's existing notice path for both local host actions and remote guest actions; do not silently return from `chessDispatch`/`onAction`.
3. Replace the generic bot pacing assumption with a Chess-specific animation/audio hold contract and test the full bot turn at the table's maximum one-bot configuration.
4. Add focused tests for malformed runtime actions at the boundary (bad coordinates, invalid promotion, unseated `RESIGN`, stale draw responses) and for result/notice rendering. The legal-rule core is already much better covered than the UI boundary.
5. Run one manual two-browser pass after the changes: host-vs-guest move exchange, rejected stale move, all promotion choices, draw offer/decline/accept, resignation, checkmate, stalemate, and host-vs-bot pacing.

### Codebase review addendum

- **systemic risks:** Chess exposes a repository-wide boundary weakness: validators return precise reasons, but app/PeerJS callers often treat rejection as a silent no-op. Host authority is present, but authority without an observable failure channel is poor multiplayer UX and hard to diagnose. Result screens also inherit a generic `game-win` assumption that does not encode winner/loser/draw semantics.
- **hotspots worth manual inspection:** `src/App.tsx` action dispatch and bot scheduling for every newer board game; `src/screens/*Results.tsx` for winner-only sound behavior; `src/net/peer.ts` for whether action-level rejection needs a distinct protocol message; and the shared `BASE_MS` callers against each game's actual animations and audio.
- **repeated anti-patterns:** generic result sounds on both sides, silent `if (!outcome.ok) return` paths, and shared timing constants used without a per-game duration contract. Chess's `void onOpenRules` prop is a smaller instance of duplicated ownership between App and screen-local state.
- **areas healthier than expected:** the Chess engine is compact, explicit, and appropriately library-backed rather than a dangerous home-grown rules implementation. FEN is a good canonical wire boundary, the tests exercise the difficult chess rules directly, and the draw-offer validator is more complete than the surrounding UI error handling.

#### Test case completeness matrix

| Area | Status |
|---|---|
| Standard initial FEN / white-to-move setup | ✅ covered |
| Host-side current-turn and seat authorization | ✅ covered for MOVE and draw actions; RESIGN seat path covered |
| Geometrically illegal move | ✅ covered |
| Self-check / pseudo-legal move exposing king | ✅ covered |
| Castling rights and rook relocation (both sides) | ✅ covered |
| En passant target and captured pawn removal | ✅ covered |
| Promotion required and queen promotion | ✅ covered |
| Invalid promotion piece | ✅ covered |
| Checkmate outcome and winner | ✅ Fool's Mate covered |
| Stalemate outcome | ✅ covered |
| Threefold repetition | ✅ outcome helper covered |
| Fifty-move draw classification | ✅ outcome helper covered |
| Insufficient-material classification | ✅ outcome helper covered |
| Other chess.js draw/game-over combinations from MOVE wrapper | ⚠️ helper coverage exists, end-to-end wrapper coverage is thin |
| Draw offer / accept / decline / implicit decline by move | ✅ covered |
| Draw response after game over / unseated responder | ✅ covered |
| Resignation and post-game rejection | ✅ covered |
| Malformed runtime `from`/`to` payloads and non-string coordinates | ⚠️ library catch is present; direct boundary cases are not all tested |
| Host/guest PeerJS action rejection and user-visible notice | ❌ missing — would catch Major #1 |
| Results winner/loser/draw sound selection and exactly-once emission | ❌ missing — would catch Major #2 |
| Move animation/audio completion before bot's next action | ❌ missing — pacing contract is not tested |
| Easy bot legality/capture bias/promotion | ✅ covered |
| Normal bot legality, black-side replies, material choice, stalemate avoidance | ✅ covered |
| Bot behavior in checkmate/zero-legal-move terminal states | ⚠️ indirectly exercised by validator/outcome tests; no direct strategy terminal test |
| FEN/session JSON round-trip and wire safety | ✅ covered |
| React screen rendering, PeerJS two-browser flow, sound playback | ❌ not covered by Vitest |
| Targeted Chess Vitest command | ✅ 42/42 passed |
| Full repository Vitest suite | ✅ 1398/1398 passed |
| TypeScript build check | ✅ clean |

**Coverage limitation:** I cannot run the app in a browser in this review environment. The playability findings are grounded in the rendered code and the Checkers sibling convention; the result-sound and silent-rejection mechanisms are concrete code-path findings, but a manual two-browser/audio pass is still required before release.

#### Test command evidence

Targeted Chess tests:

```text
RUN  v4.1.10 /opt/data/pips-ai-player/pips


 Test Files  1 passed (1)
      Tests  42 passed (42)
   Start at  20:12:28
   Duration  3.62s (transform 265ms, setup 0ms, import 343ms, tests 2.96s, environment 0ms)
```

Full suite:

```text
> pips@0.0.0 test
> vitest run


 RUN  v4.1.10 /opt/data/pips-ai-player/pips


 Test Files  66 passed (66)
      Tests  1398 passed (1398)
   Start at  20:12:53
   Duration  19.65s (transform 1.81s, setup 0ms, import 3.23s, tests 7.69s, environment 6ms)
```

TypeScript:

```text
npx tsc -b --noEmit

(exit code 0; no output)
```
