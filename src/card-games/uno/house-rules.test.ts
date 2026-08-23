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
import { addCards, cardCount, createDiscardPile, createHand, createPublicZone } from '../../card-engine/zones.ts'

// ── fixtures ────────────────────────────────────────────────────
// Same pattern as uno.test.ts / uno-call.test.ts: hand-built session with a known board,
// hands, discard, stock and houseRules. (Helpers in other .test.ts files can't be imported,
// so the minimal fixture is duplicated here.)
const deckMap = new Map(createUnoDeck().map((c) => [c.id, c]))
const byId = (id: string): UnoCard => deckMap.get(id)!
const cards = (...ids: string[]): UnoCard[] => ids.map((id) => byId(id))

const PLAYERS = ['p1', 'p2', 'p3', 'p4']

function buildGame(config: {
  players?: string[]
  stage?: UnoPublicState['stage']
  currentIndex?: number
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
  const privateStates: Record<string, UnoPrivateState> = {}
  const handCounts: Record<string, number> = {}
  for (const p of players) {
    const handCards = config.hands?.[p] ?? []
    privateStates[p] = { hand: addCards(createHand<UnoCard>(p), handCards) }
    handCounts[p] = handCards.length
  }
  const discardPile = addCards(createDiscardPile<UnoCard>(), config.discard ?? cards('uno-9'))   // red 5
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

// p1's hand with no legal play against a red 5 top / activeColor red (same set as uno.test.ts)
const NO_LEGAL = ['uno-30', 'uno-65', 'uno-78', 'uno-44']   // yellow 3, green 8, blue 2, yellow skip

// ── defs and resolution ─────────────────────────────────────────

describe('house rule defs and resolution', () => {
  it('UNO_HOUSE_RULE_DEFS has the expected entries', () => {
    expect(UNO_HOUSE_RULE_DEFS).toHaveLength(3)
    expect(UNO_HOUSE_RULE_DEFS[0]).toEqual({
      key: 'drawUntilPlayable',
      label: 'Draw until you can play',
      description: 'Keep drawing from the stock until you draw a card you can play, instead of drawing just one and passing if it isn’t playable.',
      default: false,
    })
  })

  it('resolveHouseRules() returns every defined key at its default', () => {
    const resolved = resolveHouseRules()
    for (const def of UNO_HOUSE_RULE_DEFS) expect(resolved[def.key]).toBe(def.default)
    expect(resolved).toEqual({ drawUntilPlayable: false, stackDraw: false, sevenZero: false })
  })

  it('resolveHouseRules({}) also returns every defined key at its default', () => {
    expect(resolveHouseRules({})).toEqual({ drawUntilPlayable: false, stackDraw: false, sevenZero: false })
  })

  it('resolveHouseRules({ drawUntilPlayable: true }) overlays one key and keeps others at default', () => {
    expect(resolveHouseRules({ drawUntilPlayable: true })).toEqual({ drawUntilPlayable: true, stackDraw: false, sevenZero: false })
  })
})

// ── createUnoGame ───────────────────────────────────────────────

describe('createUnoGame houseRules', () => {
  it('defaults every rule off when no third argument is given', () => {
    const uno = createUnoGame(['p1', 'p2'], 42)
    expect(uno.session.publicState.houseRules).toEqual({ drawUntilPlayable: false, stackDraw: false, sevenZero: false })
  })

  it('accepts a partial houseRules overlay as the third argument', () => {
    const uno = createUnoGame(['p1', 'p2'], 42, { drawUntilPlayable: true })
    expect(uno.session.publicState.houseRules).toEqual({ drawUntilPlayable: true, stackDraw: false, sevenZero: false })
  })
})

// ── DRAW_CARD with the rule off (regression: byte-identical to spec 34) ──

describe('DRAW_CARD with the rule off', () => {
  it('still draws exactly one card even when it is not playable', () => {
    const uno = buildGame({ hands: { p1: cards(...NO_LEGAL), p2: [], p3: [], p4: [] } })
    // default stock top is uno-63 (green 7) — unplayable against red 5 / activeColor red
    const r = applyUnoAction(uno, 'p1', { type: 'DRAW_CARD' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.lastAction).toEqual({ by: 'p1', kind: 'draw', card: null, drewCount: 1 })
    expect(pub.handCounts.p1).toBe(5)
    expect(r.uno.session.privateStates.p1.hand.cards.map((c) => c.id)).toEqual([...NO_LEGAL, 'uno-63'])
    expect(pub.stockCount).toBe(2)
    expect(cardCount(r.uno.stock)).toBe(2)
    expect(currentPlayer(pub.turn)).toBe('p2')
    expect(pub.hasDrawnThisTurn).toBe(false)
  })

  it('keeps the turn when the single drawn card happens to be playable', () => {
    const uno = buildGame({
      hands: { p1: cards(...NO_LEGAL), p2: [], p3: [], p4: [] },
      stock: cards('uno-38', 'uno-13'),   // top = red 7, playable
    })
    const r = applyUnoAction(uno, 'p1', { type: 'DRAW_CARD' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.lastAction).toEqual({ by: 'p1', kind: 'draw', card: null, drewCount: 1 })
    expect(pub.handCounts.p1).toBe(5)
    expect(pub.stockCount).toBe(1)
    expect(currentPlayer(pub.turn)).toBe('p1')
    expect(pub.hasDrawnThisTurn).toBe(true)
  })
})

// ── DRAW_CARD with drawUntilPlayable on ─────────────────────────

describe('DRAW_CARD with drawUntilPlayable on', () => {
  it('draws every unplayable card plus the first playable one, keeping the turn', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: true, stackDraw: false, sevenZero: false },
      hands: { p1: cards(...NO_LEGAL), p2: [], p3: [], p4: [] },
      stock: cards('uno-10', 'uno-38', 'uno-63'),
      // stock array: [red 5, yellow 7, green 7] — top is uno-63 (green 7), drawn first.
      // green 7 and yellow 7 are unplayable against red 5; red 5 breaks the loop.
    })
    const r = applyUnoAction(uno, 'p1', { type: 'DRAW_CARD' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.lastAction).toEqual({ by: 'p1', kind: 'draw', card: null, drewCount: 3 })
    expect(pub.handCounts.p1).toBe(7)
    expect(r.uno.session.privateStates.p1.hand.cards.map((c) => c.id)).toEqual([
      ...NO_LEGAL, 'uno-63', 'uno-38', 'uno-10',
    ])
    expect(pub.stockCount).toBe(0)
    expect(cardCount(r.uno.stock)).toBe(0)
    expect(pub.discardPile.cards.map((c) => c.id)).toEqual(['uno-9'])   // nothing played, discard untouched
    expect(currentPlayer(pub.turn)).toBe('p1')
    expect(pub.hasDrawnThisTurn).toBe(true)
  })

  it('after the multi-draw the player may pass, ending the turn', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: true, stackDraw: false, sevenZero: false },
      hands: { p1: cards(...NO_LEGAL), p2: [], p3: [], p4: [] },
      stock: cards('uno-10', 'uno-38', 'uno-63'),
    })
    const r = applyUnoAction(uno, 'p1', { type: 'DRAW_CARD' })
    expect(r.outcome.ok).toBe(true)
    const pass = applyUnoAction(r.uno, 'p1', { type: 'PASS' })
    expect(pass.outcome.ok).toBe(true)
    const after = pass.uno.session.publicState
    expect(currentPlayer(after.turn)).toBe('p2')
    expect(after.hasDrawnThisTurn).toBe(false)
  })

  it('draws exactly one card when the very first card drawn is already playable', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: true, stackDraw: false, sevenZero: false },
      hands: { p1: cards(...NO_LEGAL), p2: [], p3: [], p4: [] },
      stock: cards('uno-38', 'uno-13'),   // top = red 7, playable
    })
    const r = applyUnoAction(uno, 'p1', { type: 'DRAW_CARD' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.lastAction).toEqual({ by: 'p1', kind: 'draw', card: null, drewCount: 1 })
    expect(pub.handCounts.p1).toBe(5)
    expect(pub.stockCount).toBe(1)
    expect(currentPlayer(pub.turn)).toBe('p1')
  })

  it('a wild is always playable, so it stops the loop after one draw', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: true, stackDraw: false, sevenZero: false },
      hands: { p1: cards(...NO_LEGAL), p2: [], p3: [], p4: [] },
      stock: cards('uno-10', 'uno-100'),   // top = wild — always playable
    })
    const r = applyUnoAction(uno, 'p1', { type: 'DRAW_CARD' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.lastAction).toEqual({ by: 'p1', kind: 'draw', card: null, drewCount: 1 })
    expect(pub.handCounts.p1).toBe(5)
    expect(currentPlayer(pub.turn)).toBe('p1')
  })

  it('exhausts stock and recycling and blocks the round when nothing playable remains', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: true, stackDraw: false, sevenZero: false },
      hands: { p1: cards(...NO_LEGAL), p2: [], p3: [], p4: [] },
      discard: cards('uno-30', 'uno-63', 'uno-9'),   // top = red 5; below it yellow 3, green 7 — all unplayable
      stock: cards('uno-38', 'uno-65'),              // top = green 8, then yellow 7 — all unplayable
      scores: { p1: 10, p2: 20, p3: 30, p4: 40 },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'DRAW_CARD' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.stage).toBe('roundOver')
    expect(pub.roundResult).toBeNull()
    expect(pub.scores).toEqual({ p1: 10, p2: 20, p3: 30, p4: 40 })
    expect(pub.handCounts.p1).toBe(4)      // nothing was committed to anyone's hand
    expect(pub.stockCount).toBe(2)         // unchanged — blocked round commits nothing
  })
})

// ── across rounds ───────────────────────────────────────────────

describe('houseRules across rounds', () => {
  it('survives START_NEXT_ROUND unchanged', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: true, stackDraw: false, sevenZero: false },
      stage: 'roundOver',
      scores: { p1: 100, p2: 50, p3: 0, p4: 0 },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'START_NEXT_ROUND' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.round).toBe(1)
    expect(pub.stage).toBe('play')
    expect(pub.houseRules).toEqual({ drawUntilPlayable: true, stackDraw: false, sevenZero: false })
    expect(pub.scores).toEqual({ p1: 100, p2: 50, p3: 0, p4: 0 })
  })
})
