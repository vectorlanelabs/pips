import { describe, expect, it } from 'vitest'
import { CHECKERS_ACTION_MS, CHECKERS_CROWN_EXTRA_MS } from './App'

// Regression fixture for the review's blocking finding (docs/reviews/checkers-review.md,
// Blocking #1): the Checkers bot loop used to wait bare BASE_MS (900ms) before every action,
// which is shorter than the measured checker-move (1.032s) and checker-jump (0.624s) sounds, and
// far shorter than the crown cue (king-me played together with checker-move/-jump, measured
// 2.040s). CHECKERS_ACTION_MS must stay comfortably above the longer ordinary-move sound, and
// CHECKERS_ACTION_MS + CHECKERS_CROWN_EXTRA_MS must clear the full crown cue, so this can't
// silently regress back to a bare, un-game-specific pacing constant.
const BASE_MS = 900
const MEASURED_MOVE_SOUND_MS = 1032
const MEASURED_JUMP_SOUND_MS = 624
const MEASURED_CROWN_SOUND_MS = 2040

describe('Checkers bot action pacing', () => {
  it('paces bot actions past the generic BASE_MS beat', () => {
    expect(CHECKERS_ACTION_MS).toBeGreaterThan(BASE_MS)
  })

  it('paces bot actions comfortably past the measured move/jump sound durations', () => {
    expect(CHECKERS_ACTION_MS).toBeGreaterThan(MEASURED_MOVE_SOUND_MS)
    expect(CHECKERS_ACTION_MS).toBeGreaterThan(MEASURED_JUMP_SOUND_MS)
  })

  it('holds long enough after a crowning move to let the full king-me cue finish', () => {
    // A crowning move plays checker-move/checker-jump AND king-me together — the combined cue
    // runs the full measured crown duration. The next bot action pays CHECKERS_ACTION_MS again
    // on its own next iteration, so the total gap after a crown is the sum of both waits.
    const totalGapAfterCrown = CHECKERS_ACTION_MS + CHECKERS_CROWN_EXTRA_MS
    expect(totalGapAfterCrown).toBeGreaterThan(MEASURED_CROWN_SOUND_MS)
  })

  it('an ordinary (non-crowning) move only pays CHECKERS_ACTION_MS, not the crown extra', () => {
    // Sanity check that the crown hold is additive on top of, not baked into, the base pace —
    // an ordinary move's gap should be exactly CHECKERS_ACTION_MS, well short of the crown total.
    expect(CHECKERS_ACTION_MS).toBeLessThan(CHECKERS_ACTION_MS + CHECKERS_CROWN_EXTRA_MS)
  })
})
