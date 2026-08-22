import type { Card } from '../../card-engine/cards.ts'
import type { ActionOutcome, ActionValidator } from '../../engine/sync.ts'
import { applyAction } from '../../engine/sync.ts'
import { runBotTurn, type BotStrategy } from '../../engine/bot.ts'
import { advanceTurn, currentPlayer, setPhase, createTurnState } from '../../engine/turn-engine.ts'
import { moveCards, removeCardsById, topCard, cardCount, createPlayerZone, recyclePile, type Zone } from '../../card-engine/zones.ts'
import { shuffleDeck } from '../../card-engine/deck.ts'
import { classifyMeld, hasMeldIncluding } from './melds.ts'
import { deadwood, playerContributedMeldValue } from './scoring.ts'
import type { RummySession, RummyPublicState, RummyPrivateState, RummyAction, RummyPhase, RummyLayoff } from './state.ts'
import { dealRound, fullMeldCards } from './state.ts'

// Every meld group currently on the table, each with its FULL current cards (original zone +
// any lay-offs it's received) — the unit scoring and Ace-value context operate over.
function allMeldGroups(
  melds: Record<string, Zone[]>,
  layoffs: RummyLayoff[],
): { targetPlayerId: string; meldIndex: number; cards: ReturnType<typeof fullMeldCards> }[] {
  const groups: { targetPlayerId: string; meldIndex: number; cards: ReturnType<typeof fullMeldCards> }[] = []
  for (const [ownerId, zones] of Object.entries(melds)) {
    zones.forEach((_zone, meldIndex) => {
      groups.push({ targetPlayerId: ownerId, meldIndex, cards: fullMeldCards(melds, layoffs, ownerId, meldIndex) })
    })
  }
  return groups
}

// True iff the pending obligated card could still be used after this action: either some
// subset of the remaining hand melds it, or it can be laid off onto some existing meld group.
function obligationSatisfiable(
  obligatedCard: Card,
  remainingHand: Card[],
  melds: Record<string, Zone[]>,
  layoffs: RummyLayoff[],
): boolean {
  if (hasMeldIncluding(remainingHand, obligatedCard.id)) return true
  for (const g of allMeldGroups(melds, layoffs)) {
    if (classifyMeld([...g.cards, obligatedCard]).valid) return true
  }
  return false
}

// Who actually played a given card id — the zone owner if it's part of an original meld zone,
// or whoever laid it off otherwise. Every meld card comes from exactly one of these two places.
function contributorOf(
  melds: Record<string, Zone[]>,
  layoffs: RummyLayoff[],
  cardId: string,
): string | undefined {
  for (const [ownerId, zones] of Object.entries(melds)) {
    for (const zone of zones) {
      if (zone.cards.some((c) => c.id === cardId)) return ownerId
    }
  }
  for (const l of layoffs) {
    if (l.cards.some((c) => c.id === cardId)) return l.playerId
  }
  return undefined
}

function finishRoundByGoingOut(
  publicState: RummyPublicState,
  privateStates: Record<string, RummyPrivateState>,
  playerId: string,
  newMelds: Record<string, Zone[]>,
  newLayoffs: RummyLayoff[],
  newObligated: string | null,
  newDiscard?: Zone,
): ActionOutcome<RummyPublicState, RummyPrivateState> {
  // Score by CONTRIBUTION, not by whose meld a card physically sits in — a card either player
  // laid off onto the other's meld still scores to whoever played it.
  const groups = allMeldGroups(newMelds, newLayoffs)
  const contributedBy = (cardId: string) => contributorOf(newMelds, newLayoffs, cardId)

  // One uniform formula for every seated player, the going-out player included: their hand is
  // empty, so deadwood([]) is 0 and their delta is exactly their own meld contribution. At 2
  // players this is provably identical to the old two-formula split (going-out player got
  // contribution only, "opponent" got contribution minus deadwood) — the split was never
  // necessary; one loop covers every seat, so N-player rounds score everyone symmetrically.
  const newScores: Record<string, number> = {}
  for (const p of publicState.seatOrder) {
    const handCards = p === playerId ? [] : privateStates[p].hand.cards
    newScores[p] = publicState.scores[p]
      + playerContributedMeldValue(groups, contributedBy, p)
      - deadwood(handCards)
  }

  // Match win: every player at/above target is a candidate. Among them, the STRICTLY
  // HIGHEST scorer wins — this preserves the old 2-player if/else tree exactly, where an
  // opponent who scored strictly higher won even though the other player went out. A tie for
  // the highest score is broken by the going-out player winning IF they're part of the tie
  // (the old `newScores[playerId] >= newScores[opponentId] ? playerId : opponentId` tiebreak,
  // generalized from 2 candidates to N); if the going-out player is NOT part of the tie, the
  // tied player with the earliest position in the FIXED seatOrder wins — deterministic,
  // never object-iteration order. All candidate/tie lists are filtered in seatOrder order, so
  // the first element is always the earliest seat.
  let matchWinnerId: string | null = null
  const atTarget = publicState.seatOrder.filter((p) => newScores[p] >= publicState.target)
  if (atTarget.length > 0) {
    let maxScore = newScores[atTarget[0]]
    for (const p of atTarget) {
      if (newScores[p] > maxScore) maxScore = newScores[p]
    }
    const tiedForMax = atTarget.filter((p) => newScores[p] === maxScore)
    if (tiedForMax.length === 1) {
      matchWinnerId = tiedForMax[0]                       // lone highest scorer, going-out or not
    } else if (tiedForMax.includes(playerId)) {
      matchWinnerId = playerId                            // going-out player wins a highest-score tie
    } else {
      matchWinnerId = tiedForMax[0]                       // earliest seatOrder position among the tied
    }
  }

  return {
    ok: true,
    publicState: {
      ...publicState,
      melds: newMelds,
      layoffs: newLayoffs,
      obligatedCardId: newObligated,
      ...(newDiscard ? { discardPile: newDiscard } : {}),
      scores: newScores,
      matchWinnerId,
      roundOver: true,
      roundWinnerId: playerId,
      handCounts: { ...publicState.handCounts, [playerId]: 0 },
    },
    privateStates,
  }
}

function makeValidator(
  currentStock: Zone,
  rng: () => number,
  onStockChange: (newStock: Zone) => void,
): ActionValidator<RummyPublicState, RummyPrivateState, RummyAction> {
  return (session, playerId, action) => {
    const { publicState, privateStates } = session

    // START_NEXT_ROUND is the one action NOT gated by "is it your turn" — either player may trigger
    // dealing a fresh round once the current one is over and the match isn't decided.
    if (action.type === 'START_NEXT_ROUND') {
      if (!Object.hasOwn(privateStates, playerId)) return { ok: false, reason: 'not a player in this match' }
      if (!publicState.roundOver || publicState.matchWinnerId) {
        return { ok: false, reason: 'round is not over, or the match is already decided' }
      }
      const { hands, stock: newStock, discardPile } = dealRound(publicState.seatOrder, rng)
      onStockChange(newStock)
      // The next round's starter rotates through the FIXED seatOrder (never the previous
      // round's turn order): seatOrder[roundNumber % seatOrder.length], where roundNumber is
      // the 1-based round that just ended — round 1 ends → seatOrder[1] starts round 2, etc.,
      // wrapping to seatOrder[0] every len rounds. (Uno's 0-based round indexes the starter
      // with nextRound % len; the 1-based equivalent here is roundNumber % len.) Build the
      // turn fresh, then advanceTurn exactly that many times — exactly Uno's pattern.
      let turn = createTurnState<RummyPhase>(publicState.seatOrder, 'draw')
      for (let i = 0; i < publicState.roundNumber % publicState.seatOrder.length; i++) turn = advanceTurn(turn, 'draw')
      const melds: Record<string, Zone[]> = {}
      const handCounts: Record<string, number> = {}
      const newPrivateStates: Record<string, RummyPrivateState> = {}
      for (const seatedPlayer of publicState.seatOrder) {
        melds[seatedPlayer] = []
        handCounts[seatedPlayer] = cardCount(hands[seatedPlayer])
        newPrivateStates[seatedPlayer] = { hand: hands[seatedPlayer] }
      }
      return {
        ok: true,
        publicState: {
          ...publicState,
          turn,
          discardPile,
          stockCount: cardCount(newStock),
          melds,
          layoffs: [],
          obligatedCardId: null,
          roundNumber: publicState.roundNumber + 1,
          roundOver: false,
          roundWinnerId: null,
          handCounts,
        },
        privateStates: newPrivateStates,
      }
    }

    const isMyTurn = currentPlayer(publicState.turn) === playerId
    const myHand = privateStates[playerId]?.hand
    if (!isMyTurn || !myHand) {
      return { ok: false, reason: 'not your turn' }
    }

    if (action.type === 'DRAW_FROM_STOCK') {
      if (publicState.turn.phase !== 'draw') return { ok: false, reason: 'not draw phase' }
      if (cardCount(currentStock) > 0) {
        const top = topCard(currentStock)!
        const { from: newStock, to: newHand } = moveCards(currentStock, myHand, [top.id])
        onStockChange(newStock)
        return {
          ok: true,
          publicState: {
            ...publicState,
            turn: setPhase(publicState.turn, 'discard'),
            stockCount: cardCount(newStock),
            handCounts: { ...publicState.handCounts, [playerId]: cardCount(newHand) },
          },
          privateStates: { ...privateStates, [playerId]: { hand: newHand } },
        }
      }
      // stock is empty — try to recycle the discard pile (keep its current top card in place)
      if (cardCount(publicState.discardPile) >= 2) {
        const { source: newDiscard, dest: recycledStock } = recyclePile(
          publicState.discardPile,
          currentStock,
          { keepTop: 1, shuffle: (cards) => shuffleDeck(cards, rng) },
        )
        const top = topCard(recycledStock)!
        const { from: newStock, to: newHand } = moveCards(recycledStock, myHand, [top.id])
        onStockChange(newStock)
        return {
          ok: true,
          publicState: {
            ...publicState,
            turn: setPhase(publicState.turn, 'discard'),
            discardPile: newDiscard,
            stockCount: cardCount(newStock),
            handCounts: { ...publicState.handCounts, [playerId]: cardCount(newHand) },
          },
          privateStates: { ...privateStates, [playerId]: { hand: newHand } },
        }
      }
      // can't recycle (discard has 0 or 1 cards) — if discard is completely empty too, nobody can draw
      // anything at all this turn: the round is blocked. Otherwise, the player should draw from the
      // discard pile instead (it still has exactly 1 card available).
      if (cardCount(publicState.discardPile) === 0) {
        return {
          ok: true,
          publicState: { ...publicState, roundOver: true, roundWinnerId: null },
          privateStates,
        }
      }
      return { ok: false, reason: 'stock is empty — draw from the discard pile instead' }
    }

    if (action.type === 'DRAW_FROM_DISCARD') {
      if (publicState.turn.phase !== 'draw') return { ok: false, reason: 'not draw phase' }
      const pile = publicState.discardPile.cards
      if (pile.length === 0) return { ok: false, reason: 'discard pile is empty' }
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= pile.length) return { ok: false, reason: 'invalid index' }
      const takenIds = pile.slice(action.index).map((c) => c.id)
      const reachedCardId = pile[action.index].id
      if (takenIds.length > 1) {
        const takenCards = pile.slice(action.index)
        const resultingHandCards = [...myHand.cards, ...takenCards]
        const reachedCard = takenCards.find((c) => c.id === reachedCardId)!
        const meldableInHand = hasMeldIncluding(resultingHandCards, reachedCardId)
        const layoffableOnTable = allMeldGroups(publicState.melds, publicState.layoffs)
          .some((g) => classifyMeld([...g.cards, reachedCard]).valid)
        if (!meldableInHand && !layoffableOnTable) {
          return { ok: false, reason: 'that card cannot be melded — reach for a different card, or draw just the top card instead' }
        }
      }
      const { from: newDiscard, to: newHand } = moveCards(publicState.discardPile, myHand, takenIds)
      const obligated = takenIds.length > 1 ? reachedCardId : null
      return {
        ok: true,
        publicState: {
          ...publicState,
          turn: setPhase(publicState.turn, 'discard'),
          discardPile: newDiscard,
          obligatedCardId: obligated,
          handCounts: { ...publicState.handCounts, [playerId]: cardCount(newHand) },
        },
        privateStates: { ...privateStates, [playerId]: { hand: newHand } },
      }
    }

    if (action.type === 'LAY_DOWN_MELD') {
      if (publicState.turn.phase !== 'discard') return { ok: false, reason: 'draw first' }
      if (!Array.isArray(action.cardIds)) return { ok: false, reason: 'invalid cardIds' }
      const selected = myHand.cards.filter((c) => action.cardIds.includes(c.id))
      if (selected.length !== action.cardIds.length) return { ok: false, reason: 'card not in hand' }
      const classification = classifyMeld(selected)
      if (!classification.valid) return { ok: false, reason: 'not a valid set or run' }
      const meldZoneName = `meld-${publicState.melds[playerId]?.length ?? 0}`
      const { from: newHand, to: meldZone } = moveCards(myHand, createPlayerZone(playerId, meldZoneName, 'public'), action.cardIds)
      const newMeldsForPlayer = [...(publicState.melds[playerId] ?? []), meldZone]
      const newMelds = { ...publicState.melds, [playerId]: newMeldsForPlayer }
      const newObligated = publicState.obligatedCardId && action.cardIds.includes(publicState.obligatedCardId)
        ? null
        : publicState.obligatedCardId

      if (newObligated) {
        const obligCard = newHand.cards.find((c) => c.id === newObligated)!
        if (!obligationSatisfiable(obligCard, newHand.cards, newMelds, publicState.layoffs)) {
          return { ok: false, reason: 'that would leave no way to use the card you reached for' }
        }
      }

      // Going out requires a discard — melding your last card just ends your turn (nothing
      // left to discard), and the round continues.
      const meldTurn = cardCount(newHand) === 0 ? advanceTurn(publicState.turn, 'draw') : publicState.turn
      return {
        ok: true,
        publicState: { ...publicState, turn: meldTurn, melds: newMelds, obligatedCardId: newObligated, handCounts: { ...publicState.handCounts, [playerId]: cardCount(newHand) } },
        privateStates: { ...privateStates, [playerId]: { hand: newHand } },
      }
    }

    if (action.type === 'LAY_OFF') {
      if (publicState.turn.phase !== 'discard') return { ok: false, reason: 'draw first' }
      if (!(publicState.melds[playerId]?.length)) {
        return { ok: false, reason: 'lay down a meld of your own before laying off onto others' }
      }
      if (!Array.isArray(action.cardIds) || action.cardIds.length === 0) return { ok: false, reason: 'invalid cardIds' }
      if (!publicState.melds[action.targetPlayerId]?.[action.meldIndex]) return { ok: false, reason: 'no such meld' }
      const selected = myHand.cards.filter((c) => action.cardIds.includes(c.id))
      if (selected.length !== action.cardIds.length) return { ok: false, reason: 'card not in hand' }
      const currentFull = fullMeldCards(publicState.melds, publicState.layoffs, action.targetPlayerId, action.meldIndex)
      const combined = [...currentFull, ...selected]
      if (!classifyMeld(combined).valid) return { ok: false, reason: 'those cards cannot be added to that group' }

      // Cards leave the hand but are NOT merged into the target meld's zone — they stay
      // attributed to (and render on the side of) whoever laid them off. See RummyLayoff.
      const { zone: newHand, removed } = removeCardsById(myHand, action.cardIds)
      const newLayoff: RummyLayoff = {
        id: `layoff-${publicState.layoffs.length}`,
        playerId,
        targetPlayerId: action.targetPlayerId,
        targetMeldIndex: action.meldIndex,
        cards: removed,
      }
      const newLayoffs = [...publicState.layoffs, newLayoff]
      const newObligated = publicState.obligatedCardId && action.cardIds.includes(publicState.obligatedCardId)
        ? null
        : publicState.obligatedCardId

      if (newObligated) {
        const obligCard = newHand.cards.find((c) => c.id === newObligated)!
        if (!obligationSatisfiable(obligCard, newHand.cards, publicState.melds, newLayoffs)) {
          return { ok: false, reason: 'that would leave no way to use the card you reached for' }
        }
      }

      // Same discard-to-go-out rule as LAY_DOWN_MELD: an empty hand ends the turn, not the round.
      const layoffTurn = cardCount(newHand) === 0 ? advanceTurn(publicState.turn, 'draw') : publicState.turn
      return {
        ok: true,
        publicState: { ...publicState, turn: layoffTurn, layoffs: newLayoffs, obligatedCardId: newObligated, handCounts: { ...publicState.handCounts, [playerId]: cardCount(newHand) } },
        privateStates: { ...privateStates, [playerId]: { hand: newHand } },
      }
    }

    if (action.type === 'DISCARD_CARD') {
      if (publicState.turn.phase !== 'discard') return { ok: false, reason: 'draw first' }
      if (publicState.obligatedCardId) {
        return { ok: false, reason: 'you must use the card you reached for in a meld before discarding' }
      }
      const hasCard = myHand.cards.some((c) => c.id === action.cardId)
      if (!hasCard) return { ok: false, reason: 'card not in hand' }
      const { from: newHand, to: newDiscard } = moveCards(myHand, publicState.discardPile, [action.cardId])

      if (cardCount(newHand) === 0) {
        return finishRoundByGoingOut(publicState, { ...privateStates, [playerId]: { hand: newHand } }, playerId, publicState.melds, publicState.layoffs, null, newDiscard)
      }
      return {
        ok: true,
        publicState: { ...publicState, turn: advanceTurn(publicState.turn, 'draw'), discardPile: newDiscard, handCounts: { ...publicState.handCounts, [playerId]: cardCount(newHand) } },
        privateStates: { ...privateStates, [playerId]: { hand: newHand } },
      }
    }

    return { ok: false, reason: 'unknown action' }
  }
}

export function applyRummyAction(
  rummy: RummySession,
  playerId: string,
  action: RummyAction,
): { rummy: RummySession; outcome: ActionOutcome<RummyPublicState, RummyPrivateState> } {
  let candidateStock = rummy.stock
  const validate = makeValidator(rummy.stock, rummy.rng, (s) => { candidateStock = s })
  const { session, outcome } = applyAction(rummy.session, playerId, action, validate)
  const stock = outcome.ok ? candidateStock : rummy.stock
  return { rummy: { session, stock, rng: rummy.rng }, outcome }
}

export function runRummyBotTurn(
  rummy: RummySession,
  playerId: string,
  strategy: BotStrategy<RummyPublicState, RummyPrivateState, RummyAction>,
): { rummy: RummySession; outcome: ActionOutcome<RummyPublicState, RummyPrivateState> } {
  let candidateStock = rummy.stock
  const validate = makeValidator(rummy.stock, rummy.rng, (s) => { candidateStock = s })
  const { session, outcome } = runBotTurn(rummy.session, playerId, strategy, validate)
  const stock = outcome.ok ? candidateStock : rummy.stock
  return { rummy: { session, stock, rng: rummy.rng }, outcome }
}
