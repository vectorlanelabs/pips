import { describe, it, expect } from 'vitest'
import { createBlackjackGame, shouldReshuffleBefore } from './state.ts'

describe('Blackjack state', () => {
  describe('createBlackjackGame', () => {
    it('initializes with correct number of cards', () => {
      const game = createBlackjackGame(['player1', 'player2'], 12345)
      expect(game.shoe.length).toBe(312) // 6 decks * 52 cards
    })

    it('gives each player starting chips', () => {
      const players = ['player1', 'player2', 'player3']
      const game = createBlackjackGame(players, 12345)
      for (const player of players) {
        expect(game.session.publicState.chips[player]).toBe(1000)
      }
    })

    it('sets initial state correctly', () => {
      const game = createBlackjackGame(['p1', 'p2'], 12345)
      const publicState = game.session.publicState
      expect(publicState.turn.phase).toBe('betting')
      expect(publicState.roundNumber).toBe(1)
      expect(publicState.dealerHoleRevealed).toBe(false)
      expect(publicState.roundResults).toBe(null)
      expect(publicState.seatOrder).toEqual(['p1', 'p2'])
    })

    it('initializes hands as empty', () => {
      const game = createBlackjackGame(['p1', 'p2'], 12345)
      const publicState = game.session.publicState
      expect(publicState.hands['p1']).toEqual([])
      expect(publicState.hands['p2']).toEqual([])
    })

    it('initializes bets as zero', () => {
      const game = createBlackjackGame(['p1', 'p2'], 12345)
      const publicState = game.session.publicState
      expect(publicState.bets['p1']).toBe(0)
      expect(publicState.bets['p2']).toBe(0)
    })

    it('initializes insurance bets as zero', () => {
      const game = createBlackjackGame(['p1', 'p2'], 12345)
      const publicState = game.session.publicState
      expect(publicState.insuranceBets['p1']).toBe(0)
      expect(publicState.insuranceBets['p2']).toBe(0)
    })

    it('initializes sitting out as false', () => {
      const game = createBlackjackGame(['p1', 'p2'], 12345)
      const publicState = game.session.publicState
      expect(publicState.sittingOut['p1']).toBe(false)
      expect(publicState.sittingOut['p2']).toBe(false)
    })

    it('has private state for each player', () => {
      const game = createBlackjackGame(['p1', 'p2'], 12345)
      expect(game.session.privateStates['p1']).toBeDefined()
      expect(game.session.privateStates['p2']).toBeDefined()
    })
  })

  describe('shouldReshuffleBefore', () => {
    it('returns true when shoe < 78 cards', () => {
      expect(shouldReshuffleBefore(77)).toBe(true)
      expect(shouldReshuffleBefore(50)).toBe(true)
      expect(shouldReshuffleBefore(0)).toBe(true)
    })

    it('returns false when shoe >= 78 cards', () => {
      expect(shouldReshuffleBefore(78)).toBe(false)
      expect(shouldReshuffleBefore(100)).toBe(false)
      expect(shouldReshuffleBefore(312)).toBe(false)
    })

    it('threshold is exactly 78 (1/4 of 312)', () => {
      // 0.25 * 312 = 78
      expect(shouldReshuffleBefore(78)).toBe(false)
      expect(shouldReshuffleBefore(77)).toBe(true)
    })
  })
})
