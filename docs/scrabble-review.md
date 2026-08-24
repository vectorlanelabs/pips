# Scrabble — AI Grouch (Oscar) Review

**Date:** 2026-08-24
**Reviewer:** Oscar (ai-grouch), run via Bartowski
**Scope:** `src/board-games/scrabble/` (board, dictionary, state, rules, bot) + `src/screens/Scrabble*.tsx` + host-side wiring in `src/App.tsx` (bot loop, pacing, dispatch)

**Originally reviewed:** checkout on branch `ai-player-farkle-mcp` @ `16fb222`.
**Re-verified against:** `main` @ `dcce661` — see the [Main re-verification addendum](#main-re-verification-addendum) at the end. All blocking findings were re-run live against main and still reproduce.

**Baseline (main @ dcce661):** full suite **1243/1243 pass**, `tsc -b --noEmit` clean, 47/47 scrabble tests pass. The repro harness used to confirm the bugs was temporary and deleted; the tree is clean.

---

## Executive verdict

**needs changes** — two engine-level data-corruption bugs are confirmed with live reproductions, and the game's scoring core (the heart of Scrabble) has zero test coverage. The architecture is otherwise sound and mostly correct: word extraction, premium scoring, and the bot's move search are all right by inspection, and the test discipline (47 tests, deterministic hand-built bot fixtures) is better than most of this repo's other games. But a challenge — the game's signature mechanic — can permanently corrupt the bag and a player's rack in a common endgame scenario, and the validator accepts two tiles on one square. Both are cheap fixes. Playability has real friction: invalid moves fail silently, and in 3–4 player games the human's challenge window is roughly one second.

---

## Blocking issues

### 1. Successful challenge corrupts bag + rack when the placer wasn't fully refilled
- **severity:** blocking
- **evidence:** `rules.ts:319-332`. Undo removes `originalRack.cards.slice(-numTilesPlaced)` — i.e. "the last N tiles in the rack" — and dumps them into the bag, on the assumption the placer drew N refill tiles. When the bag runs out mid-refill, the last N rack tiles are the placer's *original* tiles, not drawn ones.
- **why it breaks:** live repro (re-run on main): p1 places 5 tiles with a 3-tile bag → rack is 5 (2 original + 3 drawn), bag 0. p2 challenges successfully → p1's rack becomes 5 tiles (`r1..r5` — the placed ones, returned), bag becomes 5 tiles (`r6, r7` originals + `b1..b3` drawn). Expected: rack 7, bag 3. **Two of p1's tiles permanently migrate into the bag**; p1 is stuck with a 5-tile rack for the rest of the game. This is the most common endgame shape (bag low, big plays), and challenge is a headline feature. The existing regression test `[Bug 2]` (`scrabble.test.ts`) only asserts `rackSize ≤ 7` — it cannot catch this; it passes on the corrupted state.
- **what would change my mind:** the repro coming back with rack = `[r1..r7]` and bag = `[b1,b2,b3]`.

### 2. Validator accepts two tiles on the same square
- **severity:** blocking
- **evidence:** `rules.ts:546-646`. `validatePlacement` checks each tile's cell against the *board* (`board[row][col] !== null`), never against the *other action tiles*. Rule 3 passes (same row *and* col → singleRow ✓), rule 4 passes, rule 5 passes (covers center).
- **why it breaks:** live repro (re-run on main): `PLACE_WORD` with two rack tiles both at `(7,7)` returns `ok: true`. Extraction reads only the first tile (`.find()`), scoring counts one, board keeps the second, rack loses both. First placement can be 2× tiles on one square. The current UI can't produce it (click flow prevents it), and neither can the bot — but the engine is declared authoritative in `CLAUDE.md` ("Host is authoritative: action validation… all happen host-side"), and it's a one-line gap: also reject duplicate `(row,col)` *and* duplicate `tileId` in the action.
- **what would change my mind:** the repro rejected with a reason string.

### 3. Bot turn can freeze the host UI for seconds — budget is aspirational
- **severity:** blocking (against the project's own top priority: "bots play at human speed")
- **evidence:** `bot.ts:200-247`. The 300ms budget is checked only at the top of each `wordLen` iteration and each anchor — *never inside* `generateValidPermutations`, which runs up to 5040 rack permutations × 100 blank-letter combos, each doing a DAWG lookup + cross-word validation, synchronously, on the host's main thread (the same thread the human's UI renders on). Live repro with the **real ENABLE1 dictionary and 2 blanks: 329.9ms on main** (355ms on the reviewed branch), against a declared 300ms budget — and that was a sparse board; dense boards with more anchors multiply it. Worse, with a permissive dictionary the same path **crashes with `RangeError: Maximum call stack size exceeded`** at `results.push(...validPlacements)` (unbounded spread; ~500K-element array).
- **why it breaks:** in a 2-blank turn the human's table freezes for ~330ms+; worst case is unbounded, and the crash proves the structure is fragile. `CLAUDE.md` explicitly makes bot pacing the top priority — a bot that locks the table isn't "human-paced", it's broken.
- **what would change my mind:** budget checks inside the permutation/letter-combo loops, `push` replaced with bounded accumulation, and the 2-blank repro under 300ms on a dense board.

---

## Major concerns

1. **The scoring engine is untested — zero coverage of the core mechanic**
   - **evidence:** `rules.ts:183-247` (`scoreWordsWithBreakdown`) has no direct test. `scrabble.test.ts` covers structure, pass/exchange, and weak regression tests — nothing asserts a DL/TL letter multiplier, a DW/TW word multiplier, the center-as-DW, the bingo +50, blank-tiles-score-0, or cross-word premium math. By inspection the math is *correct* (verified by hand: first play "CAT" through center = (3+1+1)×2 = 10), so this is a coverage hole, not a bug — but it's the highest-value code in the game and it's the least tested.
   - **impact:** a scoring regression (the #1 thing players notice) ships silently; the test suite will stay green.
   - **suggested fix:** hand-built board fixtures (the pattern `bot.test.ts` already uses) with known placements: one test per premium type, one for bingo, one for blank scoring, one for a multi-word turn.

2. **Invalid plays fail silently — no error ever reaches the player**
   - **evidence:** `App.tsx` `scrabbleDispatch` does `if (!result.outcome.ok) return` — the validator's reason strings ("first placement must cover the center square (7,7)", "placement must connect to existing tiles") are discarded. The UI never surfaces them.
   - **impact:** the classic new-player failure — first word not covering center — gets *zero* feedback. Tiles vanish from staging, nothing happens. The prompt literally says "Click Play word to submit", then the click does nothing. Same for "tiles must connect", "not enough tiles in bag" on exchange.
   - **suggested fix:** thread `outcome.reason` into the existing notice banner (`ScrabbleTable.tsx` renders `notice`).

3. **Human challenge window is ~1 second in 3–4 player games**
   - **evidence:** `App.tsx` bot scheduler + `runScrabbleBot`. After bot A places, the scheduler picks bot B (the next player) and it acts after only `BASE_MS` (900ms). Bot B's play replaces `lastPlacement`, so the human's Challenge button exists for ~900ms. 2-player games are fine (the human *is* the next player, window is unbounded); every table with 2+ bots makes human challenges effectively unusable.
   - **impact:** the game's flagship interaction (challenge) is only practically available in 2-player games. Note (main delta): difficulty gating makes this worse — see addendum.
   - **suggested fix:** hold bot B's turn while a challengeable placement is pending, or give the human an explicit "challenge or play" prompt when they're next after a bot placement.

4. **Dead "Again" button on tied games**
   - **evidence:** `ScrabbleResults.tsx` renders "Again" for any host; `scrabbleRematch` in `App.tsx` early-returns when `winnerId === null`. Tie → host clicks Again → nothing happens, no feedback.
   - **impact:** dead control in a reachable state (ties are explicitly modeled — `winnerId: null`).
   - **suggested fix:** gate the button on `winnerId !== null` or allow rematch on ties.

5. **Four copies of the letter-points table**
   - **evidence:** `state.ts` (tile distribution), `rules.ts` (`getTilePoints`), `bot.ts` (`getLetterPoints`), `ScrabbleTable.tsx` (inline map in render). Four sources of truth for "how many points is X".
   - **impact:** a points tweak drifts in one copy and three silently disagree — scoring, bot pick, and the displayed tile value all diverge.
   - **suggested fix:** export the points map once and import everywhere.

---

## Minor concerns and nits

- **Test suite self-skips on seed 42.** `scrabble.test.ts` has ~8 instances of `if (!result.outcome.ok) { expect(true).toBe(true); return }` — a *vacuous pass*. The blank-letter test doesn't test anything if the seeded rack has no blank. Change the seed or shuffle and tests quietly stop testing.
- **The "deterministic duplicate cross-word" test asserts nothing.** It builds a board, plays three words, and only checks `placement !== null` if the last play happened — the "duplicates" it claims to verify are never checked. It's a smoke test wearing a regression test's name.
- **`dictionary.test.ts` reimplements `isWord` instead of importing the module.** It tests a copy of the logic with a tiny fixture — the real `loadDictionary`/DAWG deserialization has zero coverage, and the test would pass if `dictionary.ts` broke completely.
- **Failed-challenge path lightly tested.** `skipNext` turn handling and the `challengeable: false` transition are only indirectly exercised. Also: engine allows *any* player to challenge; a non-current challenger who fails gets `skipNext` applied to the **current** player (`turn-engine.ts` advances `currentIndex + 2`), not the challenger. Practically unreachable via the UI, but an engine-level inconsistency.
- **Empty exchange accepted:** `EXCHANGE_TILES` with `tileIds: []` passes (validates empty, removes nothing, advances turn, counts as a scoreless turn). UI can't send it; engine should reject it.
- **`RACK_SIZE` defined twice** — `state.ts` (exported) and a shadowing local `const RACK_SIZE = 7` in `rules.ts`. `rules.ts` uses the local; a change to the export silently leaves the rules at 7.
- **Dead code:** `premiumConsumed` is written (`rules.ts:406`) and never read anywhere; `void localName` / `void connection` props in `ScrabbleTable.tsx`; the `'Your move…'` branch in `computePromptLine` is unreachable (`!isMyTurn` implies current ≠ local).
- **Rules overlay inaccuracies** (`ScrabbleRulesOverlay.tsx`): says "the player with the highest letter goes first" — the engine always starts the host; says game ends "when all players have passed twice" — exchanges also count; doesn't mention the exchange bag-size constraint.
- **Unsorted rack.** `ScrabbleTable.tsx` renders the rack in dealt/refill order, no sorting — `CLAUDE.md` names hand sorting as an established sibling convention that Uno skipped and paid for.
- **`game-win` sound plays for the loser and on ties** (`ScrabbleResults.tsx`).
- **No last-move highlight on the board** — the event line narrates, but nothing flashes the newly placed tiles, so with bots playing back-to-back it's hard to see what just happened.

---

## What the code gets right

- **Word extraction is correct.** Main-word span expansion, cross-word detection, single-tile perpendicular plays (handled via the cross-word path when `isHorizontal` mislabels them — the labeling is inverted but the geometry is sound), and the dedup reasoning in the `rules.ts` comment checks out.
- **Scoring is correct** — verified by inspection and hand-math: premium multipliers apply only to new tiles, per-word (correct for cross-word overlap), blanks score 0, center counts as DW, bingo +50 only on exactly 7.
- **Structural validation is thorough**: gaps, connection, center coverage, single-line, blank letter assignment, out-of-bounds, occupied cells — all enforced with clear reason strings (which is why it stings that the UI throws them away).
- **Bot search is genuinely complete** for main words ≤7 letters (anchor-based enumeration covers parallel plays, extensions, and bridges; cross-words validated against the dictionary; blanks tried as multiple letters via the common-letter combos; shared permutation cache across anchors). On main this is further hardened by the full-contiguous-run check (see addendum).
- **Bots self-police** — qualified on main by difficulty gating (see addendum): bots challenge invalid placements automatically (hard bots at 90%).
- **Pacing architecture follows the established pattern** — deal-intro hold uses `estimateDealIntroMs`, `piece-drop` on placement, turn-start sounds, one bot at a time via a busy ref. The *values* need per-game scrutiny, but the structure is right.
- **Discipline:** 1243 tests green, tsc clean, layering rules respected (engine imports nothing from React/screens), deterministic hand-built fixtures in `bot.test.ts`.

---

## Test case completeness matrix

| Area | Status |
|---|---|
| Structural validation (gaps/center/connect/blank) | ✅ covered |
| PASS / EXCHANGE basics | ✅ covered |
| Consecutive-pass endgame | ✅ covered |
| Challenge success (happy path) | ⚠️ weak regression tests only |
| Challenge failure (skipNext, lock-in) | ⚠️ indirect only |
| Challenge + partial refill (bug) | ❌ untested — **would have caught blocking #1** |
| Premium scoring (DL/TL/DW/TW/center) | ❌ untested |
| Bingo bonus | ❌ untested |
| Blank scoring on board | ❌ untested |
| Endgame rack-value adjustment / winner / tie | ❌ untested |
| Duplicate cells / duplicate tileIds in one action | ❌ untested — **would have caught blocking #2** |
| Real dictionary module | ❌ untested (test reimplements it) |
| Bot challenge branch | ⚠️ statistical difficulty-rate test on main (see addendum) |
| Bot budget/timing behavior | ❌ untested |

---

## Best next moves

1. **Fix the challenge undo** to track exactly which tiles were drawn for that placement (e.g. record refill tile IDs on `LastPlacement` at place time, and return those + the placed tiles), and add a regression test for the partial-refill case.
2. **Harden `validatePlacement`**: reject duplicate coordinates and duplicate tileIds.
3. **Surface validator reasons** to the player via the existing notice banner.
4. **Add scoring tests** — one hand-built board per premium type, bingo, blank, multi-word.
5. **Bound the bot search**: budget checks inside the permutation loop, bounded result accumulation (no `...spread` of a 500K array).

---

## Codebase review addendum

- **systemic risks:** the 4×-duplicated points table and duplicated `RACK_SIZE` are instances of a broader drift pattern — shared constants and value tables are copied per module instead of imported; `BASE_MS`/`SKIPBO_DEAL_HOLD_BUFFER_MS` being inherited by Scrabble is the pacing instance of the same habit, and `CLAUDE.md` explicitly warns about it.
- **hotspots worth manual inspection:** the `runScrabbleBot` loop's interplay with guest connections (host disconnect mid-loop), and the `CHALLENGE` path's reliance on rack tail-order.
- **repeated anti-patterns:** vacuous test assertions (`expect(true).toBe(true)` + early return), logic duplicated in tests instead of imported, dead fields/props kept "for future wiring".
- **areas healthier than expected:** `extractWords`/scoring (correct despite being untested), the bot's cross-word validation, and the challenge-based dictionary design — internally consistent (same dictionary on both sides of every challenge).

**Coverage limitation:** the app was not run in a browser. Playability claims about the challenge race, silent rejections, and the dead Again button are code-path analyses with concrete mechanisms; the engine bugs are all live-reproduced. Worth one manual 4-player session (2 bots) to feel the challenge race before shipping fixes.

---

## Main re-verification addendum

Reviewed branch `ai-player-farkle-mcp` @ `16fb222`; main @ `dcce661` is **ahead** of it for Scrabble by two commits. Re-verification results:

- **`rules.ts`, `state.ts`, `board.ts`, `dictionary.ts` are byte-identical between the reviewed branch and main.** Blocking #1 (challenge undo corruption) and #2 (duplicate-cell validator gap) were **re-run live against main and both still reproduce**. The scoring gap (Major #1) is unchanged.
- **`b6087c0` — "Fix bot playing invalid words by validating truncated main-word windows" — is a real fix for a live bug this review did not catch.** The bot validated a fixed-length window (2–7 tiles) without checking it was the full contiguous run, so it could play nonsense extensions (a live game produced "PAWNEESH" by extending "PAWNEE" through pre-existing letters). The fix (a full-contiguous-run check in `generateMovesInDirection`) is in main. Credit where due: my review flagged the ≤7-letter main-word cap but not this specific truncation mechanism — the shipped defect was worse than what I caught. The ≤7 cap itself **still exists on main** (`bot.ts:200`), so the "bot never extends to 8+ letters" completeness point stands.
- **`662cb07` — spec 51, Scrabble house bot difficulty** — adds easy/medium/hard knobs: candidate selection (easy picks uniformly at random) and challenge probability (easy 0.2 / medium 0.55 / hard 0.9). Consequences for this review:
  - The "bots self-police" positive now applies only at hard (90%); easy/medium bots will routinely let invalid words stand.
  - Major #3 (challenge race) is *worse* on main: a human whose invalid word isn't challenged by an easy bot keeps the score until someone else challenges — and the ~1s window still applies in 3–4 player games.
  - `bot.test.ts` gained ~300 lines including a statistical challenge-rate test — the "Bot challenge branch: untested" matrix row is now partially covered.
- **Bot timing re-measured on main: 329.9ms** for the 2-blank full-rack search with the real ENABLE1 dictionary and `hard` difficulty — still over the declared 300ms budget; the unbounded-spread crash structure is unchanged.
- **Baseline re-confirmed on main:** 47/47 scrabble tests, full suite 1243/1243, tsc clean.
