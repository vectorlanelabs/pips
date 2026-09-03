import type { BotStrategy } from '../../engine/bot.ts'
import type { Card } from '../../card-engine/cards.ts'
import type { Phase10PublicState, Phase10PrivateState, Phase10Action } from './state.ts'
import { fullGroupCards } from './state.ts'
import { classifyPhaseHand, validateGroupExtension } from './classify.ts'
import { PHASES, type PhaseRequirement } from './phases.ts'
import { cardPenalty } from './scoring.ts'

function combinations<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  const indices: number[] = []
  function build(start: number): void {
    if (indices.length === size) {
      result.push(indices.map((i) => items[i]))
      return
    }
    const remaining = size - indices.length
    for (let i = start; i <= items.length - remaining; i++) {
      indices.push(i)
      build(i + 1)
      indices.pop()
    }
  }
  build(0)
  return result
}

/**
 * True iff some subset of `cards` of exactly the phase's total card count passes
 * `classifyPhaseHand`. It is NOT required that the subset include every card in
 * `cards` — all size-matching subsets are searched. Hand-relevant sizes are
 * small (max 11 cards, phase totals never exceed 9), so brute force is fine.
 */
export function canCompletePhase(cards: Card[], requirement: PhaseRequirement): boolean {
  const total = requirement.parts.reduce((sum, p) => sum + p.count, 0)
  for (const subset of combinations(cards, total)) {
    if (classifyPhaseHand(subset, requirement).valid) return true
  }
  return false
}

/**
 * Same search as `canCompletePhase` but returns the matching subset's card ids
 * (in any order) instead of a boolean, or null if none exists. Skip-kind cards
 * are excluded from every candidate subset up front — they can never be part of
 * a phase, so searching subsets that include one would only waste time (and
 * could return an illegal selection if classifyPhaseHand's own Skip-rejection
 * ever had a gap).
 */
export function findPhaseSelection(cards: Card[], requirement: PhaseRequirement): string[] | null {
  const nonSkips = cards.filter((c) => c.meta?.kind !== 'skip')
  const total = requirement.parts.reduce((sum, p) => sum + p.count, 0)
  for (const subset of combinations(nonSkips, total)) {
    if (classifyPhaseHand(subset, requirement).valid) {
      return subset.map((c) => c.id)
    }
  }
  return null
}

/**
 * Connectivity score for a number card within a hand — how "useful" the card is
 * for building phases. Higher = keep, lower = discard candidate.
 *
 * Score = count of OTHER number-kind hand cards with the same rank (set
 * potential) + count of OTHER number-kind hand cards of the same suit/color
 * whose numeric rank is within 3 (run/color-group potential). A window of 3 is
 * a reasonable proxy for "close enough to plausibly end up in the same run or
 * color group together" — one generic proximity+rank-match score is the whole
 * heuristic, no per-phase special-casing.
 */
function connectivityScore(card: Card, hand: Card[]): number {
  let score = 0
  for (const other of hand) {
    if (other.id === card.id) continue
    if (other.meta?.kind !== 'number') continue
    if (other.rank === card.rank) {
      score++
    } else if (other.suit === card.suit && Math.abs(Number(other.rank) - Number(card.rank)) <= 3) {
      score++
    }
  }
  return score
}

/**
 * Pick the least-useful card to discard.
 *
 * 1. Tempo play: a Skip goes out first — it costs the
 *    opponent a turn for free, so it is always at least tactically neutral.
 * 2. Otherwise, among the non-wild, non-skip (number) cards, discard the
 *    lowest-connectivity one; ties broken by highest cardPenalty (shed the most
 *    expensive isolated card first).
 * 3. Fallback (no number cards at all, e.g. an all-wild hand): any card.
 */
export function selectDiscard(hand: Card[]): string {
  const skip = hand.find((c) => c.meta?.kind === 'skip')
  if (skip) return skip.id

  const candidates = hand.filter((c) => c.meta?.kind === 'number')
  if (candidates.length > 0) {
    let bestCard = candidates[0]
    let bestScore = connectivityScore(bestCard, hand)
    let bestPenalty = cardPenalty(bestCard)
    for (let i = 1; i < candidates.length; i++) {
      const card = candidates[i]
      const score = connectivityScore(card, hand)
      const penalty = cardPenalty(card)
      if (score < bestScore || (score === bestScore && penalty > bestPenalty)) {
        bestCard = card
        bestScore = score
        bestPenalty = penalty
      }
    }
    return bestCard.id
  }

  return hand[0].id
}

export const phase10BotStrategy: BotStrategy<
  Phase10PublicState,
  Phase10PrivateState,
  Phase10Action
> = (publicState, privateState, playerId) => {
  // Round already over — the only sensible action is to deal the next round.
  // Defensive: a caller that doesn't check roundOver before calling us would
  // otherwise crash on the (possibly empty) hand below.
  if (publicState.roundOver) {
    return { type: 'START_NEXT_ROUND' }
  }

  const phase = publicState.turn.phase
  const hand = privateState.hand.cards

  // ── Draw phase ─────────────────────────────────────────────
  if (phase === 'draw') {
    const pile = publicState.discardPile.cards
    const top = pile.length > 0 ? pile[pile.length - 1] : undefined
    // A Skip can never legally be drawn from the discard pile — never even
    // attempt it. Otherwise, take the top card if it completes the current phase.
    if (pile.length > 0 && top!.meta?.kind !== 'skip') {
      const requirement = PHASES[publicState.phaseIdx[playerId]]
      if (canCompletePhase([...hand, top!], requirement)) {
        return { type: 'DRAW_FROM_DISCARD' }
      }
    }
    // Livelock-prevention fallback: stock empty, exactly ONE non-Skip card on the
    // pile, and it doesn't complete anything — DRAW_FROM_STOCK would be REJECTED
    // in exactly this state (rules.ts only recycles when the pile has >= 2 cards),
    // so take the lone discard card instead; it's always legal. When the pile has
    // 2+ cards, DRAW_FROM_STOCK is itself legal and triggers a recycle-and-draw —
    // prefer it, since always taking the discard top here (the original bug) means
    // two bots can loop forever trading the same card and the pile never recycles.
    if (publicState.stockCount === 0 && pile.length === 1 && top!.meta?.kind !== 'skip') {
      return { type: 'DRAW_FROM_DISCARD' }
    }
    return { type: 'DRAW_FROM_STOCK' }
  }

  // ── Discard phase ──────────────────────────────────────────
  const requirement = PHASES[publicState.phaseIdx[playerId]]

  // Case 3: haven't laid this round — lay the phase if the hand completes it.
  if (!publicState.hasLaidPhase[playerId]) {
    const selection = findPhaseSelection(hand, requirement)
    if (selection) {
      return { type: 'LAY_PHASE', cardIds: selection }
    }
  }

  // Case 4: already laid this round — hit any single hand card (Skip-kind cards
  // excluded, they can never be used in a phase) that legally extends an
  // existing group, own or opponent's. One card per action; runPhase10BotTurn
  // calls us again, so multi-card extensions happen incrementally — first legal
  // one is fine, this is a "one reasonable strategy" bot, not an optimizer.
  if (publicState.hasLaidPhase[playerId]) {
    for (const [targetPlayerId, groups] of Object.entries(publicState.groups)) {
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        const group = groups[groupIndex]
        const currentFull = fullGroupCards(publicState.groups, publicState.hits, targetPlayerId, groupIndex)
        // validateGroupExtension is the SAME predicate the host validator runs —
        // the bot must never judge a hit by anything weaker (it once used the
        // bare isValid* predicates, missed the runOccupiedRange rule, proposed a
        // hit the validator rejected, and froze forever re-proposing it).
        for (const card of hand) {
          if (validateGroupExtension(currentFull, group.type, [card]).ok) {
            return { type: 'HIT', targetPlayerId, groupIndex, cardIds: [card.id] }
          }
        }
      }
    }
  }

  // Case 5: nothing productive found — discard.
  return { type: 'DISCARD_CARD', cardId: selectDiscard(hand) }
}
