import type { BotStrategy } from '../../engine/bot.ts'
import { LANE_START } from './board.ts'
import {
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
// is closest to home (ties by lower marbleIdx).
export const wahooBotStrategy: BotStrategy<WahooPublicState, WahooPrivateState, WahooAction> = (
  publicState,
  _privateState,
  playerId,
) => {
  if (publicState.turn.phase === 'roll') return { type: 'ROLL' }
  const die = publicState.die!
  const positions = publicState.positions[playerId]
  const moves = legalMoves(publicState, playerId, die)

  // A move wins now iff it is an advance that brings the last non-lane marble
  // into the lane — this must match rules.ts's actual win check exactly
  // (positions[playerId].every(p => p >= LANE_START)), not an approximation,
  // or the bot can misprioritize a move it wrongly believes ends the game.
  const winsNow = (m: WahooMove): boolean => {
    if (m.kind !== 'advance') return false
    const to = positions[m.marbleIdx] + die
    return to >= LANE_START && positions.every((q, i) => i === m.marbleIdx || q >= LANE_START)
  }

  // Fallback among non-lane-entry advances: closest to home, then lower index.
  // NOTE: the ">= 52" cutoff below (and in the priority branch further down)
  // is a deliberate "near home" strategy threshold, distinct from winsNow's
  // correctness requirement above — it decides when a track marble stops
  // competing in the closest-to-home tie-break and instead gets priority as
  // an advance-toward-lane move. Whether that threshold should track
  // LANE_START (63) instead of 52 is a bot-strategy judgment call (how eager
  // should the bot be to rush a marble home vs. keep optimizing position?),
  // not a bug fix — left as-is; see docs/reviews/wahoo-review.md item 12.
  let bestAdvance: WahooMove | undefined
  for (const m of moves) {
    if (m.kind !== 'advance' || positions[m.marbleIdx] + die >= 52) continue
    if (
      bestAdvance === undefined ||
      positions[m.marbleIdx] > positions[bestAdvance.marbleIdx] ||
      (positions[m.marbleIdx] === positions[bestAdvance.marbleIdx] && m.marbleIdx < bestAdvance.marbleIdx)
    ) {
      bestAdvance = m
    }
  }

  const move =
    moves.find(winsNow) ??
    moves.find((m) => moveBumps(publicState, playerId, die, m)) ??
    moves.find((m) => m.kind === 'advance' && positions[m.marbleIdx] + die >= 52) ??
    moves.find((m) => m.kind === 'shortcut') ??
    moves.find((m) => m.kind === 'exit') ??
    moves.find((m) => m.kind === 'out') ??
    bestAdvance
  return { type: 'MOVE', move: move! }
}
