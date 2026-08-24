export type Game = 'farkle' | 'yahtzee' | 'ttt' | 'hangman' | 'connect4'
export type Screen = 'entry' | 'room' | Game | 'results'

export const GAME_COLOR: Record<Game, string> = {
  farkle: 'var(--farkle-color)',
  yahtzee: 'var(--yahtzee-color)',
  ttt: 'var(--ttt-color)',
  hangman: 'var(--hangman-color)',
  connect4: 'var(--connect4-color)',
}

export const GAME_LABEL: Record<Game, string> = {
  farkle: 'Farkle',
  yahtzee: 'Yahtzee',
  ttt: 'Tic Tac Toe',
  hangman: 'Hangman',
  connect4: 'Connect 4',
}

export const GAME_CODE_PREFIX: Record<Game, string> = {
  farkle: 'FK',
  yahtzee: 'YZ',
  ttt: 'TT',
  hangman: 'HM',
  connect4: 'C4',
}

export const GAME_BLURB: Record<Game, string> = {
  farkle: 'Push your luck with six dice',
  yahtzee: 'Thirteen boxes, three rolls a turn',
  ttt: 'Three in a row, best of five',
  hangman: 'Set a word, guess a word',
  connect4: 'Drop discs — four in a row wins',
}

export const GAME_PLAYER_RANGE: Record<Game, string> = {
  farkle: '2–8 players',
  yahtzee: '2–8 players',
  ttt: '2 players',
  hangman: '2 players',
  connect4: '2 players',
}

// Farkle and Yahtzee scale to a party; Tic Tac Toe, Hangman, and Connect 4 are inherently two-player.
export const GAME_MAX_SEATS: Record<Game, number> = {
  farkle: 8,
  yahtzee: 8,
  ttt: 2,
  hangman: 2,
  connect4: 2,
}

export const GAME_MIN_SEATS: Record<Game, number> = {
  farkle: 1,
  yahtzee: 1,
  ttt: 2,
  hangman: 2,
  connect4: 2,
}

// Seat 0's color is always violet (host-shelf convention); after that we cycle the palette.
export const SEAT_PALETTE = ['#6c4cff', '#ff9f1c', '#0fb5a0', '#ff5d73', '#3ddc97', '#8a5cf6', '#f45b8a', '#20a4d6']

export type BotDifficulty = 'easy' | 'medium' | 'hard'

export interface Seat {
  id: string
  name: string
  bot: boolean
  isHost: boolean
  color: string
  initials: string
  score: number
  farkles: number
  best: number
}

export interface LogEntry {
  who: string
  color: string
  amount: number
  tone: 'bank' | 'farkle' | 'note'
}

export interface Die {
  id: number
  val: number
  sel: boolean
  rot: number
}

export interface FarkleState {
  dice: Die[]
  kept: number[]
  turnScore: number
  rolling: boolean
  farkle: boolean
  lost: number
  finalRound: boolean
  finalTrigger: string | null
  status: string
  round: number
  log: LogEntry[]
  winningScore: number
  openingScore: number
}

export type YCategory =
  | 'ones' | 'twos' | 'threes' | 'fours' | 'fives' | 'sixes'
  | 'threeKind' | 'fourKind' | 'fullHouse' | 'smallStraight' | 'largeStraight' | 'yahtzee' | 'chance'

export interface YahtzeeState {
  dice: Die[]
  rollsLeft: number
  cards: Record<string, Partial<Record<YCategory, number>>>
  bonuses: Record<string, number>
  round: number
  rolling: boolean
  status: string
  lastTurn: { name: string; color: string; category: YCategory; points: number } | null
}

export interface TttState {
  board: (number | null)[]
  starter: number
  winLine: number[]
  over: boolean
  roundOver: boolean
  pendingWinnerId: string | null
  wins: Record<string, number>
  // Transient feedback for a rejected tttPlay — set on the room-wide broadcast state, but
  // only rendered by the seat named in `seatId` (see TttTable). `nonce` lets the same
  // rejection reason fire visible feedback twice in a row (e.g. two stale clicks on the
  // same occupied square).
  rejection: { seatId: string; reason: string; nonce: number } | null
}

export interface Connect4State {
  board: (number | null)[]
  starter: number
  winLine: number[]
  over: boolean
  roundOver: boolean
  pendingWinnerId: string | null
  status: string
  wins: Record<string, number>
}

export type HangmanPhase = 'setting' | 'guessing' | 'roundOver'

export interface HangmanState {
  word: string
  guessed: string[]
  wrong: string[]
  phase: HangmanPhase
  guesserIdx: number
  over: boolean
  pendingWinnerId: string | null
  status: string
  wins: Record<string, number>
}

export interface RoomState {
  screen: Screen
  game: Game
  code: string
  seats: Seat[]
  turnIdx: number
  botPace: number
  botDifficulty: BotDifficulty
  showLog: boolean
  farkle: FarkleState
  yahtzee: YahtzeeState
  ttt: TttState
  hangman: HangmanState
  connect4: Connect4State
  winnerId: string | null
}

export type Action =
  | { type: 'pickGame'; game: Game }
  | { type: 'addBot' }
  | { type: 'setBotDifficulty'; difficulty: BotDifficulty }
  | { type: 'startGame' }
  | { type: 'rematch' }
  | { type: 'farkleRoll' }
  | { type: 'farkleToggle'; dieId: number }
  | { type: 'farkleBank' }
  | { type: 'farkleEndTurn' }
  | { type: 'yahtzeeRoll' }
  | { type: 'yahtzeeToggleHold'; dieId: number }
  | { type: 'yahtzeeScore'; category: YCategory }
  | { type: 'tttPlay'; cell: number }
  | { type: 'tttAdvanceRound' }
  | { type: 'connect4Play'; col: number }
  | { type: 'connect4AdvanceRound' }
  | { type: 'hangmanSetWord'; word: string }
  | { type: 'hangmanGuess'; letter: string }
  | { type: 'hangmanAdvanceRound' }
