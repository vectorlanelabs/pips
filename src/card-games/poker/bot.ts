import type { BotStrategy } from '../../engine/bot.ts'
import type { Card } from '../../card-engine/cards.ts'
import { evaluateBestHand } from './hand-eval.ts'
import type { PokerPublicState, PokerPrivateState, PokerAction } from './state.ts'
import { POKER_BIG_BLIND } from './state.ts'

// Preflop hand strength categories
function getPreflopStrength(holeCards: { rank: string }[]): 'premium' | 'good' | 'weak' {
  if (holeCards.length !== 2) return 'weak'

  const [c1, c2] = holeCards
  const r1 = c1.rank
  const r2 = c2.rank

  // Premium: pairs, AK, AQ
  if (r1 === r2 && (r1 === 'A' || r1 === 'K' || r1 === 'Q' || r1 === 'J')) return 'premium'
  if ((r1 === 'A' && (r2 === 'K' || r2 === 'Q')) || (r2 === 'A' && (r1 === 'K' || r1 === 'Q'))) return 'premium'

  // Good: pairs, A/K/Q high cards
  if (r1 === r2) return 'good' // Any pair
  if ((r1 === 'A' || r1 === 'K' || r1 === 'Q') && (r2 === 'A' || r2 === 'K' || r2 === 'Q')) return 'good'

  return 'weak'
}

// Postflop hand strength
function getPostflopHandStrength(holeCards: Array<{ rank: string; suit: string; id: string; deckIndex: number }>, boardCards: Array<{ rank: string; suit: string; id: string; deckIndex: number }>): 'strong' | 'medium' | 'weak' {
  if (holeCards.length !== 2 || boardCards.length < 3) return 'weak'

  try {
    const hand = evaluateBestHand(holeCards, boardCards)

    // Strong: at least a pair (category 1+)
    if (hand.category >= 1) {
      return 'strong'
    }

    // Medium: 4+ cards to flush (4 hole + board) or 4+ to straight - for now simplify
    // Count flush and straight draws
    const suits: Record<string, number> = {}
    for (const c of [...holeCards, ...boardCards]) {
      suits[c.suit] = (suits[c.suit] ?? 0) + 1
    }
    const hasFlushDraw = Object.values(suits).some((count) => count >= 4)

    if (hasFlushDraw && boardCards.length >= 2) {
      return 'medium'
    }

    return 'weak'
  } catch (e) {
    // Board not complete yet
    return 'weak'
  }
}

// ---- Draw variant strategy ----

// Rank order low-to-high for draw discard decisions. hand-eval keeps its rank
// table private; a small local map is fine (the spec allows either).
const RANK_ORDER: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 }

function rankValue(rank: string): number {
  return RANK_ORDER[rank] ?? 0
}

// The cards NOT in keepIds, lowest rank first, at most 3.
function discardLowestFirst(hand: Card[], keepIds: Set<string>): string[] {
  return hand
    .filter((c) => !keepIds.has(c.id))
    .sort((a, b) => rankValue(a.rank) - rankValue(b.rank))
    .slice(0, 3)
    .map((c) => c.id)
}

// Deterministic discard policy for the draw round (five-draw and seven-draw).
// Exported so the policy unit tests can construct hands directly.
export function drawDiscardAction(hand: Card[]): PokerAction {
  const category = evaluateBestHand(hand, []).category

  // Straight or better: stand pat.
  if (category >= 4) {
    return { type: 'DRAW', discardIds: [] }
  }

  // Any rank appearing 2+ times (pair, two pair, trips, full house, quads):
  // keep every such card, discard the rest -- lowest ranks first, at most 3.
  const rankCounts: Record<string, number> = {}
  for (const c of hand) {
    rankCounts[c.rank] = (rankCounts[c.rank] ?? 0) + 1
  }
  const pairedRanks = new Set(
    Object.entries(rankCounts)
      .filter(([, count]) => count >= 2)
      .map(([rank]) => rank),
  )
  if (pairedRanks.size > 0) {
    const keepIds = new Set(hand.filter((c) => pairedRanks.has(c.rank)).map((c) => c.id))
    return { type: 'DRAW', discardIds: discardLowestFirst(hand, keepIds) }
  }

  // 4+ cards of one suit: keep the 4 highest of that suit.
  const bySuit: Record<string, Card[]> = {}
  for (const c of hand) {
    if (!bySuit[c.suit]) bySuit[c.suit] = []
    bySuit[c.suit].push(c)
  }
  const flushSuitCards = Object.values(bySuit).find((cards) => cards.length >= 4)
  if (flushSuitCards) {
    const keepIds = new Set(
      [...flushSuitCards]
        .sort((a, b) => rankValue(b.rank) - rankValue(a.rank))
        .slice(0, 4)
        .map((c) => c.id),
    )
    return { type: 'DRAW', discardIds: discardLowestFirst(hand, keepIds) }
  }

  // 4 cards forming a run of consecutive ranks (ace high only: A is 14, so the
  // numeric check below never matches a wheel A-2-3-4). The highest run wins.
  const values = new Set(hand.map((c) => rankValue(c.rank)))
  for (let v = 11; v >= 2; v--) {
    if (values.has(v) && values.has(v + 1) && values.has(v + 2) && values.has(v + 3)) {
      const runValues = new Set([v, v + 1, v + 2, v + 3])
      const keepIds = new Set(hand.filter((c) => runValues.has(rankValue(c.rank))).map((c) => c.id))
      return { type: 'DRAW', discardIds: discardLowestFirst(hand, keepIds) }
    }
  }

  // High-card hand: discard the 3 lowest-ranked cards.
  return { type: 'DRAW', discardIds: discardLowestFirst(hand, new Set()) }
}

// Draw-variant betting for firstBet and secondBet (identical logic in both).
function drawBettingAction(publicState: PokerPublicState, privateState: PokerPrivateState, playerId: string): PokerAction {
  const playerHand = publicState.hands[playerId]
  const currentBet = publicState.currentBetThisStreet
  const playerBetThisStreet = playerHand.betThisStreet
  const playerChips = publicState.chips[playerId]

  const cat = evaluateBestHand(privateState.hand, []).category

  // Unopened street (secondBet opens at 0; firstBet always faces the big blind).
  if (currentBet === 0) {
    if (cat >= 3) {
      return { type: 'BET', amount: Math.min(POKER_BIG_BLIND * 2, playerChips) }
    }
    if (cat === 2) {
      return { type: 'BET', amount: Math.min(POKER_BIG_BLIND, playerChips) }
    }
    return { type: 'CHECK' }
  }

  const amountToCall = currentBet - playerBetThisStreet
  if (amountToCall <= 0) {
    return { type: 'CHECK' }
  }

  // Trips or better: raise by the legal minimum when allowed AND affordable,
  // else call. The affordability guard stops a short stack from emitting a
  // RAISE the validator would reject (raiseToAmount must exceed the current
  // bet); a rejected deterministic action would hang the bot loop forever --
  // same rationale as the reRaiseEligible guard in the holdem preflop branch.
  //
  // Street-size cap: two+ bots holding trips-or-better used to re-raise the
  // legal minimum back and forth until everyone was all-in (~25 raises,
  // minutes of paced 900ms beats). Stateless bots need a state-derived
  // throttle, so a strong hand only keeps raising while the street bet is
  // below 8 big blinds -- that bounds a street to a few raises while still
  // letting strong hands build real pots.
  if (cat >= 3) {
    if (
      publicState.reRaiseEligible[playerId] &&
      playerChips + playerBetThisStreet > currentBet &&
      publicState.currentBetThisStreet < POKER_BIG_BLIND * 8
    ) {
      const minIncrement = Math.max(publicState.lastFullRaiseIncrement, POKER_BIG_BLIND)
      const raiseAmount = Math.min(currentBet + minIncrement, playerChips + playerBetThisStreet)
      return { type: 'RAISE', amount: raiseAmount }
    }
    return { type: 'CALL' }
  }

  if (cat === 2) {
    return { type: 'CALL' }
  }

  if (cat === 1) {
    if (amountToCall <= POKER_BIG_BLIND * 2) {
      return { type: 'CALL' }
    }
    return { type: 'FOLD' }
  }

  // High card: only call the big-blind option.
  if (amountToCall <= POKER_BIG_BLIND && currentBet <= POKER_BIG_BLIND) {
    return { type: 'CALL' }
  }
  return { type: 'FOLD' }
}

export const pokerBotStrategy: BotStrategy<PokerPublicState, PokerPrivateState, PokerAction> = (publicState, privateState, playerId) => {
  const playerHand = publicState.hands[playerId]
  const holeCards = privateState.hand

  // Draw variants branch FIRST. The draw round is a DRAW action -- never CHECK
  // here: a rejected action would hang the deterministic bot loop forever (same
  // rationale as the reRaiseEligible comment below). firstBet/secondBet use
  // draw-variant betting over the whole private hand. Draw hands never fall
  // through to the holdem logic (whose holeCards.length !== 2 guard would
  // otherwise return CHECK for every 5/7-card hand).
  if (publicState.variant !== 'holdem') {
    if (publicState.turn.phase === 'draw') {
      return drawDiscardAction(holeCards)
    }
    if (publicState.turn.phase === 'firstBet' || publicState.turn.phase === 'secondBet') {
      return drawBettingAction(publicState, privateState, playerId)
    }
  }

  if (holeCards.length !== 2) {
    return { type: 'CHECK' }
  }

  const currentStreet = publicState.turn.phase
  const currentBet = publicState.currentBetThisStreet
  const playerBetThisStreet = playerHand.betThisStreet
  const playerChips = publicState.chips[playerId]

  // Preflop strategy
  if (currentStreet === 'preflop') {
    const strength = getPreflopStrength(holeCards)

    if (currentBet === 0) {
      // No bet yet, decide whether to bet or check
      if (strength === 'premium') {
        // Bet a small amount (2.5x BB)
        const betAmount = Math.min(POKER_BIG_BLIND * 2, playerChips)
        return { type: 'BET', amount: betAmount }
      } else if (strength === 'good') {
        // Check
        return { type: 'CHECK' }
      } else {
        // Check
        return { type: 'CHECK' }
      }
    } else {
      // Facing a bet
      const amountToCall = currentBet - playerBetThisStreet
      if (amountToCall <= 0) {
        return { type: 'CHECK' }
      }

      if (strength === 'premium' && publicState.reRaiseEligible[playerId]) {
        // Raise by at least the legal minimum increment (not a flat BB -- a
        // prior raise may have set a larger lastFullRaiseIncrement, and
        // raising by less than that would be rejected by the validator).
        // Only attempted when reRaiseEligible: a bot that already acted since
        // the last full raise (only a short all-in has happened since) is not
        // allowed to re-raise -- the validator would reject it every time,
        // and since this strategy is deterministic, a caller that blindly
        // retries a rejected action would retry the identical rejected
        // action forever, permanently hanging the bot's turn.
        const minIncrement = Math.max(publicState.lastFullRaiseIncrement, POKER_BIG_BLIND)
        const raiseAmount = Math.min(currentBet + minIncrement, playerChips + playerBetThisStreet)
        return { type: 'RAISE', amount: raiseAmount }
      } else if (strength === 'premium' || strength === 'good') {
        // Call
        return { type: 'CALL' }
      } else {
        // Fold (unless it's just the big blind to call)
        if (amountToCall <= POKER_BIG_BLIND && currentBet <= POKER_BIG_BLIND) {
          return { type: 'CALL' }
        }
        return { type: 'FOLD' }
      }
    }
  }

  // Postflop strategy (flop, turn, river)
  if (currentStreet === 'flop' || currentStreet === 'turn' || currentStreet === 'river') {
    const handStrength = getPostflopHandStrength(holeCards, publicState.board)

    if (currentBet === 0) {
      // No bet, decide to check or bet
      if (handStrength === 'strong') {
        // Bet
        const betAmount = Math.min(POKER_BIG_BLIND, playerChips)
        return { type: 'BET', amount: betAmount }
      } else {
        // Check
        return { type: 'CHECK' }
      }
    } else {
      // Facing a bet
      const amountToCall = currentBet - playerBetThisStreet
      if (amountToCall <= 0) {
        return { type: 'CHECK' }
      }

      if (handStrength === 'strong') {
        // Call (or raise with very strong hand)
        return { type: 'CALL' }
      } else if (handStrength === 'medium') {
        // Call
        return { type: 'CALL' }
      } else {
        // Fold
        return { type: 'FOLD' }
      }
    }
  }

  return { type: 'CHECK' }
}
