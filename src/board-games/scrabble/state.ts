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
}

export type ScrabbleStage = 'play' | 'over'

export interface LastPlacement {
  by: string
  tiles: { tileId: string; row: number; col: number; letter: string; isBlank: boolean }[]
  words: { word: string; score: number }[]   // every word formed this turn (main + cross-words)
  totalScore: number
  drawnTileIds: string[]   // IDs of the tiles drawn from the bag as refill for this placement (empty if the bag was empty)
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

// Standard English Scrabble letter point values (blanks are 0 and handled separately)
export const LETTER_POINTS: Record<string, number> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
}

// Standard English 100-tile distribution (letter, count)
const TILE_DISTRIBUTION: Array<[string, number]> = [
  ['A', 9], ['B', 2], ['C', 2], ['D', 4], ['E', 12],
  ['F', 2], ['G', 3], ['H', 2], ['I', 9], ['J', 1],
  ['K', 1], ['L', 4], ['M', 2], ['N', 6], ['O', 8],
  ['P', 2], ['Q', 1], ['R', 6], ['S', 4], ['T', 6],
  ['U', 4], ['V', 2], ['W', 2], ['X', 1], ['Y', 2],
  ['Z', 1],
]

export function createTileBag(): ScrabbleTile[] {
  const tiles: ScrabbleTile[] = []
  let counter = 0

  // Regular tiles
  for (const [letter, count] of TILE_DISTRIBUTION) {
    for (let i = 0; i < count; i++) {
      tiles.push({ id: `tile-${counter}`, letter, points: LETTER_POINTS[letter] })
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
