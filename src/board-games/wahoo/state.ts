import type { HostSession } from '../../engine/sync.ts'
import { createHostSession } from '../../engine/sync.ts'
import { createRng } from '../../engine/rng.ts'
import { createTurnState, type TurnState } from '../../engine/turn-engine.ts'
import {
  LANE_END,
  OWNER_TRACK_LEN,
  SHORTCUT_ENTRIES,
  SHORTCUT_EXITS,
  trackIndexFor,
} from './board.ts'

export type WahooSeatCount = 2 | 3 | 4

// marble position: -1 base, -2 center, 0..62 track (relative to own arm's
// come-out hole: 0 = come-out, 62 = home entrance at the own-arm tip middle),
// 63..66 home lane (63 outermost, adjacent to the home entrance; 66 deepest,
// nearest the center)
export type MarblePos = number

export interface WahooPublicState {
  stage: 'play' | 'over'
  turn: TurnState<'roll' | 'move'> // phase 'roll' = awaiting ROLL, 'move' = die shown, awaiting MOVE
  seatArms: Record<string, number> // setId -> arm 0..3
  positions: Record<string, MarblePos[]> // setId -> 4 marbles
  setOwners: Record<string, string> // setId -> controlling playerId (identity map in normal games)
  centerBy: { setId: string; marbleIdx: number; entryCornerRel: 6 | 22 } | null
  die: number | null // current roll while phase 'move'
  sixStreak: number // consecutive 6s in the current player's chain
  lastMoved: { playerId: string; setId: string; marbleIdx: number } | null // for the triple-six bust
  lastEvent: WahooEvent | null // drives status + sounds
  winnerId: string | null
  mutedArm: number | null // 3-player games: the unused arm
  houseRules: Record<WahooHouseRuleKey, boolean> // per-match settings, chosen at game creation
}

export type WahooEvent =
  | { kind: 'roll'; by: string; die: number }
  | { kind: 'move'; by: string; marbleIdx: number; bumpedId: string | null } // bumpedId = bumped setId
  | { kind: 'out'; by: string; bumpedId: string | null } // brought a marble out of base; bumpedId = bumped setId
  | { kind: 'shortcut'; by: string; bumpedId: string | null } // entered center; bumpedId = bumped setId
  | { kind: 'exit'; by: string; bumpedId: string | null } // left center; bumpedId = bumped setId
  | { kind: 'bust'; by: string; die: 6 } // triple six
  | { kind: 'pass'; by: string; die: number } // no legal move; die so clients can show the roll
  | { kind: 'win'; by: string }

export type WahooAction =
  | { type: 'ROLL' }
  | { type: 'MOVE'; move: WahooMove } // one of the legal moves for the shown die

export interface WahooMove {
  setId: string // the marble set being moved (=== playerId in normal games)
  marbleIdx: number
  kind: 'out' | 'advance' | 'shortcut' | 'exit'
}

export type WahooPrivateState = Record<string, never>

export interface WahooSession {
  session: HostSession<WahooPublicState, WahooPrivateState>
  rng: () => number // host-only; drives the die rolls
}

export type WahooHouseRuleKey = 'twoColors'

export const WAHOO_HOUSE_RULE_DEFS: {
  key: WahooHouseRuleKey
  label: string
  description: string
  default: boolean
}[] = [
  {
    key: 'twoColors',
    label: 'Two colors each',
    description:
      'Two players only: each player runs two colors on opposite corners. Roll once, move any marble you control — your colors jump, block, and even bump each other exactly like opponents. Win by getting all eight home.',
    default: false,
  },
]

// Builds the stored houseRules record from WAHOO_HOUSE_RULE_DEFS defaults,
// overlaying whatever the caller passed. Every defined key always has a real
// boolean value.
export function resolveWahooHouseRules(
  overrides?: Partial<Record<WahooHouseRuleKey, boolean>>,
): Record<WahooHouseRuleKey, boolean> {
  const resolved = {} as Record<WahooHouseRuleKey, boolean>
  for (const def of WAHOO_HOUSE_RULE_DEFS) {
    resolved[def.key] = overrides?.[def.key] ?? def.default
  }
  return resolved
}

// The two forward-diagonal corners a player's marbles can shortcut into the
// center from (relative track coordinates). The other two corners (38, 54)
// are only ever reached by EXITING the center — see exitTargetRel.
// (SHORTCUT_ENTRIES lives in board.ts with the rest of the constant set.)

// Relative track position of the exit corner for a center marble that entered
// via the given corner: the diagonal opposite (entry 6 → 38, entry 22 → 54).
export function exitTargetRel(entryCornerRel: 6 | 22): 38 | 54 {
  return SHORTCUT_EXITS[entryCornerRel]
}

// Absolute track index (0..63) of a set's relative track position.
export function absoluteIndex(seatArms: Record<string, number>, setId: string, rel: number): number {
  return trackIndexFor(seatArms[setId], rel)
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// 2 players face off on one of the two opposite arm pairs, chosen at random,
// then shuffled between them. 3 players drop one random arm (mutedArm). 4
// players take all four arms shuffled. Turn order is the given playerIds order.
// Under the twoColors house rule (2 players only), each player runs two marble
// sets on one opposite arm pair (the other pair goes to the opponent), with
// setId = playerId for the first set and `${playerId}:2` for the second.
export function createWahooGame(
  playerIds: string[],
  seed: number,
  houseRules?: Partial<Record<WahooHouseRuleKey, boolean>>,
): WahooSession {
  if (playerIds.length < 2 || playerIds.length > 4) {
    throw new Error(`createWahooGame requires 2-4 players, got ${playerIds.length}`)
  }
  const resolved = resolveWahooHouseRules(houseRules)
  // Defensive gate: twoColors is only ever real for exactly 2 players — the
  // stored value itself is forced false otherwise, so downstream code and the
  // UI never see an "on" rule in a 3-4 player game.
  const twoColors = resolved.twoColors && playerIds.length === 2
  const rng = createRng(seed)
  const ALL_ARMS = [0, 1, 2, 3]
  let seatArms: Record<string, number>
  let setOwners: Record<string, string>
  let mutedArm: number | null = null
  if (twoColors) {
    const pair = rng() < 0.5 ? [0, 2] : [1, 3]
    const otherPair = pair.map((a) => (a + 1) % 4)
    const aArms = shuffle(pair, rng)
    const bArms = shuffle(otherPair, rng)
    seatArms = {
      [playerIds[0]]: aArms[0],
      [`${playerIds[0]}:2`]: aArms[1],
      [playerIds[1]]: bArms[0],
      [`${playerIds[1]}:2`]: bArms[1],
    }
    setOwners = {
      [playerIds[0]]: playerIds[0],
      [`${playerIds[0]}:2`]: playerIds[0],
      [playerIds[1]]: playerIds[1],
      [`${playerIds[1]}:2`]: playerIds[1],
    }
  } else if (playerIds.length === 2) {
    const pair = rng() < 0.5 ? [0, 2] : [1, 3]
    const arms = shuffle(pair, rng)
    seatArms = { [playerIds[0]]: arms[0], [playerIds[1]]: arms[1] }
    setOwners = Object.fromEntries(playerIds.map((p) => [p, p]))
  } else if (playerIds.length === 3) {
    mutedArm = ALL_ARMS[Math.floor(rng() * ALL_ARMS.length)]
    const arms = shuffle(ALL_ARMS.filter((a) => a !== mutedArm), rng)
    seatArms = { [playerIds[0]]: arms[0], [playerIds[1]]: arms[1], [playerIds[2]]: arms[2] }
    setOwners = Object.fromEntries(playerIds.map((p) => [p, p]))
  } else {
    const arms = shuffle(ALL_ARMS, rng)
    seatArms = Object.fromEntries(playerIds.map((p, i) => [p, arms[i]]))
    setOwners = Object.fromEntries(playerIds.map((p) => [p, p]))
  }

  const positions: Record<string, MarblePos[]> = {}
  for (const setId of Object.keys(seatArms)) {
    positions[setId] = [-1, -1, -1, -1]
  }
  const privateStates: Record<string, WahooPrivateState> = {}
  for (const p of playerIds) {
    privateStates[p] = {}
  }

  const publicState: WahooPublicState = {
    stage: 'play',
    turn: createTurnState<'roll' | 'move'>(playerIds, 'roll'),
    seatArms,
    positions,
    setOwners,
    centerBy: null,
    die: null,
    sixStreak: 0,
    lastMoved: null,
    lastEvent: null,
    winnerId: null,
    mutedArm,
    houseRules: { ...resolved, twoColors },
  }
  return { session: createHostSession(publicState, privateStates), rng }
}

// Whether the given absolute track hole is occupied by SOME set's marble
// sitting at THAT set's own come-out hole (relative 0) — i.e. a marble on its
// own start space. Distinct per-arm entry holes mean at most one set's rel-0
// can ever map to a given abs hole.
function startProtected(publicState: WahooPublicState, abs: number): boolean {
  return Object.keys(publicState.positions).some(
    (setId) =>
      publicState.positions[setId].includes(0) && trackIndexFor(publicState.seatArms[setId], 0) === abs,
  )
}

// The complete move generator for one player with a shown die. The validator
// and the bot both use this; a MOVE is legal iff its (setId, marbleIdx, kind)
// triple is a member of this list (the target is implied by the state, never
// by the client). Under twoColors the union spans every set the player owns;
// per set, "own marble" means SAME SET ONLY — the player's other color is a
// different key and therefore bump/jump/start-protection material like any
// opponent.
export function legalMoves(publicState: WahooPublicState, playerId: string, die: number): WahooMove[] {
  const moves: WahooMove[] = []
  const mySetIds = Object.keys(publicState.setOwners).filter((s) => publicState.setOwners[s] === playerId)
  for (const setId of mySetIds) {
    const arm = publicState.seatArms[setId]
    const positions = publicState.positions[setId]
    const centerBy = publicState.centerBy

    // out: die 1 or 6, marble in base, own entry hole (relative 0) not occupied
    // by an own marble. An opponent sitting on the entry is fine — they get bumped.
    if (die === 1 || die === 6) {
      if (!positions.includes(0)) {
        for (let i = 0; i < 4; i++) {
          if (positions[i] === -1) moves.push({ setId, marbleIdx: i, kind: 'out' })
        }
      }
    }

    // shortcut: track marble at p, corner c in {6, 22}, p <= c and the die lands
    // exactly on the corner plus one step into the center. The path is a jump —
    // only the center's occupant matters (a same-set occupant blocks; anyone
    // else, own other color included, gets bumped).
    if (centerBy?.setId !== setId) {
      for (let i = 0; i < 4; i++) {
        const p = positions[i]
        if (p < 0 || p > OWNER_TRACK_LEN - 1) continue
        for (const c of SHORTCUT_ENTRIES) {
          if (p <= c && die === c - p + 1) moves.push({ setId, marbleIdx: i, kind: 'shortcut' })
        }
      }
    }

    // exit: center marble of this set, die 1 or 6, diagonal corner (38/54)
    // free of own marbles (an opponent there is bumped).
    if ((die === 1 || die === 6) && centerBy?.setId === setId) {
      const target = exitTargetRel(centerBy.entryCornerRel)
      if (!positions.includes(target)) {
        moves.push({ setId, marbleIdx: centerBy.marbleIdx, kind: 'exit' })
      }
    }

    // advance: exact count everywhere. No jumping or landing on an own marble
    // anywhere in the path (track, lane, or across the track→lane boundary);
    // opponents only matter at the landing hole (they get bumped there, and
    // only there — passing over them is fine), except landing on an opponent's
    // own start space, which is never allowed (see startProtected).
    for (let i = 0; i < 4; i++) {
      const p = positions[i]
      if (p < 0) continue
      const to = p + die
      if (to > LANE_END) continue // overshoot past the deepest lane slot is illegal
      if (positions.some((q) => q > p && q <= to)) continue // own marble jumped or landed on
      if (to <= OWNER_TRACK_LEN - 1 && startProtected(publicState, trackIndexFor(arm, to))) continue
      moves.push({ setId, marbleIdx: i, kind: 'advance' })
    }
  }
  return moves
}

// The setId of the marble a (legal) move would send home: at the entry hole
// for 'out', at the landing hole for track advances, in the center for
// 'shortcut', at the exit corner for 'exit'. Null if none. Any other set —
// opponents and the mover's own other color alike — qualifies.
export function bumpVictim(publicState: WahooPublicState, setId: string, die: number, move: WahooMove): string | null {
  const arm = publicState.seatArms[setId]
  const victimAt = (abs: number): string | null => {
    for (const s of Object.keys(publicState.positions)) {
      if (s === setId) continue
      const idx = publicState.positions[s].findIndex(
        (q) => q >= 0 && q <= OWNER_TRACK_LEN - 1 && trackIndexFor(publicState.seatArms[s], q) === abs,
      )
      if (idx !== -1) return s
    }
    return null
  }
  if (move.kind === 'out') return victimAt(trackIndexFor(arm, 0))
  if (move.kind === 'advance') {
    const to = publicState.positions[setId][move.marbleIdx] + die
    return to <= OWNER_TRACK_LEN - 1 ? victimAt(trackIndexFor(arm, to)) : null
  }
  if (move.kind === 'shortcut') {
    return publicState.centerBy !== null && publicState.centerBy.setId !== setId ? publicState.centerBy.setId : null
  }
  const target = exitTargetRel(publicState.centerBy!.entryCornerRel)
  return victimAt(trackIndexFor(arm, target))
}

// Whether a (legal) move bumps anyone at all, the mover's own other color
// included. Used by the bot to pick bumping moves.
export function moveBumps(publicState: WahooPublicState, _playerId: string, die: number, move: WahooMove): boolean {
  return bumpVictim(publicState, move.setId, die, move) !== null
}
