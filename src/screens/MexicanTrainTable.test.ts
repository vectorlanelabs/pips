import { describe, expect, it } from 'vitest'
import { computeDealFlights, estimateDealIntroMs } from '../components/DealIntro'

// Regression fixture for the review finding: MexicanTrainTable used to call DealIntro without
// `maxFlights`, so DealIntro's own default cap (10) silently truncated the animation. Mexican
// Train deals 32-72 tiles across a 2-8 seat table, so most of a deal used to pop into place
// instead of animating. MexicanTrainTable now passes
// `maxFlights={hand.length + others.reduce((sum, o) => sum + o.handSize, 0)}` — these tests pin
// that math against the shared, game-agnostic DealIntro helpers for 2-, 4-, and 8-seat deals.
describe('Mexican Train deal-intro flight configuration', () => {
  it('schedules all 32 flights for a fresh 2-seat (16/16) deal when maxFlights is passed', () => {
    const yourHandSize = 16
    const otherCounts = [16]
    const maxFlights = yourHandSize + otherCounts.reduce((a, b) => a + b, 0)
    const flights = computeDealFlights(yourHandSize, otherCounts, maxFlights)
    expect(flights).toHaveLength(32)
  })

  it('schedules all 44 flights for a fresh 4-seat (11 each) deal when maxFlights is passed', () => {
    const yourHandSize = 11
    const otherCounts = [11, 11, 11]
    const maxFlights = yourHandSize + otherCounts.reduce((a, b) => a + b, 0)
    const flights = computeDealFlights(yourHandSize, otherCounts, maxFlights)
    expect(flights).toHaveLength(44)
  })

  it('schedules all 72 flights for a fresh 8-seat (9 each) deal when maxFlights is passed', () => {
    const yourHandSize = 9
    const otherCounts = Array.from({ length: 7 }, () => 9)
    const maxFlights = yourHandSize + otherCounts.reduce((a, b) => a + b, 0)
    const flights = computeDealFlights(yourHandSize, otherCounts, maxFlights)
    expect(flights).toHaveLength(72)
  })

  it('would silently truncate to 10 flights without the explicit maxFlights (the bug this fixes)', () => {
    const flights = computeDealFlights(16, [16]) // no maxFlights — DealIntro's own default cap
    expect(flights).toHaveLength(10)
  })

  it('produces a longer estimated intro duration for a full deal than the default 10-flight cap', () => {
    expect(estimateDealIntroMs(32)).toBeGreaterThan(estimateDealIntroMs(10))
    expect(estimateDealIntroMs(72)).toBeGreaterThan(estimateDealIntroMs(32))
  })
})
