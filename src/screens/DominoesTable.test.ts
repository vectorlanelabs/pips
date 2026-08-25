import { describe, expect, it } from 'vitest'
import { computeDealFlights, estimateDealIntroMs } from '../components/DealIntro'

// Regression fixture for the review finding: DominoesTable used to call DealIntro without
// `maxFlights`, so DealIntro's own default cap (10) silently truncated the animation — a
// double-six deal is 7 tiles to each of 2 players, 14 total, so 4 tiles used to pop into place
// instead of animating. DominoesTable now passes `maxFlights={hand.length + opponentHandCount}`
// (14 for a fresh Dominoes round); these tests pin that exact math against the shared,
// game-agnostic DealIntro helpers rather than re-deriving it.
describe('Dominoes deal-intro flight configuration', () => {
  it('schedules all 14 flights for a fresh 7/7 double-six deal when maxFlights is passed', () => {
    const yourHandSize = 7
    const opponentHandCount = 7
    const maxFlights = yourHandSize + opponentHandCount
    const flights = computeDealFlights(yourHandSize, [opponentHandCount], maxFlights)
    expect(flights).toHaveLength(14)
    expect(flights.filter((f) => f.seat === 'you')).toHaveLength(7)
    expect(flights.filter((f) => f.seat === 0)).toHaveLength(7)
  })

  it('would silently truncate to 10 flights without the explicit maxFlights (the bug this fixes)', () => {
    const flights = computeDealFlights(7, [7]) // no maxFlights — DealIntro's own default cap
    expect(flights).toHaveLength(10)
  })

  it('produces a longer estimated intro duration for the full 14-flight deal than the default 10-flight cap', () => {
    expect(estimateDealIntroMs(14)).toBeGreaterThan(estimateDealIntroMs(10))
  })
})
