import { describe, expect, it } from 'vitest'
import { battleshipShotHoldMs } from './App'
import { createHostSession } from './engine/sync.ts'
import { createRng } from './engine/rng.ts'
import { createTurnState } from './engine/turn-engine.ts'
import { applyBattleshipAction } from './board-games/battleship/rules.ts'
import {
  BOARD_CELLS,
  type BattleshipPrivateState,
  type BattleshipPublicState,
  type BattleshipSession,
  type CellMark,
  type ShipId,
} from './board-games/battleship/state.ts'

// Regression fixture for the review's blocking finding (docs/reviews/battleship-review.md,
// Blocking #1): the free-mode bot loop's post-shot sound hold used to be gated on
// `currentPlayer(newPs.turn) === botId`. In 'free' mode extraTurn never advances
// currentIndex, so if the human player went first, currentPlayer() stays the human FOREVER —
// the hold condition was always false after a bot shot, and the next bot action started after
// only bare BASE_MS (900ms) despite measured ship-miss/-hit/-sunk sounds of 1.968s/3.672s/5.664s.
// battleshipShotHoldMs must key off the actual continuation condition (variant === 'free', or a
// streak hit/sink keeping the turn), not the vestigial turn pointer.

function emptyBoard(): (ShipId | null)[] {
  return Array.from({ length: BOARD_CELLS }, () => null)
}

function emptyMarks(): (CellMark | null)[] {
  return Array.from({ length: BOARD_CELLS }, () => null)
}

function place(board: (ShipId | null)[], shipId: ShipId, cells: number[]): void {
  for (const c of cells) board[c] = shipId
}

// A two-cell destroyer at 0-1 (will be hit, not sunk, by a single shot at cell 0) and a
// one-shot-away-from-sinking submarine at 20-22 that a shot at cell 22 finishes off.
function targetFleet(): (ShipId | null)[] {
  const board = emptyBoard()
  place(board, 'carrier', [40, 41, 42, 43, 44])
  place(board, 'battleship', [60, 61, 62, 63])
  place(board, 'cruiser', [80, 81, 82])
  place(board, 'submarine', [20, 21, 22])
  place(board, 'destroyer', [0, 1])
  return board
}

// Free-mode battle where the HUMAN ('human') is playerOrder[0] — currentIndex stays 0 (the
// human) for the entire match, since free-mode FIRE always calls extraTurn, which never moves
// currentIndex. The bot is playerOrder[1] and never becomes "currentPlayer" by that stale
// pointer, even while it's the one actually firing.
// `humanHits` are the marks already landed ON the human's own board (i.e. what the bot has
// fired at so far) — what a shot AT the human checks and updates.
function freeGameWithHumanFirst(humanHits?: (CellMark | null)[]): BattleshipSession {
  const playerOrder: [string, string] = ['human', 'bot']
  const publicState: BattleshipPublicState = {
    stage: 'battle',
    variant: 'free',
    turn: createTurnState<'fire'>(playerOrder, 'fire'),
    hits: { human: humanHits ?? emptyMarks(), bot: emptyMarks() },
    placedReady: { human: true, bot: true },
    sunk: { human: [], bot: [] },
    scores: { human: 0, bot: 0 },
    lastShot: null,
    winnerId: null,
  }
  const privateStates: Record<string, BattleshipPrivateState> = {
    human: { board: targetFleet() },
    bot: { board: targetFleet() },
  }
  return { session: createHostSession(publicState, privateStates), rng: createRng(0) }
}

describe('battleshipShotHoldMs — free-mode pacing race (review Blocking #1)', () => {
  it('holds after a bot HIT in free mode even though currentPlayer never changed', () => {
    const bs = freeGameWithHumanFirst()
    const result = applyBattleshipAction(bs, 'bot', { type: 'FIRE', cell: 0 }) // hits destroyer, doesn't sink
    expect(result.outcome.ok).toBe(true)
    const ps = result.bs.session.publicState
    expect(ps.lastShot).toEqual({ by: 'bot', cell: 0, result: 'hit', shipId: null })
    // The vestigial turn pointer never moved off the human — this is exactly the condition
    // that made the old currentPlayer(...) === botId gate always false in free mode.
    expect(ps.turn.playerOrder[ps.turn.currentIndex]).toBe('human')
    expect(battleshipShotHoldMs(ps, 'bot')).toBe(2800) // SHOT_SOUND_BUFFER_MS.hit
  })

  it('holds after a bot SINK in free mode, keyed off the actual shot result', () => {
    // Submarine has cells 20,21 already hit; this shot at 22 sinks it.
    const withPriorHits = emptyMarks()
    withPriorHits[20] = 'hit'
    withPriorHits[21] = 'hit'
    const bsWithPriorHits = freeGameWithHumanFirst(withPriorHits)
    const result = applyBattleshipAction(bsWithPriorHits, 'bot', { type: 'FIRE', cell: 22 })
    expect(result.outcome.ok).toBe(true)
    const ps = result.bs.session.publicState
    expect(ps.lastShot?.result).toBe('sunk')
    expect(ps.turn.playerOrder[ps.turn.currentIndex]).toBe('human')
    expect(battleshipShotHoldMs(ps, 'bot')).toBe(4800) // SHOT_SOUND_BUFFER_MS.sunk
  })

  it('does not hold once the match is over, even on the winning shot', () => {
    // Sanity: no pointless wait once stage flips to 'over'.
    const bs = freeGameWithHumanFirst()
    const ps: BattleshipPublicState = { ...bs.session.publicState, stage: 'over', lastShot: { by: 'bot', cell: 0, result: 'sunk', shipId: 'destroyer' } }
    expect(battleshipShotHoldMs(ps, 'bot')).toBe(0)
  })

  it('does not hold a standard-variant bot after a hit, since turn always advances', () => {
    const playerOrder: [string, string] = ['human', 'bot']
    const ps: BattleshipPublicState = {
      stage: 'battle',
      variant: 'standard',
      turn: { playerOrder, currentIndex: 0, direction: 1, phase: 'fire', turnNumber: 2 }, // advanced to human
      hits: { human: emptyMarks(), bot: emptyMarks() },
      placedReady: { human: true, bot: true },
      sunk: { human: [], bot: [] },
      scores: { human: 0, bot: 0 },
      lastShot: { by: 'bot', cell: 0, result: 'hit', shipId: null },
      winnerId: null,
    }
    expect(battleshipShotHoldMs(ps, 'bot')).toBe(0)
  })

  it('holds a streak-variant bot after a hit, since the turn stayed with it', () => {
    const playerOrder: [string, string] = ['human', 'bot']
    const ps: BattleshipPublicState = {
      stage: 'battle',
      variant: 'streak',
      turn: { playerOrder, currentIndex: 1, direction: 1, phase: 'fire', turnNumber: 2 }, // still bot
      hits: { human: emptyMarks(), bot: emptyMarks() },
      placedReady: { human: true, bot: true },
      sunk: { human: [], bot: [] },
      scores: { human: 0, bot: 0 },
      lastShot: { by: 'bot', cell: 0, result: 'hit', shipId: null },
      winnerId: null,
    }
    expect(battleshipShotHoldMs(ps, 'bot')).toBe(2800)
  })
})
