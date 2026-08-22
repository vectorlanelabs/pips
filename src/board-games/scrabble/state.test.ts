import { describe, it, expect } from 'vitest'
import { createTileBag, createScrabbleGame, RACK_SIZE } from './state.ts'
import { cardCount } from '../../card-engine/zones.ts'

describe('Scrabble tile bag', () => {
  it('should create exactly 100 tiles', () => {
    const bag = createTileBag()
    expect(bag.length).toBe(100)
  })

  it('should have correct letter distribution', () => {
    const bag = createTileBag()
    const counts: Record<string, number> = {}

    for (const tile of bag) {
      const letter = tile.letter === '' ? 'BLANK' : tile.letter
      counts[letter] = (counts[letter] ?? 0) + 1
    }

    expect(counts.A).toBe(9)
    expect(counts.E).toBe(12)
    expect(counts.I).toBe(9)
    expect(counts.O).toBe(8)
    expect(counts.U).toBe(4)
    expect(counts.Z).toBe(1)
    expect(counts.Q).toBe(1)
    expect(counts.X).toBe(1)
    expect(counts.J).toBe(1)
    expect(counts.K).toBe(1)
    expect(counts.BLANK).toBe(2)
  })

  it('should have correct point values', () => {
    const bag = createTileBag()

    const points: Record<string, number> = {}
    for (const tile of bag) {
      if (tile.letter !== '') {
        points[tile.letter] = tile.points
      }
    }

    expect(points.A).toBe(1)
    expect(points.B).toBe(3)
    expect(points.Q).toBe(10)
    expect(points.Z).toBe(10)
    expect(points.X).toBe(8)
  })

  it('should create blank tiles with empty letter and 0 points', () => {
    const bag = createTileBag()
    const blanks = bag.filter((t) => t.letter === '')
    expect(blanks.length).toBe(2)
    for (const blank of blanks) {
      expect(blank.points).toBe(0)
      expect(blank.id).toMatch(/^blank-/)
    }
  })
})

describe('Scrabble game initialization', () => {
  it('should create a game for 2 players', () => {
    const game = createScrabbleGame(['p1', 'p2'], 42)
    expect(game.session.publicState.turn.playerOrder).toEqual(['p1', 'p2'])
    expect(cardCount(game.session.privateStates.p1.rack)).toBe(RACK_SIZE)
    expect(cardCount(game.session.privateStates.p2.rack)).toBe(RACK_SIZE)
    expect(cardCount(game.bag)).toBe(100 - RACK_SIZE * 2)
  })

  it('should create a game for 3 players', () => {
    const game = createScrabbleGame(['p1', 'p2', 'p3'], 42)
    expect(game.session.publicState.turn.playerOrder).toEqual(['p1', 'p2', 'p3'])
    expect(cardCount(game.session.privateStates.p1.rack)).toBe(RACK_SIZE)
    expect(cardCount(game.session.privateStates.p2.rack)).toBe(RACK_SIZE)
    expect(cardCount(game.session.privateStates.p3.rack)).toBe(RACK_SIZE)
    expect(cardCount(game.bag)).toBe(100 - RACK_SIZE * 3)
  })

  it('should create a game for 4 players', () => {
    const game = createScrabbleGame(['p1', 'p2', 'p3', 'p4'], 42)
    expect(cardCount(game.session.privateStates.p1.rack)).toBe(RACK_SIZE)
    expect(cardCount(game.session.privateStates.p2.rack)).toBe(RACK_SIZE)
    expect(cardCount(game.session.privateStates.p3.rack)).toBe(RACK_SIZE)
    expect(cardCount(game.session.privateStates.p4.rack)).toBe(RACK_SIZE)
    expect(cardCount(game.bag)).toBe(100 - RACK_SIZE * 4)
  })

  it('should conserve total tile count (100)', () => {
    for (const playerCount of [2, 3, 4]) {
      const playerIds = Array.from({ length: playerCount }, (_, i) => `p${i}`)
      const game = createScrabbleGame(playerIds, 42)

      let total = cardCount(game.bag)
      for (const pid of playerIds) {
        total += cardCount(game.session.privateStates[pid].rack)
      }
      expect(total).toBe(100)
    }
  })

  it('should initialize empty 15x15 board', () => {
    const game = createScrabbleGame(['p1', 'p2'], 42)
    expect(game.session.publicState.board.length).toBe(15)
    for (const row of game.session.publicState.board) {
      expect(row.length).toBe(15)
      for (const cell of row) {
        expect(cell).toBeNull()
      }
    }
  })

  it('should initialize scores to 0', () => {
    const game = createScrabbleGame(['p1', 'p2'], 42)
    expect(game.session.publicState.scores).toEqual({ p1: 0, p2: 0 })
  })

  it('should initialize game stage to play', () => {
    const game = createScrabbleGame(['p1', 'p2'], 42)
    expect(game.session.publicState.stage).toBe('play')
  })

  it('should initialize consecutive passes to 0', () => {
    const game = createScrabbleGame(['p1', 'p2'], 42)
    expect(game.session.publicState.consecutivePasses).toBe(0)
  })

  it('should have no last placement initially', () => {
    const game = createScrabbleGame(['p1', 'p2'], 42)
    expect(game.session.publicState.lastPlacement).toBeNull()
  })

  it('should have different tiles for different seeds', () => {
    const game1 = createScrabbleGame(['p1', 'p2'], 1)
    const game2 = createScrabbleGame(['p1', 'p2'], 2)

    const rack1 = game1.session.privateStates.p1.rack.cards.map((t) => t.id).sort()
    const rack2 = game2.session.privateStates.p1.rack.cards.map((t) => t.id).sort()

    expect(rack1).not.toEqual(rack2)
  })
})
