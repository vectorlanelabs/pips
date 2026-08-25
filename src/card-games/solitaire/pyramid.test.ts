import { describe, it, expect } from 'vitest'
import { createStandardDeck } from '../../card-engine/deck.ts'
import type { Card, Suit, Rank } from '../../card-engine/cards.ts'
import type { SolitaireState, SolitaireLoc } from './state.ts'
import { dealPyramid, applyPyramidMove, isExposed, pyramidLegalDestinations, pyramidKingMove, rankValue, PYRAMID_ROWS } from './pyramid.ts'

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
function buildState(spec: { rows?: (string | null)[][]; stock?: string[]; waste?: string[] }): SolitaireState {
  const parseCard = (s: string): Card => {
    const suitMap: Record<string, Suit> = { '♠': 'spades', '♣': 'clubs', '♥': 'hearts', '♦': 'diamonds' }
    const suit = Object.entries(suitMap).find(([sym]) => s.includes(sym))?.[1] || 'spades'
    const rank = s.replace(/[♠♣♥♦]/g, '').trim()
    return findCardInDeck(suit, rank as Rank)
  }

  const pyramidRows: (Card | null)[][] = []
  for (let row = 0; row < PYRAMID_ROWS; row++) {
    const specRow = spec.rows?.[row] ?? []
    const rowCards: (Card | null)[] = []
    for (let col = 0; col <= row; col++) {
      const cell = specRow[col]
      rowCards.push(cell ? parseCard(cell) : null)
    }
    pyramidRows.push(rowCards)
  }

  return {
    mode: 'pyramid',
    seed: 0,
    tableau: [],
    faceUp: [],
    foundations: [],
    stock: (spec.stock ?? []).map(parseCard),
    waste: (spec.waste ?? []).map(parseCard),
    cells: [],
    pyramidRows,
    moves: 0,
    won: false,
  }
}

describe('dealPyramid', () => {
  it('deals 7 rows of 1..7 cards and a 24-card stock', () => {
    const state = dealPyramid(42)
    expect(state.pyramidRows).toHaveLength(7)
    state.pyramidRows.forEach((row, i) => expect(row).toHaveLength(i + 1))
    expect(state.stock).toHaveLength(24)
    expect(state.waste).toEqual([])
    expect(state.won).toBe(false)
  })

  it('every card is unique and all 52 are accounted for', () => {
    const state = dealPyramid(7)
    const all = [...state.pyramidRows.flat(), ...state.stock]
    expect(all).toHaveLength(52)
    expect(new Set(all.map((c) => c!.id)).size).toBe(52)
  })

  it('same seed deals identically; different seed differs', () => {
    const a = dealPyramid(11)
    const b = dealPyramid(11)
    const c = dealPyramid(12)
    expect(a.pyramidRows).toEqual(b.pyramidRows)
    expect(a.pyramidRows).not.toEqual(c.pyramidRows)
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

describe('applyPyramidMove — REMOVE_KING', () => {
  it('removes an exposed King alone', () => {
    const state = buildState({ rows: [[], [], [], [], [], [], ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠', 'K♠']] })
    const result = applyPyramidMove(state, { type: 'REMOVE_KING', loc: { kind: 'pyramid', row: 6, col: 6 } })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.pyramidRows[6][6]).toBeNull()
      expect(result.state.moves).toBe(1)
    }
  })

  it('rejects a non-King', () => {
    const state = buildState({ rows: [[], [], [], [], [], [], ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠', '8♠']] })
    const result = applyPyramidMove(state, { type: 'REMOVE_KING', loc: { kind: 'pyramid', row: 6, col: 6 } })
    expect(result.ok).toBe(false)
  })

  it('rejects a King that is not exposed', () => {
    const state = buildState({ rows: [['K♠'], ['2♠', '3♠']] })
    const result = applyPyramidMove(state, { type: 'REMOVE_KING', loc: { kind: 'pyramid', row: 0, col: 0 } })
    expect(result.ok).toBe(false)
  })
})

describe('applyPyramidMove — REMOVE_PAIR', () => {
  it('removes two exposed cards summing to 13', () => {
    const state = buildState({ rows: [[], [], [], [], [], [], ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠', '8♠']] })
    const a: SolitaireLoc = { kind: 'pyramid', row: 6, col: 3 } // 5
    const b: SolitaireLoc = { kind: 'pyramid', row: 6, col: 6 } // 8 -> 5+8=13
    const result = applyPyramidMove(state, { type: 'REMOVE_PAIR', a, b })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.pyramidRows[6][3]).toBeNull()
      expect(result.state.pyramidRows[6][6]).toBeNull()
    }
  })

  it('rejects ranks that do not sum to 13', () => {
    const state = buildState({ rows: [[], [], [], [], [], [], ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠', '8♠']] })
    const result = applyPyramidMove(state, {
      type: 'REMOVE_PAIR',
      a: { kind: 'pyramid', row: 6, col: 0 },
      b: { kind: 'pyramid', row: 6, col: 1 },
    })
    expect(result.ok).toBe(false)
  })

  it('rejects pairing a location with itself', () => {
    const state = buildState({ rows: [[], [], [], [], [], [], ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠', '8♠']] })
    const loc: SolitaireLoc = { kind: 'pyramid', row: 6, col: 0 }
    const result = applyPyramidMove(state, { type: 'REMOVE_PAIR', a: loc, b: loc })
    expect(result.ok).toBe(false)
  })

  it('rejects a pair where one card is not exposed', () => {
    const state = buildState({ rows: [['A♠'], ['2♠', 'Q♠']] })
    // A♠(1) + Q♠(12) = 13, but row0's card rests on both row1 cards, neither removed yet
    const result = applyPyramidMove(state, {
      type: 'REMOVE_PAIR',
      a: { kind: 'pyramid', row: 0, col: 0 },
      b: { kind: 'pyramid', row: 1, col: 1 },
    })
    expect(result.ok).toBe(false)
  })

  it('allows pairing the waste top with an exposed pyramid card', () => {
    const state = buildState({ rows: [[], [], [], [], [], [], ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠', '8♠']], waste: ['9♠'] })
    const result = applyPyramidMove(state, {
      type: 'REMOVE_PAIR',
      a: { kind: 'waste' },
      b: { kind: 'pyramid', row: 6, col: 2 }, // 4♠, 4+9=13
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.waste).toEqual([])
      expect(result.state.pyramidRows[6][2]).toBeNull()
    }
  })
})

describe('applyPyramidMove — DRAW', () => {
  it('moves the top stock card to the waste', () => {
    const state = buildState({ stock: ['5♠', '9♠'] })
    const result = applyPyramidMove(state, { type: 'DRAW' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.waste.map((c) => c.rank)).toEqual(['9'])
      expect(result.state.stock).toHaveLength(1)
    }
  })

  it('reshuffles the waste back into the stock when the stock is empty', () => {
    const state = buildState({ waste: ['5♠', '9♠'] })
    const result = applyPyramidMove(state, { type: 'DRAW' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.waste).toEqual([])
      expect(result.state.stock).toHaveLength(2)
    }
  })

  it('rejects drawing when both stock and waste are empty', () => {
    const result = applyPyramidMove(buildState({}), { type: 'DRAW' })
    expect(result.ok).toBe(false)
  })
})

describe('win condition', () => {
  it('is won once every pyramid slot is null', () => {
    const withKing = buildState({ rows: [['K♠']] })
    const result = applyPyramidMove(withKing, { type: 'REMOVE_KING', loc: { kind: 'pyramid', row: 0, col: 0 } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.state.won).toBe(true)
  })
})

describe('pyramidLegalDestinations', () => {
  it('lists only exposed locations that sum to 13 with the given card', () => {
    const state = buildState({
      rows: [[], [], [], [], [], [], ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠', '8♠']],
      waste: ['9♠'],
    })
    const partners = pyramidLegalDestinations(state, { kind: 'pyramid', row: 6, col: 2 }) // 4♠, needs 9
    expect(partners).toEqual([{ kind: 'waste' }])
  })

  it('returns nothing for a King (no partner exists)', () => {
    const state = buildState({ rows: [[], [], [], [], [], [], ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠', 'K♠']] })
    expect(pyramidLegalDestinations(state, { kind: 'pyramid', row: 6, col: 6 })).toEqual([])
  })

  it('returns nothing for a card that is not exposed', () => {
    const state = buildState({ rows: [['A♠'], ['2♠', 'Q♠']] })
    expect(pyramidLegalDestinations(state, { kind: 'pyramid', row: 0, col: 0 })).toEqual([])
  })

  it('excludes the waste from its own destination list — no self-pairing', () => {
    const state = buildState({
      rows: [[], [], [], [], [], [], ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠', '8♠']],
      waste: ['9♠'],
    })
    // Querying FROM the waste itself: the pyramid's exposed 4♠ (9+4=13) is a
    // legal partner, but the waste slot must never appear as its own
    // destination even though locKey-wise a waste `loc` and a waste
    // destination are indistinguishable.
    const dests = pyramidLegalDestinations(state, { kind: 'waste' })
    expect(dests).toEqual([{ kind: 'pyramid', row: 6, col: 2 }])
    expect(dests.some((d) => d.kind === 'waste')).toBe(false)
  })
})

describe('applyPyramidMove — won guard', () => {
  it('rejects REMOVE_PAIR once the game is already won', () => {
    const state = buildState({ rows: [[], [], [], [], [], [], ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠', '8♠']] })
    state.won = true

    const result = applyPyramidMove(state, {
      type: 'REMOVE_PAIR',
      a: { kind: 'pyramid', row: 6, col: 0 },
      b: { kind: 'pyramid', row: 6, col: 6 },
    })
    expect(result.ok).toBe(false)
  })

  it('rejects REMOVE_KING once the game is already won', () => {
    const state = buildState({ rows: [['K♠']] })
    state.won = true

    const result = applyPyramidMove(state, { type: 'REMOVE_KING', loc: { kind: 'pyramid', row: 0, col: 0 } })
    expect(result.ok).toBe(false)
  })

  it('rejects DRAW once the game is already won', () => {
    const state = buildState({ stock: ['5♠'] })
    state.won = true

    const result = applyPyramidMove(state, { type: 'DRAW' })
    expect(result.ok).toBe(false)
  })
})

describe('full pyramid clear (28-card win through sequential removals)', () => {
  it('wins by clearing every row bottom-to-top with real REMOVE_KING/REMOVE_PAIR moves', () => {
    // Built so each row's cards resolve into pairs summing to 13, with one
    // King per "odd" row taking the leftover slot. Rows are cleared bottom
    // (row 6) to top (row 0): a row only becomes exposed once the ENTIRE
    // row below it is gone, so clearing strictly in this order is always
    // legal, and by the time row 0's lone King is removed every card in
    // the 28-card pyramid has actually been accounted for.
    const state = buildState({
      rows: [
        ['K♣'],
        ['3♣', '10♣'],
        ['3♦', '10♦', 'K♦'],
        ['3♠', '10♠', '3♥', '10♥'],
        ['2♦', 'J♦', '2♣', 'J♣', 'K♥'],
        ['A♣', 'Q♣', '2♠', 'J♠', '2♥', 'J♥'],
        ['A♠', 'Q♠', 'A♥', 'Q♥', 'A♦', 'Q♦', 'K♠'],
      ],
    })

    const kingMove = (row: number, col: number) =>
      ({ type: 'REMOVE_KING' as const, loc: { kind: 'pyramid' as const, row, col } })
    const pairMove = (row: number, c1: number, c2: number) =>
      ({
        type: 'REMOVE_PAIR' as const,
        a: { kind: 'pyramid' as const, row, col: c1 },
        b: { kind: 'pyramid' as const, row, col: c2 },
      })

    const moves = [
      // row 6 (base, always exposed): 3 pairs + 1 King
      pairMove(6, 0, 1), pairMove(6, 2, 3), pairMove(6, 4, 5), kingMove(6, 6),
      // row 5, now fully exposed: 3 pairs
      pairMove(5, 0, 1), pairMove(5, 2, 3), pairMove(5, 4, 5),
      // row 4: 2 pairs + 1 King
      pairMove(4, 0, 1), pairMove(4, 2, 3), kingMove(4, 4),
      // row 3: 2 pairs
      pairMove(3, 0, 1), pairMove(3, 2, 3),
      // row 2: 1 pair + 1 King
      pairMove(2, 0, 1), kingMove(2, 2),
      // row 1: 1 pair
      pairMove(1, 0, 1),
      // row 0: the last King
      kingMove(0, 0),
    ]

    let current = state
    for (const move of moves) {
      const outcome = applyPyramidMove(current, move)
      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return
      current = outcome.state
    }

    expect(current.pyramidRows.flat().every((c) => c === null)).toBe(true)
    expect(current.won).toBe(true)
    expect(current.moves).toBe(moves.length)
  })
})

describe('pyramidKingMove', () => {
  it('returns the REMOVE_KING move for an exposed King', () => {
    const state = buildState({ rows: [[], [], [], [], [], [], ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠', 'K♠']] })
    const loc: SolitaireLoc = { kind: 'pyramid', row: 6, col: 6 }
    expect(pyramidKingMove(state, loc)).toEqual({ type: 'REMOVE_KING', loc })
  })

  it('returns null for a non-King or a King that is not exposed', () => {
    const state = buildState({ rows: [['K♠'], ['2♠', '3♠']] })
    expect(pyramidKingMove(state, { kind: 'pyramid', row: 0, col: 0 })).toBeNull()
    expect(pyramidKingMove(state, { kind: 'pyramid', row: 1, col: 0 })).toBeNull()
  })
})
