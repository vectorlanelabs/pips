import { describe, expect, it } from 'vitest'
import { createUnoDeck, type UnoCard } from './deck.ts'
import {
  type UnoPrivateState,
  type UnoPublicState,
  type UnoSession,
} from './state.ts'
import { applyUnoAction } from './rules.ts'
import { createHostSession, isJsonSerializable } from '../../engine/sync.ts'
import { createTurnState, currentPlayer } from '../../engine/turn-engine.ts'
import { createRng } from '../../engine/rng.ts'
import { addCards, cardCount, createDiscardPile, createHand, createPublicZone } from '../../card-engine/zones.ts'

// ── fixtures ────────────────────────────────────────────────────
// Same pattern as uno.test.ts: hand-built session with a known board, hands, discard and
// stock, plus a configurable unoWindow. (Helpers in uno.test.ts can't be imported from a
// .test.ts file, so the minimal fixture is duplicated here.)
const deckMap = new Map(createUnoDeck().map((c) => [c.id, c]))
const byId = (id: string): UnoCard => deckMap.get(id)!
const cards = (...ids: string[]): UnoCard[] => ids.map((id) => byId(id))

const PLAYERS = ['p1', 'p2', 'p3', 'p4']

function buildGame(config: {
  players?: string[]
  stage?: UnoPublicState['stage']
  currentIndex?: number
  discard?: UnoCard[]
  stock?: UnoCard[]
  hands?: Record<string, UnoCard[]>
  scores?: Record<string, number>
  hasDrawnThisTurn?: boolean
  unoWindow?: { playerId: string } | null
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
    activeColor: 'red',
    discardPile,
    stockCount: stock.cards.length,
    handCounts,
    hasDrawnThisTurn: config.hasDrawnThisTurn ?? false,
    pendingWild: null,
    pendingStack: null,
    pendingSevenSwap: null,
    unoWindow: config.unoWindow ?? null,
    scores: config.scores ?? Object.fromEntries(players.map((p) => [p, 0])),
    roundResult: null,
    matchWinnerId: null,
    lastAction: null,
    houseRules: { drawUntilPlayable: false, stackDraw: false, sevenZero: false },
  }
  return { session: createHostSession(publicState, privateStates), stock, rng: createRng(0) }
}

// Uno deck id layout (same as uno.test.ts): red uno-0..24 (numbers 0, 1..9×2, skip×2,
// reverse×2, draw2×2), yellow uno-25..49, green uno-50..74, blue uno-75..99, wild
// uno-100..103, wild4 uno-104..107. Default discard is uno-9 (red 5), activeColor red.

// ── opening the window ──────────────────────────────────────────

describe('uno-call window opens', () => {
  it('a number play down to exactly 1 card opens the window for the player who just moved', () => {
    const uno = buildGame({ hands: { p1: cards('uno-10', 'uno-30'), p2: [], p3: [], p4: [] } })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-10' })   // red 5, keeps yellow 3
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.unoWindow).toEqual({ playerId: 'p1' })
    expect(pub.handCounts.p1).toBe(1)
    expect(currentPlayer(pub.turn)).toBe('p2')
  })

  it('a skip play down to exactly 1 card opens the window (skip still lands past p2)', () => {
    const uno = buildGame({ hands: { p1: cards('uno-19', 'uno-30'), p2: [], p3: [], p4: [] } })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-19' })   // red skip
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.unoWindow).toEqual({ playerId: 'p1' })
    expect(currentPlayer(pub.turn)).toBe('p3')
  })

  it('a reverse play down to exactly 1 card opens the window (N≥3, direction flipped)', () => {
    const uno = buildGame({
      players: ['p1', 'p2', 'p3'],
      hands: { p1: cards('uno-21', 'uno-30'), p2: [], p3: [] },
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-21' })   // red reverse
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.unoWindow).toEqual({ playerId: 'p1' })
    expect(pub.turn.direction).toBe(-1)
    expect(currentPlayer(pub.turn)).toBe('p3')
  })

  it('a draw2 play down to exactly 1 card opens the window for the ACTOR, not the drawer', () => {
    const uno = buildGame({
      hands: { p1: cards('uno-23', 'uno-30'), p2: [], p3: [], p4: [] },
      stock: cards('uno-11', 'uno-12'),
    })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-23' })   // red draw2
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.unoWindow).toEqual({ playerId: 'p1' })   // p1 is at 1 card
    expect(pub.handCounts.p1).toBe(1)
    expect(pub.handCounts.p2).toBe(2)                   // drawer grew to 2 — no window for p2
    expect(currentPlayer(pub.turn)).toBe('p3')
  })

  it('CHOOSE_COLOR after a plain wild down to 1 card opens the window', () => {
    const uno = buildGame({ hands: { p1: cards('uno-100', 'uno-30'), p2: [], p3: [], p4: [] } })
    const played = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-100' })
    expect(played.outcome.ok).toBe(true)
    expect(played.uno.session.publicState.unoWindow).toBeNull()   // the wild PLAY itself is not turn-ending
    const r = applyUnoAction(played.uno, 'p1', { type: 'CHOOSE_COLOR', color: 'blue' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.unoWindow).toEqual({ playerId: 'p1' })
    expect(pub.handCounts.p1).toBe(1)
    expect(currentPlayer(pub.turn)).toBe('p2')
  })

  it('CHOOSE_COLOR after a wild4 down to 1 card opens the window for the ACTOR, drawer +4 untouched', () => {
    const uno = buildGame({
      hands: { p1: cards('uno-104', 'uno-30'), p2: [], p3: [], p4: [] },
      stock: cards('uno-11', 'uno-12', 'uno-13', 'uno-14', 'uno-15'),
    })
    const played = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-104' })
    expect(played.outcome.ok).toBe(true)
    expect(played.uno.session.publicState.unoWindow).toBeNull()
    const r = applyUnoAction(played.uno, 'p1', { type: 'CHOOSE_COLOR', color: 'blue' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.unoWindow).toEqual({ playerId: 'p1' })   // actor at 1
    expect(pub.handCounts.p1).toBe(1)
    expect(pub.handCounts.p2).toBe(4)                   // drawer's 0→4 opens nothing retroactively
    expect(currentPlayer(pub.turn)).toBe('p3')
  })
})

// ── not opening / destroying ────────────────────────────────────

describe('uno-call window closes or never opens', () => {
  it('going out (playing down to 0) does NOT open a window — the round is over', () => {
    const uno = buildGame({ discard: cards('uno-5'), hands: { p1: cards('uno-9'), p2: [], p3: [], p4: [] } })
    const r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-9' })   // red 5 on red 3
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.stage).toBe('roundOver')
    expect(pub.unoWindow).toBeNull()
  })

  it('a play leaving 2+ cards opens nothing and clears a window open for a DIFFERENT player', () => {
    // Window open for p1; p2 (a different player) takes their turn and ends with 3 cards.
    const uno = buildGame({
      currentIndex: 1,
      unoWindow: { playerId: 'p1' },
      hands: { p1: [], p2: cards('uno-10', 'uno-11', 'uno-12', 'uno-13'), p3: [], p4: [] },
    })
    const r = applyUnoAction(uno, 'p2', { type: 'PLAY_CARD', cardId: 'uno-10' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.unoWindow).toBeNull()   // not still p1's
    expect(pub.handCounts.p2).toBe(3)
  })

  it('the next player\'s first PLAY_CARD destroys the prior window before its own effects apply', () => {
    const uno = buildGame({
      currentIndex: 1,
      unoWindow: { playerId: 'p1' },
      hands: { p1: [], p2: cards('uno-19', 'uno-11', 'uno-12'), p3: [], p4: [] },
    })
    const r = applyUnoAction(uno, 'p2', { type: 'PLAY_CARD', cardId: 'uno-19' })   // red skip
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.unoWindow).toBeNull()                  // p1's window died uncalled
    expect(currentPlayer(pub.turn)).toBe('p4')        // the skip still did its job
    expect(pub.handCounts.p2).toBe(2)                 // p2 ends at 2 — nothing new opens
  })

  it('the next player\'s first DRAW_CARD destroys the prior window (playable draw keeps the turn)', () => {
    const uno = buildGame({
      currentIndex: 1,
      unoWindow: { playerId: 'p1' },
      hands: { p1: [], p2: cards('uno-30', 'uno-65', 'uno-78', 'uno-44'), p3: [], p4: [] },   // no legal play vs red 5
      stock: cards('uno-38', 'uno-13'),   // top = red 7 — playable draw
    })
    const r = applyUnoAction(uno, 'p2', { type: 'DRAW_CARD' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.unoWindow).toBeNull()                  // cleared by p2's first action
    expect(pub.handCounts.p2).toBe(5)
    expect(currentPlayer(pub.turn)).toBe('p2')        // playable draw keeps the turn with p2
  })

  it('the next player\'s first PASS destroys the prior window and opens nothing itself', () => {
    const uno = buildGame({
      currentIndex: 1,
      unoWindow: { playerId: 'p1' },
      hasDrawnThisTurn: true,
      hands: { p1: [], p2: cards('uno-10', 'uno-11'), p3: [], p4: [] },
    })
    const r = applyUnoAction(uno, 'p2', { type: 'PASS' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.unoWindow).toBeNull()                  // cleared
    expect(currentPlayer(pub.turn)).toBe('p3')        // PASS advanced the turn normally
    expect(pub.handCounts.p2).toBe(2)                 // passing at 2+ opens nothing
  })

  it('an unplayable auto-advance draw clears a prior window and ends at 2+ cards (no window)', () => {
    const uno = buildGame({
      currentIndex: 1,
      unoWindow: { playerId: 'p1' },
      hands: { p1: [], p2: cards('uno-30', 'uno-65', 'uno-78', 'uno-44'), p3: [], p4: [] },
    })
    // default stock top is uno-63 (green 7) — unplayable against red 5
    const r = applyUnoAction(uno, 'p2', { type: 'DRAW_CARD' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.unoWindow).toBeNull()                  // p1's stale window cleared
    expect(pub.handCounts.p2).toBe(5)                 // 4→5, ends at ≥2: no new window
    expect(currentPlayer(pub.turn)).toBe('p3')
  })
})

// ── CALL_UNO ────────────────────────────────────────────────────

describe('CALL_UNO', () => {
  it('a self-call clears the window with no card penalty and no hand change', () => {
    const uno = buildGame({
      currentIndex: 1,                  // p2 is current; vulnerable p1 calls out of band
      unoWindow: { playerId: 'p1' },
      hands: { p1: cards('uno-30'), p2: [], p3: [], p4: [] },
      stock: cards('uno-11', 'uno-12'),
    })
    const stockBefore = cardCount(uno.stock)
    const r = applyUnoAction(uno, 'p1', { type: 'CALL_UNO', targetPlayerId: 'p1' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.unoWindow).toBeNull()
    expect(pub.handCounts.p1).toBe(1)                  // still 1 — no draw
    expect(pub.stockCount).toBe(stockBefore)           // stock untouched
    expect(currentPlayer(pub.turn)).toBe('p2')         // turn exactly where it was
  })

  it('a catch makes the TARGET draw 2 from the real stock, clears the window, and never moves the turn', () => {
    const uno = buildGame({
      currentIndex: 1,
      unoWindow: { playerId: 'p1' },
      hands: { p1: cards('uno-30'), p2: [], p3: [], p4: [] },
      stock: cards('uno-11', 'uno-12', 'uno-13'),
    })
    const stockBefore = cardCount(uno.stock)
    const r = applyUnoAction(uno, 'p2', { type: 'CALL_UNO', targetPlayerId: 'p1' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.unoWindow).toBeNull()
    expect(pub.handCounts.p1).toBe(3)                  // 1 → 3
    expect(r.uno.session.privateStates.p1.hand.cards).toHaveLength(3)
    expect(pub.stockCount).toBe(stockBefore - 2)
    expect(r.uno.stock.cards).toHaveLength(stockBefore - 2)
    expect(pub.discardPile.cards.map((c) => c.id)).toEqual(['uno-9'])   // no recycle happened
    expect(currentPlayer(pub.turn)).toBe('p2')         // current player keeps the turn
    expect(pub.handCounts.p2).toBe(0)                  // the CALLER never draws
  })

  it('is not gated by whose turn it is — any seated player can catch', () => {
    const uno = buildGame({
      currentIndex: 1,                  // p2 is current
      unoWindow: { playerId: 'p1' },
      hands: { p1: cards('uno-30'), p2: [], p3: [], p4: [] },
      stock: cards('uno-11', 'uno-12', 'uno-13'),
    })
    const r = applyUnoAction(uno, 'p3', { type: 'CALL_UNO', targetPlayerId: 'p1' })   // p3 is NOT current
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.unoWindow).toBeNull()
    expect(pub.handCounts.p1).toBe(3)
    expect(currentPlayer(pub.turn)).toBe('p2')         // p2's turn untouched
  })

  it('is rejected when no window is open at all', () => {
    const uno = buildGame({ hands: { p1: cards('uno-30'), p2: [], p3: [], p4: [] } })
    const r = applyUnoAction(uno, 'p1', { type: 'CALL_UNO', targetPlayerId: 'p1' })
    expect(r.outcome.ok).toBe(false)
    expect(r.outcome.reason).toContain('no uno window')
  })

  it('is rejected when targetPlayerId does not match the actually-open window\'s owner', () => {
    const uno = buildGame({
      unoWindow: { playerId: 'p1' },    // window is for p1…
      hands: { p1: cards('uno-30'), p2: [], p3: [], p4: [] },
    })
    const r = applyUnoAction(uno, 'p2', { type: 'CALL_UNO', targetPlayerId: 'p2' })   // …but p2 calls themselves
    expect(r.outcome.ok).toBe(false)
    expect(r.outcome.reason).toContain('that player')
  })

  it('is rejected from a non-seated playerId', () => {
    const uno = buildGame({
      unoWindow: { playerId: 'p1' },
      hands: { p1: cards('uno-30'), p2: [], p3: [], p4: [] },
    })
    const r = applyUnoAction(uno, 'ghost', { type: 'CALL_UNO', targetPlayerId: 'p1' })
    expect(r.outcome.ok).toBe(false)
    expect(r.outcome.reason).toContain('not a player')
  })

  it('a catch whose draw cannot be satisfied blocks the round with no score change', () => {
    const uno = buildGame({
      currentIndex: 1,
      unoWindow: { playerId: 'p1' },
      discard: cards('uno-0'),          // just the top — nothing to recycle
      stock: [],
      hands: { p1: cards('uno-30'), p2: [], p3: [], p4: [] },
      scores: { p1: 10, p2: 20, p3: 30, p4: 40 },
    })
    const r = applyUnoAction(uno, 'p2', { type: 'CALL_UNO', targetPlayerId: 'p1' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.stage).toBe('roundOver')
    expect(pub.roundResult).toBeNull()
    expect(pub.scores).toEqual({ p1: 10, p2: 20, p3: 30, p4: 40 })
    expect(pub.unoWindow).toBeNull()
  })

  it('a successful call consumes the window — a second call on the same window is rejected', () => {
    let uno = buildGame({
      currentIndex: 1,
      unoWindow: { playerId: 'p1' },
      hands: { p1: cards('uno-30'), p2: [], p3: [], p4: [] },
      stock: cards('uno-11', 'uno-12', 'uno-13'),
    })
    let r = applyUnoAction(uno, 'p2', { type: 'CALL_UNO', targetPlayerId: 'p1' })
    expect(r.outcome.ok).toBe(true)
    expect(r.uno.session.publicState.unoWindow).toBeNull()
    r = applyUnoAction(r.uno, 'p2', { type: 'CALL_UNO', targetPlayerId: 'p1' })
    expect(r.outcome.ok).toBe(false)
    expect(r.outcome.reason).toContain('no uno window')
  })
})

// ── lifecycle: fresh window each time ───────────────────────────

describe('uno-call window lifecycle', () => {
  it('a player ending at exactly 1 card across turns gets a FRESH window each time: open → null → open', () => {
    const uno = buildGame({
      players: ['p1', 'p2'],
      hands: {
        p1: cards('uno-10', 'uno-30'),   // red 5 + yellow 3 (yellow 3 is not playable vs red)
        p2: cards('uno-13', 'uno-14', 'uno-15'),
      },
      stock: cards('uno-11', 'uno-12'),  // top = red 6 — playable when p1 draws it later
    })
    // Turn 1 (p1): plays down to exactly 1 card → the window opens for p1.
    let r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-10' })
    expect(r.outcome.ok).toBe(true)
    expect(r.uno.session.publicState.unoWindow).toEqual({ playerId: 'p1' })
    expect(currentPlayer(r.uno.session.publicState.turn)).toBe('p2')
    // Turn 2 (p2): first action destroys the window uncalled; p2 ends at 2 cards, nothing reopens.
    r = applyUnoAction(r.uno, 'p2', { type: 'PLAY_CARD', cardId: 'uno-13' })
    expect(r.outcome.ok).toBe(true)
    expect(r.uno.session.publicState.unoWindow).toBeNull()
    expect(currentPlayer(r.uno.session.publicState.turn)).toBe('p1')
    // Turn 3 (p1): still at 1 card — draws a playable card back (1→2), then plays it (2→1).
    // The window provably went null in between and now reopens fresh, same playerId.
    r = applyUnoAction(r.uno, 'p1', { type: 'DRAW_CARD' })
    expect(r.outcome.ok).toBe(true)
    expect(r.uno.session.publicState.unoWindow).toBeNull()   // the draw itself never opens a window
    expect(r.uno.session.publicState.handCounts.p1).toBe(2)
    r = applyUnoAction(r.uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-12' })
    expect(r.outcome.ok).toBe(true)
    expect(r.uno.session.publicState.unoWindow).toEqual({ playerId: 'p1' })   // a NEW window
    expect(r.uno.session.publicState.handCounts.p1).toBe(1)
  })

  it('consecutive turn-endings at exactly 1 card keep at most ONE window — always the acting player\'s', () => {
    const uno = buildGame({
      hands: { p1: cards('uno-10', 'uno-30'), p2: cards('uno-13', 'uno-14'), p3: [], p4: [] },
    })
    let r = applyUnoAction(uno, 'p1', { type: 'PLAY_CARD', cardId: 'uno-10' })
    expect(r.outcome.ok).toBe(true)
    expect(r.uno.session.publicState.unoWindow).toEqual({ playerId: 'p1' })
    r = applyUnoAction(r.uno, 'p2', { type: 'PLAY_CARD', cardId: 'uno-13' })   // p2 also ends at 1
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.handCounts.p2).toBe(1)
    expect(pub.unoWindow).toEqual({ playerId: 'p2' })   // p1's window is gone — single fresh window
  })
})

// ── round-level invariants ──────────────────────────────────────

describe('uno-call round-level invariants', () => {
  it('going out always leaves unoWindow null — even with a stale window open for a different player', () => {
    const uno = buildGame({
      currentIndex: 1,                  // p2 goes out on their own turn
      unoWindow: { playerId: 'p1' },    // constructed stale window for someone else
      discard: cards('uno-5'),
      hands: { p1: [], p2: cards('uno-9'), p3: cards('uno-100'), p4: cards('uno-23') },
    })
    const r = applyUnoAction(uno, 'p2', { type: 'PLAY_CARD', cardId: 'uno-9' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.stage).toBe('roundOver')
    expect(pub.unoWindow).toBeNull()   // nothing survives into roundOver/over, full stop
  })

  it('START_NEXT_ROUND always deals into unoWindow null', () => {
    const uno = buildGame({
      stage: 'roundOver',
      unoWindow: { playerId: 'p1' },    // constructed stale window — must not survive the reset
      hands: { p1: cards('uno-1'), p2: cards('uno-2'), p3: cards('uno-3'), p4: cards('uno-4') },
    })
    const r = applyUnoAction(uno, 'p2', { type: 'START_NEXT_ROUND' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.uno.session.publicState
    expect(pub.stage).toBe('play')
    expect(pub.unoWindow).toBeNull()
  })
})

// ── wire safety ─────────────────────────────────────────────────

describe('uno-call wire safety', () => {
  it('the CALL_UNO action and the unoWindow field survive isJsonSerializable', () => {
    expect(isJsonSerializable({ type: 'CALL_UNO', targetPlayerId: 'p1' })).toBe(true)
    expect(isJsonSerializable({ playerId: 'p1' })).toBe(true)
    expect(isJsonSerializable(null)).toBe(true)
    const uno = buildGame({
      currentIndex: 1,
      unoWindow: { playerId: 'p1' },
      hands: { p1: cards('uno-30'), p2: [], p3: [], p4: [] },
      stock: cards('uno-11', 'uno-12', 'uno-13'),
    })
    const after = applyUnoAction(uno, 'p2', { type: 'CALL_UNO', targetPlayerId: 'p1' })
    expect(after.outcome.ok).toBe(true)
    expect(isJsonSerializable(after.uno.session.publicState)).toBe(true)
    expect(JSON.parse(JSON.stringify(after.uno.session.publicState))).toEqual(after.uno.session.publicState)
  })
})
