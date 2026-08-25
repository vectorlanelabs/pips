import { describe, expect, it } from 'vitest'
import { mtDealHoldMs } from './App'
import { estimateDealIntroMs } from './components/DealIntro'

// Regression fixture for the review's major finding: the initial DealIntro (and every
// START_NEXT_ROUND re-deal) was never held against by the bot scheduler, so a bot-led opening
// could mutate canonical state while a human was still watching the shuffle/deal animation.
// Mexican Train deals 32-72 tiles depending on the 2-8 seat table, so the hold must cover the
// real total, not just DealIntro's own 10-flight default cap.
describe('mtDealHoldMs', () => {
  it('covers the full 2-seat (32-tile) deal, well past the default 10-flight cap', () => {
    const handCounts = { p1: 16, p2: 16 }
    const holdMs = mtDealHoldMs(handCounts)
    expect(holdMs).toBeGreaterThan(estimateDealIntroMs(32))
    expect(holdMs).toBeGreaterThan(estimateDealIntroMs(10))
  })

  it('covers the full 4-seat (44-tile) deal', () => {
    const handCounts = { p1: 11, p2: 11, p3: 11, p4: 11 }
    expect(mtDealHoldMs(handCounts)).toBeGreaterThan(estimateDealIntroMs(44))
  })

  it('covers the full 8-seat (72-tile) deal', () => {
    const handCounts = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`p${i}`, 9]))
    expect(mtDealHoldMs(handCounts)).toBeGreaterThan(estimateDealIntroMs(72))
  })

  it('sums hand counts across however many seats are present', () => {
    expect(mtDealHoldMs({ a: 16, b: 16 })).toBe(mtDealHoldMs({ x: 10, y: 11, z: 11 }))
  })
})
