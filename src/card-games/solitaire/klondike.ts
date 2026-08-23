import type { Card } from '../../card-engine/cards.ts'
import type { SolitaireState } from './state.ts'
import { createStandardDeck, shuffleDeck } from '../../card-engine/deck.ts'
import { createRng } from '../../engine/rng.ts'

export const KLONDIKE_COLUMNS = 7

export function dealKlondike(seed: number, mode: 'klondike' | 'klondike3' = 'klondike'): SolitaireState {
  const deck = createStandardDeck()
  const rng = createRng(seed)
  const shuffled = shuffleDeck(deck, rng)

  // Deal to tableau: column i gets i+1 cards
  const tableau: Card[][] = []
  let deckIndex = 0

  for (let col = 0; col < KLONDIKE_COLUMNS; col++) {
    const column: Card[] = []
    for (let i = 0; i < col + 1; i++) {
      column.push(shuffled[deckIndex])
      deckIndex++
    }
    tableau.push(column)
  }

  // Remaining 24 cards become stock in deal order
  const stock: Card[] = []
  while (deckIndex < shuffled.length) {
    stock.push(shuffled[deckIndex])
    deckIndex++
  }

  return {
    mode,
    seed,
    tableau,
    faceUp: Array(KLONDIKE_COLUMNS).fill(1),
    foundations: [[], [], [], []],
    stock,
    waste: [],
    cells: [],
    pyramidRows: [],
    moves: 0,
    won: false,
  }
}
