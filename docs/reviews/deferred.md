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

## From [battleship-review.md](battleship-review.md)

**Battleship ship-adjacency (no-touch) rule.** `validFleet` (`state.ts:153-172`)
checks board length, ship IDs, exact counts, and straight contiguous geometry,
but never checks whether one ship's cells neighbor another ship's cells. The
placement UI's `fits` (`state.ts:99-101`) only checks occupancy, so two ships
placed directly adjacent — orthogonally or diagonally — are accepted by both
the client preview and the host validator today. Neither the rules overlay
(`BattleshipRulesOverlay.tsx`) nor the spec states a rule either way.

**Question:** should Battleship enforce the traditional "ships cannot touch,
not even diagonally" house rule, or is touching intentionally legal? Two
options:

1. **No-touch (traditional house rule).** Reject a fleet where any two ships'
   cells are orthogonally or diagonally adjacent, in both `validFleet` (host)
   and `fits`/preview (client), and add adjacent/diagonal-contact tests. State
   the rule explicitly in the rules overlay.
2. **Touch-legal (looser, still-valid Battleship variant).** Leave `validFleet`
   and `fits` as they are, but state explicitly in the rules overlay that
   ships may touch, and add an acceptance test so the behavior is a deliberate
   choice rather than an unspecified gap.

---

## From [solitaire-review.md](solitaire-review.md)

**Solitaire Auto-play "safe" copy.** `SolitaireRulesOverlay.tsx` (Klondike/
Draw 3/FreeCell copy) tells the player Auto-play "finishes off every
remaining safe move for you." The actual guarantee `autoCompleteMoves`
provides (now documented in `shared.ts` and proven by a new reversibility
test in `autocomplete.test.ts`) is narrower than that phrase could imply: it
only ever fires once the UI's `noHiddenCardsLeft` gate holds (every card
face up, stock/waste empty, so nothing is hidden to lose), every move it
makes is legal at the moment it's generated, and every move is reversible —
the engine allows moving a foundation's top card back onto a legal tableau/
cell spot, on top of the table's own Undo button. It does **not** guarantee
the sequence is the strategically optimal one: a card it eagerly sends to a
foundation may have had another, mutually exclusive, legal tableau
destination a human might have preferred to keep it in play for. Whether
"safe" is the right word for that — accurate (nothing is lost or hidden,
everything is reversible) vs. potentially overpromising (a player could read
"safe" as "won't cost me the game") — is a copy/product call, not a bug fix,
so the wording itself was left untouched pending this decision.

**Question:** does "finishes off every remaining safe move for you" still
feel like the right description given the narrower guarantee above, or
should the copy be softened (e.g. "finishes off every remaining legal
foundation move for you")?

---
