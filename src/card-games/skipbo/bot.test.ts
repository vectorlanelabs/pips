import { describe, expect, it } from 'vitest'
import { skipBoBotStrategy, selectSkipBoDiscard } from './bot.ts'
import { createSkipBoGame, type SkipBoPublicState, type SkipBoPrivateState, type SkipBoAction, type SkipBoTurnPhase, type SkipBoSession } from './state.ts'
import { runSkipBoBotTurn } from './rules.ts'
import { currentPlayer, createTurnState } from '../../engine/turn-engine.ts'
import { cardCount, createHand, createPlayerZone, createPublicZone, addCards, topCard, type Zone } from '../../card-engine/zones.ts'
import { createSkipBoDeck } from './deck.ts'
import { createRng } from '../../engine/rng.ts'
import { createHostSession } from '../../engine/sync.ts'
import type { Card } from '../../card-engine/cards.ts'

// Skip-Bo deck id layout: rank n = sb-((n-1)*12 + copy) for copy 0..11 (so rank 1 = sb-0..sb-11,
// rank 2 = sb-12..sb-23, ... rank 12 = sb-132..sb-143); wilds = sb-144..sb-161.
const r1a = 'sb-0'
const r1b = 'sb-1'
const r3 = 'sb-24'
const r4 = 'sb-36'
const r6 = 'sb-60'
const r12a = 'sb-132'
const r12b = 'sb-133'
const w1 = 'sb-144'
const w2 = 'sb-145'

function cardMap(): Map<string, Card> {
  return new Map(createSkipBoDeck().map((c) => [c.id, c]))
}

function buildSession(config: {
  seatOrder?: string[]
  currentPlayerIndex?: number
  hands?: Record<string, string[]>
  stocks?: Record<string, string[]>
  discards?: Record<string, string[][]>   // per player, always 4 piles
  buildPiles?: { cards: string[]; nextNeeded: number }[]
}): SkipBoSession {
  const map = cardMap()
  const seatOrder = config.seatOrder ?? ['p1', 'p2']
  const hands: Record<string, Zone> = {}
  const stocks: Record<string, Zone> = {}
  const discards: Record<string, Zone[]> = {}
  const stockCounts: Record<string, number> = {}
  const stockTops: Record<string, Card | null> = {}
  const handCounts: Record<string, number> = {}
  const discardTops: Record<string, (Card | null)[]> = {}
  for (const playerId of seatOrder) {
    const handIds = config.hands?.[playerId] ?? []
    const stockIds = config.stocks?.[playerId] ?? []
    const discardIds = config.discards?.[playerId] ?? [[], [], [], []]
    hands[playerId] = addCards(createHand(playerId), handIds.map((id) => map.get(id)!))
    stocks[playerId] = addCards(createPlayerZone(playerId, 'stock', 'private'), stockIds.map((id) => map.get(id)!))
    discards[playerId] = discardIds.map((pileIds, i) =>
      addCards(createPlayerZone(playerId, `discard-${i}`, 'private'), pileIds.map((id) => map.get(id)!)),
    )
    handCounts[playerId] = handIds.length
    stockCounts[playerId] = stockIds.length
    stockTops[playerId] = topCard(stocks[playerId]) ?? null
    discardTops[playerId] = discards[playerId].map((pile) => topCard(pile) ?? null)
  }

  const turn = createTurnState<SkipBoTurnPhase>(seatOrder, 'play')
  if (config.currentPlayerIndex != null) {
    ;(turn as { currentIndex: number }).currentIndex = config.currentPlayerIndex
  }

  const publicState: SkipBoPublicState = {
    cardBack: 'pips_default',
    turn,
    seatOrder,
    stockCounts,
    stockTops,
    handCounts,
    discardTops,
    buildPiles: config.buildPiles
      ? config.buildPiles.map((p) => ({ cards: p.cards.map((id) => map.get(id)!), nextNeeded: p.nextNeeded }))
      : Array.from({ length: 4 }, () => ({ cards: [], nextNeeded: 1 })),
    drawCount: 0,
    usedCount: 0,
    roundOver: false,
    winnerId: null,
  }

  const privateStates: Record<string, SkipBoPrivateState> = {}
  for (const playerId of seatOrder) {
    privateStates[playerId] = { hand: hands[playerId], discards: discards[playerId] }
  }

  return {
    session: createHostSession(publicState, privateStates),
    drawPile: createPublicZone('draw', 'private'),
    usedPile: createPublicZone('used', 'public'),
    stocks,
    rng: createRng(0),
  }
}

function strategyAction(game: SkipBoSession, playerId: string): SkipBoAction {
  return skipBoBotStrategy(game.session.publicState, game.session.privateStates[playerId], playerId)
}

// ── bot priority loop, one rung at a time ──────────────────────

describe('skipBoBotStrategy', () => {
  it('rung 1: plays the stock top whenever it is legal anywhere — even with legal hand plays', () => {
    const game = buildSession({
      hands: { p1: [r1b] },          // rank 1, also legal
      stocks: { p1: [r1a] },         // rank 1 — legal on any fresh pile
    })
    expect(strategyAction(game, 'p1')).toEqual({ type: 'PLAY_STOCK', buildPileIndex: 0 })
  })

  it('rung 1: plays the stock top even when the hand is empty', () => {
    const game = buildSession({
      hands: { p1: [] },
      stocks: { p1: [r1a] },
    })
    expect(strategyAction(game, 'p1')).toEqual({ type: 'PLAY_STOCK', buildPileIndex: 0 })
  })

  it('rung 1 does not fire when the stock top is legal nowhere', () => {
    const game = buildSession({
      stocks: { p1: [r12a] },        // rank 12, all piles need 1
    })
    expect(strategyAction(game, 'p1').type).not.toBe('PLAY_STOCK')
  })

  it('rung 2: plays the lowest-index discard pile whose top is legal', () => {
    const game = buildSession({
      stocks: { p1: [r12a] },        // rank 12 — not legal, so rung 1 is out
      discards: {
        p1: [
          [],
          [r1a],                     // rank 1 — legal, lowest qualifying index
          [r4],                      // rank 4 — not legal
          [r1b],                     // rank 1 — legal, but a higher index
        ],
      },
    })
    expect(strategyAction(game, 'p1')).toEqual({ type: 'PLAY_DISCARD', pileIndex: 1, buildPileIndex: 0 })
  })

  it('rung 3: plays the first legal numbered hand card (hand order)', () => {
    const game = buildSession({
      hands: { p1: [r3, r1a] },      // rank 3 then rank 1 — BOTH legal here
      stocks: { p1: [r12a] },
      discards: { p1: [[r12b], [], [], []] },   // rank 12 top — not legal
      buildPiles: [
        { cards: [], nextNeeded: 3 },   // rank 3 lands here
        { cards: [], nextNeeded: 1 },   // rank 1 lands here
        { cards: [], nextNeeded: 1 },
        { cards: [], nextNeeded: 1 },
      ],
    })
    expect(strategyAction(game, 'p1')).toEqual({ type: 'PLAY_HAND', cardId: r3, buildPileIndex: 0 })
  })

  it('rung 3 fires before rung 4: numbered cards are tried before wilds', () => {
    const game = buildSession({
      hands: { p1: [r12a, w1, r1a] },   // rank 12 (not legal), wild, rank 1 (legal)
      stocks: { p1: [r12b] },
      buildPiles: [
        { cards: [], nextNeeded: 3 },   // rank 12 is legal nowhere
        { cards: [], nextNeeded: 1 },   // rank 1 is legal here
        { cards: [], nextNeeded: 1 },
        { cards: [], nextNeeded: 1 },
      ],
    })
    expect(strategyAction(game, 'p1')).toEqual({ type: 'PLAY_HAND', cardId: r1a, buildPileIndex: 1 })
  })

  it('rung 4: plays a wild only when no numbered card is legal', () => {
    const game = buildSession({
      hands: { p1: [r12a, w1] },        // rank 12 not legal anywhere, wild always is
      stocks: { p1: [r12b] },
      buildPiles: [
        { cards: [], nextNeeded: 3 },
        { cards: [], nextNeeded: 4 },
        { cards: [], nextNeeded: 5 },
        { cards: [], nextNeeded: 7 },
      ],
    })
    expect(strategyAction(game, 'p1')).toEqual({ type: 'PLAY_HAND', cardId: w1, buildPileIndex: 0 })
  })

  it('rung 4 always fires for a wild in hand — the bot never discards while a wild can be played', () => {
    // A wild is universally legal, so rung 4 always beats rung 5 whenever one is held; the
    // "never discard a wild" preference lives in selectSkipBoDiscard and is only reachable
    // there, not as a distinct rung-5 state.
    const game = buildSession({
      hands: { p1: [r12a, w1, r1a] },   // rank 12 (not legal), wild, rank 1 (also not legal)
      stocks: { p1: [r12b] },
      buildPiles: [
        { cards: [], nextNeeded: 3 },
        { cards: [], nextNeeded: 4 },
        { cards: [], nextNeeded: 5 },
        { cards: [], nextNeeded: 7 },
      ],
    })
    expect(strategyAction(game, 'p1')).toEqual({ type: 'PLAY_HAND', cardId: w1, buildPileIndex: 0 })
  })

  it('rung 5: discards the highest-numbered non-wild card when nothing is playable', () => {
    const game = buildSession({
      hands: { p1: [r1a, r12a, r6] },   // ranks 1, 12, 6 — none legal (piles need 3/4/5/7)
      stocks: { p1: [r12b] },           // rank 12 — not legal, so rung 1 is out
      buildPiles: [
        { cards: [], nextNeeded: 3 },
        { cards: [], nextNeeded: 4 },
        { cards: [], nextNeeded: 5 },
        { cards: [], nextNeeded: 7 },
      ],
    })
    expect(strategyAction(game, 'p1')).toEqual({ type: 'DISCARD', cardId: r12a, pileIndex: 0 })
  })

  it('rung 5: passes when the hand is empty and nothing is playable', () => {
    const game = buildSession({
      hands: { p1: [] },
      stocks: { p1: [r12a] },           // rank 12 — not legal
    })
    expect(strategyAction(game, 'p1')).toEqual({ type: 'PASS' })
  })

  it('selectSkipBoDiscard picks the highest rank and never a wild while numbered cards exist', () => {
    const map = cardMap()
    expect(selectSkipBoDiscard([map.get(r1a)!, map.get(r12a)!, map.get(w1)!])).toBe(r12a)
    expect(selectSkipBoDiscard([map.get(w1)!, map.get(w2)!])).toBe(w1)
  })
})

// ── full bot turn through runSkipBoBotTurn ─────────────────────

describe('skipBoBotTurn', () => {
  it('plays a full bot turn to completion without ever proposing an illegal action', () => {
    const game = createSkipBoGame(['p1', 'p2'], 42)
    let current = game
    let steps = 0
    const p1CardsAtStart = totalCardCount(current, ['p1', 'p2'])
    while (
      !current.session.publicState.roundOver &&
      currentPlayer(current.session.publicState.turn) === 'p1' &&
      steps < 500
    ) {
      const result = runSkipBoBotTurn(current, 'p1', skipBoBotStrategy)
      expect(result.outcome.ok).toBe(true)
      current = result.game
      steps++
    }
    expect(steps).toBeLessThan(500)
    // Either p1 emptied their stockpile mid-turn (win) or the turn advanced to p2
    expect(
      current.session.publicState.roundOver || currentPlayer(current.session.publicState.turn) === 'p2',
    ).toBe(true)
    // The whole deck is still accounted for, no card lost or duplicated
    expect(totalCardCount(current, ['p1', 'p2'])).toBe(p1CardsAtStart)
  })
})

function totalCardCount(game: SkipBoSession, playerIds: string[]): number {
  let total = cardCount(game.drawPile) + cardCount(game.usedPile)
  for (const playerId of playerIds) {
    const priv = game.session.privateStates[playerId]
    total += cardCount(game.stocks[playerId]) + cardCount(priv.hand)
    for (const pile of priv.discards) total += cardCount(pile)
  }
  for (const pile of game.session.publicState.buildPiles) total += pile.cards.length
  return total
}
