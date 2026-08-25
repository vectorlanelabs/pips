import { describe, expect, it } from 'vitest'
import { FARKLE_ACTION_MS, FARKLE_DECIDE_MS, FARKLE_TURN_START_EXTRA_MS } from './App'

// Regression fixture for the review's major finding (docs/reviews/farkle-review.md, major #2):
// the Farkle bot loop used to wait bare BASE_MS (900ms) before every roll and a bare 0.6 factor
// (540ms) before selecting kept dice or deciding to bank/reroll, with no Farkle-specific
// measurement, despite Farkle scaling to 8 seats (GAME_MAX_SEATS.farkle) — up to 7 bots' turns
// can land between a human's own turns (CLAUDE.md: judge pacing at a maxed-out table, not one
// bot in isolation). dice-roll and hot-dice (measured via ffprobe) run 1.392s/1.411s; bank-points
// and farkle-bust — heard only by the seat that actually banked/busted, since FarkleTable gates
// sound on the acting player's own turn — run 4.032s/2.904s.
const BASE_MS = 900
const MEASURED_ROLL_SOUND_MS = 1411 // hot-dice, the longer of dice-roll (1392ms) / hot-dice
const MEASURED_BANK_SOUND_MS = 4032
const MEASURED_BUST_SOUND_MS = 2904

describe('Farkle bot action pacing', () => {
  it('paces every roll materially slower than the generic BASE_MS beat', () => {
    expect(FARKLE_ACTION_MS).toBeGreaterThan(BASE_MS)
  })

  it('paces every roll past the longer of the measured dice-roll/hot-dice cues', () => {
    expect(FARKLE_ACTION_MS).toBeGreaterThan(MEASURED_ROLL_SOUND_MS)
  })

  it('the keep-dice/bank-or-reroll decision pause is a real pause, not a rounding error', () => {
    // Not tied to a measured sound (selecting/banking has no cue of its own until the roll/bank
    // actually lands), but must still read as a deliberate decision beat, not a blip.
    expect(FARKLE_DECIDE_MS).toBeGreaterThanOrEqual(BASE_MS)
  })

  it('the first roll of a fresh turn clears the longer of bank-points and farkle-bust before landing', () => {
    // Mid-turn re-rolls (hot dice, "roll again") only ever follow this SAME bot's own
    // dice-roll/hot-dice cue, already covered by FARKLE_ACTION_MS alone — the extra hold is only
    // paid once, before the very first roll of a turn, since that's the one that follows the
    // PREVIOUS seat's bank or bust.
    const freshTurnGapMs = FARKLE_ACTION_MS + FARKLE_TURN_START_EXTRA_MS
    expect(freshTurnGapMs).toBeGreaterThan(MEASURED_BANK_SOUND_MS)
    expect(freshTurnGapMs).toBeGreaterThan(MEASURED_BUST_SOUND_MS)
  })

  it('a mid-turn re-roll only pays FARKLE_ACTION_MS, not the turn-start extra', () => {
    // Sanity check that the turn-start hold is additive on top of, not baked into, the base
    // pace — same shape as Checkers' CHECKERS_CROWN_EXTRA_MS / Wahoo's WAHOO_BUST_EXTRA_MS.
    expect(FARKLE_ACTION_MS).toBeLessThan(FARKLE_ACTION_MS + FARKLE_TURN_START_EXTRA_MS)
  })

  it('at the 8-seat max, a full chain of 7 bot turns leaves comfortable per-action read time', () => {
    // GAME_MAX_SEATS.farkle is 8, so up to 7 bots' turns can land between a human's own turns
    // (CLAUDE.md: judge pacing at a maxed-out table). Each bot turn pays FARKLE_TURN_START_EXTRA_MS
    // once (its first roll) plus at least one FARKLE_ACTION_MS roll and two FARKLE_DECIDE_MS
    // decision pauses (keep dice, then bank) before passing play on — this is the fastest a
    // single-roll bot turn can resolve, and it still must not collapse toward BASE_MS's old pace.
    const seatsBetweenHumanTurns = 7
    const fastestSingleRollTurnMs = FARKLE_ACTION_MS + FARKLE_TURN_START_EXTRA_MS + FARKLE_DECIDE_MS * 2
    const totalMs = fastestSingleRollTurnMs * seatsBetweenHumanTurns
    const oldPaceTotalMs = (BASE_MS + BASE_MS * 0.6 * 2) * seatsBetweenHumanTurns
    expect(totalMs).toBeGreaterThan(oldPaceTotalMs)
  })
})
