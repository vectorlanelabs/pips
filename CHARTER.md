# Charter: Poker round 2 — Omaha, Deuces Wild & Ante (2026-09-01)

**Mode:** directed
**Started:** 2026-09-01
**Approved:** user directive 2026-09-01 ("add Omaha as a game variant,
and then I'll play-test everything") on top of the presented house-rules
charter — treated as approval of the presented ambiguity resolutions
plus the Omaha scope addition. Play-testing by the owner follows wrap-up.

Working branch: `charter/poker-omaha-house-rules`. Same crew and rules
as the completed Poker variants charter (see git history / DEVLOG):
lead specs+verifies+reviews (Fable), deepseek:flash implements,
claude:sonnet reviews, nothing merges/pushes without the user's "push".

## Target user
Players of the existing 18-game library who want classic draw poker at
the same table as Hold'em: one "Poker" shelf entry, the host picks
Texas Hold'em / 5-Card Draw / 7-Card Draw from a dropdown in the room,
and everything else (chips, blinds, bots, PeerJS multiplayer) works
exactly like the Hold'em they already have.

## Core use case
The Poker room's dropdown gains **Omaha** (four hole cards, exactly two
play, community board, no-limit like this app's Hold'em, 2-8 seats),
and the room gains its first **house-rules toggle block** (Uno's
pattern): **Deuces Wild** (all four 2s wild, five-of-a-kind above
straight flush, wilds equal to naturals) and **Ante** (REPLACES blinds:
every seat posts 10 before the deal, opening street starts unopened,
action starts left of the button). Both toggles default off, combine
freely, and apply to all four variants.

## Non-goals
- Seven-Card **Stud** (resolution: "7-Card Draw" = draw poker dealt
  seven, best five play at showdown).
- Antes (blinds 5/10 reused), lowball/hi-lo, multiple draw rounds,
  tournament blind escalation, draw-4-with-an-ace.
- Deuces Wild itself — **designed around, not built** (room layout slot
  for a future Uno-style house-rules block; hand evaluator stays the
  single authority on card values so wilds later touch only it).
- Any change to `src/engine/` or `src/card-engine/`.

## Milestones
- M6: Omaha engine — variant plumbing via a new isDrawVariant helper
  (audit every `variant !== 'holdem'` check), 4-card deal, holdem
  street cycle, dedicated exactly-2-hole/exactly-3-board evaluation
  (60 combos), bot strength heuristics, sweeps. The classic gotcha
  (4 suited on board + 1 in hand is NOT a flush) is a required test.
- M7: Omaha screens+wiring — dropdown entry, descriptions, overlay
  bullets, board shows (draw-UI gating keys off isDrawVariant, never
  variant !== 'holdem'), App wiring.
- M8: house-rules engine — houseRules in state ({deucesWild, ante}),
  wild evaluation in BOTH evaluators (draw/holdem best-of and Omaha
  constrained), five-of-a-kind category, ante hand-start path
  (no blinds, unopened opening street), bot deuce-keep rule, chip
  trajectories under antes, sweeps with each rule and both.
- M9: house-rules screens+wiring — Uno-pattern toggle block under the
  dropdown, table indicator chips, ante posting beat replacing the
  blinds beat, App plumbing + broadcast.
- M10: live verification (Omaha hand; deuces hand with a wild win;
  ante hand; combined) incl. bot pacing check; wrap-up for the
  owner's play-test.

## Definition of done
Omaha playable end to end in the dropdown; both house-rule toggles
functional per the resolutions; tests/tsc/build green; M10 live
verification recorded; branch clean and unmerged, awaiting the owner's
play-test and "push".

## Run budget
10 cycles or the milestone list, whichever first.

## Stop criteria
- Definition of done met → wrap-up.
- Any single milestone unresolved after 3 cycles → pivot/pause/re-scope
  decision, not a fourth attempt.
- Spec 60 turns out infeasible or self-contradictory in a way charter
  distillation missed → pause to REQUESTS.md.

## Ambiguity resolutions (locked at approval)
1. Ante REPLACES blinds (10 each; unopened opening street; order left
   of button). "Additive tournament antes" was offered and not chosen.
2. Both house rules available on all four variants, default off,
   combinable.
3. Five of a kind ranks above a straight flush; wilds are equal to
   naturals (no "naturals win ties").
4. Omaha is no-limit (matches this app's Hold'em, not pot-limit),
   2-8 seats, same blinds/chips; house rules apply to it too.
5. Omaha shows no hand-sort toggle (4 cards; holdem treatment).
