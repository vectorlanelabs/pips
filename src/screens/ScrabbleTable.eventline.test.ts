import { describe, it, expect } from 'vitest'
import { computeEventLine } from './ScrabbleTable'
import { createScrabbleGame } from '../board-games/scrabble/state'

// Regression (live report): every PASS and EXCHANGE clears lastPlacement, so
// the event line fell back to the pre-game "Waiting for the first play…" copy
// on every such opponent turn — mid-game, with words on the board — and the
// pass/exchange itself was never announced to anyone.
describe('computeEventLine', () => {
  const names = { p2: 'Flora' }

  function state(overrides: Partial<ReturnType<typeof createScrabbleGame>['session']['publicState']>) {
    const game = createScrabbleGame(['p1', 'p2'], 42)
    return { ...game.session.publicState, ...overrides }
  }

  it('announces an opponent pass by name instead of the first-play copy', () => {
    const s = state({ lastNonPlacement: { by: 'p2', kind: 'pass', count: 0 } })
    expect(computeEventLine(s, 'p1', names)).toBe('Flora passed.')
  })

  it('announces your own pass as You', () => {
    const s = state({ lastNonPlacement: { by: 'p1', kind: 'pass', count: 0 } })
    expect(computeEventLine(s, 'p1', names)).toBe('You passed.')
  })

  it('announces an exchange with its tile count', () => {
    const s = state({ lastNonPlacement: { by: 'p2', kind: 'exchange', count: 3 } })
    expect(computeEventLine(s, 'p1', names)).toBe('Flora exchanged 3 tiles.')
    const one = state({ lastNonPlacement: { by: 'p2', kind: 'exchange', count: 1 } })
    expect(computeEventLine(one, 'p1', names)).toBe('Flora exchanged 1 tile.')
  })

  it('announces a successful challenge', () => {
    const s = state({ lastNonPlacement: { by: 'p1', kind: 'challenge', count: 0 } })
    expect(computeEventLine(s, 'p1', names)).toBe('You challenged the word off the board.')
  })

  it('keeps the first-play copy only when truly nothing has happened', () => {
    const s = state({})
    expect(computeEventLine(s, 'p1', names)).toBe('Your move.')
    expect(computeEventLine(s, 'p2', names)).toBe('Waiting for the first play…')
  })

  it('a standing placement still wins over an older non-placement', () => {
    const s = state({
      lastPlacement: {
        by: 'p2',
        tiles: [],
        words: [{ word: 'CAT', score: 10 }],
        totalScore: 10,
        drawnTileIds: [],
        challengeable: true,
      },
      lastNonPlacement: { by: 'p1', kind: 'pass', count: 0 },
    })
    expect(computeEventLine(s, 'p1', names)).toBe('They played CAT for 10.')
  })
})
