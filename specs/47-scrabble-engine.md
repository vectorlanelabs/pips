# Spec 47 — Scrabble engine (dictionary, state, rules, bot)

First of at least 2 specs building Scrabble from scratch (engine now,
screens/wiring later, same split as specs 40/41/42 for Skip-Bo). This
spec is engine only: no React, no screens, no wiring. Read
`src/board-games/dominoes/{state,bot,scoring,rules}.ts` and
`src/board-games/chess/{state,bot}.ts` FIRST, in full — this spec
reuses their exact conventions (`Zone`/`Card`-shaped primitives from
`src/card-engine/`, `TurnState`/`createTurnState`/`advanceTurn`/
`currentPlayer` from `src/engine/turn-engine.ts`, `HostSession`/
`createHostSession`/`assertWireSafe` from `src/engine/sync.ts`,
`BotStrategy`/`runBotTurn` from `src/engine/bot.ts`) rather than
inventing new shapes. Also read `src/engine/sync.ts:90-121`
(`isJsonSerializable`/`assertWireSafe`) — it's why the dictionary must
never enter synced state (see "Dictionary" below).

2-4 players. You own creating exactly these new files — do not touch
any existing file:

- `scripts/build-dictionary.ts` (generator, not shipped in the app
  bundle)
- `public/dictionary/enable1.dawg.json` (generated artifact, committed)
- `src/board-games/scrabble/dictionary.ts` (+ `dictionary.test.ts`)
- `src/board-games/scrabble/board.ts` (+ `board.test.ts`) — premium
  square layout, pure board-geometry helpers
- `src/board-games/scrabble/state.ts`
- `src/board-games/scrabble/rules.ts`
- `src/board-games/scrabble/bot.ts`
- `src/board-games/scrabble/scrabble.test.ts` (or split further if that
  reads better — your call, just make sure every file you create ends
  in `.test.ts` so `npm test` picks it up)

## Dictionary (`scripts/build-dictionary.ts`, `dictionary.ts`)

- Source word list: **ENABLE1** (public domain, ~173k words) — do NOT
  use TWL/SOWPODS/NWL, those are licensed lists.
- `build-dictionary.ts` is a one-off/CI generator: reads the raw word
  list (fetch or vendor it into the script's own working set, your
  call on mechanics — it is NOT part of the app bundle and never
  imported by app code), compiles a DAWG, serializes it to
  `public/dictionary/enable1.dawg.json` as compact edge-list arrays
  (numbers/indices, not repeated word strings). Run once by hand;
  regenerate only if the word list changes. Commit the output like a
  lockfile.
- `dictionary.ts` exports `loadDictionary(): Promise<ScrabbleDictionary>`
  that `fetch()`s the generated asset and `isWord(word: string): boolean`
  on the returned handle. This is loaded via a plain dynamic
  `fetch()`/`import()` gated on entering the Scrabble room (the
  screens/wiring spec owns exactly where that call lives) — it must
  NEVER be imported by `state.ts`/`rules.ts`/`bot.ts` at module scope,
  and never passed into `createHostSession`/`HostSession` or any
  `PublicState`/`PrivateState` field. Rules/bot functions that need
  word validation take the loaded `ScrabbleDictionary` as an explicit
  parameter — same "just a value passed in" shape `chess.js`'s `Chess`
  instance uses locally without going near the wire.
- Verify actual gzipped size after building; target is roughly
  300-800KB. If it comes out much larger, fall back to a smaller
  ENABLE1 subset rather than switching to a licensed list.

## Board (`board.ts`)

Standard 15x15 premium-square layout (0-indexed row/col), symmetric
under 90-degree rotation. Encode as a static lookup, not computed at
runtime from a formula — this is the canonical published Scrabble
board:

```
TW . . DL . . . TW . . . DL . . TW
.  DW . . . TL . . . TL . . . DW .
.  . DW . . . DL . DL . . . DW . .
DL . . DW . . . DL . . . DW . . DL
.  . . . DW . . . . . DW . . . .
.  TL . . . TL . . . TL . . . TL .
.  . DL . . . DL . DL . . . DL . .
TW . . DL . . . *  . . . DL . . TW
.  . DL . . . DL . DL . . . DL . .
.  TL . . . TL . . . TL . . . TL .
.  . . . DW . . . . . DW . . . .
DL . . DW . . . DL . . . DW . . DL
.  . DW . . . DL . DL . . . DW . .
.  DW . . . TL . . . TL . . . DW .
TW . . DL . . . TW . . . DL . . TW
```

`*` (center, row 7 col 7) counts as a double-word square for scoring
purposes and is where the first word of the game must cover.

`export type PremiumKind = 'none' | 'DL' | 'TL' | 'DW' | 'TW'`
`export function premiumAt(row: number, col: number): PremiumKind`

## Tiles (`state.ts`)

Standard English 100-tile set. `export function createTileBag():
ScrabbleTile[]` — each tile `{ id: string, letter: string, points:
number }`; blanks use `letter: ''`, `points: 0`, `id` prefix
distinguishing them (e.g. `blank-0`, `blank-1`).

Distribution (letter: count/points): A 9/1, B 2/3, C 2/3, D 4/2, E
12/1, F 2/4, G 3/2, H 2/4, I 9/1, J 1/8, K 1/5, L 4/1, M 2/3, N 6/1, O
8/1, P 2/3, Q 1/10, R 6/1, S 4/1, T 6/1, U 4/1, V 2/4, W 2/4, X 1/8, Y
2/4, Z 1/10, blank 2/0. 100 tiles total.

## State (`state.ts`)

```ts
export const SCRABBLE_MIN_SEATS = 2
export const SCRABBLE_MAX_SEATS = 4
export const RACK_SIZE = 7

export interface BoardCell {
  letter: string       // the letter actually on the board (assigned letter for a blank)
  isBlank: boolean      // true if this cell was placed using a blank tile
  premiumConsumed: boolean  // true once any tile has occupied this square (premium no longer scores)
}

export type ScrabbleStage = 'play' | 'over'

export interface LastPlacement {
  by: string
  tiles: { tileId: string; row: number; col: number; letter: string; isBlank: boolean }[]
  words: { word: string; score: number }[]   // every word formed this turn (main + cross-words)
  totalScore: number
  challengeable: boolean   // false once the next player has taken any non-CHALLENGE action, or after PASS/EXCHANGE
}

export interface ScrabblePublicState {
  stage: ScrabbleStage
  turn: TurnState<'play'>
  board: (BoardCell | null)[][]     // 15x15, row-major
  bagCount: number
  handCounts: Record<string, number>
  scores: Record<string, number>
  consecutivePasses: number          // see end-game trigger below
  lastPlacement: LastPlacement | null
  winnerId: string | null            // set only when stage === 'over'
}

export interface ScrabblePrivateState {
  rack: Zone<ScrabbleTile>
}

export type ScrabbleAction =
  | { type: 'PLACE_WORD'; tiles: { tileId: string; row: number; col: number; letter: string }[] }
    // `letter` is required for every tile; for a non-blank tile it must equal the tile's own
    // `letter`, for a blank it's the human/bot's chosen letter — validated in rules.ts
  | { type: 'EXCHANGE_TILES'; tileIds: string[] }
  | { type: 'PASS' }
  | { type: 'CHALLENGE' }
```

`createScrabbleGame(playerIds: string[], seed: number): ScrabbleSession`
mirrors `createDominoesGame`'s/`createRummyGame`'s shape: seeded RNG
from `createRng(seed)`, shuffle the tile bag, deal `RACK_SIZE` tiles to
each seat's `rack` `Zone` in `playerIds` order (one at a time,
round-robin, matching `dealRound`'s loop shape), remaining tiles stay
in a host-only `bag: Zone<ScrabbleTile>` field on `ScrabbleSession`
(dominoes' `boneyard` / rummy's `stock` pattern — host-only, never
part of `HostSession`). Empty 15x15 `board` (all `null`),
`turn = createTurnState(playerIds, 'play')`, all scores 0,
`consecutivePasses: 0`, `lastPlacement: null`, `stage: 'play'`,
`winnerId: null`.

## Rules (`rules.ts`)

**Design decision, locked**: the engine does **not** check dictionary
validity when a word is placed — only structural legality. Any
sequence of tiles that forms a structurally legal placement is
accepted, valid English or not. This is the real reason a challenge
mechanic exists (and the reason bluffing is a real strategy) — auto-
rejecting invalid words at placement time would make `CHALLENGE`
pointless and the dictionary a formality. Dictionary lookups happen
only inside `resolveChallenge` (below) and inside the bot's own move
search (`bot.ts`).

**`PLACE_WORD` structural legality** (all of the below, in order —
reject with a clear reason on first failure):
1. Every named `tileId` is actually in the acting player's rack.
2. Every `(row, col)` target cell is empty (`board[row][col] === null`)
   and in bounds.
3. All placed cells lie in a single row (all same `row`) or single
   column (all same `col`), never both unless it's a single tile.
4. Combined with tiles already on the board, the full placed run (new
   tiles plus any existing tiles interleaved between the min/max new
   position) has no gaps — every cell in the contiguous span is
   occupied either by a new tile or a pre-existing one.
5. First placement of the game (`board` entirely empty beforehand)
   must cover the center cell `(7,7)` and must place 2+ tiles.
6. Every subsequent placement must be adjacent (orthogonally touching,
   not diagonal) to at least one already-occupied cell, OR form a
   cross-word with one — i.e. the placement must connect to existing
   tiles somehow. Reject fully-isolated placements.
7. For a blank tile (`tileId` starts with `blank-`), `letter` must be a
   single A-Z letter chosen by the player; for a non-blank tile,
   `letter` must equal that tile's own `letter`.

**Word extraction**: for the placed run, compute the main word (read
the full contiguous line through all placed tiles, in both
directions, using existing + new board cells). For each individual
newly-placed tile, also check perpendicular to the main word's
direction: if there are occupied cells immediately adjacent
perpendicular to that tile, extract that full perpendicular word too.
Every extracted word (main + all cross-words) is length >= 2 to count;
single letters don't form a "word" on their own and aren't scored or
challenged individually — this is a natural consequence of only
extracting when adjacent occupied cells exist.

**Scoring** (`scoreWords` helper, pure, reused by rules + bot):
for each extracted word, sum each cell's tile points, applying that
cell's letter multiplier (DL x2, TL x3) ONLY if `premiumConsumed` was
false before this placement (i.e. only for cells placed THIS turn) —
already-covered squares never rescore. Then apply the word multiplier
(DW x2, TW x3, `*` counts as DW) once per word, again only if at least
one of the word's cells is a newly-placed tile sitting on a not-yet-
consumed DW/TW/`*` square. Sum all extracted words' scores. If exactly
7 tiles were placed this turn (a "bingo"), add 50 bonus points once,
total. Mark every newly-occupied cell's `premiumConsumed: true`
regardless of whether its premium applied.

**`PLACE_WORD` effect**: validate structurally (above), compute words
+ score (dictionary NOT consulted), place tiles on the board, remove
them from the rack, refill the rack from the bag up to `RACK_SIZE` (or
fewer if the bag runs out), add score to `scores[playerId]`, set
`lastPlacement` (with `challengeable: true`), reset
`consecutivePasses: 0`, advance turn. Then run the end-game check
(below).

**`EXCHANGE_TILES`**: legal only if `bagCount >= tileIds.length` and
every named tile is in the rack (standard rule: can't exchange more
tiles than remain in the bag, though in practice with a 100-tile set
this is rarely binding). Effect: swap the named tiles back into the
bag, reshuffle (session RNG), draw the same count back out to the
rack, score unchanged, `lastPlacement: null` (an exchange is not
challengeable — nothing to challenge), `consecutivePasses += 1`,
advance turn.

**`PASS`**: no rack change. `lastPlacement: null`,
`consecutivePasses += 1`, advance turn.

**`CHALLENGE`**: legal only if `lastPlacement !== null &&
lastPlacement.challengeable === true` and the acting player is not
`lastPlacement.by` (mirrors real rules — you can't challenge your own
play; any OTHER player may, not only the next player in turn order,
since with 3-4 players anyone still get a look before their own next
turn). Effect, using the loaded `ScrabbleDictionary` passed into the
validator (screens/wiring spec wires this through — see `ActionValidator`
in `sync.ts` for how game-specific extra params like this get threaded
in, mirror whatever pattern an existing multi-arg validator already
uses, or thread it via closure the way `createHostSession` callers
already close over a seeded RNG):
- Check every word in `lastPlacement.words` against `isWord`.
- **All valid** (challenge fails): the challenger's OWN next turn is
  skipped as the penalty (advance turn state past them once, extra —
  reuse `advanceTurn` twice or an explicit skip helper, your call to
  keep this clean). `lastPlacement.challengeable = false` (locked in,
  can't be challenged twice). No score change.
- **Any invalid** (challenge succeeds): undo the placement — remove
  those tiles from the board (cells return to `null`,
  `premiumConsumed` reverts to whatever it was before, which is always
  `false` since these cells were only just placed), return the tiles
  to the ORIGINAL placer's rack, subtract `lastPlacement.totalScore`
  back out of `scores[lastPlacement.by]`. Do not advance or skip
  anyone's turn further — the placer's turn is already over and
  becomes retroactively a wasted turn, current turn proceeds normally
  from whoever's turn it already was. `lastPlacement: null`.
- A `CHALLENGE` action itself does not consume the challenger's turn
  unless it's their own turn to act — this action is available as an
  option instead of / in addition to a normal action on top of the
  normal flow; if using it outside your own turn requires a state
  model change from the current strictly-sequential turn engine,
  that's fine to build (e.g. don't call `advanceTurn` for a challenge
  from a non-current player) — just don't break `currentPlayer`'s
  meaning for every OTHER action type.

**End-game check** (run after every successful `PLACE_WORD`,
`EXCHANGE_TILES`, and `PASS` — not after `CHALLENGE`):
- If `bagCount === 0` and any player's rack is empty: game over. That
  player gets `+= sum of every OTHER player's remaining rack tile
  points`; every other player gets `-= sum of their own remaining rack
  tile points`. Set `stage: 'over'`, `winnerId` = highest final score
  (ties: null, or first by seat order — your call, document whichever
  you pick).
- Else if `consecutivePasses >= playerIds.length * 2` (everyone has
  passed/exchanged twice in a row with no intervening placement):
  game over, no rack adjustment, `winnerId` = highest current score
  (same tie handling as above).

## Bot (`bot.ts`)

`scrabbleBotStrategy: BotStrategy<ScrabblePublicState,
ScrabblePrivateState, ScrabbleAction>` — takes the loaded
`ScrabbleDictionary` as an extra closed-over/curried argument (bot
strategies here need the trie same as the challenge validator; mirror
however you threaded the dictionary into `rules.ts`'s validator so
both stay consistent).

Every bot turn, in order:
1. **Challenge check first**: if `publicState.lastPlacement !== null &&
   lastPlacement.challengeable && lastPlacement.by !== <this bot's
   playerId>`, check every word in `lastPlacement.words` against the
   dictionary. If any is invalid, return `{ type: 'CHALLENGE' }`
   immediately — do not also make a placement this call (matches
   `BotStrategy`'s one-action-per-call contract; the host's bot loop
   re-invokes the strategy next, and by then `lastPlacement` will be
   `null` after the challenge resolves).
2. Otherwise, generate legal placements: find anchor squares (empty
   cells adjacent to any occupied cell; if the board is empty, the
   only anchor is the center). For each anchor, try rack-tile
   permutations (<=5040 for 7 tiles) extending through the dictionary
   trie in both directions, backtracking on dead prefixes, and validate
   any cross-words formed at each perpendicular position against the
   dictionary too (the bot never knowingly plays an invalid word,
   unlike a human bluffing — see below for why).
3. Score every valid, fully-dictionary-checked candidate with the same
   `scoreWords` helper `rules.ts` uses. Pick from the top few
   candidates by weighted random rather than always the single best —
   mirrors chess-easy's weighted pool, keeps the bot from reading as a
   perfect solver.
4. If no legal placement exists: `EXCHANGE_TILES` with 1-3 tiles picked
   at random from the rack if `bagCount > 0`, else `PASS`.

**Bot never bluffs** (deliberate simplification, document as a design
choice, not an oversight): every word the bot plays is dictionary-
valid by construction, since move-gen already filters through the
trie. A "bluffing" bot that occasionally plays fake words and hopes
not to get challenged is a plausible future enhancement, not v1 scope.

## Verify before reporting

Write tests covering: tile bag composition (100 tiles, correct
letter/point distribution), deal correctness at 2/3/4 seats (7-tile
racks, remainder in bag, total-tile conservation across bag + racks +
board always 100), board premium-square layout matches the canonical
grid above (spot-check a handful of known squares), placement legality
(gap rejection, first-move-must-cover-center, must-connect-to-existing,
single-line-only, blank-letter validation), word extraction (main word
+ multiple simultaneous cross-words), scoring (letter/word multipliers,
premium-consumed-once, 50-point bingo bonus), `EXCHANGE_TILES` and
`PASS` state changes, the full `CHALLENGE` success/failure paths
(board/rack/score rollback on a successful challenge, turn-skip penalty
on a failed one, non-challengeable-twice), both end-game triggers
(empty rack + empty bag score adjustment; consecutive-pass-out), and
the bot's challenge-first priority plus its move-gen producing only
dictionary-valid words. Run `npx tsc -b --noEmit`, `npm test -- --run`,
`npm run build` yourself, paste the actual output, then report a
summary, every judgment call you made beyond what this spec locked
down, and confirmation of all three commands passing.

## Note for the screens/wiring spec (not this spec's scope)

Locked by the user, to carry forward:
- Blank tile assignment is a popup/modal at placement time: when a
  human places a blank, prompt them to type the letter it represents
  before the placement action is submitted (the `letter` field on that
  tile in `PLACE_WORD` is populated from this prompt).
- On the board, a tile that was placed blank must render its assigned
  letter with an obviously different treatment (lighter weight/color
  than normal tiles was the suggestion) so every player can see at a
  glance which tiles started as blanks — `BoardCell.isBlank` carries
  this from the engine, the screens spec owns the actual visual
  treatment.
