import type { BotStrategy } from '../../engine/bot.ts'
import type { Card } from '../../card-engine/cards.ts'
import { evaluateBestHand, evaluateOmahaHand } from './hand-eval.ts'
import type { PokerPublicState, PokerPrivateState, PokerAction } from './state.ts'
import { POKER_BIG_BLIND, isDrawVariant } from './state.ts'

// Rank order low-to-high. hand-eval keeps its rank table private; a small
// local map is fine (the spec allows either).
const RANK_ORDER: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 }

function rankValue(rank: string): number {
  return RANK_ORDER[rank] ?? 0
}

// Street-size cap shared by every raise branch: two+ bots holding raise-worthy
// hands used to re-raise the legal minimum back and forth until everyone was
// all-in (~25 raises, minutes of paced beats). Stateless bots need a
// state-derived throttle, so a strong hand only keeps raising while the street
// bet is below 8 big blinds -- that bounds a street to a few raises while
// still letting strong hands build real pots.
const RAISE_WAR_CAP = POKER_BIG_BLIND * 8

// ---- Deterministic variety ----

// The strategy must stay a pure function of (publicState, privateState,
// playerId): the bot loop re-derives actions from identical state and a replay
// must not diverge. A tiny string hash over hand number, street, and seat
// gives per-spot variety (stab bets, semi-bluffs) that is stable within a spot
// but differs across hands, streets, and seats -- so the table doesn't play
// like one mind with eight stacks.
function varietyRoll(publicState: PokerPublicState, playerId: string, modulus: number): number {
  const s = `${publicState.handNumber}:${publicState.turn.phase}:${playerId}`
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % modulus
}

// A legal BET: integer, at least 1, never more than the stack. `sized` is the
// target (a pot fraction, floored elsewhere); the big blind is the floor so
// bets read as real bets, and the stack is the cap (an under-stack target
// becomes an all-in bet, which the validator accepts).
function sizedBet(sized: number, playerChips: number): PokerAction {
  return { type: 'BET', amount: Math.min(playerChips, Math.max(POKER_BIG_BLIND, sized)) }
}

// ---- Holdem hand reading ----

// Preflop hand strength tiers. Exported for the policy unit tests.
// premium raises, good calls a normal raise, playable limps/calls a min-raise,
// weak only ever pays the bare big blind.
export function getPreflopStrength(holeCards: Card[]): 'premium' | 'good' | 'playable' | 'weak' {
  if (holeCards.length !== 2) return 'weak'
  const [c1, c2] = holeCards
  const v1 = rankValue(c1.rank)
  const v2 = rankValue(c2.rank)
  const hi = Math.max(v1, v2)
  const lo = Math.min(v1, v2)
  const suited = c1.suit === c2.suit
  const pair = v1 === v2

  if (pair && hi >= 10) return 'premium'                    // TT+
  if (hi === 14 && lo >= 12) return 'premium'               // AK, AQ
  if (pair && hi >= 6) return 'good'                        // 66-99
  if (hi === 14 && (lo >= 10 || suited)) return 'good'      // AJ, AT, suited ace
  if (hi === 13 && lo >= 11) return 'good'                  // KQ, KJ
  if (pair) return 'playable'                               // 22-55
  if (lo >= 10) return 'playable'                           // any two ten-or-higher
  if (suited && hi - lo <= 2 && lo >= 5) return 'playable'  // suited connectors/gappers 5+
  if (suited && hi === 13) return 'playable'                // suited king
  return 'weak'
}

// Hand category by direct counting, for card sets the real evaluator refuses
// (evaluateBestHand THROWS on a 2-hole + partial-board input -- the reason the
// old strength read wrapped it in a try/catch and silently called every
// pre-river hand "weak"). Made hands at 5-7 cards are all countable: rank
// multiples, a 5-of-a-suit flush, a 5-consecutive straight (ace both ends).
// Straight flushes collapse into the flush category -- tier-precision above
// "monster" doesn't change any decision. Wild deuces are counted as plain
// deuces here, which understates BOTH the hand and the board-only baseline
// symmetrically; the complete-board paths below use the real wild evaluator.
function partialCategory(cards: Card[]): number {
  const counts: Record<string, number> = {}
  for (const c of cards) counts[c.rank] = (counts[c.rank] ?? 0) + 1
  const multiples = Object.values(counts).filter((n) => n >= 2).sort((a, b) => b - a)
  const suitCounts: Record<string, number> = {}
  for (const c of cards) suitCounts[c.suit] = (suitCounts[c.suit] ?? 0) + 1
  const hasFlush = Object.values(suitCounts).some((n) => n >= 5)
  const values = new Set(cards.map((c) => rankValue(c.rank)))
  if (values.has(14)) values.add(1)
  let hasStraight = false
  for (let v = 1; v <= 10; v++) {
    if ([v, v + 1, v + 2, v + 3, v + 4].every((x) => values.has(x))) {
      hasStraight = true
      break
    }
  }
  if (multiples[0] === 4) return 7
  if (multiples[0] === 3 && multiples.length >= 2) return 6
  if (hasFlush) return 5
  if (hasStraight) return 4
  if (multiples[0] === 3) return 3
  if (multiples.length >= 2) return 2
  if (multiples.length === 1) return 1
  return 0
}

// The full hand's category: real evaluator on a complete board, direct count
// before that.
function handCategory(holeCards: Card[], board: Card[], deucesWild: boolean): number {
  if (board.length === 5) {
    return evaluateBestHand(holeCards, board, deucesWild).category
  }
  return partialCategory([...holeCards, ...board])
}

// What the board makes ALL BY ITSELF -- the baseline a hand must beat before
// its category means anything. The old strength read called any pair "strong",
// which included a pair sitting openly on the board: every bot at a paired
// board thought it had something.
function boardOnlyCategory(board: Card[], deucesWild: boolean): number {
  if (board.length === 5) {
    return evaluateBestHand(board, [], deucesWild).category
  }
  return partialCategory(board)
}

// Four to a flush where at least one card is ours (a 4-flush lying entirely on
// the board is everyone's draw, not a reason to put chips in). Exactly 4: five
// is a made flush and the category read catches it.
function hasFlushDraw(holeCards: Card[], board: Card[]): boolean {
  const suitCounts: Record<string, number> = {}
  for (const c of [...holeCards, ...board]) suitCounts[c.suit] = (suitCounts[c.suit] ?? 0) + 1
  return Object.entries(suitCounts).some(([suit, n]) => n === 4 && holeCards.some((h) => h.suit === suit))
}

// Four consecutive ranks using at least one hole card. Open-ended vs gutshot
// isn't distinguished -- either is worth peeling a small bet with.
function hasStraightDraw(holeCards: Card[], board: Card[]): boolean {
  const values = new Set([...holeCards, ...board].map((c) => rankValue(c.rank)))
  const holeValues = new Set(holeCards.map((c) => rankValue(c.rank)))
  for (let v = 2; v <= 11; v++) {
    const run = [v, v + 1, v + 2, v + 3]
    if (run.every((x) => values.has(x)) && run.some((x) => holeValues.has(x))) return true
  }
  return false
}

export type PostflopTier = 'monster' | 'value' | 'draw' | 'air'

// Postflop tiers, board-discounted: a category only counts when it BEATS what
// the board makes alone. Exported for the policy unit tests.
export function getHoldemPostflopTier(holeCards: Card[], board: Card[], deucesWild = false): PostflopTier {
  if (holeCards.length !== 2 || board.length < 3) return 'air'
  const cat = handCategory(holeCards, board, deucesWild)
  const boardCat = boardOnlyCategory(board, deucesWild)
  if (cat >= 2 && cat > boardCat) return 'monster'
  if (cat >= 1 && cat > boardCat) return 'value'
  if (board.length < 5 && (hasFlushDraw(holeCards, board) || hasStraightDraw(holeCards, board))) return 'draw'
  return 'air'
}

// ---- Shared postflop betting (holdem and omaha) ----

// One action table over the tier: monsters bet half pot and raise, value hands
// bet a third of the pot and call reasonable bets, draws semi-bluff sometimes
// and peel cheap bets, air stabs occasionally and otherwise gives up. Pot-
// proportional sizing and thresholds are what make the bots feel like they're
// playing the pot rather than ticking a fixed toll.
function postflopBettingAction(tier: PostflopTier, publicState: PokerPublicState, playerId: string): PokerAction {
  const playerHand = publicState.hands[playerId]
  const currentBet = publicState.currentBetThisStreet
  const playerChips = publicState.chips[playerId]
  const pot = publicState.pot

  if (currentBet === 0) {
    if (tier === 'monster') return sizedBet(Math.floor(pot / 2), playerChips)
    if (tier === 'value') return sizedBet(Math.floor(pot / 3), playerChips)
    if (tier === 'draw' && varietyRoll(publicState, playerId, 3) === 0) {
      return sizedBet(Math.floor(pot / 3), playerChips)   // semi-bluff
    }
    if (tier === 'air' && varietyRoll(publicState, playerId, 5) === 0) {
      return sizedBet(Math.floor(pot / 3), playerChips)   // stab at an unclaimed pot
    }
    return { type: 'CHECK' }
  }

  const amountToCall = currentBet - playerHand.betThisStreet
  if (amountToCall <= 0) {
    return { type: 'CHECK' }
  }

  if (tier === 'monster') {
    // Raise by the legal minimum when eligible AND affordable, under the
    // street-size cap; else call. The affordability guard (playerChips +
    // betThisStreet > currentBet) stops a short stack from emitting a RAISE
    // whose amount collapses to <= the current bet -- the validator would
    // reject it, and a rejected deterministic action hangs the bot loop
    // forever. When the cap forces the amount below a full increment, the
    // result is exactly an all-in short raise, which the validator allows.
    if (
      publicState.reRaiseEligible[playerId] &&
      playerChips + playerHand.betThisStreet > currentBet &&
      currentBet < RAISE_WAR_CAP
    ) {
      const minIncrement = Math.max(publicState.lastFullRaiseIncrement, POKER_BIG_BLIND)
      const raiseAmount = Math.min(currentBet + minIncrement, playerChips + playerHand.betThisStreet)
      return { type: 'RAISE', amount: raiseAmount }
    }
    return { type: 'CALL' }
  }
  if (tier === 'value') {
    if (amountToCall <= Math.max(POKER_BIG_BLIND * 4, Math.floor(pot / 2))) return { type: 'CALL' }
    return { type: 'FOLD' }
  }
  if (tier === 'draw') {
    if (amountToCall <= Math.max(POKER_BIG_BLIND * 2, Math.floor(pot / 4))) return { type: 'CALL' }
    return { type: 'FOLD' }
  }
  // air: peel only the cheapest bets
  if (amountToCall <= POKER_BIG_BLIND) return { type: 'CALL' }
  return { type: 'FOLD' }
}

// ---- Omaha strategy ----

// Omaha preflop hand strength (4 hole cards). Deterministic categories:
// 'premium' = a pair of Jacks or better, or two distinct pairs; 'good' = any
// pair, at most two suits in the hole, or an Ace and a King; else 'weak'.
// Exported for the policy unit tests, same as drawDiscardAction below.
export function getOmahaPreflopStrength(holeCards: Card[]): 'premium' | 'good' | 'weak' {
  if (holeCards.length !== 4) return 'weak'

  const rankCounts: Record<string, number> = {}
  const suits = new Set<string>()
  for (const c of holeCards) {
    rankCounts[c.rank] = (rankCounts[c.rank] ?? 0) + 1
    suits.add(c.suit)
  }
  const pairRanks = Object.entries(rankCounts)
    .filter(([, count]) => count >= 2)
    .map(([rank]) => rank)

  // Premium: a pair of Jacks or better, or two distinct pairs.
  const hasPremiumPair = pairRanks.some((rank) => rank === 'J' || rank === 'Q' || rank === 'K' || rank === 'A')
  if (hasPremiumPair || pairRanks.length >= 2) return 'premium'

  // Good: any pair, at most two suits, or an Ace and a King.
  const hasAK = holeCards.some((c) => c.rank === 'A') && holeCards.some((c) => c.rank === 'K')
  if (pairRanks.length > 0 || suits.size <= 2 || hasAK) return 'good'

  return 'weak'
}

// Omaha postflop tiers. A complete board is judged by evaluateOmahaHand
// (exactly two hole + exactly three board cards) against the board-only
// baseline, same as holdem. A 3-4 card board has no evaluator, so made hands
// are read directly from Omaha-legal rank matches: a hole pair matching a
// board rank is a set (monster), two hole cards matching two different board
// ranks is two pair (monster), one match or a hole pair is a pair (value) --
// the old read had NO made-hand detection on partial boards at all, so a bot
// that flopped a set called nothing and folded to any bet. The draw signal is
// the Omaha-legal flush draw: a same-suit PAIR of hole cards (the
// exactly-two-hole rule means a lone suited hole card is not a draw) with 2+
// board cards of that suit. Exported for the policy unit tests.
export function getOmahaPostflopTier(holeCards: Card[], board: Card[], deucesWild = false): PostflopTier {
  if (holeCards.length !== 4 || board.length < 3) return 'air'

  if (board.length === 5) {
    const cat = evaluateOmahaHand(holeCards, board, deucesWild).category
    const boardCat = boardOnlyCategory(board, deucesWild)
    if (cat >= 2 && cat > boardCat) return 'monster'
    if (cat >= 1 && cat > boardCat) return 'value'
    return 'air'
  }

  const boardRanks = new Set(board.map((c) => c.rank))
  const holeRankCounts: Record<string, number> = {}
  for (const c of holeCards) holeRankCounts[c.rank] = (holeRankCounts[c.rank] ?? 0) + 1
  const holePairRanks = Object.entries(holeRankCounts).filter(([, n]) => n >= 2).map(([rank]) => rank)

  if (holePairRanks.some((rank) => boardRanks.has(rank))) return 'monster'   // set
  const matchedRanks = new Set(holeCards.map((c) => c.rank).filter((rank) => boardRanks.has(rank)))
  if (matchedRanks.size >= 2) return 'monster'                               // two pair
  if (matchedRanks.size === 1 || holePairRanks.length > 0) return 'value'    // a pair of our own

  const boardSuits: Record<string, number> = {}
  for (const c of board) boardSuits[c.suit] = (boardSuits[c.suit] ?? 0) + 1
  const holeSuits: Record<string, number> = {}
  for (const c of holeCards) holeSuits[c.suit] = (holeSuits[c.suit] ?? 0) + 1
  for (const [suit, count] of Object.entries(holeSuits)) {
    if (count >= 2 && (boardSuits[suit] ?? 0) >= 2) return 'draw'
  }
  return 'air'
}

// Kept for compatibility with existing policy tests: the coarse
// strong/medium/weak read over a complete board or the Omaha-legal flush draw.
export function getOmahaPostflopStrength(holeCards: Card[], boardCards: Card[], deucesWild = false): 'strong' | 'medium' | 'weak' {
  if (boardCards.length === 5) {
    const hand = evaluateOmahaHand(holeCards, boardCards, deucesWild)
    return hand.category >= 1 ? 'strong' : 'weak'
  }

  if (boardCards.length === 3 || boardCards.length === 4) {
    const boardSuits: Record<string, number> = {}
    for (const c of boardCards) boardSuits[c.suit] = (boardSuits[c.suit] ?? 0) + 1

    const holeSuits: Record<string, number> = {}
    for (const c of holeCards) holeSuits[c.suit] = (holeSuits[c.suit] ?? 0) + 1

    for (const [suit, count] of Object.entries(holeSuits)) {
      if (count >= 2 && (boardSuits[suit] ?? 0) >= 2) {
        return 'medium'
      }
    }
    return 'weak'
  }

  return 'weak'
}

// ---- Draw variant strategy ----

// The cards NOT in keepIds, lowest rank first, at most 3.
function discardLowestFirst(hand: Card[], keepIds: Set<string>): string[] {
  return hand
    .filter((c) => !keepIds.has(c.id))
    .sort((a, b) => rankValue(a.rank) - rankValue(b.rank))
    .slice(0, 3)
    .map((c) => c.id)
}

// Deterministic discard policy for the draw round (five-draw and seven-draw).
// Exported so the policy unit tests can construct hands directly.
// With deucesWild, deuces are wild cards: they are never discarded, every
// piece of keep-logic (pair/flush/straight detection) runs over the non-deuce
// cards only, and the stand-pat check evaluates the full hand with the wild
// flag so wild-made straights and better stand pat.
export function drawDiscardAction(hand: Card[], deucesWild = false): PokerAction {
  // The discard pool: the whole hand normally; with wilds on, deuces are
  // always worth keeping and never enter the pool (the fallback below also
  // never exceeds the non-deuce count, since the pool holds only naturals).
  const keepCandidates = deucesWild ? hand.filter((c) => c.rank !== '2') : hand

  // Straight or better: stand pat. With wilds this uses the wild evaluator,
  // so e.g. four to a flush plus a deuce is a made flush and stands pat.
  if (evaluateBestHand(hand, [], deucesWild).category >= 4) {
    return { type: 'DRAW', discardIds: [] }
  }

  // Any rank appearing 2+ times (pair, two pair, trips, full house, quads):
  // keep every such card, discard the rest -- lowest ranks first, at most 3.
  const rankCounts: Record<string, number> = {}
  for (const c of keepCandidates) {
    rankCounts[c.rank] = (rankCounts[c.rank] ?? 0) + 1
  }
  const pairedRanks = new Set(
    Object.entries(rankCounts)
      .filter(([, count]) => count >= 2)
      .map(([rank]) => rank),
  )
  if (pairedRanks.size > 0) {
    const keepIds = new Set(keepCandidates.filter((c) => pairedRanks.has(c.rank)).map((c) => c.id))
    return { type: 'DRAW', discardIds: discardLowestFirst(keepCandidates, keepIds) }
  }

  // 4+ cards of one suit: keep the 4 highest of that suit.
  const bySuit: Record<string, Card[]> = {}
  for (const c of keepCandidates) {
    if (!bySuit[c.suit]) bySuit[c.suit] = []
    bySuit[c.suit].push(c)
  }
  const flushSuitCards = Object.values(bySuit).find((cards) => cards.length >= 4)
  if (flushSuitCards) {
    const keepIds = new Set(
      [...flushSuitCards]
        .sort((a, b) => rankValue(b.rank) - rankValue(a.rank))
        .slice(0, 4)
        .map((c) => c.id),
    )
    return { type: 'DRAW', discardIds: discardLowestFirst(keepCandidates, keepIds) }
  }

  // 4 cards forming a run of consecutive ranks (ace high only: A is 14, so the
  // numeric check below never matches a wheel A-2-3-4). The highest run wins.
  const values = new Set(keepCandidates.map((c) => rankValue(c.rank)))
  for (let v = 11; v >= 2; v--) {
    if (values.has(v) && values.has(v + 1) && values.has(v + 2) && values.has(v + 3)) {
      const runValues = new Set([v, v + 1, v + 2, v + 3])
      const keepIds = new Set(keepCandidates.filter((c) => runValues.has(rankValue(c.rank))).map((c) => c.id))
      return { type: 'DRAW', discardIds: discardLowestFirst(keepCandidates, keepIds) }
    }
  }

  // High-card hand: discard the 3 lowest-ranked cards (never a deuce when
  // wilds are on -- the pool above excludes them).
  return { type: 'DRAW', discardIds: discardLowestFirst(keepCandidates, new Set()) }
}

// Draw-variant betting for firstBet and secondBet (identical logic in both).
function drawBettingAction(publicState: PokerPublicState, privateState: PokerPrivateState, playerId: string): PokerAction {
  const playerHand = publicState.hands[playerId]
  const currentBet = publicState.currentBetThisStreet
  const playerBetThisStreet = playerHand.betThisStreet
  const playerChips = publicState.chips[playerId]

  const cat = evaluateBestHand(privateState.hand, [], publicState.houseRules.deucesWild).category

  // Unopened street (secondBet opens at 0; firstBet always faces the big blind).
  if (currentBet === 0) {
    if (cat >= 3) {
      return { type: 'BET', amount: Math.min(POKER_BIG_BLIND * 2, playerChips) }
    }
    if (cat === 2) {
      return { type: 'BET', amount: Math.min(POKER_BIG_BLIND, playerChips) }
    }
    // Occasional stab with nothing -- draw hands are fully hidden, so a bare
    // bet is credible and keeps the bots from playing pure showdown poker.
    if (varietyRoll(publicState, playerId, 4) === 0) {
      return { type: 'BET', amount: Math.min(POKER_BIG_BLIND, playerChips) }
    }
    return { type: 'CHECK' }
  }

  const amountToCall = currentBet - playerBetThisStreet
  if (amountToCall <= 0) {
    return { type: 'CHECK' }
  }

  // Trips or better: raise by the legal minimum when allowed AND affordable,
  // else call. The affordability guard stops a short stack from emitting a
  // RAISE the validator would reject (raiseToAmount must exceed the current
  // bet); a rejected deterministic action would hang the bot loop forever --
  // same rationale as the guards in postflopBettingAction. RAISE_WAR_CAP
  // bounds min-raise wars between strong stateless bots.
  if (cat >= 3) {
    if (
      publicState.reRaiseEligible[playerId] &&
      playerChips + playerBetThisStreet > currentBet &&
      publicState.currentBetThisStreet < RAISE_WAR_CAP
    ) {
      const minIncrement = Math.max(publicState.lastFullRaiseIncrement, POKER_BIG_BLIND)
      const raiseAmount = Math.min(currentBet + minIncrement, playerChips + playerBetThisStreet)
      return { type: 'RAISE', amount: raiseAmount }
    }
    return { type: 'CALL' }
  }

  if (cat === 2) {
    return { type: 'CALL' }
  }

  if (cat === 1) {
    if (amountToCall <= POKER_BIG_BLIND * 2) {
      return { type: 'CALL' }
    }
    return { type: 'FOLD' }
  }

  // High card: only call the big-blind option.
  if (amountToCall <= POKER_BIG_BLIND && currentBet <= POKER_BIG_BLIND) {
    return { type: 'CALL' }
  }
  return { type: 'FOLD' }
}

export const pokerBotStrategy: BotStrategy<PokerPublicState, PokerPrivateState, PokerAction> = (publicState, privateState, playerId) => {
  const playerHand = publicState.hands[playerId]
  const holeCards = privateState.hand
  const currentStreet = publicState.turn.phase
  const currentBet = publicState.currentBetThisStreet
  const playerBetThisStreet = playerHand.betThisStreet
  const playerChips = publicState.chips[playerId]

  // Draw variants branch FIRST. The draw round is a DRAW action -- never CHECK
  // here: a rejected action would hang the deterministic bot loop forever (same
  // rationale as the reRaiseEligible comment below). firstBet/secondBet use
  // draw-variant betting over the whole private hand. Draw hands never fall
  // through to the holdem logic (whose holeCards.length !== 2 guard would
  // otherwise return CHECK for every 5/7-card hand). The isDrawVariant gate --
  // not a '!== holdem' check -- keeps the second board variant (omaha) out of
  // this branch: omaha's 4-card hands must never reach drawDiscardAction or
  // drawBettingAction, both of which evaluate the whole private hand.
  if (isDrawVariant(publicState.variant)) {
    if (publicState.turn.phase === 'draw') {
      return drawDiscardAction(holeCards, publicState.houseRules.deucesWild)
    }
    if (publicState.turn.phase === 'firstBet' || publicState.turn.phase === 'secondBet') {
      return drawBettingAction(publicState, privateState, playerId)
    }
  }

  // Omaha branch BEFORE the holdem branches: 4 hole cards plus the
  // exactly-two-hole/exactly-three-board rule mean the holdem strategy (which
  // assumes 2 hole cards and evaluates over all 7 cards) must never see an
  // Omaha hand. Preflop strength is deterministic from the four hole cards;
  // postflop uses the Omaha tier read and the shared postflop action table.
  if (publicState.variant === 'omaha') {
    if (currentStreet === 'preflop') {
      const strength = getOmahaPreflopStrength(holeCards)

      if (currentBet === 0) {
        if (strength === 'premium') {
          return { type: 'BET', amount: Math.min(POKER_BIG_BLIND * 3, playerChips) }
        }
        if (strength === 'good') {
          return { type: 'BET', amount: Math.min(POKER_BIG_BLIND * 2, playerChips) }
        }
        return { type: 'CHECK' }
      }

      const amountToCall = currentBet - playerBetThisStreet
      if (amountToCall <= 0) {
        return { type: 'CHECK' }
      }

      if (
        strength === 'premium' &&
        publicState.reRaiseEligible[playerId] &&
        playerChips + playerBetThisStreet > currentBet &&
        currentBet < RAISE_WAR_CAP
      ) {
        // Raise by at least the legal minimum increment (not a flat BB -- a
        // prior raise may have set a larger lastFullRaiseIncrement, and
        // raising by less than that would be rejected by the validator).
        // Only attempted when reRaiseEligible: a bot that already acted since
        // the last full raise (only a short all-in has happened since) is not
        // allowed to re-raise -- the validator would reject it every time,
        // and since this strategy is deterministic, a caller that blindly
        // retries a rejected action would retry the identical rejected
        // action forever, permanently hanging the bot's turn. The
        // playerChips + playerBetThisStreet > currentBet affordability guard
        // stops a short stack from emitting a RAISE whose amount collapses to
        // <= the current bet -- the validator would reject it too.
        const minIncrement = Math.max(publicState.lastFullRaiseIncrement, POKER_BIG_BLIND)
        const raiseAmount = Math.min(currentBet + minIncrement, playerChips + playerBetThisStreet)
        return { type: 'RAISE', amount: raiseAmount }
      }
      if (strength === 'premium') {
        return { type: 'CALL' }
      }
      if (strength === 'good') {
        if (amountToCall <= POKER_BIG_BLIND * 5) return { type: 'CALL' }
        return { type: 'FOLD' }
      }
      if (amountToCall <= POKER_BIG_BLIND && currentBet <= POKER_BIG_BLIND) {
        return { type: 'CALL' }
      }
      return { type: 'FOLD' }
    }

    if (currentStreet === 'flop' || currentStreet === 'turn' || currentStreet === 'river') {
      const tier = getOmahaPostflopTier(holeCards, publicState.board, publicState.houseRules.deucesWild)
      return postflopBettingAction(tier, publicState, playerId)
    }

    return { type: 'CHECK' }
  }

  if (holeCards.length !== 2) {
    return { type: 'CHECK' }
  }

  // Preflop strategy
  if (currentStreet === 'preflop') {
    const strength = getPreflopStrength(holeCards)

    if (currentBet === 0) {
      // Unopened preflop street (only ante games -- blinds games always open
      // at the big blind): open bigger with better hands.
      if (strength === 'premium') {
        return { type: 'BET', amount: Math.min(POKER_BIG_BLIND * 3, playerChips) }
      }
      if (strength === 'good') {
        return { type: 'BET', amount: Math.min(POKER_BIG_BLIND * 2, playerChips) }
      }
      return { type: 'CHECK' }
    }

    const amountToCall = currentBet - playerBetThisStreet
    if (amountToCall <= 0) {
      return { type: 'CHECK' }
    }

    if (
      strength === 'premium' &&
      publicState.reRaiseEligible[playerId] &&
      playerChips + playerBetThisStreet > currentBet &&
      currentBet < RAISE_WAR_CAP
    ) {
      // Same raise legality guards as the omaha branch above (eligibility,
      // affordability, street cap) -- see that comment for the full rationale.
      const minIncrement = Math.max(publicState.lastFullRaiseIncrement, POKER_BIG_BLIND)
      const raiseAmount = Math.min(currentBet + minIncrement, playerChips + playerBetThisStreet)
      return { type: 'RAISE', amount: raiseAmount }
    }
    if (strength === 'premium') {
      return { type: 'CALL' }
    }
    if (strength === 'good') {
      if (amountToCall <= POKER_BIG_BLIND * 5) return { type: 'CALL' }
      return { type: 'FOLD' }
    }
    if (strength === 'playable') {
      if (amountToCall <= POKER_BIG_BLIND * 2) return { type: 'CALL' }
      return { type: 'FOLD' }
    }
    // Weak: only ever pay the bare big blind.
    if (amountToCall <= POKER_BIG_BLIND && currentBet <= POKER_BIG_BLIND) {
      return { type: 'CALL' }
    }
    return { type: 'FOLD' }
  }

  // Postflop strategy (flop, turn, river)
  if (currentStreet === 'flop' || currentStreet === 'turn' || currentStreet === 'river') {
    const tier = getHoldemPostflopTier(holeCards, publicState.board, publicState.houseRules.deucesWild)
    return postflopBettingAction(tier, publicState, playerId)
  }

  return { type: 'CHECK' }
}
