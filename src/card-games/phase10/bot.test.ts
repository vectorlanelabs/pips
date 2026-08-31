import { describe, expect, it } from 'vitest'
import { createPhase10Game, type Phase10PublicState, type Phase10PrivateState, type Phase10TurnPhase, type Phase10Session, type Phase10Group, type Phase10Hit } from './state.ts'
import { runPhase10BotTurn } from './rules.ts'
import { phase10BotStrategy, canCompletePhase, findPhaseSelection, selectDiscard } from './bot.ts'
import { currentPlayer, createTurnState } from '../../engine/turn-engine.ts'
import { cardCount, createHand, createDiscardPile, createPublicZone, createPlayerZone, addCards } from '../../card-engine/zones.ts'
import { createPhase10Deck } from './deck.ts'
import { createRng } from '../../engine/rng.ts'
import { createHostSession } from '../../engine/sync.ts'
import { classifyPhaseHand } from './classify.ts'
import { PHASES } from './phases.ts'
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

function cardMap(): Map<string, Card> {
  return new Map(createPhase10Deck().map((c) => [c.id, c]))
}

function cardsByIds(...ids: string[]): Card[] {
  const map = cardMap()
  return ids.map((id) => map.get(id)!)
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
  phaseIdx?: Record<string, number>
  hasLaidPhase?: Record<string, boolean>
  groups?: Record<string, Phase10Group[]>
  hits?: Phase10Hit[]
  roundOver?: boolean
  roundWinnerId?: string | null
}): Phase10Session {
  const map = cardMap()

  function cardsFor(ids: string[]): Card[] {
    return ids.map((id) => map.get(id)!)
  }

  const p1Hand = addCards(createHand('p1'), cardsFor(config.p1HandCardIds))
  const p2Hand = addCards(createHand('p2'), cardsFor(config.p2HandCardIds))
  const discardPile = addCards(createDiscardPile(), cardsFor(config.discardCardIds))
  const stock = addCards(createPublicZone('stock', 'private'), cardsFor(config.stockCardIds))

  const playerOrder: [string, string] = ['p1', 'p2']
  const turn = createTurnState<Phase10TurnPhase>(playerOrder, config.phase ?? 'draw')
  if (config.currentPlayerIndex != null) {
    // createTurnState starts at index 0; advance to desired index by directly setting it
    ;(turn as { currentIndex: number }).currentIndex = config.currentPlayerIndex
  }

  const publicState: Phase10PublicState = {
    cardBack: 'pips_default',
    turn,
    seatOrder: ['p1', 'p2'],
    discardPile,
    stockCount: cardCount(stock),
    groups: config.groups ?? { p1: [], p2: [] },
    hits: config.hits ?? [],
    hasLaidPhase: config.hasLaidPhase ?? { p1: false, p2: false },
    phaseIdx: config.phaseIdx ?? { p1: 0, p2: 0 },
    scores: { p1: 0, p2: 0 },
    roundNumber: 1,
    roundOver: config.roundOver ?? false,
    roundWinnerId: config.roundWinnerId ?? null,
    matchWinnerId: null,
    handCounts: { p1: config.p1HandCardIds.length, p2: config.p2HandCardIds.length },
  }

  const privateStates: Record<string, Phase10PrivateState> = {
    p1: { hand: p1Hand },
    p2: { hand: p2Hand },
  }

  return {
    session: createHostSession(publicState, privateStates),
    stock,
    rng: createRng(0),
  }
}

function strategyAction(game: Phase10Session, playerId: string) {
  return phase10BotStrategy(game.session.publicState, game.session.privateStates[playerId], playerId)
}

// ── tests: phase10BotStrategy ────────────────────────────────

describe('phase10BotStrategy', () => {
  it('roundOver → returns START_NEXT_ROUND regardless of anything else', () => {
    // round over AND an empty hand — the crash-guard case: must not throw
    const game = buildSession({
      p1HandCardIds: [],
      p2HandCardIds: ['p10-2', 'p10-4', 'p10-6', 'p10-8'],
      discardCardIds: ['p10-96'],
      stockCardIds: [],
      phase: 'discard',
      currentPlayerIndex: 0,
      roundOver: true,
      roundWinnerId: 'p1',
    })

    let action: ReturnType<typeof phase10BotStrategy> | undefined
    expect(() => {
      action = strategyAction(game, 'p1')
    }).not.toThrow()
    expect(action).toEqual({ type: 'START_NEXT_ROUND' })
  })

  it('draw phase: takes the discard top card when it completes the current phase', () => {
    // Phase 1 (index 0) = 2 sets of 3. p1 holds two 5s and three 9s; the discard
    // top is a green 5 — drawing it completes the phase (3×5 + 3×9).
    const p1Hand = ['p10-8', 'p10-32', 'p10-16', 'p10-40', 'p10-64', 'p10-2', 'p10-4', 'p10-6', 'p10-20', 'p10-44']
    const game = buildSession({
      p1HandCardIds: p1Hand,
      p2HandCardIds: ['p10-24', 'p10-26', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-42', 'p10-46', 'p10-50'],
      discardCardIds: ['p10-74', 'p10-56'],   // bottom: yellow 2, top: green 5
      stockCardIds: remainingDeckIds([...p1Hand, 'p10-24', 'p10-26', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-42', 'p10-46', 'p10-50', 'p10-74', 'p10-56']),
      phase: 'draw',
      currentPlayerIndex: 0,
    })

    const action = strategyAction(game, 'p1')
    expect(action).toEqual({ type: 'DRAW_FROM_DISCARD' })

    // and the validator actually accepts it — the top card lands in the hand
    const result = runPhase10BotTurn(game, 'p1', phase10BotStrategy)
    expect(result.outcome.ok).toBe(true)
    expect(result.game.session.privateStates['p1'].hand.cards.map((c) => c.id)).toContain('p10-56')
    expect(result.game.session.publicState.turn.phase).toBe('discard')
    expect(totalCards(result.game)).toBe(108)
  })

  it('draw phase: a Skip on top of the discard pile is never drawn — falls through to DRAW_FROM_STOCK', () => {
    // Same completing hand, but the discard top is a Skip (p10-96): even though
    // a 5 would complete the phase, the Skip must never be offered as a draw.
    const p1Hand = ['p10-8', 'p10-32', 'p10-16', 'p10-40', 'p10-64', 'p10-2', 'p10-4', 'p10-6', 'p10-20', 'p10-44']
    const game = buildSession({
      p1HandCardIds: p1Hand,
      p2HandCardIds: ['p10-24', 'p10-26', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-42', 'p10-46', 'p10-50'],
      discardCardIds: ['p10-74', 'p10-96'],   // bottom: yellow 2, top: Skip
      stockCardIds: remainingDeckIds([...p1Hand, 'p10-24', 'p10-26', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-42', 'p10-46', 'p10-50', 'p10-74', 'p10-96']),
      phase: 'draw',
      currentPlayerIndex: 0,
    })

    const action = strategyAction(game, 'p1')
    expect(action).not.toEqual({ type: 'DRAW_FROM_DISCARD' })
    expect(action).toEqual({ type: 'DRAW_FROM_STOCK' })

    // DRAW_FROM_STOCK is the legal play here — the validator accepts it
    const result = runPhase10BotTurn(game, 'p1', phase10BotStrategy)
    expect(result.outcome.ok).toBe(true)
  })

  it('draw phase: stock empty + pile has 2+ cards → prefers DRAW_FROM_STOCK (triggers recycle), never loops on the discard top', () => {
    // p1 holds red 2-11 (every rank distinct — no set of 3 possible for Phase 1), so the
    // green 11 on top completes nothing. Stock is empty, but the pile has 2 cards, so
    // DRAW_FROM_STOCK is itself legal (rules.ts recycles the pile when it has >= 2 cards)
    // — the bot must prefer it over always taking the discard top, or two bots would
    // trade the same top card forever and the pile would never recycle (the actual bug
    // this test now guards against, found by review).
    const p1Hand = ['p10-2', 'p10-4', 'p10-6', 'p10-8', 'p10-10', 'p10-12', 'p10-14', 'p10-16', 'p10-18', 'p10-20']
    const game = buildSession({
      p1HandCardIds: p1Hand,
      p2HandCardIds: remainingDeckIds([...p1Hand, 'p10-94', 'p10-68']),
      discardCardIds: ['p10-94', 'p10-68'],   // bottom: yellow 12, top: green 11
      stockCardIds: [],
      phase: 'draw',
      currentPlayerIndex: 0,
    })

    const action = strategyAction(game, 'p1')
    expect(action).toEqual({ type: 'DRAW_FROM_STOCK' })

    const result = runPhase10BotTurn(game, 'p1', phase10BotStrategy)
    expect(result.outcome.ok).toBe(true)
    // Stock recycled from the discard pile (keeping the top card, p10-68, in place) and
    // p1 drew the freshly-recycled top — p10-94 (the only other card that was available).
    expect(result.game.session.privateStates['p1'].hand.cards.map((c) => c.id)).toContain('p10-94')
    expect(totalCards(result.game)).toBe(108)
  })

  it('draw phase: stock empty + pile has EXACTLY 1 non-Skip card that completes nothing → takes it anyway (the real livelock-prevention case)', () => {
    // The genuinely forced case: DRAW_FROM_STOCK would be REJECTED here (rules.ts only
    // recycles when the pile has >= 2 cards), so the lone discard card is the only legal
    // move — the bot must take it even though it completes nothing.
    const p1Hand = ['p10-2', 'p10-4', 'p10-6', 'p10-8', 'p10-10', 'p10-12', 'p10-14', 'p10-16', 'p10-18', 'p10-20']
    const game = buildSession({
      p1HandCardIds: p1Hand,
      p2HandCardIds: remainingDeckIds([...p1Hand, 'p10-68']),
      discardCardIds: ['p10-68'],   // exactly one card: green 11 — completes nothing
      stockCardIds: [],
      phase: 'draw',
      currentPlayerIndex: 0,
    })

    const action = strategyAction(game, 'p1')
    expect(action).toEqual({ type: 'DRAW_FROM_DISCARD' })

    const result = runPhase10BotTurn(game, 'p1', phase10BotStrategy)
    expect(result.outcome.ok).toBe(true)
    expect(result.game.session.privateStates['p1'].hand.cards.map((c) => c.id)).toContain('p10-68')
    expect(totalCards(result.game)).toBe(108)
  })

  it('draw phase: stock empty + Skip on top of discard → DRAW_FROM_STOCK (never the Skip)', () => {
    const p1Hand = ['p10-2', 'p10-4', 'p10-6', 'p10-8', 'p10-10', 'p10-12', 'p10-14', 'p10-16', 'p10-18', 'p10-20']
    const game = buildSession({
      p1HandCardIds: p1Hand,
      p2HandCardIds: remainingDeckIds([...p1Hand, 'p10-94', 'p10-97']),
      discardCardIds: ['p10-94', 'p10-97'],   // bottom: yellow 12, top: Skip
      stockCardIds: [],
      phase: 'draw',
      currentPlayerIndex: 0,
    })

    const action = strategyAction(game, 'p1')
    expect(action).toEqual({ type: 'DRAW_FROM_STOCK' })
  })

  it('draw phase: non-useful non-Skip top with stock available → DRAW_FROM_STOCK', () => {
    const p1Hand = ['p10-2', 'p10-4', 'p10-6', 'p10-8', 'p10-10', 'p10-12', 'p10-14', 'p10-16', 'p10-18', 'p10-20']
    const game = buildSession({
      p1HandCardIds: p1Hand,
      p2HandCardIds: ['p10-24', 'p10-26', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-42', 'p10-46', 'p10-50'],
      discardCardIds: ['p10-74', 'p10-68'],   // bottom: yellow 2, top: green 11 — completes nothing
      stockCardIds: remainingDeckIds([...p1Hand, 'p10-24', 'p10-26', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-42', 'p10-46', 'p10-50', 'p10-74', 'p10-68']),
      phase: 'draw',
      currentPlayerIndex: 0,
    })

    expect(strategyAction(game, 'p1')).toEqual({ type: 'DRAW_FROM_STOCK' })
  })

  it('discard phase, not laid: returns LAY_PHASE with a valid selection when the hand completes the phase', () => {
    // Phase 1 = 2 sets of 3: three 5s + three 9s are in the hand
    const p1Hand = ['p10-8', 'p10-32', 'p10-56', 'p10-16', 'p10-40', 'p10-64', 'p10-2', 'p10-4', 'p10-6', 'p10-20']
    const game = buildSession({
      p1HandCardIds: p1Hand,
      p2HandCardIds: ['p10-24', 'p10-26', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-42', 'p10-46', 'p10-50'],
      discardCardIds: ['p10-94'],
      stockCardIds: remainingDeckIds([...p1Hand, 'p10-24', 'p10-26', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-42', 'p10-46', 'p10-50', 'p10-94']),
      phase: 'discard',
      currentPlayerIndex: 0,
    })

    const action = strategyAction(game, 'p1')
    expect(action.type).toBe('LAY_PHASE')
    if (action.type === 'LAY_PHASE') {
      // exactly the selection findPhaseSelection finds, and it is a valid phase
      expect(action.cardIds).toEqual(findPhaseSelection(cardsByIds(...p1Hand), PHASES[0]))
      expect(action.cardIds).toHaveLength(6)
      expect(classifyPhaseHand(cardsByIds(...action.cardIds), PHASES[0]).valid).toBe(true)
    }

    // and the validator accepts it end-to-end
    const result = runPhase10BotTurn(game, 'p1', phase10BotStrategy)
    expect(result.outcome.ok).toBe(true)
    expect(result.game.session.publicState.hasLaidPhase['p1']).toBe(true)
    expect(result.game.session.publicState.groups['p1']).toHaveLength(2)
    expect(totalCards(result.game)).toBe(108)
  })

  it('discard phase, already laid: hits a hand card onto its own group', () => {
    const p1GroupZone = addCards(createPlayerZone('p1', 'p10group-0', 'public'), cardsByIds('p10-8', 'p10-32', 'p10-56'))
    const p1Hand = ['p10-80', 'p10-2', 'p10-4', 'p10-6', 'p10-20', 'p10-44', 'p10-68', 'p10-26', 'p10-50', 'p10-74']
    const game = buildSession({
      p1HandCardIds: p1Hand,
      p2HandCardIds: ['p10-24', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-42', 'p10-46', 'p10-52', 'p10-54'],
      discardCardIds: ['p10-94'],
      stockCardIds: remainingDeckIds([...p1Hand, 'p10-24', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-42', 'p10-46', 'p10-52', 'p10-54', 'p10-94', 'p10-8', 'p10-32', 'p10-56']),
      phase: 'discard',
      currentPlayerIndex: 0,
      hasLaidPhase: { p1: true, p2: false },
      groups: { p1: [{ type: 'set', zone: p1GroupZone, phaseNumber: 1 }], p2: [] },
    })

    const action = strategyAction(game, 'p1')
    // yellow 5 (p10-80) extends p1's set of three 5s
    expect(action).toEqual({ type: 'HIT', targetPlayerId: 'p1', groupIndex: 0, cardIds: ['p10-80'] })

    const result = runPhase10BotTurn(game, 'p1', phase10BotStrategy)
    expect(result.outcome.ok).toBe(true)
    expect(result.game.session.publicState.hits).toHaveLength(1)
    expect(totalCards(result.game)).toBe(108)
  })

  it('discard phase, already laid: hits a hand card onto the opponent\'s group', () => {
    const p2GroupZone = addCards(createPlayerZone('p2', 'p10group-0', 'public'), cardsByIds('p10-6', 'p10-8', 'p10-10'))
    const p1Hand = ['p10-12', 'p10-44', 'p10-68', 'p10-92', 'p10-26', 'p10-50', 'p10-74', 'p10-46', 'p10-70', 'p10-94']
    const game = buildSession({
      p1HandCardIds: p1Hand,
      p2HandCardIds: ['p10-24', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-40', 'p10-42', 'p10-52', 'p10-54'],
      discardCardIds: ['p10-96'],
      stockCardIds: remainingDeckIds([...p1Hand, 'p10-24', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-40', 'p10-42', 'p10-52', 'p10-54', 'p10-96', 'p10-6', 'p10-8', 'p10-10']),
      phase: 'discard',
      currentPlayerIndex: 0,
      hasLaidPhase: { p1: true, p2: false },
      groups: { p1: [], p2: [{ type: 'run', zone: p2GroupZone, phaseNumber: 2 }] },
    })

    // red 7 (p10-12) extends p2's red 4-5-6 run
    expect(strategyAction(game, 'p1')).toEqual({ type: 'HIT', targetPlayerId: 'p2', groupIndex: 0, cardIds: ['p10-12'] })

    // and the validator accepts the hit end-to-end
    const result = runPhase10BotTurn(game, 'p1', phase10BotStrategy)
    expect(result.outcome.ok).toBe(true)
    expect(result.game.session.publicState.hits).toHaveLength(1)
    expect(totalCards(result.game)).toBe(108)
  })

  it('validates a hit against the full group including prior hits', () => {
    // p2's run is 4-5-6 and already has a hit of red 7 (p10-12) from p1. p1 holds
    // red 8 (p10-14): against the original zone 4-5-6 + 8 is not a run, but against
    // the full group 4-5-6-7 + 8 it is — proving fullGroupCards drives this path.
    const p2GroupZone = addCards(createPlayerZone('p2', 'p10group-0', 'public'), cardsByIds('p10-6', 'p10-8', 'p10-10'))
    const p1Hand = ['p10-14', 'p10-44', 'p10-68', 'p10-92', 'p10-26', 'p10-50', 'p10-74', 'p10-46', 'p10-70', 'p10-94']
    const game = buildSession({
      p1HandCardIds: p1Hand,
      p2HandCardIds: ['p10-24', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-40', 'p10-42', 'p10-52', 'p10-54'],
      discardCardIds: ['p10-96'],
      stockCardIds: remainingDeckIds([...p1Hand, 'p10-24', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-40', 'p10-42', 'p10-52', 'p10-54', 'p10-96', 'p10-6', 'p10-8', 'p10-10', 'p10-12']),
      phase: 'discard',
      currentPlayerIndex: 0,
      hasLaidPhase: { p1: true, p2: false },
      groups: { p1: [], p2: [{ type: 'run', zone: p2GroupZone, phaseNumber: 2 }] },
      hits: [{ id: 'hit-0', playerId: 'p1', targetPlayerId: 'p2', targetGroupIndex: 0, cards: cardsByIds('p10-12') }],
    })

    expect(strategyAction(game, 'p1')).toEqual({ type: 'HIT', targetPlayerId: 'p2', groupIndex: 0, cardIds: ['p10-14'] })

    // and the validator accepts the hit end-to-end, on top of the prior hit
    const result = runPhase10BotTurn(game, 'p1', phase10BotStrategy)
    expect(result.outcome.ok).toBe(true)
    expect(result.game.session.publicState.hits).toHaveLength(2)
    expect(totalCards(result.game)).toBe(108)
  })

  it('no lay, no hit possible → falls through to discard', () => {
    // p1 already laid (a set of three 5s); the hand holds no 5s and no wilds, so
    // nothing extends the set and no phase remains to lay → discard.
    const p1GroupZone = addCards(createPlayerZone('p1', 'p10group-0', 'public'), cardsByIds('p10-8', 'p10-32', 'p10-56'))
    const p1Hand = ['p10-2', 'p10-4', 'p10-6', 'p10-20', 'p10-44', 'p10-68', 'p10-26', 'p10-50', 'p10-74', 'p10-92']
    const game = buildSession({
      p1HandCardIds: p1Hand,
      p2HandCardIds: ['p10-24', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-40', 'p10-42', 'p10-52', 'p10-54'],
      discardCardIds: ['p10-94'],
      stockCardIds: remainingDeckIds([...p1Hand, 'p10-24', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-40', 'p10-42', 'p10-52', 'p10-54', 'p10-94', 'p10-8', 'p10-32', 'p10-56']),
      phase: 'discard',
      currentPlayerIndex: 0,
      hasLaidPhase: { p1: true, p2: false },
      groups: { p1: [{ type: 'set', zone: p1GroupZone, phaseNumber: 1 }], p2: [] },
    })

    const action = strategyAction(game, 'p1')
    expect(action.type).toBe('DISCARD_CARD')
    if (action.type === 'DISCARD_CARD') {
      expect(p1Hand).toContain(action.cardId)
    }
  })

  it('never proposes a hit into a run\'s wild-locked range — it would be rejected and freeze the bot', () => {
    // p2's laid run is red 3-4-Wild-6: the Wild is locked in as the 5, so rules.ts
    // rejects any HIT of a natural 5 ("already covered by a Wild"). isValidRun alone
    // still passes for [3,4,Wild,6,5] (the Wild can re-read as 2 or 7), so a bot that
    // only checks isValidRun proposes the hit, gets rejected, and — because the app's
    // bot loop re-runs the deterministic strategy on rejection — freezes forever.
    // The bot must skip the covered 5 and fall through to discarding it instead.
    const p2GroupZone = addCards(createPlayerZone('p2', 'p10group-0', 'public'), cardsByIds('p10-4', 'p10-6', 'p10-100', 'p10-10'))
    // red 5 (p10-8) is the trapped card; every filler avoids ranks 2, 5, and 7 so no
    // OTHER hit on the run is legal and the locked-range card is the only candidate.
    const p1Hand = ['p10-8', 'p10-40', 'p10-44', 'p10-46', 'p10-64', 'p10-68', 'p10-70', 'p10-88', 'p10-92', 'p10-94']
    const p2Hand = ['p10-24', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-42', 'p10-52', 'p10-54', 'p10-56']
    const game = buildSession({
      p1HandCardIds: p1Hand,
      p2HandCardIds: p2Hand,
      discardCardIds: ['p10-96'],
      stockCardIds: remainingDeckIds([...p1Hand, ...p2Hand, 'p10-96', 'p10-4', 'p10-6', 'p10-100', 'p10-10']),
      phase: 'discard',
      currentPlayerIndex: 0,
      hasLaidPhase: { p1: true, p2: true },
      groups: { p1: [], p2: [{ type: 'run', zone: p2GroupZone, phaseNumber: 2 }] },
    })

    // The trapped red 5 has zero connectivity, so it's also the natural discard.
    expect(strategyAction(game, 'p1')).toEqual({ type: 'DISCARD_CARD', cardId: 'p10-8' })

    // And the full bot turn goes through the validator without a rejection.
    const result = runPhase10BotTurn(game, 'p1', phase10BotStrategy)
    expect(result.outcome.ok).toBe(true)
    expect(totalCards(result.game)).toBe(108)
  })

  it('regression: the exact live freeze state — run 4-5-W-W-8..12, bot holding two 6s and a 5', () => {
    // Observed in a real game (2026-08-30): the human's laid run was red
    // 4,5,Wild,Wild,8,9,10,11,12 (Wilds standing in for 6 and 7), the bot held
    // green 6, green 5, yellow 6 — every one a natural inside the locked range
    // 4..12 — and the bot froze forever proposing a hit of a 6 that the
    // validator rejected. It must discard instead.
    const runZone = addCards(createPlayerZone('p2', 'p10group-0', 'public'), cardsByIds('p10-6', 'p10-8', 'p10-100', 'p10-101', 'p10-14', 'p10-16', 'p10-18', 'p10-20', 'p10-22'))
    const p1Hand = ['p10-58', 'p10-56', 'p10-82']
    const p2Hand = ['p10-24', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-42', 'p10-52']
    const game = buildSession({
      p1HandCardIds: p1Hand,
      p2HandCardIds: p2Hand,
      discardCardIds: ['p10-96'],
      stockCardIds: remainingDeckIds([...p1Hand, ...p2Hand, 'p10-96', 'p10-6', 'p10-8', 'p10-100', 'p10-101', 'p10-14', 'p10-16', 'p10-18', 'p10-20', 'p10-22']),
      phase: 'discard',
      currentPlayerIndex: 0,
      hasLaidPhase: { p1: true, p2: true },
      groups: { p1: [], p2: [{ type: 'run', zone: runZone, phaseNumber: 5 }] },
    })

    const action = strategyAction(game, 'p1')
    expect(action.type).toBe('DISCARD_CARD')

    const result = runPhase10BotTurn(game, 'p1', phase10BotStrategy)
    expect(result.outcome.ok).toBe(true)
    expect(totalCards(result.game)).toBe(108)
  })
})

// ── tests: bot-vs-bot full matches — no proposal is ever rejected ─────────────

describe('bot-vs-bot integration', () => {
  it('plays full matches and every action the strategy proposes is accepted by the validator', () => {
    // The freeze class this guards against: ANY strategy/validator disagreement
    // deadlocks the app's bot loop, because a rejected deterministic proposal is
    // re-proposed forever. Playing whole matches sweeps a wide sample of real
    // reachable states through the exact strategy → validator path.
    for (const seed of [1, 42, 987654321]) {
      let game = createPhase10Game(['p1', 'p2'], seed)
      let actions = 0
      while (!game.session.publicState.matchWinnerId && actions < 40000) {
        const ps = game.session.publicState
        const actor = ps.roundOver ? 'p1' : currentPlayer(ps.turn)
        const result = runPhase10BotTurn(game, actor, phase10BotStrategy)
        expect(result.outcome, `seed ${seed}, action ${actions}: ${JSON.stringify(result.outcome)}`).toHaveProperty('ok', true)
        game = result.game
        actions++
      }
      expect(game.session.publicState.matchWinnerId, `seed ${seed} did not finish within ${actions} actions`).not.toBeNull()
    }
  })
})

// ── tests: canCompletePhase / findPhaseSelection ─────────────

describe('canCompletePhase / findPhaseSelection', () => {
  const completingHand = ['p10-8', 'p10-32', 'p10-56', 'p10-16', 'p10-40', 'p10-64', 'p10-2', 'p10-4', 'p10-6', 'p10-20']
  const scatteredHand = ['p10-2', 'p10-4', 'p10-6', 'p10-8', 'p10-10', 'p10-12', 'p10-14', 'p10-16', 'p10-18', 'p10-20']

  it('finds a completing selection and it checks back as a valid phase', () => {
    const hand = cardsByIds(...completingHand)
    expect(canCompletePhase(hand, PHASES[0])).toBe(true)
    const selection = findPhaseSelection(hand, PHASES[0])
    expect(selection).not.toBeNull()
    expect(classifyPhaseHand(cardsByIds(...selection!), PHASES[0]).valid).toBe(true)
  })

  it('returns false/null when no size-matching subset completes the phase', () => {
    // red 2-11: every rank distinct, so Phase 1's 2 sets of 3 are impossible
    const hand = cardsByIds(...scatteredHand)
    expect(canCompletePhase(hand, PHASES[0])).toBe(false)
    expect(findPhaseSelection(hand, PHASES[0])).toBeNull()
  })

  it('never selects a phase that would require including a Skip card', () => {
    // Only 2 fives + 3 nines + a Skip: the only way to reach 6 cards that "would
    // work" is to include the Skip, which is excluded from the search up front.
    const skipOnlyHand = cardsByIds('p10-8', 'p10-32', 'p10-16', 'p10-40', 'p10-64', 'p10-96', 'p10-2', 'p10-4', 'p10-6', 'p10-20')
    expect(findPhaseSelection(skipOnlyHand, PHASES[0])).toBeNull()
    expect(canCompletePhase(skipOnlyHand, PHASES[0])).toBe(false)
  })

  it('a lone Wild cannot substitute for missing set members', () => {
    // two 5s + one Wild + three 9s — a Wild would complete the first set (5,5,W)
    const wildHand = cardsByIds('p10-8', 'p10-32', 'p10-100', 'p10-16', 'p10-40', 'p10-64', 'p10-2', 'p10-4', 'p10-6', 'p10-20')
    const selection = findPhaseSelection(wildHand, PHASES[0])
    expect(selection).not.toBeNull()
    expect(classifyPhaseHand(cardsByIds(...selection!), PHASES[0]).valid).toBe(true)
  })
})

// ── tests: selectDiscard ─────────────────────────────────────

describe('selectDiscard', () => {
  it('discards a Skip first, even when other cards look more useful', () => {
    const hand = cardsByIds('p10-96', 'p10-8', 'p10-10', 'p10-12', 'p10-42')  // Skip + tight red 5-6-7 cluster
    expect(selectDiscard(hand)).toBe('p10-96')
  })

  it('discards a Skip regardless of previous skips this round', () => {
    const hand = cardsByIds('p10-96', 'p10-8', 'p10-10', 'p10-12', 'p10-42')  // Skip + red 5-6-7 + isolated blue 10
    expect(selectDiscard(hand)).toBe('p10-96')
  })

  it('discards the obviously isolated card from a tightly-clustered hand', () => {
    // red 5-6-7 all interconnect (same suit, within 3); blue 10 is disconnected
    const hand = cardsByIds('p10-8', 'p10-10', 'p10-12', 'p10-42')
    expect(selectDiscard(hand)).toBe('p10-42')
  })

  it('breaks connectivity ties by highest cardPenalty', () => {
    // red 2, blue 10, green 5 — all pairwise disconnected (different suits, no
    // rank matches), so all score 0. blue 10 costs 10 (rank > 9) vs 5 each → shed it.
    const hand = cardsByIds('p10-2', 'p10-42', 'p10-56')
    expect(selectDiscard(hand)).toBe('p10-42')
  })

  it('falls back to any card for an all-wild hand — never crashes', () => {
    const hand = cardsByIds('p10-100', 'p10-101', 'p10-102')
    expect(selectDiscard(hand)).toBe('p10-100')
  })
})

// ── tests: strategy discard path with a Skip in hand ─────────

describe('phase10BotStrategy discard fallthrough', () => {
  it('discards a Skip when nothing else is productive', () => {
    // Not laid, and the hand cannot complete Phase 1 → discard, and the Skip
    // goes first (tempo play).
    const p1Hand = ['p10-96', 'p10-8', 'p10-10', 'p10-12', 'p10-42']
    const game = buildSession({
      p1HandCardIds: p1Hand,
      p2HandCardIds: ['p10-24', 'p10-26', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-40', 'p10-44', 'p10-46'],
      discardCardIds: ['p10-94'],
      stockCardIds: remainingDeckIds([...p1Hand, 'p10-24', 'p10-26', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-40', 'p10-44', 'p10-46', 'p10-94']),
      phase: 'discard',
      currentPlayerIndex: 0,
    })

    expect(strategyAction(game, 'p1')).toEqual({ type: 'DISCARD_CARD', cardId: 'p10-96' })

    // the validator accepts discarding the Skip (it skips p2's turn)
    const result = runPhase10BotTurn(game, 'p1', phase10BotStrategy)
    expect(result.outcome.ok).toBe(true)
    expect(currentPlayer(result.game.session.publicState.turn)).toBe('p1')
    expect(totalCards(result.game)).toBe(108)
  })

  it('discards a Skip even after a previous Skip this round', () => {
    const p1Hand = ['p10-96', 'p10-8', 'p10-10', 'p10-12', 'p10-42']
    const game = buildSession({
      p1HandCardIds: p1Hand,
      p2HandCardIds: ['p10-24', 'p10-26', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-40', 'p10-44', 'p10-46'],
      discardCardIds: ['p10-94'],
      stockCardIds: remainingDeckIds([...p1Hand, 'p10-24', 'p10-26', 'p10-28', 'p10-30', 'p10-34', 'p10-36', 'p10-38', 'p10-40', 'p10-44', 'p10-46', 'p10-94']),
      phase: 'discard',
      currentPlayerIndex: 0,
    })

    expect(strategyAction(game, 'p1')).toEqual({ type: 'DISCARD_CARD', cardId: 'p10-96' })
  })
})

// ── tests: full turn composition ─────────────────────────────

describe('phase10BotStrategy full turn', () => {
  it('composes a complete turn via runPhase10BotTurn in a loop without ever being rejected', () => {
    const game = createPhase10Game(['p1', 'p2'], 42)
    const startPlayer = currentPlayer(game.session.publicState.turn)

    let r = game
    let turnEnded = false
    const maxCalls = 20
    let callCount = 0

    while (callCount < maxCalls && !turnEnded) {
      const result = runPhase10BotTurn(r, startPlayer, phase10BotStrategy)
      callCount++
      // a bot that ever proposes an action the validator rejects is a bug
      expect(result.outcome.ok).toBe(true)
      r = result.game
      const pub = r.session.publicState
      if (pub.roundOver) {
        turnEnded = true
      } else if (pub.turn.phase === 'draw' && currentPlayer(pub.turn) !== startPlayer) {
        turnEnded = true
      }
    }

    expect(turnEnded).toBe(true)
    expect(callCount).toBeLessThan(maxCalls)
    expect(totalCards(r)).toBe(108)
  })
})
