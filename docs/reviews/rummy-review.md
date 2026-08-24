# Rummy — AI Grouch (Oscar) Review

**Date:** 2026-08-24  
**Reviewer:** Oscar (ai-grouch), run via Bartowski  
**Scope:** `src/card-games/rummy/` (state, rules, melds, scoring, bot, and all five test files), `src/screens/RummyTable.tsx`, `RummyRoom.tsx`, `RummyResults.tsx`, `RummyRulesOverlay.tsx`, `RummyTable.css`, the Rummy wiring and bot scheduler in `src/App.tsx`, and the shared `DealIntro`/sound behavior they rely on.

**Baseline:** `main` @ `d160de5`. The requested Rummy slice and TypeScript check were run against this checkout. The app was not run in a browser.

---

### Executive verdict

**needs changes** — the engine is unusually well-tested and the core meld, reach-in, layoff, conservation, scoring, and N-player paths are mostly coherent. That good engine work is undermined by two release-level table failures: a round-over state has no user-visible path to start the next round, and bots begin acting after only `BASE_MS` while Rummy's deal animation is still running. The results screen also plays a victory cue for the loser, rejected actions are silently discarded at the App boundary, and the host action boundary is not runtime-safe for malformed network payloads. The targeted tests are green, but they do not exercise the actual React/PeerJS playability contract.

### Blocking issues

#### 1. Non-match rounds enter a dead state with no way to start the next round

- **severity:** blocking
- **evidence:** `src/card-games/rummy/rules.ts:140-181` implements `START_NEXT_ROUND`, but no Rummy screen dispatches that action. `src/screens/RummyTable.tsx:509-510` only shows a round banner when `roundOver && !matchWinnerId && roundWinnerId`; it renders no “start next round” button. `src/App.tsx:1262-1269` stops the bot scheduler whenever `ps.roundOver` is true, and the results screen is mounted only when `matchWinnerId` is set (`App.tsx:4971-4986`). The banner copy says **“Round N starts automatically”** (`RummyTable.tsx:714-722`), but neither host logic nor UI performs that action.
- **why it breaks:** the normal first round can end by discard/going out while neither player has reached 500. The host broadcasts `roundOver: true`; both clients remain on the table, controls are hidden, the bot scheduler returns, and there is no action capable of transitioning to round 2. A blocked round (`rules.ts:229-237`, empty stock and empty discard) is even worse: `roundWinnerId` is null, so the banner is hidden too. The match cannot progress without an out-of-band state mutation.
- **what would change my mind:** a live two-round session where a non-winning round visibly transitions to a fresh deal, or a UI/host path that dispatches and verifies `START_NEXT_ROUND` after the round-over animation/banner. Add a test that exercises the actual screen/application transition, not only the rules function.

#### 2. Bot activity races the deal intro and is not human-paced at a full table

- **severity:** blocking (against the repository's explicit top-priority `CLAUDE.md` standard)
- **evidence:** `src/App.tsx:180-204` defines shared `BASE_MS = 900`; `runRummyBot` waits only that value before **every** Rummy action (`App.tsx:1246-1259`). `rummyStart()` immediately broadcasts the newly dealt state (`App.tsx:1231-1243`), while `RummyTable` mounts `DealIntro` for each round (`RummyTable.tsx:386-399`, `627-633`). The shared intro documents 60ms empty + 510ms shuffle + flights at 130ms + a 260ms flight/settle phase (`src/components/DealIntro.tsx:55-78`), and its default flight cap is 10; the approximate default sequence is therefore about 2 seconds, not 900ms. Rummy does not use `estimateDealIntroMs` or set a host-side hold, unlike the established gated games in `App.tsx`.
- **why it breaks:** on a bot-starting turn, the host applies a state change roughly 900ms after the deal is broadcast, before a local Rummy client has necessarily completed the roughly-2s deal/shuffle intro. With three bots, the human can then receive several consecutive draw/meld/discard updates at 900ms intervals. That is precisely the “fast-forward” behavior `CLAUDE.md` forbids: visible state changes land while the table is still showing the deal, and a full table compounds the problem rather than hiding it. The same 900ms gap is also not tied to the completion of Rummy's card animation or its card sounds; `useSound` starts a new `Audio` for every cue without a completion signal (`src/hooks/useSound.ts:126-130`).
- **what would change my mind:** a Rummy-specific host hold based on `estimateDealIntroMs` (plus render/network slack), and a measured per-action cadence that remains legible with three bots and lets the card animation/sound finish. A manual full-table run should show no bot state update during DealIntro and no rapid-fire chain between human turns.

### Major concerns

#### 1. Results tells the loser they won

- **severity:** major
- **evidence:** `src/screens/RummyResults.tsx:35-39` unconditionally runs `play('game-win')` on mount. The same component already computes `isLocalWinner` at `:42-44`, and App renders this screen for every player once `matchWinnerId` exists (`App.tsx:4971-4985`).
- **impact:** both winner and loser hear a victory cue. The heading correctly says `You win!` or `${winner} wins!`, so audio contradicts the visible result. This is a misleading feedback bug, not merely a cosmetic sound preference.
- **suggested fix:** gate `game-win` on `publicState.matchWinnerId === localPlayerId`, and provide a loser/no-win cue or silence for other seats. Add a component regression test for winner and loser mounts.

#### 2. Host silently drops rejected actions, making valid-looking controls feel dead

- **severity:** major
- **evidence:** guest actions are validated in `App.tsx:1192-1200`, but `if (!result.outcome.ok) return`; host-local actions do the same at `:1319-1329`. The rules engine does produce useful reasons such as “draw first”, “you must use the card you reached for”, and “that would leave no way to use the card you reached for” (`rules.ts:184-370`), while `RummyTable` has a `notice` banner and error sound (`RummyTable.tsx:450-493`, `622-624`). None of those reasons are threaded through for rejected Rummy actions.
- **impact:** stale guest state, a race after another player's action, or a reach-in constraint can produce no visual change and no explanation. The button appears dead even though the engine correctly rejected the intent. This is especially damaging for the unusual discard-pile obligation rule.
- **suggested fix:** return or transport the validator reason to the initiating client through the existing `notice` path; preserve the no-op canonical state, but do not make rejection indistinguishable from a lost click/network request.

#### 3. The PeerJS host boundary can throw on malformed action values

- **severity:** major
- **evidence:** `onAction(guestId, action)` accepts a network value and passes it directly to `applyRummyAction` (`App.tsx:1192-1199`). `makeValidator` immediately evaluates `action.type` (`rules.ts:137-143`) before any runtime shape check. The TypeScript `RummyAction` union is not a runtime validator; a guest can send `null`, a primitive, or an object without `type` over the plain-data PeerJS channel.
- **impact:** a malformed/stale or hostile guest payload such as `null` reaches `action.type` and throws instead of returning a rejected `ActionOutcome`. That violates the `CLAUDE.md` host-authority boundary and can disrupt the host's action callback rather than preserving the session. Field-level malformed values are partly covered (`index`, `cardIds`), but the outer action envelope is not.
- **suggested fix:** validate the action envelope before dispatch (or make `makeValidator` accept `unknown` and reject non-object/unknown-type payloads). Add serialized malformed-action tests for `null`, arrays, missing `type`, and unknown `type`, asserting no state/revision change and no throw.

#### 4. The test suite proves the engine, not the game players actually use

- **severity:** major
- **evidence:** all five Rummy test files are engine/rules tests. There are no tests for `RummyTable`, `RummyRoom`, `RummyResults`, the App's Rummy host/guest wiring, `DealIntro` sequencing, bot timers, `notice` propagation, or winner/loser sounds. The large integration file deliberately calls `applyRummyAction` and `runRummyBotTurn` directly; it cannot detect the missing `START_NEXT_ROUND` UI transition or the `BASE_MS`/DealIntro race.
- **impact:** the suite can remain 144/144 green while the first ordinary non-match round deadlocks, the deal animation is overtaken by bot updates, the loser hears `game-win`, and a player receives no rejection feedback. These are core playability requirements in the project's own standards.
- **suggested fix:** add a small application/screen-level test seam for round-over progression, rejection notices, and results audio; add deterministic scheduler/timer tests for deal hold and full-table bot cadence. Then perform one manual two-browser run with one human plus three bots.

### Minor concerns and nits

- `RummyRulesOverlay.tsx:24` says “Two players” even though the room, state, tests, and table explicitly support 2–4 seats. The rules bullets also say “both players” (`:9`) and “every round” language should be generalized to every seated player. This is misleading copy in a reachable rules dialog.
- The rules overlay says “a new one deals” after a blocked round (`RummyRulesOverlay.tsx:11`), reinforcing the automatic-transition promise that the implementation does not fulfill.
- `RummyTable.tsx:365` keeps `localName` and `onOpenRules` solely as unused props (`void` statements); App passes `onOpenRules={() => {}}` while the table owns its own rules state. This is dead wiring, not a correctness issue, but it makes ownership harder to audit.
- `RummyTable.tsx:306-312` gives clickable layoff clusters `role="button"` and `tabIndex` but no keyboard handler. Keyboard users can see a legal target but cannot activate it with Enter/Space.
- `RummyRoom.tsx:38-48` marks the invite/code as copied even when `navigator.clipboard` is unavailable or rejects. Limited feedback accuracy; unrelated to game rules.
- The engine's use of plain serializable zones and a host-only stock is the right architecture, but the public `stockCount` is a derived mirror and should continue to be checked against the host stock as the tests do.

### What the code gets right

- **Meld validation is compact and correct by inspection and tests.** `classifyMeld` enforces 3+ cards, same-rank/different-suit sets, same-suit consecutive runs, numeric rank ordering, ace-low and ace-high interpretations, and rejects wraparound. The tests cover unsorted input, 9–10 boundaries, Q-K-A, A-2-3, and invalid K-A-2 shapes.
- **Reach-in semantics are handled seriously.** Taking card `i` takes `i..top`; a non-top reach sets `obligatedCardId`, and the engine rejects a reach whose chosen card cannot be used. The soft-lock checks preserve an obligation when an unrelated meld is legal and allow a table layoff escape hatch.
- **Laying off is modeled with correct contribution ownership.** `fullMeldCards` includes prior lay-offs for validation and Ace context, while `contributorOf` and `playerContributedMeldValue` ensure a card scores for the player who contributed it rather than the owner of the target meld. The 3-player tests exercise this rather than assuming a two-player shortcut.
- **Going-out scoring is better than a naive implementation.** `finishRoundByGoingOut` scores every seat's meld contribution minus that seat's own deadwood, handles match-target candidates deterministically, and has explicit tie behavior. The tests cover opponent-higher, going-out-player tie, non-going-out tie, Ace-high scoring, and 4-player deadwood.
- **The host owns randomization, validation, and canonical state.** `RummySession` keeps stock and RNG host-side; the guest receives a derived snapshot with only its own private hand. The hidden-information and JSON checks are valuable evidence that the intended PeerJS boundary is respected for valid values.
- **Card conservation and synchronization checks are unusually strong.** The tests repeatedly assert 52-card conservation, unique IDs, `stockCount`, `handCounts`, fixed seat order, and multi-seat bot playout properties. That is real invariant testing, not just happy-path snapshots.
- **Interaction conventions are mostly matched.** Rummy uses `DealIntro`, sorted hands with suit/rank toggles, selected-card then confirmed `Lay down`/`Discard` actions, a visible turn chip, opponent turn highlighting, registered sounds, and a short footnote in the repository's established voice. The defect is sequencing and failure handling around those conventions, not their complete absence.

### Best next moves

1. Fix the round-over state first: either auto-dispatch `START_NEXT_ROUND` after a host-controlled, client-visible round result, or expose an explicit host “Next round” control. Cover both going-out and blocked-round paths, including 2–4 seats.
2. Add a Rummy deal hold using `estimateDealIntroMs` and a Rummy-specific per-action pacing budget. Measure a full four-seat table, not one bot; hold subsequent actions until visible card effects and sounds are complete.
3. Make rejected actions observable through `rummyNotice`, and add runtime validation for the outer PeerJS action envelope.
4. Fix winner-only results audio and add winner/loser component tests.
5. Add the missing application-level tests, then manually exercise: initial deal with a bot starter, several consecutive bot seats, human reach-in/obligation rejection, ordinary round completion, blocked round completion, rematch, and a losing results client.

### Codebase review addendum

- **systemic risks:** The Rummy engine is stronger than its UI boundary. `ActionOutcome.reason` is carefully produced and then discarded by App, while plain network data is trusted to satisfy a TypeScript union. This is the same host-authority/failure-observability seam that deserves auditing across the other PeerJS card games.
- **hotspots worth manual inspection:** `App.tsx`'s Rummy bot scheduler and lifecycle effects; all `roundOver` branches in the table/session render path; `useSound` calls that launch independent `Audio` objects; and every PeerJS `onAction` handler that assumes a typed payload.
- **repeated anti-patterns:** shared `BASE_MS` is reused for games with different visual/audio timing; action rejection is represented as a silent return; and results components generally play `game-win` without checking whether the local seat won. Rummy makes all three visible.
- **areas healthier than expected:** The rules layer is not hand-wavy AI-generated game logic. It has explicit invariants, stock recycling, no-progress prevention for reach-ins, N-player contribution scoring, deterministic tie-breaking, and property-style conservation tests. The main release risks are integration and playability, not the basic meld mathematics.

#### Test case completeness matrix

| Area | Status |
|---|---|
| Rank ordering and deadwood values | ✅ covered |
| Sets: size, duplicate suits, 3–4 cards | ✅ covered |
| Runs: gaps, duplicate ranks, suit mismatch, unsorted input | ✅ covered |
| Ace-low / Ace-high / no-wrap behavior | ✅ covered |
| Find-meld and bot discard heuristics | ✅ covered |
| Initial deal, stock/discard counts, turn phase | ✅ covered |
| Draw from stock and top discard | ✅ covered |
| Multi-card reach-in and obligation | ✅ covered |
| Unmeldable reach-in deadlock prevention | ✅ covered |
| Meld and layoff validation, including chains | ✅ covered |
| Going out via final discard | ✅ covered |
| Whole-hand meld does not immediately go out | ✅ covered |
| Stock recycling and true empty-stock/empty-discard block | ✅ engine-only; ❌ UI progression untested |
| Round transition after ordinary going-out | ✅ `START_NEXT_ROUND` engine action; ❌ no screen/App path |
| Match scoring, Ace context, N-player deadwood | ✅ covered |
| Match-winner tie-breaking | ✅ covered |
| Host/guest hidden-hand serialization | ✅ snapshot-level coverage |
| Malformed field values (`index`, `cardIds`) | ✅ partially covered |
| Malformed outer action envelope / `null` network action | ❌ missing — would catch Major #3 |
| Rejected action notice/error feedback | ❌ missing — would catch Major #2 |
| DealIntro-to-bot sequencing | ❌ missing — would catch Blocking #2 |
| Full-table bot pacing and sound/animation completion | ❌ missing — would catch Blocking #2 |
| RummyTable/RummyRoom/RummyResults rendering | ❌ missing |
| Winner-only results sound | ❌ missing — would catch Major #1 |
| Full targeted Rummy Vitest slice | ✅ 5 files / 144 tests passed |
| TypeScript build check | ✅ `npx tsc -b --noEmit` passed |

**Coverage limitation:** I cannot run the app in a browser in this review. The round dead state, silent rejection path, results audio, and DealIntro/bot race are grounded in the rendered code and App lifecycle; they still deserve a manual two-browser run, especially with one human and three bots.

#### Test command evidence

Targeted Rummy tests:

```text
RUN  v4.1.10 /opt/data/pips-ai-player/pips


 Test Files  5 passed (5)
      Tests  144 passed (144)
   Start at 20:06:55
   Duration 6.23s (transform 743ms, setup 0ms, import 1.31s, tests 1.18s, environment 0ms)
```

TypeScript:

```text
npx tsc -b --noEmit

(exit code 0; no output)
```
