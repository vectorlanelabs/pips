import { describe, it, expect } from 'vitest'
import { classifyMeld, isAceHighRun, canJoinGroupUsing, hasAnyMeld } from './melds.ts'
import type { Card } from '../../card-engine/cards.ts'

function card(id: string, suit: Card['suit'], rank: Card['rank']): Card {
  return { id, suit, rank, deckIndex: 0 }
}

describe('classifyMeld', () => {
  // --- Too short ---
  it('rejects empty array', () => {
    expect(classifyMeld([])).toEqual({ valid: false })
  })

  it('rejects 1-card selection', () => {
    expect(classifyMeld([card('c1', 'spades', '7')])).toEqual({ valid: false })
  })

  it('rejects 2-card selection', () => {
    expect(classifyMeld([
      card('c1', 'spades', '7'),
      card('c2', 'hearts', '7'),
    ])).toEqual({ valid: false })
  })

  // --- Valid sets ---
  it('classifies 3 cards same rank all different suits as a set', () => {
    const result = classifyMeld([
      card('c1', 'spades', '7'),
      card('c2', 'hearts', '7'),
      card('c3', 'diamonds', '7'),
    ])
    expect(result).toEqual({ valid: true, type: 'set' })
  })

  it('classifies 4 cards same rank all 4 suits as a set', () => {
    const result = classifyMeld([
      card('c1', 'spades', 'K'),
      card('c2', 'hearts', 'K'),
      card('c3', 'diamonds', 'K'),
      card('c4', 'clubs', 'K'),
    ])
    expect(result).toEqual({ valid: true, type: 'set' })
  })

  // --- Invalid sets ---
  it('rejects same-rank cards with duplicate suits', () => {
    // Two 7 of spades (different id/deckIndex but same suit)
    const result = classifyMeld([
      card('c1', 'spades', '7'),
      card('c2', 'spades', '7'),
      card('c3', 'hearts', '7'),
    ])
    expect(result).toEqual({ valid: false })
  })

  // --- Valid runs ---
  it('classifies 3 consecutive same-suit cards as a run', () => {
    const result = classifyMeld([
      card('c1', 'hearts', '3'),
      card('c2', 'hearts', '4'),
      card('c3', 'hearts', '5'),
    ])
    expect(result).toEqual({ valid: true, type: 'run' })
  })

  it('classifies 5-card consecutive same-suit run', () => {
    const result = classifyMeld([
      card('c1', 'clubs', '5'),
      card('c2', 'clubs', '6'),
      card('c3', 'clubs', '7'),
      card('c4', 'clubs', '8'),
      card('c5', 'clubs', '9'),
    ])
    expect(result).toEqual({ valid: true, type: 'run' })
  })

  // --- Invalid runs ---
  it('rejects same-suit cards with a gap', () => {
    const result = classifyMeld([
      card('c1', 'hearts', '3'),
      card('c2', 'hearts', '4'),
      card('c3', 'hearts', '6'),
    ])
    expect(result).toEqual({ valid: false })
  })

  it('rejects same-suit cards with a duplicate rank', () => {
    const result = classifyMeld([
      card('c1', 'hearts', '3'),
      card('c2', 'hearts', '4'),
      card('c3', 'hearts', '4'),
    ])
    expect(result).toEqual({ valid: false })
  })

  it('rejects consecutive ranks with different suits', () => {
    const result = classifyMeld([
      card('c1', 'hearts', '3'),
      card('c2', 'spades', '4'),
      card('c3', 'hearts', '5'),
    ])
    expect(result).toEqual({ valid: false })
  })

  // --- Ace-low, no wrap ---
  it('classifies Q-K-A same-suit as a valid run (ace-high)', () => {
    const result = classifyMeld([
      card('c1', 'spades', 'Q'),
      card('c2', 'spades', 'K'),
      card('c3', 'spades', 'A'),
    ])
    expect(result).toEqual({ valid: true, type: 'run' })
  })

  it('classifies 10-J-Q-K-A same-suit as a valid run (ace-high, longer)', () => {
    const result = classifyMeld([
      card('c1', 'spades', '10'),
      card('c2', 'spades', 'J'),
      card('c3', 'spades', 'Q'),
      card('c4', 'spades', 'K'),
      card('c5', 'spades', 'A'),
    ])
    expect(result).toEqual({ valid: true, type: 'run' })
  })

  it('rejects K-A-2 same-suit (true wraparound)', () => {
    // rankValue: 13,1,2 → sorted [1,2,13] — gap at 2→13, invalid.
    // rankValueAceHigh: 13,14,2 → sorted [2,13,14] — gap at 2→13, invalid.
    // Both interpretations correctly reject it.
    const result = classifyMeld([
      card('c1', 'spades', 'K'),
      card('c2', 'spades', 'A'),
      card('c3', 'spades', '2'),
    ])
    expect(result).toEqual({ valid: false })
  })

  it('rejects Q-K-A-2-3 same-suit (wraparound spanning both ends)', () => {
    // rankValue: 12,13,1,2,3 → sorted [1,2,3,12,13] — gap at 3→12, invalid.
    // rankValueAceHigh: 12,13,14,2,3 → sorted [2,3,12,13,14] — gap at 3→12, invalid.
    // Both interpretations correctly reject it.
    const result = classifyMeld([
      card('c1', 'spades', 'Q'),
      card('c2', 'spades', 'K'),
      card('c3', 'spades', 'A'),
      card('c4', 'spades', '2'),
      card('c5', 'spades', '3'),
    ])
    expect(result).toEqual({ valid: false })
  })

  it('classifies A-2-3 same-suit as a valid run', () => {
    const result = classifyMeld([
      card('c1', 'spades', 'A'),
      card('c2', 'spades', '2'),
      card('c3', 'spades', '3'),
    ])
    expect(result).toEqual({ valid: true, type: 'run' })
  })

  // --- Mixed nonsense ---
  it('rejects mixed ranks and suits with no meld relationship', () => {
    const result = classifyMeld([
      card('c1', 'spades', '7'),
      card('c2', 'hearts', '2'),
      card('c3', 'diamonds', 'K'),
    ])
    expect(result).toEqual({ valid: false })
  })

  // --- Unsorted input ---
  it('classifies unsorted run cards correctly', () => {
    const result = classifyMeld([
      card('c1', 'hearts', '5'),
      card('c2', 'hearts', '3'),
      card('c3', 'hearts', '4'),
    ])
    expect(result).toEqual({ valid: true, type: 'run' })
  })

  it('classifies a run crossing the 9-10 boundary as valid (numeric, not lexicographic, sort)', () => {
    const result = classifyMeld([
      card('c1', 'hearts', '10'),
      card('c2', 'hearts', '8'),
      card('c3', 'hearts', '9'),
    ])
    expect(result).toEqual({ valid: true, type: 'run' })
  })
})

describe('isAceHighRun', () => {
  it('returns true for a Q-K-A same-suit meld', () => {
    expect(isAceHighRun([
      card('c1', 'spades', 'Q'),
      card('c2', 'spades', 'K'),
      card('c3', 'spades', 'A'),
    ])).toBe(true)
  })

  it('returns false for an A-2-3 same-suit meld', () => {
    expect(isAceHighRun([
      card('c1', 'spades', 'A'),
      card('c2', 'spades', '2'),
      card('c3', 'spades', '3'),
    ])).toBe(false)
  })

  it('returns false for a set of 4 aces (no King present)', () => {
    expect(isAceHighRun([
      card('c1', 'spades', 'A'),
      card('c2', 'hearts', 'A'),
      card('c3', 'diamonds', 'A'),
      card('c4', 'clubs', 'A'),
    ])).toBe(false)
  })

  it('returns false for a full 13-card A-through-K same-suit run (ace-low, even though it contains a King)', () => {
    // A presence-only heuristic ("contains an Ace and a King") would wrongly say true here —
    // this run is valid entirely under the ace-LOW interpretation (values 1..13 consecutive),
    // so the Ace must be scored as low (5), not high (15).
    const ranks: Card['rank'][] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
    const meld = ranks.map((rank, i) => card(`c${i}`, 'spades', rank))
    expect(isAceHighRun(meld)).toBe(false)
  })
})

describe('canJoinGroupUsing', () => {
  const run9toJ = [card('d9', 'diamonds', '9'), card('d10', 'diamonds', '10'), card('dJ', 'diamonds', 'J')]

  it('bridged run extension: 7♦ joins 9-10-J♦ when the 8♦ is in the pool', () => {
    const seven = card('d7', 'diamonds', '7')
    expect(canJoinGroupUsing(run9toJ, seven, [card('d8', 'diamonds', '8')])).toBe(true)
  })

  it('no bridge available: 7♦ cannot join 9-10-J♦ with an unrelated pool', () => {
    const seven = card('d7', 'diamonds', '7')
    expect(canJoinGroupUsing(run9toJ, seven, [card('c8', 'clubs', '8'), card('dQ', 'diamonds', 'Q')])).toBe(false)
  })

  it('direct single-card extension still works with an empty pool', () => {
    expect(canJoinGroupUsing(run9toJ, card('dQ', 'diamonds', 'Q'), [])).toBe(true)
    expect(canJoinGroupUsing(run9toJ, card('d8', 'diamonds', '8'), [])).toBe(true)
  })

  it('two-card bridge: 6♦ joins 9-10-J♦ via 7♦ and 8♦ from the pool', () => {
    const six = card('d6', 'diamonds', '6')
    expect(canJoinGroupUsing(run9toJ, six, [card('d8', 'diamonds', '8'), card('d7', 'diamonds', '7')])).toBe(true)
  })

  it('ace-high bridge: A♦ joins 10-J-Q♦ via the K♦', () => {
    const group = [card('d10', 'diamonds', '10'), card('dJ', 'diamonds', 'J'), card('dQ', 'diamonds', 'Q')]
    expect(canJoinGroupUsing(group, card('dA', 'diamonds', 'A'), [card('dK', 'diamonds', 'K')])).toBe(true)
  })

  it('set extension: fourth suit joins a 3-card set, wrong rank does not', () => {
    const set = [card('c4', 'clubs', '4'), card('d4', 'diamonds', '4'), card('h4', 'hearts', '4')]
    expect(canJoinGroupUsing(set, card('s4', 'spades', '4'), [])).toBe(true)
    expect(canJoinGroupUsing(set, card('s5', 'spades', '5'), [card('c5', 'clubs', '5')])).toBe(false)
  })
})

describe('hasAnyMeld', () => {
  it('finds a set among scattered cards', () => {
    expect(hasAnyMeld([
      card('c7', 'clubs', '7'), card('dK', 'diamonds', 'K'), card('h7', 'hearts', '7'),
      card('s2', 'spades', '2'), card('s7', 'spades', '7'),
    ])).toBe(true)
  })

  it('finds an ace-low and an ace-high run', () => {
    expect(hasAnyMeld([card('cA', 'clubs', 'A'), card('c2', 'clubs', '2'), card('c3', 'clubs', '3')])).toBe(true)
    expect(hasAnyMeld([card('sQ', 'spades', 'Q'), card('sK', 'spades', 'K'), card('sA', 'spades', 'A')])).toBe(true)
  })

  it('rejects hands with only pairs and broken runs', () => {
    expect(hasAnyMeld([
      card('c7', 'clubs', '7'), card('d7', 'diamonds', '7'),
      card('h5', 'hearts', '5'), card('h6', 'hearts', '6'), card('h8', 'hearts', '8'),
      card('sK', 'spades', 'K'), card('sA', 'spades', 'A'), card('s2', 'spades', '2'),
    ])).toBe(false)
  })
})
