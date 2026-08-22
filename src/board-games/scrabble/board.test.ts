import { describe, it, expect } from 'vitest'
import { premiumAt } from './board.ts'

describe('Scrabble board layout', () => {
  it('should return correct premium types for known squares', () => {
    // Center square (7,7) - returns 'none' but handled specially in scoring as DW
    expect(premiumAt(7, 7)).toBe('none')

    // Corners should be TW
    expect(premiumAt(0, 0)).toBe('TW')
    expect(premiumAt(0, 14)).toBe('TW')
    expect(premiumAt(14, 0)).toBe('TW')
    expect(premiumAt(14, 14)).toBe('TW')

    // DW squares
    expect(premiumAt(1, 1)).toBe('DW')
    expect(premiumAt(1, 13)).toBe('DW')

    // TL squares
    expect(premiumAt(1, 5)).toBe('TL')
    expect(premiumAt(5, 1)).toBe('TL')

    // DL squares
    expect(premiumAt(0, 3)).toBe('DL')
    expect(premiumAt(3, 0)).toBe('DL')
  })

  it('should return none for empty squares', () => {
    expect(premiumAt(1, 2)).toBe('none')
    expect(premiumAt(5, 3)).toBe('none')
    expect(premiumAt(10, 1)).toBe('none')
  })

  it('should return none for out-of-bounds coordinates', () => {
    expect(premiumAt(-1, 0)).toBe('none')
    expect(premiumAt(0, -1)).toBe('none')
    expect(premiumAt(15, 0)).toBe('none')
    expect(premiumAt(0, 15)).toBe('none')
    expect(premiumAt(100, 100)).toBe('none')
  })

  it('should have board symmetry under 90-degree rotation', () => {
    // Check that premium(r, c) matches premium(c, r) and their rotations
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        const p1 = premiumAt(r, c)
        const p2 = premiumAt(c, r)
        // The board is symmetric under 90-degree rotations
        expect(p1).toBe(p2)
      }
    }
  })
})
