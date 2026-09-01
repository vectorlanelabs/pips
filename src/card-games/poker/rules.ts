import type { Card } from '../../card-engine/cards.ts'
import type { ActionOutcome, ActionValidator } from '../../engine/sync.ts'
import { applyAction } from '../../engine/sync.ts'
import { runBotTurn, type BotStrategy } from '../../engine/bot.ts'
import { advanceTurn, currentPlayer, setPhase, createTurnState, type TurnState } from '../../engine/turn-engine.ts'
import { dealCards, shuffleDeck, createStandardDeck } from '../../card-engine/deck.ts'
import { evaluateBestHand, compareRanks } from './hand-eval.ts'
import type {
  PokerSession,
  PokerPublicState,
  PokerPrivateState,
  PokerAction,
  PokerPlayerHandState,
  PokerStreet,
} from './state.ts'
import {
  POKER_SMALL_BLIND,
  POKER_BIG_BLIND,
  handSizeFor,
  getActingSeats,
  getNextNonEliminatedSeat,
} from './state.ts'

interface SidePot {
  amount: number
  eligiblePlayerIds: string[]
}

// Compute side pots from player contributions
export function computeSidePots(
  contributions: Record<string, number>,
  foldedIds: Set<string>,
): SidePot[] {
  const allPlayers = Object.keys(contributions)

  if (allPlayers.length === 0) {
    return []
  }

  // Get unique contribution levels, sorted ascending
  const levels = Array.from(new Set(Object.values(contributions)))
    .filter((v) => v > 0)
    .sort((a, b) => a - b)

  if (levels.length === 0) {
    return []
  }

  const pots: SidePot[] = []
  let previousLevel = 0

  for (const level of levels) {
    // Count how many players contributed at least this amount
    const playersAtThisLevel = allPlayers.filter((id) => contributions[id] >= level)
    const potAmount = (level - previousLevel) * playersAtThisLevel.length
    const eligibleIds = playersAtThisLevel.filter((id) => !foldedIds.has(id))

    if (potAmount > 0 && eligibleIds.length > 0) {
      pots.push({
        amount: potAmount,
        eligiblePlayerIds: eligibleIds,
      })
    }

    previousLevel = level
  }

  return pots
}

// Check if action should close (all active players matched bet or folded/all-in)
// A seat that just went all-in leaves the street's rotation, exactly as a
// folding seat does (see the FOLD branch's identical index math): removing the
// current element shifts the next actor into currentIndex, so the mod IS the
// turn advance. Without this, a later raise that reopens action hands the
// all-in seat a dead turn where every betting action is rejected ('nothing to
// call' / 'cannot check facing a bet') -- which permanently hangs a
// deterministic bot re-proposing the same action.
function turnAfterBettingAction(turn: TurnState<PokerStreet>, phase: PokerStreet, actorWentAllIn: boolean, playerId: string): TurnState<PokerStreet> {
  if (!actorWentAllIn) return advanceTurn(turn, phase)
  const newPlayerOrder = turn.playerOrder.filter((id) => id !== playerId)
  if (newPlayerOrder.length === 0) return advanceTurn(turn, phase)
  return { ...turn, playerOrder: newPlayerOrder, currentIndex: turn.currentIndex % newPlayerOrder.length }
}

function isActionClosed(publicState: PokerPublicState): boolean {
  const acting = getActingSeats(publicState)

  // Every remaining actor (0, 1, or many) must have both taken a voluntary
  // action this street AND matched the current bet. A lone remaining actor
  // (everyone else folded/all-in) is NOT automatically "unclosed" -- if they
  // already acted and matched (e.g. they just called an opponent's shove and
  // still have chips left over), the street is closed just like the
  // multi-actor case. An empty `acting` list vacuously satisfies this loop.
  const currentBet = publicState.currentBetThisStreet
  for (const seatId of acting) {
    if (!publicState.actedThisStreet[seatId] || publicState.hands[seatId].betThisStreet !== currentBet) {
      return false
    }
  }

  return true
}

// Count non-folded players
function getActivePlayers(publicState: PokerPublicState): string[] {
  return publicState.seatOrder.filter((seatId) => !publicState.hands[seatId].folded)
}

// Start the hand: post blinds and deal cards
function startNewHand(publicState: PokerPublicState, deck: Card[]): { publicState: PokerPublicState; deck: Card[]; privateStates: Record<string, PokerPrivateState> } {
  let newPublicState = { ...publicState }
  let newDeck = deck
  const newChips = { ...publicState.chips }
  const newHands: Record<string, PokerPlayerHandState> = {}
  const newPrivateStates: Record<string, PokerPrivateState> = {}
  const contributions: Record<string, number> = {}

  // Reset all hands
  for (const seatId of publicState.seatOrder) {
    newHands[seatId] = {
      cards: [],
      // Eliminated seats are folded from hand start: folded is the single
      // source of truth every rotation builder, isActionClosed, showdown
      // evaluation, and side-pot eligibility already key off, so a busted
      // seat gets no turns and never reaches showdown with an empty hand.
      folded: publicState.eliminated[seatId] === true,
      allIn: false,
      totalContributedThisHand: 0,
      betThisStreet: 0,
    }
    contributions[seatId] = 0
    newPrivateStates[seatId] = { hand: [] }
  }

  // Post blinds
  const sbAmount = Math.min(POKER_SMALL_BLIND, newChips[publicState.smallBlindSeat])
  const bbAmount = Math.min(POKER_BIG_BLIND, newChips[publicState.bigBlindSeat])

  newChips[publicState.smallBlindSeat] -= sbAmount
  newChips[publicState.bigBlindSeat] -= bbAmount
  contributions[publicState.smallBlindSeat] = sbAmount
  contributions[publicState.bigBlindSeat] = bbAmount

  newHands[publicState.smallBlindSeat].allIn = newChips[publicState.smallBlindSeat] === 0
  newHands[publicState.bigBlindSeat].allIn = newChips[publicState.bigBlindSeat] === 0
  newHands[publicState.smallBlindSeat].betThisStreet = sbAmount
  newHands[publicState.bigBlindSeat].betThisStreet = bbAmount
  newHands[publicState.smallBlindSeat].totalContributedThisHand = sbAmount
  newHands[publicState.bigBlindSeat].totalContributedThisHand = bbAmount

  // Deal private cards. As in createPokerGame, cards go ONLY into the private
  // per-seat channel -- never into publicState.hands[seatId].cards, which is
  // broadcast to every peer and would otherwise leak every seat's hole cards.
  const activeSeats = publicState.seatOrder.filter((seatId) => !publicState.eliminated[seatId])
  const handSize = handSizeFor(publicState.variant)
  for (const seatId of activeSeats) {
    const { dealt: handCards, remaining } = dealCards(newDeck, handSize)
    newDeck = remaining
    newPrivateStates[seatId].hand = handCards
  }

  // Determine preflop action order: starts left of BB (next seat after BB, wrapping to start)
  let preflopOrder = [...activeSeats]
  const bbIndex = preflopOrder.indexOf(publicState.bigBlindSeat)
  if (bbIndex !== -1) {
    // Rotate so that the seat after BB is first
    const nextIndex = (bbIndex + 1) % preflopOrder.length
    preflopOrder = [...preflopOrder.slice(nextIndex), ...preflopOrder.slice(0, nextIndex)]
  }

  // Filter out folded/all-in from action order (but they're not folded/all-in yet)
  const preflopActing = preflopOrder.filter((seatId) => !newHands[seatId].folded && !newHands[seatId].allIn)

  const actedThisStreet: Record<string, boolean> = {}
  const reRaiseEligible: Record<string, boolean> = {}
  const drawnCounts: Record<string, number | null> = {}
  for (const seatId of publicState.seatOrder) {
    actedThisStreet[seatId] = false
    reRaiseEligible[seatId] = true
    drawnCounts[seatId] = null
  }

  // Draw variants open with the first betting round; holdem opens preflop. The
  // action order is identical in both cases (starts left of the big blind).
  const initialPhase: PokerStreet = publicState.variant === 'holdem' ? 'preflop' : 'firstBet'

  newPublicState = {
    ...newPublicState,
    hands: newHands,
    chips: newChips,
    board: [],
    pot: sbAmount + bbAmount,
    currentBetThisStreet: bbAmount,
    lastFullRaiseIncrement: POKER_BIG_BLIND,
    turn: createTurnState<PokerStreet>(preflopActing, initialPhase),
    handNumber: publicState.handNumber + 1,
    handOver: false,
    actedThisStreet,
    reRaiseEligible,
    drawnCounts,
    handResults: null,
  }

  return { publicState: newPublicState, deck: newDeck, privateStates: newPrivateStates }
}

// Move to next street
function advanceStreet(publicState: PokerPublicState): PokerPublicState {
  let newPublicState = { ...publicState }
  let nextStreet: PokerStreet = 'flop'

  // Variant-aware street map: holdem keeps preflop->flop->turn->river; draw
  // variants run firstBet->draw->secondBet->showdown.
  if (publicState.variant !== 'holdem') {
    if (publicState.turn.phase === 'firstBet') {
      nextStreet = 'draw'
    } else if (publicState.turn.phase === 'draw') {
      nextStreet = 'secondBet'
    } else if (publicState.turn.phase === 'secondBet') {
      nextStreet = 'showdown'
    }
  } else if (publicState.turn.phase === 'preflop') {
    nextStreet = 'flop'
  } else if (publicState.turn.phase === 'flop') {
    nextStreet = 'turn'
  } else if (publicState.turn.phase === 'turn') {
    nextStreet = 'river'
  } else if (publicState.turn.phase === 'river') {
    nextStreet = 'showdown'
  }

  // Reset betThisStreet, actedThisStreet, and reRaiseEligible for all players (a new street)
  const newHands: Record<string, PokerPlayerHandState> = {}
  const newActedThisStreet: Record<string, boolean> = {}
  const newReRaiseEligible: Record<string, boolean> = {}
  for (const seatId of publicState.seatOrder) {
    newHands[seatId] = { ...publicState.hands[seatId], betThisStreet: 0 }
    newActedThisStreet[seatId] = false
    newReRaiseEligible[seatId] = true
  }

  newPublicState = {
    ...newPublicState,
    hands: newHands,
    actedThisStreet: newActedThisStreet,
    reRaiseEligible: newReRaiseEligible,
    currentBetThisStreet: 0,
    lastFullRaiseIncrement: POKER_BIG_BLIND,
  }

  // Determine acting order for next street (button position unless heads-up edge case)
  if (nextStreet === 'showdown') {
    newPublicState = { ...newPublicState, turn: setPhase(publicState.turn, 'showdown') }
    return newPublicState
  }

  // Find first non-folded seat after button
  const buttonIndex = publicState.seatOrder.indexOf(publicState.buttonSeat)
  let nextActionOrder = []
  for (let i = 1; i <= publicState.seatOrder.length; i++) {
    const idx = (buttonIndex + i) % publicState.seatOrder.length
    const seatId = publicState.seatOrder[idx]
    if (nextStreet === 'draw') {
      // The draw round covers every non-folded seat (all-in included -- drawing
      // is free), starting left of the button. Eliminated seats are folded from
      // hand start, so folded alone is the complete filter.
      if (!newHands[seatId].folded) {
        nextActionOrder.push(seatId)
      }
    } else if (!newHands[seatId].folded && !newHands[seatId].allIn) {
      nextActionOrder.push(seatId)
    }
  }

  newPublicState = {
    ...newPublicState,
    turn: createTurnState<PokerStreet>(nextActionOrder, nextStreet),
  }

  return newPublicState
}

// Deal board cards for a street (called after advanceStreet, so phase is the NEW phase)
function dealBoardCards(deck: Card[], publicState: PokerPublicState): { board: Card[]; deck: Card[] } {
  let newDeck = deck

  // dealBoardCards is called AFTER advanceStreet, so the phase is already the new one.
  // We deal the cards that just appeared on this new street.
  if (publicState.turn.phase === 'flop') {
    // Just moved to flop, deal the flop (3 cards)
    const { dealt, remaining } = dealCards(newDeck, 3)
    newDeck = remaining
    return { board: dealt, deck: newDeck }
  } else if (publicState.turn.phase === 'turn') {
    // Just moved to turn, deal the turn (1 card)
    const { dealt, remaining } = dealCards(newDeck, 1)
    newDeck = remaining
    return { board: dealt, deck: newDeck }
  } else if (publicState.turn.phase === 'river') {
    // Just moved to river, deal the river (1 card)
    const { dealt, remaining } = dealCards(newDeck, 1)
    newDeck = remaining
    return { board: dealt, deck: newDeck }
  }

  return { board: [], deck: newDeck }
}

// Advance until either there's action possible or we reach showdown (for all-in runout)
function advanceUntilActionOrShowdown(
  baseState: PokerPublicState,
  deck: Card[],
): { publicState: PokerPublicState; deck: Card[] } {
  let currentState = baseState
  let currentDeck = deck
  let currentBoard = [...baseState.board]

  while (true) {
    // The draw round always plays out via DRAW actions; it is never auto-skipped,
    // even when every remaining player is all-in.
    if (currentState.turn.phase === 'draw') {
      return {
        publicState: { ...currentState, board: currentBoard },
        deck: currentDeck,
      }
    }

    const acting = getActingSeats(currentState)

    // If we have more than 1 player who can act, stop here
    if (acting.length > 1) {
      return {
        publicState: { ...currentState, board: currentBoard },
        deck: currentDeck,
      }
    }

    // All players are all-in or folded, need to auto-deal remaining streets
    if (currentState.turn.phase === 'showdown') {
      return {
        publicState: { ...currentState, board: currentBoard },
        deck: currentDeck,
      }
    }

    // Advance to next street
    let advancedState = advanceStreet(currentState)

    if (advancedState.turn.phase === 'showdown') {
      return {
        publicState: { ...advancedState, board: currentBoard },
        deck: currentDeck,
      }
    }

    // Deal board cards for this street
    const { board: newBoardCards, deck: newDeck } = dealBoardCards(currentDeck, advancedState)
    currentBoard = currentBoard.concat(newBoardCards)
    currentDeck = newDeck
    currentState = { ...advancedState, board: currentBoard }
  }
}

function makeValidator(
  holdemSession: PokerSession,
  onDeckChange: (newDeck: Card[]) => void,
  onPrivateStatesChange: (newStates: Record<string, PokerPrivateState>) => void,
): ActionValidator<PokerPublicState, PokerPrivateState, PokerAction> {
  return (session, playerId, action) => {
    const { publicState } = session
    let deck = holdemSession.deck
    // Note: onDeckChange and onPrivateStatesChange are called in nested returns within the validator
    void onDeckChange
    void onPrivateStatesChange
    const currentPhase = publicState.turn.phase

    // START_NEXT_HAND can be triggered by any seated player once the hand is over
    if (action.type === 'START_NEXT_HAND') {
      if (!Object.hasOwn(publicState.chips, playerId)) {
        return { ok: false, reason: 'not a player in this match' }
      }
      if (!publicState.handOver) {
        return { ok: false, reason: 'hand is not over' }
      }

      // Check if we need to eliminate anyone
      const newEliminated = { ...publicState.eliminated }
      for (const seatId of publicState.seatOrder) {
        if (publicState.chips[seatId] === 0 && !newEliminated[seatId]) {
          newEliminated[seatId] = true
        }
      }

      // Check if game is over (only 1 non-eliminated player)
      const nonEliminated = publicState.seatOrder.filter((seatId) => !newEliminated[seatId])
      if (nonEliminated.length <= 1) {
        const winner = nonEliminated[0] ?? null
        return {
          ok: true,
          publicState: { ...publicState, eliminated: newEliminated, gameOverWinnerId: winner },
          privateStates: Object.fromEntries(publicState.seatOrder.map((seatId) => [seatId, { hand: [] }])),
        }
      }

      // Rotate button to next non-eliminated seat
      const newButtonSeat = getNextNonEliminatedSeat(publicState.seatOrder, publicState.buttonSeat, newEliminated)
      const newSBSeat = getNextNonEliminatedSeat(publicState.seatOrder, newButtonSeat, newEliminated)
      const newBBSeat = getNextNonEliminatedSeat(publicState.seatOrder, newSBSeat, newEliminated)

      // Reshuffle deck
      const newDeck = shuffleDeck(createStandardDeck(), holdemSession.rng)
      onDeckChange(newDeck)

      const newPublicState = {
        ...publicState,
        buttonSeat: newButtonSeat,
        smallBlindSeat: newSBSeat,
        bigBlindSeat: newBBSeat,
        eliminated: newEliminated,
      }

      const { publicState: stateAfterStart, deck: deckAfterStart, privateStates: newPrivateStates } = startNewHand(newPublicState, newDeck)
      onDeckChange(deckAfterStart)
      onPrivateStatesChange(newPrivateStates)

      return {
        ok: true,
        publicState: stateAfterStart,
        privateStates: newPrivateStates,
      }
    }

    // Regular actions must be on an active street (not handOver)
    if (publicState.handOver) {
      return { ok: false, reason: 'hand is over' }
    }

    // Action validation for turn-ordered streets
    if (action.type === 'FOLD' || action.type === 'CHECK' || action.type === 'CALL' || action.type === 'BET' || action.type === 'RAISE') {
      if (currentPhase === 'draw') {
        return { ok: false, reason: 'draw round: choose your discards' }
      }

      if (currentPlayer(publicState.turn) !== playerId) {
        return { ok: false, reason: 'not your turn' }
      }

      if (!Object.hasOwn(publicState.chips, playerId)) {
        return { ok: false, reason: 'not a player in this match' }
      }

      const playerChips = publicState.chips[playerId]
      const playerHand = publicState.hands[playerId]

      if (playerHand.folded) {
        return { ok: false, reason: 'you have already folded' }
      }

      if (action.type === 'FOLD') {
        const newHands = { ...publicState.hands }
        newHands[playerId] = { ...playerHand, folded: true }
        const newActedThisStreet = { ...publicState.actedThisStreet }
        newActedThisStreet[playerId] = true

        const activePlayers = getActivePlayers(publicState)
        const stillActive = activePlayers.filter((id) => id !== playerId && !newHands[id].folded)

        // If only one player left, they win immediately
        if (stillActive.length === 1) {
          const winner = stillActive[0]
          const newChips = { ...publicState.chips }
          newChips[winner] += publicState.pot
  
          return {
            ok: true,
            publicState: {
              ...publicState,
              hands: newHands,
              chips: newChips,
              actedThisStreet: newActedThisStreet,
              handOver: true,
              handResults: {
                winners: [{ playerId: winner, amount: publicState.pot }],
                potBreakdown: [
                  {
                    amount: publicState.pot,
                    eligiblePlayerIds: [winner],
                    winnerIds: [winner],
                  },
                ],
              },
            },
            privateStates: Object.fromEntries(publicState.seatOrder.map((seatId) => [seatId, { hand: [] }])),
          }
        }

        // Advance turn
        const acting = getActingSeats(publicState).filter((id) => id !== playerId)
        let newTurn = publicState.turn
        if (acting.length > 0) {
          const currentIndex = publicState.turn.currentIndex
          const newPlayerOrder = publicState.turn.playerOrder.filter((id) => id !== playerId)
          if (newPlayerOrder.length > 0) {
            const newIndex = currentIndex % newPlayerOrder.length
            newTurn = {
              ...publicState.turn,
              playerOrder: newPlayerOrder,
              currentIndex: newIndex,
            }
          }
        }

        const newPublicStateAfterFold = { ...publicState, hands: newHands, turn: newTurn, actedThisStreet: newActedThisStreet }

        // A fold can itself close the street (e.g. a bettor and a caller
        // already matched, and a third player folds) -- every other action
        // handler checks this, FOLD must too, or the round gets stuck
        // waiting for an action from a player who already matched.
        if (isActionClosed(newPublicStateAfterFold)) {
          let advancedState = advanceStreet(newPublicStateAfterFold)

          if (advancedState.turn.phase === 'showdown') {
            return conductShowdown(advancedState, session.privateStates, deck, onDeckChange, onPrivateStatesChange)
          }

          const { board: newBoardCards, deck: afterBoardDeck } = dealBoardCards(deck, advancedState)
          advancedState = { ...advancedState, board: [...publicState.board, ...newBoardCards] }

          const actingSeats = getActingSeats(advancedState)
          if (actingSeats.length <= 1) {
            const { publicState: runoutState, deck: runoutDeck } = advanceUntilActionOrShowdown(advancedState, afterBoardDeck)
            onDeckChange(runoutDeck)

            if (runoutState.turn.phase === 'showdown') {
              return conductShowdown(runoutState, session.privateStates, runoutDeck, onDeckChange, onPrivateStatesChange)
            }

            return {
              ok: true,
              publicState: runoutState,
              privateStates: session.privateStates,
            }
          }

          onDeckChange(afterBoardDeck)

          return {
            ok: true,
            publicState: advancedState,
            privateStates: session.privateStates,
          }
        }

        return {
          ok: true,
          publicState: newPublicStateAfterFold,
          privateStates: session.privateStates,
        }
      }

      if (action.type === 'CHECK') {
        if (publicState.currentBetThisStreet > playerHand.betThisStreet) {
          return { ok: false, reason: 'cannot check when facing a bet' }
        }

        const newActedThisStreet = { ...publicState.actedThisStreet }
        newActedThisStreet[playerId] = true
        const newReRaiseEligible = { ...publicState.reRaiseEligible }
        newReRaiseEligible[playerId] = false
        const newTurn = advanceTurn(publicState.turn, currentPhase)
        const newPublicState = { ...publicState, turn: newTurn, actedThisStreet: newActedThisStreet, reRaiseEligible: newReRaiseEligible }

        if (isActionClosed(newPublicState)) {
          // Move to next street and handle all-in runout
          let advancedState = advanceStreet(newPublicState)

          if (advancedState.turn.phase === 'showdown') {
            // Conduct showdown immediately (no more board to deal)
            return conductShowdown(advancedState, session.privateStates, deck, onDeckChange, onPrivateStatesChange)
          }

          // Deal the board cards for the new street
          const { board: newBoardCards, deck: afterBoardDeck } = dealBoardCards(deck, advancedState)
          advancedState = { ...advancedState, board: [...publicState.board, ...newBoardCards] }

          // Check if we need to auto-runout (all remaining players are all-in)
          const actingSeats = getActingSeats(advancedState)
          if (actingSeats.length <= 1) {
            // Everyone is all-in or folded, auto-runout remaining streets
            const { publicState: runoutState, deck: runoutDeck } = advanceUntilActionOrShowdown(advancedState, afterBoardDeck)
            onDeckChange(runoutDeck)

            if (runoutState.turn.phase === 'showdown') {
              return conductShowdown(runoutState, session.privateStates, runoutDeck, onDeckChange, onPrivateStatesChange)
            }

            return {
              ok: true,
              publicState: runoutState,
              privateStates: session.privateStates,
            }
          }

          onDeckChange(afterBoardDeck)

          return {
            ok: true,
            publicState: advancedState,
            privateStates: session.privateStates,
          }
        }

        return {
          ok: true,
          publicState: newPublicState,
          privateStates: session.privateStates,
        }
      }

      if (action.type === 'CALL') {
        const callAmount = Math.min(publicState.currentBetThisStreet - playerHand.betThisStreet, playerChips)
        if (callAmount <= 0) {
          return { ok: false, reason: 'nothing to call' }
        }

        const newChips = { ...publicState.chips, [playerId]: playerChips - callAmount }
        const newHands = { ...publicState.hands }
        const newBetThisStreet = playerHand.betThisStreet + callAmount
        newHands[playerId] = {
          ...playerHand,
          betThisStreet: newBetThisStreet,
          totalContributedThisHand: playerHand.totalContributedThisHand + callAmount,
          allIn: newChips[playerId] === 0,
        }

        const newActedThisStreet = { ...publicState.actedThisStreet }
        newActedThisStreet[playerId] = true
        const newReRaiseEligible = { ...publicState.reRaiseEligible }
        newReRaiseEligible[playerId] = false
        const newPot = publicState.pot + callAmount
        const newTurn = turnAfterBettingAction(publicState.turn, currentPhase, newChips[playerId] === 0, playerId)
        let newPublicState = { ...publicState, chips: newChips, hands: newHands, pot: newPot, turn: newTurn, actedThisStreet: newActedThisStreet, reRaiseEligible: newReRaiseEligible }

        if (isActionClosed(newPublicState)) {
          let advancedState = advanceStreet(newPublicState)

          if (advancedState.turn.phase === 'showdown') {
            return conductShowdown(advancedState, session.privateStates, deck, onDeckChange, onPrivateStatesChange)
          }

          // Deal the board cards for the new street
          const { board: newBoardCards, deck: afterBoardDeck } = dealBoardCards(deck, advancedState)
          advancedState = { ...advancedState, board: [...publicState.board, ...newBoardCards] }

          // Check if we need to auto-runout (all remaining players are all-in)
          const actingSeats = getActingSeats(advancedState)
          if (actingSeats.length <= 1) {
            // Everyone is all-in or folded, auto-runout remaining streets
            const { publicState: runoutState, deck: runoutDeck } = advanceUntilActionOrShowdown(advancedState, afterBoardDeck)
            onDeckChange(runoutDeck)

            if (runoutState.turn.phase === 'showdown') {
              return conductShowdown(runoutState, session.privateStates, runoutDeck, onDeckChange, onPrivateStatesChange)
            }

            return {
              ok: true,
              publicState: runoutState,
              privateStates: session.privateStates,
            }
          }

          onDeckChange(afterBoardDeck)

          return {
            ok: true,
            publicState: advancedState,
            privateStates: session.privateStates,
          }
        }

        return {
          ok: true,
          publicState: newPublicState,
          privateStates: session.privateStates,
        }
      }

      if (action.type === 'BET') {
        if (publicState.currentBetThisStreet > 0) {
          return { ok: false, reason: 'cannot bet when a bet already exists this street' }
        }

        const betAmount = action.amount
        if (!Number.isInteger(betAmount) || betAmount <= 0) {
          return { ok: false, reason: 'bet must be a positive integer' }
        }
        if (betAmount > playerChips) {
          return { ok: false, reason: 'bet exceeds chip count' }
        }

        const newChips = { ...publicState.chips, [playerId]: playerChips - betAmount }
        const newHands = { ...publicState.hands }
        newHands[playerId] = {
          ...playerHand,
          betThisStreet: betAmount,
          totalContributedThisHand: playerHand.totalContributedThisHand + betAmount,
          allIn: newChips[playerId] === 0,
        }

        const newActedThisStreet = { ...publicState.actedThisStreet }
        newActedThisStreet[playerId] = true
        const newPot = publicState.pot + betAmount
        const newTurn = turnAfterBettingAction(publicState.turn, currentPhase, newChips[playerId] === 0, playerId)
        let newPublicState = {
          ...publicState,
          chips: newChips,
          hands: newHands,
          pot: newPot,
          currentBetThisStreet: betAmount,
          lastFullRaiseIncrement: betAmount,
          turn: newTurn,
          actedThisStreet: newActedThisStreet,
        }

        if (isActionClosed(newPublicState)) {
          let advancedState = advanceStreet(newPublicState)

          if (advancedState.turn.phase === 'showdown') {
            return conductShowdown(advancedState, session.privateStates, deck, onDeckChange, onPrivateStatesChange)
          }

          // Deal the board cards for the new street
          const { board: newBoardCards, deck: afterBoardDeck } = dealBoardCards(deck, advancedState)
          advancedState = { ...advancedState, board: [...publicState.board, ...newBoardCards] }

          // Check if we need to auto-runout (all remaining players are all-in)
          const actingSeats = getActingSeats(advancedState)
          if (actingSeats.length <= 1) {
            // Everyone is all-in or folded, auto-runout remaining streets
            const { publicState: runoutState, deck: runoutDeck } = advanceUntilActionOrShowdown(advancedState, afterBoardDeck)
            onDeckChange(runoutDeck)

            if (runoutState.turn.phase === 'showdown') {
              return conductShowdown(runoutState, session.privateStates, runoutDeck, onDeckChange, onPrivateStatesChange)
            }

            return {
              ok: true,
              publicState: runoutState,
              privateStates: session.privateStates,
            }
          }

          onDeckChange(afterBoardDeck)

          return {
            ok: true,
            publicState: advancedState,
            privateStates: session.privateStates,
          }
        }

        return {
          ok: true,
          publicState: newPublicState,
          privateStates: session.privateStates,
        }
      }

      if (action.type === 'RAISE') {
        if (publicState.currentBetThisStreet === 0) {
          return { ok: false, reason: 'cannot raise when no bet exists; use BET instead' }
        }

        const raiseToAmount = action.amount
        if (!Number.isInteger(raiseToAmount) || raiseToAmount <= publicState.currentBetThisStreet) {
          return { ok: false, reason: 'raise must be at least equal to current bet' }
        }

        const raiseIncrement = raiseToAmount - publicState.currentBetThisStreet
        const minRaise = Math.max(publicState.lastFullRaiseIncrement, POKER_BIG_BLIND)

        // Short all-in is allowed even if below min raise
        const isShortAllIn = raiseToAmount - playerHand.betThisStreet === playerChips

        if (!isShortAllIn && raiseIncrement < minRaise) {
          return { ok: false, reason: `raise increment must be at least ${minRaise}` }
        }

        // A short all-in raise does not reopen the betting round -- a seat that
        // already acted since the last FULL bet/raise may only call or fold now,
        // not raise again, even though the short all-in nominally gave them
        // another turn (their betThisStreet no longer matches currentBetThisStreet).
        if (!publicState.reRaiseEligible[playerId]) {
          return { ok: false, reason: 'cannot re-raise: only a short all-in has happened since your last action' }
        }

        const raiseAmount = raiseToAmount - playerHand.betThisStreet
        if (raiseAmount > playerChips) {
          return { ok: false, reason: 'raise exceeds chip count' }
        }

        const newChips = { ...publicState.chips, [playerId]: playerChips - raiseAmount }
        const newHands = { ...publicState.hands }
        newHands[playerId] = {
          ...playerHand,
          betThisStreet: raiseToAmount,
          totalContributedThisHand: playerHand.totalContributedThisHand + raiseAmount,
          allIn: newChips[playerId] === 0,
        }

        const newActedThisStreet = { ...publicState.actedThisStreet }
        newActedThisStreet[playerId] = true
        // A FULL raise reopens re-raise eligibility for every OTHER seat (standard
        // rule: everyone gets a fresh chance to respond to a real raise). A short
        // all-in raise does NOT reopen anyone's eligibility -- leave it as-is, so a
        // seat that already acted since the last full raise stays locked out of
        // raising further (they may still call or fold against the short all-in).
        const newReRaiseEligible = { ...publicState.reRaiseEligible }
        if (!isShortAllIn) {
          for (const seatId of publicState.seatOrder) {
            if (seatId !== playerId) newReRaiseEligible[seatId] = true
          }
        }
        const newPot = publicState.pot + raiseAmount
        const newTurn = turnAfterBettingAction(publicState.turn, currentPhase, newChips[playerId] === 0, playerId)
        let newPublicState = {
          ...publicState,
          chips: newChips,
          hands: newHands,
          pot: newPot,
          currentBetThisStreet: raiseToAmount,
          // Only update lastFullRaiseIncrement if this is a "full" raise (at least minRaise)
          lastFullRaiseIncrement: isShortAllIn ? publicState.lastFullRaiseIncrement : raiseIncrement,
          turn: newTurn,
          actedThisStreet: newActedThisStreet,
          reRaiseEligible: newReRaiseEligible,
        }

        if (isActionClosed(newPublicState)) {
          let advancedState = advanceStreet(newPublicState)

          if (advancedState.turn.phase === 'showdown') {
            return conductShowdown(advancedState, session.privateStates, deck, onDeckChange, onPrivateStatesChange)
          }

          // Deal the board cards for the new street
          const { board: newBoardCards, deck: afterBoardDeck } = dealBoardCards(deck, advancedState)
          advancedState = { ...advancedState, board: [...publicState.board, ...newBoardCards] }

          // Check if we need to auto-runout (all remaining players are all-in)
          const actingSeats = getActingSeats(advancedState)
          if (actingSeats.length <= 1) {
            // Everyone is all-in or folded, auto-runout remaining streets
            const { publicState: runoutState, deck: runoutDeck } = advanceUntilActionOrShowdown(advancedState, afterBoardDeck)
            onDeckChange(runoutDeck)

            if (runoutState.turn.phase === 'showdown') {
              return conductShowdown(runoutState, session.privateStates, runoutDeck, onDeckChange, onPrivateStatesChange)
            }

            return {
              ok: true,
              publicState: runoutState,
              privateStates: session.privateStates,
            }
          }

          onDeckChange(afterBoardDeck)

          return {
            ok: true,
            publicState: advancedState,
            privateStates: session.privateStates,
          }
        }

        return {
          ok: true,
          publicState: newPublicState,
          privateStates: session.privateStates,
        }
      }
    }

    if (action.type === 'DRAW') {
      // Draw variants only.
      if (publicState.variant === 'holdem') {
        return { ok: false, reason: "draw actions are not part of Texas Hold'em" }
      }
      if (currentPhase !== 'draw') {
        return { ok: false, reason: 'not the draw round' }
      }
      if (currentPlayer(publicState.turn) !== playerId) {
        return { ok: false, reason: 'not your turn' }
      }

      const discardIds = action.discardIds
      if (!Array.isArray(discardIds) || discardIds.length > 3) {
        return { ok: false, reason: 'you can draw at most 3 cards' }
      }
      if (new Set(discardIds).size !== discardIds.length) {
        return { ok: false, reason: 'duplicate card in discard list' }
      }

      const privateHand = session.privateStates[playerId].hand
      for (const discardId of discardIds) {
        if (!privateHand.some((c) => c.id === discardId)) {
          return { ok: false, reason: 'card not in your hand' }
        }
      }

      // Apply: remove the discards from the private hand and deal that many
      // replacements from the deck (same onDeckChange discipline as the deal
      // paths). Discarded cards are gone -- seat caps make exhaustion impossible.
      const discardSet = new Set(discardIds)
      const keptCards = privateHand.filter((c) => !discardSet.has(c.id))
      const { dealt: replacements, remaining: deckAfterDraw } = dealCards(deck, discardIds.length)
      deck = deckAfterDraw
      const newPrivateHand = [...keptCards, ...replacements]
      const newPrivateStates = { ...session.privateStates, [playerId]: { hand: newPrivateHand } }
      onPrivateStatesChange(newPrivateStates)
      onDeckChange(deckAfterDraw)

      const newDrawnCounts = { ...publicState.drawnCounts, [playerId]: discardIds.length }
      const newPublicState = {
        ...publicState,
        drawnCounts: newDrawnCounts,
        turn: advanceTurn(publicState.turn, 'draw'),
      }

      // The draw round is done once every seat in it has drawn. The last draw
      // moves the hand into secondBet, then runs the same post-street-change
      // closure the betting actions use (auto-runout, then showdown if it lands
      // there) so an everyone-all-in hand flows draw -> showdown directly.
      const allDrawn = publicState.turn.playerOrder.every((seatId) => newDrawnCounts[seatId] != null)
      if (!allDrawn) {
        return {
          ok: true,
          publicState: newPublicState,
          privateStates: newPrivateStates,
        }
      }

      let advancedState = advanceStreet(newPublicState)

      if (advancedState.turn.phase === 'showdown') {
        return conductShowdown(advancedState, newPrivateStates, deck, onDeckChange, onPrivateStatesChange)
      }

      const { board: newBoardCards, deck: afterBoardDeck } = dealBoardCards(deck, advancedState)
      advancedState = { ...advancedState, board: [...publicState.board, ...newBoardCards] }

      const actingSeats = getActingSeats(advancedState)
      if (actingSeats.length <= 1) {
        const { publicState: runoutState, deck: runoutDeck } = advanceUntilActionOrShowdown(advancedState, afterBoardDeck)
        onDeckChange(runoutDeck)

        if (runoutState.turn.phase === 'showdown') {
          return conductShowdown(runoutState, newPrivateStates, runoutDeck, onDeckChange, onPrivateStatesChange)
        }

        return {
          ok: true,
          publicState: runoutState,
          privateStates: newPrivateStates,
        }
      }

      onDeckChange(afterBoardDeck)

      return {
        ok: true,
        publicState: advancedState,
        privateStates: newPrivateStates,
      }
    }

    return { ok: false, reason: 'unknown action' }
  }
}

// Conduct showdown and determine winners
function conductShowdown(
  publicState: PokerPublicState,
  privateStates: Record<string, PokerPrivateState>,
  _deck: Card[],
  _onDeckChange: (newDeck: Card[]) => void,
  _onPrivateStatesChange: (newStates: Record<string, PokerPrivateState>) => void,
): ActionOutcome<PokerPublicState, PokerPrivateState> {
  void _deck
  void _onDeckChange
  void _onPrivateStatesChange
  const activePlayers = getActivePlayers(publicState)
  const foldedIds = new Set(publicState.seatOrder.filter((id) => publicState.hands[id].folded))

  // Compute side pots based on total contributions
  const contributions: Record<string, number> = {}
  for (const seatId of publicState.seatOrder) {
    contributions[seatId] = publicState.hands[seatId].totalContributedThisHand
  }

  const sidePots = computeSidePots(contributions, foldedIds)

  // Evaluate hands for all active (non-folded) players using their PRIVATE
  // cards -- publicState.hands[seatId].cards is empty until the reveal below,
  // by design (see the dealing comments in state.ts / startNewHand).
  const handEvals: Record<string, any> = {}
  for (const seatId of activePlayers) {
    try {
      const hand = evaluateBestHand(privateStates[seatId].hand, publicState.board)
      handEvals[seatId] = hand
    } catch (e) {
      // Should not happen if board is complete
      return { ok: false, reason: 'error evaluating hand' }
    }
  }

  // Award each side pot
  const newChips = { ...publicState.chips }
  const potBreakdown = []
  const allWinners = []

  for (const sidePot of sidePots) {
    const eligiblePlayers = sidePot.eligiblePlayerIds.filter((id) => activePlayers.includes(id))

    if (eligiblePlayers.length === 0) continue

    // Find best hand among eligible
    let bestPlayers = [eligiblePlayers[0]]
    let bestHand = handEvals[eligiblePlayers[0]]

    for (let i = 1; i < eligiblePlayers.length; i++) {
      const seatId = eligiblePlayers[i]
      const hand = handEvals[seatId]
      const cmp = compareRanks(hand, bestHand)
      if (cmp > 0) {
        bestPlayers = [seatId]
        bestHand = hand
      } else if (cmp === 0) {
        bestPlayers.push(seatId)
      }
    }

    // Split pot among tied winners
    const awardPerWinner = Math.floor(sidePot.amount / bestPlayers.length)
    const oddChip = sidePot.amount % bestPlayers.length

    for (let i = 0; i < bestPlayers.length; i++) {
      const seatId = bestPlayers[i]
      const award = awardPerWinner + (i === 0 && oddChip > 0 ? oddChip : 0)
      newChips[seatId] = (newChips[seatId] ?? 0) + award
      allWinners.push({ playerId: seatId, amount: award })
    }

    potBreakdown.push({
      amount: sidePot.amount,
      eligiblePlayerIds: sidePot.eligiblePlayerIds,
      winnerIds: bestPlayers,
    })
  }

  // Reveal: a genuine showdown means every contesting (non-folded) player's
  // cards become public. Folded players' cards are never revealed.
  const revealedHands: Record<string, PokerPlayerHandState> = { ...publicState.hands }
  for (const seatId of activePlayers) {
    revealedHands[seatId] = { ...revealedHands[seatId], cards: privateStates[seatId].hand }
  }

  return {
    ok: true,
    publicState: {
      ...publicState,
      hands: revealedHands,
      chips: newChips,
      handOver: true,
      handResults: {
        winners: allWinners,
        potBreakdown,
      },
    },
    privateStates: Object.fromEntries(publicState.seatOrder.map((seatId) => [seatId, { hand: [] }])),
  }
}

export function applyPokerAction(
  holdemSession: PokerSession,
  playerId: string,
  action: PokerAction,
): { holdemSession: PokerSession; outcome: ActionOutcome<PokerPublicState, PokerPrivateState> } {
  let candidateDeck = holdemSession.deck
  let _candidatePrivateStates: Record<string, PokerPrivateState> = {}

  const validate = makeValidator(
    holdemSession,
    (d) => {
      candidateDeck = d
    },
    (s) => {
      _candidatePrivateStates = s
    },
  )

  void _candidatePrivateStates

  const { session, outcome } = applyAction(holdemSession.session, playerId, action, validate)

  // The deck mirrors the session's commit semantics: a rejected action must
  // not advance it (the session layer already reverts state on ok: false;
  // adopting candidateDeck unconditionally would silently lose cards).
  return {
    holdemSession: { session, deck: outcome.ok ? candidateDeck : holdemSession.deck, rng: holdemSession.rng },
    outcome,
  }
}

export function runPokerBotTurn(
  holdemSession: PokerSession,
  playerId: string,
  strategy: BotStrategy<PokerPublicState, PokerPrivateState, PokerAction>,
): { holdemSession: PokerSession; outcome: ActionOutcome<PokerPublicState, PokerPrivateState> } {
  let candidateDeck = holdemSession.deck
  let _candidatePrivateStates: Record<string, PokerPrivateState> = {}

  const validate = makeValidator(
    holdemSession,
    (d) => {
      candidateDeck = d
    },
    (s) => {
      _candidatePrivateStates = s
    },
  )

  void _candidatePrivateStates

  const { session, outcome } = runBotTurn(holdemSession.session, playerId, strategy, validate)

  // The deck mirrors the session's commit semantics: a rejected action must
  // not advance it (the session layer already reverts state on ok: false;
  // adopting candidateDeck unconditionally would silently lose cards).
  return {
    holdemSession: { session, deck: outcome.ok ? candidateDeck : holdemSession.deck, rng: holdemSession.rng },
    outcome,
  }
}
