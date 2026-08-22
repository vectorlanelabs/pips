# Spec 48 — Scrabble screens

Second of the Scrabble build (spec 47 = engine, landed; this spec =
screens; a third spec will wire `App.tsx`/`Landing.tsx`). No engine
changes — `src/board-games/scrabble/{board,state,rules,bot,
dictionary}.ts` are read-only inputs here.

Read `src/screens/SkipBoRoom.tsx`, `src/screens/DominoesTable.tsx` +
`.css`, `src/screens/DominoesResults.tsx`,
`src/screens/DominoesRulesOverlay.tsx`,
`src/screens/ChessTable.tsx` (specifically its pawn-promotion overlay,
~line 319-342), `src/components/DealIntro.tsx`,
`src/components/TableHeader.tsx`, `src/hooks/useSound.ts`, and
`src/screens/SkipBoTable.css`'s `.sb-opp-rail`/`.sb-opp-tile` rules IN
FULL before writing anything — this spec locks decisions by pointing
at exactly these conventions; do not invent alternatives to anything
listed below as "mirror X."

You own creating exactly these new files — do not touch any existing
file:

- `src/screens/ScrabbleRoom.tsx`
- `src/screens/ScrabbleTable.tsx` + `ScrabbleTable.css`
- `src/screens/ScrabbleResults.tsx`
- `src/screens/ScrabbleRulesOverlay.tsx`
- `src/components/ScrabbleTileBack.tsx` (deal-intro card-back visual)

## Brand color

Before picking `gameColor`, run `git grep -oh "gameColor=\"#[0-9a-fA-F]*\"" src/screens | sort -u` (or grep the equivalent constant each game defines) and pick a hex NOT already in use by another game. Pick something that reads as "wordy/paper" rather than reusing an existing game's exact color — document your choice in your report. This is the one open judgment call in this spec; everything else below is locked.

## Room (`ScrabbleRoom.tsx`)

Direct mirror of `SkipBoRoom.tsx` — same props shape
(`code, localName, isHost, seats, notice?, onAddHouseBot, onStartGame,
onLeave`), same layout (header row, code card, invite-link copy,
notice banner, seat slot list with filled/open rows, host-only Add
house bot / Start game buttons, non-host waiting message), same
`chip`/brand-color treatment. `SCRABBLE_MIN_SEATS = 2` /
`SCRABBLE_MAX_SEATS = 4` — these constants must already exist as
exports from `src/board-games/scrabble/state.ts` (spec 47 landed
`RACK_SIZE`/etc. but the seat-count constants may not be there yet —
check; if missing, that's a spec-47 gap, not yours to silently patch:
report it, and add the two `export const` lines yourself since it's a
one-line, zero-risk addition, not a redesign).

## Table (`ScrabbleTable.tsx` / `.css`)

**Header**: `<TableHeader gameLabel="Scrabble" gameColor={BRAND}
meta={`${code} · ${seatCount} players`} onRules={...} onLeave={...}
enabled={enabled} setEnabled={setEnabled}
turnSoundEnabled={turnSoundEnabled}
setTurnSoundEnabled={setTurnSoundEnabled} />` — `enabled`/
`turnSoundEnabled` come from this component's own `useSound()`
instance, never a second one (per `TableHeader.tsx`'s own comment).

**Table shell**: same `.dm-table-card`-equivalent treatment
(`background:var(--surface); border:4px solid var(--ink);
border-radius:28px; box-shadow:0 10px 0 var(--ink); padding:clamp(16px,2.4vw,26px)`)
— rename the class `.scr-table-card`, same values.

**Board**: 15x15 CSS grid. Each cell: a square (`aspect-ratio:1`),
bordered, background color keyed off `premiumAt(row,col)` from
`board.ts` — pick 4 distinct, legible background colors for
DL/TL/DW/TW (do not reuse an existing game's exact palette; muted
pastel tones are conventional for a word-game board and consistent
with this app's flat-color aesthetic) plus the center cell rendered
with a star glyph instead of/in addition to its DW color. An occupied
cell renders its letter tile (see "Tile face" below) instead of the
premium background. Empty cells past whatever premium color show the
letter/word-multiplier abbreviation as small centered text ("DL",
"TW", etc.) at low-opacity, matching how a physical board prints them
— do not leave premium squares blank/unlabeled, a first-time player
needs to see what a square does.

**Tile face** (used for both rack tiles and placed board tiles): a
small square, `border:2px solid var(--ink)`, off-white/cream
background (paper-tile feel, consistent with this app's flat-color
ink-bordered aesthetic), the letter centered large, the point value
small in the bottom-right corner (standard physical Scrabble tile
layout). **Blank tiles, once assigned a letter, render that letter in
a visibly lighter weight/color than a normal tile's letter** — this
was explicitly locked by the user: a blank tile's assigned letter must
always be distinguishable from a normal tile at a glance. Concretely:
normal tile letter `font-weight:800; color:var(--ink)`; blank-assigned
letter `font-weight:400; color:var(--muted-text)` (or equivalent —
pick values that are clearly, obviously lighter side-by-side, not a
subtle 1-shade difference; verify this visually before reporting done,
per this project's mandatory browser-check requirement for UI work).
`BoardCell.isBlank` is exactly the field that drives this — already
present in the engine's `state.ts`.

**Rack**: the local player's own 7 (or fewer) tiles, rendered as tile
faces in a row at the bottom of the table card, matching how every
other card game renders "your hand" (a row of face-up pieces below the
board/table furniture).

**Placement flow — select-then-place-then-confirm** (new interaction,
since no sibling has multi-piece staged placement, but built from
Dominoes' existing select/target visual language, not invented from
scratch):
1. Click a rack tile to select it (mirror `.dm-hand-tile--selected`'s
   treatment: lift + colored shadow). Click an empty board cell to
   place the selected tile there — it moves visually from the rack row
   onto that board cell (a "staged" placement, not yet submitted to
   the host) and the rack tile row shrinks by one. Repeat for
   additional tiles in the same turn.
2. **Blank tile**: the instant a blank tile is placed onto a board
   cell (step 1, before any further tiles or submission), open a
   forced-choice overlay mirroring Chess's pawn-promotion overlay
   structurally (`overlay-backdrop`/`overlay-panel`, but with NO
   `onClick` dismiss on the backdrop — same "inert until resolved"
   treatment Chess uses) containing a 26-button A-Z grid. Clicking a
   letter assigns it to that staged tile (drives what gets sent as
   `letter` in the eventual `PLACE_WORD` action for that tile) and
   closes the overlay. The staged blank tile immediately renders with
   the lighter/muted letter treatment from "Tile face" above, right
   there on the board, so the player sees exactly what they've
   committed to before submitting the whole word.
3. Any staged (not-yet-submitted) tile can be clicked again to un-stage
   it back into the rack (undoes the blank-letter choice too if it was
   one).
4. Two buttons appear once at least one tile is staged: **"Play
   word"** (submits `PLACE_WORD` with every currently-staged tile) and
   **"Clear"** (un-stages everything back to the rack, no action
   sent). Both disabled when nothing is staged. "Play word" is also
   disabled (with a visible reason, not just silently inert) if the
   staged tiles aren't in a single line — the engine will reject this
   anyway per spec 47's validation, but don't make the player submit
   to find out; mirror the shape of the rejection client-side using
   the same single-row/single-column check spec 47's `rules.ts`
   already implements (read it, replicate the check, don't diverge).

**Turn/action controls beyond placement**: an "Exchange" button
(select 1+ rack tiles the same way, then confirm — sends
`EXCHANGE_TILES`), a "Pass" button, and a **"Challenge!"** button that
appears only when `publicState.lastPlacement !== null &&
lastPlacement.challengeable && lastPlacement.by !== localPlayerId`
(sends `CHALLENGE`) — this is the one action available even when it
isn't your turn, so its enabled/visible condition is independent of
whose turn it currently is, unlike every other button here.

**Opponent area**: reuse `.sb-opp-rail`/`.sb-opp-tile`'s exact CSS
values verbatim, renamed `.scr-opp-rail`/`.scr-opp-tile` (this app's
per-game class-prefix convention). Per opponent tile: name + seat-color
dot, current score, rack tile count shown as a small face-down tile
stack/fan (reuse the fan-of-backs visual language, using
`ScrabbleTileBack.tsx` as the back face) rather than a bare number —
matches every sibling's "show a fan, not a count" convention for a
hidden zone. Turn-highlight: `.scr-opp-tile--turn` fills with the
seat's color + a `turn-tag` badge, mirroring SkipBo's exact treatment.

**Last-action status block**: mirror Dominoes'
`.dm-status-block`/`-event`/`-prompt` two-line pattern exactly
(class names renamed `.scr-status-*`). Pure functions
`computeEventLine`/`computePromptLine` reading
`publicState.lastPlacement` — e.g. event line "Alice played CATS for
14 (+ SAT for 6)." when there were cross-words, prompt line "Your
move." / "Waiting for Bob." / "You can challenge Alice's CATS!" when
`lastPlacement.challengeable` and it isn't the local player's own
placement.

**Sounds** (reuse existing registered names only — verified against
`useSound.ts`'s current registry, no new sound assets):
- Tile placed (`PLACE_WORD` succeeds): `'piece-drop'`.
- Tile drawn during rack refill: `'card-draw'`.
- A challenge succeeds (word was invalid, undone): `'letter-wrong'`.
- A challenge fails (word confirmed valid): `'letter-correct'`.
- Turn starts for the local player: reuse the existing
  `useTurnStartSound` hook exactly like Dominoes/SkipBo do — `'turn-start'`.
- Game ends: `'game-win'` on mount of the results screen (see below),
  matching every sibling's convention.
- Deal-intro shuffle: `'shuffle'` (the generic one every `DealIntro`
  caller uses by default — do not invent a `'scrabble-shuffle'` asset).
Trigger every non-deal-intro sound the same way Dominoes does: a
`useEffect` diffing `publicState.lastPlacement`/turn identity against
a ref, not a per-click imperative call — keeps sound correct for both
the acting player and everyone watching.

**Deal intro**: `<DealIntro others={opponents.map(o=>({id,name,color,
handSize:o.rackCount}))} yourHandSize={myRack.length}
maxFlights={totalTilesAcrossAllRacks} shuffleSound="shuffle"
renderCardBack={p => <ScrabbleTileBack {...p}/>}
onComplete={()=>setShowIntro(false)}/>` — `ScrabbleTileBack.tsx` is a
small new component (tile-face-shaped back, distinct ink-bordered
solid color, no letter) following whatever shape `DominoTileBack`/
similar existing `renderCardBack` implementations take (check one,
mirror its prop handling for `size`/`style`/`className`).

## Results (`ScrabbleResults.tsx`)

Mirror `DominoesResults.tsx`: same root/layout conventions,
`useEffect(() => play('game-win'), [])` on mount, guarded on
`publicState.stage === 'over'`, ranked-by-score rows (winner's row
filled with their seat color), `Again` button host-only
(`btn btn-coral btn-lg`), `Back to the shelf` (`btn btn-lg`), non-host
sees the waiting message. **New case no sibling needs**: `winnerId`
can be `null` (a tied final score, per spec 47's locked tie-handling)
— render a distinct "It's a tie!" headline instead of a single
winner's name in that case, still show the ranked score rows below it.

## Rules overlay (`ScrabbleRulesOverlay.tsx`)

Mirror `DominoesRulesOverlay.tsx`'s `overlay-backdrop`/`overlay-panel`
structure exactly (dismissible via backdrop click, unlike the blank-
tile picker). Content: bulleted summary of spec 47's locked rules —
tile values/board premiums, first-word-must-cover-center, connect-to-
existing-tiles, the challenge mechanic (state plainly that a played
word is NOT auto-checked, and can be challenged by anyone else before
it's safe — this is the single most important rule for a new player to
understand about why Scrabble here works differently from a solitaire
dictionary-checker), the two end-game triggers, the bingo bonus.

## Files you own

Exactly the 5 listed at the top. Everything else (engine files,
`App.tsx`, `Landing.tsx`, other screens) is read-only — wiring is the
next spec, not this one, so these screens will not be reachable in the
running app yet; that's expected and fine.

## Do NOT

- Touch any engine file, `App.tsx`, `Landing.tsx`, or any other
  screen's file.
- Run git, commit, or push.
- Add any new dependency or new sound asset.
- Invent a different interaction model than the locked
  select-then-place-then-confirm flow above, or a different blank-tile
  UX than the forced-choice A-Z overlay.

## Verify before reporting

`npx tsc -b --noEmit`, `npm test -- --run` (no new tests are required
by this spec — screens don't get dedicated test files per this
project's established convention — but existing tests must stay
green), `npm run build`. Since these screens aren't wired into
`App.tsx` yet, a live browser check isn't possible this spec — note
that honestly rather than claiming one; the wiring spec's own verify
step is where live-in-browser checking happens. Report the brand color
you picked and why, and any judgment call beyond what this spec locked
down.
