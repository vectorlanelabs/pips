import { describe, expect, it } from 'vitest'
import { BOT_LETTER_ORDER, decideHangmanLetter, HANGMAN_WORDS, isWordSolved, randomWord } from './hangman'

describe('randomWord', () => {
  it('always returns a word from the fixed word list', () => {
    for (let i = 0; i < 50; i++) {
      expect(HANGMAN_WORDS).toContain(randomWord())
    }
  })
})

describe('decideHangmanLetter', () => {
  it('follows the letter-frequency order, skipping already-guessed letters', () => {
    expect(decideHangmanLetter([])).toBe('E')
    expect(decideHangmanLetter(['E'])).toBe('A')
    expect(decideHangmanLetter(['E', 'A', 'O'])).toBe('R')
  })

  it('falls back to alphabetical order once the frequency order is exhausted', () => {
    const guessed = BOT_LETTER_ORDER.slice(0, -1) // every letter but the last frequency pick
    const next = decideHangmanLetter(guessed)
    expect(guessed).not.toContain(next)
  })

  it('never returns an already-guessed letter across the whole alphabet', () => {
    const all = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
    expect(decideHangmanLetter(all)).toBe('A') // exhausted fallback default
  })
})

describe('isWordSolved', () => {
  it('treats spaces as always-revealed, not guessable', () => {
    expect(isWordSolved('SEA SHELL', 'SEAHL'.split(''))).toBe(true)
  })

  it('requires every distinct non-space letter to be guessed, including repeats', () => {
    expect(isWordSolved('PUZZLE', 'PUZLE'.split(''))).toBe(true)
    expect(isWordSolved('PUZZLE', 'PUZL'.split(''))).toBe(false)
  })

  it('is false when any letter is missing', () => {
    expect(isWordSolved('CAT', ['C', 'A'])).toBe(false)
  })
})
