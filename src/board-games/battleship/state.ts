import type { HostSession } from '../../engine/sync.ts'
import { createHostSession } from '../../engine/sync.ts'
import { createRng } from '../../engine/rng.ts'
import { createTurnState, type TurnState } from '../../engine/turn-engine.ts'

export type ShipId = 'carrier' | 'battleship' | 'cruiser' | 'submarine' | 'destroyer'
export type Orientation = 'h' | 'v'
export type CellMark = 'hit' | 'miss'
export type BattleshipStage = 'placing' | 'battle' | 'over'
export type BattleshipVariant = 'standard' | 'streak' | 'free'

export interface ShipSpec { id: ShipId; name: string; len: number }
export const SHIPS: ShipSpec[] = [
  { id: 'carrier', name: 'Carrier', len: 5 },
  { id: 'battleship', name: 'Battleship', len: 4 },
  { id: 'cruiser', name: 'Cruiser', len: 3 },
  { id: 'submarine', name: 'Submarine', len: 3 },
  { id: 'destroyer', name: 'Destroyer', len: 2 },
]
export const BOARD_SIZE = 10
export const BOARD_CELLS = 100

export interface SunkReveal { shipId: ShipId; cells: number[] }
export interface LastShot { by: string; cell: number; result: 'hit' | 'miss' | 'sunk'; shipId: ShipId | null }
// shipId is non-null ONLY when result === 'sunk'. A plain 'hit' must NOT name the ship.

export interface BattleshipPublicState {
  stage: BattleshipStage
  variant: BattleshipVariant
  turn: TurnState<'fire'>
  // hits[playerId] = marks landed ON that player's own board (opponent's shots at them)
  hits: Record<string, (CellMark | null)[]>
  placedReady: Record<string, boolean>
  // sunk[playerId] = ships sunk ON that player's board, revealed with their true cells
  sunk: Record<string, SunkReveal[]>
  scores: Record<string, number>     // ships this player has sunk, 0–5
  lastShot: LastShot | null
  winnerId: string | null
}

export interface BattleshipPrivateState { board: (ShipId | null)[] }

export type BattleshipAction =
  | { type: 'PLACE_FLEET'; board: (ShipId | null)[] }
  | { type: 'FIRE'; cell: number }

export interface BattleshipSession {
  session: HostSession<BattleshipPublicState, BattleshipPrivateState>
  rng: () => number   // host-only; drives the bot's placement and targeting
}

const FLEET_CELLS = SHIPS.reduce((sum, ship) => sum + ship.len, 0)

function emptyBoard(): (ShipId | null)[] {
  return Array.from({ length: BOARD_CELLS }, () => null)
}

function emptyMarks(): (CellMark | null)[] {
  return Array.from({ length: BOARD_CELLS }, () => null)
}

export function createBattleshipGame(
  playerIds: [string, string],
  seed: number,
  variant: BattleshipVariant = 'standard',
): BattleshipSession {
  const rng = createRng(seed)
  const publicState: BattleshipPublicState = {
    stage: 'placing',
    variant,
    turn: createTurnState<'fire'>(playerIds, 'fire'),
    hits: { [playerIds[0]]: emptyMarks(), [playerIds[1]]: emptyMarks() },
    placedReady: { [playerIds[0]]: false, [playerIds[1]]: false },
    sunk: { [playerIds[0]]: [], [playerIds[1]]: [] },
    scores: { [playerIds[0]]: 0, [playerIds[1]]: 0 },
    lastShot: null,
    winnerId: null,
  }
  const privateStates: Record<string, BattleshipPrivateState> = {
    [playerIds[0]]: { board: emptyBoard() },
    [playerIds[1]]: { board: emptyBoard() },
  }
  return { session: createHostSession(publicState, privateStates), rng }
}

// The prototype's bsCells: null if any cell would leave the 10×10 grid.
// Horizontal extends right, vertical extends down.
export function shipCellsAt(anchor: number, len: number, orient: Orientation): number[] | null {
  const row = Math.floor(anchor / BOARD_SIZE)
  const col = anchor % BOARD_SIZE
  if (orient === 'h') {
    if (col + len > BOARD_SIZE) return null
    return Array.from({ length: len }, (_, i) => anchor + i)
  }
  if (row + len > BOARD_SIZE) return null
  return Array.from({ length: len }, (_, i) => anchor + i * BOARD_SIZE)
}

export function fits(board: (ShipId | null)[], cells: number[] | null): boolean {
  return cells !== null && cells.every((c) => board[c] === null)
}

export function shipCells(board: (ShipId | null)[], shipId: ShipId): number[] {
  const cells: number[] = []
  for (let i = 0; i < board.length; i++) {
    if (board[i] === shipId) cells.push(i)
  }
  return cells
}

export function isShipSunk(board: (ShipId | null)[], hits: (CellMark | null)[], shipId: ShipId): boolean {
  const cells = shipCells(board, shipId)
  return cells.length > 0 && cells.every((c) => hits[c] === 'hit')
}

export function isShipDamaged(board: (ShipId | null)[], hits: (CellMark | null)[], shipId: ShipId): boolean {
  const cells = shipCells(board, shipId)
  const hitCount = cells.reduce((count, c) => (hits[c] === 'hit' ? count + 1 : count), 0)
  return hitCount > 0 && hitCount < cells.length
}

export function allSunk(board: (ShipId | null)[], hits: (CellMark | null)[]): boolean {
  return SHIPS.every((s) => isShipSunk(board, hits, s.id))
}

// Rejection-sampling placement: for each ship not in alreadyPlaced, try a random
// orientation and anchor until the ship fits on the (optionally pre-filled) board.
// Bounded so a malformed or near-saturated `base` fails loudly instead of spinning
// forever — the caller always supplies a valid partial board (UI drafts, or the bot's
// own empty board), so this cap should never be hit on any real input.
const RANDOM_FLEET_MAX_ATTEMPTS_PER_SHIP = 10000

export function randomFleet(
  rand: () => number,
  base?: (ShipId | null)[],
  alreadyPlaced?: ShipId[],
): (ShipId | null)[] {
  const board = base ? [...base] : emptyBoard()
  for (const ship of SHIPS) {
    if (alreadyPlaced?.includes(ship.id)) continue
    let placed = false
    for (let attempt = 0; !placed && attempt < RANDOM_FLEET_MAX_ATTEMPTS_PER_SHIP; attempt++) {
      const orient: Orientation = rand() < 0.5 ? 'h' : 'v'
      const cells = shipCellsAt(Math.floor(rand() * BOARD_CELLS), ship.len, orient)
      if (cells && fits(board, cells)) {
        for (const c of cells) board[c] = ship.id
        placed = true
      }
    }
    if (!placed) {
      throw new Error(`randomFleet: could not place ${ship.id} after ${RANDOM_FLEET_MAX_ATTEMPTS_PER_SHIP} attempts — base board has no room left`)
    }
  }
  return board
}

// Host-side gate on client-submitted fleets: every ship occupies exactly its
// length as a straight contiguous horizontal or vertical line, nothing overlaps
// (impossible in a single array, but counts/shape are still validated), and the
// board is exactly the 100-cell grid.
export function validFleet(board: (ShipId | null)[]): boolean {
  if (board.length !== BOARD_CELLS) return false
  let filled = 0
  for (const cell of board) {
    if (cell === null) continue
    filled++
    if (!SHIPS.some((s) => s.id === cell)) return false
  }
  if (filled !== FLEET_CELLS) return false
  for (const ship of SHIPS) {
    const cells = shipCells(board, ship.id)
    if (cells.length !== ship.len) return false
    const sorted = [...cells].sort((a, b) => a - b)
    const orient: Orientation = sorted[1] - sorted[0] === 1 ? 'h' : 'v'
    const line = shipCellsAt(sorted[0], ship.len, orient)
    if (line === null) return false
    if (!line.every((c, i) => c === sorted[i])) return false
  }
  return true
}
