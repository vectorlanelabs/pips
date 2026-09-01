import type { Card } from '../../card-engine/cards.ts'

export interface HandRank {
  category: number // 8=straight flush, 7=four of a kind, ..., 0=high card
  tiebreakers: number[] // ordered from most significant to least, all converted to numeric values (A=14, K=13, ..., 2=2, except wheel A=1)
}

// Hand category rankings (higher is better)
const HAND_CATEGORIES = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
}

// Convert rank string to numeric value (for sorting)
function rankToValue(rank: string): number {
  const ranks: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 }
  return ranks[rank] ?? 0
}

// Check if cards form a flush
function isFlush(cards: Card[]): boolean {
  if (cards.length !== 5) return false
  const suit = cards[0].suit
  return cards.every((c) => c.suit === suit)
}

// Check if cards form a straight (including wheel)
// Returns the high card value if it's a straight, or 0 if not
function getStraightHigh(cards: Card[]): number {
  if (cards.length !== 5) return 0

  const values = cards.map((c) => rankToValue(c.rank)).sort((a, b) => a - b)
  const firstValue = values[0]

  // Check for regular straight: all consecutive
  let isStraight = true
  for (let i = 1; i < 5; i++) {
    if (values[i] !== values[i - 1] + 1) {
      isStraight = false
      break
    }
  }

  if (isStraight) {
    return values[4] // Return highest card
  }

  // Check for wheel (A-2-3-4-5): values would be [2, 3, 4, 5, 14]
  if (firstValue === 2 && values[1] === 3 && values[2] === 4 && values[3] === 5 && values[4] === 14) {
    return 5 // Wheel is the lowest straight, return 5 as high card
  }

  return 0
}

// Evaluate a single 5-card poker hand
function evaluateHand(hand: Card[]): HandRank {
  if (hand.length !== 5) {
    throw new Error('Hand must be exactly 5 cards')
  }

  const isStraightFlush = isFlush(hand) && getStraightHigh(hand) !== 0
  const isFourOfAKind = countRanks(hand).some((c) => c.count === 4)
  const isFullHouse = countRanks(hand).some((c) => c.count === 3) && countRanks(hand).some((c) => c.count === 2)
  const isFlushHand = isFlush(hand)
  const straightHigh = getStraightHigh(hand)
  const isThreeOfAKind = countRanks(hand).some((c) => c.count === 3)
  const pairs = countRanks(hand).filter((c) => c.count === 2)
  const isTwoPair = pairs.length === 2
  const isOnePair = pairs.length === 1

  if (isStraightFlush) {
    return {
      category: HAND_CATEGORIES.STRAIGHT_FLUSH,
      tiebreakers: [straightHigh === 5 ? 5 : straightHigh], // For wheel, return 5; otherwise return high card
    }
  }

  if (isFourOfAKind) {
    const ranked = countRanks(hand)
    const quads = ranked.find((c) => c.count === 4)!.rank
    const kicker = ranked.find((c) => c.count === 1)!.rank
    return {
      category: HAND_CATEGORIES.FOUR_OF_A_KIND,
      tiebreakers: [rankToValue(quads), rankToValue(kicker)],
    }
  }

  if (isFullHouse) {
    const ranked = countRanks(hand)
    const trips = ranked.find((c) => c.count === 3)!.rank
    const pair = ranked.find((c) => c.count === 2)!.rank
    return {
      category: HAND_CATEGORIES.FULL_HOUSE,
      tiebreakers: [rankToValue(trips), rankToValue(pair)],
    }
  }

  if (isFlushHand) {
    const values = hand.map((c) => rankToValue(c.rank)).sort((a, b) => b - a)
    return {
      category: HAND_CATEGORIES.FLUSH,
      tiebreakers: values,
    }
  }

  if (straightHigh !== 0) {
    return {
      category: HAND_CATEGORIES.STRAIGHT,
      tiebreakers: [straightHigh === 5 ? 5 : straightHigh],
    }
  }

  if (isThreeOfAKind) {
    const ranked = countRanks(hand)
    const trips = ranked.find((c) => c.count === 3)!.rank
    const kickers = ranked
      .filter((c) => c.count === 1)
      .map((c) => rankToValue(c.rank))
      .sort((a, b) => b - a)
    return {
      category: HAND_CATEGORIES.THREE_OF_A_KIND,
      tiebreakers: [rankToValue(trips), ...kickers],
    }
  }

  if (isTwoPair) {
    const ranked = countRanks(hand)
    const pairRanks = ranked
      .filter((c) => c.count === 2)
      .map((c) => rankToValue(c.rank))
      .sort((a, b) => b - a)
    const kicker = ranked.find((c) => c.count === 1)!.rank
    return {
      category: HAND_CATEGORIES.TWO_PAIR,
      tiebreakers: [...pairRanks, rankToValue(kicker)],
    }
  }

  if (isOnePair) {
    const ranked = countRanks(hand)
    const pair = ranked.find((c) => c.count === 2)!.rank
    const kickers = ranked
      .filter((c) => c.count === 1)
      .map((c) => rankToValue(c.rank))
      .sort((a, b) => b - a)
    return {
      category: HAND_CATEGORIES.ONE_PAIR,
      tiebreakers: [rankToValue(pair), ...kickers],
    }
  }

  // High card
  const values = hand.map((c) => rankToValue(c.rank)).sort((a, b) => b - a)
  return {
    category: HAND_CATEGORIES.HIGH_CARD,
    tiebreakers: values,
  }
}

// Count cards by rank
function countRanks(cards: Card[]): { rank: string; count: number }[] {
  const counts: Record<string, number> = {}
  for (const card of cards) {
    counts[card.rank] = (counts[card.rank] ?? 0) + 1
  }
  return Object.entries(counts)
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => {
      // Sort by count descending, then by rank value descending
      if (b.count !== a.count) return b.count - a.count
      return rankToValue(b.rank) - rankToValue(a.rank)
    })
}

// Generate all 5-card combinations from 7 cards
function* combinations(items: Card[], size: number): Generator<Card[]> {
  if (size === 0) {
    yield []
    return
  }
  if (items.length < size) return

  const [first, ...rest] = items
  for (const combo of combinations(rest, size - 1)) {
    yield [first, ...combo]
  }
  for (const combo of combinations(rest, size)) {
    yield combo
  }
}

// Evaluate all possible 5-card hands from 7 cards
export function evaluateBestHand(holeCards: Card[], boardCards: Card[]): HandRank {
  if (holeCards.length !== 2) {
    throw new Error('Must have exactly 2 hole cards')
  }
  if (boardCards.length < 0 || boardCards.length > 5) {
    throw new Error('Must have 0-5 board cards')
  }

  // For incomplete boards (preflop all-in), can't evaluate until river
  if (boardCards.length < 5) {
    throw new Error('Cannot evaluate hand until all board cards are known')
  }

  const allCards = [...holeCards, ...boardCards]
  let bestHand: HandRank | null = null

  for (const combo of combinations(allCards, 5)) {
    const hand = evaluateHand(combo)
    if (bestHand === null || compareRanks(hand, bestHand) > 0) {
      bestHand = hand
    }
  }

  if (bestHand === null) {
    throw new Error('No valid hand found')
  }

  return bestHand
}

// Compare two hand ranks: returns 1 if a is better, -1 if b is better, 0 if tied
export function compareRanks(a: HandRank, b: HandRank): number {
  if (a.category !== b.category) {
    return a.category - b.category
  }

  // Same category, compare tiebreakers
  for (let i = 0; i < Math.max(a.tiebreakers.length, b.tiebreakers.length); i++) {
    const aVal = a.tiebreakers[i] ?? 0
    const bVal = b.tiebreakers[i] ?? 0
    if (aVal !== bVal) {
      return aVal - bVal
    }
  }

  return 0 // Tie
}

// Check if two ranks are exactly equal (for split pots)
export function ranksEqual(a: HandRank, b: HandRank): boolean {
  return compareRanks(a, b) === 0
}
