import type { ActionOutcome, ActionValidator } from '../../engine/sync.ts'
import { applyAction } from '../../engine/sync.ts'
import { runBotTurn, type BotStrategy } from '../../engine/bot.ts'
import { advanceTurn, currentPlayer, extraTurn } from '../../engine/turn-engine.ts'
import type {
  BattleshipAction,
  BattleshipPrivateState,
  BattleshipPublicState,
  BattleshipSession,
  LastShot,
  SunkReveal,
} from './state.ts'
import { BOARD_CELLS, allSunk, isShipSunk, shipCells, validFleet } from './state.ts'

export const validateBattleshipAction: ActionValidator<
  BattleshipPublicState,
  BattleshipPrivateState,
  BattleshipAction
> = (session, playerId, action) => {
  const { publicState, privateStates } = session

  if (!publicState.turn.playerOrder.includes(playerId)) {
    return { ok: false, reason: 'not a participant in this match' }
  }

  if (action.type === 'PLACE_FLEET') {
    if (publicState.stage !== 'placing') return { ok: false, reason: 'not in placing stage' }
    if (publicState.placedReady[playerId]) return { ok: false, reason: 'already placed' }
    if (!validFleet(action.board)) return { ok: false, reason: 'invalid fleet' }
    const placedReady = { ...publicState.placedReady, [playerId]: true }
    const bothReady = Object.values(placedReady).every(Boolean)
    return {
      ok: true,
      publicState: {
        ...publicState,
        stage: bothReady ? 'battle' : 'placing',
        placedReady,
      },
      privateStates: { ...privateStates, [playerId]: { board: [...action.board] } },
    }
  }

  if (action.type === 'FIRE') {
    if (publicState.stage !== 'battle') return { ok: false, reason: 'not in battle stage' }
    if (publicState.variant !== 'free' && currentPlayer(publicState.turn) !== playerId) {
      return { ok: false, reason: 'not your turn' }
    }
    if (!Number.isInteger(action.cell) || action.cell < 0 || action.cell >= BOARD_CELLS) {
      return { ok: false, reason: 'invalid cell' }
    }
    const opponentId = publicState.turn.playerOrder.find((p) => p !== playerId)!
    if (publicState.hits[opponentId][action.cell] !== null) return { ok: false, reason: 'already fired there' }

    const board = privateStates[opponentId].board
    const newMarks = [...publicState.hits[opponentId]]
    let sunk = publicState.sunk
    let scores = publicState.scores
    let lastShot: LastShot

    const cellShip = board[action.cell]
    if (cellShip === null) {
      newMarks[action.cell] = 'miss'
      lastShot = { by: playerId, cell: action.cell, result: 'miss', shipId: null }
    } else {
      newMarks[action.cell] = 'hit'
      if (isShipSunk(board, newMarks, cellShip)) {
        const reveal: SunkReveal = { shipId: cellShip, cells: shipCells(board, cellShip) }
        sunk = { ...publicState.sunk, [opponentId]: [...publicState.sunk[opponentId], reveal] }
        scores = { ...publicState.scores, [playerId]: publicState.scores[playerId] + 1 }
        lastShot = { by: playerId, cell: action.cell, result: 'sunk', shipId: cellShip }
      } else {
        lastShot = { by: playerId, cell: action.cell, result: 'hit', shipId: null }
      }
    }

    const hits = { ...publicState.hits, [opponentId]: newMarks }
    if (allSunk(board, newMarks)) {
      return {
        ok: true,
        publicState: {
          ...publicState,
          hits,
          sunk,
          scores,
          lastShot,
          stage: 'over',
          winnerId: playerId,
        },
        privateStates,
      }
    }
    let turn = publicState.turn
    if (publicState.variant === 'streak') {
      turn = lastShot.result === 'miss' ? advanceTurn(publicState.turn, 'fire') : extraTurn(publicState.turn, 'fire')
    } else if (publicState.variant === 'free') {
      turn = extraTurn(publicState.turn, 'fire')
    } else {
      turn = advanceTurn(publicState.turn, 'fire')
    }
    return {
      ok: true,
      publicState: {
        ...publicState,
        turn,
        hits,
        sunk,
        scores,
        lastShot,
      },
      privateStates,
    }
  }

  return { ok: false, reason: 'unknown action' }
}

export function applyBattleshipAction(
  bs: BattleshipSession,
  playerId: string,
  action: BattleshipAction,
): { bs: BattleshipSession; outcome: ActionOutcome<BattleshipPublicState, BattleshipPrivateState> } {
  const { session, outcome } = applyAction(bs.session, playerId, action, validateBattleshipAction)
  return { bs: { session, rng: bs.rng }, outcome }
}

export function runBattleshipBotTurn(
  bs: BattleshipSession,
  playerId: string,
  strategy: BotStrategy<BattleshipPublicState, BattleshipPrivateState, BattleshipAction>,
): { bs: BattleshipSession; outcome: ActionOutcome<BattleshipPublicState, BattleshipPrivateState> } {
  const { session, outcome } = runBotTurn(bs.session, playerId, strategy, validateBattleshipAction)
  return { bs: { session, rng: bs.rng }, outcome }
}
