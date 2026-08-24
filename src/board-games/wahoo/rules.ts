import type { ActionOutcome, ActionValidator } from '../../engine/sync.ts'
import { applyAction } from '../../engine/sync.ts'
import { runBotTurn, type BotStrategy } from '../../engine/bot.ts'
import { advanceTurn, currentPlayer, extraTurn, setPhase } from '../../engine/turn-engine.ts'
import { LANE_START, OWNER_TRACK_LEN, trackIndexFor } from './board.ts'
import {
  exitTargetRel,
  legalMoves,
  type MarblePos,
  type WahooAction,
  type WahooEvent,
  type WahooMove,
  type WahooPrivateState,
  type WahooPublicState,
  type WahooSession,
} from './state.ts'

// Applies a validated move to the current state. Returns the new positions
// map, the new center owner, and the id of any bumped opponent (null if none).
function applyMove(
  publicState: WahooPublicState,
  playerId: string,
  die: number,
  move: WahooMove,
): { positions: Record<string, MarblePos[]>; centerBy: WahooPublicState['centerBy']; bumpedId: string | null } {
  const arm = publicState.seatArms[playerId]
  const myPositions = [...publicState.positions[playerId]]
  const others = { ...publicState.positions }
  let centerBy = publicState.centerBy
  let bumpedId: string | null = null

  // Bump the first opponent marble found on the given absolute track hole.
  const bumpAt = (abs: number): void => {
    for (const pid of Object.keys(others)) {
      if (pid === playerId) continue
      const idx = others[pid].findIndex(
        (q) => q >= 0 && q <= OWNER_TRACK_LEN - 1 && trackIndexFor(publicState.seatArms[pid], q) === abs,
      )
      if (idx !== -1) {
        bumpedId = pid
        others[pid] = [...others[pid]]
        others[pid][idx] = -1
        return
      }
    }
  }

  if (move.kind === 'out') {
    myPositions[move.marbleIdx] = 0
    bumpAt(trackIndexFor(arm, 0))
  } else if (move.kind === 'advance') {
    const to = myPositions[move.marbleIdx] + die
    myPositions[move.marbleIdx] = to
    if (to <= OWNER_TRACK_LEN - 1) bumpAt(trackIndexFor(arm, to))
  } else if (move.kind === 'shortcut') {
    const from = publicState.positions[playerId][move.marbleIdx]
    if (centerBy && centerBy.playerId !== playerId) {
      bumpedId = centerBy.playerId
      others[bumpedId] = [...others[bumpedId]]
      others[bumpedId][centerBy.marbleIdx] = -1
    }
    myPositions[move.marbleIdx] = -2
    centerBy = { playerId, marbleIdx: move.marbleIdx, entryCornerRel: (from + die - 1) as 6 | 22 }
  } else {
    // exit: the center marble jumps to the diagonal corner.
    const target = exitTargetRel(centerBy!.entryCornerRel)
    myPositions[move.marbleIdx] = target
    bumpAt(trackIndexFor(arm, target))
    centerBy = null
  }

  return { positions: { ...others, [playerId]: myPositions }, centerBy, bumpedId }
}

// The die roll needs the host rng, so the validator closes over `wh.rng` (the
// rummy pattern): applyAction stays pure and the rng is only consumed when an
// action is accepted.
function makeValidator(rng: () => number): ActionValidator<WahooPublicState, WahooPrivateState, WahooAction> {
  return (session, playerId, action) => {
    const { publicState, privateStates } = session
    if (publicState.stage !== 'play') return { ok: false, reason: 'game over' }
    if (currentPlayer(publicState.turn) !== playerId) return { ok: false, reason: 'not your turn' }

    if (action.type === 'ROLL') {
      if (publicState.turn.phase !== 'roll') return { ok: false, reason: 'die already rolled' }
      const die = 1 + Math.floor(rng() * 6)
      const streak = die === 6 ? publicState.sixStreak + 1 : 0

      // Third consecutive 6: bust immediately, no move required. Sends home
      // whichever marble was actually moved most recently in this chain
      // (lastMoved) — if nothing has been moved yet this chain (e.g. the first
      // two sixes both had no legal move), there is nothing to send home and
      // the turn simply ends.
      if (streak >= 3) {
        const busted =
          publicState.lastMoved && publicState.lastMoved.playerId === playerId
            ? (() => {
                const arr = [...publicState.positions[playerId]]
                arr[publicState.lastMoved!.marbleIdx] = -1
                return arr
              })()
            : publicState.positions[playerId]
        const centerBy =
          publicState.centerBy &&
          publicState.centerBy.playerId === playerId &&
          publicState.lastMoved &&
          publicState.lastMoved.playerId === playerId &&
          publicState.centerBy.marbleIdx === publicState.lastMoved.marbleIdx
            ? null
            : publicState.centerBy
        return {
          ok: true,
          publicState: {
            ...publicState,
            positions: { ...publicState.positions, [playerId]: busted },
            centerBy,
            turn: advanceTurn(publicState.turn, 'roll'),
            die: null,
            sixStreak: 0,
            lastMoved: null,
            lastEvent: { kind: 'bust', by: playerId, die: 6 },
          },
          privateStates,
        }
      }

      const rolled: WahooPublicState = {
        ...publicState,
        turn: setPhase(publicState.turn, 'move'),
        die,
        sixStreak: streak,
        lastEvent: { kind: 'roll', by: playerId, die },
      }
      // No legal move: resolve the turn immediately. A non-six ends the turn —
      // and with it the current six-chain, so lastMoved is cleared (see the
      // MOVE handler below for the matching non-six clear). A six (even
      // moveless) still grants another roll and keeps the chain's lastMoved
      // alive — the streak already accounts for it above.
      if (legalMoves(rolled, playerId, die).length === 0) {
        return {
          ok: true,
          publicState: {
            ...rolled,
            turn: die === 6 ? extraTurn(publicState.turn, 'roll') : advanceTurn(publicState.turn, 'roll'),
            die: null,
            lastMoved: die === 6 ? publicState.lastMoved : null,
            lastEvent: { kind: 'pass', by: playerId, die },
          },
          privateStates,
        }
      }
      return { ok: true, publicState: rolled, privateStates }
    }

    if (action.type === 'MOVE') {
      if (publicState.turn.phase !== 'move') return { ok: false, reason: 'roll first' }
      // action.move arrives over the wire as `unknown` at runtime — the WahooAction
      // union is compile-time only, so a malformed/stale/hostile guest payload (missing
      // or null `move`) must be rejected here rather than dereferencing straight through.
      if (typeof action.move !== 'object' || action.move === null) {
        return { ok: false, reason: 'invalid move' }
      }
      const die = publicState.die!
      const moves = legalMoves(publicState, playerId, die)
      const move = moves.find((m) => m.marbleIdx === action.move.marbleIdx && m.kind === action.move.kind)
      if (!move) return { ok: false, reason: 'not a legal move' }

      const { positions, centerBy, bumpedId } = applyMove(publicState, playerId, die, move)
      const lastMoved = { playerId, marbleIdx: move.marbleIdx }
      const lastEvent: WahooEvent =
        move.kind === 'advance'
          ? { kind: 'move', by: playerId, marbleIdx: move.marbleIdx, bumpedId }
          : { kind: move.kind, by: playerId, bumpedId }
      const movedState: WahooPublicState = {
        ...publicState,
        positions,
        centerBy,
        lastMoved,
        lastEvent,
      }

      // Win check first: all four marbles in the lane ends the game now, even
      // if the die was a 6 that would have completed a bust chain.
      if (positions[playerId].every((p) => p >= LANE_START)) {
        return {
          ok: true,
          publicState: {
            ...movedState,
            stage: 'over',
            winnerId: playerId,
            lastEvent: { kind: 'win', by: playerId },
          },
          privateStates,
        }
      }

      // A non-six ends the turn, and with it the current six-chain: clear
      // lastMoved so it can never be read as "the marble moved this chain" on
      // a LATER turn (a triple-six bust only trusts a chain-scoped lastMoved —
      // see the streak >= 3 branch above). A six keeps the chain (and this
      // move's lastMoved) alive for the extra roll.
      return {
        ok: true,
        publicState: {
          ...movedState,
          die: null,
          lastMoved: die === 6 ? lastMoved : null,
          turn: die === 6 ? extraTurn(publicState.turn, 'roll') : advanceTurn(publicState.turn, 'roll'),
        },
        privateStates,
      }
    }

    return { ok: false, reason: 'unknown action' }
  }
}

export function applyWahooAction(
  wh: WahooSession,
  playerId: string,
  action: WahooAction,
): { wh: WahooSession; outcome: ActionOutcome<WahooPublicState, WahooPrivateState> } {
  const { session, outcome } = applyAction(wh.session, playerId, action, makeValidator(wh.rng))
  return { wh: { session, rng: wh.rng }, outcome }
}

export function runWahooBotTurn(
  wh: WahooSession,
  playerId: string,
  strategy: BotStrategy<WahooPublicState, WahooPrivateState, WahooAction>,
): { wh: WahooSession; outcome: ActionOutcome<WahooPublicState, WahooPrivateState> } {
  const { session, outcome } = runBotTurn(wh.session, playerId, strategy, makeValidator(wh.rng))
  return { wh: { session, rng: wh.rng }, outcome }
}
