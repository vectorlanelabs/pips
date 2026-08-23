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
import { unoBotStrategy } from './bot.ts'
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
  activeColor?: UnoColor
  discard?: UnoCard[]
  stock?: UnoCard[]
  hands?: Record<string, UnoCard[]>
  scores?: Record<string, number>
  houseRules?: Record<UnoHouseRuleKey, boolean>
  pendingStack?: UnoPublicState['pendingStack']
  unoWindow?: UnoPublicState['unoWindow']
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
    pendingStack: config.pendingStack ?? null,
    pendingSevenSwap: null,
    unoWindow: config.unoWindow ?? null,
    scores: config.scores ?? Object.fromEntries(players.map((p) => [p, 0])),
    roundResult: null,
    matchWinnerId: null,
    lastAction: null,
    houseRules: config.houseRules ?? { drawUntilPlayable: false, stackDraw: false, sevenZero: false },
  }
  return { session: createHostSession(publicState, privateStates), stock, rng: createRng(0) }
}

const NO_LEGAL = ['uno-30', 'uno-65', 'uno-78', 'uno-44']   // yellow 3, green 8, blue 2, yellow skip

// ── house rule defs ────────────────────────────────────────────

describe('stackDraw house rule def', () => {
  it('is defined in UNO_HOUSE_RULE_DEFS', () => {
    const stackDrawDef = UNO_HOUSE_RULE_DEFS.find((d) => d.key === 'stackDraw')
    expect(stackDrawDef).toBeDefined()
    expect(stackDrawDef).toEqual({
      key: 'stackDraw',
      label: 'Stack draw cards',
      description: "Play a Draw Two on a Draw Two (or a Wild Draw Four on a Wild Draw Four) to pass the penalty along instead of drawing — it keeps growing until someone can’t or won’t continue it.",
      default: false,
    })
  })

  it('defaults to false via resolveHouseRules()', () => {
    const resolved = resolveHouseRules()
    expect(resolved.stackDraw).toBe(false)
  })

  it('can be overridden to true', () => {
    const resolved = resolveHouseRules({ stackDraw: true })
    expect(resolved.stackDraw).toBe(true)
  })
})

// ── createUnoGame ──────────────────────────────────────────────

describe('createUnoGame with stackDraw', () => {
  it('initializes pendingStack to null', () => {
    const uno = createUnoGame(['p1', 'p2'], 42, { stackDraw: false })
    expect(uno.session.publicState.pendingStack).toBe(null)
  })

  it('can create a game with stackDraw on', () => {
    const uno = createUnoGame(['p1', 'p2'], 42, { stackDraw: true })
    expect(uno.session.publicState.houseRules.stackDraw).toBe(true)
    expect(uno.session.publicState.pendingStack).toBe(null)
  })
})

// ── Regression: rule OFF ───────────────────────────────────────

describe('PLAY_CARD draw2 with stackDraw OFF (regression)', () => {
  it('behaves byte-identical to before: immediate draw-2, skipNext', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: false },
      hands: { p1: cards('uno-23', 'uno-30'), p2: [], p3: [], p4: [] },   // p1 has red draw2 + yellow 3
      discard: cards('uno-9'),   // red 5
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-23' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.pendingStack).toBe(null)
    expect(pub.lastAction?.drewCount).toBe(2)
    expect(currentPlayer(pub.turn)).toBe('p3')   // skipped p2
    expect(pub.handCounts.p2).toBe(2)   // p2 drew 2
  })
})

describe('CHOOSE_COLOR wild4 with stackDraw OFF (regression)', () => {
  it('behaves byte-identical to before: immediate draw-4, skipNext', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: false },
      hands: { p1: cards('uno-105', 'uno-30'), p2: [], p3: [], p4: [] },   // p1 has wild4 + yellow 3
      discard: cards('uno-9'),
    })
    let r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-105' })
    expect(r.outcome.ok).toBe(true)
    expect(r.uno.session.publicState.pendingWild?.isDraw4).toBe(true)

    r = applyUnoAction(r.uno, 'p1', { type: 'CHOOSE_COLOR', color: 'blue' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.pendingStack).toBe(null)
    expect(pub.lastAction?.drewCount).toBe(4)
    expect(currentPlayer(pub.turn)).toBe('p3')   // skipped p2
    expect(pub.handCounts.p2).toBe(4)   // p2 drew 4
  })
})

// ── Rule ON: opening a draw2 stack ─────────────────────────────

describe('PLAY_CARD draw2 with stackDraw ON (opening)', () => {
  it('opens a stack instead of drawing: pendingStack set, turn advances normally', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: true, sevenZero: false },
      hands: { p1: cards('uno-23', 'uno-30'), p2: [], p3: [], p4: [] },   // p1 has red draw2 + yellow 3
      discard: cards('uno-9'),   // red 5
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-23' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.pendingStack).toEqual({ kind: 'draw2', total: 2 })
    expect(currentPlayer(pub.turn)).toBe('p2')   // NOT skipped, normal advance
    expect(pub.handCounts.p2).toBe(0)   // p2 hasn't drawn yet
    expect(pub.stockCount).toBe(3)   // stock unchanged
    expect(pub.hasDrawnThisTurn).toBe(false)
  })
})

// ── Rule ON: continuing a draw2 stack ──────────────────────────

describe('PLAY_CARD draw2 while pendingStack active (continuing)', () => {
  it('increments the total and advances normally', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: true, sevenZero: false },
      hands: { p1: [], p2: cards('uno-23', 'uno-30'), p3: [], p4: [] },   // p2 has red draw2 + yellow 3
      discard: cards('uno-9'),
      currentIndex: 1,   // p2's turn
      pendingStack: { kind: 'draw2', total: 2 },
    })
    const r = applyUnoAction(uno, 'p2', { type: 'PLAY_CARD', cardId: 'uno-23' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.pendingStack).toEqual({ kind: 'draw2', total: 4 })
    expect(currentPlayer(pub.turn)).toBe('p3')
    expect(pub.handCounts.p2).toBe(1)   // p2 played 1, has 1 left
    expect(pub.handCounts.p3).toBe(0)   // p3 hasn't drawn yet
    expect(pub.stockCount).toBe(3)   // stock still unchanged
  })
})

// ── Rule ON: breaking a draw2 chain ────────────────────────────

describe('DRAW_CARD while pendingStack: draw2 chain (breaking)', () => {
  it('draws exactly the pending total, clears stack, advances turn', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: true, sevenZero: false },
      hands: { p1: [], p2: [], p3: cards(...NO_LEGAL), p4: [] },   // p3 has no legal play
      stock: cards('uno-38', 'uno-13', 'uno-63', 'uno-77'),
      discard: cards('uno-9'),
      currentIndex: 2,   // p3's turn
      pendingStack: { kind: 'draw2', total: 4 },
    })
    const r = applyUnoAction(uno, 'p3', { type: 'DRAW_CARD' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.pendingStack).toBe(null)
    expect(pub.handCounts.p3).toBe(4 + NO_LEGAL.length)   // drew 4 cards
    expect(pub.lastAction).toEqual({ by: 'p3', kind: 'draw', card: null, drewCount: 4 })
    expect(currentPlayer(pub.turn)).toBe('p4')   // turn advanced past p3
    expect(pub.hasDrawnThisTurn).toBe(false)
    expect(pub.stockCount).toBe(0)
  })
})

// ── Rule ON: PLAY_CARD rejects non-matching during stack ───────

describe('PLAY_CARD with pendingStack active (non-matching rejection)', () => {
  it('rejects a draw2 when wild4 stack is pending', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: true, sevenZero: false },
      hands: { p1: cards('uno-23'), p2: [], p3: [], p4: [] },   // p1 has red draw2
      discard: cards('uno-9'),
      pendingStack: { kind: 'wild4', total: 4 },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-23' })
    expect(r.outcome.ok).toBe(false)
    expect(r.outcome.reason).toBe('must stack a matching card or draw the pile')
  })

  it('rejects a color-matching number card when draw2 stack is pending', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: true, sevenZero: false },
      hands: { p1: cards('uno-10'), p2: [], p3: [], p4: [] },   // p1 has red 5
      discard: cards('uno-9'),   // red 5
      pendingStack: { kind: 'draw2', total: 2 },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-10' })
    expect(r.outcome.ok).toBe(false)
    expect(r.outcome.reason).toBe('must stack a matching card or draw the pile')
  })

  it('rejects a wild4 when draw2 stack is pending', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: true, sevenZero: false },
      hands: { p1: cards('uno-105'), p2: [], p3: [], p4: [] },
      discard: cards('uno-9'),
      pendingStack: { kind: 'draw2', total: 2 },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-105' })
    expect(r.outcome.ok).toBe(false)
    expect(r.outcome.reason).toBe('must stack a matching card or draw the pile')
  })
})

// ── Rule ON: wild4 stack end-to-end ────────────────────────────

describe('wild4 stack end-to-end with stackDraw ON', () => {
  it('opens with PLAY_CARD wild4 then CHOOSE_COLOR', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: true, sevenZero: false },
      hands: { p1: cards('uno-105', 'uno-30'), p2: [], p3: [], p4: [] },
      discard: cards('uno-9'),
    })
    let r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-105' })
    expect(r.outcome.ok).toBe(true)
    expect(r.uno.session.publicState.pendingWild?.isDraw4).toBe(true)
    expect(r.uno.session.publicState.pendingStack).toBe(null)   // not yet set

    r = applyUnoAction(r.uno, 'p1', { type: 'CHOOSE_COLOR', color: 'blue' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.pendingStack).toEqual({ kind: 'wild4', total: 4 })
    expect(pub.pendingWild).toBe(null)
    expect(currentPlayer(pub.turn)).toBe('p2')
  })

  it('continues with another wild4', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: true, sevenZero: false },
      hands: { p1: [], p2: cards('uno-105', 'uno-30'), p3: [], p4: [] },
      discard: cards('uno-9'),
      currentIndex: 1,
      pendingStack: { kind: 'wild4', total: 4 },
    })
    let r = applyUnoAction(uno, 'p2', { type: 'PLAY_CARD', cardId: 'uno-105' })
    expect(r.outcome.ok).toBe(true)
    expect(r.uno.session.publicState.pendingWild?.isDraw4).toBe(true)
    expect(r.uno.session.publicState.pendingStack).toEqual({ kind: 'wild4', total: 4 })   // not yet incremented

    r = applyUnoAction(r.uno, 'p2', { type: 'CHOOSE_COLOR', color: 'red' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.pendingStack).toEqual({ kind: 'wild4', total: 8 })
    expect(currentPlayer(pub.turn)).toBe('p3')
  })

  it('breaks with DRAW_CARD drawing exactly 8', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: true, sevenZero: false },
      hands: { p1: [], p2: [], p3: cards(...NO_LEGAL), p4: [] },
      stock: cards('uno-38', 'uno-13', 'uno-63', 'uno-77', 'uno-100', 'uno-11', 'uno-39', 'uno-64', 'uno-79'),
      discard: cards('uno-9'),
      currentIndex: 2,
      pendingStack: { kind: 'wild4', total: 8 },
    })
    const r = applyUnoAction(uno, 'p3', { type: 'DRAW_CARD' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.pendingStack).toBe(null)
    expect(pub.handCounts.p3).toBe(NO_LEGAL.length + 8)
    expect(pub.lastAction?.drewCount).toBe(8)
    expect(currentPlayer(pub.turn)).toBe('p4')
  })
})

// ── No mixing ──────────────────────────────────────────────────

describe('no mixing of stack families', () => {
  it('draw2 stack rejects wild4', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: true, sevenZero: false },
      hands: { p1: cards('uno-105'), p2: [], p3: [], p4: [] },
      discard: cards('uno-9'),
      pendingStack: { kind: 'draw2', total: 2 },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-105' })
    expect(r.outcome.ok).toBe(false)
    expect(r.outcome.reason).toBe('must stack a matching card or draw the pile')
  })

  it('wild4 stack rejects draw2', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: true, sevenZero: false },
      hands: { p1: cards('uno-23'), p2: [], p3: [], p4: [] },
      discard: cards('uno-9'),
      pendingStack: { kind: 'wild4', total: 4 },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-23' })
    expect(r.outcome.ok).toBe(false)
    expect(r.outcome.reason).toBe('must stack a matching card or draw the pile')
  })
})

// ── Going out mid-chain ───────────────────────────────────────

describe('going out mid-stack', () => {
  it('ends the round when a stacking card takes player to 0', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: true, sevenZero: false },
      hands: { p1: cards('uno-23'), p2: [], p3: [], p4: [] },
      discard: cards('uno-9'),
      pendingStack: { kind: 'draw2', total: 4 },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-23' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.stage).toBe('roundOver')
    expect(pub.pendingStack).toBe(null)
    expect(pub.roundResult?.outPlayerId).toBe('p1')
  })
})

// ── Blocked round ──────────────────────────────────────────────

describe('blocked round with pending stack', () => {
  it('triggers blockedRound when stock can\'t satisfy large pending total', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: true, sevenZero: false },
      hands: { p1: cards(...NO_LEGAL), p2: [], p3: [], p4: [] },
      stock: cards('uno-38'),   // only 1 card, but need 6
      discard: cards('uno-9'),
      pendingStack: { kind: 'draw2', total: 6 },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'DRAW_CARD' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.stage).toBe('roundOver')
    expect(pub.roundResult).toBe(null)
  })
})

// ── Uno-call window ────────────────────────────────────────────

describe('Uno-call window with stacking', () => {
  it('opens when a stacking play leaves player at 1 card', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: true, sevenZero: false },
      hands: { p1: cards('uno-23', 'uno-30'), p2: [], p3: [], p4: [] },   // p1 has draw2 + yellow 3; plays draw2, ends with 1
      discard: cards('uno-9'),
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-23' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.handCounts.p1).toBe(1)
    expect(pub.unoWindow).toEqual({ playerId: 'p1' })
  })

  it('does not open when DRAW_CARD accepting a large stack leaves player at > 1 card', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: true, sevenZero: false },
      hands: {
        p1: cards('uno-30'),   // 1 card initially; will draw 6 and end at 7 cards
        p2: [],
        p3: [],
        p4: [],
      },
      stock: cards('uno-38', 'uno-13', 'uno-63', 'uno-77', 'uno-100', 'uno-11'),
      discard: cards('uno-9'),
      pendingStack: { kind: 'draw2', total: 6 },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'DRAW_CARD' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.handCounts.p1).toBe(7)   // 1 + 6 = 7
    expect(pub.unoWindow).toBe(null)   // window opened only if final hand === 1
  })

  it('clears stale window from a different player when DRAW_CARD accepts the stack', () => {
    // Set up a state where there's a stale unoWindow from a previous player
    // (e.g., p2 played a card leaving them at 1 card), then p3 accepts a pending
    // stack draw. The stale window should be cleared (even though p3's draw will
    // increase their hand, not leave them at 1).
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: true, sevenZero: false },
      hands: {
        p1: [],
        p2: cards('uno-30'),   // p2 at 1 card (has stale window)
        p3: cards('uno-65'),   // p3 at 1 card; will draw 4 and end at 5
        p4: [],
      },
      stock: cards('uno-38', 'uno-13', 'uno-63', 'uno-77'),
      discard: cards('uno-9'),
      currentIndex: 2,   // p3's turn
      pendingStack: { kind: 'draw2', total: 4 },
      unoWindow: { playerId: 'p2' },   // stale window from p2
    })
    const r = applyUnoAction(uno, 'p3', { type: 'DRAW_CARD' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.handCounts.p3).toBe(5)   // 1 + 4 = 5
    expect(pub.unoWindow).toBe(null)   // stale window cleared, p3 doesn't get a new one since 5 != 1
  })
})

// ── pendingStack field initialization and reset ────────────────

describe('pendingStack field lifecycle', () => {
  it('is null in initial state', () => {
    const uno = createUnoGame(['p1', 'p2', 'p3'], 42, { stackDraw: true })
    expect(uno.session.publicState.pendingStack).toBe(null)
  })

  it('is reset to null on START_NEXT_ROUND', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: true, sevenZero: false },
      hands: { p1: [], p2: [], p3: [], p4: [] },
      stage: 'roundOver',
      pendingStack: null,   // should already be null, but assert it survives reset
    })
    const r = applyUnoAction(uno, 'p1', { type: 'START_NEXT_ROUND' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.stage).toBe('play')
    expect(pub.pendingStack).toBe(null)
  })
})

// ── Bot strategy with stacking (regression for pendingWild/pendingStack interplay) ────

describe('unoBotStrategy with stacking', () => {
  it('chooses color when continuing a wild4 stack (pendingWild + pendingStack both non-null)', () => {
    // This is the critical case that broke in round 1: a bot plays a wild4 to continue
    // a wild4 stack. At this point, pendingWild is set (color choice pending) but
    // pendingStack is also still set (we're in the middle of a stack). The bot must
    // return CHOOSE_COLOR to handle the color choice, not PLAY_CARD/DRAW_CARD.
    // The fix is that pendingWild is checked BEFORE pendingStack in bot.ts.
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: true, sevenZero: false },
      hands: {
        p1: [],
        p2: cards('uno-105', 'uno-30'),   // p2 has wild4 + yellow 3
        p3: [],
        p4: [],
      },
      discard: cards('uno-9'),
      currentIndex: 1,   // p2's turn
      pendingStack: { kind: 'wild4', total: 4 },   // continuing an existing stack
    })
    // p2 plays wild4 to continue the stack
    const playResult = applyUnoAction(uno, 'p2', { type: 'PLAY_CARD', cardId: 'uno-105' })
    expect(playResult.outcome.ok).toBe(true)
    expect(playResult.uno.session.publicState.pendingWild?.isDraw4).toBe(true)
    expect(playResult.uno.session.publicState.pendingStack?.kind).toBe('wild4')

    // Now the bot strategy is called while BOTH pendingWild and pendingStack are non-null
    const action = unoBotStrategy(
      playResult.uno.session.publicState,
      playResult.uno.session.privateStates['p2'],
      'p2',
    )
    // Must return CHOOSE_COLOR, not PLAY_CARD or DRAW_CARD
    expect(action.type).toBe('CHOOSE_COLOR')
    if (action.type === 'CHOOSE_COLOR') {
      expect(action.color).toBeDefined()
    }
  })

  it('plays a matching stack card when pendingStack is active (without pendingWild)', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: true, sevenZero: false },
      hands: {
        p1: [],
        p2: cards('uno-23', 'uno-30'),   // p2 has draw2 + yellow 3
        p3: [],
        p4: [],
      },
      discard: cards('uno-9'),
      currentIndex: 1,   // p2's turn
      pendingStack: { kind: 'draw2', total: 4 },
    })
    const action = unoBotStrategy(
      uno.session.publicState,
      uno.session.privateStates['p2'],
      'p2',
    )
    // Bot should play the matching draw2
    expect(action.type).toBe('PLAY_CARD')
    if (action.type === 'PLAY_CARD') {
      expect(action.cardId).toBe('uno-23')
    }
  })

  it('draws the pile when no matching stack card available', () => {
    const uno = buildGame({
      houseRules: { drawUntilPlayable: false, stackDraw: true, sevenZero: false },
      hands: {
        p1: [],
        p2: cards('uno-30', 'uno-65'),   // p2 has yellow 3 and green 8 (no draw2)
        p3: [],
        p4: [],
      },
      discard: cards('uno-9'),
      currentIndex: 1,   // p2's turn
      pendingStack: { kind: 'draw2', total: 4 },
    })
    const action = unoBotStrategy(
      uno.session.publicState,
      uno.session.privateStates['p2'],
      'p2',
    )
    // Bot should draw the pile
    expect(action.type).toBe('DRAW_CARD')
  })
})
