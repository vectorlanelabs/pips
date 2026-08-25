import type { Card } from '../../card-engine/cards.ts'
import type { Zone } from '../../card-engine/zones.ts'
import type { TurnState } from '../../engine/turn-engine.ts'
import type { HostSession } from '../../engine/sync.ts'
import { shuffleDeck, dealCards } from '../../card-engine/deck.ts'
import { createPhase10Deck } from './deck.ts'
import { createRng } from '../../engine/rng.ts'
import { createHand, createDiscardPile, createPublicZone, addCards, cardCount } from '../../card-engine/zones.ts'
import { createTurnState } from '../../engine/turn-engine.ts'
import { createHostSession } from '../../engine/sync.ts'

export type Phase10TurnPhase = 'draw' | 'discard'

export interface Phase10Group {
  type: import('./classify.ts').GroupType
  zone: Zone   // the cards THIS player originally laid for this group
  phaseNumber: number   // 1-based — the phase this group was laid FOR, fixed at lay time
}

// A card (or cards) hit onto an existing group — theirs or the opponent's. Hit cards stay
// attributed to whoever played them (they render on the HITTER's own side, not inside the
// target group's cluster) but still count toward that group's validity. Chains indefinitely:
// each new hit targets the same original (targetPlayerId, targetGroupIndex) and is checked
// against the FULL accumulated group so far (see fullGroupCards).
export interface Phase10Hit {
  id: string
  playerId: string          // who played these cards (hit them onto the group)
  targetPlayerId: string    // whose group (own or opponent's) this extends
  targetGroupIndex: number  // index into groups[targetPlayerId]
  cards: Card[]
}

export interface Phase10PublicState {
  turn: TurnState<Phase10TurnPhase>
  seatOrder: string[]                      // fixed player order for the whole match, never reordered
  discardPile: Zone
  stockCount: number
  groups: Record<string, Phase10Group[]>   // playerId -> groups THEY laid this round
  hits: Phase10Hit[]
  hasLaidPhase: Record<string, boolean>    // this round only, reset each round
  phaseIdx: Record<string, number>         // 0-based (0 = Phase 1 .. 9 = Phase 10). PERSISTS
                                             // across rounds — never reset by START_NEXT_ROUND.
  scores: Record<string, number>           // match score, accumulates across rounds. LOWER IS
                                             // BETTER — the opposite convention from Rummy's
                                             // state.ts. There is NO target score to cross;
                                             // winning is entirely about completing Phase 10,
                                             // scores only break ties.
  roundNumber: number
  roundOver: boolean
  roundWinnerId: string | null   // who went out, or null if the round was blocked (no draw possible)
  matchWinnerId: string | null
  handCounts: Record<string, number>      // number of cards in each player's hand — let clients show
                                            // opponent hand size without leaking card identity
  cardBack: string                       // host-chosen card-back design id (see components/cardBacks.ts);
                                          // cosmetic only, but every seat must render the same back.
}

export interface Phase10PrivateState {
  hand: Zone
}

export type Phase10Action =
  | { type: 'DRAW_FROM_STOCK' }
  | { type: 'DRAW_FROM_DISCARD' }   // top card only, no index — real rule difference from Rummy
  | { type: 'LAY_PHASE'; cardIds: string[] }
  | { type: 'HIT'; targetPlayerId: string; groupIndex: number; cardIds: string[] }
  | { type: 'DISCARD_CARD'; cardId: string }
  | { type: 'START_NEXT_ROUND' }

// The current full set of cards in a group — its original zone plus every hit (by either
// player) that has targeted it since. This is what a NEW hit's validity is checked against —
// never just the original zone's cards once anything's been hit onto it.
export function fullGroupCards(
  groups: Record<string, Phase10Group[]>,
  hits: Phase10Hit[],
  targetPlayerId: string,
  groupIndex: number,
): Card[] {
  const base = groups[targetPlayerId]?.[groupIndex]?.zone.cards ?? []
  const extensions = hits
    .filter((h) => h.targetPlayerId === targetPlayerId && h.targetGroupIndex === groupIndex)
    .flatMap((h) => h.cards)
  return [...base, ...extensions]
}

export interface Phase10Session {
  session: HostSession<Phase10PublicState, Phase10PrivateState>
  stock: Zone       // host-only, never part of HostSession — see the prior milestone's docs/card-engine.md
                      // for why (a zone that must be visible to nobody has no slot in the generic model)
  rng: () => number  // host-only, the SAME stateful generator used for the initial shuffle and every later
                       // stock-recycle shuffle and round redeal — one seed drives the whole match
}

export const PHASE10_MIN_SEATS = 2
export const PHASE10_MAX_SEATS = 6   // 108-card deck at a 10-card hand: 6 players deal 6×10+1=61 cards and
                                       // still leave 47 in stock — comfortable; matches real Phase 10's own
                                       // official 6-player cap, both lines of reasoning agree

// Cards dealt to each seated player at the start of every round. Exported so the host's deal-intro
// pacing (App.tsx) can compute the total number of card flights (seatOrder.length * PHASE10_HAND_SIZE)
// without duplicating this number.
export const PHASE10_HAND_SIZE = 10

// Shared deal logic used both for the very first round and every subsequent round (via START_NEXT_ROUND).
export function dealRound(
  playerIds: string[],
  rng: () => number,
): { hands: Record<string, Zone>; stock: Zone; discardPile: Zone } {
  const deck = createPhase10Deck()
  const shuffled = shuffleDeck(deck, rng)
  let remaining = shuffled
  const hands: Record<string, Zone> = {}
  for (const playerId of playerIds) {
    const { dealt, remaining: rest } = dealCards(remaining, PHASE10_HAND_SIZE)
    hands[playerId] = addCards(createHand(playerId), dealt)
    remaining = rest
  }
  const { dealt: discardStart, remaining: stockCards } = dealCards(remaining, 1)
  const stock = addCards(createPublicZone('stock', 'private'), stockCards)
  const discardPile = addCards(createDiscardPile(), discardStart)
  return { hands, stock, discardPile }
}

export function createPhase10Game(playerIds: string[], seed: number, cardBack = 'pips_default'): Phase10Session {
  const rng = createRng(seed)
  const { hands, stock, discardPile } = dealRound(playerIds, rng)
  const turn = createTurnState<Phase10TurnPhase>(playerIds, 'draw')

  const groups: Record<string, Phase10Group[]> = {}
  const hasLaidPhase: Record<string, boolean> = {}
  const phaseIdx: Record<string, number> = {}
  const scores: Record<string, number> = {}
  const handCounts: Record<string, number> = {}
  const privateStates: Record<string, Phase10PrivateState> = {}
  for (const playerId of playerIds) {
    groups[playerId] = []
    hasLaidPhase[playerId] = false
    phaseIdx[playerId] = 0
    scores[playerId] = 0
    handCounts[playerId] = cardCount(hands[playerId])
    privateStates[playerId] = { hand: hands[playerId] }
  }

  const publicState: Phase10PublicState = {
    turn,
    seatOrder: playerIds,
    discardPile,
    stockCount: cardCount(stock),
    groups,
    hits: [],
    hasLaidPhase,
    phaseIdx,
    scores,
    roundNumber: 1,
    roundOver: false,
    roundWinnerId: null,
    matchWinnerId: null,
    handCounts,
    cardBack,
  }

  return { session: createHostSession(publicState, privateStates), stock, rng }
}
