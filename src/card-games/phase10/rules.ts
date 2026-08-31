import type { ActionOutcome, ActionValidator } from '../../engine/sync.ts'
import { applyAction } from '../../engine/sync.ts'
import { runBotTurn, type BotStrategy } from '../../engine/bot.ts'
import { advanceTurn, currentPlayer, setPhase, skipNext, createTurnState } from '../../engine/turn-engine.ts'
import { moveCards, removeCardsById, topCard, cardCount, createPlayerZone, addCards, recyclePile, type Zone } from '../../card-engine/zones.ts'
import { shuffleDeck } from '../../card-engine/deck.ts'
import { classifyPhaseHand, validateGroupExtension } from './classify.ts'
import { PHASES } from './phases.ts'
import { handPenalty } from './scoring.ts'
import type { Phase10Session, Phase10PublicState, Phase10PrivateState, Phase10Action, Phase10TurnPhase, Phase10Group, Phase10Hit } from './state.ts'
import { dealRound, fullGroupCards } from './state.ts'

// Shared round-ending logic, called from every action that can empty the acting player's
// hand (LAY_PHASE, HIT, DISCARD_CARD). Scores the round, advances laid players' phases for
// next round, and decides whether the match is over.
function finishRoundByGoingOut(
  publicState: Phase10PublicState,
  privateStates: Record<string, Phase10PrivateState>,
  playerId: string,               // who went out
  newGroups: Record<string, Phase10Group[]>,
  newHits: Phase10Hit[],
  newHasLaidPhase: Record<string, boolean>,
  newDiscard?: Zone,
): ActionOutcome<Phase10PublicState, Phase10PrivateState> {
  // 1. Round scoring: the player who went out scores +0 this round. Every OTHER seated player
  //    adds the penalty of their OWN remaining hand — never anyone else's. Lower cumulative
  //    score is better — never invert or subtract, just add the penalty. (Phase 10, unlike
  //    Rummy, never gives the going-out player a positive contribution: going out just means
  //    paying nothing this round.) At 2 players this loop is provably identical to the old
  //    two-player split — the going-out player's score was unchanged and the opponent got
  //    += handPenalty(their hand); iterating seatOrder instead of "the opponent" only
  //    generalizes, it doesn't change anything.
  const newScores: Record<string, number> = {}
  for (const p of publicState.seatOrder) {
    newScores[p] = publicState.scores[p] + (p === playerId ? 0 : handPenalty(privateStates[p].hand.cards))
  }

  // 2. Phase advancement: players who laid their phase this round advance one phase next
  //    round (capped at index 9); players who didn't repeat their current phase. This is
  //    written into publicState.phaseIdx NOW because START_NEXT_ROUND deliberately does NOT
  //    touch phaseIdx — the advancement has to happen here, at round-end, not there.
  const newPhaseIdx: Record<string, number> = {}
  for (const p of publicState.turn.playerOrder) {
    newPhaseIdx[p] = newHasLaidPhase[p]
      ? Math.min(publicState.phaseIdx[p] + 1, 9)
      : publicState.phaseIdx[p]
  }

  // 3. Match win check: a player "completed Phase 10 this hand" iff they laid their phase
  //    AND their PRE-advancement phaseIdx was 9 (the phase they just laid was Phase 10
  //    itself). Among all completers, the one with the lowest NEW score (post this round's
  //    scoring) wins; on an exact tie, whichever completer appears first in
  //    publicState.turn.playerOrder wins — an arbitrary but stable tiebreak of last resort
  //    (real ties are vanishingly rare, but this function must be total).
  const completers = publicState.turn.playerOrder.filter(
    (p) => newHasLaidPhase[p] && publicState.phaseIdx[p] === 9,
  )
  let matchWinnerId: string | null = null
  if (completers.length > 0) {
    let best = completers[0]
    for (const p of completers) {
      if (newScores[p] < newScores[best]) best = p
    }
    matchWinnerId = best
  }

  return {
    ok: true,
    publicState: {
      ...publicState,
      groups: newGroups,
      hits: newHits,
      hasLaidPhase: newHasLaidPhase,
      phaseIdx: newPhaseIdx,
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
): ActionValidator<Phase10PublicState, Phase10PrivateState, Phase10Action> {
  return (session, playerId, action) => {
    const { publicState, privateStates } = session

    // START_NEXT_ROUND is the one action NOT gated by "is it your turn" — either player may
    // trigger dealing a fresh round once the current one is over and the match isn't decided.
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
      // wrapping to seatOrder[0] every len rounds. Build the turn fresh, then advanceTurn
      // exactly that many times — exactly Rummy's spec 35 mechanism. phaseIdx is deliberately
      // NOT touched here (phase advancement happens in finishRoundByGoingOut, see its comment).
      let turn = createTurnState<Phase10TurnPhase>(publicState.seatOrder, 'draw')
      for (let i = 0; i < publicState.roundNumber % publicState.seatOrder.length; i++) turn = advanceTurn(turn, 'draw')
      const groups: Record<string, Phase10Group[]> = {}
      const hasLaidPhase: Record<string, boolean> = {}
      const handCounts: Record<string, number> = {}
      const newPrivateStates: Record<string, Phase10PrivateState> = {}
      for (const seatedPlayer of publicState.seatOrder) {
        groups[seatedPlayer] = []
        hasLaidPhase[seatedPlayer] = false
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
          groups,
          hits: [],
          hasLaidPhase,
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
      // can't recycle (discard has 0 or 1 cards) — if discard is completely empty, or it holds
      // just a lone Skip (which can never be drawn from the discard pile), nobody can draw
      // anything at all this turn: the round is blocked. Otherwise, the player should draw from
      // the discard pile instead (it still has exactly 1 card available). On a block there are
      // no score/phaseIdx changes — nobody completed or failed anything.
      const discardCount = cardCount(publicState.discardPile)
      const lonelySkip = discardCount === 1 && topCard(publicState.discardPile)?.meta?.kind === 'skip'
      if (discardCount === 0 || lonelySkip) {
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
      if (cardCount(publicState.discardPile) === 0) return { ok: false, reason: 'discard pile is empty' }
      const top = topCard(publicState.discardPile)!
      if (top.meta?.kind === 'skip') {
        return { ok: false, reason: 'a Skip card can never be picked up from the discard pile — draw from the stock instead' }
      }
      // top card only, no reach-in — Phase 10 has no obligation to track afterwards
      const { from: newDiscard, to: newHand } = moveCards(publicState.discardPile, myHand, [top.id])
      return {
        ok: true,
        publicState: {
          ...publicState,
          turn: setPhase(publicState.turn, 'discard'),
          discardPile: newDiscard,
          handCounts: { ...publicState.handCounts, [playerId]: cardCount(newHand) },
        },
        privateStates: { ...privateStates, [playerId]: { hand: newHand } },
      }
    }

    if (action.type === 'LAY_PHASE') {
      if (publicState.turn.phase !== 'discard') return { ok: false, reason: 'draw first' }
      if (publicState.hasLaidPhase[playerId]) {
        return { ok: false, reason: 'you have already laid your phase this round' }
      }
      if (!Array.isArray(action.cardIds)) return { ok: false, reason: 'invalid cardIds' }
      const selected = myHand.cards.filter((c) => action.cardIds.includes(c.id))
      if (selected.length !== action.cardIds.length) return { ok: false, reason: 'card not in hand' }
      if (selected.some((c) => c.meta?.kind === 'skip')) {
        return { ok: false, reason: 'a Skip card cannot be used in a phase' }
      }
      const requirement = PHASES[publicState.phaseIdx[playerId]]
      const classification = classifyPhaseHand(selected, requirement)
      if (!classification.valid) return { ok: false, reason: 'that does not complete your phase' }
      const phaseGroups = classification.groups!   // defined whenever valid is true

      const { zone: newHand } = removeCardsById(myHand, action.cardIds)
      const existingGroupCount = publicState.groups[playerId]?.length ?? 0
      const newGroupsForPlayer = [...(publicState.groups[playerId] ?? [])]
      phaseGroups.forEach((group, i) => {
        const zone = addCards(createPlayerZone(playerId, `p10group-${existingGroupCount + i}`, 'public'), group.cards)
        newGroupsForPlayer.push({ type: group.type, zone, phaseNumber: requirement.phase })
      })
      const newGroups = { ...publicState.groups, [playerId]: newGroupsForPlayer }
      const newHasLaidPhase = { ...publicState.hasLaidPhase, [playerId]: true }

      if (cardCount(newHand) === 0) {
        return finishRoundByGoingOut(
          publicState,
          { ...privateStates, [playerId]: { hand: newHand } },
          playerId,
          newGroups,
          publicState.hits,
          newHasLaidPhase,
        )
      }
      return {
        ok: true,
        publicState: {
          ...publicState,
          groups: newGroups,
          hasLaidPhase: newHasLaidPhase,
          handCounts: { ...publicState.handCounts, [playerId]: cardCount(newHand) },
        },
        privateStates: { ...privateStates, [playerId]: { hand: newHand } },
      }
    }

    if (action.type === 'HIT') {
      if (publicState.turn.phase !== 'discard') return { ok: false, reason: 'draw first' }
      if (!publicState.hasLaidPhase[playerId]) {
        return { ok: false, reason: 'lay your own phase before hitting' }
      }
      if (!publicState.groups[action.targetPlayerId]?.[action.groupIndex]) {
        return { ok: false, reason: 'no such group' }
      }
      if (!Array.isArray(action.cardIds) || action.cardIds.length === 0) return { ok: false, reason: 'invalid cardIds' }
      const selected = myHand.cards.filter((c) => action.cardIds.includes(c.id))
      if (selected.length !== action.cardIds.length) return { ok: false, reason: 'card not in hand' }
      // Check against the FULL accumulated group so far, via the shared predicate —
      // the bot's hit search and the table UI use the same one, so what they propose
      // and what this validator accepts can never drift apart again.
      const currentFull = fullGroupCards(publicState.groups, publicState.hits, action.targetPlayerId, action.groupIndex)
      const groupType = publicState.groups[action.targetPlayerId][action.groupIndex].type
      const extension = validateGroupExtension(currentFull, groupType, selected)
      if (!extension.ok) return { ok: false, reason: extension.reason }

      // Cards leave the hand but are NOT merged into the target group's zone — they stay
      // attributed to (and render on the side of) whoever hit them. See Phase10Hit.
      const { zone: newHand, removed } = removeCardsById(myHand, action.cardIds)
      const newHit: Phase10Hit = {
        id: `hit-${publicState.hits.length}`,
        playerId,
        targetPlayerId: action.targetPlayerId,
        targetGroupIndex: action.groupIndex,
        cards: removed,
      }
      const newHits = [...publicState.hits, newHit]

      if (cardCount(newHand) === 0) {
        return finishRoundByGoingOut(
          publicState,
          { ...privateStates, [playerId]: { hand: newHand } },
          playerId,
          publicState.groups,
          newHits,
          publicState.hasLaidPhase,
        )
      }
      return {
        ok: true,
        publicState: {
          ...publicState,
          hits: newHits,
          handCounts: { ...publicState.handCounts, [playerId]: cardCount(newHand) },
        },
        privateStates: { ...privateStates, [playerId]: { hand: newHand } },
      }
    }

    if (action.type === 'DISCARD_CARD') {
      if (publicState.turn.phase !== 'discard') return { ok: false, reason: 'draw first' }
      const hasCard = myHand.cards.some((c) => c.id === action.cardId)
      if (!hasCard) return { ok: false, reason: 'card not in hand' }
      const { from: newHand, to: newDiscard } = moveCards(myHand, publicState.discardPile, [action.cardId])

      if (cardCount(newHand) === 0) {
        return finishRoundByGoingOut(publicState, { ...privateStates, [playerId]: { hand: newHand } }, playerId, publicState.groups, publicState.hits, publicState.hasLaidPhase, newDiscard)
      }

      // Every discarded Skip skips the NEXT player's turn: skipNext advances by 2 seats in
      // playerOrder order. With 2 players that lands back on the discarder (nobody to skip);
      // with 3+ it passes the next player entirely. No per-round cap on repeat Skips against
      // the same target — a possible future house-rule toggle, not implemented today.
      const discarded = newDiscard.cards[newDiscard.cards.length - 1]
      const skipApplied = discarded.meta?.kind === 'skip'
      return {
        ok: true,
        publicState: {
          ...publicState,
          turn: skipApplied ? skipNext(publicState.turn, 'draw') : advanceTurn(publicState.turn, 'draw'),
          discardPile: newDiscard,
          handCounts: { ...publicState.handCounts, [playerId]: cardCount(newHand) },
        },
        privateStates: { ...privateStates, [playerId]: { hand: newHand } },
      }
    }

    return { ok: false, reason: 'unknown action' }
  }
}

export function applyPhase10Action(
  game: Phase10Session,
  playerId: string,
  action: Phase10Action,
): { game: Phase10Session; outcome: ActionOutcome<Phase10PublicState, Phase10PrivateState> } {
  let candidateStock = game.stock
  const validate = makeValidator(game.stock, game.rng, (s) => { candidateStock = s })
  const { session, outcome } = applyAction(game.session, playerId, action, validate)
  const stock = outcome.ok ? candidateStock : game.stock
  return { game: { session, stock, rng: game.rng }, outcome }
}

export function runPhase10BotTurn(
  game: Phase10Session,
  playerId: string,
  strategy: BotStrategy<Phase10PublicState, Phase10PrivateState, Phase10Action>,
): { game: Phase10Session; outcome: ActionOutcome<Phase10PublicState, Phase10PrivateState> } {
  let candidateStock = game.stock
  const validate = makeValidator(game.stock, game.rng, (s) => { candidateStock = s })
  const { session, outcome } = runBotTurn(game.session, playerId, strategy, validate)
  const stock = outcome.ok ? candidateStock : game.stock
  return { game: { session, stock, rng: game.rng }, outcome }
}
