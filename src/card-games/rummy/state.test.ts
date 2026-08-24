import { describe, expect, it } from 'vitest'
import { isRummyAction, RUMMY_HAND_SIZE, createRummyGame } from './state.ts'

// ---------------------------------------------------------------------------
// isRummyAction — the runtime guard at the PeerJS host boundary (App.tsx's
// Rummy onAction handler). A guest action arrives over the wire as `unknown`;
// the compile-time RummyAction union guarantees nothing about what a hostile
// or stale/buggy client actually sends. See docs/reviews/rummy-review.md
// Major #3.
// ---------------------------------------------------------------------------

describe('isRummyAction', () => {
  it('rejects null and undefined', () => {
    expect(isRummyAction(null)).toBe(false)
    expect(isRummyAction(undefined)).toBe(false)
  })

  it('rejects primitives', () => {
    expect(isRummyAction('DRAW_FROM_STOCK')).toBe(false)
    expect(isRummyAction(42)).toBe(false)
    expect(isRummyAction(true)).toBe(false)
  })

  it('rejects arrays', () => {
    expect(isRummyAction([])).toBe(false)
    expect(isRummyAction(['DRAW_FROM_STOCK'])).toBe(false)
  })

  it('rejects a plain object with no type field', () => {
    expect(isRummyAction({})).toBe(false)
    expect(isRummyAction({ cardId: 'x' })).toBe(false)
  })

  it('rejects a type field that is not a string', () => {
    expect(isRummyAction({ type: 1 })).toBe(false)
    expect(isRummyAction({ type: null })).toBe(false)
    expect(isRummyAction({ type: {} })).toBe(false)
  })

  it('rejects an unrecognized type string', () => {
    expect(isRummyAction({ type: 'NOT_A_REAL_ACTION' })).toBe(false)
  })

  it('accepts every real RummyAction shape by its type discriminant', () => {
    expect(isRummyAction({ type: 'DRAW_FROM_STOCK' })).toBe(true)
    expect(isRummyAction({ type: 'DRAW_FROM_DISCARD', index: 0 })).toBe(true)
    expect(isRummyAction({ type: 'LAY_DOWN_MELD', cardIds: [] })).toBe(true)
    expect(isRummyAction({ type: 'LAY_OFF', targetPlayerId: 'p1', meldIndex: 0, cardIds: [] })).toBe(true)
    expect(isRummyAction({ type: 'DISCARD_CARD', cardId: 'x' })).toBe(true)
    expect(isRummyAction({ type: 'START_NEXT_ROUND' })).toBe(true)
  })

  it('accepts extra/malformed fields alongside a valid type — field-level shape is the validator’s job, not this guard’s', () => {
    expect(isRummyAction({ type: 'DISCARD_CARD', cardId: 123 })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// RUMMY_HAND_SIZE — must stay in sync with the deal (state.ts's dealRound),
// since App.tsx's deal-intro bot-hold pacing computes its flight count from
// seatOrder.length * RUMMY_HAND_SIZE.
// ---------------------------------------------------------------------------

describe('RUMMY_HAND_SIZE', () => {
  it('matches the actual number of cards dealt to each seat', () => {
    const rummy = createRummyGame(['p1', 'p2', 'p3'], 1)
    for (const playerId of ['p1', 'p2', 'p3']) {
      expect(rummy.session.privateStates[playerId].hand.cards.length).toBe(RUMMY_HAND_SIZE)
    }
  })
})
