import type { Card } from '../../card-engine/cards.ts'
import type { SolitaireState } from './state.ts'
import { createStandardDeck, shuffleDeck } from '../../card-engine/deck.ts'
import { createRng } from '../../engine/rng.ts'

export const FREECELL_COLUMNS = 8
export const FREECELL_CELLS = 4

export function dealFreeCell(seed: number): SolitaireState {
  const deck = createStandardDeck()
  const rng = createRng(seed)
  const shuffled = shuffleDeck(deck, rng)

  // Deal round-robin: card k goes to column k % 8
  const tableau: Card[][] = Array(FREECELL_COLUMNS)
    .fill(null)
    .map(() => [])

  for (let i = 0; i < shuffled.length; i++) {
    const col = i % FREECELL_COLUMNS
    tableau[col].push(shuffled[i])
  }

  return {
    mode: 'freecell',
    seed,
    tableau,
    faceUp: tableau.map((col) => col.length),
    foundations: [[], [], [], []],
    stock: [],
    waste: [],
    cells: [null, null, null, null],
    pyramidRows: [],
    moves: 0,
    won: false,
  }
}

export function maxMovableCards(state: SolitaireState, toEmptyColumn: boolean): number {
  const emptyCells = state.cells.filter((c) => c === null).length
  let emptyColumns = state.tableau.filter((col) => col.length === 0).length

  if (toEmptyColumn) {
    emptyColumns--
  }

  return (emptyCells + 1) * (2 ** emptyColumns)
}
