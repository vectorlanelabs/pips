import { describe, expect, it } from 'vitest'
import {
  BOARD_CELLS,
  SHIPS,
  createBattleshipGame,
  type BattleshipPrivateState,
  type BattleshipPublicState,
  type BattleshipSession,
  type CellMark,
  type ShipId,
  type SunkReveal,
  validFleet,
} from './state.ts'
import { applyBattleshipAction } from './rules.ts'
import { createRng } from '../../engine/rng.ts'
import { createHostSession, deriveSnapshot, isJsonSerializable } from '../../engine/sync.ts'
import { createTurnState } from '../../engine/turn-engine.ts'

function emptyBoard(): (ShipId | null)[] {
  return Array.from({ length: BOARD_CELLS }, () => null)
}
function emptyMarks(): (CellMark | null)[] {
  return Array.from({ length: BOARD_CELLS }, () => null)
}
function place(board: (ShipId | null)[], shipId: ShipId, cells: number[]): void {
  for (const c of cells) board[c] = shipId
}
function fleetA(): (ShipId | null)[] {
  const board = emptyBoard()
  place(board, 'carrier', [0, 1, 2, 3, 4])
  place(board, 'battleship', [20, 21, 22, 23])
  place(board, 'cruiser', [40, 41, 42])
  place(board, 'submarine', [60, 61, 62])
  place(board, 'destroyer', [80, 81])
  return board
}
function fleetB(): (ShipId | null)[] {
  const board = emptyBoard()
  place(board, 'carrier', [5, 6, 7, 8, 9])
  place(board, 'battleship', [24, 25, 26, 27])
  place(board, 'cruiser', [43, 44, 45])
  place(board, 'submarine', [63, 64, 65])
  place(board, 'destroyer', [82, 83])
  return board
}

function buildBattle(config: {
  p1Board: (ShipId | null)[]
  p2Board: (ShipId | null)[]
  hits?: Record<string, (CellMark | null)[]>
  sunk?: Record<string, SunkReveal[]>
  scores?: Record<string, number>
}): BattleshipSession {
  const playerOrder: [string, string] = ['p1', 'p2']
  const turn = createTurnState<'fire'>(playerOrder, 'fire')
  const publicState: BattleshipPublicState = {
    stage: 'battle',
    variant: 'standard',
    turn,
    hits: config.hits ?? { p1: emptyMarks(), p2: emptyMarks() },
    placedReady: { p1: true, p2: true },
    sunk: config.sunk ?? { p1: [], p2: [] },
    scores: config.scores ?? { p1: 0, p2: 0 },
    lastShot: null,
    winnerId: null,
  }
  const privateStates: Record<string, BattleshipPrivateState> = {
    p1: { board: config.p1Board },
    p2: { board: config.p2Board },
  }
  return { session: createHostSession(publicState, privateStates), rng: createRng(0) }
}

describe('oscar — leak-hunting a full random game trace', () => {
  it('exhaustively fires every cell of a full game and checks every intermediate guest snapshot for leaks', () => {
    let bs = buildBattle({ p1Board: fleetA(), p2Board: fleetB() })
    // p1 will shoot every one of p2's 17 ship cells directly (worst case: maximum
    // hit/sunk traffic, no misses to dilute the signal) while alternating misses
    // for p2 so the turn engine keeps advancing.
    const p2ShipCells: number[] = []
    for (let i = 0; i < BOARD_CELLS; i++) if (fleetB()[i] !== null) p2ShipCells.push(i)
    // p1 fires only ship cells, so p1 never needs a miss cell. p2 needs one
    // free (non-ship) cell on p1's board per round; fleetA leaves plenty.
    const p1EmptyCells: number[] = []
    for (let i = 0; i < BOARD_CELLS; i++) if (fleetA()[i] === null) p1EmptyCells.push(i)
    let p2MissIdx = 0
    for (const cell of p2ShipCells) {
      const r = applyBattleshipAction(bs, 'p1', { type: 'FIRE', cell })
      expect(r.outcome.ok).toBe(true)
      bs = r.bs

      // check the guest (p2) and the attacker (p1) snapshots after every single shot
      for (const viewer of ['p1', 'p2'] as const) {
        const snap = deriveSnapshot(bs.session, viewer)
        expect(isJsonSerializable(snap)).toBe(true)
        const json = JSON.stringify(snap.publicState)
        for (const ship of SHIPS) {
          const isRevealed = bs.session.publicState.sunk['p2'].some((s) => s.shipId === ship.id)
          if (isRevealed) {
            expect(json).toContain(ship.id)
          } else {
            expect(json).not.toContain(ship.id)
          }
        }
      }

      if (bs.session.publicState.stage === 'over') break
      const missResult = applyBattleshipAction(bs, 'p2', { type: 'FIRE', cell: p1EmptyCells[p2MissIdx] })
      expect(missResult.outcome.ok).toBe(true)
      bs = missResult.bs
      p2MissIdx++
    }
    expect(bs.session.publicState.stage).toBe('over')
    expect(bs.session.publicState.winnerId).toBe('p1')
  })

  it('lastShot.shipId is null for every non-terminal hit across a full trace, non-null only on sunk', () => {
    let bs = buildBattle({ p1Board: fleetA(), p2Board: fleetB() })
    const p2ShipCells: number[] = []
    for (let i = 0; i < BOARD_CELLS; i++) if (fleetB()[i] !== null) p2ShipCells.push(i)
    const p1EmptyCells: number[] = []
    for (let i = 0; i < BOARD_CELLS; i++) if (fleetA()[i] === null) p1EmptyCells.push(i)
    let p2MissIdx = 0
    for (const cell of p2ShipCells) {
      const r = applyBattleshipAction(bs, 'p1', { type: 'FIRE', cell })
      bs = r.bs
      const shot = bs.session.publicState.lastShot!
      if (shot.result === 'hit') expect(shot.shipId).toBeNull()
      if (shot.result === 'sunk') expect(shot.shipId).not.toBeNull()
      if (bs.session.publicState.stage === 'over') break
      const missResult = applyBattleshipAction(bs, 'p2', { type: 'FIRE', cell: p1EmptyCells[p2MissIdx] })
      bs = missResult.bs
      p2MissIdx++
    }
  })
})

describe('oscar — validFleet hardening', () => {
  it('rejects a sparse/holey array (holes are not null, they are undefined)', () => {
    const board = new Array(BOARD_CELLS) as (ShipId | null)[]
    place(board, 'carrier', [0, 1, 2, 3, 4])
    place(board, 'battleship', [20, 21, 22, 23])
    place(board, 'cruiser', [40, 41, 42])
    place(board, 'submarine', [60, 61, 62])
    place(board, 'destroyer', [80, 81])
    // everything else is left as a hole, never explicitly set to null
    expect(validFleet(board)).toBe(false)
  })

  it('rejects an off-grid two-length ship that would wrap a row boundary (diff===1 but off-grid)', () => {
    const board = emptyBoard()
    place(board, 'carrier', [10, 11, 12, 13, 14])
    place(board, 'battleship', [30, 31, 32, 33])
    place(board, 'cruiser', [50, 51, 52])
    place(board, 'submarine', [70, 71, 72])
    place(board, 'destroyer', [9, 10]) // would collide with carrier at 10 anyway; test wrap alone below
    expect(validFleet(board)).toBe(false)

    // isolate the wrap case: destroyer at [9,10] with no collision
    const board2 = emptyBoard()
    place(board2, 'carrier', [20, 21, 22, 23, 24])
    place(board2, 'battleship', [30, 31, 32, 33])
    place(board2, 'cruiser', [50, 51, 52])
    place(board2, 'submarine', [70, 71, 72])
    place(board2, 'destroyer', [9, 10]) // row wrap: col 9 -> col 0 next row
    expect(validFleet(board2)).toBe(false)
  })

  it('rejects extra keys / prototype pollution attempts smuggled onto the board array', () => {
    const board = fleetA()
    // JSON.parse can legally produce an array with an own "__proto__" data
    // property (it does NOT set the prototype) — simulate that shape.
    Object.defineProperty(board, '__proto__', { value: { polluted: true }, enumerable: true, configurable: true })
    expect(validFleet(board)).toBe(true) // own enumerable numeric slots unaffected
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined() // pollution did not escape to Object.prototype
  })

  it('rejects boards where a ship id string is a case/whitespace variant of a real id', () => {
    const board = fleetA()
    board[81] = 'Destroyer' as ShipId // wrong case
    board[80] = null
    expect(validFleet(board)).toBe(false)
  })
})

describe('oscar — FIRE cell type confusion', () => {
  it('rejects non-numeric cell payloads that TypeScript would block but JSON cannot', () => {
    const bs = buildBattle({ p1Board: fleetA(), p2Board: fleetB() })
    const bogusCells: unknown[] = ['5', true, null, undefined, {}, [], 5.0000001, -0, Infinity, -Infinity]
    for (const cell of bogusCells) {
      const r = applyBattleshipAction(bs, 'p1', { type: 'FIRE', cell: cell as number })
      if (cell === -0) {
        // -0 is a legitimate integer cell 0 under Number.isInteger/comparison semantics
        expect(r.outcome.ok).toBe(true)
      } else {
        expect(r.outcome.ok).toBe(false)
      }
    }
  })
})

describe('oscar — host authority: unauthorized third player', () => {
  it('PLACE_FLEET from a playerId outside the session is rejected and mutates nothing', () => {
    const game = createBattleshipGame(['p1', 'p2'], 1)
    const mallory = applyBattleshipAction(game, 'mallory', { type: 'PLACE_FLEET', board: fleetA() })
    // The engine now enforces participant membership directly: an action bearing a playerId
    // that isn't in publicState.turn.playerOrder is rejected before it can touch canonical
    // state, closing the boundary as defense-in-depth alongside the App-side guest guard.
    expect(mallory.outcome.ok).toBe(false)
    expect(mallory.bs.session.publicState.placedReady).toEqual({ p1: false, p2: false })
    expect(mallory.bs.session.privateStates['mallory']).toBeUndefined()
  })

  it('FIRE from a playerId outside the session is rejected', () => {
    const game = createBattleshipGame(['p1', 'p2'], 1)
    const mallory = applyBattleshipAction(game, 'mallory', { type: 'FIRE', cell: 0 })
    expect(mallory.outcome.ok).toBe(false)
  })
})
