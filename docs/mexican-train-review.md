# Mexican Train — AI Grouch (Oscar) Review

**Date:** 2026-08-24  
**Reviewer:** Oscar (ai-grouch), run via Bartowski  
**Scope:** `src/board-games/mexican-train/` (state, rules, bot, tests), `src/screens/MexicanTrainTable.tsx`, `MexicanTrainRoom.tsx`, `MexicanTrainResults.tsx`, `MexicanTrainRulesOverlay.tsx`, the table CSS, Mexican Train wiring and host bot/round scheduling in `src/App.tsx`, and the shared `DealIntro`/sound conventions used by the table.

**Baseline:** `main` @ `d160de5`. The targeted Mexican Train suite passed **45/45** tests; `npx tsc -b --noEmit` was clean. I did not run the app in a browser.

---

### Executive verdict

**needs changes** — the rules engine is unusually well covered and the core Mexican Train invariants are mostly coherent, but two release-visible UI failures remain: the deal animation silently caps at ten flights for tables that deal far more than ten tiles, and the results screen plays the winner cue for the loser as well. Invalid/stale actions are also discarded without feedback, turning legitimate race or network failures into dead-looking controls. I found no confirmed blocking engine-rule defect in the code or tests; the release risk is concentrated in animation/playability consistency and missing UI/integration coverage.

### Blocking issues

none

### Major concerns

#### 1. The deal intro drops most of the deal into place instead of animating it

- **severity:** major
- **evidence:** `src/screens/MexicanTrainTable.tsx:354-361` renders `DealIntro` with `others`, `yourHandSize`, and a card-back renderer, but does not pass `maxFlights`. `src/components/DealIntro.tsx:110-117` documents that the default is capped at 10 flights and explicitly warns that callers with more dealt cards must pass the real total or leftover cards pop into the pile.
- **impact:** Mexican Train deals 32 tiles in a two-player game, 45–72 tiles in larger games, and the table supports up to eight seats. With the default ten-flight cap, only ten backs animate; the remaining tiles appear all at once when the intro settles. That is exactly the broken “shuffle/deal” behavior the project convention calls out, and it is worse at a full table—the case `CLAUDE.md` says to judge, not the one-bot happy path. It also means the visible animation does not represent the state transition the host has already broadcast.
- **suggested fix:** pass the actual number of dealt tiles (or a deliberate, documented full-deal flight count) as `maxFlights`, and use the corresponding `estimateDealIntroMs` value in the host's round-start hold rather than relying only on the fixed `ROUND_PAUSE_MS`. Add a render/timing regression test or at least a pure calculation test covering 2-, 4-, and 8-seat deals.

#### 2. Results play `game-win` for every player, including the loser

- **severity:** major
- **evidence:** `src/screens/MexicanTrainResults.tsx:35-39` calls `useEffect(() => { play('game-win') }, [])` without checking `publicState.matchWinnerId` against `localPlayerId`. The same component correctly computes `isLocalWinner` at lines 41-45 and renders different winner/loser copy, so the audio contradicts the visual result for every losing client.
- **impact:** both players hear a victory cue when the match ends; the losing player is told by sound that they won. Sound is part of the game's feedback language, not decorative noise, and `CLAUDE.md` specifically treats misleading sound behavior as a bug. In a multiplayer table this is a direct semantic contradiction at the most important state transition.
- **suggested fix:** play `game-win` only when `winnerId === localPlayerId`; use a loser cue if the registry has an appropriate one, or intentionally remain silent. Add a results regression test for local winner and local loser mounts.

#### 3. Rejected actions are silently thrown away

- **severity:** major
- **evidence:** host guest actions return early in `src/App.tsx:3102-3110` when `applyMTAction` returns `!outcome.ok`; host-local actions do the same at `3257-3266`. The table receives `notice={mtNotice ?? error}` (`5384-5432`), but the Mexican Train dispatch paths never set `mtNotice` on a rejected draw/play/pass-equivalent. The engine has meaningful reasons such as `tile not in hand`, `tile cannot be played there`, `you have a legal play`, and `the boneyard is empty — pass` (`src/board-games/mexican-train/rules.ts:113-118`, `164-167`, `201-204`).
- **impact:** the normal table disables most invalid controls, but stale guest state and network races are normal in PeerJS multiplayer. A guest can select a tile, receive a newer host state, then click a target that the host rejects; nothing changes and no explanation appears. A draw can similarly lose a race with another action. The player experiences this as a dead button or a frozen table, while the authoritative engine has already explained the failure and the UI discarded it.
- **suggested fix:** thread rejection reasons into the initiating player's transient notice path. For guests, add an action-request/rejection response rather than only broadcasting accepted state; for host-local actions, set `mtNotice` directly. Clear the notice after a bounded interval or after the next accepted action. Add tests around rejected stale/out-of-turn actions at the dispatch boundary if that path is testable.

### Minor concerns and nits

- **Test gap, not a confirmed engine bug:** the 45 tests exercise the pure rules state machine heavily, but there is no test for the React table's `DealIntro` parameters, the host scheduler's animation hold, or the results sound branch. Those are the exact places where the current defects live.
- The table's comment says “the five lanes” (`MexicanTrainTable.tsx:412`) even though the implementation supports one Mexican lane plus up to eight player lanes. This is harmless documentation drift, but it is the sort of stale wording that makes future layout changes harder to review.
- `MexicanTrainRulesOverlay.tsx:9-14` gives a concise rule summary, but it does not explain that a player with no legal play must draw before passing, nor does it explain that a double keeps the same player active until they resolve it. The controls and status line communicate some of this, so this is a readability gap rather than a correctness defect.
- `MexicanTrainTable.tsx:484-486` has no manual Pass button. That is defensible because the host auto-applies `PASS` when the boneyard is empty and the player has no legal move (`App.tsx:4707-4739`), but the UI should say that the pass is automatic or show a short “No move — passing…” state during the 1.1-second delay.
- The room's clipboard calls intentionally swallow failures (`MexicanTrainRoom.tsx:34-40`), while still showing “Copied!” (`31-36`, `38-41`). If clipboard permissions are denied, the invite UI lies. This is shared sibling behavior and not Mexican Train-specific, so it is a low-priority systemic nit rather than a release finding here.
- The fixed `MT_ACTION_MS = 1100` is a reasonable improvement over the repo's 900ms baseline: it clears the roughly 1.03s domino play/draw sounds, and the 2.5s horn buffer brings horn-open actions to about 3.6s. I found no evidence that this value itself is too fast, but a full eight-bot manual session is still warranted because pacing must be judged by consecutive actions, not one bot in isolation.

### What the code gets right

- **The engine's ownership model is sound.** `applyMTAction` and `runMTBotTurn` validate against host-held private hands and boneyard state; guests submit intents, and `mtBroadcast` sends each guest only its own snapshot (`App.tsx:3031-3065`). The wire-safety tests cover public/private serialization and no hand/boneyard leakage.
- **The tile set and deal math are correct by inspection and test.** `createMexicanTrainSet` produces all 91 unique double-12 tiles; the engine tile is removed before dealing; the published 2–8 seat hand sizes leave the expected boneyard counts. The tests cover both endpoints and multiple rounds.
- **Lane legality is clear and correctly scoped.** `legalLanes` always permits the player's own lane and Mexican train, exposes only open opponent lanes, and matches either half against the lane end. The tests cover both orientations, open/closed opponents, and empty-lane engine matching.
- **Double handling is explicit rather than hidden in bot code.** A played double keeps the turn and sets `doublePending`; a playable draw keeps the turn; a dead draw or pass opens the player's train and advances. Going out on a double ends the round immediately, which is tested directly.
- **Drawing and blocked-round transitions preserve the important invariants.** Legal-play-before-draw and boneyard-empty checks are host-side; dead draws open the own train; pass streaks end a blocked round after one full table rotation; scores add remaining pips and the lowest total wins after round 12. The test suite covers 2-, 3-, 4-, and 8-player rotation/end conditions.
- **The UI matches the strongest sibling conventions.** `MexicanTrainTable` uses `DealIntro`, select-then-confirm tile play, explicit legal-lane ghost targets, active-seat rail highlighting, `TurnSoundToggle`, registered domino/train sounds, and a rules overlay. The visual active-seat treatment is materially better than several older screens. The problem is not that the conventions were ignored; it is that the `DealIntro` contract was only partially used.
- **Bot pacing has deliberate sound awareness.** `runMTBots` waits `MT_ACTION_MS` before each action, checks staleness before committing, and adds `MT_HORN_BUFFER_MS` after an opened train. The comments tie the constants to actual sound durations instead of pretending one generic delay fits every game. That is healthy architecture, even though the deal-intro hold still needs the same rigor.
- **The test suite is meaningful rather than vacuous.** The full bot matches run to completion with accepted actions, and the state tests assert concrete public/private state, scores, turn ownership, open flags, boneyard counts, and serialized snapshots. Green tests here are useful evidence for the engine, not proof of the UI.

### Best next moves

1. Fix the results sound branch and add winner/loser regression coverage.
2. Pass a real flight count to `DealIntro`; couple the host round-start delay to `estimateDealIntroMs` plus a small network/render buffer, then verify at eight seats.
3. Surface `ActionOutcome.reason` to the initiating player instead of dropping rejected actions. Exercise stale target, out-of-turn, illegal draw, and empty-boneyard scenarios.
4. Add a small UI/integration test layer for the table/results wiring, or perform a manual two-browser session covering initial deal, dead draw, double resolution, blocked round, round transition, and match results with one human plus a full bot table.

### Codebase review addendum

- **Systemic risks:** Mexican Train is on the newer host-authoritative engine path, which is healthier than the legacy room actions, but its action protocol still has no client-visible rejection channel. Across PeerJS games, “return unchanged state” is not enough for a playable multiplayer UI; stale clients need an explicit response.
- **Hotspots worth manual inspection:** `App.tsx`'s `mtBroadcast`/`mtDispatch` interaction, the `DealIntro` lifecycle against the fixed `ROUND_PAUSE_MS`, `runMTBotsIfNeeded` during a round transition, and every results screen's winner/loser sound decision.
- **Repeated anti-patterns:** generic results components/effects unconditionally play `game-win`; host code often treats rejected actions as a no-op rather than a user-visible outcome; animation consumers do not consistently use the shared pure duration estimator even when the component documents it.
- **Areas healthier than expected:** the core Mexican Train rules are compact, serializable, and well tested; no hand/boneyard leak was found; doubles, dead draws, open trains, round scoring, match tie-breaking, and bot completion all have concrete coverage. The active-turn rail and select-then-confirm interaction are stronger than the older Dominoes screen in several respects.

#### Test case completeness matrix

| Area | Status |
|---|---|
| 91-tile double-12 set and unique IDs | ✅ covered |
| Seeded deterministic deal and engine removal | ✅ covered |
| 2–8 seat hand sizes/boneyard counts | ✅ covered |
| Empty-lane engine matching and tile orientation | ✅ covered |
| Own/Mexican/open-opponent lane legality | ✅ covered |
| Tile-not-in-hand, illegal lane, out-of-turn rejection | ✅ covered |
| Legal-play-before-draw and empty-boneyard rejection | ✅ covered |
| Playable draw keeps turn; dead draw opens and advances | ✅ covered |
| Doubles, including stuck-after-double draw/pass | ✅ covered |
| Going out on a double | ✅ covered |
| Blocked round pass streaks at 2, 4, and 8 seats | ✅ covered |
| Round redeal, engine sequence, starter rotation | ✅ covered |
| Round scoring, prior-score accumulation, lowest-total tie break | ✅ covered |
| Final round and match-over transition | ✅ covered |
| Public/private snapshot isolation and JSON round trip | ✅ covered |
| Bot lane ranking, draw/pass choice, full match completion | ✅ covered |
| Malformed runtime action payloads from a PeerJS client | ⚠️ untested — type declarations do not test hostile JSON |
| Host rejection reason reaching the initiating UI | ❌ missing — would catch Major #3 |
| `DealIntro` flight count for 2–8 seat deals | ❌ missing — current default causes Major #1 |
| Host hold vs. deal-intro completion on round start | ❌ missing |
| Winner-only results sound | ❌ missing — would catch Major #2 |
| Full existing targeted Vitest command | ✅ 45/45 passed |
| TypeScript build check | ✅ `npx tsc -b --noEmit` passed |

**Coverage limitation:** I cannot run the app in a browser here. Playability findings about deal animation, silent action failures, and results audio are grounded in the rendered code, shared component contract, and host wiring; they still deserve a manual two-browser/full-table session before release.

#### Test command evidence

Targeted Mexican Train command:

```text
RUN  v4.1.10 /opt/data/pips-ai-player/pips


 Test Files  1 passed (1)
      Tests  45 passed (45)
   Start at  20:12:17
   Duration  393ms (transform 156ms, setup 0ms, import 185ms, tests 86ms, environment 0ms)
```

TypeScript:

```text
npx tsc -b --noEmit

(exit code 0; no output)
```
