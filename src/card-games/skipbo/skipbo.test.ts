import { describe, expect, it } from 'vitest'
import { createSkipBoGame, type SkipBoPublicState, type SkipBoPrivateState, type SkipBoTurnPhase, type SkipBoSession, type SkipBoBuildPile } from './state.ts'
import { applySkipBoAction, chooseBuildPile, selectEmptiestDiscardPile } from './rules.ts'
import { deriveSnapshot } from '../../engine/sync.ts'
import { currentPlayer, createTurnState } from '../../engine/turn-engine.ts'
import { cardCount, createHand, createPlayerZone, createPublicZone, addCards, topCard, type Zone } from '../../card-engine/zones.ts'
import { createSkipBoDeck } from './deck.ts'
import { createRng } from '../../engine/rng.ts'
import { createHostSession } from '../../engine/sync.ts'
import type { Card } from '../../card-engine/cards.ts'

// Skip-Bo deck id layout (162 cards): numbered 1-12 × 12 copies = sb-0..sb-143 (rank n
// occupies sb-((n-1)*12) .. sb-((n-1)*12+11)), wilds = sb-144..sb-161.

function cardMap(): Map<string, Card> {
  return new Map(createSkipBoDeck().map((c) => [c.id, c]))
}

/** Every deck card id NOT in `used` — handy for filling stockpiles with the rest of the deck. */
function remainingDeckIds(used: string[]): string[] {
  const usedSet = new Set(used)
  return createSkipBoDeck().map((c) => c.id).filter((id) => !usedSet.has(id))
}

/** Sum of every card in the session: all host-only stocks + hands + discards + build piles + draw + used. */
function totalCards(game: SkipBoSession, playerIds: string[]): number {
  const pub = game.session.publicState
  let total = cardCount(game.drawPile) + cardCount(game.usedPile)
  for (const playerId of playerIds) {
    const priv = game.session.privateStates[playerId]
    total += cardCount(game.stocks[playerId]) + cardCount(priv.hand)
    for (const pile of priv.discards) total += cardCount(pile)
  }
  for (const pile of pub.buildPiles) total += pile.cards.length
  return total
}

function allCardIds(game: SkipBoSession, playerIds: string[]): string[] {
  const ids: string[] = []
  const pub = game.session.publicState
  ids.push(...game.drawPile.cards.map((c) => c.id))
  ids.push(...game.usedPile.cards.map((c) => c.id))
  for (const playerId of playerIds) {
    const priv = game.session.privateStates[playerId]
    ids.push(...game.stocks[playerId].cards.map((c) => c.id))
    ids.push(...priv.hand.cards.map((c) => c.id))
    for (const pile of priv.discards) ids.push(...pile.cards.map((c) => c.id))
  }
  for (const pile of pub.buildPiles) ids.push(...pile.cards.map((c) => c.id))
  return ids
}

function buildSession(config: {
  seatOrder?: string[]
  currentPlayerIndex?: number
  hands?: Record<string, string[]>
  stocks?: Record<string, string[]>
  discards?: Record<string, string[][]>   // per player, always 4 piles
  buildPiles?: { cards: string[]; nextNeeded: number }[]
  drawCardIds?: string[]
  usedCardIds?: string[]
  roundOver?: boolean
  winnerId?: string | null
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
    // createTurnState starts at index 0; advance to desired index by directly setting it
    ;(turn as { currentIndex: number }).currentIndex = config.currentPlayerIndex
  }

  const buildPiles: SkipBoBuildPile[] = config.buildPiles
    ? config.buildPiles.map((p) => ({ cards: p.cards.map((id) => map.get(id)!), nextNeeded: p.nextNeeded }))
    : Array.from({ length: 4 }, () => ({ cards: [], nextNeeded: 1 }))

  const drawPile = addCards(createPublicZone('draw', 'private'), (config.drawCardIds ?? []).map((id) => map.get(id)!))
  const usedPile = addCards(createPublicZone('used', 'public'), (config.usedCardIds ?? []).map((id) => map.get(id)!))

  const privateStates: Record<string, SkipBoPrivateState> = {}
  for (const playerId of seatOrder) {
    privateStates[playerId] = { hand: hands[playerId], discards: discards[playerId] }
  }

  const publicState: SkipBoPublicState = {
    cardBack: 'pips_default',
    turn,
    seatOrder,
    stockCounts,
    stockTops,
    handCounts,
    discardTops,
    buildPiles,
    drawCount: cardCount(drawPile),
    usedCount: cardCount(usedPile),
    roundOver: config.roundOver ?? false,
    winnerId: config.winnerId ?? null,
  }

  return {
    session: createHostSession(publicState, privateStates),
    drawPile,
    usedPile,
    stocks,
    rng: createRng(0),
  }
}

// ── initial deal ───────────────────────────────────────────────

describe('createSkipBoGame', () => {
  it('deals correctly for 2 players (30-card stockpiles)', () => {
    const game = createSkipBoGame(['p1', 'p2'], 42)
    const pub = game.session.publicState

    expect(cardCount(game.stocks['p1'])).toBe(30)
    expect(cardCount(game.stocks['p2'])).toBe(30)
    expect(cardCount(game.session.privateStates['p1'].hand)).toBe(5)
    expect(cardCount(game.session.privateStates['p2'].hand)).toBe(5)
    expect(cardCount(game.drawPile)).toBe(92)   // 162 - 2*30 - 2*5
    expect(cardCount(game.usedPile)).toBe(0)
    expect(pub.stockCounts).toEqual({ p1: 30, p2: 30 })
    expect(pub.stockTops['p1']).toEqual(topCard(game.stocks['p1']))
    expect(pub.stockTops['p2']).toEqual(topCard(game.stocks['p2']))
    expect(pub.handCounts).toEqual({ p1: 5, p2: 5 })
    expect(pub.drawCount).toBe(92)
    expect(pub.usedCount).toBe(0)
    expect(pub.discardTops).toEqual({ p1: [null, null, null, null], p2: [null, null, null, null] })
    expect(pub.buildPiles).toEqual([
      { cards: [], nextNeeded: 1 },
      { cards: [], nextNeeded: 1 },
      { cards: [], nextNeeded: 1 },
      { cards: [], nextNeeded: 1 },
    ])
    expect(pub.seatOrder).toEqual(['p1', 'p2'])
    expect(currentPlayer(pub.turn)).toBe('p1')
    expect(pub.turn.phase).toBe('play')
    expect(pub.turn.turnNumber).toBe(1)
    expect(pub.roundOver).toBe(false)
    expect(pub.winnerId).toBeNull()
    expect(game.session.revision).toBe(0)
  })

  it('deals correctly for 3 players (20-card stockpiles)', () => {
    const game = createSkipBoGame(['p1', 'p2', 'p3'], 7)
    const pub = game.session.publicState
    for (const playerId of ['p1', 'p2', 'p3']) {
      expect(cardCount(game.stocks[playerId])).toBe(20)
      expect(cardCount(game.session.privateStates[playerId].hand)).toBe(5)
      expect(pub.stockTops[playerId]).toEqual(topCard(game.stocks[playerId]))
    }
    expect(cardCount(game.drawPile)).toBe(87)   // 162 - 3*20 - 3*5
    expect(pub.drawCount).toBe(87)
    expect(currentPlayer(pub.turn)).toBe('p1')
  })

  it('deals correctly for 4 players (20-card stockpiles)', () => {
    const game = createSkipBoGame(['p1', 'p2', 'p3', 'p4'], 3)
    const pub = game.session.publicState
    for (const playerId of ['p1', 'p2', 'p3', 'p4']) {
      expect(cardCount(game.stocks[playerId])).toBe(20)
      expect(cardCount(game.session.privateStates[playerId].hand)).toBe(5)
      expect(pub.stockTops[playerId]).toEqual(topCard(game.stocks[playerId]))
    }
    expect(cardCount(game.drawPile)).toBe(62)   // 162 - 4*20 - 4*5
    expect(pub.drawCount).toBe(62)
    expect(currentPlayer(pub.turn)).toBe('p1')
  })

  it('conserves all 162 cards with no duplicates at 2, 3, and 4 seats', () => {
    for (const seats of [['p1', 'p2'], ['p1', 'p2', 'p3'], ['p1', 'p2', 'p3', 'p4']]) {
      const game = createSkipBoGame(seats, 42)
      expect(totalCards(game, seats)).toBe(162)
      const ids = allCardIds(game, seats)
      expect(ids).toHaveLength(162)
      expect(new Set(ids).size).toBe(162)
    }
  })

  it('does not leak other seats\' stock identities into a snapshot — only the public top card is visible', () => {
    const game = createSkipBoGame(['p1', 'p2'], 42)
    const p1Stock = game.stocks['p1']
    expect(cardCount(p1Stock)).toBeGreaterThan(1)
    const p1Top = topCard(p1Stock)!
    const p1NonTopIds = new Set(p1Stock.cards.slice(0, -1).map((c) => c.id))
    const snapshot = deriveSnapshot(game.session, 'p2')
    // SkipBoPrivateState no longer carries any stock data at all.
    expect('stock' in snapshot.privateState!).toBe(false)
    // The only stock data p2's snapshot contains is p1's single public TOP card.
    const privateIds = new Set([
      ...snapshot.privateState!.hand.cards.map((c) => c.id),
      ...snapshot.privateState!.discards.flatMap((pile) => pile.cards.map((c) => c.id)),
    ])
    for (const id of p1NonTopIds) {
      expect(privateIds.has(id)).toBe(false)
    }
    expect(snapshot.publicState.stockTops['p1']?.id).toBe(p1Top.id)
    expect(snapshot.publicState.stockTops['p2']?.id).toBe(topCard(game.stocks['p2'])!.id)
  })
})

// ── building-pile legality and auto-targeting ──────────────────

describe('building-pile legality and auto-targeting', () => {
  it('chooseBuildPile picks the furthest-along legal pile, ties to lowest index', () => {
    const map = cardMap()
    const piles: SkipBoBuildPile[] = [
      { cards: ['sb-0'].map((id) => map.get(id)!), nextNeeded: 2 },                          // 1 card
      { cards: ['sb-1', 'sb-12', 'sb-24'].map((id) => map.get(id)!), nextNeeded: 4 },        // 3 cards
      { cards: ['sb-2', 'sb-13'].map((id) => map.get(id)!), nextNeeded: 3 },                 // 2 cards
      { cards: ['sb-3', 'sb-14', 'sb-25', 'sb-37', 'sb-48', 'sb-60'].map((id) => map.get(id)!), nextNeeded: 7 },  // 6 cards
    ]
    // A wild is legal everywhere — goes to the furthest-along pile (index 3)
    expect(chooseBuildPile(map.get('sb-144')!, piles)).toBe(3)
    // Rank 1 matches no pile's nextNeeded (2/4/3/7) — legal nowhere
    expect(chooseBuildPile(map.get('sb-4')!, piles)).toBe(-1)
    // Rank 3 is legal only on the pile whose nextNeeded is 3 (index 2)
    expect(chooseBuildPile(map.get('sb-26')!, piles)).toBe(2)
  })

  it('chooseBuildPile tie-breaks equal-length piles to the lowest index', () => {
    const map = cardMap()
    const piles: SkipBoBuildPile[] = [
      { cards: ['sb-0', 'sb-12', 'sb-24', 'sb-36', 'sb-48'].map((id) => map.get(id)!), nextNeeded: 6 },
      { cards: ['sb-1', 'sb-13', 'sb-25', 'sb-37', 'sb-49'].map((id) => map.get(id)!), nextNeeded: 6 },
      { cards: ['sb-2'].map((id) => map.get(id)!), nextNeeded: 2 },
      { cards: [], nextNeeded: 1 },
    ]
    expect(chooseBuildPile(map.get('sb-144')!, piles)).toBe(0)
  })

  it('accepts a numbered card matching a pile\'s nextNeeded on the chosen pile', () => {
    const game = buildSession({
      hands: { p1: ['sb-0'] },   // rank 1
    })
    const result = applySkipBoAction(game, 'p1', { type: 'PLAY_HAND', cardId: 'sb-0', buildPileIndex: 0 })
    expect(result.outcome.ok).toBe(true)
    const pub = result.game.session.publicState
    // all four piles are fresh (length 0) — the player's chosen pile 0 gets the card
    expect(pub.buildPiles[0].cards.map((c) => c.id)).toEqual(['sb-0'])
    expect(pub.buildPiles[0].nextNeeded).toBe(2)
    expect(pub.buildPiles[1]).toEqual({ cards: [], nextNeeded: 1 })
    expect(pub.handCounts['p1']).toBe(0)
    expect(pub.usedCount).toBe(0)
    expect(result.game.session.revision).toBe(1)
  })

  it('rejects a numbered card that matches no pile', () => {
    const game = buildSession({
      hands: { p1: ['sb-132'] },   // rank 12, all piles need 1
    })
    const result = applySkipBoAction(game, 'p1', { type: 'PLAY_HAND', cardId: 'sb-132', buildPileIndex: 0 })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toBe('not a legal play on that pile')
    expect(result.game.session.revision).toBe(0)
  })

  it('rejects a legal-elsewhere card targeted at a pile where it is illegal', () => {
    const game = buildSession({
      hands: { p1: ['sb-0'] },   // rank 1
      buildPiles: [
        { cards: [], nextNeeded: 2 },   // rank 1 is NOT legal here
        { cards: [], nextNeeded: 1 },   // legal here, but the client chose 0
        { cards: [], nextNeeded: 1 },
        { cards: [], nextNeeded: 1 },
      ],
    })
    const result = applySkipBoAction(game, 'p1', { type: 'PLAY_HAND', cardId: 'sb-0', buildPileIndex: 0 })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toBe('not a legal play on that pile')
    expect(result.game.session.revision).toBe(0)
  })

  it('rejects an out-of-range or non-integer buildPileIndex', () => {
    const game = buildSession({
      hands: { p1: ['sb-0'] },   // rank 1, legal on fresh piles
    })
    for (const buildPileIndex of [4, -1, 1.5]) {
      const result = applySkipBoAction(game, 'p1', { type: 'PLAY_HAND', cardId: 'sb-0', buildPileIndex })
      expect(result.outcome.ok).toBe(false)
      expect(result.outcome.reason).toBe('invalid build pile index')
    }
  })

  it('honors a wild explicitly targeted at a pile that is NOT the furthest along', () => {
    const game = buildSession({
      hands: { p1: ['sb-144'] },
      buildPiles: [
        { cards: ['sb-0'], nextNeeded: 2 },
        { cards: ['sb-1', 'sb-12', 'sb-24'], nextNeeded: 4 },
        { cards: ['sb-2', 'sb-13'], nextNeeded: 3 },
        { cards: ['sb-3', 'sb-14', 'sb-25', 'sb-37', 'sb-48', 'sb-60'], nextNeeded: 7 },
      ],
    })
    const result = applySkipBoAction(game, 'p1', { type: 'PLAY_HAND', cardId: 'sb-144', buildPileIndex: 0 })
    expect(result.outcome.ok).toBe(true)
    const pub = result.game.session.publicState
    expect(pub.buildPiles[0].cards).toHaveLength(2)
    expect(pub.buildPiles[0].nextNeeded).toBe(3)
    expect(pub.buildPiles[3].cards).toHaveLength(6)
    expect(pub.usedCount).toBe(0)
  })

  it('plays from the stock top and from own discard-pile tops onto the chosen piles', () => {
    const game = buildSession({
      hands: { p1: ['sb-24'] },          // rank 3
      stocks: { p1: ['sb-3', 'sb-4'] },  // both rank 1 — top is sb-4; two cards so playing doesn't win
      discards: { p1: [['sb-1'], [], [], []] },  // rank 1 on pile 0
    })
    // stock top first — fresh piles, rank 1 legal everywhere; player chooses pile 0
    const stockPlay = applySkipBoAction(game, 'p1', { type: 'PLAY_STOCK', buildPileIndex: 0 })
    expect(stockPlay.outcome.ok).toBe(true)
    expect(stockPlay.game.session.publicState.buildPiles[0].cards.map((c) => c.id)).toEqual(['sb-4'])
    expect(stockPlay.game.session.publicState.stockCounts['p1']).toBe(1)
    expect(stockPlay.game.session.publicState.stockTops['p1']?.id).toBe('sb-3')

    // discard top next — pile 0 now needs 2, piles 1-3 need 1 → player chooses pile 1
    const discardPlay = applySkipBoAction(stockPlay.game, 'p1', { type: 'PLAY_DISCARD', pileIndex: 0, buildPileIndex: 1 })
    expect(discardPlay.outcome.ok).toBe(true)
    const pub = discardPlay.game.session.publicState
    expect(pub.buildPiles[1].cards.map((c) => c.id)).toEqual(['sb-1'])
    expect(pub.discardTops['p1'][0]).toBeNull()
    expect(pub.buildPiles[0].cards.map((c) => c.id)).toEqual(['sb-4'])
  })
})

// ── pile completion: 12 → clear → 1 ────────────────────────────

describe('pile completion (12 → clear → 1)', () => {
  // ranks 1..11, one card each — a pile one card short of completing
  const eleven = ['sb-0', 'sb-12', 'sb-24', 'sb-36', 'sb-48', 'sb-60', 'sb-72', 'sb-84', 'sb-96', 'sb-108', 'sb-120']

  it('clears a pile into the used pool when a 12 completes it, then restarts at 1', () => {
    const game = buildSession({
      hands: { p1: ['sb-132', 'sb-24'] },   // rank 12 + an unplayed second card so the hand
                                            // does NOT empty (the mid-turn refill that would
                                            // otherwise recycle this used pool is covered in
                                            // the dedicated 'mid-turn hand refill' block)
      buildPiles: [{ cards: eleven, nextNeeded: 12 }, { cards: [], nextNeeded: 1 }, { cards: [], nextNeeded: 1 }, { cards: [], nextNeeded: 1 }],
    })
    const result = applySkipBoAction(game, 'p1', { type: 'PLAY_HAND', cardId: 'sb-132', buildPileIndex: 0 })
    expect(result.outcome.ok).toBe(true)
    const pub = result.game.session.publicState
    expect(pub.buildPiles[0]).toEqual({ cards: [], nextNeeded: 1 })
    expect(cardCount(result.game.usedPile)).toBe(12)
    expect(pub.usedCount).toBe(12)
    expect(pub.drawCount).toBe(0)
  })

  it('a wild can complete a pile too', () => {
    const game = buildSession({
      hands: { p1: ['sb-144', 'sb-24'] },   // same as above — second card keeps the hand from
                                            // emptying so this stays a pile-completion test
      buildPiles: [{ cards: eleven, nextNeeded: 12 }, { cards: [], nextNeeded: 1 }, { cards: [], nextNeeded: 1 }, { cards: [], nextNeeded: 1 }],
    })
    const result = applySkipBoAction(game, 'p1', { type: 'PLAY_HAND', cardId: 'sb-144', buildPileIndex: 0 })
    expect(result.outcome.ok).toBe(true)
    const pub = result.game.session.publicState
    expect(pub.buildPiles[0]).toEqual({ cards: [], nextNeeded: 1 })
    expect(pub.usedCount).toBe(12)
  })

  it('does not clear a pile when nextNeeded is not yet 12', () => {
    const game = buildSession({
      hands: { p1: ['sb-48'] },    // rank 5
      buildPiles: [{ cards: ['sb-0', 'sb-12', 'sb-24', 'sb-36'], nextNeeded: 5 }, { cards: [], nextNeeded: 1 }, { cards: [], nextNeeded: 1 }, { cards: [], nextNeeded: 1 }],
    })
    const result = applySkipBoAction(game, 'p1', { type: 'PLAY_HAND', cardId: 'sb-48', buildPileIndex: 0 })
    expect(result.outcome.ok).toBe(true)
    const pub = result.game.session.publicState
    expect(pub.buildPiles[0].cards).toHaveLength(5)
    expect(pub.buildPiles[0].nextNeeded).toBe(6)
    expect(pub.usedCount).toBe(0)
  })
})

// ── win check ──────────────────────────────────────────────────

describe('win check', () => {
  it('ends the game the instant PLAY_STOCK empties a stockpile — no turn advance, no discard step', () => {
    const game = buildSession({
      hands: { p1: ['sb-12', 'sb-24'] },   // p1 still holds hand cards — they must NOT be touched
      stocks: { p1: ['sb-0'] },            // rank 1 — playable on a fresh pile
    })
    const result = applySkipBoAction(game, 'p1', { type: 'PLAY_STOCK', buildPileIndex: 0 })
    expect(result.outcome.ok).toBe(true)
    const pub = result.game.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.winnerId).toBe('p1')
    expect(currentPlayer(pub.turn)).toBe('p1')   // turn NOT advanced
    expect(pub.turn.turnNumber).toBe(1)
    expect(pub.stockCounts['p1']).toBe(0)
    expect(pub.handCounts['p1']).toBe(2)          // no discard step ran
    expect(pub.buildPiles[0].cards.map((c) => c.id)).toEqual(['sb-0'])
    expect(pub.buildPiles[0].nextNeeded).toBe(2)
  })

  it('fires mid-turn: hand plays before it neither end the round nor advance the turn', () => {
    const game = buildSession({
      hands: { p1: ['sb-12'] },        // rank 2
      stocks: { p1: ['sb-0'] },        // rank 1
      buildPiles: [{ cards: [], nextNeeded: 2 }, { cards: [], nextNeeded: 1 }, { cards: [], nextNeeded: 1 }, { cards: [], nextNeeded: 1 }],
    })
    const afterHand = applySkipBoAction(game, 'p1', { type: 'PLAY_HAND', cardId: 'sb-12', buildPileIndex: 0 })
    expect(afterHand.outcome.ok).toBe(true)
    expect(afterHand.game.session.publicState.roundOver).toBe(false)
    expect(currentPlayer(afterHand.game.session.publicState.turn)).toBe('p1')

    const afterStock = applySkipBoAction(afterHand.game, 'p1', { type: 'PLAY_STOCK', buildPileIndex: 1 })
    expect(afterStock.outcome.ok).toBe(true)
    const pub = afterStock.game.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.winnerId).toBe('p1')
    expect(currentPlayer(pub.turn)).toBe('p1')
    expect(pub.turn.turnNumber).toBe(1)
  })

  it('PLAY_HAND never triggers the win check', () => {
    const game = buildSession({
      hands: { p1: ['sb-1'] },         // rank 1, also playable
      stocks: { p1: ['sb-0'] },        // one card left — only PLAY_STOCK may win
    })
    const result = applySkipBoAction(game, 'p1', { type: 'PLAY_HAND', cardId: 'sb-1', buildPileIndex: 0 })
    expect(result.outcome.ok).toBe(true)
    const pub = result.game.session.publicState
    expect(pub.roundOver).toBe(false)
    expect(pub.winnerId).toBeNull()
    expect(pub.stockCounts['p1']).toBe(1)
  })

  it('PLAY_DISCARD never triggers the win check', () => {
    const game = buildSession({
      hands: { p1: ['sb-24'] },
      stocks: { p1: ['sb-0'] },
      discards: { p1: [['sb-1'], [], [], []] },   // rank 1 top, playable
    })
    const result = applySkipBoAction(game, 'p1', { type: 'PLAY_DISCARD', pileIndex: 0, buildPileIndex: 0 })
    expect(result.outcome.ok).toBe(true)
    expect(result.game.session.publicState.roundOver).toBe(false)
    expect(result.game.session.publicState.stockCounts['p1']).toBe(1)
  })
})

// ── DISCARD and PASS ───────────────────────────────────────────

describe('DISCARD', () => {
  it('honors the player\'s chosen discard pile (even when another pile is emptier) and ends the turn', () => {
    const game = buildSession({
      hands: { p1: ['sb-0'], p2: ['sb-1', 'sb-2', 'sb-3', 'sb-4', 'sb-5'] },
      stocks: { p1: remainingDeckIds(['sb-0', 'sb-1', 'sb-2', 'sb-3', 'sb-4', 'sb-5']).slice(0, 30), p2: [] },
      discards: { p1: [['sb-12'], [], ['sb-13', 'sb-14', 'sb-15'], ['sb-16', 'sb-17']] },   // lengths [1, 0, 3, 2]
    })
    const result = applySkipBoAction(game, 'p1', { type: 'DISCARD', cardId: 'sb-0', pileIndex: 3 })
    expect(result.outcome.ok).toBe(true)
    const pub = result.game.session.publicState
    const p1Discards = result.game.session.privateStates['p1'].discards
    expect(p1Discards[3].cards.map((c) => c.id)).toEqual(['sb-16', 'sb-17', 'sb-0'])
    expect(p1Discards.map((p) => cardCount(p))).toEqual([1, 0, 3, 3])
    expect(pub.discardTops['p1'][3]).toEqual(cardMap().get('sb-0')!)
    expect(pub.discardTops['p1'][1]).toBeNull()
    expect(pub.handCounts['p1']).toBe(0)
    expect(currentPlayer(pub.turn)).toBe('p2')
    expect(pub.turn.phase).toBe('play')
    expect(pub.turn.turnNumber).toBe(2)
  })

  it('accepts discarding onto an empty pile to start a new pile', () => {
    const game = buildSession({
      hands: { p1: ['sb-0'] },
      discards: { p1: [['sb-12'], [], [], ['sb-13']] },   // lengths [1, 0, 0, 1]
    })
    const result = applySkipBoAction(game, 'p1', { type: 'DISCARD', cardId: 'sb-0', pileIndex: 2 })
    expect(result.outcome.ok).toBe(true)
    const p1Discards = result.game.session.privateStates['p1'].discards
    expect(p1Discards[2].cards.map((c) => c.id)).toEqual(['sb-0'])
    expect(p1Discards[1].cards).toHaveLength(0)
  })

  it('advances the turn and auto-draws the new current player\'s hand up to 5', () => {
    const game = buildSession({
      hands: { p1: ['sb-0'], p2: ['sb-1'] },
      drawCardIds: ['sb-2', 'sb-3', 'sb-4', 'sb-5', 'sb-6', 'sb-7', 'sb-8', 'sb-9'],
    })
    const result = applySkipBoAction(game, 'p1', { type: 'DISCARD', cardId: 'sb-0', pileIndex: 0 })
    expect(result.outcome.ok).toBe(true)
    const pub = result.game.session.publicState
    expect(currentPlayer(pub.turn)).toBe('p2')
    expect(pub.handCounts['p2']).toBe(5)          // 1 + 4 drawn
    expect(pub.drawCount).toBe(4)
    expect(pub.discardTops['p1'][0]?.id).toBe('sb-0')
    expect(pub.usedCount).toBe(0)
  })

  it('rejects a card that is not in the hand', () => {
    const game = buildSession({ hands: { p1: ['sb-0'] } })
    const result = applySkipBoAction(game, 'p1', { type: 'DISCARD', cardId: 'sb-999', pileIndex: 0 })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toBe('card not in hand')
  })

  it('rejects an out-of-range or non-integer discard pile index', () => {
    const game = buildSession({ hands: { p1: ['sb-0'] } })
    for (const pileIndex of [4, -1, 1.5]) {
      const result = applySkipBoAction(game, 'p1', { type: 'DISCARD', cardId: 'sb-0', pileIndex })
      expect(result.outcome.ok).toBe(false)
      expect(result.outcome.reason).toBe('invalid discard pile index')
    }
  })

  it('selectEmptiestDiscardPile picks the emptiest, ties → lowest index', () => {
    const map = cardMap()
    const zone = (ids: string[]) => addCards(createPlayerZone('p1', 'd', 'private'), ids.map((id) => map.get(id)!))
    const discards = [
      zone(['sb-0']),
      zone(['sb-12', 'sb-13']),
      zone([]),
      zone(['sb-24', 'sb-25', 'sb-26']),
    ]
    expect(selectEmptiestDiscardPile(discards)).toBe(2)
    const tied = [zone([]), zone(['sb-0']), zone([]), zone(['sb-1'])]
    expect(selectEmptiestDiscardPile(tied)).toBe(0)
  })
})

describe('PASS', () => {
  it('rejects PASS when the hand is not empty', () => {
    const game = buildSession({ hands: { p1: ['sb-0'] } })
    const result = applySkipBoAction(game, 'p1', { type: 'PASS' })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toBe('hand is not empty')
  })

  it('advances the turn and auto-draws the new current player\'s hand up to 5', () => {
    const game = buildSession({
      hands: { p1: [], p2: ['sb-1'] },
      drawCardIds: ['sb-2', 'sb-3', 'sb-4', 'sb-5', 'sb-6', 'sb-7', 'sb-8', 'sb-9'],
    })
    const result = applySkipBoAction(game, 'p1', { type: 'PASS' })
    expect(result.outcome.ok).toBe(true)
    const pub = result.game.session.publicState
    expect(currentPlayer(pub.turn)).toBe('p2')
    expect(pub.handCounts['p2']).toBe(5)
    expect(pub.drawCount).toBe(4)
    expect(pub.handCounts['p1']).toBe(0)
  })
})

// ── draw pile / used pool ──────────────────────────────────────

describe('draw pile and used pool', () => {
  it('recycles the whole used pool into the draw pile when it empties mid-draw', () => {
    const p1Hand = ['sb-0']
    const p2Hand = ['sb-1']
    const draw = ['sb-2', 'sb-3']
    const used = ['sb-144', 'sb-145', 'sb-146', 'sb-147', 'sb-148', 'sb-149', 'sb-150', 'sb-151']
    const rest = remainingDeckIds([...p1Hand, ...p2Hand, ...draw, ...used])
    const game = buildSession({
      hands: { p1: p1Hand, p2: p2Hand },
      stocks: { p1: rest.slice(0, 40), p2: rest.slice(40) },
      drawCardIds: draw,
      usedCardIds: used,
    })
    expect(totalCards(game, ['p1', 'p2'])).toBe(162)

    const result = applySkipBoAction(game, 'p1', { type: 'DISCARD', cardId: 'sb-0', pileIndex: 0 })
    expect(result.outcome.ok).toBe(true)
    const pub = result.game.session.publicState
    // p2 needs 4: draws the 2 remaining draw cards, then 2 more from the 8 recycled cards
    expect(pub.handCounts['p2']).toBe(5)
    expect(pub.drawCount).toBe(6)
    expect(pub.usedCount).toBe(0)
    expect(totalCards(result.game, ['p1', 'p2'])).toBe(162)
  })

  it('leaves the hand short without throwing when draw AND used are both empty', () => {
    const p1Hand = ['sb-0']
    const p2Hand = ['sb-1']
    const rest = remainingDeckIds([...p1Hand, ...p2Hand])
    const game = buildSession({
      hands: { p1: p1Hand, p2: p2Hand },
      stocks: { p1: rest.slice(0, 40), p2: rest.slice(40) },
    })
    const result = applySkipBoAction(game, 'p1', { type: 'DISCARD', cardId: 'sb-0', pileIndex: 0 })
    expect(result.outcome.ok).toBe(true)
    const pub = result.game.session.publicState
    expect(pub.handCounts['p2']).toBe(1)   // never refilled
    expect(pub.drawCount).toBe(0)
    expect(pub.usedCount).toBe(0)
    expect(totalCards(result.game, ['p1', 'p2'])).toBe(162)
  })

  it('gives the next player 0 extra cards in the extreme edge case', () => {
    const game = buildSession({
      hands: { p1: ['sb-0'], p2: [] },
    })
    const result = applySkipBoAction(game, 'p1', { type: 'DISCARD', cardId: 'sb-0', pileIndex: 0 })
    expect(result.outcome.ok).toBe(true)
    expect(result.game.session.publicState.handCounts['p2']).toBe(0)
  })
})

// ── mid-turn hand refill (PLAY_HAND emptying the hand) ────────

describe('mid-turn hand refill', () => {
  it('refills the hand to 5 via PLAY_HAND without advancing the turn, and the player keeps playing', () => {
    const game = buildSession({
      hands: { p1: ['sb-0'] },   // rank 1 — the player's LAST hand card
      drawCardIds: ['sb-24', 'sb-36', 'sb-48', 'sb-60', 'sb-12'],  // top is sb-12 (rank 2)
    })
    const result = applySkipBoAction(game, 'p1', { type: 'PLAY_HAND', cardId: 'sb-0', buildPileIndex: 0 })
    expect(result.outcome.ok).toBe(true)
    const pub = result.game.session.publicState
    // the emptied hand is immediately refilled to 5 from the draw pile
    expect(pub.handCounts['p1']).toBe(5)
    expect(pub.drawCount).toBe(0)
    expect(result.game.session.privateStates['p1'].hand.cards.map((c) => c.id)).toEqual([
      'sb-12', 'sb-60', 'sb-48', 'sb-36', 'sb-24',
    ])   // topCard order — first drawn is the draw pile's top
    // the turn is UNCHANGED — same player, same turn number
    expect(currentPlayer(pub.turn)).toBe('p1')
    expect(pub.turn.turnNumber).toBe(1)
    expect(pub.turn.phase).toBe('play')
    expect(pub.buildPiles[0].cards.map((c) => c.id)).toEqual(['sb-0'])
    expect(pub.buildPiles[0].nextNeeded).toBe(2)
    // p1 keeps their turn and can immediately act again with the fresh hand
    const again = applySkipBoAction(result.game, 'p1', { type: 'PLAY_HAND', cardId: 'sb-12', buildPileIndex: 0 })
    expect(again.outcome.ok).toBe(true)
    const againPub = again.game.session.publicState
    expect(againPub.buildPiles[0].cards.map((c) => c.id)).toEqual(['sb-0', 'sb-12'])
    expect(againPub.handCounts['p1']).toBe(4)   // played from the fresh 5, no refill needed
    expect(currentPlayer(againPub.turn)).toBe('p1')
    expect(againPub.turn.turnNumber).toBe(1)
  })

  it('recycles the used pool into the draw pile when a mid-turn refill exhausts it', () => {
    const p1Hand = ['sb-0']
    const p2Hand = ['sb-1']
    const draw = ['sb-2', 'sb-3']
    const used = ['sb-144', 'sb-145', 'sb-146', 'sb-147', 'sb-148', 'sb-149', 'sb-150', 'sb-151']
    const rest = remainingDeckIds([...p1Hand, ...p2Hand, ...draw, ...used])
    const game = buildSession({
      hands: { p1: p1Hand, p2: p2Hand },
      stocks: { p1: rest.slice(0, 40), p2: rest.slice(40) },
      drawCardIds: draw,
      usedCardIds: used,
    })
    expect(totalCards(game, ['p1', 'p2'])).toBe(162)

    const result = applySkipBoAction(game, 'p1', { type: 'PLAY_HAND', cardId: 'sb-0', buildPileIndex: 0 })
    expect(result.outcome.ok).toBe(true)
    const pub = result.game.session.publicState
    // p1 needs 5: draws the 2 remaining draw cards, then 3 more from the 8 recycled cards
    expect(pub.handCounts['p1']).toBe(5)
    expect(pub.drawCount).toBe(5)
    expect(pub.usedCount).toBe(0)
    // still a mid-turn refill — no turn advance
    expect(currentPlayer(pub.turn)).toBe('p1')
    expect(pub.turn.turnNumber).toBe(1)
    expect(totalCards(result.game, ['p1', 'p2'])).toBe(162)
  })

  it('double-empty edge case: hand stays 0 without throwing, and PASS remains legal', () => {
    const game = buildSession({
      hands: { p1: ['sb-0'], p2: ['sb-1'] },
    })   // no draw pile, no used pool
    const result = applySkipBoAction(game, 'p1', { type: 'PLAY_HAND', cardId: 'sb-0', buildPileIndex: 0 })
    expect(result.outcome.ok).toBe(true)
    const pub = result.game.session.publicState
    expect(pub.handCounts['p1']).toBe(0)   // refill attempt found nothing
    expect(pub.drawCount).toBe(0)
    expect(pub.usedCount).toBe(0)
    expect(currentPlayer(pub.turn)).toBe('p1')
    expect(pub.turn.turnNumber).toBe(1)
    // the hand genuinely IS 0 — PASS is the turn-ending escape hatch for this edge case
    const pass = applySkipBoAction(result.game, 'p1', { type: 'PASS' })
    expect(pass.outcome.ok).toBe(true)
    expect(currentPlayer(pass.game.session.publicState.turn)).toBe('p2')
    expect(pass.game.session.publicState.turn.turnNumber).toBe(2)
  })
})

// ── rejection and invariants ───────────────────────────────────

describe('action rejection', () => {
  it('rejects actions when it is not your turn', () => {
    const game = buildSession({ hands: { p1: ['sb-0'] } })
    const result = applySkipBoAction(game, 'p2', { type: 'PLAY_HAND', cardId: 'sb-0', buildPileIndex: 0 })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toBe('not your turn')
  })

  it('rejects PLAY_STOCK with an empty stockpile', () => {
    const game = buildSession({ stocks: { p1: [] } })
    const result = applySkipBoAction(game, 'p1', { type: 'PLAY_STOCK', buildPileIndex: 0 })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toBe('stock is empty')
  })

  it('rejects PLAY_STOCK when the stock top is legal nowhere', () => {
    const game = buildSession({ stocks: { p1: ['sb-132'] } })   // rank 12, all piles need 1
    const result = applySkipBoAction(game, 'p1', { type: 'PLAY_STOCK', buildPileIndex: 0 })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toBe('not a legal play on that pile')
  })

  it('rejects PLAY_HAND for a card not in the hand', () => {
    const game = buildSession({ hands: { p1: ['sb-0'] } })
    const result = applySkipBoAction(game, 'p1', { type: 'PLAY_HAND', cardId: 'sb-1', buildPileIndex: 0 })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toBe('card not in hand')
  })

  it('rejects PLAY_DISCARD for an out-of-range or non-integer pile index', () => {
    const game = buildSession({ discards: { p1: [['sb-0'], [], [], []] } })
    for (const pileIndex of [4, -1, 1.5]) {
      const result = applySkipBoAction(game, 'p1', { type: 'PLAY_DISCARD', pileIndex, buildPileIndex: 0 })
      expect(result.outcome.ok).toBe(false)
      expect(result.outcome.reason).toBe('invalid pile index')
    }
  })

  it('rejects PLAY_DISCARD for an empty pile', () => {
    const game = buildSession({ discards: { p1: [[], ['sb-0'], [], []] } })
    const result = applySkipBoAction(game, 'p1', { type: 'PLAY_DISCARD', pileIndex: 0, buildPileIndex: 0 })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toBe('that discard pile is empty')
  })

  it('rejects PLAY_DISCARD when the pile top is legal nowhere', () => {
    const game = buildSession({ discards: { p1: [['sb-132'], [], [], []] } })   // rank 12
    const result = applySkipBoAction(game, 'p1', { type: 'PLAY_DISCARD', pileIndex: 0, buildPileIndex: 0 })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toBe('not a legal play on that pile')
  })

  it('rejects every action once the round is over', () => {
    const game = buildSession({
      hands: { p1: ['sb-0'] },
      stocks: { p1: ['sb-1'] },
      roundOver: true,
      winnerId: 'p2',
    })
    const handPlay = applySkipBoAction(game, 'p1', { type: 'PLAY_HAND', cardId: 'sb-0', buildPileIndex: 0 })
    expect(handPlay.outcome.ok).toBe(false)
    expect(handPlay.outcome.reason).toBe('round is over')
    const stockPlay = applySkipBoAction(game, 'p1', { type: 'PLAY_STOCK', buildPileIndex: 0 })
    expect(stockPlay.outcome.ok).toBe(false)
    const pass = applySkipBoAction(game, 'p1', { type: 'PASS' })
    expect(pass.outcome.ok).toBe(false)
  })

  it('rejected actions leave the session and host-only piles reference-untouched', () => {
    const game = createSkipBoGame(['p1', 'p2'], 42)
    const drawBefore = game.drawPile
    const usedBefore = game.usedPile
    const stocksBefore = game.stocks
    // p2 acts out of turn — rejected
    const result = applySkipBoAction(game, 'p2', { type: 'PLAY_STOCK', buildPileIndex: 0 })
    expect(result.outcome.ok).toBe(false)
    expect(result.game.session).toBe(game.session)
    expect(result.game.drawPile).toBe(drawBefore)
    expect(result.game.usedPile).toBe(usedBefore)
    expect(result.game.stocks).toBe(stocksBefore)
  })
})
