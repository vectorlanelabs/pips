import { describe, expect, it } from 'vitest'
import { createTurnState } from '../engine/turn-engine'
import type { WahooPublicState } from '../board-games/wahoo/state'
import { rankWahooResults } from './WahooResults'

// Regression fixture for the review finding: the results screen previously counted
// `p >= 52` as "home" instead of the engine's actual win threshold `LANE_START` (63,
// from board.ts), so track marbles at 52-62 were miscounted as home and could invert
// ranking. positions 52 and 62 are still on the shared track; 63 and 66 are in the lane.
// setOwners/houseRules are optional so twoColors fixtures can override them; playerOrder
// derives from the unique owners of setOwners (the identity map = one row per set key,
// which is exactly the normal-game shape).
function buildPublicState(
  positions: Record<string, number[]>,
  opts: { setOwners?: Record<string, string>; houseRules?: { twoColors: boolean } } = {},
): WahooPublicState {
  const setIds = Object.keys(positions)
  const setOwners = opts.setOwners ?? Object.fromEntries(setIds.map((id) => [id, id]))
  const playerIds = [...new Set(Object.values(setOwners))]
  return {
    stage: 'over',
    turn: createTurnState<'roll' | 'move'>(playerIds, 'roll'),
    seatArms: Object.fromEntries(setIds.map((id, i) => [id, i])),
    setOwners,
    positions,
    centerBy: null,
    die: null,
    sixStreak: 0,
    lastMoved: null,
    lastEvent: null,
    winnerId: playerIds[0],
    mutedArm: null,
    houseRules: opts.houseRules ?? { twoColors: false },
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

  it('twoColors: winner with all 8 marbles home across both sets shows home 8, base 0', () => {
    const publicState = buildPublicState(
      {
        p1: [63, 64, 65, 66],
        'p1:2': [63, 64, 65, 66],
        p2: [-1, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
      {
        setOwners: { p1: 'p1', 'p1:2': 'p1', p2: 'p2', 'p2:2': 'p2' },
        houseRules: { twoColors: true },
      },
    )
    const rows = rankWahooResults(publicState, { p1: 'P1', p2: 'P2' })
    expect(rows).toHaveLength(2) // one row per player, never one per set
    expect(rows[0].id).toBe('p1')
    expect(rows[0].home).toBe(8)
    expect(rows[0].base).toBe(0)
  })

  it('twoColors: aggregates a player\'s home/base across both owned sets', () => {
    const publicState = buildPublicState(
      {
        p1: [63, 64, 65, 30], // primary set: 3 home, 1 on the track
        'p1:2': [63, 64, -1, 20], // second set: 2 home, 1 base, 1 on the track
        p2: [-1, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
      {
        setOwners: { p1: 'p1', 'p1:2': 'p1', p2: 'p2', 'p2:2': 'p2' },
        houseRules: { twoColors: true },
      },
    )
    const rows = rankWahooResults(publicState, { p1: 'P1', p2: 'P2' })
    const p1 = rows.find((r) => r.id === 'p1')!
    expect(p1.home).toBe(5) // 3 from the primary set + 2 from the second
    expect(p1.base).toBe(1) // 1 from the second set
  })

  it('twoColors off: explicit identity setOwners still yields one row per player with single-set counts', () => {
    const publicState = buildPublicState(
      { p1: [63, 66, -1, 20], p2: [64, 65, -1, -1] },
      { setOwners: { p1: 'p1', p2: 'p2' }, houseRules: { twoColors: false } },
    )
    const rows = rankWahooResults(publicState, { p1: 'P1', p2: 'P2' })
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.id === 'p1')).toMatchObject({ home: 2, base: 1 })
    expect(rows.find((r) => r.id === 'p2')).toMatchObject({ home: 2, base: 2 })
  })
})
