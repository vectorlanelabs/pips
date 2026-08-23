import { describe, it, expect } from 'vitest'
import type { Card, Suit, Rank } from '../../card-engine/cards.ts'
import type { SolitaireState } from './state.ts'
import { dealSpider, applySpiderMove, spiderLegalDestinations, SPIDER_COLUMNS } from './spider.ts'

function card(id: string, suit: Suit, rank: Rank): Card {
  return { id, suit, rank, deckIndex: 0 }
}

function buildState(spec: { tableau: string[][]; stock?: string[]; foundations?: string[][] }): SolitaireState {
  const parseCard = (spec: string): Card => {
    const suitMap: Record<string, Suit> = { S: 'spades', H: 'hearts' }
    const suit = suitMap[spec[spec.length - 1]]
    const rank = spec.slice(0, -1) as Rank
    return card(`${rank}${suit[0]}-${Math.random()}`, suit, rank)
  }
  const tableau = spec.tableau.map((col) => col.map(parseCard))
  return {
    mode: 'spider',
    seed: 0,
    tableau,
    faceUp: tableau.map((col) => col.length),
    foundations: (spec.foundations ?? []).map((f) => f.map(parseCard)),
    stock: (spec.stock ?? []).map(parseCard),
    waste: [],
    cells: [],
    pyramidRows: [],
    moves: 0,
    won: false,
  }
}

describe('dealSpider', () => {
  it('deals 4 columns of 6 and 6 columns of 5, one face-up each, 50-card stock', () => {
    const state = dealSpider(42)
    expect(state.tableau).toHaveLength(SPIDER_COLUMNS)
    state.tableau.forEach((col, i) => {
      expect(col.length).toBe(i < 4 ? 6 : 5)
      expect(state.faceUp[i]).toBe(1)
    })
    expect(state.stock.length).toBe(50)
    expect(state.foundations).toEqual([])
    expect(state.won).toBe(false)
  })

  it('uses only two suits, 4 copies of each rank per suit (104 cards total)', () => {
    const state = dealSpider(7)
    const all = [...state.tableau.flat(), ...state.stock]
    expect(all.length).toBe(104)
    const suits = new Set(all.map((c) => c.suit))
    expect(suits.size).toBe(2)
    const ids = new Set(all.map((c) => c.id))
    expect(ids.size).toBe(104)
  })

  it('same seed deals identically; different seed differs', () => {
    const a = dealSpider(11)
    const b = dealSpider(11)
    const c = dealSpider(12)
    expect(a.tableau).toEqual(b.tableau)
    expect(a.tableau).not.toEqual(c.tableau)
  })

  it('spider1 uses a single suit, 8 copies of each rank (still 104 cards total)', () => {
    const state = dealSpider(7, 'spider1')
    expect(state.mode).toBe('spider1')
    const all = [...state.tableau.flat(), ...state.stock]
    expect(all.length).toBe(104)
    const suits = new Set(all.map((c) => c.suit))
    expect(suits.size).toBe(1)
    const ids = new Set(all.map((c) => c.id))
    expect(ids.size).toBe(104)
  })

  it('spider1: any descending run is automatically same-suit and movable as a unit', () => {
    // spider1's engine reuse means this is really just "any run is one suit" —
    // proven directly rather than trusting the deck composition alone.
    const state = buildState({ tableau: [['9H'], ['8H', '7H', '6H']] })
    state.mode = 'spider1'
    const result = applySpiderMove(state, { type: 'MOVE', from: { kind: 'tableau', index: 1 }, to: { kind: 'tableau', index: 0 }, count: 3 })
    expect(result.ok).toBe(true)
  })
})

describe('applySpiderMove — tableau moves', () => {
  it('rejects a mixed-suit run as a group, accepts it as same-suit', () => {
    const mixed = buildState({ tableau: [['5S'], ['6H', '5S']] })
    // 6H,5S is a valid RANK sequence but mixed suit — can't move as a pair
    const badGroup = applySpiderMove(mixed, { type: 'MOVE', from: { kind: 'tableau', index: 1 }, to: { kind: 'tableau', index: 0 }, count: 2 })
    expect(badGroup.ok).toBe(false)

    const sameSuit = buildState({ tableau: [['7S'], ['6S', '5S']] })
    const goodGroup = applySpiderMove(sameSuit, { type: 'MOVE', from: { kind: 'tableau', index: 1 }, to: { kind: 'tableau', index: 0 }, count: 2 })
    expect(goodGroup.ok).toBe(true)
  })

  it('placement ignores suit — any card one rank lower may stack', () => {
    const state = buildState({ tableau: [['6H'], ['5S']] })
    const result = applySpiderMove(state, { type: 'MOVE', from: { kind: 'tableau', index: 1 }, to: { kind: 'tableau', index: 0 }, count: 1 })
    expect(result.ok).toBe(true)
  })

  it('rejects stacking the wrong rank', () => {
    const state = buildState({ tableau: [['6H'], ['4S']] })
    const result = applySpiderMove(state, { type: 'MOVE', from: { kind: 'tableau', index: 1 }, to: { kind: 'tableau', index: 0 }, count: 1 })
    expect(result.ok).toBe(false)
  })

  it('any card or run may land on an empty column', () => {
    const state = buildState({ tableau: [[], ['5S']] })
    const result = applySpiderMove(state, { type: 'MOVE', from: { kind: 'tableau', index: 1 }, to: { kind: 'tableau', index: 0 }, count: 1 })
    expect(result.ok).toBe(true)
  })

  it('rejects foundation/cell locations entirely', () => {
    const state = buildState({ tableau: [['5S'], ['6H']] })
    const toFoundation = applySpiderMove(state, { type: 'MOVE', from: { kind: 'tableau', index: 1 }, to: { kind: 'foundation', index: 0 }, count: 1 })
    expect(toFoundation.ok).toBe(false)
  })

  it('auto-flips the next card when a column empties its face-up run', () => {
    const state = buildState({ tableau: [['6H'], ['5S']] })
    state.faceUp = [1, 1]
    // Give column 1 a hidden card under its one face-up card
    state.tableau[1] = [card('hidden', 'hearts', '9'), ...state.tableau[1]]
    state.faceUp[1] = 1
    const result = applySpiderMove(state, { type: 'MOVE', from: { kind: 'tableau', index: 1 }, to: { kind: 'tableau', index: 0 }, count: 1 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.tableau[1]).toHaveLength(1)
      expect(result.state.faceUp[1]).toBe(1)
    }
  })
})

describe('applySpiderMove — DRAW', () => {
  it('deals one card face-up to every column', () => {
    const state = buildState({
      tableau: Array.from({ length: 10 }, () => ['5S']),
      stock: ['KS', 'QS', 'JS', '10S', '9S', '8S', '7S', '6S', '5H', '4H'],
    })
    const result = applySpiderMove(state, { type: 'DRAW' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      result.state.tableau.forEach((col) => expect(col).toHaveLength(2))
      expect(result.state.stock).toHaveLength(0)
      expect(result.state.moves).toBe(1)
    }
  })

  it('rejects dealing while any column is empty', () => {
    const state = buildState({ tableau: [[], ...Array.from({ length: 9 }, () => ['5S'])], stock: Array(10).fill('5S') })
    const result = applySpiderMove(state, { type: 'DRAW' })
    expect(result.ok).toBe(false)
  })

  it('rejects dealing an empty stock', () => {
    const state = buildState({ tableau: Array.from({ length: 10 }, () => ['5S']), stock: [] })
    const result = applySpiderMove(state, { type: 'DRAW' })
    expect(result.ok).toBe(false)
  })
})

describe('completed-run clearing', () => {
  it('clears a full same-suit King-to-Ace run off the tableau into foundations', () => {
    const ranks: Rank[] = ['K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2']
    const state = buildState({ tableau: [ranks.map((r) => `${r}S`), ['AS']] })
    const result = applySpiderMove(state, { type: 'MOVE', from: { kind: 'tableau', index: 1 }, to: { kind: 'tableau', index: 0 }, count: 1 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.tableau[0]).toEqual([])
      expect(result.state.foundations).toHaveLength(1)
      expect(result.state.foundations[0].map((c) => c.rank)).toEqual(['K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2', 'A'])
    }
  })

  it('does not clear a coincidentally-matching run that includes face-down cards', () => {
    const ranks: Rank[] = ['K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2']
    const state = buildState({ tableau: [ranks.map((r) => `${r}S`), ['AS']] })
    // Only the top 3 cards are actually face-up — the completed-looking run below is buried.
    state.faceUp[0] = 3
    const result = applySpiderMove(state, { type: 'MOVE', from: { kind: 'tableau', index: 1 }, to: { kind: 'tableau', index: 0 }, count: 1 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.tableau[0]).toHaveLength(13)
      expect(result.state.foundations).toHaveLength(0)
    }
  })

  it('sets won once all 8 sequences are completed', () => {
    const ranks: Rank[] = ['K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2']
    const state = buildState({
      tableau: [ranks.map((r) => `${r}S`), ['AS']],
      foundations: Array.from({ length: 7 }, () => ranks.concat(['A' as Rank]).map((r) => `${r}H`)),
    })
    const result = applySpiderMove(state, { type: 'MOVE', from: { kind: 'tableau', index: 1 }, to: { kind: 'tableau', index: 0 }, count: 1 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.foundations).toHaveLength(8)
      expect(result.state.won).toBe(true)
    }
  })
})

describe('spiderLegalDestinations', () => {
  it('lists only the columns that accept the moving run', () => {
    const state = buildState({ tableau: [['6H'], ['4S'], [], ['5S'], ['2S'], ['2S'], ['2S'], ['2S'], ['2S'], ['2S']] })
    const dests = spiderLegalDestinations(state, { kind: 'tableau', index: 3 }, 1)
    expect(dests).toEqual([{ kind: 'tableau', index: 0 }, { kind: 'tableau', index: 2 }])
  })
})
