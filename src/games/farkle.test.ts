import { describe, it, expect } from 'vitest'
import { bestSubset, decideFarkleBot, hasAnyScore, scoreSelection, tookFinalTurn } from './farkle'

describe('scoreSelection', () => {
  it('scores a single 1 as 100', () => {
    expect(scoreSelection([1])).toEqual({ valid: true, score: 100 })
  })

  it('scores a single 5 as 50', () => {
    expect(scoreSelection([5])).toEqual({ valid: true, score: 50 })
  })

  it('scores two 1s and two 5s as plain multiples (no triple bonus yet)', () => {
    expect(scoreSelection([1, 1])).toEqual({ valid: true, score: 200 })
    expect(scoreSelection([5, 5])).toEqual({ valid: true, score: 100 })
  })

  it('scores triples: 1,000 for three 1s, face×100 for every other face', () => {
    expect(scoreSelection([1, 1, 1])).toEqual({ valid: true, score: 1000 })
    expect(scoreSelection([2, 2, 2])).toEqual({ valid: true, score: 200 })
    expect(scoreSelection([6, 6, 6])).toEqual({ valid: true, score: 600 })
  })

  it('doubles the triple for four of a kind', () => {
    expect(scoreSelection([1, 1, 1, 1])).toEqual({ valid: true, score: 2000 })
    expect(scoreSelection([4, 4, 4, 4])).toEqual({ valid: true, score: 800 })
  })

  it('quadruples the triple for five of a kind', () => {
    expect(scoreSelection([1, 1, 1, 1, 1])).toEqual({ valid: true, score: 4000 })
    expect(scoreSelection([3, 3, 3, 3, 3])).toEqual({ valid: true, score: 1200 })
  })

  it('multiplies the triple by eight for six of a kind', () => {
    expect(scoreSelection([1, 1, 1, 1, 1, 1])).toEqual({ valid: true, score: 8000 })
    expect(scoreSelection([2, 2, 2, 2, 2, 2])).toEqual({ valid: true, score: 1600 })
  })

  it('scores three pairs as a flat 1,500, regardless of which faces pair up', () => {
    expect(scoreSelection([2, 2, 3, 3, 4, 4])).toEqual({ valid: true, score: 1500 })
    expect(scoreSelection([1, 1, 5, 5, 6, 6])).toEqual({ valid: true, score: 1500 })
  })

  it('scores a straight 1-6 as a flat 1,500', () => {
    expect(scoreSelection([1, 2, 3, 4, 5, 6])).toEqual({ valid: true, score: 1500 })
    // Order shouldn't matter — the function sorts internally.
    expect(scoreSelection([6, 4, 2, 5, 3, 1])).toEqual({ valid: true, score: 1500 })
  })

  it('rejects an empty selection', () => {
    expect(scoreSelection([])).toEqual({ valid: false, score: 0 })
  })

  it('rejects a selection with any non-scoring die, even alongside scoring ones', () => {
    // A lone 2 or 3 never scores on its own (needs 3+ of a kind).
    expect(scoreSelection([2, 3]).valid).toBe(false)
    expect(scoreSelection([1, 2]).valid).toBe(false)
    expect(scoreSelection([5, 2, 3]).valid).toBe(false)
  })
})

describe('bestSubset', () => {
  it('picks the maximum-score valid subset out of everything rolled', () => {
    // Only the three 1s can score at all (2, 3, 4 never score alone) — best must be the triple,
    // not some smaller subset of the 1s.
    const result = bestSubset([1, 1, 1, 2, 3, 4])
    expect(result.score).toBe(1000)
    expect(result.indices.sort((a, b) => a - b)).toEqual([0, 1, 2])
  })

  it('prefers the higher-scoring combination over a smaller one when both are available', () => {
    // A single 1 and a single 5 score less than treating them as one combined selection.
    const result = bestSubset([1, 5])
    expect(result.score).toBe(150)
    expect(result.indices.sort((a, b) => a - b)).toEqual([0, 1])
  })

  it('returns an empty, zero-score subset when nothing in the roll scores', () => {
    expect(bestSubset([2, 3, 4])).toEqual({ indices: [], score: 0 })
  })

  // scoreSelection's per-face contributions are strictly increasing with more valid dice, and
  // independently-scoring groups can always be combined into a strictly higher-scoring union —
  // so a genuine tie between two DIFFERENT-sized subsets for the overall max is vanishingly hard
  // to construct by hand (the only non-monotonic case, the fixed 1,500 three-pair/straight bonus,
  // has no smaller-subset equivalent in the scoring table). Rather than rely on one hand-picked
  // example, this pins the invariant itself directly: for a range of rolls, no valid subset with
  // STRICTLY FEWER dice ties bestSubset's chosen score — if one existed, bestSubset must have
  // picked it instead (see the `indices.length < best.indices.length` tie-break in bestSubset).
  it('never leaves a same-scoring, fewer-dice alternative on the table', () => {
    const rolls = [
      [1, 1, 1, 2, 3, 4],
      [1, 5, 2, 3, 4, 6],
      [2, 2, 3, 3, 4, 4],
      [1, 2, 3, 4, 5, 6],
      [1, 1, 5, 5, 2, 2],
      [6, 6, 6, 1, 5, 2],
      [1, 1, 1, 1, 5, 5],
      [3, 3, 3, 3, 2, 2],
      [5, 5, 5, 5, 1, 1],
    ]
    for (const vals of rolls) {
      const { indices, score } = bestSubset(vals)
      const n = vals.length
      for (let mask = 1; mask < 1 << n; mask++) {
        const candidate: number[] = []
        for (let i = 0; i < n; i++) if (mask & (1 << i)) candidate.push(i)
        if (candidate.length >= indices.length) continue
        const { valid, score: candidateScore } = scoreSelection(candidate.map((i) => vals[i]))
        expect(valid && candidateScore === score).toBe(false)
      }
    }
  })
})

describe('hasAnyScore', () => {
  it('false for an empty roll', () => {
    expect(hasAnyScore([])).toBe(false)
  })

  it('false when nothing in the roll can score', () => {
    expect(hasAnyScore([2, 3, 4, 6])).toBe(false)
  })

  it('true when at least one die scores, even buried among non-scoring dice', () => {
    expect(hasAnyScore([2, 3, 4, 5])).toBe(true)
    expect(hasAnyScore([2, 2, 2, 3])).toBe(true)
  })
})

describe('decideFarkleBot', () => {
  it('keeps nothing and never banks on a completely non-scoring roll', () => {
    const move = decideFarkleBot([2, 3, 4, 6], 0, 0, 500, 10000, 'medium')
    expect(move.keepIndices).toEqual([])
    expect(move.bank).toBe(false)
  })

  it('does not bank while still short of the opening threshold (not yet on the board)', () => {
    // turnScoreSoFar 300 + a rolled single 1 (100) = 400, short of the 500 opening bar — stays
    // false regardless of how aggressive the difficulty is.
    const move = decideFarkleBot([1, 2, 3], 300, 0, 500, 10000, 'easy')
    expect(move.bank).toBe(false)
  })

  it('can bank once the opening threshold is cleared', () => {
    // turnScoreSoFar 400 + a rolled single 1 (100) = 500, exactly the opening bar; easy's most
    // permissive bank bar (total >= 150) is cleared too.
    const move = decideFarkleBot([1, 2, 3], 400, 0, 500, 10000, 'easy')
    expect(move.bank).toBe(true)
  })

  it('an already-open seat (seatBanked > 0) can bank a below-opening-threshold total; a fresh seat cannot', () => {
    // seatBanked > 0 is the code's proxy for "already open": canBank only needs total > 0, not
    // total >= openingScore. total here (200) clears easy's bank bar but not the 500 opening bar.
    const alreadyOpen = decideFarkleBot([1], 100, 1000, 500, 10000, 'easy')
    const freshSeat = decideFarkleBot([1], 100, 0, 500, 10000, 'easy')
    expect(alreadyOpen.bank).toBe(true)
    expect(freshSeat.bank).toBe(false)
  })

  it('banks once seatBanked + total reaches the winning score, regardless of difficulty', () => {
    // seatBanked 9800 + a rolled triple-1 (1000) total = 10800, past the 10,000 winning score —
    // 'hard' would normally hold out for a much bigger total before banking.
    const move = decideFarkleBot([1, 1, 1], 0, 9800, 500, 10000, 'hard')
    expect(move.bank).toBe(true)
  })

  it('easy banks earlier than medium and hard at the same total', () => {
    // total 180 (turnScoreSoFar 80 + a rolled single 1) clears easy's {total:150} bar but falls
    // short of medium's lowest bar ({250,...}) and hard's lowest bar ({200,...}).
    const easy = decideFarkleBot([1], 80, 500, 500, 10000, 'easy')
    const medium = decideFarkleBot([1], 80, 500, 500, 10000, 'medium')
    const hard = decideFarkleBot([1], 80, 500, 500, 10000, 'hard')
    expect(easy.bank).toBe(true)
    expect(medium.bank).toBe(false)
    expect(hard.bank).toBe(false)
  })

  it('keeps every die on a hot-dice roll (all six score)', () => {
    const move = decideFarkleBot([1, 2, 3, 4, 5, 6], 0, 0, 500, 10000, 'medium')
    expect(move.keepIndices).toHaveLength(6)
  })
})

describe('tookFinalTurn — guards', () => {
  it('finalRound = false → false for every seat regardless of other params', () => {
    expect(tookFinalTurn(0, 1, 3, 2, false)).toBe(false)
    expect(tookFinalTurn(1, 1, 3, 2, false)).toBe(false)
    expect(tookFinalTurn(2, 1, 3, 2, false)).toBe(false)
  })

  it('triggerSeatIndex = -1 → false even with finalRound = true', () => {
    expect(tookFinalTurn(0, -1, 3, 2, true)).toBe(false)
    expect(tookFinalTurn(1, -1, 3, 2, true)).toBe(false)
  })
})

describe('tookFinalTurn — 3 seats, trigger at seat 1', () => {
  // Seat 1 banked to start the final round; play proceeds 2 → 0 → game ends.

  it('turnIdx = 2 (seat 2 now up): only the trigger is done', () => {
    expect(tookFinalTurn(1, 1, 3, 2, true)).toBe(true) // trigger — their bank started the round
    expect(tookFinalTurn(2, 1, 3, 2, true)).toBe(false) // their turn, not finished yet
    expect(tookFinalTurn(0, 1, 3, 2, true)).toBe(false) // not reached yet
  })

  it('turnIdx = 0 (seat 2 finished, seat 0 up): trigger and seat 2 done', () => {
    expect(tookFinalTurn(1, 1, 3, 0, true)).toBe(true) // trigger
    expect(tookFinalTurn(2, 1, 3, 0, true)).toBe(true) // turn passed seat 2 since the trigger's bank
    expect(tookFinalTurn(0, 1, 3, 0, true)).toBe(false) // their turn, not finished yet
  })
})

describe('tookFinalTurn — 4 seats, trigger at seat 2', () => {
  // Final order after trigger: 3, 0, 1.

  it('turnIdx = 3: only the trigger is done', () => {
    expect(tookFinalTurn(2, 2, 4, 3, true)).toBe(true) // trigger
    expect(tookFinalTurn(3, 2, 4, 3, true)).toBe(false) // their turn, not finished yet
    expect(tookFinalTurn(0, 2, 4, 3, true)).toBe(false) // not reached yet
    expect(tookFinalTurn(1, 2, 4, 3, true)).toBe(false) // not reached yet
  })

  it('turnIdx = 0: seat 3 done, seats 0 and 1 not', () => {
    expect(tookFinalTurn(2, 2, 4, 0, true)).toBe(true) // trigger
    expect(tookFinalTurn(3, 2, 4, 0, true)).toBe(true) // turn passed seat 3
    expect(tookFinalTurn(0, 2, 4, 0, true)).toBe(false) // their turn, not finished yet
    expect(tookFinalTurn(1, 2, 4, 0, true)).toBe(false) // not reached yet
  })

  it('turnIdx = 1: seats 3 and 0 done, seat 1 up', () => {
    expect(tookFinalTurn(2, 2, 4, 1, true)).toBe(true) // trigger
    expect(tookFinalTurn(3, 2, 4, 1, true)).toBe(true) // turn passed seat 3
    expect(tookFinalTurn(0, 2, 4, 1, true)).toBe(true) // turn passed seat 0
    expect(tookFinalTurn(1, 2, 4, 1, true)).toBe(false) // their turn, not finished yet
  })
})

describe('tookFinalTurn — trigger at seat 0, 3 seats', () => {
  it('turnIdx = 2 (wraparound): seats 0 and 1 done, seat 2 up', () => {
    expect(tookFinalTurn(0, 0, 3, 2, true)).toBe(true) // trigger
    expect(tookFinalTurn(1, 0, 3, 2, true)).toBe(true) // turn passed seat 1 (wrapped around)
    expect(tookFinalTurn(2, 0, 3, 2, true)).toBe(false) // their turn, not finished yet
  })
})
