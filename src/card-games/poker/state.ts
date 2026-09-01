import type { Card } from '../../card-engine/cards.ts'
import type { TurnState } from '../../engine/turn-engine.ts'
import type { HostSession } from '../../engine/sync.ts'
import { createStandardDeck, shuffleDeck, dealCards } from '../../card-engine/deck.ts'
import { createTurnState } from '../../engine/turn-engine.ts'
import { createHostSession } from '../../engine/sync.ts'
import { createRng } from '../../engine/rng.ts'

export type PokerVariant = 'holdem' | 'five-draw' | 'seven-draw'

export type PokerStreet =
  | 'preflop'
  | 'flop'
  | 'turn'
  | 'river'
  | 'firstBet'
  | 'draw'
  | 'secondBet'
  | 'showdown'
  | 'handOver'

export interface PokerPlayerHandState {
  cards: Card[] // always the variant's hand size once dealt this hand (2 holdem / 5 five-draw / 7 seven-draw), [] before dealt / after fold+reveal-not-needed
  folded: boolean
  allIn: boolean
  totalContributedThisHand: number // across all streets, for side-pot math
  betThisStreet: number // resets to 0 at the start of each new street
}

export interface PokerPublicState {
  turn: TurnState<PokerStreet> // playerOrder = seats still able to act THIS STREET (folded/all-in seats excluded from rotation but not from the hand)
  seatOrder: string[] // fixed table seat order
  chips: Record<string, number>
  eliminated: Record<string, boolean>
  buttonSeat: string
  smallBlindSeat: string
  bigBlindSeat: string
  hands: Record<string, PokerPlayerHandState>
  board: Card[] // 0, 3, 4, or 5 cards depending on street
  pot: number // total chips in the middle this hand (all streets combined)
  currentBetThisStreet: number
  lastFullRaiseIncrement: number
  handNumber: number
  handOver: boolean
  actedThisStreet: Record<string, boolean> // tracks which seats have voluntarily acted this street (resets per street, blinds don't count as acting)
  reRaiseEligible: Record<string, boolean> // true = this seat may still RAISE (hasn't yet acted since the last FULL bet/raise). A short all-in raise does not reset this for anyone; only a full bet/raise reopens it (true) for every other seat. Prevents a player who already called/checked from re-raising just because a later short all-in nominally reopened their turn.
  handResults:
    | {
        winners: { playerId: string; amount: number }[]
        potBreakdown: { amount: number; eligiblePlayerIds: string[]; winnerIds: string[] }[]
      }
    | null
  gameOverWinnerId: string | null
  cardBack: string
  variant: PokerVariant
  drawnCounts: Record<string, number | null> // null = has not drawn this hand; a number = how many cards they discarded. Reset for all seats every hand (holdem hands keep them all null forever).
}

export interface PokerPrivateState {
  hand: Card[]
}

export interface PokerSession {
  session: HostSession<PokerPublicState, PokerPrivateState>
  deck: Card[]
  rng: () => number
}

export type PokerAction =
  | { type: 'FOLD' }
  | { type: 'CHECK' }
  | { type: 'CALL' }
  | { type: 'BET'; amount: number }
  | { type: 'RAISE'; amount: number }
  | { type: 'DRAW'; discardIds: string[] }
  | { type: 'START_NEXT_HAND' }

export const POKER_MIN_SEATS = 2
export const POKER_MAX_SEATS = 8
export const POKER_SMALL_BLIND = 5
export const POKER_BIG_BLIND = 10
const STARTING_CHIPS = 1000

// Number of private cards dealt to each seat at the start of a hand
export function handSizeFor(variant: PokerVariant): number {
  if (variant === 'holdem') return 2
  if (variant === 'five-draw') return 5
  return 7
}

// Max seats a variant supports. POKER_MAX_SEATS stays 8 for holdem; draw
// variants cap lower so a full table of max draws can never exhaust the deck.
export function maxSeatsFor(variant: PokerVariant): number {
  if (variant === 'holdem') return 8
  if (variant === 'five-draw') return 6
  return 5
}

// Track which seats are still able to act in the current betting round
// (excludes folded and all-in players, but includes button/blinds who may still act)
function getActingSeats(publicState: PokerPublicState): string[] {
  return publicState.seatOrder.filter(
    (seatId) =>
      !publicState.hands[seatId].folded &&
      !publicState.hands[seatId].allIn &&
      publicState.chips[seatId] > 0,
  )
}

// Get the next non-eliminated seat after a given seat
function getNextNonEliminatedSeat(seatOrder: string[], currentSeat: string, eliminated: Record<string, boolean>): string {
  const currentIndex = seatOrder.indexOf(currentSeat)
  if (currentIndex === -1) return seatOrder[0]

  for (let i = 1; i < seatOrder.length; i++) {
    const nextIndex = (currentIndex + i) % seatOrder.length
    if (!eliminated[seatOrder[nextIndex]]) {
      return seatOrder[nextIndex]
    }
  }
  // All seats eliminated except the current one
  return currentSeat
}

// Initialize a new hand of poker
export function createPokerGame(
  playerIds: string[],
  seed: number,
  cardBack = 'pips_default',
  variant: PokerVariant = 'holdem',
): PokerSession {
  if (playerIds.length < POKER_MIN_SEATS || playerIds.length > maxSeatsFor(variant)) {
    throw new Error(`${variant} supports ${POKER_MIN_SEATS}-${maxSeatsFor(variant)} seats, got ${playerIds.length}`)
  }
  const rng = createRng(seed)
  let deck = shuffleDeck(createStandardDeck(), rng)

  const seatOrder = playerIds
  const chips: Record<string, number> = {}
  const eliminated: Record<string, boolean> = {}
  const hands: Record<string, PokerPlayerHandState> = {}
  const privateStates: Record<string, PokerPrivateState> = {}

  for (const playerId of seatOrder) {
    chips[playerId] = STARTING_CHIPS
    eliminated[playerId] = false
    hands[playerId] = {
      cards: [],
      folded: false,
      allIn: false,
      totalContributedThisHand: 0,
      betThisStreet: 0,
    }
    privateStates[playerId] = { hand: [] }
  }

  const buttonSeat = seatOrder[0]
  // Heads-up special case: button is SB, other player is BB
  let smallBlindSeat: string
  let bigBlindSeat: string
  if (seatOrder.length === 2) {
    smallBlindSeat = buttonSeat
    bigBlindSeat = seatOrder[1]
  } else {
    smallBlindSeat = getNextNonEliminatedSeat(seatOrder, buttonSeat, eliminated)
    bigBlindSeat = getNextNonEliminatedSeat(seatOrder, smallBlindSeat, eliminated)
  }

  // Post blinds
  const sbAmount = Math.min(POKER_SMALL_BLIND, chips[smallBlindSeat])
  const bbAmount = Math.min(POKER_BIG_BLIND, chips[bigBlindSeat])
  chips[smallBlindSeat] -= sbAmount
  chips[bigBlindSeat] -= bbAmount
  hands[smallBlindSeat].betThisStreet = sbAmount
  hands[smallBlindSeat].totalContributedThisHand = sbAmount
  hands[bigBlindSeat].betThisStreet = bbAmount
  hands[bigBlindSeat].totalContributedThisHand = bbAmount
  hands[smallBlindSeat].allIn = chips[smallBlindSeat] === 0
  hands[bigBlindSeat].allIn = chips[bigBlindSeat] === 0

  const pot = sbAmount + bbAmount

  // Deal private cards to all non-eliminated players. Cards go ONLY into the
  // private per-seat channel -- publicState.hands[seatId].cards stays empty
  // (its initial value) until a genuine showdown reveal. The public state is
  // broadcast to every connected peer verbatim; writing real cards into it
  // here would leak every seat's cards to every other seat regardless of what
  // the UI chooses to render.
  const activeSeats = seatOrder.filter((seatId) => !eliminated[seatId])
  for (const seatId of activeSeats) {
    const { dealt: dealtCards, remaining } = dealCards(deck, handSizeFor(variant))
    deck = remaining
    privateStates[seatId].hand = dealtCards
  }

  // Determine opening action order: starts left of BB (same for holdem preflop
  // and draw firstBet)
  let preflopOrder = [...activeSeats]
  const bbIndex = preflopOrder.indexOf(bigBlindSeat)
  if (bbIndex !== -1) {
    const nextIndex = (bbIndex + 1) % preflopOrder.length
    preflopOrder = [...preflopOrder.slice(nextIndex), ...preflopOrder.slice(0, nextIndex)]
  }
  const preflopActing = preflopOrder.filter((seatId) => !hands[seatId].folded && !hands[seatId].allIn)

  const initialPhase: PokerStreet = variant === 'holdem' ? 'preflop' : 'firstBet'
  const turn = createTurnState<PokerStreet>(preflopActing, initialPhase)

  const actedThisStreet: Record<string, boolean> = {}
  const reRaiseEligible: Record<string, boolean> = {}
  const drawnCounts: Record<string, number | null> = {}
  for (const seatId of seatOrder) {
    actedThisStreet[seatId] = false
    reRaiseEligible[seatId] = true
    drawnCounts[seatId] = null
  }

  const publicState: PokerPublicState = {
    turn,
    seatOrder,
    chips,
    eliminated,
    buttonSeat,
    smallBlindSeat,
    bigBlindSeat,
    hands,
    board: [],
    pot,
    currentBetThisStreet: bbAmount,
    lastFullRaiseIncrement: POKER_BIG_BLIND,
    handNumber: 1,
    handOver: false,
    actedThisStreet,
    reRaiseEligible,
    handResults: null,
    gameOverWinnerId: null,
    cardBack,
    variant,
    drawnCounts,
  }

  return { session: createHostSession(publicState, privateStates), deck, rng }
}

export { getActingSeats, getNextNonEliminatedSeat }
