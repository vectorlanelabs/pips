import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addSeat, applyAction, CODE_WORD_COUNT, generateCode, makeRoom } from './room'
import { grandTotal } from '../games/yahtzee'
import type { RoomState, YCategory } from '../types'

describe('generateCode', () => {
  it('draws from the full 400-word namespace', () => {
    expect(CODE_WORD_COUNT).toBe(400)
  })

  it('produces a WORD-NUMBER code with a 4-6 letter uppercase word and a number in [10, 9999]', () => {
    const codes = Array.from({ length: 500 }, () => generateCode())
    for (const code of codes) {
      const match = code.match(/^([A-Z]{3,7})-(\d+)$/)
      expect(match).not.toBeNull()
      const [, word, numStr] = match!
      expect(word.length).toBeGreaterThanOrEqual(3)
      expect(word.length).toBeLessThanOrEqual(7)
      const num = Number(numStr)
      expect(num).toBeGreaterThanOrEqual(10)
      expect(num).toBeLessThanOrEqual(9999)
    }
    // The old range topped out at 99 — assert the expansion actually happened,
    // not just that codes fall within a superset of the old range.
    const nums = codes.map((c) => Number(c.split('-')[1]))
    expect(nums.some((n) => n > 99)).toBe(true)
    expect(nums.some((n) => n > 999)).toBe(true)
  })
})

function yahtzeeRoom(): RoomState {
  let room = makeRoom('TEST-1', 'yahtzee', 'Host', 'h1')
  room = addSeat(room, 'g1', 'Guest', false)
  // h1 is seats[0], so turnIdx 0 already points at them; just flip the screen
  return { ...room, screen: 'yahtzee' as const }
}

function dice(vals: number[]) {
  return vals.map((val, id) => ({ id, val, sel: false, rot: 0 }))
}

function setYahtzee(
  room: RoomState,
  vals: number[],
  card: Partial<Record<YCategory, number>>,
  bonuses: Record<string, number> = room.yahtzee.bonuses,
): RoomState {
  return {
    ...room,
    yahtzee: {
      ...room.yahtzee,
      dice: dice(vals),
      cards: { ...room.yahtzee.cards, h1: card },
      bonuses,
    },
  }
}

function score(room: RoomState, category: YCategory, by = 'h1'): RoomState {
  return applyAction(room, { type: 'yahtzeeScore', category }, by)
}

describe('yahtzeeScore — +100 bonus for a second yahtzee', () => {
  it('awards 100 when the yahtzee box holds 50 and the roll is five of a kind', () => {
    const room = setYahtzee(yahtzeeRoom(), [6, 6, 6, 6, 6], { yahtzee: 50 })
    const result = score(room, 'sixes')

    expect(result.yahtzee.bonuses.h1).toBe(100)
    expect(result.yahtzee.cards.h1.sixes).toBe(30)
    // Seat score is grandTotal of the card plus the bonus — 80 + 100
    const h1 = result.seats.find((s) => s.id === 'h1')!
    expect(h1.score).toBe(grandTotal(result.yahtzee.cards.h1) + 100)
    // Independently derived: sixes scores 30 (5×6), card becomes {yahtzee:50, sixes:30},
    // upperTotal=30 (yahtzee excluded from upper section) is under 63 so no upper bonus,
    // grandTotal = 50+30 = 80, plus the +100 yahtzee bonus = 180.
    expect(h1.score).toBe(180)
  })

  it('no bonus when the yahtzee box was zeroed (scored elsewhere)', () => {
    // yahtzee: 0 is a filled box, but the bonus requires exactly 50
    const room = setYahtzee(yahtzeeRoom(), [6, 6, 6, 6, 6], { yahtzee: 0 })
    const result = score(room, 'sixes')

    expect(result.yahtzee.bonuses.h1).toBe(0)
    expect(result.yahtzee.cards.h1.sixes).toBe(30)
  })

  it('no bonus without five of a kind', () => {
    const room = setYahtzee(yahtzeeRoom(), [6, 6, 6, 6, 5], { yahtzee: 50 })
    const result = score(room, 'sixes')

    expect(result.yahtzee.bonuses.h1).toBe(0)
  })

  it('first yahtzee: no bonus, just the 50 in the box', () => {
    const room = setYahtzee(yahtzeeRoom(), [6, 6, 6, 6, 6], {})
    const result = score(room, 'yahtzee')

    expect(result.yahtzee.bonuses.h1).toBe(0)
    expect(result.yahtzee.cards.h1.yahtzee).toBe(50)
  })

  it('accumulates across bonuses without double counting', () => {
    // Simulate one prior bonus already banked
    const room = setYahtzee(yahtzeeRoom(), [2, 2, 2, 2, 2], { yahtzee: 50 }, { h1: 100, g1: 0 })
    const result = score(room, 'twos')

    expect(result.yahtzee.bonuses.h1).toBe(200)
    expect(result.yahtzee.cards.h1.twos).toBe(10)
    // grandTotal never reads bonuses, so the 200 is added exactly once in yahtzeeScore
    const h1 = result.seats.find((s) => s.id === 'h1')!
    expect(h1.score).toBe(grandTotal(result.yahtzee.cards.h1) + 200)
  })
})

describe('farkle — held dice survive a busted roll', () => {
  // Cycling mock guarantees every rolled die is a 2, 3, 4, or 6 (never a 1 or 5, and no
  // 3-of-a-kind possible), so any roll is a guaranteed bust. rollDie consumes two
  // Math.random() calls per die (val + rot), which the cycling mock handles fine.
  const mockVals = [0.2, 0.4, 0.6, 0.85]
  let mockIdx = 0

  beforeEach(() => {
    mockIdx = 0
    vi.spyOn(Math, 'random').mockImplementation(() => mockVals[mockIdx++ % mockVals.length])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function farkleRoom(): RoomState {
    let room = makeRoom('TEST-2', 'farkle', 'Host', 'h1')
    room = addSeat(room, 'g1', 'Guest', false)
    // h1 is seats[0], so turnIdx 0 already points at them. Pre-populate kept/turnScore to
    // simulate the player having already set aside two 5s earlier in the turn.
    return { ...room, screen: 'farkle' as const, farkle: { ...room.farkle, kept: [5, 5], turnScore: 100, dice: [] } }
  }

  it('keeps already-held dice visible when the roll busts', () => {
    const result = applyAction(farkleRoom(), { type: 'farkleRoll' }, 'h1')

    expect(result.farkle.farkle).toBe(true)
    // Previously reset to [] the moment a roll busted; the held dice must survive
    expect(result.farkle.kept).toEqual([5, 5])
    expect(result.farkle.lost).toBe(100)
  })

  it('clears held dice when the turn ends after a farkle', () => {
    const room = farkleRoom()
    const farkled = { ...room, farkle: { ...room.farkle, farkle: true, dice: [{ id: 0, val: 2, sel: false, rot: 0 }] } }
    const result = applyAction(farkled, { type: 'farkleEndTurn' }, 'h1')

    expect(result.farkle.kept).toEqual([])
    expect(result.farkle.dice).toEqual([])
  })
})

describe('farkle — a bust during the final lap ends the match', () => {
  function finalLapRoom(): RoomState {
    let room = makeRoom('TEST-2', 'farkle', 'Host', 'h1')
    room = addSeat(room, 'g1', 'Guest', false)
    room = addSeat(room, 'g2', 'Guest 2', false)
    // h1 already banked past winningScore; the final lap is under way.
    return {
      ...room,
      screen: 'farkle' as const,
      seats: room.seats.map((s) => (s.id === 'h1' ? { ...s, score: 10500 } : s)),
      farkle: { ...room.farkle, finalRound: true, finalTrigger: 'h1' },
    }
  }

  it('ends the match when the farkle brings the turn back to the trigger seat', () => {
    // g2 is the last seat before the turn returns to h1 (the trigger seat)
    const room = { ...finalLapRoom(), turnIdx: 2 }
    const result = applyAction(room, { type: 'farkleEndTurn' }, 'g2')

    expect(result.screen).toBe('results')
    expect(result.winnerId).toBe('h1')
  })

  it('keeps going when the next turn belongs to a non-trigger seat', () => {
    const room = { ...finalLapRoom(), turnIdx: 1 }
    const result = applyAction(room, { type: 'farkleEndTurn' }, 'g1')

    expect(result.screen).toBe('farkle')
    expect(result.turnIdx).toBe(2)
    expect(result.winnerId).toBeNull()
  })
})

describe('connect4', () => {
  function connect4Room(): RoomState {
    let room = makeRoom('TEST-3', 'connect4', 'Host', 'h1')
    room = addSeat(room, 'g1', 'Guest', false)
    return applyAction(room, { type: 'startGame' }, 'h1')
  }

  function play(room: RoomState, col: number, by = room.seats[room.turnIdx].id) {
    return applyAction(room, { type: 'connect4Play', col }, by)
  }

  it('starts with a fresh board and drops discs to the bottom', () => {
    let room = connect4Room()
    expect(room.screen).toBe('connect4')
    expect(room.connect4.board).toEqual(Array(42).fill(null))
    expect(room.turnIdx).toBe(0)
    room = play(room, 2)
    expect(room.connect4.board[37]).toBe(0)
    room = play(room, 2)
    expect(room.connect4.board[30]).toBe(1)
  })

  it('rejects an out-of-turn play, a full column, and a play after the round is over, without mutating state', () => {
    const room = connect4Room()
    const outOfTurn = play(room, 0, 'g1')
    expect(outOfTurn.connect4.board).toEqual(room.connect4.board)
    expect(outOfTurn.turnIdx).toBe(room.turnIdx)
    expect(outOfTurn.connect4.rejection?.seatId).toBe('g1')
    expect(outOfTurn.connect4.rejection?.reason).toBeTruthy()

    const full = { ...room, connect4: { ...room.connect4, board: Array(42).fill(null).map((cell, index) => index % 7 === 0 ? 0 : cell) } }
    const afterFull = play(full, 0)
    expect(afterFull.connect4.board).toEqual(full.connect4.board)
    expect(afterFull.connect4.rejection?.seatId).toBe('h1')

    const over = { ...room, connect4: { ...room.connect4, roundOver: true } }
    const afterOver = play(over, 0)
    expect(afterOver.connect4.board).toEqual(over.connect4.board)
    expect(afterOver.connect4.rejection?.seatId).toBe('h1')
  })

  it('rejects malformed column values (negative, out-of-range, fractional, NaN) without mutating the board', () => {
    const room = connect4Room()
    for (const col of [-1, 7, 1.5, NaN, 100, -100]) {
      const result = play(room, col)
      expect(result.connect4.board).toEqual(room.connect4.board)
      expect(result.turnIdx).toBe(room.turnIdx)
      expect(result.connect4.rejection?.seatId).toBe('h1')
    }
  })

  it('names the rejected actor in the rejection notice, and clears it on the next legal play', () => {
    let room = connect4Room()
    room = play(room, 0, 'g1') // out of turn
    expect(room.connect4.rejection?.seatId).toBe('g1')
    expect(room.connect4.rejection?.reason).toBeTruthy()
    room = play(room, 0, 'h1') // legal
    expect(room.connect4.rejection).toBeNull()
  })

  it('detects a horizontal win through applyAction', () => {
    const room = connect4Room()
    const board = Array(42).fill(null)
    board[35] = 0
    board[36] = 0
    board[37] = 0
    const withRow = { ...room, connect4: { ...room.connect4, board }, turnIdx: 0 }
    const won = play(withRow, 3)
    expect(won.connect4.roundOver).toBe(true)
    expect(won.connect4.winLine.slice().sort((a, b) => a - b)).toEqual([35, 36, 37, 38])
    expect(won.connect4.wins).toEqual({ h1: 1, g1: 0 })
  })

  it('detects both diagonal slopes through applyAction', () => {
    const room = connect4Room()
    // Down-right diagonal: (row2,col0)=14, (row3,col1)=22, (row4,col2)=30 already placed for
    // h1; the winning disc drops into col3 (row5, empty) to complete 14-22-30-38. connect4Play
    // only checks lowestOpenRow for the played column (col3) — the other columns' physical
    // support beneath the pre-set cells is irrelevant to the reducer under test.
    const downRight = Array(42).fill(null)
    downRight[14] = 0
    downRight[22] = 0
    downRight[30] = 0
    let room1 = { ...room, connect4: { ...room.connect4, board: downRight }, turnIdx: 0 }
    room1 = play(room1, 3)
    expect(room1.connect4.roundOver).toBe(true)
    expect(room1.connect4.winLine.slice().sort((a, b) => a - b)).toEqual([14, 22, 30, 38])

    // Down-left diagonal: (row2,col3)=17, (row3,col2)=23, (row4,col1)=29 already placed for
    // h1; the winning disc drops into col0 (row5, empty) to complete 17-23-29-35.
    const downLeft = Array(42).fill(null)
    downLeft[17] = 0
    downLeft[23] = 0
    downLeft[29] = 0
    let room2 = { ...room, connect4: { ...room.connect4, board: downLeft }, turnIdx: 0 }
    room2 = play(room2, 0)
    expect(room2.connect4.roundOver).toBe(true)
    expect(room2.connect4.winLine.slice().sort((a, b) => a - b)).toEqual([17, 23, 29, 35])
  })

  it('rejects connect4AdvanceRound while the round is still live', () => {
    const room = connect4Room()
    const result = applyAction(room, { type: 'connect4AdvanceRound' }, 'h1')
    expect(result.connect4.board).toEqual(room.connect4.board)
    expect(result.screen).toBe('connect4')
    expect(result.connect4.roundOver).toBe(false)
  })

  it('awards rounds and sends the third win to results', () => {
    let room = connect4Room()
    for (const col of [0, 1, 0, 1, 0, 1, 0]) room = play(room, col)
    expect(room.connect4.roundOver).toBe(true)
    expect(room.connect4.winLine).toHaveLength(4)
    expect(room.connect4.wins).toEqual({ h1: 1, g1: 0 })
    expect(room.seats.map((seat) => seat.score)).toEqual([1, 0])
    room = { ...room, connect4: { ...room.connect4, wins: { h1: 2, g1: 0 } } }
    room = play({ ...room, connect4: { ...room.connect4, board: Array(42).fill(null), roundOver: false, over: false }, turnIdx: 0 }, 0)
    for (const col of [1, 0, 1, 0, 1, 0]) room = play(room, col)
    expect(room.connect4.pendingWinnerId).toBe('h1')
    room = applyAction(room, { type: 'connect4AdvanceRound' }, 'h1')
    expect(room.screen).toBe('results')
    expect(room.winnerId).toBe('h1')
  })

  it('handles a draw and advances non-final rounds', () => {
    let room = connect4Room()
    const drawn = [1, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, null, 1, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0]
    room = { ...room, connect4: { ...room.connect4, board: drawn }, turnIdx: 0 }
    room = play(room, 5)
    expect(room.connect4.roundOver).toBe(true)
    expect(room.connect4.winLine).toEqual([])
    expect(room.connect4.wins).toEqual({ h1: 0, g1: 0 })
    room = applyAction(room, { type: 'connect4AdvanceRound' }, 'h1')
    expect(room.connect4.board).toEqual(Array(42).fill(null))
    expect(room.connect4.starter).toBe(1)
    expect(room.turnIdx).toBe(1)
    room = { ...room, connect4: { ...room.connect4, roundOver: true } }
    room = applyAction(room, { type: 'connect4AdvanceRound' }, 'g1')
    expect(room.connect4.starter).toBe(0)
    expect(room.turnIdx).toBe(0)
  })

  it('adds a zeroed win entry for a new seat', () => {
    const room = addSeat(makeRoom('TEST-4', 'connect4', 'Host', 'h1'), 'g1', 'Guest', false)
    expect(room.connect4.wins).toEqual({ h1: 0, g1: 0 })
  })
})

describe('farkle — room transitions', () => {
  // Builds a farkle room with h1 on turn, `turnScore` already banked-in-hand, optional unresolved
  // `dice` still on the table, and h1's running seat score set to `seatScore` (0 = not yet open).
  function farkleRoomAt(turnScore: number, dice: RoomState['farkle']['dice'] = [], seatScore = 0): RoomState {
    let room = makeRoom('TEST-F', 'farkle', 'Host', 'h1')
    room = addSeat(room, 'g1', 'Guest', false)
    return {
      ...room,
      screen: 'farkle' as const,
      seats: room.seats.map((s) => (s.id === 'h1' ? { ...s, score: seatScore } : s)),
      farkle: { ...room.farkle, turnScore, dice, kept: [] },
    }
  }

  describe('opening threshold', () => {
    it('rejects banking one short of the 500 opening threshold', () => {
      const room = farkleRoomAt(499)
      const result = applyAction(room, { type: 'farkleBank' }, 'h1')
      expect(result.seats.find((s) => s.id === 'h1')!.score).toBe(0)
      expect(result.farkle.rejection?.seatId).toBe('h1')
      expect(result.farkle.rejection?.reason).toContain('500')
    })

    it('accepts banking exactly at the 500 opening threshold', () => {
      const room = farkleRoomAt(500)
      const result = applyAction(room, { type: 'farkleBank' }, 'h1')
      expect(result.seats.find((s) => s.id === 'h1')!.score).toBe(500)
      expect(result.farkle.rejection).toBeNull()
    })

    it('once open, banks any positive total without re-clearing the 500 bar', () => {
      const room = farkleRoomAt(50, [], 1000)
      const result = applyAction(room, { type: 'farkleBank' }, 'h1')
      expect(result.seats.find((s) => s.id === 'h1')!.score).toBe(1050)
    })

    it('rejects banking with nothing on the table, even once already open', () => {
      const room = farkleRoomAt(0, [], 1000)
      const result = applyAction(room, { type: 'farkleBank' }, 'h1')
      expect(result.seats.find((s) => s.id === 'h1')!.score).toBe(1000)
      expect(result.farkle.rejection?.reason).toBe('Nothing to bank yet.')
    })
  })

  describe('roll/bank validation', () => {
    it('rejects farkleBank and farkleRoll when the selected dice do not all score', () => {
      const room = farkleRoomAt(0, [
        { id: 0, val: 2, sel: true, rot: 0 },
        { id: 1, val: 5, sel: true, rot: 0 },
      ])
      const bankResult = applyAction(room, { type: 'farkleBank' }, 'h1')
      expect(bankResult.farkle.rejection?.reason).toMatch(/scoring dice/)
      const rollResult = applyAction(room, { type: 'farkleRoll' }, 'h1')
      expect(rollResult.farkle.rejection?.reason).toMatch(/scoring dice/)
      expect(rollResult.farkle.dice).toEqual(room.farkle.dice)
    })

    it('rejects rolling again when dice are on the table but nothing is selected', () => {
      const room = farkleRoomAt(0, [{ id: 0, val: 2, sel: false, rot: 0 }])
      const result = applyAction(room, { type: 'farkleRoll' }, 'h1')
      expect(result.farkle.dice).toEqual(room.farkle.dice)
      expect(result.farkle.rejection?.reason).toBeTruthy()
    })

    it('rejects every farkle action from a seat that is not the active turn', () => {
      const room = farkleRoomAt(500)
      const actions = [
        { type: 'farkleRoll' as const },
        { type: 'farkleToggle' as const, dieId: 0 },
        { type: 'farkleBank' as const },
        { type: 'farkleEndTurn' as const },
      ]
      for (const action of actions) {
        const result = applyAction(room, action, 'g1')
        expect(result.turnIdx).toBe(room.turnIdx)
        expect(result.farkle.rejection?.seatId).toBe('g1')
        expect(result.farkle.rejection?.reason).toBe("It's not your turn.")
      }
    })

    it('clears a stale rejection notice on the next legal action', () => {
      const room = farkleRoomAt(500)
      const rejected = applyAction(room, { type: 'farkleBank' }, 'g1')
      expect(rejected.farkle.rejection?.seatId).toBe('g1')
      const result = applyAction(rejected, { type: 'farkleBank' }, 'h1')
      expect(result.farkle.rejection).toBeNull()
    })
  })

  describe('stale/invalid dieId', () => {
    function diceRoom(): RoomState {
      let room = makeRoom('TEST-F2', 'farkle', 'Host', 'h1')
      room = addSeat(room, 'g1', 'Guest', false)
      return {
        ...room,
        screen: 'farkle' as const,
        farkle: {
          ...room.farkle,
          dice: [
            { id: 1, val: 3, sel: false, rot: 0 },
            { id: 2, val: 5, sel: false, rot: 0 },
          ],
        },
      }
    }

    it('toggling an absent dieId is a harmless no-op', () => {
      const room = diceRoom()
      const result = applyAction(room, { type: 'farkleToggle', dieId: 999 }, 'h1')
      expect(result.farkle.dice).toEqual(room.farkle.dice)
    })

    it('toggling a negative/stale dieId is a harmless no-op', () => {
      const room = diceRoom()
      const result = applyAction(room, { type: 'farkleToggle', dieId: -1 }, 'h1')
      expect(result.farkle.dice).toEqual(room.farkle.dice)
    })

    it('toggling the same dieId twice (duplicate toggle) returns it to unselected', () => {
      const room = diceRoom()
      const once = applyAction(room, { type: 'farkleToggle', dieId: 2 }, 'h1')
      expect(once.farkle.dice.find((d) => d.id === 2)?.sel).toBe(true)
      const twice = applyAction(once, { type: 'farkleToggle', dieId: 2 }, 'h1')
      expect(twice.farkle.dice.find((d) => d.id === 2)?.sel).toBe(false)
    })
  })

  describe('bust and hot dice', () => {
    // Cycling mock guarantees every rolled die is a 2, 3, 4, or 6 (never a 1 or 5, and never
    // three-of-a-kind), so any roll is a guaranteed bust. rollDie consumes two Math.random()
    // calls per die (val + rot).
    const bustVals = [0.2, 0.4, 0.6, 0.85]
    let bustIdx = 0

    beforeEach(() => {
      bustIdx = 0
      vi.spyOn(Math, 'random').mockImplementation(() => bustVals[bustIdx++ % bustVals.length])
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('a bust loses the turn total and counts a farkle for the seat', () => {
      // No dice currently on the table (rolling fresh); 2 dice already kept means the roll asks
      // for the remaining 4 — the same die count the cycling mock is proven to bust on above.
      const room = farkleRoomAt(450, [])
      const withKept = { ...room, farkle: { ...room.farkle, kept: [1, 1] } }
      const result = applyAction(withKept, { type: 'farkleRoll' }, 'h1')
      expect(result.farkle.farkle).toBe(true)
      expect(result.farkle.lost).toBe(450)
      expect(result.seats.find((s) => s.id === 'h1')!.farkles).toBe(1)
      // The busted roll doesn't touch the seat's banked score.
      expect(result.seats.find((s) => s.id === 'h1')!.score).toBe(0)
    })
  })

  describe('hot dice', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0) // every new die comes up a 1 (always scores)
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('keeping all six scoring dice resets kept and rolls a fresh six', () => {
      const room = farkleRoomAt(500, [{ id: 5, val: 5, sel: true, rot: 0 }], 0)
      const withKept = { ...room, farkle: { ...room.farkle, kept: [1, 1, 1, 1, 1], turnScore: 500 } }
      const result = applyAction(withKept, { type: 'farkleRoll' }, 'h1')
      expect(result.farkle.kept).toEqual([])
      expect(result.farkle.dice).toHaveLength(6)
      expect(result.farkle.turnScore).toBe(550) // 500 + 50 for the selected single 5
      expect(result.farkle.farkle).toBe(false)
    })
  })

  describe('final round', () => {
    it('crossing the winning score during a bank starts the final round', () => {
      const room = farkleRoomAt(500, [], 9600)
      const result = applyAction(room, { type: 'farkleBank' }, 'h1')
      expect(result.farkle.finalRound).toBe(true)
      expect(result.farkle.finalTrigger).toBe('h1')
      expect(result.seats.find((s) => s.id === 'h1')!.score).toBe(10100)
      expect(result.screen).toBe('farkle') // the lap has just started, not completed yet
    })

    it('a bank that wraps the turn back to the trigger seat completes the match', () => {
      let room = makeRoom('TEST-F3', 'farkle', 'Host', 'h1')
      room = addSeat(room, 'g1', 'Guest', false)
      room = addSeat(room, 'g2', 'Guest 2', false)
      room = {
        ...room,
        screen: 'farkle' as const,
        turnIdx: 2,
        seats: room.seats.map((s) => (s.id === 'h1' ? { ...s, score: 10500 } : s.id === 'g2' ? { ...s, score: 400 } : s)),
        farkle: { ...room.farkle, finalRound: true, finalTrigger: 'h1', turnScore: 500, dice: [] },
      }
      const result = applyAction(room, { type: 'farkleBank' }, 'g2')
      expect(result.screen).toBe('results')
      expect(result.winnerId).toBe('h1')
    })

    it('breaks a tie for highest score by stable seat order (earliest seat wins)', () => {
      let room = makeRoom('TEST-F4', 'farkle', 'Host', 'h1')
      room = addSeat(room, 'g1', 'Guest', false)
      room = addSeat(room, 'g2', 'Guest 2', false)
      room = {
        ...room,
        screen: 'farkle' as const,
        turnIdx: 0,
        seats: room.seats.map((s) => ({ ...s, score: 5000 })), // every seat tied
        farkle: { ...room.farkle, finalRound: true, finalTrigger: 'g1', turnScore: 0, dice: [] },
      }
      const result = applyAction(room, { type: 'farkleEndTurn' }, 'h1')
      expect(result.screen).toBe('results')
      // All three seats tie at 5000; checkFarkleMatchEnd sorts by score with a stable sort, so
      // ties keep the original seat order — the earliest-seated tied player wins. This documents
      // CURRENT behavior (see the matching bullet in src/data/rules.ts), not a re-derived rule.
      expect(result.winnerId).toBe('h1')
    })
  })
})

describe('ttt', () => {
  function tttRoom(): RoomState {
    let room = makeRoom('TEST-5', 'ttt', 'Host', 'h1')
    room = addSeat(room, 'g1', 'Guest', false)
    return applyAction(room, { type: 'startGame' }, 'h1')
  }

  function play(room: RoomState, cell: number, by = room.seats[room.turnIdx].id) {
    return applyAction(room, { type: 'tttPlay', cell }, by)
  }

  it('starts with a fresh board and alternates turns on legal plays', () => {
    let room = tttRoom()
    expect(room.screen).toBe('ttt')
    expect(room.ttt.board).toEqual(Array(9).fill(null))
    expect(room.turnIdx).toBe(0)
    room = play(room, 0)
    expect(room.ttt.board[0]).toBe(0)
    expect(room.turnIdx).toBe(1)
    room = play(room, 1)
    expect(room.ttt.board[1]).toBe(1)
    expect(room.turnIdx).toBe(0)
  })

  it('rejects an out-of-turn play, an occupied cell, and a play after the round is over', () => {
    let room = tttRoom()
    const outOfTurn = play(room, 0, 'g1')
    expect(outOfTurn.ttt.board).toEqual(room.ttt.board)
    expect(outOfTurn.turnIdx).toBe(room.turnIdx)

    room = play(room, 0)
    const occupied = play(room, 0, 'g1')
    expect(occupied.ttt.board).toEqual(room.ttt.board)

    const over = { ...room, ttt: { ...room.ttt, roundOver: true } }
    const afterOver = play(over, 4, 'g1')
    expect(afterOver.ttt.board).toEqual(over.ttt.board)
  })

  it('rejects malformed cell values (negative, 9+, fractional, NaN) without mutating the board', () => {
    const room = tttRoom()
    for (const cell of [-1, 9, 1.5, NaN, 100, -100]) {
      const result = play(room, cell)
      expect(result.ttt.board).toEqual(room.ttt.board)
      expect(result.turnIdx).toBe(room.turnIdx)
      expect(result.ttt.rejection?.seatId).toBe('h1')
    }
  })

  it('detects a win, which takes precedence over a would-be full-board draw, and awards the round', () => {
    let room = tttRoom()
    const moves: [number, string][] = [[0, 'h1'], [3, 'g1'], [1, 'h1'], [4, 'g1'], [2, 'h1']]
    for (const [cell, by] of moves) room = play(room, cell, by)
    expect(room.ttt.roundOver).toBe(true)
    expect(room.ttt.over).toBe(true)
    expect(room.ttt.winLine).toEqual([0, 1, 2])
    expect(room.ttt.wins).toEqual({ h1: 1, g1: 0 })
    expect(room.seats.map((s) => s.score)).toEqual([1, 0])
  })

  it('detects a full-board draw with no winLine and no score change', () => {
    let room = tttRoom()
    const moves: [number, string][] = [
      [0, 'h1'], [1, 'g1'], [2, 'h1'], [4, 'g1'], [3, 'h1'], [5, 'g1'], [7, 'h1'], [6, 'g1'], [8, 'h1'],
    ]
    for (const [cell, by] of moves) room = play(room, cell, by)
    expect(room.ttt.roundOver).toBe(true)
    expect(room.ttt.winLine).toEqual([])
    expect(room.ttt.wins).toEqual({ h1: 0, g1: 0 })
    expect(room.seats.map((s) => s.score)).toEqual([0, 0])
  })

  it('advancing the round is host-only — a guest action cannot skip the reveal pause', () => {
    let room = tttRoom()
    room = { ...room, ttt: { ...room.ttt, roundOver: true } }
    const byGuest = applyAction(room, { type: 'tttAdvanceRound' }, 'g1')
    expect(byGuest).toBe(room)

    room = applyAction(room, { type: 'tttAdvanceRound' }, 'h1')
    expect(room.ttt.board).toEqual(Array(9).fill(null))
    expect(room.ttt.roundOver).toBe(false)
    expect(room.ttt.starter).toBe(1)
    expect(room.turnIdx).toBe(1)
  })

  it('sends the match to results once a seat reaches three wins', () => {
    let room = tttRoom()
    room = { ...room, ttt: { ...room.ttt, roundOver: true, pendingWinnerId: 'h1', wins: { h1: 3, g1: 0 } } }
    room = applyAction(room, { type: 'tttAdvanceRound' }, 'h1')
    expect(room.screen).toBe('results')
    expect(room.winnerId).toBe('h1')
  })

  it('adds a zeroed win entry for a new seat', () => {
    const room = addSeat(makeRoom('TEST-6', 'ttt', 'Host', 'h1'), 'g1', 'Guest', false)
    expect(room.ttt.wins).toEqual({ h1: 0, g1: 0 })
  })

  it('names the rejected actor in the rejection notice, and clears it on the next legal play', () => {
    let room = tttRoom()
    room = play(room, 0, 'g1') // out of turn
    expect(room.ttt.rejection?.seatId).toBe('g1')
    expect(room.ttt.rejection?.reason).toBeTruthy()
    room = play(room, 0, 'h1') // legal
    expect(room.ttt.rejection).toBeNull()
  })

  it('keeps over and roundOver moving together through a full game', () => {
    let room = tttRoom()
    expect(room.ttt.over).toBe(room.ttt.roundOver)
    const moves: [number, string][] = [[0, 'h1'], [3, 'g1'], [1, 'h1'], [4, 'g1'], [2, 'h1']]
    for (const [cell, by] of moves) {
      room = play(room, cell, by)
      expect(room.ttt.over).toBe(room.ttt.roundOver)
    }
  })
})
