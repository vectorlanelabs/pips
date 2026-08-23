# Spec 50 — Scrabble polish: deal-intro layout, real bot word search, viewport fit

Three real bugs found by the user actually playing the shipped game
(not caught by the automated live checks in specs 47-49's own review
rounds — a lesson worth internalizing: automated Playwright clicks
don't catch "this doesn't fit on my screen" or "this bot move is
nonsense," a human playing does). Read `src/screens/ScrabbleTable.tsx`
+ `.css`, `src/board-games/scrabble/bot.ts`, and
`src/screens/SkipBoTable.tsx` (for the deal-intro pattern) IN FULL
before writing anything.

You own modifying exactly:
- `src/screens/ScrabbleTable.tsx`
- `src/screens/ScrabbleTable.css`
- `src/board-games/scrabble/bot.ts`
- `src/board-games/scrabble/bot.test.ts` (new file — this file
  currently has zero dedicated tests, which is how the broken search
  shipped undetected)

Everything else is read-only.

## Bug 1: deal intro shows a blank screen with no header

`ScrabbleTable.tsx` currently does:
```jsx
if (showIntro) {
  return (
    <div className="scr-table">
      <DealIntro .../>
    </div>
  )
}
```
This is a separate early return that skips `<TableHeader>` and the
`.scr-table-card` shell entirely — during the shuffle animation the
player sees a bare, header-less screen. Every sibling with a deal
intro (check `SkipBoTable.tsx`'s `showIntro` handling) instead renders
`DealIntro` as a conditional swap INSIDE the normal return statement,
inside `.sb-table-card`, so the header and table chrome are always
visible and `DealIntro` just replaces the board/hand/actions content.

**Fix**: restructure `ScrabbleTable.tsx` to match — one `return`,
`<TableHeader>` always rendered, `.scr-table-card` always rendered,
and inside it: `{showIntro ? <DealIntro .../> : <>...board, opponent
rail, status, hand, actions...</>}`. Do not introduce a second return
path.

## Bug 2: the bot doesn't actually search for words — it places whatever rack tiles happen to fill the slots in index order

Read `generateMovesInDirection` in `bot.ts` closely. For a given
`(anchor, direction, length, position)` combination, the inner loop
that fills empty slots does this:
```js
for (let i = 0; i < rack.length; i++) {
  if (i !== rackIdx && !used.has(i)) {
    const candidate = rack[i]
    ...
    break
  }
}
```
This always takes the next unused rack tile **in raw array order** —
it never tries different letter arrangements. It is not a search for
a word the rack CAN spell; it's "take whatever's next in the rack and
see if the fixed result happens to already be a real word by luck."
This is exactly what the user observed ("played random letters
without even trying to form a word") — because that IS what's
happening. Two compounding problems:
1. No permutation/combination search over the rack — only one fixed
   ordering is ever tried per slot-length.
2. `extractPlacedWords` only extracts the MAIN word direction — cross-
   words the placement would also form are never checked, so even a
   "valid" candidate could be illegally forming gibberish
   perpendicular to the main word. Spec 47's bot design explicitly
   required cross-word validation; it was never implemented.

**Fix — rewrite `generateMovesInDirection` (and
`extractPlacedWords`/scoring as needed) to a real search**:
- For each anchor square and each direction, enumerate actual
  **permutations of rack tile subsets** (not just the fixed order) —
  rack size is ≤7, so trying subsets of size 1-7 in every order is
  bounded (≤ 7! = 5040 per anchor/direction, matches spec 47's own
  stated bound) and cheap enough to run inside the existing per-action
  `BASE_MS` pacing budget. For each permutation tried at a given
  anchor/length/position, build the resulting word (mixing placed
  tiles with any pre-existing board letters in that span) and check
  `dictionary.isWord()` on it — only keep it as a candidate if that
  check passes.
- Reuse blanks correctly: when a rack tile is blank (`letter === ''`),
  try assigning it each letter A-Z during the search rather than
  hardcoding `'A'` — trying all 26 for every blank in every
  permutation is expensive; a reasonable simplification is to only
  try assigning a blank a letter that makes the CURRENT slot's
  contribution plausible (e.g., limit to letters that keep the word
  passing `dictionary.isWord()` — since you're already checking the
  final word against the dictionary, you can enumerate blank-letter
  assignments as an inner loop and rely on the same `isWord()` filter;
  cap it sensibly so total work stays bounded, document whatever cap
  you choose).
- **For every remaining candidate, also extract and validate every
  cross-word it would form** (mirror the real engine's
  `extractWords`-style perpendicular check in `rules.ts` — read that
  function for the exact geometry, you don't need to import it since
  `bot.ts` must stay decoupled from `rules.ts`'s internals per this
  project's module boundaries, but replicate the same logic
  correctly, including checking EVERY newly placed tile's
  perpendicular neighbors, not just the main line). A candidate is
  only valid if the main word AND every cross-word it forms are all
  real dictionary words.
- Keep the existing anchor-enumeration and top-level structure
  (challenge-check first, then candidate generation, then weighted
  pick from top candidates, then exchange/pass fallback) — this spec
  is about making the SEARCH actually correct, not about changing the
  overall bot decision shape, which was already reviewed and accepted
  in spec 47/49.
- Performance: verify (and report) that a full search at a moderately
  full board (10+ existing placements) still completes well within
  the ~900ms per-action pacing budget — if your chosen permutation/
  blank-assignment bounds make it too slow, reduce scope (e.g., cap
  word length search range, cap blank-letter trials) and document the
  tradeoff rather than silently shipping something that blows the
  pacing budget.

## Bug 3: table doesn't fit in one viewport, forces scrolling

The board is hardcoded `max-width: 600px; max-height: 600px` with no
awareness of available viewport height — combined with the opponent
rail, status block, hand row, and action buttons all stacked above/
below it, the total column height regularly exceeds a normal laptop
viewport (confirmed by the user, real play, not a hypothetical).
Dominoes solves a related problem with a JS-measured `ResizeObserver`+
`scaleToFit` (`DominoesTable.tsx`) — but that's solving a DIFFERENT
problem (a variable-size snake layout). Scrabble's board is a fixed
15x15 grid, so the simpler, appropriate fix is CSS-only, not a ported
JS measurement system:

- Cap the board's size using a formula that accounts for viewport
  height, not just width — e.g. replace the flat `max-width: 600px;
  max-height: 600px` with something like `width: min(600px, 56vw,
  56vh); height: min(600px, 56vw, 56vh)` (adjust the `vh` factor as
  needed once you can actually measure the real layout — see
  verification below) so the board shrinks on a short viewport instead
  of forcing the page past 100vh.
- Tighten vertical spacing elsewhere in `.scr-table`/`.scr-table-card`/
  `.scr-opp-rail`/`.scr-status-block` (the top ends of their existing
  `clamp()` ranges) — reduce, don't eliminate, since these already use
  responsive `clamp()` sizing, just re-tune the ranges.
- The opponent rail currently gives every seat a 3-line stacked
  layout (name row / score row / hand-fan row) inside a wrapping grid
  — consider whether this can read correctly in less vertical space
  (e.g., combining the score into the name row) without losing any
  information a player needs. Use your judgment, but the goal is
  measurably shorter, not a redesign for its own sake.
- The hand row and action buttons (Play word/Clear/Exchange/Pass/
  Challenge) must ALWAYS be visible without scrolling — these are the
  primary interactive controls; if anything has to scroll, it should
  be the board or opponent rail, never the controls a player needs on
  every turn.

**Verification requirement for this bug specifically**: after your
changes, take real screenshots (via whatever live-browser method is
available to you — Playwright/chromium-cli/etc.) at two realistic
viewport sizes, 1280×800 and 1440×900, of a 4-seat game's table mid-
game (some board tiles placed, so the layout is representative, not
an empty board). Confirm and show that the full table — header,
opponent rail, board, hand, action buttons — fits without the page
needing to scroll at either size. If it doesn't fully fit at one size,
say so honestly and explain what's still overflowing, don't claim
success you didn't verify.

## Do NOT

- Touch any file outside the four listed.
- Run git, commit, or push.
- Add any new dependency (no layout/animation library — this is CSS
  and existing-pattern JS only).
- Change the bot's overall decision structure (challenge-check order,
  weighted top-candidate selection, exchange/pass fallback) — only the
  correctness of candidate generation itself.
- Port Dominoes' `ResizeObserver`/`scaleToFit` machinery wholesale —
  it solves a different problem; a CSS-based viewport-aware sizing
  fix is what this spec asks for.

## Required tests

`bot.test.ts` (new): the bot, given a rack that CAN spell a real word
at least 3-4 letters long against a realistic board state, must
actually find and place it (not rely on chance) — construct a
deterministic scenario (fixed rack letters, fixed board state, no
RNG) where you know a specific valid word is findable, and assert the
bot's strategy actually finds a placement forming that word or an
equally valid alternative (assert real dictionary validity of
whatever it picks, not a specific exact word if multiple are valid).
Also test: a candidate that would form a valid main word but an
INVALID cross-word must be rejected (construct this scenario
explicitly). Also test blanks are considered as filling a needed
letter, not hardcoded to 'A', when 'A' wouldn't form a valid word.

## Verify before reporting

`npx tsc -b --noEmit`, `npm test -- --run`, `npm run build`, plus the
live-browser verification described in Bug 1 (deal intro shows header)
and Bug 3 (fits at 1280×800 and 1440×900) above — and for Bug 2, in
addition to the deterministic unit tests, play at least one live bot
turn against a non-trivial board state and show (screenshot + the
actual word placed) that it forms a real word, not just that tests
pass. Report the real dictionary word(s) you observed the bot play
live. Report every judgment call (blank-letter search bound, exact
viewport-sizing formula used, opponent-rail compaction choices) beyond
what this spec locked down.
