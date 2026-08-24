# Wahoo — AI Grouch (Oscar) Review

**Date:** 2026-08-24  
**Reviewer:** Oscar (ai-grouch), run via Bartowski  
**Scope:** `src/board-games/wahoo/` (state, rules, board, bot, all three tests) + `src/screens/Wahoo*.tsx`/CSS + Wahoo host/guest wiring in `src/App.tsx`, reviewed against `CLAUDE.md`.  
**Baseline:** `main` @ `d160de5`.

### Resolution (2026-08-24)

All Blocking, Major, and Minor findings below are fixed on `fix/review-tier1-rummy-wahoo-ttt` (commit `7b1c24b`) and independently verified (`tsc -b --noEmit` clean, `npm run build` clean, full suite green). Two items are **open, pending product judgment, not bugs**:

- **Bot "rush home" threshold:** the review's completeness-matrix note about `bot.ts`'s `>=52` threshold turned out to be two separate things. The part that was a straight correctness bug (the bot's own win-check using `>=52` instead of the engine's real win threshold `LANE_START=63`) is fixed. The part that remains is a genuine strategy question: `bot.ts` also uses `>=52` as a "how eagerly should the bot prioritize rushing a marble home vs. improving board position" cutoff. Changing that to 63 would materially change bot play at track positions 52–62. Left as-is pending a decision on intended bot behavior.
- **`wahooActorKey` fragility (Minor):** `${stage}:${turn.turnNumber}` doesn't retrigger the bot loop for a same-turn state change that doesn't bump `turnNumber` (e.g. a plain ROLL). Not a live bug today — only a risk for future same-turn actions. A real fix needs a shared actor-generation concept in `src/engine/turn-engine.ts`, which is cross-game architecture, not a Wahoo-scoped fix. Documented in code; deferred.

Do not remove this file until both items are resolved one way or the other.

### Executive verdict

**needs changes** — the ordinary race rules are unusually well covered and mostly coherent, but there is one confirmed rule-state corruption bug, one unvalidated network payload that can throw out of the host action path, and a bot cadence that demonstrably cuts off this game's own sounds. The table is thoughtfully designed: die-before-move broadcasting, destination collision handling, active-turn highlighting, and host-side validation are all real positives. They do not rescue the release from a stale `lastMoved` invariant, malformed-action robustness, silent rejection feedback, and a results screen that reports track marbles as “home.”

### Blocking issues

#### 1. Triple-six bust can send home a marble that was not moved in the current chain

- **severity:** blocking
- **evidence:** `src/board-games/wahoo/rules.ts:159-170` sets `lastMoved` after every move, but the non-six move path at `:188-196` advances the turn without clearing it. The triple-six branch at `:95-101` trusts any `lastMoved` belonging to the current player, even when it came from that player's previous turn.
- **why it breaks:** I live-reproduced this with the real engine: p1 moves a marble, p2 makes a non-six no-move pass, then p1 is put in a no-legal-move position and rolls three sixes. The third roll sends p1's current marble at position 62 to base even though p1 has not moved a marble in this six chain. The returned state was `p1: [-1, 63, 64, 65]`, `lastEvent: { kind: 'bust', by: 'p1', die: 6 }`. This violates the stated rule (“the marble you just moved”) and can undo progress from an earlier ordinary turn. The same stale reference can incorrectly clear `centerBy`.
- **what would change my mind:** a regression test that performs an accepted move, a turn handoff caused by a non-six pass, then three moveless sixes for the same player and proves no old marble is sent home; or code that explicitly clears `lastMoved` whenever a turn/chain ends and only records it for the active six chain.

#### 2. Malformed `MOVE` payloads are not rejected safely at the host boundary

- **severity:** blocking
- **evidence:** `rules.ts:152-157` dereferences `action.move.marbleIdx` and `action.move.kind` before it has established that `action.move` is an object. `App.tsx:2624-2632` invokes `applyWahooAction` directly from a PeerJS action callback with no exception boundary. The TypeScript union is not validation for JSON arriving over the network.
- **why it breaks:** a stale, buggy, or manually crafted guest can send `{ type: 'MOVE' }` or `{ type: 'MOVE', move: null }`. The validator throws `TypeError` instead of returning `{ ok: false }`; the host callback does not catch it, so one malformed remote action can escape the authoritative action path rather than being rejected and ignored. `oscar.test.ts` does probe an unknown `kind`, but not a missing/null move object.
- **what would change my mind:** an explicit runtime guard before dereference, tests for missing/null/non-object `move`, and a host-boundary test proving malformed guest input cannot throw or mutate/broadcast state.

### Major concerns

#### 1. Bot pacing cuts off Wahoo's own sound effects, especially at a full table

- **severity:** major
- **evidence:** `App.tsx:2699-2714` waits only `BASE_MS` (900ms) before every bot action. `WahooTable.tsx:257-290` plays `dice-roll`, `piece-drop`, or `farkle-bust` as soon as the broadcast arrives. Measured asset durations are `dice-roll` 1.392s, `piece-drop` 1.032s, and `farkle-bust` 2.904s. The extra `PASS_ANIMATION_BUFFER_MS` is only 450ms and is applied after pass/bust, so even a bust gets only 1.35s before the next loop action; ordinary movement starts before `piece-drop` has finished.
- **impact:** the host can commit a bot's next roll/move while the previous sound and visible die/marble feedback are still playing. With 2–3 bots, consecutive actions fill the human's interval with exactly the rapid-fire sequence `CLAUDE.md` says to prevent; with a full four-seat table the human's turn is buried under the same 900ms rhythm. This is a playability defect, not polish.
- **suggested fix:** use a Wahoo-specific action cadence based on measured animation/sound duration, and give busts their own hold long enough for the 2.904s cue. If the client-side die flicker is authoritative to pacing, expose a duration estimator and hold the host against it rather than adding a guessed fixed buffer.

#### 2. Invalid actions fail silently for the local player and guests

- **severity:** major
- **evidence:** both `App.tsx:2629-2631` and `:2773-2782` discard `result.outcome.reason` on rejection. `WahooTable` renders `notice`, but the Wahoo dispatch path never populates it for `not your turn`, `roll first`, `not a legal move`, or stale clicks. The guest path merely sends the action and waits.
- **impact:** a race between a guest click and a newer host state, or a stale target after a reconnect, looks like a dead button. A player receives no explanation that the die was already consumed, the move is no longer legal, or it is not their turn. This is especially damaging in a game whose target rings and roll/move phases make the user expect an explicit action result.
- **suggested fix:** return a structured rejection to the initiating client or thread a transient local notice through the existing banner; at minimum show the validator reason for host-local rejections and a host response for guest rejections.

#### 3. Results miscount track marbles as “home” and rank on that wrong count

- **severity:** major
- **evidence:** the engine defines `LANE_START = 63` in `board.ts:25`; actual win checks use `p >= LANE_START` in `rules.ts:175`. `WahooResults.tsx:60-63` instead counts `p >= 52` as home and sorts rows by it.
- **impact:** a marble still on the shared track at relative positions 52–62 is displayed as home. A player can therefore show 4 home marbles and rank above another player despite not having four lane marbles; the copy “home” contradicts the rules overlay and the engine's win invariant. The error is reachable on every normal match that ends with opponents spread around the final track segment.
- **suggested fix:** use `p >= LANE_START` for the home count, and add a component/derived-ranking regression fixture containing positions 52, 62, 63, and 66.

#### 4. Winner sound is played for both winner and loser

- **severity:** major
- **evidence:** `WahooResults.tsx:35-39` unconditionally runs `play('game-win')` on mount. `App.tsx:5213-5224` renders the same results component for every player; only the headline distinguishes winner from loser.
- **impact:** the losing player hears a cue that says they won. This contradicts the visible “X takes it!” result and violates the app's sound-feedback contract. It is a concrete semantic bug, not a taste complaint.
- **suggested fix:** gate `game-win` on `winnerId === localPlayerId`; give the loser an appropriate loss cue or silence, and test both mounts.

### Minor concerns and nits

- `wahooActorKey` is only `${stage}:${turn.turnNumber}`. That is sufficient for the current ROLL→MOVE chain, but it is a fragile contract: any future accepted same-turn bookkeeping action would not retrigger the bot loop. The neighboring games document and key same-turn state changes more explicitly.
- `WahooTable` accepts `onOpenRules` but ignores it (`:196-197`) and owns a second rules-open state. This is dead wiring, not a functional blocker.
- The screen's geometry comments still describe positions as `0..57` and `58..61` (`WahooTable.tsx:88-90`) while the engine uses track `0..62` and lane `63..66`. The rendering branch itself uses the correct constants, but the stale comment is an avoidable maintenance trap.
- `createWahooGame` has no engine-level guard for player counts outside 2–4. The current room prevents this, so this is an API robustness gap rather than a confirmed UI path failure.
- There is no DealIntro, which is defensible for a board race rather than a card deal. The screen does use the relevant board-game conventions: turn chips, sound registry, and a visible die/target interaction.
- The rules overlay is concise and broadly matches the implemented rules, including the unusual center shortcut and triple-six behavior. It does not explain that a three-player game randomly mutes one arm, which may confuse players seeing grey board areas.

### What the code gets right

- **The host is authoritative on the happy path.** The host owns the RNG, validates both ROLL and MOVE, derives the broadcast snapshot, and guests only submit intents. Accepted state is plain serializable data; the serialization tests are meaningful rather than decorative.
- **Movement geometry is strong.** `board.ts` generates all quadrants from one rotated topology; tests verify 64 unique track holes, unit-step travel order, shared corners, entries, entrances, homes, bases, and bounds.
- **The legal-move generator is the right central abstraction.** Both validator and bot consume `legalMoves`, so the bot is not maintaining a second movement rulebook. It covers exact counts, overshoot, own-marble blocking/jumping, protected opponent starts, center occupancy, shortcut entry, center exit, and lane behavior.
- **Captures are handled in absolute board coordinates.** `trackIndexFor` is used consistently for cross-seat collisions, including wrap-around and shortcut exits. The tests explicitly probe seam collisions and correctly keep lane marbles immune to track captures.
- **The UI fixed a nontrivial interaction ambiguity.** `oscar.test.ts` is not a superficial pass: its destination-collision probes identify that two legal moves can share a physical hole, and `WahooTable` responds with contested-target plus marble-first selection rather than silently dropping one move.
- **Triple-six and win ordering are mostly explicit.** The code handles a third six on ROLL, preserves the same player's extra roll for a six with no legal move, clears the chain on bust, and checks win before a would-be bust on the preceding MOVE. The missing current-chain reset is the specific hole; the surrounding state machine is understandable.
- **Turn highlighting and sound registry usage match the repository better than several older games.** Active seat chips are visible, turn-start sound is gated for a multi-human table, and board feedback uses registered sounds. The failure is sequencing and winner/loser gating, not an ad hoc sound implementation.

### Best next moves

1. Fix the `lastMoved` lifetime: make it current-chain state, clear it when a non-six ends the turn and on any other chain-ending transition, then add the reproduced stale-reference regression.
2. Add runtime action-shape validation before dereferencing `MOVE`, plus host-boundary tests for malformed JSON-like payloads.
3. Replace the 900ms Wahoo bot beat with measured holds for die flicker and each sound; specifically hold through the full bust cue and ordinary piece-drop cue at a maxed-out bot table.
4. Surface rejection reasons to the local/remote initiator, and fix results home counting and winner-only audio.
5. Add rendering/wiring tests or one manual two-browser session covering a full four-seat table, human-vs-bots, stale clicks, a capture, shortcut entry/exit, triple-six after a prior turn, win/results, and rematch.

### Codebase review addendum

- **systemic risks:** The Wahoo module has a better pure-engine boundary than the legacy games, but its PeerJS action boundary still treats TypeScript types as if they were runtime validation. The repeated `if (!result.outcome.ok) return` pattern in `App.tsx` makes invalid actions indistinguishable from lost input across several newer games; Wahoo exposes the UX cost clearly.
- **hotspots worth manual inspection:** Wahoo's host bot scheduler and all sound/animation durations; `lastMoved`/`centerBy` chain lifetime; results ranking/audio; and the shared PeerJS callback boundary for malformed payload handling.
- **repeated anti-patterns:** guessed shared pacing (`BASE_MS`) despite per-asset sound lengths, discarded validator reasons, and generic result sounds applied without checking local winner state.
- **areas healthier than expected:** board generation, absolute collision logic, lane/no-pass enforcement, host-owned RNG, deterministic bot termination, and the adversarial `oscar.test.ts` probes. The Oscar file is substantive regression coverage; it is not a superficial “it passes” test despite its filename.

#### Test case completeness matrix

| Area | Status |
|---|---|
| Board topology, rotation, bounds, unique holes | ✅ covered |
| 2/3/4-seat arm assignment and deterministic seeding | ✅ covered |
| Turn/phase/over gating | ✅ covered |
| ROLL RNG, die state, pass, extra six roll | ✅ covered |
| Triple-six bust with current-chain move | ✅ covered |
| Triple-six bust after stale prior-turn `lastMoved` | ❌ missing — **would catch Blocking #1** |
| Base exit on 1/6 and capture | ✅ covered |
| Exact track movement and absolute cross-seat capture | ✅ covered |
| Protected opponent start spaces | ✅ covered |
| Own-marble blocking, lane no-pass, overshoot | ✅ covered |
| Shortcut entry, center capture, exit and exit capture | ✅ covered |
| Center/bust interaction | ✅ covered for same-turn and unrelated center cases |
| Win condition and win-before-bust ordering | ✅ covered |
| Bot full games for 2/3/4 seats | ✅ covered |
| Bot strategic choice thresholds (`>=52` vs lane start 63) | ⚠️ untested; behavior is misleading and under-specified |
| Malformed MOVE object / missing or null payload | ❌ missing — **would catch Blocking #2** |
| Host/guest rejection feedback | ❌ missing — would catch Major #2 |
| Bot pacing, animation sequencing, sound completion | ❌ missing — would catch Major #1 |
| Wahoo table target-collision ambiguity | ✅ engine/UI geometry probe in `oscar.test.ts`; no component test |
| Results home ranking boundary | ❌ missing — would catch Major #3 |
| Winner-only results sound | ❌ missing — would catch Major #4 |
| Rematch and reconnect/replace-with-bot flow | ❌ untested |
| JSON serialization across event kinds | ✅ covered, including Oscar adversarial scenarios |
| Targeted Wahoo Vitest suite | ✅ 75/75 passed across 3 files |
| TypeScript build check | ✅ clean |

**Coverage limitation:** I cannot run the app in a browser in this review environment. The playability findings are grounded in the rendered code, sibling conventions, measured sound assets, and host scheduler; they still deserve a manual two-browser/full-table session before release.

#### Test command evidence

Targeted Wahoo tests:

```text
RUN  v4.1.10 /opt/data/pips-ai-player/pips


 Test Files  3 passed (3)
      Tests  75 passed (75)
   Start at  20:12:20
   Duration  1.02s (transform 295ms, setup 0ms, import 383ms, tests 200ms, environment 0ms)
```

TypeScript:

```text
npx tsc -b --noEmit

(exit code 0; no output)
```
