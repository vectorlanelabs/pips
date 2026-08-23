import { describe, expect, it } from 'vitest'
import { createPhase10Game, type Phase10PublicState, type Phase10PrivateState, type Phase10Action, type Phase10TurnPhase, type Phase10Session, type Phase10Group, type Phase10Hit } from './state.ts'
import { applyPhase10Action, runPhase10BotTurn } from './rules.ts'
import { deriveSnapshot } from '../../engine/sync.ts'
import { currentPlayer, createTurnState } from '../../engine/turn-engine.ts'
import { cardCount, createHand, createDiscardPile, createPublicZone, createPlayerZone, addCards, type Zone } from '../../card-engine/zones.ts'
import { createPhase10Deck } from './deck.ts'
import { createRng } from '../../engine/rng.ts'
import { createHostSession } from '../../engine/sync.ts'
import type { BotStrategy } from '../../engine/bot.ts'
import type { Card } from '../../card-engine/cards.ts'

// Phase 10 deck id layout (108 cards): red 1-12 ×2 = p10-0..p10-23, blue 1-12 ×2 =
// p10-24..p10-47, green 1-12 ×2 = p10-48..p10-71, yellow 1-12 ×2 = p10-72..p10-95,
// Skip = p10-96..p10-99, Wild = p10-100..p10-107.

function totalCards(game: Phase10Session): number {
  const pub = game.session.publicState
  const priv = game.session.privateStates
  let groupCards = 0
  for (const playerId of Object.keys(pub.groups)) {
    for (const group of pub.groups[playerId]) {
      groupCards += cardCount(group.zone)
    }
  }
  const hitCards = pub.hits.reduce((sum, h) => sum + h.cards.length, 0)
  return (
    cardCount(game.stock) +
    cardCount(pub.discardPile) +
    cardCount(priv['p1'].hand) +
    cardCount(priv['p2'].hand) +
    groupCards +
    hitCards
  )
}

// N-player version of totalCards — every card in the session (stock, discard, every seated
// hand, every group zone, every hit) must sum to the 108-card deck.
function totalCardsAll(game: Phase10Session, playerIds: string[]): number {
  const pub = game.session.publicState
  let groupCards = 0
  for (const playerId of playerIds) {
    for (const group of pub.groups[playerId] ?? []) {
      groupCards += cardCount(group.zone)
    }
  }
  const hitCards = pub.hits.reduce((sum, h) => sum + h.cards.length, 0)
  return (
    cardCount(game.stock) +
    cardCount(pub.discardPile) +
    playerIds.reduce((sum, id) => sum + cardCount(game.session.privateStates[id].hand), 0) +
    groupCards +
    hitCards
  )
}

function allUniqueCardIds(game: Phase10Session): Set<string> {
  const ids = new Set<string>()
  for (const card of game.stock.cards) ids.add(card.id)
  for (const card of game.session.publicState.discardPile.cards) ids.add(card.id)
  for (const card of game.session.privateStates['p1'].hand.cards) ids.add(card.id)
  for (const card of game.session.privateStates['p2'].hand.cards) ids.add(card.id)
  for (const playerId of Object.keys(game.session.publicState.groups)) {
    for (const group of game.session.publicState.groups[playerId]) {
      for (const card of group.zone.cards) ids.add(card.id)
    }
  }
  for (const h of game.session.publicState.hits) {
    for (const card of h.cards) ids.add(card.id)
  }
  return ids
}

function allUniqueCardIdsAll(game: Phase10Session, playerIds: string[]): Set<string> {
  const ids = new Set<string>()
  for (const card of game.stock.cards) ids.add(card.id)
  for (const card of game.session.publicState.discardPile.cards) ids.add(card.id)
  for (const playerId of playerIds) {
    for (const card of game.session.privateStates[playerId].hand.cards) ids.add(card.id)
  }
  for (const playerId of Object.keys(game.session.publicState.groups)) {
    for (const group of game.session.publicState.groups[playerId]) {
      for (const card of group.zone.cards) ids.add(card.id)
    }
  }
  for (const h of game.session.publicState.hits) {
    for (const card of h.cards) ids.add(card.id)
  }
  return ids
}

function cardMap(): Map<string, Card> {
  return new Map(createPhase10Deck().map((c) => [c.id, c]))
}

/** Every deck card id NOT in `used` — handy for filling stock with the rest of the deck. */
function remainingDeckIds(used: string[]): string[] {
  const usedSet = new Set(used)
  return createPhase10Deck().map((c) => c.id).filter((id) => !usedSet.has(id))
}

function buildSession(config: {
  p1HandCardIds: string[]
  p2HandCardIds: string[]
  discardCardIds: string[]
  stockCardIds: string[]
  phase?: Phase10TurnPhase
  currentPlayerIndex?: number
  scores?: Record<string, number>
  phaseIdx?: Record<string, number>
  hasLaidPhase?: Record<string, boolean>
  groups?: Record<string, Phase10Group[]>
  hits?: Phase10Hit[]
  roundOver?: boolean
  roundWinnerId?: string | null
  matchWinnerId?: string | null
  handCounts?: Record<string, number>
  seatOrder?: string[]                          // N-player: default ['p1', 'p2']
  otherHandCardIds?: Record<string, string[]>   // hands for players beyond p1/p2, keyed by playerId
}): Phase10Session {
  const map = cardMap()

  function cardsFor(ids: string[]): Card[] {
    return ids.map((id) => map.get(id)!)
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

  const turn = createTurnState<Phase10TurnPhase>(seatOrder, config.phase ?? 'draw')
  if (config.currentPlayerIndex != null) {
    // createTurnState starts at index 0; advance to desired index by directly setting it
    ;(turn as { currentIndex: number }).currentIndex = config.currentPlayerIndex
  }

  const defaultGroups: Record<string, Phase10Group[]> = {}
  const defaultHasLaidPhase: Record<string, boolean> = {}
  const defaultPhaseIdx: Record<string, number> = {}
  const defaultScores: Record<string, number> = {}
  const defaultHandCounts: Record<string, number> = {}
  for (const playerId of seatOrder) {
    defaultGroups[playerId] = []
    defaultHasLaidPhase[playerId] = false
    defaultPhaseIdx[playerId] = 0
    defaultScores[playerId] = 0
    defaultHandCounts[playerId] = cardCount(hands[playerId])
  }

  const publicState: Phase10PublicState = {
    cardBack: 'pips_default',
    turn,
    seatOrder,
    discardPile,
    stockCount: cardCount(stock),
    groups: config.groups ?? defaultGroups,
    hits: config.hits ?? [],
    hasLaidPhase: config.hasLaidPhase ?? defaultHasLaidPhase,
    phaseIdx: config.phaseIdx ?? defaultPhaseIdx,
    scores: config.scores ?? defaultScores,
    roundNumber: 1,
    roundOver: config.roundOver ?? false,
    roundWinnerId: config.roundWinnerId ?? null,
    matchWinnerId: config.matchWinnerId ?? null,
    handCounts: config.handCounts ?? defaultHandCounts,
  }

  const privateStates: Record<string, Phase10PrivateState> = {}
  for (const playerId of seatOrder) {
    privateStates[playerId] = { hand: hands[playerId] }
  }

  return {
    session: createHostSession(publicState, privateStates),
    stock,
    rng: createRng(0),
  }
}

describe('Phase 10 integration harness', () => {
  it('initial deal is correct — 10 each, 1 discard, 87 stock, unique ids, both on Phase 1', () => {
    const game = createPhase10Game(['p1', 'p2'], 42)

    expect(cardCount(game.session.privateStates['p1'].hand)).toBe(10)
    expect(cardCount(game.session.privateStates['p2'].hand)).toBe(10)
    expect(cardCount(game.stock)).toBe(87)
    expect(cardCount(game.session.publicState.discardPile)).toBe(1)
    expect(currentPlayer(game.session.publicState.turn)).toBe('p1')
    expect(game.session.publicState.turn.phase).toBe('draw')
    expect(game.session.publicState.handCounts).toEqual({ p1: 10, p2: 10 })
    expect(game.session.publicState.phaseIdx).toEqual({ p1: 0, p2: 0 })
    expect(totalCards(game)).toBe(108)
    expect(allUniqueCardIds(game).size).toBe(108)
  })

  it('p1 draws from stock — phase moves to discard, stock decrements', () => {
    const game = createPhase10Game(['p1', 'p2'], 42)

    const result = applyPhase10Action(game, 'p1', { type: 'DRAW_FROM_STOCK' })
    expect(result.outcome.ok).toBe(true)

    const next = result.game
    expect(cardCount(next.session.privateStates['p1'].hand)).toBe(11)
    expect(cardCount(next.stock)).toBe(86)
    expect(next.session.publicState.stockCount).toBe(86)
    expect(next.session.publicState.turn.phase).toBe('discard')
    expect(next.session.revision).toBe(1)
    expect(totalCards(next)).toBe(108)
  })

  it('p2 draws from discard — top card only, phase moves to discard', () => {
    const game = createPhase10Game(['p1', 'p2'], 42)
    const r1 = applyPhase10Action(game, 'p1', { type: 'DRAW_FROM_STOCK' })

    // p1 discards a non-Skip so the turn passes to p2 normally
    const p1Hand = r1.game.session.privateStates['p1'].hand.cards
    const discardId = p1Hand.find((c) => c.meta?.kind !== 'skip')!.id
    const r2 = applyPhase10Action(r1.game, 'p1', { type: 'DISCARD_CARD', cardId: discardId })

    const result = applyPhase10Action(r2.game, 'p2', { type: 'DRAW_FROM_DISCARD' })
    expect(result.outcome.ok).toBe(true)

    const after = result.game
    expect(cardCount(after.session.privateStates['p2'].hand)).toBe(11)
    expect(cardCount(after.session.publicState.discardPile)).toBe(1)   // just the initial flip remains
    expect(after.session.publicState.turn.phase).toBe('discard')
    expect(totalCards(after)).toBe(108)
  })

  it('DRAW_FROM_DISCARD rejected when the top card is a Skip', () => {
    const game = buildSession({
      p1HandCardIds: ['p10-0', 'p10-2', 'p10-4', 'p10-6', 'p10-8', 'p10-10', 'p10-12', 'p10-14', 'p10-16', 'p10-18'],
      p2HandCardIds: ['p10-24', 'p10-26', 'p10-28', 'p10-30', 'p10-32', 'p10-34', 'p10-36', 'p10-38', 'p10-40', 'p10-42'],
      discardCardIds: ['p10-72', 'p10-96'],   // top = Skip
      stockCardIds: remainingDeckIds(['p10-0', 'p10-2', 'p10-4', 'p10-6', 'p10-8', 'p10-10', 'p10-12', 'p10-14', 'p10-16', 'p10-18', 'p10-24', 'p10-26', 'p10-28', 'p10-30', 'p10-32', 'p10-34', 'p10-36', 'p10-38', 'p10-40', 'p10-42', 'p10-72', 'p10-96']),
      phase: 'draw',
      currentPlayerIndex: 0,
    })

    const result = applyPhase10Action(game, 'p1', { type: 'DRAW_FROM_DISCARD' })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('Skip card can never be picked up')
    // nothing moved
    expect(cardCount(game.session.privateStates['p1'].hand)).toBe(10)
  })

  it('LAY_PHASE happy path — hasLaidPhase flips, groups populated with correct types', () => {
    // Phase 1 (index 0) = 2 sets of 3: three 5s + three 9s
    const p1Cards = ['p10-8', 'p10-32', 'p10-56', 'p10-16', 'p10-40', 'p10-64', 'p10-0', 'p10-2', 'p10-4', 'p10-6']
    const p2Cards = ['p10-72', 'p10-73', 'p10-74', 'p10-75', 'p10-76', 'p10-77', 'p10-78', 'p10-79', 'p10-80', 'p10-81']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-96'],
      stockCardIds: remainingDeckIds([...p1Cards, ...p2Cards, 'p10-96']),
      phase: 'discard',
      currentPlayerIndex: 0,
    })

    const result = applyPhase10Action(game, 'p1', {
      type: 'LAY_PHASE',
      cardIds: ['p10-8', 'p10-32', 'p10-56', 'p10-16', 'p10-40', 'p10-64'],
    })
    expect(result.outcome.ok).toBe(true)

    const pub = result.game.session.publicState
    expect(pub.hasLaidPhase['p1']).toBe(true)
    expect(pub.hasLaidPhase['p2']).toBe(false)
    expect(pub.groups['p1']).toHaveLength(2)
    expect(pub.groups['p1'].map((g) => g.type)).toEqual(['set', 'set'])
    expect(pub.groups['p1'].map((g) => g.phaseNumber)).toEqual([1, 1])
    expect(pub.groups['p1'][0].zone.cards.map((c) => c.id).sort()).toEqual(['p10-8', 'p10-32', 'p10-56'].sort())
    expect(pub.groups['p1'][1].zone.cards.map((c) => c.id).sort()).toEqual(['p10-16', 'p10-40', 'p10-64'].sort())
    expect(cardCount(result.game.session.privateStates['p1'].hand)).toBe(4)
    expect(pub.handCounts['p1']).toBe(4)
    expect(totalCards(result.game)).toBe(108)
  })

  it('LAY_PHASE rejected — a second LAY_PHASE the same round', () => {
    const p1Cards = ['p10-8', 'p10-32', 'p10-56', 'p10-16', 'p10-40', 'p10-64', 'p10-0', 'p10-2', 'p10-4', 'p10-6']
    const p2Cards = ['p10-72', 'p10-73', 'p10-74', 'p10-75', 'p10-76', 'p10-77', 'p10-78', 'p10-79', 'p10-80', 'p10-81']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-96'],
      stockCardIds: remainingDeckIds([...p1Cards, ...p2Cards, 'p10-96']),
      phase: 'discard',
      currentPlayerIndex: 0,
    })

    const first = applyPhase10Action(game, 'p1', {
      type: 'LAY_PHASE',
      cardIds: ['p10-8', 'p10-32', 'p10-56', 'p10-16', 'p10-40', 'p10-64'],
    })
    expect(first.outcome.ok).toBe(true)

    const second = applyPhase10Action(first.game, 'p1', {
      type: 'LAY_PHASE',
      cardIds: ['p10-0', 'p10-2', 'p10-4', 'p10-6'],
    })
    expect(second.outcome.ok).toBe(false)
    expect(second.outcome.reason).toContain('already laid your phase')
  })

  it('LAY_PHASE rejected — composition does not match the current phase', () => {
    // Phase 1 (index 0) = 2 sets of 3; a single run of 6 reds does not satisfy it
    const p1Cards = ['p10-0', 'p10-2', 'p10-4', 'p10-6', 'p10-8', 'p10-10', 'p10-12', 'p10-14', 'p10-16', 'p10-18']
    const p2Cards = ['p10-72', 'p10-73', 'p10-74', 'p10-75', 'p10-76', 'p10-77', 'p10-78', 'p10-79', 'p10-80', 'p10-81']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-96'],
      stockCardIds: remainingDeckIds([...p1Cards, ...p2Cards, 'p10-96']),
      phase: 'discard',
      currentPlayerIndex: 0,
    })

    const result = applyPhase10Action(game, 'p1', {
      type: 'LAY_PHASE',
      cardIds: ['p10-0', 'p10-2', 'p10-4', 'p10-6', 'p10-8', 'p10-10'],
    })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('does not complete your phase')
    expect(cardCount(result.game.session.privateStates['p1'].hand)).toBe(10)
  })

  it('LAY_PHASE rejected — selection contains a Skip even if the rest would work', () => {
    const p1Cards = ['p10-8', 'p10-32', 'p10-56', 'p10-16', 'p10-40', 'p10-64', 'p10-96', 'p10-0', 'p10-2', 'p10-4']
    const p2Cards = ['p10-72', 'p10-73', 'p10-74', 'p10-75', 'p10-76', 'p10-77', 'p10-78', 'p10-79', 'p10-80', 'p10-81']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-97'],
      stockCardIds: remainingDeckIds([...p1Cards, ...p2Cards, 'p10-97']),
      phase: 'discard',
      currentPlayerIndex: 0,
    })

    const result = applyPhase10Action(game, 'p1', {
      type: 'LAY_PHASE',
      cardIds: ['p10-8', 'p10-32', 'p10-56', 'p10-16', 'p10-40', 'p10-64', 'p10-96'],
    })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('Skip card cannot be used in a phase')
    expect(cardCount(result.game.session.privateStates['p1'].hand)).toBe(10)
  })

  it('going out via LAY_PHASE — laying the entire hand triggers finishRoundByGoingOut', () => {
    const p1Cards = ['p10-8', 'p10-32', 'p10-56', 'p10-16', 'p10-40', 'p10-64']   // exactly Phase 1
    const p2Cards = ['p10-72', 'p10-73', 'p10-74', 'p10-75', 'p10-76', 'p10-77', 'p10-78', 'p10-79', 'p10-80', 'p10-81']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-96'],
      stockCardIds: remainingDeckIds([...p1Cards, ...p2Cards, 'p10-96']),
      phase: 'discard',
      currentPlayerIndex: 0,
    })

    const result = applyPhase10Action(game, 'p1', { type: 'LAY_PHASE', cardIds: p1Cards })
    expect(result.outcome.ok).toBe(true)

    const pub = result.game.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.roundWinnerId).toBe('p1')
    expect(pub.matchWinnerId).toBeNull()
    expect(pub.handCounts['p1']).toBe(0)
    expect(cardCount(result.game.session.privateStates['p1'].hand)).toBe(0)
    // p1 laid their phase → advances to Phase 2; p2 didn't lay → stays on Phase 1
    expect(pub.phaseIdx).toEqual({ p1: 1, p2: 0 })
    expect(totalCards(result.game)).toBe(108)
  })

  it('going out on Phase 9 — group phaseNumber is 9, not the capped phaseIdx 9 (which would read 10)', () => {
    // Regression for the UI inference bug: a player on Phase 9 (phaseIdx 8) who lays and goes
    // out advances to Math.min(8 + 1, 9) = 9 — numerically identical to a Phase 10 lay's
    // post-round phaseIdx. The group must remember it was laid for Phase 9 (phaseNumber 9),
    // not Phase 10.
    // Phase 9 (index 8) = 1 set of 5 + 1 set of 2: five 2s + two 3s — exactly 7 cards
    const p1Cards = ['p10-2', 'p10-3', 'p10-26', 'p10-27', 'p10-50', 'p10-4', 'p10-28']
    const p2Cards = ['p10-72', 'p10-73', 'p10-74', 'p10-75', 'p10-76', 'p10-77', 'p10-78', 'p10-79', 'p10-80', 'p10-81']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-96'],
      stockCardIds: remainingDeckIds([...p1Cards, ...p2Cards, 'p10-96']),
      phase: 'discard',
      currentPlayerIndex: 0,
      phaseIdx: { p1: 8, p2: 0 },
    })

    const result = applyPhase10Action(game, 'p1', { type: 'LAY_PHASE', cardIds: p1Cards })
    expect(result.outcome.ok).toBe(true)

    const pub = result.game.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.roundWinnerId).toBe('p1')
    // 8 + 1 capped at 9 — the SAME value a Phase 10 lay would leave behind
    expect(pub.phaseIdx['p1']).toBe(9)
    expect(pub.groups['p1']).toHaveLength(2)
    expect(pub.groups['p1'].map((g) => g.phaseNumber)).toEqual([9, 9])
    expect(pub.groups['p1'][0].zone.cards.map((c) => c.id).sort()).toEqual(['p10-2', 'p10-3', 'p10-26', 'p10-27', 'p10-50'].sort())
    expect(pub.groups['p1'][1].zone.cards.map((c) => c.id).sort()).toEqual(['p10-4', 'p10-28'].sort())
    expect(totalCards(result.game)).toBe(108)
  })

  it('HIT rejected — player has not laid their own phase yet', () => {
    const p2GroupZone = addCards(createPlayerZone('p2', 'p10group-0', 'public'), ['p10-8', 'p10-32', 'p10-56'].map((id) => cardMap().get(id)!))
    const p1Cards = ['p10-80', 'p10-0', 'p10-2', 'p10-4', 'p10-6', 'p10-10', 'p10-12', 'p10-14', 'p10-16', 'p10-18']
    const p2Cards = ['p10-24', 'p10-26', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-40', 'p10-42', 'p10-44']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-96'],
      stockCardIds: remainingDeckIds([...p1Cards, ...p2Cards, 'p10-96', 'p10-8', 'p10-32', 'p10-56']),
      phase: 'discard',
      currentPlayerIndex: 0,
      groups: { p1: [], p2: [{ type: 'set', zone: p2GroupZone, phaseNumber: 1 }] },
    })

    const result = applyPhase10Action(game, 'p1', { type: 'HIT', targetPlayerId: 'p2', groupIndex: 0, cardIds: ['p10-80'] })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('lay your own phase before hitting')
  })

  it('HIT happy path — onto your own group', () => {
    const p1GroupZone = addCards(createPlayerZone('p1', 'p10group-0', 'public'), ['p10-8', 'p10-32', 'p10-56'].map((id) => cardMap().get(id)!))
    const p1Cards = ['p10-80', 'p10-0', 'p10-2', 'p10-4', 'p10-6', 'p10-10', 'p10-12', 'p10-14', 'p10-16', 'p10-18']
    const p2Cards = ['p10-72', 'p10-73', 'p10-74', 'p10-75', 'p10-76', 'p10-77', 'p10-78', 'p10-79', 'p10-81', 'p10-82']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-96'],
      stockCardIds: remainingDeckIds([...p1Cards, ...p2Cards, 'p10-96', 'p10-8', 'p10-32', 'p10-56']),
      phase: 'discard',
      currentPlayerIndex: 0,
      hasLaidPhase: { p1: true, p2: false },
      groups: { p1: [{ type: 'set', zone: p1GroupZone, phaseNumber: 1 }], p2: [] },
    })

    const result = applyPhase10Action(game, 'p1', { type: 'HIT', targetPlayerId: 'p1', groupIndex: 0, cardIds: ['p10-80'] })
    expect(result.outcome.ok).toBe(true)

    const pub = result.game.session.publicState
    expect(pub.hits).toHaveLength(1)
    expect(pub.hits[0]).toMatchObject({ id: 'hit-0', playerId: 'p1', targetPlayerId: 'p1', targetGroupIndex: 0 })
    expect(pub.hits[0].cards.map((c) => c.id)).toEqual(['p10-80'])
    // the original zone is untouched — the hit card stays attributed to the hitter
    expect(pub.groups['p1'][0].zone.cards.map((c) => c.id).sort()).toEqual(['p10-8', 'p10-32', 'p10-56'].sort())
    expect(cardCount(result.game.session.privateStates['p1'].hand)).toBe(9)
    expect(pub.handCounts['p1']).toBe(9)
    expect(totalCards(result.game)).toBe(108)
  })

  it('HIT happy path — onto the opponent\'s group', () => {
    // p2's group is a run red 4-5-6; p1 hits a red 7 onto it
    const p2GroupZone = addCards(createPlayerZone('p2', 'p10group-0', 'public'), ['p10-6', 'p10-8', 'p10-10'].map((id) => cardMap().get(id)!))
    const p1Cards = ['p10-12', 'p10-0', 'p10-2', 'p10-4', 'p10-14', 'p10-16', 'p10-18', 'p10-20', 'p10-22', 'p10-24']
    const p2Cards = ['p10-26', 'p10-28', 'p10-30', 'p10-32', 'p10-34', 'p10-36', 'p10-38', 'p10-40', 'p10-42', 'p10-44']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-96'],
      stockCardIds: remainingDeckIds([...p1Cards, ...p2Cards, 'p10-96', 'p10-6', 'p10-8', 'p10-10']),
      phase: 'discard',
      currentPlayerIndex: 0,
      hasLaidPhase: { p1: true, p2: false },
      groups: { p1: [], p2: [{ type: 'run', zone: p2GroupZone, phaseNumber: 2 }] },
    })

    const result = applyPhase10Action(game, 'p1', { type: 'HIT', targetPlayerId: 'p2', groupIndex: 0, cardIds: ['p10-12'] })
    expect(result.outcome.ok).toBe(true)
    expect(result.game.session.publicState.hits[0]).toMatchObject({ playerId: 'p1', targetPlayerId: 'p2', targetGroupIndex: 0 })
    expect(result.game.session.publicState.hits[0].cards.map((c) => c.id)).toEqual(['p10-12'])
    expect(totalCards(result.game)).toBe(108)
  })

  it('HIT happy path — two cards hit onto the same group in one action', () => {
    // p2's group is a run green 3-4-5-6-7; p1 hits green 1 AND green 2 onto it in one HIT
    const p2GroupZone = addCards(createPlayerZone('p2', 'p10group-0', 'public'), ['p10-52', 'p10-54', 'p10-56', 'p10-58', 'p10-60'].map((id) => cardMap().get(id)!))
    const p1Cards = ['p10-48', 'p10-50', 'p10-24', 'p10-26', 'p10-28', 'p10-30', 'p10-32', 'p10-34', 'p10-36', 'p10-38']
    const p2Cards = ['p10-72', 'p10-74', 'p10-76', 'p10-78', 'p10-80', 'p10-82', 'p10-84', 'p10-86', 'p10-88', 'p10-90']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-96'],
      stockCardIds: remainingDeckIds([...p1Cards, ...p2Cards, 'p10-96', 'p10-52', 'p10-54', 'p10-56', 'p10-58', 'p10-60']),
      phase: 'discard',
      currentPlayerIndex: 0,
      hasLaidPhase: { p1: true, p2: false },
      groups: { p1: [], p2: [{ type: 'run', zone: p2GroupZone, phaseNumber: 4 }] },
    })

    const result = applyPhase10Action(game, 'p1', { type: 'HIT', targetPlayerId: 'p2', groupIndex: 0, cardIds: ['p10-48', 'p10-50'] })
    expect(result.outcome.ok).toBe(true)

    const pub = result.game.session.publicState
    expect(pub.hits).toHaveLength(1)
    expect(pub.hits[0]).toMatchObject({ playerId: 'p1', targetPlayerId: 'p2', targetGroupIndex: 0 })
    expect(pub.hits[0].cards.map((c) => c.id).sort()).toEqual(['p10-48', 'p10-50'].sort())
    // both cards left the hand in the same action — not two separate HITs
    expect(cardCount(result.game.session.privateStates['p1'].hand)).toBe(8)
    expect(pub.handCounts['p1']).toBe(8)
    expect(totalCards(result.game)).toBe(108)
  })

  it('HIT rejected — two selected cards together do not extend the group validly', () => {
    // p2's group is a run green 3-4-5-6-7; green 1 + green 9 together leave a gap (no green 8) —
    // rejected as a whole, not partially applied.
    const p2GroupZone = addCards(createPlayerZone('p2', 'p10group-0', 'public'), ['p10-52', 'p10-54', 'p10-56', 'p10-58', 'p10-60'].map((id) => cardMap().get(id)!))
    const p1Cards = ['p10-48', 'p10-64', 'p10-24', 'p10-26', 'p10-28', 'p10-30', 'p10-32', 'p10-34', 'p10-36', 'p10-38']
    const p2Cards = ['p10-72', 'p10-74', 'p10-76', 'p10-78', 'p10-80', 'p10-82', 'p10-84', 'p10-86', 'p10-88', 'p10-90']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-96'],
      stockCardIds: remainingDeckIds([...p1Cards, ...p2Cards, 'p10-96', 'p10-52', 'p10-54', 'p10-56', 'p10-58', 'p10-60']),
      phase: 'discard',
      currentPlayerIndex: 0,
      hasLaidPhase: { p1: true, p2: false },
      groups: { p1: [], p2: [{ type: 'run', zone: p2GroupZone, phaseNumber: 4 }] },
    })

    // p10-64 is green 9 — 1, 3-7, 9 has a gap at 8 with no wild to fill it
    const result = applyPhase10Action(game, 'p1', { type: 'HIT', targetPlayerId: 'p2', groupIndex: 0, cardIds: ['p10-48', 'p10-64'] })
    expect(result.outcome.ok).toBe(false)

    const pub = result.game.session.publicState
    expect(pub.hits).toHaveLength(0)
    expect(cardCount(result.game.session.privateStates['p1'].hand)).toBe(10)
  })

  it('HIT rejected — the added card breaks the group constraint', () => {
    const p2GroupZone = addCards(createPlayerZone('p2', 'p10group-0', 'public'), ['p10-8', 'p10-32', 'p10-56'].map((id) => cardMap().get(id)!))
    const p1Cards = ['p10-12', 'p10-0', 'p10-2', 'p10-4', 'p10-6', 'p10-10', 'p10-14', 'p10-16', 'p10-18', 'p10-20']
    const p2Cards = ['p10-24', 'p10-26', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-40', 'p10-42', 'p10-44']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-96'],
      stockCardIds: remainingDeckIds([...p1Cards, ...p2Cards, 'p10-96', 'p10-8', 'p10-32', 'p10-56']),
      phase: 'discard',
      currentPlayerIndex: 0,
      hasLaidPhase: { p1: true, p2: false },
      groups: { p1: [], p2: [{ type: 'set', zone: p2GroupZone, phaseNumber: 1 }] },
    })

    // a red 7 (p10-12) is not a 5 — the set of 5s breaks
    const result = applyPhase10Action(game, 'p1', { type: 'HIT', targetPlayerId: 'p2', groupIndex: 0, cardIds: ['p10-12'] })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('cannot be added to that group')
    expect(result.game.session.publicState.hits).toHaveLength(0)
    expect(cardCount(result.game.session.privateStates['p1'].hand)).toBe(10)
  })

  it('HIT rejected — a natural cannot evict a Wild that already fills that gap in a run', () => {
    // p2's group is a red run 1-2-W-4 (the Wild is locked in as "3")
    const p2GroupZone = addCards(createPlayerZone('p2', 'p10group-0', 'public'), ['p10-0', 'p10-2', 'p10-100', 'p10-6'].map((id) => cardMap().get(id)!))
    const p1Cards = ['p10-4', 'p10-10', 'p10-12', 'p10-14', 'p10-16', 'p10-18', 'p10-20', 'p10-22', 'p10-24', 'p10-26']
    const p2Cards = ['p10-28', 'p10-30', 'p10-32', 'p10-34', 'p10-36', 'p10-38', 'p10-40', 'p10-42', 'p10-44', 'p10-46']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-96'],
      stockCardIds: remainingDeckIds([...p1Cards, ...p2Cards, 'p10-96', 'p10-0', 'p10-2', 'p10-100', 'p10-6']),
      phase: 'discard',
      currentPlayerIndex: 0,
      hasLaidPhase: { p1: true, p2: false },
      groups: { p1: [], p2: [{ type: 'run', zone: p2GroupZone, phaseNumber: 2 }] },
    })

    // red 3 (p10-4) would fill the exact gap the Wild already occupies
    const result = applyPhase10Action(game, 'p1', { type: 'HIT', targetPlayerId: 'p2', groupIndex: 0, cardIds: ['p10-4'] })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('already covered by a Wild')
    expect(result.game.session.publicState.hits).toHaveLength(0)
    expect(cardCount(result.game.session.privateStates['p1'].hand)).toBe(10)
  })

  it('HIT accepted — extending a run past its established range is still allowed with the Wild locked', () => {
    // same red run 1-2-W-4; extending with a red 5 only touches new range, not the Wild's gap
    const p2GroupZone = addCards(createPlayerZone('p2', 'p10group-0', 'public'), ['p10-0', 'p10-2', 'p10-100', 'p10-6'].map((id) => cardMap().get(id)!))
    const p1Cards = ['p10-8', 'p10-10', 'p10-12', 'p10-14', 'p10-16', 'p10-18', 'p10-20', 'p10-22', 'p10-24', 'p10-26']
    const p2Cards = ['p10-28', 'p10-30', 'p10-32', 'p10-34', 'p10-36', 'p10-38', 'p10-40', 'p10-42', 'p10-44', 'p10-46']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-96'],
      stockCardIds: remainingDeckIds([...p1Cards, ...p2Cards, 'p10-96', 'p10-0', 'p10-2', 'p10-100', 'p10-6']),
      phase: 'discard',
      currentPlayerIndex: 0,
      hasLaidPhase: { p1: true, p2: false },
      groups: { p1: [], p2: [{ type: 'run', zone: p2GroupZone, phaseNumber: 2 }] },
    })

    const result = applyPhase10Action(game, 'p1', { type: 'HIT', targetPlayerId: 'p2', groupIndex: 0, cardIds: ['p10-8'] })
    expect(result.outcome.ok).toBe(true)
    expect(result.game.session.publicState.hits[0].cards.map((c) => c.id)).toEqual(['p10-8'])
  })

  it('HIT rejected — nonexistent group index', () => {
    const p1Cards = ['p10-80', 'p10-0', 'p10-2', 'p10-4', 'p10-6', 'p10-10', 'p10-12', 'p10-14', 'p10-16', 'p10-18']
    const p2Cards = ['p10-24', 'p10-26', 'p10-28', 'p10-30', 'p10-32', 'p10-34', 'p10-36', 'p10-38', 'p10-40', 'p10-42']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-96'],
      stockCardIds: remainingDeckIds([...p1Cards, ...p2Cards, 'p10-96']),
      phase: 'discard',
      currentPlayerIndex: 0,
      hasLaidPhase: { p1: true, p2: false },
    })

    const result = applyPhase10Action(game, 'p1', { type: 'HIT', targetPlayerId: 'p2', groupIndex: 3, cardIds: ['p10-80'] })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('no such group')
  })

  it('going out via HIT — hitting your last card onto your own group ends the round', () => {
    const p1GroupZone = addCards(createPlayerZone('p1', 'p10group-0', 'public'), ['p10-8', 'p10-32', 'p10-56'].map((id) => cardMap().get(id)!))
    const p2Cards = ['p10-72', 'p10-73', 'p10-74', 'p10-75', 'p10-76', 'p10-77', 'p10-78', 'p10-79', 'p10-81', 'p10-82']
    const game = buildSession({
      p1HandCardIds: ['p10-80'],
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-96'],
      stockCardIds: remainingDeckIds(['p10-80', ...p2Cards, 'p10-96', 'p10-8', 'p10-32', 'p10-56']),
      phase: 'discard',
      currentPlayerIndex: 0,
      hasLaidPhase: { p1: true, p2: false },
      groups: { p1: [{ type: 'set', zone: p1GroupZone, phaseNumber: 1 }], p2: [] },
    })

    const result = applyPhase10Action(game, 'p1', { type: 'HIT', targetPlayerId: 'p1', groupIndex: 0, cardIds: ['p10-80'] })
    expect(result.outcome.ok).toBe(true)

    const pub = result.game.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.roundWinnerId).toBe('p1')
    expect(pub.handCounts['p1']).toBe(0)
    expect(pub.hits).toHaveLength(1)
    expect(totalCards(result.game)).toBe(108)
  })

  it('discard ends the turn normally — advanceTurn to the opponent', () => {
    const game = createPhase10Game(['p1', 'p2'], 42)
    const { game: afterDraw } = applyPhase10Action(game, 'p1', { type: 'DRAW_FROM_STOCK' })

    const p1Hand = afterDraw.session.privateStates['p1'].hand.cards
    const discardId = p1Hand.find((c) => c.meta?.kind !== 'skip')!.id
    const result = applyPhase10Action(afterDraw, 'p1', { type: 'DISCARD_CARD', cardId: discardId })
    expect(result.outcome.ok).toBe(true)

    const after = result.game
    expect(cardCount(after.session.privateStates['p1'].hand)).toBe(10)
    expect(cardCount(after.session.publicState.discardPile)).toBe(2)
    const discardCards = after.session.publicState.discardPile.cards
    expect(discardCards[discardCards.length - 1].id).toBe(discardId)
    expect(currentPlayer(after.session.publicState.turn)).toBe('p2')
    expect(after.session.publicState.turn.phase).toBe('draw')
    expect(totalCards(after)).toBe(108)
  })

  it('going out via DISCARD_CARD — discarding your last card ends the round', () => {
    const p2Cards = ['p10-2', 'p10-4', 'p10-6', 'p10-8', 'p10-10', 'p10-12', 'p10-14', 'p10-16', 'p10-18', 'p10-20']
    const game = buildSession({
      p1HandCardIds: ['p10-0'],
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-22'],
      stockCardIds: remainingDeckIds(['p10-0', ...p2Cards, 'p10-22']),
      phase: 'discard',
      currentPlayerIndex: 0,
    })

    const result = applyPhase10Action(game, 'p1', { type: 'DISCARD_CARD', cardId: 'p10-0' })
    expect(result.outcome.ok).toBe(true)

    const pub = result.game.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.roundWinnerId).toBe('p1')
    expect(pub.matchWinnerId).toBeNull()
    expect(pub.handCounts['p1']).toBe(0)
    expect(totalCards(result.game)).toBe(108)
  })

  it('discarding a Skip skips the opponent — in 2-player, the discarder acts again', () => {
    const p1Cards = ['p10-96', 'p10-0', 'p10-2', 'p10-4', 'p10-6', 'p10-8', 'p10-10', 'p10-12', 'p10-14', 'p10-16']
    const p2Cards = ['p10-72', 'p10-73', 'p10-74', 'p10-75', 'p10-76', 'p10-77', 'p10-78', 'p10-79', 'p10-80', 'p10-81']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-97'],
      stockCardIds: remainingDeckIds([...p1Cards, ...p2Cards, 'p10-97']),
      phase: 'discard',
      currentPlayerIndex: 0,
    })

    const result = applyPhase10Action(game, 'p1', { type: 'DISCARD_CARD', cardId: 'p10-96' })
    expect(result.outcome.ok).toBe(true)

    const pub = result.game.session.publicState
    // skipNext with 2 players advances by 2 → lands back on p1 (p2's turn is skipped)
    expect(currentPlayer(pub.turn)).toBe('p1')
    expect(pub.turn.phase).toBe('draw')
    expect(totalCards(result.game)).toBe(108)
  })

  it('discarding a second Skip the same round skips again', () => {
    const p1Cards = ['p10-96', 'p10-97', 'p10-0', 'p10-2', 'p10-4', 'p10-6', 'p10-8', 'p10-10', 'p10-12', 'p10-14']
    const p2Cards = ['p10-72', 'p10-73', 'p10-74', 'p10-75', 'p10-76', 'p10-77', 'p10-78', 'p10-79', 'p10-80', 'p10-81']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-98'],
      stockCardIds: remainingDeckIds([...p1Cards, ...p2Cards, 'p10-98']),
      phase: 'discard',
      currentPlayerIndex: 0,
    })

    const r1 = applyPhase10Action(game, 'p1', { type: 'DISCARD_CARD', cardId: 'p10-96' })
    expect(r1.outcome.ok).toBe(true)
    expect(currentPlayer(r1.game.session.publicState.turn)).toBe('p1')

    // p1 draws (their turn again after the skip), then discards the SECOND Skip
    const r2 = applyPhase10Action(r1.game, 'p1', { type: 'DRAW_FROM_STOCK' })
    expect(r2.outcome.ok).toBe(true)
    const r3 = applyPhase10Action(r2.game, 'p1', { type: 'DISCARD_CARD', cardId: 'p10-97' })
    expect(r3.outcome.ok).toBe(true)

    const pub = r3.game.session.publicState
    expect(currentPlayer(pub.turn)).toBe('p1')
    expect(pub.turn.phase).toBe('draw')
    expect(totalCards(r3.game)).toBe(108)
  })

  it('stock recycling — empty stock recycles the discard pile keeping its top card', () => {
    const p1Cards = ['p10-0', 'p10-2', 'p10-4']
    const discardCards = ['p10-6', 'p10-8', 'p10-10']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: remainingDeckIds([...p1Cards, ...discardCards]),
      discardCardIds: discardCards,
      stockCardIds: [],
      phase: 'draw',
      currentPlayerIndex: 0,
    })

    expect(cardCount(game.stock)).toBe(0)
    expect(cardCount(game.session.publicState.discardPile)).toBe(3)

    const result = applyPhase10Action(game, 'p1', { type: 'DRAW_FROM_STOCK' })
    expect(result.outcome.ok).toBe(true)

    const after = result.game
    // p1 gained 1 card; the discard pile's top card (p10-10) stays in place
    expect(cardCount(after.session.privateStates['p1'].hand)).toBe(4)
    expect(after.session.publicState.discardPile.cards).toHaveLength(1)
    expect(after.session.publicState.discardPile.cards[0].id).toBe('p10-10')
    // two cards recycled, one drawn → one left in stock
    expect(cardCount(after.stock)).toBe(1)
    expect(after.session.publicState.stockCount).toBe(1)
    expect(totalCards(after)).toBe(108)
    expect(allUniqueCardIds(after).size).toBe(108)
  })

  it('recycle impossible — empty stock with a single discard card rejects', () => {
    const p1Cards = ['p10-0', 'p10-2', 'p10-4']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: remainingDeckIds(['p10-0', 'p10-2', 'p10-4', 'p10-6']),
      discardCardIds: ['p10-6'],
      stockCardIds: [],
      phase: 'draw',
      currentPlayerIndex: 0,
    })

    const result = applyPhase10Action(game, 'p1', { type: 'DRAW_FROM_STOCK' })
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.reason).toContain('discard pile')
  })

  it('blocked round — empty stock and empty discard, no score or phaseIdx change', () => {
    const p1Cards = ['p10-0', 'p10-2', 'p10-4']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: remainingDeckIds(p1Cards),
      discardCardIds: [],
      stockCardIds: [],
      phase: 'draw',
      currentPlayerIndex: 0,
      scores: { p1: 5, p2: 7 },
      phaseIdx: { p1: 3, p2: 2 },
    })

    expect(cardCount(game.stock)).toBe(0)
    expect(cardCount(game.session.publicState.discardPile)).toBe(0)

    const result = applyPhase10Action(game, 'p1', { type: 'DRAW_FROM_STOCK' })
    expect(result.outcome.ok).toBe(true)

    const pub = result.game.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.roundWinnerId).toBeNull()
    // a dead round: nobody completed or failed anything
    expect(pub.scores).toEqual({ p1: 5, p2: 7 })
    expect(pub.phaseIdx).toEqual({ p1: 3, p2: 2 })
  })

  it('blocked round — empty stock and a lone Skip on the discard pile, no score or phaseIdx change', () => {
    const p1Cards = ['p10-0', 'p10-2', 'p10-4']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: remainingDeckIds([...p1Cards, 'p10-96']),
      discardCardIds: ['p10-96'],   // the ONLY card left anywhere to draw — and it's a Skip
      stockCardIds: [],
      phase: 'draw',
      currentPlayerIndex: 0,
      scores: { p1: 5, p2: 7 },
      phaseIdx: { p1: 3, p2: 2 },
    })

    expect(cardCount(game.stock)).toBe(0)
    expect(cardCount(game.session.publicState.discardPile)).toBe(1)

    // stock draw must be accepted — there is no other legal action this turn
    const stockResult = applyPhase10Action(game, 'p1', { type: 'DRAW_FROM_STOCK' })
    expect(stockResult.outcome.ok).toBe(true)

    const pub = stockResult.game.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.roundWinnerId).toBeNull()
    // a dead round: nobody completed or failed anything
    expect(pub.scores).toEqual({ p1: 5, p2: 7 })
    expect(pub.phaseIdx).toEqual({ p1: 3, p2: 2 })

    // the lone Skip is still never drawable — the fix must not have opened that door
    const discardResult = applyPhase10Action(game, 'p1', { type: 'DRAW_FROM_DISCARD' })
    expect(discardResult.outcome.ok).toBe(false)
  })

  it('scoring exact values — opponent hand of 5/10/Skip/Wild costs exactly 55', () => {
    // red 5 (value 5), red 10 (value 10), Skip (15), Wild (25) → 5+10+15+25 = 55
    const p2Cards = ['p10-8', 'p10-18', 'p10-96', 'p10-100']
    const game = buildSession({
      p1HandCardIds: ['p10-0'],
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-2'],
      stockCardIds: remainingDeckIds(['p10-0', ...p2Cards, 'p10-2']),
      phase: 'discard',
      currentPlayerIndex: 0,
    })

    const result = applyPhase10Action(game, 'p1', { type: 'DISCARD_CARD', cardId: 'p10-0' })
    expect(result.outcome.ok).toBe(true)

    const pub = result.game.session.publicState
    expect(pub.scores['p1']).toBe(0)       // the going-out player adds nothing
    expect(pub.scores['p2']).toBe(55)      // 5 + 10 + 15 + 25
  })

  it('phase advancement — laid player advances, un-laid player repeats their phase', () => {
    const p2Cards = ['p10-2', 'p10-4', 'p10-6', 'p10-8', 'p10-10', 'p10-12', 'p10-14', 'p10-16', 'p10-18', 'p10-20']
    const game = buildSession({
      p1HandCardIds: ['p10-0'],
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-22'],
      stockCardIds: remainingDeckIds(['p10-0', ...p2Cards, 'p10-22']),
      phase: 'discard',
      currentPlayerIndex: 0,
      hasLaidPhase: { p1: true, p2: false },
      phaseIdx: { p1: 0, p2: 0 },
    })

    const result = applyPhase10Action(game, 'p1', { type: 'DISCARD_CARD', cardId: 'p10-0' })
    expect(result.outcome.ok).toBe(true)

    const pub = result.game.session.publicState
    expect(pub.roundOver).toBe(true)
    // p1 laid their phase this round → advances to Phase 2 (index 1)
    // p2 did not lay → stays on Phase 1 (index 0)
    expect(pub.phaseIdx).toEqual({ p1: 1, p2: 0 })
  })

  it('match win, single completer — laying Phase 10 and going out wins the match immediately', () => {
    // Phase 10 (index 9) = 1 set of 5 + 1 set of 3: five 2s + three 3s — exactly 8 cards
    const phase10Cards = ['p10-2', 'p10-3', 'p10-26', 'p10-27', 'p10-50', 'p10-4', 'p10-28', 'p10-52']
    const p2Cards = ['p10-72', 'p10-73', 'p10-74', 'p10-75', 'p10-76', 'p10-77', 'p10-78', 'p10-79', 'p10-80', 'p10-81']
    const game = buildSession({
      p1HandCardIds: phase10Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-96'],
      stockCardIds: remainingDeckIds([...phase10Cards, ...p2Cards, 'p10-96']),
      phase: 'discard',
      currentPlayerIndex: 0,
      phaseIdx: { p1: 9, p2: 0 },
    })

    const result = applyPhase10Action(game, 'p1', { type: 'LAY_PHASE', cardIds: phase10Cards })
    expect(result.outcome.ok).toBe(true)

    const pub = result.game.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.roundWinnerId).toBe('p1')
    expect(pub.matchWinnerId).toBe('p1')
    // 9 + 1 capped at 9 — the match ends, there is no Phase 11
    expect(pub.phaseIdx['p1']).toBe(9)
    expect(cardCount(result.game.session.privateStates['p1'].hand)).toBe(0)
  })

  it('match win, simultaneous completers — lower post-round score wins the tiebreak', () => {
    // Both players are on Phase 10 and both laid it this round. p1 goes out by discarding
    // their last card; p2's hand penalty (55) pushes p2's score above p1's 40, so p1 wins.
    const p2Cards = ['p10-8', 'p10-18', 'p10-96', 'p10-100']
    const game = buildSession({
      p1HandCardIds: ['p10-0'],
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-2'],
      stockCardIds: remainingDeckIds(['p10-0', ...p2Cards, 'p10-2']),
      phase: 'discard',
      currentPlayerIndex: 0,
      phaseIdx: { p1: 9, p2: 9 },
      hasLaidPhase: { p1: true, p2: true },
      scores: { p1: 40, p2: 0 },
    })

    const result = applyPhase10Action(game, 'p1', { type: 'DISCARD_CARD', cardId: 'p10-0' })
    expect(result.outcome.ok).toBe(true)

    const pub = result.game.session.publicState
    expect(pub.scores).toEqual({ p1: 40, p2: 55 })
    expect(pub.matchWinnerId).toBe('p1')   // 40 < 55 — p2's penalty flipped the leader
  })

  it('match win, simultaneous completers — the lower-score completer can also be the opponent', () => {
    const p2Cards = ['p10-8', 'p10-18', 'p10-96', 'p10-100']
    const game = buildSession({
      p1HandCardIds: ['p10-0'],
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-2'],
      stockCardIds: remainingDeckIds(['p10-0', ...p2Cards, 'p10-2']),
      phase: 'discard',
      currentPlayerIndex: 0,
      phaseIdx: { p1: 9, p2: 9 },
      hasLaidPhase: { p1: true, p2: true },
      scores: { p1: 100, p2: 0 },
    })

    const result = applyPhase10Action(game, 'p1', { type: 'DISCARD_CARD', cardId: 'p10-0' })
    expect(result.outcome.ok).toBe(true)

    const pub = result.game.session.publicState
    expect(pub.scores).toEqual({ p1: 100, p2: 55 })
    expect(pub.matchWinnerId).toBe('p2')   // 55 < 100
  })

  it('START_NEXT_ROUND resets round-scoped fields but keeps phaseIdx and scores', () => {
    const p1Cards = ['p10-0', 'p10-2', 'p10-4']
    const p2Cards = ['p10-6', 'p10-8', 'p10-10', 'p10-12', 'p10-14']
    const game = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-16'],
      stockCardIds: remainingDeckIds([...p1Cards, ...p2Cards, 'p10-16']),
      phase: 'draw',
      currentPlayerIndex: 0,
      scores: { p1: 35, p2: 55 },
      phaseIdx: { p1: 1, p2: 0 },
      roundOver: true,
      roundWinnerId: 'p1',
    })

    const result = applyPhase10Action(game, 'p1', { type: 'START_NEXT_ROUND' })
    expect(result.outcome.ok).toBe(true)

    const pub = result.game.session.publicState
    expect(pub.roundNumber).toBe(2)
    expect(pub.roundOver).toBe(false)
    expect(pub.roundWinnerId).toBeNull()
    expect(pub.groups).toEqual({ p2: [], p1: [] })
    expect(pub.hits).toEqual([])
    expect(pub.hasLaidPhase).toEqual({ p2: false, p1: false })
    expect(cardCount(result.game.session.privateStates['p1'].hand)).toBe(10)
    expect(cardCount(result.game.session.privateStates['p2'].hand)).toBe(10)
    expect(cardCount(pub.discardPile)).toBe(1)
    expect(cardCount(result.game.stock)).toBe(87)
    // the whole point of a multi-round Phase 10 match — these persist
    expect(pub.phaseIdx).toEqual({ p1: 1, p2: 0 })
    expect(pub.scores).toEqual({ p1: 35, p2: 55 })
    // starting player alternates: previous order [p1, p2] → next [p2, p1]
    expect(currentPlayer(pub.turn)).toBe('p2')
    expect(totalCards(result.game)).toBe(108)
  })

  it('hidden information — p2 snapshot does not leak p1 hand cards', () => {
    const game = createPhase10Game(['p1', 'p2'], 42)
    const { game: afterDraw } = applyPhase10Action(game, 'p1', { type: 'DRAW_FROM_STOCK' })

    const p1CardIds = new Set(afterDraw.session.privateStates['p1'].hand.cards.map((c) => c.id))
    const p2CardIds = new Set(afterDraw.session.privateStates['p2'].hand.cards.map((c) => c.id))

    const p2Snapshot = deriveSnapshot(afterDraw.session, 'p2')

    expect(p2Snapshot.privateState!.hand.cards.length).toBe(10)
    for (const card of p2Snapshot.privateState!.hand.cards) {
      expect(p2CardIds.has(card.id)).toBe(true)
      expect(p1CardIds.has(card.id)).toBe(false)
    }

    const json = JSON.stringify(p2Snapshot)
    const discardIds = new Set(afterDraw.session.publicState.discardPile.cards.map((c) => c.id))
    for (const id of p1CardIds) {
      if (discardIds.has(id)) continue
      expect(json).not.toContain(id)
    }
  })

  it('malformed actions rejected with ok:false, never thrown', () => {
    const game = createPhase10Game(['p1', 'p2'], 42)

    // garbage action type
    const garbage = applyPhase10Action(game, 'p1', { type: 'GARBAGE' } as any)
    expect(garbage.outcome.ok).toBe(false)
    expect(garbage.outcome.reason).toContain('unknown action')

    // LAY_PHASE with non-array cardIds
    const { game: afterDraw } = applyPhase10Action(game, 'p1', { type: 'DRAW_FROM_STOCK' })
    for (const bad of [null, undefined, 5]) {
      const result = applyPhase10Action(afterDraw, 'p1', { type: 'LAY_PHASE', cardIds: bad as any })
      expect(result.outcome.ok).toBe(false)
      expect(result.outcome.reason).toContain('invalid cardIds')
    }

    // HIT with non-array cardIds
    const p2GroupZone = addCards(createPlayerZone('p2', 'p10group-0', 'public'), ['p10-8', 'p10-32', 'p10-56'].map((id) => cardMap().get(id)!))
    const p1Cards = ['p10-80', 'p10-0', 'p10-2', 'p10-4', 'p10-6', 'p10-10', 'p10-12', 'p10-14', 'p10-16', 'p10-18']
    const p2Cards = ['p10-24', 'p10-26', 'p10-28', 'p10-30', 'p10-32', 'p10-34', 'p10-36', 'p10-38', 'p10-40', 'p10-42']
    const hitGame = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      discardCardIds: ['p10-96'],
      stockCardIds: remainingDeckIds([...p1Cards, ...p2Cards, 'p10-96', 'p10-8', 'p10-32', 'p10-56']),
      phase: 'discard',
      currentPlayerIndex: 0,
      hasLaidPhase: { p1: true, p2: false },
      groups: { p1: [], p2: [{ type: 'set', zone: p2GroupZone, phaseNumber: 1 }] },
    })
    const hitResult = applyPhase10Action(hitGame, 'p1', { type: 'HIT', targetPlayerId: 'p2', groupIndex: 0, cardIds: null as any })
    expect(hitResult.outcome.ok).toBe(false)
    expect(hitResult.outcome.reason).toContain('invalid cardIds')
  })

  it('house player bot completes a full turn', () => {
    const game = createPhase10Game(['p1', 'p2'], 42)

    const strategy: BotStrategy<Phase10PublicState, Phase10PrivateState, Phase10Action> = (
      publicState,
      privateState,
    ) => {
      if (publicState.turn.phase === 'draw') return { type: 'DRAW_FROM_STOCK' }
      return { type: 'DISCARD_CARD', cardId: privateState.hand.cards.find((c) => c.meta?.kind !== 'skip')!.id }
    }

    const drawResult = runPhase10BotTurn(game, 'p1', strategy)
    expect(drawResult.outcome.ok).toBe(true)
    expect(drawResult.game.session.publicState.turn.phase).toBe('discard')

    const discardResult = runPhase10BotTurn(drawResult.game, 'p1', strategy)
    expect(discardResult.outcome.ok).toBe(true)
    expect(discardResult.game.session.publicState.turn.phase).toBe('draw')
    expect(currentPlayer(discardResult.game.session.publicState.turn)).toBe('p2')
    expect(totalCards(discardResult.game)).toBe(108)
  })

  // ── N-player (3-6 seats) — spec 37 ─────────────────────────

  it('4-player going out — every non-going-out player is penalized by their OWN hand only', () => {
    // p1 goes out by discarding their last card. Every OTHER seated player adds their own
    // handPenalty: p2 holds red 10 (10), p3 holds a Skip (15), p4 holds a Wild (25). The old
    // 2-player code only penalized "the opponent" — p3 and p4 would have been left at 0.
    const seatOrder = ['p1', 'p2', 'p3', 'p4']
    const game = buildSession({
      p1HandCardIds: ['p10-0'],        // red 1 — goes out with it
      p2HandCardIds: ['p10-18'],       // red 10 → 10
      otherHandCardIds: { p3: ['p10-96'], p4: ['p10-100'] },   // Skip → 15, Wild → 25
      discardCardIds: ['p10-2'],
      stockCardIds: remainingDeckIds(['p10-0', 'p10-18', 'p10-96', 'p10-100', 'p10-2']),
      phase: 'discard',
      currentPlayerIndex: 0,
      seatOrder,
      scores: { p1: 0, p2: 5, p3: 10, p4: 20 },
    })

    const result = applyPhase10Action(game, 'p1', { type: 'DISCARD_CARD', cardId: 'p10-0' })
    expect(result.outcome.ok).toBe(true)

    const pub = result.game.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.roundWinnerId).toBe('p1')
    // p1's own score is explicitly UNCHANGED (0); everyone else adds ONLY their own penalty.
    expect(pub.scores).toEqual({ p1: 0, p2: 15, p3: 25, p4: 45 })
    expect(pub.handCounts).toEqual({ p1: 0, p2: 1, p3: 1, p4: 1 })
    expect(totalCardsAll(result.game, seatOrder)).toBe(108)
  })

  it('3-player phase-completion match win — simultaneous completers tie for lowest score, earliest seatOrder wins', () => {
    // Both p1 and p2 are on Phase 10 (phaseIdx 9) and both laid it this round. p1 goes out
    // (score unchanged at 10); p2's hand is red 10 (penalty 10) → 0 + 10 = 10. They TIE for
    // the lowest post-round score among completers, so the existing tiebreak loop picks the
    // earliest position in playerOrder — p1. p3 is not a completer and lands at 25.
    const seatOrder = ['p1', 'p2', 'p3']
    const game = buildSession({
      p1HandCardIds: ['p10-0'],        // red 1 — goes out with it
      p2HandCardIds: ['p10-18'],       // red 10 → penalty 10
      otherHandCardIds: { p3: ['p10-100'] },   // Wild → penalty 25
      discardCardIds: ['p10-2'],
      stockCardIds: remainingDeckIds(['p10-0', 'p10-18', 'p10-100', 'p10-2']),
      phase: 'discard',
      currentPlayerIndex: 0,
      seatOrder,
      phaseIdx: { p1: 9, p2: 9, p3: 0 },
      hasLaidPhase: { p1: true, p2: true, p3: false },
      scores: { p1: 10, p2: 0, p3: 0 },
    })

    const result = applyPhase10Action(game, 'p1', { type: 'DISCARD_CARD', cardId: 'p10-0' })
    expect(result.outcome.ok).toBe(true)

    const pub = result.game.session.publicState
    expect(pub.roundOver).toBe(true)
    expect(pub.roundWinnerId).toBe('p1')
    expect(pub.scores).toEqual({ p1: 10, p2: 10, p3: 25 })
    // p1 and p2 both completed Phase 10 with equal lowest scores (10); p1 is earlier in
    // playerOrder ['p1','p2','p3'] and wins the deterministic tiebreak.
    expect(pub.matchWinnerId).toBe('p1')
    expect(totalCardsAll(result.game, seatOrder)).toBe(108)
  })

  it('6-player initial deal is correct — 10 each, 1 discard, 47 stock, conservation holds', () => {
    const seatOrder = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']
    const game = createPhase10Game(seatOrder, 42)
    const pub = game.session.publicState

    for (const playerId of seatOrder) {
      expect(cardCount(game.session.privateStates[playerId].hand)).toBe(10)
      expect(pub.handCounts[playerId]).toBe(10)
    }
    expect(cardCount(pub.discardPile)).toBe(1)
    expect(cardCount(game.stock)).toBe(47)   // 108 - 6×10 - 1
    expect(pub.stockCount).toBe(47)
    expect(pub.seatOrder).toEqual(seatOrder)
    expect(pub.turn.playerOrder).toEqual(seatOrder)
    expect(currentPlayer(pub.turn)).toBe('p1')
    expect(pub.turn.phase).toBe('draw')
    expect(totalCardsAll(game, seatOrder)).toBe(108)
    expect(allUniqueCardIdsAll(game, seatOrder).size).toBe(108)
  })

  it('START_NEXT_ROUND rotates the starter through every seat in seatOrder order (3 players, 5 rounds)', () => {
    // Hand-verified trace for seatOrder ['p1', 'p2', 'p3'] with 1-based round numbers:
    //   round 1 starts at seatOrder[0] = p1 (createTurnState starts at index 0)
    //   round 1 ends → starter = seatOrder[1 % 3] = seatOrder[1] = p2
    //   round 2 ends → starter = seatOrder[2 % 3] = seatOrder[2] = p3
    //   round 3 ends → starter = seatOrder[3 % 3] = seatOrder[0] = p1 (wraps)
    //   round 4 ends → starter = seatOrder[4 % 3] = seatOrder[1] = p2
    // The rotation is against the FIXED seatOrder — never the previous round's turn order.
    const seatOrder = ['p1', 'p2', 'p3']
    const p1Cards = ['p10-0', 'p10-2', 'p10-4']
    const p2Cards = ['p10-6', 'p10-8', 'p10-10']
    const p3Cards = ['p10-12', 'p10-14', 'p10-16']
    const discardCards = ['p10-18']
    const used = [...p1Cards, ...p2Cards, ...p3Cards, ...discardCards]
    const stockCardIds = remainingDeckIds(used)

    // Flip a finished-round session back to round-over so the chain can continue (START_NEXT_ROUND
    // is the only thing that legitimately transitions a round-over state).
    const markRoundOver = (g: Phase10Session): Phase10Session => {
      const session = g.session
      return { ...g, session: { ...session, publicState: { ...session.publicState, roundOver: true } } }
    }

    const round1 = buildSession({
      p1HandCardIds: p1Cards,
      p2HandCardIds: p2Cards,
      otherHandCardIds: { p3: p3Cards },
      discardCardIds: discardCards,
      stockCardIds,
      phase: 'draw',
      currentPlayerIndex: 0,
      seatOrder,
      roundOver: true,
      roundWinnerId: 'p1',
    })
    expect(currentPlayer(round1.session.publicState.turn)).toBe('p1')   // round 1 starter = seatOrder[0]

    // Round 2: starter should be seatOrder[1] = p2.
    const round2 = applyPhase10Action(round1, 'p1', { type: 'START_NEXT_ROUND' })
    expect(round2.outcome.ok).toBe(true)
    let pub = round2.game.session.publicState
    expect(pub.roundNumber).toBe(2)
    expect(pub.seatOrder).toEqual(seatOrder)
    expect(pub.turn.playerOrder).toEqual(seatOrder)
    expect(currentPlayer(pub.turn)).toBe('p2')
    expect(pub.turn.phase).toBe('draw')
    expect(pub.groups).toEqual({ p1: [], p2: [], p3: [] })
    expect(pub.hasLaidPhase).toEqual({ p1: false, p2: false, p3: false })
    expect(pub.handCounts).toEqual({ p1: 10, p2: 10, p3: 10 })
    expect(cardCount(round2.game.stock)).toBe(77)   // 108 - 3×10 - 1 discard
    expect(cardCount(pub.discardPile)).toBe(1)
    expect(totalCardsAll(round2.game, seatOrder)).toBe(108)

    // Round 3: starter should be seatOrder[2] = p3.
    const round3 = applyPhase10Action(markRoundOver(round2.game), 'p1', { type: 'START_NEXT_ROUND' })
    expect(round3.outcome.ok).toBe(true)
    pub = round3.game.session.publicState
    expect(pub.roundNumber).toBe(3)
    expect(currentPlayer(pub.turn)).toBe('p3')

    // Round 4: starter should wrap to seatOrder[0] = p1.
    const round4 = applyPhase10Action(markRoundOver(round3.game), 'p1', { type: 'START_NEXT_ROUND' })
    expect(round4.outcome.ok).toBe(true)
    pub = round4.game.session.publicState
    expect(pub.roundNumber).toBe(4)
    expect(currentPlayer(pub.turn)).toBe('p1')

    // Round 5: starter should be seatOrder[1] = p2 again.
    const round5 = applyPhase10Action(markRoundOver(round4.game), 'p1', { type: 'START_NEXT_ROUND' })
    expect(round5.outcome.ok).toBe(true)
    pub = round5.game.session.publicState
    expect(pub.roundNumber).toBe(5)
    expect(currentPlayer(pub.turn)).toBe('p2')
    expect(pub.seatOrder).toEqual(seatOrder)
    expect(pub.turn.playerOrder).toEqual(seatOrder)
  })
})
