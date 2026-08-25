import type { ActionOutcome, ActionValidator } from '../../engine/sync.ts'
import { applyAction } from '../../engine/sync.ts'
import { runBotTurn, type BotStrategy } from '../../engine/bot.ts'
import {
  advanceTurn,
  currentPlayer,
  createTurnState,
  reverseDirection,
  skipNext,
  type TurnState,
} from '../../engine/turn-engine.ts'
import { addCards, cardCount, moveCards, recyclePile, removeCardsById, topCard, type Zone } from '../../card-engine/zones.ts'
import { shuffleDeck } from '../../card-engine/deck.ts'
import type { UnoCard, UnoColor } from './deck.ts'
import type { UnoAction, UnoLastAction, UnoPrivateState, UnoPublicState, UnoSession, UnoStage } from './state.ts'
import { UNO_TARGET, dealUnoRound, handHasLegalPlay, isUnoColor, isUnoPlayable, unoCardPoints } from './state.ts'

// The player between the current player and where skipNext lands — the one who draws for
// draw2/wild4 and who gets skipped past.
function skippedPlayer(turn: TurnState<'play'>): string {
  const len = turn.playerOrder.length
  return turn.playerOrder[((turn.currentIndex + turn.direction) % len + len) % len]
}

type DrawOutcome =
  | { ok: true; stock: Zone<UnoCard>; discardPile: Zone<UnoCard>; drawn: UnoCard[] }
  | { ok: false }

// Draws `count` cards from the host-side stock. Whenever the stock runs out mid-draw, the
// discard pile (minus its current top) is recycled and reshuffled back into the stock — same
// keepTop-1 pattern as Rummy/Phase10. If recycling can't produce enough cards (discard has
// ≤1 card), the draw is unsatisfiable: ok: false, and nothing is committed.
function drawFromStock(
  currentStock: Zone<UnoCard>,
  discardPile: Zone<UnoCard>,
  count: number,
  rng: () => number,
): DrawOutcome {
  let stock = currentStock
  let discard = discardPile
  const drawn: UnoCard[] = []
  while (drawn.length < count) {
    if (cardCount(stock) === 0) {
      if (cardCount(discard) < 2) return { ok: false }
      const recycled = recyclePile(discard, stock, { keepTop: 1, shuffle: (cards) => shuffleDeck(cards, rng) })
      discard = recycled.source
      stock = recycled.dest
    }
    const { zone: newStock, removed } = removeCardsById(stock, [topCard(stock)!.id])
    stock = newStock
    drawn.push(removed[0])
  }
  return { ok: true, stock, discardPile: discard, drawn }
}

// Draws one card at a time until either a playable card is drawn or the
// stock (plus recycling) is exhausted. Bounded by the deck's finite size
// — cannot loop forever. Used only when houseRules.drawUntilPlayable is
// true; the standard (false) path still draws exactly one card via the
// existing drawFromStock(..., 1, ...) unchanged.
function drawUntilPlayable(
  currentStock: Zone<UnoCard>,
  discardPile: Zone<UnoCard>,
  activeColor: UnoColor,
  rng: () => number,
): DrawOutcome {
  let stock = currentStock
  let discard = discardPile
  const drawn: UnoCard[] = []
  for (;;) {
    const step = drawFromStock(stock, discard, 1, rng)
    if (!step.ok) return { ok: false }
    stock = step.stock
    discard = step.discardPile
    drawn.push(...step.drawn)
    const justDrawn = step.drawn[0]
    if (isUnoPlayable(justDrawn, topCard(discard)!, activeColor)) {
      return { ok: true, stock, discardPile: discard, drawn }
    }
  }
}

// The vanishing-stock fallback (mirrors Phase10's blocked round): the round ends with no
// out-player and no score change.
function blockedRound(
  publicState: UnoPublicState,
  privateStates: Record<string, UnoPrivateState>,
): ActionOutcome<UnoPublicState, UnoPrivateState> {
  return {
    ok: true,
    publicState: { ...publicState, stage: 'roundOver', roundResult: null, unoWindow: null },
    privateStates,
  }
}

// Round end via going out. Only the out-player's score moves — by the sum of unoCardPoints
// over every OTHER player's hand. pointsAdded records what each hand contributed to that
// gain (out-player's own entry is 0) so a UI can show "this round: +N" without recomputing.
function finishRoundByGoingOut(
  publicState: UnoPublicState,
  privateStates: Record<string, UnoPrivateState>,
  outPlayerId: string,
): ActionOutcome<UnoPublicState, UnoPrivateState> {
  const pointsAdded: Record<string, number> = {}
  const scores = { ...publicState.scores }
  let outGain = 0
  for (const playerId of publicState.seatOrder) {
    if (playerId === outPlayerId) {
      pointsAdded[playerId] = 0
      continue
    }
    const handSum = privateStates[playerId].hand.cards.reduce((sum, card) => sum + unoCardPoints(card), 0)
    pointsAdded[playerId] = handSum
    outGain += handSum
  }
  scores[outPlayerId] = scores[outPlayerId] + outGain
  const stage: UnoStage = scores[outPlayerId] >= UNO_TARGET ? 'over' : 'roundOver'
  return {
    ok: true,
    publicState: {
      ...publicState,
      scores,
      roundResult: { outPlayerId, pointsAdded },
      stage,
      matchWinnerId: stage === 'over' ? outPlayerId : null,
      handCounts: { ...publicState.handCounts, [outPlayerId]: 0 },
      pendingStack: null,   // clear any pending stack — going out ends the round, no draw happens
      unoWindow: null,   // the round is over — no window survives into roundOver/over, ever
    },
    privateStates,
  }
}

function makeValidator(
  currentStock: Zone<UnoCard>,
  rng: () => number,
  onStockChange: (newStock: Zone<UnoCard>) => void,
): ActionValidator<UnoPublicState, UnoPrivateState, UnoAction> {
  return (session, playerId, action) => {
    const { publicState, privateStates } = session

    // START_NEXT_ROUND is the one action NOT gated by "is it your turn" — any seated player
    // may trigger dealing a fresh round once the current one is over.
    if (action.type === 'START_NEXT_ROUND') {
      if (!Object.hasOwn(privateStates, playerId)) return { ok: false, reason: 'not a player in this match' }
      if (publicState.stage !== 'roundOver') return { ok: false, reason: 'the round is not over' }
      const nextRound = publicState.round + 1
      const { hands, stock: newStock, discardPile, activeColor } = dealUnoRound(publicState.seatOrder, rng)
      onStockChange(newStock)
      // The new round's starter is seat (round + 1) % seatCount.
      let turn = createTurnState<'play'>(publicState.seatOrder, 'play')
      for (let i = 0; i < nextRound % publicState.seatOrder.length; i++) turn = advanceTurn(turn, 'play')
      const handCounts: Record<string, number> = {}
      const newPrivateStates: Record<string, UnoPrivateState> = {}
      for (const seatedPlayer of publicState.seatOrder) {
        handCounts[seatedPlayer] = cardCount(hands[seatedPlayer])
        newPrivateStates[seatedPlayer] = { hand: hands[seatedPlayer] }
      }
      return {
        ok: true,
        publicState: {
          ...publicState,
          stage: 'play',
          turn,
          round: nextRound,
          activeColor,
          discardPile,
          stockCount: cardCount(newStock),
          handCounts,
          hasDrawnThisTurn: false,
          pendingWild: null,
          pendingStack: null,
          pendingSevenSwap: null,
          unoWindow: null,
          roundResult: null,
          lastAction: null,
        },
        privateStates: newPrivateStates,
      }
    }

    // CALL_UNO is the second action NOT gated by "is it your turn" — any seated player may
    // call the one open window (their own, or someone else's), out of band, exactly like
    // START_NEXT_ROUND. It interacts with the window instead of being cleared by it.
    if (action.type === 'CALL_UNO') {
      if (!Object.hasOwn(privateStates, playerId)) return { ok: false, reason: 'not a player in this match' }
      if (publicState.unoWindow === null) return { ok: false, reason: 'no uno window open' }
      if (action.targetPlayerId !== publicState.unoWindow.playerId) return { ok: false, reason: 'no uno window for that player' }
      // Self-call: the vulnerable player calls their own window — just closes it, no draw.
      if (playerId === publicState.unoWindow.playerId) {
        return { ok: true, publicState: { ...publicState, unoWindow: null }, privateStates }
      }
      // Catch: the window's OWNER (not the caller) draws 2 — same drawFromStock/recycle as
      // draw2/wild4. Then the window closes. The caller never draws; the turn is untouched
      // either way (the target's 1→3 hand is just a draw, it opens no window retroactively).
      const targetId = publicState.unoWindow.playerId
      const draw = drawFromStock(currentStock, publicState.discardPile, 2, rng)
      if (!draw.ok) return blockedRound(publicState, privateStates)
      onStockChange(draw.stock)
      const targetHand = addCards(privateStates[targetId].hand, draw.drawn)
      return {
        ok: true,
        publicState: {
          ...publicState,
          unoWindow: null,
          discardPile: draw.discardPile,
          stockCount: cardCount(draw.stock),
          handCounts: { ...publicState.handCounts, [targetId]: cardCount(targetHand) },
        },
        privateStates: { ...privateStates, [targetId]: { hand: targetHand } },
      }
    }

    if (publicState.stage !== 'play') return { ok: false, reason: 'the round is not in play' }
    if (currentPlayer(publicState.turn) !== playerId) return { ok: false, reason: 'not your turn' }

    // A new current player's first action: any open Uno-call window belongs to the player whose
    // turn just ended, so it dies uncalled here, before this action's own effects apply. Every
    // outcome this validator returns threads this null default through; only the turn-ending
    // branches below override it with a freshly computed window for the acting player.
    const clearedWindow: { playerId: string } | null = null

    const myHand = privateStates[playerId].hand

    if (action.type === 'PLAY_CARD') {
      if (publicState.pendingWild !== null) return { ok: false, reason: 'choose a color first' }
      if (publicState.pendingSevenSwap !== null) return { ok: false, reason: 'choose a swap target first' }
      const card = myHand.cards.find((c) => c.id === action.cardId)
      if (!card) return { ok: false, reason: 'card not in hand' }
      // While a stack is pending, only matching cards are legal
      if (publicState.pendingStack !== null) {
        if (card.kind !== publicState.pendingStack.kind) {
          return { ok: false, reason: 'must stack a matching card or draw the pile' }
        }
      } else {
        // Normal playability check only when no stack is pending
        const top = topCard(publicState.discardPile)!
        if (!isUnoPlayable(card, top, publicState.activeColor)) return { ok: false, reason: 'card is not playable' }
      }

      const { from: newHand, to: newDiscard } = moveCards(myHand, publicState.discardPile, [action.cardId])
      const newPrivateStates = { ...privateStates, [playerId]: { hand: newHand } }
      const lastAction: UnoLastAction = {
        by: playerId,
        kind: 'play',
        card: { color: card.color, kind: card.kind, value: card.value },
        drewCount: 0,
      }
      const publicBase: UnoPublicState = {
        ...publicState,
        discardPile: newDiscard,
        handCounts: { ...publicState.handCounts, [playerId]: cardCount(newHand) },
        lastAction,
        unoWindow: clearedWindow,
      }

      // Going out ends the round immediately — the card's special effect never applies.
      if (cardCount(newHand) === 0) {
        return finishRoundByGoingOut(publicBase, newPrivateStates, playerId)
      }

      switch (card.kind) {
        case 'number': {
          // Check for 7-swap or 0-rotation under sevenZero rule
          if (publicState.houseRules.sevenZero && card.value === 7) {
            return {
              ok: true,
              publicState: {
                ...publicBase,
                activeColor: card.color as UnoColor,
                pendingSevenSwap: { cardId: card.id },
                hasDrawnThisTurn: false,
              },
              privateStates: newPrivateStates,
            }
          }
          if (publicState.houseRules.sevenZero && card.value === 0) {
            // Rotate every seated player's hand one seat in the current direction
            const len = publicState.seatOrder.length
            const allPrivateStates = { ...privateStates, ...newPrivateStates }
            const rotation: Record<string, Zone<UnoCard>> = {}
            for (let i = 0; i < len; i++) {
              const sourceIndex = ((i - publicState.turn.direction) % len + len) % len
              const sourcePlayerId = publicState.seatOrder[sourceIndex]
              const destPlayerId = publicState.seatOrder[i]
              rotation[destPlayerId] = allPrivateStates[sourcePlayerId].hand
            }
            const rotatedPrivateStates: Record<string, UnoPrivateState> = {}
            const rotatedHandCounts: Record<string, number> = {}
            for (const seatedPlayer of publicState.seatOrder) {
              // Update Zone id/ownerId to match the new owner (follow createHand pattern)
              const updatedHand = { ...rotation[seatedPlayer], id: `hand:${seatedPlayer}`, ownerId: seatedPlayer }
              rotatedPrivateStates[seatedPlayer] = { hand: updatedHand }
              rotatedHandCounts[seatedPlayer] = cardCount(updatedHand)
            }
            return {
              ok: true,
              publicState: {
                ...publicBase,
                activeColor: card.color as UnoColor,
                handCounts: rotatedHandCounts,
                hasDrawnThisTurn: false,
                turn: advanceTurn(publicState.turn, 'play'),
                unoWindow: null,
              },
              privateStates: rotatedPrivateStates,
            }
          }
          return {
            ok: true,
            publicState: {
              ...publicBase,
              activeColor: card.color as UnoColor,
              hasDrawnThisTurn: false,
              turn: advanceTurn(publicState.turn, 'play'),
              unoWindow: cardCount(newHand) === 1 ? { playerId } : null,
            },
            privateStates: newPrivateStates,
          }
        }
        case 'skip':
          return {
            ok: true,
            publicState: {
              ...publicBase,
              activeColor: card.color as UnoColor,
              hasDrawnThisTurn: false,
              turn: skipNext(publicState.turn, 'play'),
              unoWindow: cardCount(newHand) === 1 ? { playerId } : null,
            },
            privateStates: newPrivateStates,
          }
        case 'reverse':
          if (publicState.seatOrder.length === 2) {
            // 2 players: reverse acts as a skip (per the design doc).
            return {
              ok: true,
              publicState: {
                ...publicBase,
                activeColor: card.color as UnoColor,
                hasDrawnThisTurn: false,
                turn: skipNext(publicState.turn, 'play'),
                unoWindow: cardCount(newHand) === 1 ? { playerId } : null,
              },
              privateStates: newPrivateStates,
            }
          }
          return {
            ok: true,
            publicState: {
              ...publicBase,
              activeColor: card.color as UnoColor,
              hasDrawnThisTurn: false,
              turn: advanceTurn(reverseDirection(publicState.turn), 'play'),
              unoWindow: cardCount(newHand) === 1 ? { playerId } : null,
            },
            privateStates: newPrivateStates,
          }
        case 'draw2': {
          if (!publicState.houseRules.stackDraw) {
            // Rule OFF: immediate draw-2 for the skipped player, skipNext
            const drawerId = skippedPlayer(publicState.turn)
            const draw = drawFromStock(currentStock, publicBase.discardPile, 2, rng)
            if (!draw.ok) return blockedRound(publicBase, newPrivateStates)
            onStockChange(draw.stock)
            const drawerHand = addCards(privateStates[drawerId].hand, draw.drawn)
            return {
              ok: true,
              publicState: {
                ...publicBase,
                discardPile: draw.discardPile,
                stockCount: cardCount(draw.stock),
                activeColor: card.color as UnoColor,
                hasDrawnThisTurn: false,
                turn: skipNext(publicState.turn, 'play'),
                unoWindow: cardCount(newHand) === 1 ? { playerId } : null,
                handCounts: { ...publicBase.handCounts, [drawerId]: cardCount(drawerHand) },
                lastAction: { ...lastAction, drewCount: 2 },
              },
              privateStates: { ...newPrivateStates, [drawerId]: { hand: drawerHand } },
            }
          }
          // Rule ON: stackDraw logic
          if (publicState.pendingStack !== null) {
            // Continue the stack — card kind match already verified at the top-level gate
            return {
              ok: true,
              publicState: {
                ...publicBase,
                activeColor: card.color as UnoColor,
                hasDrawnThisTurn: false,
                turn: advanceTurn(publicState.turn, 'play'),
                pendingStack: { kind: 'draw2', total: publicState.pendingStack.total + 2 },
                unoWindow: cardCount(newHand) === 1 ? { playerId } : null,
              },
              privateStates: newPrivateStates,
            }
          }
          // Open a new stack
          return {
            ok: true,
            publicState: {
              ...publicBase,
              activeColor: card.color as UnoColor,
              hasDrawnThisTurn: false,
              turn: advanceTurn(publicState.turn, 'play'),
              pendingStack: { kind: 'draw2', total: 2 },
              unoWindow: cardCount(newHand) === 1 ? { playerId } : null,
            },
            privateStates: newPrivateStates,
          }
        }
        case 'wild':
          // Turn does NOT advance yet — the current player must send CHOOSE_COLOR.
          return {
            ok: true,
            publicState: {
              ...publicBase,
              pendingWild: { cardId: card.id, isDraw4: false },
            },
            privateStates: newPrivateStates,
          }
        case 'wild4':
          // Same as wild; the draw-4 + skip happens once the color is chosen (card kind match already verified at the top gate).
          return {
            ok: true,
            publicState: {
              ...publicBase,
              pendingWild: { cardId: card.id, isDraw4: true },
            },
            privateStates: newPrivateStates,
          }
      }
      return { ok: false, reason: 'unknown action' }
    }

    if (action.type === 'CHOOSE_SWAP_TARGET') {
      if (publicState.pendingSevenSwap === null) return { ok: false, reason: 'no 7-swap pending' }
      if (action.targetPlayerId === playerId) return { ok: false, reason: 'cannot swap with yourself' }
      if (!publicState.seatOrder.includes(action.targetPlayerId)) return { ok: false, reason: 'target player not seated' }
      // Swap hands: the acting player receives the target's hand, and vice versa. Zone id/ownerId
      // are restamped to match their new owners (follow createHand pattern: id: `hand:${playerId}`, ownerId: playerId)
      const actingPlayerReceives = { ...privateStates[action.targetPlayerId].hand, id: `hand:${playerId}`, ownerId: playerId }
      const targetReceives = { ...privateStates[playerId].hand, id: `hand:${action.targetPlayerId}`, ownerId: action.targetPlayerId }
      const newPrivateStates = {
        ...privateStates,
        [playerId]: { hand: actingPlayerReceives },
        [action.targetPlayerId]: { hand: targetReceives },
      }
      // Update handCounts
      const newHandCounts = {
        ...publicState.handCounts,
        [playerId]: cardCount(actingPlayerReceives),
        [action.targetPlayerId]: cardCount(targetReceives),
      }
      // Determine Uno-call window priority: check acting player first, then target
      let newUnoWindow: { playerId: string } | null = null
      if (cardCount(actingPlayerReceives) === 1) {
        newUnoWindow = { playerId }
      } else if (cardCount(targetReceives) === 1) {
        newUnoWindow = { playerId: action.targetPlayerId }
      }
      return {
        ok: true,
        publicState: {
          ...publicState,
          handCounts: newHandCounts,
          pendingSevenSwap: null,
          hasDrawnThisTurn: false,
          turn: advanceTurn(publicState.turn, 'play'),
          unoWindow: newUnoWindow,
          lastAction: { ...publicState.lastAction!, swapTargetPlayerId: action.targetPlayerId },
        },
        privateStates: newPrivateStates,
      }
    }

    if (action.type === 'CHOOSE_COLOR') {
      if (publicState.pendingWild === null) return { ok: false, reason: 'no wild card pending' }
      // Runtime enum guard: action.color is compile-time-only typed as UnoColor — a malformed
      // or hostile PeerJS payload can carry any string (or omit the field). Reject before any
      // state mutation so canonical activeColor can never be poisoned with an out-of-domain value.
      if (!isUnoColor(action.color)) return { ok: false, reason: 'not a valid color' }
      if (!publicState.pendingWild.isDraw4) {
        return {
          ok: true,
          publicState: {
            ...publicState,
            activeColor: action.color,
            pendingWild: null,
            hasDrawnThisTurn: false,
            turn: advanceTurn(publicState.turn, 'play'),
            unoWindow: cardCount(myHand) === 1 ? { playerId } : null,
          },
          privateStates,
        }
      }
      // wild4 (isDraw4: true)
      if (!publicState.houseRules.stackDraw) {
        // Rule OFF: immediate draw-4, skipNext
        const drawerId = skippedPlayer(publicState.turn)
        const draw = drawFromStock(currentStock, publicState.discardPile, 4, rng)
        if (!draw.ok) return blockedRound({ ...publicState, pendingWild: null }, privateStates)
        onStockChange(draw.stock)
        const drawerHand = addCards(privateStates[drawerId].hand, draw.drawn)
        return {
          ok: true,
          publicState: {
            ...publicState,
            activeColor: action.color,
            pendingWild: null,
            hasDrawnThisTurn: false,
            turn: skipNext(publicState.turn, 'play'),
            unoWindow: cardCount(myHand) === 1 ? { playerId } : null,
            discardPile: draw.discardPile,
            stockCount: cardCount(draw.stock),
            handCounts: { ...publicState.handCounts, [drawerId]: cardCount(drawerHand) },
            // merge into the existing lastAction from the preceding PLAY_CARD — no second entry
            lastAction: { ...publicState.lastAction!, drewCount: 4 },
          },
          privateStates: { ...privateStates, [drawerId]: { hand: drawerHand } },
        }
      }
      // Rule ON: stackDraw logic
      if (publicState.pendingStack !== null) {
        // Continue the wild4 stack
        return {
          ok: true,
          publicState: {
            ...publicState,
            activeColor: action.color,
            pendingWild: null,
            hasDrawnThisTurn: false,
            turn: advanceTurn(publicState.turn, 'play'),
            pendingStack: { kind: 'wild4', total: publicState.pendingStack.total + 4 },
            unoWindow: cardCount(myHand) === 1 ? { playerId } : null,
          },
          privateStates,
        }
      }
      // Open a new wild4 stack
      return {
        ok: true,
        publicState: {
          ...publicState,
          activeColor: action.color,
          pendingWild: null,
          hasDrawnThisTurn: false,
          turn: advanceTurn(publicState.turn, 'play'),
          pendingStack: { kind: 'wild4', total: 4 },
          unoWindow: cardCount(myHand) === 1 ? { playerId } : null,
        },
        privateStates,
      }
    }

    if (action.type === 'DRAW_CARD') {
      if (publicState.pendingWild !== null) return { ok: false, reason: 'choose a color first' }
      if (publicState.pendingSevenSwap !== null) return { ok: false, reason: 'choose a swap target first' }
      // When a stack is pending, accept DRAW_CARD unconditionally
      if (publicState.pendingStack !== null) {
        const draw = drawFromStock(currentStock, publicState.discardPile, publicState.pendingStack.total, rng)
        if (!draw.ok) return blockedRound({ ...publicState, pendingStack: null }, privateStates)
        onStockChange(draw.stock)
        const newHand = addCards(myHand, draw.drawn)
        return {
          ok: true,
          publicState: {
            ...publicState,
            discardPile: draw.discardPile,
            stockCount: cardCount(draw.stock),
            handCounts: { ...publicState.handCounts, [playerId]: cardCount(newHand) },
            hasDrawnThisTurn: false,
            turn: advanceTurn(publicState.turn, 'play'),
            pendingStack: null,
            lastAction: { by: playerId, kind: 'draw', card: null, drewCount: publicState.pendingStack.total },
            unoWindow: cardCount(newHand) === 1 ? { playerId } : null,
          },
          privateStates: { ...privateStates, [playerId]: { hand: newHand } },
        }
      }
      // Normal draw logic (when no stack is pending)
      if (publicState.hasDrawnThisTurn) return { ok: false, reason: 'you have already drawn this turn' }
      const top = topCard(publicState.discardPile)!
      if (handHasLegalPlay(myHand.cards, top, publicState.activeColor)) {
        return { ok: false, reason: 'you have a legal play' }
      }
      const draw = publicState.houseRules.drawUntilPlayable
        ? drawUntilPlayable(currentStock, publicState.discardPile, publicState.activeColor, rng)
        : drawFromStock(currentStock, publicState.discardPile, 1, rng)
      if (!draw.ok) return blockedRound(publicState, privateStates)
      onStockChange(draw.stock)
      const newHand = addCards(myHand, draw.drawn)
      const drawnCard = draw.drawn[draw.drawn.length - 1]
      const newPublicState: UnoPublicState = {
        ...publicState,
        discardPile: draw.discardPile,
        stockCount: cardCount(draw.stock),
        handCounts: { ...publicState.handCounts, [playerId]: cardCount(newHand) },
        hasDrawnThisTurn: true,
        lastAction: { by: playerId, kind: 'draw', card: null, drewCount: draw.drawn.length },
        unoWindow: clearedWindow,
      }
      const newPrivateStates = { ...privateStates, [playerId]: { hand: newHand } }
      // Playable draw: turn stays with the player (they may PLAY_CARD it or PASS).
      // Unplayable draw: advance immediately — same one-line hasDrawnThisTurn reset every
      // advance/skip branch performs.
      if (isUnoPlayable(drawnCard, topCard(newPublicState.discardPile)!, publicState.activeColor)) {
        return { ok: true, publicState: newPublicState, privateStates: newPrivateStates }
      }
      return {
        ok: true,
        publicState: {
          ...newPublicState,
          hasDrawnThisTurn: false,
          turn: advanceTurn(publicState.turn, 'play'),
          unoWindow: cardCount(newHand) === 1 ? { playerId } : null,
        },
        privateStates: newPrivateStates,
      }
    }

    if (action.type === 'PASS') {
      if (publicState.pendingWild !== null) return { ok: false, reason: 'choose a color first' }
      if (publicState.pendingSevenSwap !== null) return { ok: false, reason: 'choose a swap target first' }
      if (!publicState.hasDrawnThisTurn) return { ok: false, reason: 'draw first' }
      return {
        ok: true,
        publicState: {
          ...publicState,
          turn: advanceTurn(publicState.turn, 'play'),
          hasDrawnThisTurn: false,
          lastAction: { by: playerId, kind: 'pass', card: null, drewCount: 0 },
          unoWindow: cardCount(myHand) === 1 ? { playerId } : null,
        },
        privateStates,
      }
    }

    return { ok: false, reason: 'unknown action' }
  }
}

export function applyUnoAction(
  uno: UnoSession,
  playerId: string,
  action: UnoAction,
): { uno: UnoSession; outcome: ActionOutcome<UnoPublicState, UnoPrivateState> } {
  let candidateStock = uno.stock
  const validate = makeValidator(uno.stock, uno.rng, (s) => { candidateStock = s })
  const { session, outcome } = applyAction(uno.session, playerId, action, validate)
  const stock = outcome.ok ? candidateStock : uno.stock
  return { uno: { session, stock, rng: uno.rng }, outcome }
}

export function runUnoBotTurn(
  uno: UnoSession,
  playerId: string,
  strategy: BotStrategy<UnoPublicState, UnoPrivateState, UnoAction>,
): { uno: UnoSession; outcome: ActionOutcome<UnoPublicState, UnoPrivateState> } {
  let candidateStock = uno.stock
  const validate = makeValidator(uno.stock, uno.rng, (s) => { candidateStock = s })
  const { session, outcome } = runBotTurn(uno.session, playerId, strategy, validate)
  const stock = outcome.ok ? candidateStock : uno.stock
  return { uno: { session, stock, rng: uno.rng }, outcome }
}
