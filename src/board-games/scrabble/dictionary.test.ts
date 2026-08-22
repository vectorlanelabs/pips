import { describe, it, expect } from 'vitest'

interface DAWGNode {
  [letter: string]: number | boolean
}

// Simple test fixture DAWG for unit testing
// Structure: each node is { [letter]: childIndex, end?: true }
const testDAWG: DAWGNode[] = [
  // Node 0: root
  { 'C': 1, 'D': 3, 'T': 5 },
  // Node 1: C
  { 'A': 2 },
  // Node 2: CA (end here for "CA", has child for CAT)
  { 'T': 2, 'end': true },
  // Node 3: D
  { 'O': 4 },
  // Node 4: DO (end here for "DO")
  { 'G': 2, 'end': true },
  // Node 5: T
  { 'H': 6, 'E': 8 },
  // Node 6: TH
  { 'E': 7 },
  // Node 7: THE (end here)
  { 'end': true },
  // Node 8: TE
  { 'A': 2, 'end': true },
]

function createTestDictionary() {
  const nodes = testDAWG

  function isWord(word: string): boolean {
    // Empty string should return false
    if (!word) return false

    let nodeIdx = 0
    const upper = word.toUpperCase()

    for (const char of upper) {
      const node = nodes[nodeIdx]
      if (!node) return false

      const next = node[char]
      if (typeof next === 'number') {
        nodeIdx = next
      } else {
        return false
      }
    }

    const finalNode = nodes[nodeIdx]
    return finalNode && finalNode.end === true
  }

  return { isWord }
}

describe('Dictionary - isWord function', () => {
  it('should recognize valid words', () => {
    const dict = createTestDictionary()
    expect(dict.isWord('CAT')).toBe(true)
    expect(dict.isWord('CA')).toBe(true)
    expect(dict.isWord('DO')).toBe(true)
    expect(dict.isWord('DOG')).toBe(true)
    expect(dict.isWord('THE')).toBe(true)
    expect(dict.isWord('TEA')).toBe(true)
  })

  it('should reject non-words', () => {
    const dict = createTestDictionary()
    expect(dict.isWord('CAR')).toBe(false)
    expect(dict.isWord('CATS')).toBe(false)
    expect(dict.isWord('X')).toBe(false)
    expect(dict.isWord('TAO')).toBe(false)
  })

  it('should be case-insensitive', () => {
    const dict = createTestDictionary()
    expect(dict.isWord('cat')).toBe(true)
    expect(dict.isWord('Cat')).toBe(true)
    expect(dict.isWord('CAT')).toBe(true)
    expect(dict.isWord('the')).toBe(true)
    expect(dict.isWord('ThE')).toBe(true)
    expect(dict.isWord('dog')).toBe(true)
    expect(dict.isWord('DoG')).toBe(true)
  })

  it('should return false for empty string', () => {
    const dict = createTestDictionary()
    expect(dict.isWord('')).toBe(false)
  })

  it('should handle partial words correctly', () => {
    const dict = createTestDictionary()
    // "C" is not a word in the fixture
    expect(dict.isWord('C')).toBe(false)
    // "D" is not a word in the fixture
    expect(dict.isWord('D')).toBe(false)
    // "T" is not a word in the fixture
    expect(dict.isWord('T')).toBe(false)
    // "TE" is a word (marked with end: true at node 8)
    expect(dict.isWord('TE')).toBe(true)
  })
})
