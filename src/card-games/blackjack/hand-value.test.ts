import { describe, it, expect } from 'vitest'
import { cardValue, handValue, isBust, isNaturalBlackjack } from './hand-value.ts'
import type { Card } from '../../card-engine/cards.ts'

const card = (rank: string, suit: string = 'hearts'): Card => ({
  id: `card-${rank}-${suit}`,
  rank,
  suit,
  deckIndex: 0,
})

describe('cardValue', () => {
  it('returns face value for 2-10', () => {
    expect(cardValue('2')).toBe(2)
    expect(cardValue('5')).toBe(5)
    expect(cardValue('10')).toBe(10)
  })

  it('returns 10 for J, Q, K', () => {
    expect(cardValue('J')).toBe(10)
    expect(cardValue('Q')).toBe(10)
    expect(cardValue('K')).toBe(10)
  })

  it('returns 11 for Ace', () => {
    expect(cardValue('A')).toBe(11)
  })
})

describe('handValue', () => {
  it('returns 0 for empty hand', () => {
    const result = handValue([])
    expect(result.total).toBe(0)
    expect(result.soft).toBe(false)
  })

  it('calculates hard totals correctly', () => {
    const result = handValue([card('5'), card('7')])
    expect(result.total).toBe(12)
    expect(result.soft).toBe(false)
  })

  it('calculates soft 17 (A+6)', () => {
    const result = handValue([card('A'), card('6')])
    expect(result.total).toBe(17)
    expect(result.soft).toBe(true)
  })

  it('calculates hard 17 (A+6+10)', () => {
    const result = handValue([card('A'), card('6'), card('10')])
    expect(result.total).toBe(17)
    expect(result.soft).toBe(false)
  })

  it('handles multiple aces', () => {
    const result = handValue([card('A'), card('A'), card('9')])
    expect(result.total).toBe(21)
    expect(result.soft).toBe(true)
  })

  it('handles A+5+5 = 21 soft', () => {
    const result = handValue([card('A'), card('5'), card('5')])
    expect(result.total).toBe(21)
    expect(result.soft).toBe(true)
  })

  it('prefers aces as 11 when possible', () => {
    const result = handValue([card('A'), card('2')])
    expect(result.total).toBe(13)
    expect(result.soft).toBe(true)
  })

  it('converts aces to 1 to avoid bust', () => {
    const result = handValue([card('A'), card('K'), card('Q')])
    expect(result.total).toBe(21)
    expect(result.soft).toBe(false)
  })

  it('handles complex multi-ace hands', () => {
    const result = handValue([card('A'), card('A'), card('A'), card('8')])
    expect(result.total).toBe(21)
    expect(result.soft).toBe(true)
  })

  it('soft 16 (A+5)', () => {
    const result = handValue([card('A'), card('5')])
    expect(result.total).toBe(16)
    expect(result.soft).toBe(true)
  })

  it('hard 16 (5+5+6)', () => {
    const result = handValue([card('5'), card('5'), card('6')])
    expect(result.total).toBe(16)
    expect(result.soft).toBe(false)
  })
})

describe('isBust', () => {
  it('returns false for totals <= 21', () => {
    expect(isBust([card('10'), card('5')])).toBe(false)
    expect(isBust([card('K'), card('Q')])).toBe(false)
  })

  it('returns true for totals > 21', () => {
    expect(isBust([card('K'), card('Q'), card('5')])).toBe(true)
    expect(isBust([card('9'), card('8'), card('9')])).toBe(true)
  })

  it('returns false for exactly 21', () => {
    expect(isBust([card('10'), card('J')])).toBe(false)
  })
})

describe('isNaturalBlackjack', () => {
  it('returns true for 21 with exactly 2 cards', () => {
    expect(isNaturalBlackjack([card('A'), card('K')])).toBe(true)
    expect(isNaturalBlackjack([card('K'), card('A')])).toBe(true)
  })

  it('returns false for 21 with more than 2 cards', () => {
    expect(isNaturalBlackjack([card('7'), card('7'), card('7')])).toBe(false)
  })

  it('returns false for less than 2 cards', () => {
    expect(isNaturalBlackjack([card('K')])).toBe(false)
  })

  it('returns false for non-21 totals', () => {
    expect(isNaturalBlackjack([card('10'), card('5')])).toBe(false)
  })

  it('returns false for split-aces 21 when tested in isolation', () => {
    // isNaturalBlackjack only checks value and card count, not split status
    // That's checked in rules.ts
    expect(isNaturalBlackjack([card('A'), card('A')])).toBe(false)
  })
})
