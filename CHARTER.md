# Charter: Blackjack + Texas Hold'em (2026-08-23)

**Mode:** directed
**Started:** 2026-08-23

Source: user invocation via `/model-routing Plan, design, implement, test,
deploy: Texas Hold 'Em and Blackjack. Ask me no questions. Decide for
yourself about starting chip amounts, bet minimums and limits, etc. -
every game starts with a fresh set of chips. Don't worry about tracking
values between games.` Running in an isolated git worktree
(`.claude/worktrees/poker-blackjack-loop`, branch
`worktree-poker-blackjack-loop`) per explicit mid-invocation instruction
("do this on a completely isolated worktree") — no changes land on the
main working tree or `main` branch until merge is explicitly authorized.

Both games are genuinely new territory for this codebase: no existing
game has chips, bets, or a house/dealer role distinct from a seated
player. Closest siblings by shape, read in full before any spec was
written: `src/card-games/rummy/` + `src/screens/Rummy*.tsx` (N-player
turn order, host-authoritative state, per-seat private hand delivery),
`src/card-games/solitaire/` (single-deck deal conventions), and
`src/components/DealIntro.tsx` (the shared shuffle/deal animation every
card game uses — both new games get it, same as every sibling). The
generic `src/engine/turn-engine.ts` (`TurnState`/`advanceTurn`) is reused
for seat-order action rotation in both games' betting/action rounds,
consistent with `CLAUDE.md`'s bottom-layer engine.

## Target user
Players of this site's existing 16-game library who want the two most
universally recognized card games — a casino table-stakes group game
(Blackjack, played against the house) and a competitive multi-way betting
game (Texas Hold'em) — playable serverlessly with friends or bots, no
real money at stake.

## Core use case
2-6 players (Blackjack) or 2-8 players (Hold'em), any mix of humans and
house bots, join a lobby, each start with a fresh stack of chips, and
play hand after hand — placing bets, taking actions in turn, watching
outcomes resolve — until they choose to leave or (Hold'em only) get
eliminated. No chip value is ever persisted across a fresh game start;
this is explicitly the user's own instruction, not an oversight.

## Non-goals
- No real-money stakes, no persistence of chip counts between separate
  game sessions/rematches, no account/ledger system.
- No tournament structure (no escalating blinds, no multi-table
  Hold'em) — a single fixed-blind cash-game-style table for Hold'em.
- No side bets beyond Blackjack's standard insurance (no perfect pairs,
  21+3, etc.).
- No resplitting in Blackjack (max one split per hand, i.e. at most 2
  resulting hands) and no double-after-split — documented v1
  simplifications, same spirit as Scrabble's "bot never bluffs."
- No changes to any other existing game.
- No new runtime dependencies — hand evaluation (poker) and shoe/payout
  math (blackjack) are hand-written in `src/card-games/`, not a library.

## Milestones
Blackjack ships first (simpler: no inter-player interaction, no side
pots) to establish the chip/bet UI conventions Hold'em then reuses.

- M0 (spec 52): Blackjack engine — `src/card-games/blackjack/`
  (shoe/shuffle, state, rules: bet → deal → per-seat hit/stand/double/
  split → dealer play → payout, insurance), bot basic-strategy hit/
  stand only (no bot double/split, documented simplification), full
  test coverage. No React, no screens, no wiring.
- M1 (spec 53, after M0 lands): Blackjack screens — Room (lobby, seat
  picker, bet-min/max display), Table (bet input, per-seat hand
  rendering incl. split hands, dealer hand w/ hole card, hit/stand/
  double/split/insurance controls gated to the acting seat), Results
  (per-seat win/push/loss and chip delta), RulesOverlay. Deal-intro
  reused per `CLAUDE.md`'s pattern-matching rule.
- M2 (spec 54, after M1 lands): Blackjack wiring — App.tsx lobby/
  broadcast/bot-per-seat, Landing.tsx shelf tile, route.ts, README.
  Live-verified in-browser per CLAUDE.md's mandatory bot-pacing-at-
  capacity check (6-seat table).
- M3 (spec 55, after M2 lands): Texas Hold'em engine —
  `src/card-games/holdem/` (deck, state, hand evaluator, betting-round
  rules incl. min-raise/all-in/side-pot math, blind rotation, bust/
  elimination), bot heuristic (starting-hand strength + pot-odds
  check), full test coverage. No React, no screens, no wiring.
- M4 (spec 56, after M3 lands): Hold'em screens — Room, Table (board
  cards, per-seat stacks/bets, action controls: fold/check/call/bet/
  raise/all-in, pot/side-pot display), Results (elimination order /
  final standings), RulesOverlay.
- M5 (spec 57, after M4 lands): Hold'em wiring — App.tsx/Landing.tsx/
  route.ts/README, bot-per-seat, live-verified per CLAUDE.md's bot-
  pacing rule at an 8-seat table.
- M6 (spec 58, only if live verification surfaces gaps): polish, same
  role Scrabble's spec 50 played — not pre-scheduled busywork.

## Definition of done
Both games fully playable end to end (M0-M5 landed), tsc/tests/build
green throughout, every code-touching slice adversarially reviewed by
the lead (no `ai-grouch-claude` installed in this environment — using
this skill's fallback reviewer persona), and both games live-verified in
the browser by the lead personally at capacity seat counts for the
mandatory bot-pacing check. Landed as one commit per spec on
`worktree-poker-blackjack-loop`, **not merged into `main` or pushed
without the user's explicit "push"** per this project's `CLAUDE.md` git
workflow — unchanged by running in a worktree.

## Run budget
25 cycles or the 6-milestone list (M0-M5), whichever comes first
(directed-mode default; M6 is conditional and not counted against this).

## Stop criteria
- Stop when the definition of done is met (M0-M5 landed and both games
  live-verified).
- Any single roadmap item unresolved after 3 cycles forces a pivot/
  pause/re-scope decision.
- Pause to REQUESTS.md if a locked design decision below turns out to be
  infeasible once implemented.

## Ambiguity resolutions
The user explicitly delegated all numeric/rule decisions ("decide for
yourself about starting chip amounts, bet minimums and limits, etc.").
Locked here, not left to the implementer:

- **Starting chips:** 1000 per player, every fresh game start (lobby
  entry / rematch), never carried over — matches "don't worry about
  tracking values between games" literally.
- **Blackjack:** 6-deck shoe, reshuffle before any round where remaining
  cards drop under 25% of the shoe (never mid-round). Bet min 10 / max
  500. Blackjack (natural 21) pays 3:2; dealer blackjack pushes only
  against a player blackjack, otherwise beats any non-blackjack 21.
  Dealer stands on all 17s (soft included) — the simpler, still-standard
  ruleset, avoids extra soft/hard dealer-play branching for v1. Double
  down allowed on any first-two-card total (not restricted to 9-11).
  One split max (pairs only), no resplit, no double after split. Insurance
  offered only when dealer's up-card is an Ace, costs half the original
  bet, pays 2:1 iff dealer has blackjack. A seat that can't cover the
  table minimum sits out (visually marked, not removed) rather than
  being force-ejected.
- **Texas Hold'em:** No-limit, fixed blinds (no escalation): small blind
  5 / big blind 10, starting stack 1000. Dealer button rotates every
  hand. Standard NLHE min-raise (>= size of the previous bet/raise, or
  the big blind if none yet this round), all-in for less always legal,
  side pots computed correctly for multiple simultaneous all-ins. A
  player reaching 0 chips after a hand is eliminated from the table (not
  dealt further hands, shown in final standings by elimination order);
  the game ends when one player remains with chips, who is declared the
  winner.
- **Bots:** Blackjack bots always play a fixed hit-below-17/stand-17+
  basic-strategy table, never double or split (documented simplification
  — avoids bot-driven bet-size changes and split-hand bookkeeping in
  v1). Hold'em bots use a documented heuristic (starting-hand-strength
  tier preflop, simple pot-odds/hand-strength check postflop, occasional
  bluff-free fold/call/raise) — not GTO-optimal, same spirit as
  Scrabble's "bot never bluffs" precedent.
- **Segments/routes:** `blackjack` and `holdem` (not `texas-holdem`,
  matching this codebase's short-segment convention like `skipbo`,
  `ttt`).

## Model routing
Implementer: Haiku (this session's cheapest Agent-tool model; deepseek
not available as an Agent-tool option in this session, consistent with
every recent charter's routing). Reviewer: the lead's own model (this
session's Sonnet), fallback adversarial persona from `references/
review.md` since no `ai-grouch-claude` skill is installed here.
