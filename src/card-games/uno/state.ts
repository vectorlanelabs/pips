import type { HostSession } from '../../engine/sync.ts'
import { createHostSession } from '../../engine/sync.ts'
import type { TurnState } from '../../engine/turn-engine.ts'
import { createTurnState } from '../../engine/turn-engine.ts'
import { createRng } from '../../engine/rng.ts'
import type { Zone } from '../../card-engine/zones.ts'
import { addCards, cardCount, createDiscardPile, createHand, createPublicZone } from '../../card-engine/zones.ts'
import { dealCards, shuffleDeck } from '../../card-engine/deck.ts'
import { createUnoDeck, type UnoCard, type UnoCardKind, type UnoColor } from './deck.ts'

export type UnoStage = 'play' | 'roundOver' | 'over'

export interface UnoLastAction {
  by: string
  kind: 'play' | 'draw' | 'pass'
  card: { color: UnoColor | 'wild'; kind: UnoCardKind; value: number | null } | null  // set for 'play' only
  drewCount: number   // for 'draw': how many were drawn (1 normally, N under the drawUntilPlayable house rule). Nonzero here also on a 'play' of draw2/draw4/wild4-that-drew, recording how many the NEXT player drew (0 if none) — lets the UI say "Riley drew 2"
  swapTargetPlayerId?: string   // set for 'play' of a 7 under sevenZero, records who was swapped with
}

export interface UnoRoundResult {
  outPlayerId: string
  pointsAdded: Record<string, number>   // what THIS round added to scores, keyed by playerId, out-player's own entry is 0
}

export interface UnoPublicState {
  stage: UnoStage
  // Only meaningful in stage 'play' — a round-ending action (going out, or
  // the blocked-round fallback) leaves these at their pre-transition
  // values rather than resetting them; nothing reads them outside 'play',
  // and START_NEXT_ROUND rebuilds turn fresh and resets hasDrawnThisTurn.
  turn: TurnState<'play'>
  seatOrder: string[]                    // N players, fixed for the whole match
  round: number                          // 0-based
  activeColor: UnoColor                  // color new plays are matched against (independent of the top card's own color once a wild is in play)
  discardPile: Zone<UnoCard>             // top = last played; visible to everyone
  stockCount: number
  handCounts: Record<string, number>
  hasDrawnThisTurn: boolean              // reset false whenever the turn advances to a new player
  pendingWild: { cardId: string; isDraw4: boolean } | null
  pendingStack: { kind: 'draw2' | 'wild4'; total: number } | null   // while stackDraw house rule is active and a draw card has been played but not yet drawn
  pendingSevenSwap: { cardId: string } | null   // set when a 7 is played under sevenZero, cleared once the swap target is chosen
  unoWindow: { playerId: string } | null   // at most one ever active — opens when a turn-ending action leaves the acting player at exactly 1 card, destroyed by a call or by the next player's first action
  scores: Record<string, number>         // running total, HIGHER is better, first to UNO_TARGET wins
  roundResult: UnoRoundResult | null
  matchWinnerId: string | null
  lastAction: UnoLastAction | null
  houseRules: Record<UnoHouseRuleKey, boolean>   // per-match settings, chosen at game creation; carried through START_NEXT_ROUND unchanged
  cardBack: string                       // host-chosen card-back design id (see components/cardBacks.ts);
                                          // cosmetic only, but every seat must render the same back.
}

export interface UnoPrivateState {
  hand: Zone<UnoCard>
}

export type UnoAction =
  | { type: 'PLAY_CARD'; cardId: string }
  | { type: 'CHOOSE_COLOR'; color: UnoColor }
  | { type: 'CHOOSE_SWAP_TARGET'; targetPlayerId: string }
  | { type: 'DRAW_CARD' }
  | { type: 'PASS' }
  | { type: 'CALL_UNO'; targetPlayerId: string }
  | { type: 'START_NEXT_ROUND' }

const UNO_ACTION_TYPES = new Set<UnoAction['type']>([
  'PLAY_CARD', 'CHOOSE_COLOR', 'CHOOSE_SWAP_TARGET', 'DRAW_CARD', 'PASS', 'CALL_UNO', 'START_NEXT_ROUND',
])

// Runtime guard for the PeerJS host boundary: a guest action arrives over the wire as `unknown`
// (the TypeScript UnoAction union is compile-time only, not a network validator), so the host
// must confirm it's actually a plain object with a recognized `type` string before dispatching it
// into applyUnoAction — never trust the network cast. Mirrors Rummy's isRummyAction.
export function isUnoAction(value: unknown): value is UnoAction {
  if (typeof value !== 'object' || value === null) return false
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' && UNO_ACTION_TYPES.has(type as UnoAction['type'])
}

const UNO_COLORS: UnoColor[] = ['red', 'yellow', 'green', 'blue']

// Runtime enum guard for CHOOSE_COLOR's `color` field — the TypeScript UnoColor union doesn't
// exist at runtime, so a malformed/hostile guest can send any string here (or omit the field
// entirely). Used at the rules.ts validator boundary, before `activeColor` is ever assigned,
// so an out-of-domain value is rejected rather than poisoning canonical state.
export function isUnoColor(value: unknown): value is UnoColor {
  return typeof value === 'string' && (UNO_COLORS as string[]).includes(value)
}

export interface UnoSession {
  session: HostSession<UnoPublicState, UnoPrivateState>
  stock: Zone<UnoCard>       // host-only, mirrors Rummy's stock wrapper — never part of HostSession
  rng: () => number
}

export const UNO_MIN_SEATS = 2
export const UNO_MAX_SEATS = 6
export const UNO_HAND_SIZE = 7
export const UNO_TARGET = 500

export type UnoHouseRuleKey = 'drawUntilPlayable' | 'stackDraw' | 'sevenZero'

export interface UnoHouseRuleDef {
  key: UnoHouseRuleKey
  label: string
  description: string
  default: boolean
}

// Config-driven house rules, chosen at match creation. A later screens spec maps over this
// array to render toggles — the rules themselves live in rules.ts keyed off these keys.
export const UNO_HOUSE_RULE_DEFS: UnoHouseRuleDef[] = [
  {
    key: 'drawUntilPlayable',
    label: 'Draw until you can play',
    description: 'Keep drawing from the stock until you draw a card you can play, instead of drawing just one and passing if it isn’t playable.',
    default: false,
  },
  {
    key: 'stackDraw',
    label: 'Stack draw cards',
    description: "Play a Draw Two on a Draw Two (or a Wild Draw Four on a Wild Draw Four) to pass the penalty along instead of drawing. It keeps growing until someone can’t or won’t continue it.",
    default: false,
  },
  {
    key: 'sevenZero',
    label: '7-0 rule',
    description: 'Play a 7 to swap hands with one opponent of your choice. Play a 0 and everyone passes their hand to the next player around the table.',
    default: false,
  },
]

// Builds the stored houseRules record from UNO_HOUSE_RULE_DEFS defaults, overlaying whatever
// the caller passed. Every defined key always has a real boolean value.
export function resolveHouseRules(overrides?: Partial<Record<UnoHouseRuleKey, boolean>>): Record<UnoHouseRuleKey, boolean> {
  const resolved = {} as Record<UnoHouseRuleKey, boolean>
  for (const def of UNO_HOUSE_RULE_DEFS) {
    resolved[def.key] = overrides?.[def.key] ?? def.default
  }
  return resolved
}

export function unoCardPoints(card: UnoCard): number {
  if (card.kind === 'number') return card.value!
  if (card.kind === 'wild' || card.kind === 'wild4') return 50
  return 20
}

export function isUnoPlayable(card: UnoCard, topCard: UnoCard, activeColor: UnoColor): boolean {
  if (card.kind === 'wild' || card.kind === 'wild4') return true
  if (card.color === activeColor) return true
  if (card.kind === 'number' && topCard.kind === 'number' && card.value === topCard.value) return true
  if (card.kind !== 'number' && card.kind === topCard.kind) return true
  return false
}

export function handHasLegalPlay(hand: UnoCard[], topCard: UnoCard, activeColor: UnoColor): boolean {
  return hand.some((card) => isUnoPlayable(card, topCard, activeColor))
}

// Flips the discard-pile starter off the dealt remainder: whenever the flipped card is not a
// plain number, the whole remaining pool is reshuffled and the flip retried, so the discard
// pile always starts on a number card (no "what does a starting action card do" ambiguity).
export function flipStarter(
  remaining: UnoCard[],
  rng: () => number,
): { starter: UnoCard; stock: UnoCard[] } {
  let pool = remaining
  for (;;) {
    const top = pool[pool.length - 1]
    const rest = pool.slice(0, -1)
    if (top.kind === 'number') return { starter: top, stock: rest }
    pool = shuffleDeck([...rest, top], rng)
  }
}

export interface UnoDeal {
  hands: Record<string, Zone<UnoCard>>
  stock: Zone<UnoCard>
  discardPile: Zone<UnoCard>
  activeColor: UnoColor
}

// Shared deal logic for the first round and every START_NEXT_ROUND: shuffle a fresh 108-card
// deck, deal UNO_HAND_SIZE to each seat in order, then flip a number starter for the discard
// pile (see flipStarter); the rest of the shuffled remainder is the host-side stock.
export function dealUnoRound(seatOrder: string[], rng: () => number): UnoDeal {
  const shuffled = shuffleDeck(createUnoDeck(), rng)
  let remaining = shuffled
  const hands: Record<string, Zone<UnoCard>> = {}
  for (const playerId of seatOrder) {
    const { dealt, remaining: rest } = dealCards(remaining, UNO_HAND_SIZE)
    hands[playerId] = addCards(createHand<UnoCard>(playerId), dealt)
    remaining = rest
  }
  const { starter, stock: stockCards } = flipStarter(remaining, rng)
  const discardPile = addCards(createDiscardPile<UnoCard>(), [starter])
  const stock = addCards(createPublicZone<UnoCard>('stock', 'private'), stockCards)
  return { hands, stock, discardPile, activeColor: starter.color as UnoColor }
}

export function createUnoGame(
  seatOrder: string[],
  seed: number,
  houseRules?: Partial<Record<UnoHouseRuleKey, boolean>>,
  cardBack = 'pips_default',
): UnoSession {
  const rng = createRng(seed)
  const { hands, stock, discardPile, activeColor } = dealUnoRound(seatOrder, rng)
  const turn = createTurnState<'play'>(seatOrder, 'play')
  const handCounts: Record<string, number> = {}
  const scores: Record<string, number> = {}
  const privateStates: Record<string, UnoPrivateState> = {}
  for (const playerId of seatOrder) {
    handCounts[playerId] = cardCount(hands[playerId])
    scores[playerId] = 0
    privateStates[playerId] = { hand: hands[playerId] }
  }
  const publicState: UnoPublicState = {
    stage: 'play',
    turn,
    seatOrder,
    round: 0,
    activeColor,
    discardPile,
    stockCount: cardCount(stock),
    handCounts,
    hasDrawnThisTurn: false,
    pendingWild: null,
    pendingStack: null,
    pendingSevenSwap: null,
    unoWindow: null,
    scores,
    roundResult: null,
    matchWinnerId: null,
    lastAction: null,
    houseRules: resolveHouseRules(houseRules),
    cardBack,
  }
  return { session: createHostSession(publicState, privateStates), stock, rng }
}
