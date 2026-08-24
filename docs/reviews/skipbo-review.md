# Skip-Bo — AI Grouch (Oscar) Review

**Date:** 2026-08-24  
**Reviewer:** Oscar (ai-grouch), run via Bartowski  
**Baseline:** `main` @ `d160de5`  
**Scope:** `src/card-games/skipbo/` (state, deck, rules, bot, and all three test files), `src/screens/SkipBoTable.tsx`, `SkipBoRoom.tsx`, `SkipBoResults.tsx`, `SkipBoRulesOverlay.tsx`, their CSS/card components, and Skip-Bo host/guest/bot wiring in `src/App.tsx`.

### Executive verdict

**needs changes** — the Skip-Bo engine is unusually well-tested for a new card game and I found no confirmed stock/build-pile/wild-card/hand-refill/win-condition corruption in the normal action paths. The release is nevertheless not defensible against this repository's own standards: a full table of bots can produce a long, consecutive chain of 900 ms state changes, which is too close to fast-forward for a card game and is explicitly contrary to the project's top-priority pacing rule. The UI also silently drops rejected actions and plays the winner cue for the loser, while the tests do not cover the host/wire/UI/timing contracts. I did not run the app in a browser, so rendered playability observations are code-grounded rather than manually reproduced.

### Blocking issues

#### 1. Full-table bot play is paced like an automated loop, not a human opponent

- **severity:** blocking
- **evidence:** `src/App.tsx:4016-4031` waits only `BASE_MS` (900 ms) before each call to `runSkipBoBotTurn`; `src/App.tsx:4048` schedules the next bot check after only 50 ms. `runSkipBoBotTurn` applies one action per call, so the loop correctly re-evaluates a Skip-Bo chain, but every accepted action still arrives on a fixed 900 ms beat. A turn can contain many stock, discard, and hand plays, and with three bots between the human's turns those actions become a long uninterrupted run. The app's own `CLAUDE.md` says not to reuse a shared/default pacing constant without checking it, says more bots mean more consecutive fast actions, and makes human-speed play the top priority. The same file gives Uno a deliberately slower `UNO_ACTION_MS = 1600`; Skip-Bo uses the generic `BASE_MS = 900` instead.
- **why it breaks:** a human cannot meaningfully inspect a full table when bots are landing card plays almost once per second for a potentially large chain. This is not a one-bot “feels fine” argument: at four seats the host can serialize bot turns back-to-back, and each new snapshot changes piles, stock counts, hand counts, and sounds before the human has had a reasonable reading/strategy interval. The implementation avoids racing the initial `DealIntro` via `estimateDealIntroMs(...)+700`, and `card-play` is only 0.336 s in the installed asset, so this is not a claim that the sound is literally clipped; it is the more fundamental failure to meet the required human analogue pacing.
- **what would change my mind:** a measured full-capacity session or timing test showing that a 4-seat table's consecutive bot actions leave enough time to read each move and that the chosen interval is intentionally game-specific, or a per-game pacing constant materially slower than `BASE_MS` with a rationale. The bot scheduler should also be tested across a multi-action turn and multiple consecutive bots.

### Major concerns

#### 1. Rejected actions are silently discarded at the host boundary

- **severity:** major
- **evidence:** `src/App.tsx:3961-3969` and `4091-4101` call `applySkipBoAction`, then simply `return` on `!result.outcome.ok`. The engine does provide useful reasons (`not your turn`, `round is over`, `card not in hand`, invalid pile index, illegal target, and so on) in `src/card-games/skipbo/rules.ts:155-324`, but the host never sends them to a guest or puts them in `skipBoNotice`. The local table can optimistically clear its selection at `SkipBoTable.tsx:265-283` before the host has accepted the action.
- **impact:** stale remote clicks, a race at a turn boundary, or a malformed action all look like a dead card/button: the selection disappears and the board does not change. The room/table already has a notice banner, so the failure channel is present but unused. This is particularly damaging in a select-then-confirm game where the user needs to know whether the target pile was illegal or the turn has already moved.
- **suggested fix:** return a structured rejection to the initiating guest and set a transient `skipBoNotice` for host-local rejection; only clear selection after an accepted action or retain it when rejected. Add host and guest-path tests for each rejection family.

#### 2. Losing players hear `game-win`

- **severity:** major
- **evidence:** `src/screens/SkipBoTable.tsx:226-228` plays `game-win` whenever `roundOver` changes, without checking `winnerId === localPlayerId`. Then `src/screens/SkipBoResults.tsx:35-39` unconditionally plays `game-win` on results mount. `App.tsx:5650-5664` routes every finished game to that results component.
- **impact:** when the opponent empties their stockpile, the local loser hears a victory cue during the table transition and again on the results screen. The headline correctly says `You went out first!` versus `<name> went out first!`, so the sound contradicts the visual result. Sound is part of the established feedback language, not optional decoration; the sibling table implementations guard their win cues with the relevant winner/result state.
- **suggested fix:** gate the table cue on `publicState.winnerId === localPlayerId` and gate the results cue the same way. Use a loser/no-win cue or silence for the non-winner, and add a component regression test for both local-winner and local-loser transitions.

#### 3. Host-authoritative action validation is not tested at the actual wire boundary

- **severity:** major
- **evidence:** `rules.ts` validates the expected TypeScript union and has good range/ownership checks, but `App.tsx:3961-3969` accepts arbitrary PeerJS payloads as `SkipBoAction` and calls the validator without a runtime discriminant guard. A malformed object with an unknown `type` reaches the fallback safely, but a non-object/null payload reaches `action.type` in `rules.ts:164` and can throw instead of producing a rejected outcome. The tests construct typed in-memory actions only; none exercises serialized/untrusted host input or `assertWireSafe`/PeerJS callback behavior.
- **impact:** host authority is only robust if hostile/stale/malformed guest messages are rejected without taking down the action callback. The normal UI cannot produce `null`, so this is an integration-boundary risk rather than a demonstrated normal-play crash.
- **suggested fix:** add a small runtime guard at the PeerJS action boundary (or make the validator accept `unknown` and reject malformed values), then test `null`, primitive payloads, unknown action types, missing fields, and out-of-range fields through the host callback. I would downgrade this concern if the PeerJS layer itself proves a strict runtime schema before invoking `onAction`; that dependency was not verified here.

#### 4. The most important playability contracts have no automated coverage

- **severity:** major
- **evidence:** `src/card-games/skipbo/` has 61 tests across deck, engine/rules, and bot strategy, but no screen, App wiring, host/guest, sound, animation, or scheduler tests. The engine tests do cover a strong set of state transitions, but nothing can fail if `SkipBoResults` plays the wrong cue, if a rejected action is invisible, if `DealIntro` and bot hold drift, or if a four-seat bot chain is too fast.
- **impact:** the green suite proves a substantial pure-engine subset, not that the game is playable or meets `CLAUDE.md`. The current defects in the two sound paths and silent rejection path are exactly the kind of regression a rules-only suite cannot catch.
- **suggested fix:** add focused tests around pure UI helpers and host scheduling first: winner-only sound transition, rejection notice handling, `skipBoActorKey`/multi-action re-entry, initial deal hold calculation, and a fake-timer four-seat pacing scenario. One browser session remains necessary for actual visual/audio confirmation.

### Minor concerns and nits

- **Misleading copy:** `SkipBoTable.tsx:318` labels stock-count pills with `fewest wins`, although the values are remaining stockpile cards and the game ends at the first empty stockpile. `SkipBoResults.tsx:47-58` presents remaining counts as a finishing-order statistic after the game has already ended; call it “cards left” or remove the ranking implication.
- **Two-player layout wastes table width:** `.sb-opp-tile` in `SkipBoTable.css:100-103` caps every opponent tile at `(100% - 3 gaps) / 4`, even when there is only one opponent. This prevents stretching, but leaves a lone opponent in roughly one-quarter of the rail. It is a layout limitation, not a game-state defect.
- **No explicit selected-card confirmation button:** this is not a defect by itself. Skip-Bo's select-then-confirm interaction is implemented consistently through selecting a source and clicking a highlighted build/discard target; the rules overlay explains the flow. Do not “fix” this by adding a redundant button unless sibling behavior or accessibility testing requires it.
- **Draw pile is intentionally non-interactive:** drawing is folded into turn advance and mid-turn hand refill, as the rules text and engine comments state. The disabled-looking draw-back is therefore a deliberate representation, not a dead button.
- **Private-state boundary is sensible but deserves a serialization regression:** full stocks and discard identities remain host-side/private while public state exposes stock tops and discard tops. The existing snapshot test checks stock leakage, but not a JSON round-trip of a complete per-seat view.

### What the code gets right

- **The core Skip-Bo mechanics are coherent.** `rules.ts:29-45` correctly treats wilds as universally legal and numbered cards as exact `nextNeeded` matches. `playCardOntoPile` clears a completed 12 pile into `usedPile` and resets it to 1. I found no normal-path error in stock tops, shared building piles, wild completion, discard targets, or the “play as many as possible” turn shape.
- **Hand refill semantics are handled thoughtfully.** Emptying the hand mid-turn refills to five without advancing the turn (`rules.ts:228-240`), while DISCARD/PASS advance first and draw the next player's hand (`:101-130`). The double-empty case is explicit and leaves PASS legal rather than throwing.
- **Winning is checked at the correct source.** Only `PLAY_STOCK` can empty the stockpile and set `roundOver`/`winnerId` immediately (`rules.ts:180-197`); hand/discard plays do not accidentally win. The tests cover both a direct stock win and a mid-turn stock win.
- **Card conservation is unusually well defended.** The test helpers count every host-only and public zone, and the suite checks all 162 unique IDs at 2, 3, and 4 seats plus conservation through recycling and bot play. That is the right invariant for a pile-heavy game.
- **Host authority and privacy are structurally correct.** Actions are applied through `applySkipBoAction` on the host; guests receive a per-seat snapshot; other players' stock identities are not included in `deriveSnapshot`. The public build piles and top cards expose only what the rules make public.
- **Bot strategy is deterministic and testable.** The priority order is explicit: playable stock, discard tops, numbered hand cards, wilds, then discard/pass. The tests cover each rung, tie-breaking, wild preservation, and a full bot turn with conservation.
- **The UI matches several sibling conventions.** `SkipBoTable.tsx` uses `DealIntro` with the established duration-estimation architecture, sorts the hand numerically with wilds last, uses select-then-confirm source/target interaction, highlights the active opponent tile, and uses registered sound names. The initial deal hold is not a guessed fixed delay: `App.tsx:4008-4010` uses `estimateDealIntroMs` plus explicit slack.
- **The requested checks passed.** All three Skip-Bo test files passed: 61/61. `npx tsc -b --noEmit` passed with exit code 0 and no output. This is good evidence for the pure engine and type wiring, not evidence that the browser experience is complete.

### Best next moves

1. Replace the 900 ms shared beat with a measured Skip-Bo-specific human pace, and test a maximum four-seat chain of consecutive bot actions. Keep the initial deal hold, but do not treat it as proof that in-game pacing is safe.
2. Make host rejections observable: preserve selection on rejection, surface the engine reason locally, and send a rejection/notice message to the originating guest.
3. Fix both winner cues so only the actual winner hears `game-win`; add winner and loser regression tests.
4. Add runtime validation at the PeerJS action boundary and JSON/wire tests for malformed actions and private-state preservation.
5. Add a manual two-browser/max-bot pass covering initial deal, stock/hand/discard chains, pile completion/recycling, mid-turn refill, opponent win, rematch, and a disconnected guest.

### Codebase review addendum

- **systemic risks:** The new card-game architecture has a clean host-session boundary, but `ActionOutcome` communicates rejection only as a return value and the App-level host callbacks routinely discard that value. Skip-Bo exposes the pattern clearly: validation can be excellent and still produce a dead-feeling client when the result is not propagated. The shared `BASE_MS` is another systemic risk; per-game pacing constants exist elsewhere because card games have different action density and sound/animation needs.
- **hotspots worth manual inspection:** `App.tsx:4016-4049` bot scheduling and its interaction with React render/effect timing; `SkipBoTable.tsx:198-239` sound-diff logic; `SkipBoResults.tsx:35-39`; the PeerJS `onAction` callback at `App.tsx:3961-3969`; and `deriveSnapshot`/wire serialization for private zones.
- **repeated anti-patterns:** rejected outcomes are silently returned in the Skip-Bo App path; generic `game-win` audio is applied without checking local winner identity; and rules-only tests are being asked to stand in for screen, sound, network, and timing verification.
- **areas healthier than expected:** the engine is plain-data and layered correctly; stock/build/used-pool transitions are explicit rather than hidden in mutation; card conservation tests are strong; bot decisions are one-action-per-call rather than a monolithic whole-turn strategy; hand sorting and the DealIntro convention were not skipped; and the public/private snapshot design is more disciplined than the visible UI error path.

#### Test case completeness matrix

| Area | Status |
|---|---|
| Deck size, composition, rank counts, unique IDs | ✅ covered (`deck.test.ts`) |
| Initial deal at 2 seats | ✅ covered |
| Initial deal at 3 seats | ✅ covered |
| Initial deal at 4 seats | ✅ covered |
| Full 162-card conservation / no duplicates | ✅ covered |
| Private stock identity does not leak in snapshots | ✅ covered |
| Numbered-card pile legality and explicit target validation | ✅ covered |
| Wild legality and explicit non-furthest target | ✅ covered |
| Furthest-along bot pile choice and tie-break | ✅ covered |
| Stock-top, hand, and discard-top play sources | ✅ covered |
| 12 completion → used pool → pile reset | ✅ covered |
| Stockpile win, including mid-turn win | ✅ covered |
| Hand play does not win; discard play does not win | ✅ covered |
| Discard target choice and turn advance | ✅ covered |
| PASS only with an empty hand | ✅ covered |
| Draw-to-five from draw pile | ✅ covered |
| Used-pool recycle during draw/refill | ✅ covered |
| Draw + used both empty without throwing | ✅ covered |
| Mid-turn hand refill without turn advance | ✅ covered |
| Mid-turn refill recycling used pool | ✅ covered |
| Double-empty hand and PASS escape hatch | ✅ covered |
| Out-of-turn, empty-stock, missing-card, and bad-index rejection | ✅ covered in engine |
| Rejection reason reaches a local host player | ❌ missing — current App drops it |
| Rejection reason reaches a remote guest | ❌ missing — current host sends nothing |
| Runtime malformed/null/unknown PeerJS action handling | ❌ missing |
| JSON round-trip of complete public/private Skip-Bo view | ⚠️ partial — snapshot privacy tested, wire round-trip not |
| Bot priority rungs and discard policy | ✅ covered (`bot.test.ts`) |
| Full bot turn legality and card conservation | ✅ covered |
| Multi-action bot turn with full table / consecutive bots | ❌ missing — would expose blocking pacing issue |
| Initial DealIntro hold vs actual animation estimate | ⚠️ code path only; no scheduler test |
| In-game bot pacing against human-readability standard | ❌ missing |
| Card-play/draw sound sequencing and duration | ❌ missing |
| Winner-only table sound | ❌ missing — would catch Major #2 |
| Winner-only results sound | ❌ missing — would catch Major #2 |
| Active-turn rendering and hand selection UI | ❌ missing |
| Room/guest/host/rematch wiring | ❌ missing |
| Full requested Skip-Bo Vitest slice | ✅ 3 files, 61/61 passed |
| TypeScript build check | ✅ `npx tsc -b --noEmit` passed |

**Coverage limitation:** I cannot run the app in a browser in this review environment. The pacing, silent-rejection, layout, and sound findings are grounded in the complete rendered code, host scheduler, installed sound asset duration, and repository conventions; they still need a manual two-browser session before release.

#### Test command evidence

Requested targeted tests:

```text
$ npx vitest run src/card-games/skipbo
RUN  v4.1.10 /opt/data/pips-ai-player/pips


 Test Files  3 passed (3)
      Tests  61 passed (61)
   Start at  20:07:02
   Duration  3.73s (transform 1.07s, setup 0ms, import 1.49s, tests 241ms, environment 0ms)
```

Requested TypeScript check:

```text
$ npx tsc -b --noEmit

(exit code 0; no output)
```
