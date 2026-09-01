import { describe, it, expect } from 'vitest'
import { createPokerGame, isDrawVariant } from './state.ts'
import { applyPokerAction, runPokerBotTurn } from './rules.ts'
import { evaluateOmahaHand, compareRanks } from './hand-eval.ts'
import { pokerBotStrategy, getOmahaPreflopStrength, getOmahaPostflopStrength } from './bot.ts'
import type { Card } from '../../card-engine/cards.ts'

function card(rank: string, suit: string): Card {
  return { id: `${rank}${suit}`, rank, suit, deckIndex: 0 }
}

describe('omaha', () => {
  describe('evaluateOmahaHand', () => {
    it('does NOT award a flush when the hole holds only one card of the board suit', () => {
      // Board has four hearts and one spade; the hole has exactly ONE heart.
      // Exactly-two-hole-cards means a five-heart hand needs two hole hearts,
      // so no flush may be awarded -- the classic Omaha gotcha.
      const hole = [card('3', 'hearts'), card('5', 'diamonds'), card('7', 'clubs'), card('9', 'spades')]
      const board = [card('A', 'hearts'), card('K', 'hearts'), card('Q', 'hearts'), card('J', 'hearts'), card('2', 'spades')]
      const hand = evaluateOmahaHand(hole, board)
      expect(hand.category).not.toBe(5) // FLUSH
      expect(hand.category).toBe(0) // HIGH_CARD -- nothing else connects
    })

    it('DOES award a flush when the hole holds two cards of the board suit', () => {
      // Companion to the gotcha: two hearts in the hole + three hearts on the
      // board is exactly two + three, so the flush is real.
      const hole = [card('3', 'hearts'), card('5', 'hearts'), card('7', 'diamonds'), card('9', 'clubs')]
      const board = [card('A', 'hearts'), card('K', 'hearts'), card('Q', 'hearts'), card('J', 'diamonds'), card('2', 'spades')]
      const hand = evaluateOmahaHand(hole, board)
      expect(hand.category).toBe(5) // FLUSH
      expect(hand.tiebreakers[0]).toBe(14) // A-high flush
    })

    it('does not award a straight built from four board cards (exactly-3 rule)', () => {
      // Board 5,6,7,8 + 2; hole holds a 9 and nothing else connecting. With
      // four board cards usable, 5-6-7-8-9 would be a straight -- Omaha's
      // exactly-three-board rule forbids it, so the actual best hand is just
      // high card A.
      const hole = [card('9', 'clubs'), card('A', 'diamonds'), card('K', 'hearts'), card('Q', 'spades')]
      const board = [card('5', 'clubs'), card('6', 'diamonds'), card('7', 'hearts'), card('8', 'spades'), card('2', 'clubs')]
      const hand = evaluateOmahaHand(hole, board)
      expect(hand.category).not.toBe(4) // STRAIGHT
      expect(hand.category).toBe(0) // HIGH_CARD
    })

    it('throws on the wrong number of hole cards', () => {
      const board = [card('5', 'clubs'), card('6', 'diamonds'), card('7', 'hearts'), card('8', 'spades'), card('2', 'clubs')]
      expect(() => evaluateOmahaHand([card('A', 'hearts'), card('K', 'hearts'), card('Q', 'hearts')], board)).toThrow('Omaha needs exactly 4 hole cards')
    })

    it('throws on an incomplete board', () => {
      const hole = [card('9', 'clubs'), card('A', 'diamonds'), card('K', 'hearts'), card('Q', 'spades')]
      const board = [card('5', 'clubs'), card('6', 'diamonds'), card('7', 'hearts'), card('8', 'spades')]
      expect(() => evaluateOmahaHand(hole, board)).toThrow('Cannot evaluate hand until all board cards are known')
    })
  })

  describe('isDrawVariant', () => {
    it('false for board variants, true for draw variants', () => {
      expect(isDrawVariant('holdem')).toBe(false)
      expect(isDrawVariant('omaha')).toBe(false)
      expect(isDrawVariant('five-draw')).toBe(true)
      expect(isDrawVariant('seven-draw')).toBe(true)
    })
  })

  describe('dealing', () => {
    it('omaha deal: 4 private cards each, preflop phase, blinds posted, action left of BB', () => {
      const game = createPokerGame(['p1', 'p2', 'p3'], 42, 'pips_default', 'omaha')
      const state = game.session.publicState

      expect(state.variant).toBe('omaha')
      expect(state.turn.phase).toBe('preflop')
      // 3 players: p1 button, p2 small blind, p3 big blind.
      expect(state.smallBlindSeat).toBe('p2')
      expect(state.bigBlindSeat).toBe('p3')
      expect(state.pot).toBe(15)
      expect(state.chips['p1']).toBe(1000)
      expect(state.chips['p2']).toBe(995)
      expect(state.chips['p3']).toBe(990)
      expect(state.board).toHaveLength(0)

      // 4 private cards per seat; public hand stays empty until showdown.
      for (const seatId of ['p1', 'p2', 'p3']) {
        expect(game.session.privateStates[seatId].hand).toHaveLength(4)
        expect(state.hands[seatId].cards).toHaveLength(0)
        expect(state.drawnCounts[seatId]).toBeNull()
      }
      expect(game.deck).toHaveLength(40) // 52 - 3*4 dealt

      // Action starts left of the big blind (p3), exactly like holdem preflop.
      expect(state.turn.playerOrder).toEqual(['p1', 'p2', 'p3'])
      expect(state.turn.playerOrder[state.turn.currentIndex]).toBe('p1')
    })
  })

  describe('full hand', () => {
    it('scripted calls/checks through all four streets to showdown: board to 5, exact chips, conservation, winner really best', () => {
      let game = createPokerGame(['p1', 'p2', 'p3'], 42, 'pips_default', 'omaha')
      let state = game.session.publicState

      // Preflop: [p1, p2, p3] -- p1 and p2 call the BB's 10, p3 (BB) checks.
      expect(state.turn.playerOrder[state.turn.currentIndex]).toBe('p1')
      let r = applyPokerAction(game, 'p1', { type: 'CALL' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      expect(state.pot).toBe(25)

      r = applyPokerAction(game, 'p2', { type: 'CALL' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!

      r = applyPokerAction(game, 'p3', { type: 'CHECK' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!

      // Flop dealt, pot settled at 30.
      expect(state.turn.phase).toBe('flop')
      expect(state.board).toHaveLength(3)
      expect(state.pot).toBe(30)

      // Flop, turn, river all check around [p2, p3, p1] to showdown.
      let guard = 0
      while (state.turn.phase !== 'showdown' && !state.handOver && guard < 20) {
        guard++
        const actor = state.turn.playerOrder[state.turn.currentIndex]
        const facingBet = state.currentBetThisStreet > state.hands[actor].betThisStreet
        r = applyPokerAction(game, actor, facingBet ? { type: 'CALL' } : { type: 'CHECK' })
        expect(r.outcome.ok).toBe(true)
        game = r.holdemSession
        state = r.outcome.publicState!
      }
      expect(state.turn.phase).toBe('showdown')
      expect(state.handOver).toBe(true)

      // Board ran out to 5 cards; everyone contributed exactly 10.
      expect(state.board).toHaveLength(5)
      expect(state.pot).toBe(30)

      const potBreakdown = state.handResults!.potBreakdown
      expect(potBreakdown).toHaveLength(1)
      expect(potBreakdown[0].amount).toBe(30)
      expect(potBreakdown[0].eligiblePlayerIds).toEqual(['p1', 'p2', 'p3'])

      // Exact chip trajectory: 1000 - 10 each, then the 30 pot to the winner.
      const winners = state.handResults!.winners
      const awarded: Record<string, number> = {}
      for (const w of winners) awarded[w.playerId] = (awarded[w.playerId] ?? 0) + w.amount
      expect(Object.values(awarded).reduce((a, b) => a + b, 0)).toBe(30)
      for (const seatId of ['p1', 'p2', 'p3']) {
        expect(state.chips[seatId]).toBe(990 + (awarded[seatId] ?? 0))
      }
      expect(state.chips['p1'] + state.chips['p2'] + state.chips['p3']).toBe(3000)

      // Every revealed hand is 4 cards; the winner's exactly-2-hole +
      // exactly-3-board hand beats or ties every other revealed hand.
      for (const seatId of ['p1', 'p2', 'p3']) {
        expect(state.hands[seatId].cards).toHaveLength(4)
      }
      const winnerEval = evaluateOmahaHand(state.hands[winners[0].playerId].cards, state.board)
      for (const seatId of ['p1', 'p2', 'p3']) {
        expect(compareRanks(winnerEval, evaluateOmahaHand(state.hands[seatId].cards, state.board))).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('DRAW action validation', () => {
    it('rejects DRAW in omaha', () => {
      const game = createPokerGame(['p1', 'p2'], 42, 'pips_default', 'omaha')
      const state = game.session.publicState
      const actor = state.turn.playerOrder[state.turn.currentIndex]
      const r = applyPokerAction(game, actor, { type: 'DRAW', discardIds: [] })
      expect(r.outcome.ok).toBe(false)
      expect(r.outcome.reason).toBe('this poker variant has no draw round')
    })
  })

  describe('omaha bot strength', () => {
    it('a double-paired hole is premium preflop', () => {
      const hole = [card('A', 'hearts'), card('A', 'diamonds'), card('K', 'spades'), card('K', 'clubs')]
      expect(getOmahaPreflopStrength(hole)).toBe('premium')
    })

    it('a rainbow unpaired no-AK hole is weak preflop', () => {
      const hole = [card('2', 'hearts'), card('5', 'diamonds'), card('9', 'spades'), card('Q', 'clubs')]
      expect(getOmahaPreflopStrength(hole)).toBe('weak')
    })

    it('a lone suited hole card is NOT an Omaha flush draw', () => {
      // Exactly-two-hole rule: one heart in the hole cannot combine with the
      // board into a five-card flush, so the bot must not read 'medium' here.
      const hole = [card('3', 'hearts'), card('5', 'diamonds'), card('7', 'clubs'), card('9', 'spades')]
      const board = [card('A', 'hearts'), card('K', 'hearts'), card('2', 'clubs')]
      expect(getOmahaPostflopStrength(hole, board)).not.toBe('medium')
      expect(getOmahaPostflopStrength(hole, board)).toBe('weak')
    })

    it('a suited hole PAIR with two matching board cards IS an Omaha flush draw', () => {
      const hole = [card('3', 'hearts'), card('5', 'hearts'), card('7', 'diamonds'), card('9', 'clubs')]
      const board = [card('A', 'hearts'), card('K', 'hearts'), card('2', 'spades')]
      expect(getOmahaPostflopStrength(hole, board)).toBe('medium')
    })

    it('a made pair on a complete board is strong postflop', () => {
      const hole = [card('9', 'hearts'), card('9', 'diamonds'), card('7', 'clubs'), card('2', 'spades')]
      const board = [card('A', 'hearts'), card('K', 'clubs'), card('5', 'diamonds'), card('8', 'spades'), card('3', 'hearts')]
      expect(getOmahaPostflopStrength(hole, board)).toBe('strong')
    })

    it('bot calls a bet with an Omaha flush draw and folds without one', () => {
      // Wiring check: 'medium' and 'weak' must reach the holdem postflop
      // action table as CALL and FOLD respectively when facing a bet.
      const game = createPokerGame(['p1', 'p2'], 42, 'pips_default', 'omaha')
      const pubState = {
        ...game.session.publicState,
        turn: { ...game.session.publicState.turn, phase: 'flop' as const },
        board: [card('A', 'hearts'), card('K', 'hearts'), card('2', 'spades')],
        currentBetThisStreet: 20, // p1 has only the SB's 5 in this street
      }
      const drawHole = [card('3', 'hearts'), card('5', 'hearts'), card('7', 'diamonds'), card('9', 'clubs')]
      expect(pokerBotStrategy(pubState, { hand: drawHole }, 'p1')).toEqual({ type: 'CALL' })

      const noDrawHole = [card('3', 'hearts'), card('5', 'diamonds'), card('7', 'clubs'), card('9', 'spades')]
      expect(pokerBotStrategy(pubState, { hand: noDrawHole }, 'p1')).toEqual({ type: 'FOLD' })
    })
  })

  describe('omaha full-match sweeps', () => {
    // Same harness as the draw sweeps in bot.test.ts: whole matches played by
    // the bot strategy alone. Every action the bot emits must validate, and
    // the game must progress -- either to a genuine table winner (which can
    // legitimately happen well before 15 hands) or past 15 hands.
    for (const seed of [11, 22, 33]) {
      it(`omaha seed ${seed}: every action validates and the game progresses`, () => {
        let game = createPokerGame(['p1', 'p2', 'p3', 'p4'], seed, 'pips_default', 'omaha')
        let state = game.session.publicState
        let actions = 0

        while (!state.gameOverWinnerId && actions < 4000) {
          if (state.handOver) {
            const r = applyPokerAction(game, state.seatOrder[0], { type: 'START_NEXT_HAND' })
            expect(r.outcome.ok, `hand ${state.handNumber} START_NEXT_HAND: ${r.outcome.reason}`).toBe(true)
            game = r.holdemSession
            state = r.outcome.publicState!
            actions++
            continue
          }

          // A live betting phase always has an actor; if this ever fails the
          // game is stuck and the sweep must fail loudly, not crash.
          expect(state.turn.playerOrder.length).toBeGreaterThan(0)
          const actor = state.turn.playerOrder[state.turn.currentIndex]
          const r = runPokerBotTurn(game, actor, pokerBotStrategy)
          expect(r.outcome.ok, `hand ${state.handNumber} phase ${state.turn.phase} actor ${actor}: ${r.outcome.reason}`).toBe(true)
          game = r.holdemSession
          state = r.outcome.publicState!
          actions++
        }

        if (state.gameOverWinnerId === null) {
          expect(state.handNumber).toBeGreaterThan(15)
        }
      })
    }
  })

  describe('omaha preflop short-stack guard', () => {
    it('premium 4-card hole facing a bet beyond its stack calls (all-in), never raises', () => {
      // A-A-K-K double pair -- omaha preflop premium (mirrors the holdem
      // pocket-aces guard in bot.test.ts), and reRaiseEligible stays true, so
      // the only thing that can stop a RAISE is the affordability guard.
      const premiumHole = [card('A', 'hearts'), card('A', 'diamonds'), card('K', 'spades'), card('K', 'clubs')]
      expect(getOmahaPreflopStrength(premiumHole)).toBe('premium')

      // Fresh heads-up omaha: p1 is the small blind, so chips[p1] = 995 and
      // betThisStreet = 5 -> playerChips + playerBetThisStreet = 1000.
      const game = createPokerGame(['p1', 'p2'], 42, 'pips_default', 'omaha')
      const pubState = {
        ...game.session.publicState,
        turn: { ...game.session.publicState.turn, phase: 'preflop' as const },
        // A bet no one can cover: any RAISE a short stack could emit collapses
        // to <= currentBet and the validator would reject it.
        currentBetThisStreet: 1200,
        reRaiseEligible: { ...game.session.publicState.reRaiseEligible, p1: true },
      }

      const action = pokerBotStrategy(pubState, { hand: premiumHole }, 'p1')
      expect(action).toEqual({ type: 'CALL' })
    })
  })
})
