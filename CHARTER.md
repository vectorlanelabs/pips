# Charter: Scrabble (2026-08-22)

**Mode:** directed
**Started:** 2026-08-22

Source spec: `specs/47-scrabble-engine.md`, already written by the lead
with every design decision locked (dictionary generation, board
layout, tile distribution, state shape, placement/scoring/challenge
rules, bot algorithm) after reading the closest sibling games in full
(`board-games/dominoes`, `board-games/chess`) per `CLAUDE.md`'s
pattern-matching requirement. This charter covers the whole Scrabble
build through a playable game — engine, screens, wiring — mirroring
the Skip-Bo charter's 3-spec sequencing (engine / screens / wiring),
not just spec 47 alone. Screens and wiring specs are written by the
lead in later cycles, same as Skip-Bo's specs 41/42 were written after
40 landed, not upfront.

Pre-approved by the user at invocation ("orchestrate this spec
implementation right now... use the autonomous-dev-loop skill") —
running with the lead driving cycles, checking in via chat heartbeats
rather than blocking on approval per cycle, same routing as every
prior charter's "/autonomous-dev-loop like always" pre-approval.

## Target user
Players of this site's existing 15+ game library who want a word game
with real depth — Hangman's 36-word list was explicitly called out by
the user as "more like a POC than a playable game." Scrabble is the
replacement word-game offering.

## Core use case
2-4 players (including bot seats) play a full game of Scrabble to
completion: place words against a real ~173k-word dictionary, score
per standard letter/word multipliers, challenge a suspect word (a real
mechanic with teeth, not decorative — see spec 47's locked "bot never
bluffs, humans can" design), game ends on bag-empty-plus-emptied-rack
or a stuck four-rotation of passes.

## Non-goals
- No changes to any other game.
- No new runtime dependencies (the DAWG dictionary is a generated
  static asset + a build-time-only script, not a package).
- No backend — explicitly ruled out during viability discussion (a
  static, lazy-loaded client asset solves the dictionary problem
  without one; see the conversation this charter followed from).
- No tournament word lists (TWL/SOWPODS/NWL) — licensing risk; ENABLE1
  only.
- No "bluffing bot" — v1 bot only ever plays dictionary-valid words,
  documented as a deliberate simplification in spec 47.

## Milestones
- M0 (spec 47, already written): dictionary generator + asset, board
  premium-square layout, state/rules/bot engine, full test coverage.
  No React, no screens, no wiring.
- M1 (spec to be written after M0 lands): screens — ScrabbleRoom/
  Table/Results/RulesOverlay, board rendering, blank-tile popup (user-
  locked: type the letter at placement time, render it on the tile
  with an obviously lighter/different treatment than a normal tile).
- M2 (spec to be written after M1 lands): App.tsx/Landing.tsx/README
  wiring — lobby, host/guest PeerJS flow, bot-per-seat, pacing
  (BASE_MS-scaled bot think time, checked at a maxed 4-seat table per
  CLAUDE.md's mandatory pacing-at-capacity check).

## Definition of done
Engine tests green (M0) covering deal/placement/scoring/challenge/
end-game per spec 47's "Verify before reporting" list. Live 2-seat and
4-seat match verified by the lead in-browser (deal, placement, a real
challenge exchange, blank-tile popup, bot pacing at 4 seats not
racing ahead of animations). tsc/tests/build green throughout. Every
code-touching slice reviewed adversarially by the lead (no `ai-grouch-
claude`/Oscar skill installed in this environment — using this skill's
fallback reviewer persona from `references/review.md`, at the lead's
own model, which is stronger than the Haiku implementer). Landed as
separate commits (one per spec, matching Skip-Bo's precedent),
**committed locally on each landing but NOT pushed/merged to `main`
without the user's explicit "push"** — this project's `CLAUDE.md` git
workflow is the authoritative override here, superseding this skill's
default "push if a remote exists" (confirmed against this repo's own
history: every prior charter's REQUESTS.md shows push always gated on
an explicit human "push" after wrap-up, never automatic).

## Run budget
25 cycles or the 3-milestone list, whichever comes first (directed-
mode default — no explicit limit given at invocation).

## Stop criteria
- Stop when the definition of done is met (all 3 milestones landed and
  live-verified).
- Any single roadmap item unresolved after 3 cycles forces a pivot/
  pause/re-scope decision.
- Pause to `REQUESTS.md` if a locked design decision in spec 47 turns
  out to be infeasible once implemented (e.g. DAWG asset size wildly
  exceeds the ~300-800KB estimate) — re-scope, don't silently drop the
  constraint.

## Ambiguity resolutions
None beyond what spec 47 itself already locked (see that file) — this
charter's own milestones/non-goals are a restatement of decisions
already made across the preceding conversation (challenge mechanic
required, 4-player max, blank-tile popup UX, no backend, DAWG static
asset), not new resolutions.

## Model routing
Implementer: Haiku (the documented fallback in this skill's own prior
charters when "deepseek" isn't available — deepseek is not one of this
session's Agent-tool model options, so fallback applies from cycle 1,
not as a later degradation). Reviewer: the lead's own model (this
session's Sonnet), using the fallback persona in `references/
review.md` since no `ai-grouch-claude` skill is installed here.
