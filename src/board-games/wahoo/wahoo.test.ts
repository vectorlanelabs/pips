import { describe, expect, it } from 'vitest'
import { createRng } from '../../engine/rng.ts'
import { createHostSession, deriveSnapshot, isJsonSerializable } from '../../engine/sync.ts'
import { createTurnState, currentPlayer } from '../../engine/turn-engine.ts'
import {
  absoluteIndex,
  createWahooGame,
  legalMoves,
  type MarblePos,
  type WahooEvent,
  type WahooPrivateState,
  type WahooPublicState,
  type WahooSession,
} from './state.ts'
import { applyWahooAction, runWahooBotTurn } from './rules.ts'
import { wahooBotStrategy } from './bot.ts'
import { HOME_ENTRANCE_REL, LANE_END, LANE_START, SHORTCUT_ENTRIES, SHORTCUT_EXITS, trackIndexFor } from './board.ts'

function buildWahoo(config: {
  playerIds?: string[]
  seatArms?: Record<string, number>
  positions?: Record<string, MarblePos[]>
  setOwners?: Record<string, string>
  stage?: 'play' | 'over'
  phase?: 'roll' | 'move'
  currentIndex?: number
  die?: number | null
  sixStreak?: number
  centerBy?: WahooPublicState['centerBy']
  lastMoved?: WahooPublicState['lastMoved']
  lastEvent?: WahooEvent | null
  winnerId?: string | null
  mutedArm?: number | null
  houseRules?: { twoColors: boolean }
  rngSeed?: number
}): WahooSession {
  const playerIds = config.playerIds ?? ['p1', 'p2']
  const turn = createTurnState<'roll' | 'move'>(playerIds, config.phase ?? 'roll')
  if (config.currentIndex != null) {
    // createTurnState starts at index 0; advance to the desired index directly
    ;(turn as { currentIndex: number }).currentIndex = config.currentIndex
  }
  const defaults: Record<string, MarblePos[]> = {}
  const defaultOwners: Record<string, string> = {}
  for (const p of playerIds) {
    defaults[p] = [-1, -1, -1, -1]
    defaultOwners[p] = p
  }
  const publicState: WahooPublicState = {
    stage: config.stage ?? 'play',
    turn,
    seatArms: config.seatArms ?? { p1: 0, p2: 2 },
    positions: config.positions ?? defaults,
    setOwners: config.setOwners ?? defaultOwners,
    centerBy: config.centerBy ?? null,
    die: config.die ?? null,
    sixStreak: config.sixStreak ?? 0,
    lastMoved: config.lastMoved ?? null,
    lastEvent: config.lastEvent ?? null,
    winnerId: config.winnerId ?? null,
    mutedArm: config.mutedArm ?? null,
    houseRules: config.houseRules ?? { twoColors: false },
  }
  const privateStates: Record<string, WahooPrivateState> = {}
  for (const p of playerIds) privateStates[p] = {}
  return { session: createHostSession(publicState, privateStates), rng: createRng(config.rngSeed ?? 0) }
}

describe('createWahooGame', () => {
  it('2 players sit on opposite arms with fresh positions and a roll phase', () => {
    for (let seed = 0; seed < 20; seed++) {
      const pub = createWahooGame(['p1', 'p2'], seed).session.publicState
      expect(Math.abs(pub.seatArms['p1'] - pub.seatArms['p2'])).toBe(2)
      expect(pub.mutedArm).toBeNull()
      expect(pub.turn.playerOrder).toEqual(['p1', 'p2'])
      expect(pub.turn.phase).toBe('roll')
      expect(pub.stage).toBe('play')
      expect(pub.positions['p1']).toEqual([-1, -1, -1, -1])
      expect(pub.positions['p2']).toEqual([-1, -1, -1, -1])
      expect(pub.die).toBeNull()
      expect(pub.sixStreak).toBe(0)
      expect(pub.centerBy).toBeNull()
      expect(pub.lastMoved).toBeNull()
      expect(pub.lastEvent).toBeNull()
      expect(pub.winnerId).toBeNull()
    }
    // deterministic per seed
    expect(createWahooGame(['p1', 'p2'], 7).session.publicState).toEqual(
      createWahooGame(['p1', 'p2'], 7).session.publicState,
    )
  })

  it('3 players drop one random arm into mutedArm and keep three distinct arms', () => {
    for (let seed = 0; seed < 20; seed++) {
      const pub = createWahooGame(['p1', 'p2', 'p3'], seed).session.publicState
      expect(pub.mutedArm).not.toBeNull()
      const arms = [pub.seatArms['p1'], pub.seatArms['p2'], pub.seatArms['p3']]
      expect(new Set(arms).size).toBe(3)
      expect(arms.every((a) => a >= 0 && a <= 3)).toBe(true)
      expect(arms).not.toContain(pub.mutedArm)
      expect(pub.positions['p3']).toEqual([-1, -1, -1, -1])
    }
    expect(createWahooGame(['p1', 'p2', 'p3'], 7).session.publicState).toEqual(
      createWahooGame(['p1', 'p2', 'p3'], 7).session.publicState,
    )
  })

  it('4 players take all four arms', () => {
    for (let seed = 0; seed < 20; seed++) {
      const pub = createWahooGame(['p1', 'p2', 'p3', 'p4'], seed).session.publicState
      expect(pub.mutedArm).toBeNull()
      const arms = [pub.seatArms['p1'], pub.seatArms['p2'], pub.seatArms['p3'], pub.seatArms['p4']]
      expect([...arms].sort((a, b) => a - b)).toEqual([0, 1, 2, 3])
      expect(pub.turn.playerOrder).toEqual(['p1', 'p2', 'p3', 'p4'])
    }
    expect(createWahooGame(['p1', 'p2', 'p3', 'p4'], 7).session.publicState).toEqual(
      createWahooGame(['p1', 'p2', 'p3', 'p4'], 7).session.publicState,
    )
  })
})

describe('turn and phase gating', () => {
  it('rejects ROLL and MOVE out of turn', () => {
    const wh = buildWahoo({ phase: 'roll' })
    const r = applyWahooAction(wh, 'p2', { type: 'ROLL' })
    expect(r.outcome.ok).toBe(false)
    expect(r.outcome.reason).toContain('not your turn')

    const wh2 = buildWahoo({ phase: 'move', die: 6, positions: { p1: [5, -1, -1, -1], p2: [-1, -1, -1, -1] } })
    const m = applyWahooAction(wh2, 'p2', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
    expect(m.outcome.ok).toBe(false)
    expect(m.outcome.reason).toContain('not your turn')
  })

  it('rejects ROLL during the move phase and MOVE during the roll phase', () => {
    const wh1 = buildWahoo({ phase: 'move', die: 3 })
    const r = applyWahooAction(wh1, 'p1', { type: 'ROLL' })
    expect(r.outcome.ok).toBe(false)
    expect(r.outcome.reason).toContain('already rolled')

    const wh2 = buildWahoo({ phase: 'roll' })
    const m = applyWahooAction(wh2, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'out' } })
    expect(m.outcome.ok).toBe(false)
    expect(m.outcome.reason).toContain('roll first')
  })

  it('rejects a MOVE that is not in legalMoves (wrong marble, wrong kind)', () => {
    const wh = buildWahoo({ phase: 'move', die: 3, positions: { p1: [5, -1, -1, -1], p2: [-1, -1, -1, -1] } })
    expect(legalMoves(wh.session.publicState, 'p1', 3)).toEqual([{ setId: 'p1', marbleIdx: 0, kind: 'advance' }])

    // wrong marble: marble 1 is in base, so advancing it is not legal
    const bad1 = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 1, kind: 'advance' } })
    expect(bad1.outcome.ok).toBe(false)
    expect(bad1.outcome.reason).toContain('not a legal move')

    // wrong kinds for a track marble
    for (const kind of ['out', 'shortcut', 'exit'] as const) {
      const bad = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind } })
      expect(bad.outcome.ok).toBe(false)
      expect(bad.outcome.reason).toContain('not a legal move')
    }
  })
})

describe('out', () => {
  it('brings a marble out on a 1 or 6 but not other dice', () => {
    let wh = buildWahoo({ phase: 'move', die: 1, positions: { p1: [-1, -1, -1, -1], p2: [-1, -1, -1, -1] } })
    let r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'out' } })
    expect(r.outcome.ok).toBe(true)
    let pub = r.wh.session.publicState
    expect(pub.positions['p1']).toEqual([0, -1, -1, -1])
    expect(pub.lastEvent).toEqual({ kind: 'out', by: 'p1', bumpedId: null })

    wh = buildWahoo({ phase: 'move', die: 6, positions: { p1: [-1, 5, -1, -1], p2: [-1, -1, -1, -1] } })
    r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'out' } })
    expect(r.outcome.ok).toBe(true)
    pub = r.wh.session.publicState
    expect(pub.positions['p1']).toEqual([0, 5, -1, -1])

    // die 3: no out move is offered at all
    const wh3 = buildWahoo({ phase: 'move', die: 3, positions: { p1: [-1, -1, -1, -1], p2: [-1, -1, -1, -1] } })
    expect(legalMoves(wh3.session.publicState, 'p1', 3)).toEqual([])
    const bad = applyWahooAction(wh3, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'out' } })
    expect(bad.outcome.ok).toBe(false)
  })

  it('is blocked when an own marble sits on the entry hole', () => {
    const wh = buildWahoo({ phase: 'move', die: 1, positions: { p1: [0, -1, -1, -1], p2: [-1, -1, -1, -1] } })
    expect(legalMoves(wh.session.publicState, 'p1', 1).some((m) => m.kind === 'out')).toBe(false)
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 1, kind: 'out' } })
    expect(r.outcome.ok).toBe(false)
  })

  it('bumps an opponent sitting on the entry hole', () => {
    // p2 (arm 2) at rel 32 sits on absolute 9 — p1's come-out hole.
    const wh = buildWahoo({
      phase: 'move',
      die: 6,
      positions: { p1: [-1, -1, -1, -1], p2: [32, 5, -1, -1] },
    })
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 1, kind: 'out' } })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.positions['p1']).toEqual([-1, 0, -1, -1])
    expect(pub.positions['p2']).toEqual([-1, 5, -1, -1])
    expect(pub.lastEvent).toEqual({ kind: 'out', by: 'p1', bumpedId: 'p2' })
  })
})

describe('advance', () => {
  it('lands exactly on pos + die and passes the turn', () => {
    const wh = buildWahoo({ phase: 'move', die: 3, positions: { p1: [5, -1, -1, -1], p2: [-1, -1, -1, -1] } })
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.positions['p1']).toEqual([8, -1, -1, -1])
    expect(pub.lastEvent).toEqual({ kind: 'move', by: 'p1', marbleIdx: 0, bumpedId: null })
    expect(pub.die).toBeNull()
    expect(pub.turn.phase).toBe('roll')
    expect(currentPlayer(pub.turn)).toBe('p2')
    expect(pub.turn.turnNumber).toBe(2)
  })

  it('is blocked by an own marble at the landing', () => {
    const wh = buildWahoo({ phase: 'move', die: 3, positions: { p1: [5, 8, -1, -1], p2: [-1, -1, -1, -1] } })
    expect(legalMoves(wh.session.publicState, 'p1', 3)).toEqual([{ setId: 'p1', marbleIdx: 1, kind: 'advance' }])
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
    expect(r.outcome.ok).toBe(false)
  })

  it('detects cross-seat collisions in absolute terms and bumps the opponent', () => {
    // p1 (arm 0) rel 12 and p2 (arm 2) rel 44 both sit on absolute 21 — they
    // collide absolutely but not relatively.
    expect(absoluteIndex({ p1: 0, p2: 2 }, 'p2', 44)).toBe(21)
    const wh = buildWahoo({
      phase: 'move',
      die: 1,
      currentIndex: 1,
      positions: { p1: [12, -1, -1, -1], p2: [43, 20, -1, -1] },
    })
    const r = applyWahooAction(wh, 'p2', { type: 'MOVE', move: { setId: 'p2', marbleIdx: 0, kind: 'advance' } })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.positions['p2']).toEqual([44, 20, -1, -1])
    expect(pub.positions['p1']).toEqual([-1, -1, -1, -1]) // bumped back to base
    expect(pub.lastEvent).toEqual({ kind: 'move', by: 'p2', marbleIdx: 0, bumpedId: 'p1' })
  })
})

describe('start-space protection and own-marble jumping', () => {
  it('never allows an advance to land on an opponent sitting at ITS OWN come-out hole (rel 0)', () => {
    // p2 (arm 2) sits at its own come-out (rel 0) = absolute trackIndexFor(2,0) = 41.
    // p1 (arm 0) at rel 30 with die 2 would land on absolute 32+9=41 too.
    expect(trackIndexFor(2, 0)).toBe(41)
    expect(trackIndexFor(0, 32)).toBe(41)
    const wh = buildWahoo({
      phase: 'move',
      die: 2,
      positions: { p1: [30, -1, -1, -1], p2: [0, -1, -1, -1] },
    })
    expect(legalMoves(wh.session.publicState, 'p1', 2)).toEqual([])
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
    expect(r.outcome.ok).toBe(false)
    // The same absolute hole remains bumpable when the opponent is merely
    // passing through at a NON-zero relative position -- already covered by
    // 'detects cross-seat collisions in absolute terms and bumps the
    // opponent' above; not duplicated here.
  })

  it('an own marble 3 relative spaces ahead blocks a 5-roll advance of the marble behind it', () => {
    const wh = buildWahoo({
      phase: 'move',
      die: 5,
      positions: { p1: [5, 8, -1, -1], p2: [-1, -1, -1, -1] },
    })
    expect(legalMoves(wh.session.publicState, 'p1', 5).some((m) => m.marbleIdx === 0)).toBe(false)
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
    expect(r.outcome.ok).toBe(false)
  })

  it('an own marble just past LANE_START blocks an advance crossing the track/lane boundary', () => {
    // marble 0 at rel 60, marble 1 (own) at rel 64 (just past LANE_START=63).
    // die 5 would move marble 0 to rel 65, jumping over marble 1 mid-lane.
    const wh = buildWahoo({
      phase: 'move',
      die: 5,
      positions: { p1: [60, LANE_START + 1, -1, -1], p2: [-1, -1, -1, -1] },
    })
    expect(legalMoves(wh.session.publicState, 'p1', 5).some((m) => m.marbleIdx === 0)).toBe(false)
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
    expect(r.outcome.ok).toBe(false)
  })
})

describe('home lane', () => {
  it('enters the lane with an exact count', () => {
    let wh = buildWahoo({ phase: 'move', die: 1, positions: { p1: [HOME_ENTRANCE_REL, -1, -1, -1], p2: [-1, -1, -1, -1] } })
    let r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
    expect(r.outcome.ok).toBe(true)
    expect(r.wh.session.publicState.positions['p1'][0]).toBe(LANE_START)

    wh = buildWahoo({ phase: 'move', die: 2, positions: { p1: [HOME_ENTRANCE_REL - 1, -1, -1, -1], p2: [-1, -1, -1, -1] } })
    r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
    expect(r.outcome.ok).toBe(true)
    expect(r.wh.session.publicState.positions['p1'][0]).toBe(LANE_START)
  })

  it('rejects overshoot past the deepest lane slot', () => {
    const wh = buildWahoo({ phase: 'move', die: 6, positions: { p1: [HOME_ENTRANCE_REL, -1, -1, -1], p2: [-1, -1, -1, -1] } })
    expect(legalMoves(wh.session.publicState, 'p1', 6).some((m) => m.kind === 'advance')).toBe(false)
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
    expect(r.outcome.ok).toBe(false)
  })

  it('enforces the no-pass rule inside the lane', () => {
    // entry onto an occupied lane slot is blocked
    let wh = buildWahoo({ phase: 'move', die: 1, positions: { p1: [HOME_ENTRANCE_REL, LANE_START, -1, -1], p2: [-1, -1, -1, -1] } })
    expect(legalMoves(wh.session.publicState, 'p1', 1).some((m) => m.kind === 'advance' && m.marbleIdx === 0)).toBe(false)
    let r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
    expect(r.outcome.ok).toBe(false)

    // passing a lane marble is blocked even with room ahead
    wh = buildWahoo({ phase: 'move', die: 2, positions: { p1: [LANE_START, LANE_START + 2, -1, -1], p2: [-1, -1, -1, -1] } })
    expect(legalMoves(wh.session.publicState, 'p1', 2)).toEqual([])
    r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
    expect(r.outcome.ok).toBe(false)
  })

  it('advances within the lane by exact count', () => {
    let wh = buildWahoo({ phase: 'move', die: 2, positions: { p1: [LANE_START, -1, -1, -1], p2: [-1, -1, -1, -1] } })
    let r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
    expect(r.outcome.ok).toBe(true)
    expect(r.wh.session.publicState.positions['p1'][0]).toBe(LANE_START + 2)

    wh = buildWahoo({ phase: 'move', die: 1, positions: { p1: [LANE_START + 1, LANE_START + 2, -1, -1], p2: [-1, -1, -1, -1] } })
    expect(legalMoves(wh.session.publicState, 'p1', 1).some((m) => m.kind === 'advance' && m.marbleIdx === 0)).toBe(false)
    r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
    expect(r.outcome.ok).toBe(false)
  })

  it('fills the lane back-to-front: LANE_END, LANE_END − 1, LANE_END − 2, LANE_START', () => {
    let positions: Record<string, MarblePos[]> = {
      p1: [HOME_ENTRANCE_REL, HOME_ENTRANCE_REL, HOME_ENTRANCE_REL, HOME_ENTRANCE_REL],
      p2: [-1, -1, -1, -1],
    }
    for (const [marbleIdx, die] of [[0, 4], [1, 3], [2, 2], [3, 1]] as const) {
      const wh = buildWahoo({ phase: 'move', die, positions })
      const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx, kind: 'advance' } })
      expect(r.outcome.ok).toBe(true)
      positions = r.wh.session.publicState.positions
    }
    expect(positions['p1']).toEqual([LANE_END, LANE_END - 1, LANE_END - 2, LANE_START])
  })
})

describe('shortcut', () => {
  it('offers the corner jump from p=5 with die 2 via corner 6', () => {
    const wh = buildWahoo({ phase: 'move', die: 2, positions: { p1: [5, -1, -1, -1], p2: [-1, -1, -1, -1] } })
    expect(legalMoves(wh.session.publicState, 'p1', 2)).toContainEqual({ setId: 'p1', marbleIdx: 0, kind: 'shortcut' })
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'shortcut' } })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.positions['p1']).toEqual([-2, -1, -1, -1])
    expect(pub.centerBy).toEqual({ setId: 'p1', marbleIdx: 0, entryCornerRel: SHORTCUT_ENTRIES[0] })
    expect(pub.lastEvent).toEqual({ kind: 'shortcut', by: 'p1', bumpedId: null })
  })

  it('never offers the 38/54 corners as shortcut entries', () => {
    // p=37 die 2: (38 − 37) + 1 = 2 would fit if 38 were a shortcut corner
    let wh = buildWahoo({ phase: 'move', die: 2, positions: { p1: [37, -1, -1, -1], p2: [-1, -1, -1, -1] } })
    let moves = legalMoves(wh.session.publicState, 'p1', 2)
    expect(moves.some((m) => m.kind === 'shortcut')).toBe(false)
    // p=53 die 2: (54 − 53) + 1 = 2
    wh = buildWahoo({ phase: 'move', die: 2, positions: { p1: [53, -1, -1, -1], p2: [-1, -1, -1, -1] } })
    moves = legalMoves(wh.session.publicState, 'p1', 2)
    expect(moves.some((m) => m.kind === 'shortcut')).toBe(false)
  })

  it('is illegal when the center holds an own marble', () => {
    const wh = buildWahoo({
      phase: 'move',
      die: 2,
      positions: { p1: [5, -2, -1, -1], p2: [-1, -1, -1, -1] },
      centerBy: { setId: 'p1', marbleIdx: 1, entryCornerRel: SHORTCUT_ENTRIES[0] },
    })
    expect(legalMoves(wh.session.publicState, 'p1', 2).some((m) => m.kind === 'shortcut')).toBe(false)
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'shortcut' } })
    expect(r.outcome.ok).toBe(false)
  })

  it('bumps an opponent out of the center and takes it over', () => {
    const wh = buildWahoo({
      phase: 'move',
      die: 2,
      positions: { p1: [5, -1, -1, -1], p2: [-2, -1, -1, -1] },
      centerBy: { setId: 'p2', marbleIdx: 0, entryCornerRel: SHORTCUT_ENTRIES[1] },
    })
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'shortcut' } })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.positions['p1']).toEqual([-2, -1, -1, -1])
    expect(pub.positions['p2']).toEqual([-1, -1, -1, -1]) // bumped back to base
    expect(pub.centerBy).toEqual({ setId: 'p1', marbleIdx: 0, entryCornerRel: SHORTCUT_ENTRIES[0] })
    expect(pub.lastEvent).toEqual({ kind: 'shortcut', by: 'p1', bumpedId: 'p2' })
  })
})

describe('exit', () => {
  it('requires a 1 or 6', () => {
    const wh = buildWahoo({
      phase: 'move',
      die: 3,
      positions: { p1: [-2, -1, -1, -1], p2: [-1, -1, -1, -1] },
      centerBy: { setId: 'p1', marbleIdx: 0, entryCornerRel: SHORTCUT_ENTRIES[0] },
    })
    expect(legalMoves(wh.session.publicState, 'p1', 3).some((m) => m.kind === 'exit')).toBe(false)
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'exit' } })
    expect(r.outcome.ok).toBe(false)
  })

  it('lands on the diagonal corner: entry 6 → rel 38, entry 22 → rel 54', () => {
    let wh = buildWahoo({
      phase: 'move',
      die: 1,
      positions: { p1: [-2, -1, -1, -1], p2: [-1, -1, -1, -1] },
      centerBy: { setId: 'p1', marbleIdx: 0, entryCornerRel: SHORTCUT_ENTRIES[0] },
    })
    let r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'exit' } })
    expect(r.outcome.ok).toBe(true)
    let pub = r.wh.session.publicState
    expect(pub.positions['p1']).toEqual([SHORTCUT_EXITS[SHORTCUT_ENTRIES[0]], -1, -1, -1])
    expect(pub.centerBy).toBeNull()
    expect(pub.lastEvent).toEqual({ kind: 'exit', by: 'p1', bumpedId: null })

    wh = buildWahoo({
      phase: 'move',
      die: 6,
      positions: { p1: [-2, -1, -1, -1], p2: [-1, -1, -1, -1] },
      centerBy: { setId: 'p1', marbleIdx: 0, entryCornerRel: SHORTCUT_ENTRIES[1] },
    })
    r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'exit' } })
    expect(r.outcome.ok).toBe(true)
    pub = r.wh.session.publicState
    expect(pub.positions['p1']).toEqual([SHORTCUT_EXITS[SHORTCUT_ENTRIES[1]], -1, -1, -1])
    expect(pub.centerBy).toBeNull()
  })

  it('is blocked by an own marble on the target corner', () => {
    const wh = buildWahoo({
      phase: 'move',
      die: 1,
      positions: { p1: [-2, SHORTCUT_EXITS[SHORTCUT_ENTRIES[0]], -1, -1], p2: [-1, -1, -1, -1] },
      centerBy: { setId: 'p1', marbleIdx: 0, entryCornerRel: SHORTCUT_ENTRIES[0] },
    })
    expect(legalMoves(wh.session.publicState, 'p1', 1).some((m) => m.kind === 'exit')).toBe(false)
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'exit' } })
    expect(r.outcome.ok).toBe(false)
  })

  it('bumps an opponent on the target corner', () => {
    // p1 (arm 0) exits entry 6 → rel 38 = abs (9+38) = 47. p2 (arm 2) at
    // rel 6 sits on the same absolute hole: (41+6) = 47.
    const wh = buildWahoo({
      phase: 'move',
      die: 1,
      positions: { p1: [-2, -1, -1, -1], p2: [6, -1, -1, -1] },
      centerBy: { setId: 'p1', marbleIdx: 0, entryCornerRel: SHORTCUT_ENTRIES[0] },
    })
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'exit' } })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.positions['p1']).toEqual([SHORTCUT_EXITS[SHORTCUT_ENTRIES[0]], -1, -1, -1])
    expect(pub.positions['p2']).toEqual([-1, -1, -1, -1])
    expect(pub.lastEvent).toEqual({ kind: 'exit', by: 'p1', bumpedId: 'p2' })
  })
})

describe('six chain', () => {
  it('roll 6 + move grants an extra roll; the third consecutive 6 busts on ROLL, no MOVE needed', () => {
    // seed 749: the first three host rolls are all 6
    let wh = buildWahoo({ phase: 'roll', rngSeed: 749, positions: { p1: [5, -1, -1, -1], p2: [-1, -1, -1, -1] } })
    for (let i = 1; i <= 2; i++) {
      let r = applyWahooAction(wh, 'p1', { type: 'ROLL' })
      expect(r.outcome.ok).toBe(true)
      wh = r.wh
      let pub = wh.session.publicState
      expect(pub.die).toBe(6)
      expect(pub.turn.phase).toBe('move')
      expect(pub.lastEvent).toEqual({ kind: 'roll', by: 'p1', die: 6 })

      r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
      expect(r.outcome.ok).toBe(true)
      wh = r.wh
      pub = wh.session.publicState
      expect(pub.lastMoved).toEqual({ playerId: 'p1', setId: 'p1', marbleIdx: 0 })
      expect(pub.sixStreak).toBe(i)
      expect(pub.die).toBeNull()
      expect(pub.turn.phase).toBe('roll')
      expect(currentPlayer(pub.turn)).toBe('p1') // extra roll for the same player
      expect(pub.turn.turnNumber).toBe(i + 1)
      expect(pub.positions['p1'][0]).toBe(5 + 6 * i)
    }

    // The 3rd six busts immediately on the ROLL action itself, sending home
    // the marble from lastMoved (moved on the 2nd six) -- no MOVE submitted.
    const r = applyWahooAction(wh, 'p1', { type: 'ROLL' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.sixStreak).toBe(0)
    expect(pub.die).toBeNull()
    expect(pub.positions['p1'][0]).toBe(-1) // busted back to base
    expect(pub.turn.phase).toBe('roll')
    expect(currentPlayer(pub.turn)).toBe('p2') // turn passes
    expect(pub.turn.turnNumber).toBe(4)
    expect(pub.lastEvent).toEqual({ kind: 'bust', by: 'p1', die: 6 })
  })

  it('a third six always busts, even with no legal move, and no lastMoved leaves positions unchanged', () => {
    // the marble at the entrance (rel 62) overshoots with a 6 (68 > 66); every
    // lane marble overshoots too, nothing is in base or the center — no legal
    // moves. sixStreak is pre-seeded at 2 with no lastMoved, so this third six
    // busts immediately with nothing to send home.
    const wh = buildWahoo({
      phase: 'roll',
      rngSeed: 4, // first roll is a 6
      sixStreak: 2,
      positions: { p1: [HOME_ENTRANCE_REL, LANE_START, LANE_START + 1, LANE_START + 2], p2: [-1, -1, -1, -1] },
    })
    const r = applyWahooAction(wh, 'p1', { type: 'ROLL' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.lastEvent).toEqual({ kind: 'bust', by: 'p1', die: 6 })
    expect(pub.die).toBeNull()
    expect(pub.sixStreak).toBe(0)
    expect(pub.turn.phase).toBe('roll')
    expect(currentPlayer(pub.turn)).toBe('p2')
    expect(pub.turn.turnNumber).toBe(2)
    expect(pub.positions['p1']).toEqual([HOME_ENTRANCE_REL, LANE_START, LANE_START + 1, LANE_START + 2])
  })

  it('a 6 with no legal move still grants an extra roll on the 1st/2nd six of a chain', () => {
    // p1 has no base marbles and every other marble overshoots on a 6 -- no
    // legal move at all. This is the 1st six of the chain (sixStreak starts
    // at 0), so it must grant an extra roll, not end the turn.
    const wh = buildWahoo({
      phase: 'roll',
      rngSeed: 4, // first roll is a 6
      positions: { p1: [HOME_ENTRANCE_REL, LANE_START, LANE_START + 1, LANE_START + 2], p2: [-1, -1, -1, -1] },
    })
    expect(legalMoves(wh.session.publicState, 'p1', 6)).toEqual([])
    const r = applyWahooAction(wh, 'p1', { type: 'ROLL' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.lastEvent).toEqual({ kind: 'pass', by: 'p1', die: 6 })
    expect(pub.die).toBeNull()
    expect(pub.sixStreak).toBe(1)
    expect(pub.turn.phase).toBe('roll')
    expect(currentPlayer(pub.turn)).toBe('p1') // same player, extra roll
    expect(pub.turn.turnNumber).toBe(2)
  })

  it('three consecutive moveless sixes still bust on the third, leaving positions unchanged', () => {
    // All marbles parked deep in the lane so nothing can ever move; three
    // consecutive ROLL calls each land a 6 (contrived by hand-seeding
    // sixStreak between rolls is not needed here -- we drive it via real
    // consecutive ROLLs against a seed whose first three rolls are all 6).
    let wh = buildWahoo({
      phase: 'roll',
      rngSeed: 749, // first three host rolls are all 6
      positions: { p1: [LANE_START, LANE_START + 1, LANE_START + 2, LANE_END], p2: [-1, -1, -1, -1] },
    })
    for (let i = 1; i <= 2; i++) {
      const r = applyWahooAction(wh, 'p1', { type: 'ROLL' })
      expect(r.outcome.ok).toBe(true)
      wh = r.wh
      const pub = wh.session.publicState
      expect(pub.lastEvent).toEqual({ kind: 'pass', by: 'p1', die: 6 })
      expect(pub.sixStreak).toBe(i)
      expect(currentPlayer(pub.turn)).toBe('p1')
    }
    const r = applyWahooAction(wh, 'p1', { type: 'ROLL' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.lastEvent).toEqual({ kind: 'bust', by: 'p1', die: 6 })
    expect(pub.sixStreak).toBe(0)
    expect(pub.positions['p1']).toEqual([LANE_START, LANE_START + 1, LANE_START + 2, LANE_END])
    expect(currentPlayer(pub.turn)).toBe('p2')
  })
})

describe('pass', () => {
  it('any roll with no legal move emits pass, advances the turn, and clears the die', () => {
    // all four marbles in the lane: no advance fits, nothing else applies
    const wh = buildWahoo({
      phase: 'roll',
      rngSeed: 0, // first roll is a 2
      positions: { p1: [LANE_START, LANE_START + 1, LANE_START + 2, LANE_END], p2: [-1, -1, -1, -1] },
    })
    const r = applyWahooAction(wh, 'p1', { type: 'ROLL' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.lastEvent).toEqual({ kind: 'pass', by: 'p1', die: 2 })
    expect(pub.die).toBeNull()
    expect(pub.turn.phase).toBe('roll')
    expect(currentPlayer(pub.turn)).toBe('p2')
    expect(pub.turn.turnNumber).toBe(2)
  })
})

describe('win', () => {
  it('ends the game when the fourth marble reaches the lane; further actions rejected', () => {
    const wh = buildWahoo({
      phase: 'move',
      die: 1,
      positions: { p1: [HOME_ENTRANCE_REL, LANE_START + 1, LANE_START + 2, LANE_END], p2: [-1, -1, -1, -1] },
    })
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.stage).toBe('over')
    expect(pub.winnerId).toBe('p1')
    expect(pub.positions['p1']).toEqual([LANE_START, LANE_START + 1, LANE_START + 2, LANE_END])
    expect(pub.lastEvent).toEqual({ kind: 'win', by: 'p1' })

    for (const playerId of ['p1', 'p2']) {
      const post = applyWahooAction(r.wh, playerId, { type: 'ROLL' })
      expect(post.outcome.ok).toBe(false)
      expect(post.outcome.reason).toContain('game over')
    }
  })

  it('the win fires before a would-be triple-six bust', () => {
    const wh = buildWahoo({
      phase: 'move',
      die: 6,
      sixStreak: 2,
      positions: { p1: [HOME_ENTRANCE_REL - 5, LANE_START + 1, LANE_START + 2, LANE_END], p2: [-1, -1, -1, -1] },
    })
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.stage).toBe('over')
    expect(pub.winnerId).toBe('p1')
    expect(pub.positions['p1'][0]).toBe(LANE_START) // NOT busted back to base
    expect(pub.lastEvent).toEqual({ kind: 'win', by: 'p1' })
  })
})

describe('full bot games', () => {
  const runGame = (wh: WahooSession): WahooSession => {
    let actions = 0
    while (wh.session.publicState.stage !== 'over') {
      const playerId = currentPlayer(wh.session.publicState.turn)
      const r = runWahooBotTurn(wh, playerId, wahooBotStrategy)
      expect(r.outcome.ok).toBe(true)
      wh = r.wh
      actions++
      expect(actions).toBeLessThanOrEqual(5000)
    }
    return wh
  }

  const expectWinner = (wh: WahooSession): void => {
    const pub = wh.session.publicState
    expect(pub.winnerId).not.toBeNull()
    expect(pub.positions[pub.winnerId!].every((p) => p >= 52)).toBe(true)
    expect(pub.stage).toBe('over')
  }

  it('2 seats terminate with a winner', () => {
    expectWinner(runGame(createWahooGame(['p1', 'p2'], 7)))
  })

  it('3 seats terminate with a winner', () => {
    expectWinner(runGame(createWahooGame(['p1', 'p2', 'p3'], 11)))
  })

  it('4 seats terminate with a winner', () => {
    expectWinner(runGame(createWahooGame(['p1', 'p2', 'p3', 'p4'], 23)))
  })
})

describe('serialization', () => {
  it('revision +1 per accepted action; every player snapshot is json-serializable', () => {
    const playerIds = ['p1', 'p2', 'p3']
    let wh = buildWahoo({
      playerIds,
      seatArms: { p1: 0, p2: 1, p3: 2 },
      phase: 'move',
      die: 1,
      positions: { p1: [-1, -1, -1, -1], p2: [-1, -1, -1, -1], p3: [-1, -1, -1, -1] },
    })
    expect(wh.session.revision).toBe(0)

    // rejected actions do not bump the revision (or consume the rng)
    const bad = applyWahooAction(wh, 'p1', { type: 'ROLL' })
    expect(bad.outcome.ok).toBe(false)
    expect(bad.wh.session.revision).toBe(0)

    // accepted: p1 brings a marble out
    let r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'out' } })
    expect(r.outcome.ok).toBe(true)
    wh = r.wh
    expect(wh.session.revision).toBe(1)

    // accepted: p2 rolls (seed 0 → die 2, all marbles in base → pass)
    r = applyWahooAction(wh, 'p2', { type: 'ROLL' })
    expect(r.outcome.ok).toBe(true)
    wh = r.wh
    expect(wh.session.revision).toBe(2)

    // accepted: p3 rolls; take the move if one exists
    r = applyWahooAction(wh, currentPlayer(wh.session.publicState.turn), { type: 'ROLL' })
    expect(r.outcome.ok).toBe(true)
    wh = r.wh
    expect(wh.session.revision).toBe(3)
    if (wh.session.publicState.turn.phase === 'move') {
      const pid = currentPlayer(wh.session.publicState.turn)
      const moves = legalMoves(wh.session.publicState, pid, wh.session.publicState.die!)
      r = applyWahooAction(wh, pid, { type: 'MOVE', move: moves[0] })
      expect(r.outcome.ok).toBe(true)
      wh = r.wh
      expect(wh.session.revision).toBe(4)
    }

    for (const playerId of playerIds) {
      const snapshot = deriveSnapshot(wh.session, playerId)
      expect(isJsonSerializable(snapshot)).toBe(true)
      expect(snapshot.privateState).toEqual({})
      expect(JSON.parse(JSON.stringify(snapshot.publicState))).toEqual(snapshot.publicState)
    }
  })
})
