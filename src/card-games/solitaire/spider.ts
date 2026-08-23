import type { Card, Suit } from '../../card-engine/cards.ts'
import { RANKS } from '../../card-engine/cards.ts'
import { shuffleDeck } from '../../card-engine/deck.ts'
import { createRng } from '../../engine/rng.ts'
import type { SolitaireState, SolitaireLoc, SolitaireMove, MoveOutcome } from './state.ts'
import { rankIndex, topOf } from './shared.ts'

export const SPIDER_COLUMNS = 10
// Two-suit Spider is the common "medium difficulty" default — placement
// never cares about suit (only rank), but a multi-card run can only be
// picked up as a unit when every card in it shares one suit, so two suits
// still meaningfully increases the difficulty over one suit (mixed-suit
// sequences must be walked one card at a time). One suit is the easiest
// variant: every card is guaranteed the same suit, so any descending run —
// however it was built — can always be picked up as a whole unit.
const SPIDER_SUITS: Record<'spider' | 'spider1', Suit[]> = {
  spider: ['spades', 'hearts'],
  spider1: ['spades'],
}

function createSpiderDeck(mode: 'spider' | 'spider1'): Card[] {
  const suits = SPIDER_SUITS[mode]
  const reps = 8 / suits.length // always 104 cards total (8 * 13), split evenly across the suits used
  const cards: Card[] = []
  let counter = 0
  for (let rep = 0; rep < reps; rep++) {
    for (const suit of suits) {
      for (const rank of RANKS) {
        cards.push({ id: `s${counter}`, suit, rank, deckIndex: rep })
        counter++
      }
    }
  }
  return cards
}

export function dealSpider(seed: number, mode: 'spider' | 'spider1' = 'spider'): SolitaireState {
  const deck = createSpiderDeck(mode)
  const rng = createRng(seed)
  const shuffled = shuffleDeck(deck, rng)

  const tableau: Card[][] = Array.from({ length: SPIDER_COLUMNS }, () => [])
  const faceUp = Array(SPIDER_COLUMNS).fill(1)
  let index = 0
  for (let col = 0; col < SPIDER_COLUMNS; col++) {
    const count = col < 4 ? 6 : 5
    for (let i = 0; i < count; i++) {
      tableau[col].push(shuffled[index])
      index++
    }
  }
  const stock = shuffled.slice(index)

  return {
    mode,
    seed,
    tableau,
    faceUp,
    foundations: [],
    stock,
    waste: [],
    cells: [],
    moves: 0,
    won: false,
  }
}

function isSpiderSequence(cards: Card[]): boolean {
  if (cards.length === 0) return false
  for (let i = 1; i < cards.length; i++) {
    if (rankIndex(cards[i]) !== rankIndex(cards[i - 1]) - 1) return false
    if (cards[i].suit !== cards[i - 1].suit) return false
  }
  return true
}

// After a move touches this column, pull off a complete same-suit K→A run
// sitting at its top, if there is one, into a new foundations entry. A
// column can reach 13+ cards while still having face-down cards near the
// bottom (its own original deal, never fully exposed) — the top-13 check
// must stay within the FACE-UP portion, or it could "complete" a run that
// includes cards the player never even legitimately built.
function clearCompleteRun(tableau: Card[][], faceUp: number[], col: number): { tableau: Card[][]; faceUp: number[]; cleared: Card[] | null } {
  const column = tableau[col]
  if (column.length < 13 || faceUp[col] < 13) return { tableau, faceUp, cleared: null }
  const top13 = column.slice(column.length - 13)
  if (rankIndex(top13[0]) !== 12 || !isSpiderSequence(top13)) return { tableau, faceUp, cleared: null }

  const newTableau = tableau.map((c, i) => (i === col ? c.slice(0, c.length - 13) : c))
  const newFaceUp = [...faceUp]
  const remaining = newTableau[col].length
  const remainingFaceUp = faceUp[col] - 13
  newFaceUp[col] = remaining === 0 ? 0 : (remainingFaceUp > 0 ? remainingFaceUp : 1)
  return { tableau: newTableau, faceUp: newFaceUp, cleared: top13 }
}

export function applySpiderMove(state: SolitaireState, move: SolitaireMove): MoveOutcome {
  if (move.type === 'DRAW') {
    if (state.stock.length === 0) {
      return { ok: false, reason: 'stock is empty' }
    }
    if (state.tableau.some((col) => col.length === 0)) {
      return { ok: false, reason: 'every column needs a card before you can deal again' }
    }
    const n = Math.min(SPIDER_COLUMNS, state.stock.length)
    const dealt = state.stock.slice(state.stock.length - n)
    let tableau = state.tableau.map((col, i) => (i < n ? [...col, dealt[n - 1 - i]] : [...col]))
    let faceUp = state.faceUp.map((f, i) => (i < n ? f + 1 : f))
    const foundations = [...state.foundations]
    for (let col = 0; col < n; col++) {
      const result = clearCompleteRun(tableau, faceUp, col)
      if (result.cleared) {
        tableau = result.tableau
        faceUp = result.faceUp
        foundations.push(result.cleared)
      }
    }
    return {
      ok: true,
      state: {
        ...state,
        tableau,
        faceUp,
        foundations,
        stock: state.stock.slice(0, state.stock.length - n),
        moves: state.moves + 1,
        won: foundations.length === 8,
      },
    }
  }

  const { from, to, count } = move
  if (from.kind !== 'tableau' || to.kind !== 'tableau') {
    return { ok: false, reason: 'spider only moves tableau to tableau' }
  }
  if (!Number.isInteger(count) || count < 1) {
    return { ok: false, reason: 'count must be a positive integer' }
  }
  if (!Number.isInteger(from.index) || from.index < 0 || from.index >= SPIDER_COLUMNS) {
    return { ok: false, reason: 'tableau index out of range' }
  }
  if (!Number.isInteger(to.index) || to.index < 0 || to.index >= SPIDER_COLUMNS) {
    return { ok: false, reason: 'tableau index out of range' }
  }
  if (from.index === to.index) {
    return { ok: false, reason: 'from and to must be different' }
  }
  if (state.tableau[from.index].length === 0) {
    return { ok: false, reason: 'tableau column is empty' }
  }
  if (count > state.faceUp[from.index]) {
    return { ok: false, reason: 'count exceeds face-up cards' }
  }

  const sourceColumn = state.tableau[from.index]
  const sourceCards = sourceColumn.slice(sourceColumn.length - count)
  if (!isSpiderSequence(sourceCards)) {
    return { ok: false, reason: 'cards do not form a same-suit sequence' }
  }

  const destColumn = state.tableau[to.index]
  if (destColumn.length > 0) {
    const destTop = topOf(destColumn)!
    if (rankIndex(destTop) !== rankIndex(sourceCards[0]) + 1) {
      return { ok: false, reason: 'card cannot be stacked on tableau' }
    }
  }

  let tableau = state.tableau.map((col, i) => {
    if (i === from.index) return col.slice(0, col.length - count)
    if (i === to.index) return [...col, ...sourceCards]
    return col
  })
  let faceUp = [...state.faceUp]
  const remainingSource = tableau[from.index].length
  faceUp[from.index] = remainingSource === 0 ? 0 : (count === state.faceUp[from.index] ? 1 : state.faceUp[from.index] - count)
  faceUp[to.index] += count

  const foundations = [...state.foundations]
  for (const col of [to.index, from.index]) {
    const result = clearCompleteRun(tableau, faceUp, col)
    if (result.cleared) {
      tableau = result.tableau
      faceUp = result.faceUp
      foundations.push(result.cleared)
    }
  }

  return {
    ok: true,
    state: {
      ...state,
      tableau,
      faceUp,
      foundations,
      moves: state.moves + 1,
      won: foundations.length === 8,
    },
  }
}

// Every legal destination column for the run currently starting at `from`
// (spider has no foundation/cell targets — completion is automatic).
export function spiderLegalDestinations(state: SolitaireState, from: SolitaireLoc, count: number): SolitaireLoc[] {
  const destinations: SolitaireLoc[] = []
  for (let i = 0; i < SPIDER_COLUMNS; i++) {
    const move: SolitaireMove = { type: 'MOVE', from, to: { kind: 'tableau', index: i }, count }
    if (applySpiderMove(state, move).ok) {
      destinations.push({ kind: 'tableau', index: i })
    }
  }
  return destinations
}
