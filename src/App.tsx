import { useEffect, useRef, useState } from 'react'
import type { Action, BotDifficulty, Game, RoomState } from './types'
import { GAME_CODE_PREFIX } from './types'
import { addSeat, applyAction, generateCode, makeRoom, removeSeat } from './state/room'
import { decideBoot, gameFromPath, gamePath, readNameCookie, writeNameCookie, readCardBackCookie, writeCardBackCookie, type RoutedGame } from './state/route'
import { randomBotName } from './data/botNames'
import { createHost, joinHost, peerIdForCode, type GuestHandle, type HostHandle } from './net/peer'
import { Landing } from './screens/Landing'
import { Room } from './screens/Room'
import { Results } from './screens/Results'
import { FarkleTable } from './screens/FarkleTable'
import { YahtzeeTable } from './screens/YahtzeeTable'
import { TttTable } from './screens/TttTable'
import { Connect4Table } from './screens/Connect4Table'
import { HangmanTable } from './screens/HangmanTable'
import { RulesOverlay } from './components/RulesOverlay'
import { decideFarkleBot } from './games/farkle'
import { decideYahtzeeCategory, decideYahtzeeHold } from './games/yahtzee'
import { decideTttMove } from './games/ttt'
import { decideConnect4Move } from './games/connect4'
import { decideHangmanLetter } from './games/hangman'

// ---- Rummy (separate parallel session, per CHARTER.md resolution #7) ----
import { createRummyGame, RUMMY_MAX_SEATS, RUMMY_MIN_SEATS, type RummySession, type RummyPublicState, type RummyAction } from './card-games/rummy/state'
import { applyRummyAction, runRummyBotTurn } from './card-games/rummy/rules'
import { rummyBotStrategy } from './card-games/rummy/bot'
import { deriveSnapshot, shouldAcceptUpdate } from './engine/sync'
import { currentPlayer } from './engine/turn-engine'
import type { Card } from './card-engine/cards'
import { RummyTable } from './screens/RummyTable'
import { RummyResults } from './screens/RummyResults'
import { RummyRoom } from './screens/RummyRoom'
import { CARD_BACKS, DEFAULT_CARD_BACK } from './components/cardBacks'

// The saved card back, or the default if the cookie is unset or names a design
// that no longer exists.
function savedCardBack(): string {
  const id = readCardBackCookie()
  return id && CARD_BACKS.some((d) => d.id === id) ? id : DEFAULT_CARD_BACK
}

// ---- Phase 10 (separate parallel session, per CHARTER.md resolution #7) ----
import { createPhase10Game, PHASE10_MAX_SEATS, PHASE10_MIN_SEATS, type Phase10Session, type Phase10PublicState, type Phase10PrivateState, type Phase10Action } from './card-games/phase10/state'
import { applyPhase10Action, runPhase10BotTurn } from './card-games/phase10/rules'
import { phase10BotStrategy } from './card-games/phase10/bot'
import { Phase10Table } from './screens/Phase10Table'
import { Phase10Results } from './screens/Phase10Results'
import { Phase10Room } from './screens/Phase10Room'

// ---- Battleship (separate parallel session, per CHARTER.md resolution #7) ----
import { createBattleshipGame, type BattleshipSession, type BattleshipPublicState, type BattleshipPrivateState, type BattleshipAction, type BattleshipVariant, type ShipId } from './board-games/battleship/state'
import { applyBattleshipAction, runBattleshipBotTurn } from './board-games/battleship/rules'
import { makeBattleshipBotStrategy } from './board-games/battleship/bot'
import { BattleshipTable } from './screens/BattleshipTable'
import { BattleshipResults } from './screens/BattleshipResults'
import { BattleshipRoom } from './screens/BattleshipRoom'

// ---- Dominoes (separate parallel session, per CHARTER.md resolution #7) ----
import { createDominoesGame, type DominoesSession, type DominoesPublicState, type DominoesPrivateState, type DominoesAction, type DominoTile, type DominoArm } from './board-games/dominoes/state'
import { applyDominoesAction, runDominoesBotTurn } from './board-games/dominoes/rules'
import { dominoesBotStrategy } from './board-games/dominoes/bot'
import { DominoesTable } from './screens/DominoesTable'
import { DominoesResults } from './screens/DominoesResults'
import { DominoesRoom } from './screens/DominoesRoom'

// ---- Wahoo (separate parallel session, per CHARTER.md resolution #7) ----
import { createWahooGame, type WahooSession, type WahooPublicState, type WahooAction } from './board-games/wahoo/state'
import { applyWahooAction, runWahooBotTurn } from './board-games/wahoo/rules'
import { wahooBotStrategy } from './board-games/wahoo/bot'
import { WahooTable } from './screens/WahooTable'
import { WahooResults } from './screens/WahooResults'
import { WahooRoom } from './screens/WahooRoom'

// ---- Checkers (separate parallel session, per CHARTER.md resolution #7) ----
import { createCheckersGame, type CheckersSession, type CheckersPublicState, type CheckersAction } from './board-games/checkers/state'
import { applyCheckersAction, runCheckersBotTurn } from './board-games/checkers/rules'
import { makeCheckersBotStrategy } from './board-games/checkers/bot'
import { CheckersTable } from './screens/CheckersTable'
import { CheckersResults } from './screens/CheckersResults'
import { CheckersRoom } from './screens/CheckersRoom'

// ---- Mexican Train (separate parallel session, per CHARTER.md resolution #7) ----
import { createMexicanTrainGame, handHasLegalPlay, MT_MAX_SEATS, MT_MIN_SEATS, type MTSession, type MTPublicState, type MTTile, type MTAction } from './board-games/mexican-train/state'
import { applyMTAction, runMTBotTurn } from './board-games/mexican-train/rules'
import { mexicanTrainBotStrategy } from './board-games/mexican-train/bot'
import { MexicanTrainTable } from './screens/MexicanTrainTable'
import { MexicanTrainResults } from './screens/MexicanTrainResults'
import { MexicanTrainRoom } from './screens/MexicanTrainRoom'

// ---- Chess (separate parallel session, per CHARTER.md resolution #7) ----
import { createChessGame, type ChessSession, type ChessPublicState, type ChessAction, type ChessDifficulty } from './board-games/chess/state'
import { applyChessAction, runChessBotTurn } from './board-games/chess/rules'
import { makeEasyChessBotStrategy, makeNormalChessBotStrategy } from './board-games/chess/bot'
import { ChessTable } from './screens/ChessTable'
import { ChessResults } from './screens/ChessResults'
import { ChessRoom } from './screens/ChessRoom'

// ---- Uno (separate parallel session, per CHARTER.md resolution #7) ----
import { createUnoGame, resolveHouseRules, UNO_HAND_SIZE, UNO_MAX_SEATS, UNO_MIN_SEATS, type UnoAction, type UnoHouseRuleKey, type UnoPublicState, type UnoSession } from './card-games/uno/state'
import { applyUnoAction, runUnoBotTurn } from './card-games/uno/rules'
import { unoBotStrategy } from './card-games/uno/bot'
import type { UnoCard } from './card-games/uno/deck'
import { estimateDealIntroMs } from './components/DealIntro'
import { UnoTable } from './screens/UnoTable'
import { UnoResults } from './screens/UnoResults'
import { UnoRoom } from './screens/UnoRoom'

// ---- Skip-Bo (separate parallel session, per CHARTER.md resolution #7) ----
import { createSkipBoGame, SKIPBO_MAX_SEATS, SKIPBO_MIN_SEATS, type SkipBoAction, type SkipBoPublicState, type SkipBoSession } from './card-games/skipbo/state'
import { applySkipBoAction, runSkipBoBotTurn } from './card-games/skipbo/rules'
import { skipBoBotStrategy } from './card-games/skipbo/bot'
import { SkipBoTable } from './screens/SkipBoTable'
import { SkipBoResults } from './screens/SkipBoResults'
import { SkipBoRoom } from './screens/SkipBoRoom'

// ---- Solitaire (single-player local session) ----
import { createSolitaireGame, type SolitaireState, type SolitaireMode, type SolitaireMove } from './card-games/solitaire/state'
import { applyAnyMove as applySolitaireMove } from './card-games/solitaire/dispatch'
import { SolitaireRoom } from './screens/SolitaireRoom'
import { SolitaireTable } from './screens/SolitaireTable'
import { SolitaireResults } from './screens/SolitaireResults'

// ---- Scrabble ----
import { createScrabbleGame, SCRABBLE_MAX_SEATS, SCRABBLE_MIN_SEATS, type ScrabbleAction, type ScrabblePublicState, type ScrabbleSession, type ScrabbleTile } from './board-games/scrabble/state'
import { applyScrabbleAction, runScrabbleBotTurn } from './board-games/scrabble/rules'
import { createScrabbleBotStrategy } from './board-games/scrabble/bot'
import { loadDictionary, type ScrabbleDictionary } from './board-games/scrabble/dictionary'
import { ScrabbleTable } from './screens/ScrabbleTable'
import { ScrabbleResults } from './screens/ScrabbleResults'
import { ScrabbleRoom } from './screens/ScrabbleRoom'

type RummyView =
  | { kind: 'lobby'; roster: { name: string; isBot: boolean; isHost: boolean }[]; cardBack: string }
  | { kind: 'game'; revision: number; publicState: RummyPublicState; hand: Card[]; names: Record<string, string> }
type Phase10View =
  | { kind: 'lobby'; roster: { name: string; isBot: boolean; isHost: boolean }[]; cardBack: string }
  | { kind: 'game'; revision: number; publicState: Phase10PublicState; privateState: Phase10PrivateState; names: Record<string, string> }
type BattleshipView = { revision: number; publicState: BattleshipPublicState; privateState: BattleshipPrivateState; opponentName: string }
type DominoesView = { revision: number; publicState: DominoesPublicState; privateState: DominoesPrivateState; opponentName: string }
type WahooView =
  | { kind: 'lobby'; roster: { name: string; isBot: boolean; isHost: boolean }[] }
  | { kind: 'game'; revision: number; publicState: WahooPublicState; names: Record<string, string> }
type CheckersView =
  | { kind: 'lobby'; roster: { name: string; isBot: boolean; isHost: boolean }[] }
  | { kind: 'game'; revision: number; publicState: CheckersPublicState; names: Record<string, string> }
type MTView =
  | { kind: 'lobby'; roster: { name: string; isBot: boolean; isHost: boolean }[] }
  | { kind: 'game'; revision: number; publicState: MTPublicState; hand: MTTile[]; names: Record<string, string> }
type ChessView = { revision: number; publicState: ChessPublicState; opponentName: string }
type UnoView =
  | { kind: 'lobby'; roster: { name: string; isBot: boolean; isHost: boolean }[]; houseRules: Record<UnoHouseRuleKey, boolean>; difficulty: BotDifficulty; cardBack: string }
  | { kind: 'game'; revision: number; publicState: UnoPublicState; hand: UnoCard[]; names: Record<string, string> }
type SkipBoView =
  | { kind: 'lobby'; roster: { name: string; isBot: boolean; isHost: boolean }[]; cardBack: string }
  | { kind: 'game'; revision: number; publicState: SkipBoPublicState; hand: Card[]; names: Record<string, string> }
type ScrabbleView =
  | { kind: 'lobby'; roster: { name: string; isBot: boolean; isHost: boolean }[]; difficulty: BotDifficulty }
  | { kind: 'game'; revision: number; publicState: ScrabblePublicState; rack: ScrabbleTile[]; names: Record<string, string> }

const BASE_MS = 900
const ROUND_PAUSE_MS = 4000
// Extra wait after a Wahoo pass/bust (turn moves with nothing to click) so
// the die-flicker animation always finishes before the next actor starts.
const PASS_ANIMATION_BUFFER_MS = 450
// MT-specific pacing: measured against the actual sound assets so bot turns
// don't outrun their own sounds. domino-play/domino-draw run ~1.03s; a bare
// BASE_MS (900ms) gap between actions clips their tail.
// Uno: BASE_MS (900ms) was fine for a single bot but with several bots
// sharing a table, a human's own turns get buried in a run of back-to-back
// 900ms plays that blur together ("fast forward"). A slower, card-game-scale
// pace gives each bot's play (and its sound) room to actually register.
const UNO_ACTION_MS = 1600
// Extra hold after every round start (initial deal, rematch, or START_NEXT_
// ROUND) before ANY bot acts — human or bot, nobody should be mid-animation
// on their local DealIntro when a bot's first move lands. estimateDealIntroMs
// covers the intro itself; this buffer is slack for network latency and
// per-client render/paint time on top of that estimate.
const UNO_DEAL_HOLD_BUFFER_MS = 700
// Skip-Bo: a turn is a chain of individual card plays (stock/hand/discard),
// each a state-changing animation and sound a human watches land. The bot
// loop therefore waits BASE_MS before EVERY individual action — not once per
// turn — so a full 4-bot table never blurs a run of plays together between a
// human's own turns.
const SKIPBO_DEAL_HOLD_BUFFER_MS = 700
const MT_ACTION_MS = 1100
// Yahtzee was reusing bare BASE_MS across its 3-roll/2-hold/1-score turn shape, which measured at
// ~4.6s per bot turn against a human averaging ~10-13s per turn on the same table (see spec/
// console-timing audit) — the bot felt like it was "always my turn" instead of a real opponent
// taking its time. Sized so a full turn lands close to that human average, not just above BASE_MS.
const YAHTZEE_ACTION_MS = 2000
// train-horn runs 3.6s. Any action that opens a train (pass-open OR a dead
// draw — both honk, see MexicanTrainTable's `action.opened !== null` sound
// gate) needs the next action held off long enough that the horn finishes.
// This buffer is IN ADDITION to the MT_ACTION_MS the loop already pays on
// its next iteration, so buffer + MT_ACTION_MS should cover the full clip.
const MT_HORN_BUFFER_MS = 2500
// Battleship: streak (hit = go again) and free-for-all (every shot = go
// again) variants can chain many bot shots with only BASE_MS between them,
// but ship-miss/-hit/-sunk run 1.97s/3.67s/5.66s — sized here so BASE_MS +
// buffer comfortably clears each clip before the next shot fires.
const SHOT_SOUND_BUFFER_MS: Record<'hit' | 'miss' | 'sunk', number> = {
  miss: 1100,
  hit: 2800,
  sunk: 4800,
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export default function App() {
  const [name, setName] = useState('')
  const [joinCodeInput, setJoinCodeInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [room, setRoom] = useState<RoomState | null>(null)
  const [role, setRole] = useState<'host' | 'guest' | null>(null)
  const [localSeatId, setLocalSeatId] = useState<string | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)

  // ---- Rummy ----
  const [rummyRole, setRummyRole] = useState<'host' | 'guest' | null>(null)
  const [rummyCode, setRummyCode] = useState('')
  const [rummyLocalPlayerId, setRummyLocalPlayerId] = useState<string | null>(null)
  const [rummyView, setRummyView] = useState<RummyView | null>(null)
  const [rummyConnection, setRummyConnection] = useState<'connected' | 'disconnected'>('connected')
  const [rummyNotice, setRummyNotice] = useState<string | null>(null)
  const [rummyStarted, setRummyStarted] = useState(false)
  const [rummySeats, setRummySeats] = useState<{ playerId: string; name: string; isBot: boolean }[]>([])
  const [rummyCardBack, setRummyCardBack] = useState(savedCardBack)

  // ---- Phase 10 ----
  const [phase10Role, setPhase10Role] = useState<'host' | 'guest' | null>(null)
  const [phase10Code, setPhase10Code] = useState('')
  const [phase10LocalPlayerId, setPhase10LocalPlayerId] = useState<string | null>(null)
  const [phase10View, setPhase10View] = useState<Phase10View | null>(null)
  const [phase10Connection, setPhase10Connection] = useState<'connected' | 'disconnected'>('connected')
  const [phase10Notice, setPhase10Notice] = useState<string | null>(null)
  const [phase10Started, setPhase10Started] = useState(false)
  const [phase10Seats, setPhase10Seats] = useState<{ playerId: string; name: string; isBot: boolean }[]>([])

  // ---- Battleship ----
  const [battleshipRole, setBattleshipRole] = useState<'host' | 'guest' | null>(null)
  const [battleshipCode, setBattleshipCode] = useState('')
  const [battleshipLocalPlayerId, setBattleshipLocalPlayerId] = useState<string | null>(null)
  const [battleshipOpponentId, setBattleshipOpponentId] = useState<string | null>(null)
  const [battleshipOpponentName, setBattleshipOpponentName] = useState('')
  const [battleshipView, setBattleshipView] = useState<BattleshipView | null>(null)
  const [battleshipConnection, setBattleshipConnection] = useState<'connected' | 'disconnected'>('connected')
  const [battleshipWaiting, setBattleshipWaiting] = useState(false)
  const [battleshipVariant, setBattleshipVariant] = useState<BattleshipVariant>('standard')

  // ---- Dominoes ----
  const [dominoesRole, setDominoesRole] = useState<'host' | 'guest' | null>(null)
  const [dominoesCode, setDominoesCode] = useState('')
  const [dominoesLocalPlayerId, setDominoesLocalPlayerId] = useState<string | null>(null)
  const [dominoesOpponentId, setDominoesOpponentId] = useState<string | null>(null)
  const [dominoesOpponentName, setDominoesOpponentName] = useState('')
  const [dominoesView, setDominoesView] = useState<DominoesView | null>(null)
  const [dominoesConnection, setDominoesConnection] = useState<'connected' | 'disconnected'>('connected')
  const [dominoesWaiting, setDominoesWaiting] = useState(false)

  // ---- Wahoo ----
  const [wahooRole, setWahooRole] = useState<'host' | 'guest' | null>(null)
  const [wahooCode, setWahooCode] = useState('')
  const [wahooLocalPlayerId, setWahooLocalPlayerId] = useState<string | null>(null)
  const [wahooView, setWahooView] = useState<WahooView | null>(null)
  const [wahooConnection, setWahooConnection] = useState<'connected' | 'disconnected'>('connected')
  const [wahooNotice, setWahooNotice] = useState<string | null>(null)
  const [wahooStarted, setWahooStarted] = useState(false)
  const [wahooSeats, setWahooSeats] = useState<{ playerId: string; name: string; isBot: boolean }[]>([])
  const [wahooDropped, setWahooDropped] = useState<string[]>([])

  // ---- Checkers ----
  const [checkersRole, setCheckersRole] = useState<'host' | 'guest' | null>(null)
  const [checkersCode, setCheckersCode] = useState('')
  const [checkersLocalPlayerId, setCheckersLocalPlayerId] = useState<string | null>(null)
  const [checkersView, setCheckersView] = useState<CheckersView | null>(null)
  const [checkersConnection, setCheckersConnection] = useState<'connected' | 'disconnected'>('connected')
  const [checkersStarted, setCheckersStarted] = useState(false)
  const [checkersSeats, setCheckersSeats] = useState<{ playerId: string; name: string; isBot: boolean }[]>([])

  // ---- Mexican Train ----
  const [mtRole, setMTRole] = useState<'host' | 'guest' | null>(null)
  const [mtCode, setMTCode] = useState('')
  const [mtLocalPlayerId, setMTLocalPlayerId] = useState<string | null>(null)
  const [mtView, setMTView] = useState<MTView | null>(null)
  const [mtConnection, setMTConnection] = useState<'connected' | 'disconnected'>('connected')
  const [mtNotice, setMTNotice] = useState<string | null>(null)
  const [mtStarted, setMTStarted] = useState(false)
  const [mtSeats, setMTSeats] = useState<{ playerId: string; name: string; isBot: boolean }[]>([])
  const [mtDropped, setMTDropped] = useState<string[]>([])

  // ---- Chess ----
  const [chessRole, setChessRole] = useState<'host' | 'guest' | null>(null)
  const [chessCode, setChessCode] = useState('')
  const [chessLocalPlayerId, setChessLocalPlayerId] = useState<string | null>(null)
  const [chessOpponentId, setChessOpponentId] = useState<string | null>(null)
  const [chessOpponentName, setChessOpponentName] = useState('')
  const [chessView, setChessView] = useState<ChessView | null>(null)
  const [chessConnection, setChessConnection] = useState<'connected' | 'disconnected'>('connected')
  const [chessWaiting, setChessWaiting] = useState(false)
  const [chessDifficulty, setChessDifficulty] = useState<ChessDifficulty>('easy')

  // ---- Uno ----
  const [unoRole, setUnoRole] = useState<'host' | 'guest' | null>(null)
  const [unoCode, setUnoCode] = useState('')
  const [unoLocalPlayerId, setUnoLocalPlayerId] = useState<string | null>(null)
  const [unoView, setUnoView] = useState<UnoView | null>(null)
  const [unoConnection, setUnoConnection] = useState<'connected' | 'disconnected'>('connected')
  const [unoNotice, setUnoNotice] = useState<string | null>(null)
  const [unoStarted, setUnoStarted] = useState(false)
  const [unoSeats, setUnoSeats] = useState<{ playerId: string; name: string; isBot: boolean }[]>([])
  const [unoDropped, setUnoDropped] = useState<string[]>([])
  const [unoHouseRules, setUnoHouseRules] = useState<Record<UnoHouseRuleKey, boolean>>(() => resolveHouseRules())
  const [unoDifficulty, setUnoDifficulty] = useState<BotDifficulty>('medium')

  // ---- Skip-Bo ----
  const [skipBoRole, setSkipBoRole] = useState<'host' | 'guest' | null>(null)
  const [skipBoCode, setSkipBoCode] = useState('')
  const [skipBoLocalPlayerId, setSkipBoLocalPlayerId] = useState<string | null>(null)
  const [skipBoView, setSkipBoView] = useState<SkipBoView | null>(null)
  const [skipBoConnection, setSkipBoConnection] = useState<'connected' | 'disconnected'>('connected')
  const [skipBoNotice, setSkipBoNotice] = useState<string | null>(null)
  const [skipBoStarted, setSkipBoStarted] = useState(false)
  const [skipBoSeats, setSkipBoSeats] = useState<{ playerId: string; name: string; isBot: boolean }[]>([])

  // ---- Solitaire ----
  const [solitaireOpen, setSolitaireOpen] = useState(false)
  const [solitaireMode, setSolitaireMode] = useState<SolitaireMode>('klondike')
  const [solitaireHistory, setSolitaireHistory] = useState<SolitaireState[]>([])
  const [solitaireDealId, setSolitaireDealId] = useState(0)

  // ---- Scrabble ----
  const [scrabbleRole, setScrabbleRole] = useState<'host' | 'guest' | null>(null)
  const [scrabbleCode, setScrabbleCode] = useState('')
  const [scrabbleLocalPlayerId, setScrabbleLocalPlayerId] = useState<string | null>(null)
  const [scrabbleView, setScrabbleView] = useState<ScrabbleView | null>(null)
  const [scrabbleConnection, setScrabbleConnection] = useState<'connected' | 'disconnected'>('connected')
  const [scrabbleNotice, setScrabbleNotice] = useState<string | null>(null)
  const [scrabbleStarted, setScrabbleStarted] = useState(false)
  const [scrabbleSeats, setScrabbleSeats] = useState<{ playerId: string; name: string; isBot: boolean }[]>([])
  const [scrabbleDifficulty, setScrabbleDifficulty] = useState<BotDifficulty>('medium')

  const roomRef = useRef<RoomState | null>(null)
  const hostRef = useRef<HostHandle<RoomState> | null>(null)
  const guestRef = useRef<GuestHandle<Action> | null>(null)
  const botBusyRef = useRef(false)
  const rummySessionRef = useRef<RummySession | null>(null)
  const rummyHostRef = useRef<HostHandle<RummyView> | null>(null)
  const rummyGuestRef = useRef<GuestHandle<RummyAction> | null>(null)
  const rummyBotBusyRef = useRef(false)
  const rummyLocalPlayerIdRef = useRef<string | null>(null)
  const rummySeatsRef = useRef<{ playerId: string; name: string; isBot: boolean }[]>([])
  const rummyStartedRef = useRef(false)
  const rummyNamesRef = useRef<Record<string, string>>({})
  const rummyBotSeatsRef = useRef<Set<string>>(new Set())
  const rummyCardBackRef = useRef(savedCardBack())
  const rummyBotCounterRef = useRef(0)
  const phase10SessionRef = useRef<Phase10Session | null>(null)
  const phase10HostRef = useRef<HostHandle<Phase10View> | null>(null)
  const phase10GuestRef = useRef<GuestHandle<Phase10Action> | null>(null)
  const phase10BotBusyRef = useRef(false)
  const phase10LocalPlayerIdRef = useRef<string | null>(null)
  const phase10SeatsRef = useRef<{ playerId: string; name: string; isBot: boolean }[]>([])
  const phase10StartedRef = useRef(false)
  const phase10NamesRef = useRef<Record<string, string>>({})
  const phase10BotSeatsRef = useRef<Set<string>>(new Set())
  const phase10BotCounterRef = useRef(0)
  const battleshipSessionRef = useRef<BattleshipSession | null>(null)
  const battleshipHostRef = useRef<HostHandle<BattleshipView> | null>(null)
  const battleshipGuestRef = useRef<GuestHandle<BattleshipAction> | null>(null)
  const battleshipBotBusyRef = useRef(false)
  const battleshipLocalPlayerIdRef = useRef<string | null>(null)
  const battleshipOpponentIdRef = useRef<string | null>(null)
  const battleshipOpponentNameRef = useRef('')
  const battleshipVariantRef = useRef<BattleshipVariant>('standard')
  const dominoesSessionRef = useRef<DominoesSession | null>(null)
  const dominoesHostRef = useRef<HostHandle<DominoesView> | null>(null)
  const dominoesGuestRef = useRef<GuestHandle<DominoesAction> | null>(null)
  const dominoesBotBusyRef = useRef(false)
  const dominoesLocalPlayerIdRef = useRef<string | null>(null)
  const dominoesOpponentIdRef = useRef<string | null>(null)
  const dominoesOpponentNameRef = useRef('')
  const wahooSessionRef = useRef<WahooSession | null>(null)
  const wahooHostRef = useRef<HostHandle<WahooView> | null>(null)
  const wahooGuestRef = useRef<GuestHandle<WahooAction> | null>(null)
  const wahooBotBusyRef = useRef(false)
  const wahooLocalPlayerIdRef = useRef<string | null>(null)
  const wahooSeatsRef = useRef<{ playerId: string; name: string; isBot: boolean }[]>([])
  const wahooStartedRef = useRef(false)
  const wahooNamesRef = useRef<Record<string, string>>({})
  const wahooBotSeatsRef = useRef<Set<string>>(new Set())
  const wahooBotCounterRef = useRef(0)
  const wahooDroppedRef = useRef<string[]>([])
  const checkersSessionRef = useRef<CheckersSession | null>(null)
  const checkersHostRef = useRef<HostHandle<CheckersView> | null>(null)
  const checkersGuestRef = useRef<GuestHandle<CheckersAction> | null>(null)
  const checkersBotBusyRef = useRef(false)
  const checkersLocalPlayerIdRef = useRef<string | null>(null)
  const checkersSeatsRef = useRef<{ playerId: string; name: string; isBot: boolean }[]>([])
  const checkersStartedRef = useRef(false)
  const checkersNamesRef = useRef<Record<string, string>>({})
  const mtSessionRef = useRef<MTSession | null>(null)
  const mtHostRef = useRef<HostHandle<MTView> | null>(null)
  const mtGuestRef = useRef<GuestHandle<MTAction> | null>(null)
  const mtBotBusyRef = useRef(false)
  const mtLocalPlayerIdRef = useRef<string | null>(null)
  const mtSeatsRef = useRef<{ playerId: string; name: string; isBot: boolean }[]>([])
  const mtStartedRef = useRef(false)
  const mtNamesRef = useRef<Record<string, string>>({})
  const mtBotSeatsRef = useRef<Set<string>>(new Set())
  const mtBotCounterRef = useRef(0)
  const mtDroppedRef = useRef<string[]>([])
  const chessSessionRef = useRef<ChessSession | null>(null)
  const chessHostRef = useRef<HostHandle<ChessView> | null>(null)
  const chessGuestRef = useRef<GuestHandle<ChessAction> | null>(null)
  const chessBotBusyRef = useRef(false)
  const chessLocalPlayerIdRef = useRef<string | null>(null)
  const chessOpponentIdRef = useRef<string | null>(null)
  const chessOpponentNameRef = useRef('')
  const chessDifficultyRef = useRef<ChessDifficulty>('easy')
  const unoSessionRef = useRef<UnoSession | null>(null)
  const unoHostRef = useRef<HostHandle<UnoView> | null>(null)
  const unoGuestRef = useRef<GuestHandle<UnoAction> | null>(null)
  const unoBotBusyRef = useRef(false)
  const unoLocalPlayerIdRef = useRef<string | null>(null)
  const unoSeatsRef = useRef<{ playerId: string; name: string; isBot: boolean }[]>([])
  const unoStartedRef = useRef(false)
  const unoNamesRef = useRef<Record<string, string>>({})
  const unoBotSeatsRef = useRef<Set<string>>(new Set())
  const unoBotCounterRef = useRef(0)
  const unoDroppedRef = useRef<string[]>([])
  const unoDifficultyRef = useRef<BotDifficulty>('medium')
  const unoHouseRulesRef = useRef<Record<UnoHouseRuleKey, boolean>>(resolveHouseRules())
  // Bot Uno-call reflex state (§6): the vulnerable seat's playerId (null when
  // no window is open), plus a generation counter bumped on every window change
  // to invalidate any setTimeout scheduled against a now-stale window.
  const unoWindowKeyRef = useRef<string | null>(null)
  const unoReflexGenRef = useRef(0)
  // Deal-hold: no bot (turn loop or Uno-call reflex) may act until this
  // timestamp. Set every time unoBroadcast() observes the round counter
  // change — covers the initial deal, every rematch, and every START_NEXT_
  // ROUND, from one central place rather than each round-starting call site.
  const unoLastRoundRef = useRef<number | null>(null)
  const unoBotsHeldUntilRef = useRef(0)
  const skipBoSessionRef = useRef<SkipBoSession | null>(null)
  const skipBoHostRef = useRef<HostHandle<SkipBoView> | null>(null)
  const skipBoGuestRef = useRef<GuestHandle<SkipBoAction> | null>(null)
  const skipBoBotBusyRef = useRef(false)
  const skipBoLocalPlayerIdRef = useRef<string | null>(null)
  const skipBoSeatsRef = useRef<{ playerId: string; name: string; isBot: boolean }[]>([])
  const skipBoStartedRef = useRef(false)
  const skipBoNamesRef = useRef<Record<string, string>>({})
  const skipBoBotSeatsRef = useRef<Set<string>>(new Set())
  const skipBoBotCounterRef = useRef(0)
  const skipBoBotsHeldUntilRef = useRef(0)
  const scrabbleSessionRef = useRef<ScrabbleSession | null>(null)
  const scrabbleHostRef = useRef<HostHandle<ScrabbleView> | null>(null)
  const scrabbleGuestRef = useRef<GuestHandle<ScrabbleAction> | null>(null)
  const scrabbleBotBusyRef = useRef(false)
  const scrabbleLocalPlayerIdRef = useRef<string | null>(null)
  const scrabbleSeatsRef = useRef<{ playerId: string; name: string; isBot: boolean }[]>([])
  const scrabbleStartedRef = useRef(false)
  const scrabbleNamesRef = useRef<Record<string, string>>({})
  const scrabbleBotSeatsRef = useRef<Set<string>>(new Set())
  const scrabbleBotCounterRef = useRef(0)
  const scrabbleBotsHeldUntilRef = useRef(0)
  const scrabbleDictionaryRef = useRef<ScrabbleDictionary | null>(null)
  const scrabbleDifficultyRef = useRef<BotDifficulty>('medium')
  // Routing: the popstate guard reads the live game from a ref (no stale closures).
  const liveGameRef = useRef<RoutedGame | null>(null)
  const pendingHostBootRef = useRef<RoutedGame | null>(null)

  useEffect(() => {
    roomRef.current = room
  }, [room])

  useEffect(() => () => {
    hostRef.current?.destroy()
    guestRef.current?.destroy()
    rummyHostRef.current?.destroy()
    rummyGuestRef.current?.destroy()
    phase10HostRef.current?.destroy()
    phase10GuestRef.current?.destroy()
    battleshipHostRef.current?.destroy()
    battleshipGuestRef.current?.destroy()
    dominoesHostRef.current?.destroy()
    dominoesGuestRef.current?.destroy()
    wahooHostRef.current?.destroy()
    wahooGuestRef.current?.destroy()
    checkersHostRef.current?.destroy()
    checkersGuestRef.current?.destroy()
    chessHostRef.current?.destroy()
    chessGuestRef.current?.destroy()
    unoHostRef.current?.destroy()
    unoGuestRef.current?.destroy()
    skipBoHostRef.current?.destroy()
    skipBoGuestRef.current?.destroy()
    scrabbleHostRef.current?.destroy()
    scrabbleGuestRef.current?.destroy()
  }, [])

  // ---- Routing ----

  function pushGameUrl(game: RoutedGame) {
    if (gameFromPath(location.pathname) !== game) history.pushState({}, '', gamePath(game))
  }

  function replaceGameUrl(game: RoutedGame) {
    if (gameFromPath(location.pathname) !== game) history.replaceState({}, '', gamePath(game))
  }

  // Boot: seed the name from the cookie, then act on the initial URL —
  // ?join= deep link, game deep link (host), or plain shelf.
  useEffect(() => {
    const cookieName = readNameCookie()
    if (cookieName) setName(cookieName)
    const boot = decideBoot(location.pathname, location.search, !!cookieName)
    switch (boot.kind) {
      case 'join':
        setJoinCodeInput(boot.code.toUpperCase())
        break
      case 'host':
        // replaceState first: a deep link has no /pips entry beneath, so
        // Back exits the site — correct for a deep link. The shelf handler
        // runs once the cookie-seeded name lands in state (host starters
        // read `name` synchronously).
        history.replaceState({}, '', gamePath(boot.game))
        pendingHostBootRef.current = boot.game
        break
      case 'shelf-needs-name':
        history.replaceState({}, '', '/pips/')
        break
      case 'shelf':
        // Plain shelf on a junk path (/pips/not-a-game): scrub the URL so it
        // doesn't linger in the address bar. 'shelf' already means no game
        // path, so the base forms are the only paths fine as-is.
        if (location.pathname !== '/' && location.pathname !== '/pips' && location.pathname !== '/pips/') {
          history.replaceState({}, '', '/pips/')
        }
        break
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Deep-link host: start the game after the cookie name has been seeded.
  useEffect(() => {
    const game = pendingHostBootRef.current
    if (game === null || name === '') return
    pendingHostBootRef.current = null
    hostGameFromBoot(game)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])

  // Current "live game" for the popstate guard. Lobbies/rooms and results
  // screens are NOT live; battleship stays live until stage === 'over'
  // (leaving mid-match is what we guard).
  function liveGameNow(): RoutedGame | null {
    const legacy = roomRef.current
    if (legacy && legacy.screen !== 'room' && legacy.screen !== 'results') return legacy.game
    if (rummyRole && rummyStarted && rummyView?.kind === 'game' && !rummyView.publicState.matchWinnerId) return 'rummy'
    if (phase10Role && phase10Started && phase10View?.kind === 'game' && !phase10View.publicState.matchWinnerId) return 'phase10'
    if (battleshipRole && battleshipView && battleshipView.publicState.stage !== 'over') return 'battleship'
    if (dominoesRole && dominoesView && dominoesView.publicState.stage !== 'over') return 'dominoes'
    if (wahooRole && wahooStarted && wahooView?.kind === 'game' && wahooView.publicState.stage !== 'over') return 'wahoo'
    if (checkersRole && checkersStarted && checkersView?.kind === 'game' && checkersView.publicState.stage !== 'over') return 'checkers'
    if (mtRole && mtStarted && mtView?.kind === 'game' && mtView.publicState.stage !== 'over') return 'mexican-train'
    if (chessRole && chessView && chessView.publicState.stage !== 'over') return 'chess'
    if (unoRole && unoStarted && unoView?.kind === 'game' && unoView.publicState.stage !== 'over') return 'uno'
    if (skipBoRole && skipBoStarted && skipBoView?.kind === 'game' && !skipBoView.publicState.roundOver) return 'skipbo'
    if (solitaireOpen && solitaireHistory.length > 0 && !solitaireHistory[solitaireHistory.length - 1].won) return 'solitaire'
    if (scrabbleRole && scrabbleStarted && scrabbleView?.kind === 'game' && scrabbleView.publicState.stage !== 'over') return 'scrabble'
    return null
  }

  useEffect(() => {
    liveGameRef.current = liveGameNow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, rummyRole, rummyStarted, rummyView, phase10Role, phase10Started, phase10View, battleshipRole, battleshipView, dominoesRole, dominoesView, wahooRole, wahooStarted, wahooView, checkersRole, checkersStarted, checkersView, mtRole, mtStarted, mtView, chessRole, chessView, unoRole, unoStarted, unoView, skipBoRole, skipBoStarted, skipBoView, solitaireOpen, solitaireHistory, scrabbleRole, scrabbleStarted, scrabbleView])

  // Back/forward guard: confirm before leaving a live game mid-match.
  useEffect(() => {
    const onPopstate = () => {
      const game = liveGameRef.current
      if (game !== null && !window.confirm('Leave the game?')) {
        history.pushState({}, '', gamePath(game))
        return
      }
      resetToEntry({ fromPopstate: true })
    }
    window.addEventListener('popstate', onPopstate)
    return () => window.removeEventListener('popstate', onPopstate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function hostGameFromBoot(game: RoutedGame) {
    switch (game) {
      case 'farkle': case 'yahtzee': case 'ttt': case 'hangman': case 'connect4':
        startHost(game)
        return
      case 'rummy': startRummyHost(); return
      case 'phase10': startPhase10Host(); return
      case 'battleship': startBattleshipHost(); return
      case 'dominoes': startDominoesHost(); return
      case 'wahoo': startWahooHost(); return
      case 'checkers': startCheckersHost(); return
      case 'mexican-train': startMTHost(); return
      case 'chess': startChessHost(); return
      case 'uno': startUnoHost(); return
      case 'skipbo': startSkipBoHost(); return
      case 'solitaire': startSolitaire(); return
      case 'scrabble': startScrabbleHost(); return
    }
  }

  function hostApply(action: Action, by: string): RoomState | null {
    if (!roomRef.current) return null
    const next = applyAction(roomRef.current, action, by)
    if (action.type === 'pickGame') replaceGameUrl(next.game)
    roomRef.current = next
    setRoom(next)
    hostRef.current?.broadcast(next)
    return next
  }

  function dispatch(action: Action) {
    if (role === 'host' && localSeatId) hostApply(action, localSeatId)
    else if (role === 'guest') guestRef.current?.sendAction(action)
  }

  function startHost(game: Game) {
    setError(null)
    hostRef.current = createHost<RoomState, Action>(() => `${GAME_CODE_PREFIX[game]}-${generateCode()}`, {
      onReady(code) {
        const hostId = peerIdForCode(code)
        const initial = makeRoom(code, game, name.trim(), hostId)
        roomRef.current = initial
        setRoom(initial)
        setRole('host')
        writeNameCookie(name)
        pushGameUrl(game)
        setLocalSeatId(hostId)
      },
      onJoin(guestId, guestName) {
        const next = addSeat(roomRef.current!, guestId, guestName, false)
        roomRef.current = next
        setRoom(next)
        hostRef.current?.broadcast(next)
      },
      onAction(guestId, action) {
        hostApply(action, guestId)
      },
      onLeave(guestId) {
        const prev = roomRef.current!
        let next = removeSeat(prev, guestId)
        if (next.turnIdx >= next.seats.length) next = { ...next, turnIdx: 0 }
        roomRef.current = next
        setRoom(next)
        hostRef.current?.broadcast(next)
      },
      onError(message) {
        setError(message)
      },
    })
  }

  function startGuest(code: string) {
    if (!code) return
    setError(null)
    const handle = joinHost<RoomState, Action>(code, name.trim(), {
      onState(state) {
        const first = roomRef.current === null
        roomRef.current = state
        setRoom(state)
        if (first) {
          writeNameCookie(name)
          pushGameUrl(state.game)
        } else {
          replaceGameUrl(state.game)
        }
      },
      onError() {
        setError('Could not reach that room. Check the code and try again.')
      },
      onDisconnected() {
        setError('Lost connection to the host.')
      },
    })
    guestRef.current = handle
    setRole('guest')
    handle.peerId.then((id) => setLocalSeatId(id)).catch(() => {})
  }

  function resetToEntry(opts?: { fromPopstate?: boolean }) {
    hostRef.current?.destroy()
    hostRef.current = null
    guestRef.current?.destroy()
    guestRef.current = null
    roomRef.current = null
    setRoom(null)
    setRole(null)
    setLocalSeatId(null)
    setRulesOpen(false)
    setJoinCodeInput('')
    // Rummy
    rummyHostRef.current?.destroy()
    rummyHostRef.current = null
    rummyGuestRef.current?.destroy()
    rummyGuestRef.current = null
    rummySessionRef.current = null
    setRummyRole(null)
    setRummyCode('')
    setRummyLocalPlayerId(null)
    rummyLocalPlayerIdRef.current = null
    setRummyView(null)
    setRummyConnection('connected')
    setRummyNotice(null)
    setRummyStarted(false)
    rummyStartedRef.current = false
    setRummySeats([])
    rummySeatsRef.current = []
    rummyBotBusyRef.current = false
    rummyBotSeatsRef.current.clear()
    rummyBotCounterRef.current = 0
    rummyNamesRef.current = {}
    // Card back deliberately survives a reset — it's the host's saved preference.
    // Phase 10
    phase10HostRef.current?.destroy()
    phase10HostRef.current = null
    phase10GuestRef.current?.destroy()
    phase10GuestRef.current = null
    phase10SessionRef.current = null
    setPhase10Role(null)
    setPhase10Code('')
    setPhase10LocalPlayerId(null)
    phase10LocalPlayerIdRef.current = null
    setPhase10View(null)
    setPhase10Connection('connected')
    setPhase10Notice(null)
    setPhase10Started(false)
    phase10StartedRef.current = false
    setPhase10Seats([])
    phase10SeatsRef.current = []
    phase10BotBusyRef.current = false
    phase10BotSeatsRef.current.clear()
    phase10BotCounterRef.current = 0
    phase10NamesRef.current = {}
    // Battleship
    battleshipHostRef.current?.destroy()
    battleshipHostRef.current = null
    battleshipGuestRef.current?.destroy()
    battleshipGuestRef.current = null
    battleshipSessionRef.current = null
    setBattleshipRole(null)
    setBattleshipCode('')
    setBattleshipLocalPlayerId(null)
    battleshipLocalPlayerIdRef.current = null
    setBattleshipOpponentId(null)
    battleshipOpponentIdRef.current = null
    setBattleshipOpponentName('')
    battleshipOpponentNameRef.current = ''
    setBattleshipView(null)
    setBattleshipConnection('connected')
    setBattleshipWaiting(false)
    setBattleshipVariant('standard')
    battleshipVariantRef.current = 'standard'
    // Dominoes
    dominoesHostRef.current?.destroy()
    dominoesHostRef.current = null
    dominoesGuestRef.current?.destroy()
    dominoesGuestRef.current = null
    dominoesSessionRef.current = null
    setDominoesRole(null)
    setDominoesCode('')
    setDominoesLocalPlayerId(null)
    dominoesLocalPlayerIdRef.current = null
    setDominoesOpponentId(null)
    dominoesOpponentIdRef.current = null
    setDominoesOpponentName('')
    dominoesOpponentNameRef.current = ''
    setDominoesView(null)
    setDominoesConnection('connected')
    setDominoesWaiting(false)
    // Wahoo
    wahooHostRef.current?.destroy()
    wahooHostRef.current = null
    wahooGuestRef.current?.destroy()
    wahooGuestRef.current = null
    wahooSessionRef.current = null
    setWahooRole(null)
    setWahooCode('')
    setWahooLocalPlayerId(null)
    wahooLocalPlayerIdRef.current = null
    setWahooView(null)
    setWahooConnection('connected')
    setWahooNotice(null)
    setWahooStarted(false)
    wahooStartedRef.current = false
    setWahooSeats([])
    wahooSeatsRef.current = []
    setWahooDropped([])
    wahooDroppedRef.current = []
    wahooBotBusyRef.current = false
    wahooBotSeatsRef.current.clear()
    wahooBotCounterRef.current = 0
    wahooNamesRef.current = {}
    // Checkers
    checkersHostRef.current?.destroy()
    checkersHostRef.current = null
    checkersGuestRef.current?.destroy()
    checkersGuestRef.current = null
    checkersSessionRef.current = null
    setCheckersRole(null)
    setCheckersCode('')
    setCheckersLocalPlayerId(null)
    checkersLocalPlayerIdRef.current = null
    setCheckersView(null)
    setCheckersConnection('connected')
    setCheckersStarted(false)
    checkersStartedRef.current = false
    setCheckersSeats([])
    checkersSeatsRef.current = []
    checkersBotBusyRef.current = false
    checkersNamesRef.current = {}
    // Mexican Train
    mtHostRef.current?.destroy()
    mtHostRef.current = null
    mtGuestRef.current?.destroy()
    mtGuestRef.current = null
    mtSessionRef.current = null
    setMTRole(null)
    setMTCode('')
    setMTLocalPlayerId(null)
    mtLocalPlayerIdRef.current = null
    setMTView(null)
    setMTConnection('connected')
    setMTNotice(null)
    setMTStarted(false)
    mtStartedRef.current = false
    setMTSeats([])
    mtSeatsRef.current = []
    setMTDropped([])
    mtDroppedRef.current = []
    mtBotBusyRef.current = false
    mtBotSeatsRef.current.clear()
    mtBotCounterRef.current = 0
    mtNamesRef.current = {}
    // Chess
    chessHostRef.current?.destroy()
    chessHostRef.current = null
    chessGuestRef.current?.destroy()
    chessGuestRef.current = null
    chessSessionRef.current = null
    setChessRole(null)
    setChessCode('')
    setChessLocalPlayerId(null)
    chessLocalPlayerIdRef.current = null
    setChessOpponentId(null)
    chessOpponentIdRef.current = null
    setChessOpponentName('')
    chessOpponentNameRef.current = ''
    setChessView(null)
    setChessConnection('connected')
    setChessWaiting(false)
    setChessDifficulty('easy')
    chessDifficultyRef.current = 'easy'
    // Uno
    unoHostRef.current?.destroy()
    unoHostRef.current = null
    unoGuestRef.current?.destroy()
    unoGuestRef.current = null
    unoSessionRef.current = null
    setUnoRole(null)
    setUnoCode('')
    setUnoLocalPlayerId(null)
    unoLocalPlayerIdRef.current = null
    setUnoView(null)
    setUnoConnection('connected')
    setUnoNotice(null)
    setUnoStarted(false)
    unoStartedRef.current = false
    setUnoSeats([])
    unoSeatsRef.current = []
    setUnoDropped([])
    unoDroppedRef.current = []
    unoBotBusyRef.current = false
    unoBotSeatsRef.current.clear()
    unoBotCounterRef.current = 0
    unoNamesRef.current = {}
    setUnoHouseRules(resolveHouseRules())
    unoHouseRulesRef.current = resolveHouseRules()
    unoDifficultyRef.current = 'medium'
    setUnoDifficulty('medium')
    unoWindowKeyRef.current = null
    unoReflexGenRef.current = 0
    // Skip-Bo
    skipBoHostRef.current?.destroy()
    skipBoHostRef.current = null
    skipBoGuestRef.current?.destroy()
    skipBoGuestRef.current = null
    skipBoSessionRef.current = null
    setSkipBoRole(null)
    setSkipBoCode('')
    setSkipBoLocalPlayerId(null)
    skipBoLocalPlayerIdRef.current = null
    setSkipBoView(null)
    setSkipBoConnection('connected')
    setSkipBoNotice(null)
    setSkipBoStarted(false)
    skipBoStartedRef.current = false
    setSkipBoSeats([])
    skipBoSeatsRef.current = []
    skipBoBotBusyRef.current = false
    skipBoBotSeatsRef.current.clear()
    skipBoBotCounterRef.current = 0
    skipBoNamesRef.current = {}
    skipBoBotsHeldUntilRef.current = 0
    // Solitaire
    setSolitaireOpen(false)
    setSolitaireHistory([])
    // Scrabble
    scrabbleHostRef.current?.destroy()
    scrabbleHostRef.current = null
    scrabbleGuestRef.current?.destroy()
    scrabbleGuestRef.current = null
    scrabbleSessionRef.current = null
    setScrabbleRole(null)
    setScrabbleCode('')
    setScrabbleLocalPlayerId(null)
    scrabbleLocalPlayerIdRef.current = null
    setScrabbleView(null)
    setScrabbleConnection('connected')
    setScrabbleNotice(null)
    setScrabbleStarted(false)
    scrabbleStartedRef.current = false
    setScrabbleSeats([])
    scrabbleSeatsRef.current = []
    setScrabbleDifficulty('medium')
    scrabbleDifficultyRef.current = 'medium'
    scrabbleBotBusyRef.current = false
    scrabbleBotSeatsRef.current.clear()
    scrabbleBotCounterRef.current = 0
    scrabbleNamesRef.current = {}
    scrabbleBotsHeldUntilRef.current = 0
    scrabbleDictionaryRef.current = null
    // UI Leave buttons land on the shelf; from popstate the browser has
    // already moved, so history is left alone.
    if (!opts?.fromPopstate) history.replaceState({}, '', '/pips/')
  }

  function whoActsNow(state: RoomState): { id: string; bot: boolean } | null {
    if (state.screen === 'hangman') {
      if (state.hangman.phase !== 'guessing' || state.hangman.over) return null
      const seat = state.seats[state.hangman.guesserIdx]
      return seat ? { id: seat.id, bot: seat.bot } : null
    }
    if (state.screen === 'farkle' || state.screen === 'yahtzee' || state.screen === 'ttt' || state.screen === 'connect4') {
      const seat = state.seats[state.turnIdx]
      return seat ? { id: seat.id, bot: seat.bot } : null
    }
    return null
  }

  function actorKey(state: RoomState): string {
    return `${state.screen}:${state.turnIdx}:${state.hangman.phase}:${state.hangman.guesserIdx}`
  }

  function stale(key: string) {
    return !roomRef.current || actorKey(roomRef.current) !== key
  }

  // ---- Rummy helpers ----

  // Fixed per-seat ink palette, zipped against seatOrder the same way Uno's
  // UNO_SEAT_INKS is. Rummy's cap is 4 seats, so 4 entries (first 4 of Uno's
  // own palette — same visual language across games).
  const RUMMY_SEAT_INKS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308']
  // Phase 10 caps at 6 seats, so this reuses Uno's full first-six palette
  // (same palette-reuse convention Rummy's spec 36 established for its 4-entry version).
  const PHASE10_SEAT_INKS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#9333ea', '#0fb5a0']

  // The actor key must re-key on any field that can change within the SAME
  // player's turn (a draw-then-play is two actions, same turnNumber), so the
  // loop re-evaluates after a draw that doesn't advance the turn.
  function rummyActorKey(session: RummySession): string {
    const ps = session.session.publicState
    return `${ps.roundNumber}:${ps.turn.turnNumber}:${ps.turn.phase}:${ps.obligatedCardId ?? ''}:${ps.stockCount}:${ps.discardPile.cards.length}:${ps.layoffs.length}`
  }

  function rummyStale(key: string) {
    return !rummySessionRef.current || rummyActorKey(rummySessionRef.current) !== key
  }

  // Hands are PRIVATE and up to 3 guests can be seated, so a single broadcast
  // cannot carry every hand (any guest would see the others'). Lobby phase →
  // broadcast the roster view; game phase → per-guest sendTo with only that
  // guest's own hand. The host's own view comes from its local snapshot.
  function rummyBroadcast() {
    if (!rummyStartedRef.current) {
      const view: RummyView = {
        kind: 'lobby',
        roster: rummySeatsRef.current.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === rummyLocalPlayerIdRef.current })),
        cardBack: rummyCardBackRef.current,
      }
      setRummyView(view)
      rummyHostRef.current?.broadcast(view)
      return
    }
    const session = rummySessionRef.current!
    const hostSnap = deriveSnapshot(session.session, rummyLocalPlayerIdRef.current!)
    setRummyView({
      kind: 'game',
      revision: hostSnap.revision,
      publicState: hostSnap.publicState,
      hand: hostSnap.privateState!.hand.cards,
      names: { ...rummyNamesRef.current },
    })
    const names = { ...rummyNamesRef.current }
    for (const seat of rummySeatsRef.current) {
      if (seat.playerId === rummyLocalPlayerIdRef.current) continue
      if (rummyBotSeatsRef.current.has(seat.playerId)) continue
      const guestSnap = deriveSnapshot(session.session, seat.playerId)
      rummyHostRef.current?.sendTo(seat.playerId, {
        kind: 'game',
        revision: guestSnap.revision,
        publicState: guestSnap.publicState,
        hand: guestSnap.privateState!.hand.cards,
        names,
      })
    }
  }

  function startRummyHost() {
    setError(null)
    rummyHostRef.current = createHost<RummyView, RummyAction>(() => `RM-${generateCode()}`, {
      onReady(code) {
        const hostId = peerIdForCode(code)
        setRummyRole('host')
        writeNameCookie(name)
        pushGameUrl('rummy')
        setRummyCode(code)
        setRummyLocalPlayerId(hostId)
        rummyLocalPlayerIdRef.current = hostId
        setRummyStarted(false)
        rummyStartedRef.current = false
        setRummySeats([{ playerId: hostId, name: name.trim(), isBot: false }])
        rummySeatsRef.current = [{ playerId: hostId, name: name.trim(), isBot: false }]
        setRummyNotice(null)
        rummyBroadcast()
      },
      onJoin(guestId, guestName) {
        if (rummyStartedRef.current) {
          rummyHostRef.current?.reject(guestId, 'Game in progress — spectating comes later.')
          return
        }
        if (rummySeatsRef.current.length >= RUMMY_MAX_SEATS) {
          rummyHostRef.current?.reject(guestId, 'Table is full.')
          return
        }
        rummySeatsRef.current = [...rummySeatsRef.current, { playerId: guestId, name: guestName, isBot: false }]
        setRummySeats(rummySeatsRef.current)
        rummyBroadcast()
      },
      onAction(guestId, action) {
        if (!rummyStartedRef.current) return
        const session = rummySessionRef.current
        if (!session) return
        if (!rummySeatsRef.current.some((s) => s.playerId === guestId)) return
        const result = applyRummyAction(session, guestId, action)
        if (!result.outcome.ok) return
        rummySessionRef.current = result.rummy
        rummyBroadcast()
      },
      onLeave(guestId) {
        if (!rummyStartedRef.current) {
          rummySeatsRef.current = rummySeatsRef.current.filter((s) => s.playerId !== guestId)
          setRummySeats(rummySeatsRef.current)
          rummyBroadcast()
          return
        }
        const seat = rummySeatsRef.current.find((s) => s.playerId === guestId)
        if (!seat) return
        setRummyNotice(`${seat.name} disconnected.`)
      },
      onError(message) {
        setError(message)
      },
    })
  }

  function addRummyHouseBot() {
    if (rummyRole !== 'host' || rummyStartedRef.current) return
    if (rummySeatsRef.current.length >= RUMMY_MAX_SEATS) return
    rummyBotCounterRef.current += 1
    const botId = `bot-${rummyBotCounterRef.current}`
    const botName = randomBotName(rummySeatsRef.current.map((s) => s.name))
    rummySeatsRef.current = [...rummySeatsRef.current, { playerId: botId, name: botName, isBot: true }]
    setRummySeats(rummySeatsRef.current)
    rummyBotSeatsRef.current.add(botId)
    rummyBroadcast()
  }

  function rummyStart() {
    if (rummyRole !== 'host' || rummyStartedRef.current) return
    const seats = rummySeatsRef.current
    // Variable seat count: at least RUMMY_MIN_SEATS, at most RUMMY_MAX_SEATS —
    // whatever is seated when the host presses Start, NOT a fixed-count gate.
    if (seats.length < RUMMY_MIN_SEATS || seats.length > RUMMY_MAX_SEATS) return
    const playerIds = seats.map((s) => s.playerId)
    const seed = Math.floor(Math.random() * 2147483647)
    rummySessionRef.current = createRummyGame(playerIds, seed, rummyCardBackRef.current)
    rummyNamesRef.current = Object.fromEntries(seats.map((s) => [s.playerId, s.name]))
    rummyStartedRef.current = true
    setRummyStarted(true)
    rummyBroadcast()
  }

  async function runRummyBot(botId: string, key: string) {
    while (!rummyStale(key)) {
      await wait(BASE_MS)
      if (rummyStale(key)) return
      const session = rummySessionRef.current!
      const ps = session.session.publicState
      if (ps.roundOver || ps.matchWinnerId) return
      if (currentPlayer(ps.turn) !== botId) return
      if (!rummyBotSeatsRef.current.has(botId)) return
      const result = runRummyBotTurn(session, botId, rummyBotStrategy)
      if (!result.outcome.ok) return
      rummySessionRef.current = result.rummy
      rummyBroadcast()
    }
  }

  async function runRummyBotsIfNeeded() {
    if (rummyBotBusyRef.current) return
    const session = rummySessionRef.current
    if (!session) return
    const ps = session.session.publicState
    if (ps.roundOver || ps.matchWinnerId) return
    const currentId = currentPlayer(ps.turn)
    if (!rummyBotSeatsRef.current.has(currentId)) return
    rummyBotBusyRef.current = true
    const key = rummyActorKey(session)
    try {
      await runRummyBot(currentId, key)
    } finally {
      rummyBotBusyRef.current = false
      setTimeout(() => runRummyBotsIfNeeded(), 50)
    }
  }

  function startRummyGuest(code: string) {
    if (!code) return
    setError(null)
    let localRevision = -1
    const handle = joinHost<RummyView, RummyAction>(code, name.trim(), {
      onState(view) {
        if (view.kind === 'lobby') {
          setRummyView(view)
          setRummyStarted(false)
          return
        }
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        setRummyView(view)
        setRummyStarted(true)
      },
      onError() {
        resetToEntry()
        setError('Could not reach that room. Check the code and try again.')
      },
      onRejected(reason) {
        resetToEntry()
        setError(reason)
      },
      onConnected() {
        setRummyConnection('connected')
      },
      onDisconnected() {
        setRummyConnection('disconnected')
      },
    })
    rummyGuestRef.current = handle
    setRummyRole('guest')
    writeNameCookie(name)
    pushGameUrl('rummy')
    setRummyCode(code)
    handle.peerId.then((id) => { setRummyLocalPlayerId(id); rummyLocalPlayerIdRef.current = id }).catch(() => {})
  }

  function rummyDispatch(action: RummyAction) {
    if (rummyRole === 'host' && rummyLocalPlayerId) {
      const session = rummySessionRef.current
      if (!session) return
      const result = applyRummyAction(session, rummyLocalPlayerId, action)
      if (!result.outcome.ok) return
      rummySessionRef.current = result.rummy
      rummyBroadcast()
    } else if (rummyRole === 'guest') {
      rummyGuestRef.current?.sendAction(action)
    }
  }

  function rummyRematch() {
    if (rummyRole !== 'host' || !rummySessionRef.current) return
    const ps = rummySessionRef.current.session.publicState
    if (ps.matchWinnerId === null) return
    const prevRevision = rummySessionRef.current.session.revision
    const playerIds = [...ps.seatOrder]
    const seed = Math.floor(Math.random() * 2147483647)
    const next = createRummyGame(playerIds, seed, ps.cardBack)
    next.session = { ...next.session, revision: prevRevision + 1 }
    rummySessionRef.current = next
    rummyBroadcast()
  }

  function setCardBackPreference(id: string) {
    rummyCardBackRef.current = id
    setRummyCardBack(id)
    writeCardBackCookie(id)
  }

  function rummySetCardBack(id: string) {
    if (rummyRole !== 'host' || rummyStartedRef.current) return
    // Ref-first: rummyBroadcast() runs synchronously and must send the new pick.
    setCardBackPreference(id)
    rummyBroadcast()
  }

  function phase10SetCardBack(id: string) {
    if (phase10Role !== 'host' || phase10StartedRef.current) return
    setCardBackPreference(id)
    phase10Broadcast()
  }

  function unoSetCardBack(id: string) {
    if (unoRole !== 'host' || unoStartedRef.current) return
    setCardBackPreference(id)
    unoBroadcast()
  }

  function skipBoSetCardBack(id: string) {
    if (skipBoRole !== 'host' || skipBoStartedRef.current) return
    setCardBackPreference(id)
    skipBoBroadcast()
  }

  // ---- End Rummy helpers ----

  // ---- Solitaire helpers ----

  function startSolitaire() {
    writeNameCookie(name)
    pushGameUrl('solitaire')
    setError(null)
    setSolitaireHistory([])
    setSolitaireOpen(true)
  }

  function solitaireDeal() {
    const seed = Math.floor(Math.random() * 2147483647)
    setSolitaireHistory([createSolitaireGame(solitaireMode, seed)])
    setSolitaireDealId((n) => n + 1)
  }

  function solitaireApply(move: SolitaireMove) {
    setSolitaireHistory((h) => {
      const current = h[h.length - 1]
      const outcome = applySolitaireMove(current, move)
      return outcome.ok ? [...h, outcome.state] : h
    })
  }

  function solitaireUndo() {
    setSolitaireHistory((h) => (h.length > 1 ? h.slice(0, -1) : h))
  }

  // ---- End Solitaire helpers ----

  // ---- Phase 10 helpers ----

  // The actor key must re-key on any field that can change within the SAME
  // player's turn (a draw-then-play is two actions, same turnNumber), so the
  // loop re-evaluates after a draw that doesn't advance the turn.
  function phase10ActorKey(session: Phase10Session): string {
    const ps = session.session.publicState
    return `${ps.roundNumber}:${ps.turn.turnNumber}:${ps.turn.phase}:${ps.stockCount}:${ps.discardPile.cards.length}:${ps.hits.length}:${Object.values(ps.groups).reduce((n, gs) => n + gs.length, 0)}`
  }

  function phase10Stale(key: string) {
    return !phase10SessionRef.current || phase10ActorKey(phase10SessionRef.current) !== key
  }

  // Hands are PRIVATE and up to 5 guests can be seated, so a single broadcast
  // cannot carry every hand (any guest would see the others'). Lobby phase →
  // broadcast the roster view; game phase → per-guest sendTo with only that
  // guest's own hand. The host's own view comes from its local snapshot.
  function phase10Broadcast() {
    if (!phase10StartedRef.current) {
      const view: Phase10View = {
        kind: 'lobby',
        roster: phase10SeatsRef.current.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === phase10LocalPlayerIdRef.current })),
        cardBack: rummyCardBackRef.current,
      }
      setPhase10View(view)
      phase10HostRef.current?.broadcast(view)
      return
    }
    const session = phase10SessionRef.current!
    const hostSnap = deriveSnapshot(session.session, phase10LocalPlayerIdRef.current!)
    setPhase10View({
      kind: 'game',
      revision: hostSnap.revision,
      publicState: hostSnap.publicState,
      privateState: hostSnap.privateState!,
      names: { ...phase10NamesRef.current },
    })
    const names = { ...phase10NamesRef.current }
    for (const seat of phase10SeatsRef.current) {
      if (seat.playerId === phase10LocalPlayerIdRef.current) continue
      if (phase10BotSeatsRef.current.has(seat.playerId)) continue
      const guestSnap = deriveSnapshot(session.session, seat.playerId)
      phase10HostRef.current?.sendTo(seat.playerId, {
        kind: 'game',
        revision: guestSnap.revision,
        publicState: guestSnap.publicState,
        privateState: guestSnap.privateState!,
        names,
      })
    }
  }

  function startPhase10Host() {
    setError(null)
    phase10HostRef.current = createHost<Phase10View, Phase10Action>(() => `P10-${generateCode()}`, {
      onReady(code) {
        const hostId = peerIdForCode(code)
        setPhase10Role('host')
        writeNameCookie(name)
        pushGameUrl('phase10')
        setPhase10Code(code)
        setPhase10LocalPlayerId(hostId)
        phase10LocalPlayerIdRef.current = hostId
        setPhase10Started(false)
        phase10StartedRef.current = false
        setPhase10Seats([{ playerId: hostId, name: name.trim(), isBot: false }])
        phase10SeatsRef.current = [{ playerId: hostId, name: name.trim(), isBot: false }]
        setPhase10Notice(null)
        phase10Broadcast()
      },
      onJoin(guestId, guestName) {
        if (phase10StartedRef.current) {
          phase10HostRef.current?.reject(guestId, 'Game in progress — spectating comes later.')
          return
        }
        if (phase10SeatsRef.current.length >= PHASE10_MAX_SEATS) {
          phase10HostRef.current?.reject(guestId, 'Table is full.')
          return
        }
        phase10SeatsRef.current = [...phase10SeatsRef.current, { playerId: guestId, name: guestName, isBot: false }]
        setPhase10Seats(phase10SeatsRef.current)
        phase10Broadcast()
      },
      onAction(guestId, action) {
        if (!phase10StartedRef.current) return
        const session = phase10SessionRef.current
        if (!session) return
        if (!phase10SeatsRef.current.some((s) => s.playerId === guestId)) return
        const result = applyPhase10Action(session, guestId, action)
        if (!result.outcome.ok) return
        phase10SessionRef.current = result.game
        phase10Broadcast()
      },
      onLeave(guestId) {
        if (!phase10StartedRef.current) {
          phase10SeatsRef.current = phase10SeatsRef.current.filter((s) => s.playerId !== guestId)
          setPhase10Seats(phase10SeatsRef.current)
          phase10Broadcast()
          return
        }
        const seat = phase10SeatsRef.current.find((s) => s.playerId === guestId)
        if (!seat) return
        setPhase10Notice(`${seat.name} disconnected.`)
      },
      onError(message) {
        setError(message)
      },
    })
  }

  function addPhase10HouseBot() {
    if (phase10Role !== 'host' || phase10StartedRef.current) return
    if (phase10SeatsRef.current.length >= PHASE10_MAX_SEATS) return
    phase10BotCounterRef.current += 1
    const botId = `bot-${phase10BotCounterRef.current}`
    const botName = randomBotName(phase10SeatsRef.current.map((s) => s.name))
    phase10SeatsRef.current = [...phase10SeatsRef.current, { playerId: botId, name: botName, isBot: true }]
    setPhase10Seats(phase10SeatsRef.current)
    phase10BotSeatsRef.current.add(botId)
    phase10Broadcast()
  }

  function phase10Start() {
    if (phase10Role !== 'host' || phase10StartedRef.current) return
    const seats = phase10SeatsRef.current
    // Variable seat count: at least PHASE10_MIN_SEATS, at most PHASE10_MAX_SEATS —
    // whatever is seated when the host presses Start, NOT a fixed-count gate.
    if (seats.length < PHASE10_MIN_SEATS || seats.length > PHASE10_MAX_SEATS) return
    const playerIds = seats.map((s) => s.playerId)
    const seed = Math.floor(Math.random() * 2147483647)
    phase10SessionRef.current = createPhase10Game(playerIds, seed, rummyCardBackRef.current)
    phase10NamesRef.current = Object.fromEntries(seats.map((s) => [s.playerId, s.name]))
    phase10StartedRef.current = true
    setPhase10Started(true)
    phase10Broadcast()
  }

  async function runPhase10Bot(botId: string, key: string) {
    while (!phase10Stale(key)) {
      await wait(BASE_MS)
      if (phase10Stale(key)) return
      const session = phase10SessionRef.current!
      const ps = session.session.publicState
      if (ps.roundOver || ps.matchWinnerId) return
      if (currentPlayer(ps.turn) !== botId) return
      if (!phase10BotSeatsRef.current.has(botId)) return
      const result = runPhase10BotTurn(session, botId, phase10BotStrategy)
      if (!result.outcome.ok) return
      phase10SessionRef.current = result.game
      phase10Broadcast()
    }
  }

  async function runPhase10BotsIfNeeded() {
    if (phase10BotBusyRef.current) return
    const session = phase10SessionRef.current
    if (!session) return
    const ps = session.session.publicState
    if (ps.roundOver || ps.matchWinnerId) return
    const currentId = currentPlayer(ps.turn)
    if (!phase10BotSeatsRef.current.has(currentId)) return
    phase10BotBusyRef.current = true
    const key = phase10ActorKey(session)
    try {
      await runPhase10Bot(currentId, key)
    } finally {
      phase10BotBusyRef.current = false
      setTimeout(() => runPhase10BotsIfNeeded(), 50)
    }
  }

  function startPhase10Guest(code: string) {
    if (!code) return
    setError(null)
    let localRevision = -1
    const handle = joinHost<Phase10View, Phase10Action>(code, name.trim(), {
      onState(view) {
        if (view.kind === 'lobby') {
          setPhase10View(view)
          setPhase10Started(false)
          return
        }
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        setPhase10View(view)
        setPhase10Started(true)
      },
      onError() {
        resetToEntry()
        setError('Could not reach that room. Check the code and try again.')
      },
      onRejected(reason) {
        resetToEntry()
        setError(reason)
      },
      onConnected() {
        setPhase10Connection('connected')
      },
      onDisconnected() {
        setPhase10Connection('disconnected')
      },
    })
    phase10GuestRef.current = handle
    setPhase10Role('guest')
    writeNameCookie(name)
    pushGameUrl('phase10')
    setPhase10Code(code)
    handle.peerId.then((id) => { setPhase10LocalPlayerId(id); phase10LocalPlayerIdRef.current = id }).catch(() => {})
  }

  function phase10Dispatch(action: Phase10Action) {
    if (phase10Role === 'host' && phase10LocalPlayerId) {
      const session = phase10SessionRef.current
      if (!session) return
      const result = applyPhase10Action(session, phase10LocalPlayerId, action)
      if (!result.outcome.ok) return
      phase10SessionRef.current = result.game
      phase10Broadcast()
    } else if (phase10Role === 'guest') {
      phase10GuestRef.current?.sendAction(action)
    }
  }

  function phase10Rematch() {
    if (phase10Role !== 'host' || !phase10SessionRef.current) return
    const ps = phase10SessionRef.current.session.publicState
    if (ps.matchWinnerId === null) return
    const prevRevision = phase10SessionRef.current.session.revision
    const playerIds = [...ps.seatOrder]
    const seed = Math.floor(Math.random() * 2147483647)
    const next = createPhase10Game(playerIds, seed, ps.cardBack)
    next.session = { ...next.session, revision: prevRevision + 1 }
    phase10SessionRef.current = next
    phase10Broadcast()
  }

  // ---- End Phase 10 helpers ----

  // ---- Battleship helpers ----

  function battleshipActorKey(bs: BattleshipSession): string {
    const ps = bs.session.publicState
    return ps.variant === 'free' ? ps.stage : `${ps.stage}:${ps.turn.turnNumber}`
  }

  function battleshipStale(key: string) {
    return !battleshipSessionRef.current || battleshipActorKey(battleshipSessionRef.current) !== key
  }

  function battleshipUpdateViews() {
    const session = battleshipSessionRef.current!
    const hostSnap = deriveSnapshot(session.session, battleshipLocalPlayerIdRef.current!)
    setBattleshipView({ revision: hostSnap.revision, publicState: hostSnap.publicState, privateState: hostSnap.privateState!, opponentName: battleshipOpponentNameRef.current })
    const opponentId = battleshipOpponentIdRef.current
    if (opponentId && opponentId !== 'bot') {
      const guestSnap = deriveSnapshot(session.session, opponentId)
      battleshipHostRef.current?.broadcast({ revision: guestSnap.revision, publicState: guestSnap.publicState, privateState: guestSnap.privateState!, opponentName: name })
    }
  }

  function startBattleshipHost() {
    setError(null)
    battleshipHostRef.current = createHost<BattleshipView, BattleshipAction>(() => `BS-${generateCode()}`, {
      onReady(code) {
        const hostId = peerIdForCode(code)
        setBattleshipRole('host')
        writeNameCookie(name)
        pushGameUrl('battleship')
        setBattleshipCode(code)
        setBattleshipLocalPlayerId(hostId)
        battleshipLocalPlayerIdRef.current = hostId
        setBattleshipWaiting(true)
      },
      onJoin(guestId, guestName) {
        if (battleshipSessionRef.current) {
          battleshipHostRef.current?.reject(guestId, 'That Battleship table is already full.')
          return
        }
        const seed = Math.floor(Math.random() * 2147483647)
        battleshipSessionRef.current = createBattleshipGame([battleshipLocalPlayerIdRef.current!, guestId], seed, battleshipVariantRef.current)
        setBattleshipOpponentId(guestId)
        battleshipOpponentIdRef.current = guestId
        setBattleshipOpponentName(guestName)
        battleshipOpponentNameRef.current = guestName
        setBattleshipWaiting(false)
        battleshipUpdateViews()
      },
      onAction(guestId, action) {
        if (!battleshipSessionRef.current || guestId !== battleshipOpponentIdRef.current) return
        const result = applyBattleshipAction(battleshipSessionRef.current!, guestId, action)
        if (!result.outcome.ok) return
        battleshipSessionRef.current = result.bs
        battleshipUpdateViews()
      },
      onLeave(guestId) {
        // Guest left mid-match: match cannot continue with only 1 player.
        if (guestId !== battleshipOpponentIdRef.current) return
        setError('Opponent left the room.')
      },
      onError(message) {
        setError(message)
      },
    })
  }

  function addBattleshipHouseBot() {
    if (battleshipRole !== 'host' || !battleshipLocalPlayerId || !battleshipWaiting) return
    const botId = 'bot'
    const botName = randomBotName([name.trim()])
    const seed = Math.floor(Math.random() * 2147483647)
    const bs = createBattleshipGame([battleshipLocalPlayerId, botId], seed, battleshipVariantRef.current)
    const placed = runBattleshipBotTurn(bs, 'bot', makeBattleshipBotStrategy(bs.rng))
    battleshipSessionRef.current = placed.bs
    setBattleshipOpponentId(botId)
    battleshipOpponentIdRef.current = botId
    setBattleshipOpponentName(botName)
    battleshipOpponentNameRef.current = botName
    setBattleshipWaiting(false)
    battleshipUpdateViews()
  }

  async function runBattleshipBot(botId: string, key: string) {
    while (!battleshipStale(key)) {
      await wait(BASE_MS)
      if (battleshipStale(key)) return
      const session = battleshipSessionRef.current!
      const ps = session.session.publicState
      if (ps.stage !== 'battle') return
      if (ps.variant !== 'free' && currentPlayer(ps.turn) !== botId) return
      const result = runBattleshipBotTurn(session, botId, makeBattleshipBotStrategy(session.rng))
      if (!result.outcome.ok) return
      battleshipSessionRef.current = result.bs
      const snap = deriveSnapshot(result.bs.session, battleshipLocalPlayerId!)
      setBattleshipView({ revision: snap.revision, publicState: snap.publicState, privateState: snap.privateState!, opponentName: battleshipOpponentNameRef.current })
      // A streak/free-for-all extra turn keeps the SAME bot firing every
      // BASE_MS with no natural pause. ship-miss/-hit/-sunk run 2/3.7/5.7s —
      // far longer than BASE_MS — so a hot streak stacks shot sounds on top
      // of each other. Hold the next shot off long enough for this one's
      // sound to finish before firing again.
      const newPs = result.bs.session.publicState
      if (newPs.stage === 'battle' && currentPlayer(newPs.turn) === botId) {
        const extra = SHOT_SOUND_BUFFER_MS[newPs.lastShot?.result ?? 'miss']
        await wait(extra)
        if (battleshipStale(key)) return
      }
    }
  }

  async function runBattleshipBotsIfNeeded() {
    if (battleshipBotBusyRef.current) return
    const session = battleshipSessionRef.current
    if (!session) return
    const ps = session.session.publicState
    if (ps.stage !== 'battle') return
    if (battleshipOpponentId !== 'bot') return
    if (ps.variant !== 'free' && currentPlayer(ps.turn) !== 'bot') return
    battleshipBotBusyRef.current = true
    const key = battleshipActorKey(session)
    try {
      await runBattleshipBot('bot', key)
    } finally {
      battleshipBotBusyRef.current = false
      setTimeout(() => runBattleshipBotsIfNeeded(), 50)
    }
  }

  function startBattleshipGuest(code: string) {
    if (!code) return
    setError(null)
    let localRevision = -1
    const handle = joinHost<BattleshipView, BattleshipAction>(code, name.trim(), {
      onState(view) {
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        setBattleshipView(view)
        setBattleshipOpponentName(view.opponentName)
      },
      onError() {
        resetToEntry()
        setError('Could not reach that room. Check the code and try again.')
      },
      onRejected(reason) {
        resetToEntry()
        setError(reason)
      },
      onConnected() {
        setBattleshipConnection('connected')
      },
      onDisconnected() {
        setBattleshipConnection('disconnected')
      },
    })
    battleshipGuestRef.current = handle
    setBattleshipRole('guest')
    writeNameCookie(name)
    pushGameUrl('battleship')
    setBattleshipCode(code)
    handle.peerId.then((id) => { setBattleshipLocalPlayerId(id); battleshipLocalPlayerIdRef.current = id }).catch(() => {})
  }

  function battleshipDispatch(action: BattleshipAction) {
    if (battleshipRole === 'host' && battleshipLocalPlayerId) {
      const result = applyBattleshipAction(battleshipSessionRef.current!, battleshipLocalPlayerId, action)
      if (!result.outcome.ok) return
      battleshipSessionRef.current = result.bs
      battleshipUpdateViews()
    } else if (battleshipRole === 'guest') {
      battleshipGuestRef.current?.sendAction(action)
    }
  }

  function battleshipRematch() {
    if (battleshipRole !== 'host' || !battleshipSessionRef.current || !battleshipLocalPlayerId) return
    const prevRevision = battleshipSessionRef.current.session.revision
    const prevVariant = battleshipSessionRef.current.session.publicState.variant
    const playerIds = battleshipSessionRef.current.session.publicState.turn.playerOrder as [string, string]
    const seed = Math.floor(Math.random() * 2147483647)
    const next = createBattleshipGame(playerIds, seed, prevVariant)
    next.session = { ...next.session, revision: prevRevision + 1 }
    battleshipSessionRef.current = next
    if (battleshipOpponentId === 'bot') {
      const placed = runBattleshipBotTurn(next, 'bot', makeBattleshipBotStrategy(next.rng))
      battleshipSessionRef.current = placed.bs
    }
    battleshipUpdateViews()
  }

  // ---- End Battleship helpers ----

  // ---- Dominoes helpers ----

  function dominoesActorKey(dm: DominoesSession): string {
    const ps = dm.session.publicState
    return `${ps.stage}:${ps.roundNumber}:${ps.turn.turnNumber}`
  }

  function dominoesStale(key: string) {
    return !dominoesSessionRef.current || dominoesActorKey(dominoesSessionRef.current) !== key
  }

  function dominoesUpdateViews() {
    const session = dominoesSessionRef.current!
    const hostSnap = deriveSnapshot(session.session, dominoesLocalPlayerIdRef.current!)
    setDominoesView({ revision: hostSnap.revision, publicState: hostSnap.publicState, privateState: hostSnap.privateState!, opponentName: dominoesOpponentNameRef.current })
    const opponentId = dominoesOpponentIdRef.current
    if (opponentId && opponentId !== 'bot') {
      const guestSnap = deriveSnapshot(session.session, opponentId)
      dominoesHostRef.current?.broadcast({ revision: guestSnap.revision, publicState: guestSnap.publicState, privateState: guestSnap.privateState!, opponentName: name })
    }
  }

  function startDominoesHost() {
    setError(null)
    dominoesHostRef.current = createHost<DominoesView, DominoesAction>(() => `DM-${generateCode()}`, {
      onReady(code) {
        const hostId = peerIdForCode(code)
        setDominoesRole('host')
        writeNameCookie(name)
        pushGameUrl('dominoes')
        setDominoesCode(code)
        setDominoesLocalPlayerId(hostId)
        dominoesLocalPlayerIdRef.current = hostId
        setDominoesWaiting(true)
      },
      onJoin(guestId, guestName) {
        if (dominoesSessionRef.current) {
          dominoesHostRef.current?.reject(guestId, 'That Dominoes table is already full.')
          return
        }
        const seed = Math.floor(Math.random() * 2147483647)
        dominoesSessionRef.current = createDominoesGame([dominoesLocalPlayerIdRef.current!, guestId], seed)
        setDominoesOpponentId(guestId)
        dominoesOpponentIdRef.current = guestId
        setDominoesOpponentName(guestName)
        dominoesOpponentNameRef.current = guestName
        setDominoesWaiting(false)
        dominoesUpdateViews()
      },
      onAction(guestId, action) {
        if (!dominoesSessionRef.current || guestId !== dominoesOpponentIdRef.current) return
        const result = applyDominoesAction(dominoesSessionRef.current!, guestId, action)
        if (!result.outcome.ok) return
        dominoesSessionRef.current = result.dm
        dominoesUpdateViews()
      },
      onLeave(guestId) {
        // Guest left mid-match: match cannot continue with only 1 player.
        if (guestId !== dominoesOpponentIdRef.current) return
        setError('Opponent left the room.')
      },
      onError(message) {
        setError(message)
      },
    })
  }

  function addDominoesHouseBot() {
    if (dominoesRole !== 'host' || !dominoesLocalPlayerId || !dominoesWaiting) return
    const botId = 'bot'
    const botName = randomBotName([name.trim()])
    const seed = Math.floor(Math.random() * 2147483647)
    dominoesSessionRef.current = createDominoesGame([dominoesLocalPlayerId, botId], seed)
    setDominoesOpponentId(botId)
    dominoesOpponentIdRef.current = botId
    setDominoesOpponentName(botName)
    dominoesOpponentNameRef.current = botName
    setDominoesWaiting(false)
    dominoesUpdateViews()
  }

  async function runDominoesBot(botId: string, key: string) {
    while (!dominoesStale(key)) {
      await wait(BASE_MS)
      if (dominoesStale(key)) return
      const session = dominoesSessionRef.current!
      const ps = session.session.publicState
      if (ps.stage !== 'play' || currentPlayer(ps.turn) !== botId) return
      const result = runDominoesBotTurn(session, botId, dominoesBotStrategy)
      if (!result.outcome.ok) return
      dominoesSessionRef.current = result.dm
      const snap = deriveSnapshot(result.dm.session, dominoesLocalPlayerId!)
      setDominoesView({ revision: snap.revision, publicState: snap.publicState, privateState: snap.privateState!, opponentName: dominoesOpponentNameRef.current })
    }
  }

  async function runDominoesBotsIfNeeded() {
    if (dominoesBotBusyRef.current) return
    const session = dominoesSessionRef.current
    if (!session) return
    const ps = session.session.publicState
    if (ps.stage !== 'play') return
    if (dominoesOpponentId !== 'bot') return
    if (currentPlayer(ps.turn) !== 'bot') return
    dominoesBotBusyRef.current = true
    const key = dominoesActorKey(session)
    try {
      await runDominoesBot('bot', key)
    } finally {
      dominoesBotBusyRef.current = false
      setTimeout(() => runDominoesBotsIfNeeded(), 50)
    }
  }

  function startDominoesGuest(code: string) {
    if (!code) return
    setError(null)
    let localRevision = -1
    const handle = joinHost<DominoesView, DominoesAction>(code, name.trim(), {
      onState(view) {
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        setDominoesView(view)
        setDominoesOpponentName(view.opponentName)
      },
      onError() {
        resetToEntry()
        setError('Could not reach that room. Check the code and try again.')
      },
      onRejected(reason) {
        resetToEntry()
        setError(reason)
      },
      onConnected() {
        setDominoesConnection('connected')
      },
      onDisconnected() {
        setDominoesConnection('disconnected')
      },
    })
    dominoesGuestRef.current = handle
    setDominoesRole('guest')
    writeNameCookie(name)
    pushGameUrl('dominoes')
    setDominoesCode(code)
    handle.peerId.then((id) => { setDominoesLocalPlayerId(id); dominoesLocalPlayerIdRef.current = id }).catch(() => {})
  }

  function dominoesDispatch(action: DominoesAction) {
    if (dominoesRole === 'host' && dominoesLocalPlayerId) {
      const result = applyDominoesAction(dominoesSessionRef.current!, dominoesLocalPlayerId, action)
      if (!result.outcome.ok) return
      dominoesSessionRef.current = result.dm
      dominoesUpdateViews()
    } else if (dominoesRole === 'guest') {
      dominoesGuestRef.current?.sendAction(action)
    }
  }

  function dominoesRematch() {
    if (dominoesRole !== 'host' || !dominoesSessionRef.current || !dominoesLocalPlayerId) return
    const prevRevision = dominoesSessionRef.current.session.revision
    const playerIds = dominoesSessionRef.current.session.publicState.turn.playerOrder as [string, string]
    const seed = Math.floor(Math.random() * 2147483647)
    const next = createDominoesGame(playerIds, seed)
    next.session = { ...next.session, revision: prevRevision + 1 }
    dominoesSessionRef.current = next
    dominoesUpdateViews()
  }

  // ---- End Dominoes helpers ----

  // ---- Wahoo helpers ----

  function wahooActorKey(wh: WahooSession): string {
    const ps = wh.session.publicState
    return `${ps.stage}:${ps.turn.turnNumber}`
  }

  function wahooStale(key: string) {
    return !wahooSessionRef.current || wahooActorKey(wahooSessionRef.current) !== key
  }

  function wahooBroadcast() {
    if (!wahooStartedRef.current) {
      const view: WahooView = {
        kind: 'lobby',
        roster: wahooSeatsRef.current.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === wahooLocalPlayerIdRef.current })),
      }
      setWahooView(view)
      wahooHostRef.current?.broadcast(view)
      return
    }
    const snap = deriveSnapshot(wahooSessionRef.current!.session, wahooLocalPlayerIdRef.current!)
    const view: WahooView = {
      kind: 'game',
      revision: snap.revision,
      publicState: snap.publicState,
      names: { ...wahooNamesRef.current },
    }
    setWahooView(view)
    wahooHostRef.current?.broadcast(view)
  }

  function startWahooHost() {
    setError(null)
    wahooHostRef.current = createHost<WahooView, WahooAction>(() => `WH-${generateCode()}`, {
      onReady(code) {
        const hostId = peerIdForCode(code)
        setWahooRole('host')
        writeNameCookie(name)
        pushGameUrl('wahoo')
        setWahooCode(code)
        setWahooLocalPlayerId(hostId)
        wahooLocalPlayerIdRef.current = hostId
        setWahooStarted(false)
        wahooStartedRef.current = false
        setWahooSeats([{ playerId: hostId, name: name.trim(), isBot: false }])
        wahooSeatsRef.current = [{ playerId: hostId, name: name.trim(), isBot: false }]
        wahooDroppedRef.current = []
        setWahooDropped([])
        setWahooNotice(null)
        wahooBroadcast()
      },
      onJoin(guestId, guestName) {
        if (wahooStartedRef.current) {
          wahooHostRef.current?.reject(guestId, 'Game in progress — spectating comes later.')
          return
        }
        if (wahooSeatsRef.current.length >= 4) {
          wahooHostRef.current?.reject(guestId, 'Table is full.')
          return
        }
        wahooSeatsRef.current = [...wahooSeatsRef.current, { playerId: guestId, name: guestName, isBot: false }]
        setWahooSeats(wahooSeatsRef.current)
        wahooBroadcast()
      },
      onAction(guestId, action) {
        if (!wahooStartedRef.current) return
        const session = wahooSessionRef.current
        if (!session) return
        if (!wahooSeatsRef.current.some((s) => s.playerId === guestId)) return
        const result = applyWahooAction(session, guestId, action)
        if (!result.outcome.ok) return
        wahooSessionRef.current = result.wh
        wahooBroadcast()
      },
      onLeave(guestId) {
        if (!wahooStartedRef.current) {
          wahooSeatsRef.current = wahooSeatsRef.current.filter((s) => s.playerId !== guestId)
          setWahooSeats(wahooSeatsRef.current)
          wahooBroadcast()
          return
        }
        const seat = wahooSeatsRef.current.find((s) => s.playerId === guestId)
        if (!seat) return
        setWahooNotice(`${seat.name} disconnected.`)
        if (!wahooDroppedRef.current.includes(guestId)) {
          wahooDroppedRef.current = [...wahooDroppedRef.current, guestId]
          setWahooDropped(wahooDroppedRef.current)
        }
      },
      onError(message) {
        setError(message)
      },
    })
  }

  function addWahooHouseBot() {
    if (wahooRole !== 'host' || wahooStartedRef.current) return
    if (wahooSeatsRef.current.length >= 4) return
    wahooBotCounterRef.current += 1
    const botId = `bot-${wahooBotCounterRef.current}`
    const botName = randomBotName(wahooSeatsRef.current.map((s) => s.name))
    wahooSeatsRef.current = [...wahooSeatsRef.current, { playerId: botId, name: botName, isBot: true }]
    setWahooSeats(wahooSeatsRef.current)
    wahooBotSeatsRef.current.add(botId)
    wahooBroadcast()
  }

  function wahooStart() {
    if (wahooRole !== 'host' || wahooStartedRef.current) return
    const seats = wahooSeatsRef.current
    if (seats.length < 2 || seats.length > 4) return
    const playerIds = seats.map((s) => s.playerId)
    for (let i = playerIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[playerIds[i], playerIds[j]] = [playerIds[j], playerIds[i]]
    }
    const seed = Math.floor(Math.random() * 2147483647)
    wahooSessionRef.current = createWahooGame(playerIds, seed)
    wahooNamesRef.current = Object.fromEntries(seats.map((s) => [s.playerId, s.name]))
    wahooStartedRef.current = true
    setWahooStarted(true)
    wahooDroppedRef.current = []
    setWahooDropped([])
    wahooBroadcast()
  }

  function wahooReplaceWithBot(playerId: string) {
    if (wahooRole !== 'host' || !wahooStartedRef.current) return
    // Ref-guard (not the state value): a double-click before React re-renders
    // would otherwise read the stale dropped list twice and replace twice.
    if (!wahooDroppedRef.current.includes(playerId)) return
    wahooBotSeatsRef.current.add(playerId)
    wahooNamesRef.current = { ...wahooNamesRef.current, [playerId]: `${wahooNamesRef.current[playerId]} (bot)` }
    wahooDroppedRef.current = wahooDroppedRef.current.filter((id) => id !== playerId)
    setWahooDropped(wahooDroppedRef.current)
    wahooBroadcast()
    runWahooBotsIfNeeded()
  }

  async function runWahooBots(botId: string, key: string) {
    while (!wahooStale(key)) {
      await wait(BASE_MS)
      if (wahooStale(key)) return
      const session = wahooSessionRef.current!
      const ps = session.session.publicState
      if (ps.stage !== 'play') return
      if (currentPlayer(ps.turn) !== botId) return
      if (!wahooBotSeatsRef.current.has(botId)) return
      const result = runWahooBotTurn(session, botId, wahooBotStrategy)
      if (!result.outcome.ok) return
      wahooSessionRef.current = result.wh
      wahooBroadcast()
      const kind = result.wh.session.publicState.lastEvent?.kind
      if (kind === 'pass' || kind === 'bust') await wait(PASS_ANIMATION_BUFFER_MS)
    }
  }

  async function runWahooBotsIfNeeded() {
    if (wahooBotBusyRef.current) return
    const session = wahooSessionRef.current
    if (!session) return
    const ps = session.session.publicState
    if (ps.stage !== 'play') return
    const currentId = currentPlayer(ps.turn)
    if (!wahooBotSeatsRef.current.has(currentId)) return
    wahooBotBusyRef.current = true
    const key = wahooActorKey(session)
    try {
      await runWahooBots(currentId, key)
    } finally {
      wahooBotBusyRef.current = false
      setTimeout(() => runWahooBotsIfNeeded(), 50)
    }
  }

  function startWahooGuest(code: string) {
    if (!code) return
    setError(null)
    let localRevision = -1
    const handle = joinHost<WahooView, WahooAction>(code, name.trim(), {
      onState(view) {
        if (view.kind === 'lobby') {
          setWahooView(view)
          return
        }
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        setWahooView(view)
        setWahooStarted(true)
      },
      onError() {
        resetToEntry()
        setError('Could not reach that room. Check the code and try again.')
      },
      onRejected(reason) {
        resetToEntry()
        setError(reason)
      },
      onConnected() {
        setWahooConnection('connected')
      },
      onDisconnected() {
        setWahooConnection('disconnected')
      },
    })
    wahooGuestRef.current = handle
    setWahooRole('guest')
    writeNameCookie(name)
    pushGameUrl('wahoo')
    setWahooCode(code)
    handle.peerId.then((id) => { setWahooLocalPlayerId(id); wahooLocalPlayerIdRef.current = id }).catch(() => {})
  }

  function wahooDispatch(action: WahooAction) {
    if (wahooRole === 'host' && wahooLocalPlayerId) {
      const session = wahooSessionRef.current
      if (!session) return
      const result = applyWahooAction(session, wahooLocalPlayerId, action)
      if (!result.outcome.ok) return
      wahooSessionRef.current = result.wh
      wahooBroadcast()
    } else if (wahooRole === 'guest') {
      wahooGuestRef.current?.sendAction(action)
    }
  }

  function wahooRematch() {
    if (wahooRole !== 'host' || !wahooSessionRef.current) return
    const ps = wahooSessionRef.current.session.publicState
    if (ps.stage !== 'over') return
    const prevRevision = wahooSessionRef.current.session.revision
    const playerIds = [...ps.turn.playerOrder]
    for (let i = playerIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[playerIds[i], playerIds[j]] = [playerIds[j], playerIds[i]]
    }
    const seed = Math.floor(Math.random() * 2147483647)
    const next = createWahooGame(playerIds, seed)
    next.session = { ...next.session, revision: prevRevision + 1 }
    wahooSessionRef.current = next
    wahooBroadcast()
  }

  // ---- End Wahoo helpers ----

  // ---- Checkers helpers ----

  function checkersActorKey(ck: CheckersSession): string {
    const ps = ck.session.publicState
    return `${ps.stage}:${ps.turn.turnNumber}`
  }

  function checkersStale(key: string) {
    return !checkersSessionRef.current || checkersActorKey(checkersSessionRef.current) !== key
  }

  function checkersBroadcast() {
    if (!checkersStartedRef.current) {
      const view: CheckersView = {
        kind: 'lobby',
        roster: checkersSeatsRef.current.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === checkersLocalPlayerIdRef.current })),
      }
      setCheckersView(view)
      checkersHostRef.current?.broadcast(view)
      return
    }
    const snap = deriveSnapshot(checkersSessionRef.current!.session, checkersLocalPlayerIdRef.current!)
    const view: CheckersView = {
      kind: 'game',
      revision: snap.revision,
      publicState: snap.publicState,
      names: { ...checkersNamesRef.current },
    }
    setCheckersView(view)
    checkersHostRef.current?.broadcast(view)
  }

  function startCheckersHost() {
    setError(null)
    checkersHostRef.current = createHost<CheckersView, CheckersAction>(() => `CK-${generateCode()}`, {
      onReady(code) {
        const hostId = peerIdForCode(code)
        setCheckersRole('host')
        writeNameCookie(name)
        pushGameUrl('checkers')
        setCheckersCode(code)
        setCheckersLocalPlayerId(hostId)
        checkersLocalPlayerIdRef.current = hostId
        setCheckersStarted(false)
        checkersStartedRef.current = false
        setCheckersSeats([{ playerId: hostId, name: name.trim(), isBot: false }])
        checkersSeatsRef.current = [{ playerId: hostId, name: name.trim(), isBot: false }]
        checkersBroadcast()
      },
      onJoin(guestId, guestName) {
        if (checkersStartedRef.current) {
          checkersHostRef.current?.reject(guestId, 'Game in progress — spectating comes later.')
          return
        }
        if (checkersSeatsRef.current.length >= 2) {
          checkersHostRef.current?.reject(guestId, 'Table is full.')
          return
        }
        checkersSeatsRef.current = [...checkersSeatsRef.current, { playerId: guestId, name: guestName, isBot: false }]
        setCheckersSeats(checkersSeatsRef.current)
        checkersBroadcast()
      },
      onAction(guestId, action) {
        if (!checkersStartedRef.current) return
        const session = checkersSessionRef.current
        if (!session) return
        if (!checkersSeatsRef.current.some((s) => s.playerId === guestId)) return
        const result = applyCheckersAction(session, guestId, action)
        if (!result.outcome.ok) return
        checkersSessionRef.current = result.game
        checkersBroadcast()
      },
      onLeave(guestId) {
        if (!checkersStartedRef.current) {
          checkersSeatsRef.current = checkersSeatsRef.current.filter((s) => s.playerId !== guestId)
          setCheckersSeats(checkersSeatsRef.current)
          checkersBroadcast()
          return
        }
        // Guest left mid-match: match cannot continue with only 1 player.
        if (!checkersSeatsRef.current.some((s) => s.playerId === guestId)) return
        setError('Opponent left the room.')
      },
      onError(message) {
        setError(message)
      },
    })
  }

  function addCheckersHouseBot() {
    if (checkersRole !== 'host' || checkersStartedRef.current) return
    if (checkersSeatsRef.current.length >= 2) return
    const botId = 'bot'
    const botName = randomBotName(checkersSeatsRef.current.map((s) => s.name))
    checkersSeatsRef.current = [...checkersSeatsRef.current, { playerId: botId, name: botName, isBot: true }]
    setCheckersSeats(checkersSeatsRef.current)
    checkersBroadcast()
  }

  function checkersStart() {
    if (checkersRole !== 'host' || checkersStartedRef.current) return
    const seats = checkersSeatsRef.current
    if (seats.length !== 2) return
    const seed = Math.floor(Math.random() * 2147483647)
    checkersSessionRef.current = createCheckersGame([seats[0].playerId, seats[1].playerId], seed)
    checkersNamesRef.current = Object.fromEntries(seats.map((s) => [s.playerId, s.name]))
    checkersStartedRef.current = true
    setCheckersStarted(true)
    checkersBroadcast()
  }

  async function runCheckersBot(botId: string, key: string) {
    while (!checkersStale(key)) {
      await wait(BASE_MS)
      if (checkersStale(key)) return
      const session = checkersSessionRef.current!
      const ps = session.session.publicState
      if (ps.stage !== 'play') return
      if (currentPlayer(ps.turn) !== botId) return
      const result = runCheckersBotTurn(session, botId, makeCheckersBotStrategy(session.rng))
      if (!result.outcome.ok) return
      checkersSessionRef.current = result.game
      const snap = deriveSnapshot(result.game.session, checkersLocalPlayerId!)
      setCheckersView({ kind: 'game', revision: snap.revision, publicState: snap.publicState, names: { ...checkersNamesRef.current } })
    }
  }

  async function runCheckersBotsIfNeeded() {
    if (checkersBotBusyRef.current) return
    const session = checkersSessionRef.current
    if (!session) return
    const ps = session.session.publicState
    if (ps.stage !== 'play') return
    if (currentPlayer(ps.turn) !== 'bot') return
    checkersBotBusyRef.current = true
    const key = checkersActorKey(session)
    try {
      await runCheckersBot('bot', key)
    } finally {
      checkersBotBusyRef.current = false
      setTimeout(() => runCheckersBotsIfNeeded(), 50)
    }
  }

  function startCheckersGuest(code: string) {
    if (!code) return
    setError(null)
    let localRevision = -1
    const handle = joinHost<CheckersView, CheckersAction>(code, name.trim(), {
      onState(view) {
        if (view.kind === 'lobby') {
          setCheckersView(view)
          return
        }
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        setCheckersView(view)
        setCheckersStarted(true)
      },
      onError() {
        resetToEntry()
        setError('Could not reach that room. Check the code and try again.')
      },
      onRejected(reason) {
        resetToEntry()
        setError(reason)
      },
      onConnected() {
        setCheckersConnection('connected')
      },
      onDisconnected() {
        setCheckersConnection('disconnected')
      },
    })
    checkersGuestRef.current = handle
    setCheckersRole('guest')
    writeNameCookie(name)
    pushGameUrl('checkers')
    setCheckersCode(code)
    handle.peerId.then((id) => { setCheckersLocalPlayerId(id); checkersLocalPlayerIdRef.current = id }).catch(() => {})
  }

  function checkersDispatch(action: CheckersAction) {
    if (checkersRole === 'host' && checkersLocalPlayerId) {
      const session = checkersSessionRef.current
      if (!session) return
      const result = applyCheckersAction(session, checkersLocalPlayerId, action)
      if (!result.outcome.ok) return
      checkersSessionRef.current = result.game
      checkersBroadcast()
    } else if (checkersRole === 'guest') {
      checkersGuestRef.current?.sendAction(action)
    }
  }

  function checkersRematch() {
    if (checkersRole !== 'host' || !checkersSessionRef.current) return
    const ps = checkersSessionRef.current.session.publicState
    if (ps.stage !== 'over') return
    const prevRevision = checkersSessionRef.current.session.revision
    const playerIds = [...ps.turn.playerOrder] as [string, string]
    const seed = Math.floor(Math.random() * 2147483647)
    const next = createCheckersGame(playerIds, seed)
    next.session = { ...next.session, revision: prevRevision + 1 }
    checkersSessionRef.current = next
    checkersBroadcast()
  }

  // ---- End Checkers helpers ----

  // ---- Mexican Train helpers ----

  // Seat inks, fixed per seat index 0..7 — the same per-seat palette Wahoo
  // assigns by arm index at game start.
  const MT_SEAT_INKS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#9333ea', '#0fb5a0', '#f97316', '#64748b']

  function mtActorKey(mt: MTSession): string {
    const ps = mt.session.publicState
    const handCountsSum = Object.values(ps.handCounts).reduce((sum, n) => sum + n, 0)
    return `${ps.stage}:${ps.turn.turnNumber}:${handCountsSum}:${ps.boneyardCount}:${ps.doublePending}`
  }

  function mtStale(key: string) {
    return !mtSessionRef.current || mtActorKey(mtSessionRef.current) !== key
  }

  // Hands are PRIVATE and up to 7 guests can be seated, so a single broadcast
  // cannot carry every hand (any guest would see the others'). Lobby phase →
  // broadcast the roster view; game phase → per-guest sendTo with only that
  // guest's own hand. The host's own view comes from its local snapshot.
  function mtBroadcast() {
    if (!mtStartedRef.current) {
      const view: MTView = {
        kind: 'lobby',
        roster: mtSeatsRef.current.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === mtLocalPlayerIdRef.current })),
      }
      setMTView(view)
      mtHostRef.current?.broadcast(view)
      return
    }
    const session = mtSessionRef.current!
    const hostSnap = deriveSnapshot(session.session, mtLocalPlayerIdRef.current!)
    setMTView({
      kind: 'game',
      revision: hostSnap.revision,
      publicState: hostSnap.publicState,
      hand: hostSnap.privateState!.hand.cards,
      names: { ...mtNamesRef.current },
    })
    const names = { ...mtNamesRef.current }
    for (const seat of mtSeatsRef.current) {
      if (seat.playerId === mtLocalPlayerIdRef.current) continue
      if (mtBotSeatsRef.current.has(seat.playerId)) continue
      const guestSnap = deriveSnapshot(session.session, seat.playerId)
      mtHostRef.current?.sendTo(seat.playerId, {
        kind: 'game',
        revision: guestSnap.revision,
        publicState: guestSnap.publicState,
        hand: guestSnap.privateState!.hand.cards,
        names,
      })
    }
  }

  function startMTHost() {
    setError(null)
    mtHostRef.current = createHost<MTView, MTAction>(() => `MT-${generateCode()}`, {
      onReady(code) {
        const hostId = peerIdForCode(code)
        setMTRole('host')
        writeNameCookie(name)
        pushGameUrl('mexican-train')
        setMTCode(code)
        setMTLocalPlayerId(hostId)
        mtLocalPlayerIdRef.current = hostId
        setMTStarted(false)
        mtStartedRef.current = false
        setMTSeats([{ playerId: hostId, name: name.trim(), isBot: false }])
        mtSeatsRef.current = [{ playerId: hostId, name: name.trim(), isBot: false }]
        mtDroppedRef.current = []
        setMTDropped([])
        setMTNotice(null)
        mtBroadcast()
      },
      onJoin(guestId, guestName) {
        if (mtStartedRef.current) {
          mtHostRef.current?.reject(guestId, 'Game in progress — spectating comes later.')
          return
        }
        if (mtSeatsRef.current.length >= MT_MAX_SEATS) {
          mtHostRef.current?.reject(guestId, 'Table is full.')
          return
        }
        mtSeatsRef.current = [...mtSeatsRef.current, { playerId: guestId, name: guestName, isBot: false }]
        setMTSeats(mtSeatsRef.current)
        mtBroadcast()
      },
      onAction(guestId, action) {
        if (!mtStartedRef.current) return
        const session = mtSessionRef.current
        if (!session) return
        if (!mtSeatsRef.current.some((s) => s.playerId === guestId)) return
        const result = applyMTAction(session, guestId, action)
        if (!result.outcome.ok) return
        mtSessionRef.current = result.mt
        mtBroadcast()
      },
      onLeave(guestId) {
        if (!mtStartedRef.current) {
          mtSeatsRef.current = mtSeatsRef.current.filter((s) => s.playerId !== guestId)
          setMTSeats(mtSeatsRef.current)
          mtBroadcast()
          return
        }
        const seat = mtSeatsRef.current.find((s) => s.playerId === guestId)
        if (!seat) return
        setMTNotice(`${seat.name} disconnected.`)
        if (!mtDroppedRef.current.includes(guestId)) {
          mtDroppedRef.current = [...mtDroppedRef.current, guestId]
          setMTDropped(mtDroppedRef.current)
        }
      },
      onError(message) {
        setError(message)
      },
    })
  }

  function addMTHouseBot() {
    if (mtRole !== 'host' || mtStartedRef.current) return
    if (mtSeatsRef.current.length >= MT_MAX_SEATS) return
    mtBotCounterRef.current += 1
    const botId = `bot-${mtBotCounterRef.current}`
    const botName = randomBotName(mtSeatsRef.current.map((s) => s.name))
    mtSeatsRef.current = [...mtSeatsRef.current, { playerId: botId, name: botName, isBot: true }]
    setMTSeats(mtSeatsRef.current)
    mtBotSeatsRef.current.add(botId)
    mtBroadcast()
  }

  function mtStart() {
    if (mtRole !== 'host' || mtStartedRef.current) return
    const seats = mtSeatsRef.current
    if (seats.length < MT_MIN_SEATS || seats.length > MT_MAX_SEATS) return
    const playerIds = seats.map((s) => s.playerId)
    // Deliberately outside the seeded rng: host-only, one-time, and seatOrder is sent to guests — it must not shift the seeded deal.
    for (let i = playerIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[playerIds[i], playerIds[j]] = [playerIds[j], playerIds[i]]
    }
    const seed = Math.floor(Math.random() * 2147483647)
    mtSessionRef.current = createMexicanTrainGame(playerIds, seed)
    mtNamesRef.current = Object.fromEntries(seats.map((s) => [s.playerId, s.name]))
    mtStartedRef.current = true
    setMTStarted(true)
    mtDroppedRef.current = []
    setMTDropped([])
    mtBroadcast()
  }

  function mtReplaceWithBot(playerId: string) {
    if (mtRole !== 'host' || !mtStartedRef.current) return
    // Ref-guard (not the state value): a double-click before React re-renders
    // would otherwise read the stale dropped list twice and replace twice.
    if (!mtDroppedRef.current.includes(playerId)) return
    mtBotSeatsRef.current.add(playerId)
    mtNamesRef.current = { ...mtNamesRef.current, [playerId]: `${mtNamesRef.current[playerId]} (bot)` }
    mtDroppedRef.current = mtDroppedRef.current.filter((id) => id !== playerId)
    setMTDropped(mtDroppedRef.current)
    mtBroadcast()
    runMTBotsIfNeeded()
  }

  async function runMTBots(botId: string, key: string) {
    while (!mtStale(key)) {
      await wait(MT_ACTION_MS)
      if (mtStale(key)) return
      const session = mtSessionRef.current!
      const ps = session.session.publicState
      if (ps.stage !== 'play') return
      if (currentPlayer(ps.turn) !== botId) return
      if (!mtBotSeatsRef.current.has(botId)) return
      const result = runMTBotTurn(session, botId, mexicanTrainBotStrategy)
      if (!result.outcome.ok) return
      mtSessionRef.current = result.mt
      mtBroadcast()
      // Opening a train (pass-open or a dead draw) plays the 3.6s train-horn:
      // leave clear air (on top of the normal per-action beat) before the next
      // bot acts, so consecutive stuck bots don't pile their horns into one rush.
      if (result.mt.session.publicState.lastAction?.opened !== null) {
        await wait(MT_HORN_BUFFER_MS)
        if (mtStale(key)) return
      }
    }
  }

  async function runMTBotsIfNeeded() {
    if (mtBotBusyRef.current) return
    const session = mtSessionRef.current
    if (!session) return
    const ps = session.session.publicState
    if (ps.stage !== 'play') return
    const currentId = currentPlayer(ps.turn)
    if (!mtBotSeatsRef.current.has(currentId)) return
    mtBotBusyRef.current = true
    const key = mtActorKey(session)
    try {
      await runMTBots(currentId, key)
    } finally {
      mtBotBusyRef.current = false
      setTimeout(() => runMTBotsIfNeeded(), 50)
    }
  }

  function startMTGuest(code: string) {
    if (!code) return
    setError(null)
    let localRevision = -1
    const handle = joinHost<MTView, MTAction>(code, name.trim(), {
      onState(view) {
        if (view.kind === 'lobby') {
          setMTView(view)
          return
        }
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        setMTView(view)
        setMTStarted(true)
      },
      onError() {
        resetToEntry()
        setError('Could not reach that room. Check the code and try again.')
      },
      onRejected(reason) {
        resetToEntry()
        setError(reason)
      },
      onConnected() {
        setMTConnection('connected')
      },
      onDisconnected() {
        setMTConnection('disconnected')
      },
    })
    mtGuestRef.current = handle
    setMTRole('guest')
    writeNameCookie(name)
    pushGameUrl('mexican-train')
    setMTCode(code)
    handle.peerId.then((id) => { setMTLocalPlayerId(id); mtLocalPlayerIdRef.current = id }).catch(() => {})
  }

  function mtDispatch(action: MTAction) {
    if (mtRole === 'host' && mtLocalPlayerId) {
      const session = mtSessionRef.current
      if (!session) return
      const result = applyMTAction(session, mtLocalPlayerId, action)
      if (!result.outcome.ok) return
      mtSessionRef.current = result.mt
      mtBroadcast()
    } else if (mtRole === 'guest') {
      mtGuestRef.current?.sendAction(action)
    }
  }

  function mtRematch() {
    if (mtRole !== 'host' || !mtSessionRef.current) return
    const ps = mtSessionRef.current.session.publicState
    if (ps.stage !== 'over') return
    const prevRevision = mtSessionRef.current.session.revision
    const playerIds = [...ps.seatOrder]
    const seed = Math.floor(Math.random() * 2147483647)
    const next = createMexicanTrainGame(playerIds, seed)
    next.session = { ...next.session, revision: prevRevision + 1 }
    mtSessionRef.current = next
    mtBroadcast()
  }

  // ---- End Mexican Train helpers ----

  // ---- Chess helpers ----

  function chessActorKey(ch: ChessSession): string {
    const ps = ch.session.publicState
    return `${ps.stage}:${ps.turn.turnNumber}`
  }

  function chessStale(key: string) {
    return !chessSessionRef.current || chessActorKey(chessSessionRef.current) !== key
  }

  function chessUpdateViews() {
    const session = chessSessionRef.current!
    const hostSnap = deriveSnapshot(session.session, chessLocalPlayerIdRef.current!)
    setChessView({ revision: hostSnap.revision, publicState: hostSnap.publicState, opponentName: chessOpponentNameRef.current })
    const opponentId = chessOpponentIdRef.current
    if (opponentId && opponentId !== 'bot') {
      const guestSnap = deriveSnapshot(session.session, opponentId)
      chessHostRef.current?.broadcast({ revision: guestSnap.revision, publicState: guestSnap.publicState, opponentName: name })
    }
  }

  function startChessHost() {
    setError(null)
    chessHostRef.current = createHost<ChessView, ChessAction>(() => `CH-${generateCode()}`, {
      onReady(code) {
        const hostId = peerIdForCode(code)
        setChessRole('host')
        writeNameCookie(name)
        pushGameUrl('chess')
        setChessCode(code)
        setChessLocalPlayerId(hostId)
        chessLocalPlayerIdRef.current = hostId
        setChessWaiting(true)
      },
      onJoin(guestId, guestName) {
        if (chessSessionRef.current) {
          chessHostRef.current?.reject(guestId, 'That Chess table is already full.')
          return
        }
        const seed = Math.floor(Math.random() * 2147483647)
        chessSessionRef.current = createChessGame([chessLocalPlayerIdRef.current!, guestId], chessDifficultyRef.current, seed)
        setChessOpponentId(guestId)
        chessOpponentIdRef.current = guestId
        setChessOpponentName(guestName)
        chessOpponentNameRef.current = guestName
        setChessWaiting(false)
        chessUpdateViews()
      },
      onAction(guestId, action) {
        if (!chessSessionRef.current || guestId !== chessOpponentIdRef.current) return
        const result = applyChessAction(chessSessionRef.current!, guestId, action)
        if (!result.outcome.ok) return
        chessSessionRef.current = result.game
        chessUpdateViews()
      },
      onLeave(guestId) {
        // Guest left mid-match: match cannot continue with only 1 player.
        if (guestId !== chessOpponentIdRef.current) return
        setError('Opponent left the room.')
      },
      onError(message) {
        setError(message)
      },
    })
  }

  function addChessHouseBot() {
    if (chessRole !== 'host' || !chessLocalPlayerId || !chessWaiting) return
    const botId = 'bot'
    const botName = randomBotName([name.trim()])
    const seed = Math.floor(Math.random() * 2147483647)
    // No placement phase (unlike Battleship): if the bot were to move first
    // it's black (seat 1) and never does — the bot-loop effect picks it up
    // next tick anyway, so no immediate first move is hand-fired here.
    chessSessionRef.current = createChessGame([chessLocalPlayerId, botId], chessDifficultyRef.current, seed)
    setChessOpponentId(botId)
    chessOpponentIdRef.current = botId
    setChessOpponentName(botName)
    chessOpponentNameRef.current = botName
    setChessWaiting(false)
    chessUpdateViews()
  }

  async function runChessBot(botId: string, key: string) {
    while (!chessStale(key)) {
      await wait(BASE_MS)
      if (chessStale(key)) return
      const session = chessSessionRef.current!
      const ps = session.session.publicState
      if (ps.stage !== 'play') return
      if (currentPlayer(ps.turn) !== botId) return
      // 'hard' is not selectable (spec 28) — a stale session could still carry
      // it, so fall through to normal rather than crash on an unknown branch.
      const strategy = ps.difficulty === 'easy'
        ? makeEasyChessBotStrategy(session.rng)
        : makeNormalChessBotStrategy()
      const result = runChessBotTurn(session, botId, strategy)
      if (!result.outcome.ok) return
      chessSessionRef.current = result.game
      const snap = deriveSnapshot(result.game.session, chessLocalPlayerId!)
      setChessView({ revision: snap.revision, publicState: snap.publicState, opponentName: chessOpponentNameRef.current })
    }
  }

  async function runChessBotsIfNeeded() {
    if (chessBotBusyRef.current) return
    const session = chessSessionRef.current
    if (!session) return
    const ps = session.session.publicState
    if (ps.stage !== 'play') return
    if (chessOpponentId !== 'bot') return
    if (currentPlayer(ps.turn) !== 'bot') return
    chessBotBusyRef.current = true
    const key = chessActorKey(session)
    try {
      await runChessBot('bot', key)
    } finally {
      chessBotBusyRef.current = false
      setTimeout(() => runChessBotsIfNeeded(), 50)
    }
  }

  function startChessGuest(code: string) {
    if (!code) return
    setError(null)
    let localRevision = -1
    const handle = joinHost<ChessView, ChessAction>(code, name.trim(), {
      onState(view) {
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        setChessView(view)
        setChessOpponentName(view.opponentName)
      },
      onError() {
        resetToEntry()
        setError('Could not reach that room. Check the code and try again.')
      },
      onRejected(reason) {
        resetToEntry()
        setError(reason)
      },
      onConnected() {
        setChessConnection('connected')
      },
      onDisconnected() {
        setChessConnection('disconnected')
      },
    })
    chessGuestRef.current = handle
    setChessRole('guest')
    writeNameCookie(name)
    pushGameUrl('chess')
    setChessCode(code)
    handle.peerId.then((id) => { setChessLocalPlayerId(id); chessLocalPlayerIdRef.current = id }).catch(() => {})
  }

  function chessDispatch(action: ChessAction) {
    if (chessRole === 'host' && chessLocalPlayerId) {
      const result = applyChessAction(chessSessionRef.current!, chessLocalPlayerId, action)
      if (!result.outcome.ok) return
      chessSessionRef.current = result.game
      chessUpdateViews()
    } else if (chessRole === 'guest') {
      chessGuestRef.current?.sendAction(action)
    }
  }

  function chessRematch() {
    if (chessRole !== 'host' || !chessSessionRef.current || !chessLocalPlayerId) return
    const ps = chessSessionRef.current.session.publicState
    if (ps.stage !== 'over') return
    const prevRevision = chessSessionRef.current.session.revision
    const playerIds = [...ps.seatOrder] as [string, string]
    const seed = Math.floor(Math.random() * 2147483647)
    const next = createChessGame(playerIds, ps.difficulty, seed)
    next.session = { ...next.session, revision: prevRevision + 1 }
    chessSessionRef.current = next
    chessUpdateViews()
  }

  // ---- End Chess helpers ----

  // ---- Uno helpers ----

  // Seat inks, fixed per seat index 0..5 — the first six of MT's 8-color
  // palette, one per seat under Uno's 6-seat cap.
  const UNO_SEAT_INKS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#9333ea', '#0fb5a0']

  // The actor key must re-key on any field that can change within the SAME
  // player's turn (a draw-then-play is two actions, same turnNumber), so the
  // loop re-evaluates after a draw that doesn't advance the turn.
  function unoActorKey(uno: UnoSession): string {
    const ps = uno.session.publicState
    return `${ps.stage}:${ps.turn.turnNumber}:${ps.hasDrawnThisTurn}:${ps.pendingWild !== null}:${ps.pendingSevenSwap !== null}:${ps.stockCount}:${ps.discardPile.cards.length}`
  }

  function unoStale(key: string) {
    return !unoSessionRef.current || unoActorKey(unoSessionRef.current) !== key
  }

  // Hands are PRIVATE and up to 9 guests can be seated, so a single broadcast
  // cannot carry every hand (any guest would see the others'). Lobby phase →
  // broadcast the roster view (now also carrying the host's house rules and
  // bot difficulty so guests render them read-only); game phase → per-guest
  // sendTo with only that guest's own hand. The host's own view comes from
  // its local snapshot.
  function unoBroadcast() {
    if (!unoStartedRef.current) {
      const view: UnoView = {
        kind: 'lobby',
        roster: unoSeatsRef.current.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === unoLocalPlayerIdRef.current })),
        houseRules: { ...unoHouseRulesRef.current },
        difficulty: unoDifficultyRef.current,
        cardBack: rummyCardBackRef.current,
      }
      setUnoView(view)
      unoHostRef.current?.broadcast(view)
      return
    }
    const session = unoSessionRef.current!
    const currentRound = session.session.publicState.round
    if (currentRound !== unoLastRoundRef.current) {
      unoLastRoundRef.current = currentRound
      const totalCards = session.session.publicState.seatOrder.length * UNO_HAND_SIZE
      unoBotsHeldUntilRef.current = Date.now() + estimateDealIntroMs(totalCards) + UNO_DEAL_HOLD_BUFFER_MS
    }
    const hostSnap = deriveSnapshot(session.session, unoLocalPlayerIdRef.current!)
    setUnoView({
      kind: 'game',
      revision: hostSnap.revision,
      publicState: hostSnap.publicState,
      hand: hostSnap.privateState!.hand.cards,
      names: { ...unoNamesRef.current },
    })
    const names = { ...unoNamesRef.current }
    for (const seat of unoSeatsRef.current) {
      if (seat.playerId === unoLocalPlayerIdRef.current) continue
      if (unoBotSeatsRef.current.has(seat.playerId)) continue
      const guestSnap = deriveSnapshot(session.session, seat.playerId)
      unoHostRef.current?.sendTo(seat.playerId, {
        kind: 'game',
        revision: guestSnap.revision,
        publicState: guestSnap.publicState,
        hand: guestSnap.privateState!.hand.cards,
        names,
      })
    }
    // Every accepted action of ANY kind (play, draw, pass, color choice,
    // CALL_UNO, or a round transition) flows through here, so the host's bot
    // reflex system observes every unoWindow value the session ever produces.
    checkUnoBotReflexes()
  }

  function startUnoHost() {
    setError(null)
    unoHostRef.current = createHost<UnoView, UnoAction>(() => `UN-${generateCode()}`, {
      onReady(code) {
        const hostId = peerIdForCode(code)
        setUnoRole('host')
        writeNameCookie(name)
        pushGameUrl('uno')
        setUnoCode(code)
        setUnoLocalPlayerId(hostId)
        unoLocalPlayerIdRef.current = hostId
        setUnoStarted(false)
        unoStartedRef.current = false
        setUnoSeats([{ playerId: hostId, name: name.trim(), isBot: false }])
        unoSeatsRef.current = [{ playerId: hostId, name: name.trim(), isBot: false }]
        unoDroppedRef.current = []
        setUnoDropped([])
        setUnoNotice(null)
        setUnoHouseRules(resolveHouseRules())
        unoHouseRulesRef.current = resolveHouseRules()
        unoDifficultyRef.current = 'medium'
        setUnoDifficulty('medium')
        unoWindowKeyRef.current = null
        unoReflexGenRef.current = 0
        unoBroadcast()
      },
      onJoin(guestId, guestName) {
        if (unoStartedRef.current) {
          unoHostRef.current?.reject(guestId, 'Game in progress — spectating comes later.')
          return
        }
        if (unoSeatsRef.current.length >= UNO_MAX_SEATS) {
          unoHostRef.current?.reject(guestId, 'Table is full.')
          return
        }
        unoSeatsRef.current = [...unoSeatsRef.current, { playerId: guestId, name: guestName, isBot: false }]
        setUnoSeats(unoSeatsRef.current)
        unoBroadcast()
      },
      onAction(guestId, action) {
        if (!unoStartedRef.current) return
        const session = unoSessionRef.current
        if (!session) return
        if (!unoSeatsRef.current.some((s) => s.playerId === guestId)) return
        const result = applyUnoAction(session, guestId, action)
        if (!result.outcome.ok) return
        unoSessionRef.current = result.uno
        unoBroadcast()
      },
      onLeave(guestId) {
        if (!unoStartedRef.current) {
          unoSeatsRef.current = unoSeatsRef.current.filter((s) => s.playerId !== guestId)
          setUnoSeats(unoSeatsRef.current)
          unoBroadcast()
          return
        }
        const seat = unoSeatsRef.current.find((s) => s.playerId === guestId)
        if (!seat) return
        setUnoNotice(`${seat.name} disconnected.`)
        if (!unoDroppedRef.current.includes(guestId)) {
          unoDroppedRef.current = [...unoDroppedRef.current, guestId]
          setUnoDropped(unoDroppedRef.current)
        }
      },
      onError(message) {
        setError(message)
      },
    })
  }

  function addUnoHouseBot() {
    if (unoRole !== 'host' || unoStartedRef.current) return
    if (unoSeatsRef.current.length >= UNO_MAX_SEATS) return
    unoBotCounterRef.current += 1
    const botId = `bot-${unoBotCounterRef.current}`
    const botName = randomBotName(unoSeatsRef.current.map((s) => s.name))
    unoSeatsRef.current = [...unoSeatsRef.current, { playerId: botId, name: botName, isBot: true }]
    setUnoSeats(unoSeatsRef.current)
    unoBotSeatsRef.current.add(botId)
    unoBroadcast()
  }

  function unoToggleHouseRule(key: UnoHouseRuleKey) {
    if (unoRole !== 'host' || unoStartedRef.current) return
    // Ref-first (not the state value): unoBroadcast() runs synchronously below
    // and must send the just-toggled rules, which the state updater can't
    // guarantee yet.
    const next = { ...unoHouseRulesRef.current, [key]: !unoHouseRulesRef.current[key] }
    unoHouseRulesRef.current = next
    setUnoHouseRules(next)
    unoBroadcast()
  }

  function unoSetDifficulty(d: BotDifficulty) {
    if (unoRole !== 'host' || unoStartedRef.current) return
    unoDifficultyRef.current = d
    setUnoDifficulty(d)
    unoBroadcast()
  }

  function unoStart() {
    if (unoRole !== 'host' || unoStartedRef.current) return
    const seats = unoSeatsRef.current
    // Variable seat count: at least UNO_MIN_SEATS, at most UNO_MAX_SEATS —
    // whatever is seated when the host presses Start, NOT a fixed-count gate.
    if (seats.length < UNO_MIN_SEATS || seats.length > UNO_MAX_SEATS) return
    const playerIds = seats.map((s) => s.playerId)
    // Deliberately outside the seeded rng: host-only, one-time, and seatOrder
    // is sent to guests — it must not shift the seeded deal.
    for (let i = playerIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[playerIds[i], playerIds[j]] = [playerIds[j], playerIds[i]]
    }
    const seed = Math.floor(Math.random() * 2147483647)
    unoSessionRef.current = createUnoGame(playerIds, seed, unoHouseRulesRef.current, rummyCardBackRef.current)
    unoNamesRef.current = Object.fromEntries(seats.map((s) => [s.playerId, s.name]))
    unoStartedRef.current = true
    setUnoStarted(true)
    unoDroppedRef.current = []
    setUnoDropped([])
    unoWindowKeyRef.current = null
    unoReflexGenRef.current = 0
    unoBroadcast()
  }

  function unoReplaceWithBot(playerId: string) {
    if (unoRole !== 'host' || !unoStartedRef.current) return
    // Ref-guard (not the state value): a double-click before React re-renders
    // would otherwise read the stale dropped list twice and replace twice.
    if (!unoDroppedRef.current.includes(playerId)) return
    unoBotSeatsRef.current.add(playerId)
    unoNamesRef.current = { ...unoNamesRef.current, [playerId]: `${unoNamesRef.current[playerId]} (bot)` }
    unoDroppedRef.current = unoDroppedRef.current.filter((id) => id !== playerId)
    setUnoDropped(unoDroppedRef.current)
    // If this seat was vulnerable (unoWindow open on them) while still human,
    // checkUnoBotReflexes() never scheduled a reflex for them — humans aren't
    // bots, so the window-open pass skipped them. Now that they're a bot,
    // force the next unoBroadcast() to treat the window as "new" so a self-
    // call reflex actually gets scheduled instead of the window just sitting
    // open until the next player's turn clears it uncalled.
    if (unoSessionRef.current?.session.publicState.unoWindow?.playerId === playerId) {
      unoWindowKeyRef.current = null
    }
    unoBroadcast()
    runUnoBotsIfNeeded()
  }

  async function runUnoBots(botId: string, key: string) {
    while (!unoStale(key)) {
      const holdRemaining = unoBotsHeldUntilRef.current - Date.now()
      await wait(holdRemaining > 0 ? holdRemaining : UNO_ACTION_MS)
      if (unoStale(key)) return
      if (Date.now() < unoBotsHeldUntilRef.current) continue
      const session = unoSessionRef.current!
      const ps = session.session.publicState
      if (ps.stage !== 'play') return
      if (currentPlayer(ps.turn) !== botId) return
      if (!unoBotSeatsRef.current.has(botId)) return
      const result = runUnoBotTurn(session, botId, unoBotStrategy)
      if (!result.outcome.ok) return
      unoSessionRef.current = result.uno
      unoBroadcast()
    }
  }

  async function runUnoBotsIfNeeded() {
    if (unoBotBusyRef.current) return
    const session = unoSessionRef.current
    if (!session) return
    const ps = session.session.publicState
    if (ps.stage !== 'play') return
    const currentId = currentPlayer(ps.turn)
    if (!unoBotSeatsRef.current.has(currentId)) return
    unoBotBusyRef.current = true
    const key = unoActorKey(session)
    try {
      await runUnoBots(currentId, key)
    } finally {
      unoBotBusyRef.current = false
      setTimeout(() => runUnoBotsIfNeeded(), 50)
    }
  }

  function startUnoGuest(code: string) {
    if (!code) return
    setError(null)
    let localRevision = -1
    const handle = joinHost<UnoView, UnoAction>(code, name.trim(), {
      onState(view) {
        if (view.kind === 'lobby') {
          setUnoView(view)
          setUnoHouseRules(view.houseRules)
          setUnoDifficulty(view.difficulty)
          return
        }
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        setUnoView(view)
        setUnoStarted(true)
      },
      onError() {
        resetToEntry()
        setError('Could not reach that room. Check the code and try again.')
      },
      onRejected(reason) {
        resetToEntry()
        setError(reason)
      },
      onConnected() {
        setUnoConnection('connected')
      },
      onDisconnected() {
        setUnoConnection('disconnected')
      },
    })
    unoGuestRef.current = handle
    setUnoRole('guest')
    writeNameCookie(name)
    pushGameUrl('uno')
    setUnoCode(code)
    handle.peerId.then((id) => { setUnoLocalPlayerId(id); unoLocalPlayerIdRef.current = id }).catch(() => {})
  }

  function unoDispatch(action: UnoAction) {
    if (unoRole === 'host' && unoLocalPlayerId) {
      const session = unoSessionRef.current
      if (!session) return
      const result = applyUnoAction(session, unoLocalPlayerId, action)
      if (!result.outcome.ok) return
      unoSessionRef.current = result.uno
      unoBroadcast()
    } else if (unoRole === 'guest') {
      unoGuestRef.current?.sendAction(action)
    }
  }

  function unoRematch() {
    if (unoRole !== 'host' || !unoSessionRef.current) return
    const ps = unoSessionRef.current.session.publicState
    if (ps.stage !== 'over') return
    const prevRevision = unoSessionRef.current.session.revision
    const playerIds = [...ps.seatOrder]
    const seed = Math.floor(Math.random() * 2147483647)
    const next = createUnoGame(playerIds, seed, ps.houseRules, ps.cardBack)
    next.session = { ...next.session, revision: prevRevision + 1 }
    unoSessionRef.current = next
    unoWindowKeyRef.current = null
    unoReflexGenRef.current = 0
    unoBroadcast()
  }

  // ---- Bot Uno-call reflex system (§6) ----
  //
  // CALL_UNO is not part of unoBotStrategy and is not gated by turn
  // ownership, so bots need a SEPARATE reflex path that runs independently of
  // the per-turn bot loop above. It is triggered by unoWindow changing, not by
  // whose turn it is. Every setTimeout callback re-checks the generation
  // counter before acting, so a reflex scheduled against an old window can
  // never fire a stale CALL_UNO after that window has closed.

  function rollUnoBotReflex(difficulty: BotDifficulty, isSelf: boolean): { delayMs: number; skip: boolean } {
    // Self-calls: the load-bearing dynamic is the delay sometimes exceeding a
    // fast catcher's 1s window, so easy straddles/exceeds 1000ms (often loses
    // races) and hard is mostly under 1000ms (usually wins them).
    //
    // Catches: UnoTable's useCatchStagger gives the vulnerable player — human
    // OR bot — an exclusive first 1000ms to self-call before ANY catch button
    // enables in the UI. A bot catcher must honor that same floor, not just
    // roll from the self-call distribution — otherwise a medium/hard bot can
    // (and reliably will, since their un-floored ranges dip well under 1000ms)
    // catch a human before the human's own UI even lets them click their own
    // button, which reads as broken/unfair rather than "a fast bot."
    const tier = isSelf
      ? (difficulty === 'easy' ? { min: 900, max: 1500, skip: 0.2 } :
         difficulty === 'hard' ? { min: 400, max: 800, skip: 0.03 } :
         { min: 600, max: 1100, skip: 0.1 })
      : (difficulty === 'easy' ? { min: 1000, max: 1500, skip: 0.2 } :
         difficulty === 'hard' ? { min: 1000, max: 1100, skip: 0.03 } :
         { min: 1000, max: 1300, skip: 0.1 })
    const delayMs = tier.min + Math.random() * (tier.max - tier.min)
    const skip = Math.random() < tier.skip
    return { delayMs, skip }
  }

  function attemptUnoBotCall(callerId: string, targetPlayerId: string) {
    const session = unoSessionRef.current
    if (!session) return
    if (session.session.publicState.unoWindow?.playerId !== targetPlayerId) return
    const result = applyUnoAction(session, callerId, { type: 'CALL_UNO', targetPlayerId })
    if (!result.outcome.ok) return
    unoSessionRef.current = result.uno
    // Re-broadcasting re-invokes checkUnoBotReflexes(), which will see the
    // window is now null and bump the generation counter, invalidating any
    // other still-pending timers from this same window.
    unoBroadcast()
  }

  function checkUnoBotReflexes() {
    const session = unoSessionRef.current
    if (!session) return
    const window = session.session.publicState.unoWindow
    const newKey = window?.playerId ?? null
    if (newKey === unoWindowKeyRef.current) return
    unoWindowKeyRef.current = newKey
    // Bump the generation counter on every window change (open, close, or
    // re-open for someone else). A window closing and the SAME player's window
    // reopening later necessarily passes through null in between (spec 34b:
    // destroyed windows are never reopened stale), so a plain
    // current !== new comparison is sufficient — no extra generation counter
    // is needed for THAT part. This counter is for invalidating pending
    // setTimeouts, not for detecting the window change itself.
    const myGen = ++unoReflexGenRef.current
    if (newKey === null) return
    for (const seat of unoSeatsRef.current) {
      if (!unoBotSeatsRef.current.has(seat.playerId)) continue
      const isSelf = seat.playerId === newKey
      const { delayMs, skip } = rollUnoBotReflex(unoDifficultyRef.current, isSelf)
      if (skip) continue
      const targetPlayerId = newKey
      setTimeout(() => {
        if (unoReflexGenRef.current !== myGen) return
        attemptUnoBotCall(seat.playerId, targetPlayerId)
      }, delayMs)
    }
  }

  // ---- End Uno helpers ----

  // ---- Skip-Bo helpers ----

  // Seat inks: same 4-entry palette as Rummy (Skip-Bo also caps at 4 seats).
  const SKIPBO_SEAT_INKS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308']
  const SCRABBLE_SEAT_INKS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308']

  // The actor key must re-key on any field that can change within the SAME
  // player's turn — Skip-Bo turns are chains of individual plays, so
  // buildPiles/handCounts/stockCounts (and the draw/used counters) must all
  // be part of the key. Otherwise the loop would treat two successive plays
  // as the same actor state and never re-evaluate between them.
  function skipBoActorKey(session: SkipBoSession): string {
    const ps = session.session.publicState
    const piles = ps.buildPiles.map((p) => `${p.cards.length}:${p.nextNeeded}`).join(',')
    return `${ps.turn.turnNumber}:${ps.roundOver}:${ps.winnerId ?? ''}:${piles}:${ps.drawCount}:${ps.usedCount}:${Object.values(ps.handCounts).join(',')}:${Object.values(ps.stockCounts).join(',')}`
  }

  function skipBoStale(key: string) {
    return !skipBoSessionRef.current || skipBoActorKey(skipBoSessionRef.current) !== key
  }

  // Hands AND stockpiles are PRIVATE, and up to 3 guests can be seated, so a
  // single broadcast cannot carry every hand/stock (any guest would see the
  // others'). Lobby phase → broadcast the roster view; game phase → per-guest
  // sendTo with only that guest's own hand and stock top. The host's own view
  // comes from its local snapshot.
  function skipBoBroadcast() {
    if (!skipBoStartedRef.current) {
      const view: SkipBoView = {
        kind: 'lobby',
        roster: skipBoSeatsRef.current.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === skipBoLocalPlayerIdRef.current })),
        cardBack: rummyCardBackRef.current,
      }
      setSkipBoView(view)
      skipBoHostRef.current?.broadcast(view)
      return
    }
    const session = skipBoSessionRef.current!
    const hostSnap = deriveSnapshot(session.session, skipBoLocalPlayerIdRef.current!)
    setSkipBoView({
      kind: 'game',
      revision: hostSnap.revision,
      publicState: hostSnap.publicState,
      hand: hostSnap.privateState!.hand.cards,
      names: { ...skipBoNamesRef.current },
    })
    const names = { ...skipBoNamesRef.current }
    for (const seat of skipBoSeatsRef.current) {
      if (seat.playerId === skipBoLocalPlayerIdRef.current) continue
      if (skipBoBotSeatsRef.current.has(seat.playerId)) continue
      const guestSnap = deriveSnapshot(session.session, seat.playerId)
      skipBoHostRef.current?.sendTo(seat.playerId, {
        kind: 'game',
        revision: guestSnap.revision,
        publicState: guestSnap.publicState,
        hand: guestSnap.privateState!.hand.cards,
        names,
      })
    }
  }

  function startSkipBoHost() {
    setError(null)
    skipBoHostRef.current = createHost<SkipBoView, SkipBoAction>(() => `SB-${generateCode()}`, {
      onReady(code) {
        const hostId = peerIdForCode(code)
        setSkipBoRole('host')
        writeNameCookie(name)
        pushGameUrl('skipbo')
        setSkipBoCode(code)
        setSkipBoLocalPlayerId(hostId)
        skipBoLocalPlayerIdRef.current = hostId
        setSkipBoStarted(false)
        skipBoStartedRef.current = false
        setSkipBoSeats([{ playerId: hostId, name: name.trim(), isBot: false }])
        skipBoSeatsRef.current = [{ playerId: hostId, name: name.trim(), isBot: false }]
        setSkipBoNotice(null)
        skipBoBroadcast()
      },
      onJoin(guestId, guestName) {
        if (skipBoStartedRef.current) {
          skipBoHostRef.current?.reject(guestId, 'Game in progress — spectating comes later.')
          return
        }
        if (skipBoSeatsRef.current.length >= SKIPBO_MAX_SEATS) {
          skipBoHostRef.current?.reject(guestId, 'Table is full.')
          return
        }
        skipBoSeatsRef.current = [...skipBoSeatsRef.current, { playerId: guestId, name: guestName, isBot: false }]
        setSkipBoSeats(skipBoSeatsRef.current)
        skipBoBroadcast()
      },
      onAction(guestId, action) {
        if (!skipBoStartedRef.current) return
        const session = skipBoSessionRef.current
        if (!session) return
        if (!skipBoSeatsRef.current.some((s) => s.playerId === guestId)) return
        const result = applySkipBoAction(session, guestId, action)
        if (!result.outcome.ok) return
        skipBoSessionRef.current = result.game
        skipBoBroadcast()
      },
      onLeave(guestId) {
        if (!skipBoStartedRef.current) {
          skipBoSeatsRef.current = skipBoSeatsRef.current.filter((s) => s.playerId !== guestId)
          setSkipBoSeats(skipBoSeatsRef.current)
          skipBoBroadcast()
          return
        }
        const seat = skipBoSeatsRef.current.find((s) => s.playerId === guestId)
        if (!seat) return
        setSkipBoNotice(`${seat.name} disconnected.`)
      },
      onError(message) {
        setError(message)
      },
    })
  }

  function addSkipBoHouseBot() {
    if (skipBoRole !== 'host' || skipBoStartedRef.current) return
    if (skipBoSeatsRef.current.length >= SKIPBO_MAX_SEATS) return
    skipBoBotCounterRef.current += 1
    const botId = `bot-${skipBoBotCounterRef.current}`
    const botName = randomBotName(skipBoSeatsRef.current.map((s) => s.name))
    skipBoSeatsRef.current = [...skipBoSeatsRef.current, { playerId: botId, name: botName, isBot: true }]
    setSkipBoSeats(skipBoSeatsRef.current)
    skipBoBotSeatsRef.current.add(botId)
    skipBoBroadcast()
  }

  function skipBoStart() {
    if (skipBoRole !== 'host' || skipBoStartedRef.current) return
    const seats = skipBoSeatsRef.current
    if (seats.length < SKIPBO_MIN_SEATS || seats.length > SKIPBO_MAX_SEATS) return
    const playerIds = seats.map((s) => s.playerId)
    const seed = Math.floor(Math.random() * 2147483647)
    skipBoSessionRef.current = createSkipBoGame(playerIds, seed, rummyCardBackRef.current)
    skipBoNamesRef.current = Object.fromEntries(seats.map((s) => [s.playerId, s.name]))
    // Hold bots until every client's DealIntro (5 starting-hand cards per seat,
    // stockpiles are not animated) has played out, plus latency slack.
    skipBoBotsHeldUntilRef.current = Date.now() + estimateDealIntroMs(playerIds.length * 5) + SKIPBO_DEAL_HOLD_BUFFER_MS
    skipBoStartedRef.current = true
    setSkipBoStarted(true)
    skipBoBroadcast()
  }

  async function runSkipBoBot(botId: string, key: string) {
    while (!skipBoStale(key)) {
      const holdRemaining = skipBoBotsHeldUntilRef.current - Date.now()
      await wait(holdRemaining > 0 ? holdRemaining : BASE_MS)
      if (skipBoStale(key)) return
      if (Date.now() < skipBoBotsHeldUntilRef.current) continue
      const session = skipBoSessionRef.current!
      const ps = session.session.publicState
      if (ps.roundOver || ps.winnerId) return
      if (currentPlayer(ps.turn) !== botId) return
      if (!skipBoBotSeatsRef.current.has(botId)) return
      const result = runSkipBoBotTurn(session, botId, skipBoBotStrategy)
      if (!result.outcome.ok) return
      skipBoSessionRef.current = result.game
      skipBoBroadcast()
    }
  }

  async function runSkipBoBotsIfNeeded() {
    if (skipBoBotBusyRef.current) return
    const session = skipBoSessionRef.current
    if (!session) return
    const ps = session.session.publicState
    if (ps.roundOver || ps.winnerId) return
    const currentId = currentPlayer(ps.turn)
    if (!skipBoBotSeatsRef.current.has(currentId)) return
    skipBoBotBusyRef.current = true
    const key = skipBoActorKey(session)
    try {
      await runSkipBoBot(currentId, key)
    } finally {
      skipBoBotBusyRef.current = false
      setTimeout(() => runSkipBoBotsIfNeeded(), 50)
    }
  }

  function startSkipBoGuest(code: string) {
    if (!code) return
    setError(null)
    let localRevision = -1
    const handle = joinHost<SkipBoView, SkipBoAction>(code, name.trim(), {
      onState(view) {
        if (view.kind === 'lobby') {
          setSkipBoView(view)
          setSkipBoStarted(false)
          return
        }
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        setSkipBoView(view)
        setSkipBoStarted(true)
      },
      onError() {
        resetToEntry()
        setError('Could not reach that room. Check the code and try again.')
      },
      onRejected(reason) {
        resetToEntry()
        setError(reason)
      },
      onConnected() {
        setSkipBoConnection('connected')
      },
      onDisconnected() {
        setSkipBoConnection('disconnected')
      },
    })
    skipBoGuestRef.current = handle
    setSkipBoRole('guest')
    writeNameCookie(name)
    pushGameUrl('skipbo')
    setSkipBoCode(code)
    handle.peerId.then((id) => { setSkipBoLocalPlayerId(id); skipBoLocalPlayerIdRef.current = id }).catch(() => {})
  }

  function skipBoDispatch(action: SkipBoAction) {
    if (skipBoRole === 'host' && skipBoLocalPlayerId) {
      const session = skipBoSessionRef.current
      if (!session) return
      const result = applySkipBoAction(session, skipBoLocalPlayerId, action)
      if (!result.outcome.ok) return
      skipBoSessionRef.current = result.game
      skipBoBroadcast()
    } else if (skipBoRole === 'guest') {
      skipBoGuestRef.current?.sendAction(action)
    }
  }

  // Skip-Bo is a single-round game: a rematch is a completely fresh deal with
  // the same seat order (mirroring Dominoes/Battleship/Checkers/Chess — not
  // Rummy/Uno's score-carrying match layer).
  function skipBoRematch() {
    if (skipBoRole !== 'host' || !skipBoSessionRef.current) return
    const ps = skipBoSessionRef.current.session.publicState
    if (ps.winnerId === null) return
    const prevRevision = skipBoSessionRef.current.session.revision
    const playerIds = [...ps.seatOrder]
    const seed = Math.floor(Math.random() * 2147483647)
    const next = createSkipBoGame(playerIds, seed, ps.cardBack)
    next.session = { ...next.session, revision: prevRevision + 1 }
    skipBoSessionRef.current = next
    skipBoBotsHeldUntilRef.current = Date.now() + estimateDealIntroMs(playerIds.length * 5) + SKIPBO_DEAL_HOLD_BUFFER_MS
    skipBoBroadcast()
  }

  // ---- Scrabble helpers ----

  // Scrabble's actor key: must re-key on fields that change within CHALLENGE actions
  // (lastPlacement.challengeable changes when someone challenges or moves again).
  function scrabbleActorKey(session: ScrabbleSession): string {
    const ps = session.session.publicState
    const placement = ps.lastPlacement
    const placementKey = placement
      ? `${placement.by}:${placement.challengeable}:${placement.tiles.length}`
      : 'none'
    return `${ps.turn.turnNumber}:${ps.stage}:${placementKey}:${Object.values(ps.scores).join(',')}`
  }

  function scrabbleStale(key: string) {
    return !scrabbleSessionRef.current || scrabbleActorKey(scrabbleSessionRef.current) !== key
  }

  function scrabbleBroadcast() {
    if (!scrabbleStartedRef.current) {
      const view: ScrabbleView = {
        kind: 'lobby',
        roster: scrabbleSeatsRef.current.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === scrabbleLocalPlayerIdRef.current })),
        difficulty: scrabbleDifficultyRef.current,
      }
      setScrabbleView(view)
      scrabbleHostRef.current?.broadcast(view)
      return
    }
    const session = scrabbleSessionRef.current!
    const hostSnap = deriveSnapshot(session.session, scrabbleLocalPlayerIdRef.current!)
    setScrabbleView({
      kind: 'game',
      revision: hostSnap.revision,
      publicState: hostSnap.publicState,
      rack: hostSnap.privateState!.rack.cards,
      names: { ...scrabbleNamesRef.current },
    })
    const names = { ...scrabbleNamesRef.current }
    for (const seat of scrabbleSeatsRef.current) {
      if (seat.playerId === scrabbleLocalPlayerIdRef.current) continue
      if (scrabbleBotSeatsRef.current.has(seat.playerId)) continue
      const guestSnap = deriveSnapshot(session.session, seat.playerId)
      scrabbleHostRef.current?.sendTo(seat.playerId, {
        kind: 'game',
        revision: guestSnap.revision,
        publicState: guestSnap.publicState,
        rack: guestSnap.privateState!.rack.cards,
        names,
      })
    }
  }

  function startScrabbleHost() {
    setError(null)
    // Fire-and-forget dictionary loading (no blocking on room creation)
    loadDictionary().then(d => { scrabbleDictionaryRef.current = d }).catch(() => {})
    scrabbleHostRef.current = createHost<ScrabbleView, ScrabbleAction>(() => `SCR-${generateCode()}`, {
      onReady(code) {
        const hostId = peerIdForCode(code)
        setScrabbleRole('host')
        writeNameCookie(name)
        pushGameUrl('scrabble')
        setScrabbleCode(code)
        setScrabbleLocalPlayerId(hostId)
        scrabbleLocalPlayerIdRef.current = hostId
        setScrabbleStarted(false)
        scrabbleStartedRef.current = false
        setScrabbleSeats([{ playerId: hostId, name: name.trim(), isBot: false }])
        scrabbleSeatsRef.current = [{ playerId: hostId, name: name.trim(), isBot: false }]
        setScrabbleNotice(null)
        scrabbleBroadcast()
      },
      onJoin(guestId, guestName) {
        if (scrabbleStartedRef.current) {
          scrabbleHostRef.current?.reject(guestId, 'Game in progress — spectating comes later.')
          return
        }
        if (scrabbleSeatsRef.current.length >= SCRABBLE_MAX_SEATS) {
          scrabbleHostRef.current?.reject(guestId, 'Table is full.')
          return
        }
        scrabbleSeatsRef.current = [...scrabbleSeatsRef.current, { playerId: guestId, name: guestName, isBot: false }]
        setScrabbleSeats(scrabbleSeatsRef.current)
        scrabbleBroadcast()
      },
      onAction(guestId, action) {
        if (!scrabbleStartedRef.current) return
        const session = scrabbleSessionRef.current
        if (!session) return
        if (!scrabbleSeatsRef.current.some((s) => s.playerId === guestId)) return
        const result = applyScrabbleAction(session, guestId, action, scrabbleDictionaryRef.current)
        if (!result.outcome.ok) return
        scrabbleSessionRef.current = result.session
        scrabbleBroadcast()
        runScrabbleBotsIfNeeded()
      },
      onLeave(guestId) {
        if (!scrabbleStartedRef.current) {
          scrabbleSeatsRef.current = scrabbleSeatsRef.current.filter((s) => s.playerId !== guestId)
          setScrabbleSeats(scrabbleSeatsRef.current)
          scrabbleBroadcast()
          return
        }
        const seat = scrabbleSeatsRef.current.find((s) => s.playerId === guestId)
        if (!seat) return
        setScrabbleNotice(`${seat.name} disconnected.`)
      },
      onError(message) {
        setError(message)
      },
    })
  }

  function addScrabbleHouseBot() {
    if (scrabbleRole !== 'host' || scrabbleStartedRef.current) return
    if (scrabbleSeatsRef.current.length >= SCRABBLE_MAX_SEATS) return
    scrabbleBotCounterRef.current += 1
    const botId = `bot-${scrabbleBotCounterRef.current}`
    const botName = randomBotName(scrabbleSeatsRef.current.map((s) => s.name))
    scrabbleSeatsRef.current = [...scrabbleSeatsRef.current, { playerId: botId, name: botName, isBot: true }]
    setScrabbleSeats(scrabbleSeatsRef.current)
    scrabbleBotSeatsRef.current.add(botId)
    scrabbleBroadcast()
  }

  function scrabbleSetDifficulty(d: BotDifficulty) {
    if (scrabbleRole !== 'host' || scrabbleStartedRef.current) return
    scrabbleDifficultyRef.current = d
    setScrabbleDifficulty(d)
    scrabbleBroadcast()
  }

  async function scrabbleStart() {
    if (scrabbleRole !== 'host' || scrabbleStartedRef.current) return
    const seats = scrabbleSeatsRef.current
    if (seats.length < SCRABBLE_MIN_SEATS || seats.length > SCRABBLE_MAX_SEATS) return

    // Ensure dictionary is loaded before starting
    if (scrabbleDictionaryRef.current === null) {
      try {
        scrabbleDictionaryRef.current = await loadDictionary()
      } catch (e) {
        setError('Failed to load dictionary. Please try again.')
        return
      }
    }

    const playerIds = seats.map((s) => s.playerId)
    const seed = Math.floor(Math.random() * 2147483647)
    scrabbleSessionRef.current = createScrabbleGame(playerIds, seed)
    scrabbleNamesRef.current = Object.fromEntries(seats.map((s) => [s.playerId, s.name]))
    // Hold bots until every client's DealIntro (7 tiles per seat) has played out
    scrabbleBotsHeldUntilRef.current = Date.now() + estimateDealIntroMs(playerIds.length * 7) + SKIPBO_DEAL_HOLD_BUFFER_MS
    scrabbleStartedRef.current = true
    setScrabbleStarted(true)
    scrabbleBroadcast()
    runScrabbleBotsIfNeeded()
  }

  async function runScrabbleBot(botId: string, key: string) {
    while (!scrabbleStale(key)) {
      const holdRemaining = scrabbleBotsHeldUntilRef.current - Date.now()
      await wait(holdRemaining > 0 ? holdRemaining : BASE_MS)
      if (scrabbleStale(key)) return
      if (Date.now() < scrabbleBotsHeldUntilRef.current) continue
      const session = scrabbleSessionRef.current!
      const ps = session.session.publicState
      if (ps.stage === 'over') return
      if (!scrabbleBotSeatsRef.current.has(botId)) return

      const result = runScrabbleBotTurn(session, botId, createScrabbleBotStrategy(scrabbleDictionaryRef.current!, scrabbleDifficultyRef.current), scrabbleDictionaryRef.current)
      if (!result.outcome.ok) return
      scrabbleSessionRef.current = result.session
      scrabbleBroadcast()
    }
  }

  async function runScrabbleBotsIfNeeded() {
    if (scrabbleBotBusyRef.current) return
    const session = scrabbleSessionRef.current
    if (!session) return
    const ps = session.session.publicState
    if (ps.stage === 'over') return

    // Find first priority: any bot that can challenge
    let botToRun: string | null = null
    if (ps.lastPlacement !== null && ps.lastPlacement.challengeable) {
      for (const botId of ps.turn.playerOrder) {
        if (scrabbleBotSeatsRef.current.has(botId) &&
            botId !== ps.lastPlacement.by) {
          botToRun = botId
          break
        }
      }
    }

    // Second priority: current player's turn
    if (!botToRun) {
      const currentId = currentPlayer(ps.turn)
      if (scrabbleBotSeatsRef.current.has(currentId)) {
        botToRun = currentId
      }
    }

    if (!botToRun) return

    scrabbleBotBusyRef.current = true
    const key = scrabbleActorKey(session)
    try {
      await runScrabbleBot(botToRun, key)
    } finally {
      scrabbleBotBusyRef.current = false
      setTimeout(() => runScrabbleBotsIfNeeded(), 50)
    }
  }

  function startScrabbleGuest(code: string) {
    if (!code) return
    setError(null)
    let localRevision = -1
    const handle = joinHost<ScrabbleView, ScrabbleAction>(code, name.trim(), {
      onState(view) {
        if (view.kind === 'lobby') {
          setScrabbleView(view)
          setScrabbleDifficulty(view.difficulty)
          setScrabbleStarted(false)
          return
        }
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        setScrabbleView(view)
        setScrabbleStarted(true)
      },
      onError() {
        resetToEntry()
        setError('Could not reach that room. Check the code and try again.')
      },
      onRejected(reason) {
        resetToEntry()
        setError(reason)
      },
      onConnected() {
        setScrabbleConnection('connected')
      },
      onDisconnected() {
        setScrabbleConnection('disconnected')
      },
    })
    scrabbleGuestRef.current = handle
    setScrabbleRole('guest')
    writeNameCookie(name)
    pushGameUrl('scrabble')
    setScrabbleCode(code)
    handle.peerId.then((id) => { setScrabbleLocalPlayerId(id); scrabbleLocalPlayerIdRef.current = id }).catch(() => {})
  }

  function scrabbleDispatch(action: ScrabbleAction) {
    if (scrabbleRole === 'host' && scrabbleLocalPlayerId) {
      const session = scrabbleSessionRef.current
      if (!session) return
      const result = applyScrabbleAction(session, scrabbleLocalPlayerId, action, scrabbleDictionaryRef.current)
      if (!result.outcome.ok) return
      scrabbleSessionRef.current = result.session
      scrabbleBroadcast()
      runScrabbleBotsIfNeeded()
    } else if (scrabbleRole === 'guest') {
      scrabbleGuestRef.current?.sendAction(action)
    }
  }

  function scrabbleRematch() {
    if (scrabbleRole !== 'host' || !scrabbleSessionRef.current) return
    const ps = scrabbleSessionRef.current.session.publicState
    if (ps.stage !== 'over' || ps.winnerId === null) return
    const prevRevision = scrabbleSessionRef.current.session.revision
    const playerIds = [...ps.turn.playerOrder]
    const seed = Math.floor(Math.random() * 2147483647)
    const next = createScrabbleGame(playerIds, seed)
    next.session = { ...next.session, revision: prevRevision + 1 }
    scrabbleSessionRef.current = next
    scrabbleBotsHeldUntilRef.current = Date.now() + estimateDealIntroMs(playerIds.length * 7) + SKIPBO_DEAL_HOLD_BUFFER_MS
    scrabbleBroadcast()
  }

  // ---- End Skip-Bo helpers ----

  async function runFarkleBot(seatId: string, key: string) {
    while (!stale(key)) {
      const pace = roomRef.current!.botPace
      await wait(BASE_MS * pace)
      if (stale(key)) return
      const rolled = hostApply({ type: 'farkleRoll' }, seatId)
      if (!rolled) return
      if (rolled.farkle.farkle) {
        await wait(BASE_MS * pace)
        if (stale(key)) return
        hostApply({ type: 'farkleEndTurn' }, seatId)
        return
      }
      const seat = rolled.seats.find((s) => s.id === seatId)!
      const move = decideFarkleBot(
        rolled.farkle.dice.map((d) => d.val), rolled.farkle.turnScore, seat.score,
        rolled.farkle.openingScore, rolled.farkle.winningScore, rolled.botDifficulty,
      )
      await wait(BASE_MS * pace * 0.6)
      if (stale(key)) return
      let cur = rolled
      for (const idx of move.keepIndices) {
        const dieId = cur.farkle.dice[idx].id
        const next = hostApply({ type: 'farkleToggle', dieId }, seatId)
        if (!next) return
        cur = next
      }
      await wait(BASE_MS * pace * 0.6)
      if (stale(key)) return
      if (move.bank) {
        hostApply({ type: 'farkleBank' }, seatId)
        return
      }
    }
  }

  async function runYahtzeeBot(seatId: string, key: string) {
    const pace = roomRef.current!.botPace
    await wait(YAHTZEE_ACTION_MS * pace)
    if (stale(key)) return
    let state = hostApply({ type: 'yahtzeeRoll' }, seatId)
    if (!state) return
    while (state.yahtzee.rollsLeft > 0 && !stale(key)) {
      await wait(YAHTZEE_ACTION_MS * pace * 0.6)
      if (stale(key)) return
      const holdIds = decideYahtzeeHold(
        state.yahtzee.dice, state.yahtzee.cards[seatId] ?? {}, state.botDifficulty, state.yahtzee.rollsLeft,
      )
      let cur = state
      // yahtzeeToggleHold flips sel — only toggle dice whose CURRENT hold state disagrees with
      // the decision, or a die correctly held from the previous roll gets un-held by mistake.
      for (const die of cur.yahtzee.dice) {
        if (holdIds.has(die.id) === die.sel) continue
        const next = hostApply({ type: 'yahtzeeToggleHold', dieId: die.id }, seatId)
        if (!next) return
        cur = next
      }
      state = cur
      // Holding every die means a reroll changes nothing — skip straight to scoring instead of
      // burning a full pause-and-reroll cycle watching dice that won't move.
      if (holdIds.size === state.yahtzee.dice.length) break
      await wait(YAHTZEE_ACTION_MS * pace)
      if (stale(key)) return
      const rolled = hostApply({ type: 'yahtzeeRoll' }, seatId)
      if (!rolled) return
      state = rolled
    }
    if (stale(key)) return
    await wait(YAHTZEE_ACTION_MS * pace * 0.6)
    if (stale(key)) return
    const vals = state.yahtzee.dice.map((d) => d.val)
    const category = decideYahtzeeCategory(vals, state.yahtzee.cards[seatId] ?? {}, state.botDifficulty)
    hostApply({ type: 'yahtzeeScore', category }, seatId)
  }

  async function runTttBot(seatId: string, key: string) {
    const pace = roomRef.current!.botPace
    await wait(BASE_MS * pace)
    if (stale(key)) return
    const state = roomRef.current!
    const me = state.seats.findIndex((s) => s.id === seatId)
    const opponent = state.seats.findIndex((s) => s.id !== seatId)
    const cell = decideTttMove(state.ttt.board, me, opponent)
    hostApply({ type: 'tttPlay', cell }, seatId)
  }

  async function runConnect4Bot(seatId: string, key: string) {
    const pace = roomRef.current!.botPace
    await wait(BASE_MS * pace)
    if (stale(key)) return
    const state = roomRef.current!
    const me = state.seats.findIndex((s) => s.id === seatId)
    const opponent = state.seats.findIndex((s) => s.id !== seatId)
    const col = decideConnect4Move(state.connect4.board, me, opponent)
    hostApply({ type: 'connect4Play', col }, seatId)
  }

  async function runHangmanBot(seatId: string, key: string) {
    while (!stale(key)) {
      const pace = roomRef.current!.botPace
      await wait(BASE_MS * pace)
      if (stale(key)) return
      const state = roomRef.current!
      if (state.screen !== 'hangman' || state.hangman.phase !== 'guessing' || state.hangman.over) return
      const letter = decideHangmanLetter(state.hangman.guessed)
      const next = hostApply({ type: 'hangmanGuess', letter }, seatId)
      if (!next) return
      if (next.hangman.over || next.screen !== 'hangman') return
    }
  }

  async function runBotsIfNeeded() {
    if (botBusyRef.current) return
    const state = roomRef.current
    if (!state) return
    const actor = whoActsNow(state)
    if (!actor || !actor.bot) return
    botBusyRef.current = true
    const myKey = actorKey(state)
    try {
      if (state.screen === 'farkle') await runFarkleBot(actor.id, myKey)
      else if (state.screen === 'yahtzee') await runYahtzeeBot(actor.id, myKey)
      else if (state.screen === 'ttt') await runTttBot(actor.id, myKey)
      else if (state.screen === 'connect4') await runConnect4Bot(actor.id, myKey)
      else if (state.screen === 'hangman') await runHangmanBot(actor.id, myKey)
    } finally {
      botBusyRef.current = false
      setTimeout(() => runBotsIfNeeded(), 50)
    }
  }

  useEffect(() => {
    if (role !== 'host' || !room) return
    runBotsIfNeeded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, room?.screen, room?.turnIdx, room?.hangman.phase, room?.hangman.guesserIdx])

  // Pause on a finished Tic-Tac-Toe round (winning line still visible) before moving
  // on, whether the round ended on a bot's move or a human's — otherwise it flashes past.
  useEffect(() => {
    if (role !== 'host' || !room) return
    if (room.screen === 'ttt' && room.ttt.roundOver) {
      const t = setTimeout(() => dispatch({ type: 'tttAdvanceRound' }), ROUND_PAUSE_MS)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, room?.screen, room?.ttt.roundOver])

  // Pause on a finished Connect 4 round (winning line still visible) before moving
  // on, whether the round ended on a bot's move or a human's — otherwise it flashes past.
  useEffect(() => {
    if (role !== 'host' || !room) return
    if (room.screen === 'connect4' && room.connect4.roundOver) {
      const t = setTimeout(() => dispatch({ type: 'connect4AdvanceRound' }), ROUND_PAUSE_MS)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, room?.screen, room?.connect4.roundOver])

  // ---- Rummy effects (host-only) ----

  // Bot turn trigger
  useEffect(() => {
    if (rummyRole !== 'host' || !rummyView || rummyView.kind !== 'game') return
    runRummyBotsIfNeeded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rummyRole, rummyView])

  // Round transition (pause then start next round)
  useEffect(() => {
    if (rummyRole !== 'host' || !rummyView || rummyView.kind !== 'game') return
    if (rummyView.publicState.roundOver && !rummyView.publicState.matchWinnerId) {
      const t = setTimeout(() => {
        const result = applyRummyAction(rummySessionRef.current!, rummyLocalPlayerIdRef.current!, { type: 'START_NEXT_ROUND' })
        if (result.outcome.ok) {
          rummySessionRef.current = result.rummy
          rummyBroadcast()
        }
      }, ROUND_PAUSE_MS)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rummyRole, rummyView])

  // ---- Phase 10 effects (host-only) ----

  // Bot turn trigger
  useEffect(() => {
    if (phase10Role !== 'host' || !phase10View || phase10View.kind !== 'game') return
    runPhase10BotsIfNeeded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase10Role, phase10View])

  // Round transition (pause then start next round)
  useEffect(() => {
    if (phase10Role !== 'host' || !phase10View || phase10View.kind !== 'game') return
    if (phase10View.publicState.roundOver && !phase10View.publicState.matchWinnerId) {
      const t = setTimeout(() => {
        const result = applyPhase10Action(phase10SessionRef.current!, phase10LocalPlayerId!, { type: 'START_NEXT_ROUND' })
        if (result.outcome.ok) {
          phase10SessionRef.current = result.game
          phase10Broadcast()
        }
      }, ROUND_PAUSE_MS)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase10Role, phase10View])

  // ---- Battleship effects (host-only) ----

  // Bot turn trigger (no round transition — Battleship has no rounds)
  useEffect(() => {
    if (battleshipRole !== 'host' || !battleshipView) return
    runBattleshipBotsIfNeeded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battleshipRole, battleshipView])

  // ---- Dominoes effects (host-only) ----

  // Bot turn trigger (draws do NOT advance the turn — the inner loop keeps acting
  // while the actor key is unchanged; stage is part of the key so round transitions
  // abort the loop).
  useEffect(() => {
    if (dominoesRole !== 'host' || !dominoesView) return
    runDominoesBotsIfNeeded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dominoesRole, dominoesView])

  // Round transition (pause then start next round)
  useEffect(() => {
    if (dominoesRole !== 'host' || !dominoesView) return
    if (dominoesView.publicState.stage === 'roundEnd' && !dominoesView.publicState.matchWinnerId) {
      const t = setTimeout(() => {
        const result = applyDominoesAction(dominoesSessionRef.current!, dominoesLocalPlayerId!, { type: 'START_NEXT_ROUND' })
        if (result.outcome.ok) {
          dominoesSessionRef.current = result.dm
          dominoesUpdateViews()
        }
      }, ROUND_PAUSE_MS)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dominoesRole, dominoesView?.publicState.stage, dominoesView?.publicState.matchWinnerId])

  // ---- Wahoo effects (host-only) ----

  // Bot turn trigger. The actor key only bumps when a turn hands off (or a 6
  // grants an extra roll), so the inner loop covers the ROLL then MOVE of one
  // bot window; each action is committed + broadcast separately so guests see
  // the die before the move.
  useEffect(() => {
    if (wahooRole !== 'host' || !wahooView) return
    runWahooBotsIfNeeded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wahooRole, wahooView])

  // ---- Checkers effects (host-only) ----

  // Bot turn trigger. The actor key is stage + turnNumber, and a chain jump
  // keeps both stable (same player, same turn), so the inner loop keeps
  // acting until the chain ends — every link of a multi-jump is paced like
  // any other bot move. chainCell/lastMove are in the deps too so a chain
  // continuation re-checks even if the view reference were unchanged.
  useEffect(() => {
    if (checkersRole !== 'host' || !checkersView) return
    runCheckersBotsIfNeeded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkersRole, checkersView, checkersView?.kind === 'game' ? checkersView.publicState.chainCell : null, checkersView?.kind === 'game' ? checkersView.publicState.lastMove : null])

  // Game-end advance: when stage is 'gameEnd' and there's no match winner
  // yet, the host auto-issues NEXT_GAME after the same pause pattern
  // dominoes uses for START_NEXT_ROUND. Stage 'over' → results screen.
  useEffect(() => {
    if (checkersRole !== 'host' || !checkersView) return
    if (checkersView.kind === 'game' && checkersView.publicState.stage === 'gameEnd' && !checkersView.publicState.matchWinnerId) {
      const t = setTimeout(() => {
        const result = applyCheckersAction(checkersSessionRef.current!, checkersLocalPlayerId!, { type: 'NEXT_GAME' })
        if (result.outcome.ok) {
          checkersSessionRef.current = result.game
          checkersBroadcast()
        }
      }, ROUND_PAUSE_MS)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkersRole, checkersView?.kind === 'game' ? checkersView.publicState.stage : null, checkersView?.kind === 'game' ? checkersView.publicState.matchWinnerId : null])

  // ---- Mexican Train effects (host-only) ----

  // Bot turn trigger. The actor key includes the hand-count sum, boneyard
  // count, and double-pending, so every accepted action bumps it (a double
  // keeps the turn; a playable draw keeps the turn) — the inner loop paces
  // each step.
  useEffect(() => {
    if (mtRole !== 'host' || !mtView) return
    runMTBotsIfNeeded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mtRole, mtView])

  // Auto-pass housekeeping (prototype-deadlock fix, second half): when the
  // boneyard is empty and the current player — human or bot — has no legal
  // play, the host applies PASS for them after BASE_MS (the module validates
  // it). Bots would PASS via strategy anyway; this covers humans and keeps
  // one code path. Humans with a boneyard still draw manually via the button.
  useEffect(() => {
    if (mtRole !== 'host' || !mtView || mtView.kind !== 'game') return
    if (mtView.publicState.stage !== 'play') return
    const session = mtSessionRef.current
    if (!session) return
    if (mtView.publicState.boneyardCount > 0) return
    const currentId = currentPlayer(mtView.publicState.turn)
    const snap = deriveSnapshot(session.session, currentId)
    const hand = snap.privateState?.hand.cards ?? []
    const seat = mtView.publicState.seatOrder.indexOf(currentId)
    if (handHasLegalPlay(hand, seat, mtView.publicState)) return
    // Chained stuck players: when the PREVIOUS action was also a pass-open,
    // stretch the auto-pass beat so the horns don't pile up.
    const delay = mtView.publicState.lastAction?.kind === 'pass-open' ? MT_ACTION_MS + MT_HORN_BUFFER_MS : MT_ACTION_MS
    const t = setTimeout(() => {
      const live = mtSessionRef.current
      if (!live) return
      const ps = live.session.publicState
      if (ps.stage !== 'play' || currentPlayer(ps.turn) !== currentId) return
      const result = applyMTAction(live, currentId, { type: 'PASS' })
      if (result.outcome.ok) {
        mtSessionRef.current = result.mt
        mtBroadcast()
      }
    }, delay)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mtRole, mtView])

  // Round advance: stage 'roundEnd' → host auto-deals the next round after the
  // dominoes pause. Stage 'over' → MexicanTrainResults.
  useEffect(() => {
    if (mtRole !== 'host' || !mtView || mtView.kind !== 'game') return
    if (mtView.publicState.stage === 'roundEnd' && !mtView.publicState.matchWinnerId) {
      const t = setTimeout(() => {
        const session = mtSessionRef.current
        if (!session) return
        const result = applyMTAction(session, mtLocalPlayerId!, { type: 'START_NEXT_ROUND' })
        if (result.outcome.ok) {
          mtSessionRef.current = result.mt
          mtBroadcast()
        }
      }, ROUND_PAUSE_MS)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mtRole, mtView])

  // ---- Chess effects (host-only) ----

  // Bot turn trigger. The actor key is stage + turnNumber, and every accepted
  // action advances turnNumber (except draw-offer bookkeeping, which the bot
  // never proposes), so the inner loop paces each bot move.
  useEffect(() => {
    if (chessRole !== 'host' || !chessView) return
    runChessBotsIfNeeded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chessRole, chessView])

  // ---- Uno effects (host-only) ----

  // Bot turn trigger. The actor key includes every field that can change
  // within the SAME player's turn (draw-then-play is two actions, same
  // turnNumber), so the inner loop re-evaluates after a draw that doesn't
  // advance the turn. CALL_UNO is NOT part of this loop — see
  // checkUnoBotReflexes(), which runs at the end of every unoBroadcast().
  useEffect(() => {
    if (unoRole !== 'host' || !unoView) return
    runUnoBotsIfNeeded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unoRole, unoView])

  // ---- Skip-Bo effects (host-only) ----

  // Bot turn trigger. The actor key includes every field that can change
  // within the SAME player's turn (a Skip-Bo turn is a chain of individual
  // plays), so the inner loop re-evaluates after each play rather than
  // running a whole turn at once.
  useEffect(() => {
    if (skipBoRole !== 'host' || !skipBoView) return
    runSkipBoBotsIfNeeded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipBoRole, skipBoView])

  // ---- Render ----

  // Landing: dice games, Rummy, Phase 10, Battleship, Dominoes, Wahoo,
  // Checkers, Mexican Train, Chess, Uno, Skip-Bo, Solitaire, and Scrabble are all not yet in a session
  if (!room && !rummyRole && !phase10Role && !battleshipRole && !dominoesRole && !wahooRole && !checkersRole && !mtRole && !chessRole && !unoRole && !skipBoRole && !solitaireOpen && !scrabbleRole) {
    return (
      <Landing
        name={name}
        onNameChange={setName}
        joinCode={joinCodeInput}
        onJoinCodeChange={setJoinCodeInput}
        onJoin={() => {
          const code = joinCodeInput.trim()
          if (code.startsWith('RM-')) startRummyGuest(code)
          else if (code.startsWith('P10-')) startPhase10Guest(code)
          else if (code.startsWith('BS-')) startBattleshipGuest(code)
          else if (code.startsWith('DM-')) startDominoesGuest(code)
          else if (code.startsWith('WH-')) startWahooGuest(code)
          else if (code.startsWith('CK-')) startCheckersGuest(code)
          else if (code.startsWith('MT-')) startMTGuest(code)
          else if (code.startsWith('CH-')) startChessGuest(code)
          else if (code.startsWith('UN-')) startUnoGuest(code)
          else if (code.startsWith('SB-')) startSkipBoGuest(code)
          else if (code.startsWith('SCR-')) startScrabbleGuest(code)
          else startGuest(code)
        }}
        onPickGame={(g) => startHost(g)}
        onPickRummy={startRummyHost}
        onPickPhase10={startPhase10Host}
        onPickBattleship={startBattleshipHost}
        onPickDominoes={startDominoesHost}
        onPickWahoo={startWahooHost}
        onPickCheckers={startCheckersHost}
        onPickMexicanTrain={startMTHost}
        onPickChess={startChessHost}
        onPickUno={startUnoHost}
        onPickSkipBo={startSkipBoHost}
        onPickSolitaire={startSolitaire}
        onPickScrabble={startScrabbleHost}
        error={error}
      />
    )
  }

  // Dice-game session active
  if (room) {
    const isHost = role === 'host'

    return (
      <>
        {room.screen === 'room' && (
          <Room
            room={room}
            isHost={isHost}
            onAddBot={() => dispatch({ type: 'addBot' })}
            onSetDifficulty={(d) => dispatch({ type: 'setBotDifficulty', difficulty: d })}
            onStart={() => dispatch({ type: 'startGame' })}
            onLeave={resetToEntry}
            onOpenRules={() => setRulesOpen(true)}
          />
        )}
        {room.screen === 'farkle' && (
          <FarkleTable
            room={room}
            localSeatId={localSeatId}
            onRoll={() => dispatch({ type: 'farkleRoll' })}
            onToggle={(dieId) => dispatch({ type: 'farkleToggle', dieId })}
            onBank={() => dispatch({ type: 'farkleBank' })}
            onEndTurn={() => dispatch({ type: 'farkleEndTurn' })}
            onOpenRules={() => setRulesOpen(true)}
            onLeave={resetToEntry}
          />
        )}
        {room.screen === 'yahtzee' && (
          <YahtzeeTable
            room={room}
            localSeatId={localSeatId}
            onRoll={() => dispatch({ type: 'yahtzeeRoll' })}
            onToggleHold={(dieId) => dispatch({ type: 'yahtzeeToggleHold', dieId })}
            onScore={(category) => dispatch({ type: 'yahtzeeScore', category })}
            onOpenRules={() => setRulesOpen(true)}
            onLeave={resetToEntry}
          />
        )}
        {room.screen === 'ttt' && (
          <TttTable
            room={room}
            localSeatId={localSeatId}
            onPlay={(cell) => dispatch({ type: 'tttPlay', cell })}
            onOpenRules={() => setRulesOpen(true)}
            onLeave={resetToEntry}
          />
        )}
        {room.screen === 'connect4' && (
          <Connect4Table
            room={room}
            localSeatId={localSeatId}
            onPlay={(col) => dispatch({ type: 'connect4Play', col })}
            onOpenRules={() => setRulesOpen(true)}
            onLeave={resetToEntry}
          />
        )}
        {room.screen === 'hangman' && (
          <HangmanTable
            room={room}
            localSeatId={localSeatId}
            onSetWord={(word) => dispatch({ type: 'hangmanSetWord', word })}
            onGuess={(letter) => dispatch({ type: 'hangmanGuess', letter })}
            onAdvanceRound={() => dispatch({ type: 'hangmanAdvanceRound' })}
            onOpenRules={() => setRulesOpen(true)}
            onLeave={resetToEntry}
          />
        )}
        {room.screen === 'results' && (
          <Results
            room={room}
            localSeatId={localSeatId}
            isHost={isHost}
            onRematch={() => dispatch({ type: 'rematch' })}
            onBackToShelf={resetToEntry}
          />
        )}
        {rulesOpen && <RulesOverlay game={room.game} onClose={() => setRulesOpen(false)} />}
      </>
    )
  }

  // ---- Rummy session active ----
  // Rummy lobby — 2 to 4 seats. Host sees seats from state; guests see the
  // lobby view the host broadcasts (buttons hidden either way).
  if (rummyRole && !rummyStarted) {
    const roster = rummyRole === 'host'
      ? rummySeats.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === rummyLocalPlayerId }))
      : (rummyView?.kind === 'lobby' ? rummyView.roster : [])
    const viewCardBack = rummyRole === 'host'
      ? rummyCardBack
      : (rummyView?.kind === 'lobby' ? rummyView.cardBack : DEFAULT_CARD_BACK)
    return (
      <RummyRoom
        code={rummyCode}
        localName={name}
        isHost={rummyRole === 'host'}
        seats={roster}
        notice={rummyNotice ?? error}
        cardBack={viewCardBack}
        onSelectCardBack={rummySetCardBack}
        onAddHouseBot={addRummyHouseBot}
        onStartGame={rummyStart}
        onLeave={resetToEntry}
      />
    )
  }

  // Rummy match results
  if (rummyView?.kind === 'game' && rummyView.publicState.matchWinnerId) {
    const rummyColors = Object.fromEntries(rummyView.publicState.seatOrder.map((id, i) => [id, RUMMY_SEAT_INKS[i]]))
    return (
      <RummyResults
        localPlayerId={rummyLocalPlayerId ?? ''}
        localName={name}
        names={rummyView.names}
        colors={rummyColors}
        publicState={rummyView.publicState}
        isHost={rummyRole === 'host'}
        notice={rummyNotice ?? error}
        onRematch={rummyRematch}
        onBackToShelf={resetToEntry}
      />
    )
  }

  // Rummy table (active game)
  if (rummyView?.kind === 'game' && rummyLocalPlayerId) {
    const rummyColors = Object.fromEntries(rummyView.publicState.seatOrder.map((id, i) => [id, RUMMY_SEAT_INKS[i]]))
    return (
      <RummyTable
        code={rummyCode}
        localPlayerId={rummyLocalPlayerId}
        localName={name}
        names={rummyView.names}
        colors={rummyColors}
        connection={rummyConnection}
        notice={rummyNotice ?? error}
        publicState={rummyView.publicState}
        hand={rummyView.hand}
        onDrawStock={() => rummyDispatch({ type: 'DRAW_FROM_STOCK' })}
        onDrawDiscard={(index) => rummyDispatch({ type: 'DRAW_FROM_DISCARD', index })}
        onLayDownMeld={(cardIds) => rummyDispatch({ type: 'LAY_DOWN_MELD', cardIds })}
        onLayOffMeld={(targetPlayerId, meldIndex, cardIds) => rummyDispatch({ type: 'LAY_OFF', targetPlayerId, meldIndex, cardIds })}
        onDiscard={(cardId) => rummyDispatch({ type: 'DISCARD_CARD', cardId })}
        onOpenRules={() => {}}
        onLeave={resetToEntry}
      />
    )
  }

  // ---- Phase 10 session active ----
  // Phase 10 lobby — 2 to 6 seats. Host sees seats from state; guests see the
  // lobby view the host broadcasts (buttons hidden either way).
  if (phase10Role && !phase10Started) {
    const roster = phase10Role === 'host'
      ? phase10Seats.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === phase10LocalPlayerId }))
      : (phase10View?.kind === 'lobby' ? phase10View.roster : [])
    const phase10ViewCardBack = phase10Role === 'host'
      ? rummyCardBack
      : (phase10View?.kind === 'lobby' ? phase10View.cardBack : DEFAULT_CARD_BACK)
    return (
      <Phase10Room
        code={phase10Code}
        localName={name}
        isHost={phase10Role === 'host'}
        seats={roster}
        notice={phase10Notice ?? error}
        cardBack={phase10ViewCardBack}
        onSelectCardBack={phase10SetCardBack}
        onAddHouseBot={addPhase10HouseBot}
        onStartGame={phase10Start}
        onLeave={resetToEntry}
      />
    )
  }

  // Phase 10 match results
  if (phase10View?.kind === 'game' && phase10View.publicState.matchWinnerId) {
    const phase10Colors = Object.fromEntries(phase10View.publicState.seatOrder.map((id, i) => [id, PHASE10_SEAT_INKS[i]]))
    return (
      <Phase10Results
        localPlayerId={phase10LocalPlayerId ?? ''}
        localName={name}
        names={phase10View.names}
        colors={phase10Colors}
        publicState={phase10View.publicState}
        isHost={phase10Role === 'host'}
        notice={phase10Notice ?? error}
        onRematch={phase10Rematch}
        onBackToShelf={resetToEntry}
      />
    )
  }

  // Phase 10 table (active game)
  if (phase10View?.kind === 'game' && phase10LocalPlayerId) {
    const phase10Colors = Object.fromEntries(phase10View.publicState.seatOrder.map((id, i) => [id, PHASE10_SEAT_INKS[i]]))
    return (
      <Phase10Table
        code={phase10Code}
        localPlayerId={phase10LocalPlayerId}
        localName={name}
        names={phase10View.names}
        colors={phase10Colors}
        connection={phase10Connection}
        notice={phase10Notice ?? error}
        publicState={phase10View.publicState}
        hand={phase10View.privateState.hand.cards}
        onDrawStock={() => phase10Dispatch({ type: 'DRAW_FROM_STOCK' })}
        onDrawDiscard={() => phase10Dispatch({ type: 'DRAW_FROM_DISCARD' })}
        onLayPhase={(cardIds) => phase10Dispatch({ type: 'LAY_PHASE', cardIds })}
        onHit={(targetPlayerId, groupIndex, cardIds) => phase10Dispatch({ type: 'HIT', targetPlayerId, groupIndex, cardIds })}
        onDiscard={(cardId) => phase10Dispatch({ type: 'DISCARD_CARD', cardId })}
        onOpenRules={() => {}}
        onLeave={resetToEntry}
      />
    )
  }

  // ---- Battleship session active ----
  // Battleship waiting screen (host waiting for opponent) — mirrors the shared Room.tsx /
  // RummyRoom.tsx / Phase10Room.tsx layout so the start flow doesn't feel like a different app.
  if (battleshipRole === 'host' && battleshipWaiting) {
    return (
      <BattleshipRoom
        code={battleshipCode}
        localName={name}
        notice={error}
        variant={battleshipVariant}
        onSetVariant={(v) => { setBattleshipVariant(v); battleshipVariantRef.current = v }}
        onAddHouseBot={addBattleshipHouseBot}
        onLeave={resetToEntry}
      />
    )
  }

  // Battleship match results
  if (battleshipView && battleshipView.publicState.stage === 'over' && battleshipView.publicState.winnerId) {
    return (
      <BattleshipResults
        localPlayerId={battleshipLocalPlayerId ?? ''}
        localName={name}
        opponentName={battleshipOpponentName}
        publicState={battleshipView.publicState}
        isHost={battleshipRole === 'host'}
        notice={error}
        onRematch={battleshipRematch}
        onBackToShelf={resetToEntry}
      />
    )
  }

  // Battleship table (active match)
  if (battleshipView && battleshipLocalPlayerId) {
    return (
      <BattleshipTable
        code={battleshipCode}
        localPlayerId={battleshipLocalPlayerId}
        localName={name}
        opponentName={battleshipOpponentName}
        opponentColor="#1a6fae"
        connection={battleshipConnection}
        notice={error}
        publicState={battleshipView.publicState}
        board={battleshipView.privateState.board}
        onPlaceFleet={(b: (ShipId | null)[]) => battleshipDispatch({ type: 'PLACE_FLEET', board: b })}
        onFire={(cell) => battleshipDispatch({ type: 'FIRE', cell })}
        onOpenRules={() => {}}
        onLeave={resetToEntry}
      />
    )
  }

  // ---- Dominoes session active ----
  // Dominoes waiting screen (host waiting for opponent) — mirrors the shared Room.tsx /
  // RummyRoom.tsx / Phase10Room.tsx / BattleshipRoom.tsx layout so the start flow doesn't
  // feel like a different app.
  if (dominoesRole === 'host' && dominoesWaiting) {
    return (
      <DominoesRoom
        code={dominoesCode}
        localName={name}
        notice={error}
        onAddHouseBot={addDominoesHouseBot}
        onLeave={resetToEntry}
      />
    )
  }

  // Dominoes match results
  if (dominoesView && dominoesView.publicState.stage === 'over' && dominoesView.publicState.matchWinnerId) {
    return (
      <DominoesResults
        localPlayerId={dominoesLocalPlayerId ?? ''}
        localName={name}
        opponentName={dominoesOpponentName}
        publicState={dominoesView.publicState}
        isHost={dominoesRole === 'host'}
        notice={error}
        onRematch={dominoesRematch}
        onBackToShelf={resetToEntry}
      />
    )
  }

  // Dominoes table (active match)
  if (dominoesView && dominoesLocalPlayerId) {
    return (
      <DominoesTable
        code={dominoesCode}
        localPlayerId={dominoesLocalPlayerId}
        localName={name}
        opponentName={dominoesOpponentName}
        opponentColor="#5b5bd6"
        connection={dominoesConnection}
        notice={error}
        publicState={dominoesView.publicState}
        hand={dominoesView.privateState.hand.cards satisfies DominoTile[]}
        onPlayTile={(tileId, arm: DominoArm | 'center') => dominoesDispatch({ type: 'PLAY_TILE', tileId, arm })}
        onDraw={() => dominoesDispatch({ type: 'DRAW_TILE' })}
        onPass={() => dominoesDispatch({ type: 'PASS' })}
        onOpenRules={() => {}}
        onLeave={resetToEntry}
      />
    )
  }

  // ---- Wahoo session active ----
  // Wahoo lobby — the first multi-seat room. Host sees seats from state;
  // guests see the lobby view the host broadcasts (buttons hidden either way).
  if (wahooRole && !wahooStarted) {
    const roster = wahooRole === 'host'
      ? wahooSeats.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === wahooLocalPlayerId }))
      : (wahooView?.kind === 'lobby' ? wahooView.roster : [])
    return (
      <WahooRoom
        code={wahooCode}
        localName={name}
        isHost={wahooRole === 'host'}
        seats={roster}
        notice={wahooNotice ?? error}
        onAddHouseBot={addWahooHouseBot}
        onStartGame={wahooStart}
        onLeave={resetToEntry}
      />
    )
  }

  // Wahoo match results
  if (wahooView?.kind === 'game' && wahooView.publicState.stage === 'over' && wahooView.publicState.winnerId) {
    return (
      <WahooResults
        localPlayerId={wahooLocalPlayerId ?? ''}
        localName={name}
        names={wahooView.names}
        publicState={wahooView.publicState}
        isHost={wahooRole === 'host'}
        notice={wahooNotice ?? error}
        onRematch={wahooRematch}
        onBackToShelf={resetToEntry}
      />
    )
  }

  // Wahoo table (active game). Host-only: a "replace with a bot" banner above
  // the table for every guest seat that disconnected mid-game.
  if (wahooView?.kind === 'game' && wahooLocalPlayerId) {
    return (
      <>
        {wahooRole === 'host' && wahooDropped.length > 0 && (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            justifyContent: 'center',
            alignItems: 'center',
            textAlign: 'center',
            background: 'var(--coral)',
            color: '#fff',
            fontWeight: 700,
            fontSize: 'clamp(14px, 1.8vw, 17px)',
            padding: '10px 22px',
            borderRadius: 999,
            border: '3px solid var(--ink)',
            boxShadow: '0 5px 0 var(--ink)',
            marginBottom: 'clamp(10px, 2vw, 18px)',
          }}>
            {wahooDropped.map((pid) => (
              <button
                key={pid}
                type="button"
                className="btn pill-small"
                style={{ background: '#fff', color: 'var(--coral)' }}
                onClick={() => wahooReplaceWithBot(pid)}
              >
                Replace {wahooView.names[pid] ?? pid} with a bot
              </button>
            ))}
          </div>
        )}
        <WahooTable
          code={wahooCode}
          localPlayerId={wahooLocalPlayerId}
          localName={name}
          names={wahooView.names}
          connection={wahooConnection}
          notice={wahooNotice ?? error}
          publicState={wahooView.publicState}
          onRoll={() => wahooDispatch({ type: 'ROLL' })}
          onMove={(move) => wahooDispatch({ type: 'MOVE', move })}
          onOpenRules={() => {}}
          onLeave={resetToEntry}
        />
      </>
    )
  }

  // ---- Checkers session active ----
  // Checkers lobby — host sees seats from state; guests see the lobby view the
  // host broadcasts (buttons hidden either way).
  if (checkersRole && !checkersStarted) {
    const roster = checkersRole === 'host'
      ? checkersSeats.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === checkersLocalPlayerId }))
      : (checkersView?.kind === 'lobby' ? checkersView.roster : [])
    return (
      <CheckersRoom
        code={checkersCode}
        localName={name}
        isHost={checkersRole === 'host'}
        seats={roster}
        notice={error}
        onAddHouseBot={addCheckersHouseBot}
        onStartGame={checkersStart}
        onLeave={resetToEntry}
      />
    )
  }

  // Checkers match results
  if (checkersView?.kind === 'game' && checkersView.publicState.stage === 'over' && checkersView.publicState.matchWinnerId) {
    const opponentId = checkersView.publicState.seatOrder.find((id) => id !== checkersLocalPlayerId) ?? ''
    const opponentName = checkersView.names[opponentId] ?? opponentId
    return (
      <CheckersResults
        localPlayerId={checkersLocalPlayerId ?? ''}
        localName={name}
        opponentName={opponentName}
        publicState={checkersView.publicState}
        isHost={checkersRole === 'host'}
        notice={error}
        onRematch={checkersRematch}
        onBackToShelf={resetToEntry}
      />
    )
  }

  // Checkers table (active match). Board is public — nothing to hide per player.
  if (checkersView?.kind === 'game' && checkersLocalPlayerId) {
    const opponentId = checkersView.publicState.seatOrder.find((id) => id !== checkersLocalPlayerId) ?? ''
    // Seat colors, same two-color assignment the other 2-player engine games
    // use: local player green, opponent the checkers brand amber.
    const checkersColors = {
      [checkersLocalPlayerId]: 'var(--green-text)',
      [opponentId]: '#b45309',
    }
    return (
      <CheckersTable
        code={checkersCode}
        localPlayerId={checkersLocalPlayerId}
        names={checkersView.names}
        colors={checkersColors}
        connection={checkersConnection}
        notice={error}
        publicState={checkersView.publicState}
        onMove={(from, to) => checkersDispatch({ type: 'MOVE', from, to })}
        onOpenRules={() => {}}
        onLeave={resetToEntry}
      />
    )
  }

  // ---- Mexican Train session active ----
  // Mexican Train lobby — 2 to 8 seats. Host sees seats from state; guests
  // see the lobby view the host broadcasts (buttons hidden either way).
  if (mtRole && !mtStarted) {
    const roster = mtRole === 'host'
      ? mtSeats.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === mtLocalPlayerId }))
      : (mtView?.kind === 'lobby' ? mtView.roster : [])
    return (
      <MexicanTrainRoom
        code={mtCode}
        localName={name}
        isHost={mtRole === 'host'}
        seats={roster}
        notice={mtNotice ?? error}
        onAddHouseBot={addMTHouseBot}
        onStartGame={mtStart}
        onLeave={resetToEntry}
      />
    )
  }

  // Mexican Train match results
  if (mtView?.kind === 'game' && mtView.publicState.stage === 'over' && mtView.publicState.matchWinnerId) {
    const mtColors = Object.fromEntries(mtView.publicState.seatOrder.map((id, i) => [id, MT_SEAT_INKS[i]]))
    return (
      <MexicanTrainResults
        localPlayerId={mtLocalPlayerId ?? ''}
        localName={name}
        names={mtView.names}
        colors={mtColors}
        publicState={mtView.publicState}
        isHost={mtRole === 'host'}
        notice={mtNotice ?? error}
        onRematch={mtRematch}
        onBackToShelf={resetToEntry}
      />
    )
  }

  // Mexican Train table (active game). Host-only: a "replace with a bot"
  // banner above the table for every guest seat that disconnected mid-match.
  if (mtView?.kind === 'game' && mtLocalPlayerId) {
    const mtColors = Object.fromEntries(mtView.publicState.seatOrder.map((id, i) => [id, MT_SEAT_INKS[i]]))
    return (
      <>
        {mtRole === 'host' && mtDropped.length > 0 && (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            justifyContent: 'center',
            alignItems: 'center',
            textAlign: 'center',
            background: 'var(--coral)',
            color: '#fff',
            fontWeight: 700,
            fontSize: 'clamp(14px, 1.8vw, 17px)',
            padding: '10px 22px',
            borderRadius: 999,
            border: '3px solid var(--ink)',
            boxShadow: '0 5px 0 var(--ink)',
            marginBottom: 'clamp(10px, 2vw, 18px)',
          }}>
            {mtDropped.map((pid) => (
              <button
                key={pid}
                type="button"
                className="btn pill-small"
                style={{ background: '#fff', color: 'var(--coral)' }}
                onClick={() => mtReplaceWithBot(pid)}
              >
                Replace {mtView.names[pid] ?? pid} with a bot
              </button>
            ))}
          </div>
        )}
        <MexicanTrainTable
          code={mtCode}
          localPlayerId={mtLocalPlayerId}
          names={mtView.names}
          colors={mtColors}
          connection={mtConnection}
          notice={mtNotice ?? error}
          publicState={mtView.publicState}
          hand={mtView.hand}
          onPlayTile={(tileId, lane) => mtDispatch({ type: 'PLAY_TILE', tileId, lane })}
          onDraw={() => mtDispatch({ type: 'DRAW_TILE' })}
          onLeave={resetToEntry}
        />
      </>
    )
  }

  // ---- Chess session active ----
  // Chess waiting screen (host waiting for opponent) — mirrors the shared Room.tsx /
  // RummyRoom.tsx / Phase10Room.tsx / BattleshipRoom.tsx layout so the start flow
  // doesn't feel like a different app.
  if (chessRole === 'host' && chessWaiting) {
    return (
      <ChessRoom
        code={chessCode}
        localName={name}
        notice={error}
        difficulty={chessDifficulty}
        onSetDifficulty={(d) => { setChessDifficulty(d); chessDifficultyRef.current = d }}
        onAddHouseBot={addChessHouseBot}
        onLeave={resetToEntry}
      />
    )
  }

  // Chess match results
  if (chessView && chessView.publicState.stage === 'over' && chessView.publicState.outcome) {
    return (
      <ChessResults
        localPlayerId={chessLocalPlayerId ?? ''}
        localName={name}
        opponentName={chessOpponentName}
        publicState={chessView.publicState}
        isHost={chessRole === 'host'}
        notice={error}
        onRematch={chessRematch}
        onBackToShelf={resetToEntry}
      />
    )
  }

  // Chess table (active match). Board is public — nothing to hide per player.
  if (chessView && chessLocalPlayerId) {
    const opponentId = chessView.publicState.seatOrder.find((id) => id !== chessLocalPlayerId) ?? ''
    // Seat colors, same two-color assignment the other 2-player engine games
    // use: local player green, opponent the chess brand cyan (matches what
    // ChessResults already assumes internally).
    const chessColors = {
      [chessLocalPlayerId]: 'var(--green-text)',
      [opponentId]: '#0891b2',
    }
    const chessNames = {
      [chessLocalPlayerId]: name,
      [opponentId]: chessOpponentName,
    }
    return (
      <ChessTable
        code={chessCode}
        localPlayerId={chessLocalPlayerId}
        names={chessNames}
        colors={chessColors}
        connection={chessConnection}
        notice={error}
        publicState={chessView.publicState}
        onMove={(from, to, promotion) => chessDispatch({ type: 'MOVE', from, to, ...(promotion !== undefined ? { promotion } : {}) })}
        onResign={() => chessDispatch({ type: 'RESIGN' })}
        onOfferDraw={() => chessDispatch({ type: 'OFFER_DRAW' })}
        onAcceptDraw={() => chessDispatch({ type: 'ACCEPT_DRAW' })}
        onDeclineDraw={() => chessDispatch({ type: 'DECLINE_DRAW' })}
        onOpenRules={() => {}}
        onLeave={resetToEntry}
      />
    )
  }

  // ---- Uno session active ----
  // Uno lobby — 2 to 10 seats. Host sees seats from state; guests see the
  // lobby view the host broadcasts (buttons hidden either way). House rules
  // and bot difficulty ride along in the lobby view for read-only guest UI.
  if (unoRole && !unoStarted) {
    const roster = unoRole === 'host'
      ? unoSeats.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === unoLocalPlayerId }))
      : (unoView?.kind === 'lobby' ? unoView.roster : [])
    const viewHouseRules = unoRole === 'host'
      ? unoHouseRules
      : (unoView?.kind === 'lobby' ? unoView.houseRules : resolveHouseRules())
    const viewDifficulty = unoRole === 'host'
      ? unoDifficulty
      : (unoView?.kind === 'lobby' ? unoView.difficulty : 'medium')
    const unoViewCardBack = unoRole === 'host'
      ? rummyCardBack
      : (unoView?.kind === 'lobby' ? unoView.cardBack : DEFAULT_CARD_BACK)
    return (
      <UnoRoom
        code={unoCode}
        localName={name}
        isHost={unoRole === 'host'}
        seats={roster}
        notice={unoNotice ?? error}
        houseRules={viewHouseRules}
        difficulty={viewDifficulty}
        cardBack={unoViewCardBack}
        onSelectCardBack={unoSetCardBack}
        onAddHouseBot={addUnoHouseBot}
        onToggleHouseRule={unoToggleHouseRule}
        onSetDifficulty={unoSetDifficulty}
        onStartGame={unoStart}
        onLeave={resetToEntry}
      />
    )
  }

  // Uno match results
  if (unoView?.kind === 'game' && unoView.publicState.stage === 'over' && unoView.publicState.matchWinnerId) {
    const unoColors = Object.fromEntries(unoView.publicState.seatOrder.map((id, i) => [id, UNO_SEAT_INKS[i]]))
    return (
      <UnoResults
        localPlayerId={unoLocalPlayerId ?? ''}
        localName={name}
        names={unoView.names}
        colors={unoColors}
        publicState={unoView.publicState}
        isHost={unoRole === 'host'}
        notice={unoNotice ?? error}
        onRematch={unoRematch}
        onBackToShelf={resetToEntry}
      />
    )
  }

  // Uno table (active game). Host-only: a "replace with a bot" banner above
  // the table for every guest seat that disconnected mid-match.
  if (unoView?.kind === 'game' && unoLocalPlayerId) {
    const unoColors = Object.fromEntries(unoView.publicState.seatOrder.map((id, i) => [id, UNO_SEAT_INKS[i]]))
    return (
      <>
        {unoRole === 'host' && unoDropped.length > 0 && (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            justifyContent: 'center',
            alignItems: 'center',
            textAlign: 'center',
            background: 'var(--coral)',
            color: '#fff',
            fontWeight: 700,
            fontSize: 'clamp(14px, 1.8vw, 17px)',
            padding: '10px 22px',
            borderRadius: 999,
            border: '3px solid var(--ink)',
            boxShadow: '0 5px 0 var(--ink)',
            marginBottom: 'clamp(10px, 2vw, 18px)',
          }}>
            {unoDropped.map((pid) => (
              <button
                key={pid}
                type="button"
                className="btn pill-small"
                style={{ background: '#fff', color: 'var(--coral)' }}
                onClick={() => unoReplaceWithBot(pid)}
              >
                Replace {unoView.names[pid] ?? pid} with a bot
              </button>
            ))}
          </div>
        )}
        {/* Spec 46: UnoTable's new sevenZero prop requires the onChooseSwapTarget wiring below, so App.tsx was touched despite not being on spec's ownership list */}
        <UnoTable
          code={unoCode}
          localPlayerId={unoLocalPlayerId}
          names={unoView.names}
          colors={unoColors}
          connection={unoConnection}
          notice={unoNotice ?? error}
          publicState={unoView.publicState}
          hand={unoView.hand}
          onPlayCard={(cardId) => unoDispatch({ type: 'PLAY_CARD', cardId })}
          onChooseColor={(color) => unoDispatch({ type: 'CHOOSE_COLOR', color })}
          onChooseSwapTarget={(targetPlayerId) => unoDispatch({ type: 'CHOOSE_SWAP_TARGET', targetPlayerId })}
          onDraw={() => unoDispatch({ type: 'DRAW_CARD' })}
          onPass={() => unoDispatch({ type: 'PASS' })}
          onCallUno={(targetPlayerId) => unoDispatch({ type: 'CALL_UNO', targetPlayerId })}
          onStartNextRound={() => unoDispatch({ type: 'START_NEXT_ROUND' })}
          onOpenRules={() => {}}
          onLeave={resetToEntry}
        />
      </>
    )
  }

  // ---- Skip-Bo session active ----
  // Skip-Bo lobby — 2 to 4 seats. Host sees seats from state; guests see the
  // lobby view the host broadcasts (buttons hidden either way).
  if (skipBoRole && !skipBoStarted) {
    const roster = skipBoRole === 'host'
      ? skipBoSeats.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === skipBoLocalPlayerId }))
      : (skipBoView?.kind === 'lobby' ? skipBoView.roster : [])
    const skipBoViewCardBack = skipBoRole === 'host'
      ? rummyCardBack
      : (skipBoView?.kind === 'lobby' ? skipBoView.cardBack : DEFAULT_CARD_BACK)
    return (
      <SkipBoRoom
        code={skipBoCode}
        localName={name}
        isHost={skipBoRole === 'host'}
        seats={roster}
        notice={skipBoNotice ?? error}
        cardBack={skipBoViewCardBack}
        onSelectCardBack={skipBoSetCardBack}
        onAddHouseBot={addSkipBoHouseBot}
        onStartGame={skipBoStart}
        onLeave={resetToEntry}
      />
    )
  }

  // Skip-Bo results — single round; a stockpile hitting 0 wins immediately
  // (possibly mid-turn), so roundOver + winnerId is the game-over signal.
  if (skipBoView?.kind === 'game' && skipBoView.publicState.roundOver && skipBoView.publicState.winnerId) {
    const skipBoColors = Object.fromEntries(skipBoView.publicState.seatOrder.map((id, i) => [id, SKIPBO_SEAT_INKS[i]]))
    return (
      <SkipBoResults
        localPlayerId={skipBoLocalPlayerId ?? ''}
        localName={name}
        names={skipBoView.names}
        colors={skipBoColors}
        publicState={skipBoView.publicState}
        isHost={skipBoRole === 'host'}
        notice={skipBoNotice ?? error}
        onRematch={skipBoRematch}
        onBackToShelf={resetToEntry}
      />
    )
  }

  // Skip-Bo table (active game)
  if (skipBoView?.kind === 'game' && skipBoLocalPlayerId) {
    const skipBoColors = Object.fromEntries(skipBoView.publicState.seatOrder.map((id, i) => [id, SKIPBO_SEAT_INKS[i]]))
    return (
      <SkipBoTable
        code={skipBoCode}
        localPlayerId={skipBoLocalPlayerId}
        localName={name}
        names={skipBoView.names}
        colors={skipBoColors}
        connection={skipBoConnection}
        notice={skipBoNotice ?? error}
        publicState={skipBoView.publicState}
        hand={skipBoView.hand}
        onPlayStock={(buildPileIndex) => skipBoDispatch({ type: 'PLAY_STOCK', buildPileIndex })}
        onPlayHand={(cardId, buildPileIndex) => skipBoDispatch({ type: 'PLAY_HAND', cardId, buildPileIndex })}
        onPlayDiscard={(pileIndex, buildPileIndex) => skipBoDispatch({ type: 'PLAY_DISCARD', pileIndex, buildPileIndex })}
        onDiscard={(cardId, pileIndex) => skipBoDispatch({ type: 'DISCARD', cardId, pileIndex })}
        onPass={() => skipBoDispatch({ type: 'PASS' })}
        onLeave={resetToEntry}
      />
    )
  }

  // ---- Solitaire session active ----
  if (solitaireOpen && solitaireHistory.length === 0) {
    return (
      <SolitaireRoom
        localName={name}
        cardBack={rummyCardBack}
        onSelectCardBack={setCardBackPreference}
        mode={solitaireMode}
        onSelectMode={setSolitaireMode}
        onStart={solitaireDeal}
        onLeave={resetToEntry}
      />
    )
  }
  if (solitaireOpen) {
    const current = solitaireHistory[solitaireHistory.length - 1]
    if (current.won) {
      return (
        <SolitaireResults
          mode={current.mode}
          moves={current.moves}
          onDealAgain={solitaireDeal}
          onBackToShelf={resetToEntry}
        />
      )
    }
    return (
      <SolitaireTable
        localName={name}
        state={current}
        cardBack={rummyCardBack}
        dealId={solitaireDealId}
        canUndo={solitaireHistory.length > 1}
        onMove={solitaireApply}
        onUndo={solitaireUndo}
        onDealAgain={solitaireDeal}
        onLeave={resetToEntry}
      />
    )
  }

  // Scrabble lobby
  if (scrabbleRole && !scrabbleStarted) {
    const roster = scrabbleRole === 'host'
      ? scrabbleSeats.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === scrabbleLocalPlayerId }))
      : (scrabbleView?.kind === 'lobby' ? scrabbleView.roster : [])
    return (
      <ScrabbleRoom
        code={scrabbleCode}
        localName={name}
        isHost={scrabbleRole === 'host'}
        seats={roster}
        notice={scrabbleNotice ?? error}
        difficulty={scrabbleDifficulty}
        onAddHouseBot={addScrabbleHouseBot}
        onSetDifficulty={scrabbleSetDifficulty}
        onStartGame={scrabbleStart}
        onLeave={resetToEntry}
      />
    )
  }

  // Scrabble results
  if (scrabbleView?.kind === 'game' && scrabbleView.publicState.stage === 'over') {
    const scrabbleOpponentNames = Object.fromEntries(
      scrabbleView.publicState.turn.playerOrder
        .filter((id) => id !== scrabbleLocalPlayerId)
        .map((id) => [id, scrabbleView.names[id] ?? id])
    )
    return (
      <ScrabbleResults
        localPlayerId={scrabbleLocalPlayerId ?? ''}
        localName={name}
        publicState={scrabbleView.publicState}
        opponentNames={scrabbleOpponentNames}
        isHost={scrabbleRole === 'host'}
        notice={scrabbleNotice ?? error}
        onRematch={scrabbleRematch}
        onBackToShelf={resetToEntry}
      />
    )
  }

  // Scrabble table (active game)
  if (scrabbleView?.kind === 'game' && scrabbleView.publicState.stage === 'play' && scrabbleLocalPlayerId) {
    const scrabbleColors = Object.fromEntries(scrabbleView.publicState.turn.playerOrder.map((id, i) => [id, SCRABBLE_SEAT_INKS[i]]))
    const scrabbleOpponentNames = Object.fromEntries(
      scrabbleView.publicState.turn.playerOrder
        .filter((id) => id !== scrabbleLocalPlayerId)
        .map((id) => [id, scrabbleView.names[id] ?? id])
    )
    return (
      <ScrabbleTable
        code={scrabbleCode}
        localPlayerId={scrabbleLocalPlayerId}
        localName={name}
        publicState={scrabbleView.publicState}
        myRack={scrabbleView.rack}
        connection={scrabbleConnection}
        notice={scrabbleNotice ?? error}
        opponentNames={scrabbleOpponentNames}
        opponentColors={scrabbleColors}
        onPlaceWord={(tiles) => scrabbleDispatch({ type: 'PLACE_WORD', tiles })}
        onExchange={(tileIds) => scrabbleDispatch({ type: 'EXCHANGE_TILES', tileIds })}
        onPass={() => scrabbleDispatch({ type: 'PASS' })}
        onChallenge={() => scrabbleDispatch({ type: 'CHALLENGE' })}
        onLeave={resetToEntry}
      />
    )
  }

  // Fallback (shouldn't normally be reached)
  return null
}
