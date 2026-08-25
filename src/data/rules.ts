import type { Game } from '../types'

export interface RuleRow { label: string; value: string }
export interface RuleContent { intro: string; scoring: RuleRow[]; bullets: string[] }

export const RULES: Record<Game, RuleContent> = {
  farkle: {
    intro: 'Push your luck with six dice. Roll, keep what scores, and decide whether to bank it or roll again.',
    scoring: [
      { label: 'Single 1', value: '100' },
      { label: 'Single 5', value: '50' },
      { label: 'Three 1s', value: '1,000' },
      { label: 'Three of a kind (2–6)', value: 'face × 100' },
      { label: 'Four of a kind', value: 'double the triple (four 1s = 2,000)' },
      { label: 'Five of a kind', value: 'four times the triple (five 1s = 4,000)' },
      { label: 'Six of a kind', value: 'eight times the triple (six 1s = 8,000)' },
      { label: 'Three pairs', value: '1,500' },
      { label: 'Straight 1–6', value: '1,500' },
    ],
    bullets: [
      'A roll with no scoring dice at all is a farkle — the whole turn total is lost.',
      'Any dice you set aside must, together, score entirely.',
      'Keep all six scoring dice and all six come back — hot dice.',
      'Bank at least 500 the first time you get on the board.',
      'First to 10,000 triggers a final round; highest score when it comes back around wins.',
      'A tie for highest score goes to whoever sits earliest at the table.',
    ],
  },
  yahtzee: {
    intro: 'Thirteen turns each. Roll up to three times a turn, holding any dice in between, then fill one box on the card.',
    scoring: [
      { label: 'Ones – Sixes', value: 'sum of that face' },
      { label: 'Three of a kind', value: 'sum of all five' },
      { label: 'Four of a kind', value: 'sum of all five' },
      { label: 'Full house', value: '25' },
      { label: 'Small straight', value: '30' },
      { label: 'Large straight', value: '40' },
      { label: 'Yahtzee', value: '50' },
      { label: 'Chance', value: 'sum of all five' },
      { label: 'Upper bonus', value: '35 at 63+' },
    ],
    bullets: [
      'You must roll at least once before writing a score.',
      'Every category gets used exactly once — a zero is allowed if nothing fits.',
      'Highest grand total after thirteen turns wins.',
    ],
  },
  ttt: {
    intro: 'Standard three-in-a-row. Whoever started alternates each game.',
    scoring: [],
    bullets: [
      'A draw is replayed and scores nothing.',
      'First to three games wins the match.',
    ],
  },
  connect4: {
    intro: 'Click a column to drop a disc — it falls to the lowest open slot in that column.',
    scoring: [],
    bullets: [
      'Four in a row — across, down, or on either diagonal — wins the game.',
      'A full board with no four in a row is a draw: it replays and nobody scores.',
      'First to three games wins the match.',
      'The starting player alternates every game.',
    ],
  },
  hangman: {
    intro: 'One of you sets a word, the other guesses it letter by letter.',
    scoring: [],
    bullets: [
      'Six wrong letters loses the round.',
      'Solving the word scores a point.',
      'First to two words solved wins the match.',
      'Roles alternate every round.',
    ],
  },
}
