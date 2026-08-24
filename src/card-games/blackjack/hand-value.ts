import type { Card } from '../../card-engine/cards.ts'
import type { Rank } from '../../card-engine/cards.ts'

export function cardValue(rank: Rank): number {
  if (rank === 'A') return 11
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10
  const num = parseInt(rank, 10)
  return Number.isFinite(num) ? num : 0
}

export function handValue(cards: Card[]): { total: number; soft: boolean } {
  if (cards.length === 0) return { total: 0, soft: false }

  let total = 0
  let aces = 0

  for (const card of cards) {
    const value = cardValue(card.rank)
    if (card.rank === 'A') {
      aces += 1
    }
    total += value
  }

  // Count aces as 11 if possible, else as 1.
  // Start with all aces as 11, then convert them to 1 until we're under 21 (or run out of aces).
  while (total > 21 && aces > 0) {
    total -= 10  // convert an ace from 11 to 1
    aces -= 1
  }

  // soft is true iff at least one ace is still being counted as 11
  const soft = aces > 0 && total <= 21

  return { total, soft }
}

export function isBust(cards: Card[]): boolean {
  return handValue(cards).total > 21
}

export function isNaturalBlackjack(cards: Card[]): boolean {
  if (cards.length !== 2) return false
  const value = handValue(cards)
  return value.total === 21
}
