# Spec 54 — Blackjack wiring

Part of the Blackjack + Texas Hold'em charter (`CHARTER.md`), milestone
M2 — the final Blackjack milestone. Wires the landed engine (spec 52)
and screens (spec 53) into `src/App.tsx`, `src/screens/Landing.tsx`, and
`src/state/route.ts`, mirroring Rummy's wiring pattern (the closest
N-seat, host-authoritative, PeerJS sibling) with two deliberate,
locked departures explained below.

Read `src/App.tsx`'s existing Rummy wiring in full before writing any
code — the relevant blocks are: state/refs declaration (~App.tsx:220-352),
`rummyBroadcast`/`onAction`/dispatch (~App.tsx:996-1075, 1193-1204),
`rummyStart` (~App.tsx:1105-1118), the bot loop (`runRummyBot`,
~App.tsx:1120-1152, and the triggering effect around line 3892), the
auto-advance-round effect (~App.tsx:3898-3908), the Landing-gate
condition (~App.tsx:4123), the join-code-prefix dispatch (~App.tsx:4131-
4141), the Room/game render block (~App.tsx:4246-4310), and
`resetToEntry()`. Also skim Skip-Bo's bot loop (~App.tsx:3339-3372) for
its `holdRemaining`/`BASE_MS` pattern, since it (like Blackjack) chains
multiple bot actions within one turn.

## Files you own
- `src/App.tsx`
- `src/screens/Landing.tsx`
- `src/state/route.ts`
- `README.md` (add Blackjack to whatever game list/section already
  documents the other games — match its existing format, don't restructure)

Do not touch any engine file, any screens file, or any other game's
wiring code. Do not run `git`.

## Locked design — two departures from Rummy's pattern, both intentional

**1. Broadcast is single, not per-guest `sendTo`.** Blackjack's
`BlackjackPublicState` has no private per-seat data (no hidden hands —
confirmed in spec 52: every seat's cards are always fully visible to
everyone, only the dealer's hole card is conditionally hidden via the
public `dealerHoleRevealed` flag, not per-seat privacy). So
`blackjackBroadcast()` should derive ONE view via `deriveSnapshot`-
equivalent (or just wrap `publicState` directly the way Rummy's lobby-
phase broadcast already does with no derived private state) and call
`blackjackHostRef.current?.broadcast(view)` once, not loop `sendTo` per
guest. This is a real simplification, precedented by Rummy's own lobby-
phase broadcast call — not a shortcut around anything Blackjack needs.

**2. `START_NEXT_ROUND` is human-initiated by whichever seat clicks
"Deal next round" (already built into `BlackjackTable`'s round-over
banner in spec 53) — there is NO automatic host-side timer like
Rummy's `ROUND_PAUSE_MS`/`START_NEXT_ROUND` auto-advance effect.** This
is deliberate: Blackjack rounds resolve quickly and repeatedly (not a
multi-minute meld-out event), and letting a human decide when they're
done reading the round summary fits this project's human-pacing
philosophy better than a forced 4-second timer would. The action still
routes through the exact same path every other action does (guest UI
calls the dispatch function, which is `onAction`-routed to the host if
the local player isn't the host, exactly like HIT/STAND/etc — no new
plumbing required, just don't gate the button or its handler on
`isHost` the way Rummy's *automatic* advance effect does).

## State/refs (mirror Rummy's naming convention, `blackjack`-prefixed)
- `blackjackRole: 'host' | 'guest' | null`
- `blackjackCode: string | null`
- `blackjackLocalPlayerId: string | null`
- `blackjackView`: a `BlackjackView` union — `{ kind: 'lobby' }` (seats
  not yet started) | `{ kind: 'game'; revision: number; publicState:
  BlackjackPublicState }` (no `hand`/private-state field needed per the
  single-broadcast design above).
- `blackjackConnection`, `blackjackNotice`, `blackjackStarted`,
  `blackjackSeats` — same shapes as Rummy's equivalents.
- Refs mirroring every one of the above state values (`blackjackSessionRef`,
  `blackjackStartedRef`, `blackjackSeatsRef`, `blackjackLocalPlayerIdRef`,
  `blackjackBotSeatsRef`, `blackjackNamesRef`, `blackjackColorsRef`,
  `blackjackBotBusyRef`, `blackjackCardBackRef`) for the same closure-
  staleness reason Rummy's refs exist — every `setState` call gets a
  same-tick paired ref write, no exceptions.
- `blackjackHostRef: HostHandle<BlackjackView>`, `blackjackGuestRef:
  GuestHandle<BlackjackAction>`.
- Join-code prefix: `'BK-'` (2-letter prefixes are taken by existing
  games per the research — confirm `'BK'` isn't already used by
  scanning the existing prefix list in App.tsx before locking it; if it
  collides, pick the next unused short prefix and note the substitution
  in your report, don't silently break another game's prefix).

## Bot loop — the one genuinely novel piece (no exact precedent exists)

Blackjack has phases with no single "current player" (`betting` and
`insurance` — any eligible seat may act, independent of turn order,
per spec 52). The bot loop must handle this correctly:

- **`betting` phase**: any bot seat with `!sittingOut[botId] &&
  bets[botId] === 0` still needs to bet. Iterate bot seats needing a
  bet, one at a time, each paced by a `BASE_MS` (900ms, reused verbatim
  from Rummy/Skip-Bo's constant — do not invent a new constant) delay
  before dispatching `runBlackjackBotTurn(session, botId,
  blackjackBotStrategy)`, then broadcast, then move to the next bot
  seat still needing a bet (re-checking the CURRENT state each time, not
  a stale snapshot, in case a human's bet changed things).
- **`insurance` phase**: same iteration shape — any bot seat with
  `turn.playerOrder.includes(botId) && !hasResolvedInsurance[botId]`,
  one at a time, `BASE_MS` apart.
- **`acting` phase**: exactly Rummy's existing single-current-player
  pattern — check `currentPlayer(turn)` is a bot, act, `BASE_MS` pace,
  repeat (a bot's turn may itself chain multiple actions if it hits
  below 17 repeatedly — pace EVERY individual HIT the same `BASE_MS`,
  same as Rummy paces every individual action within one bot's turn,
  never a burst).
- **`dealerPlay`/`roundOver`**: no bot action needed (dealer play is
  resolved synchronously inside the engine's own action handlers, not
  a separate dispatched action).
- Use the same "actor key"/staleness-guard idea Rummy's `rummyStale`
  function implements (re-derive a key from the fields that change
  turn-to-turn — for Blackjack: `phase`, `roundNumber`, current acting
  seat/hand index, or bet/insurance completion counts — so a human
  action mid-loop causes the stale bot loop iteration to bail instead
  of double-acting). Do not skip this guard; it's what prevents a race
  between a human's action and a bot's paced delay elsewhere in this
  codebase and Blackjack's multi-phase shape needs it just as much.
- **The mandatory CLAUDE.md check**: before reporting done, verify (by
  reading your own loop code, not by assertion) that at a maxed 6-seat
  table with 5 bots, no two consecutive bot actions across the whole
  loop (betting, insurance, and acting phases alike) can fire without at
  least one `BASE_MS` gap between them — more bots waiting to act must
  never compress the pacing, only extend the total time before a human's
  own turn comes around. State this check explicitly in your report.

## Route / Landing wiring
- `src/state/route.ts`: add `'blackjack'` to the `RoutedGame` union and
  `blackjack: 'blackjack'` to `GAME_SEGMENTS`.
- `src/screens/Landing.tsx`: add an `onPickBlackjack: () => void` prop
  and a shelf tile entry mirroring the newest existing entry's shape
  (title "Blackjack", a short note mentioning it's played against the
  house, a color not already used by another tile — check the existing
  palette and pick an unused hue, don't reuse one).
- `App.tsx`: `hostGameFromBoot` switch case, the Landing JSX prop wire-
  up, the join-code prefix dispatch, the shelf-gate boolean (add
  `&& !blackjackRole`), the Room/Table render block (lobby branch +
  game branch — NO results branch, since spec 53 deliberately has no
  Results screen), and a Blackjack reset block inside `resetToEntry()`.
- `README.md`: add Blackjack to the existing game list/section, matching
  its current format exactly (don't add a new section structure).

## Do NOT
- Add a `BlackjackResults` render branch — there is no Results screen.
- Add an automatic host-side round-advance timer — see the locked
  departure above.
- Add per-guest `sendTo` broadcasting — see the locked departure above.
- Touch any file outside the list above.
- Add new dependencies or new `SoundName` values.

## Verify before reporting
Run, in the working directory
(`/Users/charlie/Desktop/Projects/pips/.claude/worktrees/poker-blackjack-loop`):
```
npx tsc -b --noEmit
npx vitest run
npm run build
```
Expected: tsc clean, full suite green (1321 tests, unchanged — wiring
gets no dedicated test file per this repo's convention), build succeeds.
Report all three commands' real final output verbatim.

Live verification (the lead will do this personally in-browser after
your report, same as every prior wiring spec in this project's history
— code review and tsc/tests alone have missed real bugs before, e.g. a
whole game being unreachable from the shelf due to a missed guard
clause). Your job is to get the code genuinely correct per this spec,
not to attempt the live check yourself.

## Honest-failure escape hatch
If any locked decision here is genuinely contradictory once
implementing, stop and report the exact contradiction rather than
silently resolving it.

## Report format
- Files changed
- tsc real final output
- vitest real final output
- npm run build real final output
- Explicit confirmation of the mandatory bot-pacing check above (state
  what you verified and how)
- The join-code prefix you actually used (and whether `'BK-'` collided
  with anything)
- Anything the spec didn't cover or you were unsure about
