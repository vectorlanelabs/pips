import { describe, expect, it } from 'vitest'
import { DOMINOES_ACTION_MS, dominoesDealHoldMs } from './App'
import { estimateDealIntroMs } from './components/DealIntro'

// Regression fixture for the review's blocking finding: the Dominoes bot loop used to wait bare
// BASE_MS (900ms) between actions, which is shorter than the actual domino-play/domino-draw
// sound assets (measured ~1.032s locally with ffprobe) — the next bot action landed before the
// previous one's cue finished. DOMINOES_ACTION_MS must stay comfortably above that measured
// duration so this can't silently regress back to a bare, un-game-specific pacing constant.
const MEASURED_DOMINO_SOUND_MS = 1032

describe('Dominoes bot action pacing', () => {
  it('paces bot actions comfortably past the measured domino-play/domino-draw sound duration', () => {
    expect(DOMINOES_ACTION_MS).toBeGreaterThan(MEASURED_DOMINO_SOUND_MS)
  })
})

// Regression fixture for the review's blocking finding: the initial DealIntro (and every
// START_NEXT_ROUND re-deal) was never held against by the bot scheduler, so a bot-led opening
// could mutate canonical state while a human was still watching the shuffle/deal animation.
describe('dominoesDealHoldMs', () => {
  it('covers the full 14-flight double-six deal, not just the DealIntro default 10-flight cap', () => {
    const holdMs = dominoesDealHoldMs({ p1: 7, p2: 7 })
    expect(holdMs).toBeGreaterThan(estimateDealIntroMs(14))
    expect(holdMs).toBeGreaterThan(estimateDealIntroMs(10))
  })

  it('sums hand counts across however many seats are present, in case that ever changes', () => {
    expect(dominoesDealHoldMs({ p1: 7, p2: 7 })).toBe(dominoesDealHoldMs({ a: 3, b: 4, c: 7 }))
  })
})
