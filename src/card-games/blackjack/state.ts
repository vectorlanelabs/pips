import type { Card } from '../../card-engine/cards.ts'
import type { TurnState } from '../../engine/turn-engine.ts'
import type { HostSession } from '../../engine/sync.ts'
import { createStandardDeck, shuffleDeck } from '../../card-engine/deck.ts'
import { createTurnState } from '../../engine/turn-engine.ts'
import { createHostSession } from '../../engine/sync.ts'
import { createRng } from '../../engine/rng.ts'

export type BlackjackPhase = 'betting' | 'insurance' | 'acting' | 'dealerPlay' | 'roundOver'

export interface BlackjackHand {
  id: string
  cards: Card[]
  bet: number
  doubled: boolean
  isSplitHand: boolean
  fromSplitOf: string | null
  done: boolean
  result: 'blackjack' | 'win' | 'push' | 'lose' | null
}

export interface BlackjackPublicState {
  turn: TurnState<BlackjackPhase>
  seatOrder: string[]
  chips: Record<string, number>
  bets: Record<string, number>
  sittingOut: Record<string, boolean>
  hands: Record<string, BlackjackHand[]>
  activeHandIndex: Record<string, number>
  insuranceBets: Record<string, number>
  dealerHand: Card[]
  dealerHoleRevealed: boolean
  shoeCount: number
  roundNumber: number
  roundResults: Record<string, { handIndex: number; result: BlackjackHand['result']; chipDelta: number }[]> | null
  cardBack: string
  hasResolvedInsurance: Record<string, boolean>  // tracks who has resolved insurance in insurance phase
}

export interface BlackjackPrivateState {
  // No private information needed for Blackjack
}

export interface BlackjackSession {
  session: HostSession<BlackjackPublicState, BlackjackPrivateState>
  shoe: Card[]
  rng: () => number
}

export type BlackjackAction =
  | { type: 'PLACE_BET'; amount: number }
  | { type: 'TAKE_INSURANCE' }
  | { type: 'DECLINE_INSURANCE' }
  | { type: 'HIT' }
  | { type: 'STAND' }
  | { type: 'DOUBLE' }
  | { type: 'SPLIT' }
  | { type: 'START_NEXT_ROUND' }

export const BLACKJACK_MIN_SEATS = 2
export const BLACKJACK_MAX_SEATS = 6
export const BLACKJACK_MIN_BET = 10
export const BLACKJACK_MAX_BET = 500
const STARTING_CHIPS = 1000
const SHOE_RESHUFFLE_THRESHOLD = Math.floor(6 * 52 * 0.25) // 0.25 * 312 = 78

export function createBlackjackGame(playerIds: string[], seed: number, cardBack = 'pips_default'): BlackjackSession {
  const rng = createRng(seed)
  const shoe = shuffleDeck(createStandardDeck({ numberOfDecks: 6 }), rng)

  const seatOrder = playerIds
  const chips: Record<string, number> = {}
  const bets: Record<string, number> = {}
  const sittingOut: Record<string, boolean> = {}
  const hands: Record<string, BlackjackHand[]> = {}
  const activeHandIndex: Record<string, number> = {}
  const insuranceBets: Record<string, number> = {}
  const privateStates: Record<string, BlackjackPrivateState> = {}

  for (const playerId of seatOrder) {
    chips[playerId] = STARTING_CHIPS
    bets[playerId] = 0
    sittingOut[playerId] = false
    hands[playerId] = []
    activeHandIndex[playerId] = 0
    insuranceBets[playerId] = 0
    privateStates[playerId] = {}
  }

  // Betting phase: turn player order is filtered from seatOrder in rules.ts
  // Start with betting phase; empty player order gets filled in during betting setup
  const turn = createTurnState<BlackjackPhase>([], 'betting')

  const publicState: BlackjackPublicState = {
    turn,
    seatOrder,
    chips,
    bets,
    sittingOut,
    hands,
    activeHandIndex,
    insuranceBets,
    dealerHand: [],
    dealerHoleRevealed: false,
    shoeCount: shoe.length,
    roundNumber: 1,
    roundResults: null,
    cardBack,
    hasResolvedInsurance: {},
  }

  return { session: createHostSession(publicState, privateStates), shoe, rng }
}

export function shouldReshuffleBefore(shoeCount: number): boolean {
  return shoeCount < SHOE_RESHUFFLE_THRESHOLD
}
