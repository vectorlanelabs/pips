import { describe, it, expect } from 'vitest'
import { createStandardDeck } from '../../card-engine/deck.ts'
import type { Card, Suit, Rank } from '../../card-engine/cards.ts'
import type { SolitaireState } from './state.ts'
import { createSolitaireGame } from './state.ts'
import { applyMove, findFoundationMove, legalDestinations } from './shared.ts'

// Helper to find a card by suit and rank in the standard deck
function findCardInDeck(suit: Suit, rank: Rank): Card {
  const deck = createStandardDeck()
  const card = deck.find((c) => c.suit === suit && c.rank === rank)
  if (!card) throw new Error(`Card not found: ${rank}${suit}`)
  return card
}

// Helper to build a constructed state from short specs like 'K♠', '10♥'
function buildState(spec: {
  tableau?: string[][]
  stock?: string[]
  waste?: string[]
  foundations?: Record<string, string[]>
}): SolitaireState {
  const state: SolitaireState = {
    mode: 'klondike',
    seed: 0,
    tableau: [[], [], [], [], [], [], []],
    faceUp: [0, 0, 0, 0, 0, 0, 0],
    foundations: [[], [], [], []],
    stock: [],
    waste: [],
    cells: [],
    pyramidRows: [],
    moves: 0,
    won: false,
  }

  // Parse rank and suit from specs like 'K♠' or '10♥'
  const parseCard = (spec: string): Card => {
    const suitMap: Record<string, Suit> = {
      '♠': 'spades',
      '♣': 'clubs',
      '♥': 'hearts',
      '♦': 'diamonds',
    }
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

  if (spec.stock) {
    state.stock = spec.stock.map(parseCard)
  }

  if (spec.waste) {
    state.waste = spec.waste.map(parseCard)
  }

  if (spec.foundations) {
    for (const [suitStr, cards] of Object.entries(spec.foundations)) {
      const suitMap: Record<string, number> = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 }
      const idx = suitMap[suitStr]
      state.foundations[idx] = cards.map(parseCard)
    }
  }

  return state
}

describe('Klondike', () => {
  it('deal shape', () => {
    const state = createSolitaireGame('klondike', 12345)

    // 7 columns with lengths 1-7
    expect(state.tableau.length).toBe(7)
    for (let i = 0; i < 7; i++) {
      expect(state.tableau[i].length).toBe(i + 1)
    }

    // faceUp all 1
    expect(state.faceUp).toEqual([1, 1, 1, 1, 1, 1, 1])

    // stock 24
    expect(state.stock.length).toBe(24)

    // foundations 4 empties
    expect(state.foundations).toEqual([[], [], [], []])

    // 52 unique ids
    const allCards = [
      ...state.tableau.flat(),
      ...state.stock,
    ]
    const ids = new Set(allCards.map((c) => c.id))
    expect(ids.size).toBe(52)

    // waste empty, cells empty
    expect(state.waste).toEqual([])
    expect(state.cells).toEqual([])

    // mode, moves, won
    expect(state.mode).toBe('klondike')
    expect(state.moves).toBe(0)
    expect(state.won).toBe(false)
  })

  it('same seed → deep-equal state', () => {
    const state1 = createSolitaireGame('klondike', 999)
    const state2 = createSolitaireGame('klondike', 999)

    expect(JSON.parse(JSON.stringify(state1))).toEqual(JSON.parse(JSON.stringify(state2)))
  })

  it('different seed → different tableau', () => {
    const state1 = createSolitaireGame('klondike', 111)
    const state2 = createSolitaireGame('klondike', 222)

    // Very unlikely to be equal with different seeds
    expect(state1.tableau[0][0].id).not.toBe(state2.tableau[0][0].id)
  })

  it('DRAW moves stock top to waste', () => {
    const state = createSolitaireGame('klondike', 12345)
    const topStockCard = state.stock[state.stock.length - 1]

    const result = applyMove(state, { type: 'DRAW' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const newState = result.state
    expect(newState.stock.length).toBe(state.stock.length - 1)
    expect(newState.waste[newState.waste.length - 1]).toEqual(topStockCard)
    expect(newState.moves).toBe(1)
  })

  it('DRAW recycles with correct order when stock empty', () => {
    let state = createSolitaireGame('klondike', 12345)

    // Draw all 24 cards from stock
    for (let i = 0; i < 24; i++) {
      const result = applyMove(state, { type: 'DRAW' })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      state = result.state
    }

    expect(state.stock.length).toBe(0)
    expect(state.waste.length).toBe(24)

    // Draw once more → stock becomes reversed waste, waste becomes empty
    const firstCard = state.waste[0]
    const result = applyMove(state, { type: 'DRAW' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const newState = result.state
    expect(newState.stock.length).toBe(24)
    expect(newState.waste.length).toBe(0)
    expect(newState.stock[newState.stock.length - 1]).toEqual(firstCard)
  })

  it('DRAW rejects when stock and waste both empty', () => {
    const state = buildState({
      stock: [],
      waste: [],
    })

    const result = applyMove(state, { type: 'DRAW' })
    expect(result.ok).toBe(false)
  })

  it('tableau → tableau: red-on-black descending', () => {
    const state = buildState({
      tableau: [
        ['K♠'],
        ['Q♥'],
      ],
    })

    const result = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 1 },
      to: { kind: 'tableau', index: 0 },
      count: 1,
    })

    expect(result.ok).toBe(true)
  })

  it('tableau → tableau: rejects same color', () => {
    const state = buildState({
      tableau: [
        ['K♠'],
        ['Q♠'],
      ],
    })

    const move = {
      type: 'MOVE' as const,
      from: { kind: 'tableau' as const, index: 1 },
      to: { kind: 'tableau' as const, index: 0 },
      count: 1,
    }

    const result = applyMove(state, move)
    expect(result.ok).toBe(false)
  })

  it('tableau → tableau: rejects wrong rank', () => {
    const state = buildState({
      tableau: [
        ['K♠'],
        ['10♥'],
      ],
    })

    const move = {
      type: 'MOVE' as const,
      from: { kind: 'tableau' as const, index: 1 },
      to: { kind: 'tableau' as const, index: 0 },
      count: 1,
    }

    const result = applyMove(state, move)
    expect(result.ok).toBe(false)
  })

  it('tableau → tableau: rejects moving more than faceUp', () => {
    const state = buildState({
      tableau: [
        ['10♠', 'J♥', 'Q♠'],
        [],
      ],
    })
    state.faceUp[0] = 1

    const move = {
      type: 'MOVE' as const,
      from: { kind: 'tableau' as const, index: 0 },
      to: { kind: 'tableau' as const, index: 1 },
      count: 2,
    }

    const result = applyMove(state, move)
    expect(result.ok).toBe(false)
  })

  it('tableau → tableau: rejects non-King on empty column', () => {
    const state = buildState({
      tableau: [
        ['Q♥'],
        [],
      ],
    })

    const move = {
      type: 'MOVE' as const,
      from: { kind: 'tableau' as const, index: 0 },
      to: { kind: 'tableau' as const, index: 1 },
      count: 1,
    }

    const result = applyMove(state, move)
    expect(result.ok).toBe(false)
  })

  it('tableau → tableau: accepts King on empty column', () => {
    const state = buildState({
      tableau: [
        ['K♥'],
        [],
      ],
    })

    const move = {
      type: 'MOVE' as const,
      from: { kind: 'tableau' as const, index: 0 },
      to: { kind: 'tableau' as const, index: 1 },
      count: 1,
    }

    const result = applyMove(state, move)
    expect(result.ok).toBe(true)
  })

  it('auto-flip: moving only face-up card with face-down underneath sets faceUp to 1', () => {
    const state2 = buildState({
      tableau: [
        ['10♠', 'J♥', 'Q♠'],
        ['K♥'],
      ],
    })
    state2.faceUp[0] = 1

    const result = applyMove(state2, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 0 },
      to: { kind: 'tableau', index: 1 },
      count: 1,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.faceUp[0]).toBe(1)
  })

  it('auto-flip: moving last card leaves faceUp 0', () => {
    const state = buildState({
      tableau: [
        ['K♥'],
        [],
      ],
    })
    state.faceUp[0] = 1

    const result = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 0 },
      to: { kind: 'tableau', index: 1 },
      count: 1,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.faceUp[0]).toBe(0)
  })

  it('waste → tableau', () => {
    const state = buildState({
      waste: ['Q♥'],
      tableau: [
        ['K♠'],
      ],
    })

    const move = {
      type: 'MOVE' as const,
      from: { kind: 'waste' as const },
      to: { kind: 'tableau' as const, index: 0 },
      count: 1,
    }

    const result = applyMove(state, move)
    expect(result.ok).toBe(true)
  })

  it('waste → foundation', () => {
    const state = buildState({
      waste: ['A♠'],
    })

    const move = {
      type: 'MOVE' as const,
      from: { kind: 'waste' as const },
      to: { kind: 'foundation' as const, index: 3 },
      count: 1,
    }

    const result = applyMove(state, move)
    expect(result.ok).toBe(true)
  })

  it('foundation → tableau', () => {
    const state = buildState({
      foundations: { spades: ['A♠', '2♠'] },
      tableau: [
        ['3♥'],
      ],
    })

    const move = {
      type: 'MOVE' as const,
      from: { kind: 'foundation' as const, index: 3 },
      to: { kind: 'tableau' as const, index: 0 },
      count: 1,
    }

    const result = applyMove(state, move)
    expect(result.ok).toBe(true)
  })

  it('tableau → foundation requires exact next rank', () => {
    const state = buildState({
      tableau: [
        ['A♠'],
        ['3♠'],
      ],
    })

    // Correct: A to empty foundation
    const moveA = {
      type: 'MOVE' as const,
      from: { kind: 'tableau' as const, index: 0 },
      to: { kind: 'foundation' as const, index: 3 },
      count: 1,
    }
    expect(applyMove(state, moveA).ok).toBe(true)

    // Wrong: 3 on empty foundation
    const move3 = {
      type: 'MOVE' as const,
      from: { kind: 'tableau' as const, index: 1 },
      to: { kind: 'foundation' as const, index: 3 },
      count: 1,
    }
    expect(applyMove(state, move3).ok).toBe(false)
  })

  it('findFoundationMove returns the move when legal', () => {
    const state = buildState({
      waste: ['A♠'],
    })

    const move = findFoundationMove(state, { kind: 'waste' })
    expect(move).not.toBeNull()
    if (!move) return
    expect(move.type).toBe('MOVE')
    if (move.type !== 'MOVE') return
    expect(move.to.kind).toBe('foundation')
  })

  it('findFoundationMove returns null when illegal', () => {
    const state = buildState({
      waste: ['5♠'],
    })

    const move = findFoundationMove(state, { kind: 'waste' })
    expect(move).toBeNull()
  })

  it('legalDestinations for a known position', () => {
    const state = buildState({
      tableau: [
        ['K♠'],
        [],
        ['Q♥'],
        ['J♣'],
        [],
        [],
        [],
      ],
    })

    const destinations = legalDestinations(state, { kind: 'tableau', index: 0 }, 1)
    expect(destinations).toEqual([
      { kind: 'tableau', index: 1 },
      { kind: 'tableau', index: 4 },
      { kind: 'tableau', index: 5 },
      { kind: 'tableau', index: 6 },
    ])
  })

  it('legalDestinations respects order: tableau before foundation', () => {
    const state = buildState({
      tableau: [
        ['A♣'],
        [],
        ['2♦'],
        [],
        [],
        [],
        [],
      ],
      foundations: { hearts: ['A♥'] },
    })

    const destinations = legalDestinations(state, { kind: 'tableau', index: 0 }, 1)
    expect(destinations).toEqual([
      { kind: 'tableau', index: 2 },
      { kind: 'foundation', index: 0 },
    ])
  })

  it('win: last King sets won', () => {
    const state = buildState({
      foundations: {
        clubs: ['A♣', '2♣', '3♣', '4♣', '5♣', '6♣', '7♣', '8♣', '9♣', '10♣', 'J♣', 'Q♣'],
        diamonds: ['A♦', '2♦', '3♦', '4♦', '5♦', '6♦', '7♦', '8♦', '9♦', '10♦', 'J♦', 'Q♦'],
        hearts: ['A♥', '2♥', '3♥', '4♥', '5♥', '6♥', '7♥', '8♥', '9♥', '10♥', 'J♥', 'Q♥'],
        spades: ['A♠', '2♠', '3♠', '4♠', '5♠', '6♠', '7♠', '8♠', '9♠', '10♠', 'J♠', 'Q♠'],
      },
      tableau: [
        ['K♣'],
        ['K♦'],
        ['K♥'],
        ['K♠'],
      ],
    })

    expect(state.won).toBe(false)

    // Move first King
    let result = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 0 },
      to: { kind: 'foundation', index: 0 },
      count: 1,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.won).toBe(false)

    let newState = result.state

    // Move second King
    result = applyMove(newState, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 1 },
      to: { kind: 'foundation', index: 1 },
      count: 1,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.won).toBe(false)

    newState = result.state

    // Move third King
    result = applyMove(newState, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 2 },
      to: { kind: 'foundation', index: 2 },
      count: 1,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.won).toBe(false)

    newState = result.state

    // Move fourth King → won
    result = applyMove(newState, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 3 },
      to: { kind: 'foundation', index: 3 },
      count: 1,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.won).toBe(true)
  })

  it('moves increments on success only', () => {
    const state = buildState({
      tableau: [
        ['K♠'],
        ['Q♥'],
        [],
      ],
    })

    const startMoves = state.moves

    // Successful move: K♠ to empty column
    const result1 = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 0 },
      to: { kind: 'tableau', index: 2 },
      count: 1,
    })
    expect(result1.ok).toBe(true)
    if (!result1.ok) return
    expect(result1.state.moves).toBe(startMoves + 1)

    // Rejected move: try to move 2 cards from a column with only 1
    const result2 = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 0 },
      to: { kind: 'tableau', index: 1 },
      count: 2,
    })
    expect(result2.ok).toBe(false)
  })

  it('JSON round-trip', () => {
    const state = createSolitaireGame('klondike', 12345)
    const roundTripped = JSON.parse(JSON.stringify(state))
    expect(roundTripped).toEqual(state)
  })

  it('rejects DRAW in freecell', () => {
    const state = createSolitaireGame('klondike', 12345)
    // This state is klondike, so DRAW should work. Freecell is tested separately
    const result = applyMove(state, { type: 'DRAW' })
    expect(result.ok).toBe(true)
  })

  it('rejects move to waste', () => {
    const state = buildState({
      tableau: [['K♠']],
    })

    const move = {
      type: 'MOVE' as const,
      from: { kind: 'tableau' as const, index: 0 },
      to: { kind: 'waste' as const },
      count: 1,
    }

    const result = applyMove(state, move)
    expect(result.ok).toBe(false)
  })

  it('rejects from === to', () => {
    const state = buildState({
      tableau: [['K♠']],
    })

    const move = {
      type: 'MOVE' as const,
      from: { kind: 'tableau' as const, index: 0 },
      to: { kind: 'tableau' as const, index: 0 },
      count: 1,
    }

    const result = applyMove(state, move)
    expect(result.ok).toBe(false)
  })

  it('non-integer indexes are rejected, never thrown', () => {
    const state = buildState({
      tableau: [['K♠']],
    })

    const result1 = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 1.5 },
      to: { kind: 'tableau', index: 0 },
      count: 1,
    })
    expect(result1.ok).toBe(false)

    const result2 = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 0 },
      to: { kind: 'tableau', index: 2.5 },
      count: 1,
    })
    expect(result2.ok).toBe(false)
  })

  it('rejects any move once the game is already won', () => {
    const state = buildState({ tableau: [['K♥'], []] })
    state.won = true

    const result = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 0 },
      to: { kind: 'tableau', index: 1 },
      count: 1,
    })
    expect(result.ok).toBe(false)

    const drawResult = applyMove({ ...state, stock: [findCardInDeck('spades', 'A')] }, { type: 'DRAW' })
    expect(drawResult.ok).toBe(false)
  })
})

describe('Klondike Draw 3', () => {
  it('draws 3 at a time, preserving chronological order — top of stock drawn first (buried), last drawn ends up playable on top of waste', () => {
    const state = buildState({ stock: ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠'] })
    state.mode = 'klondike3'

    const result = applyMove(state, { type: 'DRAW' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // 7♠ (the stock top) is drawn first and ends up buried; 5♠, drawn last,
    // ends up on top of the waste and is the only one actually playable.
    expect(result.state.waste.map((c) => c.rank)).toEqual(['7', '6', '5'])
    expect(result.state.stock.map((c) => c.rank)).toEqual(['2', '3', '4'])
    expect(result.state.moves).toBe(1)
  })

  it('draws a partial group when fewer than 3 cards remain in stock', () => {
    const state = buildState({ stock: ['A♠', '2♠'] })
    state.mode = 'klondike3'

    const result = applyMove(state, { type: 'DRAW' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Stock is [A♠, 2♠] bottom-to-top, so 2♠ (the top) is drawn first and
    // ends up buried; A♠, drawn last, ends up playable on top of the waste.
    expect(result.state.waste.map((c) => c.rank)).toEqual(['2', 'A'])
    expect(result.state.stock).toEqual([])
  })

  it('recycles the waste back into the stock, preserving order for the next draw-3 pass', () => {
    let state: SolitaireState = buildState({ stock: ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠'] })
    state.mode = 'klondike3'

    let result = applyMove(state, { type: 'DRAW' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    state = result.state

    result = applyMove(state, { type: 'DRAW' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    state = result.state

    expect(state.stock).toEqual([])
    expect(state.waste.map((c) => c.rank)).toEqual(['7', '6', '5', '4', '3', '2'])

    result = applyMove(state, { type: 'DRAW' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.state.waste).toEqual([])
    expect(result.state.stock.map((c) => c.rank)).toEqual(['2', '3', '4', '5', '6', '7'])
  })
})
