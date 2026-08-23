import { describe, it, expect } from 'vitest'
import { createStandardDeck } from '../../card-engine/deck.ts'
import type { Card, Suit, Rank } from '../../card-engine/cards.ts'
import type { SolitaireState } from './state.ts'
import { createSolitaireGame } from './state.ts'
import { applyMove } from './shared.ts'
import { maxMovableCards } from './freecell.ts'

// Helper to find a card by suit and rank in the standard deck
function findCardInDeck(suit: Suit, rank: Rank): Card {
  const deck = createStandardDeck()
  const card = deck.find((c) => c.suit === suit && c.rank === rank)
  if (!card) throw new Error(`Card not found: ${rank}${suit}`)
  return card
}

// Helper to build a constructed state from short specs
function buildState(spec: {
  tableau?: string[][]
  cells?: (string | null)[]
  foundations?: Record<string, string[]>
}): SolitaireState {
  const state: SolitaireState = {
    mode: 'freecell',
    seed: 0,
    tableau: [[], [], [], [], [], [], [], []],
    faceUp: [0, 0, 0, 0, 0, 0, 0, 0],
    foundations: [[], [], [], []],
    stock: [],
    waste: [],
    cells: [null, null, null, null],
    pyramidRows: [],
    moves: 0,
    won: false,
  }

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

  if (spec.cells) {
    for (let i = 0; i < spec.cells.length; i++) {
      state.cells[i] = spec.cells[i] === null ? null : parseCard(spec.cells[i]!)
    }
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

describe('FreeCell', () => {
  it('deal shape', () => {
    const state = createSolitaireGame('freecell', 12345)

    // 8 columns
    expect(state.tableau.length).toBe(8)

    // Lengths: 7,7,7,7,6,6,6,6
    expect(state.tableau[0].length).toBe(7)
    expect(state.tableau[1].length).toBe(7)
    expect(state.tableau[2].length).toBe(7)
    expect(state.tableau[3].length).toBe(7)
    expect(state.tableau[4].length).toBe(6)
    expect(state.tableau[5].length).toBe(6)
    expect(state.tableau[6].length).toBe(6)
    expect(state.tableau[7].length).toBe(6)

    // faceUp equals lengths
    for (let i = 0; i < 8; i++) {
      expect(state.faceUp[i]).toBe(state.tableau[i].length)
    }

    // stock/waste empty
    expect(state.stock).toEqual([])
    expect(state.waste).toEqual([])

    // 4 null cells
    expect(state.cells).toEqual([null, null, null, null])

    // 52 unique ids
    const allCards = state.tableau.flat()
    const ids = new Set(allCards.map((c) => c.id))
    expect(ids.size).toBe(52)

    // mode, moves, won
    expect(state.mode).toBe('freecell')
    expect(state.moves).toBe(0)
    expect(state.won).toBe(false)

    // foundations empty
    expect(state.foundations).toEqual([[], [], [], []])
  })

  it('same seed → deep-equal state', () => {
    const state1 = createSolitaireGame('freecell', 999)
    const state2 = createSolitaireGame('freecell', 999)

    expect(JSON.parse(JSON.stringify(state1))).toEqual(JSON.parse(JSON.stringify(state2)))
  })

  it('different seed → different tableau', () => {
    const state1 = createSolitaireGame('freecell', 111)
    const state2 = createSolitaireGame('freecell', 222)

    expect(state1.tableau[0][0].id).not.toBe(state2.tableau[0][0].id)
  })

  it('DRAW rejected in freecell', () => {
    const state = createSolitaireGame('freecell', 12345)

    const result = applyMove(state, { type: 'DRAW' })
    expect(result.ok).toBe(false)
  })

  it('tableau → empty cell accepted', () => {
    const state = buildState({
      tableau: [
        ['K♠'],
      ],
      cells: [null, null, null, null],
    })

    const result = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 0 },
      to: { kind: 'cell', index: 0 },
      count: 1,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.cells[0]).toEqual(findCardInDeck('spades', 'K'))
  })

  it('tableau → occupied cell rejected', () => {
    const state = buildState({
      tableau: [
        ['K♠'],
      ],
      cells: ['Q♥', null, null, null],
    })

    const result = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 0 },
      to: { kind: 'cell', index: 0 },
      count: 1,
    })

    expect(result.ok).toBe(false)
  })

  it('count 2 → cell rejected', () => {
    const state = buildState({
      tableau: [
        ['Q♥', 'K♠'],
      ],
      cells: [null, null, null, null],
    })

    const result = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 0 },
      to: { kind: 'cell', index: 0 },
      count: 2,
    })

    expect(result.ok).toBe(false)
  })

  it('cell → tableau accepted when stackable', () => {
    const state = buildState({
      tableau: [
        ['K♠'],
      ],
      cells: ['Q♥', null, null, null],
    })

    const result = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'cell', index: 0 },
      to: { kind: 'tableau', index: 0 },
      count: 1,
    })

    expect(result.ok).toBe(true)
  })

  it('cell → foundation accepted for an Ace', () => {
    const state = buildState({
      cells: ['A♠', null, null, null],
    })

    const result = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'cell', index: 0 },
      to: { kind: 'foundation', index: 3 },
      count: 1,
    })

    expect(result.ok).toBe(true)
  })

  it('any single card onto an empty column is accepted', () => {
    const state = buildState({
      tableau: [
        ['Q♥'],
        [],
      ],
    })

    const result = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 0 },
      to: { kind: 'tableau', index: 1 },
      count: 1,
    })

    expect(result.ok).toBe(true)
  })

  it('supermove cap: 0 empty cells and 0 empty columns, 2-card run rejected', () => {
    const state = buildState({
      tableau: [
        ['K♠', 'Q♥'],
        ['J♠'],
        Array(6).fill('A♣'),
        Array(6).fill('A♦'),
        Array(6).fill('A♥'),
        Array(6).fill('A♠'),
        Array(6).fill('2♣'),
        Array(6).fill('2♦'),
      ],
      cells: ['3♣', '3♦', '3♥', '3♠'],
    })

    const result = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 0 },
      to: { kind: 'tableau', index: 1 },
      count: 2,
    })

    expect(result.ok).toBe(false)
  })

  it('supermove cap: 1 empty cell, 2-card run accepted', () => {
    const state = buildState({
      tableau: [
        ['J♠', '10♥'],
        ['Q♦'],
        Array(7).fill('A♣'),
        Array(7).fill('A♦'),
        Array(7).fill('A♥'),
        Array(7).fill('A♠'),
        Array(6).fill('2♣'),
        Array(6).fill('2♦'),
      ],
      cells: [null, '3♦', '3♥', '3♠'],
    })

    const result = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 0 },
      to: { kind: 'tableau', index: 1 },
      count: 2,
    })

    expect(result.ok).toBe(true)
  })

  it('supermove cap: 1 empty cell, 1 other empty column, 4-card run accepted', () => {
    const state = buildState({
      tableau: [
        ['J♠', '10♥', '9♣', '8♦'],
        ['Q♦'],
        [],
        Array(7).fill('A♣'),
        Array(7).fill('A♥'),
        Array(7).fill('A♠'),
        Array(6).fill('2♣'),
        Array(6).fill('2♠'),
      ],
      cells: [null, '3♦', '3♥', '3♠'],
    })

    const result = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 0 },
      to: { kind: 'tableau', index: 1 },
      count: 4,
    })

    expect(result.ok).toBe(true)
  })

  it('supermove cap: 1 empty cell, 1 other empty column, 5-card run rejected', () => {
    const state = buildState({
      tableau: [
        ['K♠', 'Q♥', 'J♣', '10♦', '9♠'],
        ['8♥'],
        [],
        Array(6).fill('A♣'),
        Array(6).fill('A♦'),
        Array(6).fill('A♥'),
        Array(6).fill('A♠'),
        Array(6).fill('2♣'),
      ],
      cells: [null, '3♦', '3♥', '3♠'],
    })

    const result = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 0 },
      to: { kind: 'tableau', index: 1 },
      count: 5,
    })

    expect(result.ok).toBe(false)
  })

  it('supermove cap: moving 3-card run onto empty column with 1 empty cell, no other empty columns rejected', () => {
    const state = buildState({
      tableau: [
        ['K♠', 'Q♥', 'J♣'],
        Array(7).fill('10♦'),
        Array(7).fill('9♠'),
        Array(7).fill('8♥'),
        Array(6).fill('A♣'),
        Array(6).fill('A♦'),
        Array(6).fill('A♥'),
        [],
      ],
      cells: [null, '3♦', '3♥', '3♠'],
    })

    const result = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 0 },
      to: { kind: 'tableau', index: 7 },
      count: 3,
    })

    // Destination is empty, so we count 1 empty cell (1 null) and 0 other empty columns
    // Cap is (1 + 1) * 2^0 = 2, so 3-card run is rejected
    expect(result.ok).toBe(false)
  })

  it('supermove cap: moving 2-card run onto empty column with 1 empty cell, no other empty columns accepted', () => {
    const state = buildState({
      tableau: [
        ['K♠', 'Q♥'],
        Array(7).fill('10♦'),
        Array(7).fill('9♠'),
        Array(7).fill('8♥'),
        Array(6).fill('A♣'),
        Array(6).fill('A♦'),
        Array(6).fill('A♥'),
        [],
      ],
      cells: [null, '3♦', '3♥', '3♠'],
    })

    const result = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 0 },
      to: { kind: 'tableau', index: 7 },
      count: 2,
    })

    // Cap is (1 + 1) * 2^0 = 2, so 2-card run is accepted
    expect(result.ok).toBe(true)
  })

  it('maxMovableCards with various states', () => {
    const state = buildState({
      tableau: [
        ['K♠'],
        Array(6).fill('A♣'),
        Array(6).fill('A♦'),
        Array(6).fill('A♥'),
        Array(6).fill('A♠'),
        Array(6).fill('2♣'),
        Array(6).fill('2♦'),
        [],
      ],
      cells: [null, '3♦', '3♥', '3♠'],
    })

    // 1 empty cell, 1 other empty column (tableau[7], not counting source), toEmptyColumn=false
    // Cap: (1 + 1) * 2^1 = 4
    const cap1 = maxMovableCards(state, false)
    expect(cap1).toBe(4)

    // toEmptyColumn=true, 0 empty columns (after excluding destination)
    // Cap: (1 + 1) * 2^0 = 2
    const cap2 = maxMovableCards(state, true)
    expect(cap2).toBe(2)
  })

  it('faceUp[i] === tableau[i].length after moves', () => {
    let state = buildState({
      tableau: [
        ['K♠', 'Q♥'],
        ['K♦'],
      ],
    })

    // Verify initial state
    for (let i = 0; i < 8; i++) {
      expect(state.faceUp[i]).toBe(state.tableau[i].length)
    }

    // Move Q♥ to K♣ (Q is one rank lower than K, opposite color)
    // Note: K♦ is in tableau[1], so use a different card for the destination
    state = buildState({
      tableau: [
        ['K♠', 'Q♥'],
        ['K♣'],
      ],
    })

    const result = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 0 },
      to: { kind: 'tableau', index: 1 },
      count: 1,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    state = result.state

    // Verify faceUp still matches length
    for (let i = 0; i < 8; i++) {
      expect(state.faceUp[i]).toBe(state.tableau[i].length)
    }
  })

  it('win detection', () => {
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

  it('non-integer cell index is rejected, never thrown', () => {
    const state = createSolitaireGame('freecell', 12345)

    const result = applyMove(state, {
      type: 'MOVE',
      from: { kind: 'tableau', index: 0 },
      to: { kind: 'cell', index: 1.5 },
      count: 1,
    })
    expect(result.ok).toBe(false)
  })
})
