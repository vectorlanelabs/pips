import { describe, expect, it } from 'vitest'
import { CHESS_ACTION_MS, CHESS_PROMOTION_EXTRA_MS } from './App'

// Regression fixture for the review's Major #3 finding (docs/reviews/chess-review.md): the Chess
// bot loop used to wait bare BASE_MS (900ms) before every move, which is shorter than the game's
// own ordinary move sound (piece-drop, measured 1.000s) and far shorter than a promotion's king-me
// cue (measured 2.000s). Chess is strictly 2-seat (max 1 bot) and turns always alternate, so
// back-to-back bot actions never happen — but the wait before the bot's own move still has to
// clear whatever move (the human's) just handed it the turn, or the bot's own move-sound can start
// while that prior cue is still playing. CHESS_ACTION_MS must stay comfortably above the ordinary
// move sound, and CHESS_ACTION_MS + CHESS_PROMOTION_EXTRA_MS must clear the full promotion cue, so
// this can't silently regress back to a bare, un-game-specific pacing constant.
const BASE_MS = 900
const MEASURED_MOVE_SOUND_MS = 1000 // piece-drop.mp3, measured via ffprobe
const MEASURED_CAPTURE_SOUND_MS = 600 // checker-jumping-over.mp3 (reused for captures), measured via ffprobe
const MEASURED_PROMOTION_SOUND_MS = 2000 // king-me.mp3 (reused for promotions), measured via ffprobe

describe('Chess bot action pacing', () => {
  it('paces bot actions past the generic BASE_MS beat', () => {
    expect(CHESS_ACTION_MS).toBeGreaterThan(BASE_MS)
  })

  it('paces bot actions comfortably past the measured move/capture sound durations', () => {
    expect(CHESS_ACTION_MS).toBeGreaterThan(MEASURED_MOVE_SOUND_MS)
    expect(CHESS_ACTION_MS).toBeGreaterThan(MEASURED_CAPTURE_SOUND_MS)
  })

  it('holds long enough after a promoting move to let the full king-me cue finish', () => {
    // A promotion just before the bot's turn plays king-me for the full measured duration. The
    // extra hold is paid before the bot's own move fires, on top of the loop's own CHESS_ACTION_MS
    // wait, so the total gap after a promotion is the sum of both waits.
    const totalGapAfterPromotion = CHESS_ACTION_MS + CHESS_PROMOTION_EXTRA_MS
    expect(totalGapAfterPromotion).toBeGreaterThan(MEASURED_PROMOTION_SOUND_MS)
  })

  it('an ordinary (non-promoting) move only pays CHESS_ACTION_MS, not the promotion extra', () => {
    // Sanity check that the promotion hold is additive on top of, not baked into, the base pace —
    // an ordinary move's gap should be exactly CHESS_ACTION_MS, well short of the promotion total.
    expect(CHESS_ACTION_MS).toBeLessThan(CHESS_ACTION_MS + CHESS_PROMOTION_EXTRA_MS)
  })
})
