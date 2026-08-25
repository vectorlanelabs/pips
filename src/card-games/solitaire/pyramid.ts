import type { Card } from '../../card-engine/cards.ts'
import { RANKS } from '../../card-engine/cards.ts'
import { createStandardDeck, shuffleDeck } from '../../card-engine/deck.ts'
import { createRng } from '../../engine/rng.ts'
import type { SolitaireState, SolitaireLoc, SolitaireMove, MoveOutcome } from './state.ts'

// 1 (apex) + 2 + ... + 7 = 28 cards; row 0 is the apex, row 6 is the base.
export const PYRAMID_ROWS = 7

export function dealPyramid(seed: number): SolitaireState {
  const deck = createStandardDeck()
  const rng = createRng(seed)
  const shuffled = shuffleDeck(deck, rng)

  const pyramidRows: (Card | null)[][] = []
  let index = 0
  for (let row = 0; row < PYRAMID_ROWS; row++) {
    const rowCards: (Card | null)[] = []
    for (let col = 0; col <= row; col++) {
      rowCards.push(shuffled[index])
      index++
    }
    pyramidRows.push(rowCards)
  }

  const stock = shuffled.slice(index)

  return {
    mode: 'pyramid',
    seed,
    tableau: [],
    faceUp: [],
    foundations: [],
    stock,
    waste: [],
    cells: [],
    pyramidRows,
    moves: 0,
    won: false,
  }
}

export function rankValue(rank: string): number {
  return RANKS.indexOf(rank) + 1 // A=1, 2..10 numeric, J=11, Q=12, K=13
}

function locKey(loc: SolitaireLoc): string {
  return loc.kind === 'waste' ? 'waste' : loc.kind === 'pyramid' ? `${loc.row},${loc.col}` : `${loc.kind}:?`
}

export function cardAt(state: SolitaireState, loc: SolitaireLoc): Card | null {
  if (loc.kind === 'waste') return state.waste.length > 0 ? state.waste[state.waste.length - 1] : null
  if (loc.kind !== 'pyramid') return null
  return state.pyramidRows[loc.row]?.[loc.col] ?? null
}

export function isExposed(state: SolitaireState, loc: SolitaireLoc): boolean {
  if (loc.kind === 'waste') return state.waste.length > 0
  if (loc.kind !== 'pyramid') return false
  if (!state.pyramidRows[loc.row]?.[loc.col]) return false
  if (loc.row === PYRAMID_ROWS - 1) return true
  return state.pyramidRows[loc.row + 1][loc.col] === null && state.pyramidRows[loc.row + 1][loc.col + 1] === null
}

function removeLoc(state: SolitaireState, loc: SolitaireLoc): SolitaireState {
  if (loc.kind === 'waste') {
    return { ...state, waste: state.waste.slice(0, -1) }
  }
  if (loc.kind !== 'pyramid') return state
  const pyramidRows = state.pyramidRows.map((row) => [...row])
  pyramidRows[loc.row][loc.col] = null
  return { ...state, pyramidRows }
}

function finish(state: SolitaireState): MoveOutcome {
  const won = state.pyramidRows.every((row) => row.every((c) => c === null))
  return { ok: true, state: { ...state, moves: state.moves + 1, won } }
}

export function applyPyramidMove(state: SolitaireState, move: SolitaireMove): MoveOutcome {
  if (state.won) {
    return { ok: false, reason: 'game is already won' }
  }

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

  if (move.type === 'REMOVE_PAIR') {
    const { a, b } = move
    if (locKey(a) === locKey(b)) return { ok: false, reason: 'pick two different cards' }
    const cardA = cardAt(state, a)
    const cardB = cardAt(state, b)
    if (!cardA || !cardB) return { ok: false, reason: 'no card there' }
    if (!isExposed(state, a) || !isExposed(state, b)) return { ok: false, reason: 'card is not exposed' }
    if (rankValue(cardA.rank) + rankValue(cardB.rank) !== 13) return { ok: false, reason: 'ranks must sum to 13' }
    return finish(removeLoc(removeLoc(state, a), b))
  }

  return { ok: false, reason: 'pyramid only supports DRAW, REMOVE_KING, and REMOVE_PAIR' }
}

// Every currently-exposed location that would pair with `loc` (rank sum 13).
// Does not include `loc` itself, and doesn't apply to a King (which has no
// partner — it's removed alone via REMOVE_KING). The `count` parameter from
// the shared anyLegalDestinations signature is unused: pyramid moves never
// carry a multi-card count.
export function pyramidLegalDestinations(state: SolitaireState, loc: SolitaireLoc): SolitaireLoc[] {
  const card = cardAt(state, loc)
  if (!card || !isExposed(state, loc)) return []
  const need = 13 - rankValue(card.rank)
  const results: SolitaireLoc[] = []

  const waste: SolitaireLoc = { kind: 'waste' }
  if (locKey(waste) !== locKey(loc) && isExposed(state, waste)) {
    if (rankValue(cardAt(state, waste)!.rank) === need) results.push(waste)
  }

  for (let row = 0; row < state.pyramidRows.length; row++) {
    for (let col = 0; col < state.pyramidRows[row].length; col++) {
      const pLoc: SolitaireLoc = { kind: 'pyramid', row, col }
      if (locKey(pLoc) === locKey(loc)) continue
      if (!isExposed(state, pLoc)) continue
      if (rankValue(cardAt(state, pLoc)!.rank) === need) results.push(pLoc)
    }
  }

  return results
}

// The King click-again shortcut, mirroring Klondike's click-again-to-foundation:
// if `loc` holds an exposed King, this is the move that clears it alone.
export function pyramidKingMove(state: SolitaireState, loc: SolitaireLoc): SolitaireMove | null {
  const card = cardAt(state, loc)
  if (!card || !isExposed(state, loc) || rankValue(card.rank) !== 13) return null
  return { type: 'REMOVE_KING', loc }
}
