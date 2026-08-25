import { describe, expect, it } from 'vitest'
import { isUnoAction, isUnoColor } from './state.ts'

// ---------------------------------------------------------------------------
// isUnoAction — the runtime guard at the PeerJS host boundary (App.tsx's Uno
// onAction handler). A guest action arrives over the wire as `unknown`; the
// compile-time UnoAction union guarantees nothing about what a hostile or
// stale/buggy client actually sends. Mirrors Rummy's isRummyAction. See
// docs/reviews/uno-review.md Blocking #1.
// ---------------------------------------------------------------------------

describe('isUnoAction', () => {
  it('rejects null and undefined', () => {
    expect(isUnoAction(null)).toBe(false)
    expect(isUnoAction(undefined)).toBe(false)
  })

  it('rejects primitives', () => {
    expect(isUnoAction('DRAW_CARD')).toBe(false)
    expect(isUnoAction(42)).toBe(false)
    expect(isUnoAction(true)).toBe(false)
  })

  it('rejects arrays', () => {
    expect(isUnoAction([])).toBe(false)
    expect(isUnoAction(['DRAW_CARD'])).toBe(false)
  })

  it('rejects a plain object with no type field', () => {
    expect(isUnoAction({})).toBe(false)
    expect(isUnoAction({ cardId: 'x' })).toBe(false)
  })

  it('rejects a type field that is not a string', () => {
    expect(isUnoAction({ type: 1 })).toBe(false)
    expect(isUnoAction({ type: null })).toBe(false)
    expect(isUnoAction({ type: {} })).toBe(false)
  })

  it('rejects an unrecognized type string', () => {
    expect(isUnoAction({ type: 'NOT_A_REAL_ACTION' })).toBe(false)
  })

  it('accepts every real UnoAction shape by its type discriminant', () => {
    expect(isUnoAction({ type: 'PLAY_CARD', cardId: 'x' })).toBe(true)
    expect(isUnoAction({ type: 'CHOOSE_COLOR', color: 'red' })).toBe(true)
    expect(isUnoAction({ type: 'CHOOSE_SWAP_TARGET', targetPlayerId: 'p1' })).toBe(true)
    expect(isUnoAction({ type: 'DRAW_CARD' })).toBe(true)
    expect(isUnoAction({ type: 'PASS' })).toBe(true)
    expect(isUnoAction({ type: 'CALL_UNO', targetPlayerId: 'p1' })).toBe(true)
    expect(isUnoAction({ type: 'START_NEXT_ROUND' })).toBe(true)
  })

  it('accepts extra/malformed fields alongside a valid type — field-level shape (e.g. an out-of-domain color) is the rules validator’s job, not this envelope guard’s', () => {
    expect(isUnoAction({ type: 'CHOOSE_COLOR', color: 'purple' })).toBe(true)
    expect(isUnoAction({ type: 'CHOOSE_COLOR' })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// isUnoColor — the runtime enum guard used inside rules.ts's CHOOSE_COLOR
// handler, before activeColor is ever assigned. See docs/reviews/uno-review.md
// Blocking #1.
// ---------------------------------------------------------------------------

describe('isUnoColor', () => {
  it('accepts every canonical UNO color', () => {
    expect(isUnoColor('red')).toBe(true)
    expect(isUnoColor('yellow')).toBe(true)
    expect(isUnoColor('green')).toBe(true)
    expect(isUnoColor('blue')).toBe(true)
  })

  it('rejects an out-of-domain color string', () => {
    expect(isUnoColor('purple')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isUnoColor('')).toBe(false)
  })

  it('rejects null, undefined, and non-string values', () => {
    expect(isUnoColor(null)).toBe(false)
    expect(isUnoColor(undefined)).toBe(false)
    expect(isUnoColor(42)).toBe(false)
    expect(isUnoColor({})).toBe(false)
  })

  it('is case-sensitive — the canonical values are lowercase only', () => {
    expect(isUnoColor('Red')).toBe(false)
    expect(isUnoColor('RED')).toBe(false)
  })
})
