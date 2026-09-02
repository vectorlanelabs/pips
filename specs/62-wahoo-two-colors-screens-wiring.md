# Spec 62 — Wahoo two colors: screens + wiring

Companion to spec 61 (engine — read it first; its data model is the
contract). This spec puts the `twoColors` house rule in front of players:
the room toggle (Wahoo's first house rule, introducing the Uno-style
house-rules section to the Wahoo room), the App.tsx lobby plumbing, and a
set-aware table/results/rules pass. Sibling conventions to match, per
CLAUDE.md: the house-rule toggle UI and lobby sync come from Uno
(`src/screens/UnoRoom.tsx` + the Uno wiring in `App.tsx` — the
`unoHouseRulesRef` / lobby-view-broadcast / `onToggleHouseRule` shape);
the table interaction model is Wahoo's own existing select-then-confirm
marble flow, unchanged in feel.

You own EXACTLY these files — all exist, edit only:

- `src/screens/WahooRoom.tsx`
- `src/screens/WahooTable.tsx`
- `src/screens/WahooRulesOverlay.tsx`
- `src/screens/WahooResults.tsx` (expected minimal or no change — verify
  and report either way)
- `src/App.tsx` (Wahoo sections only)
- `src/screens/WahooResults.test.ts` (only if the type changes break it)

And this NEW file (only if genuinely needed for the toggle styles):

- `src/screens/WahooRoom.css` — copy the house-rule toggle block from
  `UnoRoom.css` under `wh-house-rule*` class names for visual parity. Do
  not reuse the `uno-`prefixed classes cross-game and do not restyle
  anything else.

Do NOT touch anything under `src/board-games/` (spec 61 owns it), any
other game's files, or `route.ts`. Do NOT run git.

## Room: WahooRoom.tsx

Mirror `UnoRoom.tsx`'s house-rules section (its props, generic map over
the defs array, host-only interactivity, read-only display for guests):

- New props: `houseRules: Record<WahooHouseRuleKey, boolean>` and
  `onToggleHouseRule: (key: WahooHouseRuleKey) => void` (host-only).
- Render a "House rules" section mapping over `WAHOO_HOUSE_RULE_DEFS`,
  same toggle-button anatomy as Uno (label + description + On/Off pill),
  `wh-house-rule*` classes.
- **Two-player gating (the lobby behavior locked with the owner):** the
  toggle is additionally disabled whenever `seats.length > 2`, for the
  host too, with a short inline note in the description slot's style
  (e.g. "Two players only") so the reason is visible. The auto-off itself
  is host logic in App.tsx (below) — the room just renders the state it's
  given; guests see the flip happen because the host rebroadcasts.

## App.tsx: Wahoo lobby plumbing (mirror the Uno shape exactly)

- Extend the Wahoo lobby view (`WahooView`'s `lobby` kind — see the Uno
  lobby kind at `App.tsx:201` for the shape) with
  `houseRules: Record<WahooHouseRuleKey, boolean>`.
- Host keeps `wahooHouseRulesRef` (initialized and reset via
  `resolveWahooHouseRules()`, same lifecycle points as
  `unoHouseRulesRef` — init, room-create, teardown/reset paths), and a
  guest-visible state mirror, following the Uno pattern verbatim.
- `onToggleHouseRule` (host only): flip the key in the ref, rebroadcast
  the lobby view. Guests get the value from the lobby view and pass it
  read-only into `WahooRoom`.
- **Auto-off, visibly:** in the host's roster-change path (guest joins
  AND add-house-bot), when the seat count becomes `> 2` while
  `twoColors` is on, set it off in the ref and rebroadcast — everyone in
  the room sees the toggle drop to Off. It stays off if seats fall back
  to 2 (the host may re-enable by hand).
- Start game: pass `wahooHouseRulesRef.current` as `createWahooGame`'s
  third argument. The engine's own `playerIds.length !== 2` gate (spec
  61) is the defensive backstop — keep the App-side auto-off anyway; the
  two are belt and suspenders, per the locked lobby decision.
- Guest→host and host→guest payloads stay plain serializable data.

## Table: WahooTable.tsx

Spec 61 rekeys `seatArms`/`positions`/`centerBy` by setId and adds
`setOwners`; in normal games setId === playerId so every existing render
path is behavior-identical. The table work is making the identity
assumption explicit instead of accidental:

- **Marble rendering already iterates map keys** (`positions` /
  `seatArms`) — with four sets those loops render four colors with the
  existing `ARM_COLORS`/`seatColor` machinery essentially for free.
  Rename locals from `playerId`/`pid` to `setId` where they are actually
  set keys, and route every NAME lookup through
  `setOwners` (`names[setOwners[setId]]`).
- **Local interaction:** everywhere the table computes "my" moves,
  marbles, and holes for `localPlayerId` (the `legalMoves` call at
  `WahooTable.tsx:201`, `marbleHole`, `movableMarbleIdxs`,
  `selectedMarbleIdx`, the contested-target grouping, and the MOVE
  submit), the unit becomes `(setId, marbleIdx)` instead of bare
  `marbleIdx` — `legalMoves` already returns the union tagged with
  `setId` (spec 61), so selection state, candidate rings, and the
  submitted `WahooMove` all carry the pair. Two-color games must let the
  player pick freely across both their colors within one roll's
  candidates; normal games must look and behave pixel-identically to
  today.
- **Turn highlight, die, status strip:** keyed off the acting playerId —
  unchanged, except copy that names a bump victim must resolve through
  `setOwners`, and a self-bump (`setOwners[lastEvent.bumpedId] ===
  lastEvent.by`) gets its own line — something in the existing status
  voice like "sent their own marble home!" — because that forced play is
  the whole flavor of the rule and must not read as a name-lookup bug.
- **Sounds/animations:** no new ones. The existing bump/move/roll cues
  fire per event exactly as today; verify (per the CLAUDE.md pacing
  section, mandatory) that nothing about the set rework lets a bot's
  next action land before the current cue finishes — the Wahoo pacing
  constants in App.tsx (see the note at `App.tsx:280`) are not to be
  changed by this spec, only re-verified live.

## WahooRulesOverlay.tsx

Add one bullet, matching the existing bullets' voice and length, e.g.:
"House rule, two players: run two colors on opposite corners. Move
either color each roll — your colors bump each other like opponents
(sometimes you'll have to), and you need all eight marbles home."

## WahooResults.tsx

Winner is a playerId (unchanged by spec 61) — expected to work as-is.
Verify against a finished two-color game (any per-marble/per-arm detail
it renders must resolve names via `setOwners`) and report "no change
needed" or the minimal fix.

## Verify before reporting

`npx tsc -b --noEmit` silent repo-wide (this spec closes out the errors
spec 61 handed off). `npm test` fully green — report the total.
`npm run build` clean. Then a live pass, host + 1 house bot with
`twoColors` ON (and per CLAUDE.md, pacing judged against the bot running
TWO colors — its bump-rich move stream is the stress case, not a
single-color bot):

- Lobby: toggle on; add a second bot → toggle visibly drops to Off and
  greys; remove isn't possible so also verify a fresh 3-seat room can't
  enable it; back in a 2-seat room start with it ON.
- Table: both your colors are selectable on one roll; select-then-confirm
  feel unchanged; a forced self-bump plays out with the self-bump status
  line; bump/move sounds finish before the bot's next action lands;
  turn highlight and die behavior unchanged.
- A full game to the end: one color finishing does not end it; results
  screen credits the right player.

Cite, in the report, the specific sibling files matched (UnoRoom/Uno
wiring for the toggle path, the existing Wahoo table flow for
interaction) per the CLAUDE.md convention-citation bar.
