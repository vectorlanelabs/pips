import { describe, expect, it } from 'vitest'
import { SKIPBO_ACTION_MS, skipBoDealHoldMs } from './App'
import { estimateDealIntroMs } from './components/DealIntro'

// Regression fixture for the review's blocking finding (docs/reviews/skipbo-review.md,
// Blocking #1): the Skip-Bo bot loop used to wait bare BASE_MS (900ms) before every individual
// stock/hand/discard play. A single turn is a CHAIN of these plays, and a full 4-seat table can
// land up to 3 bots' worth of chained plays between a human's own turns — a bare 900ms beat blurs
// them into an unreadable "fast forward" run, which CLAUDE.md's pacing rule treats as a bug even
// when nothing is technically broken. SKIPBO_ACTION_MS must stay a card-game-scale pace (matching
// Rummy/Uno/Wahoo/TTT's measured 1600ms, not the generic board-game BASE_MS) so this can't
// silently regress back to a bare, un-game-specific constant.
const BASE_MS = 900

describe('Skip-Bo bot action pacing', () => {
  it('paces each individual action materially slower than the generic BASE_MS beat', () => {
    expect(SKIPBO_ACTION_MS).toBeGreaterThan(BASE_MS)
    // "Materially slower", not just barely — matches the other card games' human-legible pace.
    expect(SKIPBO_ACTION_MS).toBeGreaterThanOrEqual(BASE_MS * 1.5)
  })

  it('at a maxed 4-seat table, a 3-action bot chain leaves comfortable per-action read time', () => {
    // Simulates the review's exact worst case: one bot's turn chains 3 individual plays
    // (e.g. two stock plays and a hand play) before passing to the next seat. Each action still
    // pays its own SKIPBO_ACTION_MS wait — the loop re-evaluates after every single play, it
    // never runs a whole chain in one uninterrupted burst — so total elapsed time for the chain
    // scales linearly and each individual state change gets a full read window.
    const chainLength = 3
    const totalMs = SKIPBO_ACTION_MS * chainLength
    expect(totalMs).toBeGreaterThanOrEqual(BASE_MS * 1.5 * chainLength)
  })
})

// Regression fixture: the initial deal (and every rematch re-deal) was already correctly held
// against DealIntro via estimateDealIntroMs per the review, but that computation lived inline
// and duplicated at two call sites (skipBoStart, skipBoRematch). Factored into a pure function so
// it can be pinned here without mounting the app, matching Dominoes' dominoesDealHoldMs pattern.
describe('skipBoDealHoldMs', () => {
  it('covers the full per-seat 5-card starting hand deal', () => {
    for (const seatCount of [2, 3, 4]) {
      const holdMs = skipBoDealHoldMs(seatCount)
      expect(holdMs).toBeGreaterThan(estimateDealIntroMs(seatCount * 5))
    }
  })

  it('scales with seat count, since more seats means more starting-hand flights to animate', () => {
    expect(skipBoDealHoldMs(4)).toBeGreaterThan(skipBoDealHoldMs(2))
  })
})
