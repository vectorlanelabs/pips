# Spec 61 — Wahoo house rule: two colors each (engine)

First house rule for Wahoo (the game has none yet — this spec introduces
the Wahoo equivalent of Uno's generic house-rules pathway from specs
34c/45/46, which is the established convention: house rules are host
toggles, variants are a dropdown). The rule, `twoColors`, applies to
**2-player games only**: each player runs two colors on opposite corners
(e.g. one player plays NW + SE, the other NE + SW), so all four arms are
in play. On your turn you roll once and move any one legal marble from
either color you control. Your two colors treat each other **exactly like
opponents** for every movement rule: your NW marbles can jump over your SE
marbles, can bump them home (including out of the center), and are blocked
by the come-out-hole protection just like an opponent would be. Bumping
your own other color is legal — and since Wahoo already has no voluntary
pass, when it's your only legal move you're forced to make it. You win
when **all eight** of your marbles (both colors) are home.

Spec 62 covers the screens and App.tsx wiring. This spec is the engine:
state, rules, bot, tests.

You own EXACTLY these files — the first three exist, edit only:

- `src/board-games/wahoo/state.ts`
- `src/board-games/wahoo/rules.ts`
- `src/board-games/wahoo/bot.ts`

And this NEW file:

- `src/board-games/wahoo/two-colors.test.ts`

Do NOT touch `board.ts` — the board geometry (arms, track, lanes, center,
shortcut corners) is unchanged; all four arms and their come-out holes
already exist. Do NOT touch any screen, `App.tsx`, or `wahoo.test.ts` /
`oscar.test.ts` — EXCEPT that the existing test files (and screens, via
compile errors surfaced by `tsc -b`) may break on the type changes below;
in the existing TEST files fix ONLY the resulting compile/assert breakage,
mechanically and minimally, and report exactly what and why. Compile
errors in `src/screens/Wahoo*.tsx` or `App.tsx` are EXPECTED and are spec
62's job — coordinate: if you land first, `tsc -b` will not be silent
repo-wide; run `npx vitest run src/board-games/wahoo/` plus
`npx tsc --noEmit -p tsconfig.app.json` scoped as best you can and state
plainly in your report which screen files still have expected errors for
spec 62. Do NOT "helpfully" patch the screens. Do NOT run git.

## Design decisions (locked)

### House-rule scaffolding (mirror Uno's, same shapes and names)

In `state.ts`, following `src/card-games/uno/state.ts`'s
`UNO_HOUSE_RULE_DEFS` / `resolveHouseRules` pattern exactly:

```ts
export type WahooHouseRuleKey = 'twoColors'

export const WAHOO_HOUSE_RULE_DEFS: {
  key: WahooHouseRuleKey
  label: string
  description: string
  default: boolean
}[] = [
  {
    key: 'twoColors',
    label: 'Two colors each',
    description:
      'Two players only: each player runs two colors on opposite corners. Roll once, move any marble you control — your colors jump, block, and even bump each other exactly like opponents. Win by getting all eight home.',
    default: false,
  },
]

export function resolveWahooHouseRules(
  overrides?: Partial<Record<WahooHouseRuleKey, boolean>>,
): Record<WahooHouseRuleKey, boolean>
```

`createWahooGame` gains a third parameter,
`houseRules?: Partial<Record<WahooHouseRuleKey, boolean>>`, resolved via
`resolveWahooHouseRules` and stored on the public state as
`houseRules: Record<WahooHouseRuleKey, boolean>` (plain data, wire-safe).
**Defensive gate:** `twoColors` is treated as `false` unless
`playerIds.length === 2` — the resolved/stored value itself is forced to
`false` in that case, so downstream code and the UI never see an "on"
rule in a 3-4 player game.

### Data model: marble SETS, not players (the load-bearing decision)

Today `seatArms`, `positions`, `centerBy.playerId`, and the keys iterated
by `bumpAt` / `startProtected` / `moveBumps` all use playerIds, and every
"is this marble mine?" check is `pid === playerId`. The chosen semantics —
your other color is an opponent for every movement rule — means the clean
generalization is to key those maps by **marble set id** instead:

- New public-state field `setOwners: Record<string, string>` mapping
  setId → controlling playerId.
- **Normal games (rule off, any seat count): setId === playerId**, and
  `setOwners` is the identity map. Every map keeps byte-identical keys and
  values to today. This is the regression constraint: with `twoColors`
  off, the serialized public state must be identical to today's except
  for the two new fields (`houseRules`, `setOwners`), and every existing
  behavior test must stay green.
- **Two-color games:** four sets. Player A owns setIds `A` and `A:2`,
  player B owns `B` and `B:2` (setId = playerId for the first set,
  `` `${playerId}:2` `` for the second — plain strings, wire-safe).
  `seatArms` and `positions` are keyed by these four setIds
  (`positions[setId]` stays a 4-marble array; nothing becomes length 8).

Seating: player A's two sets get one opposite arm pair, player B's the
other — `rng() < 0.5` picks whether A gets `{0, 2}` or `{1, 3}` (B gets
the other pair), and within each player's pair which set takes which arm
is shuffled, reusing the existing `shuffle`/rng flow. `mutedArm` stays
`null`. Turn state is still over the two playerIds — turn order, `turn`,
`sixStreak` are per-player, unchanged.

With this model, `bumpAt`, `startProtected`, and the opponent-occupancy
scan in `moveBumps` need only their identity comparison moved from
playerId to setId — a marble of your other color IS a different key, so
it gets jumped over, bumped, and start-protected by the existing code
paths, not by new special cases. That is the point of the design: the
"exactly like opponents" semantics fall out of the keying.

### Type changes

- `WahooMove` gains `setId: string` (required). The validator resolves a
  MOVE by matching `(setId, marbleIdx, kind)` against `legalMoves` and
  rejects a move whose `setId` is not owned by the acting player (the
  legal-move membership check gives this for free, but the malformed-
  payload guard at `rules.ts:160` must also survive a missing/non-string
  `setId` without crashing).
- `centerBy` becomes `{ setId: string; marbleIdx: number; entryCornerRel:
  6 | 22 } | null` (field rename `playerId` → `setId`).
- `lastMoved` becomes `{ playerId: string; setId: string; marbleIdx:
  number } | null` — the triple-six bust still keys off
  `lastMoved.playerId === playerId` (the actor busts whatever marble THEY
  last moved this chain, whichever of their colors it belongs to) but now
  sends home `positions[lastMoved.setId][marbleIdx]`, and the matching
  center-clear check compares `centerBy.setId === lastMoved.setId`.
- `WahooEvent`: `by` stays the acting **playerId** (status lines and
  sounds are about the actor). `bumpedId` becomes the bumped **setId** —
  in normal games that's still the victim's playerId, so nothing changes
  for existing consumers; in two-color games spec 62 maps it through
  `setOwners` for names and can detect a self-bump
  (`setOwners[bumpedId] === by`) for the status line.
- `legalMoves(publicState, playerId, die)` keeps its signature and returns
  the UNION of moves across every set the player controls (derive the
  player's setIds from `setOwners`). Per set: "own marble blocks the
  path / occupies my come-out hole / holds the center against my
  shortcut" means SAME SET ONLY; everything else on the board — opponent
  sets and your own other color alike — is bump/jump material via the
  absolute-index checks. Concretely, the per-set logic is today's
  per-player logic verbatim with `positions[setId]` / `seatArms[setId]` /
  `centerBy.setId` substituted; the union loop is the only new shape.
- `moveBumps` keeps its signature but gains a companion the bot needs:
  `bumpVictim(publicState, setId, die, move): string | null` returning
  the setId of the marble a legal move would send home (null if none).
  `moveBumps` can be reimplemented as `bumpVictim(...) !== null` —
  "bumps anyone at all, own other color included".
- `applyMove` operates on the moving `setId` throughout; the win check
  becomes: every set in `setOwners` owned by the acting player has all
  four marbles `>= LANE_START` (in normal games that's exactly today's
  single-array check).

Everything crossing the wire stays plain serializable data — string keys,
numbers, null. No classes, no functions.

### What does NOT change

One roll, one marble moved, per roll. Roll a 6 → extra roll; three 6s in
a chain → bust as today (per the `lastMoved` rework above). No voluntary
pass exists and none is added: if the union of legal moves across both
your sets is non-empty, you must move — the auto-pass branch fires only
when BOTH sets have nothing. Exact counts, overshoot, shortcut entry
corners, exit-on-1-or-6, come-out on 1 or 6 — all untouched.

## bot.ts

`wahooBotStrategy` must handle a bot controlling two sets. Keep it
stateless and deterministic:

- Generate the full move union via `legalMoves` (it already unions).
- Partition moves by `bumpVictim`: a move is a **self-bump** iff its
  victim set is owned by the bot itself. Run the existing priority ladder
  (win now → bump → lane entry → shortcut → exit → out → best advance)
  over the NON-self-bump moves first; only if that set is empty fall
  through to the self-bump moves (forced — pick by the same ladder for
  determinism). A bot must never choose to send its own marble home while
  any alternative exists, and the "bump" priority rung counts only
  bumps of OPPONENT-owned sets.
- `winsNow` must mirror the new win check exactly: the advance completes
  the LAST unfinished marble across ALL of the bot's sets (same
  no-approximation warning as the existing comment at `bot.ts:27` — keep
  that comment true).
- Cross-set tie-breaks must stay deterministic: order sets by setId
  (the player's primary set before `:2`), then the existing
  closest-to-home / lower-marbleIdx rules within and across sets.
- Do not change the 52-threshold strategy judgment or any pacing — the
  bot still submits exactly one ROLL and one MOVE per phase; all pacing
  lives in App.tsx and is untouched by this spec (spec 62 re-verifies it
  live per the CLAUDE.md bot-pacing mandate).

## two-colors.test.ts (vitest, ≥ 16 tests)

Fixture-build the way `wahoo.test.ts` does (seeded `createWahooGame`,
direct state surgery where needed). Cover at minimum:

- `resolveWahooHouseRules()` / `createWahooGame` default `twoColors` to
  `false`; `WAHOO_HOUSE_RULE_DEFS` has the expected single entry.
- **Regression, rule OFF:** a 2-player, a 3-player, and a 4-player game
  have setId === playerId everywhere, identity `setOwners`, and (2-player)
  the same opposite-pair seating behavior as today. Existing suites
  `wahoo.test.ts` and `oscar.test.ts` staying green is the other half of
  this regression net.
- **Defensive gate:** `createWahooGame` with 3 and with 4 players and
  `{ twoColors: true }` stores `houseRules.twoColors === false` and builds
  a completely normal game.
- **Seating, rule ON:** 2 players → exactly four sets, `setOwners` maps
  two per player, each player's two arms are an opposite pair (0/2 or
  1/3), all four arms covered, `mutedArm === null`.
- **Move union:** with marbles placed in both of a player's sets, ROLL
  then `legalMoves` returns moves tagged with both setIds; a MOVE with a
  setId the actor doesn't own is rejected; a MOVE with a missing/garbage
  `setId` is rejected without throwing.
- **Jumping:** an advance whose path crosses the player's OTHER color's
  marble (compare via absolute indices) is legal; the same path crossing
  a SAME-set marble is still illegal.
- **Bumping own color:** landing (exact count) on your other color's
  marble on the shared track sends it to base (`-1`), `lastEvent.bumpedId`
  is that setId, and `setOwners[bumpedId]` is the actor.
- **Forced own-bump:** construct a state where the only legal move in the
  union bumps the actor's own other color — `legalMoves` returns exactly
  that move (no pass), and applying it performs the bump.
- **Start protection between own colors:** your set-A marble cannot land
  on your set-B marble sitting on set B's own come-out hole; bringing a
  set-A marble OUT when your set-B marble sits on set A's come-out hole
  bumps it (it is not on its own start).
- **Center:** set A can shortcut into the center while set B holds it —
  set B's marble goes home; a SAME-set marble in the center still blocks
  that set's shortcut; exit is offered only for the set actually in the
  center and lands/bumps via that set's relative coordinates.
- **Win:** completing all four marbles of one color with the other color
  unfinished does NOT end the game (`stage` stays `'play'`); the move
  completing the eighth marble sets `stage: 'over'`, `winnerId` = the
  controlling playerId, `lastEvent` `win`.
- **Triple-six bust across colors:** a chain whose last-moved marble
  belongs to the actor's second set busts THAT marble home; a chain where
  the bust marble is the one holding the center clears `centerBy`.
- **Bot:** given a choice between a plain advance and a self-bump, the
  bot advances; given only a self-bump, it takes it; given an opponent
  bump and a self-bump, it bumps the opponent; `winsNow` fires only on
  the true eighth-marble completion (not on finishing one color).
- **Serialization:** `JSON.parse(JSON.stringify(publicState))` round-trips
  losslessly on a mid-game two-color state.

## Verify before reporting

`npx vitest run src/board-games/wahoo/` fully green — report the new
total, and exactly which existing-test fixtures (if any) needed the
minimal mechanical touch-up and why. `npx tsc -b --noEmit` will surface
the expected spec-62 errors in `src/screens/Wahoo*.tsx` / `App.tsx` if
this lands first — list them explicitly as handed off, and confirm there
are NO errors in `src/board-games/` or `src/engine/`. Do not run
`npm run build` (it can't pass until spec 62) — say so rather than
reporting a red build as a surprise.
