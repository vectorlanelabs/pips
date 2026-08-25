import type {
  Action, Connect4State, FarkleState, Game, HangmanState, RoomState, Seat, TttState, YahtzeeState, YCategory,
} from '../types'
import { GAME_MAX_SEATS, SEAT_PALETTE } from '../types'
import { hasAnyScore, rollDice as rollFarkleDice, scoreSelection } from '../games/farkle'
import { Y_CATEGORIES, grandTotal, isFiveKind, rollDice as rollYahtzeeDice, scoreCategory, upperTotal } from '../games/yahtzee'
import { checkWin, isDraw } from '../games/ttt'
import { checkWin as c4CheckWin, isBoardFull, lowestOpenRow } from '../games/connect4'
import { isWordSolved, randomWord } from '../games/hangman'
import { randomBotName } from '../data/botNames'

const CODE_WORDS = [
  'BONE', 'DICE', 'CARD', 'GAME', 'PLAY', 'STAR', 'MOON', 'LEAF', 'WAVE', 'FOX',
  'BIRD', 'FROG', 'PLUM', 'MINT', 'SAGE', 'REEF', 'DUNE', 'PEAK', 'GLOW', 'SPARK',
  'LYNX', 'WOLF', 'HAWK', 'SEAL', 'CRAB', 'FERN', 'ROSE', 'OAK', 'ELM', 'PINE',
  'CORAL', 'STONE', 'CLOUD', 'RIVER', 'FIELD', 'GROVE', 'BRISK', 'SWIFT', 'BOLD', 'CALM',
  'GOLD', 'JADE', 'ONYX', 'PEARL', 'RUBY', 'AMBER', 'TEAL', 'PLUME', 'ECHO', 'FLAME',
  'TRAIL', 'SUMMIT', 'CANYON', 'HARBOR', 'MEADOW', 'THICKET', 'BRAMBLE', 'WILLOW', 'CEDAR', 'BIRCH',
  'DEER', 'GOAT', 'HORSE', 'SHEEP', 'MOUSE', 'TIGER', 'ZEBRA', 'PANDA', 'KOALA', 'OTTER',
  'BEAVER', 'RABBIT', 'TURTLE', 'WHALE', 'EAGLE', 'ROBIN', 'FALCON', 'PARROT', 'TOUCAN', 'CAMEL',
  'LLAMA', 'BISON', 'PUPPY', 'KITTEN', 'LIZARD', 'GECKO', 'SPIDER', 'BEETLE', 'MONKEY', 'OSPREY',
  'RAVEN', 'CRANE', 'STORK', 'SWAN', 'QUAIL', 'FINCH', 'WREN', 'LARK', 'DOVE', 'GNAT',
  'MOTH', 'WASP', 'HIVE', 'SLUG', 'SNAIL', 'WORM', 'NEWT', 'TOAD', 'MULE', 'PONY',
  'COLT', 'CALF', 'LAMB', 'CHICK', 'STAG', 'BUCK', 'IBEX', 'LEMUR', 'SLOTH', 'WEASEL',
  'FERRET', 'BADGER', 'SKUNK', 'MOLE', 'SHREW', 'IGUANA', 'COBRA', 'VIPER', 'PYTHON', 'GERBIL',
  'VIOLET', 'INDIGO', 'MAUVE', 'IVORY', 'SEPIA', 'OCHRE', 'BEIGE', 'LILAC', 'NAVY', 'OLIVE',
  'MAROON', 'SILVER', 'BRONZE', 'COPPER', 'COBALT', 'AZURE', 'MELON', 'LEMON', 'LIME', 'GRAPE',
  'MANGO', 'GUAVA', 'PAPAYA', 'KIWI', 'BERRY', 'APPLE', 'HONEY', 'SUGAR', 'SPICE', 'CLOVE',
  'BASIL', 'CUMIN', 'ONION', 'GARLIC', 'PEPPER', 'CELERY', 'POTATO', 'SQUASH', 'PICKLE', 'BAGEL',
  'BREAD', 'TOAST', 'BUTTER', 'CREAM', 'SYRUP', 'WAFFLE', 'MUFFIN', 'COOKIE', 'CANDY', 'MOCHA',
  'LATTE', 'JUICE', 'GRAY', 'BREEZE', 'FROST', 'MIST', 'HAZE', 'DAWN', 'DUSK', 'GLADE',
  'FOREST', 'JUNGLE', 'DESERT', 'OASIS', 'ISLAND', 'LAGOON', 'DELTA', 'CLIFF', 'CAVERN', 'GROTTO',
  'GEYSER', 'TUNDRA', 'VALLEY', 'HOLLOW', 'BLUFF', 'MARSH', 'SWAMP', 'BAYOU', 'CREEK', 'BROOK',
  'POND', 'LAKE', 'OCEAN', 'TIDE', 'SHORE', 'BEACH', 'SAND', 'SHELL', 'PEBBLE', 'QUARTZ',
  'CINDER', 'SMOKE', 'BLAZE', 'SHADOW', 'FOGGY', 'WINDY', 'RAINY', 'SUNNY', 'LAMP', 'CANDLE',
  'MIRROR', 'CLOCK', 'CHAIR', 'TABLE', 'COUCH', 'WINDOW', 'DOOR', 'PORCH', 'FENCE', 'GARDEN',
  'BASKET', 'BUCKET', 'KETTLE', 'TEAPOT', 'SPOON', 'FORK', 'PLATE', 'BOWL', 'GLASS', 'VASE',
  'BOTTLE', 'FLASK', 'PENCIL', 'CRAYON', 'PAINT', 'CANVAS', 'QUILT', 'YARN', 'NEEDLE', 'BUTTON',
  'RIBBON', 'SATIN', 'VELVET', 'LINEN', 'WOOL', 'SILK', 'COTTON', 'DENIM', 'SCARF', 'BOOT',
  'SHOE', 'SOCK', 'CAPE', 'CROWN', 'MEDAL', 'TOKEN', 'COIN', 'CHARM', 'RING', 'BANNER',
  'FLAG', 'KITE', 'DRUM', 'FLUTE', 'BANJO', 'CHIME', 'BELL', 'GONG', 'HORN', 'HAPPY',
  'JOLLY', 'LUCKY', 'BRAVE', 'NOBLE', 'GENTLE', 'QUIET', 'QUICK', 'CLEVER', 'WITTY', 'ZESTY',
  'SWEET', 'FRESH', 'CRISP', 'CHILL', 'COZY', 'WARM', 'COOL', 'TIDY', 'NEAT', 'SLEEK',
  'SHARP', 'SHINY', 'GLOSSY', 'FUZZY', 'FLUFFY', 'SOFT', 'PLUSH', 'CUDDLY', 'SPRY', 'NIMBLE',
  'AGILE', 'STURDY', 'STOUT', 'HARDY', 'MIGHTY', 'GRAND', 'ROYAL', 'REGAL', 'PRIME', 'SUPER',
  'SOLID', 'STEADY', 'HONEST', 'KINDLY', 'PERKY', 'BUBBLY', 'DAINTY', 'DAPPER', 'FANCY', 'CLASSY',
  'JAUNTY', 'PUZZLE', 'RIDDLE', 'MARBLE', 'PENNY', 'NICKEL', 'STAMP', 'LETTER', 'PARCEL', 'BUNDLE',
  'TRUNK', 'CHEST', 'CABIN', 'LODGE', 'TOWER', 'CASTLE', 'BRIDGE', 'TUNNEL', 'ISLE', 'HERON',
  'BOBCAT', 'WALRUS', 'WOMBAT', 'ORCA', 'LOTUS', 'MAPLE', 'FLINT', 'TULIP', 'DAISY', 'CROCUS',
  'ASTER', 'ORCHID', 'JASPER', 'BASALT', 'ATOLL', 'KELP', 'COMET', 'NEBULA', 'ORBIT', 'LUNAR',
  'METEOR', 'PLANET', 'GALAXY', 'ROCKET', 'VOYAGE', 'MOSS', 'BUNNY', 'OYSTER', 'MARLIN', 'FOAM',
  'CANOE', 'ANCHOR', 'TEMPO', 'RANCH', 'PECAN', 'TOFFEE', 'GRAVEL', 'FOSSIL', 'CONDOR', 'MODEST',
]

export const CODE_WORD_COUNT = CODE_WORDS.length

export function generateCode(): string {
  const word = CODE_WORDS[Math.floor(Math.random() * CODE_WORDS.length)]
  const num = Math.floor(10 + Math.random() * 9990)
  return `${word}-${num}`
}

export function makeSeat(id: string, name: string, bot: boolean, isHost: boolean, seatIdx: number): Seat {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'
  return {
    id, name, bot, isHost,
    color: SEAT_PALETTE[seatIdx % SEAT_PALETTE.length],
    initials,
    score: 0, farkles: 0, best: 0,
  }
}

function initFarkle(): FarkleState {
  return {
    dice: [], kept: [], turnScore: 0, farkle: false, lost: 0,
    finalRound: false, finalTrigger: null, status: 'Six dice, ready.', round: 1, log: [],
    winningScore: 10000, openingScore: 500, rejection: null,
  }
}

function initYahtzee(seats: Seat[]): YahtzeeState {
  const cards: YahtzeeState['cards'] = {}
  const bonuses: YahtzeeState['bonuses'] = {}
  seats.forEach((s) => {
    cards[s.id] = {}
    bonuses[s.id] = 0
  })
  return { dice: [], rollsLeft: 3, cards, bonuses, round: 1, rolling: false, status: 'Your roll.', lastTurn: null, rejection: null }
}

function initTtt(seats: Seat[]): TttState {
  const wins: Record<string, number> = {}
  seats.forEach((s) => { wins[s.id] = 0 })
  return { board: Array(9).fill(null), starter: 0, winLine: [], over: false, roundOver: false, pendingWinnerId: null, wins, rejection: null }
}

function initConnect4(seats: Seat[]): Connect4State {
  const wins: Record<string, number> = {}
  seats.forEach((s) => { wins[s.id] = 0 })
  return { board: Array(42).fill(null), starter: 0, winLine: [], over: false, roundOver: false, pendingWinnerId: null, status: '', wins, rejection: null }
}

function initHangman(seats: Seat[]): HangmanState {
  const wins: Record<string, number> = {}
  seats.forEach((s) => { wins[s.id] = 0 })
  return startHangmanRound({ word: '', guessed: [], wrong: [], phase: 'setting', guesserIdx: 1, over: false, pendingWinnerId: null, status: '', wins, rejection: null }, seats)
}

function startHangmanRound(base: HangmanState, seats: Seat[]): HangmanState {
  const setterIdx = base.guesserIdx === 0 ? 1 : 0
  const setter = seats[setterIdx]
  if (!setter || setter.bot) {
    return { ...base, word: randomWord(), guessed: [], wrong: [], phase: 'guessing', over: false, pendingWinnerId: null, status: `Guess ${seats[base.guesserIdx]?.name ?? "the"}'s word.`, rejection: null }
  }
  return { ...base, word: '', guessed: [], wrong: [], phase: 'setting', over: false, pendingWinnerId: null, status: `Give ${seats[base.guesserIdx]?.name ?? 'them'} a word to guess.`, rejection: null }
}

export function makeRoom(code: string, game: Game, hostName: string, hostId: string): RoomState {
  const seats = [makeSeat(hostId, hostName, false, true, 0)]
  return {
    screen: 'room', game, code, seats, turnIdx: 0, botPace: 1, botDifficulty: 'medium', showLog: true,
    farkle: initFarkle(), yahtzee: initYahtzee(seats), ttt: initTtt(seats), hangman: initHangman(seats), connect4: initConnect4(seats),
    winnerId: null,
  }
}

function withNewSeats(state: RoomState, seats: Seat[]): RoomState {
  return { ...state, seats, yahtzee: { ...state.yahtzee, cards: reconcileCards(state.yahtzee.cards, seats), bonuses: reconcileScores(state.yahtzee.bonuses, seats) }, ttt: { ...state.ttt, wins: reconcileScores(state.ttt.wins, seats) }, hangman: { ...state.hangman, wins: reconcileScores(state.hangman.wins, seats) }, connect4: { ...state.connect4, wins: reconcileScores(state.connect4.wins, seats) } }
}

function reconcileCards(cards: YahtzeeState['cards'], seats: Seat[]): YahtzeeState['cards'] {
  const next = { ...cards }
  seats.forEach((s) => { if (!next[s.id]) next[s.id] = {} })
  return next
}

function reconcileScores(scores: Record<string, number>, seats: Seat[]): Record<string, number> {
  const next = { ...scores }
  seats.forEach((s) => { if (next[s.id] === undefined) next[s.id] = 0 })
  return next
}

export function addSeat(state: RoomState, id: string, name: string, bot: boolean): RoomState {
  if (state.seats.length >= GAME_MAX_SEATS[state.game]) return state
  const seat = makeSeat(id, name, bot, false, state.seats.length)
  return withNewSeats(state, [...state.seats, seat])
}

export function removeSeat(state: RoomState, id: string): RoomState {
  return withNewSeats(state, state.seats.filter((s) => s.id !== id))
}

function advanceTurn(seats: Seat[], turnIdx: number, round: number): { turnIdx: number; round: number } {
  const next = (turnIdx + 1) % seats.length
  return { turnIdx: next, round: next === 0 ? round + 1 : round }
}

export function applyAction(state: RoomState, action: Action, by: string): RoomState {
  switch (action.type) {
    case 'pickGame': {
      if (state.screen !== 'room') return state
      const max = GAME_MAX_SEATS[action.game]
      const seats = state.seats.length > max ? state.seats.slice(0, max) : state.seats
      return withNewSeats({ ...state, game: action.game }, seats)
    }
    case 'addBot': {
      if (state.seats.length >= GAME_MAX_SEATS[state.game]) return state
      return addSeat(state, `bot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, randomBotName(state.seats.map((s) => s.name)), true)
    }
    case 'setBotDifficulty':
      return { ...state, botDifficulty: action.difficulty }
    case 'startGame':
      return startGame(state)
    case 'rematch':
      return startGame({ ...state, screen: 'room' })
    case 'farkleRoll':
      return farkleRoll(state, by)
    case 'farkleToggle':
      return farkleToggle(state, by, action.dieId)
    case 'farkleBank':
      return farkleBank(state, by)
    case 'farkleEndTurn':
      return farkleEndTurn(state, by)
    case 'yahtzeeRoll':
      return yahtzeeRoll(state, by)
    case 'yahtzeeToggleHold':
      return yahtzeeToggleHold(state, by, action.dieId)
    case 'yahtzeeScore':
      return yahtzeeScore(state, by, action.category)
    case 'tttPlay':
      return tttPlay(state, by, action.cell)
    case 'tttAdvanceRound':
      return tttAdvanceRound(state, by)
    case 'connect4Play':
      return connect4Play(state, by, action.col)
    case 'connect4AdvanceRound':
      return connect4AdvanceRound(state)
    case 'hangmanSetWord':
      return hangmanSetWord(state, by, action.word)
    case 'hangmanGuess':
      return hangmanGuess(state, by, action.letter)
    case 'hangmanAdvanceRound':
      return hangmanAdvanceRound(state)
    default:
      return state
  }
}

function startGame(state: RoomState): RoomState {
  const seats = state.seats
  let farkle = state.farkle
  let yahtzee = state.yahtzee
  let ttt = state.ttt
  let hangman = state.hangman
  let connect4 = state.connect4
  if (state.game === 'farkle') farkle = { ...initFarkle(), winningScore: farkle.winningScore, openingScore: farkle.openingScore }
  if (state.game === 'yahtzee') yahtzee = initYahtzee(seats)
  if (state.game === 'ttt') ttt = { ...initTtt(seats), starter: 0 }
  if (state.game === 'hangman') hangman = initHangman(seats)
  if (state.game === 'connect4') connect4 = { ...initConnect4(seats), starter: 0 }
  return { ...state, screen: state.game, turnIdx: 0, farkle, yahtzee, ttt, hangman, connect4, winnerId: null }
}

// ---------- Farkle ----------

function isFarkleTurn(state: RoomState, by: string) {
  return state.seats[state.turnIdx]?.id === by
}

// Transient rejection notice for a Farkle action the host declined to apply — matches TTT's
// tttReject precedent (docs/reviews/farkle-review.md major #3, see `git show 6211c0d`). Set on
// the room-wide broadcast state, but only rendered by the seat named in `seatId`.
function farkleReject(state: RoomState, f: FarkleState, by: string, reason: string): RoomState {
  return { ...state, farkle: { ...f, rejection: { seatId: by, reason, nonce: Date.now() } } }
}

function farkleRoll(state: RoomState, by: string): RoomState {
  if (state.screen !== 'farkle') return state
  let f = state.farkle
  if (!isFarkleTurn(state, by)) return farkleReject(state, f, by, "It's not your turn.")
  const selected = f.dice.filter((d) => d.sel)
  let turnScore = f.turnScore
  let kept = f.kept
  if (selected.length > 0) {
    const { valid, score } = scoreSelection(selected.map((d) => d.val))
    if (!valid) return farkleReject(state, f, by, "Select scoring dice — that mix doesn't score.")
    turnScore += score
    kept = [...kept, ...selected.map((d) => d.val)]
  } else if (f.dice.length > 0) {
    return farkleReject(state, f, by, 'Set aside a scoring die before rolling again.')
  }
  let remaining = 6 - kept.length
  if (remaining === 0) { remaining = 6; kept = [] }
  const dice = rollFarkleDice(remaining)
  const scored = hasAnyScore(dice.map((d) => d.val))
  if (!scored) {
    const seat = state.seats.find((s) => s.id === by)!
    const seats = state.seats.map((s) => (s.id === by ? { ...s, farkles: s.farkles + 1 } : s))
    const log = [...f.log, { who: seat.name, color: seat.color, amount: turnScore, tone: 'farkle' as const }]
    return {
      ...state,
      seats,
      farkle: { ...f, dice, kept, turnScore: 0, farkle: true, lost: turnScore, status: 'Farkle!', log, rejection: null },
    }
  }
  return { ...state, farkle: { ...f, dice, kept, turnScore, farkle: false, status: 'Keep what scores.', rejection: null } }
}

function farkleToggle(state: RoomState, by: string, dieId: number): RoomState {
  if (state.screen !== 'farkle') return state
  const f = state.farkle
  if (!isFarkleTurn(state, by)) return farkleReject(state, f, by, "It's not your turn.")
  // An absent/duplicate/stale dieId simply matches no die and is a no-op — harmless, since the
  // host is the sole source of the dice array and a client can only ever reference ids it was
  // actually sent (docs/reviews/farkle-review.md minor: covered by tests, not a behavior change).
  const dice = f.dice.map((d) => (d.id === dieId ? { ...d, sel: !d.sel } : d))
  return { ...state, farkle: { ...f, dice, rejection: null } }
}

// Ends the match if the final lap just completed (turn arrived back at the
// seat that first crossed the winning score). Shared by every farkle
// action that can advance the turn — a bust must trigger this exactly
// like a bank does, or a farkle during the final lap silently skips it.
function checkFarkleMatchEnd(
  seats: RoomState['seats'],
  turnIdx: number,
  finalRound: boolean,
  finalTrigger: string | null,
): { winnerId: string } | null {
  if (!finalRound || seats[turnIdx]?.id !== finalTrigger) return null
  const winnerId = [...seats].sort((a, b) => b.score - a.score)[0].id
  return { winnerId }
}

function farkleBank(state: RoomState, by: string): RoomState {
  if (state.screen !== 'farkle') return state
  const f = state.farkle
  if (!isFarkleTurn(state, by)) return farkleReject(state, f, by, "It's not your turn.")
  const selected = f.dice.filter((d) => d.sel)
  let turnScore = f.turnScore
  if (selected.length > 0) {
    const { valid, score } = scoreSelection(selected.map((d) => d.val))
    if (!valid) return farkleReject(state, f, by, "Select scoring dice — that mix doesn't score.")
    turnScore += score
  }
  const seat = state.seats.find((s) => s.id === by)!
  if (seat.score === 0 && turnScore < f.openingScore) {
    return farkleReject(state, f, by, `Reach ${f.openingScore.toLocaleString()} to open.`)
  }
  if (turnScore <= 0) return farkleReject(state, f, by, 'Nothing to bank yet.')
  const newScore = seat.score + turnScore
  const seats = state.seats.map((s) => (s.id === by ? { ...s, score: newScore, best: Math.max(s.best, turnScore) } : s))
  const log = [...f.log, { who: seat.name, color: seat.color, amount: turnScore, tone: 'bank' as const }]
  let finalRound = f.finalRound
  let finalTrigger = f.finalTrigger
  if (!finalRound && newScore >= f.winningScore) { finalRound = true; finalTrigger = by }
  const { turnIdx, round } = advanceTurn(state.seats, state.turnIdx, f.round)
  const ended = checkFarkleMatchEnd(seats, turnIdx, finalRound, finalTrigger)
  if (ended) {
    return { ...state, seats, screen: 'results', winnerId: ended.winnerId, farkle: { ...f, log, turnScore: 0, dice: [], kept: [], rejection: null } }
  }
  return {
    ...state,
    seats,
    turnIdx,
    farkle: { ...f, log, turnScore: 0, dice: [], kept: [], farkle: false, finalRound, finalTrigger, round, status: 'Six dice, ready.', rejection: null },
  }
}

function farkleEndTurn(state: RoomState, by: string): RoomState {
  if (state.screen !== 'farkle') return state
  const f = state.farkle
  if (!isFarkleTurn(state, by)) return farkleReject(state, f, by, "It's not your turn.")
  const { turnIdx, round } = advanceTurn(state.seats, state.turnIdx, f.round)
  const nextFarkle = { ...f, farkle: false, dice: [], kept: [], round, status: 'Six dice, ready.', rejection: null }
  const ended = checkFarkleMatchEnd(state.seats, turnIdx, f.finalRound, f.finalTrigger)
  if (ended) return { ...state, turnIdx, screen: 'results', winnerId: ended.winnerId, farkle: nextFarkle }
  return { ...state, turnIdx, farkle: nextFarkle }
}

// ---------- Yahtzee ----------

function isYahtzeeTurn(state: RoomState, by: string) {
  return state.seats[state.turnIdx]?.id === by
}

// Transient rejection notice for a Yahtzee action the host declined to apply — matches TTT's
// tttReject precedent (docs/reviews/yahtzee-review.md major #3, see `git show 6211c0d`). Set on
// the room-wide broadcast state, but only rendered by the seat named in `seatId`.
function yahtzeeReject(state: RoomState, y: YahtzeeState, by: string, reason: string): RoomState {
  return { ...state, yahtzee: { ...y, rejection: { seatId: by, reason, nonce: Date.now() } } }
}

function yahtzeeRoll(state: RoomState, by: string): RoomState {
  if (state.screen !== 'yahtzee') return state
  const y = state.yahtzee
  if (!isYahtzeeTurn(state, by)) return yahtzeeReject(state, y, by, "It's not your turn.")
  if (y.rollsLeft <= 0) return yahtzeeReject(state, y, by, 'No rolls left — pick a box.')
  const dice = y.dice.length === 0
    ? rollYahtzeeDice(5)
    : y.dice.map((d) => (d.sel ? d : { ...d, val: 1 + Math.floor(Math.random() * 6), rot: Math.random() * 10 - 5 }))
  return { ...state, yahtzee: { ...y, dice, rollsLeft: y.rollsLeft - 1, status: 'Hold dice, or score a box.', rejection: null } }
}

function yahtzeeToggleHold(state: RoomState, by: string, dieId: number): RoomState {
  if (state.screen !== 'yahtzee') return state
  const y = state.yahtzee
  if (!isYahtzeeTurn(state, by)) return yahtzeeReject(state, y, by, "It's not your turn.")
  if (y.dice.length === 0) return state
  // An absent/duplicate/stale dieId simply matches no die and is a harmless no-op — the host is
  // the sole source of the dice array, so a client can only ever reference ids it was actually
  // sent. Returning the same state reference (rather than a re-mapped-but-unchanged array) avoids
  // a needless broadcast/render (docs/reviews/yahtzee-review.md minor, matches Farkle precedent).
  if (!y.dice.some((d) => d.id === dieId)) return state
  const dice = y.dice.map((d) => (d.id === dieId ? { ...d, sel: !d.sel } : d))
  return { ...state, yahtzee: { ...y, dice, rejection: null } }
}

function yahtzeeScore(state: RoomState, by: string, category: YCategory): RoomState {
  if (state.screen !== 'yahtzee') return state
  const y = state.yahtzee
  if (!isYahtzeeTurn(state, by)) return yahtzeeReject(state, y, by, "It's not your turn.")
  // Runtime guard at the host authority boundary: `category` is only a compile-time YCategory on
  // a well-behaved client. A stale/buggy/malicious PeerJS client can send any string, so validate
  // it against the real category list before it ever touches the canonical card — otherwise a
  // bogus key is accepted as a zero-valued card entry and can satisfy the 13-category completion
  // check (docs/reviews/yahtzee-review.md major #1).
  if (!Y_CATEGORIES.includes(category)) return yahtzeeReject(state, y, by, 'Not a real scoring category.')
  if (y.dice.length === 0) return yahtzeeReject(state, y, by, 'Roll before scoring.')
  if (y.cards[by]?.[category] !== undefined) return yahtzeeReject(state, y, by, 'That box is already filled.')
  const vals = y.dice.map((d) => d.val)
  const bonus = isFiveKind(vals) && y.cards[by]?.yahtzee === 50 ? 100 : 0
  const bonuses = bonus ? { ...y.bonuses, [by]: (y.bonuses[by] ?? 0) + bonus } : y.bonuses
  const points = scoreCategory(vals, category, y.cards[by] ?? {})
  const cards = { ...y.cards, [by]: { ...y.cards[by], [category]: points } }
  const seats = state.seats.map((s) => (s.id === by ? { ...s, score: grandTotal(cards[by]) + (bonuses[by] ?? 0) } : s))
  const allDone = seats.every((s) => Object.keys(cards[s.id] ?? {}).length >= 13)
  if (allDone) {
    const winnerId = [...seats].sort((a, b) => b.score - a.score)[0].id
    return { ...state, seats, screen: 'results', winnerId, yahtzee: { ...y, cards, bonuses, rejection: null } }
  }
  const { turnIdx, round } = advanceTurn(state.seats, state.turnIdx, y.round)
  const lastTurnSeat = state.seats.find((s) => s.id === by)!
  return {
    ...state, seats, turnIdx,
    yahtzee: {
      ...y, cards, bonuses, dice: [], rollsLeft: 3, round, status: 'Your roll.',
      lastTurn: { name: lastTurnSeat.name, color: lastTurnSeat.color, category, points }, rejection: null,
    },
  }
}

// ---------- Tic Tac Toe ----------

function tttReject(state: RoomState, t: TttState, by: string, reason: string): RoomState {
  return { ...state, ttt: { ...t, rejection: { seatId: by, reason, nonce: Date.now() } } }
}

function tttPlay(state: RoomState, by: string, cell: number): RoomState {
  if (state.screen !== 'ttt') return state
  const t = state.ttt
  // Malformed/crafted payloads (from a stale or hostile PeerJS client) must never reach the
  // board index below — checked before anything else touches `board[cell]`.
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) return tttReject(state, t, by, "That's not a real square.")
  if (t.roundOver) return tttReject(state, t, by, 'This round is already over.')
  if (t.board[cell] !== null) return tttReject(state, t, by, 'That square is taken.')
  const seatIdx = state.seats.findIndex((s) => s.id === by)
  if (seatIdx !== state.turnIdx) return tttReject(state, t, by, "It's not your turn.")
  const board = [...t.board]
  board[cell] = seatIdx
  const winLine = checkWin(board, seatIdx)
  const draw = !winLine && isDraw(board)
  if (winLine || draw) {
    const wins = { ...t.wins }
    if (winLine) wins[by] = (wins[by] ?? 0) + 1
    const seats = state.seats.map((s) => ({ ...s, score: wins[s.id] ?? 0 }))
    const matchOver = Object.values(wins).some((w) => w >= 3)
    const pendingWinnerId = matchOver ? Object.entries(wins).sort((a, b) => b[1] - a[1])[0][0] : null
    return {
      ...state, seats,
      ttt: { ...t, board, winLine: winLine ?? [], over: true, roundOver: true, pendingWinnerId, wins, rejection: null },
    }
  }
  const turnIdx = (state.turnIdx + 1) % state.seats.length
  return { ...state, ttt: { ...t, board, rejection: null }, turnIdx }
}

// Round advancement is timer-owned (see the host's ROUND_PAUSE_MS effect in App.tsx) — it must
// never be reachable by a guest action, or an untrusted client can skip the human-readable
// reveal pause. `by` is checked against the seat marked isHost rather than trusting the caller.
function tttAdvanceRound(state: RoomState, by: string): RoomState {
  if (state.screen !== 'ttt') return state
  const t = state.ttt
  if (!t.roundOver) return state
  if (state.seats.find((s) => s.isHost)?.id !== by) return state
  if (t.pendingWinnerId) {
    return { ...state, screen: 'results', winnerId: t.pendingWinnerId }
  }
  const nextStarter = (t.starter + 1) % state.seats.length
  return {
    ...state, turnIdx: nextStarter,
    ttt: { ...t, board: Array(9).fill(null), winLine: [], over: false, roundOver: false, pendingWinnerId: null, starter: nextStarter, rejection: null },
  }
}

// ---------- Connect 4 ----------

function connect4Reject(state: RoomState, c: Connect4State, by: string, reason: string): RoomState {
  return { ...state, connect4: { ...c, rejection: { seatId: by, reason, nonce: Date.now() } } }
}

function connect4Play(state: RoomState, by: string, col: number): RoomState {
  if (state.screen !== 'connect4') return state
  const c = state.connect4
  // Malformed/crafted payloads (from a stale or hostile PeerJS client) must never reach the
  // board index below — checked before anything else touches `board[row * 7 + col]`.
  if (!Number.isInteger(col) || col < 0 || col > 6) return connect4Reject(state, c, by, "That's not a real column.")
  if (c.roundOver) return connect4Reject(state, c, by, 'This round is already over.')
  const seatIdx = state.seats.findIndex((s) => s.id === by)
  if (seatIdx !== state.turnIdx) return connect4Reject(state, c, by, "It's not your turn.")
  const row = lowestOpenRow(c.board, col)
  if (row < 0) return connect4Reject(state, c, by, 'That column is full.')
  const board = [...c.board]
  board[row * 7 + col] = seatIdx
  const winLine = c4CheckWin(board, row, col, seatIdx)
  const draw = !winLine && isBoardFull(board)
  if (winLine || draw) {
    const wins = { ...c.wins }
    if (winLine) wins[by] = (wins[by] ?? 0) + 1
    const seats = state.seats.map((s) => ({ ...s, score: wins[s.id] ?? 0 }))
    const matchOver = Object.values(wins).some((w) => w >= 3)
    const pendingWinnerId = matchOver ? Object.entries(wins).sort((a, b) => b[1] - a[1])[0][0] : null
    return {
      ...state, seats,
      connect4: { ...c, board, winLine: winLine ?? [], over: true, roundOver: true, pendingWinnerId, wins, rejection: null },
    }
  }
  const turnIdx = (state.turnIdx + 1) % state.seats.length
  return { ...state, connect4: { ...c, board, rejection: null }, turnIdx }
}

function connect4AdvanceRound(state: RoomState): RoomState {
  if (state.screen !== 'connect4') return state
  const c = state.connect4
  if (!c.roundOver) return state
  if (c.pendingWinnerId) {
    return { ...state, screen: 'results', winnerId: c.pendingWinnerId }
  }
  const nextStarter = (c.starter + 1) % state.seats.length
  return {
    ...state, turnIdx: nextStarter,
    connect4: { ...c, board: Array(42).fill(null), winLine: [], over: false, roundOver: false, pendingWinnerId: null, starter: nextStarter, status: '', rejection: null },
  }
}

// ---------- Hangman ----------

// Transient rejection notice for a Hangman action the host declined to apply — matches TTT's
// tttReject precedent (docs/reviews/hangman-review.md major #4, see `git show 6211c0d`). Set on
// the room-wide broadcast state, but only rendered by the seat named in `seatId`.
function hangmanReject(state: RoomState, h: HangmanState, by: string, reason: string): RoomState {
  return { ...state, hangman: { ...h, rejection: { seatId: by, reason, nonce: Date.now() } } }
}

function hangmanSetWord(state: RoomState, by: string, word: string): RoomState {
  if (state.screen !== 'hangman') return state
  const h = state.hangman
  if (h.phase !== 'setting') return hangmanReject(state, h, by, 'A word has already been set.')
  const setterIdx = h.guesserIdx === 0 ? 1 : 0
  if (state.seats[setterIdx]?.id !== by) return hangmanReject(state, h, by, "It's not your turn to set a word.")
  const clean = word.trim().toUpperCase().replace(/\s+/g, ' ')
  // Reject outright rather than silently stripping stray characters — the setter's copy
  // promises "letters and spaces only," so a rejected submission with a reason is the honest
  // response to a character that copy doesn't allow (docs/reviews/hangman-review.md minor).
  if (!/^[A-Z ]*$/.test(clean)) return hangmanReject(state, h, by, 'Letters and spaces only — remove other characters.')
  if (clean.replace(/ /g, '').length < 3) return hangmanReject(state, h, by, 'Word needs at least 3 letters.')
  return { ...state, hangman: { ...h, word: clean, phase: 'guessing', guessed: [], wrong: [], status: `Guess ${state.seats[h.guesserIdx]?.name}'s word.`, rejection: null } }
}

function hangmanGuess(state: RoomState, by: string, letter: string): RoomState {
  if (state.screen !== 'hangman') return state
  const h = state.hangman
  if (h.phase !== 'guessing') return hangmanReject(state, h, by, "There's no word to guess right now.")
  if (state.seats[h.guesserIdx]?.id !== by) return hangmanReject(state, h, by, "It's not your turn to guess.")
  // A crafted/stale PeerJS action can send anything as `letter` — normalize case, then reject
  // anything that isn't exactly one A-Z character before it can become a canonical
  // guessed/wrong entry (docs/reviews/hangman-review.md major #1).
  const L = letter.trim().toUpperCase()
  if (!/^[A-Z]$/.test(L)) return hangmanReject(state, h, by, 'Guess a single letter, A through Z.')
  if (h.guessed.includes(L)) return hangmanReject(state, h, by, `You already guessed ${L}.`)
  const guessed = [...h.guessed, L]
  const wrong = h.word.includes(L) ? h.wrong : [...h.wrong, L]
  const solved = isWordSolved(h.word, guessed)
  const lost = wrong.length >= 6
  if (solved || lost) {
    const wins = { ...h.wins }
    const guesser = state.seats[h.guesserIdx]
    if (solved && guesser) wins[guesser.id] = (wins[guesser.id] ?? 0) + 1
    const seats = state.seats.map((s) => ({ ...s, score: wins[s.id] ?? 0 }))
    const matchOver = Object.values(wins).some((w) => w >= 2)
    const pendingWinnerId = matchOver ? Object.entries(wins).sort((a, b) => b[1] - a[1])[0][0] : null
    const status = solved ? `${guesser?.name ?? 'They'} solved it!` : `Out of guesses — it was "${h.word}".`
    return {
      ...state, seats,
      hangman: { ...h, guessed, wrong, over: true, phase: 'roundOver', pendingWinnerId, status, wins, rejection: null },
    }
  }
  return { ...state, hangman: { ...h, guessed, wrong, rejection: null } }
}

function hangmanAdvanceRound(state: RoomState): RoomState {
  if (state.screen !== 'hangman') return state
  const h = state.hangman
  if (h.phase !== 'roundOver') return state
  if (h.pendingWinnerId) {
    return { ...state, screen: 'results', winnerId: h.pendingWinnerId }
  }
  const nextGuesser = h.guesserIdx === 0 ? 1 : 0
  return { ...state, hangman: startHangmanRound({ ...h, guesserIdx: nextGuesser }, state.seats) }
}

export function seatUpperBonusText(cards: YahtzeeState['cards'], seatId: string): string {
  const total = upperTotal(cards[seatId] ?? {})
  return total >= 63 ? '35' : `${total}/63`
}

export { advanceTurn }
