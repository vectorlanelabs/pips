import { describe, expect, it } from 'vitest'
import { checkWin, decideTttMove, isDraw } from './ttt'

function boardWith(seatIdx: number, cells: number[]): (number | null)[] {
  const board = Array(9).fill(null)
  cells.forEach((i) => { board[i] = seatIdx })
  return board
}

describe('checkWin', () => {
  it('detects all three horizontal lines', () => {
    for (const line of [[0, 1, 2], [3, 4, 5], [6, 7, 8]]) {
      expect(checkWin(boardWith(0, line), 0)?.sort((a, b) => a - b)).toEqual(line)
    }
  })

  it('detects all three vertical lines', () => {
    for (const line of [[0, 3, 6], [1, 4, 7], [2, 5, 8]]) {
      expect(checkWin(boardWith(0, line), 0)?.sort((a, b) => a - b)).toEqual(line)
    }
  })

  it('detects both diagonal lines', () => {
    for (const line of [[0, 4, 8], [2, 4, 6]]) {
      expect(checkWin(boardWith(0, line), 0)?.sort((a, b) => a - b)).toEqual(line)
    }
  })

  it('does not report a win for a partial line', () => {
    const board = boardWith(0, [0, 1])
    expect(checkWin(board, 0)).toBeNull()
  })

  it('does not report a win for a full line belonging to the other seat', () => {
    const board = boardWith(1, [0, 1, 2])
    expect(checkWin(board, 0)).toBeNull()
  })
})

describe('isDraw', () => {
  it('false when any cell is empty', () => {
    const board = boardWith(0, [0, 1, 2, 3, 4, 5, 6, 7])
    expect(isDraw(board)).toBe(false)
  })

  it('true once every cell is filled, regardless of owner', () => {
    const board = [0, 1, 0, 1, 0, 1, 1, 0, 1]
    expect(isDraw(board)).toBe(true)
  })
})

describe('checkWin vs isDraw precedence', () => {
  it('a full board that also completes a line is a win, not a draw', () => {
    // X: 0,1,2 (top row) plus fills the rest without forming another full line for O.
    const board = [0, 0, 0, 1, 1, 0, 0, 1, 1]
    expect(isDraw(board)).toBe(true)
    expect(checkWin(board, 0)?.sort((a, b) => a - b)).toEqual([0, 1, 2])
  })
})

describe('decideTttMove', () => {
  it('takes an immediate win over anything else', () => {
    // me (0) has two in a row on the top row; also has an opportunity to block "opponent" (1),
    // but should take its own win instead.
    const board = boardWith(0, [0, 1])
    board[3] = 1
    board[4] = 1
    expect(decideTttMove(board, 0, 1)).toBe(2)
  })

  it('blocks an immediate opponent win when it has no win of its own', () => {
    const board = boardWith(1, [3, 4])
    expect(decideTttMove(board, 0, 1)).toBe(5)
  })

  it('takes the center when open and no win/block is available', () => {
    expect(decideTttMove(Array(9).fill(null), 0, 1)).toBe(4)
  })

  it('takes a corner when the center is taken and no win/block is available', () => {
    const board = Array(9).fill(null)
    board[4] = 1
    const move = decideTttMove(board, 0, 1)
    expect([0, 2, 6, 8]).toContain(move)
  })

  it('falls back to a remaining empty square when the center and every corner are taken', () => {
    // Center and all four corners (0,2,6,8) are occupied; only the edges (1,3,5,7) are open.
    const board = [0, null, 1, null, 0, null, 1, null, 0]
    const move = decideTttMove(board, 0, 1)
    expect([1, 3, 5, 7]).toContain(move)
  })

  it('never returns an already-occupied cell', () => {
    const board = [0, 1, 0, 1, null, 1, 0, 1, null]
    const move = decideTttMove(board, 0, 1)
    expect(board[move]).toBeNull()
  })
})
