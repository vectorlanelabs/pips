import type { BotDifficulty, Die, YCategory } from '../types'
import { rollDie } from './farkle'

export const Y_CATEGORIES: YCategory[] = [
  'ones', 'twos', 'threes', 'fours', 'fives', 'sixes',
  'threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance',
]

export const Y_LABEL: Record<YCategory, string> = {
  ones: 'Ones', twos: 'Twos', threes: 'Threes', fours: 'Fours', fives: 'Fives', sixes: 'Sixes',
  threeKind: 'Three of a kind', fourKind: 'Four of a kind', fullHouse: 'Full house',
  smallStraight: 'Small straight', largeStraight: 'Large straight', yahtzee: 'Yahtzee', chance: 'Chance',
}

export const Y_SUBLABEL: Record<YCategory, string> = {
  ones: 'Sum of 1s', twos: 'Sum of 2s', threes: 'Sum of 3s', fours: 'Sum of 4s', fives: 'Sum of 5s', sixes: 'Sum of 6s',
  threeKind: 'Sum of all five', fourKind: 'Sum of all five', fullHouse: 'Flat 25',
  smallStraight: 'Flat 30', largeStraight: 'Flat 40', yahtzee: 'Flat 50', chance: 'Sum of all five',
}

function countByFace(vals: number[]): Record<number, number> {
  const counts: Record<number, number> = {}
  for (const v of vals) counts[v] = (counts[v] || 0) + 1
  return counts
}

const UPPER_FACE: Partial<Record<YCategory, number>> = { ones: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 }
const UPPER_CAT_FOR_FACE: Record<number, YCategory> = { 1: 'ones', 2: 'twos', 3: 'threes', 4: 'fours', 5: 'fives', 6: 'sixes' }

export function isFiveKind(vals: number[]): boolean {
  return vals.length === 5 && vals.every((v) => v === vals[0])
}

export function scoreCategory(vals: number[], cat: YCategory, card: Partial<Record<YCategory, number>> = {}): number {
  const joker = isFiveKind(vals) && card.yahtzee === 50 && card[UPPER_CAT_FOR_FACE[vals[0]]] !== undefined
  const sum = vals.reduce((a, b) => a + b, 0)
  const counts = countByFace(vals)
  const groups = Object.values(counts)
  if (cat in UPPER_FACE) {
    const face = UPPER_FACE[cat]!
    return (counts[face] || 0) * face
  }
  switch (cat) {
    case 'threeKind':
      return groups.some((c) => c >= 3) ? sum : 0
    case 'fourKind':
      return groups.some((c) => c >= 4) ? sum : 0
    case 'fullHouse':
      if (joker) return 25
      return groups.length === 2 && groups.includes(3) && groups.includes(2) ? 25 : 0
    case 'smallStraight': {
      if (joker) return 30
      const set = new Set(vals)
      const runs = [[1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]]
      return runs.some((run) => run.every((n) => set.has(n))) ? 30 : 0
    }
    case 'largeStraight': {
      if (joker) return 40
      const set = new Set(vals)
      const runs = [[1, 2, 3, 4, 5], [2, 3, 4, 5, 6]]
      return runs.some((run) => run.every((n) => set.has(n))) ? 40 : 0
    }
    case 'yahtzee':
      return groups.some((c) => c === 5) ? 50 : 0
    case 'chance':
      return sum
    default:
      return 0
  }
}

export function upperTotal(card: Partial<Record<YCategory, number>>): number {
  return (['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'] as YCategory[])
    .reduce((sum, c) => sum + (card[c] ?? 0), 0)
}

export function grandTotal(card: Partial<Record<YCategory, number>>): number {
  const base = Y_CATEGORIES.reduce((sum, c) => sum + (card[c] ?? 0), 0)
  return base + (upperTotal(card) >= 63 ? 35 : 0)
}

export function rollDice(count: number, startId = 0) {
  return Array.from({ length: count }, (_, i) => rollDie(startId + i))
}

/** Display order for the dice row: held dice first (original relative order), then unheld. */
export function partitionDiceOrder(dice: Die[]): { ids: number[]; heldCount: number } {
  const held = dice.filter((d) => d.sel).map((d) => d.id)
  const unheld = dice.filter((d) => !d.sel).map((d) => d.id)
  return { ids: [...held, ...unheld], heldCount: held.length }
}

const BURN_ORDER: YCategory[] = [
  'ones', 'yahtzee', 'largeStraight', 'smallStraight', 'fullHouse', 'fourKind',
  'twos', 'threes', 'fours', 'fives', 'sixes', 'threeKind', 'chance',
]

/** Easy-mode hold: pattern-matches on the current dice only, no lookahead — kept beatable on purpose. */
function decideYahtzeeHoldHeuristic(dice: Die[], card: Partial<Record<YCategory, number>>, difficulty: BotDifficulty): Set<number> {
  const vals = dice.map((d) => d.val)
  const counts = countByFace(vals)
  const entries = Object.entries(counts).map(([face, count]) => ({ face: Number(face), count }))
  const distinct = entries.length

  // Four distinct faces on five dice: one reroll away from a straight.
  if (distinct === 4) {
    const bothStraightsFilled = card.smallStraight !== undefined && card.largeStraight !== undefined
    if (difficulty !== 'hard' || !bothStraightsFilled) {
      const hold = new Set<number>()
      const seen = new Set<number>()
      dice.forEach((d) => {
        if (!seen.has(d.val)) {
          hold.add(d.id)
          seen.add(d.val)
        }
      })
      return hold
    }
  }

  // Two pairs (or a pair + triple) on the board: hold both, chase the full house.
  if (difficulty !== 'easy') {
    const pairGroups = entries.filter((e) => e.count >= 2).sort((a, b) => b.count - a.count || b.face - a.face)
    if (pairGroups.length >= 2) {
      const facesToHold = new Set(pairGroups.slice(0, 2).map((g) => g.face))
      const hold = new Set<number>()
      dice.forEach((d) => {
        if (facesToHold.has(d.val)) hold.add(d.id)
      })
      return hold
    }
  }

  // Otherwise hold whichever face shows up most (ties favor the higher face) — chases
  // three/four/five-of-a-kind naturally.
  let modeFace = vals[0]
  let modeCount = 0
  for (const e of entries) {
    if (e.count > modeCount || (e.count === modeCount && e.face > modeFace)) {
      modeFace = e.face
      modeCount = e.count
    }
  }
  const hold = new Set<number>()
  dice.forEach((d) => {
    if (d.val === modeFace) hold.add(d.id)
  })
  return hold
}

// ---- Exact expected-value dice search (medium & hard) ----
//
// Rather than pattern-matching the current dice, medium/hard evaluate every possible hold —
// which dice to keep vs. reroll — by computing the EXACT expected value of the best open
// category, playing optimally through every reroll still to come (not just the next one), and
// taking the argmax. "Exact" because we enumerate every distinct reroll outcome (weighted by how
// many raw dice sequences produce it) instead of simulating.
//
// This needs real lookahead, not just "what's my best score after one more roll": on the very
// first hold decision there are TWO rerolls left, and a hold that looks mediocre one roll ahead
// (e.g. going for a straight) can be the right call once you account for the second reroll it'll
// still get. The state space is small enough (252 distinct 5-die outcomes x 2 possible
// rolls-remaining, for a FIXED set of open categories) that a memoized recursion covers full
// depth live, in well under the time a human bot-turn pause already budgets.

type WeightedMultiset = { vals: number[]; weight: number }
const multisetCache = new Map<number, WeightedMultiset[]>()

function factorial(n: number): number {
  let f = 1
  for (let i = 2; i <= n; i++) f *= i
  return f
}

/** Every sorted face-combination of length n, weighted by how many raw dice rolls produce it. */
function weightedMultisets(n: number): WeightedMultiset[] {
  const cached = multisetCache.get(n)
  if (cached) return cached
  const results: WeightedMultiset[] = []
  const build = (start: number, vals: number[]) => {
    if (vals.length === n) {
      const counts = countByFace(vals)
      let denom = 1
      for (const c of Object.values(counts)) denom *= factorial(c)
      results.push({ vals: [...vals], weight: factorial(n) / denom })
      return
    }
    for (let face = start; face <= 6; face++) {
      vals.push(face)
      build(face, vals)
      vals.pop()
    }
  }
  build(1, [])
  multisetCache.set(n, results)
  return results
}

// Upper section needs 63 total (roughly 3-of-each) for a 35-point bonus — worth almost as much
// as a second Yahtzee, but the plain EV search below has no way to see it: it only ever compares
// raw category scores, so it's blind to whether THIS upper score keeps the bonus alive or lets it
// slip away. hard-only: every upper-section point is worth its face value PLUS a pro-rated share
// of the 35-point bonus (35/63 per point) for as long as the bonus is still realistically live —
// "realistically" meaning even 3-of-each in every other still-open upper box could still reach 63.
// Once the bonus is already locked in (>=63) or already out of reach even at that pace, pressure
// drops to zero — there's nothing left to protect either way.
const UPPER_BONUS_PER_POINT = 35 / 63

function upperBonusPressure(cat: YCategory, rawScore: number, card: Partial<Record<YCategory, number>>): number {
  const face = UPPER_FACE[cat]
  if (face === undefined) return 0
  const current = upperTotal(card)
  if (current >= 63) return 0
  const otherOpenUpper = (Object.keys(UPPER_FACE) as YCategory[]).filter((c) => c !== cat && !(c in card))
  const paceIfOthersHitThree = current + rawScore
    + otherOpenUpper.reduce((sum, c) => sum + 3 * UPPER_FACE[c]!, 0)
  if (paceIfOthersHitThree < 63) return 0
  return rawScore * UPPER_BONUS_PER_POINT
}

/** Best achievable score across `open` for a settled hand — the terminal value with no rolls left. */
function bestScore(
  vals: number[], open: YCategory[], card: Partial<Record<YCategory, number>>, bonusAware: boolean,
): number {
  let best = 0
  for (const c of open) {
    const s = scoreCategory(vals, c, card)
    const weighted = bonusAware ? s + upperBonusPressure(c, s, card) : s
    if (weighted > best) best = weighted
  }
  return best
}

/** Exact expected value of playing a specific hold optimally through the rerolls still to come. */
function holdOptionValue(
  vals: number[], mask: number, rollsLeft: number, open: YCategory[],
  card: Partial<Record<YCategory, number>>, bonusAware: boolean, memo: Map<number, number>,
): number {
  const held: number[] = []
  for (let i = 0; i < vals.length; i++) if (mask & (1 << i)) held.push(vals[i])
  const rerollCount = vals.length - held.length
  if (rerollCount === 0) return turnValue(held, rollsLeft - 1, open, card, bonusAware, memo)
  let total = 0
  let weightSum = 0
  for (const { vals: reroll, weight } of weightedMultisets(rerollCount)) {
    total += turnValue([...held, ...reroll], rollsLeft - 1, open, card, bonusAware, memo) * weight
    weightSum += weight
  }
  return total / weightSum
}

/** Compact integer key for a dice multiset — counts per face (0-5 each) packed base-6, no sort/join. */
function multisetKey(vals: number[]): number {
  let c1 = 0, c2 = 0, c3 = 0, c4 = 0, c5 = 0, c6 = 0
  for (const v of vals) {
    if (v === 1) c1++
    else if (v === 2) c2++
    else if (v === 3) c3++
    else if (v === 4) c4++
    else if (v === 5) c5++
    else c6++
  }
  return (((((c1 * 6 + c2) * 6 + c3) * 6 + c4) * 6 + c5) * 6 + c6)
}

/**
 * Exact expected value of the best open category, playing optimally (best hold at every step)
 * through `rollsLeft` more mandatory rerolls from `vals`. Memoized by dice-multiset + rollsLeft —
 * `open`/`card` are fixed for the lifetime of one `memo`, so this never needs them in the key.
 * Memoizing rollsLeft=0 too matters: without it, every leaf bestScore call (there are hundreds of
 * thousands of them across a full 2-reroll search) recomputes from scratch instead of hitting the
 * ~252-entry cache, which is most of where the search's time actually goes.
 */
function turnValue(
  vals: number[], rollsLeft: number, open: YCategory[],
  card: Partial<Record<YCategory, number>>, bonusAware: boolean, memo: Map<number, number>,
): number {
  const key = multisetKey(vals) * 3 + rollsLeft
  const cached = memo.get(key)
  if (cached !== undefined) return cached
  let value: number
  if (rollsLeft === 0) {
    value = bestScore(vals, open, card, bonusAware)
  } else {
    let best = -1
    for (let mask = 0; mask < 1 << vals.length; mask++) {
      const v = holdOptionValue(vals, mask, rollsLeft, open, card, bonusAware, memo)
      if (v > best) best = v
    }
    value = best
  }
  memo.set(key, value)
  return value
}

/** Best hold (bitmask over dice positions) for the current decision point. */
function bestHoldMask(
  vals: number[], rollsLeft: number, open: YCategory[],
  card: Partial<Record<YCategory, number>>, bonusAware: boolean, memo: Map<number, number>,
): { mask: number; value: number } {
  let bestMask = 0
  let bestValue = -1
  for (let mask = 0; mask < 1 << vals.length; mask++) {
    const value = holdOptionValue(vals, mask, rollsLeft, open, card, bonusAware, memo)
    if (value > bestValue) {
      bestValue = value
      bestMask = mask
    }
  }
  return { mask: bestMask, value: bestValue }
}

export function decideYahtzeeHold(
  dice: Die[],
  card: Partial<Record<YCategory, number>> = {},
  difficulty: BotDifficulty = 'medium',
  rollsLeft: number = 1,
): Set<number> {
  if (difficulty === 'easy') return decideYahtzeeHoldHeuristic(dice, card, difficulty)

  const open = Y_CATEGORIES.filter((c) => !(c in card))
  const vals = dice.map((d) => d.val)
  const { mask } = bestHoldMask(vals, rollsLeft, open, card, difficulty === 'hard', new Map())
  const hold = new Set<number>()
  dice.forEach((d, i) => {
    if (mask & (1 << i)) hold.add(d.id)
  })
  return hold
}

// threeKind/fourKind/chance all score "sum of all five dice", so a roll that satisfies more than
// one of them ties on raw score at easy/no-adjustment. Not needed once opportunityCost is in
// play (medium & hard) since that compares continuous EV, not raw ties — kept only as a fallback.
const TIE_BREAK_PRIORITY: YCategory[] = [
  'yahtzee', 'largeStraight', 'smallStraight', 'fullHouse', 'fourKind', 'threeKind',
  'sixes', 'fives', 'fours', 'threes', 'twos', 'ones', 'chance',
]

// Expected value of a category from a fresh roll (both rerolls still to come) with ONLY that
// category open — i.e. what it's really worth if left for a future turn instead of taken now.
// Reuses the same exact-expectation search as decideYahtzeeHold (card={} — Joker off, a
// standalone-category simplification), and is cached forever per category since it never depends
// on live game state.
const opportunityCostTable = new Map<YCategory, number>()

function opportunityCost(cat: YCategory): number {
  const cached = opportunityCostTable.get(cat)
  if (cached !== undefined) return cached
  const memo = new Map<number, number>()
  let total = 0
  let weightSum = 0
  for (const { vals, weight } of weightedMultisets(5)) {
    total += turnValue(vals, 2, [cat], {}, false, memo) * weight
    weightSum += weight
  }
  const value = total / weightSum
  opportunityCostTable.set(cat, value)
  return value
}

export function decideYahtzeeCategory(
  vals: number[],
  card: Partial<Record<YCategory, number>>,
  difficulty: BotDifficulty = 'medium',
): YCategory {
  const open = Y_CATEGORIES.filter((c) => !(c in card))
  let best: YCategory | null = null
  let bestWeight = -Infinity
  let anyPositive = false
  for (const c of open) {
    const s = scoreCategory(vals, c, card)
    if (s > 0) anyPositive = true
    // Medium & hard: prefer the category where taking it now beats what it's typically worth if
    // saved — a principled version of "lock in the rare box," not just an arbitrary bonus.
    // Hard only, on top of that: weigh in the 63-point upper bonus, which the opportunity-cost
    // table alone can't see (see upperBonusPressure).
    const weight = difficulty === 'easy' ? s
      : difficulty === 'hard' ? s - opportunityCost(c) + upperBonusPressure(c, s, card)
      : s - opportunityCost(c)
    const tieWins = weight === bestWeight && best !== null
      && TIE_BREAK_PRIORITY.indexOf(c) < TIE_BREAK_PRIORITY.indexOf(best)
    if (weight > bestWeight || tieWins) {
      bestWeight = weight
      best = c
    }
  }
  if (best && anyPositive) return best
  for (const c of BURN_ORDER) {
    if (open.includes(c)) return c
  }
  return open[0]
}
