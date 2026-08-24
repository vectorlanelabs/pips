# Dominoes — AI Grouch (Oscar) Review

**Date:** 2026-08-24  
**Reviewer:** Oscar (ai-grouch), run via Bartowski  
**Scope:** `src/board-games/dominoes/` (state, rules, scoring, bot, layout, all three test files), `src/screens/DominoesTable.tsx`, `DominoesRoom.tsx`, `DominoesResults.tsx`, `DominoesRulesOverlay.tsx`, `DominoesTable.css`, and the Dominoes wiring/effects in `src/App.tsx` (baseline `main` @ `d160de5`). I also read the shared `DealIntro`, PeerJS host/guest contract, and Battleship's sibling room/table/results screens for convention comparison.

**Verification baseline:** the requested Dominoes slice passed **69/69 tests across 3 files**; `npx tsc -b --noEmit` was clean. I did not run the app in a browser.

---

### Executive verdict

**needs changes** — the rules engine is unusually well tested and survives the adversarial `oscar.test.ts` probes: dealing, private-state serialization, draw-until-playable, spinner geometry, All Fives scoring, blocked rounds, going out, match thresholds, and host-side legality are all coherent by inspection and by the green test suite. The release problem is the UI/host sequencing: the bot is deliberately scheduled at 900ms while the Dominoes action sounds are 1.032s long, and the initial DealIntro is not held by host-side logic; this violates the repository's top-priority human-speed and animation rules. Rejected actions are silently discarded, and the results screen plays `game-win` for the loser as well as the winner. The engine itself is defensible; the shipped play experience is not.

### Blocking issues

#### 1. Bot actions overlap their own sound and can race the deal animation

- **severity:** blocking
- **evidence:** `src/App.tsx:2468-2480` waits only `BASE_MS` (900ms) before every Dominoes bot action. The actual assets are `src/assets/sounds/domino-play.mp3` and `domino-draw.mp3`, both measured locally at **1.032s** with `ffprobe`; the next action therefore begins about 132ms before the previous cue finishes. The same scheduler starts after the host immediately publishes the game state (`addDominoesHouseBot` → `dominoesUpdateViews`), while `DominoesTable` mounts `DealIntro`. `DealIntro` documents and exports `estimateDealIntroMs`, but Dominoes neither uses the estimator nor holds the bot until `onComplete`.
- **why it breaks:** in a draw chain, the second draw/play lands while the first Dominoes sound is still playing, so the feedback is clipped or overlapped. On a bot-led opening, the bot can mutate canonical state while the human is still watching the empty → shuffle → deal sequence. This is exactly the failure mode `CLAUDE.md` elevates above ordinary functional correctness: a bot that is technically legal but too fast to follow is broken. The problem is not hypothetical pacing taste; the measured interval is shorter than the measured cue, and the visible intro is explicitly asynchronous.
- **what would change my mind:** a host-side Dominoes pacing path that waits at least the measured action sound/animation duration, plus a round-start hold based on `estimateDealIntroMs` (or an equivalent pure estimator), and a test or timing harness proving the bot cannot act before those holds expire. A manual full opening and multi-draw bot turn should make each action separately observable.

### Major concerns

#### 1. Rejected actions are silently ignored

- **severity:** major
- **evidence:** host-side `dominoesDispatch` (`src/App.tsx:2535-2543`) returns immediately when `applyDominoesAction` reports `{ ok: false }`; `onAction` (`:2436-2441`) does the same for a guest action. The engine has useful reason strings (`'not your turn'`, `'you have a legal play'`, `'the boneyard is empty — pass'`, etc.), and `DominoesTable` already accepts a `notice` prop and renders an error banner, but the Dominoes wiring never puts the rejected reason into that banner.
- **impact:** a stale click, a double-click, or a guest action that arrives after the board changed looks like a dead button. A player who clicks Draw while a legal tile is already available receives no explanation; a remote action rejected by the host produces no state change and no feedback. The UI does disable most obvious invalid controls, but network races and stale tabs remain real paths, and the code has already built the error-display affordance without connecting it.
- **suggested fix:** preserve the validator reason for the initiating player. For host actions, set a transient Dominoes notice; for guest actions, send a rejection message that does not eject/reset the guest and render the reason locally. Add a test for each dispatch path, not just engine rejection.

#### 2. Losers hear the victory cue

- **severity:** major
- **evidence:** `src/screens/DominoesResults.tsx:40-41` runs `play('game-win')` unconditionally on mount. The component then correctly computes `isLocalWinner` at `:46-47` and renders either `You take the match!` or `${opponentName} takes the match.`
- **impact:** both players hear a sound that semantically says “you won,” including the player whose screen says the opponent won. That contradicts the visible result and makes the sound registry's feedback language misleading. It is the same generic-results mistake seen in sibling screens, but Dominoes should not copy a known bad convention merely because it exists.
- **suggested fix:** gate `game-win` on `publicState.matchWinnerId === localPlayerId`; use a loser cue or silence for the other client. Add a component-level regression test for local winner and local loser mounts.

#### 3. DealIntro silently animates only ten of fourteen dealt tiles

- **severity:** major
- **evidence:** `DominoesTable.tsx:386-393` invokes `DealIntro` without `maxFlights`. `DealIntro` defaults `maxFlights` to 10 (`src/components/DealIntro.tsx:19-23, 102-117`), while Dominoes deals 7 tiles to each player (`state.ts:87-97`), i.e. 14 total. The shared component explicitly says that when the cap is exceeded, leftover cards “silently pop into the pile the instant the capped animation ends.”
- **impact:** the opening animation visually deals only part of the hands, then the remaining tiles appear at settle. That reads as a broken or incomplete shuffle and is especially noticeable in a game whose board is otherwise careful about visible state. The component provides the exact escape hatch; Dominoes simply does not pass the real total.
- **suggested fix:** pass `maxFlights={hand.length + opponentHandCount}` (or the equivalent full deal count), and include the resulting duration in the host bot hold. Add a render/timing regression test or at least a shared helper assertion that all 14 flights are scheduled.

#### 4. No direct UI/transport coverage for the release-critical behavior

- **severity:** major
- **evidence:** all three Dominoes test files are engine/layout tests. `dominoes.test.ts` has strong state and bot tests, `layout.test.ts` has extensive geometry tests, and `oscar.test.ts` has 19 adversarial probes, but none mounts `DominoesTable`/`DominoesResults`, exercises `App` dispatch, checks the guest rejection callback, measures action pacing, or verifies `DealIntro` sequencing.
- **impact:** the suite can remain green while the player hears clipped sounds, sees an incomplete deal, gets no explanation for a rejected click, and hears the wrong result cue. These are not speculative edge cases; they are visible code paths absent from the executable contract.
- **suggested fix:** add focused screen/wiring tests for winner/loser audio, notice propagation, all 14 deal flights, and a fake-timer bot scheduler test that proves no action occurs before the sound/intro holds.

### Minor concerns and nits

- `DominoesTable` accepts `onOpenRules` but discards it (`void onOpenRules`); the Rules button opens its own local state instead. This is harmless today, but it is dead wiring and makes the prop contract misleading. Either remove the prop or use it.
- `localName` is similarly accepted and discarded by the table. The sibling table pattern has the same compatibility residue, so this is cleanup rather than a release defect.
- The engine's `roundEnd` pause is 4s and is host-driven in `App.tsx:4636-4650`; that is a reasonable human-readable transition. It should remain coupled to the deal intro rather than being treated as a substitute for the opening animation hold.
- The rules copy says “the lighter hand banks both hands’ pips,” while the engine correctly awards the combined pip total to the lower-pip player. The copy is understandable, but “the player with fewer remaining pips banks both hands’ pips” is less ambiguous.
- The house bot uses `Math.random()` for the match seed (`App.tsx:2458`), while the in-match engine uses a seeded RNG. This is acceptable for casual room creation, not an engine correctness defect.
- No deal intro omission: Dominoes does use `DealIntro`, which is the right established convention for a dealt-table game. The defect is incomplete flight configuration and host timing, not the presence of the intro.

### What the code gets right

- **The draw/boneyard invariant is clear and enforced.** A player cannot draw while holding a legal play; each draw consumes exactly one boneyard tile; the turn stays with the same player; a playable draw must then be played; passing is legal only once the boneyard is empty. The tests cover both playable and unplayable draw chains.
- **Play legality is host-side and correctly based on current board state.** The validator checks tile ownership and computes legal arms from the current center, spinner state, and arm ends. Stale intents are revalidated rather than trusted from the client.
- **Spinner handling is coherent.** A double lead opens all four arms; non-doubles expose only left/right; empty spinner arms expose the center pip; placed doubles retain the doubled end semantics. The scoring tests include the easy-to-miss case where only one spinner side is occupied.
- **All Fives scoring is unusually well defended.** `boardTotal`, multiple-of-five gating, double-end counting, zero scores, going-out bonuses, blocked-round scoring, ties, and match target transitions all have direct tests. The adversarial probes specifically attack spinner inflation and final-play-plus-go-out scoring.
- **Round and match state transitions are explicit.** Scores persist across rounds, starters alternate, a tied score at/above target keeps the match alive, and a non-tied target close records a winner. `START_NEXT_ROUND` is not accepted during play or after match over.
- **Host authority and privacy are sound in the engine.** Randomization and canonical action application remain host-side; snapshots expose the viewer's own hand but not opponent/boneyard IDs; the tests run a complete seeded bot-vs-bot match while checking serialization and leak boundaries.
- **The layout work is not superficial.** `layout.test.ts` checks doubles at bends, pinwheel direction, cross-arm collision cases, long-arm spiraling, bounds, and scale floors. This is a meaningful geometric test suite, not a snapshot that merely proves something rendered.
- **`oscar.test.ts` is real adversarial coverage, not a superficial pass.** It contains information-leak, crafted-action, scoring-edge, draw-chain, stale-state, and host-authority probes. It passes 19 tests and materially increases confidence in the pure game layer. Its limitation is scope: it does not test the React/PeerJS/UI layer where the remaining defects live.
- **The code matches the healthier sibling conventions in several places.** It uses `DealIntro`, registered sound names, `ScoreHeader`, turn-start sound, select-then-confirm placement on a non-empty board, a room/results/table split, and plain serializable session state. The fixed two-player shape also makes the “full table” pacing concern more bounded than in N-player games—but does not excuse sub-sound pacing.

### Best next moves

1. Fix the host bot scheduler first: use measured per-action holds (at minimum >1.032s for the two Dominoes action cues) and hold the first bot action through the full 14-flight intro using `estimateDealIntroMs(14)` plus the established render/network slack.
2. Pass all 14 deal flights to `DealIntro`; do not let the component's default cap hide half the deal.
3. Make rejected actions observable without ejecting or resetting a guest; thread validator reasons into the existing notice banner.
4. Make result audio winner-aware and add winner/loser regression tests.
5. Add UI/wiring tests with fake timers. Keep the existing engine suite intact—it is one of the stronger game test suites in this repository.
6. Run one manual two-browser session after those changes: initial bot lead, several consecutive draws, a blocked round, a going-out round, match over as both local winner and local loser, and a stale/invalid guest click.

### Codebase review addendum

- **systemic risks:** The Dominoes engine has stronger invariants and adversarial tests than the surrounding UI integration. The recurring systemic risk is the boundary between pure host state and asynchronous client presentation: `App.tsx` schedules bots from state publication, while the client owns animation and sound lifetimes. Without a shared per-game timing contract, a green engine suite can coexist with an unplayable table.
- **hotspots worth manual inspection:** `App.tsx`'s other bot schedulers for the same fixed `BASE_MS` assumption; every results screen's winner/loser audio; every `DealIntro` caller with more than ten dealt cards; and every PeerJS `onRejected` handler to ensure ordinary invalid actions are not treated as connection failure.
- **repeated anti-patterns:** invalid action outcomes are often discarded at the app dispatch boundary; generic `game-win` is played without checking the local winner; and visual animation durations are not consistently coupled to host bot scheduling. Dominoes exposes all three clearly.
- **areas healthier than expected:** the pure Dominoes engine is compact, plain-data, host-authoritative, and not over-abstracted. The test authors did not merely test happy paths: the layout fuzz-derived cases, serialized snapshot checks, stale-action probe, draw-chain enforcement, and complete match loop are valuable evidence.

#### Test case completeness matrix

| Area | Status |
|---|---|
| Double-six set: 28 unique tiles | ✅ covered |
| 7/7 deal, 14-tile boneyard, disjointness, seeded determinism | ✅ covered |
| Private snapshots / no opponent or boneyard tile-ID leaks | ✅ covered, including adversarial full-match probe |
| Center lead and canonical tile ownership | ✅ covered |
| Matching pips on right/left arms | ✅ covered |
| Illegal arm, center replay, non-current player, bogus tile/action payloads | ✅ covered in `dominoes.test.ts`/`oscar.test.ts` |
| Double lead / spinner opens four arms | ✅ covered |
| Spinner arm end values and double placement semantics | ✅ covered |
| All Fives board totals and multiple-of-five gate | ✅ covered |
| Going out: final-play score plus opponent-pip bonus | ✅ covered |
| Blocked round: lower hand scores combined pips | ✅ covered |
| Blocked equal-pip tie scores nobody | ✅ covered |
| Round alternation and score persistence | ✅ covered |
| Target threshold, tied ≥ target, match winner | ✅ covered |
| Draw-until-playable and turn unchanged across draws | ✅ covered |
| Pass only with empty boneyard and no legal play | ✅ covered |
| Bot strategy: lead, scoring choice, tie breaks, draw/pass, full match | ✅ covered |
| Bot pacing against real sound durations | ❌ missing — would catch Blocking #1 |
| DealIntro full 14-flight configuration | ❌ missing — would catch Major #3 |
| Host hold through client deal animation | ❌ missing — would catch Blocking #1 |
| App host dispatch rejection notice | ❌ missing — would catch Major #1 |
| Guest PeerJS rejection behavior | ❌ missing |
| Winner-only results sound | ❌ missing — would catch Major #2 |
| DominoesTable interaction/rendering and disabled-state copy | ❌ missing |
| Complete Dominoes engine slice | ✅ `3/3` files, `69/69` tests passed |
| TypeScript build check | ✅ `npx tsc -b --noEmit` passed |

**Coverage limitation:** I cannot run the app in a browser in this review environment. The pacing, incomplete-flight, silent-rejection, and winner-audio findings are grounded in the read code plus measured sound durations, but they still deserve a manual two-browser session after fixes.

#### Test command evidence

Targeted Dominoes tests:

```text
RUN  v4.1.10 /opt/data/pips-ai-player/pips


 Test Files  3 passed (3)
      Tests  69 passed (69)
   Start at  20:12:26
   Duration  2.10s (transform 464ms, setup 0ms, import 666ms, tests 347ms, environment 0ms)
```

TypeScript:

```text
npx tsc -b --noEmit

(exit code 0; no output)
```
