# Spec 51 — Scrabble house bot difficulty

A room-wide difficulty setting for Scrabble house bots, mirroring the
existing pattern already shipped for Uno (`unoDifficulty`/
`UnoRoom.tsx`) and Chess (`ChessDifficulty`/`ChessRoom.tsx`). Read
`src/board-games/scrabble/bot.ts`, `src/board-games/scrabble/rules.ts`
(the `hasInvalid`/challenge-check shape only), `src/screens/
ScrabbleRoom.tsx`, `src/screens/UnoRoom.tsx` IN FULL, and the following
exact locations in `src/App.tsx` before writing anything:
- `type ScrabbleView` (currently ~line 156-158) vs. `type UnoView`
  (~line 150-152) — compare the two, Uno's `lobby` variant already
  carries `difficulty`.
- `function scrabbleBroadcast()` (~3423-3455) vs. Uno's equivalent
  lobby-broadcast block (~2784-2793).
- `function addScrabbleHouseBot()` (~3517-3527).
- `async function scrabbleStart()` (~3529-3554).
- `async function runScrabbleBot(botId, key)` (~3556-3572) — the
  `createScrabbleBotStrategy(scrabbleDictionaryRef.current!)` call at
  line ~3567 is the actual wiring point for the difficulty parameter.
- `function unoSetDifficulty(d)` (~2921-2926) — the exact shape to
  mirror for a new `scrabbleSetDifficulty`.
- The `resetToEntry`-style cleanup block for Scrabble (~926-938) where
  `scrabbleDifficultyRef.current` must be reset alongside the other
  per-room refs.
- The Scrabble lobby render block (~4970-4987) where `<ScrabbleRoom>`
  is invoked.

You own modifying exactly:
- `src/board-games/scrabble/bot.ts`
- `src/board-games/scrabble/bot.test.ts`
- `src/screens/ScrabbleRoom.tsx`
- `src/App.tsx` — Scrabble-prefixed state/refs/functions/JSX only (the
  locations listed above and their immediate siblings). Do not touch
  any other game's code in this file.

Everything else is read-only.

## Why this is being asked for

Bots currently play at a single fixed strength: always the best-
scoring word available, and (per spec 47/50) always challenging an
opponent word it can prove is invalid. A human player doesn't have
perfect dictionary recall — they sometimes let a bogus word slide
because they don't know it's wrong, or don't bother checking. A single
fixed bot strength can't represent that range. This spec adds three
named tiers (`easy`/`medium`/`hard`) that tune two independent things:
how good a move the bot plays, and how often it calls out a word it
knows is fake.

## Design: reuse `BotDifficulty`, don't invent a new type

`src/types.ts` already exports `export type BotDifficulty = 'easy' |
'medium' | 'hard'`, used by Uno today. Import and reuse this exact
type for Scrabble — do not create a `ScrabbleDifficulty` alias. Default
value is `'medium'`, matching Uno's default (Chess's `'easy'` default
does not apply here — Chess is a different, single-opponent game).

## `bot.ts` changes

`createScrabbleBotStrategy` currently has signature:
```ts
export function createScrabbleBotStrategy(
  dictionary: ScrabbleDictionary,
): BotStrategy<...>
```
Change to:
```ts
export function createScrabbleBotStrategy(
  dictionary: ScrabbleDictionary,
  difficulty: BotDifficulty,
): BotStrategy<...>
```
(Import `BotDifficulty` from `../../types.ts`.)

### Knob 1 — challenge probability

Currently (step 1 of the strategy):
```ts
if (publicState.lastPlacement !== null &&
    publicState.lastPlacement.challengeable &&
    publicState.lastPlacement.by !== playerId) {
  const hasInvalid = publicState.lastPlacement.words.some((w) => !dictionary.isWord(w.word))
  if (hasInvalid) {
    return { type: 'CHALLENGE' }
  }
}
```
The bot only ever reaches `hasInvalid` when it has already, with
certainty, proven the word is fake (via the real dictionary) — this
knob is NOT about the bot's ability to detect a bad word, only about
whether it bothers to act on that knowledge, mirroring a human who
might not know or might not bother to look it up. Gate the `return`
behind a probability roll keyed by difficulty:
- `easy`: ~20% chance to challenge when it knows the word is invalid
- `medium`: ~55%
- `hard`: ~90%

If the roll says "don't challenge," fall through to normal move
generation (step 2) exactly as if `hasInvalid` were false — do not
introduce a separate no-op path. Use `Math.random() < tier` for the
roll (this file already uses bare `Math.random()` elsewhere for
candidate tie-breaking and exchange-count selection, so this matches
existing style — no new RNG abstraction needed).

### Knob 2 — move quality (candidate selection)

Currently, after generating all valid `candidates` (step 2's end):
```ts
candidates.sort((a, b) => b.score - a.score)
const topScore = candidates[0].score
const topCandidates = candidates.filter((c) => c.score >= topScore * 0.95)
const picked = topCandidates[Math.floor(Math.random() * topCandidates.length)]
return picked.action
```
Branch this on difficulty:
- `medium` and `hard`: keep this exact behavior unchanged (top-5%-tie,
  random among ties). Do not build out a deeper strategic heuristic
  for `hard` in this spec — the search itself (correctness, cross-word
  validation, time budget) was already the subject of spec 50 and is
  out of scope here; `hard` differing only in challenge aggressiveness
  is an acceptable, honest v1.
- `easy`: pick uniformly at random from ALL valid `candidates`
  (`candidates[Math.floor(Math.random() * candidates.length)]`), not
  score-weighted at all — this produces the "plays a real word, but
  not necessarily a good one" feel of a weaker human player. Do not
  filter out low-scoring candidates before this pick; the whole point
  is an easy bot sometimes plays a 2-point word when a 30-point word
  was sitting right there in its rack.

Do not change anything about candidate generation itself (anchor
enumeration, permutation search, cross-word validation, the 300ms time
budget) — this spec only touches which already-valid candidate gets
chosen and whether a known-bad opponent word gets challenged.

## `ScrabbleRoom.tsx` changes

Add to `ScrabbleRoomProps`:
```ts
difficulty: BotDifficulty
onSetDifficulty: (d: BotDifficulty) => void
```
(import `BotDifficulty` from `../types`). Render a difficulty selector
matching `UnoRoom.tsx`'s "House bot reflex" block exactly in structure
(three pill buttons in a row, `disabled={!isHost}` so guests see but
can't change it, selected tier highlighted) — place it directly above
the existing "Add house bot" / "Start game" button block. Adjust the
caption text to describe what it actually changes for Scrabble, e.g.
"How good a move house bots play, and how often they call a bad
word." — don't reuse Uno's "How quickly house bots call Uno." caption
verbatim, it describes the wrong mechanic.

## `App.tsx` wiring

1. Add state + ref (mirror `unoDifficulty`/`unoDifficultyRef` exactly):
   ```ts
   const [scrabbleDifficulty, setScrabbleDifficulty] = useState<BotDifficulty>('medium')
   const scrabbleDifficultyRef = useRef<BotDifficulty>('medium')
   ```
2. Add `difficulty: BotDifficulty` to `ScrabbleView`'s `lobby` variant
   (mirror `UnoView`'s lobby variant exactly).
3. In `scrabbleBroadcast()`'s lobby branch, include
   `difficulty: scrabbleDifficultyRef.current` in the constructed
   `view` (mirror Uno's equivalent block).
4. Add a `scrabbleSetDifficulty(d: BotDifficulty)` function mirroring
   `unoSetDifficulty` exactly: guard on `scrabbleRole !== 'host' ||
   scrabbleStartedRef.current` (return early otherwise), set both the
   ref and state, then call `scrabbleBroadcast()`.
5. In the Scrabble reset-to-entry cleanup block (~926-938), reset
   `scrabbleDifficultyRef.current = 'medium'` and
   `setScrabbleDifficulty('medium')` alongside the other resets there.
6. At the `createScrabbleBotStrategy(scrabbleDictionaryRef.current!)`
   call site inside `runScrabbleBot` (~line 3567), pass
   `scrabbleDifficultyRef.current` as the second argument.
7. In the Scrabble lobby guest branch of `onState` (~3619,
   `if (view.kind === 'lobby') { setScrabbleView(view); ... }`), also
   call `setScrabbleDifficulty(view.difficulty)` so a guest's own
   local `scrabbleDifficulty` state stays in sync for display (mirror
   whatever Uno's guest `onState` handler does for its own
   `difficulty` field — read it to confirm the exact pattern before
   copying it).
8. In the `<ScrabbleRoom>` render block (~4975-4986), pass
   `difficulty={scrabbleDifficulty}` and
   `onSetDifficulty={scrabbleSetDifficulty}`.

Difficulty is chosen once per room, before or after bots are added —
it applies to every house bot in the room uniformly for the whole
game (matching Uno's model exactly; no per-seat difficulty in this
spec). Changing it mid-lobby (before Start Game) is fine and takes
effect on the next bot turn; the setting can't be changed once
`scrabbleStart()` has run (`scrabbleSetDifficulty` already guards on
`scrabbleStartedRef.current`).

## Do NOT

- Touch any file outside the four listed.
- Touch any other game's difficulty system (Chess, Uno) even though
  you're reading them for reference.
- Add a `ScrabbleDifficulty` type — reuse `BotDifficulty`.
- Change candidate *generation* (search, validation, time budget) —
  only which candidate gets picked, and the challenge-probability
  gate.
- Add per-seat difficulty, a fourth tier, or any UI beyond the pill
  selector described above.
- Run git, commit, or push.
- Add any new dependency.

## Required tests

In `bot.test.ts`, add tests that:
1. Given a fixed `Math.random()` mock (or a large-N statistical
   sample — pick whichever is more reliable given the existing file's
   style, and say which you chose and why) at `easy`, the bot
   sometimes plays a lower-scoring candidate when a higher-scoring one
   was available (construct a rack/board with at least two valid
   candidates of clearly different scores).
2. At `medium`/`hard`, the top-tie-only behavior from before this spec
   is unchanged (existing tests 1-4 should still pass with an added
   `difficulty` argument — update their `strategy(...)` construction
   calls to pass `'medium'` explicitly rather than relying on a
   default, since there is no default in the function signature).
3. Given a `lastPlacement` with a word the mock dictionary marks
   invalid, the bot challenges at a rate that differs meaningfully
   between `easy` and `hard` — e.g. run the strategy N times (N large
   enough for a stable result, document your choice) with a fixed
   invalid `lastPlacement` at each tier and assert the challenge rate
   for `hard` is clearly higher than for `easy` (don't assert exact
   percentages given `Math.random()` in a real, unseeded run — assert
   a directional/threshold relationship that would fail if the tiers
   were swapped or collapsed to the same value).

## Verify before reporting

`npx tsc -b --noEmit`, `npm test -- --run`, `npm run build`. Also
live-verify: start a Scrabble room, confirm the difficulty selector
renders and is clickable pre-start, confirm a guest joining the room
sees the host's currently-selected tier (read-only), start a game at
`easy` and separately at `hard` with a house bot seeded onto an
identical or comparable board state, and report what you actually
observed differ between the two runs (move score chosen, whether a
challenge was called on a known-bad word) — don't just report that
tests pass. Report every judgment call (exact `Math.random()` test
strategy chosen, exact caption text used, anything about the guest
sync in step 7 above that wasn't fully pinned down) beyond what this
spec locked down.
