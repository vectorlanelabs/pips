import { describe, expect, it } from 'vitest'
import { PHASES } from './phases.ts'

describe('PHASES', () => {
  it('contains exactly 10 phases', () => {
    expect(PHASES).toHaveLength(10)
  })

  it('has each phase number matching its 1-based index', () => {
    PHASES.forEach((phase, index) => {
      expect(phase.phase).toBe(index + 1)
    })
  })

  it('phase 1 is 2 sets of 3', () => {
    expect(PHASES[0]).toEqual({
      phase: 1,
      label: '2 sets of 3',
      parts: [{ type: 'set', count: 3 }, { type: 'set', count: 3 }],
    })
  })

  it('phase 2 is 1 set of 3 + 1 run of 4', () => {
    expect(PHASES[1]).toEqual({
      phase: 2,
      label: '1 set of 3 + 1 run of 4',
      parts: [{ type: 'set', count: 3 }, { type: 'run', count: 4 }],
    })
  })

  it('phase 3 is 1 set of 4 + 1 run of 4', () => {
    expect(PHASES[2]).toEqual({
      phase: 3,
      label: '1 set of 4 + 1 run of 4',
      parts: [{ type: 'set', count: 4 }, { type: 'run', count: 4 }],
    })
  })

  it('phase 4 is a single run of 7', () => {
    expect(PHASES[3]).toEqual({
      phase: 4,
      label: '1 run of 7',
      parts: [{ type: 'run', count: 7 }],
    })
  })

  it('phase 5 is a single run of 8', () => {
    expect(PHASES[4]).toEqual({
      phase: 5,
      label: '1 run of 8',
      parts: [{ type: 'run', count: 8 }],
    })
  })

  it('phase 6 is a single run of 9', () => {
    expect(PHASES[5]).toEqual({
      phase: 6,
      label: '1 run of 9',
      parts: [{ type: 'run', count: 9 }],
    })
  })

  it('phase 7 is 2 sets of 4', () => {
    expect(PHASES[6]).toEqual({
      phase: 7,
      label: '2 sets of 4',
      parts: [{ type: 'set', count: 4 }, { type: 'set', count: 4 }],
    })
  })

  it('phase 8 is a single 7-card color group', () => {
    expect(PHASES[7]).toEqual({
      phase: 8,
      label: '7 cards of one color',
      parts: [{ type: 'color', count: 7 }],
    })
  })

  it('phase 9 is 1 set of 5 + 1 set of 2', () => {
    expect(PHASES[8]).toEqual({
      phase: 9,
      label: '1 set of 5 + 1 set of 2',
      parts: [{ type: 'set', count: 5 }, { type: 'set', count: 2 }],
    })
  })

  it('phase 10 is 1 set of 5 + 1 set of 3 (NOT set of 4 + set of 3)', () => {
    expect(PHASES[9]).toEqual({
      phase: 10,
      label: '1 set of 5 + 1 set of 3',
      parts: [{ type: 'set', count: 5 }, { type: 'set', count: 3 }],
    })
  })
})
