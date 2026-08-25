import { describe, expect, it } from 'vitest'
import type { Card } from '../../card-engine/cards.ts'
import { PHASES } from './phases.ts'
import {
  classifyGroup,
  classifyPhaseHand,
  isValidColorGroup,
  isValidRun,
  isValidSet,
  orderColorGroupForDisplay,
  orderRunForDisplay,
} from './classify.ts'

function numberCard(id: string, suit: string, rank: string): Card {
  return { id, suit, rank, deckIndex: 0, meta: { kind: 'number' } }
}

function wildCard(id: string): Card {
  return { id, suit: 'special', rank: 'WILD', deckIndex: 0, meta: { kind: 'wild' } }
}

function skipCard(id: string): Card {
  return { id, suit: 'special', rank: 'SKIP', deckIndex: 0, meta: { kind: 'skip' } }
}

describe('isValidSet', () => {
  it('accepts 3 naturals of the same number in different colors', () => {
    expect(isValidSet([
      numberCard('c1', 'red', '5'),
      numberCard('c2', 'blue', '5'),
      numberCard('c3', 'green', '5'),
    ])).toBe(true)
  })

  it('rejects 3 naturals where one differs', () => {
    expect(isValidSet([
      numberCard('c1', 'red', '5'),
      numberCard('c2', 'blue', '5'),
      numberCard('c3', 'green', '7'),
    ])).toBe(false)
  })

  it('accepts 2 naturals plus a wild (same number implied)', () => {
    expect(isValidSet([
      numberCard('c1', 'red', '5'),
      numberCard('c2', 'blue', '5'),
      wildCard('c3'),
    ])).toBe(true)
  })

  it('rejects an all-wild group (no natural card)', () => {
    expect(isValidSet([wildCard('c1'), wildCard('c2'), wildCard('c3')])).toBe(false)
  })

  it('rejects a single card (below the >=2 floor)', () => {
    expect(isValidSet([numberCard('c1', 'red', '5')])).toBe(false)
  })

  it('rejects two same-number naturals plus a Skip card', () => {
    expect(isValidSet([
      numberCard('c1', 'red', '5'),
      numberCard('c2', 'blue', '5'),
      skipCard('c3'),
    ])).toBe(false)
  })
})

describe('isValidRun', () => {
  it('accepts consecutive naturals regardless of color', () => {
    expect(isValidRun([
      numberCard('c1', 'red', '3'),
      numberCard('c2', 'blue', '4'),
      numberCard('c3', 'green', '5'),
      numberCard('c4', 'yellow', '6'),
    ])).toBe(true)
  })

  it('rejects a gap with no wild to fill it', () => {
    expect(isValidRun([
      numberCard('c1', 'red', '3'),
      numberCard('c2', 'blue', '4'),
      numberCard('c3', 'green', '6'),
    ])).toBe(false)
  })

  it('accepts a gap filled by a wild', () => {
    expect(isValidRun([
      numberCard('c1', 'red', '3'),
      numberCard('c2', 'blue', '4'),
      wildCard('c3'),
      numberCard('c4', 'green', '6'),
    ])).toBe(true)
  })

  it('accepts wilds extending the run downward below the lowest natural', () => {
    // naturals 11,12 + wilds at 9,10 → run of 9,10,11,12
    expect(isValidRun([
      numberCard('c1', 'red', '11'),
      numberCard('c2', 'blue', '12'),
      wildCard('c3'),
      wildCard('c4'),
    ])).toBe(true)
  })

  it('rejects wilds trying to extend past 12 (no wraparound)', () => {
    // naturals 11,12 + 11 wilds = 13 cards, needing 13 distinct numbers → hits the [1,12] ceiling
    const cards: Card[] = [
      numberCard('c1', 'red', '11'),
      numberCard('c2', 'blue', '12'),
    ]
    for (let i = 0; i < 11; i++) {
      cards.push(wildCard(`w${i}`))
    }
    expect(isValidRun(cards)).toBe(false)
  })

  it('rejects two naturals with the same number', () => {
    expect(isValidRun([
      numberCard('c1', 'red', '5'),
      numberCard('c2', 'blue', '5'),
    ])).toBe(false)
  })

  it('accepts an all-wild group of length 9', () => {
    const cards = Array.from({ length: 9 }, (_, i) => wildCard(`w${i}`))
    expect(isValidRun(cards)).toBe(true)
  })

  it('rejects 3 consecutive naturals plus a Skip card', () => {
    expect(isValidRun([
      numberCard('c1', 'red', '3'),
      numberCard('c2', 'blue', '4'),
      numberCard('c3', 'green', '5'),
      skipCard('c4'),
    ])).toBe(false)
  })

  it('rejects an all-Skip group', () => {
    expect(isValidRun([skipCard('c1'), skipCard('c2'), skipCard('c3')])).toBe(false)
  })

  it('rejects an all-wild group longer than 12 cards', () => {
    const cards = Array.from({ length: 13 }, (_, i) => wildCard(`w${i}`))
    expect(isValidRun(cards)).toBe(false)
  })
})

describe('isValidColorGroup', () => {
  it('accepts naturals all of one color', () => {
    expect(isValidColorGroup([
      numberCard('c1', 'red', '3'),
      numberCard('c2', 'red', '7'),
      numberCard('c3', 'red', '11'),
    ])).toBe(true)
  })

  it('rejects naturals split across two colors', () => {
    expect(isValidColorGroup([
      numberCard('c1', 'red', '3'),
      numberCard('c2', 'red', '7'),
      numberCard('c3', 'blue', '11'),
    ])).toBe(false)
  })

  it('accepts naturals of one color plus wilds', () => {
    expect(isValidColorGroup([
      numberCard('c1', 'red', '3'),
      numberCard('c2', 'red', '7'),
      wildCard('c3'),
    ])).toBe(true)
  })

  it('rejects an all-wild group (no natural)', () => {
    expect(isValidColorGroup([wildCard('c1'), wildCard('c2')])).toBe(false)
  })

  it('rejects two same-color naturals plus a Skip card', () => {
    expect(isValidColorGroup([
      numberCard('c1', 'red', '3'),
      numberCard('c2', 'red', '7'),
      skipCard('c3'),
    ])).toBe(false)
  })
})

describe('display ordering', () => {
  it('places a Wild in an internal run gap', () => {
    const ordered = orderRunForDisplay([
      numberCard('seven', 'green', '7'),
      numberCard('nine', 'green', '9'),
      wildCard('wild'),
    ])

    expect(ordered.map((c) => c.id)).toEqual(['seven', 'wild', 'nine'])
  })

  it('places an end-extension Wild after a run', () => {
    const ordered = orderRunForDisplay([
      numberCard('five', 'green', '5'),
      numberCard('six', 'green', '6'),
      numberCard('seven', 'green', '7'),
      wildCard('wild'),
    ])

    expect(ordered.map((c) => c.id)).toEqual(['five', 'six', 'seven', 'wild'])
  })

  it('places Wilds in each of two run gaps', () => {
    const ordered = orderRunForDisplay([
      numberCard('two', 'green', '2'),
      numberCard('five', 'green', '5'),
      wildCard('wild-one'),
      wildCard('wild-two'),
    ])

    expect(ordered.map((c) => c.id)).toEqual(['two', 'wild-one', 'wild-two', 'five'])
  })

  it('keeps an all-Wild run in its original order', () => {
    const ordered = orderRunForDisplay([wildCard('wild-one'), wildCard('wild-two'), wildCard('wild-three')])

    expect(ordered.map((c) => c.id)).toEqual(['wild-one', 'wild-two', 'wild-three'])
  })

  // Regression: a caller may pass an incomplete subset of a run's true accumulated cards
  // (e.g. Phase10Table's GroupCluster only combines a group's own zone plus SAME-player hits,
  // excluding a different player's cross-hit that also targets the group and fills one of its
  // gaps with a Wild — see the comment on orderRunForDisplay). That subset can have more gaps
  // than it has Wilds to cover, even though the true full group (validated server-side) is a
  // real run. This must never index wilds[] out of bounds and return `undefined` in the array —
  // that previously reached a `.map(card => card.id)` render call and crashed the whole screen.
  it('skips a gap with no natural or Wild in the given subset, without producing undefined', () => {
    const ordered = orderRunForDisplay([
      numberCard('two', 'green', '2'),
      numberCard('five', 'green', '5'),
      wildCard('wild-one'),
      // Only one Wild here even though ranks 3 AND 4 are both missing — as if another player's
      // Wild filling one of those gaps was a cross-hit not included in this subset.
    ])

    expect(ordered.every((c) => c !== undefined)).toBe(true)
    expect(ordered.map((c) => c.id)).toEqual(['two', 'wild-one', 'five'])
  })

  it('orders color-group naturals by rank and appends Wilds', () => {
    const ordered = orderColorGroupForDisplay([
      numberCard('nine', 'green', '9'),
      numberCard('three', 'green', '3'),
      wildCard('wild'),
    ])

    expect(ordered.map((c) => c.id)).toEqual(['three', 'nine', 'wild'])
  })
})

describe('classifyGroup', () => {
  it('accepts a valid group of the exact count', () => {
    expect(classifyGroup([
      numberCard('c1', 'red', '5'),
      numberCard('c2', 'blue', '5'),
      numberCard('c3', 'green', '5'),
    ], 'set', 3)).toBe(true)
  })

  it('accepts a valid color group of the exact count', () => {
    expect(classifyGroup([
      numberCard('c1', 'red', '2'),
      numberCard('c2', 'red', '8'),
      numberCard('c3', 'red', '12'),
    ], 'color', 3)).toBe(true)
  })

  it('rejects a too-long group even though the set itself is valid', () => {
    expect(classifyGroup([
      numberCard('c1', 'red', '5'),
      numberCard('c2', 'blue', '5'),
      numberCard('c3', 'green', '5'),
      numberCard('c4', 'yellow', '5'),
    ], 'set', 3)).toBe(false)
  })

  it('rejects a too-short group even though the run itself is valid', () => {
    expect(classifyGroup([
      numberCard('c1', 'red', '3'),
      numberCard('c2', 'blue', '4'),
      numberCard('c3', 'green', '5'),
    ], 'run', 4)).toBe(false)
  })
})

describe('classifyPhaseHand', () => {
  it('accepts phase 1 with two valid sets of 3', () => {
    const result = classifyPhaseHand([
      numberCard('c1', 'red', '5'),
      numberCard('c2', 'blue', '5'),
      numberCard('c3', 'green', '5'),
      numberCard('c4', 'red', '9'),
      numberCard('c5', 'blue', '9'),
      numberCard('c6', 'green', '9'),
    ], PHASES[0])
    expect(result.valid).toBe(true)
    expect(result.groups).toHaveLength(2)
    expect(result.groups![0].type).toBe('set')
    expect(result.groups![1].type).toBe('set')
  })

  it('accepts phase 1 when only a non-obvious split works', () => {
    // The first-3/rest split {5r,5b,9r} is not a set; the search must find
    // {5r,5b,5g} + {9r,9b,WILD}.
    const result = classifyPhaseHand([
      numberCard('c1', 'red', '5'),
      numberCard('c2', 'blue', '5'),
      numberCard('c3', 'red', '9'),
      numberCard('c4', 'green', '5'),
      numberCard('c5', 'blue', '9'),
      wildCard('c6'),
    ], PHASES[0])
    expect(result.valid).toBe(true)
    expect(result.groups).toHaveLength(2)
    expect(result.groups![0].type).toBe('set')
    expect(result.groups![1].type).toBe('set')
  })

  it('rejects phase 1 with 6 cards that cannot split into two sets of 3', () => {
    const result = classifyPhaseHand([
      numberCard('c1', 'red', '1'),
      numberCard('c2', 'blue', '1'),
      numberCard('c3', 'red', '2'),
      numberCard('c4', 'blue', '2'),
      numberCard('c5', 'red', '3'),
      numberCard('c6', 'blue', '3'),
    ], PHASES[0])
    expect(result.valid).toBe(false)
  })

  it('rejects phase 1 when one of the 6 selected cards is a Skip', () => {
    // The other 5 could combine into something set-shaped, but the Skip card
    // occupies a slot and can never be part of a set.
    const result = classifyPhaseHand([
      numberCard('c1', 'red', '5'),
      numberCard('c2', 'blue', '5'),
      numberCard('c3', 'green', '5'),
      numberCard('c4', 'red', '9'),
      numberCard('c5', 'blue', '9'),
      skipCard('c6'),
    ], PHASES[0])
    expect(result.valid).toBe(false)
  })

  it('rejects a wrong total card count immediately (no partition search)', () => {
    const result = classifyPhaseHand([
      numberCard('c1', 'red', '5'),
      numberCard('c2', 'blue', '5'),
      numberCard('c3', 'green', '5'),
      numberCard('c4', 'red', '9'),
      numberCard('c5', 'blue', '9'),
    ], PHASES[0])
    expect(result.valid).toBe(false)
    expect(result.groups).toBeUndefined()
  })

  it('accepts phase 8 with 7 naturals of one color as a single color group', () => {
    const result = classifyPhaseHand([
      numberCard('c1', 'red', '1'),
      numberCard('c2', 'red', '3'),
      numberCard('c3', 'red', '5'),
      numberCard('c4', 'red', '7'),
      numberCard('c5', 'red', '9'),
      numberCard('c6', 'red', '11'),
      numberCard('c7', 'red', '12'),
    ], PHASES[7])
    expect(result.valid).toBe(true)
    expect(result.groups).toHaveLength(1)
    expect(result.groups![0].type).toBe('color')
  })

  it('rejects phase 8 with one off-color natural and no wild to cover it', () => {
    const result = classifyPhaseHand([
      numberCard('c1', 'red', '1'),
      numberCard('c2', 'red', '3'),
      numberCard('c3', 'red', '5'),
      numberCard('c4', 'red', '7'),
      numberCard('c5', 'red', '9'),
      numberCard('c6', 'red', '11'),
      numberCard('c7', 'blue', '12'),
    ], PHASES[7])
    expect(result.valid).toBe(false)
  })

  it('accepts phase 4 with a 7-card run using 2 wilds', () => {
    // naturals 4,5,6,8,9 + wilds at 7 and 10 → run of 4,5,6,7,8,9,10
    const result = classifyPhaseHand([
      numberCard('c1', 'red', '4'),
      numberCard('c2', 'blue', '5'),
      numberCard('c3', 'green', '6'),
      numberCard('c4', 'yellow', '8'),
      numberCard('c5', 'red', '9'),
      wildCard('c6'),
      wildCard('c7'),
    ], PHASES[3])
    expect(result.valid).toBe(true)
    expect(result.groups).toHaveLength(1)
    expect(result.groups![0].type).toBe('run')
  })

  it('accepts phase 2 with a set of 3 plus a run of 4', () => {
    const result = classifyPhaseHand([
      numberCard('c1', 'red', '5'),
      numberCard('c2', 'blue', '5'),
      numberCard('c3', 'green', '5'),
      numberCard('c4', 'red', '1'),
      numberCard('c5', 'red', '2'),
      numberCard('c6', 'red', '3'),
      numberCard('c7', 'red', '4'),
    ], PHASES[1])
    expect(result.valid).toBe(true)
    expect(result.groups).toHaveLength(2)
    expect(result.groups!.map((g) => g.type).sort()).toEqual(['run', 'set'])
  })

  it('rejects phase 2 when the run part has a gap and no wild', () => {
    const result = classifyPhaseHand([
      numberCard('c1', 'red', '5'),
      numberCard('c2', 'blue', '5'),
      numberCard('c3', 'green', '5'),
      numberCard('c4', 'red', '1'),
      numberCard('c5', 'red', '2'),
      numberCard('c6', 'red', '3'),
      numberCard('c7', 'red', '9'),
    ], PHASES[1])
    expect(result.valid).toBe(false)
  })

  it('accepts phase 3 with a set of 4 plus a run of 4', () => {
    const result = classifyPhaseHand([
      numberCard('c1', 'red', '7'),
      numberCard('c2', 'blue', '7'),
      numberCard('c3', 'green', '7'),
      numberCard('c4', 'yellow', '7'),
      numberCard('c5', 'red', '9'),
      numberCard('c6', 'red', '10'),
      numberCard('c7', 'red', '11'),
      numberCard('c8', 'red', '12'),
    ], PHASES[2])
    expect(result.valid).toBe(true)
    expect(result.groups).toHaveLength(2)
    expect(result.groups!.map((g) => g.type).sort()).toEqual(['run', 'set'])
  })

  it('rejects phase 3 when the set part is only 3 cards, not 4', () => {
    const result = classifyPhaseHand([
      numberCard('c1', 'red', '7'),
      numberCard('c2', 'blue', '7'),
      numberCard('c3', 'green', '7'),
      numberCard('c4', 'red', '9'),
      numberCard('c5', 'red', '10'),
      numberCard('c6', 'red', '11'),
      numberCard('c7', 'red', '12'),
      numberCard('c8', 'yellow', '1'),
    ], PHASES[2])
    expect(result.valid).toBe(false)
  })

  it('accepts phase 5 with an 8-card run', () => {
    const result = classifyPhaseHand([
      numberCard('c1', 'red', '1'),
      numberCard('c2', 'red', '2'),
      numberCard('c3', 'red', '3'),
      numberCard('c4', 'red', '4'),
      numberCard('c5', 'red', '5'),
      numberCard('c6', 'red', '6'),
      numberCard('c7', 'red', '7'),
      numberCard('c8', 'red', '8'),
    ], PHASES[4])
    expect(result.valid).toBe(true)
    expect(result.groups).toHaveLength(1)
    expect(result.groups![0].type).toBe('run')
  })

  it('rejects phase 5 with only a 7-card run (one short)', () => {
    const result = classifyPhaseHand([
      numberCard('c1', 'red', '1'),
      numberCard('c2', 'red', '2'),
      numberCard('c3', 'red', '3'),
      numberCard('c4', 'red', '4'),
      numberCard('c5', 'red', '5'),
      numberCard('c6', 'red', '6'),
      numberCard('c7', 'red', '7'),
      numberCard('c8', 'blue', '9'),
    ], PHASES[4])
    expect(result.valid).toBe(false)
  })

  it('accepts phase 6 with a 9-card run', () => {
    const result = classifyPhaseHand([
      numberCard('c1', 'red', '1'),
      numberCard('c2', 'red', '2'),
      numberCard('c3', 'red', '3'),
      numberCard('c4', 'red', '4'),
      numberCard('c5', 'red', '5'),
      numberCard('c6', 'red', '6'),
      numberCard('c7', 'red', '7'),
      numberCard('c8', 'red', '8'),
      numberCard('c9', 'red', '9'),
    ], PHASES[5])
    expect(result.valid).toBe(true)
    expect(result.groups).toHaveLength(1)
    expect(result.groups![0].type).toBe('run')
  })

  it('rejects phase 6 with a duplicated rank breaking the run', () => {
    const result = classifyPhaseHand([
      numberCard('c1', 'red', '1'),
      numberCard('c2', 'red', '2'),
      numberCard('c3', 'red', '3'),
      numberCard('c4', 'red', '4'),
      numberCard('c5', 'red', '5'),
      numberCard('c6', 'red', '6'),
      numberCard('c7', 'red', '7'),
      numberCard('c8', 'red', '8'),
      numberCard('c9', 'blue', '8'),
    ], PHASES[5])
    expect(result.valid).toBe(false)
  })

  it('accepts phase 7 with two sets of 4', () => {
    const result = classifyPhaseHand([
      numberCard('c1', 'red', '3'),
      numberCard('c2', 'blue', '3'),
      numberCard('c3', 'green', '3'),
      numberCard('c4', 'yellow', '3'),
      numberCard('c5', 'red', '8'),
      numberCard('c6', 'blue', '8'),
      numberCard('c7', 'green', '8'),
      numberCard('c8', 'yellow', '8'),
    ], PHASES[6])
    expect(result.valid).toBe(true)
    expect(result.groups).toHaveLength(2)
    expect(result.groups!.every((g) => g.type === 'set')).toBe(true)
  })

  it('rejects phase 7 when one set is short a matching card', () => {
    const result = classifyPhaseHand([
      numberCard('c1', 'red', '3'),
      numberCard('c2', 'blue', '3'),
      numberCard('c3', 'green', '3'),
      numberCard('c4', 'yellow', '3'),
      numberCard('c5', 'red', '8'),
      numberCard('c6', 'blue', '8'),
      numberCard('c7', 'green', '8'),
      numberCard('c8', 'yellow', '9'),
    ], PHASES[6])
    expect(result.valid).toBe(false)
  })
})
