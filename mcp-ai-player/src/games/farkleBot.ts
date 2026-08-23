import type { BotDifficulty } from '../../../src/types.js'

// Standalone copy of the host's Farkle scoring + bot decision logic
// (src/games/farkle.ts), reimplemented here rather than imported: this package
// publishes standalone via npx, so it can't reach back into ../../src at
// runtime. Keep these in sync with the host's farkle.ts if its rules change.

function countByFace(vals: number[]): Record<number, number> {
  const counts: Record<number, number> = {}
  for (const v of vals) counts[v] = (counts[v] || 0) + 1
  return counts
}

/** Score a fully-selected set of dice. `valid` is false if any die in the selection doesn't score. */
export function scoreSelection(vals: number[]): { valid: boolean; score: number } {
  if (vals.length === 0) return { valid: false, score: 0 }
  if (vals.length === 6) {
    const sorted = [...vals].sort((a, b) => a - b)
    if (sorted.join(',') === '1,2,3,4,5,6') return { valid: true, score: 1500 }
    const counts = countByFace(vals)
    const groups = Object.values(counts)
    if (groups.length === 3 && groups.every((c) => c === 2)) return { valid: true, score: 1500 }
  }
  const counts = countByFace(vals)
  let score = 0
  let valid = true
  for (const [faceStr, count] of Object.entries(counts)) {
    const face = Number(faceStr)
    if (count >= 3) {
      const base = face === 1 ? 1000 : face * 100
      score += base * Math.pow(2, count - 3)
    } else if (face === 1) {
      score += count * 100
    } else if (face === 5) {
      score += count * 50
    } else {
      valid = false
    }
  }
  return { valid, score }
}

export function hasAnyScore(vals: number[]): boolean {
  if (vals.length === 0) return false
  const { score } = bestSubset(vals)
  return score > 0
}

/** Highest-scoring valid subset of a roll. Ties broken toward fewer dice. */
export function bestSubset(vals: number[]): { indices: number[]; score: number } {
  const n = vals.length
  let best: { indices: number[]; score: number } = { indices: [], score: 0 }
  for (let mask = 1; mask < 1 << n; mask++) {
    const indices: number[] = []
    for (let i = 0; i < n; i++) if (mask & (1 << i)) indices.push(i)
    const { valid, score } = scoreSelection(indices.map((i) => vals[i]))
    if (!valid) continue
    if (score > best.score || (score === best.score && indices.length < best.indices.length)) {
      best = { indices, score }
    }
  }
  return best
}

export interface FarkleBotMove {
  keepIndices: number[]
  bank: boolean
}

// Bank once total/diceLeft clears any one of these bars. Easy stops pushing
// early and leaves points on the table; hard pushes its luck much further
// before playing it safe. Mirrors the host's BANK_BARS.
const BANK_BARS: Record<BotDifficulty, Array<{ total: number; maxDiceLeft: number }>> = {
  easy: [
    { total: 150, maxDiceLeft: 6 },
    { total: 300, maxDiceLeft: 3 },
  ],
  medium: [
    { total: 250, maxDiceLeft: 1 },
    { total: 350, maxDiceLeft: 2 },
    { total: 550, maxDiceLeft: 6 },
  ],
  hard: [
    { total: 200, maxDiceLeft: 1 },
    { total: 350, maxDiceLeft: 2 },
    { total: 500, maxDiceLeft: 3 },
    { total: 800, maxDiceLeft: 6 },
  ],
}

/** Decide what to keep from the current roll, and whether to bank afterward. */
export function decideFarkleBot(
  rollVals: number[],
  turnScoreSoFar: number,
  seatBanked: number,
  openingScore: number,
  winningScore: number,
  difficulty: BotDifficulty = 'medium',
): FarkleBotMove {
  const { indices, score } = bestSubset(rollVals)
  const total = turnScoreSoFar + score
  const diceLeft = rollVals.length - indices.length
  const canBank = seatBanked > 0 ? total > 0 : total >= openingScore
  let bank = false
  if (canBank) {
    if (seatBanked + total >= winningScore) bank = true
    else if (BANK_BARS[difficulty].some((bar) => total >= bar.total && diceLeft <= bar.maxDiceLeft)) bank = true
  }
  return { keepIndices: indices, bank }
}
