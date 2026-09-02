import { describe, expect, it } from 'vitest'
import { POKER_ACTION_MS, POKER_FASTFORWARD_MS } from './App'

// Regression fixture, same shape as App.skipbo.test.ts: poker was the last
// card game pacing bots at bare BASE_MS (900ms), which play-testing read as
// rushed — a maxed 8-seat holdem table lands up to 7 consecutive bot betting
// decisions between a human's own turns. POKER_ACTION_MS must stay a
// card-game-scale pace (matching Uno/Skip-Bo/Rummy/Phase 10's measured
// 1600ms), so this can't silently regress back to the generic constant.
const BASE_MS = 900

describe('poker bot action pacing', () => {
  it('paces each betting decision materially slower than the generic BASE_MS beat', () => {
    expect(POKER_ACTION_MS).toBeGreaterThan(BASE_MS)
    expect(POKER_ACTION_MS).toBeGreaterThanOrEqual(BASE_MS * 1.5)
  })

  it('at a maxed 8-seat table, a 7-bot orbit leaves comfortable per-action read time', () => {
    // Worst case per CLAUDE.md's maxed-table rule: 7 bot decisions in a row.
    const orbitMs = POKER_ACTION_MS * 7
    expect(orbitMs).toBeGreaterThanOrEqual(BASE_MS * 1.5 * 7)
  })

  it('fast-forward (all humans folded) races visibly but not instantly', () => {
    // The bots-only runout should be clearly quicker than the watched pace
    // yet still show each action as a distinct flip, not a blur.
    expect(POKER_FASTFORWARD_MS).toBeLessThan(BASE_MS / 2)
    expect(POKER_FASTFORWARD_MS).toBeGreaterThanOrEqual(200)
  })
})
