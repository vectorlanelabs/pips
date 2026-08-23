import { describe, it, expect } from 'vitest'
import { createStandardDeck } from '../../card-engine/deck.ts'
import type { Card, Suit, Rank } from '../../card-engine/cards.ts'
import type { SolitaireState } from './state.ts'
import { applyMove, autoCompleteMoves } from './shared.ts'

const DECK = createStandardDeck()

function card(suit: Suit, rank: Rank): Card {
  const found = DECK.find((c) => c.suit === suit && c.rank === rank)
  if (!found) throw new Error(`card not found: ${rank} of ${suit}`)
  return found
}

function emptyState(mode: 'klondike' | 'freecell'): SolitaireState {
  const columns = mode === 'klondike' ? 7 : 8
  return {
    mode,
    seed: 0,
    tableau: Array.from({ length: columns }, () => []),
    faceUp: Array(columns).fill(0),
    foundations: [[], [], [], []],
    stock: [],
    waste: [],
    cells: mode === 'freecell' ? [null, null, null, null] : [],
    pyramidRows: [],
    moves: 0,
    won: false,
  }
}

function applyAll(state: SolitaireState, moves: ReturnType<typeof autoCompleteMoves>): SolitaireState {
  let current = state
  for (const move of moves) {
    const outcome = applyMove(current, move)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) current = outcome.state
  }
  return current
}

describe('autoCompleteMoves', () => {
  it('returns no moves when nothing can go to a foundation', () => {
    const state = emptyState('klondike')
    state.tableau[0] = [card('spades', '5')]
    state.faceUp[0] = 1
    expect(autoCompleteMoves(state)).toEqual([])
  })

  it('chains an auto-flip reveal into a later pass (klondike)', () => {
    const state = emptyState('klondike')
    // Column 0: 2♠ hidden under A♠ — the 2♠ isn't eligible until A♠ leaves
    // and auto-flip reveals it, which only happens in a LATER scan pass.
    state.tableau[0] = [card('spades', '2'), card('spades', 'A')]
    state.faceUp[0] = 1
    state.tableau[1] = [card('clubs', 'A')]
    state.faceUp[1] = 1

    const moves = autoCompleteMoves(state)
    expect(moves).toEqual([
      { type: 'MOVE', from: { kind: 'tableau', index: 0 }, to: { kind: 'foundation', index: 3 }, count: 1 },
      { type: 'MOVE', from: { kind: 'tableau', index: 0 }, to: { kind: 'foundation', index: 3 }, count: 1 },
      { type: 'MOVE', from: { kind: 'tableau', index: 1 }, to: { kind: 'foundation', index: 0 }, count: 1 },
    ])

    const final = applyAll(state, moves)
    expect(final.foundations[3].map((c) => c.rank)).toEqual(['A', '2'])
    expect(final.foundations[0].map((c) => c.rank)).toEqual(['A'])
    expect(final.tableau[0]).toEqual([])
    expect(final.tableau[1]).toEqual([])
  })

  it('sends a waste-top card home (klondike)', () => {
    const state = emptyState('klondike')
    state.waste = [card('hearts', 'A')]
    const moves = autoCompleteMoves(state)
    expect(moves).toEqual([{ type: 'MOVE', from: { kind: 'waste' }, to: { kind: 'foundation', index: 2 }, count: 1 }])
    const final = applyAll(state, moves)
    expect(final.waste).toEqual([])
    expect(final.foundations[2].map((c) => c.rank)).toEqual(['A'])
  })

  it('sends a free-cell card home (freecell)', () => {
    const state = emptyState('freecell')
    state.cells[2] = card('diamonds', 'A')
    const moves = autoCompleteMoves(state)
    expect(moves).toEqual([{ type: 'MOVE', from: { kind: 'cell', index: 2 }, to: { kind: 'foundation', index: 1 }, count: 1 }])
    const final = applyAll(state, moves)
    expect(final.cells[2]).toBeNull()
    expect(final.foundations[1].map((c) => c.rank)).toEqual(['A'])
  })

  it('terminates and clears a fully-exposed win-in-waiting position', () => {
    const state = emptyState('freecell')
    // Four full K-to-A runs, one per column — every card is already a legal
    // chain straight to its foundation once the ranks below it clear.
    const ranks: Rank[] = ['K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2', 'A']
    const suits: Suit[] = ['clubs', 'diamonds', 'hearts', 'spades']
    suits.forEach((suit, i) => {
      state.tableau[i] = ranks.map((r) => card(suit, r))
      state.faceUp[i] = ranks.length
    })

    const moves = autoCompleteMoves(state)
    expect(moves).toHaveLength(52)
    const final = applyAll(state, moves)
    expect(final.won).toBe(true)
  })
})
