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

  it('rejects invalid plays', () => {
    const room = connect4Room()
    expect(play(room, 0, 'g1')).toBe(room)
    const full = { ...room, connect4: { ...room.connect4, board: Array(42).fill(null).map((cell, index) => index % 7 === 0 ? 0 : cell) } }
    expect(play(full, 0)).toBe(full)
    const over = { ...room, connect4: { ...room.connect4, roundOver: true } }
    expect(play(over, 0)).toBe(over)
    expect(play(room, -1)).toBe(room)
    expect(play(room, 7)).toBe(room)
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
