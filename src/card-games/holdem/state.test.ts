import { describe, it, expect } from 'vitest'
import { createHoldemGame, HOLDEM_MIN_SEATS, HOLDEM_MAX_SEATS, HOLDEM_SMALL_BLIND, HOLDEM_BIG_BLIND } from './state.ts'

describe('holdem state', () => {
  describe('createHoldemGame', () => {
    it('creates game with correct constants', () => {
      expect(HOLDEM_MIN_SEATS).toBe(2)
      expect(HOLDEM_MAX_SEATS).toBe(8)
      expect(HOLDEM_SMALL_BLIND).toBe(5)
      expect(HOLDEM_BIG_BLIND).toBe(10)
    })

    it('initializes 2-player game correctly', () => {
      const game = createHoldemGame(['p1', 'p2'], 42)

      expect(game.session.publicState.seatOrder).toEqual(['p1', 'p2'])
      // After blinds are posted, chips are reduced: p1 (SB) has 995, p2 (BB) has 990
      expect(game.session.publicState.chips['p1']).toBe(995)
      expect(game.session.publicState.chips['p2']).toBe(990)
      expect(game.session.publicState.eliminated['p1']).toBe(false)
      expect(game.session.publicState.eliminated['p2']).toBe(false)
    })

    it('initializes 3-player game correctly', () => {
      const game = createHoldemGame(['p1', 'p2', 'p3'], 42)

      expect(game.session.publicState.seatOrder).toEqual(['p1', 'p2', 'p3'])
      // Button at p1, SB at p2 (posts 5), BB at p3 (posts 10)
      expect(game.session.publicState.chips['p1']).toBe(1000) // Button, no blind
      expect(game.session.publicState.chips['p2']).toBe(995) // SB
      expect(game.session.publicState.chips['p3']).toBe(990) // BB
      for (const pid of ['p1', 'p2', 'p3']) {
        expect(game.session.publicState.eliminated[pid]).toBe(false)
      }
    })

    it('initializes maxseats game correctly', () => {
      const playerIds = Array.from({ length: HOLDEM_MAX_SEATS }, (_, i) => `p${i + 1}`)
      const game = createHoldemGame(playerIds, 42)

      expect(game.session.publicState.seatOrder).toHaveLength(HOLDEM_MAX_SEATS)
      // Button at first (p1), SB at second (p2, has 995), BB at third (p3, has 990), rest have 1000
      expect(game.session.publicState.chips[playerIds[0]]).toBe(1000) // Button
      expect(game.session.publicState.chips[playerIds[1]]).toBe(995) // SB
      expect(game.session.publicState.chips[playerIds[2]]).toBe(990) // BB
      for (let i = 3; i < playerIds.length; i++) {
        expect(game.session.publicState.chips[playerIds[i]]).toBe(1000)
      }
    })

    it('sets button and blinds correctly in 2-player', () => {
      const game = createHoldemGame(['p1', 'p2'], 42)

      // In heads-up: button = SB, other = BB
      expect(game.session.publicState.buttonSeat).toBe('p1')
      expect(game.session.publicState.smallBlindSeat).toBe('p1')
      expect(game.session.publicState.bigBlindSeat).toBe('p2')
    })

    it('sets button and blinds correctly in 3-player', () => {
      const game = createHoldemGame(['p1', 'p2', 'p3'], 42)

      // Button at first non-eliminated (p1)
      expect(game.session.publicState.buttonSeat).toBe('p1')
      // SB next after button
      expect(game.session.publicState.smallBlindSeat).toBe('p2')
      // BB next after SB
      expect(game.session.publicState.bigBlindSeat).toBe('p3')
    })

    it('posts blinds into pot correctly', () => {
      const game = createHoldemGame(['p1', 'p2'], 42)

      // SB (p1) posts 5: 1000 - 5 = 995
      // BB (p2) posts 10: 1000 - 10 = 990
      // Pot: 5 + 10 = 15
      expect(game.session.publicState.chips['p1']).toBe(995)
      expect(game.session.publicState.chips['p2']).toBe(990)
      expect(game.session.publicState.pot).toBe(15)
    })

    it('deals hole cards privately, never into public state (hole cards must not leak to other peers)', () => {
      const game = createHoldemGame(['p1', 'p2', 'p3'], 42)

      // publicState.hands[id].cards is broadcast to every peer -- it must stay
      // empty until a genuine showdown reveal, or every seat could read every
      // other seat's hole cards straight off the wire.
      for (const pid of ['p1', 'p2', 'p3']) {
        expect(game.session.publicState.hands[pid].cards).toHaveLength(0)
      }

      // The real cards live only in each seat's own private channel.
      expect(game.session.privateStates['p1'].hand).toHaveLength(2)
      expect(game.session.privateStates['p2'].hand).toHaveLength(2)
      expect(game.session.privateStates['p3'].hand).toHaveLength(2)
    })

    it('initializes preflop street correctly', () => {
      const game = createHoldemGame(['p1', 'p2', 'p3'], 42)

      expect(game.session.publicState.turn.phase).toBe('preflop')
      expect(game.session.publicState.turn.playerOrder.length).toBeGreaterThan(0)
    })

    it('initializes hand state for each player', () => {
      const game = createHoldemGame(['p1', 'p2'], 42)

      for (const pid of ['p1', 'p2']) {
        const hand = game.session.publicState.hands[pid]
        expect(hand.folded).toBe(false)
        expect(hand.allIn).toBe(false)
        expect(hand.betThisStreet).toBeGreaterThanOrEqual(0)
        expect(hand.totalContributedThisHand).toBeGreaterThanOrEqual(0)
      }
    })

    it('initializes game state fields', () => {
      const game = createHoldemGame(['p1', 'p2'], 42)
      const state = game.session.publicState

      expect(state.handNumber).toBe(1)
      expect(state.handOver).toBe(false)
      expect(state.handResults).toBe(null)
      expect(state.gameOverWinnerId).toBe(null)
      expect(state.board).toEqual([])
      expect(state.currentBetThisStreet).toBe(HOLDEM_BIG_BLIND)
      expect(state.lastFullRaiseIncrement).toBe(HOLDEM_BIG_BLIND)
    })

    it('all chips accounted for after initialization', () => {
      const playerIds = ['p1', 'p2', 'p3']
      const game = createHoldemGame(playerIds, 42)
      const state = game.session.publicState

      const totalChips = playerIds.reduce((sum, pid) => sum + state.chips[pid], 0) + state.pot

      expect(totalChips).toBe(3000) // 3 * 1000
    })

    it('initializes with different random seeds', () => {
      const game1 = createHoldemGame(['p1', 'p2', 'p3'], 1)
      const game2 = createHoldemGame(['p1', 'p2', 'p3'], 2)

      // Different seeds should produce different shuffles
      // Just verify both games created successfully with different initial states
      expect(game1.session.publicState.handNumber).toBe(game2.session.publicState.handNumber)
    })

    it('card back can be customized', () => {
      const game = createHoldemGame(['p1', 'p2'], 42, 'custom_back')
      expect(game.session.publicState.cardBack).toBe('custom_back')
    })

    it('default card back is pips_default', () => {
      const game = createHoldemGame(['p1', 'p2'], 42)
      expect(game.session.publicState.cardBack).toBe('pips_default')
    })
  })

  describe('hand state tracking', () => {
    it('tracks contributions correctly', () => {
      const game = createHoldemGame(['p1', 'p2'], 42)

      // SB should have 5 contributed
      expect(game.session.publicState.hands[game.session.publicState.smallBlindSeat].totalContributedThisHand).toBe(5)
      // BB should have 10 contributed
      expect(game.session.publicState.hands[game.session.publicState.bigBlindSeat].totalContributedThisHand).toBe(10)
    })

    it('tracks bet this street correctly', () => {
      const game = createHoldemGame(['p1', 'p2'], 42)

      // SB should have 5 bet this street
      expect(game.session.publicState.hands[game.session.publicState.smallBlindSeat].betThisStreet).toBe(5)
      // BB should have 10 bet this street
      expect(game.session.publicState.hands[game.session.publicState.bigBlindSeat].betThisStreet).toBe(10)
    })
  })
})
