# Spec 49 — Scrabble wiring

Third and final spec of the Scrabble build (47 = engine, 48 = screens,
both landed). This wires the existing engine + screens into the live
app: lobby, PeerJS host/guest lifecycle, bot-per-seat, `Landing.tsx`,
`route.ts`, `README.md`. No engine or screen changes.

Read `specs/42-skipbo-wiring.md` in full, then read the ACTUAL Skip-Bo
wiring it produced in `src/App.tsx` (search `skipBo` — the lobby
route/screen-switch logic, `startSkipBoHost`/`startSkipBoGuest`,
`skipBoBroadcast`, `addSkipBoHouseBot`, `runSkipBoBot`/
`runSkipBoBotsIfNeeded`, `skipBoRematch`, the `skipBoStale`/
`skipBoActorKey` guard, and the `estimateDealIntroMs`-based
`skipBoBotsHeldUntilRef` hold-off) IN FULL before writing anything —
this spec mirrors that wiring's shape exactly except for the stated
deltas below. Also skim `src/screens/Landing.tsx` and
`src/state/route.ts` for their exact one-entry-per-game shape.

You own creating/modifying exactly these:

- `src/App.tsx` (modify — add Scrabble wiring alongside every other
  game's, following the file's existing per-game section convention;
  do not touch any other game's code)
- `src/screens/Landing.tsx` (modify — one shelf entry)
- `src/state/route.ts` (modify — one union member + one segment entry)
- `README.md` (modify — add Scrabble to the game list, matching
  whatever one-line-per-game format is already there)

Everything else (engine, screens) is read-only.

## Route + Landing

`route.ts`: add `'scrabble'` to the `RoutedGame` union and
`scrabble: 'scrabble'` to `GAME_SEGMENTS`, same shape as every other
entry.

`Landing.tsx`: one shelf object, `{ title: 'Scrabble', note: '2–4
players', color: '#8b6e47', onClick: onPickScrabble }` (color matches
spec 48's locked brand color — do not pick a different one here),
`onPickScrabble` threaded through the component's props exactly like
`onPickSkipBo` is, wired in `App.tsx` to `startScrabbleHost`.

## Join-code prefix

Skip-Bo uses `'SB-'`. Before picking Scrabble's prefix, grep
`App.tsx` for every existing `code.startsWith('...')` check and
confirm your choice isn't taken — `'SCR-'` is the expected fit but
verify it's actually free rather than assuming; report what you found
and used.

## State/refs (mirror Skip-Bo's exact set, renamed)

`scrabbleRole`, `scrabbleStarted`(Ref), `scrabbleHostRef`,
`scrabbleSessionRef` (holds the full `ScrabbleSession` — `{session,
bag, rng}`, not just the inner `HostSession`, exactly like
`skipBoSessionRef` holds the Skip-Bo equivalent), `scrabbleLocalPlayerId`,
`scrabbleView`, `scrabbleBotSeatsRef`, `scrabbleBotCounterRef`,
`scrabbleBotsHeldUntilRef`, `scrabbleBotBusyRef`. One genuinely new
ref Skip-Bo doesn't need: **`scrabbleDictionaryRef`** — holds the
loaded `ScrabbleDictionary | null`. See "Dictionary loading" below.

## Dictionary loading (new — no Skip-Bo precedent, this is Scrabble-specific)

Only the HOST ever validates actions (host-authoritative, same as
every game) — so only the host needs the dictionary loaded; guests
never touch it. In `startScrabbleHost()`, alongside the existing
host-setup work, kick off `loadDictionary().then(d => {
scrabbleDictionaryRef.current = d })` (from
`src/board-games/scrabble/dictionary.ts`) — fire-and-forget, don't
block room creation on it (the lobby doesn't need it yet). Before
`scrabbleStart()` actually creates the game session (host clicks
"Start game"), **await the dictionary being loaded** — if
`scrabbleDictionaryRef.current` is still null at that moment, await
the same `loadDictionary()` promise (store it, don't re-fetch) before
proceeding, and show a brief "Loading dictionary…" state on the Start
button (disabled + relabeled) rather than silently hanging with no
feedback. Every `applyScrabbleAction`/`runScrabbleBotTurn` call
thereafter passes `scrabbleDictionaryRef.current` as the dictionary
argument — since you've awaited it before `scrabbleStart()`, it will
never be null once the game is actually running.

## Lobby

`startScrabbleHost()`: create code (prefix above), set host
state/refs, `createHost<ScrabbleView, ScrabbleAction>(code, { onJoin,
onAction, onLeave })` — `onJoin` rejects on the started flag first,
then on `seats.length >= SCRABBLE_MAX_SEATS`, exactly like Skip-Bo's
`onJoin` order.

`startScrabbleGuest(code)`: mirror `startSkipBoGuest` exactly,
`joinHost<ScrabbleView, ScrabbleAction>(...)`, routed from the
join-code field via the prefix check above.

`addScrabbleHouseBot()`: capped at `SCRABBLE_MAX_SEATS`, monotonic
counter (`scrabbleBotCounterRef.current += 1` then
`bot-${scrabbleBotCounterRef.current}`) — the fixed post-spec-39
scheme, never `bot-${seats.length}`.

`scrabbleStart()`: validate against `SCRABBLE_MIN_SEATS`/
`SCRABBLE_MAX_SEATS`, await the dictionary per above, then
`createScrabbleGame(seats, seed)`.

## Broadcast (private rack delivery)

`scrabbleBroadcast()`: lobby phase broadcasts the roster to everyone,
same as every sibling. Game phase: compute the host's own snapshot via
`deriveSnapshot(session.session, localPlayerId)`, then loop every seat
and `scrabbleHostRef.current?.sendTo(seat.playerId, ...)` for each
non-host, non-bot seat with THEIR OWN private view (their `rack`) —
mirror `skipBoBroadcast`'s exact private-delivery loop. This is the
highest-privacy-risk part of this spec (a rack leaking to another
player is a real bug class, same tier Skip-Bo's own wiring review
treated as its top risk) — read `skipBoBroadcast` line by line before
writing this, don't approximate it.

## Screen switch

Mirror Skip-Bo's three-way branch, substituting spec 47's actual
fields (`stage`/`winnerId`, not `roundOver`/`matchWinnerId`):
- Lobby: `scrabbleRole && !scrabbleStarted` → `<ScrabbleRoom>`.
- Results: `scrabbleView?.kind === 'game' && scrabbleView.publicState.stage === 'over'` → `<ScrabbleResults>`.
- Table: `scrabbleView?.kind === 'game' && scrabbleView.publicState.stage === 'play' && scrabbleLocalPlayerId` → `<ScrabbleTable>`, passing the new `opponentNames`/`opponentColors` props spec 48 added (build these from the current seat list — a `Record<playerId, name>` and a per-seat color assignment; reuse whatever per-seat color scheme an existing N-player sibling like Rummy/Phase10/SkipBo already assigns opponents, don't invent a new palette).

`scrabbleRematch()`: fresh game, same `seatOrder`, new seed — matches
spec 47's single-continuous-game design (no round/match layer, same
precedent as Skip-Bo/Battleship/Dominoes/Checkers/Chess, not Rummy's
carry-forward-scores model).

## Bot scheduling — the one place this spec genuinely departs from Skip-Bo's shape

Skip-Bo's bot loop only ever wakes a bot when the turn engine says
it's literally that bot's turn (`currentPlayer(turn) === botId`),
because every Skip-Bo action is turn-gated. **Scrabble is different**:
`CHALLENGE` is deliberately NOT turn-gated in spec 47's `rules.ts` —
any seat other than the placer may send it any time
`lastPlacement.challengeable` is true, regardless of whose formal turn
it is. A naive "only wake a bot on its own turn" loop would mean a bot
sitting two seats away from the placer never gets a chance to catch an
invalid word at all, even though the engine allows it — defeating the
entire point of building a real challenge mechanic (an invalid word
would only ever get caught if the very next player in turn order
happens to challenge). Fix this with one clean scheduling rule instead
of one bot-coroutine-per-seat:

`runScrabbleBotsIfNeeded()` (called after every `scrabbleBroadcast()`,
same trigger points as `runSkipBoBotsIfNeeded`, plus re-polled the
same way while `scrabbleBotBusyRef` is held) does, each time it runs,
a single scan over bot seats in `seatOrder`:
1. First priority: any bot seat where `canChallenge`-equivalent is
   true (`lastPlacement !== null && lastPlacement.challengeable &&
   lastPlacement.by !== thatBotId && stage === 'play'`) — among those,
   pick the first in seat order (deterministic, no real concurrency
   needed since this all runs synchronously host-side).
2. Else: the bot seat, if any, where `currentPlayer(turn) === thatBotId`.
3. If neither exists, do nothing this tick.

For whichever ONE bot seat is selected, pace exactly one action
(`await wait(...)` per the pacing rules below, respecting
`scrabbleBotsHeldUntilRef` the same way Skip-Bo does for its deal-intro
hold-off), run its strategy once via `runScrabbleBotTurn` (which
internally already decides challenge-vs-real-move — you are not
duplicating that decision, just choosing WHICH bot gets invoked this
tick), broadcast, and return — the next `runScrabbleBotsIfNeeded()`
call (triggered by the broadcast this action just caused) re-scans
from scratch and picks the next opportunity. This naturally handles
the "challenge, then that same player's real move" sequence too: a
successful OR failed challenge doesn't necessarily change
`currentPlayer`, so the very next scan may find the SAME bot now
eligible under rule 2 instead of rule 1, and it takes its real turn
next tick — this is correct, not a bug, and don't try to force a
different bot to go next just because one bot acted last tick.

Use the same `scrabbleStale(key)`/`scrabbleActorKey(session)` guard
shape as `skipBoStale`/`skipBoActorKey` so a stale coroutine from a
previous game/rematch can't race in.

## Pacing

Every bot action (whether a challenge-check or a real move) waits
`BASE_MS` (900, hardcoded — Scrabble, like every card-engine/board-game-
engine game, does not read `botPace`, which belongs only to the older
`src/games/*` dice/board system) before acting — one wait per action,
matching the per-action granularity Skip-Bo established, since a
Scrabble bot's `PLACE_WORD` legal-move search is real computation, not
free: **verify in your own testing that a bot's move-generation search
completes well under that 900ms window even on a fairly full board**
(this is the mandatory CLAUDE.md pacing check — a "paced" delay that's
actually mostly eaten by real compute time is a bug, not cosmetic).

Deal-intro hold-off: on `scrabbleStart()` and `scrabbleRematch()`, set
`scrabbleBotsHeldUntilRef.current = Date.now() +
estimateDealIntroMs(totalTilesDealt) + SKIPBO_DEAL_HOLD_BUFFER_MS`-
equivalent (reuse the same buffer constant Skip-Bo uses, or define a
Scrabble-specific one of the same value if it's a Skip-Bo-local
constant — your call, document which), where `totalTilesDealt` =
`seats.length * RACK_SIZE` (up to 4×7=28) — mirrors Skip-Bo's
`playerIds.length * 5` shape with Scrabble's own rack size. **At 4
seats with 3 bots**, verify by reading the code (and live testing,
below) that bots genuinely wait out this hold before their first
action — this is exactly the "more bots means more consecutive fast
actions between a human's own turns" scenario CLAUDE.md's pacing
section calls out as the thing to judge against, not a 1-bot table.

## House-bot ID collision reset

Wherever the app's full-reset path (`resetToEntry`-equivalent, already
exists and handles this for Skip-Bo/Rummy/Phase10/Wahoo/Mexican
Train/Uno) clears each game's `xBotSeatsRef`, add Scrabble's
`scrabbleBotSeatsRef.current.clear()` and
`scrabbleBotCounterRef.current = 0` to that same reset block, mirroring
exactly how Skip-Bo's pair is cleared alongside it.

## Verify before reporting

`npx tsc -b --noEmit`, `npm test -- --run` (1127 unchanged — App.tsx
wiring gets no dedicated test file, matching every sibling's wiring
spec), `npm run build`. Then — **this is the first Scrabble spec where
a live browser check is both possible and mandatory** per this
project's standard practice for UI/wiring work: start the dev server,
play a full 2-seat host+bot match AND a full 4-seat host+3-bots match
in the browser yourself. Confirm: deal intro plays once (not per
turn), rack tiles are private (only your own rack visible — check via
a second browser/guest connection if you can, or reason carefully
about `scrabbleBroadcast`'s per-seat `sendTo` if a live 2-browser test
isn't practical in your environment — say explicitly which you did),
a full word placement including a blank tile end to end (popup
appears, letter renders visibly lighter on the board), a real
challenge (successful AND failed, if you can force both), bots pace
correctly at the 4-seat table (watch for stacked/instant bot actions —
report timings you observed, don't just assert "felt fine"), and the
game reaches its end state (either trigger) showing `ScrabbleResults`
correctly including the tie case if you can force one. Report exactly
what you verified live vs. what you could only verify by reading code,
honestly — a claimed check you didn't actually perform is the worst
possible outcome here, this project treats it as a hard requirement,
not optional polish.
