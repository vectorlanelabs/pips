# Phase 10 — AI Grouch (Oscar) Review

**Date:** 2026-08-24  
**Reviewer:** Oscar (ai-grouch), run via Bartowski  
**Scope:** `src/card-games/phase10/` (state, rules, phases, classify, deck, scoring, bot, and all six test files), `src/screens/Phase10Table.tsx`, `Phase10Table.css`, `Phase10Room.tsx`, `Phase10Results.tsx`, `Phase10RulesOverlay.tsx`, Phase 10 wiring and host bot/round scheduling in `src/App.tsx`, plus sibling conventions in `RummyTable.tsx`, `RummyResults.tsx`, `DealIntro.tsx`, and `useSound.ts`.

**Baseline:** `main` @ `d160de5`. The targeted Phase 10 suite and TypeScript check were run against this checkout. I did not modify, stage, or commit any source file.

---

### Executive verdict

**needs changes** — the rules engine is unusually deliberate and conserves cards correctly across the tested paths, but the shipped game violates the repository's highest-priority playability contract: host bot actions begin before the visible `DealIntro` can finish. That is a real state/animation race, not a cosmetic disagreement. The UI also contradicts its own Skip-card rule, plays the winner sound for the losing client, and exposes at least one clickable action that the validator will reject without explaining why. The six-file engine suite is green, but its coverage is concentrated in happy paths and does not exercise the screen/wiring failures or several phase/rule boundaries.

### Blocking issues

#### 1. Bots mutate the game while the deal animation is still running

- **severity:** blocking
- **evidence:** `src/screens/Phase10Table.tsx:390-403` mounts `DealIntro` for each `roundNumber`; the shared `DealIntro` sequence takes roughly 2 seconds with its default ten flights (`DealIntro.tsx:60-78`, `130ms` flight cadence, `260ms` flight duration, plus shuffle/start delays). `src/App.tsx:4593-4598` triggers `runPhase10BotsIfNeeded()` as soon as the host has a game view, and `runPhase10Bot()` waits only `BASE_MS = 900` (`App.tsx:180`, `2095-2108`) before applying and broadcasting the bot action. Phase 10 does not use `estimateDealIntroMs` or any equivalent host hold.
- **why it breaks:** after a new round is dealt, the human sees the table-opening shuffle/deal, but the host can already consume a bot's draw and discard at 900ms. With a full six-seat table, the same scheduling path then emits consecutive bot updates every 900ms while clients are still watching the deal. The visible animation no longer represents the state that the host is advancing; a player can finish watching a deal and find that the stock, discard, turn, and possibly several bot actions have already changed. This directly violates `CLAUDE.md`: state-changing animations are real events, and bot/host logic must never race ahead of them. The same race occurs after every automatic `START_NEXT_ROUND` transition.
- **what would change my mind:** a host-side hold based on the actual deal duration (for example, `estimateDealIntroMs` with the real flight count), or an equivalent pure timing contract, plus a full six-seat trace showing that no bot state update is broadcast before every client has had time to finish the intro. A browser run is still needed to validate the final feel, but the race is already established by the code's timers.

### Major concerns

#### 1. Repeated Skip cards violate the game's stated rule

- **severity:** major
- **evidence:** `Phase10RulesOverlay.tsx:10` says a discarded Skip skips the opponent's next turn “once per player per round.” `rules.ts:349-358` has no per-round Skip-target tracking: every discarded Skip calls `skipNext`. The existing integration tests explicitly codify the contradiction: `phase10.test.ts:714-740` expects a second Skip in the same round to skip again.
- **impact:** in a three-to-six-player game, a player can be skipped repeatedly despite the rules shown to users. In two-player games, the same player can be denied every intervening turn by repeatedly discarding Skips. The UI and engine are not describing different variants; the rules overlay presents a restriction that the authoritative host does not enforce.
- **suggested fix:** choose one rule and make every layer agree. For the displayed rule, add round-scoped tracking of which target/player has already been skipped, reject a repeat with a surfaced reason, reset it in `START_NEXT_ROUND`, and replace the regression tests that currently assert the illegal second skip.

#### 2. Results plays `game-win` for the loser as well as the winner

- **severity:** major
- **evidence:** `src/screens/Phase10Results.tsx:36-44` computes `isLocalWinner`, but `useEffect(() => { play('game-win') }, [])` plays the registered winner cue unconditionally on every client. The visual headline correctly says `You win!` or `<name> wins!`.
- **impact:** when the match ends, the losing player hears an audio cue that says they won. This contradicts the screen's own text and the established sound semantics; sound is table feedback, not decoration. The same generic behavior exists in sibling result screens, but that is not a defense for reproducing it in a new game.
- **suggested fix:** gate `game-win` on `publicState.matchWinnerId === localPlayerId`; use a loser-appropriate cue or silence otherwise. Add a component-level regression test for both local-winner and local-loser mounts.

#### 3. The stock card is clickable in a reachable state where the host rejects it, with no explanation

- **severity:** major
- **evidence:** `Phase10Table.tsx:498-506` defines `canDrawStock` as any active draw phase, including `stockCount === 0` and a one-card discard pile. `rules.ts:185-200` rejects that exact state when the lone discard is a non-Skip, returning `stock is empty — draw from the discard pile instead`. `App.tsx:2168-2178` drops failed host actions, and `App.tsx:2041-2049` does the same for guest actions; no `phase10Notice` is set from the rejection reason.
- **impact:** the stock back looks actionable, the player clicks it, and nothing visibly happens. The actual legal action is the discard card beside it, but the UI does not disable the stock or show the validator's instruction. This is a dead/failed interaction in the exact edge case the engine deliberately handles.
- **suggested fix:** match the engine's exceptional state in `canDrawStock` (disable stock when empty and the lone discard is a drawable non-Skip), or surface rejected action reasons through the existing notice/error banner. Do both if stale network actions must remain debuggable.

#### 4. Important phase and wildcard boundaries are not tested at the integration boundary

- **severity:** major
- **evidence:** `phases.test.ts` asserts only selected phase definitions (1, 4, 6, 8, 10); `classify.test.ts` has representative classification for phases 1, 4, and 8; `phase10.test.ts` exercises Phase 9 and Phase 10 completion and several generic Phase 1 paths, but there is no direct valid/invalid fixture for Phase 2, 3, 5, 6, or 7 through `applyPhase10Action`. There is also no end-to-end test of a Wild completing each relevant group type, no test of the displayed Skip restriction, and no test of the screen's exact disabled-action behavior.
- **impact:** the suite can stay green while a phase requirement is mistyped, a phase-specific partition is rejected, or a Wild edge case is broken. The implementation is readable and much of it is correct by inspection, but these are the core rules players are buying the game for; the current tests do not prove all ten phases.
- **suggested fix:** add table-driven fixtures for all ten phases, with valid minimum selections, invalid near-misses, Wild substitutions, and a full host action through lay/going-out/phase advancement. Add at least one test for each phase that differs structurally from its neighbors, not just another Phase 1 partition.

### Minor concerns and nits

- `Phase10Table.tsx:367` accepts `onOpenRules` and immediately discards it (`void onOpenRules`), while the table owns its own rules state. This is inherited from the sibling pattern and not a user-facing defect, but it is needless API ambiguity.
- `Phase10Table.tsx:249-252` makes a hittable group a `role="button"` with `tabIndex`, but `GroupCluster` has no keyboard handler. Keyboard users can focus a group that appears actionable and cannot activate it with Enter/Space.
- The group CSS comment at `Phase10Table.css:485-492` says “single selected card,” while the implementation and engine support multi-card hits. The comment is stale and can mislead future changes.
- `Phase10RulesOverlay.tsx:26` says “Two players” even though the room and engine support two to six seats. The adjacent bullet and `Phase10Room` correctly advertise six seats, so this is misleading copy rather than a rules-engine defect.
- `Phase10Results.tsx:37` fires the result sound from a mount-only effect without including `play` in the dependency list. This matches the sibling results implementation and is not a confirmed runtime bug here; it remains a lifecycle smell.
- The hand sorting and DealIntro conventions are otherwise present. No criticism is warranted for the absence of sorting or a deal intro: Phase 10 does sort (`color`/`order`) and does use `DealIntro`, matching the closest sibling Rummy.
- I measured the registered card sounds: `card-play.mp3` is `0.336s`, `card-draw.mp3` is `0.624s`, and `shuffle.mp3` is `0.648s`. The 900ms bot beat is long enough for those individual clips, so I found no separate confirmed sound-cutoff defect; the confirmed audio problem is the semantic winner cue above.

### What the code gets right

- **The 108-card deck is correct.** `deck.ts` creates 96 numbered cards, 4 Skips, and 8 Wilds with unique IDs, and the deck tests verify the distribution, metadata, suits, and ranks.
- **The phase list is mostly careful and explicit.** All ten requirements are present, Phase 10 is correctly `1 set of 5 + 1 set of 3`, and phase advancement is capped at Phase 10 rather than inventing Phase 11.
- **Meld validation is stronger than the test count initially suggests.** `classify.ts` rejects duplicate run ranks, rejects Skip cards, handles Wilds in gaps and at run ends, enforces the 1–12 ceiling, rejects all-Wild sets/color groups, and searches both partitions for two-part phases instead of assuming the first split works.
- **The host-side action boundary is the right architecture.** `applyPhase10Action` owns authorization, turn/phase checks, card ownership, phase validity, hit validity, discard behavior, stock recycling, scoring, and canonical public/private state. PeerJS views send only plain serializable snapshots and intents.
- **Card conservation is tested repeatedly.** Integration and bot tests count all cards across stock, discard, private hands, groups, and hits; the six-player deal and multi-player score paths are covered. The tests also verify hidden-hand snapshots do not leak the other player's cards.
- **Going out, scoring, phase progression, and simultaneous Phase 10 completion are handled coherently.** `finishRoundByGoingOut` scores every non-going-out seat's own hand, advances only players who laid, and chooses among simultaneous Phase 10 completers by post-round score with a stable seat-order tiebreak.
- **The bot strategy is not a token stub.** It avoids drawing a Skip from discard, handles stock recycling and the one-card discard edge, searches subsets for phase completion, hits against the full accumulated group, respects locked Wild gaps, and has stale-state checks in the host loop.
- **Play interaction mostly matches the sibling card-game contract.** Phase 10 has select-then-confirm card play, sorted hand views, turn-highlighted opponent tiles, sound-registry usage, `DealIntro`, rules overlay, and the same hand-privacy footnote as Rummy. The active opponent tile treatment is especially clear.
- **The requested automated checks pass.** All six Phase 10 test files passed, for 125/125 tests, and `npx tsc -b --noEmit` exited cleanly.

### Best next moves

1. **Fix the animation race first.** Hold host bot activity until a pure DealIntro duration estimate has elapsed for the actual seat count and flight count; re-check both initial deal and automatic next-round deal at six seats.
2. **Make Skip semantics internally consistent.** Implement the stated once-per-player-per-round restriction, or rewrite the overlay/copy and tests to document a deliberate variant. Do not leave the current contradiction.
3. **Make rejected actions observable.** Disable the stock in the lone-discard edge and thread `ActionOutcome.reason` into the existing notice banner for stale/remote failures.
4. **Correct winner-only results audio and add a focused component regression test.** The loser must not hear `game-win`.
5. **Expand engine tests by phase and rule boundary.** Add valid/invalid fixtures for all ten phases, Wild run locking, repeated Skip policy, stock/discard edge states, and six-seat transitions.
6. **Do one manual browser pass after the fixes:** six seats (one human plus five bots), initial deal, several consecutive bot actions, a Skip attempt, stock recycling, blocked-round behavior, a human/guest match finish, and winner/loser audio.

### Codebase review addendum

- **systemic risks:** Phase 10 inherits the app-wide pattern of silently returning from rejected host actions (`App.tsx:2047`, `2173`) rather than carrying an action outcome to the initiating UI. That is tolerable only while controls perfectly predict engine legality; stale PeerJS clients and edge-state clicks make that assumption false. The other systemic risk is shared `BASE_MS` pacing: the constant is suitable as a generic delay only after each game's visible animation contract has been checked, and Phase 10 currently has not done that.
- **hotspots worth manual inspection:** `App.tsx:1975-2127` for host broadcast/bot scheduling, `App.tsx:4591-4614` for round transition ordering, `rules.ts:339-363` for Skip state and turn advancement, `Phase10Table.tsx:498-513` for draw affordance gating, and `Phase10Results.tsx:35-44` for winner/loser feedback.
- **repeated anti-patterns:** winner audio is unconditionally played in sibling results screens; rejected actions commonly become no-ops; and shared pacing is applied per game without a game-specific animation/sound budget. These are systemic concerns, but the Phase 10 deal race is confirmed here because the code visibly mounts the intro and starts the bot on independent timers.
- **areas healthier than expected:** the Phase 10 engine is plain-data and layered correctly; no React import leaks into the card-game rules; private hands remain private in snapshots; N-player scoring and starter rotation are explicitly handled; and the bot tests include real edge cases rather than only checking that a function returns an object.

#### Test case completeness matrix

| Area | Status |
|---|---|
| 108-card deck composition and unique IDs | ✅ covered |
| Initial 2-player deal and 6-player deal | ✅ covered |
| Hidden-hand snapshot/privacy | ✅ covered |
| Draw from stock and draw from discard top | ✅ covered |
| Skip cannot be drawn from discard | ✅ covered |
| Empty-stock recycle keeping discard top | ✅ covered |
| Empty stock + empty discard blocked round | ✅ covered |
| Empty stock + lone Skip blocked round | ✅ covered |
| Empty stock + lone non-Skip discard UI/host behavior | ⚠️ engine rejection covered; UI affordance and notice missing |
| All ten phase definitions | ⚠️ only selected definitions asserted |
| Valid/invalid Phase 1 classification | ✅ covered |
| Valid/invalid Phase 2 | ❌ missing direct fixture |
| Valid/invalid Phase 3 | ❌ missing direct fixture |
| Valid/invalid Phase 4 | ✅ representative coverage |
| Valid/invalid Phase 5 | ❌ missing direct fixture |
| Valid/invalid Phase 6 | ⚠️ definition checked; no action/classification fixture |
| Valid/invalid Phase 7 | ❌ missing direct fixture |
| Valid/invalid Phase 8 color group | ✅ representative coverage |
| Valid/invalid Phase 9 | ✅ integration happy path |
| Valid/invalid Phase 10 | ✅ integration happy path |
| Wilds in sets, runs, and color groups across all phases | ⚠️ partial |
| Wild lock / no natural eviction in runs | ✅ covered |
| Skip exclusion from phases and hits | ✅ covered |
| Skip once-per-player-per-round rule | ❌ missing and current test asserts the contradictory behavior |
| Lay phase authorization, exact count, and duplicate IDs | ✅ mostly covered |
| Hit authorization, full accumulated group, and multi-card hit | ✅ covered |
| Going out via lay, hit, and discard | ✅ covered |
| Own-hand scoring for 3–6 players | ✅ covered |
| Phase advancement and starter rotation | ✅ covered |
| Simultaneous Phase 10 completers/tiebreak | ✅ covered |
| Host/guest serialization and per-guest private snapshots | ⚠️ snapshot privacy covered; live PeerJS flow untested |
| Bot action validity and stock edge cases | ✅ covered |
| Bot pacing against DealIntro and full six-seat table | ❌ missing — would catch Blocking #1 |
| Results winner-only sound | ❌ missing — would catch Major #2 |
| Rejected-action notice / stale-client feedback | ❌ missing — would catch Major #3 |
| Targeted Phase 10 Vitest suite | ✅ 6 files, 125/125 passed |
| TypeScript build check | ✅ `npx tsc -b --noEmit` passed |

**Coverage limitation:** I cannot run the app in a browser in this review. The animation race, silent stock failure, keyboard activation gap, and winner/loser audio behavior are grounded in the rendered code and sibling conventions; they still deserve a manual browser session after remediation, especially with one human and five bots.

#### Test command evidence

Targeted Phase 10 suite:

```text
RUN  v4.1.10 /opt/data/pips-ai-player/pips


 Test Files  6 passed (6)
      Tests  125 passed (125)
   Start at  20:07:32
   Duration  8.48s (transform 2.36s, setup 0ms, import 3.02s, tests 954ms, environment 1ms)
```

TypeScript:

```text
npx tsc -b --noEmit

(exit code 0; no output)
```
