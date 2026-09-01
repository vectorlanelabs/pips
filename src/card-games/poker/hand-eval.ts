import { RANKS, SUITS, type Card } from '../../card-engine/cards.ts'

export interface HandRank {
  category: number // 9=five of a kind (only reachable with wilds), 8=straight flush, 7=four of a kind, ..., 0=high card
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
  FIVE_OF_A_KIND: 9,
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

  // Five of a kind outranks everything. Only reachable when a wild assignment
  // duplicated a rank (a single 52-card deck can never hold five natural
  // copies of one rank), so the check lives in the 5-card core where
  // wild-built hands land -- and it must run before the straight-flush check:
  // five copies of one rank also satisfy isFlush when a wild copied a suit.
  // One countRanks pass feeds this check and every category check below.
  const rankCounts = countRanks(hand)
  if (rankCounts.some((c) => c.count === 5)) {
    const fiveRank = rankCounts.find((c) => c.count === 5)!.rank
    return { category: HAND_CATEGORIES.FIVE_OF_A_KIND, tiebreakers: [rankToValue(fiveRank)] }
  }

  const isStraightFlush = isFlush(hand) && getStraightHigh(hand) !== 0
  const isFourOfAKind = rankCounts.some((c) => c.count === 4)
  const isFullHouse = rankCounts.some((c) => c.count === 3) && rankCounts.some((c) => c.count === 2)
  const isFlushHand = isFlush(hand)
  const straightHigh = getStraightHigh(hand)
  const isThreeOfAKind = rankCounts.some((c) => c.count === 3)
  const pairs = rankCounts.filter((c) => c.count === 2)
  const isTwoPair = pairs.length === 2
  const isOnePair = pairs.length === 1

  if (isStraightFlush) {
    return {
      category: HAND_CATEGORIES.STRAIGHT_FLUSH,
      tiebreakers: [straightHigh === 5 ? 5 : straightHigh], // For wheel, return 5; otherwise return high card
    }
  }

  if (isFourOfAKind) {
    const ranked = rankCounts
    const quads = ranked.find((c) => c.count === 4)!.rank
    const kicker = ranked.find((c) => c.count === 1)!.rank
    return {
      category: HAND_CATEGORIES.FOUR_OF_A_KIND,
      tiebreakers: [rankToValue(quads), rankToValue(kicker)],
    }
  }

  if (isFullHouse) {
    const ranked = rankCounts
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
    const ranked = rankCounts
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
    const ranked = rankCounts
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
    const ranked = rankCounts
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

// Deuces Wild evaluation of a single 5-card hand: every card whose rank is
// '2' is wild and may be assigned any (rank, suit) from the full 52-card
// space (13 ranks x 4 suits). Duplicates with natural cards ARE allowed -- a
// wild may copy an existing card, which is exactly what makes five of a kind
// and paired duplicates possible. w=1/w=2 brute-force every assignment (52 or
// 2704 evaluations -- cheap); w=3/w=4 use the locked rule table below.
function evaluateFiveWithWilds(cards: Card[]): HandRank {
  const naturals = cards.filter((c) => c.rank !== '2')
  const w = 5 - naturals.length

  if (w === 0) {
    return evaluateHand(cards)
  }

  if (w === 1 || w === 2) {
    const allCards = wildAssignmentSpace()
    let best: HandRank | null = null

    if (w === 1) {
      const assign = (assignments: Card[], depth: number): void => {
        if (depth === w) {
          const hand = evaluateHand([...naturals, ...assignments])
          if (best === null || compareRanks(hand, best) > 0) {
            best = hand
          }
          return
        }
        for (const candidate of allCards) {
          assignments.push(candidate)
          assign(assignments, depth + 1)
          assignments.pop()
        }
      }
      assign([], 0)
      return best!
    }

    // w === 2: unordered pairs (j >= i) suffice -- assignment order is irrelevant, halving the 52^2 sweep.
    for (let i = 0; i < allCards.length; i++) {
      for (let j = i; j < allCards.length; j++) {
        const hand = evaluateHand([...naturals, allCards[i], allCards[j]])
        if (best === null || compareRanks(hand, best) > 0) {
          best = hand
        }
      }
    }
    return best!
  }

  if (w === 3) {
    // Naturals a, b with values va >= vb after rankToValue.
    const [first, second] = naturals
    const firstValue = rankToValue(first.rank)
    const secondValue = rankToValue(second.rank)
    const a = firstValue >= secondValue ? first : second
    const b = firstValue >= secondValue ? second : first
    const va = rankToValue(a.rank)
    const vb = rankToValue(b.rank)

    if (a.rank === b.rank) {
      return { category: HAND_CATEGORIES.FIVE_OF_A_KIND, tiebreakers: [va] }
    }

    if (a.suit === b.suit) {
      const top = getWildStraightTop(va, vb)
      if (top !== 0) {
        return { category: HAND_CATEGORIES.STRAIGHT_FLUSH, tiebreakers: [top] }
      }
    }

    // Quads of the higher natural, lower natural kicker.
    return { category: HAND_CATEGORIES.FOUR_OF_A_KIND, tiebreakers: [va, vb] }
  }

  if (w === 4) {
    // Five of a kind always beats any straight flush the wilds could make instead.
    return { category: HAND_CATEGORIES.FIVE_OF_A_KIND, tiebreakers: [rankToValue(naturals[0].rank)] }
  }

  // w === 5 cannot occur: only four 2s exist in a deck.
  throw new Error('Cannot have 5 wild deuces in a 5-card hand')
}

// Largest straight top t (5..14) with both values inside the window [t-4, t];
// also considers the wheel window [1..5] treating an Ace as 1 (t for wheel =
// 5 -- a natural 2 cannot occur here, it would be wild). Returns 0 when no
// straight window contains both values.
function getWildStraightTop(va: number, vb: number): number {
  for (let t = 14; t >= 5; t--) {
    if (va >= t - 4 && va <= t && vb >= t - 4 && vb <= t) {
      return t
    }
  }
  const wheelVa = va === 14 ? 1 : va
  const wheelVb = vb === 14 ? 1 : vb
  if (wheelVa >= 1 && wheelVa <= 5 && wheelVb >= 1 && wheelVb <= 5) {
    return 5
  }
  return 0
}

// The full 52-card (rank, suit) space a wild may be assigned to. Every wild
// in a hand draws from this same space independently, so two wilds may be
// assigned the same card (that is what makes five of a kind possible).
function wildAssignmentSpace(): Card[] {
  const cards: Card[] = []
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      cards.push({ id: `wild-${rank}${suit}`, rank, suit, deckIndex: 0 })
    }
  }
  return cards
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
export function evaluateBestHand(holeCards: Card[], boardCards: Card[], deucesWild = false): HandRank {
  if (holeCards.length === 2) {
    if (boardCards.length < 0 || boardCards.length > 5) {
      throw new Error('Must have 0-5 board cards')
    }

    // For incomplete boards (preflop all-in), can't evaluate until river
    if (boardCards.length < 5) {
      throw new Error('Cannot evaluate hand until all board cards are known')
    }
  } else if (holeCards.length === 5 || holeCards.length === 7) {
    if (boardCards.length !== 0) {
      throw new Error('Draw hands are evaluated with no board')
    }
  } else {
    throw new Error('Must have 2, 5, or 7 hole cards')
  }

  const allCards = [...holeCards, ...boardCards]
  let bestHand: HandRank | null = null

  for (const combo of combinations(allCards, 5)) {
    const hand = deucesWild ? evaluateFiveWithWilds(combo) : evaluateHand(combo)
    if (bestHand === null || compareRanks(hand, bestHand) > 0) {
      bestHand = hand
    }
  }

  if (bestHand === null) {
    throw new Error('No valid hand found')
  }

  return bestHand
}

// Evaluate an Omaha hand: the best five-card hand formed from EXACTLY two of
// the four hole cards and EXACTLY three of the five board cards (C(4,2) x
// C(5,3) = 60 candidates, each scored by the same evaluateHand as holdem).
// Mirrors evaluateBestHand's incomplete-board behavior so mid-street probes
// (bot strategy, tests) fail the same way for both variants.
export function evaluateOmahaHand(holeCards: Card[], boardCards: Card[], deucesWild = false): HandRank {
  if (holeCards.length !== 4) {
    throw new Error('Omaha needs exactly 4 hole cards')
  }
  if (boardCards.length !== 5) {
    throw new Error('Cannot evaluate hand until all board cards are known')
  }

  let bestHand: HandRank | null = null

  for (const holeCombo of combinations(holeCards, 2)) {
    for (const boardCombo of combinations(boardCards, 3)) {
      const hand = deucesWild ? evaluateFiveWithWilds([...holeCombo, ...boardCombo]) : evaluateHand([...holeCombo, ...boardCombo])
      if (bestHand === null || compareRanks(hand, bestHand) > 0) {
        bestHand = hand
      }
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
