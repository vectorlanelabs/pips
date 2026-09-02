import { describe, expect, it } from 'vitest'
import { createTurnState } from '../engine/turn-engine'
import type { WahooPublicState } from '../board-games/wahoo/state'
import { rankWahooResults } from './WahooResults'

// Regression fixture for the review finding: the results screen previously counted
// `p >= 52` as "home" instead of the engine's actual win threshold `LANE_START` (63,
// from board.ts), so track marbles at 52-62 were miscounted as home and could invert
// ranking. positions 52 and 62 are still on the shared track; 63 and 66 are in the lane.
function buildPublicState(positions: Record<string, number[]>): WahooPublicState {
  const playerIds = Object.keys(positions)
  return {
    stage: 'over',
    turn: createTurnState<'roll' | 'move'>(playerIds, 'roll'),
    seatArms: Object.fromEntries(playerIds.map((id, i) => [id, i])),
    setOwners: Object.fromEntries(playerIds.map((id) => [id, id])),
    positions,
    centerBy: null,
    die: null,
    sixStreak: 0,
    lastMoved: null,
    lastEvent: null,
    winnerId: playerIds[0],
    mutedArm: null,
    houseRules: { twoColors: false },
  }
}

describe('rankWahooResults', () => {
  it('only counts marbles at LANE_START (63) or deeper as home, not track positions 52-62', () => {
    const publicState = buildPublicState({
      p1: [52, 62, 63, 66], // 2 on the track (52, 62), 2 in the lane (63, 66)
    })
    const rows = rankWahooResults(publicState, {})
    expect(rows[0].home).toBe(2)
  })

  it('does not let a player with more track-52..62 marbles outrank a player with more actual lane marbles', () => {
    const publicState = buildPublicState({
      // p1: all 4 marbles deep on the track (52-62) but NONE in the lane.
      p1: [52, 55, 58, 62],
      // p2: only 3 marbles in the lane (63-66), 1 still at base.
      p2: [63, 64, 65, -1],
    })
    const rows = rankWahooResults(publicState, { p1: 'P1', p2: 'P2' })
    expect(rows[0].id).toBe('p2') // p2 must rank above p1 despite p1's larger raw position numbers
    expect(rows[0].home).toBe(3)
    expect(rows.find((r) => r.id === 'p1')!.home).toBe(0)
  })

  it('counts a base marble (-1) as neither home nor track', () => {
    const publicState = buildPublicState({ p1: [-1, -1, 63, 66] })
    const rows = rankWahooResults(publicState, {})
    expect(rows[0].home).toBe(2)
    expect(rows[0].base).toBe(2)
  })
})
