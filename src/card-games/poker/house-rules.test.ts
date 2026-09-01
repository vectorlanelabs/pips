import { describe, it, expect } from 'vitest'
import { createPokerGame, DEFAULT_HOUSE_RULES, POKER_ANTE, POKER_BIG_BLIND, type PokerHouseRules } from './state.ts'
import { applyPokerAction, runPokerBotTurn } from './rules.ts'
import { evaluateBestHand, evaluateOmahaHand, compareRanks, type HandRank } from './hand-eval.ts'
import { pokerBotStrategy, drawDiscardAction } from './bot.ts'
import { createRng } from '../../engine/rng.ts'
import { createStandardDeck, shuffleDeck } from '../../card-engine/deck.ts'
import { RANKS, SUITS, type Card } from '../../card-engine/cards.ts'

function card(rank: string, suit: string): Card {
  return { id: `${rank}${suit}`, rank, suit, deckIndex: 0 }
}

// evaluateFiveWithWilds is deliberately NOT exported from hand-eval.ts (it is
// an internal fast path). For an exactly-5-card input with no board,
// evaluateBestHand(cards, [], true) runs that same single-combination call,
// so every wild-hand vector below reaches the fast path through the public
// API it serves.
function evalFiveWithWilds(cards: Card[]): HandRank {
  return evaluateBestHand(cards, [], true)
}

describe('poker house rules', () => {
  describe('deuces wild category ladder', () => {
    it('five of a kind (pair + three 2s) beats a natural straight flush', () => {
      const fiveOfAKind = evalFiveWithWilds([card('A', 'spades'), card('A', 'hearts'), card('2', 'clubs'), card('2', 'diamonds'), card('2', 'hearts')])
      expect(fiveOfAKind.category).toBe(9)
      expect(fiveOfAKind.tiebreakers).toEqual([14])

      const naturalSF = evaluateBestHand([card('A', 'hearts'), card('K', 'hearts'), card('Q', 'hearts'), card('J', 'hearts'), card('10', 'hearts')], [], false)
      expect(naturalSF.category).toBe(8)
      expect(compareRanks(fiveOfAKind, naturalSF)).toBeGreaterThan(0)
    })

    it('wild straight flush (two suited naturals + three 2s in a window) beats natural quads', () => {
      const wildSF = evalFiveWithWilds([card('5', 'hearts'), card('9', 'hearts'), card('2', 'clubs'), card('2', 'diamonds'), card('2', 'hearts')])
      expect(wildSF.category).toBe(8)
      expect(wildSF.tiebreakers).toEqual([9])

      const naturalQuads = evaluateBestHand([card('K', 'spades'), card('K', 'hearts'), card('K', 'diamonds'), card('K', 'clubs'), card('3', 'spades')], [], false)
      expect(naturalQuads.category).toBe(7)
      expect(compareRanks(wildSF, naturalQuads)).toBeGreaterThan(0)
    })
  })

  describe('one wild (w=1)', () => {
    it('one 2 + AAAA -> five of a kind Aces [14]', () => {
      const hand = evalFiveWithWilds([card('A', 'spades'), card('A', 'hearts'), card('A', 'diamonds'), card('A', 'clubs'), card('2', 'spades')])
      expect(hand.category).toBe(9)
      expect(hand.tiebreakers).toEqual([14])
    })

    it('one 2 + AAKK -> the wild is best used as a third Ace: full house [14, 13]', () => {
      const hand = evalFiveWithWilds([card('A', 'spades'), card('A', 'hearts'), card('K', 'diamonds'), card('K', 'clubs'), card('2', 'spades')])
      expect(hand.category).toBe(6)
      expect(hand.tiebreakers).toEqual([14, 13])
    })

    it('one 2 + four same-suit non-window ranks -> flush', () => {
      const hand = evalFiveWithWilds([card('A', 'hearts'), card('K', 'hearts'), card('Q', 'hearts'), card('9', 'hearts'), card('2', 'diamonds')])
      expect(hand.category).toBe(5)
      expect(hand.tiebreakers[0]).toBe(14)
    })

    it('one 2 + four distinct offsuit ranks inside a straight window -> straight', () => {
      const hand = evalFiveWithWilds([card('9', 'spades'), card('8', 'hearts'), card('7', 'diamonds'), card('6', 'clubs'), card('2', 'clubs')])
      expect(hand.category).toBe(4)
      expect(hand.tiebreakers).toEqual([10])
    })
  })

  describe('two wilds (w=2)', () => {
    it('two 2s + AAK -> quads of Aces with K kicker', () => {
      const hand = evalFiveWithWilds([card('A', 'spades'), card('A', 'hearts'), card('K', 'diamonds'), card('2', 'clubs'), card('2', 'spades')])
      expect(hand.category).toBe(7)
      expect(hand.tiebreakers).toEqual([14, 13])
    })

    it('two 2s + three suited cards in a window -> straight flush', () => {
      const hand = evalFiveWithWilds([card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts'), card('2', 'clubs'), card('2', 'spades')])
      expect(hand.category).toBe(8)
      expect(hand.tiebreakers).toEqual([9])
    })
  })

  describe('three wilds (w=3) -- locked rule table', () => {
    it('natural pair -> five of a kind of the pair rank', () => {
      const hand = evalFiveWithWilds([card('A', 'spades'), card('A', 'hearts'), card('2', 'clubs'), card('2', 'diamonds'), card('2', 'hearts')])
      expect(hand.category).toBe(9)
      expect(hand.tiebreakers).toEqual([14])
    })

    it('suited naturals in a straight window -> straight flush with the right top', () => {
      const hand = evalFiveWithWilds([card('5', 'hearts'), card('9', 'hearts'), card('2', 'clubs'), card('2', 'diamonds'), card('2', 'hearts')])
      expect(hand.category).toBe(8)
      expect(hand.tiebreakers).toEqual([9])
    })

    it('suited Ace + 5 -> wheel straight flush, top 5', () => {
      const hand = evalFiveWithWilds([card('A', 'hearts'), card('5', 'hearts'), card('2', 'clubs'), card('2', 'diamonds'), card('2', 'hearts')])
      expect(hand.category).toBe(8)
      expect(hand.tiebreakers).toEqual([5])
    })

    it('suited naturals with no straight window -> quads of the higher natural, lower natural kicker', () => {
      const hand = evalFiveWithWilds([card('A', 'hearts'), card('6', 'hearts'), card('2', 'clubs'), card('2', 'diamonds'), card('2', 'hearts')])
      expect(hand.category).toBe(7)
      expect(hand.tiebreakers).toEqual([14, 6])
    })

    it('offsuit naturals inside a window -> quads + kicker (offsuit kills the straight flush)', () => {
      const hand = evalFiveWithWilds([card('A', 'spades'), card('K', 'diamonds'), card('2', 'clubs'), card('2', 'diamonds'), card('2', 'hearts')])
      expect(hand.category).toBe(7)
      expect(hand.tiebreakers).toEqual([14, 13])
    })

    it('offsuit naturals with no window -> quads of the higher natural, lower natural kicker', () => {
      const hand = evalFiveWithWilds([card('A', 'spades'), card('6', 'diamonds'), card('2', 'clubs'), card('2', 'diamonds'), card('2', 'hearts')])
      expect(hand.category).toBe(7)
      expect(hand.tiebreakers).toEqual([14, 6])
    })
  })

  describe('four wilds (w=4)', () => {
    it('one natural + four 2s -> five of a kind of the natural', () => {
      const hand = evalFiveWithWilds([card('A', 'spades'), card('2', 'clubs'), card('2', 'diamonds'), card('2', 'hearts'), card('2', 'spades')])
      expect(hand.category).toBe(9)
      expect(hand.tiebreakers).toEqual([14])
    })

    it('every possible single natural + the four deuces is five of a kind of that natural (all 48 cases)', () => {
      const deuces = [card('2', 'clubs'), card('2', 'diamonds'), card('2', 'hearts'), card('2', 'spades')]
      const rankValues: Record<string, number> = { '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 }
      for (const rank of RANKS) {
        if (rank === '2') continue
        for (const suit of SUITS) {
          const hand = evalFiveWithWilds([card(rank, suit), ...deuces])
          expect(hand.category).toBe(9)
          expect(hand.tiebreakers).toEqual([rankValues[rank]])
        }
      }
    })
  })

  describe('oracle property (the core proof)', () => {
    // The fast path's w<=2 enumeration is mirrored by a deliberately
    // independent brute-force oracle living in this test file: it enumerates
    // the same 52-assignments-per-wild space on its own and scores every
    // candidate with the non-wild path. Yes, the two implementations mirror
    // each other for w<=2 -- the oracle's value is guarding future edits to
    // the fast path, and it cross-checks the w<=2 path against evaluateHand's
    // five-of-a-kind handling. The w=3 locked rule table gets the same
    // cross-check below (52^3 = 140,608 assignments per hand, so a smaller
    // sample of 10 hands at a 30s budget).
    function buildWildSpace(): Card[] {
      const space: Card[] = []
      for (const rank of RANKS) {
        for (const suit of SUITS) {
          space.push({ id: `oracle-${rank}${suit}`, rank, suit, deckIndex: 0 })
        }
      }
      return space
    }

    function oracleFiveWithWilds(cards: Card[]): HandRank {
      const naturals = cards.filter((c) => c.rank !== '2')
      const w = cards.length - naturals.length
      if (w === 0) return evaluateBestHand(cards, [], false)

      const space = buildWildSpace()
      let best: HandRank | null = null
      const assign = (assignments: Card[], depth: number): void => {
        if (depth === w) {
          const candidate = evaluateBestHand([...naturals, ...assignments], [], false)
          if (best === null || compareRanks(candidate, best) > 0) best = candidate
          return
        }
        for (const wildCard of space) {
          assign([...assignments, wildCard], depth + 1)
        }
      }
      assign([], 0)
      return best!
    }

    function drawFiveCardHands(rng: () => number, count: number, deuceCount: number): Card[][] {
      const hands: Card[][] = []
      let guard = 0
      while (hands.length < count && guard < 200000) {
        guard++
        const deck = shuffleDeck(createStandardDeck(), rng)
        const hand = deck.slice(0, 5)
        if (hand.filter((c) => c.rank === '2').length === deuceCount) {
          hands.push(hand)
        }
      }
      expect(hands).toHaveLength(count)
      return hands
    }

    it('matches an independent brute-force oracle for 400 seeded hands with 1-2 deuces, and equals the non-wild evaluation for 200 deuce-free hands', () => {
      const rng = createRng(12345)

      const oneDeuce = drawFiveCardHands(rng, 200, 1)
      const twoDeuces = drawFiveCardHands(rng, 200, 2)
      for (const hand of [...oneDeuce, ...twoDeuces]) {
        expect(evalFiveWithWilds(hand)).toEqual(oracleFiveWithWilds(hand))
      }

      const noDeuce = drawFiveCardHands(rng, 200, 0)
      for (const hand of noDeuce) {
        expect(evalFiveWithWilds(hand)).toEqual(evaluateBestHand(hand, [], false))
      }
    }, 30000)

    it('matches the brute-force oracle for 10 seeded hands with 3 deuces (the locked rule table)', () => {
      const rng = createRng(54321)
      const threeDeuces = drawFiveCardHands(rng, 10, 3)
      for (const hand of threeDeuces) {
        expect(evalFiveWithWilds(hand)).toEqual(oracleFiveWithWilds(hand))
      }
    }, 30000)
  })

  describe('evaluateBestHand / evaluateOmahaHand deucesWild flag', () => {
    it('holdem 7-card hand: a lone deuce completing a flush flips the result', () => {
      const hole = [card('2', 'diamonds'), card('8', 'clubs')]
      const board = [card('A', 'hearts'), card('K', 'hearts'), card('Q', 'hearts'), card('9', 'hearts'), card('3', 'clubs')]

      const off = evaluateBestHand(hole, board, false)
      expect(off.category).toBe(0) // high card A -- four hearts are not a flush

      const on = evaluateBestHand(hole, board, true)
      expect(on.category).toBe(5) // FLUSH: the deuce becomes the fifth heart
      expect(compareRanks(on, off)).toBeGreaterThan(0)
    })

    it('omaha 4+5: exactly-two-hole rule plus a wild deuce flips the result', () => {
      const hole = [card('2', 'diamonds'), card('7', 'hearts'), card('3', 'clubs'), card('9', 'spades')]
      const board = [card('A', 'hearts'), card('K', 'hearts'), card('Q', 'hearts'), card('J', 'hearts'), card('5', 'clubs')]

      const off = evaluateOmahaHand(hole, board, false)
      expect(off.category).toBe(0) // one hole heart can't make a flush (exactly-2 rule)

      const on = evaluateOmahaHand(hole, board, true)
      expect(on.category).toBe(5) // FLUSH: the deuce joins the one heart in the hole
      expect(compareRanks(on, off)).toBeGreaterThan(0)
    })
  })

  describe('createPokerGame house rules default', () => {
    it('POKER_ANTE and DEFAULT_HOUSE_RULES exist with the shared-design values', () => {
      expect(POKER_ANTE).toBe(10)
      expect(DEFAULT_HOUSE_RULES).toEqual({ deucesWild: false, ante: false })
    })

    it('defaults to house rules off and plays a scripted holdem hand exactly as before', () => {
      let game = createPokerGame(['p1', 'p2', 'p3'], 42)
      expect(game.session.publicState.houseRules).toEqual(DEFAULT_HOUSE_RULES)

      let state = game.session.publicState
      let r = applyPokerAction(game, 'p1', { type: 'CALL' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      r = applyPokerAction(game, 'p2', { type: 'CALL' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      r = applyPokerAction(game, 'p3', { type: 'CHECK' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!

      // Same shape as the omaha full-hand trajectory: blinds called to 30,
      // then checks around to showdown with exact chips and conservation.
      expect(state.turn.phase).toBe('flop')
      expect(state.pot).toBe(30)

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
      expect(state.handOver).toBe(true)
      expect(state.board).toHaveLength(5)
      expect(state.pot).toBe(30)

      const winners = state.handResults!.winners
      const awarded: Record<string, number> = {}
      for (const w of winners) awarded[w.playerId] = (awarded[w.playerId] ?? 0) + w.amount
      expect(Object.values(awarded).reduce((a, b) => a + b, 0)).toBe(30)
      for (const seatId of ['p1', 'p2', 'p3']) {
        expect(state.chips[seatId]).toBe(990 + (awarded[seatId] ?? 0))
      }
      expect(state.chips['p1'] + state.chips['p2'] + state.chips['p3']).toBe(3000)
    })

    it('accepts explicit house rules as the 5th parameter', () => {
      const custom: PokerHouseRules = { deucesWild: true, ante: true }
      const game = createPokerGame(['p1', 'p2'], 42, 'pips_default', 'holdem', custom)
      expect(game.session.publicState.houseRules).toEqual(custom)
    })

    it('carries houseRules through START_NEXT_HAND', () => {
      let game = createPokerGame(['p1', 'p2'], 42)
      let state = game.session.publicState
      let r = applyPokerAction(game, state.turn.playerOrder[state.turn.currentIndex], { type: 'FOLD' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      expect(state.handOver).toBe(true)

      r = applyPokerAction(game, 'p1', { type: 'START_NEXT_HAND' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      expect(state.handNumber).toBe(2)
      expect(state.houseRules).toEqual(DEFAULT_HOUSE_RULES)
    })
  })
})

describe('poker ante', () => {
  describe('ante hand-start', () => {
    it('3-player holdem: everyone posts the ante, street opens unopened, CHECK then BET legal, exact showdown stacks', () => {
      let game = createPokerGame(['p1', 'p2', 'p3'], 42, 'pips_default', 'holdem', { deucesWild: false, ante: true })
      let state = game.session.publicState

      // No blinds were posted: every seat put the full ante into the pot, no
      // street bet exists, and the minimum bet/raise sizing is unchanged.
      expect(state.pot).toBe(30)
      expect(state.currentBetThisStreet).toBe(0)
      expect(state.lastFullRaiseIncrement).toBe(POKER_BIG_BLIND)
      for (const seatId of ['p1', 'p2', 'p3']) {
        expect(state.chips[seatId]).toBe(990)
        expect(state.hands[seatId].totalContributedThisHand).toBe(10)
        expect(state.hands[seatId].betThisStreet).toBe(0)
        expect(state.hands[seatId].allIn).toBe(false)
      }
      // The button/blind seats still exist and still rotate; action starts
      // left of the button (p1 is button), the post-flop convention.
      expect(state.smallBlindSeat).toBe('p2')
      expect(state.bigBlindSeat).toBe('p3')
      expect(state.turn.playerOrder).toEqual(['p2', 'p3', 'p1'])

      // With no blinds the opening street is unopened: the first actor may
      // CHECK (in a blind game firstBet always faces the big blind instead).
      let r = applyPokerAction(game, 'p2', { type: 'CHECK' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      r = applyPokerAction(game, 'p3', { type: 'CHECK' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!

      // A BET opens the street normally.
      r = applyPokerAction(game, 'p1', { type: 'BET', amount: 20 })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      expect(state.pot).toBe(50)
      expect(state.currentBetThisStreet).toBe(20)

      r = applyPokerAction(game, 'p2', { type: 'CALL' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      r = applyPokerAction(game, 'p3', { type: 'CALL' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      expect(state.pot).toBe(90)

      // Check through flop, turn, river to showdown.
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
      expect(state.handOver).toBe(true)
      expect(state.board).toHaveLength(5)
      expect(state.pot).toBe(90)

      // Exact final stacks: 1000 - ante 10 - bet 20 = 970, plus the pot share.
      const winners = state.handResults!.winners
      const awarded: Record<string, number> = {}
      for (const w of winners) awarded[w.playerId] = (awarded[w.playerId] ?? 0) + w.amount
      expect(Object.values(awarded).reduce((a, b) => a + b, 0)).toBe(90)
      for (const seatId of ['p1', 'p2', 'p3']) {
        expect(state.chips[seatId]).toBe(970 + (awarded[seatId] ?? 0))
      }
      expect(state.chips['p1'] + state.chips['p2'] + state.chips['p3']).toBe(3000)
    })

    it('a seat with fewer chips than the ante goes all-in for less; side pots settle exactly', () => {
      let game = createPokerGame(['p1', 'p2', 'p3'], 42, 'pips_default', 'holdem', { deucesWild: false, ante: true })
      let state = game.session.publicState

      // Fold out hand 1 so START_NEXT_HAND rotates the button naturally.
      let r = applyPokerAction(game, 'p2', { type: 'FOLD' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      r = applyPokerAction(game, 'p3', { type: 'FOLD' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      expect(state.handOver).toBe(true)

      // Simulate a seat ground down below the ante. (Reaching 1-9 chips by
      // play alone takes ~99 ante-only hands; the session is plain data, so
      // writing the short stack directly is the honest setup.)
      state.chips['p3'] = 5
      const chipsBefore = state.seatOrder.reduce((sum, seatId) => sum + state.chips[seatId], 0)

      r = applyPokerAction(game, 'p1', { type: 'START_NEXT_HAND' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!

      // Hand 2: p2 button, p3 SB, p1 BB -- but no blinds are posted. p3 puts
      // in its whole 5 and is all-in; the other seats post the full ante.
      expect(state.buttonSeat).toBe('p2')
      expect(state.hands['p3'].totalContributedThisHand).toBe(5)
      expect(state.hands['p3'].allIn).toBe(true)
      expect(state.hands['p3'].betThisStreet).toBe(0)
      expect(state.hands['p1'].totalContributedThisHand).toBe(10)
      expect(state.hands['p2'].totalContributedThisHand).toBe(10)
      expect(state.pot).toBe(25)
      expect(state.currentBetThisStreet).toBe(0)
      // Action starts left of the button, skipping the all-in seat.
      expect(state.turn.playerOrder).toEqual(['p1', 'p2'])

      // p1 bets 20, p2 calls: contributions are p1 30, p2 30, p3 5.
      r = applyPokerAction(game, 'p1', { type: 'BET', amount: 20 })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      r = applyPokerAction(game, 'p2', { type: 'CALL' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      expect(state.pot).toBe(65)

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
      expect(state.handOver).toBe(true)
      expect(state.pot).toBe(65)

      // Side pots split exactly at the two contribution levels (5 and 30):
      // three seats at 5 -> 15, then two seats at 30 -> 50.
      const breakdown = state.handResults!.potBreakdown
      expect(breakdown).toHaveLength(2)
      expect(breakdown[0].amount).toBe(15)
      expect(breakdown[0].eligiblePlayerIds).toEqual(['p1', 'p2', 'p3'])
      expect(breakdown[1].amount).toBe(50)
      expect(breakdown[1].eligiblePlayerIds).toEqual(['p1', 'p2'])

      // The all-in seat can win at most its 15-chip side pot.
      const p3Award = state.handResults!.winners.find((w) => w.playerId === 'p3')?.amount ?? 0
      expect(p3Award).toBeLessThanOrEqual(15)

      // Everything the pot held was awarded; chips are conserved exactly.
      const awardedTotal = state.handResults!.winners.reduce((sum, w) => sum + w.amount, 0)
      expect(awardedTotal).toBe(65)
      expect(state.seatOrder.reduce((sum, seatId) => sum + state.chips[seatId], 0)).toBe(chipsBefore)
    })

    it('3-player holdem ante: everyone all-in at hand start settles in the same START_NEXT_HAND action (regression)', () => {
      // Reproduces the lead's freeze: 3 seats at 5 chips each in an ante game.
      // The next hand's ante posts put every seat all-in before anyone can act,
      // leaving turn.playerOrder empty -- every action was rejected 'not your
      // turn' forever. The hand must run out and settle inside START_NEXT_HAND.
      let game = createPokerGame(['p1', 'p2', 'p3'], 42, 'pips_default', 'holdem', { deucesWild: false, ante: true })
      let state = game.session.publicState

      // Fold out hand 1 so START_NEXT_HAND is legal.
      let r = applyPokerAction(game, 'p2', { type: 'FOLD' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      r = applyPokerAction(game, 'p3', { type: 'FOLD' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      expect(state.handOver).toBe(true)

      // Ground every stack to exactly the ante (the session is plain data, so
      // writing the stacks directly is the honest setup, as above).
      for (const seatId of ['p1', 'p2', 'p3']) state.chips[seatId] = 5
      const chipsBefore = state.seatOrder.reduce((sum, seatId) => sum + state.chips[seatId], 0)

      r = applyPokerAction(game, 'p1', { type: 'START_NEXT_HAND' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!

      // The same action that started the hand ran out the board and conducted
      // the showdown: with zero actors there is no waiting, the hand is over.
      expect(state.handOver).toBe(true)
      expect(state.handResults).not.toBeNull()
      expect(state.board).toHaveLength(5)
      expect(state.pot).toBe(15)

      // Pot 15 fully awarded; chips conserved to the 15 that were on the table.
      const awardedTotal = state.handResults!.winners.reduce((sum, w) => sum + w.amount, 0)
      expect(awardedTotal).toBe(15)
      expect(state.seatOrder.reduce((sum, seatId) => sum + state.chips[seatId], 0)).toBe(chipsBefore)
    })

    it('five-draw ante: everyone all-in at hand start stops at the draw round, then settles after draws (regression)', () => {
      // Draw-variant sibling of the holdem freeze: the runout must stop at the
      // 'draw' phase -- drawing is free, so all-in seats still take their draw
      // turns -- and only then flow on to secondBet and showdown.
      let game = createPokerGame(['p1', 'p2', 'p3'], 42, 'pips_default', 'five-draw', { deucesWild: false, ante: true })
      let state = game.session.publicState

      // Fold out hand 1 so START_NEXT_HAND is legal.
      let r = applyPokerAction(game, 'p2', { type: 'FOLD' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      r = applyPokerAction(game, 'p3', { type: 'FOLD' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      expect(state.handOver).toBe(true)

      for (const seatId of ['p1', 'p2', 'p3']) state.chips[seatId] = 5
      const chipsBefore = state.seatOrder.reduce((sum, seatId) => sum + state.chips[seatId], 0)

      r = applyPokerAction(game, 'p1', { type: 'START_NEXT_HAND' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!

      // The runout stopped at the draw round: all three seats are all-in but
      // still get their (free) draw turns before the hand can settle.
      expect(state.turn.phase).toBe('draw')
      expect(state.handOver).toBe(false)
      expect(state.pot).toBe(15)

      const drawOrder = [...state.turn.playerOrder]
      expect(drawOrder).toHaveLength(3)
      for (const seatId of drawOrder) {
        r = applyPokerAction(game, seatId, { type: 'DRAW', discardIds: [] })
        expect(r.outcome.ok, `draw for ${seatId}: ${r.outcome.reason}`).toBe(true)
        game = r.holdemSession
        state = r.outcome.publicState!
      }

      // The last draw closed the round: secondBet had no actors either, so the
      // hand ran out to showdown in that same action.
      expect(state.handOver).toBe(true)
      expect(state.handResults).not.toBeNull()
      const awardedTotal = state.handResults!.winners.reduce((sum, w) => sum + w.amount, 0)
      expect(awardedTotal).toBe(15)
      expect(state.seatOrder.reduce((sum, seatId) => sum + state.chips[seatId], 0)).toBe(chipsBefore)
    })

    it('five-draw with ante on: firstBet opens unopened (CHECK legal), draw round unaffected', () => {
      let game = createPokerGame(['p1', 'p2', 'p3'], 42, 'pips_default', 'five-draw', { deucesWild: false, ante: true })
      let state = game.session.publicState

      expect(state.turn.phase).toBe('firstBet')
      expect(state.pot).toBe(30)
      expect(state.currentBetThisStreet).toBe(0)
      for (const seatId of ['p1', 'p2', 'p3']) {
        expect(state.chips[seatId]).toBe(990)
        expect(state.hands[seatId].betThisStreet).toBe(0)
      }
      expect(state.turn.playerOrder).toEqual(['p2', 'p3', 'p1'])

      // Unopened firstBet: CHECK is legal for every seat (with blinds the
      // first actor always faces the big blind and cannot check).
      let r = applyPokerAction(game, 'p2', { type: 'CHECK' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      r = applyPokerAction(game, 'p3', { type: 'CHECK' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      r = applyPokerAction(game, 'p1', { type: 'CHECK' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!

      // The draw round arrives and plays out exactly as in a blind game.
      expect(state.turn.phase).toBe('draw')
      const drawOrder = [...state.turn.playerOrder]
      for (const seatId of drawOrder) {
        const discardIds = game.session.privateStates[seatId].hand.slice(0, 2).map((c) => c.id)
        r = applyPokerAction(game, seatId, { type: 'DRAW', discardIds })
        expect(r.outcome.ok).toBe(true)
        game = r.holdemSession
        state = r.outcome.publicState!
      }
      expect(state.turn.phase).toBe('secondBet')
      expect(state.currentBetThisStreet).toBe(0)
      expect(state.pot).toBe(30)
    })
  })

  describe('bot deuce-keep', () => {
    it('with deucesWild on, drawDiscardAction never returns a 2 in the discards', () => {
      const hands: Card[][] = [
        // pair + wild: without the flag the deuce is the lowest discard
        [card('2', 'clubs'), card('5', 'hearts'), card('5', 'diamonds'), card('8', 'spades'), card('K', 'clubs')],
        // 4-flush + wild: a made flush with wilds, stands pat
        [card('2', 'spades'), card('5', 'spades'), card('8', 'spades'), card('K', 'spades'), card('3', 'hearts')],
        // high card + wild: fallback discards only non-deuce lows
        [card('2', 'clubs'), card('5', 'diamonds'), card('9', 'spades'), card('J', 'hearts'), card('K', 'clubs')],
        // two wilds + three suited-ish naturals inside a straight window: stands pat
        [card('2', 'clubs'), card('2', 'diamonds'), card('7', 'spades'), card('8', 'hearts'), card('9', 'clubs')],
      ]
      for (const hand of hands) {
        const action = drawDiscardAction(hand, true)
        expect(action.type).toBe('DRAW')
        if (action.type === 'DRAW') {
          for (const discardId of action.discardIds) {
            expect(hand.find((c) => c.id === discardId)!.rank).not.toBe('2')
          }
        }
      }

      // The flag genuinely changes behavior: the same pair hand discards the
      // deuce with wilds off and keeps it with wilds on.
      const pairHand = hands[0]
      expect(drawDiscardAction(pairHand, false)).toEqual({ type: 'DRAW', discardIds: ['2clubs', '8spades', 'Kclubs'] })
      expect(drawDiscardAction(pairHand, true)).toEqual({ type: 'DRAW', discardIds: ['8spades', 'Kclubs'] })
    })
  })

  describe('house-rule full-match sweeps', () => {
    // Same harness as the omaha/draw sweeps: whole matches played by the bot
    // strategy alone. Every action the bot emits must validate, and the game
    // must progress -- either to a genuine table winner or past the case's
    // minimum hand count.
    const cases: { variant: 'holdem' | 'omaha' | 'five-draw'; houseRules: PokerHouseRules; seeds: number[]; actionCap: number; minHands: number }[] = [
      { variant: 'five-draw', houseRules: { deucesWild: true, ante: false }, seeds: [11, 22], actionCap: 4000, minHands: 15 },
      { variant: 'holdem', houseRules: { deucesWild: false, ante: true }, seeds: [11, 22], actionCap: 4000, minHands: 15 },
      // deuces+ante omaha showdown evaluation is legitimately heavy in compressed sweeps; live play is paced and unaffected.
      { variant: 'omaha', houseRules: { deucesWild: true, ante: true }, seeds: [11, 22], actionCap: 2000, minHands: 8 },
    ]
    for (const c of cases) {
      for (const seed of c.seeds) {
        it(`${c.variant} ${JSON.stringify(c.houseRules)} seed ${seed}: every action validates and the game progresses`, () => {
          let game = createPokerGame(['p1', 'p2', 'p3', 'p4'], seed, 'pips_default', c.variant, c.houseRules)
          let state = game.session.publicState
          let actions = 0

          while (!state.gameOverWinnerId && actions < c.actionCap) {
            if (state.handOver) {
              const r = applyPokerAction(game, state.seatOrder[0], { type: 'START_NEXT_HAND' })
              expect(r.outcome.ok, `hand ${state.handNumber} START_NEXT_HAND: ${r.outcome.reason}`).toBe(true)
              game = r.holdemSession
              state = r.outcome.publicState!
              actions++
              continue
            }

            // A live betting/draw phase always has an actor; if this ever
            // fails the game is stuck and the sweep must fail loudly.
            expect(state.turn.playerOrder.length).toBeGreaterThan(0)
            const actor = state.turn.playerOrder[state.turn.currentIndex]
            const r = runPokerBotTurn(game, actor, pokerBotStrategy)
            expect(r.outcome.ok, `hand ${state.handNumber} phase ${state.turn.phase} actor ${actor}: ${r.outcome.reason}`).toBe(true)
            game = r.holdemSession
            state = r.outcome.publicState!
            actions++
          }

          if (state.gameOverWinnerId === null) {
            expect(state.handNumber).toBeGreaterThan(c.minHands)
          }
        }, 30000)
      }
    }
  })
})
