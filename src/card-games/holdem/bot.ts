import type { BotStrategy } from '../../engine/bot.ts'
import { evaluateBestHand } from './hand-eval.ts'
import type { HoldemPublicState, HoldemPrivateState, HoldemAction } from './state.ts'
import { HOLDEM_BIG_BLIND } from './state.ts'

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

export const holdemBotStrategy: BotStrategy<HoldemPublicState, HoldemPrivateState, HoldemAction> = (publicState, privateState, playerId) => {
  const playerHand = publicState.hands[playerId]
  const holeCards = privateState.hand

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
        const betAmount = Math.min(HOLDEM_BIG_BLIND * 2, playerChips)
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
        const minIncrement = Math.max(publicState.lastFullRaiseIncrement, HOLDEM_BIG_BLIND)
        const raiseAmount = Math.min(currentBet + minIncrement, playerChips + playerBetThisStreet)
        return { type: 'RAISE', amount: raiseAmount }
      } else if (strength === 'premium' || strength === 'good') {
        // Call
        return { type: 'CALL' }
      } else {
        // Fold (unless it's just the big blind to call)
        if (amountToCall <= HOLDEM_BIG_BLIND && currentBet <= HOLDEM_BIG_BLIND) {
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
        const betAmount = Math.min(HOLDEM_BIG_BLIND, playerChips)
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
