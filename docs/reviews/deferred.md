# Deferred items — pending product judgment

Items landed here are *not* bugs against already-stated intent — they're places
where closing the finding requires a decision only the project owner should
make (a game-rule call, a strategy/feel call, or a scope call like adding new
dev dependencies). Each entry stays open until visited. We review this whole
file at the end of the review-fix pass, all at once.

---

## From [rummy-review.md](rummy-review.md)

**Rummy component test coverage.** Closing the "test suite doesn't cover the
App/screen playability contract" finding fully means adding `jsdom` + a React
testing library as new dev dependencies — a project-wide tooling decision
(would benefit every game, not just Rummy), not a Rummy-scoped fix. `CLAUDE.md`
reserves new-dependency decisions for an explicit spec.

**Question:** is component-level render testing worth adding project-wide, and
if so, which library?

---

## From [wahoo-review.md](wahoo-review.md)

**Wahoo bot "rush home" threshold.** `bot.ts` uses track position ≥52 as a
strategy cutoff for how eagerly the bot should prioritize rushing a marble
home vs. improving board position. The engine's actual win threshold is
`LANE_START = 63`; using 63 as the *win-check* was a straight bug and is
fixed. But changing the *strategy* cutoff to 63 would materially change how
aggressively the bot plays in the 52–62 range — that's a feel/strategy
decision, not a correctness bug.

**Question:** should the bot's "rush home" priority threshold change, and if
so to what?

**Wahoo `wahooActorKey` fragility.** `${stage}:${turn.turnNumber}` won't
retrigger the bot loop for a same-turn state change that doesn't bump
`turnNumber` (e.g. a plain ROLL). Not a live bug today — only a risk for a
*future* same-turn action. A real fix needs a shared "actor generation"
concept added to `src/engine/turn-engine.ts`, which is cross-game
architecture, not a Wahoo-only patch.

**Question:** worth a cross-game turn-engine change now, or wait until a game
actually needs same-turn re-entry?

---
