# Solitaire — AI Grouch (Oscar) Review

**Date:** 2026-08-24  
**Reviewer:** Oscar (ai-grouch), run via Bartowski  
**Scope:** `src/card-games/solitaire/` in full (the six-mode picker plus Klondike Draw 1/Draw 3, FreeCell, Spider 2 Suit/1 Suit, and Pyramid), `src/screens/SolitaireRoom.tsx`, `SolitaireTable.tsx`, `SolitaireResults.tsx`, `SolitaireRulesOverlay.tsx`, `SolitaireTable.css`, and Solitaire wiring in `src/App.tsx`. I also checked the project's `CLAUDE.md` standards and the established review format in `docs/hangman-review.md` and `docs/scrabble-review.md`.

**Baseline:** `main` @ `d160de5`. The app was not run in a browser.

---

### Executive verdict

**needs changes** — the solitaire engines are compact, mostly well-factored, and the requested six-file engine suite is green, but the release bar is not met because invalid play gives the player no actionable explanation and the most important cross-variant paths remain under-tested. I found no confirmed blocking rules bug in the code read: Klondike stacking/foundations, FreeCell supermove capacity, Spider same-suit pickup/automatic run clearing, and Pyramid exposure/pairing are internally coherent. The concerns are primarily playability and confidence: one UI-level failure mode is indistinguishable from a dead interaction, and the test suite does not cover the actual dispatch boundary, mode picker/table integration, or several variant-specific edge cases.

### Blocking issues

none

### Major concerns

#### 1. Invalid moves fail without a player-visible reason

- **severity:** major
- **evidence:** `src/screens/SolitaireTable.tsx:177-185` calls `applyMove`; on rejection it only invokes `play('error')`. The status line remains the generic instruction from `getStatusLine()` (`:337-369`), and `App.tsx:1943-1948` silently keeps the old history when `applyAnyMove` rejects a move. The engine does produce concrete reasons such as `"cards do not form a valid sequence"`, `"supermove cap exceeded"`, `"every column needs a card before you can deal again"`, and `"ranks must sum to 13"`, but none reaches the UI.
- **impact:** a user dragging a mixed-suit Spider run, exceeding a FreeCell supermove limit, pairing a non-exposed Pyramid card, or clicking an unavailable stock gets an error sound but no explanation of what failed. The result is operationally indistinguishable from a dead drop target or stale UI, especially for a first-time player learning several variants through the mode picker. The rules overlay says what is legal, but does not explain the specific failed action at the moment it fails.
- **suggested fix:** return the `MoveOutcome.reason` from the table callback path, or add a transient local notice in `SolitaireTable` for rejected moves. Keep the error sound, but pair it with the reason and clear it after the next successful action. Add component/integration coverage for at least one rejection in each family.

#### 2. Variant-specific test coverage is much narrower than the apparent 104-test count

- **severity:** major
- **evidence:** the six files run, but `klondike.test.ts` exercises only `mode: 'klondike'`, not Draw 3 behavior; `freecell.test.ts` does not test foundation removal, invalid source locations, or supermoves after a source/destination interaction; `spider.test.ts` does not cover `spiderLegalDestinations` for multi-card same-suit runs or a final partial stock deal; `pyramid.test.ts` does not test `pyramidLegalDestinations` against a waste-to-waste/self edge or full-deck removal; and there are no tests for `dispatch.ts`, `SolitaireTable`, `SolitaireRoom`, `SolitaireResults`, or the App history/deal wiring.
- **impact:** the green suite proves a useful collection of engine examples, not end-to-end playability of all six modes. A regression in the mode-family dispatch, Draw 3 stock ordering, selected-card UI behavior, error handling, or the transition from `won` state to `SolitaireResults` can ship while all 104 tests remain green.
- **suggested fix:** add a small dispatch/table contract suite. At minimum cover Klondike Draw 3's draw-three/waste order and recycle behavior; both Spider modes through dispatch; Pyramid King shortcut through dispatch; invalid-move notices; mode selection/deal wiring; and the results transition. Add explicit edge-case engine tests listed in the matrix below.

#### 3. Automatic completion is intentionally called “safe” but has no safety contract tests

- **severity:** major
- **evidence:** `SolitaireTable.tsx:371-383` enables Auto-play when all cards are face up and stock/waste are empty, then dispatches every move returned by `autoCompleteAnyMoves` (`:380-384`). `shared.ts:336-355` repeatedly moves any currently legal top card to its foundation; it does not encode a proof that moving that card cannot remove a needed tableau resource. The existing tests prove termination and a fully exposed win-in-waiting fixture, but do not test a position where a legal foundation move should be deferred for playability or verify the UI's “safe move” claim across realistic FreeCell states.
- **impact:** this may be acceptable as a house-rule auto-finish feature, but the implementation and copy imply stronger guarantees than the tests establish. In FreeCell, moving a card to a foundation is reversible through the engine, but Auto-play applies the entire sequence in one batch and offers no pause/choice once enabled. If the heuristic is later expanded or a foundation-return rule changes, the user can be pushed into an unwanted line with no regression signal.
- **suggested fix:** either document the exact auto-complete invariant (“only legal ascending foundation moves after all hidden information is gone”) and test it as a deliberate house rule, or make the button say “Finish available foundation moves” and provide a stop/undo affordance. Add a constructed FreeCell case with legal but strategically consequential foundation moves and assert the intended behavior.

### Minor concerns and nits

- **No explicit win guard in the engine:** `applyMove`, `applySpiderMove`, and `applyPyramidMove` do not reject actions when `state.won` is already true. The App immediately renders `SolitaireResults` for a won history entry, so this is not reachable through the normal table, but a direct caller can mutate a won state. A `won` guard or a documented reducer precondition would make the invariant explicit.
- **`localName` is intentionally unused in `SolitaireTable`:** `:76` contains `void localName`. Solitaire is single-player, so there is no missing seat rail; removing the prop would reduce noise, but this is cleanup rather than a defect.
- **The Spider UI reserves a fixed 950px column:** `SolitaireTable.css:111-121` acknowledges that a very long pile can still scroll. That is a reasonable non-resizing compromise, but narrow screens can require substantial page scrolling before the lower tableau is reachable; one responsive/manual pass is warranted.
- **The mode picker is clear but presents six choices with no difficulty grouping:** the descriptions are accurate and the rules button is useful. Grouping the two Klondike and two Spider variants visually could reduce cognitive load, but this is taste, not a correctness problem.
- **Sound registry usage is consistent:** the table uses `card-draw`, `shuffle`, `card-play`, and `error` through `useSound`; I found no unregistered Solitaire-specific sound name. Results uses the shared `game-win` cue, which is semantically correct for a single-player win.
- **DealIntro is present and correctly scoped:** `SolitaireTable.tsx:437-443` uses the established `DealIntro` convention, while the single-player game appropriately has no bot pacing requirement. The intro is keyed through `dealId`, including Deal again/rematches.

### What the code gets right

- **The family dispatch is simple and legible.** `dispatch.ts` sends Pyramid to its own rules, Spider modes to the Spider engine, and the remaining modes to shared Klondike/FreeCell rules. There is no needless abstraction layer hiding the actual rules.
- **Klondike rules are internally sound by inspection.** `isTableauSequence` enforces strict descending rank plus alternating colors; empty columns require a King; foundations require exact suit and next rank; only the waste top is movable; and the Draw 3 path preserves chronological draw order so the last drawn card is the playable waste top.
- **FreeCell supermove capacity is implemented with the right shape.** `maxMovableCards` counts empty cells and excludes the destination empty column before applying `(empty cells + 1) * 2^empty columns`. The test suite covers several capacity boundaries rather than only the happy path.
- **Spider correctly separates stacking legality from pickup legality.** Any one-rank-lower card may be placed regardless of suit, while multi-card pickup requires a strict same-suit descending run. Completed face-up K-to-A runs are cleared automatically, and the code avoids clearing a coincidental run containing face-down cards.
- **Pyramid exposure and removal are explicit.** `isExposed` models the two supporting cards, waste is treated as exposed, Kings have a dedicated removal move, and pair removal checks distinct locations, card presence, exposure, and rank sum. The tests cover the important geometry and both pyramid/waste pairing.
- **State updates are immutable enough for local undo.** `App.tsx` stores complete `SolitaireState` snapshots; successful moves append one state, undo pops one, and Deal again replaces history with a fresh seeded deal. The engine state is plain serializable data, consistent with the repository constraints.
- **The UI interaction model matches the sibling convention.** It supports select-then-confirm, click-again shortcuts, and native drag/drop; it highlights legal targets; it offers unlimited undo; and it includes a DealIntro, rules overlay, card-back picker, header controls, and registry-backed sounds.
- **The mode copy is unusually honest.** The Draw 3 description calls out that only the last drawn card is playable; Spider explains the suit-dependent pickup rule; FreeCell states the supermove formula; and Pyramid explains exposure and King removal. I found no misleading win or opponent copy.

### Best next moves

1. Surface `MoveOutcome.reason` as a transient player-facing notice instead of relying on an error sound alone; cover one rejection per variant family.
2. Add the missing variant/dispatch tests: Klondike Draw 3 order and recycle, Spider 1-Suit through `dispatch.ts`, Pyramid King shortcut through dispatch, invalid indices/counts, and post-win behavior.
3. Add a lightweight component/integration test for the App history contract: Deal again creates the selected mode, successful moves append exactly one snapshot, rejected moves do not, undo restores the previous state, and `won` renders `SolitaireResults`.
4. Decide and document the Auto-play contract. Either prove/test the intended safe-finish heuristic or soften the copy and provide an explicit user-controlled finish/undo path.
5. Manually exercise each mode in a browser after the above: start from the picker, open rules, complete a deal intro, make an invalid move, undo a valid move, exhaust/recycle stock where applicable, and finish a constructed or real win.

### Codebase review addendum

- **systemic risks:** This game is local rather than PeerJS-hosted, so the host-authority and bot-pacing requirements do not apply directly. The relevant systemic risk is the repository's recurring “engine rejection becomes a no-op” pattern: the rules return useful reasons, but the caller often discards them. Solitaire is a cleaner case than the multiplayer games because the table can surface a local notice without network protocol changes.
- **hotspots worth manual inspection:** `dispatch.ts` as the single variant boundary; `SolitaireTable.tsx` selection/drag/drop state transitions; the `noHiddenCardsLeft` Auto-play gate; and CSS behavior on narrow viewports with Spider piles and Pyramid's fixed 543×555 play area.
- **repeated anti-patterns:** test fixtures are often hand-constructed with duplicate cards or random IDs, which is fine for isolated legality tests but weak for deck-integrity and full-game invariants. The UI has no direct test coverage despite containing substantial interaction state. Rejection reasons are generated centrally but not propagated to the user.
- **areas healthier than expected:** the rules are not over-abstracted, the six-mode picker is explicit rather than clever, card-family differences are represented in types and dispatch, all requested engine tests pass, and the table matches the project's DealIntro/select-confirm/sound conventions without inventing a bot loop for a single-player game.

#### Test case completeness matrix

| Area | Status |
|---|---|
| Klondike deal shape, deterministic seed, 52-card accounting | ✅ covered |
| Klondike Draw 1 stock draw/recycle order | ✅ covered |
| Klondike Draw 3 deal/recycle order | ❌ missing — only `mode: 'klondike'` is exercised |
| Klondike alternating-color sequence and King-to-empty rule | ✅ covered |
| Klondike auto-flip and foundation exact-rank rule | ✅ covered |
| Klondike malformed indices/counts and source bounds | ⚠️ partial |
| FreeCell deal shape and face-up invariant | ✅ covered |
| FreeCell cell occupancy and foundation placement | ✅ partial |
| FreeCell supermove capacity boundaries | ✅ covered |
| FreeCell foundation-to-tableau / all source kinds | ⚠️ partial |
| Spider 2-Suit deal, placement, same-suit pickup | ✅ covered |
| Spider 1-Suit dispatch and complete interaction path | ⚠️ engine direct coverage only; dispatch missing |
| Spider empty-column stock-deal gate and stock exhaustion | ✅ covered |
| Spider auto-flip and face-down run protection | ✅ covered |
| Spider multi-run clearing after all move shapes | ⚠️ partial |
| Pyramid deal shape, exposure geometry, rank values | ✅ covered |
| Pyramid King removal, pair removal, waste pairing | ✅ covered |
| Pyramid full 28-card win through realistic sequential removals | ❌ missing — only a one-card constructed win |
| Pyramid draw/recycle and stock/waste exhaustion | ✅ covered |
| Shared/variant dispatch routing | ❌ missing |
| `hasAnyLegalMove` across all supported modes | ⚠️ Klondike/FreeCell only |
| Auto-play termination and exposed win-in-waiting | ✅ covered |
| Auto-play safety/house-rule contract | ❌ missing |
| Invalid move reason reaches the UI | ❌ missing — would catch Major #1 |
| Select-then-confirm, click-again shortcut, drag/drop | ❌ missing |
| DealIntro, card-back picker, rules overlay, mode picker | ❌ missing |
| History append/undo/Deal again/result transition | ❌ missing |
| Full targeted Solitaire Vitest suite | ✅ 104/104 passed |
| TypeScript build check | ✅ `npx tsc -b --noEmit` passed |

**Coverage limitation:** I cannot run the app in a browser in this review. The playability findings are grounded in the rendered code, the repository's `CLAUDE.md`, and sibling conventions; a manual browser pass is still required for drag/drop behavior, responsive layout, DealIntro timing, sound audibility, and mode-picker flow.

#### Test command evidence

Targeted Solitaire tests:

```text
RUN  v4.1.10 /opt/data/pips-ai-player/pips


 Test Files  6 passed (6)
      Tests  104 passed (104)
   Start at  20:06:51
   Duration  2.95s (transform 471ms, setup 0ms, import 864ms, tests 198ms, environment 0ms)
```

TypeScript:

```text
npx tsc -b --noEmit

(exit code 0; no output)
```
