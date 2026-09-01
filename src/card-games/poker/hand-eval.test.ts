import { describe, it, expect } from 'vitest'
import { evaluateBestHand, compareRanks, ranksEqual } from './hand-eval.ts'
import type { Card } from '../../card-engine/cards.ts'

function card(rank: string, suit: string): Card {
  return { id: `${rank}${suit}`, rank, suit, deckIndex: 0 }
}

describe('hand-eval', () => {
  describe('evaluateBestHand', () => {
    it('evaluates high card correctly', () => {
      const hole = [card('A', 'hearts'), card('K', 'diamonds')]
      const board = [card('Q', 'clubs'), card('J', 'spades'), card('9', 'hearts'), card('7', 'diamonds'), card('5', 'clubs')]
      const hand = evaluateBestHand(hole, board)
      expect(hand.category).toBe(0) // HIGH_CARD
      expect(hand.tiebreakers[0]).toBe(14) // A
      expect(hand.tiebreakers[1]).toBe(13) // K
    })

    it('evaluates one pair correctly', () => {
      const hole = [card('A', 'hearts'), card('A', 'diamonds')]
      const board = [card('K', 'clubs'), card('Q', 'spades'), card('J', 'hearts'), card('9', 'diamonds'), card('5', 'clubs')]
      const hand = evaluateBestHand(hole, board)
      expect(hand.category).toBe(1) // ONE_PAIR
      expect(hand.tiebreakers[0]).toBe(14) // pair of A
      expect(hand.tiebreakers[1]).toBe(13) // K kicker
      expect(hand.tiebreakers[2]).toBe(12) // Q kicker
      expect(hand.tiebreakers[3]).toBe(11) // J kicker
    })

    it('evaluates two pair correctly', () => {
      const hole = [card('A', 'hearts'), card('K', 'diamonds')]
      const board = [card('A', 'clubs'), card('K', 'spades'), card('Q', 'hearts'), card('J', 'diamonds'), card('9', 'clubs')]
      const hand = evaluateBestHand(hole, board)
      expect(hand.category).toBe(2) // TWO_PAIR
      expect(hand.tiebreakers[0]).toBe(14) // higher pair
      expect(hand.tiebreakers[1]).toBe(13) // lower pair
      expect(hand.tiebreakers[2]).toBe(12) // Q kicker
    })

    it('evaluates three of a kind correctly', () => {
      const hole = [card('A', 'hearts'), card('A', 'diamonds')]
      const board = [card('A', 'clubs'), card('K', 'spades'), card('Q', 'hearts'), card('J', 'diamonds'), card('9', 'clubs')]
      const hand = evaluateBestHand(hole, board)
      expect(hand.category).toBe(3) // THREE_OF_A_KIND
      expect(hand.tiebreakers[0]).toBe(14) // trips rank
      expect(hand.tiebreakers[1]).toBe(13) // K kicker
      expect(hand.tiebreakers[2]).toBe(12) // Q kicker
    })

    it('evaluates straight correctly', () => {
      const hole = [card('A', 'hearts'), card('K', 'diamonds')]
      const board = [card('Q', 'clubs'), card('J', 'spades'), card('10', 'hearts'), card('9', 'diamonds'), card('2', 'clubs')]
      const hand = evaluateBestHand(hole, board)
      expect(hand.category).toBe(4) // STRAIGHT
      expect(hand.tiebreakers[0]).toBe(14) // A-high straight
    })

    it('evaluates wheel (A-2-3-4-5) straight correctly', () => {
      const hole = [card('A', 'hearts'), card('2', 'diamonds')]
      const board = [card('3', 'clubs'), card('4', 'spades'), card('5', 'hearts'), card('K', 'diamonds'), card('Q', 'clubs')]
      const hand = evaluateBestHand(hole, board)
      expect(hand.category).toBe(4) // STRAIGHT
      expect(hand.tiebreakers[0]).toBe(5) // Wheel is 5-high
    })

    it('evaluates flush correctly', () => {
      const hole = [card('A', 'hearts'), card('K', 'hearts')]
      const board = [card('Q', 'hearts'), card('J', 'hearts'), card('9', 'hearts'), card('7', 'diamonds'), card('5', 'clubs')]
      const hand = evaluateBestHand(hole, board)
      expect(hand.category).toBe(5) // FLUSH
      expect(hand.tiebreakers[0]).toBe(14) // A high
      expect(hand.tiebreakers[1]).toBe(13) // K
      expect(hand.tiebreakers[2]).toBe(12) // Q
      expect(hand.tiebreakers[3]).toBe(11) // J
      expect(hand.tiebreakers[4]).toBe(9) // 9
    })

    it('evaluates full house correctly', () => {
      const hole = [card('A', 'hearts'), card('A', 'diamonds')]
      const board = [card('A', 'clubs'), card('K', 'spades'), card('K', 'hearts'), card('Q', 'diamonds'), card('J', 'clubs')]
      const hand = evaluateBestHand(hole, board)
      expect(hand.category).toBe(6) // FULL_HOUSE
      expect(hand.tiebreakers[0]).toBe(14) // trips
      expect(hand.tiebreakers[1]).toBe(13) // pair
    })

    it('evaluates four of a kind correctly', () => {
      const hole = [card('A', 'hearts'), card('A', 'diamonds')]
      const board = [card('A', 'clubs'), card('A', 'spades'), card('K', 'hearts'), card('Q', 'diamonds'), card('J', 'clubs')]
      const hand = evaluateBestHand(hole, board)
      expect(hand.category).toBe(7) // FOUR_OF_A_KIND
      expect(hand.tiebreakers[0]).toBe(14) // quads
      expect(hand.tiebreakers[1]).toBe(13) // K kicker
    })

    it('evaluates straight flush correctly', () => {
      const hole = [card('A', 'hearts'), card('K', 'hearts')]
      const board = [card('Q', 'hearts'), card('J', 'hearts'), card('10', 'hearts'), card('9', 'diamonds'), card('8', 'clubs')]
      const hand = evaluateBestHand(hole, board)
      expect(hand.category).toBe(8) // STRAIGHT_FLUSH
      expect(hand.tiebreakers[0]).toBe(14) // A-high straight flush
    })

    it('evaluates wheel straight flush correctly', () => {
      const hole = [card('A', 'hearts'), card('2', 'hearts')]
      const board = [card('3', 'hearts'), card('4', 'hearts'), card('5', 'hearts'), card('K', 'diamonds'), card('Q', 'clubs')]
      const hand = evaluateBestHand(hole, board)
      expect(hand.category).toBe(8) // STRAIGHT_FLUSH
      expect(hand.tiebreakers[0]).toBe(5) // Wheel
    })

    it('picks best 5-card hand from 7 cards', () => {
      // This hand has both a straight flush and a regular flush
      const hole = [card('A', 'hearts'), card('K', 'hearts')]
      const board = [card('Q', 'hearts'), card('J', 'hearts'), card('10', 'hearts'), card('9', 'spades'), card('8', 'diamonds')]
      const hand = evaluateBestHand(hole, board)
      expect(hand.category).toBe(8) // Should pick the straight flush: A-K-Q-J-10 all hearts
    })

    it('handles kicker comparisons in pairs correctly', () => {
      const hole1 = [card('A', 'hearts'), card('K', 'diamonds')]
      const board1 = [card('A', 'clubs'), card('Q', 'spades'), card('J', 'hearts'), card('10', 'diamonds'), card('9', 'clubs')]
      const hand1 = evaluateBestHand(hole1, board1)

      const hole2 = [card('A', 'hearts'), card('8', 'diamonds')]
      const board2 = [card('A', 'clubs'), card('Q', 'spades'), card('J', 'hearts'), card('10', 'diamonds'), card('9', 'clubs')]
      const hand2 = evaluateBestHand(hole2, board2)

      // Both have A-A pair, but hand1 has K kicker while hand2 has 8 kicker
      expect(compareRanks(hand1, hand2)).toBeGreaterThan(0) // hand1 is better
    })
  })

  describe('compareRanks', () => {
    it('correctly ranks different hand categories', () => {
      const highCard = { category: 0, tiebreakers: [14, 13, 12, 11, 10] }
      const pair = { category: 1, tiebreakers: [14, 13, 12, 11] }
      const twoPair = { category: 2, tiebreakers: [14, 13, 12] }

      expect(compareRanks(pair, highCard)).toBeGreaterThan(0)
      expect(compareRanks(twoPair, pair)).toBeGreaterThan(0)
      expect(compareRanks(highCard, pair)).toBeLessThan(0)
    })

    it('correctly ranks same category with different tiebreakers', () => {
      const pair1 = { category: 1, tiebreakers: [14, 13, 12, 11] } // A pair with K-Q-J kickers
      const pair2 = { category: 1, tiebreakers: [14, 13, 12, 10] } // A pair with K-Q-10 kickers

      expect(compareRanks(pair1, pair2)).toBeGreaterThan(0)
      expect(compareRanks(pair2, pair1)).toBeLessThan(0)
    })

    it('detects exact ties', () => {
      const hand1 = { category: 1, tiebreakers: [14, 13, 12, 11] }
      const hand2 = { category: 1, tiebreakers: [14, 13, 12, 11] }

      expect(compareRanks(hand1, hand2)).toBe(0)
    })
  })

  describe('ranksEqual', () => {
    it('returns true for identical ranks', () => {
      const hand1 = { category: 1, tiebreakers: [14, 13, 12, 11] }
      const hand2 = { category: 1, tiebreakers: [14, 13, 12, 11] }

      expect(ranksEqual(hand1, hand2)).toBe(true)
    })

    it('returns false for different ranks', () => {
      const hand1 = { category: 1, tiebreakers: [14, 13, 12, 11] }
      const hand2 = { category: 1, tiebreakers: [14, 13, 12, 10] }

      expect(ranksEqual(hand1, hand2)).toBe(false)
    })
  })
})
