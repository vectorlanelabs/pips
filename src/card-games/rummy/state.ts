import type { Card } from '../../card-engine/cards.ts'
import type { Zone } from '../../card-engine/zones.ts'
import type { TurnState } from '../../engine/turn-engine.ts'
import type { HostSession } from '../../engine/sync.ts'
import { createStandardDeck, shuffleDeck, dealCards } from '../../card-engine/deck.ts'
import { createRng } from '../../engine/rng.ts'
import { createHand, createDiscardPile, createPublicZone, addCards, cardCount } from '../../card-engine/zones.ts'
import { createTurnState } from '../../engine/turn-engine.ts'
import { createHostSession } from '../../engine/sync.ts'

export type RummyPhase = 'draw' | 'discard'

// A card (or cards) laid off from a player's hand onto an existing meld — theirs or the
// opponent's. Laid-off cards stay attributed to whoever played them (they render on the
// LAYER's own side, not inside the target meld's cluster) but still count toward that meld's
// validity and completeness. Chains indefinitely: each new lay-off targets the same original
// (targetPlayerId, targetMeldIndex) and is checked against the FULL accumulated group so far
// (see fullMeldCards) — e.g. opponent lays 5-6-7, I lay off a 4, opponent lays off a 3 against
// my 4, and so on, with no limit.
export interface RummyLayoff {
  id: string
  playerId: string          // who played these cards — whose side they render on, who scores them
  targetPlayerId: string    // whose original meld (melds[targetPlayerId]) this extends
  targetMeldIndex: number   // index into melds[targetPlayerId]
  cards: Card[]
}

export interface RummyPublicState {
  turn: TurnState<RummyPhase>
  seatOrder: string[]                      // fixed player order for the whole match, never reordered
  discardPile: Zone
  stockCount: number
  melds: Record<string, Zone[]>          // playerId -> the meld zones THEY originally laid down this round.
                                            // Never mutated by a lay-off — see `layoffs` for those.
  layoffs: RummyLayoff[]
  obligatedCardId: string | null          // if set, the current acting player must use this card id in a
                                            // meld action (LAY_DOWN_MELD or LAY_OFF) before they may
                                            // DISCARD_CARD this turn
  scores: Record<string, number>          // match score per player, accumulates across rounds
  target: number                           // match target score
  roundNumber: number
  roundOver: boolean
  roundWinnerId: string | null             // player who went out this round, or null if the round ended blocked
  matchWinnerId: string | null
  handCounts: Record<string, number>      // number of cards in each player's hand — let clients show
                                            // opponent hand size without leaking card identity
  cardBack: string                         // host-chosen card-back design id (see components/cardBacks.ts);
                                            // cosmetic only, but every seat must render the same back
}

export interface RummyPrivateState {
  hand: Zone
}

export type RummyAction =
  | { type: 'DRAW_FROM_STOCK' }
  | { type: 'DRAW_FROM_DISCARD'; index: number }   // index into discardPile.cards (0 = bottom/oldest); taking
                                                      // index i takes cards[i..last] (i.e. that card and everything
                                                      // above/newer than it, matching Zone's documented convention
                                                      // that the last array index is the "top")
  | { type: 'LAY_DOWN_MELD'; cardIds: string[] }
  | { type: 'LAY_OFF'; targetPlayerId: string; meldIndex: number; cardIds: string[] }
                                                      // add card(s) from hand onto an existing meld — yours or
                                                      // the opponent's — identified by (targetPlayerId, index
                                                      // into publicState.melds[targetPlayerId]). Requires having
                                                      // already laid down at least one meld of your own this round.
  | { type: 'DISCARD_CARD'; cardId: string }
  | { type: 'START_NEXT_ROUND' }

// The current full set of cards in a meld group — its original zone plus every lay-off (by
// either player) that has targeted it since. This is what a NEW lay-off's validity is checked
// against, and what scoring uses for correct Ace-value context (ace-high run vs ace-low vs a
// set of aces) — never just the original zone's cards once anything's been laid off onto it.
export function fullMeldCards(
  melds: Record<string, Zone[]>,
  layoffs: RummyLayoff[],
  targetPlayerId: string,
  meldIndex: number,
): Card[] {
  const base = melds[targetPlayerId]?.[meldIndex]?.cards ?? []
  const extensions = layoffs
    .filter((l) => l.targetPlayerId === targetPlayerId && l.targetMeldIndex === meldIndex)
    .flatMap((l) => l.cards)
  return [...base, ...extensions]
}

export interface RummySession {
  session: HostSession<RummyPublicState, RummyPrivateState>
  stock: Zone       // host-only, never part of HostSession — see the prior milestone's docs/card-engine.md
                      // for why (a zone that must be visible to nobody has no slot in the generic model)
  rng: () => number  // host-only, the SAME stateful generator used for the initial shuffle and every later
                       // stock-recycle shuffle and round redeal — one seed drives the whole match
}

export const RUMMY_MIN_SEATS = 2
export const RUMMY_MAX_SEATS = 4   // hard ceiling for a single 52-card deck at a 10-card hand: 5 players
                                     // would deal 5×10+1=51 cards and leave a degenerate 1-card stock; 4 leaves 11

const TARGET_SCORE = 500

// Shared deal logic used both for the very first round and every subsequent round (via START_NEXT_ROUND).
// Deals 10 cards to each player in `playerIds` order, then 1 to the discard pile, remainder to stock —
// the same loop shape as Uno's dealUnoRound.
function dealRound(
  playerIds: string[],
  rng: () => number,
): { hands: Record<string, Zone>; stock: Zone; discardPile: Zone } {
  const deck = createStandardDeck()
  const shuffled = shuffleDeck(deck, rng)
  let remaining = shuffled
  const hands: Record<string, Zone> = {}
  for (const playerId of playerIds) {
    const { dealt, remaining: rest } = dealCards(remaining, 10)
    hands[playerId] = addCards(createHand(playerId), dealt)
    remaining = rest
  }
  const { dealt: discardStart, remaining: stockCards } = dealCards(remaining, 1)
  const stock = addCards(createPublicZone('stock', 'private'), stockCards)
  const discardPile = addCards(createDiscardPile(), discardStart)
  return { hands, stock, discardPile }
}

export function createRummyGame(playerIds: string[], seed: number, cardBack = 'pips_default'): RummySession {
  const rng = createRng(seed)
  const { hands, stock, discardPile } = dealRound(playerIds, rng)
  const turn = createTurnState<RummyPhase>(playerIds, 'draw')

  const melds: Record<string, Zone[]> = {}
  const scores: Record<string, number> = {}
  const handCounts: Record<string, number> = {}
  const privateStates: Record<string, RummyPrivateState> = {}
  for (const playerId of playerIds) {
    melds[playerId] = []
    scores[playerId] = 0
    handCounts[playerId] = cardCount(hands[playerId])
    privateStates[playerId] = { hand: hands[playerId] }
  }

  const publicState: RummyPublicState = {
    turn,
    seatOrder: playerIds,
    discardPile,
    stockCount: cardCount(stock),
    melds,
    layoffs: [],
    obligatedCardId: null,
    scores,
    target: TARGET_SCORE,
    roundNumber: 1,
    roundOver: false,
    roundWinnerId: null,
    matchWinnerId: null,
    handCounts,
    cardBack,
  }

  return { session: createHostSession(publicState, privateStates), stock, rng }
}

// Exported so rules.ts's START_NEXT_ROUND handler can reuse the exact same deal logic.
export { dealRound }
