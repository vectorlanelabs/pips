# Hangman — AI Grouch (Oscar) Review

**Date:** 2026-08-24  
**Reviewer:** Oscar (ai-grouch), run via Bartowski  
**Scope:** `src/games/hangman.ts`, `src/screens/HangmanTable.tsx`, Hangman wiring in `src/App.tsx`, Hangman state transitions in `src/state/room.ts`, shared turn/sound behavior used by the table, and the results screen reached by Hangman.

**Baseline:** checkout on `main` @ `d160de5`. The full Vitest suite passed **1398/1398** tests across **66** files; the targeted Hangman test command found no test file; `tsc -b --noEmit` was clean. No Hangman-specific test exists.

---

### Executive verdict

**needs changes** — the core two-player state machine is small and mostly coherent, but it has no direct tests and leaves a host-authoritative input invariant unenforced: `hangmanGuess` accepts any string rather than exactly one alphabetic letter. The UI is playable on the happy path, but it misses the established active-turn treatment, silently ignores rejected state changes, and routes Hangman through a generic results sound that tells the loser they won. I found no confirmed blocking engine bug in the normal UI flow; the release risk is concentrated in untested validation and consistency failures.

### Blocking issues

none

### Major concerns

#### 1. Host accepts malformed guess payloads instead of validating one letter

- **severity:** major
- **evidence:** `src/state/room.ts:470-480` uppercases `letter`, checks only `h.guessed.includes(L)`, then appends `L` to `guessed` or `wrong`. The action contract in `src/types.ts:193-194` is only `{ letter: string }`; there is no length or `A-Z` check. The UI happens to emit one of the 26 buttons, but `hostApply` (`src/App.tsx:700-707`) treats `applyAction`'s result as canonical and broadcasts it.
- **impact:** a stale, buggy, or manually crafted PeerJS client can send `"AB"`, `"1"`, punctuation, or an empty string. These values become canonical guessed/wrong entries even though they are not letters. Six malformed non-word guesses can consume the loss budget; an empty string consumes a guessed slot without being a letter. This breaks the game's state invariant and leaves the remote UI showing junk in `Wrong:` or silently burning guesses. Host authority is only useful if the host validates the action payload as well as the actor identity.
- **suggested fix:** normalize and reject unless the normalized payload matches `/^[A-Z]$/`; do not broadcast rejected actions. Add tests for lowercase acceptance, duplicate rejection, empty/multi-character rejection, punctuation rejection, and all three game phases.

#### 2. The Hangman table does not visually mark whose turn it is

- **severity:** major
- **evidence:** `src/screens/HangmanTable.tsx:191-201` renders every seat card with the same border, white background, and shadow. It never derives an active seat or applies the active-seat highlight. In contrast, the sibling `src/screens/TttTable.tsx:114-131` and `src/screens/Connect4Table.tsx:116-133` explicitly compute `isActive` and change the card background, text color, and shadow. Hangman has two distinct active roles: the setter during `setting`, then the guesser during `guessing`.
- **impact:** the main instruction says who is setting/guessing, but the player rail gives no persistent turn treatment. This is especially poor during the setter handoff and for a spectator/remote player reading the table between state updates. It violates the repository's stated sibling convention for turn highlighting and makes a central game state less legible than the established board-game tables.
- **suggested fix:** derive `activeSeatId` from `h.phase` (`setterIdx` while setting, `guesserIdx` while guessing; none while round over) and reuse the sibling active-seat card treatment. Keep the round-over winner/status styling separate from the live-turn treatment.

#### 3. Results always play the winner cue, including for the loser

- **severity:** major
- **evidence:** Hangman reaches `screen: 'results'` at `src/state/room.ts:497-505`. `src/screens/Results.tsx:62-64` unconditionally runs `play('game-win')` on mount, regardless of `localSeatId` and `room.winnerId`.
- **impact:** both players hear a victory sound when the results screen opens; the losing Hangman player receives an audio cue that semantically says they won. This is not merely aesthetic: sound is part of the table's feedback language, and the project's own review standard treats misleading or cut/incorrect sound cues as bugs. The visual heading correctly distinguishes `You take it!` from the opponent, so the audio contradicts the UI.
- **suggested fix:** gate `game-win` on `room.winnerId === localSeatId`, and use an appropriate loser/no-win cue or silence for the other player. Add a results test or a component-level regression test covering winner and loser mounts.

#### 4. Rejected or malformed actions fail with no player-visible explanation

- **severity:** major
- **evidence:** `hangmanSetWord` (`src/state/room.ts:460-467`) returns the unchanged room when the caller is not the setter or when the cleaned word has fewer than three letters. `hangmanGuess` similarly returns unchanged state for the wrong phase, wrong actor, or duplicate letter (`:470-476`). `HangmanTable` passes callbacks directly to dispatch (`src/App.tsx:4920-4929`) and renders no notice/error state. A stale client or a failed request therefore looks identical to a dead button/network stall.
- **impact:** the normal UI disables the obvious invalid controls, but the host-side rejection paths still exist and are reachable through stale tabs or malformed network actions. A setter can remain on “Give … a word to guess” with no reason why nothing happened; a guessed letter can be rejected after a race while the player gets no feedback. This makes debugging and recovery needlessly opaque.
- **suggested fix:** return a structured action outcome or thread a transient notice through the existing room/app feedback mechanism. At minimum, show a local pending/error message for rejected setter actions and duplicate/out-of-turn guesses; do not pretend a no-op was a successful submission.

### Minor concerns and nits

- `src/games/hangman.ts:11-13` uses `Math.random()` directly for bot-set words. This is acceptable for a casual game, but it does not match the deterministic/randomization discipline of a host-owned RNG. If reproducibility or authoritative seeded games matters here, move word selection behind the host's existing random source.
- `HangmanTable` defines `PART_THRESHOLD` and renders a `.2s` opacity transition, but there is no explicit last-guess animation gate or duration estimator. The current bot waits `BASE_MS` (900ms) between guesses (`src/App.tsx:4504-4515`), so I found no concrete race in this path; keep the buffer coupled to any future gallows/letter animation rather than reducing it casually.
- The setter copy says “Letters and spaces only,” while `hangmanSetWord` silently strips every other character (`:465`). That is forgiving input behavior, but it can conceal typos (`"C@T"` becomes `"CT"`) instead of telling the setter what was rejected.
- The alphabet buttons have no `aria-label` beyond their visible one-character content and no explicit explanation for disabled buttons. This is a limited accessibility/readability issue, not a game-state defect.
- There is no Hangman deal intro, which is defensible: Hangman is not a card/tablet deal game, and the closest board-game siblings do not use `DealIntro`. The omission should not be “fixed” by adding a card-oriented animation just to satisfy a convention.

### What the code gets right

- **The normal state transitions are straightforward and internally consistent.** `startHangmanRound` assigns the setter opposite the current guesser; `hangmanSetWord` moves only from the setter's side into guessing; `hangmanGuess` stops after a solve or six wrong guesses; and `hangmanAdvanceRound` either alternates the guesser or moves to results once a player reaches two wins.
- **Duplicate guessed letters are rejected in the normal path.** `h.guessed.includes(L)` prevents repeated UI guesses from adding another wrong mark or changing the round. The remaining problem is that the accepted value is not constrained to one alphabetic character.
- **Spaces are treated consistently as non-guessable characters.** `isWordSolved` ignores spaces, and the renderer splits words for display rather than rendering a misleading blank slot for the separator.
- **Setter authority and guesser authority are checked host-side.** `hangmanSetWord` checks the opposite seat; `hangmanGuess` checks `h.guesserIdx`; and the host owns `applyAction` and broadcasts the resulting plain state. This is the correct architecture, even though payload validation is incomplete.
- **Bot pacing is materially better than a rapid-fire loop.** The Hangman bot waits `BASE_MS` before every letter, checks for stale state, and exits immediately on round end. With Hangman's hard cap of six wrong guesses and only two seats, I found no evidence that the bot can race a visible state-changing animation or spam a full table. The 900ms value is inherited, so it deserves future per-game review, but it is not a confirmed pacing defect here.
- **Sound usage follows the registry and avoids opponent spam.** The table uses registered `letter-correct`, `letter-wrong`, `round-win`, and turn-start sounds, and the transition diff only plays guess feedback when the local player was the guesser. That restraint is sensible; the generic results cue is the separate problem.
- **TypeScript and the complete existing suite are green.** This is useful evidence that the wiring compiles and unrelated regressions were not introduced, but it does not meaningfully validate Hangman because no Hangman test file exists.

### Best next moves

1. Add a focused `src/games/hangman.test.ts` (or the repository's required beside-code equivalent) covering every state transition and malformed-action boundary, starting with the exact six-invalid-payload loss scenario.
2. Enforce a single uppercase `A-Z` guess in `hangmanGuess`, and make rejected setter/guess actions observable to the initiating player.
3. Add the active-seat treatment to `HangmanTable`, matching `TttTable.tsx`/`Connect4Table.tsx`, with setter and guesser roles mapped explicitly.
4. Fix `Results.tsx` so only the winner hears `game-win`; add a regression test for both local winner and local loser.
5. Do one manual two-browser session after those changes: human setter vs bot, human guesser vs bot, solve, lose at six wrong guesses, alternate round, and finish the match.

### Codebase review addendum

- **systemic risks:** The legacy `RoomState` path has a useful host-authoritative shape, but its `Action` union carries unconstrained primitive payloads and `applyAction` communicates rejection by returning the old state. That combination makes malformed inputs easy to canonicalize and failures hard to surface. Hangman exposes the pattern clearly; the same boundary deserves an audit in Farkle, Yahtzee, Tic Tac Toe, and Connect 4.
- **hotspots worth manual inspection:** `src/state/room.ts` action handlers for input-range validation; `src/App.tsx`'s shared bot scheduler and `hostApply`; `src/screens/Results.tsx` for game-specific winner/loser audio; and any remote-client path that can issue actions after a phase transition.
- **repeated anti-patterns:** Generic result behavior is applied without checking whether the local player is the winner; no-op rejection is used as the only error channel; and the legacy game screens do not all share the same active-seat visual treatment.
- **areas healthier than expected:** Hangman's actual rules are compact rather than over-abstracted; the round/match boundary is explicit; the bot loop has stale-state checks and a human-readable delay; and the engine does not trust the client's claimed seat for authorization.

#### Test case completeness matrix

| Area | Status |
|---|---|
| Word normalization (case, repeated whitespace, minimum length) | ⚠️ untested |
| Setter-only word submission | ❌ untested — malformed/stale caller paths can hide regressions |
| Guesser-only letter submission | ❌ untested |
| Lowercase letter normalization | ❌ untested |
| Duplicate guessed-letter deduplication | ❌ untested |
| Non-letter / empty / multi-character guess rejection | ❌ missing — would catch Major #1 |
| Correct guess and repeated-letter reveal | ❌ untested |
| Wrong-guess accumulation and six-strike loss | ❌ untested |
| Solving words with repeated letters | ❌ untested |
| Solving multi-word phrases with spaces | ❌ untested |
| Round alternation after non-match round | ❌ untested |
| Match winner at two wins and results transition | ❌ untested |
| Continue rejection outside `roundOver` | ❌ untested |
| Bot letter order and bot stop-on-round-over | ❌ untested |
| Host/guest serialized action/state path | ❌ untested |
| Active-turn rendering for setter/guesser | ❌ untested |
| Correct winner-only results sound | ❌ untested — would catch Major #3 |
| Full existing Vitest suite | ✅ 1398/1398 passed |
| TypeScript build check | ✅ `npx tsc -b --noEmit` passed |

**Coverage limitation:** I did not run the app in a browser. Playability findings about turn highlighting, silent failures, and results audio are grounded in the rendered code and shared sibling conventions; they still deserve one manual two-browser Hangman session before release.

#### Test command evidence

Targeted Hangman command (the requested file is absent):

```text
RUN  v4.1.10 /opt/data/pips-ai-player/pips

No test files found, exiting with code 1

filter: src/games/hangman.test.ts
include: **/*.{test,spec}.?(c|m)[jt]s?(x)
exclude:  **/node_modules/**, **/.git/**
```

Full suite:

```text
RUN  v4.1.10 /opt/data/pips-ai-player/pips


 Test Files  66 passed (66)
      Tests  1398 passed (1398)
   Start at  20:02:53
   Duration  18.04s (transform 1.63s, setup 0ms, import 2.82s, tests 7.42s, environment 5ms)
```

TypeScript:

```text
npx tsc -b --noEmit

(exit code 0; no output)
```
