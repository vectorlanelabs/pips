import { describe, it, expect } from 'vitest'
import {
  decideYahtzeeCategory, decideYahtzeeHold, grandTotal, isFiveKind, partitionDiceOrder, scoreCategory, upperTotal,
} from './yahtzee'
import type { Die } from '../types'

const dieAt = (id: number, val: number): Die => ({ id, val, sel: false, rot: 0 })
const heldIds = (dice: Die[], hold: Set<number>) => dice.filter((d) => hold.has(d.id)).map((d) => d.val).sort()

describe('isFiveKind', () => {
  it('five equal values → true', () => {
    expect(isFiveKind([4, 4, 4, 4, 4])).toBe(true)
  })

  it('four equal values → false', () => {
    expect(isFiveKind([4, 4, 4, 4, 5])).toBe(false)
  })

  it('short arrays → false', () => {
    expect(isFiveKind([])).toBe(false)
    expect(isFiveKind([3, 3, 3])).toBe(false)
  })
})

describe('scoreCategory — upper section', () => {
  it('sums only the matching face', () => {
    // [3,3,3,2,5]: no 1s, three 3s, one 5
    expect(scoreCategory([3, 3, 3, 2, 5], 'ones')).toBe(0)
    expect(scoreCategory([3, 3, 3, 2, 5], 'threes')).toBe(9)
    expect(scoreCategory([3, 3, 3, 2, 5], 'fives')).toBe(5)
  })

  it('five sixes → 30', () => {
    expect(scoreCategory([6, 6, 6, 6, 6], 'sixes')).toBe(30)
  })
})

describe('scoreCategory — three/four of a kind', () => {
  it('exactly three of a kind → sum of all five dice', () => {
    // 3+3+3+2+5 = 16; fourKind needs four equal → 0
    expect(scoreCategory([3, 3, 3, 2, 5], 'threeKind')).toBe(16)
    expect(scoreCategory([3, 3, 3, 2, 5], 'fourKind')).toBe(0)
  })

  it('four of a kind satisfies threeKind too → sum of all five', () => {
    // 2+2+2+2+6 = 14 for both
    expect(scoreCategory([2, 2, 2, 2, 6], 'threeKind')).toBe(14)
    expect(scoreCategory([2, 2, 2, 2, 6], 'fourKind')).toBe(14)
  })

  it('no matching group → 0', () => {
    expect(scoreCategory([1, 2, 3, 4, 5], 'threeKind')).toBe(0)
  })
})

describe('scoreCategory — full house (empty card, joker off)', () => {
  it('3+2 → 25', () => {
    expect(scoreCategory([3, 3, 3, 5, 5], 'fullHouse', {})).toBe(25)
  })

  it('4+1 → 0', () => {
    expect(scoreCategory([3, 3, 3, 3, 5], 'fullHouse', {})).toBe(0)
  })

  it('five of a kind → 0 without a filled yahtzee box', () => {
    // Not a 3+2 split, and the joker needs card.yahtzee to be defined
    expect(scoreCategory([2, 2, 2, 2, 2], 'fullHouse', {})).toBe(0)
  })
})

describe('scoreCategory — straights', () => {
  it('small straight with an extra die → 30', () => {
    expect(scoreCategory([1, 2, 3, 4, 6], 'smallStraight')).toBe(30)
  })

  it('small straight with a duplicate → 30', () => {
    expect(scoreCategory([2, 3, 4, 5, 5], 'smallStraight')).toBe(30)
  })

  it('no four-in-a-row → 0', () => {
    expect(scoreCategory([1, 2, 3, 5, 6], 'smallStraight')).toBe(0)
  })

  it('large straight → 40', () => {
    expect(scoreCategory([1, 2, 3, 4, 5], 'largeStraight')).toBe(40)
    expect(scoreCategory([2, 3, 4, 5, 6], 'largeStraight')).toBe(40)
  })

  it('five dice missing one end → 0', () => {
    expect(scoreCategory([1, 2, 3, 4, 6], 'largeStraight')).toBe(0)
  })
})

describe('scoreCategory — yahtzee and chance', () => {
  it('yahtzee → 50', () => {
    expect(scoreCategory([5, 5, 5, 5, 5], 'yahtzee')).toBe(50)
  })

  it('four of a kind → 0', () => {
    expect(scoreCategory([5, 5, 5, 5, 4], 'yahtzee')).toBe(0)
  })

  it('chance → sum of all five dice', () => {
    // 1+3+4+6+6 = 20
    expect(scoreCategory([1, 3, 4, 6, 6], 'chance')).toBe(20)
  })
})

describe('scoreCategory — joker branch (five of a kind + filled yahtzee + filled upper box)', () => {
  it('filled yahtzee and matching upper box → wildcard on lower boxes', () => {
    // Four of a kind also means fours must already be filled for the joker
    const card = { yahtzee: 50, fours: 16 }
    expect(scoreCategory([4, 4, 4, 4, 4], 'fullHouse', card)).toBe(25)
    expect(scoreCategory([4, 4, 4, 4, 4], 'smallStraight', card)).toBe(30)
    expect(scoreCategory([4, 4, 4, 4, 4], 'largeStraight', card)).toBe(40)
  })

  it('zeroed yahtzee box still enables the joker (checks !== undefined)', () => {
    // A 0 in the yahtzee box means it was filled but the first yahtzee was scored elsewhere
    const card = { yahtzee: 0, fours: 0 }
    expect(scoreCategory([4, 4, 4, 4, 4], 'largeStraight', card)).toBe(40)
  })

  it('matching upper box open → no wildcard', () => {
    // yahtzee filled, but fours has no entry yet
    const card = { yahtzee: 50 }
    expect(scoreCategory([4, 4, 4, 4, 4], 'fullHouse', card)).toBe(0)
    expect(scoreCategory([4, 4, 4, 4, 4], 'smallStraight', card)).toBe(0)
    expect(scoreCategory([4, 4, 4, 4, 4], 'largeStraight', card)).toBe(0)
  })

  it('yahtzee box open → no wildcard', () => {
    const card = { fours: 16 }
    expect(scoreCategory([4, 4, 4, 4, 4], 'fullHouse', card)).toBe(0)
  })

  it('a different upper box being filled does not enable the joker for the actual matching box', () => {
    // Fours rolled, but only "threes" is filled — "fours" (the matching box) is still open,
    // so the joker must not apply even though *some* upper box has a value.
    const card = { yahtzee: 50, threes: 9 }
    expect(scoreCategory([4, 4, 4, 4, 4], 'fullHouse', card)).toBe(0)
  })

  it('joker never applies to non-five-of-a-kind rolls', () => {
    const card = { yahtzee: 50, fours: 16 }
    expect(scoreCategory([4, 4, 4, 4, 5], 'fullHouse', card)).toBe(0)
  })
})

describe('upperTotal', () => {
  it('sums the six upper boxes, missing ones count 0', () => {
    // 3 + 12 + 18 = 33
    expect(upperTotal({ ones: 3, fours: 12, sixes: 18 })).toBe(33)
  })

  it('ignores lower boxes', () => {
    expect(upperTotal({ ones: 1, chance: 30, yahtzee: 50 })).toBe(1)
  })

  it('empty card → 0', () => {
    expect(upperTotal({})).toBe(0)
  })
})

describe('grandTotal', () => {
  it('adds the 35-point upper bonus when the upper section reaches 63', () => {
    // Upper: 3+6+9+12+15+18 = 63 → +35
    // Lower: 5+5+25+30+0+0+40 = 105
    const card = {
      ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18,
      threeKind: 5, fourKind: 5, fullHouse: 25, smallStraight: 30,
      largeStraight: 0, yahtzee: 0, chance: 40,
    }
    expect(grandTotal(card)).toBe(63 + 105 + 35)
  })

  it('no bonus when the upper section is below 63', () => {
    // Same lower boxes; sixes dropped from 18 to 12 → upper 57
    const card = {
      ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 12,
      threeKind: 5, fourKind: 5, fullHouse: 25, smallStraight: 30,
      largeStraight: 0, yahtzee: 0, chance: 40,
    }
    expect(grandTotal(card)).toBe(57 + 105)
  })

  it('reads only the card — no bonuses parameter to fold into', () => {
    // A second yahtzee bonus lives in room.yahtzee.bonuses, never in the card,
    // so grandTotal must not change for the same card.
    const card = { ones: 3, fours: 12, sixes: 18, yahtzee: 50 }
    expect(grandTotal(card)).toBe(33 + 50)
  })
})

describe('decideYahtzeeHold — expected-value search (medium/hard)', () => {
  it('four of a kind + an odd die → holds the four, rerolls the odd one out', () => {
    const dice = [dieAt(0, 4), dieAt(1, 4), dieAt(2, 4), dieAt(3, 4), dieAt(4, 2)]
    const hold = decideYahtzeeHold(dice, {}, 'medium')
    expect(heldIds(dice, hold)).toEqual([4, 4, 4, 4])
  })

  it('small straight already made, one die free → holds the run, rerolls the spare for a shot at large straight', () => {
    const dice = [dieAt(0, 1), dieAt(1, 2), dieAt(2, 3), dieAt(3, 4), dieAt(4, 6)]
    const hold = decideYahtzeeHold(dice, {}, 'medium')
    expect(heldIds(dice, hold)).toEqual([1, 2, 3, 4])
  })

  it('five of a kind already rolled → holds all five (nothing to gain from rerolling)', () => {
    const dice = [dieAt(0, 5), dieAt(1, 5), dieAt(2, 5), dieAt(3, 5), dieAt(4, 5)]
    const hold = decideYahtzeeHold(dice, {}, 'hard')
    expect(hold.size).toBe(5)
  })

  it('easy mode keeps the old pattern-match heuristic, not the EV search', () => {
    // Four distinct faces (1,2,3,4 + a duplicate 4): the heuristic holds one of each distinct
    // face and discards the duplicate, even though the EV search would keep all four 4s instead.
    const dice = [dieAt(0, 1), dieAt(1, 2), dieAt(2, 3), dieAt(3, 4), dieAt(4, 4)]
    const hold = decideYahtzeeHold(dice, {}, 'easy')
    expect(heldIds(dice, hold)).toEqual([1, 2, 3, 4])
  })

  it('two rerolls left plays more aggressively than one reroll left, given the same dice', () => {
    // [3,3,6,3,1] (three 3s + a 6 + a 1): with only ONE reroll left it's worth locking in a
    // narrower straight-chase bet (hold the 3 and the 6, reroll 3 dice hoping for e.g. 2,4,5).
    // With TWO rerolls left there's room for a broader, more valuable bet — hold just the single
    // 3 and reroll 4 dice chasing three/four/five of a kind instead. Depth should change the call.
    const dice = [dieAt(0, 3), dieAt(1, 3), dieAt(2, 6), dieAt(3, 3), dieAt(4, 1)]
    const oneRerollLeft = decideYahtzeeHold(dice, {}, 'medium', 1)
    const twoRerollsLeft = decideYahtzeeHold(dice, {}, 'medium', 2)
    expect(heldIds(dice, oneRerollLeft)).toEqual([3, 6])
    expect(heldIds(dice, twoRerollsLeft)).toEqual([3])
  })

  describe('hard-only upper-bonus awareness', () => {
    it('upper section behind pace → hard holds the pair of 6s (biggest bonus payoff), medium does not', () => {
      // Card: only ones/twos filled, way under the pace needed for the 63-point bonus. Medium
      // (no bonus awareness) chases the pair worth more on its own (2+4); hard recognizes the
      // pair of 6s is worth more toward securing the bonus and holds that instead.
      const card = { ones: 1, twos: 2 }
      const dice = [dieAt(0, 6), dieAt(1, 4), dieAt(2, 2), dieAt(3, 1), dieAt(4, 6)]
      const medium = decideYahtzeeHold(dice, card, 'medium', 2)
      const hard = decideYahtzeeHold(dice, card, 'hard', 2)
      expect(heldIds(dice, medium)).toEqual([2, 4])
      expect(heldIds(dice, hard)).toEqual([6, 6])
    })

    it('bonus already secured → hard stops caring, matches medium', () => {
      // Upper section already at 63+, so there's nothing left to protect — hard's bonus pressure
      // should drop to zero and it should land on the same call as medium.
      const card = { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 } // upperTotal = 63
      const dice = [dieAt(0, 4), dieAt(1, 4), dieAt(2, 4), dieAt(3, 4), dieAt(4, 2)]
      const medium = decideYahtzeeHold(dice, card, 'medium', 2)
      const hard = decideYahtzeeHold(dice, card, 'hard', 2)
      expect(heldIds(dice, hard)).toEqual(heldIds(dice, medium))
    })

    it('bonus already mathematically out of reach → hard stops caring, matches medium', () => {
      // Every upper box but ones is already filled with a low score; even a perfect ones=5 can't
      // reach 63, so hard's bonus pressure should drop out entirely.
      const card = { twos: 0, threes: 0, fours: 0, fives: 0, sixes: 0 }
      const dice = [dieAt(0, 4), dieAt(1, 4), dieAt(2, 4), dieAt(3, 4), dieAt(4, 2)]
      const medium = decideYahtzeeHold(dice, card, 'medium', 2)
      const hard = decideYahtzeeHold(dice, card, 'hard', 2)
      expect(heldIds(dice, hard)).toEqual(heldIds(dice, medium))
    })
  })
})

describe('decideYahtzeeCategory — tie-break between equal-scoring categories', () => {
  it('medium: four of a kind ties threeKind/chance on raw score → picks the rarer fourKind box', () => {
    // [4,4,4,4,2]: threeKind, fourKind, and chance all score 18 — fourKind is the
    // hardest of the three to satisfy again, so it should win the tie.
    expect(decideYahtzeeCategory([4, 4, 4, 4, 2], {}, 'medium')).toBe('fourKind')
  })

  it('hard: the same roll instead favors fours, once upper-bonus pressure is in play', () => {
    // fourKind scores higher raw (18 vs 16) and has lower opportunity cost than fours, but hard
    // also weighs fours' contribution toward the 63-point upper bonus (still reachable from an
    // empty card), which tips the balance — a real behavior difference from medium, not a bug.
    expect(decideYahtzeeCategory([4, 4, 4, 4, 2], {}, 'hard')).toBe('fours')
  })

  it('fourKind already filled → opportunity cost prefers the upper box over the tied threeKind/chance', () => {
    // fours=16 raw but a LOW opportunity cost (matching one specific face again is rare); threeKind
    // and chance both raw=18 but have much higher opportunity cost (a random future roll is fairly
    // likely to satisfy either), so taking fours now beats saving it for a below-average future turn.
    expect(decideYahtzeeCategory([4, 4, 4, 4, 2], { fourKind: 18 }, 'medium')).toBe('fours')
  })

  it('yahtzee still outranks fourKind on a five-of-a-kind tie', () => {
    // [5,5,5,5,5]: yahtzee(50), fourKind(25), threeKind(25), chance(25) all open.
    expect(decideYahtzeeCategory([5, 5, 5, 5, 5], {}, 'medium')).toBe('yahtzee')
  })
})

describe('partitionDiceOrder', () => {
  const die = (id: number, sel: boolean) => ({ id, val: 1, sel, rot: 0 })

  it('all unheld → original order preserved', () => {
    expect(partitionDiceOrder([die(0, false), die(1, false), die(2, false)])).toEqual({
      ids: [0, 1, 2],
      heldCount: 0,
    })
  })

  it('all held → heldCount is 3, ids in original order', () => {
    expect(partitionDiceOrder([die(4, true), die(2, true), die(9, true)])).toEqual({
      ids: [4, 2, 9],
      heldCount: 3,
    })
  })

  it('mix preserves relative order within each group', () => {
    expect(partitionDiceOrder([die(3, false), die(7, true), die(1, false), die(9, true), die(5, false)])).toEqual({
      ids: [7, 9, 3, 1, 5],
      heldCount: 2,
    })
  })

  it('empty → empty ids, heldCount 0', () => {
    expect(partitionDiceOrder([])).toEqual({ ids: [], heldCount: 0 })
  })
})
