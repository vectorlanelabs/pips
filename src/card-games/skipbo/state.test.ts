import { describe, expect, it } from 'vitest'
import { isSkipBoAction } from './state.ts'

// ---------------------------------------------------------------------------
// isSkipBoAction — the runtime guard at the PeerJS host boundary (App.tsx's
// Skip-Bo onAction handler). A guest action arrives over the wire as
// `unknown`; the compile-time SkipBoAction union guarantees nothing about
// what a hostile or stale/buggy client actually sends. See
// docs/reviews/skipbo-review.md Major #3. Mirrors Rummy's isRummyAction.
// ---------------------------------------------------------------------------

describe('isSkipBoAction', () => {
  it('rejects null and undefined', () => {
    expect(isSkipBoAction(null)).toBe(false)
    expect(isSkipBoAction(undefined)).toBe(false)
  })

  it('rejects primitives', () => {
    expect(isSkipBoAction('PASS')).toBe(false)
    expect(isSkipBoAction(42)).toBe(false)
    expect(isSkipBoAction(true)).toBe(false)
  })

  it('rejects arrays', () => {
    expect(isSkipBoAction([])).toBe(false)
    expect(isSkipBoAction(['PASS'])).toBe(false)
  })

  it('rejects a plain object with no type field', () => {
    expect(isSkipBoAction({})).toBe(false)
    expect(isSkipBoAction({ cardId: 'x' })).toBe(false)
  })

  it('rejects a type field that is not a string', () => {
    expect(isSkipBoAction({ type: 1 })).toBe(false)
    expect(isSkipBoAction({ type: null })).toBe(false)
    expect(isSkipBoAction({ type: {} })).toBe(false)
  })

  it('rejects an unrecognized type string', () => {
    expect(isSkipBoAction({ type: 'NOT_A_REAL_ACTION' })).toBe(false)
  })

  it('accepts every real SkipBoAction shape by its type discriminant', () => {
    expect(isSkipBoAction({ type: 'PLAY_STOCK', buildPileIndex: 0 })).toBe(true)
    expect(isSkipBoAction({ type: 'PLAY_HAND', cardId: 'sb-0', buildPileIndex: 1 })).toBe(true)
    expect(isSkipBoAction({ type: 'PLAY_DISCARD', pileIndex: 0, buildPileIndex: 2 })).toBe(true)
    expect(isSkipBoAction({ type: 'DISCARD', cardId: 'sb-0', pileIndex: 3 })).toBe(true)
    expect(isSkipBoAction({ type: 'PASS' })).toBe(true)
  })

  it('accepts extra/malformed fields alongside a valid type — field-level shape is the validator’s job, not this guard’s', () => {
    expect(isSkipBoAction({ type: 'PLAY_STOCK', buildPileIndex: 'not a number' })).toBe(true)
  })
})
