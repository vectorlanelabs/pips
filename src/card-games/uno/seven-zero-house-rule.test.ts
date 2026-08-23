import { describe, expect, it } from 'vitest'
import { createUnoDeck, type UnoCard, type UnoColor } from './deck.ts'
import {
  UNO_HOUSE_RULE_DEFS,
  createUnoGame,
  resolveHouseRules,
  type UnoHouseRuleKey,
  type UnoPrivateState,
  type UnoPublicState,
  type UnoSession,
} from './state.ts'
import { applyUnoAction } from './rules.ts'
import { createHostSession } from '../../engine/sync.ts'
import { createTurnState, currentPlayer } from '../../engine/turn-engine.ts'
import { createRng } from '../../engine/rng.ts'
import { addCards, createDiscardPile, createHand, createPublicZone } from '../../card-engine/zones.ts'

// ── fixtures ────────────────────────────────────────────────────
const deckMap = new Map(createUnoDeck().map((c) => [c.id, c]))
const byId = (id: string): UnoCard => deckMap.get(id)!
const cards = (...ids: string[]): UnoCard[] => ids.map((id) => byId(id))

const PLAYERS = ['p1', 'p2', 'p3', 'p4']

function buildGame(config: {
  players?: string[]
  stage?: UnoPublicState['stage']
  currentIndex?: number
  direction?: 1 | -1
  activeColor?: UnoColor
  discard?: UnoCard[]
  stock?: UnoCard[]
  hands?: Record<string, UnoCard[]>
  scores?: Record<string, number>
  houseRules?: Record<UnoHouseRuleKey, boolean>
} = {}): UnoSession {
  const players = config.players ?? PLAYERS
  const turn = createTurnState<'play'>(players, 'play')
  if (config.currentIndex != null) {
    (turn as { currentIndex: number }).currentIndex = config.currentIndex
  }
  if (config.direction != null) {
    (turn as { direction: number }).direction = config.direction
  }
  const privateStates: Record<string, UnoPrivateState> = {}
  const handCounts: Record<string, number> = {}
  for (const p of players) {
    const handCards = config.hands?.[p] ?? []
    privateStates[p] = { hand: addCards(createHand<UnoCard>(p), handCards) }
    handCounts[p] = handCards.length
  }
  const discardPile = addCards(createDiscardPile<UnoCard>(), config.discard ?? cards('uno-9'))
  const stock = addCards(createPublicZone<UnoCard>('stock', 'private'), config.stock ?? cards('uno-13', 'uno-38', 'uno-63'))
  const publicState: UnoPublicState = {
    cardBack: 'pips_default',
    stage: config.stage ?? 'play',
    turn,
    seatOrder: players,
    round: 0,
    activeColor: config.activeColor ?? 'red',
    discardPile,
    stockCount: stock.cards.length,
    handCounts,
    hasDrawnThisTurn: false,
    pendingWild: null,
    pendingStack: null,
    pendingSevenSwap: null,
    unoWindow: null,
    scores: config.scores ?? Object.fromEntries(players.map((p) => [p, 0])),
    roundResult: null,
    matchWinnerId: null,
    lastAction: null,
    houseRules: config.houseRules ?? { drawUntilPlayable: false, stackDraw: false, sevenZero: false },
  }
  return { session: createHostSession(publicState, privateStates), stock, rng: createRng(0) }
}

// ── defs and resolution ─────────────────────────────────────────

describe('seven-zero house rule defs', () => {
  it('UNO_HOUSE_RULE_DEFS includes sevenZero', () => {
    expect(UNO_HOUSE_RULE_DEFS.length).toBeGreaterThanOrEqual(3)
    const sevenZeroDef = UNO_HOUSE_RULE_DEFS.find((d) => d.key === 'sevenZero')
    expect(sevenZeroDef).toEqual({
      key: 'sevenZero',
      label: '7-0 rule',
      description: 'Play a 7 to swap hands with one opponent of your choice. Play a 0 and everyone passes their hand to the next player around the table.',
      default: false,
    })
  })

  it('resolveHouseRules() defaults sevenZero to false', () => {
    const resolved = resolveHouseRules()
    expect(resolved.sevenZero).toBe(false)
  })

  it('resolveHouseRules({ sevenZero: true }) overlays sevenZero', () => {
    const resolved = resolveHouseRules({ sevenZero: true })
    expect(resolved.sevenZero).toBe(true)
    expect(resolved.drawUntilPlayable).toBe(false)
    expect(resolved.stackDraw).toBe(false)
  })
})

// ── createUnoGame ───────────────────────────────────────────────

describe('createUnoGame houseRules with sevenZero', () => {
  it('defaults sevenZero off when no third argument is given', () => {
    const uno = createUnoGame(['p1', 'p2'], 42)
    expect(uno.session.publicState.houseRules.sevenZero).toBe(false)
  })

  it('accepts sevenZero: true as an overlay', () => {
    const uno = createUnoGame(['p1', 'p2'], 42, { sevenZero: true })
    expect(uno.session.publicState.houseRules.sevenZero).toBe(true)
  })

  it('initializes pendingSevenSwap to null', () => {
    const uno = createUnoGame(['p1', 'p2'], 42)
    expect(uno.session.publicState.pendingSevenSwap).toBe(null)
  })
})

// ── Regression: rule OFF ────────────────────────────────────────

describe('7 and 0 with rule OFF (regression)', () => {
  it('playing a 7 behaves like a normal number card when sevenZero is off', () => {
    // uno-13 = red 7
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: false },
      hands: { p1: cards('uno-13', 'uno-1'), p2: cards('uno-2'), p3: cards('uno-3'), p4: cards('uno-4') },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-13' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.activeColor).toBe('red')
    expect(pub.pendingSevenSwap).toBe(null)
    expect(currentPlayer(pub.turn)).toBe('p2')
    expect(pub.handCounts.p1).toBe(1)
  })

  it('playing a 0 behaves like a normal number card when sevenZero is off', () => {
    // uno-0 = red 0
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: false },
      hands: { p1: cards('uno-0', 'uno-1'), p2: cards('uno-2'), p3: cards('uno-3'), p4: cards('uno-4') },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-0' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.activeColor).toBe('red')
    expect(pub.pendingSevenSwap).toBe(null)
    expect(currentPlayer(pub.turn)).toBe('p2')
    expect(pub.handCounts.p1).toBe(1)
  })
})

// ── Rule ON: playing a 7 ────────────────────────────────────────

describe('playing a 7 with sevenZero ON', () => {
  it('sets pendingSevenSwap and does not advance turn', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: true },
      hands: { p1: cards('uno-13', 'uno-0'), p2: [], p3: [], p4: [] },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-13' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.activeColor).toBe('red')
    expect(pub.pendingSevenSwap).toEqual({ cardId: 'uno-13' })
    expect(currentPlayer(pub.turn)).toBe('p1')
    expect(pub.handCounts.p1).toBe(1)
  })

  it('going out on a 7 ends the round immediately without setting pendingSevenSwap', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: true },
      hands: { p1: cards('uno-13'), p2: [], p3: [], p4: [] },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-13' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.stage).toBe('roundOver')
    expect(pub.pendingSevenSwap).toBe(null)
    expect(pub.roundResult?.outPlayerId).toBe('p1')
  })
})

// ── CHOOSE_SWAP_TARGET ──────────────────────────────────────────

describe('CHOOSE_SWAP_TARGET action', () => {
  it('swaps hands correctly between two players', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: true },
      hands: {
        p1: cards('uno-13', 'uno-1', 'uno-2'),  // 3 cards
        p2: cards('uno-10', 'uno-11'),  // 2 cards
        p3: [],
        p4: [],
      },
    })
    // p1 plays a 7
    let r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-13' })
    expect(r.outcome.ok).toBe(true)
    expect(r.uno.session.publicState.pendingSevenSwap).not.toBe(null)
    // p1 chooses p2 as swap target
    r = applyUnoAction(r.uno, 'p1', { type: 'CHOOSE_SWAP_TARGET', targetPlayerId: 'p2' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.pendingSevenSwap).toBe(null)
    expect(pub.handCounts.p1).toBe(2)  // was 3-1=2, got p2's 2
    expect(pub.handCounts.p2).toBe(2)  // was 2, got p1's 3-1=2
    expect(r.uno.session.privateStates.p1.hand.cards.map((c) => c.id)).toEqual(['uno-10', 'uno-11'])
    expect(r.uno.session.privateStates.p2.hand.cards.map((c) => c.id)).toEqual(['uno-1', 'uno-2'])
    expect(currentPlayer(pub.turn)).toBe('p2')
  })

  it('rejects self-target', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: true },
      hands: { p1: cards('uno-13', 'uno-1'), p2: [], p3: [], p4: [] },
    })
    let r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-13' })
    expect(r.outcome.ok).toBe(true)
    r = applyUnoAction(r.uno, 'p1', { type: 'CHOOSE_SWAP_TARGET', targetPlayerId: 'p1' })
    expect(r.outcome.ok).toBe(false)
  })

  it('rejects when no 7-swap is pending', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: true },
      hands: { p1: cards('uno-1'), p2: [], p3: [], p4: [] },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'CHOOSE_SWAP_TARGET', targetPlayerId: 'p2' })
    expect(r.outcome.ok).toBe(false)
  })

  it('rejects unknown/unseated targetPlayerId', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: true },
      hands: { p1: cards('uno-13', 'uno-1'), p2: [], p3: [], p4: [] },
    })
    let r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-13' })
    expect(r.outcome.ok).toBe(true)
    r = applyUnoAction(r.uno, 'p1', { type: 'CHOOSE_SWAP_TARGET', targetPlayerId: 'unknown' })
    expect(r.outcome.ok).toBe(false)
  })

  it('sets lastAction with swapTargetPlayerId', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: true },
      hands: { p1: cards('uno-13', 'uno-1'), p2: cards('uno-10'), p3: [], p4: [] },
    })
    let r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-13' })
    r = applyUnoAction(r.uno, 'p1', { type: 'CHOOSE_SWAP_TARGET', targetPlayerId: 'p2' })
    const pub = r.uno.session.publicState
    expect(pub.lastAction).toEqual({
      by: 'p1',
      kind: 'play',
      card: { color: 'red', kind: 'number', value: 7 },
      drewCount: 0,
      swapTargetPlayerId: 'p2',
    })
  })
})

// ── Uno-call window after swap ──────────────────────────────────

describe('Uno-call window after swap (priority)', () => {
  it('opens for acting player if they end at 1 card post-swap', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: true },
      hands: {
        p1: cards('uno-13', 'uno-1', 'uno-2'),  // 3 cards, will play uno-13 and have [uno-1, uno-2], then swap with p2's [uno-10] to end at 1
        p2: cards('uno-10'),  // 1 card, will get p1's remaining 2 cards
        p3: cards('uno-20'),
        p4: cards('uno-30'),
      },
    })
    let r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-13' })
    r = applyUnoAction(r.uno, 'p1', { type: 'CHOOSE_SWAP_TARGET', targetPlayerId: 'p2' })
    const pub = r.uno.session.publicState
    expect(pub.unoWindow?.playerId).toBe('p1')
  })

  it('opens for target if only target ends at 1 card post-swap', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: true },
      hands: {
        p1: cards('uno-13', 'uno-1'),  // 2 cards, will play uno-13 and have [uno-1], then swap with p2's [uno-10, uno-11] to end at 2
        p2: cards('uno-10', 'uno-11'),  // 2 cards, will get p1's remaining 1 card to end at 1
        p3: cards('uno-20'),
        p4: cards('uno-30'),
      },
    })
    let r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-13' })
    r = applyUnoAction(r.uno, 'p1', { type: 'CHOOSE_SWAP_TARGET', targetPlayerId: 'p2' })
    const pub = r.uno.session.publicState
    expect(pub.unoWindow?.playerId).toBe('p2')
  })

  it('stays null if neither ends at 1 card post-swap', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: true },
      hands: {
        p1: cards('uno-13', 'uno-1', 'uno-2'),  // 3 cards
        p2: cards('uno-10', 'uno-11'),  // 2 cards
        p3: [],
        p4: [],
      },
    })
    let r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-13' })
    r = applyUnoAction(r.uno, 'p1', { type: 'CHOOSE_SWAP_TARGET', targetPlayerId: 'p2' })
    const pub = r.uno.session.publicState
    expect(pub.unoWindow).toBe(null)
  })
})

// ── Rule ON: playing a 0 ────────────────────────────────────────

describe('playing a 0 with sevenZero ON', () => {
  it('rotates all seated hands one seat in the turn direction', () => {
    const uno = buildGame({
      players: ['p1', 'p2', 'p3'],
      houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: true },
      hands: {
        p1: cards('uno-0', 'uno-1'),  // red 0 + red 1
        p2: cards('uno-10', 'uno-11'),
        p3: cards('uno-20', 'uno-21'),
      },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-0' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    // With direction=1 (forward), rotation moves: p3→p1, p1→p2, p2→p3
    // So p1 should now have p3's hand, p2 should have p1's (minus the 0), p3 should have p2's
    expect(r.uno.session.privateStates.p1.hand.cards.map((c) => c.id)).toEqual(['uno-20', 'uno-21'])
    expect(r.uno.session.privateStates.p2.hand.cards.map((c) => c.id)).toEqual(['uno-1'])  // p1's hand minus the played 0
    expect(r.uno.session.privateStates.p3.hand.cards.map((c) => c.id)).toEqual(['uno-10', 'uno-11'])
    expect(currentPlayer(pub.turn)).toBe('p2')
    expect(pub.unoWindow).toBe(null)
  })

  it('respects reverse direction when rotating', () => {
    const uno = buildGame({
      players: ['p1', 'p2', 'p3'],
      currentIndex: 1,  // p2 is current
      direction: -1,  // reverse direction
      houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: true },
      hands: {
        p1: cards('uno-1'),  // red 1
        p2: cards('uno-0', 'uno-11'),  // red 0 + red 6
        p3: cards('uno-20', 'uno-21'),  // red skip + red reverse
      },
    })
    // Play a 0 from p2 in reverse direction
    const r = applyUnoAction(uno, 'p2', { type: 'PLAY_CARD', cardId: 'uno-0' })
    expect(r.outcome.ok).toBe(true)
    // With direction=-1 (backward), rotation: p1 gets p2's hand, p2 gets p3's hand, p3 gets p1's hand
    expect(r.uno.session.privateStates.p1.hand.cards.map((c) => c.id)).toEqual(['uno-11'])  // p2's hand minus the 0
    expect(r.uno.session.privateStates.p2.hand.cards.map((c) => c.id)).toEqual(['uno-20', 'uno-21'])  // p3's hand
    expect(r.uno.session.privateStates.p3.hand.cards.map((c) => c.id)).toEqual(['uno-1'])  // p1's hand
  })

  it('does not open an Uno window even if a player ends at 1 card after rotation', () => {
    const uno = buildGame({
      players: ['p1', 'p2', 'p3'],
      houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: true },
      hands: {
        p1: cards('uno-0'),  // 1 card
        p2: cards('uno-10', 'uno-11', 'uno-12'),
        p3: cards('uno-20'),  // 1 card, will get p1's hand after rotation so no uno
      },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-0' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.unoWindow).toBe(null)
  })

  it('going out on a 0 ends the round immediately without rotating', () => {
    const uno = buildGame({
      players: ['p1', 'p2', 'p3'],
      houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: true },
      hands: {
        p1: cards('uno-0'),
        p2: cards('uno-10'),
        p3: cards('uno-20'),
      },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-0' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.stage).toBe('roundOver')
    expect(pub.roundResult?.outPlayerId).toBe('p1')
    // No rotation happened
    expect(r.uno.session.privateStates.p2.hand.cards.map((c) => c.id)).toEqual(['uno-10'])
    expect(r.uno.session.privateStates.p3.hand.cards.map((c) => c.id)).toEqual(['uno-20'])
  })
})

// ── START_NEXT_ROUND ────────────────────────────────────────────

describe('START_NEXT_ROUND resets pendingSevenSwap', () => {
  it('clears pendingSevenSwap when starting a new round', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: true },
      stage: 'roundOver',
      hands: { p1: [], p2: [], p3: [], p4: [] },
    })
    uno.session.publicState.roundResult = { outPlayerId: 'p1', pointsAdded: { p1: 0, p2: 10, p3: 10, p4: 10 } }
    const r = applyUnoAction(uno, 'p1', { type: 'START_NEXT_ROUND' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.stage).toBe('play')
    expect(pub.pendingSevenSwap).toBe(null)
  })
})

// ── Additional edge cases ───────────────────────────────────────

describe('seven-zero with 2 players', () => {
  it('7-swap works with 2 players', () => {
    const uno = buildGame({
      players: ['p1', 'p2'],
      houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: true },
      hands: {
        p1: cards('uno-13', 'uno-1'),
        p2: cards('uno-10'),
      },
    })
    let r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-13' })
    r = applyUnoAction(r.uno, 'p1', { type: 'CHOOSE_SWAP_TARGET', targetPlayerId: 'p2' })
    expect(r.outcome.ok).toBe(true)
    expect(r.uno.session.privateStates.p1.hand.cards.map((c) => c.id)).toEqual(['uno-10'])
    expect(r.uno.session.privateStates.p2.hand.cards.map((c) => c.id)).toEqual(['uno-1'])
  })

  it('0-rotation in 2-player: general rotation logic degenerates to a hand swap', () => {
    const uno = buildGame({
      players: ['p1', 'p2'],
      houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: true },
      hands: {
        p1: cards('uno-0', 'uno-1'),
        p2: cards('uno-10'),
      },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-0' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    // In 2-player, rotation moves: p2→p1, p1→p2
    // So p1 should have p2's hand, p2 should have p1's (minus the 0)
    expect(r.uno.session.privateStates.p1.hand.cards.map((c) => c.id)).toEqual(['uno-10'])
    expect(r.uno.session.privateStates.p2.hand.cards.map((c) => c.id)).toEqual(['uno-1'])
    expect(currentPlayer(pub.turn)).toBe('p2')
  })
})
