# Deferred items — pending product judgment

## What this file is

This is the handoff file for the tail end of a multi-game adversarial-review
fix pass (see `docs/reviews/` — each `<game>-review.md` is an Oscar/ai-grouch
review of one game). Every finding across all 16 reviewed games has been
either fixed and verified, or landed here because closing it requires a
decision only the project owner can make — a game-rule call, a bot
strategy/feel call, or a scope call (e.g. adding a new dev dependency).
Nothing in this file is a known bug; every item is a deliberate open question.

**If you are an agent picking this up:** do not resolve any item yourself by
guessing. Work through the open items below **with the user, one at a time**
— ask the question, wait for their answer, then implement exactly what they
chose. Don't batch-ask all of them in one message unless the user asks you
to; that's an option for them to request, not a default. After the user
answers, revisit that game's original review file (linked in the item's
heading, e.g. `docs/reviews/wahoo-review.md`) for the full original context
(evidence, line numbers, suggested fix) before implementing.

## Repo context

- All prior fixes from this review pass live on branch
  `fix/review-tier1-rummy-wahoo-ttt`, pushed to `origin` and merged into
  `main` as of 2026-08-25. Work on `main` (or a fresh branch off it) unless
  told otherwise — there is no separate worktree/branch to find these fixes
  on anymore.
- Repo constraints live in `CLAUDE.md` at the repo root — read it before
  touching any file. In particular: every work request gets its own branch
  off `main`; commit freely; merging to `main`/pushing needs explicit
  permission from the user.
- Verification bar for every change in this repo: `npx tsc -b --noEmit`,
  `npm run build`, and `npm test` (full suite) must all stay clean. Run them
  yourself after implementing a resolution — do not trust "should work."

## Closing out an item

When the user has decided an item and you've implemented it:

1. Update the game's engine/tests/copy per their decision (see each item's
   "Question" and any numbered options for the concrete implementation
   shape).
2. Run `npx tsc -b --noEmit`, `npm run build`, `npm test` — confirm clean.
3. Delete that item's entry from this file.
4. Open the corresponding `docs/reviews/<game>-review.md` file. If this was
   the *only* open item left in that file's "Resolution" note, delete the
   whole review file (matching the convention already used throughout this
   pass — see git log on `main` for examples, e.g. "Remove
   docs/scrabble-review.md now that all findings are resolved"). If other
   items from that same file are still open here, just update its
   "Resolution" section to drop the now-closed item from the open list.
5. Once this file has zero items left, delete `docs/reviews/deferred.md`
   itself in the same commit that closes the last item.
6. Commit on a feature branch off `main` per `CLAUDE.md`'s git workflow; ask
   before merging/pushing.

## Open items (5 games, 7 questions)

---

## From [rummy-review.md](rummy-review.md)

**Status:** open

**Rummy component test coverage.** Closing the "test suite doesn't cover the
App/screen playability contract" finding fully means adding `jsdom` + a React
testing library (e.g. `@testing-library/react`) as new dev dependencies — a
project-wide tooling decision (would benefit every game's screens, not just
Rummy's), not a Rummy-scoped fix. `CLAUDE.md` reserves new-dependency
decisions for an explicit spec, so this pass didn't add one unilaterally.
Relevant files: `src/screens/RummyTable.tsx`, `src/screens/RummyResults.tsx`,
`src/screens/RummyRoom.tsx` (currently untested at the component-render
level — same gap exists for every other game's screens, since none of them
have this tooling either).

**Question:** is component-level render testing worth adding project-wide,
and if so, which library (`@testing-library/react` is the standard choice,
but confirm)? If yes: add the dependency via its own spec, wire it into the
existing `vitest` config, and write the missing Rummy screen tests as the
first real usage. If no: close this item as "declined," no code change.

---

## From [wahoo-review.md](wahoo-review.md)

**Status:** open (2 sub-items)

**1. Wahoo bot "rush home" threshold.** `src/board-games/wahoo/bot.ts` uses
track position `≥52` as a strategy cutoff for how eagerly the bot should
prioritize rushing a marble home vs. improving board position. The engine's
actual win threshold is `LANE_START = 63` (`src/board-games/wahoo/board.ts`);
using 63 for the bot's own *win-check* was a straight bug and is already
fixed. But changing the *strategy* cutoff itself to 63 would materially
change how aggressively the bot plays in the 52–62 track range — that's a
feel/strategy decision, not a correctness bug, so it was left at 52.

**Question:** should the bot's "rush home" priority threshold move from 52
to 63 (or some other value), and if so why — is 52 too eager, too passive,
or fine as-is? Implementation is a one-constant change in `bot.ts` plus
updating whatever test currently pins the 52 behavior.

**2. Wahoo `wahooActorKey` fragility.** In `src/App.tsx`, the key
`${stage}:${turn.turnNumber}` used to detect a new bot-actionable state won't
retrigger the bot loop for a same-turn state change that doesn't bump
`turnNumber` (e.g. a plain ROLL that doesn't end the turn). Not a live bug
today — only a risk for a *future* same-turn action added to Wahoo. A real
fix needs a shared "actor generation" concept added to
`src/engine/turn-engine.ts`, which is cross-game architecture, not a
Wahoo-only patch.

**Question:** worth a cross-game turn-engine change now (touches every game
using `turn-engine.ts`, needs its own scoped spec), or wait until a specific
game actually needs same-turn re-entry and fix it then? Recommend waiting
unless the user has a concrete near-term game in mind that needs this.

---

## From [battleship-review.md](battleship-review.md)

**Status:** open

**Battleship ship-adjacency (no-touch) rule.** `validFleet`
(`src/board-games/battleship/state.ts`, roughly lines 153-172) checks board
length, ship IDs, exact counts, and straight contiguous geometry, but never
checks whether one ship's cells neighbor another ship's cells. The placement
UI's `fits` helper (same file, roughly lines 99-101) only checks occupancy,
so two ships placed directly adjacent — orthogonally or diagonally — are
accepted by both the client preview and the host validator today. Neither
the rules overlay (`src/screens/BattleshipRulesOverlay.tsx`) nor any spec
states a rule either way.

**Question:** should Battleship enforce the traditional "ships cannot touch,
not even diagonally" house rule, or is touching intentionally legal? Two
concrete options:

1. **No-touch (traditional house rule).** Reject a fleet where any two
   ships' cells are orthogonally or diagonally adjacent, in both
   `validFleet` (host) and `fits`/preview (client), and add adjacent/
   diagonal-contact regression tests. State the rule explicitly in the
   rules overlay.
2. **Touch-legal (looser, still-valid Battleship variant).** Leave
   `validFleet` and `fits` as they are, but state explicitly in the rules
   overlay that ships may touch, and add an acceptance test so the behavior
   is a deliberate, tested choice rather than an unspecified gap.

---

## From [solitaire-review.md](solitaire-review.md)

**Status:** open

**Solitaire Auto-play "safe" copy.** `src/screens/SolitaireRulesOverlay.tsx`
(Klondike/Draw 3/FreeCell copy) tells the player Auto-play "finishes off
every remaining safe move for you." The actual guarantee
`autoCompleteMoves` provides (documented in
`src/card-games/solitaire/shared.ts` and proven by a reversibility test in
`src/card-games/solitaire/autocomplete.test.ts`) is narrower than that
phrase could imply: it only ever fires once the UI's `noHiddenCardsLeft`
gate holds (every card face up, stock/waste empty, so nothing is hidden to
lose), every move it makes is legal at the moment it's generated, and every
move is reversible — the engine allows moving a foundation's top card back
onto a legal tableau/cell spot, on top of the table's own Undo button. It
does **not** guarantee the sequence is the strategically optimal one: a card
it eagerly sends to a foundation may have had another, mutually exclusive,
legal tableau destination a human might have preferred to keep it in play
for. Whether "safe" is the right word for that — accurate (nothing is lost
or hidden, everything is reversible) vs. potentially overpromising (a player
could read "safe" as "won't cost me the game") — is a copy/product call, so
the wording itself was left untouched.

**Question:** does "finishes off every remaining safe move for you" still
feel like the right description given the narrower guarantee above, or
should the copy be softened (e.g. "finishes off every remaining legal
foundation move for you")? Implementation is a one-line copy change in
`SolitaireRulesOverlay.tsx` once decided.

---

## From [yahtzee-review.md](yahtzee-review.md)

**Status:** open

**Yahtzee Joker rule after a zeroed Yahtzee box.** `scoreCategory` in
`src/games/yahtzee.ts` treats the Joker (five-of-a-kind scoring in an open
lower box once the Yahtzee box is no longer open) as available whenever
`card.yahtzee !== undefined` — that includes a Yahtzee box that was
deliberately scored as a 0, not just one that scored the real 50. This is
now documented as-is in the rules overlay (`src/data/rules.ts`) and locked
in by existing tests (`src/games/yahtzee.test.ts`), so players can at least
see what the app currently does. Whether that specific case — Joker scoring
still being available after a *zeroed* Yahtzee box — is the intended
standard-Yahtzee house rule, versus Joker scoring that should only unlock
after an actual 50-point Yahtzee, is a rule call this pass did not make.

**Question:** should a zeroed-out Yahtzee box still unlock Joker scoring in
the lower section, or should Jokers require an actual scored (50-point)
Yahtzee first? If the latter, `scoreCategory`'s `joker` predicate in
`src/games/yahtzee.ts` and the tests in `src/games/yahtzee.test.ts` that
currently lock in the zeroed-box behavior need to change together, and the
rules-overlay copy in `src/data/rules.ts` needs to be corrected to match.

---

## From [phase10-review.md](phase10-review.md)

**Status:** open

**Phase 10 Skip-card rule contradiction.**
`src/screens/Phase10RulesOverlay.tsx` says a discarded Skip skips the
opponent's next turn "once per player per round." The `DISCARD_CARD` handler
in `src/card-games/phase10/rules.ts` has no per-round Skip-target tracking
at all: every discarded Skip calls `skipNext`, unconditionally, every time.
The existing integration tests explicitly codify the repeat behavior as
correct (`src/card-games/phase10/phase10.test.ts`, test named
`'discarding a second Skip the same round skips again'`) — this isn't an
oversight, it's a prior deliberate implementation choice that the overlay
copy was never brought in line with. In a 3-6 player game, a player can be
skipped repeatedly in the same round; in a 2-player game, the same opponent
can be denied every intervening turn by repeatedly discarding Skips.

**Question:** which behavior is actually intended?

1. **Once-per-player-per-round (matches the overlay today).** Add
   round-scoped tracking of which target/player has already been skipped
   this round (in `src/card-games/phase10/rules.ts`), reject a repeat
   `DISCARD_CARD` of a Skip against an already-skipped target with a
   surfaced reason (or simply don't re-apply `skipNext` for it — the
   discard itself still succeeds, only the skip effect doesn't reapply),
   reset the tracking in `START_NEXT_ROUND`, and replace the test named
   `'discarding a second Skip the same round skips again'` (and any sibling
   test asserting the same thing) with tests asserting the restriction.
2. **No restriction (matches the engine today).** Leave `rules.ts` and the
   existing tests as they are, and correct the
   `Phase10RulesOverlay.tsx` bullet to describe what actually happens (drop
   "once per player per round" — every discarded Skip skips the next turn,
   full stop).
