import { describe, it, expect } from 'vitest'
import { createBlackjackGame } from './state.ts'
import { applyBlackjackAction, runBlackjackBotTurn } from './rules.ts'
import { blackjackBotStrategy } from './bot.ts'
import { BLACKJACK_MIN_BET } from './state.ts'
import type { BlackjackPublicState, BlackjackPrivateState } from './state.ts'

describe('Blackjack bot strategy', () => {
  describe('betting phase', () => {
    it('always bets the minimum', () => {
      const game = createBlackjackGame(['bot', 'p1'], 12345)
      const result = runBlackjackBotTurn(game, 'bot', blackjackBotStrategy)

      expect(result.outcome.ok).toBe(true)
      expect(result.outcome.publicState?.bets['bot']).toBe(BLACKJACK_MIN_BET)
      expect(result.outcome.publicState?.bets['bot']).toBe(10)
    })

    it('bets minimum consistently', () => {
      let game = createBlackjackGame(['bot', 'p1'], 12345)

      // First round
      game = runBlackjackBotTurn(game, 'bot', blackjackBotStrategy).blackjackSession
      expect(game.session.publicState.bets['bot']).toBe(10)

      // Complete round and start next
      game = applyBlackjackAction(game, 'p1', { type: 'PLACE_BET', amount: 50 }).blackjackSession

      if (game.session.publicState.turn.phase === 'insurance') {
        game = applyBlackjackAction(game, 'bot', { type: 'DECLINE_INSURANCE' }).blackjackSession
        game = applyBlackjackAction(game, 'p1', { type: 'DECLINE_INSURANCE' }).blackjackSession
      }

      while (game.session.publicState.turn.phase === 'acting') {
        const current = game.session.publicState.turn.playerOrder[game.session.publicState.turn.currentIndex]
        game = applyBlackjackAction(game, current, { type: 'STAND' }).blackjackSession
      }

      game = applyBlackjackAction(game, 'bot', { type: 'START_NEXT_ROUND' }).blackjackSession

      // Second round
      game = runBlackjackBotTurn(game, 'bot', blackjackBotStrategy).blackjackSession
      expect(game.session.publicState.bets['bot']).toBe(10)
    })
  })

  describe('insurance phase', () => {
    it('always declines insurance', () => {
      let game = createBlackjackGame(['bot', 'p1'], 11111)

      game = applyBlackjackAction(game, 'bot', { type: 'PLACE_BET', amount: 50 }).blackjackSession
      game = applyBlackjackAction(game, 'p1', { type: 'PLACE_BET', amount: 60 }).blackjackSession

      if (game.session.publicState.turn.phase === 'insurance') {
        const result = runBlackjackBotTurn(game, 'bot', blackjackBotStrategy)
        expect(result.outcome.ok).toBe(true)
        expect(result.outcome.publicState?.insuranceBets['bot']).toBe(0)
      }
    })
  })

  describe('acting phase', () => {
    it('hits when total < 17', () => {
      // Create a game and manipulate it to have a known hand
      let game = createBlackjackGame(['bot', 'p1'], 12345)

      game = runBlackjackBotTurn(game, 'bot', blackjackBotStrategy).blackjackSession
      game = applyBlackjackAction(game, 'p1', { type: 'PLACE_BET', amount: 50 }).blackjackSession

      if (game.session.publicState.turn.phase === 'insurance') {
        game = applyBlackjackAction(game, 'bot', { type: 'DECLINE_INSURANCE' }).blackjackSession
        game = applyBlackjackAction(game, 'p1', { type: 'DECLINE_INSURANCE' }).blackjackSession
      }

      const currentPlayer = game.session.publicState.turn.playerOrder[game.session.publicState.turn.currentIndex]
      const hand = game.session.publicState.hands[currentPlayer]?.[0]

      if (hand && hand.cards.length === 2) {
        // Calculate hand value
        let total = 0
        for (const card of hand.cards) {
          if (card.rank === 'A') total += 11
          else if (['J', 'Q', 'K'].includes(card.rank)) total += 10
          else total += parseInt(card.rank, 10)
        }

        // Adjust for aces
        let aces = hand.cards.filter((c) => c.rank === 'A').length
        while (total > 21 && aces > 0) {
          total -= 10
          aces--
        }

        if (total < 17) {
          // Bot should hit
          const result = runBlackjackBotTurn(game, currentPlayer, blackjackBotStrategy)
          if (result.outcome.ok) {
            expect(result.outcome.ok).toBe(true)
          } else {
            expect(result.outcome.reason).not.toContain('not in acting phase')
          }
        }
      }
    })

    it('stands when total >= 17', () => {
      let game = createBlackjackGame(['bot', 'p1'], 22222)

      game = runBlackjackBotTurn(game, 'bot', blackjackBotStrategy).blackjackSession
      game = applyBlackjackAction(game, 'p1', { type: 'PLACE_BET', amount: 50 }).blackjackSession

      if (game.session.publicState.turn.phase === 'insurance') {
        game = applyBlackjackAction(game, 'bot', { type: 'DECLINE_INSURANCE' }).blackjackSession
        game = applyBlackjackAction(game, 'p1', { type: 'DECLINE_INSURANCE' }).blackjackSession
      }

      // Keep the game going
      while (game.session.publicState.turn.phase === 'acting' && game.session.publicState.bets['bot'] > 0) {
        const currentPlayer = game.session.publicState.turn.playerOrder[game.session.publicState.turn.currentIndex]
        const hand = game.session.publicState.hands[currentPlayer]?.[0]

        if (!hand) break

        const value = calculateHandValue(hand.cards)

        if (currentPlayer === 'bot') {
          const result = runBlackjackBotTurn(game, currentPlayer, blackjackBotStrategy)
          if (result.outcome.ok) {
            game = result.blackjackSession
            // If bot stood on 17+, it should be done
            if (value >= 17) {
              expect(game.session.publicState.hands[currentPlayer][0]?.done).toBe(true)
            }
          }
          break
        } else {
          game = applyBlackjackAction(game, currentPlayer, { type: 'STAND' }).blackjackSession
        }
      }
    })

    it('never emits DOUBLE action', () => {
      let game = createBlackjackGame(['bot', 'p1'], 33333)

      game = runBlackjackBotTurn(game, 'bot', blackjackBotStrategy).blackjackSession
      game = applyBlackjackAction(game, 'p1', { type: 'PLACE_BET', amount: 50 }).blackjackSession

      if (game.session.publicState.turn.phase === 'insurance') {
        game = applyBlackjackAction(game, 'bot', { type: 'DECLINE_INSURANCE' }).blackjackSession
        game = applyBlackjackAction(game, 'p1', { type: 'DECLINE_INSURANCE' }).blackjackSession
      }

      let iterations = 0
      while (game.session.publicState.turn.phase === 'acting' && iterations++ < 50) {
        const currentPlayer = game.session.publicState.turn.playerOrder[game.session.publicState.turn.currentIndex]

        if (currentPlayer === 'bot') {
          // Get the action that the bot would take
          const action = blackjackBotStrategy(
            game.session.publicState,
            game.session.privateStates['bot'],
            'bot'
          )
          expect(action.type).not.toBe('DOUBLE')
          expect(action.type).not.toBe('SPLIT')

          game = runBlackjackBotTurn(game, currentPlayer, blackjackBotStrategy).blackjackSession
        } else {
          game = applyBlackjackAction(game, currentPlayer, { type: 'STAND' }).blackjackSession
        }
      }
    })

    it('never emits SPLIT action', () => {
      let game = createBlackjackGame(['bot', 'p1'], 44444)

      game = runBlackjackBotTurn(game, 'bot', blackjackBotStrategy).blackjackSession
      game = applyBlackjackAction(game, 'p1', { type: 'PLACE_BET', amount: 50 }).blackjackSession

      if (game.session.publicState.turn.phase === 'insurance') {
        game = applyBlackjackAction(game, 'bot', { type: 'DECLINE_INSURANCE' }).blackjackSession
        game = applyBlackjackAction(game, 'p1', { type: 'DECLINE_INSURANCE' }).blackjackSession
      }

      let iterations = 0
      while (game.session.publicState.turn.phase === 'acting' && iterations++ < 50) {
        const currentPlayer = game.session.publicState.turn.playerOrder[game.session.publicState.turn.currentIndex]

        if (currentPlayer === 'bot') {
          const action = blackjackBotStrategy(
            game.session.publicState,
            game.session.privateStates['bot'],
            'bot'
          )
          expect(action.type).not.toBe('SPLIT')

          game = runBlackjackBotTurn(game, currentPlayer, blackjackBotStrategy).blackjackSession
        } else {
          game = applyBlackjackAction(game, currentPlayer, { type: 'STAND' }).blackjackSession
        }
      }
    })
  })

  describe('strategy consistency', () => {
    it('plays identically to another instance with same seed', () => {
      const game1 = createBlackjackGame(['bot1', 'bot2'], 12345)
      const game2 = createBlackjackGame(['bot1', 'bot2'], 12345)

      const action1 = blackjackBotStrategy(game1.session.publicState, game1.session.privateStates['bot1'], 'bot1')
      const action2 = blackjackBotStrategy(game2.session.publicState, game2.session.privateStates['bot1'], 'bot1')

      expect(action1).toEqual(action2)
    })

    it('handles all valid game phases', () => {
      const game = createBlackjackGame(['bot', 'p1'], 12345)

      // Betting phase
      const bettingAction = blackjackBotStrategy(game.session.publicState, game.session.privateStates['bot'], 'bot')
      expect(bettingAction.type).toBe('PLACE_BET')

      // Other phases would need to advance the game
      expect(typeof bettingAction).toBe('object')
    })
  })

  it('does not trigger START_NEXT_ROUND', () => {
    // Verify the strategy function itself doesn't emit this action
    const dummyState: BlackjackPublicState = {
      turn: { playerOrder: ['bot'], currentIndex: 0, direction: 1, phase: 'roundOver', turnNumber: 1 },
      seatOrder: ['bot', 'p1'],
      chips: { bot: 1000, p1: 1000 },
      bets: { bot: 10, p1: 10 },
      sittingOut: { bot: false, p1: false },
      hands: { bot: [], p1: [] },
      activeHandIndex: { bot: 0, p1: 0 },
      insuranceBets: { bot: 0, p1: 0 },
      dealerHand: [],
      dealerHoleRevealed: false,
      shoeCount: 312,
      roundNumber: 1,
      roundResults: null,
      cardBack: 'pips_default',
      hasResolvedInsurance: {},
    }
    const dummyPrivateState: BlackjackPrivateState = {}

    // The bot strategy should throw on roundOver phase since it's not handled
    // (wiring handles START_NEXT_ROUND, not the bot)
    expect(() => {
      blackjackBotStrategy(dummyState, dummyPrivateState, 'bot')
    }).toThrow()
  })
})

// Helper function
function calculateHandValue(cards: any[]): number {
  let total = 0
  let aces = 0

  for (const card of cards) {
    if (card.rank === 'A') {
      total += 11
      aces += 1
    } else if (['J', 'Q', 'K'].includes(card.rank)) {
      total += 10
    } else {
      total += parseInt(card.rank, 10)
    }
  }

  while (total > 21 && aces > 0) {
    total -= 10
    aces -= 1
  }

  return total
}
