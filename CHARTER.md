# Charter: Wahoo two colors each (2026-09-01)

**Mode:** directed
**Started:** 2026-09-01
**Approved:** user directive 2026-09-01 ("orchestrate. /autonomous-dev-loop
and /model-routing") immediately after interactively locking every design
decision for specs 61/62 via four answered questions (win condition,
opponent-identical own-color semantics, lobby auto-off, unchanged turn
flow). Treated as pre-approval of exactly that scope — the specs ARE the
PRD. Play-testing by the owner follows wrap-up.

Working branch: `charter/wahoo-two-colors`. Standard crew: lead
specs+verifies+reviews (Fable), deepseek:flash implements, claude:sonnet
reviews (Oscar). Nothing merges/pushes without the user's "push".

## Target user
Two players at a Wahoo table who want the fuller four-color board:
each runs two colors on opposite corners, moving any marble they control
each roll, with their own colors treating each other exactly like
opponents (jump, bump — even forced self-bumps).

## Core use case
Wahoo's first house rule, `twoColors`, introduced via the established
Uno-pattern toggle block (specs 34c/45/46 pathway): host toggles it in
the room (2-player only, visibly auto-off when a 3rd seat fills), the
engine rekeys marble maps by marble SET with a `setOwners` map (identity
in normal games), win = all eight home, bot never chooses a self-bump
while alternatives exist.

## Non-goals
- Any variant dropdown (this is a house rule per the room-control
  convention), any other new Wahoo rule, board.ts geometry changes,
  pacing-constant changes, other games' files.
- 3-4 player two-color play (defensively forced off in the engine).

## Milestones
- **M1** — spec 61: engine (state/rules/bot + two-colors.test.ts;
  set-keyed data model, house-rule scaffolding, ≥16 tests, regression
  identity when off).
- **M2** — spec 62: screens+wiring (WahooRoom toggle block + App lobby
  plumbing mirroring Uno, set-aware table, rules-overlay bullet,
  results check) **including the live browser pass**: lobby auto-off
  on 3rd seat, both colors selectable in one roll, self-bump status
  line, full game to a real all-eight win, and the CLAUDE.md-mandated
  bot pacing check with a bot running two colors.

## Definition of done
Both specs landed per their own "Verify before reporting" sections;
tests/tsc/build green repo-wide; M2 live verification recorded in the
devlog; branch clean and unmerged, awaiting the owner's play-test and
"push".

## Run budget
6 cycles or the milestone list, whichever first.

## Stop criteria
- Definition of done met → wrap-up.
- Either milestone unresolved after 3 cycles → pivot/pause/re-scope
  decision, not a fourth attempt.
- The set-keyed data model turns out to conflict with something the
  specs missed in a way that forces a redesign → pause to REQUESTS.md
  (a redesign is a lead/user decision, not an implementer improvisation).

## Ambiguity resolutions (locked at spec time, with the user)
1. Win = ALL EIGHT marbles home; one finished color does not end it.
2. Own colors are opponents for EVERY movement rule: jumping, bumping,
   center bumps, start-space protection. Self-bumps legal and forced
   when they're the only move (no voluntary pass exists).
3. Lobby: toggle visibly auto-flips off (and greys) when seats > 2;
   host may re-enable at 2; engine forces it off for 3-4 players as
   backstop.
4. Turn flow unchanged: one roll, one marble, 6 = extra roll,
   triple-six bust sends home the chain's last-moved marble regardless
   of color.
