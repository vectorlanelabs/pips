# Spec 57 — Texas Hold'em wiring

Part of the Blackjack + Texas Hold'em charter (`CHARTER.md`), milestone
M5 — the FINAL milestone of the whole charter. Wires the landed engine
(spec 55/55b) and screens (spec 56) into `src/App.tsx`, `src/screens/
Landing.tsx`, and `src/state/route.ts`, mirroring Blackjack's wiring
(spec 54) with one major structural difference driven by Hold'em's
privacy model.

Read Blackjack's wiring in `src/App.tsx` in full before writing any
code (grep for `blackjack` — the whole block is contiguous): state/refs
declaration, `blackjackBroadcast`/`onAction`/dispatch, `blackjackStart`,
the bot loop (`runBlackjackBot`/`runBlackjackBotsIfNeeded`), the
Room/Table render blocks, route/Landing/README wiring, and
`resetToEntry()`. Also skim Rummy's wiring for its **per-guest `sendTo`**
broadcast pattern (`rummyBroadcast`, ~App.tsx:996-1033) — this is the
one Hold'em needs, NOT Blackjack's single-`broadcast()` shortcut.

## Files you own
- `src/App.tsx`
- `src/screens/Landing.tsx`
- `src/state/route.ts`
- `README.md`

Do not touch any engine file, any screens file, or any other game's
wiring code. Do not run `git`.

## Locked design — the one major departure from Blackjack's pattern

**Hold'em has real private information (hole cards) — use per-guest
`sendTo`, not Blackjack's single `broadcast()`.** Blackjack's
`blackjackBroadcast()` could call `hostRef.broadcast(view)` once because
its public state has nothing to hide. Hold'em's `HoldemPublicState` is
safe to broadcast as-is (hole cards never live there except at a
genuine showdown reveal — confirmed by spec 55/55b's privacy fix), BUT
each seat also needs its OWN private view (`HoldemPrivateState.hand`,
their 2 hole cards) delivered ONLY to them. Mirror Rummy's exact
pattern: for each non-bot seat, `deriveSnapshot(session.session,
seat.playerId)` (or the equivalent manual construction — check how
Rummy's `rummyBroadcast` actually does this) and `hostRef.current
?.sendTo(seat.playerId, view)`, skipping bot seats (bots read state
directly via `runHoldemBotTurn`, they don't need wire delivery) and the
host itself (the host sets its own view directly via
`setHoldemView`/equivalent, using its own private state from
`session.privateStates[hostId]`). Lobby-phase state (before the game
starts) has no private data yet, so that phase CAN use a single
broadcast, same as every other game's lobby.

**Everything else mirrors Blackjack's departures from Rummy, still
correct here:**
- `START_NEXT_HAND` is human-initiated (any seat's "Deal next hand"
  button, already built into `HoldemTable` in spec 56) — no automatic
  host-side timer, same reasoning as Blackjack: let a human actually
  read the hand result.
- Bot loop pacing: `BASE_MS` (900ms, reuse the existing constant)
  before every individual bot action.

## Bot loop — simpler than Blackjack's, closer to Rummy's

Unlike Blackjack (which has order-independent betting/insurance
phases), Hold'em's engine (spec 55b) made every street STRICTLY
turn-ordered — there is no phase where multiple seats can act in any
order. This means the bot loop is the ordinary single-current-player
pattern every other game in this codebase already uses (Rummy's
`runRummyBot`/`runRummyBotsIfNeeded` is the closest, most direct
template — closer than Blackjack's novel multi-phase loop was):
- Trigger: a `useEffect` on `[holdemRole, holdemView]` (or equivalent)
  that checks `currentPlayer(publicState.turn)` is a bot seat and,
  if so, runs the bot loop.
- The loop: `await wait(BASE_MS)`, re-check staleness (same actor-key/
  staleness-guard idea as every other bot loop in this file — re-derive
  a key from fields that change turn-to-turn: `handNumber`, `turn.phase`,
  `turn.currentIndex`, `pot`), dispatch `runHoldemBotTurn(session,
  botId, holdemBotStrategy)`, broadcast (per-guest `sendTo`, not a
  single `broadcast()` — see above), repeat while the current player is
  still a bot seat and the hand isn't over.
- `START_NEXT_HAND` is NOT bot-triggered (matches every other game's
  convention and `holdemBotStrategy`'s own contract — it never emits
  this action).
- **The mandatory CLAUDE.md check**: at a maxed 8-seat table with 7
  bots, confirm (by reading your own loop code) that no two consecutive
  bot actions can fire without at least one `BASE_MS` gap — state this
  explicitly in your report.

## Route / Landing wiring
- `src/state/route.ts`: add `'holdem'` to `RoutedGame` and `holdem:
  'holdem'` to `GAME_SEGMENTS`.
- `src/screens/Landing.tsx`: `onPickHoldem: () => void` prop, a shelf
  tile ("Texas Hold'em", a short note like "no-limit, 2-8 players", a
  color not already used — check the existing palette including
  Blackjack's `#ff5d73`, pick a genuinely unused hue).
- `App.tsx`: `hostGameFromBoot` case, Landing JSX prop, join-code prefix
  dispatch (check existing prefixes first — Blackjack used `'BK-'`, per
  its own devlog note about checking for collisions; pick the next
  sensible unused short prefix, e.g. `'HE-'` or `'TH-'`, and report
  which you used and why), the shelf-gate boolean (`&& !holdemRole`),
  the Room/Table render block (lobby branch + game branch, no results
  branch — same as Blackjack, no `HoldemResults` exists), a Hold'em
  reset block in `resetToEntry()`.
- `README.md`: add Hold'em to the existing game list, matching format.

## Do NOT
- Add a `HoldemResults` render branch.
- Use Blackjack's single-`broadcast()` pattern for the in-game view —
  Hold'em needs per-guest `sendTo` for the reasons above.
- Add an automatic host-side round-advance timer.
- Add new dependencies or new `SoundName` values.

## Verify before reporting
Run, in the working directory
(`/Users/charlie/Desktop/Projects/pips/.claude/worktrees/poker-blackjack-loop`):
```
npx tsc -b --noEmit
npx vitest run
npm run build
```
Expected: tsc clean, full suite green (1398 tests, unchanged), build
succeeds. Report all three commands' real final output.

This is the FINAL milestone of the whole charter. After your report,
the lead will do a thorough live-browser verification (this charter has
found real, severe bugs at every single stage that only a live
playthrough caught — a payout arithmetic bug in Blackjack invisible to
75 passing tests, and an action-area bug in Hold'em's own screens spec
that made the game literally unplayable through its most common turns
despite passing tsc/tests/build) — get the wiring genuinely correct per
this spec, but do not claim the charter is done in your own report;
that determination happens after live verification.

## Honest-failure escape hatch
If any locked decision here is genuinely contradictory once
implementing, stop and report the exact contradiction rather than
silently resolving it.

## Report format
- Files changed
- tsc real final output
- vitest real final output
- npm run build real final output
- Explicit confirmation of the mandatory bot-pacing check
- The join-code prefix you used and what you checked for collisions
- Confirmation you used per-guest `sendTo` for the in-game view, not a
  single `broadcast()`
- Anything the spec didn't cover or you were unsure about
