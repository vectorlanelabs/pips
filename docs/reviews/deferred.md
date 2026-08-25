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

## Open items (1 game, 1 question)

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

**Decision (2026-08-25):** yes — add `@testing-library/react` (+ `jsdom`)
project-wide and write the missing Rummy screen tests as the first usage.
In progress.
