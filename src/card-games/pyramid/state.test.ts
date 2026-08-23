import { describe, it, expect } from 'vitest'
import { createStandardDeck } from '../../card-engine/deck.ts'
import type { Card, Suit, Rank } from '../../card-engine/cards.ts'
import type { PyramidState, PyramidLoc } from './state.ts'
import { dealPyramid, applyMove, isExposed, legalPartners, rankValue, PYRAMID_ROWS } from './state.ts'

function findCardInDeck(suit: Suit, rank: Rank): Card {
  const deck = createStandardDeck()
  const card = deck.find((c) => c.suit === suit && c.rank === rank)
  if (!card) throw new Error(`Card not found: ${rank}${suit}`)
  return card
}

// Builds a state from a flat list of rank specs like '7♠', filled row by row
// (row 0 = 1 slot, row 1 = 2 slots, ... row 6 = 7 slots). Any unspecified
// trailing slots are left null (already removed) so tests can set up partial
// pyramids without listing all 28 cards.
function buildState(spec: { rows?: (string | null)[][]; stock?: string[]; waste?: string[] }): PyramidState {
  const parseCard = (s: string): Card => {
    const suitMap: Record<string, Suit> = { '♠': 'spades', '♣': 'clubs', '♥': 'hearts', '♦': 'diamonds' }
    const suit = Object.entries(suitMap).find(([sym]) => s.includes(sym))?.[1] || 'spades'
    const rank = s.replace(/[♠♣♥♦]/g, '').trim()
    return findCardInDeck(suit, rank as Rank)
  }

  const pyramid: (Card | null)[][] = []
  for (let row = 0; row < PYRAMID_ROWS; row++) {
    const specRow = spec.rows?.[row] ?? []
    const rowCards: (Card | null)[] = []
    for (let col = 0; col <= row; col++) {
      const cell = specRow[col]
      rowCards.push(cell ? parseCard(cell) : null)
    }
    pyramid.push(rowCards)
  }

  return {
    seed: 0,
    pyramid,
    stock: (spec.stock ?? []).map(parseCard),
    waste: (spec.waste ?? []).map(parseCard),
    moves: 0,
    won: false,
  }
}

describe('dealPyramid', () => {
  it('deals 7 rows of 1..7 cards and a 24-card stock', () => {
    const state = dealPyramid(42)
    expect(state.pyramid).toHaveLength(7)
    state.pyramid.forEach((row, i) => expect(row).toHaveLength(i + 1))
    expect(state.stock).toHaveLength(24)
    expect(state.waste).toEqual([])
    expect(state.won).toBe(false)
  })

  it('every card is unique and all 52 are accounted for', () => {
    const state = dealPyramid(7)
    const all = [...state.pyramid.flat(), ...state.stock]
    expect(all).toHaveLength(52)
    expect(new Set(all.map((c) => c!.id)).size).toBe(52)
  })

  it('same seed deals identically; different seed differs', () => {
    const a = dealPyramid(11)
    const b = dealPyramid(11)
    const c = dealPyramid(12)
    expect(a.pyramid).toEqual(b.pyramid)
    expect(a.pyramid).not.toEqual(c.pyramid)
  })
})

describe('rankValue', () => {
  it('A=1, numeric ranks match, J=11, Q=12, K=13', () => {
    expect(rankValue('A')).toBe(1)
    expect(rankValue('7')).toBe(7)
    expect(rankValue('10')).toBe(10)
    expect(rankValue('J')).toBe(11)
    expect(rankValue('Q')).toBe(12)
    expect(rankValue('K')).toBe(13)
  })
})

describe('isExposed', () => {
  it('the base row is always exposed', () => {
    const state = buildState({ rows: [[], [], [], [], [], [], ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠', '8♠']] })
    for (let col = 0; col < 7; col++) {
      expect(isExposed(state, { kind: 'pyramid', row: 6, col })).toBe(true)
    }
  })

  it('a higher card is exposed only once both cards it rests on are removed', () => {
    const state = buildState({ rows: [['A♠'], ['2♠', '3♠']] })
    expect(isExposed(state, { kind: 'pyramid', row: 0, col: 0 })).toBe(false)

    const halfCleared = buildState({ rows: [['A♠'], ['2♠', null]] })
    expect(isExposed(halfCleared, { kind: 'pyramid', row: 0, col: 0 })).toBe(false)

    const cleared = buildState({ rows: [['A♠'], [null, null]] })
    expect(isExposed(cleared, { kind: 'pyramid', row: 0, col: 0 })).toBe(true)
  })

  it('an already-removed slot is not exposed', () => {
    const state = buildState({ rows: [[null]] })
    expect(isExposed(state, { kind: 'pyramid', row: 0, col: 0 })).toBe(false)
  })

  it('waste is exposed only when it has a card', () => {
    expect(isExposed(buildState({ waste: ['5♠'] }), { kind: 'waste' })).toBe(true)
    expect(isExposed(buildState({}), { kind: 'waste' })).toBe(false)
  })
})

describe('applyMove — REMOVE_KING', () => {
  it('removes an exposed King alone', () => {
    const state = buildState({ rows: [[], [], [], [], [], [], ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠', 'K♠']] })
    const result = applyMove(state, { type: 'REMOVE_KING', loc: { kind: 'pyramid', row: 6, col: 6 } })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.pyramid[6][6]).toBeNull()
      expect(result.state.moves).toBe(1)
    }
  })

  it('rejects a non-King', () => {
    const state = buildState({ rows: [[], [], [], [], [], [], ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠', '8♠']] })
    const result = applyMove(state, { type: 'REMOVE_KING', loc: { kind: 'pyramid', row: 6, col: 6 } })
    expect(result.ok).toBe(false)
  })

  it('rejects a King that is not exposed', () => {
    const state = buildState({ rows: [['K♠'], ['2♠', '3♠']] })
    const result = applyMove(state, { type: 'REMOVE_KING', loc: { kind: 'pyramid', row: 0, col: 0 } })
    expect(result.ok).toBe(false)
  })
})

describe('applyMove — REMOVE_PAIR', () => {
  it('removes two exposed cards summing to 13', () => {
    const state = buildState({ rows: [[], [], [], [], [], [], ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠', '8♠']] })
    const a: PyramidLoc = { kind: 'pyramid', row: 6, col: 3 } // 5
    const b: PyramidLoc = { kind: 'pyramid', row: 6, col: 6 } // 8 -> 5+8=13
    const result = applyMove(state, { type: 'REMOVE_PAIR', a, b })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.pyramid[6][3]).toBeNull()
      expect(result.state.pyramid[6][6]).toBeNull()
    }
  })

  it('rejects ranks that do not sum to 13', () => {
    const state = buildState({ rows: [[], [], [], [], [], [], ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠', '8♠']] })
    const result = applyMove(state, {
      type: 'REMOVE_PAIR',
      a: { kind: 'pyramid', row: 6, col: 0 },
      b: { kind: 'pyramid', row: 6, col: 1 },
    })
    expect(result.ok).toBe(false)
  })

  it('rejects pairing a location with itself', () => {
    const state = buildState({ rows: [[], [], [], [], [], [], ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠', '8♠']] })
    const loc: PyramidLoc = { kind: 'pyramid', row: 6, col: 0 }
    const result = applyMove(state, { type: 'REMOVE_PAIR', a: loc, b: loc })
    expect(result.ok).toBe(false)
  })

  it('rejects a pair where one card is not exposed', () => {
    const state = buildState({ rows: [['A♠'], ['2♠', 'Q♠']] })
    // A♠(1) + Q♠(12) = 13, but row0's card rests on both row1 cards, neither removed yet
    const result = applyMove(state, {
      type: 'REMOVE_PAIR',
      a: { kind: 'pyramid', row: 0, col: 0 },
      b: { kind: 'pyramid', row: 1, col: 1 },
    })
    expect(result.ok).toBe(false)
  })

  it('allows pairing the waste top with an exposed pyramid card', () => {
    const state = buildState({ rows: [[], [], [], [], [], [], ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠', '8♠']], waste: ['9♠'] })
    // 8♠(8) + 9♠? wait 8+? need sum13, waste is 9 -> need pyramid card of 4
    const result = applyMove(state, {
      type: 'REMOVE_PAIR',
      a: { kind: 'waste' },
      b: { kind: 'pyramid', row: 6, col: 2 }, // 4♠
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.waste).toEqual([])
      expect(result.state.pyramid[6][2]).toBeNull()
    }
  })
})

describe('applyMove — DRAW', () => {
  it('moves the top stock card to the waste', () => {
    const state = buildState({ stock: ['5♠', '9♠'] })
    const result = applyMove(state, { type: 'DRAW' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.waste.map((c) => c.rank)).toEqual(['9'])
      expect(result.state.stock).toHaveLength(1)
    }
  })

  it('reshuffles the waste back into the stock when the stock is empty', () => {
    const state = buildState({ waste: ['5♠', '9♠'] })
    const result = applyMove(state, { type: 'DRAW' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.waste).toEqual([])
      expect(result.state.stock).toHaveLength(2)
    }
  })

  it('rejects drawing when both stock and waste are empty', () => {
    const result = applyMove(buildState({}), { type: 'DRAW' })
    expect(result.ok).toBe(false)
  })
})

describe('win condition', () => {
  it('is won once every pyramid slot is null', () => {
    const withKing = buildState({ rows: [['K♠']] })
    const result = applyMove(withKing, { type: 'REMOVE_KING', loc: { kind: 'pyramid', row: 0, col: 0 } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.state.won).toBe(true)
  })
})

describe('legalPartners', () => {
  it('lists only exposed locations that sum to 13 with the given card', () => {
    const state = buildState({
      rows: [[], [], [], [], [], [], ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠', '8♠']],
      waste: ['9♠'],
    })
    const partners = legalPartners(state, { kind: 'pyramid', row: 6, col: 2 }) // 4♠, needs 9
    expect(partners).toEqual([{ kind: 'waste' }])
  })

  it('returns nothing for a King (no partner exists)', () => {
    const state = buildState({ rows: [[], [], [], [], [], [], ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠', 'K♠']] })
    expect(legalPartners(state, { kind: 'pyramid', row: 6, col: 6 })).toEqual([])
  })

  it('returns nothing for a card that is not exposed', () => {
    const state = buildState({ rows: [['A♠'], ['2♠', 'Q♠']] })
    expect(legalPartners(state, { kind: 'pyramid', row: 0, col: 0 })).toEqual([])
  })
})
