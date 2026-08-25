import { describe, it, expect } from 'vitest'
import type { Card, Suit, Rank } from '../../card-engine/cards.ts'
import type { SolitaireState, SolitaireMode } from './state.ts'
import { applyAnyMove, anyLegalDestinations, findAnyFoundationMove, autoCompleteAnyMoves } from './dispatch.ts'

function card(id: string, suit: Suit, rank: Rank): Card {
  return { id, suit, rank, deckIndex: 0 }
}

function emptyState(mode: SolitaireMode): SolitaireState {
  const columns = mode === 'freecell' ? 8 : mode === 'spider' || mode === 'spider1' ? 10 : mode === 'pyramid' ? 0 : 7
  const hasFoundations = mode !== 'pyramid' && mode !== 'spider' && mode !== 'spider1'
  return {
    mode,
    seed: 0,
    tableau: Array.from({ length: columns }, () => []),
    faceUp: Array(columns).fill(0),
    foundations: hasFoundations ? [[], [], [], []] : [],
    stock: [],
    waste: [],
    cells: mode === 'freecell' ? [null, null, null, null] : [],
    pyramidRows: [],
    moves: 0,
    won: false,
  }
}

// These tests exist because dispatch.ts is the one place that decides which
// engine (shared klondike/freecell, spider, or pyramid) actually handles a
// move — the per-engine test files below it never exercise that boundary,
// so a routing mistake (e.g. spider1 falling through to the shared engine)
// could ship even with every other Solitaire test green.
describe('dispatch: applyAnyMove routing', () => {
  it('routes klondike/freecell through the shared engine', () => {
    const state = emptyState('klondike')
    state.waste = [card('a', 'spades', 'A')]
    const result = applyAnyMove(state, { type: 'MOVE', from: { kind: 'waste' }, to: { kind: 'foundation', index: 3 }, count: 1 })
    expect(result.ok).toBe(true)
  })

  it('routes spider1 (Spider 1-Suit) through the spider engine', () => {
    const state = emptyState('spider1')
    state.tableau[0] = [card('a', 'spades', '9')]
    state.faceUp[0] = 1
    state.tableau[1] = [card('b', 'spades', '8')]
    state.faceUp[1] = 1

    const result = applyAnyMove(state, { type: 'MOVE', from: { kind: 'tableau', index: 1 }, to: { kind: 'tableau', index: 0 }, count: 1 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.tableau[0].map((c) => c.rank)).toEqual(['9', '8'])
    }

    // Spider never accepts a foundation destination — proves this actually
    // went through the spider engine rather than falling through to shared
    // klondike/freecell rules, which would have rejected for a different
    // reason (or worse, silently misbehaved).
    const badDest = applyAnyMove(state, { type: 'MOVE', from: { kind: 'tableau', index: 1 }, to: { kind: 'foundation', index: 0 }, count: 1 })
    expect(badDest.ok).toBe(false)
  })

  it('routes pyramid through the pyramid engine', () => {
    const state = emptyState('pyramid')
    // Row 6 (the base row) is always exposed regardless of what's above it,
    // so this King is legally removable without having to fill out the rest
    // of the pyramid's structure.
    state.pyramidRows = [[], [], [], [], [], [], [card('k', 'clubs', 'K')]]
    const result = applyAnyMove(state, { type: 'REMOVE_KING', loc: { kind: 'pyramid', row: 6, col: 0 } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.state.won).toBe(true)
  })
})

describe('dispatch: findAnyFoundationMove routing', () => {
  it('finds the Pyramid King shortcut through dispatch', () => {
    const state = emptyState('pyramid')
    state.pyramidRows = [[], [], [], [], [], [], [card('k', 'hearts', 'K')]]
    const move = findAnyFoundationMove(state, { kind: 'pyramid', row: 6, col: 0 })
    expect(move).toEqual({ type: 'REMOVE_KING', loc: { kind: 'pyramid', row: 6, col: 0 } })
  })

  it('returns null for spider (no foundation shortcut exists)', () => {
    const state = emptyState('spider')
    state.tableau[0] = [card('a', 'spades', 'A')]
    state.faceUp[0] = 1
    expect(findAnyFoundationMove(state, { kind: 'tableau', index: 0 })).toBeNull()
  })

  it('finds the klondike foundation shortcut through dispatch', () => {
    const state = emptyState('klondike')
    state.waste = [card('a', 'spades', 'A')]
    const move = findAnyFoundationMove(state, { kind: 'waste' })
    expect(move).toEqual({ type: 'MOVE', from: { kind: 'waste' }, to: { kind: 'foundation', index: 3 }, count: 1 })
  })
})

describe('dispatch: anyLegalDestinations routing', () => {
  it('routes spider1 to spiderLegalDestinations', () => {
    const state = emptyState('spider1')
    state.tableau[0] = [card('a', 'spades', '9')]
    state.faceUp[0] = 1
    state.tableau[1] = [card('b', 'spades', '8')]
    state.faceUp[1] = 1
    // Fill every other column with a card of the wrong rank so they're
    // unambiguously rejected — an empty column would accept anything and
    // wouldn't distinguish "routed to spiderLegalDestinations" from a bug.
    for (let i = 2; i < 10; i++) {
      state.tableau[i] = [card(`f${i}`, 'spades', '2')]
      state.faceUp[i] = 1
    }

    const dests = anyLegalDestinations(state, { kind: 'tableau', index: 1 }, 1)
    expect(dests).toEqual([{ kind: 'tableau', index: 0 }])
  })

  it('routes pyramid to pyramidLegalDestinations', () => {
    const state = emptyState('pyramid')
    state.pyramidRows = [[], [], [], [], [], [], [card('a', 'spades', '5'), card('b', 'hearts', '8')]]

    const dests = anyLegalDestinations(state, { kind: 'pyramid', row: 6, col: 0 }, 1)
    expect(dests).toEqual([{ kind: 'pyramid', row: 6, col: 1 }])
  })

  it('routes klondike/freecell to the shared legalDestinations', () => {
    const state = emptyState('klondike')
    state.waste = [card('a', 'spades', 'A')]
    // All 7 tableau columns are empty, and klondike only allows a King onto
    // an empty column, so the only legal destination is the foundation.
    const dests = anyLegalDestinations(state, { kind: 'waste' }, 1)
    expect(dests).toEqual([{ kind: 'foundation', index: 3 }])
  })
})

describe('dispatch: autoCompleteAnyMoves routing', () => {
  it('returns moves for klondike/freecell', () => {
    const state = emptyState('klondike')
    state.waste = [card('a', 'hearts', 'A')]
    expect(autoCompleteAnyMoves(state)).toEqual([
      { type: 'MOVE', from: { kind: 'waste' }, to: { kind: 'foundation', index: 2 }, count: 1 },
    ])
  })

  it('returns [] for spider — it has no foundation shortcut to auto-complete', () => {
    const state = emptyState('spider')
    state.tableau[0] = [card('a', 'spades', 'A')]
    state.faceUp[0] = 1
    expect(autoCompleteAnyMoves(state)).toEqual([])
  })

  it('returns [] for pyramid — it has no foundation shortcut to auto-complete', () => {
    const state = emptyState('pyramid')
    state.pyramidRows = [[card('k', 'clubs', 'K')]]
    expect(autoCompleteAnyMoves(state)).toEqual([])
  })
})
