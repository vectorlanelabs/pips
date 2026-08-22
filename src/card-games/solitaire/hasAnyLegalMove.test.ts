import { describe, it, expect } from 'vitest'
import { createStandardDeck } from '../../card-engine/deck.ts'
import type { Card, Suit, Rank } from '../../card-engine/cards.ts'
import type { SolitaireState } from './state.ts'
import { hasAnyLegalMove } from './shared.ts'

function findCardInDeck(suit: Suit, rank: Rank): Card {
  const deck = createStandardDeck()
  const card = deck.find((c) => c.suit === suit && c.rank === rank)
  if (!card) throw new Error(`Card not found: ${rank}${suit}`)
  return card
}

function buildState(spec: {
  mode?: SolitaireState['mode']
  tableau?: string[][]
  stock?: string[]
  waste?: string[]
  foundations?: Record<string, string[]>
  cells?: (string | null)[]
}): SolitaireState {
  const columns = spec.mode === 'freecell' ? 8 : 7
  const state: SolitaireState = {
    mode: spec.mode ?? 'klondike',
    seed: 0,
    tableau: Array.from({ length: columns }, () => []),
    faceUp: Array(columns).fill(0),
    foundations: [[], [], [], []],
    stock: [],
    waste: [],
    cells: [],
    moves: 0,
    won: false,
  }

  const parseCard = (spec: string): Card => {
    const suitMap: Record<string, Suit> = { '♠': 'spades', '♣': 'clubs', '♥': 'hearts', '♦': 'diamonds' }
    const suit = Object.entries(suitMap).find(([sym]) => spec.includes(sym))?.[1] || 'spades'
    const rank = spec.replace(/[♠♣♥♦]/g, '').trim()
    return findCardInDeck(suit, rank as Rank)
  }

  if (spec.tableau) {
    for (let i = 0; i < spec.tableau.length; i++) {
      state.tableau[i] = spec.tableau[i].map(parseCard)
      state.faceUp[i] = spec.tableau[i].length
    }
  }

  if (spec.stock) state.stock = spec.stock.map(parseCard)
  if (spec.waste) state.waste = spec.waste.map(parseCard)

  if (spec.foundations) {
    const suitMap: Record<string, number> = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 }
    for (const [suitStr, cards] of Object.entries(spec.foundations)) {
      state.foundations[suitMap[suitStr]] = cards.map(parseCard)
    }
  }

  if (spec.cells) {
    state.cells = spec.cells.map((c) => (c ? parseCard(c) : null))
  }

  return state
}

describe('hasAnyLegalMove', () => {
  it('true when the waste top can stack on a tableau column', () => {
    const state = buildState({ tableau: [['7♠'], []], waste: ['6♥'] })
    expect(hasAnyLegalMove(state)).toBe(true)
  })

  it('true when a tableau run can stack elsewhere', () => {
    const state = buildState({ tableau: [['7♠'], ['6♥']] })
    expect(hasAnyLegalMove(state)).toBe(true)
  })

  it('true when a foundation card can come back into the tableau', () => {
    const state = buildState({ tableau: [['7♠']], foundations: { hearts: ['A♥', '2♥', '3♥', '4♥', '5♥', '6♥'] } })
    expect(hasAnyLegalMove(state)).toBe(true)
  })

  it('true when a card can go onto the foundation', () => {
    const state = buildState({ tableau: [['A♠']] })
    expect(hasAnyLegalMove(state)).toBe(true)
  })

  it('true when a King can drop onto an empty column', () => {
    const state = buildState({ tableau: [['K♠'], []] })
    expect(hasAnyLegalMove(state)).toBe(true)
  })

  it('false when nothing can move anywhere', () => {
    // Two black 7s with nothing stackable between them, no aces, no empty columns.
    const state = buildState({ tableau: [['7♠'], ['7♣']], waste: ['8♠'] })
    expect(hasAnyLegalMove(state)).toBe(false)
  })

  it('true for freecell when a card can park in an open cell', () => {
    const state = buildState({ mode: 'freecell', tableau: [['7♠'], ['7♣']], cells: [null, null, null, null] })
    expect(hasAnyLegalMove(state)).toBe(true)
  })
})
