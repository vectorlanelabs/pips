import type { BotStrategy } from '../../engine/bot.ts'
import { handValue } from './hand-value.ts'
import type { BlackjackPublicState, BlackjackPrivateState, BlackjackAction } from './state.ts'
import { BLACKJACK_MIN_BET } from './state.ts'

export const blackjackBotStrategy: BotStrategy<BlackjackPublicState, BlackjackPrivateState, BlackjackAction> = (
  publicState: BlackjackPublicState,
  _privateState: BlackjackPrivateState,
  playerId: string,
): BlackjackAction => {
  const phase = publicState.turn.phase

  if (phase === 'betting') {
    // Always bet the table minimum
    return { type: 'PLACE_BET', amount: BLACKJACK_MIN_BET }
  }

  if (phase === 'insurance') {
    // Always decline insurance
    return { type: 'DECLINE_INSURANCE' }
  }

  if (phase === 'acting') {
    // Get current hand
    const hands = publicState.hands[playerId]
    const activeIndex = publicState.activeHandIndex[playerId]
    if (!hands || activeIndex >= hands.length) {
      throw new Error('invalid hand state')
    }

    const currentHand = hands[activeIndex]
    const value = handValue(currentHand.cards).total

    // HIT while total < 17, else STAND
    // Never DOUBLE or SPLIT per the spec
    if (value < 17) {
      return { type: 'HIT' }
    } else {
      return { type: 'STAND' }
    }
  }

  throw new Error(`unexpected phase: ${phase}`)
}
