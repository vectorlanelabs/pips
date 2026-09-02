import type { BotStrategy } from '../../engine/bot.ts'
import { LANE_START } from './board.ts'
import {
  bumpVictim,
  legalMoves,
  moveBumps,
  type WahooAction,
  type WahooMove,
  type WahooPrivateState,
  type WahooPublicState,
} from './state.ts'

// Stateless, deterministic picker: roll whenever awaiting a roll, otherwise
// choose among the legal moves by priority — win now, bump an opponent, enter
// the lane, shortcut, exit, bring a marble out, then the advance whose marble
// is closest to home (ties by lower marbleIdx, then lower setId). Under
// twoColors the full union is partitioned first: moves that would bump the
// bot's own other color are only chosen when no other move exists.
export const wahooBotStrategy: BotStrategy<WahooPublicState, WahooPrivateState, WahooAction> = (
  publicState,
  _privateState,
  playerId,
) => {
  if (publicState.turn.phase === 'roll') return { type: 'ROLL' }
  const die = publicState.die!
  const allPositions = publicState.positions
  const mySetIds = Object.keys(publicState.setOwners).filter((s) => publicState.setOwners[s] === playerId)
  const moves = legalMoves(publicState, playerId, die)

  // A move wins now iff it is an advance that brings the last non-lane marble
  // into the lane — this must match rules.ts's actual win check exactly
  // (every set the player owns has all four marbles >= LANE_START), not an
  // approximation, or the bot can misprioritize a move it wrongly believes
  // ends the game.
  const winsNow = (m: WahooMove): boolean => {
    if (m.kind !== 'advance') return false
    const to = allPositions[m.setId][m.marbleIdx] + die
    return (
      to >= LANE_START &&
      mySetIds.every((s) => allPositions[s].every((q, i) => (s === m.setId && i === m.marbleIdx) || q >= LANE_START))
    )
  }

  // A move is a self-bump iff it sends home a marble of a set the bot itself
  // owns (its other color under twoColors). The bot never chooses one while
  // any alternative exists.
  const isSelfBump = (m: WahooMove): boolean => {
    const victim = bumpVictim(publicState, m.setId, die, m)
    return victim !== null && publicState.setOwners[victim] === playerId
  }
  const nonSelfBumps = moves.filter((m) => !isSelfBump(m))
  const selfBumps = moves.filter((m) => isSelfBump(m))

  // Fallback among non-lane-entry advances: closest to home, then lower index
  // (across sets: lower setId first, then marbleIdx).
  // NOTE: the ">= 52" cutoff below (and in the priority branch further down)
  // is a deliberate "near home" strategy threshold, distinct from winsNow's
  // correctness requirement above — it decides when a track marble stops
  // competing in the closest-to-home tie-break and instead gets priority as
  // an advance-toward-lane move. Whether that threshold should track
  // LANE_START (63) instead of 52 is a bot-strategy judgment call (how eager
  // should the bot be to rush a marble home vs. keep optimizing position?),
  // not a bug fix — left as-is; see docs/reviews/wahoo-review.md item 12.
  const bestAdvance = (pool: WahooMove[]): WahooMove | undefined => {
    let best: WahooMove | undefined
    for (const m of pool) {
      if (m.kind !== 'advance' || allPositions[m.setId][m.marbleIdx] + die >= 52) continue
      if (best === undefined) {
        best = m
        continue
      }
      const p = allPositions[m.setId][m.marbleIdx]
      const bp = allPositions[best.setId][best.marbleIdx]
      if (
        p > bp ||
        (p === bp && (m.setId < best.setId || (m.setId === best.setId && m.marbleIdx < best.marbleIdx)))
      ) {
        best = m
      }
    }
    return best
  }

  const pick = (pool: WahooMove[]): WahooMove | undefined =>
    pool.find(winsNow) ??
    pool.find((m) => moveBumps(publicState, playerId, die, m)) ??
    pool.find((m) => m.kind === 'advance' && allPositions[m.setId][m.marbleIdx] + die >= 52) ??
    pool.find((m) => m.kind === 'shortcut') ??
    pool.find((m) => m.kind === 'exit') ??
    pool.find((m) => m.kind === 'out') ??
    bestAdvance(pool)

  const move = pick(nonSelfBumps) ?? pick(selfBumps)
  return { type: 'MOVE', move: move! }
}
