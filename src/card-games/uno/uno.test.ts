import { describe, expect, it } from 'vitest'
import { createUnoDeck, type UnoCard, type UnoColor } from './deck.ts'
import {
  UNO_HAND_SIZE,
  UNO_MAX_SEATS,
  UNO_MIN_SEATS,
  UNO_TARGET,
  createUnoGame,
  dealUnoRound,
  flipStarter,
  handHasLegalPlay,
  isUnoPlayable,
  unoCardPoints,
  type UnoAction,
  type UnoLastAction,
  type UnoPrivateState,
  type UnoPublicState,
  type UnoRoundResult,
  type UnoSession,
} from './state.ts'
import { applyUnoAction, runUnoBotTurn } from './rules.ts'
import { unoBotStrategy } from './bot.ts'
import { assertWireSafe, createHostSession, deriveSnapshot, isJsonSerializable } from '../../engine/sync.ts'
import { advanceTurn, createTurnState, currentPlayer } from '../../engine/turn-engine.ts'
import { createRng } from '../../engine/rng.ts'
import { addCards, cardCount, createDiscardPile, createHand, createPublicZone, topCard } from '../../card-engine/zones.ts'

// ── fixtures ────────────────────────────────────────────────────
// Uno deck id layout: red uno-0..24, yellow uno-25..49, green uno-50..74, blue uno-75..99
// (each color: 0, 1..9×2, skip×2, reverse×2, draw2×2), wild uno-100..103, wild4 uno-104..107.
const deckMap = new Map(createUnoDeck().map((c) => [c.id, c]))
const byId = (id: string): UnoCard => deckMap.get(id)!
const cards = (...ids: string[]): UnoCard[] => ids.map((id) => byId(id))

const PLAYERS = ['p1', 'p2', 'p3', 'p4']

// Hand-built session with a known board, hands, discard and stock (mexican-train-test style).
function buildGame(config: {
  players?: string[]
  stage?: UnoPublicState['stage']
  currentIndex?: number
  direction?: 1 | -1
  round?: number
  activeColor?: UnoColor
  discard?: UnoCard[]
  stock?: UnoCard[]
  hands?: Record<string, UnoCard[]>
  scores?: Record<string, number>
  hasDrawnThisTurn?: boolean
  pendingWild?: { cardId: string; isDraw4: boolean } | null
  roundResult?: UnoRoundResult | null
  matchWinnerId?: string | null
  lastAction?: UnoLastAction | null
} = {}): UnoSession {
  const players = config.players ?? PLAYERS
  const turn = createTurnState<'play'>(players, 'play')
  if (config.currentIndex != null) {
    (turn as { currentIndex: number }).currentIndex = config.currentIndex
  }
  if (config.direction != null) {
    (turn as { direction: 1 | -1 }).direction = config.direction
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
    round: config.round ?? 0,
    activeColor: config.activeColor ?? 'red',
    discardPile,
    stockCount: stock.cards.length,
    handCounts,
    hasDrawnThisTurn: config.hasDrawnThisTurn ?? false,
    pendingWild: config.pendingWild ?? null,
    pendingStack: null,
    pendingSevenSwap: null,
    unoWindow: null,
    scores: config.scores ?? Object.fromEntries(players.map((p) => [p, 0])),
    roundResult: config.roundResult ?? null,
    matchWinnerId: config.matchWinnerId ?? null,
    lastAction: config.lastAction ?? null,
    houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: false },
  }
  return { session: createHostSession(publicState, privateStates), stock, rng: createRng(0) }
}

// ── malformed action defense-in-depth ──────────────────────────
// App.tsx's onAction guards with isUnoAction (see state.test.ts) before ever reaching here —
// this documents that applyUnoAction itself never throws on an unrecognized action.type; it
// rejects cleanly, in case that boundary is ever bypassed (e.g. host-local dispatch).

describe('applyUnoAction with a malformed action', () => {
  it('rejects an unrecognized type, does not throw, and leaves state untouched', () => {
    const uno = buildGame({ hands: { p1: cards('uno-10'), p2: [], p3: [], p4: [] } })
    const before = uno.session.revision
    expect(() => applyUnoAction(uno, 'p1', { type: 'NOT_A_REAL_ACTION' } as unknown as UnoAction)).not.toThrow()
    const result = applyUnoAction(uno, 'p1', { type: 'NOT_A_REAL_ACTION' } as unknown as UnoAction)
    expect(result.outcome.ok).toBe(false)
    expect(result.uno.session.revision).toBe(before)
  })
})

// ── deal ────────────────────────────────────────────────────────

describe('deal', () => {
  it('deals 7 to each of 2 players with a number starter and the right stock remainder', () => {
    const uno = createUnoGame(['p1', 'p2'], 42)
    const pub = uno.session.publicState
    expect(pub.handCounts).toEqual({ p1: 7, p2: 7 })
    for (const p of ['p1', 'p2']) expect(uno.session.privateStates[p].hand.cards).toHaveLength(7)
    expect(pub.discardPile.cards).toHaveLength(1)
    expect(pub.discardPile.cards[0].kind).toBe('number')
    expect(pub.activeColor).toBe(pub.discardPile.cards[0].color)
    expect(pub.stockCount).toBe(108 - 14 - 1)
    expect(uno.stock.cards).toHaveLength(108 - 14 - 1)
    expect(currentPlayer(pub.turn)).toBe('p1')
    expect(pub.stage).toBe('play')
    expect(pub.round).toBe(0)
    expect(pub.scores).toEqual({ p1: 0, p2: 0 })
  })

  it('deals 7 to each of 3, 5 and 6 players with the correct stock remainder', () => {
    for (const n of [3, 5, 6]) {
      const players = Array.from({ length: n }, (_, i) => `p${i + 1}`)
      const uno = createUnoGame(players, 42)
      const pub = uno.session.publicState
      for (const p of players) {
        expect(pub.handCounts[p]).toBe(7)
        expect(uno.session.privateStates[p].hand.cards).toHaveLength(7)
      }
      expect(pub.discardPile.cards).toHaveLength(1)
      expect(pub.discardPile.cards[0].kind).toBe('number')
      expect(pub.stockCount).toBe(108 - 7 * n - 1)
      expect(uno.stock.cards).toHaveLength(108 - 7 * n - 1)
    }
  })

  it('is deterministic per seed and differs across seeds', () => {
    const a = createUnoGame(['p1', 'p2', 'p3'], 42)
    const b = createUnoGame(['p1', 'p2', 'p3'], 42)
    const c = createUnoGame(['p1', 'p2', 'p3'], 43)
    const handIds = (g: UnoSession) => g.session.privateStates.p1.hand.cards.map((x) => x.id)
    expect(handIds(b)).toEqual(handIds(a))
    expect(handIds(c)).not.toEqual(handIds(a))
  })

  it('conserves all 108 unique cards across hands, discard and stock', () => {
    const uno = createUnoGame(PLAYERS, 42)
    const all = [
      ...uno.session.privateStates.p1.hand.cards,
      ...uno.session.privateStates.p2.hand.cards,
      ...uno.session.privateStates.p3.hand.cards,
      ...uno.session.privateStates.p4.hand.cards,
      ...uno.session.publicState.discardPile.cards,
      ...uno.stock.cards,
    ]
    expect(all).toHaveLength(108)
    expect(new Set(all.map((c) => c.id)).size).toBe(108)
  })

  it('exposes the seat bounds and constants', () => {
    expect(UNO_MIN_SEATS).toBe(2)
    expect(UNO_MAX_SEATS).toBe(6)
    expect(UNO_HAND_SIZE).toBe(7)
    expect(UNO_TARGET).toBe(500)
  })

  it('dealUnoRound flips a number starter and leaves the right remainder', () => {
    const deal = dealUnoRound(['p1', 'p2', 'p3'], createRng(5))
    expect(deal.discardPile.cards).toHaveLength(1)
    expect(deal.discardPile.cards[0].kind).toBe('number')
    expect(deal.activeColor).toBe(deal.discardPile.cards[0].color)
    expect(deal.stock.cards).toHaveLength(108 - 21 - 1)
    expect(deal.hands.p1.cards).toHaveLength(7)
  })
})

describe('flipStarter', () => {
  it('reshuffles the whole pool and retries when the flipped card is not a number', () => {
    let calls = 0
    const rng = () => { calls++; return 0 }
    // top is uno-100 (wild) — the flip must reject it, reshuffle, and land on a number
    const { starter, stock } = flipStarter(cards('uno-0', 'uno-1', 'uno-100'), rng)
    expect(starter.kind).toBe('number')
    expect(starter.id).toBe('uno-0')
    expect(stock.map((c) => c.id).sort()).toEqual(['uno-1', 'uno-100'])
    expect(calls).toBeGreaterThan(0)   // a reshuffle/retry provably happened
  })

  it('does not reshuffle when the flipped card is already a number', () => {
    const rng = () => { throw new Error('rng must not be called') }
    const { starter, stock } = flipStarter(cards('uno-100', 'uno-0'), rng)
    expect(starter.id).toBe('uno-0')
    expect(stock.map((c) => c.id)).toEqual(['uno-100'])
  })
})

// ── isUnoPlayable ───────────────────────────────────────────────

describe('isUnoPlayable', () => {
  const top = byId('uno-9')   // red 5
  const active: UnoColor = 'red'

  it('same color is always playable, whatever the kind or number', () => {
    expect(isUnoPlayable(byId('uno-10'), top, active)).toBe(true)   // red 5
    expect(isUnoPlayable(byId('uno-13'), top, active)).toBe(true)   // red 7
    expect(isUnoPlayable(byId('uno-19'), top, active)).toBe(true)   // red skip
    expect(isUnoPlayable(byId('uno-21'), top, active)).toBe(true)   // red reverse
    expect(isUnoPlayable(byId('uno-23'), top, active)).toBe(true)   // red draw2
  })

  it('same number on a different color is playable', () => {
    expect(isUnoPlayable(byId('uno-34'), top, active)).toBe(true)   // yellow 5
    expect(isUnoPlayable(byId('uno-59'), top, active)).toBe(true)   // green 5
    expect(isUnoPlayable(byId('uno-84'), top, active)).toBe(true)   // blue 5
  })

  it('same action kind on a different color is playable regardless of color', () => {
    expect(isUnoPlayable(byId('uno-44'), byId('uno-19'), 'blue')).toBe(true)   // yellow skip on red skip
    expect(isUnoPlayable(byId('uno-46'), byId('uno-21'), 'blue')).toBe(true)   // yellow reverse on red reverse
    expect(isUnoPlayable(byId('uno-48'), byId('uno-23'), 'blue')).toBe(true)   // yellow draw2 on red draw2
  })

  it('wild and wild4 are always playable', () => {
    expect(isUnoPlayable(byId('uno-100'), top, active)).toBe(true)
    expect(isUnoPlayable(byId('uno-104'), top, active)).toBe(true)
    expect(isUnoPlayable(byId('uno-100'), byId('uno-104'), 'green')).toBe(true)
  })

  it('rejects mismatched color, kind and number', () => {
    expect(isUnoPlayable(byId('uno-30'), top, active)).toBe(false)            // yellow 3 vs red 5
    expect(isUnoPlayable(byId('uno-44'), top, 'blue')).toBe(false)            // yellow skip vs red 5
    expect(isUnoPlayable(byId('uno-46'), byId('uno-19'), 'blue')).toBe(false) // yellow reverse vs red skip
    expect(isUnoPlayable(byId('uno-1'), byId('uno-9'), 'blue')).toBe(false)   // red 1 vs red 5
    expect(isUnoPlayable(byId('uno-1'), byId('uno-100'), 'blue')).toBe(false) // red 1 vs wild top, active blue
  })

  it('handHasLegalPlay follows the same rules', () => {
    expect(handHasLegalPlay(cards('uno-30', 'uno-65'), top, active)).toBe(false)
    expect(handHasLegalPlay(cards('uno-30', 'uno-10'), top, active)).toBe(true)
    expect(handHasLegalPlay(cards('uno-30', 'uno-100'), top, active)).toBe(true)
    expect(handHasLegalPlay([], top, active)).toBe(false)
  })
})

describe('unoCardPoints', () => {
  it('numbers score face value, action cards 20, wilds 50', () => {
    expect(unoCardPoints(byId('uno-0'))).toBe(0)
    expect(unoCardPoints(byId('uno-9'))).toBe(5)
    expect(unoCardPoints(byId('uno-19'))).toBe(20)   // skip
    expect(unoCardPoints(byId('uno-21'))).toBe(20)   // reverse
    expect(unoCardPoints(byId('uno-23'))).toBe(20)   // draw2
    expect(unoCardPoints(byId('uno-100'))).toBe(50)  // wild
    expect(unoCardPoints(byId('uno-104'))).toBe(50)  // wild4
  })
})

// ── PLAY_CARD ───────────────────────────────────────────────────

describe('PLAY_CARD', () => {
  it('rejects an out-of-turn play', () => {
    const uno = buildGame({ currentIndex: 1, hands: { p1: cards('uno-10'), p2: [], p3: [], p4: [] } })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-10' })
    expect(r.outcome.ok).toBe(false)
    expect(r.outcome.reason).toContain('not your turn')
  })

  it('rejects a card not in hand', () => {
    const uno = buildGame({ hands: { p1: cards('uno-10'), p2: [], p3: [], p4: [] } })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-30' })
    expect(r.outcome.ok).toBe(false)
    expect(r.outcome.reason).toContain('card not in hand')
  })

  it('rejects a card that is not legal against the top', () => {
    const uno = buildGame({ hands: { p1: cards('uno-30', 'uno-10'), p2: [], p3: [], p4: [] } })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-30' })
    expect(r.outcome.ok).toBe(false)
    expect(r.outcome.reason).toContain('not playable')
  })

  it('a legal number card updates activeColor and advances the turn', () => {
    const uno = buildGame({ hands: { p1: cards('uno-34', 'uno-10'), p2: [], p3: [], p4: [] } })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-34' })   // yellow 5 on red 5
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.activeColor).toBe('yellow')
    expect(topCard(pub.discardPile)!.id).toBe('uno-34')
    expect(currentPlayer(pub.turn)).toBe('p2')
    expect(pub.hasDrawnThisTurn).toBe(false)
    expect(pub.lastAction).toEqual({ by: 'p1', kind: 'play', card: { color: 'yellow', kind: 'number', value: 5 }, drewCount: 0 })
  })
})

// ── skip ────────────────────────────────────────────────────────

describe('skip', () => {
  it('skips exactly one player and lands past them — not back on the player', () => {
    const uno = buildGame({ hands: { p1: cards('uno-19', 'uno-10'), p2: [], p3: [], p4: [] } })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-19' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.activeColor).toBe('red')
    expect(currentPlayer(pub.turn)).toBe('p3')   // seat 2: p2 (seat 1) is the one skipped
    expect(currentPlayer(pub.turn)).not.toBe('p1')
    expect(currentPlayer(pub.turn)).not.toBe('p2')
    expect(pub.turn.direction).toBe(1)
    expect(pub.turn.turnNumber).toBe(2)
    expect(pub.handCounts.p1).toBe(1)
  })
})

// ── reverse ─────────────────────────────────────────────────────

describe('reverse', () => {
  it('flips direction and advances (does not skip) for N≥3', () => {
    const uno = buildGame({
      players: ['p1', 'p2', 'p3'],
      hands: { p1: cards('uno-21', 'uno-10'), p2: [], p3: [] },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-21' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.turn.direction).toBe(-1)
    expect(currentPlayer(pub.turn)).toBe('p3')
    // explicit before/after turn-order check: the next advance goes BACKWARD to p2
    const after = advanceTurn(pub.turn, 'play')
    expect(currentPlayer(after)).toBe('p2')
    expect(after.direction).toBe(-1)
  })

  it('acts as a skip for N=2', () => {
    const uno = buildGame({ players: ['p1', 'p2'], hands: { p1: cards('uno-21', 'uno-10'), p2: [] } })
    const before = uno.session.publicState.turn
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-21' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(currentPlayer(pub.turn)).toBe('p1')   // skip in 2 players lands back on the same player
    expect(pub.turn.direction).toBe(1)
    expect(pub.turn.turnNumber).toBe(before.turnNumber + 1)
  })
})

// ── draw2 ───────────────────────────────────────────────────────

describe('draw2', () => {
  it('gives the next player 2 cards and skips past them', () => {
    const uno = buildGame({
      hands: { p1: cards('uno-23', 'uno-10'), p2: [], p3: [], p4: [] },
      stock: cards('uno-11', 'uno-12', 'uno-13'),
    })
    const stockBefore = cardCount(uno.stock)
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-23' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.handCounts.p2).toBe(2)
    expect(pub.handCounts.p1).toBe(1)
    expect(currentPlayer(pub.turn)).toBe('p3')   // p2 drew and was skipped past
    expect(pub.stockCount).toBe(stockBefore - 2)
    expect(r.uno.stock.cards).toHaveLength(stockBefore - 2)
    expect(pub.activeColor).toBe('red')
    expect(pub.lastAction).toEqual({ by: 'p1', kind: 'play', card: { color: 'red', kind: 'draw2', value: null }, drewCount: 2 })
  })
})

// ── wild ────────────────────────────────────────────────────────

describe('wild', () => {
  it('sets pendingWild and does not advance the turn', () => {
    const uno = buildGame({ hands: { p1: cards('uno-100', 'uno-10'), p2: [], p3: [], p4: [] } })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-100' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.pendingWild).toEqual({ cardId: 'uno-100', isDraw4: false })
    expect(currentPlayer(pub.turn)).toBe('p1')
    expect(pub.lastAction?.drewCount).toBe(0)
  })

  it('rejects PLAY_CARD, DRAW_CARD and PASS while a wild is pending', () => {
    const uno = buildGame({ hands: { p1: cards('uno-100', 'uno-10'), p2: [], p3: [], p4: [] } })
    const played = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-100' })
    expect(played.outcome.ok).toBe(true)
    const g = played.uno
    expect(applyUnoAction(g, 'p1', { type: 'PLAY_CARD', cardId: 'uno-10' }).outcome.ok).toBe(false)
    expect(applyUnoAction(g, 'p1', { type: 'DRAW_CARD' }).outcome.ok).toBe(false)
    expect(applyUnoAction(g, 'p1', { type: 'PASS' }).outcome.ok).toBe(false)
  })

  it('rejects CHOOSE_COLOR from a non-current player', () => {
    const uno = buildGame({ hands: { p1: cards('uno-100', 'uno-10'), p2: [], p3: [], p4: [] } })
    const played = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-100' })
    expect(played.outcome.ok).toBe(true)
    const r = applyUnoAction(played.uno, 'p2', { type: 'CHOOSE_COLOR', color: 'blue' })
    expect(r.outcome.ok).toBe(false)
    expect(r.outcome.reason).toContain('not your turn')
  })

  it('CHOOSE_COLOR sets activeColor, clears pendingWild and advances with no draw', () => {
    const uno = buildGame({
      hands: { p1: cards('uno-100', 'uno-10'), p2: [], p3: [], p4: [] },
      stock: cards('uno-13', 'uno-38', 'uno-63'),
    })
    const played = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-100' })
    const stockBefore = cardCount(played.uno.stock)
    const p2Before = played.uno.session.publicState.handCounts.p2
    const r = applyUnoAction(played.uno, 'p1', { type: 'CHOOSE_COLOR', color: 'green' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.activeColor).toBe('green')
    expect(pub.pendingWild).toBeNull()
    expect(currentPlayer(pub.turn)).toBe('p2')
    expect(pub.hasDrawnThisTurn).toBe(false)
    expect(pub.stockCount).toBe(stockBefore)
    expect(pub.handCounts.p2).toBe(p2Before)
    expect(pub.lastAction).toEqual({ by: 'p1', kind: 'play', card: { color: 'wild', kind: 'wild', value: null }, drewCount: 0 })
  })

  // Defense-in-depth for the PeerJS host boundary (App.tsx's onAction guards with isUnoAction,
  // but that guard only checks the envelope shape — it does not know CHOOSE_COLOR.color must be
  // one of the four canonical UNO colors). A malformed or hostile guest can still send a
  // syntactically valid CHOOSE_COLOR action with an out-of-domain color; the rules validator
  // itself must reject it before activeColor is ever assigned, so canonical state can't be
  // poisoned with a value no colored card can ever match.
  it.each([
    ['an out-of-domain color string', 'purple'],
    ['an empty string', ''],
    ['null', null],
    ['a missing color field', undefined],
  ])('rejects CHOOSE_COLOR with %s, leaving state and stock unchanged', (_label, color) => {
    const uno = buildGame({
      hands: { p1: cards('uno-100', 'uno-10'), p2: [], p3: [], p4: [] },
      stock: cards('uno-13', 'uno-38', 'uno-63'),
    })
    const played = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-100' })
    expect(played.outcome.ok).toBe(true)
    const before = played.uno.session.publicState
    const stockBefore = cardCount(played.uno.stock)
    const action = color === undefined
      ? ({ type: 'CHOOSE_COLOR' } as unknown as UnoAction)
      : ({ type: 'CHOOSE_COLOR', color } as unknown as UnoAction)
    const r = applyUnoAction(played.uno, 'p1', action)
    expect(r.outcome.ok).toBe(false)
    expect(r.outcome.reason).toBe('not a valid color')
    const after = r.uno.session.publicState
    expect(after.activeColor).toBe(before.activeColor)
    expect(after.pendingWild).toEqual(before.pendingWild)
    expect(cardCount(r.uno.stock)).toBe(stockBefore)
    expect(r.uno.session.revision).toBe(played.uno.session.revision)
  })
})

// ── wild4 ───────────────────────────────────────────────────────

describe('wild4', () => {
  it('sets pendingWild with isDraw4 and does not advance the turn', () => {
    const uno = buildGame({ hands: { p1: cards('uno-104', 'uno-10'), p2: [], p3: [], p4: [] } })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-104' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.pendingWild).toEqual({ cardId: 'uno-104', isDraw4: true })
    expect(currentPlayer(pub.turn)).toBe('p1')
  })

  it('CHOOSE_COLOR triggers a 4-card draw and a skip past the drawer', () => {
    const uno = buildGame({
      hands: { p1: cards('uno-104', 'uno-10'), p2: [], p3: [], p4: [] },
      stock: cards('uno-11', 'uno-12', 'uno-13', 'uno-14', 'uno-15'),
    })
    const stockBefore = cardCount(uno.stock)
    const played = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-104' })
    expect(played.outcome.ok).toBe(true)
    const r = applyUnoAction(played.uno, 'p1', { type: 'CHOOSE_COLOR', color: 'blue' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.activeColor).toBe('blue')
    expect(pub.pendingWild).toBeNull()
    expect(pub.handCounts.p2).toBe(4)
    expect(currentPlayer(pub.turn)).toBe('p3')   // p2 drew 4 and was skipped past
    expect(pub.stockCount).toBe(stockBefore - 4)
    expect(r.uno.stock.cards).toHaveLength(stockBefore - 4)
    expect(pub.lastAction).toEqual({ by: 'p1', kind: 'play', card: { color: 'wild', kind: 'wild4', value: null }, drewCount: 4 })
  })

  // Same runtime enum guard as the plain-wild path above, exercised for the isDraw4 branch
  // separately since it's a distinct code path in rules.ts (the draw/skip logic sits AFTER
  // the color check, so a malformed color must never reach it).
  it.each([
    ['an out-of-domain color string', 'purple'],
    ['null', null],
  ])('rejects CHOOSE_COLOR with %s on a pending wild4, leaving state and stock unchanged', (_label, color) => {
    const uno = buildGame({
      hands: { p1: cards('uno-104', 'uno-10'), p2: [], p3: [], p4: [] },
      stock: cards('uno-11', 'uno-12', 'uno-13', 'uno-14', 'uno-15'),
    })
    const stockBefore = cardCount(uno.stock)
    const played = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-104' })
    expect(played.outcome.ok).toBe(true)
    const before = played.uno.session.publicState
    const r = applyUnoAction(played.uno, 'p1', { type: 'CHOOSE_COLOR', color } as unknown as UnoAction)
    expect(r.outcome.ok).toBe(false)
    expect(r.outcome.reason).toBe('not a valid color')
    const after = r.uno.session.publicState
    expect(after.activeColor).toBe(before.activeColor)
    expect(after.pendingWild).toEqual(before.pendingWild)
    expect(after.handCounts).toEqual(before.handCounts)
    expect(cardCount(r.uno.stock)).toBe(stockBefore)   // PLAY_CARD moves hand->discard only; stock untouched either way
    expect(r.uno.session.revision).toBe(played.uno.session.revision)
  })
})

// ── going out ───────────────────────────────────────────────────

describe('going out', () => {
  const OTHERS = { p2: cards('uno-1', 'uno-2'), p3: cards('uno-100'), p4: cards('uno-23') }
  // p2 = 2 points, p3 = 50, p4 = 20 → out-player gains 72

  function goOutGame(p1CardId: string): UnoSession {
    return buildGame({
      discard: cards('uno-5'),   // red 3
      hands: { p1: cards(p1CardId), ...OTHERS },
    })
  }

  function expectRoundEnded(pub: UnoPublicState) {
    expect(pub.stage).toBe('roundOver')
    expect(pub.roundResult).toEqual({
      outPlayerId: 'p1',
      pointsAdded: { p1: 0, p2: 2, p3: 50, p4: 20 },
    })
    expect(pub.scores.p1).toBe(72)
    expect(pub.scores.p2).toBe(0)
    expect(pub.scores.p3).toBe(0)
    expect(pub.scores.p4).toBe(0)
    expect(pub.handCounts.p1).toBe(0)
  }

  it('going out on a plain number ends the round immediately', () => {
    const uno = goOutGame('uno-9')   // red 5, legal on red 3
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-9' })
    expect(r.outcome.ok).toBe(true)
    expectRoundEnded(r.uno.session.publicState)
  })

  it('going out on a skip applies no skip', () => {
    const uno = goOutGame('uno-19')
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-19' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expectRoundEnded(pub)
    expect(pub.handCounts.p2).toBe(2)   // no one else's hand changed
  })

  it('going out on a reverse leaves the direction untouched', () => {
    const uno = goOutGame('uno-21')
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-21' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expectRoundEnded(pub)
    expect(pub.turn.direction).toBe(1)
  })

  it('going out on a draw2 draws nothing', () => {
    const uno = goOutGame('uno-23')
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-23' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expectRoundEnded(pub)
    expect(pub.handCounts.p2).toBe(2)
    expect(pub.stockCount).toBe(3)   // default stock untouched
  })

  it('going out on a wild sets no pendingWild', () => {
    const uno = goOutGame('uno-100')
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-100' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expectRoundEnded(pub)
    expect(pub.pendingWild).toBeNull()
  })

  it('going out on a wild4 draws nothing and sets no pendingWild', () => {
    const uno = goOutGame('uno-104')
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-104' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expectRoundEnded(pub)
    expect(pub.pendingWild).toBeNull()
    expect(pub.handCounts.p2).toBe(2)
    expect(pub.stockCount).toBe(3)
  })
})

// ── scoring and match end ───────────────────────────────────────

describe('scoring and match end', () => {
  it('only the out-player score moves, by the exact sum of every other hand', () => {
    const uno = buildGame({
      discard: cards('uno-5'),
      scores: { p1: 10, p2: 7, p3: 3, p4: 1 },
      hands: { p1: cards('uno-9'), p2: cards('uno-1', 'uno-2'), p3: cards('uno-100'), p4: cards('uno-23') },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-9' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.scores).toEqual({ p1: 82, p2: 7, p3: 3, p4: 1 })   // 10 + (2 + 50 + 20)
  })

  it('match ends exactly at UNO_TARGET: stage over with the right winner', () => {
    const uno = buildGame({
      discard: cards('uno-5'),
      scores: { p1: 490, p2: 0, p3: 0, p4: 0 },
      hands: { p1: cards('uno-9'), p2: cards('uno-10'), p3: cards('uno-7'), p4: cards('uno-1') },
    })   // 5 + 4 + 1 = 10 → 490 + 10 = 500 exactly
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-9' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.stage).toBe('over')
    expect(pub.matchWinnerId).toBe('p1')
    expect(pub.scores.p1).toBe(500)
    expect(pub.scores.p2).toBe(0)
  })

  it('stays roundOver just under the target', () => {
    const uno = buildGame({
      discard: cards('uno-5'),
      scores: { p1: 490, p2: 0, p3: 0, p4: 0 },
      hands: { p1: cards('uno-9'), p2: cards('uno-7'), p3: cards('uno-8'), p4: cards('uno-1') },
    })   // 4 + 4 + 1 = 9 → 499 < 500
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-9' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.stage).toBe('roundOver')
    expect(pub.matchWinnerId).toBeNull()
    expect(pub.scores.p1).toBe(499)
  })
})

// ── START_NEXT_ROUND ────────────────────────────────────────────

describe('START_NEXT_ROUND', () => {
  it('is rejected while the round is in play', () => {
    const uno = buildGame()
    const r = applyUnoAction(uno, 'p1', { type: 'START_NEXT_ROUND' })
    expect(r.outcome.ok).toBe(false)
    expect(r.outcome.reason).toContain('round is not over')
  })

  it('is rejected once the match is over', () => {
    const uno = buildGame({ stage: 'over', matchWinnerId: 'p1' })
    const r = applyUnoAction(uno, 'p1', { type: 'START_NEXT_ROUND' })
    expect(r.outcome.ok).toBe(false)
  })

  it('is rejected for a non-player', () => {
    const uno = buildGame({ stage: 'roundOver' })
    const r = applyUnoAction(uno, 'ghost', { type: 'START_NEXT_ROUND' })
    expect(r.outcome.ok).toBe(false)
    expect(r.outcome.reason).toContain('not a player')
  })

  it('any seated player can trigger it', () => {
    const uno = buildGame({ stage: 'roundOver', round: 0 })
    const r = applyUnoAction(uno, 'p3', { type: 'START_NEXT_ROUND' })
    expect(r.outcome.ok).toBe(true)
  })

  it('rotates the starter by one seat each round for N=3', () => {
    const players = ['p1', 'p2', 'p3']
    const cases: [number, string][] = [[0, 'p2'], [1, 'p3'], [2, 'p1']]
    for (const [round, expectedStarter] of cases) {
      const uno = buildGame({ players, stage: 'roundOver', round })
      const r = applyUnoAction(uno, 'p1', { type: 'START_NEXT_ROUND' })
      expect(r.outcome.ok).toBe(true)
      const pub = r.uno.session.publicState
      expect(pub.round).toBe(round + 1)
      expect(currentPlayer(pub.turn)).toBe(expectedStarter)
    }
  })

  it('deals fresh and resets all transient state, preserving scores', () => {
    const uno = buildGame({
      stage: 'roundOver',
      round: 0,
      scores: { p1: 120, p2: 40, p3: 60, p4: 10 },
      pendingWild: { cardId: 'uno-100', isDraw4: false },
      hasDrawnThisTurn: true,
      roundResult: { outPlayerId: 'p1', pointsAdded: { p1: 0, p2: 2, p3: 50, p4: 20 } },
      lastAction: { by: 'p1', kind: 'play', card: { color: 'red', kind: 'number', value: 5 }, drewCount: 0 },
      hands: { p1: cards('uno-1'), p2: cards('uno-2'), p3: cards('uno-3'), p4: cards('uno-4') },
    })
    const r = applyUnoAction(uno, 'p2', { type: 'START_NEXT_ROUND' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.stage).toBe('play')
    expect(pub.round).toBe(1)
    expect(pub.pendingWild).toBeNull()
    expect(pub.hasDrawnThisTurn).toBe(false)
    expect(pub.lastAction).toBeNull()
    expect(pub.roundResult).toBeNull()
    expect(pub.scores).toEqual({ p1: 120, p2: 40, p3: 60, p4: 10 })
    expect(pub.handCounts).toEqual({ p1: 7, p2: 7, p3: 7, p4: 7 })
    expect(pub.discardPile.cards).toHaveLength(1)
    expect(pub.discardPile.cards[0].kind).toBe('number')
    expect(pub.stockCount).toBe(108 - 28 - 1)
    expect(cardCount(r.uno.stock)).toBe(108 - 28 - 1)
    expect(currentPlayer(pub.turn)).toBe('p2')
    for (const p of PLAYERS) expect(r.uno.session.privateStates[p].hand.cards).toHaveLength(7)
  })
})

// ── DRAW_CARD ───────────────────────────────────────────────────

describe('DRAW_CARD', () => {
  // yellow 3, green 8, blue 2, yellow skip — nothing matches a red top with activeColor red
  const NO_LEGAL = ['uno-30', 'uno-65', 'uno-78', 'uno-44']

  it('is rejected when a legal play exists', () => {
    const uno = buildGame({ hands: { p1: cards('uno-10', ...NO_LEGAL), p2: [], p3: [], p4: [] } })
    const r = applyUnoAction(uno, 'p1', { type: 'DRAW_CARD' })
    expect(r.outcome.ok).toBe(false)
    expect(r.outcome.reason).toContain('legal play')
  })

  it('is rejected a second time in the same turn', () => {
    const uno = buildGame({
      hands: { p1: cards(...NO_LEGAL), p2: [], p3: [], p4: [] },
      stock: cards('uno-38', 'uno-13'),   // top = red 7, playable
    })
    const first = applyUnoAction(uno, 'p1', { type: 'DRAW_CARD' })
    expect(first.outcome.ok).toBe(true)
    expect(currentPlayer(first.uno.session.publicState.turn)).toBe('p1')
    expect(first.uno.session.publicState.handCounts.p1).toBe(5)
    const second = applyUnoAction(first.uno, 'p1', { type: 'DRAW_CARD' })
    expect(second.outcome.ok).toBe(false)
    expect(second.outcome.reason).toContain('already drawn')
  })

  it('an unplayable draw auto-advances the turn with no further action possible', () => {
    const uno = buildGame({ hands: { p1: cards(...NO_LEGAL), p2: [], p3: [], p4: [] } })
    // default stock top is uno-63 (green 7) — unplayable against red 5 / activeColor red
    const r = applyUnoAction(uno, 'p1', { type: 'DRAW_CARD' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(currentPlayer(pub.turn)).toBe('p2')
    expect(pub.hasDrawnThisTurn).toBe(false)
    expect(pub.handCounts.p1).toBe(5)
    expect(applyUnoAction(r.uno, 'p1', { type: 'PASS' }).outcome.ok).toBe(false)
    expect(applyUnoAction(r.uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-63' }).outcome.ok).toBe(false)
  })

  it('a playable draw keeps the turn, and PASS then ends it', () => {
    const uno = buildGame({
      hands: { p1: cards(...NO_LEGAL), p2: [], p3: [], p4: [] },
      stock: cards('uno-38', 'uno-13'),   // top = red 7, playable
    })
    const r = applyUnoAction(uno, 'p1', { type: 'DRAW_CARD' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(currentPlayer(pub.turn)).toBe('p1')
    expect(pub.hasDrawnThisTurn).toBe(true)
    expect(pub.lastAction).toEqual({ by: 'p1', kind: 'draw', card: null, drewCount: 1 })
    const pass = applyUnoAction(r.uno, 'p1', { type: 'PASS' })
    expect(pass.outcome.ok).toBe(true)
    const after = pass.uno.session.publicState
    expect(currentPlayer(after.turn)).toBe('p2')
    expect(after.hasDrawnThisTurn).toBe(false)
    expect(after.lastAction).toEqual({ by: 'p1', kind: 'pass', card: null, drewCount: 0 })
  })

  it('PASS is rejected before any draw this turn', () => {
    const uno = buildGame({ hands: { p1: cards(...NO_LEGAL), p2: [], p3: [], p4: [] } })
    const r = applyUnoAction(uno, 'p1', { type: 'PASS' })
    expect(r.outcome.ok).toBe(false)
    expect(r.outcome.reason).toContain('draw first')
  })
})

// ── stock exhaustion / recycling ────────────────────────────────

describe('stock exhaustion', () => {
  const NO_LEGAL = ['uno-30', 'uno-65', 'uno-78', 'uno-44']

  it('recycles the discard pile when the stock runs out, preserving the top', () => {
    const uno = buildGame({
      hands: { p1: cards(...NO_LEGAL), p2: [], p3: [], p4: [] },
      discard: cards('uno-75', 'uno-25', 'uno-0'),   // top = red 0
      stock: [],
    })
    const r = applyUnoAction(uno, 'p1', { type: 'DRAW_CARD' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.discardPile.cards).toHaveLength(1)
    expect(pub.discardPile.cards[0].id).toBe('uno-0')   // top preserved
    expect(pub.stockCount).toBe(1)                       // 2 recycled − 1 drawn
    expect(cardCount(r.uno.stock)).toBe(1)
    expect(pub.handCounts.p1).toBe(5)
  })

  it('draw2 recycles mid-draw when the stock runs out', () => {
    const uno = buildGame({
      hands: { p1: cards('uno-23', 'uno-10'), p2: [], p3: [], p4: [] },
      discard: cards('uno-75', 'uno-25', 'uno-0'),   // top = red 0
      stock: cards('uno-11'),                        // only 1 card left in stock
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-23' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.handCounts.p2).toBe(2)
    // 1 in stock, then p1's draw2 tops the discard so the recycle moves 3 cards, then 1 drawn → 2 left
    expect(pub.stockCount).toBe(2)
    expect(cardCount(r.uno.stock)).toBe(2)
    expect(pub.discardPile.cards).toHaveLength(1)
    expect(pub.discardPile.cards[0].id).toBe('uno-23')
    expect(currentPlayer(pub.turn)).toBe('p3')
  })

  it('a draw that cannot be satisfied blocks the round with no score change', () => {
    const uno = buildGame({
      hands: { p1: cards(...NO_LEGAL), p2: [], p3: [], p4: [] },
      discard: cards('uno-0'),   // just the top — nothing to recycle
      stock: [],
      scores: { p1: 10, p2: 20, p3: 30, p4: 40 },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'DRAW_CARD' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.stage).toBe('roundOver')
    expect(pub.roundResult).toBeNull()
    expect(pub.scores).toEqual({ p1: 10, p2: 20, p3: 30, p4: 40 })
    expect(pub.stockCount).toBe(0)
  })
})

// ── no leak and wire safety ─────────────────────────────────────

describe('no leak and wire safety', () => {
  it('a snapshot exposes only its own hand; no other hands or stock ids in public state', () => {
    const uno = buildGame({
      hands: {
        p1: cards('uno-10', 'uno-19'),
        p2: cards('uno-30', 'uno-31'),
        p3: cards('uno-50', 'uno-51'),
        p4: cards('uno-75', 'uno-76'),
      },
      stock: cards('uno-1', 'uno-2'),
    })
    const played = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-10' })
    expect(played.outcome.ok).toBe(true)
    const snap = deriveSnapshot(played.uno.session, 'p1')
    expect(snap.privateState?.hand.cards.map((c) => c.id)).toEqual(['uno-19'])
    const privateIds = new Set(
      cards('uno-19', 'uno-30', 'uno-31', 'uno-50', 'uno-51', 'uno-75', 'uno-76', 'uno-1', 'uno-2').map((c) => c.id),
    )
    const json = JSON.stringify(snap.publicState)
    // quoted ids: "uno-1" must not appear as its own token — "uno-10" legitimately can
    for (const id of privateIds) expect(json).not.toContain(`"${id}"`)
    expect(isJsonSerializable(snap)).toBe(true)
  })

  it('public and private state survive assertWireSafe and a lossless JSON round-trip', () => {
    let uno = buildGame({
      hands: { p1: cards('uno-34', 'uno-10'), p2: cards('uno-65'), p3: [], p4: [] },
      stock: cards('uno-1', 'uno-2', 'uno-3'),
    })
    let r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-34' })
    expect(r.outcome.ok).toBe(true)
    uno = r.uno
    r = applyUnoAction(uno, 'p2', { type: 'DRAW_CARD' })
    expect(r.outcome.ok).toBe(true)
    uno = r.uno
    const pub = uno.session.publicState
    const priv = uno.session.privateStates.p1
    const snap = deriveSnapshot(uno.session, 'p1')
    expect(() => assertWireSafe(pub, 'test')).not.toThrow()
    expect(() => assertWireSafe(priv, 'test')).not.toThrow()
    expect(() => assertWireSafe(snap, 'test')).not.toThrow()
    expect(JSON.parse(JSON.stringify(pub))).toEqual(pub)
    expect(JSON.parse(JSON.stringify(priv))).toEqual(priv)
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap)
  })
})

// ── bot ─────────────────────────────────────────────────────────

describe('bot', () => {
  it('prefers an action card over an equally-legal plain number', () => {
    const uno = buildGame({ hands: { p1: cards('uno-19', 'uno-10'), p2: [], p3: [], p4: [] } })
    const action = unoBotStrategy(uno.session.publicState, uno.session.privateStates.p1, 'p1')
    expect(action).toEqual({ type: 'PLAY_CARD', cardId: 'uno-19' })
  })

  it('prefers a non-wild legal card over reaching for a wild', () => {
    const uno = buildGame({ hands: { p1: cards('uno-10', 'uno-100'), p2: [], p3: [], p4: [] } })
    const action = unoBotStrategy(uno.session.publicState, uno.session.privateStates.p1, 'p1')
    expect(action).toEqual({ type: 'PLAY_CARD', cardId: 'uno-10' })
  })

  it('when forced to play a wild, chooses the color it holds most of', () => {
    const uno = buildGame({
      discard: cards('uno-80'),   // blue 3
      activeColor: 'blue',
      hands: { p1: cards('uno-100', 'uno-1', 'uno-2'), p2: [], p3: [], p4: [] },   // two red 1s
    })
    const action = unoBotStrategy(uno.session.publicState, uno.session.privateStates.p1, 'p1')
    expect(action).toEqual({ type: 'PLAY_CARD', cardId: 'uno-100' })
    const played = applyUnoAction(uno, 'p1', action)
    expect(played.outcome.ok).toBe(true)
    const color = unoBotStrategy(played.uno.session.publicState, played.uno.session.privateStates.p1, 'p1')
    expect(color).toEqual({ type: 'CHOOSE_COLOR', color: 'red' })
    const chosen = applyUnoAction(played.uno, 'p1', color)
    expect(chosen.outcome.ok).toBe(true)
    expect(chosen.uno.session.publicState.activeColor).toBe('red')
  })

  it('breaks color-count ties by color order red/yellow/green/blue', () => {
    const uno = buildGame({
      discard: cards('uno-38'),   // yellow 7
      activeColor: 'yellow',
      hands: { p1: cards('uno-100', 'uno-10', 'uno-80'), p2: [], p3: [], p4: [] },   // red 5 + blue 3
    })
    const played = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-100' })
    expect(played.outcome.ok).toBe(true)
    const color = unoBotStrategy(played.uno.session.publicState, played.uno.session.privateStates.p1, 'p1')
    expect(color).toEqual({ type: 'CHOOSE_COLOR', color: 'red' })
  })

  it('draws when no legal play exists', () => {
    const uno = buildGame({ hands: { p1: cards('uno-30', 'uno-65', 'uno-78', 'uno-44'), p2: [], p3: [], p4: [] } })
    const action = unoBotStrategy(uno.session.publicState, uno.session.privateStates.p1, 'p1')
    expect(action).toEqual({ type: 'DRAW_CARD' })
  })

  it('plays a drawn card immediately when it turns out legal', () => {
    const uno = buildGame({
      hands: { p1: cards('uno-30', 'uno-65', 'uno-78', 'uno-44'), p2: [], p3: [], p4: [] },
      stock: cards('uno-38', 'uno-13'),   // top = red 7, playable
    })
    const first = runUnoBotTurn(uno, 'p1', unoBotStrategy)
    expect(first.outcome.ok).toBe(true)
    expect(currentPlayer(first.uno.session.publicState.turn)).toBe('p1')
    expect(first.uno.session.publicState.handCounts.p1).toBe(5)
    const second = runUnoBotTurn(first.uno, 'p1', unoBotStrategy)
    expect(second.outcome.ok).toBe(true)
    const pub = second.uno.session.publicState
    expect(pub.handCounts.p1).toBe(4)
    expect(pub.lastAction?.kind).toBe('play')
    expect(topCard(pub.discardPile)!.id).toBe('uno-13')
  })

  it('passes (defensively) when it has drawn and nothing is playable', () => {
    const uno = buildGame({
      hands: { p1: cards('uno-30', 'uno-65', 'uno-78', 'uno-44'), p2: [], p3: [], p4: [] },
      hasDrawnThisTurn: true,
    })
    const action = unoBotStrategy(uno.session.publicState, uno.session.privateStates.p1, 'p1')
    expect(action).toEqual({ type: 'PASS' })
  })

  it('a full bot match runs rounds to completion and reaches a match winner', () => {
    let uno = createUnoGame(['p1', 'p2', 'p3'], 7)
    let actions = 0
    while (uno.session.publicState.matchWinnerId === null && actions < 20000) {
      const pub = uno.session.publicState
      if (pub.stage === 'roundOver') {
        const r = applyUnoAction(uno, 'p1', { type: 'START_NEXT_ROUND' })
        expect(r.outcome.ok).toBe(true)
        uno = r.uno
        actions++
        continue
      }
      const player = currentPlayer(pub.turn)
      const r = runUnoBotTurn(uno, player, unoBotStrategy)
      expect(r.outcome.ok).toBe(true)
      uno = r.uno
      actions++
    }
    expect(uno.session.publicState.stage).toBe('over')
    expect(uno.session.publicState.matchWinnerId).not.toBeNull()
    expect(actions).toBeLessThan(20000)
  })
})

// ── property-based invariants ───────────────────────────────────

describe('property-based invariants', () => {
  // Explicit timeout: 50 trials x up to 300 actions each, with conservation/serialization/
  // host-zone checks after every action, comfortably exceeds Vitest's default 5000ms budget
  // (measured ~6s locally) without the workload itself being slow or reducible without losing
  // seat-count/trial coverage — see docs/reviews/uno-review.md Major #1.
  it('stock, conservation, handCounts and wire-safety invariants hold across long random legal sequences', () => {
    for (let trial = 0; trial < 50; trial++) {
      const n = 2 + (trial % 5)   // cycles 2..6 so every seat count gets covered
      const players = Array.from({ length: n }, (_, i) => `p${i}`)
      let uno = createUnoGame(players, trial)
      for (let actionIndex = 0; actionIndex < 300; actionIndex++) {
        const pub = uno.session.publicState
        if (pub.stage === 'over') break
        // Every seat is a bot; when a round ends the bot strategy has no move for it, so any
        // seated player legally starts the next round (same pattern as the full-bot-match test).
        const r =
          pub.stage === 'roundOver'
            ? applyUnoAction(uno, players[0], { type: 'START_NEXT_ROUND' })
            : runUnoBotTurn(uno, currentPlayer(pub.turn), unoBotStrategy)
        expect(
          r.outcome.ok,
          `trial ${trial} action ${actionIndex} rejected: ${r.outcome.reason ?? '(no reason)'}`,
        ).toBe(true)
        uno = r.uno
        const after = uno.session.publicState
        // 1. the public stockCount never drifts from the real host-side stock
        expect(after.stockCount).toBe(cardCount(uno.stock))
        // 2. all 108 cards are always conserved across every hand + stock + discard
        const totalCards =
          players.reduce((sum, p) => sum + cardCount(uno.session.privateStates[p].hand), 0) +
          cardCount(uno.stock) +
          cardCount(after.discardPile)
        expect(totalCards).toBe(108)
        // 3. handCounts never drift from the real private hands
        for (const p of players) {
          expect(after.handCounts[p]).toBe(cardCount(uno.session.privateStates[p].hand))
        }
        // 4. public state always survives the wire
        expect(isJsonSerializable(after)).toBe(true)
      }
    }
  }, 30000)
})
