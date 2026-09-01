# Spec 60 — Poker variants: 5-Card Draw and 7-Card Draw (plan)

One "Poker" shelf entry, Solitaire-style: the room offers a variant
picker and the HOST chooses between **Texas Hold'em**, **5-Card Draw**,
and **7-Card Draw**. This document is the charter-level plan; it splits
into three implementable work orders (60a engine, 60b screens, 60c
wiring) mirroring how Hold'em shipped as specs 55/56/57. Read those
three specs, plus `src/card-games/holdem/` and `src/screens/Holdem*` IN
FULL before implementing any part.

**Naming note (confirm with owner before 60a):** "7-Card Draw" here
means draw poker dealt seven cards with the best FIVE playing at
showdown — the same game as 5-Card Draw with a bigger hand. It is NOT
Seven-Card Stud (no up-cards, no per-street deals). If Stud was the
intent, this plan does not cover it.

## Why this shape

The hard part of any poker variant is the betting engine — no-limit
bet/raise legality, short all-ins and re-raise gating, side pots, chip
trajectories, elimination, the heads-up button rule. Hold'em's
`rules.ts` already solves all of it (spec 55, hardened by 55b), and its
`hand-eval.ts` `evaluateBestHand(holeCards, boardCards)` already picks
the best 5 of up to 7 cards — which IS the 7-Card Draw showdown, and
degenerates correctly to the 5-card case. Both draw variants therefore
live INSIDE the existing engine as a variant, not as a new module:
the street cycle and the deal become variant-dependent, one new action
(DRAW) is added, and every chip-moving line stays untouched and covered
by its existing chip-trajectory tests.

## Locked design

**Variant model.** `PokerVariant = 'holdem' | 'five-draw' | 'seven-draw'`,
carried in `publicState.variant`: host picks in the room, fixed for the
session, `createPokerGame(playerIds, seed, variant, cardBack)`. The
room control is SOLITAIRE'S pattern — a dropdown (`<select
className="input select-chevron">` with the variant's one-line
description rendered beneath it, exactly as `SolitaireRoom` does for
its modes) — NOT Battleship's radio-card house-rule-style picker. This
matters because Poker is about to become the first game with BOTH a
variant selector AND house rules (see "Coming next" below), and it
fixes the app-wide convention:

> **Room-control convention (owner-set, applies to every game from
> here on):** a DROPDOWN (Solitaire's select + description) picks WHICH
> game variant is being played; TOGGLES (Uno's house-rules checkboxes)
> switch optional rules on or off within it. Never a third pattern.

**Battleship migration (small standalone item, may ride with 60b):**
Battleship's current radio-card variant picker predates this convention
and should convert to the Solitaire dropdown — its three modes are
variants, not house rules. Mechanical UI swap in `BattleshipRoom`, no
state or engine changes.

**Rename (60a commit #1, mechanical, zero logic).**
`src/card-games/holdem/` → `src/card-games/poker/`, `Holdem*` screens →
`Poker*`, `createHoldemGame` → `createPokerGame`, `HoldemPublicState` →
`PokerPublicState`, etc. Imports-only commit, reviewed on its own,
BEFORE any behavior change. Three variants living under "holdem" names
is active mislabeling; doing the rename first keeps every later diff
readable. Type aliases for the old names are NOT kept — nothing outside
the app imports them.

**Seats.** Hold'em: 2–8 (unchanged). Draw variants are capped by deck
math (52 cards, no reshuffle, draw up to 3 replacements each):
- 5-Card Draw: **2–6 seats** (6×5 dealt + 6×3 drawn = 48 ≤ 52).
- 7-Card Draw: **2–5 seats** (5×7 dealt + 5×3 drawn = 50 ≤ 52).
Deck exhaustion is therefore impossible; assert it in the engine
rather than writing a reshuffle path.

**Hand flow (both draw variants).** Same chips (1000 start), same 5/10
blinds, same button rotation and heads-up rule, same elimination and
`gameOverWinnerId` as Hold'em — blinds, not antes, because the blinds
machinery exists and is tested (antes can become a house rule later).
Street cycle replaces Hold'em's:

  `firstBet` → `draw` → `secondBet` → `showdown` → `handOver`

- Deal 5 (or 7) cards to each seat, blinds posted first, action starts
  left of the big blind exactly like preflop.
- `firstBet` and `secondBet` reuse the betting actions and street-close
  logic verbatim (FOLD/CHECK/CALL/BET/RAISE — `secondBet` opens with no
  forced bets, so checking around is legal, like the flop).
- `draw`: one rotation, in seat order starting left of the button,
  every NON-FOLDED player (all-in players included — drawing is free)
  takes exactly one `{ type: 'DRAW'; discardIds: string[] }` action,
  0–3 cards. 0 discards = stand pat. Discards leave the game (no
  reshuffle; see seat caps). Replacements come off the deck in order.
  The PUBLIC state records how many cards each player drew (opponents
  read draws as information — "stood pat" is a tell and must be
  visible); the cards themselves stay private.
- If betting closes with everyone remaining all-in, the draw round
  still happens (it is a choice, not a bet), then showdown.
- Showdown: `evaluateBestHand(hand, [])` per remaining player — best 5
  of 5 or best 5 of 7 — then the EXISTING pot/side-pot settlement code
  runs unchanged.

**Bots (60a).** Reuse the Hold'em bot's betting brain with the made-hand
rank (from the evaluator) as its strength input pre-draw and post-draw.
New discard policy, plain and rule-shaped: keep made hands (pair or
better keeps the made cards, draws the rest); keep a 4-flush or
open-ended 4-straight; otherwise keep the highest kicker(s) and draw 3.
No simulation, no equity tables — "one reasonable strategy", matching
the sibling bots.

**Bot pacing (mandatory check, CLAUDE.md).** The draw phase is a new
VISIBLE state change: each player's discard/draw must read as an event
at a full table (5–6 players = up to 5 consecutive bot draws between a
human's turns). Do not inherit `HOLDEM_ACTION_MS`-style constants
unchecked; judge the rhythm with a maxed table of bots before calling
60c done. If the screens add a discard/draw animation (they should —
cards leaving to a muck + replacements arriving, same flight language as
DealIntro), expose a pure duration estimator the host holds bots
against, exactly like `estimateDealIntroMs` — never a guessed buffer.
Sound: reuse the existing card-play/deal cues; the next bot's action
must not clip the current one's sound.

## Work orders

**60a — engine.** Files: everything under `src/card-games/poker/`
(post-rename) and its tests. The rename commit, then: `variant` in
state and `createPokerGame`, the draw street cycle, the DRAW action and
its validation (turn, phase, 0–3 cards, ownership, once per draw
round), drawn-count in public state, showdown via the existing
evaluator, bot discard policy + betting reuse. Testing bar inherited
from spec 55: every chip-moving branch keeps its hand-traced
chip-trajectory tests (they must pass UNCHANGED — that is the proof the
betting engine didn't move); new tests for the draw round (draw order,
stand pat, all-in players draw, fold-before-draw, deck-math assertion,
7-card showdown picks the right 5) and a bot-vs-bot full-match sweep per
variant asserting every proposed action is accepted by the validator
(the Phase 10 freeze lesson — `runPokerBotTurn` outcome must never be
rejected).

**60b — screens.** `PokerRoom` gets the variant DROPDOWN in Solitaire's
exact pattern: host-editable `<select>`, the selected variant's
description line beneath it, guests see the current choice read-only
(borrow the guest-read-only treatment from Uno's house-rules block —
Solitaire has no guests to copy from). Option labels: "Texas Hold'em" /
"5-Card Draw" / "7-Card Draw"; description lines: "Community cards,
no-limit betting. 2 to 8 players." / "One draw, best five wins. 2 to 6
players." / "Seven dealt, best five play. 2 to 5 players." (plain
voice, no em dashes). A variant whose seat cap is below the current
seated count renders as a disabled option; Start is gated on the
selected variant's min/max. `PokerTable` branches: no board row for draw variants; the
draw phase gets select-then-confirm discards (tap cards to select, one
confirm button reading "Draw 2" / "Stand pat" — the app-wide
select-then-confirm convention), the 5/7-card hand gets the suit/rank
sort toggle (Rummy's convention — a 2-card Hold'em hand didn't need
one, a 7-card hand does), opponents show drawn-count captions ("drew 2",
"stood pat"), and showdown reveal reuses Hold'em's staging (including
the fresh-showdown delay and winner highlight). DealIntro runs for
every variant (already wired; flight count scales with hand size — the
estimator already takes the count). `PokerRulesOverlay` becomes
variant-keyed like `SolitaireRulesOverlay(mode)`. Landing: the "Texas
Hold'em" CARDS tile becomes **"Poker"** ("no-limit, 2–8 players"), one
tile, like Solitaire.

**60c — wiring.** App.tsx: variant state in the room flow (host sets,
broadcast to guests in the lobby view the way Uno broadcasts its
house-rules choices), passed to
`createPokerGame`; the bot loop learns nothing new except the draw-turn
case (the strategy returns DRAW; the same never-dead-end rejection
handling applies) and the draw-animation hold from 60b's estimator.
Guest action plumbing gains the DRAW intent. Seat-cap enforcement moves
variant-aware (add-bot and join both respect the selected variant's
max).

## Coming next (design around it, do not build it)

A **Deuces Wild** house rule is planned immediately after this ships,
making Poker the first game area with BOTH a variant dropdown and a
house-rules section. Consequences for this spec's work orders:

- 60b lays out `PokerRoom` so a "House rules" block (Uno's pattern:
  host-toggled checkboxes with label + description, guests read-only,
  `UNO_HOUSE_RULE_DEFS`-style defs table) slots in under the variant
  dropdown without a redesign. Do not render an empty section now —
  just don't design the column so tightly that adding it moves
  everything.
- 60a keeps `hand-eval.ts` extensible enough that wild cards are a
  change confined to the evaluator (and DRAW/showdown validation), not
  a rework of `rules.ts` — concretely: nothing outside `hand-eval.ts`
  may assume a card's rank/suit maps to exactly one evaluated value.
- State should carry the variant and (later) house rules as separate
  fields — do not fold the variant into a rules record.

## Out of scope (explicitly)

- Antes, multiple draws, lowball/hi-lo, wild cards, draw-4-with-an-ace:
  all possible later house rules, none now.
- Seven-Card Stud (see naming note).
- Tournament blinds escalation — same cash-table model as Hold'em.
- Touching `src/engine/` or `src/card-engine/` — nothing here needs it.
