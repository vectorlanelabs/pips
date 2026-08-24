import { describe, expect, it } from 'vitest'
import { createRummyGame, type RummyPublicState, type RummyPrivateState, type RummyAction, type RummyPhase, type RummySession, type RummyLayoff, fullMeldCards } from './state.ts'
import { applyRummyAction, runRummyBotTurn } from './rules.ts'
import { deriveSnapshot } from '../../engine/sync.ts'
import { currentPlayer } from '../../engine/turn-engine.ts'
import { cardCount, createHand, createDiscardPile, createPublicZone, addCards, type Zone } from '../../card-engine/zones.ts'
import { createStandardDeck } from '../../card-engine/deck.ts'
import { createRng } from '../../engine/rng.ts'
import { createTurnState } from '../../engine/turn-engine.ts'
import { createHostSession } from '../../engine/sync.ts'
import { classifyMeld } from './melds.ts'
import { deadwood, meldValue } from './scoring.ts'
import { rummyBotStrategy } from './bot.ts'
import type { BotStrategy } from '../../engine/bot.ts'
import type { Card } from '../../card-engine/cards.ts'

function totalCards(
  rummy: RummySession,
): number {
  const pub = rummy.session.publicState
  const priv = rummy.session.privateStates
  let meldCards = 0
  for (const playerId of Object.keys(pub.melds)) {
    for (const meld of pub.melds[playerId]) {
      meldCards += cardCount(meld)
    }
  }
  const layoffCards = pub.layoffs.reduce((sum, l) => sum + l.cards.length, 0)
  return (
    cardCount(rummy.stock) +
    cardCount(pub.discardPile) +
    cardCount(priv['p1'].hand) +
    cardCount(priv['p2'].hand) +
    meldCards +
    layoffCards
  )
}

// N-player version of totalCards — every card in the session (stock, discard, every seated
// hand, every meld zone, every layoff) must sum to the 52-card deck.
function totalCardsAll(rummy: RummySession, playerIds: string[]): number {
  const pub = rummy.session.publicState
  let meldCards = 0
  for (const playerId of playerIds) {
    for (const meld of pub.melds[playerId] ?? []) {
      meldCards += cardCount(meld)
    }
  }
  const layoffCards = pub.layoffs.reduce((sum, l) => sum + l.cards.length, 0)
  return (
    cardCount(rummy.stock) +
    cardCount(pub.discardPile) +
    playerIds.reduce((sum, id) => sum + cardCount(rummy.session.privateStates[id].hand), 0) +
    meldCards +
    layoffCards
  )
}

function allUniqueCardIds(rummy: RummySession): Set<string> {
  const ids = new Set<string>()
  for (const card of rummy.stock.cards) ids.add(card.id)
  for (const card of rummy.session.publicState.discardPile.cards) ids.add(card.id)
  for (const card of rummy.session.privateStates['p1'].hand.cards) ids.add(card.id)
  for (const card of rummy.session.privateStates['p2'].hand.cards) ids.add(card.id)
  for (const playerId of Object.keys(rummy.session.publicState.melds)) {
    for (const meld of rummy.session.publicState.melds[playerId]) {
      for (const card of meld.cards) ids.add(card.id)
    }
  }
  for (const l of rummy.session.publicState.layoffs) {
    for (const card of l.cards) ids.add(card.id)
  }
  return ids
}

/** Find any 3 cards in the hand that form a valid meld. Returns their ids, or null. */
function findMeld(cards: Card[]): string[] | null {
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      for (let k = j + 1; k < cards.length; k++) {
        const trio = [cards[i], cards[j], cards[k]]
        if (classifyMeld(trio).valid) {
          return trio.map((c) => c.id)
        }
      }
    }
  }
  return null
}

/** Look up a Card by id from a fresh standard deck. */
function cardMap(id: string): Card {
  const deck = createStandardDeck()
  const map = new Map(deck.map((c) => [c.id, c]))
  return map.get(id)!
}

function buildSession(config: {
  p1HandCardIds: string[]
  p2HandCardIds: string[]
  discardCardIds: string[]
  stockCardIds: string[]
  phase?: RummyPhase
  currentPlayerIndex?: number
  scores?: Record<string, number>
  roundOver?: boolean
  roundWinnerId?: string | null
  matchWinnerId?: string | null
  obligatedCardId?: string | null
  melds?: Record<string, Zone[]>
  layoffs?: RummyLayoff[]
  handCounts?: Record<string, number>
  seatOrder?: string[]
  otherHandCardIds?: Record<string, string[]>   // hands for players beyond p1/p2, keyed by playerId
}): RummySession {
  const deck = createStandardDeck()
  const cardMap = new Map(deck.map((c) => [c.id, c]))

  function cardsFor(ids: string[]): Card[] {
    return ids.map((id) => cardMap.get(id)!)
  }

  const seatOrder = config.seatOrder ?? ['p1', 'p2']
  const hands: Record<string, Zone> = {
    p1: addCards(createHand('p1'), cardsFor(config.p1HandCardIds)),
    p2: addCards(createHand('p2'), cardsFor(config.p2HandCardIds)),
  }
  for (const [playerId, ids] of Object.entries(config.otherHandCardIds ?? {})) {
    hands[playerId] = addCards(createHand(playerId), cardsFor(ids))
  }
  const discardPile = addCards(createDiscardPile(), cardsFor(config.discardCardIds))
  const stock = addCards(createPublicZone('stock', 'private'), cardsFor(config.stockCardIds))

  const turn = createTurnState<RummyPhase>(seatOrder, config.phase ?? 'draw')
  if (config.currentPlayerIndex != null) {
    // createTurnState starts at index 0; advance to desired index by directly setting it
    ;(turn as { currentIndex: number }).currentIndex = config.currentPlayerIndex
  }

  const defaultMelds: Record<string, Zone[]> = {}
  const defaultScores: Record<string, number> = {}
  const defaultHandCounts: Record<string, number> = {}
  for (const playerId of seatOrder) {
    defaultMelds[playerId] = []
    defaultScores[playerId] = 0
    defaultHandCounts[playerId] = cardCount(hands[playerId])
  }

  const publicState: RummyPublicState = {
    turn,
    seatOrder,
    discardPile,
    stockCount: cardCount(stock),
    melds: config.melds ?? defaultMelds,
    layoffs: config.layoffs ?? [],
    obligatedCardId: config.obligatedCardId ?? null,
    scores: config.scores ?? defaultScores,
    target: 100,
    roundNumber: 1,
    roundOver: config.roundOver ?? false,
    roundWinnerId: config.roundWinnerId ?? null,
    matchWinnerId: config.matchWinnerId ?? null,
    cardBack: 'classic',
    handCounts: config.handCounts ?? defaultHandCounts,
  }

  const privateStates: Record<string, RummyPrivateState> = {}
  for (const playerId of seatOrder) {
    privateStates[playerId] = { hand: hands[playerId] }
  }

  return {
    session: createHostSession(publicState, privateStates),
    stock,
    rng: createRng(0),
  }
}

describe('Rummy integration harness', () => {
  it('initial deal is correct', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)

    expect(cardCount(rummy.session.privateStates['p1'].hand)).toBe(10)
    expect(cardCount(rummy.session.privateStates['p2'].hand)).toBe(10)
    expect(cardCount(rummy.stock)).toBe(31)
    expect(cardCount(rummy.session.publicState.discardPile)).toBe(1)
    expect(currentPlayer(rummy.session.publicState.turn)).toBe('p1')
    expect(rummy.session.publicState.turn.phase).toBe('draw')
    expect(rummy.session.publicState.handCounts).toEqual({ p1: 10, p2: 10 })
    expect(totalCards(rummy)).toBe(52)
  })

  // Defense-in-depth for the PeerJS host boundary (App.tsx's onAction guards with
  // isRummyAction — see state.test.ts — before ever reaching here), documenting that the
  // validator itself never throws on an unrecognized action.type; it rejects cleanly.
  it('an action with an unrecognized type is rejected, not thrown, and leaves state untouched', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)
    const before = rummy.session.revision

    expect(() => applyRummyAction(rummy, 'p1', { type: 'NOT_A_REAL_ACTION' } as unknown as RummyAction))
      .not.toThrow()
    const result = applyRummyAction(rummy, 'p1', { type: 'NOT_A_REAL_ACTION' } as unknown as RummyAction)
    expect(result.outcome.ok).toBe(false)
    expect(result.rummy.session.revision).toBe(before)
  })

  it('p1 draws from stock', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)

    const result = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })
    expect(result.outcome.ok).toBe(true)

    const next = result.rummy
    expect(cardCount(next.session.privateStates['p1'].hand)).toBe(11)
    expect(cardCount(next.stock)).toBe(30)
    expect(next.session.publicState.stockCount).toBe(cardCount(next.stock))
    expect(next.session.publicState.turn.phase).toBe('discard')
    expect(next.session.revision).toBe(1)
    expect(totalCards(next)).toBe(52)
  })

  it('stockCount stays in sync with the real stock after each action', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)

    // p1 draws from stock
    const r1 = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })
    expect(r1.outcome.ok).toBe(true)
    expect(r1.rummy.session.publicState.stockCount).toBe(cardCount(r1.rummy.stock))

    // p1 discards (stock untouched, count must still match)
    const p1HandAfterDraw = r1.rummy.session.privateStates['p1'].hand
    const r2 = applyRummyAction(r1.rummy, 'p1', { type: 'DISCARD_CARD', cardId: p1HandAfterDraw.cards[0].id })
    expect(r2.outcome.ok).toBe(true)
    expect(r2.rummy.session.publicState.stockCount).toBe(cardCount(r2.rummy.stock))

    // p2 draws from stock
    const r3 = applyRummyAction(r2.rummy, 'p2', { type: 'DRAW_FROM_STOCK' })
    expect(r3.outcome.ok).toBe(true)
    expect(r3.rummy.session.publicState.stockCount).toBe(cardCount(r3.rummy.stock))

    // p2 discards
    const p2HandAfterDraw = r3.rummy.session.privateStates['p2'].hand
    const r4 = applyRummyAction(r3.rummy, 'p2', { type: 'DISCARD_CARD', cardId: p2HandAfterDraw.cards[0].id })
    expect(r4.outcome.ok).toBe(true)
    expect(r4.rummy.session.publicState.stockCount).toBe(cardCount(r4.rummy.stock))
  })

  it('rejected action leaves the stock object reference-untouched', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)
    const stockBefore = rummy.stock

    // p2 tries to draw when it is p1's turn — rejected
    const result = applyRummyAction(rummy, 'p2', { type: 'DRAW_FROM_STOCK' })
    expect(result.outcome.ok).toBe(false)

    // The stock must be literally untouched (same reference), not just structurally equal
    expect(result.rummy.stock).toBe(stockBefore)
    expect(cardCount(result.rummy.stock)).toBe(31)
  })

  it('hidden information — p2 snapshot does not leak p1 cards', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)
    const { rummy: afterDraw } = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })

    const p1CardIds = new Set(afterDraw.session.privateStates['p1'].hand.cards.map((c) => c.id))
    const p2CardIds = new Set(afterDraw.session.privateStates['p2'].hand.cards.map((c) => c.id))

    const p2Snapshot = deriveSnapshot(afterDraw.session, 'p2')

    // p2's private state should be exactly p2's own 10-card hand, not p1's
    expect(p2Snapshot.privateState!.hand.cards.length).toBe(10)
    for (const card of p2Snapshot.privateState!.hand.cards) {
      expect(p2CardIds.has(card.id)).toBe(true)
      expect(p1CardIds.has(card.id)).toBe(false)
    }

    // JSON.stringify must not leak p1's card ids
    const json = JSON.stringify(p2Snapshot)
    const discardIds = new Set(afterDraw.session.publicState.discardPile.cards.map((c) => c.id))
    for (const id of p1CardIds) {
      if (discardIds.has(id)) continue
      expect(json).not.toContain(id)
    }
  })

  it('p1 discards, turn passes to p2', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)
    const { rummy: afterDraw } = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })

    const p1HandAfterDraw = afterDraw.session.privateStates['p1'].hand
    const discardedId = p1HandAfterDraw.cards[0].id

    const result = applyRummyAction(afterDraw, 'p1', { type: 'DISCARD_CARD', cardId: discardedId })
    expect(result.outcome.ok).toBe(true)

    const afterDiscard = result.rummy
    expect(cardCount(afterDiscard.session.privateStates['p1'].hand)).toBe(10)
    expect(cardCount(afterDiscard.session.publicState.discardPile)).toBe(2)
    const discardCards = afterDiscard.session.publicState.discardPile.cards
    expect(discardCards[discardCards.length - 1].id).toBe(discardedId)
    expect(currentPlayer(afterDiscard.session.publicState.turn)).toBe('p2')
    expect(afterDiscard.session.publicState.turn.phase).toBe('draw')
    expect(totalCards(afterDiscard)).toBe(52)
  })

  it('p2 draws from discard', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)
    const { rummy: afterDraw } = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })
    const p1HandAfterDraw = afterDraw.session.privateStates['p1'].hand
    const discardedId = p1HandAfterDraw.cards[0].id
    const { rummy: afterDiscard } = applyRummyAction(afterDraw, 'p1', {
      type: 'DISCARD_CARD',
      cardId: discardedId,
    })

    // Discard pile has 2 cards: initial (index 0) + p1's discard (index 1). Draw the top.
    const result = applyRummyAction(afterDiscard, 'p2', { type: 'DRAW_FROM_DISCARD', index: 1 })
    expect(result.outcome.ok).toBe(true)

    const afterP2Draw = result.rummy
    expect(cardCount(afterP2Draw.session.privateStates['p2'].hand)).toBe(11)

    const p2CardIds = afterP2Draw.session.privateStates['p2'].hand.cards.map((c) => c.id)
    expect(p2CardIds).toContain(discardedId)

    expect(cardCount(afterP2Draw.session.publicState.discardPile)).toBe(1)
    expect(afterP2Draw.session.publicState.turn.phase).toBe('discard')
    expect(totalCards(afterP2Draw)).toBe(52)
  })

  it('p2 discards, turn returns to p1', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)
    const { rummy: afterDraw } = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })
    const p1HandAfterDraw = afterDraw.session.privateStates['p1'].hand
    const { rummy: afterP1Discard } = applyRummyAction(afterDraw, 'p1', {
      type: 'DISCARD_CARD',
      cardId: p1HandAfterDraw.cards[0].id,
    })
    const { rummy: afterP2Draw } = applyRummyAction(afterP1Discard, 'p2', { type: 'DRAW_FROM_DISCARD', index: 1 })
    const p2HandAfterDraw = afterP2Draw.session.privateStates['p2'].hand

    const { rummy: afterP2Discard } = applyRummyAction(afterP2Draw, 'p2', {
      type: 'DISCARD_CARD',
      cardId: p2HandAfterDraw.cards[0].id,
    })

    expect(currentPlayer(afterP2Discard.session.publicState.turn)).toBe('p1')
    expect(afterP2Discard.session.publicState.turn.phase).toBe('draw')
    expect(totalCards(afterP2Discard)).toBe(52)
  })

  it('illegal action rejected — wrong player', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)
    const { rummy: afterDraw } = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })
    const p1HandAfterDraw = afterDraw.session.privateStates['p1'].hand
    const { rummy: afterP1Discard } = applyRummyAction(afterDraw, 'p1', {
      type: 'DISCARD_CARD',
      cardId: p1HandAfterDraw.cards[0].id,
    })
    const { rummy: afterP2Draw } = applyRummyAction(afterP1Discard, 'p2', { type: 'DRAW_FROM_DISCARD', index: 1 })
    const p2HandAfterDraw = afterP2Draw.session.privateStates['p2'].hand
    const { rummy: afterP2Discard } = applyRummyAction(afterP2Draw, 'p2', {
      type: 'DISCARD_CARD',
      cardId: p2HandAfterDraw.cards[0].id,
    })

    // Now it's p1's turn, phase 'draw'
    expect(currentPlayer(afterP2Discard.session.publicState.turn)).toBe('p1')

    const revisionBefore = afterP2Discard.session.revision

    const result = applyRummyAction(afterP2Discard, 'p2', { type: 'DRAW_FROM_STOCK' })
    expect(result.outcome.ok).toBe(false)

    // Session unchanged
    expect(result.rummy.session.revision).toBe(revisionBefore)
    expect(result.rummy.session.publicState).toEqual(afterP2Discard.session.publicState)
    expect(result.rummy.session.privateStates).toEqual(afterP2Discard.session.privateStates)
  })

  it('illegal action rejected — wrong phase', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)
    const { rummy: afterDraw } = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })
    const p1HandAfterDraw = afterDraw.session.privateStates['p1'].hand
    const { rummy: afterP1Discard } = applyRummyAction(afterDraw, 'p1', {
      type: 'DISCARD_CARD',
      cardId: p1HandAfterDraw.cards[0].id,
    })
    const { rummy: afterP2Draw } = applyRummyAction(afterP1Discard, 'p2', { type: 'DRAW_FROM_DISCARD', index: 1 })
    const p2HandAfterDraw = afterP2Draw.session.privateStates['p2'].hand
    const { rummy: afterP2Discard } = applyRummyAction(afterP2Draw, 'p2', {
      type: 'DISCARD_CARD',
      cardId: p2HandAfterDraw.cards[0].id,
    })

    // Now it's p1's turn, phase 'draw'
    expect(currentPlayer(afterP2Discard.session.publicState.turn)).toBe('p1')
    expect(afterP2Discard.session.publicState.turn.phase).toBe('draw')

    const revisionBefore = afterP2Discard.session.revision
    const p1CardId = afterP2Discard.session.privateStates['p1'].hand.cards[0].id

    const result = applyRummyAction(afterP2Discard, 'p1', {
      type: 'DISCARD_CARD',
      cardId: p1CardId,
    })
    expect(result.outcome.ok).toBe(false)

    // Session unchanged
    expect(result.rummy.session.revision).toBe(revisionBefore)
    expect(result.rummy.session.publicState).toEqual(afterP2Discard.session.publicState)
  })

  it('house player bot completes a full turn', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)
    const { rummy: afterDraw } = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })
    const p1HandAfterDraw = afterDraw.session.privateStates['p1'].hand
    const { rummy: afterP1Discard } = applyRummyAction(afterDraw, 'p1', {
      type: 'DISCARD_CARD',
      cardId: p1HandAfterDraw.cards[0].id,
    })
    const { rummy: afterP2Draw } = applyRummyAction(afterP1Discard, 'p2', { type: 'DRAW_FROM_DISCARD', index: 1 })
    const p2HandAfterDraw = afterP2Draw.session.privateStates['p2'].hand
    const { rummy: afterP2Discard } = applyRummyAction(afterP2Draw, 'p2', {
      type: 'DISCARD_CARD',
      cardId: p2HandAfterDraw.cards[0].id,
    })

    // Now it's p1's turn, phase 'draw'
    expect(currentPlayer(afterP2Discard.session.publicState.turn)).toBe('p1')

    const strategy: BotStrategy<RummyPublicState, RummyPrivateState, RummyAction> = (
      publicState,
      privateState,
      _playerId,
    ) => {
      if (publicState.turn.phase === 'draw') return { type: 'DRAW_FROM_STOCK' }
      return { type: 'DISCARD_CARD', cardId: privateState.hand.cards[0].id }
    }

    // First bot action: draw (phase is 'draw')
    const drawResult = runRummyBotTurn(afterP2Discard, 'p1', strategy)
    expect(drawResult.outcome.ok).toBe(true)
    expect(drawResult.rummy.session.publicState.turn.phase).toBe('discard')
    expect(totalCards(drawResult.rummy)).toBe(52)

    // Second bot action: discard (phase is now 'discard')
    const discardResult = runRummyBotTurn(drawResult.rummy, 'p1', strategy)
    expect(discardResult.outcome.ok).toBe(true)
    expect(discardResult.rummy.session.publicState.turn.phase).toBe('draw')
    expect(currentPlayer(discardResult.rummy.session.publicState.turn)).toBe('p2')
    expect(totalCards(discardResult.rummy)).toBe(52)
  })

  it('full-game conservation check after all operations', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)
    expect(totalCards(rummy)).toBe(52)

    const { rummy: r1 } = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })
    expect(totalCards(r1)).toBe(52)

    const p1HandAfterDraw = r1.session.privateStates['p1'].hand
    const { rummy: r2 } = applyRummyAction(r1, 'p1', {
      type: 'DISCARD_CARD',
      cardId: p1HandAfterDraw.cards[0].id,
    })
    expect(totalCards(r2)).toBe(52)

    const { rummy: r3 } = applyRummyAction(r2, 'p2', { type: 'DRAW_FROM_DISCARD', index: 1 })
    expect(totalCards(r3)).toBe(52)

    const p2HandAfterDraw = r3.session.privateStates['p2'].hand
    const { rummy: r4 } = applyRummyAction(r3, 'p2', {
      type: 'DISCARD_CARD',
      cardId: p2HandAfterDraw.cards[0].id,
    })
    expect(totalCards(r4)).toBe(52)

    // Collect all card ids across all locations
    const allIds = allUniqueCardIds(r4)
    expect(allIds.size).toBe(52)

    const total =
      cardCount(r4.stock) +
      cardCount(r4.session.publicState.discardPile) +
      cardCount(r4.session.privateStates['p1'].hand) +
      cardCount(r4.session.privateStates['p2'].hand)
    expect(total).toBe(52)
  })

  // ── new tests ───────────────────────────────────────────────

  it('LAY_DOWN_MELD with valid meld succeeds', () => {
    // Construct a state with known meld cards: A♣,2♣,3♣ form a run
    const p2Cards = ['c4', 'c5', 'c6', 'c7', 'c8']
    const remaining = createStandardDeck().map(c => c.id).filter(id =>
      id !== 'c0' && id !== 'c1' && id !== 'c2' && id !== 'c3' && !p2Cards.includes(id)
    )

    const rummy = buildSession({
      p1HandCardIds: ['c0', 'c1', 'c2'],
      p2HandCardIds: p2Cards,
      discardCardIds: ['c3'],
      stockCardIds: remaining,
      phase: 'discard',
      currentPlayerIndex: 0,
    })

    const meldIds = ['c0', 'c1', 'c2']
    const initialHandSize = cardCount(rummy.session.privateStates['p1'].hand)
    const initialMeldCount = rummy.session.publicState.melds['p1'].length

    const result = applyRummyAction(rummy, 'p1', { type: 'LAY_DOWN_MELD', cardIds: meldIds })
    expect(result.outcome.ok).toBe(true)

    const after = result.rummy
    expect(cardCount(after.session.privateStates['p1'].hand)).toBe(initialHandSize - meldIds.length)
    expect(after.session.publicState.melds['p1'].length).toBe(initialMeldCount + 1)

    const meldZone = after.session.publicState.melds['p1'][initialMeldCount]
    expect(meldZone).toBeDefined()
    const meldIdsInZone = meldZone.cards.map((c) => c.id).sort()
    expect(meldIdsInZone).toEqual([...meldIds].sort())

    expect(totalCards(after)).toBe(52)
  })

  it('invalid meld rejected', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)
    const { rummy: afterDraw } = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })

    const hand = afterDraw.session.privateStates['p1'].hand.cards
    // Pick 3 cards of different suits and non-consecutive ranks, or just any 3 random cards
    // that don't form a meld. Try combinations until we find one.
    let nonMeldIds: string[] | null = null
    for (let i = 0; i < hand.length && !nonMeldIds; i++) {
      for (let j = i + 1; j < hand.length && !nonMeldIds; j++) {
        for (let k = j + 1; k < hand.length && !nonMeldIds; k++) {
          const trio = [hand[i], hand[j], hand[k]]
          if (!classifyMeld(trio).valid) {
            nonMeldIds = trio.map((c) => c.id)
          }
        }
      }
    }
    expect(nonMeldIds).not.toBeNull()

    const meldsBefore = afterDraw.session.publicState.melds['p1'].length
    const result = applyRummyAction(afterDraw, 'p1', { type: 'LAY_DOWN_MELD', cardIds: nonMeldIds! })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('not a valid')
    expect(result.rummy.session.publicState.melds['p1'].length).toBe(meldsBefore)
  })

  it('card not in hand rejected for LAY_DOWN_MELD', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)
    const { rummy: afterDraw } = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })

    const handIds = afterDraw.session.privateStates['p1'].hand.cards.map((c) => c.id)
    const result = applyRummyAction(afterDraw, 'p1', {
      type: 'LAY_DOWN_MELD',
      cardIds: [handIds[0], handIds[1], 'nonexistent-card-id'],
    })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('card not in hand')
  })

  it('reach-in mechanic — multi-card draw from discard', () => {
    // p2 hand: A♣,2♣,4♣,5♣,6♣,7♣,8♣,9♣,10♣,J♣ (clubs run, missing 3♣)
    // Discard: [K♠, 3♣, Q♣, K♣] — reaching for index 1 (3♣) takes 3 cards and is meldable (A♣,2♣,3♣)
    const p2Cards = ['c0', 'c1', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10']
    const discardCards = ['c51', 'c2', 'c11', 'c12']
    const p1Cards = ['c20', 'c21', 'c22', 'c23', 'c24', 'c25', 'c26', 'c27', 'c28', 'c29']
    const used = new Set([...p2Cards, ...discardCards, ...p1Cards])
    const stockCards = createStandardDeck().map(c => c.id).filter(id => !used.has(id))

    const rummy = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: discardCards,
      stockCardIds: stockCards,
      phase: 'draw',
      currentPlayerIndex: 1,
    })

    // Discard pile has 4 cards (indices 0,1,2,3 where 3 is top/newest)
    const pileBefore = rummy.session.publicState.discardPile.cards
    expect(pileBefore.length).toBe(4)

    // Reach for index 1 — takes cards[1], cards[2], cards[3] (3 cards: 3♣, Q♣, K♣)
    const reachedCardId = pileBefore[1].id
    const p2HandSizeBefore = cardCount(rummy.session.privateStates['p2'].hand)

    const result = applyRummyAction(rummy, 'p2', { type: 'DRAW_FROM_DISCARD', index: 1 })
    expect(result.outcome.ok).toBe(true)

    const after = result.rummy
    // Hand should gain 3 cards (indices 1,2,3)
    expect(cardCount(after.session.privateStates['p2'].hand)).toBe(p2HandSizeBefore + 3)
    // Discard pile should shrink to just what was below index 1 (index 0 only = 1 card)
    expect(cardCount(after.session.publicState.discardPile)).toBe(1)
    // obligatedCardId must equal the reached-for card's id
    expect(after.session.publicState.obligatedCardId).toBe(reachedCardId)

    expect(totalCards(after)).toBe(52)
  })

  it('reach-in with top card only — no obligation', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)

    // Play one cycle so discard has 2 cards
    const { rummy: r1 } = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })
    const p1h = r1.session.privateStates['p1'].hand
    const { rummy: r2 } = applyRummyAction(r1, 'p1', { type: 'DISCARD_CARD', cardId: p1h.cards[0].id })

    // Discard pile has 2 cards: index 0 = initial, index 1 = p1's discard (top)
    const pile = r2.session.publicState.discardPile.cards
    expect(pile.length).toBe(2)
    const topIndex = pile.length - 1

    const result = applyRummyAction(r2, 'p2', { type: 'DRAW_FROM_DISCARD', index: topIndex })
    expect(result.outcome.ok).toBe(true)
    // Single card take → no obligation
    expect(result.rummy.session.publicState.obligatedCardId).toBeNull()
  })

  it('obligation enforcement — must meld before discarding after reach-in', () => {
    // p2 hand: A♣,2♣,4♣,5♣,6♣,7♣,8♣,9♣,10♣,J♣ (clubs, missing 3♣)
    // Discard: [K♠, 3♣, Q♣, K♣] — reach for index 1 takes 3♣,Q♣,K♣
    // After reach, A♣,2♣,3♣ form a run (includes obligated 3♣)
    const p2Cards = ['c0', 'c1', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10']
    const discardCards = ['c51', 'c2', 'c11', 'c12']
    const p1Cards = ['c20', 'c21', 'c22', 'c23', 'c24', 'c25', 'c26', 'c27', 'c28', 'c29']
    const used = new Set([...p2Cards, ...discardCards, ...p1Cards])
    const stockCards = createStandardDeck().map(c => c.id).filter(id => !used.has(id))

    const rummy = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: discardCards,
      stockCardIds: stockCards,
      phase: 'draw',
      currentPlayerIndex: 1,
    })

    const pileBefore = rummy.session.publicState.discardPile.cards
    const reachedCardId = pileBefore[1].id // 3♣

    const { rummy: r7 } = applyRummyAction(rummy, 'p2', { type: 'DRAW_FROM_DISCARD', index: 1 })
    expect(r7.session.publicState.obligatedCardId).toBe(reachedCardId)

    // Try to discard without melding first → must be rejected
    const p2HandAfterDraw = r7.session.privateStates['p2'].hand
    const discardAttempt = applyRummyAction(r7, 'p2', { type: 'DISCARD_CARD', cardId: p2HandAfterDraw.cards[0].id })
    expect(discardAttempt.outcome.ok).toBe(false)
    expect(discardAttempt.outcome.reason).toContain('must use the card')

    // A♣,2♣,3♣ form a run — meld includes the obligated card
    const meldResult = applyRummyAction(r7, 'p2', { type: 'LAY_DOWN_MELD', cardIds: ['c0', 'c1', reachedCardId] })
    expect(meldResult.outcome.ok).toBe(true)
    // obligatedCardId should be cleared
    expect(meldResult.rummy.session.publicState.obligatedCardId).toBeNull()

    // Now discarding should succeed
    const handAfterMeld = meldResult.rummy.session.privateStates['p2'].hand
    const discardResult = applyRummyAction(meldResult.rummy, 'p2', { type: 'DISCARD_CARD', cardId: handAfterMeld.cards[0].id })
    expect(discardResult.outcome.ok).toBe(true)
  })

  it('melding your whole hand does NOT end the round — the turn just passes', () => {
    // Going out requires a discard. p1 melds all 3 cards (run A♣ 2♣ 3♣) — hand empty, but the
    // round continues and the turn advances to p2 with no scoring.
    const p2Cards = ['c4', 'c5', 'c6', 'c7', 'c8']
    const remaining = createStandardDeck().map(c => c.id).filter(id =>
      id !== 'c0' && id !== 'c1' && id !== 'c2' && id !== 'c3' && !p2Cards.includes(id)
    )

    const rummy = buildSession({
      p1HandCardIds: ['c0', 'c1', 'c2'],
      p2HandCardIds: p2Cards,
      discardCardIds: ['c3'],
      stockCardIds: remaining,
      phase: 'discard',
      currentPlayerIndex: 0,
    })

    const result = applyRummyAction(rummy, 'p1', { type: 'LAY_DOWN_MELD', cardIds: ['c0', 'c1', 'c2'] })
    expect(result.outcome.ok).toBe(true)

    const pub = result.rummy.session.publicState
    expect(pub.roundOver).toBe(false)
    expect(pub.roundWinnerId).toBe(null)
    expect(cardCount(result.rummy.session.privateStates['p1'].hand)).toBe(0)
    expect(pub.handCounts['p1']).toBe(0)
    expect(currentPlayer(pub.turn)).toBe('p2')
    expect(pub.turn.phase).toBe('draw')
    expect(pub.scores).toEqual({ p1: 0, p2: 0 })

    expect(totalCards(result.rummy)).toBe(52)
    expect(allUniqueCardIds(result.rummy).size).toBe(52)
  })

  it('empty-hand player goes out on a later turn — draw then discard ends the round', () => {
    // p1 melded out earlier (A♣2♣3♣ on the table, hand empty). On their next turn they draw
    // from the stock and discard that card — THAT discard ends the round.
    const p1MeldCards = [cardMap('c0'), cardMap('c1'), cardMap('c2')]
    const p1MeldZone = addCards(createHand('p1'), p1MeldCards)
    const p2Cards = ['c4', 'c5', 'c6']
    const used = new Set(['c0', 'c1', 'c2', 'c3', ...p2Cards])
    const stockCards = createStandardDeck().map(c => c.id).filter(id => !used.has(id))

    const rummy = buildSession({
      p1HandCardIds: [],
      p2HandCardIds: p2Cards,
      discardCardIds: ['c3'],
      stockCardIds: stockCards,
      phase: 'draw',
      currentPlayerIndex: 0,
      melds: { p1: [p1MeldZone], p2: [] },
    })

    const drawn = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })
    expect(drawn.outcome.ok).toBe(true)
    const drawnCard = drawn.rummy.session.privateStates['p1'].hand.cards[0]

    const result = applyRummyAction(drawn.rummy, 'p1', { type: 'DISCARD_CARD', cardId: drawnCard.id })
    expect(result.outcome.ok).toBe(true)

    const pub = result.rummy.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.roundWinnerId).toBe('p1')
    // p1: A♣2♣3♣ meld = 15; p2: no melds, deadwood 5♣6♣7♣ = 15 → -15
    expect(pub.scores['p1']).toBe(15)
    expect(pub.scores['p2']).toBe(-15)
    expect(totalCards(result.rummy)).toBe(52)
  })

  it('going out via discard — round ends, scores update', () => {
    // Construct: p1 has exactly 1 card, p2 has cards for deadwood
    // p1: c0=A♣, p2: c1=2♣ c2=3♣ c3=4♣ (deadwood: 5+5+5=15)
    const p2Cards = ['c1', 'c2', 'c3']
    const remaining = createStandardDeck().map(c => c.id).filter(id =>
      id !== 'c0' && !p2Cards.includes(id)
    )

    const rummy = buildSession({
      p1HandCardIds: ['c0'],
      p2HandCardIds: p2Cards,
      discardCardIds: [remaining[0]],
      stockCardIds: remaining.slice(1),
      phase: 'discard',
      currentPlayerIndex: 0,
    })

    const result = applyRummyAction(rummy, 'p1', { type: 'DISCARD_CARD', cardId: 'c0' })
    expect(result.outcome.ok).toBe(true)

    const pub = result.rummy.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.roundWinnerId).toBe('p1')
    expect(cardCount(result.rummy.session.privateStates['p1'].hand)).toBe(0)

    // p1: no melds, empty hand → delta 0
    // p2: no melds, deadwood = 2♣(5)+3♣(5)+4♣(5)=15 → delta -15
    expect(pub.scores['p1']).toBe(0)
    expect(pub.scores['p2']).toBe(-15)

    expect(totalCards(result.rummy)).toBe(52)
  })

  it('match win — score crosses 100', () => {
    // Construct: p1 at 95, going out adds ≥10 → crosses 100 → p1 wins
    // p1 hand: meld cards (c0,c1,c2 = A♣,2♣,3♣) plus 9♣ (c8) to discard out with; p2 deadwood = 20
    const p2Cards = ['c4', 'c5', 'c6', 'c7']
    const p1Cards = ['c0', 'c1', 'c2', 'c8']
    const remaining = createStandardDeck().map(c => c.id).filter(id =>
      !p1Cards.includes(id) && id !== 'c3' && !p2Cards.includes(id)
    )

    const rummy = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['c3'],
      stockCardIds: remaining,
      phase: 'discard',
      currentPlayerIndex: 0,
      scores: { p1: 95, p2: 0 },
    })

    const melded = applyRummyAction(rummy, 'p1', { type: 'LAY_DOWN_MELD', cardIds: ['c0', 'c1', 'c2'] })
    expect(melded.outcome.ok).toBe(true)
    const result = applyRummyAction(melded.rummy, 'p1', { type: 'DISCARD_CARD', cardId: 'c8' })
    expect(result.outcome.ok).toBe(true)

    const pub = result.rummy.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.roundWinnerId).toBe('p1')
    // p1 at 95, melds A♣2♣3♣ = 5+5+5=15, discards out → 110 ≥ 100 target → match winner
    // p2: no melds, deadwood = 4×5=20 → 0-20 = -20
    expect(pub.scores['p1']).toBe(110)
    expect(pub.matchWinnerId).toBe('p1')
  })

  it('stock recycling — empty stock, discard recycled', () => {
    // Construct: empty stock, discard has several cards (≥2)
    // p1 cards: c0, c1, c2 | p2 cards: c3, c4, c5, c6, c7 + remaining
    // discard: c8, c9, c10 (3 cards), stock: empty
    // When p1 draws from stock: recycle discards c8,c9 into stock, keep c10 (top)
    // Then p1 draws top of new stock
    const p1Cards = ['c0', 'c1', 'c2']
    const p2BaseCards = ['c3', 'c4', 'c5', 'c6', 'c7']
    const discardCards = ['c8', 'c9', 'c10']
    const remaining = createStandardDeck().map(c => c.id).filter(id =>
      !p1Cards.includes(id) && !p2BaseCards.includes(id) && !discardCards.includes(id)
    )

    const rummy = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: [...p2BaseCards, ...remaining], // all remaining cards in p2's hand
      discardCardIds: discardCards,
      stockCardIds: [], // empty stock!
      phase: 'draw',
      currentPlayerIndex: 0,
    })

    expect(cardCount(rummy.stock)).toBe(0)
    expect(cardCount(rummy.session.publicState.discardPile)).toBe(3)

    const result = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })
    expect(result.outcome.ok).toBe(true)

    const after = result.rummy
    // p1 gained 1 card
    expect(cardCount(after.session.privateStates['p1'].hand)).toBe(4)
    // Top discard card (c10) stays in discard
    expect(after.session.publicState.discardPile.cards.length).toBe(1)
    expect(after.session.publicState.discardPile.cards[0].id).toBe('c10')
    // Stock has the recycled cards minus the 1 drawn = 2 - 1 = 1 card (c8,c9 shuffled, then one drawn)
    // Actually: discard had 3 cards (c8@top, c9, c10), keepTop=1 keeps c10, recycles c8,c9 into stock.
    // Stock had 0 cards, gets c8,c9 (shuffled). Then p1 draws 1 from stock → stock has 1 left.
    expect(cardCount(after.stock)).toBe(1)
    // public stockCount matches
    expect(after.session.publicState.stockCount).toBe(cardCount(after.stock))

    // Total conservation
    expect(totalCards(after)).toBe(52)
    expect(allUniqueCardIds(after).size).toBe(52)
  })

  it('recycle impossible — discard has 1 card, stock empty', () => {
    // Empty stock, discard with exactly 1 card → can't recycle, suggest drawing from discard
    const p1Cards = ['c0', 'c1', 'c2']
    const p2BaseCards = ['c3', 'c4', 'c5', 'c6', 'c7']
    const discardCards = ['c8']
    const remaining = createStandardDeck().map(c => c.id).filter(id =>
      !p1Cards.includes(id) && !p2BaseCards.includes(id) && !discardCards.includes(id)
    )

    const rummy = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: [...p2BaseCards, ...remaining],
      discardCardIds: discardCards,
      stockCardIds: [], // empty stock!
      phase: 'draw',
      currentPlayerIndex: 0,
    })

    expect(cardCount(rummy.stock)).toBe(0)
    expect(cardCount(rummy.session.publicState.discardPile)).toBe(1)

    const result = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('discard pile')
  })

  it('true block — empty stock and empty discard', () => {
    // Empty stock, empty discard → round is blocked
    const p1Cards = ['c0', 'c1', 'c2']
    const p2BaseCards = ['c3', 'c4', 'c5', 'c6', 'c7']
    const remaining = createStandardDeck().map(c => c.id).filter(id =>
      !p1Cards.includes(id) && !p2BaseCards.includes(id)
    )

    const rummy = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: [...p2BaseCards, ...remaining],
      discardCardIds: [], // empty discard!
      stockCardIds: [], // empty stock!
      phase: 'draw',
      currentPlayerIndex: 0,
    })

    expect(cardCount(rummy.stock)).toBe(0)
    expect(cardCount(rummy.session.publicState.discardPile)).toBe(0)

    const result = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })
    expect(result.outcome.ok).toBe(true)
    expect(result.rummy.session.publicState.roundOver).toBe(true)
    expect(result.rummy.session.publicState.roundWinnerId).toBeNull()
  })

  it('a blocked round (no winner) can still transition to a fresh round via START_NEXT_ROUND — this is the App.tsx host-effect path (round-over, no matchWinnerId) firing for the blocked case, not just the going-out case', () => {
    const p1Cards = ['c0', 'c1', 'c2']
    const p2BaseCards = ['c3', 'c4', 'c5', 'c6', 'c7']
    const remaining = createStandardDeck().map(c => c.id).filter(id =>
      !p1Cards.includes(id) && !p2BaseCards.includes(id)
    )
    const rummy = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: [...p2BaseCards, ...remaining],
      discardCardIds: [],
      stockCardIds: [],
      phase: 'draw',
      currentPlayerIndex: 0,
    })
    const blocked = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })
    expect(blocked.outcome.ok).toBe(true)
    expect(blocked.rummy.session.publicState.roundOver).toBe(true)
    expect(blocked.rummy.session.publicState.roundWinnerId).toBeNull()
    expect(blocked.rummy.session.publicState.matchWinnerId).toBeNull()

    const next = applyRummyAction(blocked.rummy, 'p1', { type: 'START_NEXT_ROUND' })
    expect(next.outcome.ok).toBe(true)
    expect(next.rummy.session.publicState.roundOver).toBe(false)
    expect(next.rummy.session.publicState.roundNumber).toBe(2)
    // No score change for a blocked round — nobody melded, nobody had deadwood scored.
    expect(next.rummy.session.publicState.scores).toEqual(rummy.session.publicState.scores)
  })

  it('START_NEXT_ROUND succeeds — new round dealt, scores preserved, start alternates', () => {
    // Simulate round end via direct state construction
    const p1Cards = ['c0', 'c1', 'c2']
    const p2Cards = ['c4', 'c5', 'c6', 'c7', 'c8']
    const remaining = createStandardDeck().map(c => c.id).filter(id =>
      id !== 'c3' && !p1Cards.includes(id) && !p2Cards.includes(id)
    )

    const afterRound = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['c3'],
      stockCardIds: remaining,
      phase: 'draw',
      currentPlayerIndex: 0,
      scores: { p1: 35, p2: 0 },
      roundOver: true,
      roundWinnerId: 'p1',
    })

    // Only one of the two returned fields changes (alternating start):
    // prev order was [p1, p2] → next order [p2, p1]
    // p1 starts in the new round (playerOrder[0] = 'p2', start index 0), wait:
    // Actually the spec says: const [prevA, prevB] = publicState.turn.playerOrder
    // nextOrder = [prevB, prevA] — so if prev was ['p1','p2'], next is ['p2','p1']
    // createTurnState sets currentIndex=0, so p2 starts
    // That means the player who starts alternates each round.
    const result = applyRummyAction(afterRound, 'p1', { type: 'START_NEXT_ROUND' })
    expect(result.outcome.ok).toBe(true)

    const pub = result.rummy.session.publicState
    expect(pub.roundNumber).toBe(2)
    expect(pub.roundOver).toBe(false)
    expect(pub.roundWinnerId).toBeNull()
    expect(pub.obligatedCardId).toBeNull()

    // Scores carried over
    expect(pub.scores).toEqual({ p1: 35, p2: 0 })

    // Both hands fresh (10 cards each)
    expect(cardCount(result.rummy.session.privateStates['p1'].hand)).toBe(10)
    expect(cardCount(result.rummy.session.privateStates['p2'].hand)).toBe(10)

    // Discard has 1 card (from deal)
    expect(cardCount(pub.discardPile)).toBe(1)

    // Melds reset
    expect(pub.melds).toEqual({ p2: [], p1: [] })

    // Starting player alternated: prev order [p1,p2] → new order [p2,p1], start index 0 = p2
    expect(currentPlayer(pub.turn)).toBe('p2')

    // Total conservation
    expect(totalCards(result.rummy)).toBe(52)
  })

  it('START_NEXT_ROUND rejected when round not over', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)
    expect(rummy.session.publicState.roundOver).toBe(false)

    const result = applyRummyAction(rummy, 'p1', { type: 'START_NEXT_ROUND' })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('round is not over')
  })

  it('START_NEXT_ROUND rejected when match already won', () => {
    const afterMatch = buildSession({
      p1HandCardIds: ['c0', 'c1', 'c2'],
      p2HandCardIds: ['c4', 'c5', 'c6'],
      discardCardIds: ['c3'],
      stockCardIds: createStandardDeck().map(c => c.id).filter(id =>
        id !== 'c0' && id !== 'c1' && id !== 'c2' && id !== 'c3' && id !== 'c4' && id !== 'c5' && id !== 'c6'
      ),
      phase: 'draw',
      currentPlayerIndex: 0,
      roundOver: true,
      matchWinnerId: 'p1',
    })

    const result = applyRummyAction(afterMatch, 'p2', { type: 'START_NEXT_ROUND' })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('match is already decided')
  })

  it('full-game conservation extended — meld + reach-in + going-out sequence', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)
    expect(totalCards(rummy)).toBe(52)
    expect(allUniqueCardIds(rummy).size).toBe(52)

    // p1 draws stock, discards
    const { rummy: r1 } = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })
    expect(totalCards(r1)).toBe(52)
    const p1h1 = r1.session.privateStates['p1'].hand
    const { rummy: r2 } = applyRummyAction(r1, 'p1', { type: 'DISCARD_CARD', cardId: p1h1.cards[0].id })
    expect(totalCards(r2)).toBe(52)

    // p2 draws stock, discards
    const { rummy: r3 } = applyRummyAction(r2, 'p2', { type: 'DRAW_FROM_STOCK' })
    expect(totalCards(r3)).toBe(52)
    const p2h1 = r3.session.privateStates['p2'].hand
    const { rummy: r4 } = applyRummyAction(r3, 'p2', { type: 'DISCARD_CARD', cardId: p2h1.cards[0].id })
    expect(totalCards(r4)).toBe(52)

    // Build up discard with more actions
    const { rummy: r5 } = applyRummyAction(r4, 'p1', { type: 'DRAW_FROM_STOCK' })
    const p1h2 = r5.session.privateStates['p1'].hand
    const { rummy: r6 } = applyRummyAction(r5, 'p1', { type: 'DISCARD_CARD', cardId: p1h2.cards[0].id })
    expect(totalCards(r6)).toBe(52)

    const { rummy: r7 } = applyRummyAction(r6, 'p2', { type: 'DRAW_FROM_STOCK' })
    const p2h2 = r7.session.privateStates['p2'].hand
    const { rummy: r8 } = applyRummyAction(r7, 'p2', { type: 'DISCARD_CARD', cardId: p2h2.cards[0].id })
    expect(totalCards(r8)).toBe(52)

    // Now discard has 5 cards. p1 reaches in (multi-card draw).
    const pileBefore = r8.session.publicState.discardPile.cards
    expect(pileBefore.length).toBe(5)

    const { rummy: r9 } = applyRummyAction(r8, 'p1', { type: 'DRAW_FROM_DISCARD', index: 2 })
    expect(totalCards(r9)).toBe(52)

    // Try to find a meld in p1's hand and lay it down
    const p1Hand = r9.session.privateStates['p1'].hand.cards
    const meldIds = findMeld(p1Hand)
    if (meldIds) {
      const { rummy: r10 } = applyRummyAction(r9, 'p1', { type: 'LAY_DOWN_MELD', cardIds: meldIds })
      expect(totalCards(r10)).toBe(52)

      // Discard something (if still have cards and no obligation)
      const p1HandAfterMeld = r10.session.privateStates['p1'].hand.cards
      if (p1HandAfterMeld.length > 0 && !r10.session.publicState.obligatedCardId) {
        const { rummy: r11 } = applyRummyAction(r10, 'p1', { type: 'DISCARD_CARD', cardId: p1HandAfterMeld[0].id })
        expect(totalCards(r11)).toBe(52)

        // Final assertion: 52 unique cards across all locations
        const ids = allUniqueCardIds(r11)
        expect(ids.size).toBe(52)
        expect(totalCards(r11)).toBe(52)
      } else {
        // Still verify conservation even without the discard
        const ids = allUniqueCardIds(r10)
        expect(ids.size).toBe(52)
        expect(totalCards(r10)).toBe(52)
      }
    } else {
      // Discard something
      const { rummy: r10 } = applyRummyAction(r9, 'p1', { type: 'DISCARD_CARD', cardId: p1Hand[0].id })
      expect(totalCards(r10)).toBe(52)
      const ids = allUniqueCardIds(r10)
      expect(ids.size).toBe(52)
    }
  })

  // ── Regression tests for adversarial review ─────────────────────

  it('deadlock prevented — reach-in for unmeldable card rejected', () => {
    // p2 hand: A♣,2♣,4♣,5♣,7♣,8♣,A♦,2♦,4♦,5♦ (no Q/J/10 of clubs, no other Q)
    // Discard: [K♠, Q♣, 2♠, A♠] — reaching for index 1 (Q♣) takes Q♣,2♠,A♠
    // Resulting hand can form A-set and 2-set, but neither includes Q♣ → unmeldable
    const p2Cards = ['c0', 'c1', 'c3', 'c4', 'c6', 'c7', 'c13', 'c14', 'c16', 'c17']
    const discardCards = ['c51', 'c11', 'c40', 'c39']
    const p1Cards = ['c20', 'c21', 'c22', 'c23', 'c24', 'c25', 'c26', 'c27', 'c28', 'c29']
    const used = new Set([...p2Cards, ...discardCards, ...p1Cards])
    const stockCards = createStandardDeck().map(c => c.id).filter(id => !used.has(id))

    const rummy = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: discardCards,
      stockCardIds: stockCards,
      phase: 'draw',
      currentPlayerIndex: 1,
    })

    const pileBefore = rummy.session.publicState.discardPile.cards
    const p2HandBefore = rummy.session.privateStates['p2'].hand
    const obligatedBefore = rummy.session.publicState.obligatedCardId

    const result = applyRummyAction(rummy, 'p2', { type: 'DRAW_FROM_DISCARD', index: 1 })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('cannot be melded')

    // State unchanged — hand, discard, obligation all preserved
    expect(result.rummy.session.privateStates['p2'].hand).toEqual(p2HandBefore)
    expect(result.rummy.session.publicState.discardPile.cards).toEqual(pileBefore)
    expect(result.rummy.session.publicState.obligatedCardId).toBe(obligatedBefore)
    expect(totalCards(result.rummy)).toBe(52)
  })

  it('deadlock allowed when meldable — reach-in succeeds', () => {
    // Same setup as the reach-in mechanic test: p2 can meld A♣,2♣,3♣ after reaching for 3♣
    const p2Cards = ['c0', 'c1', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10']
    const discardCards = ['c51', 'c2', 'c11', 'c12']
    const p1Cards = ['c20', 'c21', 'c22', 'c23', 'c24', 'c25', 'c26', 'c27', 'c28', 'c29']
    const used = new Set([...p2Cards, ...discardCards, ...p1Cards])
    const stockCards = createStandardDeck().map(c => c.id).filter(id => !used.has(id))

    const rummy = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: discardCards,
      stockCardIds: stockCards,
      phase: 'draw',
      currentPlayerIndex: 1,
    })

    const result = applyRummyAction(rummy, 'p2', { type: 'DRAW_FROM_DISCARD', index: 1 })
    expect(result.outcome.ok).toBe(true)
    expect(result.rummy.session.publicState.obligatedCardId).not.toBeNull()
    expect(totalCards(result.rummy)).toBe(52)
  })

  it('malformed DRAW_FROM_DISCARD index rejected, not thrown', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)

    // NaN
    let result = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_DISCARD', index: NaN })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('invalid index')

    // non-integer float
    result = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_DISCARD', index: 1.5 })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('invalid index')

    // null (cast)
    result = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_DISCARD', index: null as any })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('invalid index')

    // undefined (cast)
    result = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_DISCARD', index: undefined as any })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('invalid index')
  })

  it('malformed LAY_DOWN_MELD cardIds rejected, not thrown', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)
    const { rummy: afterDraw } = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })

    // null (cast)
    let result = applyRummyAction(afterDraw, 'p1', { type: 'LAY_DOWN_MELD', cardIds: null as any })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('invalid cardIds')

    // undefined (cast)
    result = applyRummyAction(afterDraw, 'p1', { type: 'LAY_DOWN_MELD', cardIds: undefined as any })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('invalid cardIds')

    // number (cast)
    result = applyRummyAction(afterDraw, 'p1', { type: 'LAY_DOWN_MELD', cardIds: 5 as any })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('invalid cardIds')
  })

  it('START_NEXT_ROUND rejects non-participant playerId', () => {
    const p1Cards = ['c0', 'c1', 'c2']
    const p2Cards = ['c4', 'c5', 'c6', 'c7', 'c8']
    const remaining = createStandardDeck().map(c => c.id).filter(id =>
      id !== 'c3' && !p1Cards.includes(id) && !p2Cards.includes(id)
    )

    const afterRound = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['c3'],
      stockCardIds: remaining,
      phase: 'draw',
      currentPlayerIndex: 0,
      scores: { p1: 35, p2: 0 },
      roundOver: true,
      roundWinnerId: 'p1',
    })

    const result = applyRummyAction(afterRound, 'not-a-real-player', { type: 'START_NEXT_ROUND' })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('not a player')
    expect(result.rummy.session.publicState.roundNumber).toBe(afterRound.session.publicState.roundNumber)
  })

  // ── handCounts tests ────────────────────────────────────────

  it('handCounts: DRAW_FROM_STOCK increments acting player by 1, opponent unchanged', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)
    expect(rummy.session.publicState.handCounts).toEqual({ p1: 10, p2: 10 })

    const { rummy: r1 } = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })
    expect(r1.session.publicState.handCounts).toEqual({ p1: 11, p2: 10 })
  })

  it('handCounts: DRAW_FROM_DISCARD single card increments acting player by 1', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)
    const { rummy: r1 } = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })
    const p1h = r1.session.privateStates['p1'].hand
    const { rummy: r2 } = applyRummyAction(r1, 'p1', { type: 'DISCARD_CARD', cardId: p1h.cards[0].id })

    // p2 draws top of discard (single card, index = last)
    const pileLength = r2.session.publicState.discardPile.cards.length
    const { rummy: r3 } = applyRummyAction(r2, 'p2', { type: 'DRAW_FROM_DISCARD', index: pileLength - 1 })
    expect(r3.session.publicState.handCounts).toEqual({ p1: 10, p2: 11 })
  })

  it('handCounts: DRAW_FROM_DISCARD reach-in increments acting player by taken count', () => {
    // p2 hand: A♣,2♣,4♣,5♣,6♣,7♣,8♣,9♣,10♣,J♣ (clubs run, missing 3♣)
    // Discard: [K♠, 3♣, Q♣, K♣] — reach for index 1 takes 3 cards
    const p2Cards = ['c0', 'c1', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10']
    const discardCards = ['c51', 'c2', 'c11', 'c12']
    const p1Cards = ['c20', 'c21', 'c22', 'c23', 'c24', 'c25', 'c26', 'c27', 'c28', 'c29']
    const used = new Set([...p2Cards, ...discardCards, ...p1Cards])
    const stockCards = createStandardDeck().map(c => c.id).filter(id => !used.has(id))

    const rummy = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: discardCards,
      stockCardIds: stockCards,
      phase: 'draw',
      currentPlayerIndex: 1,
    })

    expect(rummy.session.publicState.handCounts).toEqual({ p1: 10, p2: 10 })

    const { rummy: after } = applyRummyAction(rummy, 'p2', { type: 'DRAW_FROM_DISCARD', index: 1 })
    // Takes indices 1,2,3 — 3 cards — hand goes from 10→13
    expect(after.session.publicState.handCounts).toEqual({ p1: 10, p2: 13 })
  })

  it('handCounts: LAY_DOWN_MELD (non-going-out) decrements acting player by meld size', () => {
    // p1 has 5 cards, meld 3 of them
    const p2Cards = ['c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12']
    const remaining = createStandardDeck().map(c => c.id).filter(id =>
      id !== 'c0' && id !== 'c1' && id !== 'c2' && !p2Cards.includes(id)
    )

    const rummy = buildSession({
      p1HandCardIds: ['c0', 'c1', 'c2', 'c50', 'c49'],
      p2HandCardIds: p2Cards,
      discardCardIds: [remaining[0]],
      stockCardIds: remaining.slice(1),
      phase: 'discard',
      currentPlayerIndex: 0,
      handCounts: { p1: 5, p2: 10 },
    })

    const { rummy: after } = applyRummyAction(rummy, 'p1', { type: 'LAY_DOWN_MELD', cardIds: ['c0', 'c1', 'c2'] })
    expect(after.session.publicState.handCounts).toEqual({ p1: 2, p2: 10 })
  })

  it('handCounts: DISCARD_CARD (non-going-out) decrements acting player by 1', () => {
    const rummy = createRummyGame(['p1', 'p2'], 42)
    const { rummy: r1 } = applyRummyAction(rummy, 'p1', { type: 'DRAW_FROM_STOCK' })
    // handCounts now p1:11, p2:10
    expect(r1.session.publicState.handCounts).toEqual({ p1: 11, p2: 10 })

    const p1h = r1.session.privateStates['p1'].hand
    const { rummy: r2 } = applyRummyAction(r1, 'p1', { type: 'DISCARD_CARD', cardId: p1h.cards[0].id })
    expect(r2.session.publicState.handCounts).toEqual({ p1: 10, p2: 10 })
  })

  it('handCounts: going out via LAY_DOWN_MELD sets winner handCount to 0', () => {
    // p1 has 3 cards forming a meld, melding all → hand empty → goes out
    const p2Cards = ['c4', 'c5', 'c6', 'c7', 'c8']
    const remaining = createStandardDeck().map(c => c.id).filter(id =>
      id !== 'c0' && id !== 'c1' && id !== 'c2' && id !== 'c3' && !p2Cards.includes(id)
    )

    const rummy = buildSession({
      p1HandCardIds: ['c0', 'c1', 'c2'],
      p2HandCardIds: p2Cards,
      discardCardIds: ['c3'],
      stockCardIds: remaining,
      phase: 'discard',
      currentPlayerIndex: 0,
    })

    const { rummy: after } = applyRummyAction(rummy, 'p1', { type: 'LAY_DOWN_MELD', cardIds: ['c0', 'c1', 'c2'] })
    expect(after.session.publicState.handCounts['p1']).toBe(0)
    // opponent hand unchanged
    expect(after.session.publicState.handCounts['p2']).toBe(p2Cards.length)
  })

  it('handCounts: going out via DISCARD_CARD sets winner handCount to 0', () => {
    // p1 has 1 card, discarding it → hand empty → goes out
    const p2Cards = ['c1', 'c2', 'c3']
    const remaining = createStandardDeck().map(c => c.id).filter(id =>
      id !== 'c0' && !p2Cards.includes(id)
    )

    const rummy = buildSession({
      p1HandCardIds: ['c0'],
      p2HandCardIds: p2Cards,
      discardCardIds: [remaining[0]],
      stockCardIds: remaining.slice(1),
      phase: 'discard',
      currentPlayerIndex: 0,
    })

    const { rummy: after } = applyRummyAction(rummy, 'p1', { type: 'DISCARD_CARD', cardId: 'c0' })
    expect(after.session.publicState.handCounts['p1']).toBe(0)
    expect(after.session.publicState.handCounts['p2']).toBe(p2Cards.length)
  })

  it('handCounts: START_NEXT_ROUND resets both players to 10', () => {
    const p1Cards = ['c0', 'c1', 'c2']
    const p2Cards = ['c4', 'c5', 'c6', 'c7', 'c8']
    const remaining = createStandardDeck().map(c => c.id).filter(id =>
      id !== 'c3' && !p1Cards.includes(id) && !p2Cards.includes(id)
    )

    const afterRound = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['c3'],
      stockCardIds: remaining,
      phase: 'draw',
      currentPlayerIndex: 0,
      scores: { p1: 35, p2: 0 },
      roundOver: true,
      roundWinnerId: 'p1',
    })

    const { rummy: after } = applyRummyAction(afterRound, 'p1', { type: 'START_NEXT_ROUND' })
    expect(after.session.publicState.handCounts).toEqual({ p2: 10, p1: 10 })
  })

  // ── new symmetric scoring & ace-high tests ──────────────────

  it('going out — both players score independently (loser credited for prior melds)', () => {
    // p1 hand: 2♣(c1),2♦(c14),2♥(c27),2♠(c40) → set of 4 twos, meld value = 5×4 = 20,
    // plus J♠(c49) to discard out with
    // p2 meld on table: 5♣(c4),5♦(c17),5♥(c30),5♠(c43) → set of 4 fives, value = 20
    // p2 hand (leftover deadwood): 6♣(c5),6♦(c18) → deadwood = 5+5 = 10
    // p1 delta = 20 - 0 = 20; p2 delta = 20 - 10 = 10
    const p1Cards = ['c1', 'c14', 'c27', 'c40', 'c49']
    const p2HandCards = ['c5', 'c18']
    const p2MeldCards = [cardMap('c4'), cardMap('c17'), cardMap('c30'), cardMap('c43')]
    const used = new Set([...p1Cards, ...p2HandCards, 'c4', 'c17', 'c30', 'c43', 'c51'])
    const stockCards = createStandardDeck().map(c => c.id).filter(id => !used.has(id))

    const p2MeldZone = addCards(createHand('p2'), p2MeldCards)

    const rummy = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2HandCards,
      discardCardIds: ['c51'],
      stockCardIds: stockCards,
      phase: 'discard',
      currentPlayerIndex: 0,
      melds: { p1: [], p2: [p2MeldZone] },
    })

    const melded = applyRummyAction(rummy, 'p1', { type: 'LAY_DOWN_MELD', cardIds: ['c1', 'c14', 'c27', 'c40'] })
    expect(melded.outcome.ok).toBe(true)
    const result = applyRummyAction(melded.rummy, 'p1', { type: 'DISCARD_CARD', cardId: 'c49' })
    expect(result.outcome.ok).toBe(true)

    const pub = result.rummy.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.roundWinnerId).toBe('p1')
    // p1: 2-set meld = 20; empty hand → +20
    // p2: 5-set meld = 20; deadwood 5+5=10 → 20-10 = +10
    expect(pub.scores['p1']).toBe(20)
    expect(pub.scores['p2']).toBe(10)

    expect(totalCards(result.rummy)).toBe(52)
  })

  it('going out via Q-K-A ace-high run — ace contributes 15 to meld value', () => {
    // p1 hand: Q♠(c50),K♠(c51),A♠(c39) → ace-high run, meld value = 10+10+15 = 35,
    // plus 5♣(c4) to discard out with
    // p2 hand: 2♣(c1),3♣(c2),4♣(c3) → deadwood = 5+5+5 = 15
    const p1Cards = ['c50', 'c51', 'c39', 'c4']
    const p2Cards = ['c1', 'c2', 'c3']
    const used = new Set([...p1Cards, ...p2Cards, 'c0'])
    const stockCards = createStandardDeck().map(c => c.id).filter(id => !used.has(id))

    const rummy = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['c0'],
      stockCardIds: stockCards,
      phase: 'discard',
      currentPlayerIndex: 0,
    })

    const melded = applyRummyAction(rummy, 'p1', { type: 'LAY_DOWN_MELD', cardIds: ['c50', 'c51', 'c39'] })
    expect(melded.outcome.ok).toBe(true)
    const result = applyRummyAction(melded.rummy, 'p1', { type: 'DISCARD_CARD', cardId: 'c4' })
    expect(result.outcome.ok).toBe(true)

    const pub = result.rummy.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.roundWinnerId).toBe('p1')
    // p1: QKA meld = 10+10+15=35; empty hand → +35
    // p2: no melds; deadwood 5+5+5=15 → -15
    expect(pub.scores['p1']).toBe(35)
    expect(pub.scores['p2']).toBe(-15)

    expect(totalCards(result.rummy)).toBe(52)
  })

  it('match winner tiebreak — both cross target, opponent higher → opponent wins', () => {
    // p1 hand: A♣(c0),2♣(c1),3♣(c2) → meld value = 5+5+5 = 15, plus 6♣(c5) to discard out with
    // p2 meld: 10♣(c9),10♦(c22),10♥(c35) → set of 3 tens, value = 10+10+10 = 30
    // p2 hand: 5♣(c4),5♦(c17) → deadwood = 5+5 = 10
    // Start: p1=95, p2=95
    // p1 delta = 15 → p1=110 (≥100)
    // p2 delta = 30-10=20 → p2=115 (≥100)
    // Both at target, p2 higher → opponent (p2) wins
    const p1Cards = ['c0', 'c1', 'c2', 'c5']
    const p2HandCards = ['c4', 'c17']
    const p2MeldCards = [cardMap('c9'), cardMap('c22'), cardMap('c35')]
    const used = new Set([...p1Cards, ...p2HandCards, 'c9', 'c22', 'c35', 'c51'])
    const stockCards = createStandardDeck().map(c => c.id).filter(id => !used.has(id))

    const p2MeldZone = addCards(createHand('p2'), p2MeldCards)

    const rummy = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2HandCards,
      discardCardIds: ['c51'],
      stockCardIds: stockCards,
      phase: 'discard',
      currentPlayerIndex: 0,
      scores: { p1: 95, p2: 95 },
      melds: { p1: [], p2: [p2MeldZone] },
    })

    const melded = applyRummyAction(rummy, 'p1', { type: 'LAY_DOWN_MELD', cardIds: ['c0', 'c1', 'c2'] })
    expect(melded.outcome.ok).toBe(true)
    const result = applyRummyAction(melded.rummy, 'p1', { type: 'DISCARD_CARD', cardId: 'c5' })
    expect(result.outcome.ok).toBe(true)

    const pub = result.rummy.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.roundWinnerId).toBe('p1')
    // p1: 5+5+5=15 → 95+15=110; p2: 30-(5+5)=20 → 95+20=115
    expect(pub.scores['p1']).toBe(110)
    expect(pub.scores['p2']).toBe(115)
    // Both ≥100, p2 higher → opponent wins the match
    expect(pub.matchWinnerId).toBe('p2')
  })

  it('match winner tiebreak — both cross target, equal scores → player who went out wins', () => {
    // p1 hand: A♣(c0),2♣(c1),3♣(c2) → meld value = 5+5+5 = 15, plus 6♣(c5) to discard out with
    // p2 meld: 5♣(c4),5♦(c17),5♥(c30),5♠(c43) → set of 4 fives, value = 20
    // p2 hand: 6♦(c18) → deadwood = 5
    // Start: p1=95, p2=95
    // p1 delta = 15 → p1=110 (≥100)
    // p2 delta = 20-5=15 → p2=110 (≥100)
    // Both at target with equal scores → player who went out (p1) wins
    const p1Cards = ['c0', 'c1', 'c2', 'c5']
    const p2HandCards = ['c18']
    const p2MeldCards = [cardMap('c4'), cardMap('c17'), cardMap('c30'), cardMap('c43')]
    const used = new Set([...p1Cards, ...p2HandCards, 'c4', 'c17', 'c30', 'c43', 'c51'])
    const stockCards = createStandardDeck().map(c => c.id).filter(id => !used.has(id))

    const p2MeldZone = addCards(createHand('p2'), p2MeldCards)

    const rummy = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2HandCards,
      discardCardIds: ['c51'],
      stockCardIds: stockCards,
      phase: 'discard',
      currentPlayerIndex: 0,
      scores: { p1: 95, p2: 95 },
      melds: { p1: [], p2: [p2MeldZone] },
    })

    const melded = applyRummyAction(rummy, 'p1', { type: 'LAY_DOWN_MELD', cardIds: ['c0', 'c1', 'c2'] })
    expect(melded.outcome.ok).toBe(true)
    const result = applyRummyAction(melded.rummy, 'p1', { type: 'DISCARD_CARD', cardId: 'c5' })
    expect(result.outcome.ok).toBe(true)

    const pub = result.rummy.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.roundWinnerId).toBe('p1')
    // p1: 5+5+5=15 → 95+15=110; p2: 20-5=15 → 95+15=110
    expect(pub.scores['p1']).toBe(110)
    expect(pub.scores['p2']).toBe(110)
    // Equal scores, player who went out wins the tiebreak
    expect(pub.matchWinnerId).toBe('p1')
  })

  // ── LAY_OFF: adding cards to an existing meld (yours or the opponent's) ──

  it('LAY_OFF onto your own meld — extends it, still owned by you', () => {
    // p1 meld on table: 5♣,5♦,5♥ (c4,c17,c30). p1 hand: 5♠ (c43) + filler.
    const p1MeldCards = [cardMap('c4'), cardMap('c17'), cardMap('c30')]
    const p1MeldZone = addCards(createHand('p1'), p1MeldCards)
    const used = new Set(['c4', 'c17', 'c30', 'c43', 'c50', 'c51'])
    const stockCards = createStandardDeck().map(c => c.id).filter(id => !used.has(id))

    const rummy = buildSession({
      p1HandCardIds: ['c43', 'c50'],
      p2HandCardIds: [],
      discardCardIds: ['c51'],
      stockCardIds: stockCards,
      phase: 'discard',
      currentPlayerIndex: 0,
      melds: { p1: [p1MeldZone], p2: [] },
    })

    const result = applyRummyAction(rummy, 'p1', { type: 'LAY_OFF', targetPlayerId: 'p1', meldIndex: 0, cardIds: ['c43'] })
    expect(result.outcome.ok).toBe(true)

    const pub = result.rummy.session.publicState
    // The original meld zone is untouched — the laid-off card stays a separate layoff entry.
    expect(pub.melds['p1'][0].cards.map(c => c.id).sort()).toEqual(['c17', 'c30', 'c4'].sort())
    expect(pub.layoffs).toHaveLength(1)
    expect(pub.layoffs[0]).toMatchObject({ playerId: 'p1', targetPlayerId: 'p1', targetMeldIndex: 0 })
    expect(pub.layoffs[0].cards.map(c => c.id)).toEqual(['c43'])
    expect(result.rummy.session.privateStates['p1'].hand.cards.map(c => c.id)).toEqual(['c50'])
    expect(totalCards(result.rummy)).toBe(52)
  })

  it('LAY_OFF onto the opponent\'s meld — scores to the layer, not the meld owner', () => {
    // p1 already melded A♣,2♣,3♣ (c0,c1,c2 = value 15) earlier this round.
    // p2's meld on the table: 5♣,5♦,5♥ (c4,c17,c30 = value 15), owned by p2.
    // p1 lays off 5♠ (c43) onto p2's set, then discards J♠ (c49) to go out — the 5♠'s
    // value (5) should count toward p1's score, not p2's.
    const p1MeldCards = [cardMap('c0'), cardMap('c1'), cardMap('c2')]
    const p1MeldZone = addCards(createHand('p1'), p1MeldCards)
    const p2MeldCards = [cardMap('c4'), cardMap('c17'), cardMap('c30')]
    const p2MeldZone = addCards(createHand('p2'), p2MeldCards)
    const used = new Set(['c0', 'c1', 'c2', 'c4', 'c17', 'c30', 'c43', 'c49', 'c5', 'c18', 'c51'])
    const stockCards = createStandardDeck().map(c => c.id).filter(id => !used.has(id))

    const rummy = buildSession({
      p1HandCardIds: ['c43', 'c49'],
      p2HandCardIds: ['c5', 'c18'],   // 6♣,6♦ → deadwood 10
      discardCardIds: ['c51'],
      stockCardIds: stockCards,
      phase: 'discard',
      currentPlayerIndex: 0,
      melds: { p1: [p1MeldZone], p2: [p2MeldZone] },
    })

    const laidOff = applyRummyAction(rummy, 'p1', { type: 'LAY_OFF', targetPlayerId: 'p2', meldIndex: 0, cardIds: ['c43'] })
    expect(laidOff.outcome.ok).toBe(true)
    const result = applyRummyAction(laidOff.rummy, 'p1', { type: 'DISCARD_CARD', cardId: 'c49' })
    expect(result.outcome.ok).toBe(true)

    const pub = result.rummy.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.roundWinnerId).toBe('p1')
    // p2's original meld zone is untouched — the laid-off 5♠ renders on p1's side instead.
    expect(pub.melds['p2'][0].cards.length).toBe(3)
    expect(pub.layoffs).toHaveLength(1)
    expect(pub.layoffs[0]).toMatchObject({ playerId: 'p1', targetPlayerId: 'p2', targetMeldIndex: 0 })
    expect(pub.layoffs[0].cards.map(c => c.id)).toEqual(['c43'])
    // p1: own meld (A-2-3♣ ace-low run, Ace=5 → 5+5+5=15) + laid-off 5♠ (5) = 20, no deadwood (hand empty)
    // p2: own meld (15) - deadwood (5+5=10) = 5 — NOT credited for the 5♠
    expect(pub.scores['p1']).toBe(20)
    expect(pub.scores['p2']).toBe(5)
    expect(totalCards(result.rummy)).toBe(52)
  })

  it('LAY_OFF rejected — player has not laid down a meld of their own yet', () => {
    const p2MeldCards = [cardMap('c4'), cardMap('c17'), cardMap('c30')]
    const p2MeldZone = addCards(createHand('p2'), p2MeldCards)
    const used = new Set(['c4', 'c17', 'c30', 'c43', 'c51'])
    const stockCards = createStandardDeck().map(c => c.id).filter(id => !used.has(id))

    const rummy = buildSession({
      p1HandCardIds: ['c43'],
      p2HandCardIds: [],
      discardCardIds: ['c51'],
      stockCardIds: stockCards,
      phase: 'discard',
      currentPlayerIndex: 0,
      melds: { p1: [], p2: [p2MeldZone] },
    })

    const result = applyRummyAction(rummy, 'p1', { type: 'LAY_OFF', targetPlayerId: 'p2', meldIndex: 0, cardIds: ['c43'] })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('lay down a meld of your own')
  })

  it('LAY_OFF rejected — the added card does not form a valid meld with the target', () => {
    const p1MeldCards = [cardMap('c0'), cardMap('c1'), cardMap('c2')]
    const p1MeldZone = addCards(createHand('p1'), p1MeldCards)
    const p2MeldCards = [cardMap('c4'), cardMap('c17'), cardMap('c30')]
    const p2MeldZone = addCards(createHand('p2'), p2MeldCards)
    const used = new Set(['c0', 'c1', 'c2', 'c4', 'c17', 'c30', 'c6', 'c51'])
    const stockCards = createStandardDeck().map(c => c.id).filter(id => !used.has(id))

    const rummy = buildSession({
      p1HandCardIds: ['c6'],   // 7♣ — unrelated to p2's set of 5s
      p2HandCardIds: [],
      discardCardIds: ['c51'],
      stockCardIds: stockCards,
      phase: 'discard',
      currentPlayerIndex: 0,
      melds: { p1: [p1MeldZone], p2: [p2MeldZone] },
    })

    const result = applyRummyAction(rummy, 'p1', { type: 'LAY_OFF', targetPlayerId: 'p2', meldIndex: 0, cardIds: ['c6'] })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('cannot be added')
  })

  it('LAY_OFF chains indefinitely — either player can extend an already-extended meld', () => {
    // p2's original meld: 5♣,6♣,7♣ (c4,c5,c6). p1 has a trivial meld of their own (required
    // to lay off at all): A♦,2♦,3♦ (c13,c14,c15).
    // p1 lays off 4♣ (c3) onto p2's run. Then p2 lays off 3♣ (c2) onto the SAME meld — which
    // must be validated against the run as it now stands (3-4-5-6-7), not just the original
    // 5-6-7 — proving the chain has no fixed depth.
    const p1MeldCards = [cardMap('c13'), cardMap('c14'), cardMap('c15')]
    const p1MeldZone = addCards(createHand('p1'), p1MeldCards)
    const p2MeldCards = [cardMap('c4'), cardMap('c5'), cardMap('c6')]
    const p2MeldZone = addCards(createHand('p2'), p2MeldCards)
    const used = new Set(['c13', 'c14', 'c15', 'c4', 'c5', 'c6', 'c3', 'c2', 'c40', 'c41', 'c51'])
    const stockCards = createStandardDeck().map(c => c.id).filter(id => !used.has(id))

    const rummy = buildSession({
      p1HandCardIds: ['c3', 'c40'],   // 4♣ + 2♠ filler (an emptied hand would auto-advance the turn)
      p2HandCardIds: ['c2', 'c41'],   // 3♣ + 3♠ filler
      discardCardIds: ['c51'],
      stockCardIds: stockCards,
      phase: 'discard',
      currentPlayerIndex: 0,
      melds: { p1: [p1MeldZone], p2: [p2MeldZone] },
    })

    const r1 = applyRummyAction(rummy, 'p1', { type: 'LAY_OFF', targetPlayerId: 'p2', meldIndex: 0, cardIds: ['c3'] })
    expect(r1.outcome.ok).toBe(true)
    expect(r1.rummy.session.publicState.melds['p2'][0].cards.length).toBe(3)   // still just the original 3
    expect(r1.rummy.session.publicState.layoffs).toHaveLength(1)

    // Hand the turn to p2 (LAY_OFF is turn-gated; direct index flip mirrors buildSession's own pattern).
    const midSession = r1.rummy.session
    const p2Turn = { ...midSession.publicState.turn, currentIndex: midSession.publicState.turn.playerOrder.indexOf('p2') }
    const midRummy = { ...r1.rummy, session: { ...midSession, publicState: { ...midSession.publicState, turn: p2Turn } } }

    const r2 = applyRummyAction(midRummy, 'p2', { type: 'LAY_OFF', targetPlayerId: 'p2', meldIndex: 0, cardIds: ['c2'] })
    expect(r2.outcome.ok).toBe(true)

    const pub = r2.rummy.session.publicState
    expect(pub.melds['p2'][0].cards.length).toBe(3)   // original zone still untouched
    expect(pub.layoffs).toHaveLength(2)
    expect(pub.layoffs[0]).toMatchObject({ playerId: 'p1', targetPlayerId: 'p2', targetMeldIndex: 0 })
    expect(pub.layoffs[1]).toMatchObject({ playerId: 'p2', targetPlayerId: 'p2', targetMeldIndex: 0 })
    // p2's LAY_OFF above only succeeds because it's validated against the full 4-5-6-7 group
    // (3 is only consecutive with 4, not with the original 5-6-7 alone) — that's the chain proof.
    expect(totalCards(r2.rummy)).toBe(52)
  })

  // ── obligated-card soft-lock regression tests ────────────────
  // Reaching into the discard obligates the reached card; a later meld that strips the card's
  // only support must be rejected (or the turn becomes unfinishable), unless the obligated
  // card can still be laid off onto an existing meld group.

  it('obligated-card soft-lock — melding away the obligated card\'s support is rejected, session unchanged', () => {
    // p2 holds 8♠(c46),9♠(c47),8♥(c33),8♦(c20). Discard [K♠,7♠,Q♠,K♣] — reaching for
    // index 1 (7♠) takes 7♠,Q♠,K♣ and sets the obligation (7♠-8♠-9♠ run becomes available).
    const p2Cards = ['c46', 'c47', 'c33', 'c20']
    const discardCards = ['c51', 'c45', 'c50', 'c12']
    const p1Cards = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9']
    const used = new Set([...p2Cards, ...discardCards, ...p1Cards])
    const stockCards = createStandardDeck().map((c) => c.id).filter((id) => !used.has(id))

    const rummy = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: discardCards,
      stockCardIds: stockCards,
      phase: 'draw',
      currentPlayerIndex: 1,
    })

    const { rummy: afterDraw } = applyRummyAction(rummy, 'p2', { type: 'DRAW_FROM_DISCARD', index: 1 })
    expect(afterDraw.session.publicState.obligatedCardId).toBe('c45')

    // Laying down the 8-set consumes 8♠ — 7♠ now melds with nothing and has no table group
    // to be laid off onto → must be rejected before it can soft-lock the turn.
    const before = afterDraw.session
    const result = applyRummyAction(afterDraw, 'p2', { type: 'LAY_DOWN_MELD', cardIds: ['c46', 'c33', 'c20'] })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('no way to use the card you reached for')

    // Session state is unchanged by the rejection.
    expect(result.rummy.session.revision).toBe(before.revision)
    expect(result.rummy.session.publicState).toEqual(before.publicState)
    expect(result.rummy.session.privateStates).toEqual(before.privateStates)
  })

  it('obligated-card soft-lock — unrelated meld still allowed while the obligated card stays meldable', () => {
    // p2 holds 8♠(c46),9♠(c47),8♥(c33),8♦(c20) plus a 2-set (c1,c14,c27). Reaching for 7♠
    // obligates it; laying down the unrelated 2-set leaves 7♠-8♠-9♠ intact in the hand.
    const p2Cards = ['c46', 'c47', 'c33', 'c20', 'c1', 'c14', 'c27']
    const discardCards = ['c51', 'c45', 'c50', 'c12']
    const p1Cards = ['c0', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10']
    const used = new Set([...p2Cards, ...discardCards, ...p1Cards])
    const stockCards = createStandardDeck().map((c) => c.id).filter((id) => !used.has(id))

    const rummy = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: discardCards,
      stockCardIds: stockCards,
      phase: 'draw',
      currentPlayerIndex: 1,
    })

    const { rummy: afterDraw } = applyRummyAction(rummy, 'p2', { type: 'DRAW_FROM_DISCARD', index: 1 })
    expect(afterDraw.session.publicState.obligatedCardId).toBe('c45')

    const result = applyRummyAction(afterDraw, 'p2', { type: 'LAY_DOWN_MELD', cardIds: ['c1', 'c14', 'c27'] })
    expect(result.outcome.ok).toBe(true)
    // obligation survives — 7♠-8♠-9♠ is still meldable from the remaining hand
    expect(result.rummy.session.publicState.obligatedCardId).toBe('c45')
    expect(result.rummy.session.publicState.melds['p2'][0].cards.map((c) => c.id).sort()).toEqual(['c1', 'c14', 'c27'].sort())
  })

  it('obligated-card soft-lock — hand-meld stripped but layoff-able onto an existing table group succeeds', () => {
    // p1 already has 4♠5♠6♠ (c42,c43,c44) on the table. p2 holds 8♠(c46),9♠(c47),8♥(c33),
    // 8♦(c20) and reaches for 7♠(c45). Laying down the 8-set strips the run support, but the
    // obligated 7♠ can still be laid off onto p1's spades run → the meld is allowed.
    const p2Cards = ['c46', 'c47', 'c33', 'c20']
    const discardCards = ['c51', 'c45', 'c50', 'c12']
    const p1Cards = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9']
    const p1MeldCards = [cardMap('c42'), cardMap('c43'), cardMap('c44')]
    const p1MeldZone = addCards(createHand('p1'), p1MeldCards)
    const used = new Set([...p2Cards, ...discardCards, ...p1Cards, 'c42', 'c43', 'c44'])
    const stockCards = createStandardDeck().map((c) => c.id).filter((id) => !used.has(id))

    const rummy = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: discardCards,
      stockCardIds: stockCards,
      phase: 'draw',
      currentPlayerIndex: 1,
      melds: { p1: [p1MeldZone], p2: [] },
    })

    const { rummy: afterDraw } = applyRummyAction(rummy, 'p2', { type: 'DRAW_FROM_DISCARD', index: 1 })
    expect(afterDraw.session.publicState.obligatedCardId).toBe('c45')

    const result = applyRummyAction(afterDraw, 'p2', { type: 'LAY_DOWN_MELD', cardIds: ['c46', 'c33', 'c20'] })
    expect(result.outcome.ok).toBe(true)
    expect(result.rummy.session.publicState.obligatedCardId).toBe('c45')

    // The escape hatch the check preserved is real: laying the obligated 7♠ off onto the
    // existing 4♠5♠6♠ run is itself a legal action that clears the obligation.
    const layoff = applyRummyAction(result.rummy, 'p2', { type: 'LAY_OFF', targetPlayerId: 'p1', meldIndex: 0, cardIds: ['c45'] })
    expect(layoff.outcome.ok).toBe(true)
    expect(layoff.rummy.session.publicState.obligatedCardId).toBeNull()
    expect(layoff.rummy.session.publicState.layoffs[0]).toMatchObject({ playerId: 'p2', targetPlayerId: 'p1', targetMeldIndex: 0 })
  })

  it('obligated-card soft-lock — after rejection the turn still ends cleanly via a meld including the obligated card', () => {
    // Same setup as the first test: reach for 7♠, the support-stripping 8-set is rejected,
    // then melding 7♠-8♠-9♠ (which includes the obligated card) clears the obligation and
    // the turn can be finished with a discard.
    const p2Cards = ['c46', 'c47', 'c33', 'c20']
    const discardCards = ['c51', 'c45', 'c50', 'c12']
    const p1Cards = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9']
    const used = new Set([...p2Cards, ...discardCards, ...p1Cards])
    const stockCards = createStandardDeck().map((c) => c.id).filter((id) => !used.has(id))

    const rummy = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: discardCards,
      stockCardIds: stockCards,
      phase: 'draw',
      currentPlayerIndex: 1,
    })

    const { rummy: afterDraw } = applyRummyAction(rummy, 'p2', { type: 'DRAW_FROM_DISCARD', index: 1 })
    expect(afterDraw.session.publicState.obligatedCardId).toBe('c45')

    const rejected = applyRummyAction(afterDraw, 'p2', { type: 'LAY_DOWN_MELD', cardIds: ['c46', 'c33', 'c20'] })
    expect(rejected.outcome.ok).toBe(false)

    // The meld INCLUDING the obligated card is still available and clears the obligation.
    const meldResult = applyRummyAction(rejected.rummy, 'p2', { type: 'LAY_DOWN_MELD', cardIds: ['c45', 'c46', 'c47'] })
    expect(meldResult.outcome.ok).toBe(true)
    expect(meldResult.rummy.session.publicState.obligatedCardId).toBeNull()

    // And the turn ends cleanly with a discard.
    const handAfterMeld = meldResult.rummy.session.privateStates['p2'].hand
    const discardResult = applyRummyAction(meldResult.rummy, 'p2', { type: 'DISCARD_CARD', cardId: handAfterMeld.cards[0].id })
    expect(discardResult.outcome.ok).toBe(true)
    expect(currentPlayer(discardResult.rummy.session.publicState.turn)).toBe('p1')
    expect(discardResult.rummy.session.publicState.turn.phase).toBe('draw')
  })

  // ── N-player (3-4 seats) — spec 35 ──────────────────────────

  it('3-player round — melds and layoffs from multiple players score by contribution, with each player\'s own deadwood', () => {
    // p1's original meld: A♣2♣3♣4♣ (c0,c1,c2,c3) — run, value 5×4 = 20.
    // p2 laid off 5♣ (c4) onto it, p3 laid off 6♣ (c5) onto it → full run A-2-3-4-5-6♣,
    // value 5×6 = 30 (ace-low, so every card is 5). p2's own meld: 5♦5♥5♠ (c17,c30,c43) — set, value 15.
    // p1 hand: J♠ (c49) to discard out with. p2 hand: 6♦7♦ (c18,c19) → deadwood 10. p3 hand: 8♦9♦ (c20,c21) → deadwood 10.
    // p1 delta = 20 - 0 = 20
    // p2 delta = 5♣ (5, laid off onto p1's run) + 15 (own set) - 10 = 10
    // p3 delta = 6♣ (5, laid off onto p1's run) - 10 = -5
    const p1MeldCards = [cardMap('c0'), cardMap('c1'), cardMap('c2'), cardMap('c3')]
    const p1MeldZone = addCards(createHand('p1'), p1MeldCards)
    const p2MeldCards = [cardMap('c17'), cardMap('c30'), cardMap('c43')]
    const p2MeldZone = addCards(createHand('p2'), p2MeldCards)
    const layoffs: RummyLayoff[] = [
      { id: 'layoff-0', playerId: 'p2', targetPlayerId: 'p1', targetMeldIndex: 0, cards: [cardMap('c4')] },
      { id: 'layoff-1', playerId: 'p3', targetPlayerId: 'p1', targetMeldIndex: 0, cards: [cardMap('c5')] },
    ]
    const seatOrder = ['p1', 'p2', 'p3']
    const used = new Set(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c17', 'c30', 'c43', 'c49', 'c18', 'c19', 'c20', 'c21', 'c51'])
    const stockCardIds = createStandardDeck().map((c) => c.id).filter((id) => !used.has(id))

    const rummy = buildSession({
      p1HandCardIds: ['c49'],
      p2HandCardIds: ['c18', 'c19'],
      discardCardIds: ['c51'],
      stockCardIds,
      phase: 'discard',
      currentPlayerIndex: 0,
      seatOrder,
      melds: { p1: [p1MeldZone], p2: [p2MeldZone], p3: [] },
      layoffs,
      otherHandCardIds: { p3: ['c20', 'c21'] },
    })

    const result = applyRummyAction(rummy, 'p1', { type: 'DISCARD_CARD', cardId: 'c49' })
    expect(result.outcome.ok).toBe(true)

    const pub = result.rummy.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.roundWinnerId).toBe('p1')
    expect(pub.scores).toEqual({ p1: 20, p2: 10, p3: -5 })
    // Original meld zones are untouched by layoffs; both layoffs recorded separately.
    expect(pub.melds['p1'][0].cards.length).toBe(4)
    expect(pub.melds['p2'][0].cards.length).toBe(3)
    expect(pub.layoffs).toHaveLength(2)
    expect(pub.handCounts).toEqual({ p1: 0, p2: 2, p3: 2 })
    expect(totalCardsAll(result.rummy, seatOrder)).toBe(52)
    // Invariant: sum of deltas = total meld value on the table (30 + 15) - total deadwood (10 + 10).
    expect(pub.scores['p1'] + pub.scores['p2'] + pub.scores['p3']).toBe(25)
    expect(pub.matchWinnerId).toBeNull()
  })

  it('4-player going out — every non-going-out player\'s score drops by their OWN deadwood', () => {
    // p1 melds A♣2♣3♣ (c0,c1,c2) = 15 and discards J♠ (c49) to go out.
    // p2: no melds, hand A♦2♦3♦ (c13,c14,c15) → deadwood 15+5+5 = 25 → delta -25
    // p3: no melds, hand 4♦5♦6♦ (c16,c17,c18) → deadwood 5+5+5 = 15 → delta -15
    // p4: no melds, hand 2♠3♠ (c40,c41) → deadwood 5+5 = 10 → delta -10
    // The old 2-player code only subtracted the single "opponent"'s deadwood; p3 and p4 would
    // have been left at 0. Every seated player must get their own deadwood subtracted.
    const p1MeldCards = [cardMap('c0'), cardMap('c1'), cardMap('c2')]
    const p1MeldZone = addCards(createHand('p1'), p1MeldCards)
    const seatOrder = ['p1', 'p2', 'p3', 'p4']
    const used = new Set(['c0', 'c1', 'c2', 'c49', 'c13', 'c14', 'c15', 'c16', 'c17', 'c18', 'c40', 'c41', 'c51'])
    const stockCardIds = createStandardDeck().map((c) => c.id).filter((id) => !used.has(id))

    const rummy = buildSession({
      p1HandCardIds: ['c49'],
      p2HandCardIds: ['c13', 'c14', 'c15'],
      discardCardIds: ['c51'],
      stockCardIds,
      phase: 'discard',
      currentPlayerIndex: 0,
      seatOrder,
      melds: { p1: [p1MeldZone], p2: [], p3: [], p4: [] },
      otherHandCardIds: { p3: ['c16', 'c17', 'c18'], p4: ['c40', 'c41'] },
    })

    const result = applyRummyAction(rummy, 'p1', { type: 'DISCARD_CARD', cardId: 'c49' })
    expect(result.outcome.ok).toBe(true)

    const pub = result.rummy.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.roundWinnerId).toBe('p1')
    // p1: 15 - 0 = 15; p2: 0 - 25 = -25; p3: 0 - 15 = -15; p4: 0 - 10 = -10
    expect(pub.scores).toEqual({ p1: 15, p2: -25, p3: -15, p4: -10 })
    expect(pub.handCounts).toEqual({ p1: 0, p2: 3, p3: 3, p4: 2 })
    expect(totalCardsAll(result.rummy, seatOrder)).toBe(52)
  })

  it('match winner tiebreak — non-going-out players tied at target: earliest seatOrder wins', () => {
    // p1 goes out with a 15-point meld → p1=15 (below target 100), so the going-out player is
    // NOT a candidate. p2 and p3 both land exactly at 100 with equal scores.
    //   p2: own meld 5♣5♦5♥5♠ (20) - deadwood 2♦3♦4♦ (15) = +5 → 95+5 = 100
    //   p3: own meld 6♣6♦6♥ (15) - deadwood 7♣7♦ (10) = +5 → 95+5 = 100
    // The corrected match-win rule: strictly highest among candidates wins; on a tie that does
    // NOT include the going-out player, the earliest seatOrder position among the tied wins —
    // here p2 (seatOrder [p1, p2, p3]), deterministically, never object-iteration order.
    const p1Cards = ['c0', 'c1', 'c2', 'c49']
    const p2MeldCards = [cardMap('c4'), cardMap('c17'), cardMap('c30'), cardMap('c43')]
    const p3MeldCards = [cardMap('c5'), cardMap('c18'), cardMap('c31')]
    const p2MeldZone = addCards(createHand('p2'), p2MeldCards)
    const p3MeldZone = addCards(createHand('p3'), p3MeldCards)
    const seatOrder = ['p1', 'p2', 'p3']
    const used = new Set(['c0', 'c1', 'c2', 'c49', 'c4', 'c17', 'c30', 'c43', 'c14', 'c15', 'c16', 'c5', 'c18', 'c31', 'c6', 'c19', 'c51'])
    const stockCardIds = createStandardDeck().map((c) => c.id).filter((id) => !used.has(id))

    const rummy = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: ['c14', 'c15', 'c16'],
      discardCardIds: ['c51'],
      stockCardIds,
      phase: 'discard',
      currentPlayerIndex: 0,
      seatOrder,
      scores: { p1: 0, p2: 95, p3: 95 },
      melds: { p1: [], p2: [p2MeldZone], p3: [p3MeldZone] },
      otherHandCardIds: { p3: ['c6', 'c19'] },
    })

    const melded = applyRummyAction(rummy, 'p1', { type: 'LAY_DOWN_MELD', cardIds: ['c0', 'c1', 'c2'] })
    expect(melded.outcome.ok).toBe(true)
    const result = applyRummyAction(melded.rummy, 'p1', { type: 'DISCARD_CARD', cardId: 'c49' })
    expect(result.outcome.ok).toBe(true)

    const pub = result.rummy.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.roundWinnerId).toBe('p1')
    expect(pub.scores).toEqual({ p1: 15, p2: 100, p3: 100 })
    // p1 is below target; p2 and p3 tie at the highest score; earliest seatOrder wins.
    expect(pub.matchWinnerId).toBe('p2')
    expect(totalCardsAll(result.rummy, seatOrder)).toBe(52)
  })

  it('START_NEXT_ROUND rotates the starter through every seat in seatOrder order (3 players, 4 rounds)', () => {
    // Hand-verified trace for seatOrder [p1, p2, p3]:
    //   round 1 starts at seatOrder[0] = p1 (createTurnState starts at index 0)
    //   round 1 ends  → next starter = seatOrder[roundNumber % 3] = seatOrder[1] = p2
    //   round 2 ends  → next starter = seatOrder[2 % 3] = seatOrder[2] = p3
    //   round 3 ends  → next starter = seatOrder[3 % 3] = seatOrder[0] = p1 (wraps)
    // The rotation is against the FIXED seatOrder — never the previous round's turn order.
    const seatOrder = ['p1', 'p2', 'p3']
    const p1Cards = ['c0', 'c1', 'c2']
    const p2Cards = ['c4', 'c5', 'c6']
    const used = new Set([...p1Cards, ...p2Cards, 'c3', 'c7', 'c8', 'c9'])
    const stockCardIds = createStandardDeck().map((c) => c.id).filter((id) => !used.has(id))

    // Flip a finished-round session back to round-over so the chain can continue (START_NEXT_ROUND
    // is the only thing that legitimately transitions a round-over state).
    const markRoundOver = (r: RummySession): RummySession => {
      const session = r.session
      return { ...r, session: { ...session, publicState: { ...session.publicState, roundOver: true } } }
    }

    const round1 = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['c3'],
      stockCardIds,
      phase: 'draw',
      currentPlayerIndex: 0,
      seatOrder,
      roundOver: true,
      roundWinnerId: 'p1',
      otherHandCardIds: { p3: ['c7', 'c8', 'c9'] },
    })
    expect(currentPlayer(round1.session.publicState.turn)).toBe('p1')   // round 1 starter = seatOrder[0]

    // Round 2: starter should be seatOrder[1] = p2.
    const round2 = applyRummyAction(round1, 'p1', { type: 'START_NEXT_ROUND' })
    expect(round2.outcome.ok).toBe(true)
    let pub = round2.rummy.session.publicState
    expect(pub.roundNumber).toBe(2)
    expect(pub.seatOrder).toEqual(seatOrder)
    expect(pub.turn.playerOrder).toEqual(seatOrder)
    expect(currentPlayer(pub.turn)).toBe('p2')
    expect(pub.turn.phase).toBe('draw')
    expect(pub.handCounts).toEqual({ p1: 10, p2: 10, p3: 10 })
    expect(cardCount(round2.rummy.stock)).toBe(21)   // 52 - 3×10 - 1 discard
    expect(cardCount(pub.discardPile)).toBe(1)
    expect(totalCardsAll(round2.rummy, seatOrder)).toBe(52)

    // Round 3: starter should be seatOrder[2] = p3.
    const round3 = applyRummyAction(markRoundOver(round2.rummy), 'p1', { type: 'START_NEXT_ROUND' })
    expect(round3.outcome.ok).toBe(true)
    pub = round3.rummy.session.publicState
    expect(pub.roundNumber).toBe(3)
    expect(currentPlayer(pub.turn)).toBe('p3')

    // Round 4: starter should wrap to seatOrder[0] = p1.
    const round4 = applyRummyAction(markRoundOver(round3.rummy), 'p1', { type: 'START_NEXT_ROUND' })
    expect(round4.outcome.ok).toBe(true)
    pub = round4.rummy.session.publicState
    expect(pub.roundNumber).toBe(4)
    expect(currentPlayer(pub.turn)).toBe('p1')
    expect(pub.seatOrder).toEqual(seatOrder)
    expect(pub.turn.playerOrder).toEqual(seatOrder)
  })

  it('property: 2-4 seat bot playouts keep conservation, handCounts/stockCount sync, fixed seatOrder, and the going-out delta-sum identity', () => {
    for (let trial = 0; trial < 9; trial++) {
      const n = 2 + (trial % 3)   // cycles 2..4 so every seat count gets covered
      const players = Array.from({ length: n }, (_, i) => `p${i}`)
      let rummy = createRummyGame(players, trial)
      let roundStartScores = { ...rummy.session.publicState.scores }
      let actions = 0
      const maxActions = 120

      while (actions < maxActions && !rummy.session.publicState.matchWinnerId) {
        const pub = rummy.session.publicState
        const result = pub.roundOver
          ? applyRummyAction(rummy, players[0], { type: 'START_NEXT_ROUND' })
          : runRummyBotTurn(rummy, currentPlayer(pub.turn), rummyBotStrategy)
        expect(
          result.outcome.ok,
          `trial ${trial} (${n} players) action ${actions}: ${result.outcome.reason ?? '(no reason)'}`,
        ).toBe(true)
        rummy = result.rummy
        actions++

        const after = rummy.session.publicState
        // 1. seatOrder is fixed for the whole match
        expect(after.seatOrder).toEqual(players)
        // 2. the public stockCount never drifts from the real host-side stock
        expect(after.stockCount).toBe(cardCount(rummy.stock))
        // 3. all 52 cards are always conserved across hands + stock + discard + melds + layoffs
        expect(totalCardsAll(rummy, players)).toBe(52)
        // 4. handCounts never drift from the real private hands
        for (const p of players) {
          expect(after.handCounts[p]).toBe(cardCount(rummy.session.privateStates[p].hand))
        }

        if (pub.roundOver && !after.roundOver) {
          // a new round just started — snapshot scores for the delta-sum identity below
          roundStartScores = { ...after.scores }
        } else if (after.roundOver && after.roundWinnerId) {
          // Going-out round: sum of score deltas = total meld value on the table
          // - total deadwood left in everyone's hands.
          let meldTotal = 0
          for (const p of players) {
            for (let i = 0; i < (after.melds[p] ?? []).length; i++) {
              meldTotal += meldValue(fullMeldCards(after.melds, after.layoffs, p, i))
            }
          }
          const deadwoodTotal = players.reduce((s, p) => s + deadwood(rummy.session.privateStates[p].hand.cards), 0)
          const deltaSum = players.reduce((s, p) => s + (after.scores[p] - (roundStartScores[p] ?? 0)), 0)
          expect(deltaSum, `trial ${trial} (${n} players) going-out delta-sum`).toBe(meldTotal - deadwoodTotal)
        }
      }
    }
  })
})
