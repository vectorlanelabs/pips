import { describe, expect, it } from 'vitest'
import {
  BOARD_CELLS,
  SHIPS,
  createBattleshipGame,
  type BattleshipPrivateState,
  type BattleshipPublicState,
  type BattleshipSession,
  type BattleshipVariant,
  type CellMark,
  type ShipId,
  type SunkReveal,
  allSunk,
  fits,
  isShipDamaged,
  isShipSunk,
  randomFleet,
  shipCells,
  shipCellsAt,
  validFleet,
} from './state.ts'
import { applyBattleshipAction, runBattleshipBotTurn } from './rules.ts'
import { makeBattleshipBotStrategy } from './bot.ts'
import { createRng } from '../../engine/rng.ts'
import { createHostSession, deriveSnapshot, isJsonSerializable } from '../../engine/sync.ts'
import { createTurnState, currentPlayer } from '../../engine/turn-engine.ts'

function emptyBoard(): (ShipId | null)[] {
  return Array.from({ length: BOARD_CELLS }, () => null)
}

function emptyMarks(): (CellMark | null)[] {
  return Array.from({ length: BOARD_CELLS }, () => null)
}

function place(board: (ShipId | null)[], shipId: ShipId, cells: number[]): void {
  for (const c of cells) board[c] = shipId
}

// Known valid fleets with no cells in common.
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
  currentPlayerIndex?: number
  variant?: BattleshipVariant
}): BattleshipSession {
  const playerOrder: [string, string] = ['p1', 'p2']
  const turn = createTurnState<'fire'>(playerOrder, 'fire')
  if (config.currentPlayerIndex != null) {
    // createTurnState starts at index 0; advance to desired index by directly setting it
    ;(turn as { currentIndex: number }).currentIndex = config.currentPlayerIndex
  }
  const publicState: BattleshipPublicState = {
    stage: 'battle',
    variant: config.variant ?? 'standard',
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

describe('battleship board helpers', () => {
  it('shipCellsAt returns null for off-grid placements', () => {
    expect(shipCellsAt(9, 2, 'h')).toBeNull()    // row 0, col 9 — horizontal leaves the grid
    expect(shipCellsAt(90, 2, 'v')).toBeNull()   // row 9, col 0 — vertical leaves the grid
    expect(shipCellsAt(99, 2, 'h')).toBeNull()   // bottom-right corner
    expect(shipCellsAt(99, 2, 'v')).toBeNull()
  })

  it('shipCellsAt computes in-bounds shapes correctly', () => {
    expect(shipCellsAt(0, 5, 'h')).toEqual([0, 1, 2, 3, 4])
    expect(shipCellsAt(0, 5, 'v')).toEqual([0, 10, 20, 30, 40])
    expect(shipCellsAt(12, 3, 'h')).toEqual([12, 13, 14])
    expect(shipCellsAt(15, 3, 'v')).toEqual([15, 25, 35])
    expect(shipCellsAt(77, 2, 'h')).toEqual([77, 78])
  })

  it('fits / shipCells / isShipSunk / isShipDamaged / allSunk behave on plain data', () => {
    const board = fleetA()
    const marks = emptyMarks()
    expect(fits(board, [10, 11])).toBe(true)
    expect(fits(board, [0, 10])).toBe(false)      // 0 is the carrier
    expect(fits(board, null)).toBe(false)
    expect(shipCells(board, 'carrier')).toEqual([0, 1, 2, 3, 4])
    expect(shipCells(board, 'cruiser')).toEqual([40, 41, 42])
    expect(isShipSunk(board, marks, 'carrier')).toBe(false)
    expect(isShipDamaged(board, marks, 'carrier')).toBe(false)
    for (const c of [0, 1]) marks[c] = 'hit'
    expect(isShipDamaged(board, marks, 'carrier')).toBe(true)
    expect(isShipSunk(board, marks, 'carrier')).toBe(false)
    for (const c of [2, 3, 4]) marks[c] = 'hit'
    expect(isShipSunk(board, marks, 'carrier')).toBe(true)
    expect(allSunk(board, marks)).toBe(false)
    for (const c of [20, 21, 22, 23, 40, 41, 42, 60, 61, 62, 80, 81]) marks[c] = 'hit'
    expect(allSunk(board, marks)).toBe(true)
  })
})

describe('validFleet', () => {
  it('accepts a legal hand-built fleet', () => {
    expect(validFleet(fleetA())).toBe(true)
    expect(validFleet(fleetB())).toBe(true)
  })

  it('rejects missing ships, wrong-length runs, and broken lines', () => {
    const missing = fleetA()
    for (const c of [80, 81]) missing[c] = null   // destroyer removed — only 15 cells filled
    expect(validFleet(missing)).toBe(false)

    const wrongLengths = fleetB()
    wrongLengths[84] = 'destroyer'                // destroyer runs 3 cells long
    wrongLengths[64] = null                       // submarine down to 2 — still 17 cells filled
    expect(validFleet(wrongLengths)).toBe(false)

    const diagonal = fleetB()
    diagonal[83] = null
    diagonal[93] = 'destroyer'                    // destroyer cells no longer collinear
    expect(validFleet(diagonal)).toBe(false)

    const broken = fleetB()
    broken[83] = null
    broken[84] = 'destroyer'                      // gap between 82 and 84
    expect(validFleet(broken)).toBe(false)
  })

  it('rejects 18 filled cells, wrong board lengths, and unknown ship ids', () => {
    const extra = fleetB()
    extra[84] = 'destroyer'                       // 18 cells total
    expect(validFleet(extra)).toBe(false)

    expect(validFleet([])).toBe(false)
    expect(validFleet(emptyBoard().slice(0, 50))).toBe(false)
    expect(validFleet(Array.from({ length: 101 }, () => null))).toBe(false)

    const bogus = emptyBoard()
    bogus[0] = 'aircraft carrier' as ShipId
    expect(validFleet(bogus)).toBe(false)
  })
})

describe('touch-legal placement (deliberate — no no-touch house rule)', () => {
  it('accepts a fleet with orthogonally and diagonally adjacent ships', () => {
    const board = emptyBoard()
    place(board, 'carrier', [0, 1, 2, 3, 4])
    place(board, 'battleship', [20, 21, 22, 23])
    place(board, 'submarine', [34, 35, 36])       // diagonally adjacent to battleship's cell 23
    place(board, 'cruiser', [50, 51, 52])
    place(board, 'destroyer', [60, 61])            // orthogonally adjacent to cruiser's row above
    expect(validFleet(board)).toBe(true)
  })

  it('the placement preview (fits) allows a ship directly against an existing one', () => {
    const board = emptyBoard()
    place(board, 'carrier', [0, 1, 2, 3, 4])
    expect(fits(board, [10, 11, 12, 13])).toBe(true) // orthogonally touching the carrier
  })
})

describe('randomFleet', () => {
  it('produces a valid fleet, deterministically per seed', () => {
    const a = randomFleet(createRng(1))
    const b = randomFleet(createRng(1))
    expect(validFleet(a)).toBe(true)
    expect(b).toEqual(a)
  })

  it('respects base and alreadyPlaced — pre-placed ships stay untouched', () => {
    const base = emptyBoard()
    place(base, 'carrier', [0, 1, 2, 3, 4])
    place(base, 'battleship', [20, 21, 22, 23])
    const result = randomFleet(createRng(2), base, ['carrier', 'battleship'])
    expect(validFleet(result)).toBe(true)
    for (const c of [0, 1, 2, 3, 4, 20, 21, 22, 23]) {
      expect(result[c]).toBe(base[c])
    }
    expect(result.filter((v) => v === 'carrier')).toHaveLength(5)
    expect(result.filter((v) => v === 'battleship')).toHaveLength(4)
    expect(result.filter((v) => v === 'cruiser')).toHaveLength(3)
    expect(result.filter((v) => v === 'submarine')).toHaveLength(3)
    expect(result.filter((v) => v === 'destroyer')).toHaveLength(2)
  })
})

describe('PLACE_FLEET', () => {
  it('accepts a legal fleet, sets placedReady, and starts battle when both players are ready', () => {
    const game = createBattleshipGame(['p1', 'p2'], 1)
    expect(game.session.publicState.stage).toBe('placing')
    expect(currentPlayer(game.session.publicState.turn)).toBe('p1')

    const r1 = applyBattleshipAction(game, 'p1', { type: 'PLACE_FLEET', board: fleetA() })
    expect(r1.outcome.ok).toBe(true)
    expect(r1.bs.session.publicState.placedReady).toEqual({ p1: true, p2: false })
    expect(r1.bs.session.publicState.stage).toBe('placing')
    expect(r1.bs.session.privateStates['p1'].board).toEqual(fleetA())
    expect(r1.bs.session.privateStates['p2'].board).toEqual(emptyBoard())

    const r2 = applyBattleshipAction(r1.bs, 'p1', { type: 'PLACE_FLEET', board: fleetA() })
    expect(r2.outcome.ok).toBe(false)
    expect(r2.outcome.reason).toContain('already placed')

    const r3 = applyBattleshipAction(r1.bs, 'p2', { type: 'PLACE_FLEET', board: fleetB() })
    expect(r3.outcome.ok).toBe(true)
    expect(r3.bs.session.publicState.stage).toBe('battle')
    expect(r3.bs.session.publicState.placedReady).toEqual({ p1: true, p2: true })
    expect(r3.bs.session.privateStates['p2'].board).toEqual(fleetB())
    expect(currentPlayer(r3.bs.session.publicState.turn)).toBe('p1')
    expect(r3.bs.session.publicState.turn.phase).toBe('fire')
  })

  it('rejects an illegal fleet and rejects placement once battle has started', () => {
    const game = createBattleshipGame(['p1', 'p2'], 1)
    const bad = emptyBoard()
    bad[0] = 'carrier'
    const r1 = applyBattleshipAction(game, 'p1', { type: 'PLACE_FLEET', board: bad })
    expect(r1.outcome.ok).toBe(false)
    expect(r1.outcome.reason).toContain('invalid fleet')

    const { bs: bs1 } = applyBattleshipAction(game, 'p1', { type: 'PLACE_FLEET', board: fleetA() })
    const { bs: bs2 } = applyBattleshipAction(bs1, 'p2', { type: 'PLACE_FLEET', board: fleetB() })
    const r2 = applyBattleshipAction(bs2, 'p1', { type: 'PLACE_FLEET', board: fleetA() })
    expect(r2.outcome.ok).toBe(false)
    expect(r2.outcome.reason).toContain('placing')
  })
})

describe('FIRE rejections', () => {
  it('rejects firing during placing', () => {
    const game = createBattleshipGame(['p1', 'p2'], 1)
    const result = applyBattleshipAction(game, 'p1', { type: 'FIRE', cell: 0 })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('battle')
  })

  it('rejects firing out of turn', () => {
    const bs = buildBattle({ p1Board: fleetA(), p2Board: fleetB() })  // p1 is current player
    const result = applyBattleshipAction(bs, 'p2', { type: 'FIRE', cell: 0 })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('turn')
  })

  it('rejects out-of-range and non-integer cells', () => {
    const bs = buildBattle({ p1Board: fleetA(), p2Board: fleetB() })
    for (const cell of [-1, 100, 1.5, NaN]) {
      const result = applyBattleshipAction(bs, 'p1', { type: 'FIRE', cell })
      expect(result.outcome.ok).toBe(false)
    }
  })

  it('rejects firing at a cell already fired on', () => {
    const bs = buildBattle({ p1Board: fleetA(), p2Board: fleetB() })
    const r1 = applyBattleshipAction(bs, 'p1', { type: 'FIRE', cell: 0 })    // miss on p2's board
    expect(r1.outcome.ok).toBe(true)
    const r2 = applyBattleshipAction(r1.bs, 'p2', { type: 'FIRE', cell: 10 })  // miss on p1's board
    expect(r2.outcome.ok).toBe(true)
    const r3 = applyBattleshipAction(r2.bs, 'p1', { type: 'FIRE', cell: 0 })   // repeat cell
    expect(r3.outcome.ok).toBe(false)
    expect(r3.outcome.reason).toContain('already fired')
  })
})

describe('FIRE resolution', () => {
  it('a miss marks the cell and passes the turn', () => {
    const bs = buildBattle({ p1Board: fleetA(), p2Board: fleetB() })
    const result = applyBattleshipAction(bs, 'p1', { type: 'FIRE', cell: 0 })
    expect(result.outcome.ok).toBe(true)
    const pub = result.bs.session.publicState
    expect(pub.hits['p2'][0]).toBe('miss')
    expect(pub.hits['p1'].every((m) => m === null)).toBe(true)
    expect(pub.lastShot).toEqual({ by: 'p1', cell: 0, result: 'miss', shipId: null })
    expect(pub.scores).toEqual({ p1: 0, p2: 0 })
    expect(currentPlayer(pub.turn)).toBe('p2')
  })

  it('a hit marks the cell without naming the ship and passes the turn', () => {
    const bs = buildBattle({ p1Board: fleetA(), p2Board: fleetB() })
    const result = applyBattleshipAction(bs, 'p1', { type: 'FIRE', cell: 5 })  // p2's carrier
    expect(result.outcome.ok).toBe(true)
    const pub = result.bs.session.publicState
    expect(pub.hits['p2'][5]).toBe('hit')
    expect(pub.lastShot).toEqual({ by: 'p1', cell: 5, result: 'hit', shipId: null })
    expect(pub.sunk['p2']).toEqual([])
    expect(pub.scores['p1']).toBe(0)
    expect(currentPlayer(pub.turn)).toBe('p2')
  })

  it('sinking a ship reveals its true cells, scores the shooter, and names the ship', () => {
    const bs = buildBattle({ p1Board: fleetA(), p2Board: fleetB() })
    const r1 = applyBattleshipAction(bs, 'p1', { type: 'FIRE', cell: 82 })  // destroyer's first cell
    expect(r1.outcome.ok).toBe(true)
    expect(r1.bs.session.publicState.lastShot).toEqual({ by: 'p1', cell: 82, result: 'hit', shipId: null })
    expect(r1.bs.session.publicState.sunk['p2']).toEqual([])

    const r2 = applyBattleshipAction(r1.bs, 'p2', { type: 'FIRE', cell: 10 })
    expect(r2.outcome.ok).toBe(true)

    const r3 = applyBattleshipAction(r2.bs, 'p1', { type: 'FIRE', cell: 83 })  // second cell → sunk
    expect(r3.outcome.ok).toBe(true)
    const pub = r3.bs.session.publicState
    expect(pub.sunk['p2']).toEqual([{ shipId: 'destroyer', cells: [82, 83] }])
    expect(pub.scores).toEqual({ p1: 1, p2: 0 })
    expect(pub.lastShot).toEqual({ by: 'p1', cell: 83, result: 'sunk', shipId: 'destroyer' })
    expect(pub.stage).toBe('battle')
    expect(pub.winnerId).toBeNull()
    expect(currentPlayer(pub.turn)).toBe('p2')
  })

  it('sinking all five ships ends the game with a winner and a score of 5', () => {
    const marks = emptyMarks()
    for (const c of [5, 6, 7, 8, 9, 24, 25, 26, 27, 43, 44, 45, 63, 64, 65, 82]) marks[c] = 'hit'
    const sunk: SunkReveal[] = [
      { shipId: 'carrier', cells: [5, 6, 7, 8, 9] },
      { shipId: 'battleship', cells: [24, 25, 26, 27] },
      { shipId: 'cruiser', cells: [43, 44, 45] },
      { shipId: 'submarine', cells: [63, 64, 65] },
    ]
    const bs = buildBattle({
      p1Board: fleetA(),
      p2Board: fleetB(),
      hits: { p1: emptyMarks(), p2: marks },
      sunk: { p1: [], p2: sunk },
      scores: { p1: 4, p2: 0 },
    })
    const result = applyBattleshipAction(bs, 'p1', { type: 'FIRE', cell: 83 })
    expect(result.outcome.ok).toBe(true)
    const pub = result.bs.session.publicState
    expect(pub.stage).toBe('over')
    expect(pub.winnerId).toBe('p1')
    expect(pub.scores['p1']).toBe(5)
    expect(pub.sunk['p2']).toEqual([...sunk, { shipId: 'destroyer', cells: [82, 83] }])
    expect(pub.lastShot).toEqual({ by: 'p1', cell: 83, result: 'sunk', shipId: 'destroyer' })
    // turn is untouched on game over
    expect(currentPlayer(pub.turn)).toBe('p1')
    expect(pub.turn.turnNumber).toBe(1)
  })
})

describe('battleship bot', () => {
  it('places a valid fleet in the placing stage, accepted via runBattleshipBotTurn', () => {
    const game = createBattleshipGame(['p1', 'p2'], 1)
    const strategy = makeBattleshipBotStrategy(createRng(1))
    const action = strategy(game.session.publicState, game.session.privateStates['p1'], 'p1')
    expect(action.type).toBe('PLACE_FLEET')
    const placeAction = action as { type: 'PLACE_FLEET'; board: (ShipId | null)[] }
    expect(validFleet(placeAction.board)).toBe(true)

    // a fresh strategy with the same seed proposes the same first board
    const result = runBattleshipBotTurn(game, 'p1', makeBattleshipBotStrategy(createRng(1)))
    expect(result.outcome.ok).toBe(true)
    expect(result.bs.session.publicState.placedReady['p1']).toBe(true)
    expect(result.bs.session.privateStates['p1'].board).toEqual(placeAction.board)
  })

  it('fires at an orthogonal unfired neighbor of a mid-ship hit — all four directions', () => {
    const p2Board = emptyBoard()
    place(p2Board, 'cruiser', [1, 11, 21])   // vertical, col 1, rows 0–2 — 11 is mid-ship
    const marks = emptyMarks()
    marks[11] = 'hit'
    const bs = buildBattle({
      p1Board: fleetA(),
      p2Board,
      hits: { p1: emptyMarks(), p2: marks },
    })
    const strategy = makeBattleshipBotStrategy(createRng(5))
    const action = strategy(bs.session.publicState, bs.session.privateStates['p1'], 'p1')
    expect(action.type).toBe('FIRE')
    // up 1, down 21, left 10, right 12 — each direction is a possible pick
    expect([1, 21, 10, 12]).toContain((action as { type: 'FIRE'; cell: number }).cell)
  })

  it('targeting at board edges stays in bounds', () => {
    const strategy = makeBattleshipBotStrategy(createRng(5))

    // top edge: hit at 1 → up is off-grid, candidates are down 11, left 0, right 2
    const boardTop = emptyBoard()
    place(boardTop, 'cruiser', [1, 11, 21])
    const marksTop = emptyMarks()
    marksTop[1] = 'hit'
    const bsTop = buildBattle({ p1Board: fleetA(), p2Board: boardTop, hits: { p1: emptyMarks(), p2: marksTop } })
    const a = strategy(bsTop.session.publicState, bsTop.session.privateStates['p1'], 'p1') as { type: 'FIRE'; cell: number }
    expect([11, 0, 2]).toContain(a.cell)

    // top-right corner: hit at 9 → up and right off-grid, candidates are down 19, left 8
    const boardCorner = emptyBoard()
    place(boardCorner, 'cruiser', [7, 8, 9])
    const marksCorner = emptyMarks()
    marksCorner[9] = 'hit'
    const bsCorner = buildBattle({ p1Board: fleetA(), p2Board: boardCorner, hits: { p1: emptyMarks(), p2: marksCorner } })
    const b = strategy(bsCorner.session.publicState, bsCorner.session.privateStates['p1'], 'p1') as { type: 'FIRE'; cell: number }
    expect([19, 8]).toContain(b.cell)

    // bottom-left corner: hit at 90 → down and left off-grid, candidates are up 80, right 91
    const boardBottom = emptyBoard()
    place(boardBottom, 'cruiser', [70, 80, 90])
    const marksBottom = emptyMarks()
    marksBottom[90] = 'hit'
    const bsBottom = buildBattle({ p1Board: fleetA(), p2Board: boardBottom, hits: { p1: emptyMarks(), p2: marksBottom } })
    const c = strategy(bsBottom.session.publicState, bsBottom.session.privateStates['p1'], 'p1') as { type: 'FIRE'; cell: number }
    expect([80, 91]).toContain(c.cell)
  })

  it('returns to random mode after a ship is sunk and all its neighbors are fired', () => {
    const marks = emptyMarks()
    for (const c of [82, 83]) marks[c] = 'hit'      // destroyer sunk and revealed
    for (const c of [72, 92, 81, 73, 93, 84]) marks[c] = 'miss'  // every neighbor already fired
    const bs = buildBattle({
      p1Board: fleetA(),
      p2Board: fleetB(),
      hits: { p1: emptyMarks(), p2: marks },
      sunk: { p1: [], p2: [{ shipId: 'destroyer', cells: [82, 83] }] },
    })
    const strategy = makeBattleshipBotStrategy(createRng(9))
    const action = strategy(bs.session.publicState, bs.session.privateStates['p1'], 'p1') as { type: 'FIRE'; cell: number }
    expect(action.type).toBe('FIRE')
    expect(marks[action.cell]).toBeNull()   // never a fired cell
    expect([72, 92, 81, 73, 93, 84, 82, 83]).not.toContain(action.cell)  // not adjacent-restricted
  })

  it('full bot-vs-bot match terminates with a winner in at most 200 shots, every action accepted', () => {
    let bs = createBattleshipGame(['p1', 'p2'], 7)
    const strategyP1 = makeBattleshipBotStrategy(createRng(11))
    const strategyP2 = makeBattleshipBotStrategy(createRng(23))
    for (const playerId of ['p1', 'p2'] as const) {
      const result = runBattleshipBotTurn(bs, playerId, playerId === 'p1' ? strategyP1 : strategyP2)
      expect(result.outcome.ok).toBe(true)
      bs = result.bs
    }
    expect(bs.session.publicState.stage).toBe('battle')
    let shots = 0
    while (bs.session.publicState.stage !== 'over') {
      const playerId = currentPlayer(bs.session.publicState.turn)
      const result = runBattleshipBotTurn(bs, playerId, playerId === 'p1' ? strategyP1 : strategyP2)
      expect(result.outcome.ok).toBe(true)
      bs = result.bs
      shots++
      expect(shots).toBeLessThanOrEqual(200)
    }
    const pub = bs.session.publicState
    expect(pub.winnerId).not.toBeNull()
    expect(pub.scores[pub.winnerId!]).toBe(5)
  })
})

describe('no-leak — guest never sees the host board', () => {
  it('guest snapshot leaks nothing until a ship sinks, then only the sunk ship', () => {
    const game = createBattleshipGame(['p1', 'p2'], 1)
    const hostFleet = fleetA()
    const guestFleet = fleetB()

    const r1 = applyBattleshipAction(game, 'p1', { type: 'PLACE_FLEET', board: hostFleet })
    expect(r1.outcome.ok).toBe(true)
    const afterHostPlace = r1.bs
    const r2 = applyBattleshipAction(afterHostPlace, 'p2', { type: 'PLACE_FLEET', board: guestFleet })
    expect(r2.outcome.ok).toBe(true)
    const afterBothPlace = r2.bs
    expect(afterBothPlace.session.publicState.stage).toBe('battle')

    const snapshot = deriveSnapshot(afterBothPlace.session, 'p2')
    expect(snapshot.privateState!.board).toEqual(guestFleet)
    const jsonBefore = JSON.stringify(snapshot.publicState)
    for (const ship of SHIPS) {
      expect(jsonBefore).not.toContain(ship.id)
    }
    expect(isJsonSerializable(snapshot)).toBe(true)

    // Guest sinks the host's destroyer: p1 misses, p2 hits 80, p1 misses again, p2 hits 81
    const f1 = applyBattleshipAction(afterBothPlace, 'p1', { type: 'FIRE', cell: 0 })
    expect(f1.outcome.ok).toBe(true)
    const afterMiss = f1.bs
    const f2 = applyBattleshipAction(afterMiss, 'p2', { type: 'FIRE', cell: 80 })
    expect(f2.outcome.ok).toBe(true)
    const afterHit = f2.bs
    const f3 = applyBattleshipAction(afterHit, 'p1', { type: 'FIRE', cell: 1 })
    expect(f3.outcome.ok).toBe(true)
    const afterMiss2 = f3.bs
    const f4 = applyBattleshipAction(afterMiss2, 'p2', { type: 'FIRE', cell: 81 })
    expect(f4.outcome.ok).toBe(true)
    const afterSunk = f4.bs

    const pub = afterSunk.session.publicState
    expect(pub.sunk['p1']).toEqual([{ shipId: 'destroyer', cells: [80, 81] }])
    expect(pub.lastShot).toEqual({ by: 'p2', cell: 81, result: 'sunk', shipId: 'destroyer' })

    const snapshotAfter = deriveSnapshot(afterSunk.session, 'p2')
    const jsonAfter = JSON.stringify(snapshotAfter.publicState)
    for (const ship of SHIPS) {
      if (ship.id === 'destroyer') {
        expect(jsonAfter).toContain(ship.id)
      } else {
        expect(jsonAfter).not.toContain(ship.id)
      }
    }
    expect(isJsonSerializable(snapshotAfter)).toBe(true)
  })
})

describe('revision flow', () => {
  it('accepted actions bump revision by exactly 1, rejected actions leave it unchanged', () => {
    const game = createBattleshipGame(['p1', 'p2'], 3)
    expect(game.session.revision).toBe(0)

    const r1 = applyBattleshipAction(game, 'p1', { type: 'PLACE_FLEET', board: fleetA() })
    expect(r1.outcome.ok).toBe(true)
    expect(r1.bs.session.revision).toBe(1)

    const rej1 = applyBattleshipAction(r1.bs, 'p1', { type: 'PLACE_FLEET', board: fleetA() })
    expect(rej1.outcome.ok).toBe(false)
    expect(rej1.bs.session.revision).toBe(1)

    const rej2 = applyBattleshipAction(r1.bs, 'p1', { type: 'FIRE', cell: 0 })
    expect(rej2.outcome.ok).toBe(false)
    expect(rej2.bs.session.revision).toBe(1)

    const r2 = applyBattleshipAction(r1.bs, 'p2', { type: 'PLACE_FLEET', board: fleetB() })
    expect(r2.outcome.ok).toBe(true)
    expect(r2.bs.session.revision).toBe(2)

    const r3 = applyBattleshipAction(r2.bs, 'p1', { type: 'FIRE', cell: 0 })
    expect(r3.outcome.ok).toBe(true)
    expect(r3.bs.session.revision).toBe(3)

    const r4 = applyBattleshipAction(r3.bs, 'p2', { type: 'FIRE', cell: 10 })
    expect(r4.outcome.ok).toBe(true)
    expect(r4.bs.session.revision).toBe(4)

    const rej3 = applyBattleshipAction(r4.bs, 'p1', { type: 'FIRE', cell: 0 })  // repeat cell
    expect(rej3.outcome.ok).toBe(false)
    expect(rej3.bs.session.revision).toBe(4)

    const r5 = applyBattleshipAction(r4.bs, 'p1', { type: 'FIRE', cell: 5 })  // hit on p2's carrier
    expect(r5.outcome.ok).toBe(true)
    expect(r5.bs.session.revision).toBe(5)

    const rej4 = applyBattleshipAction(r5.bs, 'p2', { type: 'FIRE', cell: 100 })  // out of range
    expect(rej4.outcome.ok).toBe(false)
    expect(rej4.bs.session.revision).toBe(5)
  })
})

describe('variants', () => {
  it('stores the variant in public state; defaults to standard', () => {
    const streak = createBattleshipGame(['p1', 'p2'], 1, 'streak')
    expect(streak.session.publicState.variant).toBe('streak')
    const standard = createBattleshipGame(['p1', 'p2'], 1)
    expect(standard.session.publicState.variant).toBe('standard')
  })

  it('streak: a hit keeps the turn, a miss passes it', () => {
    let bs = createBattleshipGame(['p1', 'p2'], 1, 'streak')
    const r1 = applyBattleshipAction(bs, 'p1', { type: 'PLACE_FLEET', board: fleetA() })
    expect(r1.outcome.ok).toBe(true)
    bs = r1.bs
    const r2 = applyBattleshipAction(bs, 'p2', { type: 'PLACE_FLEET', board: fleetB() })
    expect(r2.outcome.ok).toBe(true)
    bs = r2.bs
    expect(bs.session.publicState.stage).toBe('battle')

    // hit → the streak holder keeps the turn
    const h1 = applyBattleshipAction(bs, 'p1', { type: 'FIRE', cell: 5 })  // p2's carrier
    expect(h1.outcome.ok).toBe(true)
    expect(currentPlayer(h1.bs.session.publicState.turn)).toBe('p1')
    expect(h1.bs.session.publicState.turn.turnNumber).toBe(2)

    // opponent's out-of-turn fire while the streak holder is up → rejected
    const oot = applyBattleshipAction(h1.bs, 'p2', { type: 'FIRE', cell: 10 })
    expect(oot.outcome.ok).toBe(false)
    expect(oot.outcome.reason).toContain('turn')

    // the same player fires again immediately and is accepted
    const h2 = applyBattleshipAction(h1.bs, 'p1', { type: 'FIRE', cell: 6 })
    expect(h2.outcome.ok).toBe(true)
    expect(currentPlayer(h2.bs.session.publicState.turn)).toBe('p1')
    expect(h2.bs.session.publicState.turn.turnNumber).toBe(3)

    // miss → turn passes to the opponent
    const m1 = applyBattleshipAction(h2.bs, 'p1', { type: 'FIRE', cell: 0 })  // empty on p2's board
    expect(m1.outcome.ok).toBe(true)
    expect(m1.bs.session.publicState.lastShot).toEqual({ by: 'p1', cell: 0, result: 'miss', shipId: null })
    expect(currentPlayer(m1.bs.session.publicState.turn)).toBe('p2')
    expect(m1.bs.session.publicState.turn.turnNumber).toBe(4)
  })

  it('streak: sinking a ship also keeps the turn', () => {
    let bs = createBattleshipGame(['p1', 'p2'], 1, 'streak')
    const r1 = applyBattleshipAction(bs, 'p1', { type: 'PLACE_FLEET', board: fleetA() })
    expect(r1.outcome.ok).toBe(true)
    bs = r1.bs
    const r2 = applyBattleshipAction(bs, 'p2', { type: 'PLACE_FLEET', board: fleetB() })
    expect(r2.outcome.ok).toBe(true)
    bs = r2.bs

    const h1 = applyBattleshipAction(bs, 'p1', { type: 'FIRE', cell: 82 })  // destroyer's first cell
    expect(h1.outcome.ok).toBe(true)
    expect(currentPlayer(h1.bs.session.publicState.turn)).toBe('p1')

    const s1 = applyBattleshipAction(h1.bs, 'p1', { type: 'FIRE', cell: 83 })  // second cell → sunk
    expect(s1.outcome.ok).toBe(true)
    const pub = s1.bs.session.publicState
    expect(pub.lastShot).toEqual({ by: 'p1', cell: 83, result: 'sunk', shipId: 'destroyer' })
    expect(pub.scores['p1']).toBe(1)
    expect(currentPlayer(pub.turn)).toBe('p1')  // sunk keeps the turn

    // the same player may fire again right after a sunk
    const h2 = applyBattleshipAction(s1.bs, 'p1', { type: 'FIRE', cell: 5 })
    expect(h2.outcome.ok).toBe(true)
    expect(currentPlayer(h2.bs.session.publicState.turn)).toBe('p1')
  })

  it('free: any player may fire at any time; turnNumber counts shots', () => {
    let bs = createBattleshipGame(['p1', 'p2'], 1, 'free')
    const r1 = applyBattleshipAction(bs, 'p1', { type: 'PLACE_FLEET', board: fleetA() })
    expect(r1.outcome.ok).toBe(true)
    bs = r1.bs
    const r2 = applyBattleshipAction(bs, 'p2', { type: 'PLACE_FLEET', board: fleetB() })
    expect(r2.outcome.ok).toBe(true)
    bs = r2.bs
    expect(bs.session.publicState.stage).toBe('battle')

    const a1 = applyBattleshipAction(bs, 'p1', { type: 'FIRE', cell: 0 })    // miss on p2's board
    expect(a1.outcome.ok).toBe(true)
    const a2 = applyBattleshipAction(a1.bs, 'p1', { type: 'FIRE', cell: 10 })  // A again immediately
    expect(a2.outcome.ok).toBe(true)
    const b1 = applyBattleshipAction(a2.bs, 'p2', { type: 'FIRE', cell: 10 })  // B fires
    expect(b1.outcome.ok).toBe(true)
    const a3 = applyBattleshipAction(b1.bs, 'p1', { type: 'FIRE', cell: 5 })   // A again — hit
    expect(a3.outcome.ok).toBe(true)

    const pub = a3.bs.session.publicState
    expect(pub.turn.turnNumber).toBe(5)  // 4 accepted shots after the initial 1
    expect(pub.hits['p2'][0]).toBe('miss')
    expect(pub.hits['p2'][10]).toBe('miss')
    expect(pub.hits['p1'][10]).toBe('miss')
    expect(pub.hits['p2'][5]).toBe('hit')
    expect(pub.lastShot).toEqual({ by: 'p1', cell: 5, result: 'hit', shipId: null })
  })

  it('free: cell validation, repeat cells, placing stage, and double placement still reject', () => {
    // repeat cell + out of range during battle
    let bs = createBattleshipGame(['p1', 'p2'], 1, 'free')
    const r1 = applyBattleshipAction(bs, 'p1', { type: 'PLACE_FLEET', board: fleetA() })
    expect(r1.outcome.ok).toBe(true)
    bs = r1.bs
    const r2 = applyBattleshipAction(bs, 'p2', { type: 'PLACE_FLEET', board: fleetB() })
    expect(r2.outcome.ok).toBe(true)
    bs = r2.bs
    const f1 = applyBattleshipAction(bs, 'p1', { type: 'FIRE', cell: 0 })
    expect(f1.outcome.ok).toBe(true)
    const f2 = applyBattleshipAction(f1.bs, 'p1', { type: 'FIRE', cell: 0 })  // repeat cell
    expect(f2.outcome.ok).toBe(false)
    expect(f2.outcome.reason).toContain('already fired')
    const f3 = applyBattleshipAction(f1.bs, 'p1', { type: 'FIRE', cell: 100 })  // out of range
    expect(f3.outcome.ok).toBe(false)
    expect(f3.outcome.reason).toContain('invalid cell')

    // firing during placing
    const placing = createBattleshipGame(['p1', 'p2'], 1, 'free')
    const f4 = applyBattleshipAction(placing, 'p1', { type: 'FIRE', cell: 0 })
    expect(f4.outcome.ok).toBe(false)
    expect(f4.outcome.reason).toContain('battle')

    // PLACE_FLEET double-submit
    const d1 = applyBattleshipAction(placing, 'p1', { type: 'PLACE_FLEET', board: fleetA() })
    expect(d1.outcome.ok).toBe(true)
    const d2 = applyBattleshipAction(d1.bs, 'p1', { type: 'PLACE_FLEET', board: fleetA() })
    expect(d2.outcome.ok).toBe(false)
    expect(d2.outcome.reason).toContain('already placed')
  })

  it('free: the shot that sinks all five ends the match; no post-game shots', () => {
    const marks = emptyMarks()
    for (const c of [5, 6, 7, 8, 9, 24, 25, 26, 27, 43, 44, 45, 63, 64, 65, 82]) marks[c] = 'hit'
    const sunk: SunkReveal[] = [
      { shipId: 'carrier', cells: [5, 6, 7, 8, 9] },
      { shipId: 'battleship', cells: [24, 25, 26, 27] },
      { shipId: 'cruiser', cells: [43, 44, 45] },
      { shipId: 'submarine', cells: [63, 64, 65] },
    ]
    const bs = buildBattle({
      p1Board: fleetA(),
      p2Board: fleetB(),
      hits: { p1: emptyMarks(), p2: marks },
      sunk: { p1: [], p2: sunk },
      scores: { p1: 4, p2: 0 },
      variant: 'free',
    })
    const result = applyBattleshipAction(bs, 'p1', { type: 'FIRE', cell: 83 })
    expect(result.outcome.ok).toBe(true)
    const pub = result.bs.session.publicState
    expect(pub.stage).toBe('over')
    expect(pub.winnerId).toBe('p1')
    expect(pub.scores['p1']).toBe(5)
    expect(pub.lastShot).toEqual({ by: 'p1', cell: 83, result: 'sunk', shipId: 'destroyer' })

    // no post-game shots and no tie path: both players rejected once the stage is 'over'
    const post1 = applyBattleshipAction(result.bs, 'p1', { type: 'FIRE', cell: 10 })
    expect(post1.outcome.ok).toBe(false)
    expect(post1.outcome.reason).toContain('battle')
    const post2 = applyBattleshipAction(result.bs, 'p2', { type: 'FIRE', cell: 10 })
    expect(post2.outcome.ok).toBe(false)
    expect(post2.outcome.reason).toContain('battle')
  })

  it('streak: full bot-vs-bot match terminates with a winner in at most 200 shots', () => {
    let bs = createBattleshipGame(['p1', 'p2'], 7, 'streak')
    const strategyP1 = makeBattleshipBotStrategy(createRng(11))
    const strategyP2 = makeBattleshipBotStrategy(createRng(23))
    for (const playerId of ['p1', 'p2'] as const) {
      const result = runBattleshipBotTurn(bs, playerId, playerId === 'p1' ? strategyP1 : strategyP2)
      expect(result.outcome.ok).toBe(true)
      bs = result.bs
    }
    expect(bs.session.publicState.stage).toBe('battle')
    let shots = 0
    while (bs.session.publicState.stage !== 'over') {
      const playerId = currentPlayer(bs.session.publicState.turn)
      const result = runBattleshipBotTurn(bs, playerId, playerId === 'p1' ? strategyP1 : strategyP2)
      expect(result.outcome.ok).toBe(true)
      bs = result.bs
      shots++
      expect(shots).toBeLessThanOrEqual(200)
    }
    const pub = bs.session.publicState
    expect(pub.winnerId).not.toBeNull()
    expect(pub.scores[pub.winnerId!]).toBe(5)
  })

  it('free: full bot-vs-bot match with manual alternation terminates with a winner in at most 200 shots', () => {
    let bs = createBattleshipGame(['p1', 'p2'], 7, 'free')
    const strategyP1 = makeBattleshipBotStrategy(createRng(11))
    const strategyP2 = makeBattleshipBotStrategy(createRng(23))
    for (const playerId of ['p1', 'p2'] as const) {
      const result = runBattleshipBotTurn(bs, playerId, playerId === 'p1' ? strategyP1 : strategyP2)
      expect(result.outcome.ok).toBe(true)
      bs = result.bs
    }
    expect(bs.session.publicState.stage).toBe('battle')
    let shots = 0
    let round = 0
    while (bs.session.publicState.stage !== 'over') {
      const playerId = round % 2 === 0 ? 'p1' : 'p2'
      const result = runBattleshipBotTurn(bs, playerId, playerId === 'p1' ? strategyP1 : strategyP2)
      expect(result.outcome.ok).toBe(true)
      bs = result.bs
      round++
      shots++
      expect(shots).toBeLessThanOrEqual(200)
    }
    const pub = bs.session.publicState
    expect(pub.winnerId).not.toBeNull()
    expect(pub.scores[pub.winnerId!]).toBe(5)
  })

  it('free: guest snapshot leaks nothing and variant round-trips through JSON', () => {
    const game = createBattleshipGame(['p1', 'p2'], 1, 'free')
    const hostFleet = fleetA()
    const guestFleet = fleetB()

    const r1 = applyBattleshipAction(game, 'p1', { type: 'PLACE_FLEET', board: hostFleet })
    expect(r1.outcome.ok).toBe(true)
    const afterHostPlace = r1.bs
    const r2 = applyBattleshipAction(afterHostPlace, 'p2', { type: 'PLACE_FLEET', board: guestFleet })
    expect(r2.outcome.ok).toBe(true)
    const afterBothPlace = r2.bs
    expect(afterBothPlace.session.publicState.stage).toBe('battle')

    const snapshot = deriveSnapshot(afterBothPlace.session, 'p2')
    expect(snapshot.privateState!.board).toEqual(guestFleet)
    const jsonBefore = JSON.stringify(snapshot.publicState)
    for (const ship of SHIPS) {
      expect(jsonBefore).not.toContain(ship.id)
    }
    expect(JSON.parse(jsonBefore).variant).toBe('free')
    expect(isJsonSerializable(snapshot)).toBe(true)

    // interleaved shots in free mode: p1 misses, p2 hits 80, p1 misses again, p2 sinks 81
    const f1 = applyBattleshipAction(afterBothPlace, 'p1', { type: 'FIRE', cell: 0 })
    expect(f1.outcome.ok).toBe(true)
    const afterMiss = f1.bs
    const f2 = applyBattleshipAction(afterMiss, 'p2', { type: 'FIRE', cell: 80 })
    expect(f2.outcome.ok).toBe(true)
    const afterHit = f2.bs
    const f3 = applyBattleshipAction(afterHit, 'p1', { type: 'FIRE', cell: 1 })
    expect(f3.outcome.ok).toBe(true)
    const afterMiss2 = f3.bs
    const f4 = applyBattleshipAction(afterMiss2, 'p2', { type: 'FIRE', cell: 81 })
    expect(f4.outcome.ok).toBe(true)
    const afterSunk = f4.bs

    const pub = afterSunk.session.publicState
    expect(pub.sunk['p1']).toEqual([{ shipId: 'destroyer', cells: [80, 81] }])
    expect(pub.lastShot).toEqual({ by: 'p2', cell: 81, result: 'sunk', shipId: 'destroyer' })

    const snapshotAfter = deriveSnapshot(afterSunk.session, 'p2')
    const jsonAfter = JSON.stringify(snapshotAfter.publicState)
    for (const ship of SHIPS) {
      if (ship.id === 'destroyer') {
        expect(jsonAfter).toContain(ship.id)
      } else {
        expect(jsonAfter).not.toContain(ship.id)
      }
    }
    expect(JSON.parse(jsonAfter).variant).toBe('free')
    expect(isJsonSerializable(snapshotAfter)).toBe(true)
  })
})
