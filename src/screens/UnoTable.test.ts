import { describe, expect, it } from 'vitest'
import type { UnoCard } from '../card-games/uno/deck'
import type { UnoLastAction } from '../card-games/uno/state'
import { isUnoForcedDrawAction, sortUnoHand } from './UnoTable'

function card(id: string, color: UnoCard['color'], kind: UnoCard['kind'], value: number | null = null): UnoCard {
  return { id, color, kind, value }
}

describe('sortUnoHand', () => {
  it('returns a new array and leaves the input order untouched', () => {
    const input = [
      card('blue-1', 'blue', 'number', 1),
      card('red-1', 'red', 'number', 1),
    ]
    const sorted = sortUnoHand(input)
    expect(sorted).not.toBe(input)
    expect(sorted.map((c) => c.id)).toEqual(['red-1', 'blue-1'])
    expect(input.map((c) => c.id)).toEqual(['blue-1', 'red-1'])
  })

  it('sorts an empty hand', () => {
    expect(sortUnoHand([])).toEqual([])
  })

  it('groups by the fixed color order red, yellow, green, blue', () => {
    const input = [
      card('blue', 'blue', 'number', 0),
      card('yellow', 'yellow', 'number', 0),
      card('green', 'green', 'number', 0),
      card('red', 'red', 'number', 0),
    ]
    expect(sortUnoHand(input).map((c) => c.color)).toEqual(['red', 'yellow', 'green', 'blue'])
  })

  it('sorts numbers ascending within a color, then action cards skip/reverse/draw2', () => {
    const input = [
      card('r-draw2', 'red', 'draw2'),
      card('r-9', 'red', 'number', 9),
      card('r-0', 'red', 'number', 0),
      card('r-reverse', 'red', 'reverse'),
      card('r-5', 'red', 'number', 5),
      card('r-skip', 'red', 'skip'),
      card('r-1', 'red', 'number', 1),
    ]
    expect(sortUnoHand(input).map((c) => c.id)).toEqual([
      'r-0', 'r-1', 'r-5', 'r-9', 'r-skip', 'r-reverse', 'r-draw2',
    ])
  })

  it('keeps wilds at the very end, wild before wild4', () => {
    const input = [
      card('wild4', 'wild', 'wild4'),
      card('blue-1', 'blue', 'number', 1),
      card('wild', 'wild', 'wild'),
      card('red-2', 'red', 'number', 2),
    ]
    expect(sortUnoHand(input).map((c) => c.id)).toEqual(['red-2', 'blue-1', 'wild', 'wild4'])
  })

  it('is stable for identical cards (same color/kind/value keep their relative order)', () => {
    const input = [
      card('r-5-a', 'red', 'number', 5),
      card('r-5-b', 'red', 'number', 5),
      card('r-5-c', 'red', 'number', 5),
    ]
    expect(sortUnoHand(input).map((c) => c.id)).toEqual(['r-5-a', 'r-5-b', 'r-5-c'])
  })
})

// See docs/reviews/uno-review.md Major #4: the forced-draw reveal gate must not also hide
// cards received through a legal 7 swap or 0 rotation, since those are the player's own hand,
// not a penalty draw.
describe('isUnoForcedDrawAction', () => {
  it('is false when there is no last action yet (fresh round)', () => {
    expect(isUnoForcedDrawAction(null)).toBe(false)
  })

  it('is true for an immediate draw2 landing on the next player', () => {
    const la: UnoLastAction = { by: 'p1', kind: 'play', card: { color: 'red', kind: 'draw2', value: null }, drewCount: 2 }
    expect(isUnoForcedDrawAction(la)).toBe(true)
  })

  it('is true for an immediate wild4 landing on the next player', () => {
    const la: UnoLastAction = { by: 'p1', kind: 'play', card: { color: 'wild', kind: 'wild4', value: null }, drewCount: 4 }
    expect(isUnoForcedDrawAction(la)).toBe(true)
  })

  it('is false for a completed 7 swap (drewCount stays 0)', () => {
    const la: UnoLastAction = {
      by: 'p1', kind: 'play', card: { color: 'red', kind: 'number', value: 7 }, drewCount: 0, swapTargetPlayerId: 'p2',
    }
    expect(isUnoForcedDrawAction(la)).toBe(false)
  })

  it('is false for a 0 rotation (drewCount stays 0)', () => {
    const la: UnoLastAction = { by: 'p1', kind: 'play', card: { color: 'red', kind: 'number', value: 0 }, drewCount: 0 }
    expect(isUnoForcedDrawAction(la)).toBe(false)
  })

  it('is false for the drawer resolving a stacked pile themselves (kind is "draw", not "play")', () => {
    const la: UnoLastAction = { by: 'p1', kind: 'draw', card: null, drewCount: 4 }
    expect(isUnoForcedDrawAction(la)).toBe(false)
  })

  it('is false for an ordinary play with no draw effect', () => {
    const la: UnoLastAction = { by: 'p1', kind: 'play', card: { color: 'red', kind: 'number', value: 3 }, drewCount: 0 }
    expect(isUnoForcedDrawAction(la)).toBe(false)
  })
})
