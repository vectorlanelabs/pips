import type { Card } from '../../card-engine/cards.ts'
import { RANKS } from '../../card-engine/cards.ts'
import { createStandardDeck, shuffleDeck } from '../../card-engine/deck.ts'
import { createRng } from '../../engine/rng.ts'

// 1 (apex) + 2 + ... + 7 = 28 cards; row 0 is the apex, row 6 is the base.
export const PYRAMID_ROWS = 7

export interface PyramidState {
  seed: number
  // row r has r+1 slots; null marks a removed card. Row 6 (the base) always
  // has nothing "resting on" it and so is always exposed; a card higher up
  // (lower row index) is exposed once both cards it rests on — (row+1, col)
  // and (row+1, col+1) — have been removed. Every card deals face up; this
  // is a rule constraint on what's REMOVABLE, not a visibility constraint.
  pyramid: (Card | null)[][]
  stock: Card[] // last = next to draw
  waste: Card[] // last = top, the only waste card in play
  moves: number
  won: boolean
}

export type PyramidLoc = { kind: 'pyramid'; row: number; col: number } | { kind: 'waste' }

export type PyramidMove =
  | { type: 'DRAW' }
  | { type: 'REMOVE_KING'; loc: PyramidLoc }
  | { type: 'REMOVE_PAIR'; a: PyramidLoc; b: PyramidLoc }

export type MoveOutcome =
  | { ok: true; state: PyramidState }
  | { ok: false; reason: string }

export function dealPyramid(seed: number): PyramidState {
  const deck = createStandardDeck()
  const rng = createRng(seed)
  const shuffled = shuffleDeck(deck, rng)

  const pyramid: (Card | null)[][] = []
  let index = 0
  for (let row = 0; row < PYRAMID_ROWS; row++) {
    const rowCards: (Card | null)[] = []
    for (let col = 0; col <= row; col++) {
      rowCards.push(shuffled[index])
      index++
    }
    pyramid.push(rowCards)
  }

  const stock = shuffled.slice(index)

  return { seed, pyramid, stock, waste: [], moves: 0, won: false }
}

export function rankValue(rank: string): number {
  return RANKS.indexOf(rank) + 1 // A=1, 2..10 numeric, J=11, Q=12, K=13
}

function locKey(loc: PyramidLoc): string {
  return loc.kind === 'waste' ? 'waste' : `${loc.row},${loc.col}`
}

export function cardAt(state: PyramidState, loc: PyramidLoc): Card | null {
  if (loc.kind === 'waste') return state.waste.length > 0 ? state.waste[state.waste.length - 1] : null
  return state.pyramid[loc.row]?.[loc.col] ?? null
}

export function isExposed(state: PyramidState, loc: PyramidLoc): boolean {
  if (loc.kind === 'waste') return state.waste.length > 0
  if (!state.pyramid[loc.row]?.[loc.col]) return false
  if (loc.row === PYRAMID_ROWS - 1) return true
  return state.pyramid[loc.row + 1][loc.col] === null && state.pyramid[loc.row + 1][loc.col + 1] === null
}

function removeLoc(state: PyramidState, loc: PyramidLoc): PyramidState {
  if (loc.kind === 'waste') {
    return { ...state, waste: state.waste.slice(0, -1) }
  }
  const pyramid = state.pyramid.map((row) => [...row])
  pyramid[loc.row][loc.col] = null
  return { ...state, pyramid }
}

function finish(state: PyramidState): MoveOutcome {
  const won = state.pyramid.every((row) => row.every((c) => c === null))
  return { ok: true, state: { ...state, moves: state.moves + 1, won } }
}

export function applyMove(state: PyramidState, move: PyramidMove): MoveOutcome {
  if (move.type === 'DRAW') {
    if (state.stock.length > 0) {
      const card = state.stock[state.stock.length - 1]
      return {
        ok: true,
        state: { ...state, stock: state.stock.slice(0, -1), waste: [...state.waste, card], moves: state.moves + 1 },
      }
    }
    if (state.waste.length > 0) {
      return { ok: true, state: { ...state, stock: [...state.waste].reverse(), waste: [], moves: state.moves + 1 } }
    }
    return { ok: false, reason: 'nothing to draw' }
  }

  if (move.type === 'REMOVE_KING') {
    const card = cardAt(state, move.loc)
    if (!card) return { ok: false, reason: 'no card there' }
    if (!isExposed(state, move.loc)) return { ok: false, reason: 'card is not exposed' }
    if (rankValue(card.rank) !== 13) return { ok: false, reason: 'only a King can be removed alone' }
    return finish(removeLoc(state, move.loc))
  }

  // REMOVE_PAIR
  const { a, b } = move
  if (locKey(a) === locKey(b)) return { ok: false, reason: 'pick two different cards' }
  const cardA = cardAt(state, a)
  const cardB = cardAt(state, b)
  if (!cardA || !cardB) return { ok: false, reason: 'no card there' }
  if (!isExposed(state, a) || !isExposed(state, b)) return { ok: false, reason: 'card is not exposed' }
  if (rankValue(cardA.rank) + rankValue(cardB.rank) !== 13) return { ok: false, reason: 'ranks must sum to 13' }
  return finish(removeLoc(removeLoc(state, a), b))
}

// Every currently-exposed location that would pair with `loc` (rank sum 13).
// Does not include `loc` itself, and doesn't apply to a King (which has no
// partner — it's removed alone via REMOVE_KING).
export function legalPartners(state: PyramidState, loc: PyramidLoc): PyramidLoc[] {
  const card = cardAt(state, loc)
  if (!card || !isExposed(state, loc)) return []
  const need = 13 - rankValue(card.rank)
  const results: PyramidLoc[] = []

  const waste: PyramidLoc = { kind: 'waste' }
  if (locKey(waste) !== locKey(loc) && isExposed(state, waste)) {
    if (rankValue(cardAt(state, waste)!.rank) === need) results.push(waste)
  }

  for (let row = 0; row < state.pyramid.length; row++) {
    for (let col = 0; col < state.pyramid[row].length; col++) {
      const pLoc: PyramidLoc = { kind: 'pyramid', row, col }
      if (locKey(pLoc) === locKey(loc)) continue
      if (!isExposed(state, pLoc)) continue
      if (rankValue(cardAt(state, pLoc)!.rank) === need) results.push(pLoc)
    }
  }

  return results
}
