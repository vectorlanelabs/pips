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
import { createRummyGame, RUMMY_MAX_SEATS, RUMMY_MIN_SEATS, RUMMY_HAND_SIZE, isRummyAction, type RummySession, type RummyPublicState, type RummyAction } from './card-games/rummy/state'
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
import { createPhase10Game, PHASE10_MAX_SEATS, PHASE10_MIN_SEATS, PHASE10_HAND_SIZE, type Phase10Session, type Phase10PublicState, type Phase10PrivateState, type Phase10Action } from './card-games/phase10/state'
import { applyPhase10Action, runPhase10BotTurn } from './card-games/phase10/rules'
import { phase10BotStrategy, selectDiscard } from './card-games/phase10/bot'
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
import { createDominoesGame, DOMINOES_MIN_SEATS, DOMINOES_MAX_SEATS, type DominoesSession, type DominoesPublicState, type DominoesPrivateState, type DominoesAction, type DominoTile, type DominoArm } from './board-games/dominoes/state'
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
import { createUnoGame, isUnoAction, resolveHouseRules, UNO_HAND_SIZE, UNO_MAX_SEATS, UNO_MIN_SEATS, type UnoAction, type UnoHouseRuleKey, type UnoPublicState, type UnoSession } from './card-games/uno/state'
import { applyUnoAction, runUnoBotTurn } from './card-games/uno/rules'
import { unoBotStrategy } from './card-games/uno/bot'
import type { UnoCard } from './card-games/uno/deck'
import { estimateDealIntroMs } from './components/DealIntro'
import { UnoTable } from './screens/UnoTable'
import { UnoResults } from './screens/UnoResults'
import { UnoRoom } from './screens/UnoRoom'

// ---- Skip-Bo (separate parallel session, per CHARTER.md resolution #7) ----
import { createSkipBoGame, SKIPBO_MAX_SEATS, SKIPBO_MIN_SEATS, isSkipBoAction, type SkipBoAction, type SkipBoPublicState, type SkipBoSession } from './card-games/skipbo/state'
import { applySkipBoAction, runSkipBoBotTurn } from './card-games/skipbo/rules'
import { skipBoBotStrategy } from './card-games/skipbo/bot'
import { SkipBoTable } from './screens/SkipBoTable'
import { SkipBoResults } from './screens/SkipBoResults'
import { SkipBoRoom } from './screens/SkipBoRoom'

// ---- Blackjack (separate parallel session, per CHARTER.md resolution #7) ----
import { createBlackjackGame, BLACKJACK_MAX_SEATS, BLACKJACK_MIN_SEATS, type BlackjackSession, type BlackjackPublicState, type BlackjackAction } from './card-games/blackjack/state'
import { applyBlackjackAction, runBlackjackBotTurn } from './card-games/blackjack/rules'
import { blackjackBotStrategy } from './card-games/blackjack/bot'
import { BlackjackTable } from './screens/BlackjackTable'
import { BlackjackRoom } from './screens/BlackjackRoom'

// ---- Texas Hold'em (separate parallel session, per CHARTER.md resolution #7) ----
import { createHoldemGame, HOLDEM_MAX_SEATS, HOLDEM_MIN_SEATS, type HoldemSession, type HoldemPublicState, type HoldemPrivateState, type HoldemAction } from './card-games/holdem/state'
import { applyHoldemAction, runHoldemBotTurn } from './card-games/holdem/rules'
import { holdemBotStrategy } from './card-games/holdem/bot'
import { HoldemTable } from './screens/HoldemTable'
import { HoldemRoom } from './screens/HoldemRoom'

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
  // Sent one-off, out of band from the revision-gated 'game' snapshots, whenever this guest's own
  // action is rejected — carries the validator's reason so the table can show WHY nothing happened
  // instead of the action just silently doing nothing. Never stored as the guest's current view.
  | { kind: 'notice'; message: string }
type Phase10View =
  | { kind: 'lobby'; roster: { name: string; isBot: boolean; isHost: boolean }[]; cardBack: string }
  | { kind: 'game'; revision: number; publicState: Phase10PublicState; privateState: Phase10PrivateState; names: Record<string, string> }
  // Sent one-off, out of band from the revision-gated 'game' snapshots, whenever this guest's own
  // action is rejected — carries the validator's reason so the table can show WHY nothing happened
  // instead of the action just silently doing nothing. Never stored as the guest's current view.
  | { kind: 'notice'; message: string }
type BattleshipView =
  | { kind: 'game'; revision: number; publicState: BattleshipPublicState; privateState: BattleshipPrivateState; opponentName: string }
  // Sent one-off, out of band from the revision-gated 'game' snapshots, whenever this guest's own
  // action is rejected — carries the validator's reason so the table can show WHY nothing happened
  // instead of the action just silently doing nothing. Never stored as the guest's current view.
  | { kind: 'notice'; message: string }
type DominoesView =
  | { kind: 'lobby'; roster: { name: string; isBot: boolean; isHost: boolean }[] }
  | { kind: 'game'; revision: number; publicState: DominoesPublicState; privateState: DominoesPrivateState; names: Record<string, string> }
  // Sent one-off, out of band from the revision-gated 'game' snapshots, whenever this guest's own
  // action is rejected — carries the validator's reason so the table can show WHY nothing happened
  // instead of the action just silently doing nothing. Never stored as the guest's current view.
  | { kind: 'notice'; message: string }
type WahooView =
  | { kind: 'lobby'; roster: { name: string; isBot: boolean; isHost: boolean }[] }
  | { kind: 'game'; revision: number; publicState: WahooPublicState; names: Record<string, string> }
  // Sent one-off, out of band from the revision-gated 'game' snapshots, whenever this guest's own
  // action is rejected — carries the validator's reason so the table can show WHY nothing happened
  // instead of the action just silently doing nothing. Never stored as the guest's current view.
  | { kind: 'notice'; message: string }
type CheckersView =
  | { kind: 'lobby'; roster: { name: string; isBot: boolean; isHost: boolean }[] }
  | { kind: 'game'; revision: number; publicState: CheckersPublicState; names: Record<string, string> }
  // Sent one-off, out of band from the revision-gated 'game' snapshots, whenever this guest's own
  // action is rejected — carries the validator's reason so the table can show WHY nothing happened
  // instead of the action just silently doing nothing. Never stored as the guest's current view.
  | { kind: 'notice'; message: string }
type MTView =
  | { kind: 'lobby'; roster: { name: string; isBot: boolean; isHost: boolean }[] }
  | { kind: 'game'; revision: number; publicState: MTPublicState; hand: MTTile[]; names: Record<string, string> }
  // Sent one-off, out of band from the revision-gated 'game' snapshots, whenever this guest's own
  // action is rejected — carries the validator's reason so the table can show WHY nothing happened
  // instead of the action just silently doing nothing. Never stored as the guest's current view.
  | { kind: 'notice'; message: string }
type ChessView =
  | { kind: 'game'; revision: number; publicState: ChessPublicState; opponentName: string }
  // Sent one-off, out of band from the revision-gated 'game' snapshots, whenever this guest's own
  // action is rejected — carries the validator's reason so the table can show WHY nothing happened
  // instead of the action just silently doing nothing. Never stored as the guest's current view.
  | { kind: 'notice'; message: string }
type UnoView =
  | { kind: 'lobby'; roster: { name: string; isBot: boolean; isHost: boolean }[]; houseRules: Record<UnoHouseRuleKey, boolean>; difficulty: BotDifficulty; cardBack: string }
  | { kind: 'game'; revision: number; publicState: UnoPublicState; hand: UnoCard[]; names: Record<string, string> }
  // Sent one-off, out of band from the revision-gated 'game' snapshots, whenever this guest's own
  // action is rejected — carries the validator's reason so the table can show WHY nothing happened
  // instead of the action just silently doing nothing. Never stored as the guest's current view.
  | { kind: 'notice'; message: string }
type SkipBoView =
  | { kind: 'lobby'; roster: { name: string; isBot: boolean; isHost: boolean }[]; cardBack: string }
  | { kind: 'game'; revision: number; publicState: SkipBoPublicState; hand: Card[]; names: Record<string, string> }
  // Sent one-off, out of band from the revision-gated 'game' snapshots, whenever this guest's own
  // action is rejected — carries the validator's reason so the table can show WHY nothing happened
  // instead of the action just silently doing nothing. Never stored as the guest's current view.
  | { kind: 'notice'; message: string }
type BlackjackView =
  | { kind: 'lobby'; roster: { name: string; isBot: boolean; isHost: boolean }[]; cardBack: string }
  | { kind: 'game'; revision: number; publicState: BlackjackPublicState; names: Record<string, string> }
type HoldemView =
  | { kind: 'lobby'; roster: { name: string; isBot: boolean; isHost: boolean }[]; cardBack: string }
  | { kind: 'game'; revision: number; publicState: HoldemPublicState; privateState: HoldemPrivateState; names: Record<string, string> }
type ScrabbleView =
  | { kind: 'lobby'; roster: { name: string; isBot: boolean; isHost: boolean }[]; difficulty: BotDifficulty }
  | { kind: 'game'; revision: number; publicState: ScrabblePublicState; rack: ScrabbleTile[]; names: Record<string, string> }

const BASE_MS = 900
const ROUND_PAUSE_MS = 4000
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
// each a state-changing animation and sound a human watches land. The bot loop
// waits before EVERY individual action — not once per turn — but bare BASE_MS
// (900ms) is still too fast: at a full 4-seat table, up to 3 bots' worth of
// these chained plays can land back-to-back between a human's own turns,
// blurring into the "fast forward" CLAUDE.md warns against (same shape as
// Rummy's draw/meld/discard chain — reuses its measured card-game-scale pace
// rather than the generic board-game BASE_MS).
// Exported so a regression test can pin it against BASE_MS without mounting the app.
export const SKIPBO_ACTION_MS = 1600
// Same rationale as UNO_DEAL_HOLD_BUFFER_MS: slack for network latency and per-client
// render/paint time on top of estimateDealIntroMs's pure animation estimate.
const SKIPBO_DEAL_HOLD_BUFFER_MS = 700

// Pure so a regression test can pin the round-start bot hold against the actual 5-card starting
// hand deal without mounting the app. Skip-Bo always deals exactly 5 hand cards per seat (unlike
// Dominoes' variable per-round hand size), so this takes seat count directly rather than a
// handCounts record. Stockpiles are never part of DealIntro's flight count (see SkipBoTable's
// `maxFlights`), only the 5-card starting hands are.
export function skipBoDealHoldMs(seatCount: number): number {
  return estimateDealIntroMs(seatCount * 5) + SKIPBO_DEAL_HOLD_BUFFER_MS
}
// Rummy: same "fast forward" problem as Uno — a turn is draw, then optional meld/lay-off(s),
// then discard, each its own broadcast state change with its own card sound. A full 4-seat
// table means up to 3 bots' worth of these actions can land between a human's own turns, so
// this reuses Uno's measured card-game-scale pace rather than bare BASE_MS (900ms would blur
// them together — see CLAUDE.md's "never reuse a shared pacing constant" rule).
const RUMMY_ACTION_MS = 1600
// Same rationale as UNO_DEAL_HOLD_BUFFER_MS: slack for network latency and per-client
// render/paint time on top of estimateDealIntroMs's pure animation estimate.
const RUMMY_DEAL_HOLD_BUFFER_MS = 700
// Phase 10: same turn shape as Rummy (draw, then optional lay-phase/hit(s), then discard),
// each its own broadcast state change with its own card sound — reuses Rummy's measured
// card-game-scale pace for the identical reason, not as a blind default (see CLAUDE.md's
// "never reuse a shared pacing constant" rule). At a full 6-seat table this still leaves a
// human able to follow up to 5 consecutive bot turns between their own.
const PHASE10_ACTION_MS = 1600
// Same rationale as UNO_DEAL_HOLD_BUFFER_MS: slack for network latency and per-client
// render/paint time on top of estimateDealIntroMs's pure animation estimate.
const PHASE10_DEAL_HOLD_BUFFER_MS = 700
// Wahoo: reused bare BASE_MS (900ms) + a 450ms pass/bust-only buffer, which cuts off the game's
// own sounds — measured dice-roll runs 1.392s and piece-drop runs 1.032s, both longer than a
// bare 900ms gap between actions. WAHOO_ACTION_MS covers every ordinary action (roll or move)
// with headroom over the longer of the two. A full 4-seat table means up to 3 bots' worth of
// these can land between a human's own turns (CLAUDE.md: judge pacing at a maxed-out table).
const WAHOO_ACTION_MS = 1600
// farkle-bust (the triple-six sound) runs 2.904s — far longer than any ordinary action's sound
// and than the old 450ms buffer. WAHOO_ACTION_MS alone (1600ms) would still cut it off, so a
// bust gets extra hold on top so the total gap before the next bot action is comfortably past
// the full cue (1600 + 1600 = 3200ms > 2904ms, with margin for network/render latency).
const WAHOO_BUST_EXTRA_MS = 1600
const MT_ACTION_MS = 1100
// Same rationale as DOMINOES_DEAL_HOLD_BUFFER_MS: slack for network latency and per-client
// render/paint time on top of estimateDealIntroMs's pure animation estimate.
const MT_DEAL_HOLD_BUFFER_MS = 700

// Pure so a regression test can pin the round-start bot hold against the actual dealt-tile total
// (32-72 tiles across 2-8 seats) without mounting the app. `handCounts` is the fresh-round
// MTPublicState field — every seat's hand size sums to the total DealIntro flight count (see
// MexicanTrainTable's `maxFlights={hand.length + others total}`).
export function mtDealHoldMs(handCounts: Record<string, number>): number {
  const totalFlights = Object.values(handCounts).reduce((a, b) => a + b, 0)
  return estimateDealIntroMs(totalFlights) + MT_DEAL_HOLD_BUFFER_MS
}
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
// Whether the SAME bot will fire again on the loop's next iteration, and if so, how long to hold
// first so this shot's sound has time to finish. In 'free' mode extraTurn always runs and
// currentPlayer never changes — the bot keeps firing regardless of who "currentPlayer" nominally
// is — so gating on currentPlayer alone (as this used to) left free mode with NO hold at all after
// the first shot. Gate on the same continuation condition the bot loop itself uses (variant ===
// 'free', or currentPlayer === botId for a streak hit/sink), not the vestigial turn pointer.
// Exported so a regression test can pin this against a real free-mode hit/sink trace without
// mounting the app or the bot loop's own timers.
export function battleshipShotHoldMs(ps: BattleshipPublicState, botId: string): number {
  if (ps.stage !== 'battle') return 0
  const botFiresAgain = ps.variant === 'free' || currentPlayer(ps.turn) === botId
  if (!botFiresAgain) return 0
  return SHOT_SOUND_BUFFER_MS[ps.lastShot?.result ?? 'miss']
}
// Blackjack: bets are already placed and the round is already dealt in
// public state the instant betting closes, so nothing gates the bots'
// first hit/stand decision except this hold -- without it a bot could act
// mid-way through a human's local DealIntro reveal.
const BLACKJACK_DEAL_HOLD_BUFFER_MS = 700
// Hold'em: same DealIntro race as Blackjack, plus this table also stages a
// paced "small blind posts / big blind posts" reveal (see HoldemTable's
// HOLDEM_BLIND_STAGE_MS) before the deal intro even starts, so the hold
// must cover both stages, not just the deal.
const HOLDEM_BLIND_STAGE_MS = 900 * 2
const HOLDEM_DEAL_HOLD_BUFFER_MS = 700
// Scrabble: when a bot is about to act on a still-challengeable placement it
// didn't make (either to challenge it or, if it declines, to immediately play
// its own word over it), a human elsewhere at the table needs real time to
// read what happened and hit Challenge before the placement is gone. BASE_MS
// (900ms) is sized for routine turn pacing, not for "notice a word appeared,
// decide if it's real, and click a button" — this is closer to the other
// games' read-and-react windows (YAHTZEE_ACTION_MS, MT_HORN_BUFFER_MS).
const SCRABBLE_CHALLENGE_WINDOW_MS = 2500
// Dominoes: bare BASE_MS (900ms) is shorter than the domino-play/domino-draw cues themselves
// (measured ~1.032s), so back-to-back bot actions clip their own sound. Fixed two-player table,
// so this doesn't compound across seats the way N-player games do, but the cue still needs to
// finish before the next action lands.
// Exported (unlike its sibling pacing constants) so a regression test can pin it against the
// measured domino-play/domino-draw sound duration without mounting the app.
export const DOMINOES_ACTION_MS = 1300
// Same rationale as UNO_DEAL_HOLD_BUFFER_MS: slack for network latency and per-client
// render/paint time on top of estimateDealIntroMs's pure animation estimate.
const DOMINOES_DEAL_HOLD_BUFFER_MS = 700

// Pure so a regression test can pin the round-start bot hold against the actual double-six
// deal without mounting the app. `handCounts` is the fresh-round DominoesPublicState field —
// every seated player's hand size (5 or 7 tiles, depending on seat count) sums to the total
// DealIntro flight count (see DominoesTable's `maxFlights`, which sums the same way).
export function dominoesDealHoldMs(handCounts: Record<string, number>): number {
  const totalFlights = Object.values(handCounts).reduce((a, b) => a + b, 0)
  return estimateDealIntroMs(totalFlights) + DOMINOES_DEAL_HOLD_BUFFER_MS
}
// Checkers: bare BASE_MS (900ms) is shorter than the game's own move sound (measured 1.032s) and
// far shorter than its crown cue (measured 2.040s, king-me played together with checker-move on a
// crowning move) — the next bot action could start while the prior move's sound was still playing.
// Fixed two-player table, no deal intro, so this doesn't compound across seats the way N-player
// games do, but every move (ordinary, jump, or crown) is still a visible board change a human is
// watching, per CLAUDE.md's pacing rule.
// Exported so a regression test can pin it against the measured move/jump sound durations without
// mounting the app.
export const CHECKERS_ACTION_MS = 1300
// A crowning move plays checker-move (or checker-jump) AND king-me together — the combined cue
// runs the full 2.040s king-me duration, well past what CHECKERS_ACTION_MS alone covers. This
// extra hold is paid only after a move that actually crowned, on top of the next loop iteration's
// own CHECKERS_ACTION_MS wait, so a crown's total gap (1300 + 1000 = 2300ms) comfortably clears
// the measured 2.040s cue with margin for render/audio-engine latency — same shape as Wahoo's
// WAHOO_BUST_EXTRA_MS for its own longer-than-usual cue.
export const CHECKERS_CROWN_EXTRA_MS = 1000
// Chess is strictly 2 seats (max 1 bot) and turns strictly alternate, so back-to-back bot
// actions never happen — the bot only ever moves once per human turn. But bare BASE_MS (900ms)
// is shorter than the game's own ordinary move sound (piece-drop, measured 1.000s): the wait
// before the bot's move is a "thinking time" beat measured from whatever move just handed it the
// turn (the human's own move), so a too-short wait can let the bot's own move-sound fire while
// that prior move's cue is still playing. Exported so a regression test can pin it against the
// measured sound durations without mounting the app.
export const CHESS_ACTION_MS = 1100
// A promotion (the human's move that just handed the bot its turn) plays king-me (measured
// 2.000s) — far longer than CHESS_ACTION_MS alone covers. Hold extra, paid before the bot's own
// move fires, so that cue finishes first — same shape as Checkers' CHECKERS_CROWN_EXTRA_MS,
// just paid before rather than after since Chess never has a second bot action to protect.
export const CHESS_PROMOTION_EXTRA_MS = 1000
// Tic Tac Toe is strictly 2 seats (GAME_MAX_SEATS.ttt), so there's never more than one bot
// action landing between a human's own turns — the multi-bot "fast forward" risk other games
// guard against doesn't apply here. But drawn-x/drawn-circle (the human's own mark sound) run
// 1.463s/1.071s (measured via afinfo), longer than bare BASE_MS (900ms). A bare BASE_MS gap
// would let the bot's reply land — and, if that reply ends the round, start round-win on top —
// while the human's own mark sound is still playing. TTT_ACTION_MS gives the longer of the two
// mark sounds room to finish before the bot moves.
const TTT_ACTION_MS = 1600
// Connect 4 is strictly 2 seats (GAME_MAX_SEATS.connect4), so — like TTT — the multi-bot
// "fast forward" risk doesn't apply here. But piece-drop (the human's own drop sound) runs
// 1.032s (measured via afinfo), longer than bare BASE_MS (900ms), which would let the bot's
// reply land — and clip the drop cue's tail — before it finished. CONNECT4_ACTION_MS gives
// the drop sound room to finish before the bot moves. (A winning move plays round-win alone,
// not piece-drop-then-round-win — see Connect4Table's sound-selection effect — so no
// Checkers-style CROWN_EXTRA analog is needed here; the round-pause timer already gates the
// next screen transition.)
const CONNECT4_ACTION_MS = 1300
// Farkle reused bare BASE_MS (900ms) before every roll and a bare 0.6 factor (540ms) before
// selecting kept dice or deciding to bank/reroll, with no Farkle-specific measurement, despite
// scaling to 8 seats (GAME_MAX_SEATS.farkle) — up to 7 bots' turns can land between a human's
// own turns (CLAUDE.md: judge pacing at a maxed-out table, not one bot in isolation). Every roll
// is a visible state change on every client (useDiceAnimation's flicker isn't gated to the
// acting seat, unlike sound — see FarkleTable), so it needs real read time regardless of who's
// rolling. dice-roll/hot-dice run 1.392s/1.411s (measured via ffprobe); FARKLE_ACTION_MS clears
// the longer of the two with margin. FARKLE_DECIDE_MS covers the shorter keep-dice/bank-or-
// reroll decisions that follow a roll (analogous to the 0.6 factor other games use), which don't
// have their own sound to clear.
export const FARKLE_ACTION_MS = 1500
export const FARKLE_DECIDE_MS = 900
// Extra hold paid only before the FIRST roll of a fresh turn (never a mid-turn re-roll, which
// only ever follows a plain roll's own dice-roll/hot-dice cue) — bank-points and farkle-bust are
// heard only by the seat that banked/busted (FarkleTable gates sound on the acting player's own
// turn) but still run far longer than an ordinary roll: bank-points measures 4.032s, and
// farkle-bust measures 2.904s on top of its own 420ms flicker-settle delay (see FarkleTable's
// bustTimer). FARKLE_ACTION_MS + FARKLE_TURN_START_EXTRA_MS (1500 + 2700 = 4200ms) clears the
// longer of the two with margin, so the next seat's first roll never lands mid-cue.
export const FARKLE_TURN_START_EXTRA_MS = 2700

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
  // Despite the name, this is the ONE shared card-back preference for every card game
  // (Rummy, Solitaire, Phase10, Uno, Skip-Bo) — see setCardBackPreference below.
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
  const [battleshipNotice, setBattleshipNotice] = useState<string | null>(null)
  const [battleshipWaiting, setBattleshipWaiting] = useState(false)
  const [battleshipVariant, setBattleshipVariant] = useState<BattleshipVariant>('standard')

  // ---- Dominoes ----
  const [dominoesRole, setDominoesRole] = useState<'host' | 'guest' | null>(null)
  const [dominoesCode, setDominoesCode] = useState('')
  const [dominoesLocalPlayerId, setDominoesLocalPlayerId] = useState<string | null>(null)
  const [dominoesView, setDominoesView] = useState<DominoesView | null>(null)
  const [dominoesConnection, setDominoesConnection] = useState<'connected' | 'disconnected'>('connected')
  const [dominoesNotice, setDominoesNotice] = useState<string | null>(null)
  const [dominoesStarted, setDominoesStarted] = useState(false)
  const [dominoesSeats, setDominoesSeats] = useState<{ playerId: string; name: string; isBot: boolean }[]>([])

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
  const [checkersNotice, setCheckersNotice] = useState<string | null>(null)
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
  const [chessNotice, setChessNotice] = useState<string | null>(null)
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

  // ---- Blackjack ----
  const [blackjackRole, setBlackjackRole] = useState<'host' | 'guest' | null>(null)
  const [blackjackCode, setBlackjackCode] = useState('')
  const [blackjackLocalPlayerId, setBlackjackLocalPlayerId] = useState<string | null>(null)
  const [blackjackView, setBlackjackView] = useState<BlackjackView | null>(null)
  const [blackjackConnection, setBlackjackConnection] = useState<'connected' | 'disconnected'>('connected')
  const [blackjackNotice, setBlackjackNotice] = useState<string | null>(null)
  const [blackjackStarted, setBlackjackStarted] = useState(false)
  const [blackjackSeats, setBlackjackSeats] = useState<{ playerId: string; name: string; isBot: boolean }[]>([])

  // ---- Texas Hold'em ----
  const [holdemRole, setHoldemRole] = useState<'host' | 'guest' | null>(null)
  const [holdemCode, setHoldemCode] = useState('')
  const [holdemLocalPlayerId, setHoldemLocalPlayerId] = useState<string | null>(null)
  const [holdemView, setHoldemView] = useState<HoldemView | null>(null)
  const [holdemConnection, setHoldemConnection] = useState<'connected' | 'disconnected'>('connected')
  const [holdemNotice, setHoldemNotice] = useState<string | null>(null)
  const [holdemStarted, setHoldemStarted] = useState(false)
  const [holdemSeats, setHoldemSeats] = useState<{ playerId: string; name: string; isBot: boolean }[]>([])

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
  // Tracks the exact text scrabbleDispatch last set on a rejected action, so a
  // subsequent successful dispatch only clears ITS OWN rejection message --
  // not an unrelated notice (e.g. "X disconnected") that arrived in between.
  const scrabbleRejectionNoticeRef = useRef<string | null>(null)
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
  const rummyBotsHeldUntilRef = useRef(0)
  const rummyLastRoundRef = useRef<number | null>(null)
  const rummyRejectionNoticeRef = useRef<string | null>(null)
  const phase10SessionRef = useRef<Phase10Session | null>(null)
  const phase10HostRef = useRef<HostHandle<Phase10View> | null>(null)
  const phase10GuestRef = useRef<GuestHandle<Phase10Action> | null>(null)
  const phase10BotBusyRef = useRef(false)
  const phase10BotStuckRef = useRef(false)
  const phase10LocalPlayerIdRef = useRef<string | null>(null)
  const phase10SeatsRef = useRef<{ playerId: string; name: string; isBot: boolean }[]>([])
  const phase10StartedRef = useRef(false)
  const phase10NamesRef = useRef<Record<string, string>>({})
  const phase10BotSeatsRef = useRef<Set<string>>(new Set())
  const phase10BotCounterRef = useRef(0)
  const phase10BotsHeldUntilRef = useRef(0)
  const phase10LastRoundRef = useRef<number | null>(null)
  const phase10RejectionNoticeRef = useRef<string | null>(null)
  const battleshipSessionRef = useRef<BattleshipSession | null>(null)
  const battleshipHostRef = useRef<HostHandle<BattleshipView> | null>(null)
  const battleshipGuestRef = useRef<GuestHandle<BattleshipAction> | null>(null)
  const battleshipBotBusyRef = useRef(false)
  const battleshipLocalPlayerIdRef = useRef<string | null>(null)
  const battleshipOpponentIdRef = useRef<string | null>(null)
  const battleshipOpponentNameRef = useRef('')
  const battleshipVariantRef = useRef<BattleshipVariant>('standard')
  const battleshipRejectionNoticeRef = useRef<string | null>(null)
  const dominoesSessionRef = useRef<DominoesSession | null>(null)
  const dominoesHostRef = useRef<HostHandle<DominoesView> | null>(null)
  const dominoesGuestRef = useRef<GuestHandle<DominoesAction> | null>(null)
  const dominoesBotBusyRef = useRef(false)
  const dominoesLocalPlayerIdRef = useRef<string | null>(null)
  const dominoesSeatsRef = useRef<{ playerId: string; name: string; isBot: boolean }[]>([])
  const dominoesStartedRef = useRef(false)
  const dominoesNamesRef = useRef<Record<string, string>>({})
  const dominoesBotSeatsRef = useRef<Set<string>>(new Set())
  const dominoesBotCounterRef = useRef(0)
  const dominoesBotsHeldUntilRef = useRef(0)
  const dominoesLastRoundRef = useRef<number | null>(null)
  const dominoesRejectionNoticeRef = useRef<string | null>(null)
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
  const wahooRejectionNoticeRef = useRef<string | null>(null)
  const checkersSessionRef = useRef<CheckersSession | null>(null)
  const checkersHostRef = useRef<HostHandle<CheckersView> | null>(null)
  const checkersGuestRef = useRef<GuestHandle<CheckersAction> | null>(null)
  const checkersBotBusyRef = useRef(false)
  const checkersLocalPlayerIdRef = useRef<string | null>(null)
  const checkersSeatsRef = useRef<{ playerId: string; name: string; isBot: boolean }[]>([])
  const checkersStartedRef = useRef(false)
  const checkersNamesRef = useRef<Record<string, string>>({})
  const checkersRejectionNoticeRef = useRef<string | null>(null)
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
  const mtBotsHeldUntilRef = useRef(0)
  const mtLastRoundRef = useRef<number | null>(null)
  const mtRejectionNoticeRef = useRef<string | null>(null)
  const chessSessionRef = useRef<ChessSession | null>(null)
  const chessHostRef = useRef<HostHandle<ChessView> | null>(null)
  const chessGuestRef = useRef<GuestHandle<ChessAction> | null>(null)
  const chessRejectionNoticeRef = useRef<string | null>(null)
  const chessBotBusyRef = useRef(false)
  const chessLocalPlayerIdRef = useRef<string | null>(null)
  const chessOpponentIdRef = useRef<string | null>(null)
  const chessOpponentNameRef = useRef('')
  const chessDifficultyRef = useRef<ChessDifficulty>('easy')
  const unoSessionRef = useRef<UnoSession | null>(null)
  const unoHostRef = useRef<HostHandle<UnoView> | null>(null)
  const unoGuestRef = useRef<GuestHandle<UnoAction> | null>(null)
  const unoRejectionNoticeRef = useRef<string | null>(null)
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
  const skipBoRejectionNoticeRef = useRef<string | null>(null)
  const blackjackSessionRef = useRef<BlackjackSession | null>(null)
  const blackjackHostRef = useRef<HostHandle<BlackjackView> | null>(null)
  const blackjackGuestRef = useRef<GuestHandle<BlackjackAction> | null>(null)
  const blackjackBotBusyRef = useRef(false)
  const blackjackLocalPlayerIdRef = useRef<string | null>(null)
  const blackjackSeatsRef = useRef<{ playerId: string; name: string; isBot: boolean }[]>([])
  const blackjackStartedRef = useRef(false)
  const blackjackNamesRef = useRef<Record<string, string>>({})
  const blackjackBotSeatsRef = useRef<Set<string>>(new Set())
  const blackjackBotCounterRef = useRef(0)
  const blackjackLastPhaseRef = useRef<string | null>(null)
  const blackjackBotsHeldUntilRef = useRef(0)
  const holdemSessionRef = useRef<HoldemSession | null>(null)
  const holdemHostRef = useRef<HostHandle<HoldemView> | null>(null)
  const holdemGuestRef = useRef<GuestHandle<HoldemAction> | null>(null)
  const holdemBotBusyRef = useRef(false)
  const holdemLocalPlayerIdRef = useRef<string | null>(null)
  const holdemSeatsRef = useRef<{ playerId: string; name: string; isBot: boolean }[]>([])
  const holdemStartedRef = useRef(false)
  const holdemNamesRef = useRef<Record<string, string>>({})
  const holdemBotSeatsRef = useRef<Set<string>>(new Set())
  const holdemBotCounterRef = useRef(0)
  const holdemCardBackRef = useRef(savedCardBack())
  const holdemLastHandRef = useRef<number | null>(null)
  const holdemBotsHeldUntilRef = useRef(0)
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
    blackjackHostRef.current?.destroy()
    blackjackGuestRef.current?.destroy()
    holdemHostRef.current?.destroy()
    holdemGuestRef.current?.destroy()
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
    if (battleshipRole && battleshipView?.kind === 'game' && battleshipView.publicState.stage !== 'over') return 'battleship'
    if (dominoesRole && dominoesView?.kind === 'game' && dominoesView.publicState.stage !== 'over') return 'dominoes'
    if (wahooRole && wahooStarted && wahooView?.kind === 'game' && wahooView.publicState.stage !== 'over') return 'wahoo'
    if (checkersRole && checkersStarted && checkersView?.kind === 'game' && checkersView.publicState.stage !== 'over') return 'checkers'
    if (mtRole && mtStarted && mtView?.kind === 'game' && mtView.publicState.stage !== 'over') return 'mexican-train'
    if (chessRole && chessView?.kind === 'game' && chessView.publicState.stage !== 'over') return 'chess'
    if (unoRole && unoStarted && unoView?.kind === 'game' && unoView.publicState.stage !== 'over') return 'uno'
    if (skipBoRole && skipBoStarted && skipBoView?.kind === 'game' && !skipBoView.publicState.roundOver) return 'skipbo'
    if (blackjackRole && blackjackStarted && blackjackView?.kind === 'game') return 'blackjack'
    if (solitaireOpen && solitaireHistory.length > 0 && !solitaireHistory[solitaireHistory.length - 1].won) return 'solitaire'
    if (scrabbleRole && scrabbleStarted && scrabbleView?.kind === 'game' && scrabbleView.publicState.stage !== 'over') return 'scrabble'
    return null
  }

  useEffect(() => {
    liveGameRef.current = liveGameNow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, rummyRole, rummyStarted, rummyView, phase10Role, phase10Started, phase10View, battleshipRole, battleshipView, dominoesRole, dominoesView, wahooRole, wahooStarted, wahooView, checkersRole, checkersStarted, checkersView, mtRole, mtStarted, mtView, chessRole, chessView, unoRole, unoStarted, unoView, skipBoRole, skipBoStarted, skipBoView, blackjackRole, blackjackStarted, blackjackView, solitaireOpen, solitaireHistory, scrabbleRole, scrabbleStarted, scrabbleView])

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
      case 'blackjack': startBlackjackHost(); return
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
    rummyBotsHeldUntilRef.current = 0
    rummyLastRoundRef.current = null
    rummyRejectionNoticeRef.current = null
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
    phase10BotStuckRef.current = false
    phase10BotSeatsRef.current.clear()
    phase10BotCounterRef.current = 0
    phase10NamesRef.current = {}
    phase10BotsHeldUntilRef.current = 0
    phase10LastRoundRef.current = null
    phase10RejectionNoticeRef.current = null
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
    setBattleshipNotice(null)
    battleshipRejectionNoticeRef.current = null
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
    setDominoesView(null)
    setDominoesConnection('connected')
    setDominoesNotice(null)
    setDominoesStarted(false)
    dominoesStartedRef.current = false
    setDominoesSeats([])
    dominoesSeatsRef.current = []
    dominoesBotBusyRef.current = false
    dominoesBotSeatsRef.current.clear()
    dominoesBotCounterRef.current = 0
    dominoesNamesRef.current = {}
    dominoesBotsHeldUntilRef.current = 0
    dominoesLastRoundRef.current = null
    dominoesRejectionNoticeRef.current = null
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
    wahooRejectionNoticeRef.current = null
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
    setCheckersNotice(null)
    checkersRejectionNoticeRef.current = null
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
    mtBotsHeldUntilRef.current = 0
    mtLastRoundRef.current = null
    mtRejectionNoticeRef.current = null
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
    setChessNotice(null)
    chessRejectionNoticeRef.current = null
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
    skipBoRejectionNoticeRef.current = null
    // Blackjack
    blackjackHostRef.current?.destroy()
    blackjackHostRef.current = null
    blackjackGuestRef.current?.destroy()
    blackjackGuestRef.current = null
    blackjackSessionRef.current = null
    setBlackjackRole(null)
    setBlackjackCode('')
    setBlackjackLocalPlayerId(null)
    blackjackLocalPlayerIdRef.current = null
    setBlackjackView(null)
    setBlackjackConnection('connected')
    setBlackjackNotice(null)
    setBlackjackStarted(false)
    blackjackStartedRef.current = false
    setBlackjackSeats([])
    blackjackSeatsRef.current = []
    blackjackBotBusyRef.current = false
    blackjackBotSeatsRef.current.clear()
    blackjackBotCounterRef.current = 0
    blackjackNamesRef.current = {}
    // Card back deliberately survives a reset — it's the host's saved preference.
    // Texas Hold'em
    holdemHostRef.current?.destroy()
    holdemHostRef.current = null
    holdemGuestRef.current?.destroy()
    holdemGuestRef.current = null
    holdemSessionRef.current = null
    setHoldemRole(null)
    setHoldemCode('')
    setHoldemLocalPlayerId(null)
    holdemLocalPlayerIdRef.current = null
    setHoldemView(null)
    setHoldemConnection('connected')
    setHoldemNotice(null)
    setHoldemStarted(false)
    holdemStartedRef.current = false
    setHoldemSeats([])
    holdemSeatsRef.current = []
    holdemBotBusyRef.current = false
    holdemBotSeatsRef.current.clear()
    holdemBotCounterRef.current = 0
    holdemNamesRef.current = {}
    // Card back deliberately survives a reset — it's the host's saved preference.
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
    scrabbleRejectionNoticeRef.current = null
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
    const currentRound = session.session.publicState.roundNumber
    if (currentRound !== rummyLastRoundRef.current) {
      rummyLastRoundRef.current = currentRound
      const totalFlights = session.session.publicState.seatOrder.length * RUMMY_HAND_SIZE
      rummyBotsHeldUntilRef.current = Date.now() + estimateDealIntroMs(totalFlights) + RUMMY_DEAL_HOLD_BUFFER_MS
    }
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
          rummyHostRef.current?.reject(guestId, 'Game already in progress.')
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
        // action arrives over PeerJS as `unknown` at runtime — the TypeScript RummyAction
        // union is compile-time only, so a malformed/stale/hostile guest payload must be
        // rejected here, before it ever reaches action.type inside the validator.
        if (!isRummyAction(action)) return
        const result = applyRummyAction(session, guestId, action)
        if (!result.outcome.ok) {
          // Sent one-off (not a broadcast, not gated by revision) so this guest sees WHY
          // their action did nothing, even though canonical state didn't change.
          rummyHostRef.current?.sendTo(guestId, { kind: 'notice', message: result.outcome.reason ?? 'that move is not allowed' })
          return
        }
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
      const holdRemaining = rummyBotsHeldUntilRef.current - Date.now()
      await wait(holdRemaining > 0 ? holdRemaining : RUMMY_ACTION_MS)
      if (rummyStale(key)) return
      if (Date.now() < rummyBotsHeldUntilRef.current) continue
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
        if (view.kind === 'notice') {
          // Out-of-band rejection feedback for MY OWN last action — never touches
          // rummyView/localRevision, so it can't be mistaken for (or block) a real state update.
          rummyRejectionNoticeRef.current = view.message
          setRummyNotice(view.message)
          return
        }
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        // A fresh accepted state means my last action (if any) went through — clear a
        // rejection notice I set, but never stomp an unrelated one (e.g. a disconnect banner).
        setRummyNotice((prev) => (prev !== null && prev === rummyRejectionNoticeRef.current ? null : prev))
        rummyRejectionNoticeRef.current = null
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
      if (!result.outcome.ok) {
        const reason = result.outcome.reason ?? 'that move is not allowed'
        rummyRejectionNoticeRef.current = reason
        setRummyNotice(reason)
        return
      }
      // Only clear the notice if it's still the rejection message this same function set —
      // don't stomp an unrelated notice (e.g. a disconnect banner) that may have arrived since.
      if (rummyNotice !== null && rummyNotice === rummyRejectionNoticeRef.current) {
        setRummyNotice(null)
      }
      rummyRejectionNoticeRef.current = null
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

  // ---- Blackjack helpers ----

  function blackjackActorKey(session: BlackjackSession): string {
    const ps = session.session.publicState
    // Key on phase, roundNumber, and completion counts for betting/insurance phases,
    // plus current player for acting phase to detect when human action changes the state
    const betCount = Object.values(ps.bets).filter(b => b > 0).length
    const insuranceCount = Object.values(ps.hasResolvedInsurance).filter(r => r).length
    const currentId = currentPlayer(ps.turn)
    return `${ps.roundNumber}:${ps.turn.phase}:${betCount}:${insuranceCount}:${currentId}`
  }

  function blackjackStale(key: string): boolean {
    return !blackjackSessionRef.current || blackjackActorKey(blackjackSessionRef.current) !== key
  }

  function blackjackBroadcast() {
    if (!blackjackStartedRef.current) {
      const view: BlackjackView = {
        kind: 'lobby',
        roster: blackjackSeatsRef.current.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === blackjackLocalPlayerIdRef.current })),
        cardBack: rummyCardBackRef.current,
      }
      setBlackjackView(view)
      blackjackHostRef.current?.broadcast(view)
      return
    }
    const session = blackjackSessionRef.current!
    const phase = session.session.publicState.turn.phase
    if (blackjackLastPhaseRef.current === 'betting' && phase !== 'betting') {
      const totalFlights = session.session.publicState.seatOrder.length * 2
      blackjackBotsHeldUntilRef.current = Date.now() + estimateDealIntroMs(totalFlights) + BLACKJACK_DEAL_HOLD_BUFFER_MS
    }
    blackjackLastPhaseRef.current = phase
    // No private state needed — all cards are public except dealer's hole card, which is controlled by dealerHoleRevealed flag
    const view: BlackjackView = {
      kind: 'game',
      revision: session.session.revision,
      publicState: session.session.publicState,
      names: { ...blackjackNamesRef.current },
    }
    setBlackjackView(view)
    blackjackHostRef.current?.broadcast(view)
  }

  function startBlackjackHost() {
    setError(null)
    blackjackHostRef.current = createHost<BlackjackView, BlackjackAction>(() => `BK-${generateCode()}`, {
      onReady(code) {
        const hostId = peerIdForCode(code)
        setBlackjackRole('host')
        writeNameCookie(name)
        pushGameUrl('blackjack')
        setBlackjackCode(code)
        setBlackjackLocalPlayerId(hostId)
        blackjackLocalPlayerIdRef.current = hostId
        setBlackjackStarted(false)
        blackjackStartedRef.current = false
        setBlackjackSeats([{ playerId: hostId, name: name.trim(), isBot: false }])
        blackjackSeatsRef.current = [{ playerId: hostId, name: name.trim(), isBot: false }]
        setBlackjackNotice(null)
        blackjackBroadcast()
      },
      onJoin(guestId, guestName) {
        if (blackjackStartedRef.current) {
          blackjackHostRef.current?.reject(guestId, 'Game already in progress.')
          return
        }
        if (blackjackSeatsRef.current.length >= BLACKJACK_MAX_SEATS) {
          blackjackHostRef.current?.reject(guestId, 'Table is full.')
          return
        }
        blackjackSeatsRef.current = [...blackjackSeatsRef.current, { playerId: guestId, name: guestName, isBot: false }]
        setBlackjackSeats(blackjackSeatsRef.current)
        blackjackBroadcast()
      },
      onAction(guestId, action) {
        if (!blackjackStartedRef.current) return
        const session = blackjackSessionRef.current
        if (!session) return
        if (!blackjackSeatsRef.current.some((s) => s.playerId === guestId)) return
        const result = applyBlackjackAction(session, guestId, action)
        if (!result.outcome.ok) return
        blackjackSessionRef.current = result.blackjackSession
        blackjackBroadcast()
      },
      onLeave(guestId) {
        if (!blackjackStartedRef.current) {
          blackjackSeatsRef.current = blackjackSeatsRef.current.filter((s) => s.playerId !== guestId)
          setBlackjackSeats(blackjackSeatsRef.current)
          blackjackBroadcast()
          return
        }
        const seat = blackjackSeatsRef.current.find((s) => s.playerId === guestId)
        if (!seat) return
        setBlackjackNotice(`${seat.name} disconnected.`)
      },
      onError(message) {
        setError(message)
      },
    })
  }

  function addBlackjackHouseBot() {
    if (blackjackRole !== 'host' || blackjackStartedRef.current) return
    if (blackjackSeatsRef.current.length >= BLACKJACK_MAX_SEATS) return
    blackjackBotCounterRef.current += 1
    const botId = `bot-${blackjackBotCounterRef.current}`
    const botName = randomBotName(blackjackSeatsRef.current.map((s) => s.name))
    blackjackSeatsRef.current = [...blackjackSeatsRef.current, { playerId: botId, name: botName, isBot: true }]
    setBlackjackSeats(blackjackSeatsRef.current)
    blackjackBotSeatsRef.current.add(botId)
    blackjackBroadcast()
  }

  function blackjackStart() {
    if (blackjackRole !== 'host' || blackjackStartedRef.current) return
    const seats = blackjackSeatsRef.current
    if (seats.length < BLACKJACK_MIN_SEATS || seats.length > BLACKJACK_MAX_SEATS) return
    const playerIds = seats.map((s) => s.playerId)
    const seed = Math.floor(Math.random() * 2147483647)
    blackjackSessionRef.current = createBlackjackGame(playerIds, seed, rummyCardBackRef.current)
    blackjackNamesRef.current = Object.fromEntries(seats.map((s) => [s.playerId, s.name]))
    blackjackStartedRef.current = true
    setBlackjackStarted(true)
    blackjackBroadcast()
  }

  async function runBlackjackBot(botId: string, key: string) {
    const session = blackjackSessionRef.current!
    const ps = session.session.publicState
    const phase = ps.turn.phase

    if (phase === 'betting') {
      // Iterate all bot seats still needing to bet
      while (!blackjackStale(key)) {
        // Find bot seats that still need a bet
        const botNeedingBet = blackjackSeatsRef.current.find(
          (s) => s.isBot && blackjackBotSeatsRef.current.has(s.playerId) &&
                 ps.bets[s.playerId] === 0 && !ps.sittingOut[s.playerId]
        )
        if (!botNeedingBet) return

        await wait(BASE_MS)
        if (blackjackStale(key)) return

        const updatedSession = blackjackSessionRef.current!
        const updatedPs = updatedSession.session.publicState
        // Re-check the bot still needs a bet in current state
        if (updatedPs.bets[botNeedingBet.playerId] > 0 || updatedPs.sittingOut[botNeedingBet.playerId]) continue

        const result = runBlackjackBotTurn(updatedSession, botNeedingBet.playerId, blackjackBotStrategy)
        if (!result.outcome.ok) return
        blackjackSessionRef.current = result.blackjackSession
        blackjackBroadcast()
      }
    } else if (phase === 'insurance') {
      // Iterate all bot seats still needing to resolve insurance
      while (!blackjackStale(key)) {
        const botNeedingInsurance = blackjackSeatsRef.current.find(
          (s) => s.isBot && blackjackBotSeatsRef.current.has(s.playerId) &&
                 ps.turn.playerOrder.includes(s.playerId) &&
                 !ps.hasResolvedInsurance[s.playerId]
        )
        if (!botNeedingInsurance) return

        const holdRemaining = blackjackBotsHeldUntilRef.current - Date.now()
        await wait(holdRemaining > 0 ? holdRemaining : BASE_MS)
        if (blackjackStale(key)) return
        if (Date.now() < blackjackBotsHeldUntilRef.current) continue

        const updatedSession = blackjackSessionRef.current!
        const updatedPs = updatedSession.session.publicState
        // Re-check in current state
        if (!updatedPs.turn.playerOrder.includes(botNeedingInsurance.playerId) || updatedPs.hasResolvedInsurance[botNeedingInsurance.playerId]) continue

        const result = runBlackjackBotTurn(updatedSession, botNeedingInsurance.playerId, blackjackBotStrategy)
        if (!result.outcome.ok) return
        blackjackSessionRef.current = result.blackjackSession
        blackjackBroadcast()
      }
    } else if (phase === 'acting') {
      // Single current player pattern
      while (!blackjackStale(key)) {
        const holdRemaining = blackjackBotsHeldUntilRef.current - Date.now()
        await wait(holdRemaining > 0 ? holdRemaining : BASE_MS)
        if (blackjackStale(key)) return
        if (Date.now() < blackjackBotsHeldUntilRef.current) continue
        const updatedSession = blackjackSessionRef.current!
        const updatedPs = updatedSession.session.publicState
        if (updatedPs.turn.phase === 'roundOver' || currentPlayer(updatedPs.turn) !== botId) return
        if (!blackjackBotSeatsRef.current.has(botId)) return
        const result = runBlackjackBotTurn(updatedSession, botId, blackjackBotStrategy)
        if (!result.outcome.ok) return
        blackjackSessionRef.current = result.blackjackSession
        blackjackBroadcast()
      }
    }
  }

  async function runBlackjackBotsIfNeeded() {
    if (blackjackBotBusyRef.current) return
    const session = blackjackSessionRef.current
    if (!session) return
    const ps = session.session.publicState
    if (ps.turn.phase === 'roundOver') return

    const phase = ps.turn.phase
    let botToAct: string | null = null

    if (phase === 'betting') {
      // Find first bot that needs to bet
      const botNeedingBet = blackjackSeatsRef.current.find(
        (s) => s.isBot && blackjackBotSeatsRef.current.has(s.playerId) &&
               ps.bets[s.playerId] === 0 && !ps.sittingOut[s.playerId]
      )
      botToAct = botNeedingBet?.playerId ?? null
    } else if (phase === 'insurance') {
      // Find first bot that needs to resolve insurance
      const botNeedingInsurance = blackjackSeatsRef.current.find(
        (s) => s.isBot && blackjackBotSeatsRef.current.has(s.playerId) &&
               ps.turn.playerOrder.includes(s.playerId) &&
               !ps.hasResolvedInsurance[s.playerId]
      )
      botToAct = botNeedingInsurance?.playerId ?? null
    } else if (phase === 'acting') {
      // Single current player
      const current = currentPlayer(ps.turn)
      if (blackjackBotSeatsRef.current.has(current)) botToAct = current
    }

    if (!botToAct) return

    blackjackBotBusyRef.current = true
    const key = blackjackActorKey(session)
    try {
      await runBlackjackBot(botToAct, key)
    } finally {
      blackjackBotBusyRef.current = false
      setTimeout(() => runBlackjackBotsIfNeeded(), 50)
    }
  }

  function startBlackjackGuest(code: string) {
    if (!code) return
    setError(null)
    let localRevision = -1
    const handle = joinHost<BlackjackView, BlackjackAction>(code, name.trim(), {
      onState(view) {
        if (view.kind === 'lobby') {
          setBlackjackView(view)
          setBlackjackStarted(false)
          return
        }
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        setBlackjackView(view)
        setBlackjackStarted(true)
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
        setBlackjackConnection('connected')
      },
      onDisconnected() {
        setBlackjackConnection('disconnected')
      },
    })
    blackjackGuestRef.current = handle
    setBlackjackRole('guest')
    writeNameCookie(name)
    pushGameUrl('blackjack')
    setBlackjackCode(code)
    handle.peerId.then((id) => { setBlackjackLocalPlayerId(id); blackjackLocalPlayerIdRef.current = id }).catch(() => {})
  }

  function blackjackDispatch(action: BlackjackAction) {
    if (blackjackRole === 'host' && blackjackLocalPlayerId) {
      const session = blackjackSessionRef.current
      if (!session) return
      const result = applyBlackjackAction(session, blackjackLocalPlayerId, action)
      if (!result.outcome.ok) return
      blackjackSessionRef.current = result.blackjackSession
      blackjackBroadcast()
    } else if (blackjackRole === 'guest') {
      blackjackGuestRef.current?.sendAction(action)
    }
  }

  function blackjackSetCardBack(id: string) {
    if (blackjackRole !== 'host' || blackjackStartedRef.current) return
    setCardBackPreference(id)
    blackjackBroadcast()
  }

  // ---- End Blackjack helpers ----

  // ---- Texas Hold'em helpers ----

  function holdemActorKey(session: HoldemSession): string {
    const ps = session.session.publicState
    // Key on hand number, street, and current player index to detect state changes
    return `${ps.handNumber}:${ps.turn.phase}:${ps.turn.currentIndex}:${ps.pot}`
  }

  function holdemStale(key: string): boolean {
    return !holdemSessionRef.current || holdemActorKey(holdemSessionRef.current) !== key
  }

  function holdemBroadcast() {
    if (!holdemStartedRef.current) {
      const view: HoldemView = {
        kind: 'lobby',
        roster: holdemSeatsRef.current.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === holdemLocalPlayerIdRef.current })),
        cardBack: holdemCardBackRef.current,
      }
      setHoldemView(view)
      holdemHostRef.current?.broadcast(view)
      return
    }
    const session = holdemSessionRef.current!
    const handNumber = session.session.publicState.handNumber
    if (holdemLastHandRef.current !== handNumber) {
      holdemLastHandRef.current = handNumber
      const totalFlights = session.session.publicState.seatOrder.length * 2
      holdemBotsHeldUntilRef.current = Date.now() + HOLDEM_BLIND_STAGE_MS + estimateDealIntroMs(totalFlights) + HOLDEM_DEAL_HOLD_BUFFER_MS
    }
    const hostSnap = deriveSnapshot(session.session, holdemLocalPlayerIdRef.current!)
    setHoldemView({
      kind: 'game',
      revision: hostSnap.revision,
      publicState: hostSnap.publicState,
      privateState: hostSnap.privateState!,
      names: { ...holdemNamesRef.current },
    })
    const names = { ...holdemNamesRef.current }
    for (const seat of holdemSeatsRef.current) {
      if (seat.playerId === holdemLocalPlayerIdRef.current) continue
      if (holdemBotSeatsRef.current.has(seat.playerId)) continue
      const guestSnap = deriveSnapshot(session.session, seat.playerId)
      holdemHostRef.current?.sendTo(seat.playerId, {
        kind: 'game',
        revision: guestSnap.revision,
        publicState: guestSnap.publicState,
        privateState: guestSnap.privateState!,
        names,
      })
    }
  }

  function startHoldemHost() {
    setError(null)
    holdemHostRef.current = createHost<HoldemView, HoldemAction>(() => `HE-${generateCode()}`, {
      onReady(code) {
        const hostId = peerIdForCode(code)
        setHoldemRole('host')
        writeNameCookie(name)
        pushGameUrl('holdem')
        setHoldemCode(code)
        setHoldemLocalPlayerId(hostId)
        holdemLocalPlayerIdRef.current = hostId
        setHoldemStarted(false)
        holdemStartedRef.current = false
        setHoldemSeats([{ playerId: hostId, name: name.trim(), isBot: false }])
        holdemSeatsRef.current = [{ playerId: hostId, name: name.trim(), isBot: false }]
        setHoldemNotice(null)
        holdemBroadcast()
      },
      onJoin(guestId, guestName) {
        if (holdemStartedRef.current) {
          holdemHostRef.current?.reject(guestId, 'Game already in progress.')
          return
        }
        if (holdemSeatsRef.current.length >= HOLDEM_MAX_SEATS) {
          holdemHostRef.current?.reject(guestId, 'Table is full.')
          return
        }
        holdemSeatsRef.current = [...holdemSeatsRef.current, { playerId: guestId, name: guestName, isBot: false }]
        setHoldemSeats(holdemSeatsRef.current)
        holdemBroadcast()
      },
      onAction(guestId, action) {
        if (!holdemStartedRef.current) return
        const session = holdemSessionRef.current
        if (!session) return
        if (!holdemSeatsRef.current.some((s) => s.playerId === guestId)) return
        const result = applyHoldemAction(session, guestId, action)
        if (!result.outcome.ok) return
        holdemSessionRef.current = result.holdemSession
        holdemBroadcast()
      },
      onLeave(guestId) {
        if (!holdemStartedRef.current) {
          holdemSeatsRef.current = holdemSeatsRef.current.filter((s) => s.playerId !== guestId)
          setHoldemSeats(holdemSeatsRef.current)
          holdemBroadcast()
          return
        }
        const seat = holdemSeatsRef.current.find((s) => s.playerId === guestId)
        if (!seat) return
        setHoldemNotice(`${seat.name} disconnected.`)
      },
      onError(message) {
        setError(message)
      },
    })
  }

  function addHoldemHouseBot() {
    if (holdemRole !== 'host' || holdemStartedRef.current) return
    if (holdemSeatsRef.current.length >= HOLDEM_MAX_SEATS) return
    holdemBotCounterRef.current += 1
    const botId = `bot-${holdemBotCounterRef.current}`
    const botName = randomBotName(holdemSeatsRef.current.map((s) => s.name))
    holdemSeatsRef.current = [...holdemSeatsRef.current, { playerId: botId, name: botName, isBot: true }]
    setHoldemSeats(holdemSeatsRef.current)
    holdemBotSeatsRef.current.add(botId)
    holdemBroadcast()
  }

  function holdemStart() {
    if (holdemRole !== 'host' || holdemStartedRef.current) return
    const seats = holdemSeatsRef.current
    if (seats.length < HOLDEM_MIN_SEATS || seats.length > HOLDEM_MAX_SEATS) return
    const playerIds = seats.map((s) => s.playerId)
    const seed = Math.floor(Math.random() * 2147483647)
    holdemSessionRef.current = createHoldemGame(playerIds, seed, holdemCardBackRef.current)
    holdemNamesRef.current = Object.fromEntries(seats.map((s) => [s.playerId, s.name]))
    holdemStartedRef.current = true
    setHoldemStarted(true)
    holdemBroadcast()
  }

  async function runHoldemBot(botId: string, key: string) {
    while (!holdemStale(key)) {
      const holdRemaining = holdemBotsHeldUntilRef.current - Date.now()
      await wait(holdRemaining > 0 ? holdRemaining : BASE_MS)
      if (holdemStale(key)) return
      if (Date.now() < holdemBotsHeldUntilRef.current) continue
      const session = holdemSessionRef.current!
      const ps = session.session.publicState
      if (ps.handOver || ps.gameOverWinnerId) return
      if (currentPlayer(ps.turn) !== botId) return
      if (!holdemBotSeatsRef.current.has(botId)) return
      const result = runHoldemBotTurn(session, botId, holdemBotStrategy)
      if (result.outcome.ok) {
        holdemSessionRef.current = result.holdemSession
        holdemBroadcast()
        continue
      }
      // The strategy's chosen action was rejected by the validator. This
      // should not happen (the strategy is written to only propose legal
      // actions), but the strategy is deterministic -- if it did happen and
      // we just gave up, the next retry would derive the identical action
      // from the identical state and be rejected again, forever, hanging
      // this bot's turn permanently. Fall back to FOLD, which is always
      // legal whenever it's genuinely this seat's turn.
      const foldResult = applyHoldemAction(session, botId, { type: 'FOLD' })
      if (!foldResult.outcome.ok) return
      holdemSessionRef.current = foldResult.holdemSession
      holdemBroadcast()
    }
  }

  async function runHoldemBotsIfNeeded() {
    if (holdemBotBusyRef.current) return
    const session = holdemSessionRef.current
    if (!session) return
    const ps = session.session.publicState
    if (ps.handOver || ps.gameOverWinnerId) return
    const currentId = currentPlayer(ps.turn)
    if (!holdemBotSeatsRef.current.has(currentId)) return
    holdemBotBusyRef.current = true
    const key = holdemActorKey(session)
    try {
      await runHoldemBot(currentId, key)
    } finally {
      holdemBotBusyRef.current = false
      setTimeout(() => runHoldemBotsIfNeeded(), 50)
    }
  }

  function startHoldemGuest(code: string) {
    if (!code) return
    setError(null)
    let localRevision = -1
    const handle = joinHost<HoldemView, HoldemAction>(code, name.trim(), {
      onState(view) {
        if (view.kind === 'lobby') {
          setHoldemView(view)
          setHoldemStarted(false)
          return
        }
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        setHoldemView(view)
        setHoldemStarted(true)
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
        setHoldemConnection('connected')
      },
      onDisconnected() {
        setHoldemConnection('disconnected')
      },
    })
    holdemGuestRef.current = handle
    setHoldemRole('guest')
    writeNameCookie(name)
    pushGameUrl('holdem')
    setHoldemCode(code)
    handle.peerId.then((id) => { setHoldemLocalPlayerId(id); holdemLocalPlayerIdRef.current = id }).catch(() => {})
  }

  function holdemDispatch(action: HoldemAction) {
    if (holdemRole === 'host' && holdemLocalPlayerId) {
      const session = holdemSessionRef.current
      if (!session) return
      const result = applyHoldemAction(session, holdemLocalPlayerId, action)
      if (!result.outcome.ok) return
      holdemSessionRef.current = result.holdemSession
      holdemBroadcast()
    } else if (holdemRole === 'guest') {
      holdemGuestRef.current?.sendAction(action)
    }
  }

  function holdemSetCardBack(id: string) {
    if (holdemRole !== 'host' || holdemStartedRef.current) return
    holdemCardBackRef.current = id
    setHoldemView(null)
    holdemBroadcast()
  }

  // ---- End Texas Hold'em helpers ----

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
    const currentRound = session.session.publicState.roundNumber
    if (currentRound !== phase10LastRoundRef.current) {
      phase10LastRoundRef.current = currentRound
      const totalFlights = session.session.publicState.seatOrder.length * PHASE10_HAND_SIZE
      phase10BotsHeldUntilRef.current = Date.now() + estimateDealIntroMs(totalFlights) + PHASE10_DEAL_HOLD_BUFFER_MS
    }
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
          phase10HostRef.current?.reject(guestId, 'Game already in progress.')
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
        if (!result.outcome.ok) {
          // Sent one-off (not a broadcast, not gated by revision) so this guest sees WHY
          // their action did nothing, even though canonical state didn't change.
          phase10HostRef.current?.sendTo(guestId, { kind: 'notice', message: result.outcome.reason ?? 'that move is not allowed' })
          return
        }
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
      const holdRemaining = phase10BotsHeldUntilRef.current - Date.now()
      await wait(holdRemaining > 0 ? holdRemaining : PHASE10_ACTION_MS)
      if (phase10Stale(key)) return
      if (Date.now() < phase10BotsHeldUntilRef.current) continue
      const session = phase10SessionRef.current!
      const ps = session.session.publicState
      if (ps.roundOver || ps.matchWinnerId) return
      if (currentPlayer(ps.turn) !== botId) return
      if (!phase10BotSeatsRef.current.has(botId)) return
      const result = runPhase10BotTurn(session, botId, phase10BotStrategy)
      if (!result.outcome.ok) {
        // A rejected bot action is always a bot bug (the strategy and validator
        // disagreed), and the strategy is deterministic — silently returning here
        // once froze the game forever, with the loop re-proposing the same doomed
        // action every 50ms. Log it, then recover with a plain discard, which is
        // always legal in the discard phase with a non-empty hand.
        console.error(`Phase 10 bot ${botId} action rejected: ${result.outcome.reason ?? 'unknown'}`)
        const botHand = session.session.privateStates[botId]?.hand.cards ?? []
        if (ps.turn.phase === 'discard' && botHand.length > 0) {
          const fallback = applyPhase10Action(session, botId, { type: 'DISCARD_CARD', cardId: selectDiscard(botHand) })
          if (fallback.outcome.ok) {
            phase10SessionRef.current = fallback.game
            phase10Broadcast()
            continue
          }
        }
        // One-way flag: without it the 50ms re-arm in runPhase10BotsIfNeeded would
        // re-enter here and re-log the same rejection forever.
        phase10BotStuckRef.current = true
        setPhase10Notice(`${phase10NamesRef.current[botId] ?? botId} got stuck. Please report this bug.`)
        return
      }
      phase10SessionRef.current = result.game
      phase10Broadcast()
    }
  }

  async function runPhase10BotsIfNeeded() {
    if (phase10BotBusyRef.current || phase10BotStuckRef.current) return
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
        if (view.kind === 'notice') {
          // Out-of-band rejection feedback for MY OWN last action — never touches
          // phase10View/localRevision, so it can't be mistaken for (or block) a real state update.
          phase10RejectionNoticeRef.current = view.message
          setPhase10Notice(view.message)
          return
        }
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        // A fresh accepted state means my last action (if any) went through — clear a
        // rejection notice I set, but never stomp an unrelated one (e.g. a disconnect banner).
        setPhase10Notice((prev) => (prev !== null && prev === phase10RejectionNoticeRef.current ? null : prev))
        phase10RejectionNoticeRef.current = null
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
      if (!result.outcome.ok) {
        const reason = result.outcome.reason ?? 'that move is not allowed'
        phase10RejectionNoticeRef.current = reason
        setPhase10Notice(reason)
        return
      }
      // Only clear the notice if it's still the rejection message this same function set —
      // don't stomp an unrelated notice (e.g. a disconnect banner) that may have arrived since.
      if (phase10Notice !== null && phase10Notice === phase10RejectionNoticeRef.current) {
        setPhase10Notice(null)
      }
      phase10RejectionNoticeRef.current = null
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
    setBattleshipView({ kind: 'game', revision: hostSnap.revision, publicState: hostSnap.publicState, privateState: hostSnap.privateState!, opponentName: battleshipOpponentNameRef.current })
    const opponentId = battleshipOpponentIdRef.current
    if (opponentId && opponentId !== 'bot') {
      const guestSnap = deriveSnapshot(session.session, opponentId)
      battleshipHostRef.current?.broadcast({ kind: 'game', revision: guestSnap.revision, publicState: guestSnap.publicState, privateState: guestSnap.privateState!, opponentName: name })
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
        if (!result.outcome.ok) {
          // Sent one-off (not a broadcast, not gated by revision) so this guest sees WHY
          // their action did nothing, even though canonical state didn't change.
          battleshipHostRef.current?.sendTo(guestId, { kind: 'notice', message: result.outcome.reason ?? 'that move is not allowed' })
          return
        }
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
      setBattleshipView({ kind: 'game', revision: snap.revision, publicState: snap.publicState, privateState: snap.privateState!, opponentName: battleshipOpponentNameRef.current })
      // A streak/free-for-all extra turn keeps the SAME bot firing every
      // BASE_MS with no natural pause. ship-miss/-hit/-sunk run 2/3.7/5.7s —
      // far longer than BASE_MS — so a hot streak stacks shot sounds on top
      // of each other. Hold the next shot off long enough for this one's
      // sound to finish before firing again.
      const holdMs = battleshipShotHoldMs(result.bs.session.publicState, botId)
      if (holdMs > 0) {
        await wait(holdMs)
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
        if (view.kind === 'notice') {
          // Out-of-band rejection feedback for MY OWN last action — never touches
          // battleshipView/localRevision, so it can't be mistaken for (or block) a real state update.
          battleshipRejectionNoticeRef.current = view.message
          setBattleshipNotice(view.message)
          return
        }
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        // A fresh accepted state means my last action (if any) went through — clear a
        // rejection notice I set, but never stomp an unrelated one (e.g. a disconnect banner).
        setBattleshipNotice((prev) => (prev !== null && prev === battleshipRejectionNoticeRef.current ? null : prev))
        battleshipRejectionNoticeRef.current = null
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
      if (!result.outcome.ok) {
        const reason = result.outcome.reason ?? 'that move is not allowed'
        battleshipRejectionNoticeRef.current = reason
        setBattleshipNotice(reason)
        return
      }
      // Only clear the notice if it's still the rejection message this same function set —
      // don't stomp an unrelated notice (e.g. a disconnect banner) that may have arrived since.
      if (battleshipNotice !== null && battleshipNotice === battleshipRejectionNoticeRef.current) {
        setBattleshipNotice(null)
      }
      battleshipRejectionNoticeRef.current = null
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

  // Hands are PRIVATE and up to 3 guests can be seated, so a single broadcast cannot carry every
  // hand (any guest would see the others'). Lobby phase → broadcast the roster view; game phase →
  // per-guest sendTo with only that guest's own hand. The host's own view comes from its local
  // snapshot. Mirrors rummyBroadcast() exactly.
  function dominoesBroadcast() {
    if (!dominoesStartedRef.current) {
      const view: DominoesView = {
        kind: 'lobby',
        roster: dominoesSeatsRef.current.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === dominoesLocalPlayerIdRef.current })),
      }
      setDominoesView(view)
      dominoesHostRef.current?.broadcast(view)
      return
    }
    const session = dominoesSessionRef.current!
    const currentRound = session.session.publicState.roundNumber
    if (currentRound !== dominoesLastRoundRef.current) {
      dominoesLastRoundRef.current = currentRound
      // Every fresh round's hand sizes vary by seat count (see DOMINOES_HAND_SIZES) — hold bots
      // until each client's local DealIntro (see DominoesTable's maxFlights) has had time to
      // actually finish, not just estimateDealIntroMs's pure animation window.
      dominoesBotsHeldUntilRef.current = Date.now() + dominoesDealHoldMs(session.session.publicState.handCounts)
    }
    const hostSnap = deriveSnapshot(session.session, dominoesLocalPlayerIdRef.current!)
    setDominoesView({ kind: 'game', revision: hostSnap.revision, publicState: hostSnap.publicState, privateState: hostSnap.privateState!, names: { ...dominoesNamesRef.current } })
    const names = { ...dominoesNamesRef.current }
    for (const seat of dominoesSeatsRef.current) {
      if (seat.playerId === dominoesLocalPlayerIdRef.current) continue
      if (dominoesBotSeatsRef.current.has(seat.playerId)) continue
      const guestSnap = deriveSnapshot(session.session, seat.playerId)
      dominoesHostRef.current?.sendTo(seat.playerId, { kind: 'game', revision: guestSnap.revision, publicState: guestSnap.publicState, privateState: guestSnap.privateState!, names })
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
        setDominoesStarted(false)
        dominoesStartedRef.current = false
        setDominoesSeats([{ playerId: hostId, name: name.trim(), isBot: false }])
        dominoesSeatsRef.current = [{ playerId: hostId, name: name.trim(), isBot: false }]
        setDominoesNotice(null)
        dominoesBroadcast()
      },
      onJoin(guestId, guestName) {
        if (dominoesStartedRef.current) {
          dominoesHostRef.current?.reject(guestId, 'Game already in progress.')
          return
        }
        if (dominoesSeatsRef.current.length >= DOMINOES_MAX_SEATS) {
          dominoesHostRef.current?.reject(guestId, 'Table is full.')
          return
        }
        dominoesSeatsRef.current = [...dominoesSeatsRef.current, { playerId: guestId, name: guestName, isBot: false }]
        setDominoesSeats(dominoesSeatsRef.current)
        dominoesBroadcast()
      },
      onAction(guestId, action) {
        if (!dominoesStartedRef.current) return
        const session = dominoesSessionRef.current
        if (!session) return
        if (!dominoesSeatsRef.current.some((s) => s.playerId === guestId)) return
        const result = applyDominoesAction(session, guestId, action)
        if (!result.outcome.ok) {
          // Sent one-off (not a broadcast, not gated by revision) so this guest sees WHY
          // their action did nothing, even though canonical state didn't change.
          dominoesHostRef.current?.sendTo(guestId, { kind: 'notice', message: result.outcome.reason ?? 'that move is not allowed' })
          return
        }
        dominoesSessionRef.current = result.dm
        dominoesBroadcast()
      },
      onLeave(guestId) {
        if (!dominoesStartedRef.current) {
          dominoesSeatsRef.current = dominoesSeatsRef.current.filter((s) => s.playerId !== guestId)
          setDominoesSeats(dominoesSeatsRef.current)
          dominoesBroadcast()
          return
        }
        const seat = dominoesSeatsRef.current.find((s) => s.playerId === guestId)
        if (!seat) return
        setDominoesNotice(`${seat.name} disconnected.`)
      },
      onError(message) {
        setError(message)
      },
    })
  }

  function addDominoesHouseBot() {
    if (dominoesRole !== 'host' || dominoesStartedRef.current) return
    if (dominoesSeatsRef.current.length >= DOMINOES_MAX_SEATS) return
    dominoesBotCounterRef.current += 1
    const botId = `bot-${dominoesBotCounterRef.current}`
    const botName = randomBotName(dominoesSeatsRef.current.map((s) => s.name))
    dominoesSeatsRef.current = [...dominoesSeatsRef.current, { playerId: botId, name: botName, isBot: true }]
    setDominoesSeats(dominoesSeatsRef.current)
    dominoesBotSeatsRef.current.add(botId)
    dominoesBroadcast()
  }

  function dominoesStart() {
    if (dominoesRole !== 'host' || dominoesStartedRef.current) return
    const seats = dominoesSeatsRef.current
    // Variable seat count: at least DOMINOES_MIN_SEATS, at most DOMINOES_MAX_SEATS —
    // whatever is seated when the host presses Start, NOT a fixed-count gate.
    if (seats.length < DOMINOES_MIN_SEATS || seats.length > DOMINOES_MAX_SEATS) return
    const playerIds = seats.map((s) => s.playerId)
    const seed = Math.floor(Math.random() * 2147483647)
    dominoesSessionRef.current = createDominoesGame(playerIds, seed)
    dominoesNamesRef.current = Object.fromEntries(seats.map((s) => [s.playerId, s.name]))
    dominoesStartedRef.current = true
    setDominoesStarted(true)
    dominoesBroadcast()
  }

  async function runDominoesBot(botId: string, key: string) {
    while (!dominoesStale(key)) {
      const holdRemaining = dominoesBotsHeldUntilRef.current - Date.now()
      await wait(holdRemaining > 0 ? holdRemaining : DOMINOES_ACTION_MS)
      if (dominoesStale(key)) return
      if (Date.now() < dominoesBotsHeldUntilRef.current) continue
      const session = dominoesSessionRef.current!
      const ps = session.session.publicState
      if (ps.stage !== 'play' || currentPlayer(ps.turn) !== botId) return
      if (!dominoesBotSeatsRef.current.has(botId)) return
      const result = runDominoesBotTurn(session, botId, dominoesBotStrategy)
      if (!result.outcome.ok) return
      dominoesSessionRef.current = result.dm
      dominoesBroadcast()
    }
  }

  async function runDominoesBotsIfNeeded() {
    if (dominoesBotBusyRef.current) return
    const session = dominoesSessionRef.current
    if (!session) return
    const ps = session.session.publicState
    if (ps.stage !== 'play') return
    const currentId = currentPlayer(ps.turn)
    if (!dominoesBotSeatsRef.current.has(currentId)) return
    dominoesBotBusyRef.current = true
    const key = dominoesActorKey(session)
    try {
      await runDominoesBot(currentId, key)
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
        if (view.kind === 'lobby') {
          setDominoesView(view)
          setDominoesStarted(false)
          return
        }
        if (view.kind === 'notice') {
          // Out-of-band rejection feedback for MY OWN last action — never touches
          // dominoesView/localRevision, so it can't be mistaken for (or block) a real state update.
          dominoesRejectionNoticeRef.current = view.message
          setDominoesNotice(view.message)
          return
        }
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        // A fresh accepted state means my last action (if any) went through — clear a
        // rejection notice I set, but never stomp an unrelated one (e.g. a disconnect banner).
        setDominoesNotice((prev) => (prev !== null && prev === dominoesRejectionNoticeRef.current ? null : prev))
        dominoesRejectionNoticeRef.current = null
        setDominoesView(view)
        setDominoesStarted(true)
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
      const session = dominoesSessionRef.current
      if (!session) return
      const result = applyDominoesAction(session, dominoesLocalPlayerId, action)
      if (!result.outcome.ok) {
        const reason = result.outcome.reason ?? 'that move is not allowed'
        dominoesRejectionNoticeRef.current = reason
        setDominoesNotice(reason)
        return
      }
      // Only clear the notice if it's still the rejection message this same function set —
      // don't stomp an unrelated notice (e.g. a disconnect banner) that may have arrived since.
      if (dominoesNotice !== null && dominoesNotice === dominoesRejectionNoticeRef.current) {
        setDominoesNotice(null)
      }
      dominoesRejectionNoticeRef.current = null
      dominoesSessionRef.current = result.dm
      dominoesBroadcast()
    } else if (dominoesRole === 'guest') {
      dominoesGuestRef.current?.sendAction(action)
    }
  }

  function dominoesRematch() {
    if (dominoesRole !== 'host' || !dominoesSessionRef.current) return
    const ps = dominoesSessionRef.current.session.publicState
    if (ps.matchWinnerId === null) return
    const prevRevision = dominoesSessionRef.current.session.revision
    const playerIds = [...ps.seatOrder]
    const seed = Math.floor(Math.random() * 2147483647)
    const next = createDominoesGame(playerIds, seed)
    next.session = { ...next.session, revision: prevRevision + 1 }
    dominoesSessionRef.current = next
    // Force the deal-intro hold to recompute even if the finished match's last round happened
    // to also be round 1 (single-round match) — a rematch always deals a fresh hand.
    dominoesLastRoundRef.current = null
    dominoesBroadcast()
  }

  // ---- End Dominoes helpers ----

  // ---- Wahoo helpers ----

  // `${stage}:${turnNumber}` identifies "this is still the same bot's turn window" for
  // wahooStale below: every current transition that hands the turn off or grants an extra
  // roll goes through advanceTurn/extraTurn (both bump turnNumber), so this is exact today.
  // It is a fragile contract, though: it's tempting to "fix" it by folding in
  // wh.session.revision (which bumps on every accepted action, same-turn ones included), but
  // that would break the ROLL-then-MOVE sequence within a single bot turn — a plain ROLL uses
  // setPhase (no turnNumber change) but still bumps revision, so runWahooBots's inner while
  // loop would see the key change and abort right after ROLL, before ever submitting MOVE.
  // Making this robust against a hypothetical future same-turn action that hands off the
  // actor WITHOUT going through advanceTurn/extraTurn would need a turn-engine-level concept
  // (e.g. an explicit "actor generation" distinct from both turnNumber and revision) — that's
  // a shared src/engine/turn-engine.ts change affecting every game on this engine, not a
  // Wahoo-local fix, so it's left as a known constraint rather than guessed at here.
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
          wahooHostRef.current?.reject(guestId, 'Game already in progress.')
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
        if (!result.outcome.ok) {
          // Sent one-off (not a broadcast, not gated by revision) so this guest sees WHY
          // their action did nothing, even though canonical state didn't change.
          wahooHostRef.current?.sendTo(guestId, { kind: 'notice', message: result.outcome.reason ?? 'that move is not allowed' })
          return
        }
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
      await wait(WAHOO_ACTION_MS)
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
      // farkle-bust runs far longer than WAHOO_ACTION_MS alone covers — hold extra so the
      // next bot action doesn't cut off the cue (see WAHOO_BUST_EXTRA_MS above).
      const kind = result.wh.session.publicState.lastEvent?.kind
      if (kind === 'bust') await wait(WAHOO_BUST_EXTRA_MS)
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
        if (view.kind === 'notice') {
          // Out-of-band rejection feedback for MY OWN last action — never touches
          // wahooView/localRevision, so it can't be mistaken for (or block) a real state update.
          wahooRejectionNoticeRef.current = view.message
          setWahooNotice(view.message)
          return
        }
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        // A fresh accepted state means my last action (if any) went through — clear a
        // rejection notice I set, but never stomp an unrelated one (e.g. a disconnect banner).
        setWahooNotice((prev) => (prev !== null && prev === wahooRejectionNoticeRef.current ? null : prev))
        wahooRejectionNoticeRef.current = null
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
      if (!result.outcome.ok) {
        const reason = result.outcome.reason ?? 'that move is not allowed'
        wahooRejectionNoticeRef.current = reason
        setWahooNotice(reason)
        return
      }
      // Only clear the notice if it's still the rejection message this same function set —
      // don't stomp an unrelated notice (e.g. a disconnect banner) that may have arrived since.
      if (wahooNotice !== null && wahooNotice === wahooRejectionNoticeRef.current) {
        setWahooNotice(null)
      }
      wahooRejectionNoticeRef.current = null
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
          checkersHostRef.current?.reject(guestId, 'Game already in progress.')
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
        if (!result.outcome.ok) {
          // Sent one-off (not a broadcast, not gated by revision) so this guest sees WHY
          // their action did nothing, even though canonical state didn't change.
          checkersHostRef.current?.sendTo(guestId, { kind: 'notice', message: result.outcome.reason ?? 'that move is not allowed' })
          return
        }
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
      await wait(CHECKERS_ACTION_MS)
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
      // A crowning move's combined checker-move/checker-jump + king-me cue runs the full measured
      // 2.040s — far longer than CHECKERS_ACTION_MS alone covers. Hold extra so the next bot
      // action (which pays its own CHECKERS_ACTION_MS wait on the next loop iteration) doesn't
      // start until that cue has actually finished. See CHECKERS_CROWN_EXTRA_MS above.
      if (result.game.session.publicState.lastMove?.crowned) await wait(CHECKERS_CROWN_EXTRA_MS)
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
        if (view.kind === 'notice') {
          // Out-of-band rejection feedback for MY OWN last action — never touches
          // checkersView/localRevision, so it can't be mistaken for (or block) a real state update.
          checkersRejectionNoticeRef.current = view.message
          setCheckersNotice(view.message)
          return
        }
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        // A fresh accepted state means my last action (if any) went through — clear a
        // rejection notice I set, but never stomp an unrelated one (e.g. a disconnect banner).
        setCheckersNotice((prev) => (prev !== null && prev === checkersRejectionNoticeRef.current ? null : prev))
        checkersRejectionNoticeRef.current = null
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
      if (!result.outcome.ok) {
        const reason = result.outcome.reason ?? 'that move is not allowed'
        checkersRejectionNoticeRef.current = reason
        setCheckersNotice(reason)
        return
      }
      // Only clear the notice if it's still the rejection message this same function set —
      // don't stomp an unrelated notice (e.g. a disconnect banner) that may have arrived since.
      if (checkersNotice !== null && checkersNotice === checkersRejectionNoticeRef.current) {
        setCheckersNotice(null)
      }
      checkersRejectionNoticeRef.current = null
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
    const currentRound = session.session.publicState.round
    if (currentRound !== mtLastRoundRef.current) {
      mtLastRoundRef.current = currentRound
      // Every fresh round deals the full 2-8-seat, 32-72-tile spread — hold bots until each
      // client's local DealIntro (see MexicanTrainTable's maxFlights) has had time to actually
      // finish, not just estimateDealIntroMs's pure animation window.
      mtBotsHeldUntilRef.current = Date.now() + mtDealHoldMs(session.session.publicState.handCounts)
    }
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
          mtHostRef.current?.reject(guestId, 'Game already in progress.')
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
        if (!result.outcome.ok) {
          // Sent one-off (not a broadcast, not gated by revision) so this guest sees WHY
          // their action did nothing, even though canonical state didn't change.
          mtHostRef.current?.sendTo(guestId, { kind: 'notice', message: result.outcome.reason ?? 'that move is not allowed' })
          return
        }
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
      const holdRemaining = mtBotsHeldUntilRef.current - Date.now()
      await wait(holdRemaining > 0 ? holdRemaining : MT_ACTION_MS)
      if (mtStale(key)) return
      if (Date.now() < mtBotsHeldUntilRef.current) continue
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
        if (view.kind === 'notice') {
          // Out-of-band rejection feedback for MY OWN last action — never touches
          // mtView/localRevision, so it can't be mistaken for (or block) a real state update.
          mtRejectionNoticeRef.current = view.message
          setMTNotice(view.message)
          return
        }
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        // A fresh accepted state means my last action (if any) went through — clear a
        // rejection notice I set, but never stomp an unrelated one (e.g. a disconnect banner).
        setMTNotice((prev) => (prev !== null && prev === mtRejectionNoticeRef.current ? null : prev))
        mtRejectionNoticeRef.current = null
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
      if (!result.outcome.ok) {
        const reason = result.outcome.reason ?? 'that move is not allowed'
        mtRejectionNoticeRef.current = reason
        setMTNotice(reason)
        return
      }
      // Only clear the notice if it's still the rejection message this same function set —
      // don't stomp an unrelated notice (e.g. a disconnect banner) that may have arrived since.
      if (mtNotice !== null && mtNotice === mtRejectionNoticeRef.current) {
        setMTNotice(null)
      }
      mtRejectionNoticeRef.current = null
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
    // Force the deal-intro hold to recompute even if the finished match's last round happened
    // to also be round 0 — a rematch always deals a fresh full spread of hands.
    mtLastRoundRef.current = null
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
    setChessView({ kind: 'game', revision: hostSnap.revision, publicState: hostSnap.publicState, opponentName: chessOpponentNameRef.current })
    const opponentId = chessOpponentIdRef.current
    if (opponentId && opponentId !== 'bot') {
      const guestSnap = deriveSnapshot(session.session, opponentId)
      chessHostRef.current?.broadcast({ kind: 'game', revision: guestSnap.revision, publicState: guestSnap.publicState, opponentName: name })
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
        if (!result.outcome.ok) {
          // Sent one-off (not a broadcast, not gated by revision) so this guest sees WHY
          // their action did nothing, even though canonical state didn't change.
          chessHostRef.current?.sendTo(guestId, { kind: 'notice', message: result.outcome.reason ?? 'that move is not allowed' })
          return
        }
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
      await wait(CHESS_ACTION_MS)
      if (chessStale(key)) return
      const session = chessSessionRef.current!
      const ps = session.session.publicState
      if (ps.stage !== 'play') return
      if (currentPlayer(ps.turn) !== botId) return
      // Whatever move just handed the bot this turn (the human's move, since Chess
      // is strictly 2-seat and turns always alternate) may have been a promotion,
      // which plays king-me (measured 2.000s) — far longer than CHESS_ACTION_MS
      // covers on its own. Hold extra so that cue finishes before this bot move's
      // own sound fires.
      if (ps.lastMove?.san.includes('=')) {
        await wait(CHESS_PROMOTION_EXTRA_MS)
        if (chessStale(key)) return
      }
      // 'hard' is not selectable (spec 28) — a stale session could still carry
      // it, so fall through to normal rather than crash on an unknown branch.
      const strategy = ps.difficulty === 'easy'
        ? makeEasyChessBotStrategy(session.rng)
        : makeNormalChessBotStrategy()
      const result = runChessBotTurn(session, botId, strategy)
      if (!result.outcome.ok) return
      chessSessionRef.current = result.game
      const snap = deriveSnapshot(result.game.session, chessLocalPlayerId!)
      setChessView({ kind: 'game', revision: snap.revision, publicState: snap.publicState, opponentName: chessOpponentNameRef.current })
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
        if (view.kind === 'notice') {
          // Out-of-band rejection feedback for MY OWN last action — never touches
          // chessView/localRevision, so it can't be mistaken for (or block) a real state update.
          chessRejectionNoticeRef.current = view.message
          setChessNotice(view.message)
          return
        }
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        // A fresh accepted state means my last action (if any) went through — clear a
        // rejection notice I set, but never stomp an unrelated one (e.g. a disconnect banner).
        setChessNotice((prev) => (prev !== null && prev === chessRejectionNoticeRef.current ? null : prev))
        chessRejectionNoticeRef.current = null
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
      if (!result.outcome.ok) {
        const reason = result.outcome.reason ?? 'that move is not allowed'
        chessRejectionNoticeRef.current = reason
        setChessNotice(reason)
        return
      }
      // Only clear the notice if it's still the rejection message this same function set —
      // don't stomp an unrelated notice (e.g. a disconnect banner) that may have arrived since.
      if (chessNotice !== null && chessNotice === chessRejectionNoticeRef.current) {
        setChessNotice(null)
      }
      chessRejectionNoticeRef.current = null
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
          unoHostRef.current?.reject(guestId, 'Game already in progress.')
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
        // action arrives over PeerJS as `unknown` at runtime — the TypeScript UnoAction
        // union is compile-time only, so a malformed/stale/hostile guest payload must be
        // rejected here, before it ever reaches action.type inside the validator.
        if (!isUnoAction(action)) return
        const result = applyUnoAction(session, guestId, action)
        if (!result.outcome.ok) {
          // Sent one-off (not a broadcast, not gated by revision) so this guest sees WHY
          // their action did nothing, even though canonical state didn't change.
          unoHostRef.current?.sendTo(guestId, { kind: 'notice', message: result.outcome.reason ?? 'that move is not allowed' })
          return
        }
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
        if (view.kind === 'notice') {
          // Out-of-band rejection feedback for MY OWN last action — never touches
          // unoView/localRevision, so it can't be mistaken for (or block) a real state update.
          unoRejectionNoticeRef.current = view.message
          setUnoNotice(view.message)
          return
        }
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        // A fresh accepted state means my last action (if any) went through — clear a
        // rejection notice I set, but never stomp an unrelated one (e.g. a disconnect banner).
        setUnoNotice((prev) => (prev !== null && prev === unoRejectionNoticeRef.current ? null : prev))
        unoRejectionNoticeRef.current = null
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
      if (!result.outcome.ok) {
        const reason = result.outcome.reason ?? 'that move is not allowed'
        unoRejectionNoticeRef.current = reason
        setUnoNotice(reason)
        return
      }
      // Only clear the notice if it's still the rejection message this same function set —
      // don't stomp an unrelated notice (e.g. a disconnect banner) that may have arrived since.
      if (unoNotice !== null && unoNotice === unoRejectionNoticeRef.current) {
        setUnoNotice(null)
      }
      unoRejectionNoticeRef.current = null
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
  const BLACKJACK_SEAT_INKS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#9333ea', '#0fb5a0']
  const HOLDEM_SEAT_INKS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#9333ea', '#0fb5a0', '#ec4899', '#06b6d4']
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
          skipBoHostRef.current?.reject(guestId, 'Game already in progress.')
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
        // action arrives over PeerJS as `unknown` at runtime — the TypeScript SkipBoAction
        // union is compile-time only, so a malformed/stale/hostile guest payload must be
        // rejected here, before it ever reaches action.type inside the validator.
        if (!isSkipBoAction(action)) return
        const result = applySkipBoAction(session, guestId, action)
        if (!result.outcome.ok) {
          // Sent one-off (not a broadcast, not gated by revision) so this guest sees WHY
          // their action did nothing, even though canonical state didn't change.
          skipBoHostRef.current?.sendTo(guestId, { kind: 'notice', message: result.outcome.reason ?? 'that move is not allowed' })
          return
        }
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
    skipBoBotsHeldUntilRef.current = Date.now() + skipBoDealHoldMs(playerIds.length)
    skipBoStartedRef.current = true
    setSkipBoStarted(true)
    skipBoBroadcast()
  }

  async function runSkipBoBot(botId: string, key: string) {
    while (!skipBoStale(key)) {
      const holdRemaining = skipBoBotsHeldUntilRef.current - Date.now()
      await wait(holdRemaining > 0 ? holdRemaining : SKIPBO_ACTION_MS)
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
        if (view.kind === 'notice') {
          // Out-of-band rejection feedback for MY OWN last action — never touches
          // skipBoView/localRevision, so it can't be mistaken for (or block) a real state update.
          skipBoRejectionNoticeRef.current = view.message
          setSkipBoNotice(view.message)
          return
        }
        if (!shouldAcceptUpdate(localRevision, view.revision)) return
        localRevision = view.revision
        // A fresh accepted state means my last action (if any) went through — clear a
        // rejection notice I set, but never stomp an unrelated one (e.g. a disconnect banner).
        setSkipBoNotice((prev) => (prev !== null && prev === skipBoRejectionNoticeRef.current ? null : prev))
        skipBoRejectionNoticeRef.current = null
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
      if (!result.outcome.ok) {
        const reason = result.outcome.reason ?? 'that move is not allowed'
        skipBoRejectionNoticeRef.current = reason
        setSkipBoNotice(reason)
        return
      }
      // Only clear the notice if it's still the rejection message this same function set —
      // don't stomp an unrelated notice (e.g. a disconnect banner) that may have arrived since.
      if (skipBoNotice !== null && skipBoNotice === skipBoRejectionNoticeRef.current) {
        setSkipBoNotice(null)
      }
      skipBoRejectionNoticeRef.current = null
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
    skipBoBotsHeldUntilRef.current = Date.now() + skipBoDealHoldMs(playerIds.length)
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
        scrabbleRejectionNoticeRef.current = null
        scrabbleBroadcast()
      },
      onJoin(guestId, guestName) {
        if (scrabbleStartedRef.current) {
          scrabbleHostRef.current?.reject(guestId, 'Game already in progress.')
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
      const psBeforeWait = scrabbleSessionRef.current!.session.publicState
      // A human at the table can still challenge this placement, and this
      // bot is about to act on it (challenge it, or -- if it declines --
      // immediately play its own word over it). Give the table the longer
      // read-and-react window instead of routine turn pacing.
      const pendingChallengeForHuman =
        psBeforeWait.lastPlacement !== null &&
        psBeforeWait.lastPlacement.challengeable &&
        psBeforeWait.lastPlacement.by !== botId &&
        psBeforeWait.turn.playerOrder.some((pid) => !scrabbleBotSeatsRef.current.has(pid))
      const holdRemaining = scrabbleBotsHeldUntilRef.current - Date.now()
      await wait(holdRemaining > 0 ? holdRemaining : pendingChallengeForHuman ? SCRABBLE_CHALLENGE_WINDOW_MS : BASE_MS)
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
      if (!result.outcome.ok) {
        const reason = result.outcome.reason ?? 'that move is not allowed'
        scrabbleRejectionNoticeRef.current = reason
        setScrabbleNotice(reason)
        return
      }
      // Only clear the notice if it's still the rejection message this same
      // function set -- don't stomp an unrelated notice (e.g. a disconnect
      // banner) that may have arrived since.
      if (scrabbleNotice !== null && scrabbleNotice === scrabbleRejectionNoticeRef.current) {
        setScrabbleNotice(null)
      }
      scrabbleRejectionNoticeRef.current = null
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
    if (ps.stage !== 'over') return
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
    // Only the very first roll of this call is the start of a fresh turn — it's the one that
    // follows the PREVIOUS seat's bank/bust cue (see FARKLE_TURN_START_EXTRA_MS above). Every
    // later iteration is a mid-turn re-roll (hot dice or "roll again"), which only ever follows
    // this same bot's own plain dice-roll/hot-dice cue, already cleared by FARKLE_ACTION_MS.
    let freshTurn = true
    while (!stale(key)) {
      const pace = roomRef.current!.botPace
      const rollWaitMs = FARKLE_ACTION_MS + (freshTurn ? FARKLE_TURN_START_EXTRA_MS : 0)
      freshTurn = false
      await wait(rollWaitMs * pace)
      if (stale(key)) return
      const rolled = hostApply({ type: 'farkleRoll' }, seatId)
      if (!rolled) return
      if (rolled.farkle.farkle) {
        await wait(FARKLE_ACTION_MS * pace)
        if (stale(key)) return
        hostApply({ type: 'farkleEndTurn' }, seatId)
        return
      }
      const seat = rolled.seats.find((s) => s.id === seatId)!
      const move = decideFarkleBot(
        rolled.farkle.dice.map((d) => d.val), rolled.farkle.turnScore, seat.score,
        rolled.farkle.openingScore, rolled.farkle.winningScore, rolled.botDifficulty,
      )
      await wait(FARKLE_DECIDE_MS * pace)
      if (stale(key)) return
      let cur = rolled
      for (const idx of move.keepIndices) {
        const dieId = cur.farkle.dice[idx].id
        const next = hostApply({ type: 'farkleToggle', dieId }, seatId)
        if (!next) return
        cur = next
      }
      await wait(FARKLE_DECIDE_MS * pace)
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
    await wait(TTT_ACTION_MS * pace)
    if (stale(key)) return
    const state = roomRef.current!
    const me = state.seats.findIndex((s) => s.id === seatId)
    const opponent = state.seats.findIndex((s) => s.id !== seatId)
    const cell = decideTttMove(state.ttt.board, me, opponent)
    hostApply({ type: 'tttPlay', cell }, seatId)
  }

  async function runConnect4Bot(seatId: string, key: string) {
    const pace = roomRef.current!.botPace
    await wait(CONNECT4_ACTION_MS * pace)
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
    if (dominoesRole !== 'host' || dominoesView?.kind !== 'game') return
    runDominoesBotsIfNeeded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dominoesRole, dominoesView])

  // Round transition (pause then start next round)
  useEffect(() => {
    if (dominoesRole !== 'host' || dominoesView?.kind !== 'game') return
    if (dominoesView.publicState.stage === 'roundEnd' && !dominoesView.publicState.matchWinnerId) {
      const t = setTimeout(() => {
        const result = applyDominoesAction(dominoesSessionRef.current!, dominoesLocalPlayerId!, { type: 'START_NEXT_ROUND' })
        if (result.outcome.ok) {
          dominoesSessionRef.current = result.dm
          dominoesBroadcast()
        }
      }, ROUND_PAUSE_MS)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dominoesRole, dominoesView?.kind === 'game' ? dominoesView.publicState.stage : undefined, dominoesView?.kind === 'game' ? dominoesView.publicState.matchWinnerId : undefined])

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

  // ---- Blackjack effects (host-only) ----

  // Bot turn trigger. Blackjack has phases (betting, insurance, acting) with
  // no single current player in some phases, so the actor key and loop shape
  // differ from single-current-player games.
  useEffect(() => {
    if (blackjackRole !== 'host' || !blackjackView || blackjackView.kind !== 'game') return
    runBlackjackBotsIfNeeded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blackjackRole, blackjackView])

  // Bot turn trigger for Hold'em (single current-player pattern like Rummy)
  useEffect(() => {
    if (holdemRole !== 'host' || !holdemView || holdemView.kind !== 'game') return
    runHoldemBotsIfNeeded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdemRole, holdemView])

  // ---- Render ----

  // Landing: dice games, Rummy, Phase 10, Battleship, Dominoes, Wahoo,
  // Checkers, Mexican Train, Chess, Uno, Skip-Bo, Blackjack, Hold'em, Solitaire, and Scrabble are all not yet in a session
  if (!room && !rummyRole && !phase10Role && !battleshipRole && !dominoesRole && !wahooRole && !checkersRole && !mtRole && !chessRole && !unoRole && !skipBoRole && !blackjackRole && !holdemRole && !solitaireOpen && !scrabbleRole) {
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
          else if (code.startsWith('BK-')) startBlackjackGuest(code)
          else if (code.startsWith('HE-')) startHoldemGuest(code)
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
        onPickBlackjack={startBlackjackHost}
        onPickHoldem={startHoldemHost}
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
  if (battleshipView?.kind === 'game' && battleshipView.publicState.stage === 'over' && battleshipView.publicState.winnerId) {
    return (
      <BattleshipResults
        localPlayerId={battleshipLocalPlayerId ?? ''}
        localName={name}
        opponentName={battleshipOpponentName}
        publicState={battleshipView.publicState}
        isHost={battleshipRole === 'host'}
        notice={battleshipNotice ?? error}
        onRematch={battleshipRematch}
        onBackToShelf={resetToEntry}
      />
    )
  }

  // Battleship table (active match)
  if (battleshipView?.kind === 'game' && battleshipLocalPlayerId) {
    return (
      <BattleshipTable
        code={battleshipCode}
        localPlayerId={battleshipLocalPlayerId}
        opponentName={battleshipOpponentName}
        opponentColor="#1a6fae"
        connection={battleshipConnection}
        notice={battleshipNotice ?? error}
        publicState={battleshipView.publicState}
        board={battleshipView.privateState.board}
        onPlaceFleet={(b: (ShipId | null)[]) => battleshipDispatch({ type: 'PLACE_FLEET', board: b })}
        onFire={(cell) => battleshipDispatch({ type: 'FIRE', cell })}
        onLeave={resetToEntry}
      />
    )
  }

  // ---- Dominoes session active ----
  const DOMINOES_SEAT_INKS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308']

  // Dominoes lobby — 2 to 4 seats. Host sees seats from state; guests see the
  // lobby view the host broadcasts (buttons hidden either way).
  if (dominoesRole && !dominoesStarted) {
    const roster = dominoesRole === 'host'
      ? dominoesSeats.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === dominoesLocalPlayerId }))
      : (dominoesView?.kind === 'lobby' ? dominoesView.roster : [])
    return (
      <DominoesRoom
        code={dominoesCode}
        localName={name}
        isHost={dominoesRole === 'host'}
        seats={roster}
        notice={dominoesNotice ?? error}
        onAddHouseBot={addDominoesHouseBot}
        onStartGame={dominoesStart}
        onLeave={resetToEntry}
      />
    )
  }

  // Dominoes match results
  if (dominoesView?.kind === 'game' && dominoesView.publicState.stage === 'over' && dominoesView.publicState.matchWinnerId) {
    const dominoesColors = Object.fromEntries(dominoesView.publicState.seatOrder.map((id, i) => [id, DOMINOES_SEAT_INKS[i]]))
    return (
      <DominoesResults
        localPlayerId={dominoesLocalPlayerId ?? ''}
        localName={name}
        names={dominoesView.names}
        colors={dominoesColors}
        publicState={dominoesView.publicState}
        isHost={dominoesRole === 'host'}
        notice={dominoesNotice ?? error}
        onRematch={dominoesRematch}
        onBackToShelf={resetToEntry}
      />
    )
  }

  // Dominoes table (active match)
  if (dominoesView?.kind === 'game' && dominoesLocalPlayerId) {
    const dominoesColors = Object.fromEntries(dominoesView.publicState.seatOrder.map((id, i) => [id, DOMINOES_SEAT_INKS[i]]))
    return (
      <DominoesTable
        code={dominoesCode}
        localPlayerId={dominoesLocalPlayerId}
        names={dominoesView.names}
        colors={dominoesColors}
        connection={dominoesConnection}
        notice={dominoesNotice ?? error}
        publicState={dominoesView.publicState}
        hand={dominoesView.privateState.hand.cards satisfies DominoTile[]}
        onPlayTile={(tileId, arm: DominoArm | 'center') => dominoesDispatch({ type: 'PLAY_TILE', tileId, arm })}
        onDraw={() => dominoesDispatch({ type: 'DRAW_TILE' })}
        onPass={() => dominoesDispatch({ type: 'PASS' })}
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
        notice={checkersNotice ?? error}
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
        notice={checkersNotice ?? error}
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
        notice={checkersNotice ?? error}
        publicState={checkersView.publicState}
        onMove={(from, to) => checkersDispatch({ type: 'MOVE', from, to })}
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
        notice={chessNotice ?? error}
        difficulty={chessDifficulty}
        onSetDifficulty={(d) => { setChessDifficulty(d); chessDifficultyRef.current = d }}
        onAddHouseBot={addChessHouseBot}
        onLeave={resetToEntry}
      />
    )
  }

  // Chess match results
  if (chessView?.kind === 'game' && chessView.publicState.stage === 'over' && chessView.publicState.outcome) {
    return (
      <ChessResults
        localPlayerId={chessLocalPlayerId ?? ''}
        localName={name}
        opponentName={chessOpponentName}
        publicState={chessView.publicState}
        isHost={chessRole === 'host'}
        notice={chessNotice ?? error}
        onRematch={chessRematch}
        onBackToShelf={resetToEntry}
      />
    )
  }

  // Chess table (active match). Board is public — nothing to hide per player.
  if (chessView?.kind === 'game' && chessLocalPlayerId) {
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
        notice={chessNotice ?? error}
        publicState={chessView.publicState}
        onMove={(from, to, promotion) => chessDispatch({ type: 'MOVE', from, to, ...(promotion !== undefined ? { promotion } : {}) })}
        onResign={() => chessDispatch({ type: 'RESIGN' })}
        onOfferDraw={() => chessDispatch({ type: 'OFFER_DRAW' })}
        onAcceptDraw={() => chessDispatch({ type: 'ACCEPT_DRAW' })}
        onDeclineDraw={() => chessDispatch({ type: 'DECLINE_DRAW' })}
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

  // ---- Blackjack session active ----
  // Blackjack lobby — 2 to 6 seats. Host sees seats from state; guests see the
  // lobby view the host broadcasts (buttons hidden either way).
  if (blackjackRole && !blackjackStarted) {
    const roster = blackjackRole === 'host'
      ? blackjackSeats.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === blackjackLocalPlayerId }))
      : (blackjackView?.kind === 'lobby' ? blackjackView.roster : [])
    const viewCardBack = blackjackRole === 'host'
      ? rummyCardBack
      : (blackjackView?.kind === 'lobby' ? blackjackView.cardBack : DEFAULT_CARD_BACK)
    return (
      <BlackjackRoom
        code={blackjackCode}
        localName={name}
        isHost={blackjackRole === 'host'}
        seats={roster}
        notice={blackjackNotice ?? error}
        cardBack={viewCardBack}
        onSelectCardBack={blackjackSetCardBack}
        onAddHouseBot={addBlackjackHouseBot}
        onStartGame={blackjackStart}
        onLeave={resetToEntry}
      />
    )
  }

  // Blackjack table (active game)
  if (blackjackView?.kind === 'game' && blackjackLocalPlayerId) {
    const blackjackColors = Object.fromEntries(blackjackView.publicState.seatOrder.map((id, i) => [id, BLACKJACK_SEAT_INKS[i]]))
    return (
      <BlackjackTable
        code={blackjackCode}
        localPlayerId={blackjackLocalPlayerId}
        localName={name}
        names={blackjackView.names}
        colors={blackjackColors}
        connection={blackjackConnection}
        notice={blackjackNotice ?? error}
        publicState={blackjackView.publicState}
        onPlaceBet={(amount) => blackjackDispatch({ type: 'PLACE_BET', amount })}
        onTakeInsurance={() => blackjackDispatch({ type: 'TAKE_INSURANCE' })}
        onDeclineInsurance={() => blackjackDispatch({ type: 'DECLINE_INSURANCE' })}
        onHit={() => blackjackDispatch({ type: 'HIT' })}
        onStand={() => blackjackDispatch({ type: 'STAND' })}
        onDouble={() => blackjackDispatch({ type: 'DOUBLE' })}
        onSplit={() => blackjackDispatch({ type: 'SPLIT' })}
        onStartNextRound={() => blackjackDispatch({ type: 'START_NEXT_ROUND' })}
        onLeaveTable={resetToEntry}
      />
    )
  }

  // Hold'em lobby
  if (holdemRole && !holdemStarted) {
    const roster = holdemRole === 'host'
      ? holdemSeats.map((s) => ({ name: s.name, isBot: s.isBot, isHost: s.playerId === holdemLocalPlayerId }))
      : (holdemView?.kind === 'lobby' ? holdemView.roster : [])
    const viewCardBack = holdemRole === 'host'
      ? holdemCardBackRef.current
      : (holdemView?.kind === 'lobby' ? holdemView.cardBack : DEFAULT_CARD_BACK)
    return (
      <HoldemRoom
        code={holdemCode}
        localName={name}
        isHost={holdemRole === 'host'}
        seats={roster}
        notice={holdemNotice ?? error}
        cardBack={viewCardBack}
        onSelectCardBack={holdemSetCardBack}
        onAddHouseBot={addHoldemHouseBot}
        onStartGame={holdemStart}
        onLeave={resetToEntry}
      />
    )
  }

  // Hold'em table (active game)
  if (holdemView?.kind === 'game' && holdemLocalPlayerId) {
    const holdemColors = Object.fromEntries(holdemView.publicState.seatOrder.map((id, i) => [id, HOLDEM_SEAT_INKS[i]]))
    return (
      <HoldemTable
        code={holdemCode}
        localPlayerId={holdemLocalPlayerId}
        names={holdemView.names}
        colors={holdemColors}
        connection={holdemConnection}
        notice={holdemNotice ?? error}
        publicState={holdemView.publicState}
        privateState={holdemView.privateState}
        onFold={() => holdemDispatch({ type: 'FOLD' })}
        onCheck={() => holdemDispatch({ type: 'CHECK' })}
        onCall={() => holdemDispatch({ type: 'CALL' })}
        onBet={(amount) => holdemDispatch({ type: 'BET', amount })}
        onRaise={(amount) => holdemDispatch({ type: 'RAISE', amount })}
        onStartNextHand={() => holdemDispatch({ type: 'START_NEXT_HAND' })}
        onLeaveTable={resetToEntry}
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
