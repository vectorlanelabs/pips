import type { Card } from '../../card-engine/cards.ts'
import type { ActionOutcome, ActionValidator } from '../../engine/sync.ts'
import { applyAction } from '../../engine/sync.ts'
import { runBotTurn, type BotStrategy } from '../../engine/bot.ts'
import { advanceTurn, currentPlayer, setPhase, createTurnState } from '../../engine/turn-engine.ts'
import { dealCards, shuffleDeck, drawCard, createStandardDeck } from '../../card-engine/deck.ts'
import { handValue, isBust, isNaturalBlackjack } from './hand-value.ts'
import type {
  BlackjackSession,
  BlackjackPublicState,
  BlackjackPrivateState,
  BlackjackAction,
  BlackjackHand,
  BlackjackPhase,
} from './state.ts'
import {
  BLACKJACK_MIN_BET,
  BLACKJACK_MAX_BET,
  shouldReshuffleBefore,
} from './state.ts'

// Called after every player hand is done; reveals hole card and plays dealer's hand
function dealerPlay(publicState: BlackjackPublicState, shoe: Card[]): { publicState: BlackjackPublicState; shoe: Card[] } {
  let currentShoe = shoe
  let dealerHand = [...publicState.dealerHand]

  // Reveal hole card
  let newPublicState = { ...publicState, dealerHoleRevealed: true }

  // Dealer hits while total < 17, stands on 17+ (including soft 17)
  while (handValue(dealerHand).total < 17) {
    const { card: drawn, remaining } = drawCard(currentShoe)
    if (drawn) {
      dealerHand = [...dealerHand, drawn]
      currentShoe = remaining
    } else {
      break
    }
  }

  newPublicState = { ...newPublicState, dealerHand }

  return { publicState: newPublicState, shoe: currentShoe }
}

// Resolve payouts for all hands
function settleRound(
  publicState: BlackjackPublicState,
): { publicState: BlackjackPublicState; results: Record<string, { handIndex: number; result: BlackjackHand['result']; chipDelta: number }[]> } {
  const newChips = { ...publicState.chips }
  const results: Record<string, { handIndex: number; result: BlackjackHand['result']; chipDelta: number }[]> = {}
  const dealerValue = handValue(publicState.dealerHand)
  const dealerBusted = isBust(publicState.dealerHand)
  const dealerHasNatural = isNaturalBlackjack(publicState.dealerHand)

  for (const seatId of publicState.seatOrder) {
    const seatHands = publicState.hands[seatId]
    const insuranceBet = publicState.insuranceBets[seatId]
    results[seatId] = []

    // If sitting out, no hands to settle
    if (publicState.sittingOut[seatId]) continue

    for (let handIndex = 0; handIndex < seatHands.length; handIndex++) {
      const hand = seatHands[handIndex]
      let result: 'blackjack' | 'win' | 'push' | 'lose' | null = null
      let chipDelta = 0

      // Payout precedence:
      // 1. Player busts: lose the bet
      if (isBust(hand.cards)) {
        result = 'lose'
        chipDelta = -hand.bet
      }
      // 2. Player has natural blackjack (2 cards, value 21, not a split hand)
      else if (!hand.isSplitHand && isNaturalBlackjack(hand.cards)) {
        if (dealerHasNatural) {
          result = 'push'
          chipDelta = 0
        } else {
          result = 'blackjack'
          chipDelta = Math.floor(hand.bet * 1.5)
        }
      }
      // 3. Dealer busts and player hand didn't
      else if (dealerBusted) {
        result = 'win'
        chipDelta = hand.bet
      }
      // 4. Compare totals
      else {
        const playerValue = handValue(hand.cards).total
        if (playerValue > dealerValue.total) {
          result = 'win'
          chipDelta = hand.bet
        } else if (playerValue < dealerValue.total) {
          result = 'lose'
          chipDelta = -hand.bet
        } else {
          result = 'push'
          chipDelta = 0
        }
      }

      const newHands = { ...publicState.hands }
      const seatHandsCopy = [...seatHands]
      seatHandsCopy[handIndex] = { ...hand, result }
      newHands[seatId] = seatHandsCopy

      newChips[seatId] = (newChips[seatId] ?? 0) + chipDelta
      results[seatId].push({ handIndex, result, chipDelta })
    }

    // Handle insurance payout: 2:1 if dealer has natural, otherwise lost
    if (insuranceBet > 0) {
      if (dealerHasNatural) {
        newChips[seatId] = (newChips[seatId] ?? 0) + insuranceBet * 2
      }
      // Insurance lost — no additional chip change; it was already deducted from chips
    }
  }

  return {
    publicState: { ...publicState, chips: newChips },
    results,
  }
}

function makeValidator(
  blackjackSession: BlackjackSession,
  onShoeChange: (newShoe: Card[]) => void,
): ActionValidator<BlackjackPublicState, BlackjackPrivateState, BlackjackAction> {
  return (session, playerId, action) => {
    const { publicState } = session
    const { shoe, rng } = blackjackSession
    const isBetting = publicState.turn.phase === 'betting'
    const isInsurance = publicState.turn.phase === 'insurance'
    const isActing = publicState.turn.phase === 'acting'
    const isRoundOver = publicState.turn.phase === 'roundOver'

    // START_NEXT_ROUND can be triggered by any seated player once the round is over
    if (action.type === 'START_NEXT_ROUND') {
      if (!Object.hasOwn(publicState.chips, playerId)) return { ok: false, reason: 'not a player in this match' }
      if (!isRoundOver) return { ok: false, reason: 'round is not over' }

      // Check if we need to reshuffle
      let newShoe = shoe
      if (shouldReshuffleBefore(shoe.length)) {
        newShoe = shuffleDeck(createStandardDeck({ numberOfDecks: 6 }), rng)
      }
      onShoeChange(newShoe)

      // Determine who's sitting out this round (insufficient chips)
      const newSittingOut: Record<string, boolean> = {}
      for (const seatId of publicState.seatOrder) {
        newSittingOut[seatId] = (publicState.chips[seatId] ?? 0) < BLACKJACK_MIN_BET
      }

      const newHands: Record<string, BlackjackHand[]> = {}
      const newActiveHandIndex: Record<string, number> = {}
      const newBets: Record<string, number> = {}
      const newInsuranceBets: Record<string, number> = {}

      for (const seatId of publicState.seatOrder) {
        newHands[seatId] = []
        newActiveHandIndex[seatId] = 0
        newBets[seatId] = 0
        newInsuranceBets[seatId] = 0
      }

      // Create a fresh turn state for betting phase (empty playerOrder for now)
      const newTurn = createTurnState<BlackjackPhase>([], 'betting')

      const newPublicState: BlackjackPublicState = {
        ...publicState,
        turn: newTurn,
        hands: newHands,
        activeHandIndex: newActiveHandIndex,
        bets: newBets,
        sittingOut: newSittingOut,
        insuranceBets: newInsuranceBets,
        dealerHand: [],
        dealerHoleRevealed: false,
        roundNumber: publicState.roundNumber + 1,
        roundResults: null,
        shoeCount: newShoe.length,
        hasResolvedInsurance: {},
      }

      const newPrivateStates: Record<string, BlackjackPrivateState> = {}
      for (const seatId of publicState.seatOrder) {
        newPrivateStates[seatId] = {}
      }

      return {
        ok: true,
        publicState: newPublicState,
        privateStates: newPrivateStates,
      }
    }

    if (action.type === 'PLACE_BET') {
      if (!isBetting) return { ok: false, reason: 'not in betting phase' }
      if (!Object.hasOwn(publicState.chips, playerId)) return { ok: false, reason: 'not a player in this match' }
      if (publicState.sittingOut[playerId]) return { ok: false, reason: 'sitting out this round' }

      const amount = action.amount
      if (!Number.isInteger(amount) || amount < BLACKJACK_MIN_BET || amount > BLACKJACK_MAX_BET) {
        return { ok: false, reason: `bet must be between ${BLACKJACK_MIN_BET} and ${BLACKJACK_MAX_BET}` }
      }
      if (amount > publicState.chips[playerId]) return { ok: false, reason: 'bet exceeds chip count' }

      // Check if this player has already placed a bet
      if (publicState.bets[playerId] > 0) return { ok: false, reason: 'already placed bet' }

      const newChips = { ...publicState.chips, [playerId]: publicState.chips[playerId] - amount }
      const newBets = { ...publicState.bets, [playerId]: amount }

      // Check if all eligible players have bet; if so, move to dealing
      const bettingPlayers = publicState.seatOrder.filter((seatId) => !publicState.sittingOut[seatId])
      const allHaveBet = bettingPlayers.every((seatId) => newBets[seatId] > 0)

      if (allHaveBet) {
        // Deal hands: 2 to each player, 2 to dealer
        let newShoe = shoe
        const newHands: Record<string, BlackjackHand[]> = {}
        let dealerHand: Card[] = []
        let handIdCounter = 0

        for (const seatId of bettingPlayers) {
          const { dealt: twoCards, remaining } = dealCards(newShoe, 2)
          newShoe = remaining
          newHands[seatId] = [
            {
              id: `hand-${handIdCounter}`,
              cards: twoCards,
              bet: newBets[seatId],
              doubled: false,
              isSplitHand: false,
              fromSplitOf: null,
              done: false,
              result: null,
            },
          ]
          handIdCounter += 1
        }

        // Dealer gets 2 cards
        const { dealt: dealerCards, remaining: shoeAfterDealer } = dealCards(newShoe, 2)
        dealerHand = dealerCards
        newShoe = shoeAfterDealer

        onShoeChange(newShoe)

        // Check if dealer shows an Ace (need insurance phase)
        const dealerUpCard = dealerHand[0]
        const needsInsurance = dealerUpCard && dealerUpCard.rank === 'A'

        if (needsInsurance) {
          // Insurance phase: every betting player must resolve insurance
          const newTurn = createTurnState<BlackjackPhase>(bettingPlayers, 'insurance')
          // Initialize hasResolvedInsurance for all betting players
          const newHasResolvedInsurance: Record<string, boolean> = {}
          for (const seatId of bettingPlayers) {
            newHasResolvedInsurance[seatId] = false
          }
          return {
            ok: true,
            publicState: {
              ...publicState,
              chips: newChips,
              bets: newBets,
              hands: newHands,
              activeHandIndex: Object.fromEntries(bettingPlayers.map((s) => [s, 0])),
              dealerHand,
              dealerHoleRevealed: false,
              turn: newTurn,
              shoeCount: newShoe.length,
              hasResolvedInsurance: newHasResolvedInsurance,
            },
            privateStates: Object.fromEntries(publicState.seatOrder.map((seatId) => [seatId, {}])),
          }
        } else {
          // No insurance needed, go straight to acting phase
          const newTurn = createTurnState<BlackjackPhase>(bettingPlayers, 'acting')
          return {
            ok: true,
            publicState: {
              ...publicState,
              chips: newChips,
              bets: newBets,
              hands: newHands,
              activeHandIndex: Object.fromEntries(bettingPlayers.map((s) => [s, 0])),
              dealerHand,
              dealerHoleRevealed: false,
              turn: newTurn,
              shoeCount: newShoe.length,
            },
            privateStates: Object.fromEntries(publicState.seatOrder.map((seatId) => [seatId, {}])),
          }
        }
      }

      return {
        ok: true,
        publicState: { ...publicState, chips: newChips, bets: newBets },
        privateStates: Object.fromEntries(publicState.seatOrder.map((seatId) => [seatId, {}])),
      }
    }

    if (action.type === 'TAKE_INSURANCE' || action.type === 'DECLINE_INSURANCE') {
      if (!isInsurance) return { ok: false, reason: 'not in insurance phase' }
      if (!Object.hasOwn(publicState.chips, playerId)) return { ok: false, reason: 'not a player in this match' }
      if (publicState.sittingOut[playerId]) return { ok: false, reason: 'sitting out this round' }

      // Insurance only available if dealer shows Ace
      const dealerUpCard = publicState.dealerHand[0]
      if (!dealerUpCard || dealerUpCard.rank !== 'A') {
        return { ok: false, reason: 'insurance not available' }
      }

      // Check if this player has already resolved insurance
      const bettingPlayers = publicState.turn.playerOrder
      if (!bettingPlayers.includes(playerId)) return { ok: false, reason: 'not eligible for insurance' }
      if (publicState.hasResolvedInsurance[playerId]) {
        return { ok: false, reason: 'already resolved insurance' }
      }

      const newInsuranceBets = { ...publicState.insuranceBets }
      const newChips = { ...publicState.chips }
      const newHasResolvedInsurance = { ...publicState.hasResolvedInsurance }
      let newTurn = publicState.turn

      if (action.type === 'TAKE_INSURANCE') {
        const insuranceAmount = Math.floor(publicState.bets[playerId] / 2)
        if (insuranceAmount > newChips[playerId]) {
          return { ok: false, reason: 'not enough chips for insurance' }
        }
        newInsuranceBets[playerId] = insuranceAmount
        newChips[playerId] -= insuranceAmount
      } else {
        newInsuranceBets[playerId] = 0 // DECLINE_INSURANCE
      }

      // Mark this player as having resolved insurance
      newHasResolvedInsurance[playerId] = true

      // Check if all eligible players have resolved insurance
      const allResolved = bettingPlayers.every((seatId) => newHasResolvedInsurance[seatId])

      if (allResolved) {
        // Everyone has resolved insurance, move to acting
        newTurn = createTurnState<BlackjackPhase>(bettingPlayers, 'acting')
      }
      // Otherwise keep the insurance phase active (do NOT mutate currentIndex)

      return {
        ok: true,
        publicState: { ...publicState, chips: newChips, insuranceBets: newInsuranceBets, turn: newTurn, hasResolvedInsurance: newHasResolvedInsurance },
        privateStates: Object.fromEntries(publicState.seatOrder.map((seatId) => [seatId, {}])),
      }
    }

    // HIT/STAND/DOUBLE/SPLIT are turn-based actions
    if (action.type === 'HIT' || action.type === 'STAND' || action.type === 'DOUBLE' || action.type === 'SPLIT') {
      if (!isActing) return { ok: false, reason: 'not in acting phase' }
      if (currentPlayer(publicState.turn) !== playerId) return { ok: false, reason: 'not your turn' }

      const hands = publicState.hands[playerId]
      const activeIndex = publicState.activeHandIndex[playerId]
      if (!hands || activeIndex >= hands.length) return { ok: false, reason: 'invalid hand' }

      const currentHand = hands[activeIndex]
      if (currentHand.done) return { ok: false, reason: 'hand is already done' }

      let newShoe = shoe
      let newHands = { ...publicState.hands }
      let newChips = { ...publicState.chips }
      let newTurn = publicState.turn
      let newActiveHandIndex = { ...publicState.activeHandIndex }

      if (action.type === 'HIT') {
        const { card: drawn, remaining } = drawCard(newShoe)
        if (!drawn) return { ok: false, reason: 'shoe is empty' }
        newShoe = remaining

        const newCards = [...currentHand.cards, drawn]
        const playerHands = [...hands]
        playerHands[activeIndex] = { ...currentHand, cards: newCards }

        // Check if hand is bust or 21 (auto-stand)
        if (isBust(newCards) || handValue(newCards).total === 21) {
          playerHands[activeIndex] = { ...playerHands[activeIndex], done: true }

          // Move to next hand or next player
          if (activeIndex + 1 < playerHands.length) {
            newActiveHandIndex[playerId] = activeIndex + 1
          } else {
            newTurn = advanceTurn(publicState.turn, 'acting')
          }
        }

        newHands[playerId] = playerHands
      } else if (action.type === 'STAND') {
        const playerHands = [...hands]
        playerHands[activeIndex] = { ...currentHand, done: true }

        // Move to next hand or next player
        if (activeIndex + 1 < playerHands.length) {
          newActiveHandIndex[playerId] = activeIndex + 1
        } else {
          newTurn = advanceTurn(publicState.turn, 'acting')
        }

        newHands[playerId] = playerHands
      } else if (action.type === 'DOUBLE') {
        // DOUBLE is only legal as first action on a 2-card hand with enough chips
        if (currentHand.cards.length !== 2) return { ok: false, reason: 'can only double on exactly 2 cards' }
        if (currentHand.doubled) return { ok: false, reason: 'already doubled' }
        const additionalBet = currentHand.bet
        if (additionalBet > newChips[playerId]) return { ok: false, reason: 'not enough chips to double' }

        // Draw exactly one card
        const { card: drawn, remaining } = drawCard(newShoe)
        if (!drawn) return { ok: false, reason: 'shoe is empty' }
        newShoe = remaining

        const newCards = [...currentHand.cards, drawn]
        const playerHands = [...hands]
        playerHands[activeIndex] = {
          ...currentHand,
          cards: newCards,
          bet: currentHand.bet + additionalBet,
          doubled: true,
          done: true,
        }

        newChips[playerId] -= additionalBet

        // Move to next hand or next player
        if (activeIndex + 1 < playerHands.length) {
          newActiveHandIndex[playerId] = activeIndex + 1
        } else {
          newTurn = advanceTurn(publicState.turn, 'acting')
        }

        newHands[playerId] = playerHands
      } else if (action.type === 'SPLIT') {
        // SPLIT is only legal as first action on a 2-card hand of same rank, not already a split hand
        if (currentHand.cards.length !== 2) return { ok: false, reason: 'can only split exactly 2 cards' }
        if (currentHand.isSplitHand) return { ok: false, reason: 'cannot split a split hand' }
        if (currentHand.cards[0].rank !== currentHand.cards[1].rank) {
          return { ok: false, reason: 'can only split matching ranks' }
        }

        const splitBet = currentHand.bet
        if (splitBet > newChips[playerId]) return { ok: false, reason: 'not enough chips to split' }

        // Get one card for each new hand
        const { card: card1, remaining: after1 } = drawCard(newShoe)
        if (!card1) return { ok: false, reason: 'shoe is empty' }
        const { card: card2, remaining: after2 } = drawCard(after1)
        if (!card2) return { ok: false, reason: 'shoe is empty' }
        newShoe = after2

        const isAces = currentHand.cards[0].rank === 'A'
        const hand1: BlackjackHand = {
          id: `hand-${playerId}-${Date.now()}-1`,
          cards: [currentHand.cards[0], card1],
          bet: splitBet,
          doubled: false,
          isSplitHand: true,
          fromSplitOf: currentHand.id,
          done: isAces, // Split aces auto-stand
          result: null,
        }
        const hand2: BlackjackHand = {
          id: `hand-${playerId}-${Date.now()}-2`,
          cards: [currentHand.cards[1], card2],
          bet: splitBet,
          doubled: false,
          isSplitHand: true,
          fromSplitOf: currentHand.id,
          done: isAces, // Split aces auto-stand
          result: null,
        }

        const playerHands = [hand1, hand2]
        newChips[playerId] -= splitBet
        newHands[playerId] = playerHands
        newActiveHandIndex[playerId] = 0

        // If split aces, auto-move to next player; otherwise, continue with first hand
        if (isAces) {
          newTurn = advanceTurn(publicState.turn, 'acting')
        }
      }

      // Check if all players are done
      let allPlayersAreDone = true
      const bettingPlayers = publicState.seatOrder.filter((seatId) => !publicState.sittingOut[seatId])
      for (const seatId of bettingPlayers) {
        const seatHands = newHands[seatId]
        if (!seatHands.every((h) => h.done)) {
          allPlayersAreDone = false
          break
        }
      }

      if (allPlayersAreDone) {
        // Move to dealer play
        const { publicState: dealerPlayState, shoe: shoeAfterDealer } = dealerPlay(publicState, newShoe)
        newShoe = shoeAfterDealer

        // Update hands in dealer play state before settling
        let finalState = { ...dealerPlayState, hands: newHands }

        // Settle all hands
        const { publicState: settledState, results } = settleRound(finalState)

        onShoeChange(newShoe)
        return {
          ok: true,
          publicState: {
            ...settledState,
            turn: setPhase(publicState.turn, 'roundOver'),
            roundResults: results,
            shoeCount: newShoe.length,
          },
          privateStates: Object.fromEntries(publicState.seatOrder.map((seatId) => [seatId, {}])),
        }
      }

      onShoeChange(newShoe)
      return {
        ok: true,
        publicState: { ...publicState, hands: newHands, chips: newChips, turn: newTurn, activeHandIndex: newActiveHandIndex, shoeCount: newShoe.length },
        privateStates: Object.fromEntries(publicState.seatOrder.map((seatId) => [seatId, {}])),
      }
    }

    return { ok: false, reason: 'unknown action' }
  }
}

export function applyBlackjackAction(
  blackjackSession: BlackjackSession,
  playerId: string,
  action: BlackjackAction,
): { blackjackSession: BlackjackSession; outcome: ActionOutcome<BlackjackPublicState, BlackjackPrivateState> } {
  let candidateShoe = blackjackSession.shoe
  const validate = makeValidator(blackjackSession, (s) => { candidateShoe = s })
  const { session, outcome } = applyAction(blackjackSession.session, playerId, action, validate)
  const shoe = outcome.ok ? candidateShoe : blackjackSession.shoe
  return { blackjackSession: { session, shoe, rng: blackjackSession.rng }, outcome }
}

export function runBlackjackBotTurn(
  blackjackSession: BlackjackSession,
  playerId: string,
  strategy: BotStrategy<BlackjackPublicState, BlackjackPrivateState, BlackjackAction>,
): { blackjackSession: BlackjackSession; outcome: ActionOutcome<BlackjackPublicState, BlackjackPrivateState> } {
  let candidateShoe = blackjackSession.shoe
  const validate = makeValidator(blackjackSession, (s) => { candidateShoe = s })
  const { session, outcome } = runBotTurn(blackjackSession.session, playerId, strategy, validate)
  const shoe = outcome.ok ? candidateShoe : blackjackSession.shoe
  return { blackjackSession: { session, shoe, rng: blackjackSession.rng }, outcome }
}
