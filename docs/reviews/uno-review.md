# UNO — AI Grouch (Oscar) Review

**Date:** 2026-08-24  
**Reviewer:** Oscar (ai-grouch), run via Bartowski  
**Scope:** `src/card-games/uno/` (deck, state, rules, bot, and all six UNO test files), `src/screens/UnoTable.tsx`, `UnoRoom.tsx`, `UnoResults.tsx`, `UnoRulesOverlay.tsx`, the UNO wiring and bot scheduler in `src/App.tsx`, the shared `DealIntro`/sound path used by UNO, and the UNO-specific table/card styling.  
**Baseline:** `main` @ `d160de5`, as supplied. The app was not run in a browser.

### Executive verdict

**needs changes** — the UNO engine is substantially better than the UI consistency history in `CLAUDE.md suggests: it now has a real deal intro, sorted hand, select-then-confirm play, active-turn treatment, host-side state transitions, and deliberately slow bot pacing. The rules tests are broad and all 161 pass when the property test is given a realistic timeout. But the requested default test command does not pass because the 50-trial invariant test exceeds Vitest's 5-second per-test timeout, and the host accepts an out-of-domain color from a runtime PeerJS action, allowing a malformed client to poison canonical state. The remaining release risk is concentrated in unobservable rejected actions, misleading loser audio, and an incoming-hand reveal gate that does not distinguish forced draws from 7-0 swaps.

### Blocking issues

#### 1. Runtime `CHOOSE_COLOR` validation is missing at the host authority boundary

- **severity:** blocking
- **evidence:** `src/card-games/uno/rules.ts:478-490` assigns `action.color` directly to `activeColor` and advances the turn; the wild-draw-four path at `:504-506` does the same. `UnoAction`'s TypeScript union (`state.ts:57-64`) constrains compile-time callers, but `src/App.tsx:3578-3586` passes a PeerJS-decoded action from a guest directly into `applyUnoAction`. There is no runtime check that the value is exactly `red`, `yellow`, `green`, or `blue`.
- **why it breaks:** a stale or malicious guest can send `{type: 'CHOOSE_COLOR', color: 'purple'}` after playing a wild. The host then broadcasts `activeColor: 'purple'` as canonical state. No colored card can match that active color; ordinary number/action cards can only proceed through number/type matching, and the table's color semantics are now false until another wild repairs the state. This violates `CLAUDE.md`'s host-authoritative validation requirement: the host owns the truth, so it must validate the wire payload rather than trusting TypeScript types that do not exist at runtime.
- **what would change my mind:** a host-side enum guard rejecting every non-UNO color before state mutation, plus tests that feed malformed runtime actions (`purple`, empty string, `null`, and a missing color) through the same action boundary and verify state and stock are unchanged.

### Major concerns

#### 1. The requested UNO test command fails on the repository's default test timeout

- **severity:** major
- **evidence:** `npx vitest run src/card-games/uno` ran all six files but reported `1 failed | 5 passed`, `160 passed (161)`, with the sole failure being `uno.test.ts > property-based invariants`; Vitest reported `Test timed out in 5000ms`. A supplemental run with `npx vitest run src/card-games/uno --testTimeout=30000` passed `6` files and `161` tests.
- **impact:** the rules are not proven green under the command the task and repository convention require. This is not a rule failure—the longer-timeout run passes—but a test suite that times out at its normal configured limit gives CI/reviewers a red signal and can conceal whether a future failure is a timeout or an invariant break. The property test does 50 trials × up to 300 actions with repeated conservation, serialization, and host-zone checks; its workload is incompatible with the default per-test budget.
- **suggested fix:** either reduce the property workload while retaining meaningful seat-count coverage, or set an explicit timeout on that `it` (and document why). Keep the invariant assertions; do not delete the test merely to make the default command green.

#### 2. Rejected guest and host actions are silently discarded

- **severity:** major
- **evidence:** `src/App.tsx:3583-3586` returns from the host's `onAction` when `applyUnoAction` rejects, and `src/App.tsx:3762-3772` does the same for local host dispatch. `UnoTable` renders `notice`, but no rejection reason is threaded into `setUnoNotice` or any local pending/error mechanism. The engine does produce useful reasons (`card not in hand`, `choose a color first`, `must stack a matching card or draw the pile`, etc.).
- **impact:** a stale guest, a double-click, a race with a bot, or a rejected out-of-turn action looks exactly like a dead button/network stall. The table even presents explicit actions—Play, draw, pass, color, swap, UNO—without telling the player when the host rejected the intent. In multiplayer, this makes the central authoritative architecture hostile to recovery and diagnosis.
- **suggested fix:** return or broadcast a structured rejection targeted to the initiating seat, or at minimum set a transient local notice for host actions and use the existing host-to-guest error/rejection channel for guest actions. Preserve the engine's reason string and add a test for notice propagation, not just engine rejection.

#### 3. Results play the winner sound for the loser

- **severity:** major
- **evidence:** `src/screens/UnoResults.tsx:36-40` calls `play('game-win')` unconditionally on mount. `App.tsx:5543-5557` renders the same `UnoResults` screen to every seat once `stage === 'over'`; the component already computes `isLocalWinner` at `:43`, but the sound effect ignores it.
- **impact:** every player hears a victory cue, including the player whose UI says `${winner} takes it!`. That contradicts the visual result and the shared sound language. `CLAUDE.md` explicitly treats misleading/overlapped sound as a playability defect, not harmless polish.
- **suggested fix:** gate `game-win` on `publicState.matchWinnerId === localPlayerId` and give losers a distinct loss cue or silence. Add a component-level test for winner and loser mounts.

#### 4. The forced-draw reveal gate also hides cards received through 7-0 hand exchange/rotation

- **severity:** major
- **evidence:** `src/screens/UnoTable.tsx:317-348` only adds newly arrived cards to `knownCardIds` for `ownDraw`; otherwise it deliberately leaves new IDs unknown. The renderer at `:776-787` turns every unknown card into a face-down card with a reveal click. The comments describe this as a “Forced-draw reveal gate” and specifically mention cards arriving from another player's draw2/wild4, but the rules can replace a player's hand through `CHOOSE_SWAP_TARGET` (`rules.ts:437-475`) or rotate it on 0 (`:277-307`).
- **impact:** after a legal 7 swap or 0 rotation, the recipient's newly acquired hand appears face-down even though it is now their own hand and was not a forced draw. A player can eventually click Reveal, so this is not state corruption, but it makes the house rule's central interaction look broken and can leave the player unable to make an informed play until they discover the extra reveal step. The state update and the presentation model disagree about what kind of event occurred.
- **suggested fix:** track the action kind/card effect that caused hand growth, or include a private-state reveal policy, and only gate cards newly added by forced draw penalties. Reveal exchanged/rotated cards immediately (or provide a specifically labeled hand-swap reveal animation).

### Minor concerns and nits

- `UnoRulesOverlay.tsx:21` says “Two to ten players,” while `UNO_MAX_SEATS` and `UnoRoom.tsx:183` cap this implementation at six. That is reachable, misleading copy, not a taste issue.
- The rules overlay mentions only the draw-until-playable house rule (`UnoRulesOverlay.tsx:8`) even though the lobby exposes stacking and 7-0. Players can enable mechanics that the in-game rules sheet does not explain.
- `UnoRulesOverlay.tsx:3` says a wild can be played “any time.” That is consistent with this implementation's explicit `isUnoPlayable` policy, but it is a deliberate deviation from the common official Wild Draw Four restriction. If official UNO compatibility is intended, the rule needs to be stated and tested rather than left implicit.
- `UnoTable.tsx:403-407` starts two independent `Audio` instances synchronously for a wild4 (`uno-wild` and `uno-draw`). The shared sound hook does not cancel audio, so I found no evidence of clipping; however, the overlap should be checked manually because the project treats a cut-short or unintelligible cue as a bug.
- `unoBroadcast()` holds bots until `estimateDealIntroMs(seats * 7) + 700` (`App.tsx:3507-3510`), while the actual animation also shows the starter/discard context. The conservative extra hold is safe, but its coupling should remain documented when deal layout changes.
- `UnoTable` keeps an empty `onOpenRules={() => {}}` in `App.tsx:5615`; the visible Rules button is therefore dead in the active table. `UnoRoom` has a working overlay, but after starting the game the player cannot open rules from the table.
- The table does correctly implement select-then-confirm and sorted hand behavior; these are no longer valid criticisms despite the historical `CLAUDE.md` warning.

### What the code gets right

- **The engine has a coherent host-authoritative shape.** Shuffling, dealing, stock recycling, action validation, canonical public state, and private hands stay in the host session; snapshots avoid leaking other hands and stock IDs. The wire-safety tests are meaningful JSON round trips, not just type checks.
- **Deck composition and dealing are well covered.** The 108-card composition, sequential IDs, per-color counts, starter-number invariant, deterministic seeds, seat bounds, and conservation are explicitly tested.
- **Core turn behavior is thoughtfully handled.** Skip, reverse, two-player reverse-as-skip, draw-two, wild, wild-draw-four, draw/pass behavior, stock recycling, blocked rounds, going out, scoring, match threshold, and starter rotation all have direct tests. Going out correctly suppresses the action card's pending effect.
- **House rules are not bolted on carelessly.** Draw-until-playable, draw stacking, 7 swap, 0 rotation, stack-family separation, and pending-state lifecycle have dedicated suites. The bot has a regression test for the subtle `pendingWild + pendingStack` combination.
- **UNO-call behavior is unusually well tested.** The suite covers self-call, catches by non-current players, target penalties, stale-window destruction, window reopening, stock failure, round boundaries, and wire safety. The remaining concern is presentation/rejection feedback, not the tested engine mechanics.
- **The historical playability gaps are mostly fixed.** `UnoTable` uses `DealIntro` with the real flight count, `sortUnoHand`, select-then-confirm (`selectedId` plus Play), active scoreboard/opponent highlighting, registry sound names, and an explicit 1600ms per-action bot delay. The host also holds bot activity through the deal animation estimate plus a 700ms buffer. Against the full six-seat case, this is materially more human-paced than a bare shared 900ms loop.
- **The bot is deterministic and re-evaluates multi-step turns.** The actor key includes same-turn state such as `hasDrawnThisTurn`, pending wild/swap, stock count, and discard length, and the scheduler checks staleness before each action. That is the right shape for draw-then-play and wild color-choice sequences.

### Best next moves

1. Validate `CHOOSE_COLOR` at runtime in the rules boundary; add malformed-wire tests and verify rejected actions do not mutate or broadcast state.
2. Make rejected actions observable to their initiator, and wire the active table's Rules button instead of passing `() => {}`.
3. Fix winner-only result audio and add winner/loser component tests.
4. Separate forced-draw reveal state from 7-0 swap/rotation state, then manually exercise 7 and 0 with a human client.
5. Make the default `npx vitest run src/card-games/uno` command green by reducing or explicitly timing the property test; retain the supplemental 161/161 result as evidence that the current failure is timeout-only.
6. Run one manual six-seat session with several bots: initial deal, consecutive bot turns, wild4, stacking, a 7 swap, a 0 rotation, a forced draw, UNO catch, round transition, and winner/loser results audio.

### Codebase review addendum

- **systemic risks:** The strongest systemic issue visible here is the gap between TypeScript action unions and runtime PeerJS messages. Most UNO payloads are checked by membership or card lookup, but enum-valued fields such as `CHOOSE_COLOR.color` are trusted. The second systemic issue is that `applyAction` communicates rejection as a no-op and the caller drops the reason; this makes authoritative multiplayer failures indistinguishable from UI/network failures.
- **hotspots worth manual inspection:** `src/App.tsx`'s per-game action handlers and all enum-bearing card-game actions; `src/screens/UnoTable.tsx`'s state-diff/reveal/sound effects; `src/screens/*Results.tsx` for winner-only audio; and the interaction between `DealIntro` duration estimates and each game's host bot scheduler.
- **repeated anti-patterns:** silent `if (!outcome.ok) return` dispatch paths, generic results audio not gated by local winner identity, and test workloads that are valid but exceed the runner's default timeout. UNO's table itself is healthier than the historical warning suggests: it does not repeat the old unsorted-hand or instant-play mistakes.
- **areas healthier than expected:** The engine is compact and plain-data based, action effects are split into explicit branches rather than hidden behind an over-generic card abstraction, and the tests include long conservation/wire-safety runs plus dedicated edge-case suites. Bot timing is especially deliberate: the code comments and the actual 1600ms schedule address full-table consecutive actions rather than claiming one-bot comfort is enough.

#### Test case completeness matrix

| Area | Status |
|---|---|
| 108-card composition, IDs, counts, ordering | ✅ covered |
| Deal sizes 2–6 seats, starter number, deterministic seed | ✅ covered |
| Card matching by color/number/action kind/wild | ✅ covered |
| Runtime validation of `CHOOSE_COLOR` enum | ❌ missing — would catch Blocking #1 |
| Out-of-turn, missing-card, illegal-play rejection | ✅ engine-covered; ⚠️ UI reason propagation missing |
| Skip/reverse/two-player reverse | ✅ covered |
| Draw Two / Wild Draw Four immediate effects | ✅ covered |
| Wild pending color choice and actor authorization | ✅ normal-path covered; ❌ malformed runtime enum |
| Standard draw, playable draw, pass, auto-advance | ✅ covered |
| Draw-until-playable and exhaustion/blocking | ✅ covered |
| Stock recycling mid-draw | ✅ covered |
| Draw stacking, family separation, stack break | ✅ covered |
| 7 swap and 0 rotation, including direction/2-player cases | ✅ engine-covered |
| Forced-draw reveal behavior | ⚠️ no component test; swap/rotation interaction untested |
| UNO-call open/close/self/catch/penalty/stock failure | ✅ covered |
| Going out, points, 500 threshold, next-round starter | ✅ covered |
| Host/guest action rejection feedback | ❌ missing — would catch Major #2 |
| Sorted hand / select-then-confirm / active turn rendering | ⚠️ sort helper covered; no full table interaction test |
| Deal intro flight count and bot hold | ⚠️ code path inspected; no timing/integration test |
| Bot strategy and long full-match completion | ✅ covered |
| Full six-seat consecutive bot pacing | ❌ no timing test |
| Winner-only results sound | ❌ missing — would catch Major #3 |
| Rules copy for six seats and all enabled house rules | ❌ missing |
| Requested targeted UNO command | ❌ 160/161 passed; one property test timed out at 5s |
| Supplemental UNO command (`--testTimeout=30000`) | ✅ 161/161 passed across 6 files |
| TypeScript build check | ✅ `npx tsc -b --noEmit` passed |

**Coverage limitation:** I cannot run the app in a browser in this review. Playability findings about dead Rules, silent rejection, reveal behavior, animation/sound sequencing, and winner/loser audio are grounded in the rendered code and shared components; they still deserve a manual six-seat two-client session before release.

#### Test command evidence

Requested targeted command (actual output; exit code 1):

```text
RUN  v4.1.10 /opt/data/pips-ai-player/pips

 ❯ src/card-games/uno/uno.test.ts (63 tests | 1 failed) 5925ms
     × stock, conservation, handCounts and wire-safety invariants hold across long random legal sequences 5455ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/card-games/uno/uno.test.ts > property-based invariants > stock, conservation, handCounts and wire-safety invariants hold across long random legal sequences
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ src/card-games/uno/uno.test.ts:919:3
    917|
    918| describe('property-based invariants', () => {
    919|   it('stock, conservation, handCounts and wire-safety invariants hold …
       |   ^
    920|     for (let trial = 0; trial < 50; trial++) {
    921|       const n = 2 + (trial % 5)   // cycles 2..6 so every seat count g…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 5 passed (6)
      Tests  1 failed (160 passed) | 160 passed (161)
   Start at  20:07:10
   Duration  13.27s (transform 2.24s, setup 0ms, import 2.91s, tests 6.25s, environment 0ms)
```

Supplemental diagnostic command:

```text
npx vitest run src/card-games/uno --testTimeout=30000

RUN  v4.1.10 /opt/data/pips-ai-player/pips


 Test Files  6 passed (6)
      Tests  161 passed (161)
   Start at  20:08:22
   Duration  2.70s (transform 332ms, setup 0ms, import 490ms, tests 1.34s, environment 0ms)
```

TypeScript command (actual output; exit code 0):

```text
npx tsc -b --noEmit

(exit code 0; no output)
```
