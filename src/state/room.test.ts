import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addSeat, applyAction, CODE_WORD_COUNT, generateCode, makeRoom } from './room'
import { Y_CATEGORIES, grandTotal } from '../games/yahtzee'
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

describe('farkle — hotDice is set whenever a roll uses up all 6 dice', () => {
  // Deterministic dice values via a mocked Math.random. rollDie consumes two calls per die
  // (val, then rot) — the (i + 0.5) / 6 centering avoids floating-point boundary flakiness
  // that a plain i / 6 sequence would risk (1/6 * 6 can floor to 0 instead of 1).
  function mockSequentialDiceVals(vals: number[]) {
    const calls: number[] = []
    for (const v of vals) {
      calls.push((v - 1 + 0.5) / 6) // produces val via 1 + floor(x * 6)
      calls.push(0.5) // rot — value doesn't matter for this test
    }
    let i = 0
    vi.spyOn(Math, 'random').mockImplementation(() => calls[i++ % calls.length])
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function farkleRoom(): RoomState {
    let room = makeRoom('TEST-3', 'farkle', 'Host', 'h1')
    room = addSeat(room, 'g1', 'Guest', false)
    return { ...room, screen: 'farkle' as const }
  }

  it('sets hotDice true when a SINGLE roll scores all 6 fresh dice at once (no prior partial keep)', () => {
    // A straight 1-6, all six already selected — the exact bug case: kept was 0 before this
    // roll (nothing was ever set aside from an earlier partial roll this turn), so a
    // before/after diff of kept.length could never distinguish this from "no dice kept yet".
    mockSequentialDiceVals([3, 3, 3, 3, 3, 3]) // the fresh reroll this action produces
    const room = farkleRoom()
    const straightRolled = {
      ...room,
      farkle: {
        ...room.farkle,
        kept: [],
        turnScore: 0,
        dice: [1, 2, 3, 4, 5, 6].map((val, id) => ({ id, val, sel: true, rot: 0 })),
      },
    }

    const result = applyAction(straightRolled, { type: 'farkleRoll' }, 'h1')

    expect(result.farkle.kept).toEqual([]) // reset — every die is back in play
    expect(result.farkle.dice).toHaveLength(6)
    expect(result.farkle.hotDice).toBe(true)
  })

  it('sets hotDice true when 6 dice are used up across multiple partial keeps', () => {
    mockSequentialDiceVals([2, 4, 1, 5, 3, 6])
    const room = farkleRoom()
    // Already kept two 5s from an earlier roll this turn; now selecting four more 1s to reach 6.
    const partiallyKept = {
      ...room,
      farkle: {
        ...room.farkle,
        kept: [5, 5],
        turnScore: 100,
        dice: [1, 1, 1, 1].map((val, id) => ({ id, val, sel: true, rot: 0 })),
      },
    }

    const result = applyAction(partiallyKept, { type: 'farkleRoll' }, 'h1')

    expect(result.farkle.kept).toEqual([])
    expect(result.farkle.hotDice).toBe(true)
  })

  it('leaves hotDice false for an ordinary roll that does not use up all 6 dice', () => {
    mockSequentialDiceVals([2, 2, 2, 2]) // remaining 4 dice re-rolled, scores (three 2s + spare)
    const room = farkleRoom()
    const partialSelect = {
      ...room,
      farkle: {
        ...room.farkle,
        kept: [],
        turnScore: 0,
        // Only 2 of the 6 dice selected (a single scoring pair-of-5s is not standard, so use a
        // lone 1 and 5 — each scores alone) — kept only reaches 2, nowhere near 6.
        dice: [{ id: 0, val: 1, sel: true, rot: 0 }, { id: 1, val: 5, sel: true, rot: 0 }, { id: 2, val: 2, sel: false, rot: 0 }, { id: 3, val: 3, sel: false, rot: 0 }],
      },
    }

    const result = applyAction(partialSelect, { type: 'farkleRoll' }, 'h1')

    expect(result.farkle.kept).toEqual([1, 5])
    expect(result.farkle.hotDice).toBe(false)
  })

  it('resets a stale hotDice flag to false on the next bank', () => {
    const room = farkleRoom()
    // turnScore must clear the opening threshold (500, from initFarkle's default openingScore)
    // or farkleBank rejects the action and hotDice would trivially stay unchanged — not the
    // reset-on-success path this test means to cover.
    const afterHotDice = { ...room, farkle: { ...room.farkle, hotDice: true, dice: [{ id: 0, val: 5, sel: true, rot: 0 }], turnScore: 600 } }

    const result = applyAction(afterHotDice, { type: 'farkleBank' }, 'h1')

    expect(result.farkle.hotDice).toBe(false)
  })

  it('resets a stale hotDice flag to false on the next end-turn', () => {
    const room = farkleRoom()
    const afterHotDiceBust = { ...room, farkle: { ...room.farkle, hotDice: true, farkle: true } }

    const result = applyAction(afterHotDiceBust, { type: 'farkleEndTurn' }, 'h1')

    expect(result.farkle.hotDice).toBe(false)
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

describe('hangman', () => {
  // Two human seats: startHangmanRound puts the setter opposite the guesser (guesserIdx
  // starts at 1), so the host ('h1') sets the first word and the guest ('g1') guesses it.
  function hangmanRoom(): RoomState {
    let room = makeRoom('TEST-7', 'hangman', 'Host', 'h1')
    room = addSeat(room, 'g1', 'Guest', false)
    return applyAction(room, { type: 'startGame' }, 'h1')
  }

  function setWord(room: RoomState, word: string, by = 'h1') {
    return applyAction(room, { type: 'hangmanSetWord', word }, by)
  }

  function guess(room: RoomState, letter: string, by = 'g1') {
    return applyAction(room, { type: 'hangmanGuess', letter }, by)
  }

  it('starts with the setter opposite the guesser, awaiting a word', () => {
    const room = hangmanRoom()
    expect(room.hangman.phase).toBe('setting')
    expect(room.hangman.guesserIdx).toBe(1)
  })

  it('rejects a word submitted by anyone other than the setter', () => {
    const room = hangmanRoom()
    const result = setWord(room, 'CASTLE', 'g1')
    expect(result.hangman.phase).toBe('setting')
    expect(result.hangman.word).toBe('')
    expect(result.hangman.rejection?.seatId).toBe('g1')
    expect(result.hangman.rejection?.reason).toBeTruthy()
  })

  it('rejects a word under three letters', () => {
    const room = hangmanRoom()
    const result = setWord(room, 'AT')
    expect(result.hangman.phase).toBe('setting')
    expect(result.hangman.rejection?.seatId).toBe('h1')
  })

  it('rejects a word containing anything but letters and spaces, without silently stripping it', () => {
    const room = hangmanRoom()
    for (const bad of ['C@T', 'CAT!', 'CAT1', "CAT'S"]) {
      const result = setWord(room, bad)
      expect(result.hangman.phase).toBe('setting')
      expect(result.hangman.word).toBe('')
      expect(result.hangman.rejection?.reason).toBeTruthy()
    }
  })

  it('accepts a valid word, normalizing case and collapsing whitespace', () => {
    const room = hangmanRoom()
    const result = setWord(room, '  peanut   butter  ')
    expect(result.hangman.phase).toBe('guessing')
    expect(result.hangman.word).toBe('PEANUT BUTTER')
    expect(result.hangman.rejection).toBeNull()
  })

  it('rejects a guess submitted by anyone other than the guesser', () => {
    let room = hangmanRoom()
    room = setWord(room, 'CAT')
    const result = guess(room, 'C', 'h1')
    expect(result.hangman.guessed).toEqual([])
    expect(result.hangman.rejection?.seatId).toBe('h1')
  })

  it('rejects a guess outside the guessing phase (setting and roundOver)', () => {
    const settingRoom = hangmanRoom()
    const duringSetting = guess(settingRoom, 'C')
    expect(duringSetting.hangman.guessed).toEqual([])
    expect(duringSetting.hangman.rejection?.reason).toBeTruthy()

    let over = hangmanRoom()
    over = setWord(over, 'CAT')
    over = { ...over, hangman: { ...over.hangman, phase: 'roundOver' } }
    const duringRoundOver = guess(over, 'C')
    expect(duringRoundOver.hangman.guessed).toEqual([])
    expect(duringRoundOver.hangman.rejection?.reason).toBeTruthy()
  })

  it('normalizes a lowercase guess to uppercase and accepts it', () => {
    let room = hangmanRoom()
    room = setWord(room, 'CAT')
    room = guess(room, 'c')
    expect(room.hangman.guessed).toEqual(['C'])
    expect(room.hangman.rejection).toBeNull()
  })

  it('rejects a duplicate guessed letter without changing guessed/wrong', () => {
    let room = hangmanRoom()
    room = setWord(room, 'CAT')
    room = guess(room, 'C')
    const dup = guess(room, 'c')
    expect(dup.hangman.guessed).toEqual(['C'])
    expect(dup.hangman.rejection?.reason).toBeTruthy()
  })

  it('rejects empty, multi-character, and punctuation guess payloads without mutating state', () => {
    let room = hangmanRoom()
    room = setWord(room, 'CAT')
    for (const bad of ['', 'AB', '1', '!', '  ', 'a1', 'AA']) {
      const result = guess(room, bad)
      expect(result.hangman.guessed).toEqual(room.hangman.guessed)
      expect(result.hangman.wrong).toEqual(room.hangman.wrong)
      expect(result.hangman.rejection?.reason).toBeTruthy()
    }
  })

  it('clears the rejection notice on the next legal guess', () => {
    let room = hangmanRoom()
    room = setWord(room, 'CAT')
    room = guess(room, '1') // rejected, malformed
    expect(room.hangman.rejection).not.toBeNull()
    room = guess(room, 'C') // legal
    expect(room.hangman.rejection).toBeNull()
  })

  it('reveals every occurrence of a correctly guessed repeated letter and solves multi-word phrases', () => {
    let room = hangmanRoom()
    room = setWord(room, 'SEA SHELL')
    for (const letter of ['S', 'E', 'A', 'H', 'L']) room = guess(room, letter)
    expect(room.hangman.phase).toBe('roundOver')
    expect(room.hangman.over).toBe(true)
    expect(room.hangman.wins.g1).toBe(1)
    expect(room.seats.find((s) => s.id === 'g1')?.score).toBe(1)
  })

  it('loses the round after six wrong guesses without awarding a win', () => {
    let room = hangmanRoom()
    room = setWord(room, 'CAT')
    for (const letter of ['B', 'D', 'F', 'G', 'H', 'J']) room = guess(room, letter)
    expect(room.hangman.phase).toBe('roundOver')
    expect(room.hangman.over).toBe(true)
    expect(room.hangman.wrong.length).toBe(6)
    expect(room.hangman.wins).toEqual({ h1: 0, g1: 0 })
  })

  it('alternates the guesser for the next round after a non-match-ending round', () => {
    let room = hangmanRoom()
    room = setWord(room, 'CAT')
    for (const letter of ['B', 'D', 'F', 'G', 'H', 'J']) room = guess(room, letter)
    expect(room.hangman.pendingWinnerId).toBeNull()
    room = applyAction(room, { type: 'hangmanAdvanceRound' }, 'h1')
    expect(room.screen).toBe('hangman')
    expect(room.hangman.guesserIdx).toBe(0)
  })

  it('rejects hangmanAdvanceRound before the round is over', () => {
    const room = hangmanRoom()
    const result = applyAction(room, { type: 'hangmanAdvanceRound' }, 'h1')
    expect(result).toBe(room)
  })

  it('sends the match to results once a seat reaches two wins', () => {
    let room = hangmanRoom()
    room = {
      ...room,
      hangman: { ...room.hangman, phase: 'roundOver', over: true, pendingWinnerId: 'g1', wins: { h1: 0, g1: 2 } },
    }
    room = applyAction(room, { type: 'hangmanAdvanceRound' }, 'h1')
    expect(room.screen).toBe('results')
    expect(room.winnerId).toBe('g1')
  })
})

describe('yahtzee — room transitions', () => {
  it('starts with no dice and three rolls left', () => {
    const room = yahtzeeRoom()
    expect(room.yahtzee.dice).toEqual([])
    expect(room.yahtzee.rollsLeft).toBe(3)
  })

  it('an initial roll produces five dice and consumes one roll', () => {
    const room = yahtzeeRoom()
    const result = applyAction(room, { type: 'yahtzeeRoll' }, 'h1')
    expect(result.yahtzee.dice).toHaveLength(5)
    expect(result.yahtzee.rollsLeft).toBe(2)
  })

  it('allows exactly three rolls, then rejects a fourth', () => {
    let room = yahtzeeRoom()
    room = applyAction(room, { type: 'yahtzeeRoll' }, 'h1')
    room = applyAction(room, { type: 'yahtzeeRoll' }, 'h1')
    room = applyAction(room, { type: 'yahtzeeRoll' }, 'h1')
    expect(room.yahtzee.rollsLeft).toBe(0)
    const diceBefore = room.yahtzee.dice
    const result = applyAction(room, { type: 'yahtzeeRoll' }, 'h1')
    expect(result.yahtzee.dice).toEqual(diceBefore)
    expect(result.yahtzee.rollsLeft).toBe(0)
    expect(result.yahtzee.rejection?.seatId).toBe('h1')
    expect(result.yahtzee.rejection?.reason).toMatch(/no rolls left/i)
  })

  it('a held die keeps its value across a reroll', () => {
    let room = yahtzeeRoom()
    room = applyAction(room, { type: 'yahtzeeRoll' }, 'h1')
    const heldDie = room.yahtzee.dice[0]
    room = applyAction(room, { type: 'yahtzeeToggleHold', dieId: heldDie.id }, 'h1')
    expect(room.yahtzee.dice.find((d) => d.id === heldDie.id)?.sel).toBe(true)
    room = applyAction(room, { type: 'yahtzeeRoll' }, 'h1')
    const stillHeld = room.yahtzee.dice.find((d) => d.id === heldDie.id)
    expect(stillHeld?.sel).toBe(true)
    expect(stillHeld?.val).toBe(heldDie.val)
  })

  it('toggling an unknown/stale dieId is a harmless no-op, not a rejection', () => {
    let room = yahtzeeRoom()
    room = applyAction(room, { type: 'yahtzeeRoll' }, 'h1')
    const result = applyAction(room, { type: 'yahtzeeToggleHold', dieId: 9999 }, 'h1')
    expect(result.yahtzee.dice).toEqual(room.yahtzee.dice)
    expect(result.yahtzee.rejection).toBeNull()
  })

  it('rejects roll/hold/score from a seat that is not the active turn', () => {
    let room = yahtzeeRoom()
    room = applyAction(room, { type: 'yahtzeeRoll' }, 'h1')
    const dieId = room.yahtzee.dice[0].id

    const rollResult = applyAction(room, { type: 'yahtzeeRoll' }, 'g1')
    expect(rollResult.yahtzee.dice).toEqual(room.yahtzee.dice)
    expect(rollResult.yahtzee.rejection?.seatId).toBe('g1')
    expect(rollResult.yahtzee.rejection?.reason).toBe("It's not your turn.")

    const holdResult = applyAction(room, { type: 'yahtzeeToggleHold', dieId }, 'g1')
    expect(holdResult.yahtzee.dice).toEqual(room.yahtzee.dice)
    expect(holdResult.yahtzee.rejection?.seatId).toBe('g1')

    const scoreResult = applyAction(room, { type: 'yahtzeeScore', category: 'chance' }, 'g1')
    expect(scoreResult.yahtzee.cards.g1?.chance).toBeUndefined()
    expect(scoreResult.yahtzee.rejection?.seatId).toBe('g1')
  })

  it('rejects scoring before the first roll of a turn', () => {
    const room = yahtzeeRoom()
    const result = applyAction(room, { type: 'yahtzeeScore', category: 'chance' }, 'h1')
    expect(result.yahtzee.cards.h1?.chance).toBeUndefined()
    expect(result.yahtzee.rejection?.reason).toMatch(/roll/i)
  })

  it('an exhausted-roll (zero rolls left) score is still legal', () => {
    let room = yahtzeeRoom()
    room = applyAction(room, { type: 'yahtzeeRoll' }, 'h1')
    room = applyAction(room, { type: 'yahtzeeRoll' }, 'h1')
    room = applyAction(room, { type: 'yahtzeeRoll' }, 'h1')
    expect(room.yahtzee.rollsLeft).toBe(0)
    const result = applyAction(room, { type: 'yahtzeeScore', category: 'chance' }, 'h1')
    expect(result.yahtzee.cards.h1?.chance).toBeDefined()
  })

  it('rejects scoring an already-filled category', () => {
    const room = setYahtzee(yahtzeeRoom(), [1, 2, 3, 4, 5], { chance: 15 })
    const result = applyAction(room, { type: 'yahtzeeScore', category: 'chance' }, 'h1')
    expect(result.yahtzee.cards.h1?.chance).toBe(15)
    expect(result.yahtzee.rejection?.reason).toMatch(/already filled/i)
  })

  it('rejects an unknown/malformed category before it touches the card, and 13 of them cannot force match completion', () => {
    let room = setYahtzee(yahtzeeRoom(), [1, 2, 3, 4, 5], {})
    for (let i = 0; i < 13; i++) {
      room = applyAction(room, { type: 'yahtzeeScore', category: `bogus${i}` as unknown as YCategory }, 'h1')
    }
    expect(room.yahtzee.cards.h1).toEqual({})
    expect(room.screen).toBe('yahtzee')
    expect(room.turnIdx).toBe(0)
    expect(room.yahtzee.rejection?.seatId).toBe('h1')
    expect(room.yahtzee.rejection?.reason).toBe('Not a real scoring category.')
  })

  it('clears a stale rejection notice on the next legal action', () => {
    const room = setYahtzee(yahtzeeRoom(), [1, 2, 3, 4, 5], { chance: 15 })
    const rejected = applyAction(room, { type: 'yahtzeeScore', category: 'chance' }, 'h1')
    expect(rejected.yahtzee.rejection?.seatId).toBe('h1')
    const result = applyAction(rejected, { type: 'yahtzeeScore', category: 'ones' }, 'h1')
    expect(result.yahtzee.rejection).toBeNull()
  })

  it('fills all 13 categories for every seat, advancing the round each time, and ends the match', () => {
    let room = yahtzeeRoom()
    for (let round = 0; round < 13; round++) {
      expect(room.yahtzee.round).toBe(round + 1)
      for (let turn = 0; turn < 2; turn++) {
        const seatId = room.seats[room.turnIdx].id
        room = applyAction(room, { type: 'yahtzeeRoll' }, seatId)
        room = applyAction(room, { type: 'yahtzeeScore', category: Y_CATEGORIES[round] }, seatId)
      }
    }
    expect(room.screen).toBe('results')
    expect(Object.keys(room.yahtzee.cards.h1 ?? {})).toHaveLength(13)
    expect(Object.keys(room.yahtzee.cards.g1 ?? {})).toHaveLength(13)
    expect(room.winnerId).toBeTruthy()
  })

  it('breaks a tie for the final grand total by stable seat order (earliest seat wins)', () => {
    // Every category filled at 0 except chance, which both seats will land on 15 (1+2+3+4+5).
    // g1 has already completed all 13 boxes; h1 is one box away (chance) — scoring it completes
    // the match with both seats tied at 15. This documents CURRENT tie-break behavior (see the
    // matching bullet in src/data/rules.ts), not a re-derived rule — matches the Farkle precedent.
    const zeroCard = Object.fromEntries(Y_CATEGORIES.filter((c) => c !== 'chance').map((c) => [c, 0])) as Partial<Record<YCategory, number>>
    let room = yahtzeeRoom()
    room = {
      ...room,
      seats: room.seats.map((s) => (s.id === 'g1' ? { ...s, score: 15 } : s)),
      yahtzee: {
        ...room.yahtzee,
        dice: [1, 2, 3, 4, 5].map((val, id) => ({ id, val, sel: false, rot: 0 })),
        rollsLeft: 1,
        cards: { h1: zeroCard, g1: { ...zeroCard, chance: 15 } },
      },
    }
    const result = applyAction(room, { type: 'yahtzeeScore', category: 'chance' }, 'h1')
    expect(result.screen).toBe('results')
    expect(result.seats.find((s) => s.id === 'h1')!.score).toBe(15)
    expect(result.seats.find((s) => s.id === 'g1')!.score).toBe(15)
    expect(result.winnerId).toBe('h1')
  })
})
