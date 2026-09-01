import { describe, it, expect } from 'vitest'
import { createPokerGame } from './state.ts'
import { applyPokerAction } from './rules.ts'
import { evaluateBestHand, compareRanks } from './hand-eval.ts'
import type { PokerPublicState, PokerSession, PokerVariant } from './state.ts'

// Drive the firstBet round with every player calling (the big blind checks),
// leaving the game in the draw phase. Mirrors the call/check driver style in
// rules.test.ts.
function driveFirstBetToDraw(
  playerIds: string[],
  seed: number,
  variant: PokerVariant,
): { game: PokerSession; state: PokerPublicState } {
  let game = createPokerGame(playerIds, seed, 'pips_default', variant)
  let state = game.session.publicState
  let guard = 0
  while (state.turn.phase === 'firstBet' && !state.handOver && guard < 20) {
    guard++
    const actor = state.turn.playerOrder[state.turn.currentIndex]
    const facingBet = state.currentBetThisStreet > state.hands[actor].betThisStreet
    const r = applyPokerAction(game, actor, facingBet ? { type: 'CALL' } : { type: 'CHECK' })
    expect(r.outcome.ok).toBe(true)
    game = r.holdemSession
    state = r.outcome.publicState!
  }
  expect(state.turn.phase).toBe('draw')
  return { game, state }
}

describe('draw variants', () => {
  describe('dealing', () => {
    it('five-draw deal: 5 private cards each, firstBet phase, blinds posted, action left of BB', () => {
      const game = createPokerGame(['p1', 'p2', 'p3'], 42, 'pips_default', 'five-draw')
      const state = game.session.publicState

      expect(state.variant).toBe('five-draw')
      expect(state.turn.phase).toBe('firstBet')
      // 3 players: p1 button, p2 small blind, p3 big blind.
      expect(state.smallBlindSeat).toBe('p2')
      expect(state.bigBlindSeat).toBe('p3')
      expect(state.pot).toBe(15)
      expect(state.chips['p1']).toBe(1000)
      expect(state.chips['p2']).toBe(995)
      expect(state.chips['p3']).toBe(990)
      expect(state.board).toHaveLength(0)

      // 5 private cards per seat; public hand stays empty until showdown.
      for (const seatId of ['p1', 'p2', 'p3']) {
        expect(game.session.privateStates[seatId].hand).toHaveLength(5)
        expect(state.hands[seatId].cards).toHaveLength(0)
        expect(state.drawnCounts[seatId]).toBeNull()
      }

      // Action starts left of the big blind (p3).
      expect(state.turn.playerOrder).toEqual(['p1', 'p2', 'p3'])
      expect(state.turn.playerOrder[state.turn.currentIndex]).toBe('p1')
    })

    it('seven-draw deal: 7 private cards each', () => {
      const game = createPokerGame(['p1', 'p2', 'p3'], 7, 'pips_default', 'seven-draw')
      const state = game.session.publicState

      expect(state.variant).toBe('seven-draw')
      expect(state.turn.phase).toBe('firstBet')
      expect(state.pot).toBe(15)
      for (const seatId of ['p1', 'p2', 'p3']) {
        expect(game.session.privateStates[seatId].hand).toHaveLength(7)
        expect(state.hands[seatId].cards).toHaveLength(0)
      }
    })

    it('holdem regression: default variant still deals 2, starts preflop, drawnCounts all null', () => {
      const game = createPokerGame(['p1', 'p2', 'p3'], 42)
      const state = game.session.publicState

      expect(state.variant).toBe('holdem')
      expect(state.turn.phase).toBe('preflop')
      for (const seatId of ['p1', 'p2', 'p3']) {
        expect(game.session.privateStates[seatId].hand).toHaveLength(2)
        expect(state.drawnCounts[seatId]).toBeNull()
      }
    })
  })

  describe('DRAW action validation', () => {
    it('rejects DRAW in holdem', () => {
      const game = createPokerGame(['p1', 'p2'], 42)
      const state = game.session.publicState
      const actor = state.turn.playerOrder[state.turn.currentIndex]
      const r = applyPokerAction(game, actor, { type: 'DRAW', discardIds: [] })
      expect(r.outcome.ok).toBe(false)
      expect(r.outcome.reason).toBe("draw actions are not part of Texas Hold'em")
    })

    it('rejects DRAW outside the draw phase', () => {
      const game = createPokerGame(['p1', 'p2'], 42, 'pips_default', 'five-draw')
      const state = game.session.publicState
      expect(state.turn.phase).toBe('firstBet')
      const actor = state.turn.playerOrder[state.turn.currentIndex]
      const r = applyPokerAction(game, actor, { type: 'DRAW', discardIds: [] })
      expect(r.outcome.ok).toBe(false)
      expect(r.outcome.reason).toBe('not the draw round')
    })

    it('rejects DRAW out of turn', () => {
      const { game, state } = driveFirstBetToDraw(['p1', 'p2'], 42, 'five-draw')
      // Heads-up draw order is [p2, p1]; p2 draws first.
      expect(state.turn.playerOrder[state.turn.currentIndex]).toBe('p2')
      const r = applyPokerAction(game, 'p1', { type: 'DRAW', discardIds: [] })
      expect(r.outcome.ok).toBe(false)
      expect(r.outcome.reason).toBe('not your turn')
    })

    it('rejects DRAW with 4 discard ids', () => {
      const { game } = driveFirstBetToDraw(['p1', 'p2'], 42, 'five-draw')
      const actor = 'p2'
      const hand = game.session.privateStates[actor].hand
      const r = applyPokerAction(game, actor, { type: 'DRAW', discardIds: hand.slice(0, 4).map((c) => c.id) })
      expect(r.outcome.ok).toBe(false)
      expect(r.outcome.reason).toBe('you can draw at most 3 cards')
    })

    it('rejects DRAW with a duplicated id', () => {
      const { game } = driveFirstBetToDraw(['p1', 'p2'], 42, 'five-draw')
      const actor = 'p2'
      const id = game.session.privateStates[actor].hand[0].id
      const r = applyPokerAction(game, actor, { type: 'DRAW', discardIds: [id, id] })
      expect(r.outcome.ok).toBe(false)
      expect(r.outcome.reason).toBe('duplicate card in discard list')
    })

    it('rejects DRAW with an id not in the hand', () => {
      const { game } = driveFirstBetToDraw(['p1', 'p2'], 42, 'five-draw')
      const actor = 'p2'
      // The deck holds only cards no one was dealt, so its top card is never in a hand.
      const foreignId = game.deck[0].id
      const r = applyPokerAction(game, actor, { type: 'DRAW', discardIds: [foreignId] })
      expect(r.outcome.ok).toBe(false)
      expect(r.outcome.reason).toBe('card not in your hand')
    })
  })

  describe('the draw round', () => {
    it('stand pat: DRAW [] sets drawnCounts 0, hand unchanged, turn advances', () => {
      const { game: g, state: s } = driveFirstBetToDraw(['p1', 'p2'], 42, 'five-draw')
      let game = g
      let state = s
      const actor = 'p2'
      const beforeIds = game.session.privateStates[actor].hand.map((c) => c.id)
      expect(state.drawnCounts[actor]).toBeNull()

      const r = applyPokerAction(game, actor, { type: 'DRAW', discardIds: [] })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!

      expect(state.drawnCounts[actor]).toBe(0)
      expect(game.session.privateStates[actor].hand.map((c) => c.id)).toEqual(beforeIds)
      expect(state.turn.phase).toBe('draw')
      expect(state.turn.playerOrder[state.turn.currentIndex]).toBe('p1')
      expect(state.drawnCounts['p1']).toBeNull()
    })

    it('draw replaces cards: discards removed, replacements come off the deck in order', () => {
      const { game: g } = driveFirstBetToDraw(['p1', 'p2'], 42, 'five-draw')
      let game = g
      const actor = 'p2'
      const handBefore = game.session.privateStates[actor].hand
      const discardIds = handBefore.slice(0, 3).map((c) => c.id)
      const deckTopIds = game.deck.slice(0, 3).map((c) => c.id)

      const r = applyPokerAction(game, actor, { type: 'DRAW', discardIds })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession

      const handAfter = game.session.privateStates[actor].hand
      expect(handAfter).toHaveLength(5)
      for (const id of discardIds) {
        expect(handAfter.some((c) => c.id === id)).toBe(false)
      }
      // Kept cards keep their original order; replacements append in deck order.
      expect(handAfter.slice(0, 2).map((c) => c.id)).toEqual(handBefore.slice(3).map((c) => c.id))
      expect(handAfter.slice(2).map((c) => c.id)).toEqual(deckTopIds)
      expect(game.deck).toHaveLength(39) // 52 - 2*5 dealt - 3 drawn
    })

    it('draw round starts left of the button and proceeds in seat order', () => {
      const { game: g, state: s } = driveFirstBetToDraw(['p1', 'p2', 'p3'], 42, 'five-draw')
      let game = g
      let state = s

      // Button is p1, so the draw round is [p2, p3, p1].
      expect(state.turn.phase).toBe('draw')
      expect(state.turn.playerOrder).toEqual(['p2', 'p3', 'p1'])

      for (const expected of ['p2', 'p3', 'p1']) {
        expect(state.turn.playerOrder[state.turn.currentIndex]).toBe(expected)
        const r = applyPokerAction(game, expected, { type: 'DRAW', discardIds: [] })
        expect(r.outcome.ok).toBe(true)
        game = r.holdemSession
        state = r.outcome.publicState!
      }

      expect(state.turn.phase).toBe('secondBet')
      expect(state.drawnCounts['p1']).toBe(0)
      expect(state.drawnCounts['p2']).toBe(0)
      expect(state.drawnCounts['p3']).toBe(0)
    })

    it('a player who folded in firstBet is skipped in the draw round', () => {
      let game = createPokerGame(['p1', 'p2', 'p3'], 42, 'pips_default', 'five-draw')
      let state = game.session.publicState

      // firstBet order [p1, p2, p3]: p1 folds, p2 calls, p3 (BB) checks.
      expect(state.turn.playerOrder[state.turn.currentIndex]).toBe('p1')
      let r = applyPokerAction(game, 'p1', { type: 'FOLD' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      expect(state.hands['p1'].folded).toBe(true)

      r = applyPokerAction(game, 'p2', { type: 'CALL' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!

      r = applyPokerAction(game, 'p3', { type: 'CHECK' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!

      expect(state.turn.phase).toBe('draw')
      expect(state.turn.playerOrder).toEqual(['p2', 'p3'])

      // The two non-folded players complete the round.
      for (const expected of ['p2', 'p3']) {
        expect(state.turn.playerOrder[state.turn.currentIndex]).toBe(expected)
        r = applyPokerAction(game, expected, { type: 'DRAW', discardIds: [] })
        expect(r.outcome.ok).toBe(true)
        game = r.holdemSession
        state = r.outcome.publicState!
      }
      expect(state.turn.phase).toBe('secondBet')
    })

    it('all-in players still draw and the hand settles with exact final chips', () => {
      let game = createPokerGame(['p1', 'p2', 'p3'], 11, 'pips_default', 'five-draw')
      let state = game.session.publicState

      // firstBet order [p1, p2, p3]: p1 shoves all-in, p2 folds, p3 calls all-in.
      expect(state.turn.playerOrder[state.turn.currentIndex]).toBe('p1')
      let r = applyPokerAction(game, 'p1', { type: 'RAISE', amount: 1000 })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      expect(state.hands['p1'].allIn).toBe(true)

      r = applyPokerAction(game, 'p2', { type: 'FOLD' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!

      r = applyPokerAction(game, 'p3', { type: 'CALL' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      expect(state.hands['p3'].allIn).toBe(true)

      // Betting closed -> draw round over the two non-folded all-in seats.
      expect(state.turn.phase).toBe('draw')
      expect(state.turn.playerOrder).toEqual(['p3', 'p1'])

      // All-in seats still draw (drawing is free).
      r = applyPokerAction(game, 'p3', {
        type: 'DRAW',
        discardIds: game.session.privateStates['p3'].hand.slice(0, 3).map((c) => c.id),
      })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      expect(state.turn.playerOrder[state.turn.currentIndex]).toBe('p1')

      r = applyPokerAction(game, 'p1', { type: 'DRAW', discardIds: [] })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!

      // secondBet has fewer than 2 bettable actors -> straight to showdown.
      expect(state.turn.phase).toBe('showdown')
      expect(state.handOver).toBe(true)

      // Chip trajectory: everyone started at 1000. p1 and p3 each put in 1000;
      // p2 posted the 5 small blind and folded. Pot = 2005 (15 main + 1990 side)
      // goes to the winner of the p1 vs p3 showdown.
      const winners = state.handResults!.winners
      const awarded: Record<string, number> = {}
      for (const w of winners) awarded[w.playerId] = (awarded[w.playerId] ?? 0) + w.amount
      const winnerIds = Object.keys(awarded)
      expect(winnerIds).toHaveLength(1)
      const winner = winnerIds[0]
      const loser = winner === 'p1' ? 'p3' : 'p1'
      expect(awarded[winner]).toBe(2005)
      expect(state.chips[winner]).toBe(2005)
      expect(state.chips[loser]).toBe(0)
      expect(state.chips['p2']).toBe(995)
      expect(state.chips['p1'] + state.chips['p2'] + state.chips['p3']).toBe(3000)

      // The revealed winner hand really beats the loser's.
      const winnerEval = evaluateBestHand(state.hands[winner].cards, [])
      const loserEval = evaluateBestHand(state.hands[loser].cards, [])
      expect(compareRanks(winnerEval, loserEval)).toBeGreaterThan(0)
    })

    it('full five-draw hand: scripted bets both rounds, exact final chips and pot breakdown', () => {
      let game = createPokerGame(['p1', 'p2', 'p3'], 23, 'pips_default', 'five-draw')
      let state = game.session.publicState

      // firstBet: the BB's 10 is already a bet this street, so p1 opens by
      // raising to 20 (the minimum raise); p2 and p3 call (pot 60).
      expect(state.turn.playerOrder[state.turn.currentIndex]).toBe('p1')
      let r = applyPokerAction(game, 'p1', { type: 'RAISE', amount: 20 })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      expect(state.pot).toBe(35) // 15 blinds + 20 raise

      r = applyPokerAction(game, 'p2', { type: 'CALL' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!

      r = applyPokerAction(game, 'p3', { type: 'CALL' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      expect(state.pot).toBe(60)

      // Draw round [p2, p3, p1]: p2 draws 2, p3 draws 1, p1 stands pat.
      expect(state.turn.phase).toBe('draw')
      expect(state.turn.playerOrder).toEqual(['p2', 'p3', 'p1'])
      r = applyPokerAction(game, 'p2', { type: 'DRAW', discardIds: game.session.privateStates['p2'].hand.slice(0, 2).map((c) => c.id) })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      r = applyPokerAction(game, 'p3', { type: 'DRAW', discardIds: game.session.privateStates['p3'].hand.slice(0, 1).map((c) => c.id) })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      r = applyPokerAction(game, 'p1', { type: 'DRAW', discardIds: [] })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      expect(state.drawnCounts).toEqual({ p1: 0, p2: 2, p3: 1 })

      // secondBet: p2 bets 30, p3 and p1 call (pot 150) -> showdown.
      expect(state.turn.phase).toBe('secondBet')
      expect(state.turn.playerOrder).toEqual(['p2', 'p3', 'p1'])
      r = applyPokerAction(game, 'p2', { type: 'BET', amount: 30 })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      r = applyPokerAction(game, 'p3', { type: 'CALL' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      r = applyPokerAction(game, 'p1', { type: 'CALL' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
      expect(state.turn.phase).toBe('showdown')
      expect(state.handOver).toBe(true)
      expect(state.pot).toBe(150)

      // Pot breakdown: one 150 pot, all three players eligible.
      const potBreakdown = state.handResults!.potBreakdown
      expect(potBreakdown).toHaveLength(1)
      expect(potBreakdown[0].amount).toBe(150)
      expect(potBreakdown[0].eligiblePlayerIds).toEqual(['p1', 'p2', 'p3'])

      // Chip trajectory: everyone started at 1000 and put in exactly 50 (20 + 30).
      // Final stack = 950 + the player's share of the 150 pot, which must be exact.
      const winners = state.handResults!.winners
      const awarded: Record<string, number> = {}
      for (const w of winners) awarded[w.playerId] = (awarded[w.playerId] ?? 0) + w.amount
      expect(Object.values(awarded).reduce((a, b) => a + b, 0)).toBe(150)
      for (const seatId of ['p1', 'p2', 'p3']) {
        expect(state.chips[seatId]).toBe(950 + (awarded[seatId] ?? 0))
      }
      expect(state.chips['p1'] + state.chips['p2'] + state.chips['p3']).toBe(3000)

      // The winner's revealed hand is genuinely best.
      const winnerEval = evaluateBestHand(state.hands[winners[0].playerId].cards, [])
      for (const seatId of ['p1', 'p2', 'p3']) {
        expect(compareRanks(winnerEval, evaluateBestHand(state.hands[seatId].cards, []))).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('deck math', () => {
    it('6-player five-draw where everyone draws 3 succeeds with cards to spare', () => {
      const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']
      const { game: g, state: s } = driveFirstBetToDraw(playerIds, 42, 'five-draw')
      let game = g
      let state = s
      expect(game.deck).toHaveLength(22) // 52 - 6*5 dealt
      expect(state.turn.playerOrder).toEqual(['p2', 'p3', 'p4', 'p5', 'p6', 'p1'])

      while (state.turn.phase === 'draw') {
        const actor = state.turn.playerOrder[state.turn.currentIndex]
        const r = applyPokerAction(game, actor, {
          type: 'DRAW',
          discardIds: game.session.privateStates[actor].hand.slice(0, 3).map((c) => c.id),
        })
        expect(r.outcome.ok).toBe(true)
        game = r.holdemSession
        state = r.outcome.publicState!
      }

      expect(state.turn.phase).toBe('secondBet')
      expect(game.deck).toHaveLength(4) // 22 - 6*3 drawn
      for (const seatId of playerIds) {
        expect(game.session.privateStates[seatId].hand).toHaveLength(5)
        expect(state.drawnCounts[seatId]).toBe(3)
      }
    })

    it('5-player seven-draw where everyone draws 3 succeeds with cards to spare', () => {
      const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5']
      const { game: g, state: s } = driveFirstBetToDraw(playerIds, 42, 'seven-draw')
      let game = g
      let state = s
      expect(game.deck).toHaveLength(17) // 52 - 5*7 dealt
      expect(state.turn.playerOrder).toEqual(['p2', 'p3', 'p4', 'p5', 'p1'])

      while (state.turn.phase === 'draw') {
        const actor = state.turn.playerOrder[state.turn.currentIndex]
        const r = applyPokerAction(game, actor, {
          type: 'DRAW',
          discardIds: game.session.privateStates[actor].hand.slice(0, 3).map((c) => c.id),
        })
        expect(r.outcome.ok).toBe(true)
        game = r.holdemSession
        state = r.outcome.publicState!
      }

      expect(state.turn.phase).toBe('secondBet')
      expect(game.deck).toHaveLength(2) // 17 - 5*3 drawn
      for (const seatId of playerIds) {
        expect(game.session.privateStates[seatId].hand).toHaveLength(7)
        expect(state.drawnCounts[seatId]).toBe(3)
      }
    })
  })
})

describe('holdem', () => {
  it('createPokerGame enforces the variant seat cap (regression)', () => {
    // 8-seat seven-draw would silently deal p8 only 3 cards (56 > 52) and
    // corrupt the hand invisibly until showdown threw. It must throw upfront.
    expect(() => createPokerGame(['p1','p2','p3','p4','p5','p6','p7','p8'], 1, 'pips_default', 'seven-draw')).toThrow(/seats/)
    expect(() => createPokerGame(['p1','p2','p3','p4','p5','p6','p7'], 1, 'pips_default', 'five-draw')).toThrow(/seats/)
    expect(() => createPokerGame(['p1'], 1)).toThrow(/seats/)
  })

  it('a rejected action leaves the deck untouched (regression)', () => {
    const game = createPokerGame(['p1', 'p2', 'p3'], 3, 'pips_default', 'five-draw')
    const deckBefore = game.deck.length
    const notMyTurn = game.session.publicState.turn.playerOrder[1]
    const r = applyPokerAction(game, notMyTurn, { type: 'DRAW', discardIds: [] })
    expect(r.outcome.ok).toBe(false)
    expect(r.holdemSession.deck.length).toBe(deckBefore)
  })

  it('a seat that goes all-in mid-street leaves the rotation like a folder (regression)', () => {
    // Pre-fix: an all-in seat stayed in turn.playerOrder, and when a later
    // raise kept the street open the rotation handed it a dead turn where
    // every betting action was rejected ('nothing to call'), permanently
    // hanging a deterministic bot. The all-in actor must drop out of the
    // rotation immediately, exactly as a folding actor does.
    let game = createPokerGame(['p1', 'p2', 'p3'], 5)
    let state = game.session.publicState
    const first = state.turn.playerOrder[0]
    const r = applyPokerAction(game, first, { type: 'RAISE', amount: 1000 })
    expect(r.outcome.ok).toBe(true)
    state = r.outcome.publicState!
    expect(state.hands[first].allIn).toBe(true)
    expect(state.turn.playerOrder).not.toContain(first)
    expect(state.turn.playerOrder[state.turn.currentIndex]).not.toBe(first)
  })

  it('eliminated seats are folded from hand start: no freeze after a bust (regression)', () => {
    // Reproduces the live freeze: after a player busts, START_NEXT_HAND used to
    // reset their hand state with folded: false, so later-street rotations and
    // the showdown's getActivePlayers still included them. The eliminated seat
    // took betting turns with 0 chips and an empty hand, and at showdown
    // evaluateBestHand threw on the empty hand ('error evaluating hand'),
    // rejecting the closing action -- the hand could never complete.
    let game = createPokerGame(['p1', 'p2', 'p3', 'p4'], 1)
    let state = game.session.publicState

    // Hand 1: button p1, SB p2, BB p3, so preflop acts [p4, p1, p2, p3].
    // p4 shoves all-in, p1 calls all-in, p2 and p3 fold -> p4 vs p1 runout.
    expect(state.turn.playerOrder[state.turn.currentIndex]).toBe('p4')
    let r = applyPokerAction(game, 'p4', { type: 'RAISE', amount: 1000 })
    expect(r.outcome.ok).toBe(true)
    game = r.holdemSession
    state = r.outcome.publicState!

    r = applyPokerAction(game, 'p1', { type: 'CALL' })
    expect(r.outcome.ok).toBe(true)
    game = r.holdemSession
    state = r.outcome.publicState!

    r = applyPokerAction(game, 'p2', { type: 'FOLD' })
    expect(r.outcome.ok).toBe(true)
    game = r.holdemSession
    state = r.outcome.publicState!

    // Everyone is all-in or folded, so the hand auto-runouts to showdown.
    r = applyPokerAction(game, 'p3', { type: 'FOLD' })
    expect(r.outcome.ok).toBe(true)
    game = r.holdemSession
    state = r.outcome.publicState!
    expect(state.handOver).toBe(true)
    expect(state.handResults).not.toBeNull()

    // Start the next hand: the busted seat (0 chips) becomes eliminated.
    r = applyPokerAction(game, 'p2', { type: 'START_NEXT_HAND' })
    expect(r.outcome.ok).toBe(true)
    game = r.holdemSession
    state = r.outcome.publicState!

    const eliminatedSeat = state.seatOrder.find((seatId) => state.eliminated[seatId])!
    expect(eliminatedSeat).toBeDefined()
    expect(state.chips[eliminatedSeat]).toBe(0)

    // The fix: the eliminated seat is folded from hand start, so it is absent
    // from the preflop order and can never take a betting turn.
    expect(state.turn.playerOrder).not.toContain(eliminatedSeat)
    expect(state.hands[eliminatedSeat].folded).toBe(true)

    // Walk the hand: every remaining player checks/calls every street to
    // showdown -- the same walk that froze before the fix.
    let guard = 0
    while (!state.handOver && state.turn.phase !== 'showdown' && guard < 50) {
      guard++
      const actor = state.turn.playerOrder[state.turn.currentIndex]
      const facingBet = state.currentBetThisStreet > state.hands[actor].betThisStreet
      r = applyPokerAction(game, actor, facingBet ? { type: 'CALL' } : { type: 'CHECK' })
      expect(r.outcome.ok).toBe(true)
      game = r.holdemSession
      state = r.outcome.publicState!
    }

    // The hand completes: showdown evaluates only the remaining players, the
    // eliminated seat is in no pot's eligibility list, and chips are conserved.
    expect(state.handOver).toBe(true)
    expect(state.handResults).not.toBeNull()
    for (const pot of state.handResults!.potBreakdown) {
      expect(pot.eligiblePlayerIds).not.toContain(eliminatedSeat)
    }
    expect(state.seatOrder.reduce((sum, seatId) => sum + state.chips[seatId], 0)).toBe(4000)
  })
})
