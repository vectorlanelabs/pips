import type { HostSession } from '../../engine/sync.ts'
import { createHostSession } from '../../engine/sync.ts'
import type { TurnState } from '../../engine/turn-engine.ts'
import { createTurnState } from '../../engine/turn-engine.ts'
import { createRng } from '../../engine/rng.ts'
import type { Zone } from '../../card-engine/zones.ts'
import { addCards, cardCount, createHand, createPublicZone } from '../../card-engine/zones.ts'
import { shuffleDeck } from '../../card-engine/deck.ts'

export const SCRABBLE_MIN_SEATS = 2
export const SCRABBLE_MAX_SEATS = 4
export const RACK_SIZE = 7

export interface ScrabbleTile {
  id: string
  letter: string  // empty string for blanks
  points: number
}

export interface BoardCell {
  letter: string       // the letter actually on the board (assigned letter for a blank)
  isBlank: boolean      // true if this cell was placed using a blank tile
  premiumConsumed: boolean  // true once any tile has occupied this square
}

export type ScrabbleStage = 'play' | 'over'

export interface LastPlacement {
  by: string
  tiles: { tileId: string; row: number; col: number; letter: string; isBlank: boolean }[]
  words: { word: string; score: number }[]   // every word formed this turn (main + cross-words)
  totalScore: number
  challengeable: boolean   // false once the next player has taken any non-CHALLENGE action
}

export interface ScrabblePublicState {
  stage: ScrabbleStage
  turn: TurnState<'play'>
  board: (BoardCell | null)[][]     // 15x15, row-major
  bagCount: number
  handCounts: Record<string, number>
  scores: Record<string, number>
  consecutivePasses: number
  lastPlacement: LastPlacement | null
  winnerId: string | null            // set only when stage === 'over'
}

export interface ScrabblePrivateState {
  rack: Zone<ScrabbleTile>
}

export type ScrabbleAction =
  | { type: 'PLACE_WORD'; tiles: { tileId: string; row: number; col: number; letter: string }[] }
  | { type: 'EXCHANGE_TILES'; tileIds: string[] }
  | { type: 'PASS' }
  | { type: 'CHALLENGE' }

export interface ScrabbleSession {
  session: HostSession<ScrabblePublicState, ScrabblePrivateState>
  bag: Zone<ScrabbleTile>   // host-only, outside HostSession
  rng: () => number
}

// Standard English 100-tile distribution
const TILE_DISTRIBUTION: Array<[string, number, number]> = [
  ['A', 9, 1], ['B', 2, 3], ['C', 2, 3], ['D', 4, 2], ['E', 12, 1],
  ['F', 2, 4], ['G', 3, 2], ['H', 2, 4], ['I', 9, 1], ['J', 1, 8],
  ['K', 1, 5], ['L', 4, 1], ['M', 2, 3], ['N', 6, 1], ['O', 8, 1],
  ['P', 2, 3], ['Q', 1, 10], ['R', 6, 1], ['S', 4, 1], ['T', 6, 1],
  ['U', 4, 1], ['V', 2, 4], ['W', 2, 4], ['X', 1, 8], ['Y', 2, 4],
  ['Z', 1, 10],
]

export function createTileBag(): ScrabbleTile[] {
  const tiles: ScrabbleTile[] = []
  let counter = 0

  // Regular tiles
  for (const [letter, count, points] of TILE_DISTRIBUTION) {
    for (let i = 0; i < count; i++) {
      tiles.push({ id: `tile-${counter}`, letter, points })
      counter++
    }
  }

  // Blank tiles (2 total, 0 points each)
  for (let i = 0; i < 2; i++) {
    tiles.push({ id: `blank-${i}`, letter: '', points: 0 })
  }

  return tiles
}

export function createScrabbleGame(playerIds: string[], seed: number): ScrabbleSession {
  const rng = createRng(seed)
  const shuffled = shuffleDeck(createTileBag(), rng)

  // Deal RACK_SIZE tiles to each player, round-robin
  const racks: Record<string, Zone<ScrabbleTile>> = {}
  const racksArray: Zone<ScrabbleTile>[] = []
  let tileIndex = 0

  for (const playerId of playerIds) {
    const rack = createHand<ScrabbleTile>(playerId)
    const dealt = shuffled.slice(tileIndex, tileIndex + RACK_SIZE)
    racks[playerId] = addCards(rack, dealt)
    racksArray.push(racks[playerId])
    tileIndex += RACK_SIZE
  }

  // Remaining tiles go in the bag
  const bagTiles = shuffled.slice(playerIds.length * RACK_SIZE)
  const bag = addCards(createPublicZone<ScrabbleTile>('bag', 'private'), bagTiles)

  const turn = createTurnState<'play'>(playerIds, 'play')

  // Create 15x15 board initialized to all null
  const board: (BoardCell | null)[][] = Array(15).fill(null).map(() => Array(15).fill(null))

  const publicState: ScrabblePublicState = {
    stage: 'play',
    turn,
    board,
    bagCount: cardCount(bag),
    handCounts: Object.fromEntries(playerIds.map((pid) => [pid, RACK_SIZE])),
    scores: Object.fromEntries(playerIds.map((pid) => [pid, 0])),
    consecutivePasses: 0,
    lastPlacement: null,
    winnerId: null,
  }

  const privateStates: Record<string, ScrabblePrivateState> = Object.fromEntries(
    playerIds.map((pid) => [pid, { rack: racks[pid] }])
  )

  return { session: createHostSession(publicState, privateStates), bag, rng }
}
