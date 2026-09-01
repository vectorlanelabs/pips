# Charter: Poker variants — 5-Card Draw & 7-Card Draw (2026-08-31)

**Mode:** directed
**Started:** 2026-08-31
**Approved:** by the user in-session, 2026-08-31 ("approved"), after
presentation of milestones and ambiguity resolutions.

Source: `specs/60-poker-draw-variants.md` (charter-level plan written and
revised with the owner this session) plus the owner's room-control
convention: variant selection is a Solitaire-style dropdown; house rules
are Uno-style toggles; never a third pattern. Working branch:
`charter/poker-variants` (off the spec branch, in the main working
tree — no worktree instruction this run). Commits land on the branch
freely; **nothing merges to `main` or pushes to origin without the
user's explicit "push"** (standing project rule; a Pages deploy fires on
push to main).

Crew per `/model-routing` (user-directed): the lead (Fable, this
session) specs, dispatches, verifies, reviews-gates, and does all git
and state-file work; `deepseek -m deepseek-v4-flash` writes all product
code and tests (fallback: `codex exec`); `claude --model sonnet
--effort medium` runs the Oscar-style adversarial review on every
code-touching slice; debugging stays with the lead. Both crew probes
returned OK at charter start.

## Target user
Players of the existing 18-game library who want classic draw poker at
the same table as Hold'em: one "Poker" shelf entry, the host picks
Texas Hold'em / 5-Card Draw / 7-Card Draw from a dropdown in the room,
and everything else (chips, blinds, bots, PeerJS multiplayer) works
exactly like the Hold'em they already have.

## Core use case
A host opens Poker, picks 5-Card Draw from the dropdown, seats a mix of
friends and house bots, and plays hands end to end — deal, first
betting round, draw (select discards, confirm), second betting round,
showdown with correct pot/side-pot settlement — with the same pacing,
deal intro, and select-then-confirm conventions as every sibling game.

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
- M0: mechanical rename `card-games/holdem/` → `poker/`, `Holdem*`
  screens → `Poker*`, exported identifiers (`createHoldemGame` →
  `createPokerGame`, types, `HOLDEM_*` constants). Zero behavior
  change; full suite passes untouched. User-visible copy ("Texas
  Hold'em"), CSS class names, and App-local variable names are OUT of
  scope for the rename.
- M1: engine (spec 60a) — `variant: 'holdem' | 'five-draw' |
  'seven-draw'` in state and `createPokerGame`; draw-variant street
  cycle `firstBet → draw → secondBet → showdown → handOver`; `DRAW`
  action (0–3 discards, once per draw round, all-in players still
  draw, folded players skip); public per-player drawn counts; seat
  caps 2–6 (five-draw) / 2–5 (seven-draw) with deck-math assertion;
  showdown via existing `evaluateBestHand`; bot discard policy +
  betting reuse; bot-vs-bot full-match sweeps per variant asserting
  every proposed action is accepted. Hold'em chip-trajectory tests
  pass UNCHANGED.
- M2: screens (spec 60b) — PokerRoom variant dropdown (Solitaire
  select + description, guests read-only), draw-phase
  select-then-confirm UI ("Draw 2" / "Stand pat"), suit/rank sort
  toggle for 5/7-card hands, opponent drawn-count captions, showdown
  staging reuse, variant-keyed rules overlay, Landing tile "Poker".
- M3: wiring (spec 60c) — variant through room flow and
  `createPokerGame`, guest DRAW plumbing, bot loop draw case with a
  pure animation-duration estimator the host holds bots against,
  variant-aware seat caps on join/add-bot.
- M4: BattleshipRoom migrates from radio-card variant picker to the
  Solitaire dropdown (convention item; UI only).
- M5: live verification in a real browser at max seats per variant
  including the CLAUDE.md bot-pacing check at a full table; wrap-up.

## Definition of done
All three variants playable end to end (host, guests, bots) with the
host choosing via the dropdown; Battleship migrated; `npx tsc -b
--noEmit`, `npm test`, `npm run build` all green; M5 live verification
recorded in the devlog. Everything committed on the charter branch,
NOT merged or pushed — wrap-up hands the "push" decision to the user.

## Run budget
The milestone list or 12 cycles, whichever comes first. On exhaustion:
land in-flight work, clean tree, cancel the scheduled safety net,
request renewal in REQUESTS.md and chat.

## Stop criteria
- Definition of done met → wrap-up.
- Any single milestone unresolved after 3 cycles → pivot/pause/re-scope
  decision, not a fourth attempt.
- Spec 60 turns out infeasible or self-contradictory in a way charter
  distillation missed → pause to REQUESTS.md.

## Ambiguity resolutions (approved at sign-off)
1. "7-Card Draw" = draw poker dealt seven, best five at showdown — not
   Stud.
2. Blinds (5/10), not antes.
3. Draw up to 3 replacements; seat caps 2–6 / 2–5 by deck math
   (52-card deck, no reshuffle: 6×5+6×3=48; 5×7+5×3=50).
4. All-in players still take their draw turn (drawing is free).
5. Deuces Wild designed-around only.
6. Rename scope as in M0 (exported identifiers yes; copy/CSS
   classes/App locals no).
