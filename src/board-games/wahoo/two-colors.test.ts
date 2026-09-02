// Two-colors house-rule tests (spec 61): every test here targets the twoColors
// path of state.ts/rules.ts/bot.ts — defaults and defs, the rule-off regression
// identity, the defensive gate, two-color seating, the move union, own-color
// jump/bump/start-protection semantics, center interactions, the all-eight win
// check, the cross-color triple-six bust, the bot's self-bump avoidance, and
// JSON round-tripping. Fixtures are built the way wahoo.test.ts builds them:
// seeded createWahooGame for seating/defaults, direct state construction
// elsewhere.
import { describe, expect, it } from 'vitest'
import { createRng } from '../../engine/rng.ts'
import { createHostSession, isJsonSerializable } from '../../engine/sync.ts'
import { createTurnState, currentPlayer } from '../../engine/turn-engine.ts'
import {
  createWahooGame,
  legalMoves,
  resolveWahooHouseRules,
  WAHOO_HOUSE_RULE_DEFS,
  type MarblePos,
  type WahooEvent,
  type WahooMove,
  type WahooPrivateState,
  type WahooPublicState,
  type WahooSession,
} from './state.ts'
import { applyWahooAction } from './rules.ts'
import { wahooBotStrategy } from './bot.ts'
import { HOME_ENTRANCE_REL, LANE_END, LANE_START, SHORTCUT_ENTRIES, SHORTCUT_EXITS, trackIndexFor } from './board.ts'

// The fixed two-color seating used by the direct-state fixtures: p1 owns the
// 0/2 opposite pair, p2 the 1/3 pair, first set's setId === playerId.
const TWO_COLOR_SEATS = { p1: 0, 'p1:2': 2, p2: 1, 'p2:2': 3 }
const TWO_COLOR_OWNERS = { p1: 'p1', 'p1:2': 'p1', p2: 'p2', 'p2:2': 'p2' }

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
  // Two-color fixtures key the maps by four setIds; derive the defaults from
  // whatever set-keyed map the caller provides so no set is left without
  // positions/ownership entries.
  const setIds = Object.keys(config.seatArms ?? config.setOwners ?? {})
  const keys = setIds.length > 0 ? setIds : playerIds
  const defaults: Record<string, MarblePos[]> = {}
  const defaultOwners: Record<string, string> = {}
  for (const s of keys) {
    defaults[s] = [-1, -1, -1, -1]
    defaultOwners[s] = s
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

describe('house-rule defaults and defs', () => {
  it('twoColors defaults to false; WAHOO_HOUSE_RULE_DEFS is the single expected entry', () => {
    expect(resolveWahooHouseRules()).toEqual({ twoColors: false })
    expect(resolveWahooHouseRules({})).toEqual({ twoColors: false })
    expect(resolveWahooHouseRules({ twoColors: true })).toEqual({ twoColors: true })
    expect(WAHOO_HOUSE_RULE_DEFS).toEqual([
      {
        key: 'twoColors',
        label: 'Two colors each',
        description: expect.stringContaining('Two players only'),
        default: false,
      },
    ])
    // createWahooGame stores the resolved defaults on the public state
    expect(createWahooGame(['p1', 'p2'], 1).session.publicState.houseRules).toEqual({ twoColors: false })
  })
})

describe('regression: rule off', () => {
  it('2/3/4-player games keep setId === playerId, identity setOwners, and 2-player opposite-pair seating', () => {
    for (const playerIds of [['p1', 'p2'], ['p1', 'p2', 'p3'], ['p1', 'p2', 'p3', 'p4']] as const) {
      for (let seed = 0; seed < 10; seed++) {
        const pub = createWahooGame([...playerIds], seed).session.publicState
        expect(pub.houseRules.twoColors).toBe(false)
        expect(Object.keys(pub.seatArms).sort()).toEqual([...playerIds].sort())
        expect(Object.keys(pub.positions).sort()).toEqual([...playerIds].sort())
        expect(pub.setOwners).toEqual(Object.fromEntries([...playerIds].map((p) => [p, p] as [string, string])))
        for (const p of playerIds) {
          expect(pub.positions[p]).toEqual([-1, -1, -1, -1])
        }
      }
    }
    // 2-player seating behavior is unchanged: one opposite arm pair
    for (let seed = 0; seed < 20; seed++) {
      const pub = createWahooGame(['p1', 'p2'], seed).session.publicState
      expect(Math.abs(pub.seatArms['p1'] - pub.seatArms['p2'])).toBe(2)
      expect(pub.mutedArm).toBeNull()
    }
  })
})

describe('defensive gate', () => {
  it('twoColors is forced off for 3- and 4-player games even when requested', () => {
    for (let seed = 0; seed < 10; seed++) {
      const pub3 = createWahooGame(['p1', 'p2', 'p3'], seed, { twoColors: true }).session.publicState
      expect(pub3.houseRules).toEqual({ twoColors: false })
      expect(Object.keys(pub3.positions).sort()).toEqual(['p1', 'p2', 'p3'])
      expect(pub3.setOwners).toEqual({ p1: 'p1', p2: 'p2', p3: 'p3' })
      expect(pub3.mutedArm).not.toBeNull()

      const pub4 = createWahooGame(['p1', 'p2', 'p3', 'p4'], seed, { twoColors: true }).session.publicState
      expect(pub4.houseRules).toEqual({ twoColors: false })
      expect(Object.keys(pub4.positions).sort()).toEqual(['p1', 'p2', 'p3', 'p4'])
      expect(pub4.setOwners).toEqual({ p1: 'p1', p2: 'p2', p3: 'p3', p4: 'p4' })
      expect(pub4.mutedArm).toBeNull()
    }
  })
})

describe('two-color seating', () => {
  it('four sets, two per player, opposite arm pairs, all four arms covered, mutedArm null', () => {
    for (let seed = 0; seed < 20; seed++) {
      const pub = createWahooGame(['p1', 'p2'], seed, { twoColors: true }).session.publicState
      expect(pub.houseRules).toEqual({ twoColors: true })
      expect(pub.turn.playerOrder).toEqual(['p1', 'p2'])
      expect(Object.keys(pub.positions).sort()).toEqual(['p1', 'p1:2', 'p2', 'p2:2'])
      expect(Object.keys(pub.seatArms).sort()).toEqual(['p1', 'p1:2', 'p2', 'p2:2'])
      expect(pub.setOwners).toEqual({ p1: 'p1', 'p1:2': 'p1', p2: 'p2', 'p2:2': 'p2' })
      expect(pub.mutedArm).toBeNull()
      const p1Arms = [pub.seatArms['p1'], pub.seatArms['p1:2']]
      const p2Arms = [pub.seatArms['p2'], pub.seatArms['p2:2']]
      // each player's two arms are one opposite pair (0/2 or 1/3)
      expect(Math.abs(p1Arms[0] - p1Arms[1])).toBe(2)
      expect(Math.abs(p2Arms[0] - p2Arms[1])).toBe(2)
      expect(new Set([...p1Arms, ...p2Arms]).size).toBe(4) // all four arms in play
      for (const setId of Object.keys(pub.positions)) {
        expect(pub.positions[setId]).toEqual([-1, -1, -1, -1])
      }
    }
    expect(createWahooGame(['p1', 'p2'], 7, { twoColors: true }).session.publicState).toEqual(
      createWahooGame(['p1', 'p2'], 7, { twoColors: true }).session.publicState,
    )
  })
})

describe('move union', () => {
  it('ROLL then legalMoves returns moves tagged with both of the actor’s setIds', () => {
    const wh = buildWahoo({
      phase: 'roll',
      rngSeed: 0, // first roll is a 2
      seatArms: TWO_COLOR_SEATS,
      setOwners: TWO_COLOR_OWNERS,
      positions: {
        p1: [5, -1, -1, -1],
        'p1:2': [5, -1, -1, -1],
        p2: [-1, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
    })
    const r = applyWahooAction(wh, 'p1', { type: 'ROLL' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.die).toBe(2)
    const moves = legalMoves(pub, 'p1', pub.die!)
    expect(moves.some((m) => m.setId === 'p1')).toBe(true)
    expect(moves.some((m) => m.setId === 'p1:2')).toBe(true)
    expect(moves.every((m) => m.setId === 'p1' || m.setId === 'p1:2')).toBe(true)
  })

  it('rejects a MOVE whose setId is not owned by the actor, or is missing/garbage — without throwing', () => {
    const wh = buildWahoo({
      phase: 'move',
      die: 3,
      seatArms: TWO_COLOR_SEATS,
      setOwners: TWO_COLOR_OWNERS,
      positions: {
        p1: [5, -1, -1, -1],
        'p1:2': [5, -1, -1, -1],
        p2: [-1, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
    })
    // p2 is a real set in the game but is not owned by the actor
    const foreign = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p2', marbleIdx: 0, kind: 'advance' } })
    expect(foreign.outcome.ok).toBe(false)
    expect(foreign.outcome.reason).toContain('not a legal move')
    // missing setId — malformed payload must be rejected, not crash the validator
    const missing = applyWahooAction(wh, 'p1', {
      type: 'MOVE',
      move: { marbleIdx: 0, kind: 'advance' } as unknown as WahooMove,
    })
    expect(missing.outcome.ok).toBe(false)
    expect(missing.outcome.reason).toContain('not a legal move')
    // garbage setId
    const garbage = applyWahooAction(wh, 'p1', {
      type: 'MOVE',
      move: { setId: 'not-a-set', marbleIdx: 0, kind: 'advance' },
    })
    expect(garbage.outcome.ok).toBe(false)
    expect(garbage.outcome.reason).toContain('not a legal move')
  })
})

describe('jumping over your own other color', () => {
  it('an advance crossing the other color’s marble is legal; crossing a same-set marble is not', () => {
    // p1 (arm 0) at rel 30 → abs 39; die 6 lands rel 36 → abs 45. The other
    // color (arm 2) at rel 2 → abs 43 sits strictly between, so the path
    // crosses it — opponents (own other color included) are passable.
    expect(trackIndexFor(0, 30)).toBe(39)
    expect(trackIndexFor(2, 2)).toBe(43)
    expect(trackIndexFor(0, 36)).toBe(45)
    const wh = buildWahoo({
      phase: 'move',
      die: 6,
      seatArms: TWO_COLOR_SEATS,
      setOwners: TWO_COLOR_OWNERS,
      positions: {
        p1: [30, -1, -1, -1],
        'p1:2': [2, -1, -1, -1],
        p2: [-1, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
    })
    expect(legalMoves(wh.session.publicState, 'p1', 6)).toContainEqual({
      setId: 'p1',
      marbleIdx: 0,
      kind: 'advance',
    })
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.positions['p1']).toEqual([36, -1, -1, -1])
    expect(pub.positions['p1:2']).toEqual([2, -1, -1, -1]) // passed over, untouched
    expect(pub.lastEvent).toEqual({ kind: 'move', by: 'p1', marbleIdx: 0, bumpedId: null })

    // The same path crossing a SAME-set marble (rel 34 sits inside (30, 36])
    // is still illegal.
    const same = buildWahoo({
      phase: 'move',
      die: 6,
      seatArms: TWO_COLOR_SEATS,
      setOwners: TWO_COLOR_OWNERS,
      positions: {
        p1: [30, 34, -1, -1],
        'p1:2': [-1, -1, -1, -1],
        p2: [-1, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
    })
    expect(
      legalMoves(same.session.publicState, 'p1', 6).some(
        (m) => m.setId === 'p1' && m.marbleIdx === 0 && m.kind === 'advance',
      ),
    ).toBe(false)
    const bad = applyWahooAction(same, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
    expect(bad.outcome.ok).toBe(false)
  })
})

describe('bumping your own other color', () => {
  it('landing exactly on the other color’s marble sends it to base, bumpedId = that setId', () => {
    // p1 (arm 0) at rel 30 → abs 39; die 6 lands rel 36 → abs 45, exactly
    // where the other color (arm 2, rel 4 → abs 45) sits.
    expect(trackIndexFor(2, 4)).toBe(45)
    const wh = buildWahoo({
      phase: 'move',
      die: 6,
      seatArms: TWO_COLOR_SEATS,
      setOwners: TWO_COLOR_OWNERS,
      positions: {
        p1: [30, -1, -1, -1],
        'p1:2': [4, -1, -1, -1],
        p2: [-1, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
    })
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.positions['p1']).toEqual([36, -1, -1, -1])
    expect(pub.positions['p1:2']).toEqual([-1, -1, -1, -1]) // bumped home
    expect(pub.lastEvent).toEqual({ kind: 'move', by: 'p1', marbleIdx: 0, bumpedId: 'p1:2' })
    expect(pub.setOwners['p1:2']).toBe('p1') // the victim belongs to the actor
  })
})

describe('forced own-bump', () => {
  it('when the union contains only the self-bump, it is returned (no pass) and applied', () => {
    // p1 (arm 0) marble 0 at rel 24, die 6 → rel 30 → abs 39, exactly where
    // p1:2 (arm 2) marble 0 sits at rel 62 → abs 39. Every other marble of
    // both sets overshoots on a 6, so the union is exactly this one move.
    expect(trackIndexFor(2, 62)).toBe(39)
    const wh = buildWahoo({
      phase: 'move',
      die: 6,
      seatArms: TWO_COLOR_SEATS,
      setOwners: TWO_COLOR_OWNERS,
      positions: {
        p1: [24, LANE_START, LANE_START + 1, LANE_START + 2],
        'p1:2': [62, LANE_START, LANE_START + 1, LANE_START + 2],
        p2: [-1, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
    })
    expect(legalMoves(wh.session.publicState, 'p1', 6)).toEqual([{ setId: 'p1', marbleIdx: 0, kind: 'advance' }])
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.positions['p1']).toEqual([30, LANE_START, LANE_START + 1, LANE_START + 2])
    expect(pub.positions['p1:2'][0]).toBe(-1) // the bump went through
    expect(pub.lastEvent).toEqual({ kind: 'move', by: 'p1', marbleIdx: 0, bumpedId: 'p1:2' })
  })
})

describe('start protection between your own colors', () => {
  it('a set-A marble cannot land on the other color sitting on ITS OWN come-out hole', () => {
    // p1:2 (arm 2) sits at its own come-out (rel 0 → abs 41). p1 (arm 0) at
    // rel 30 with die 2 would land rel 32 → abs 41 too.
    expect(trackIndexFor(2, 0)).toBe(41)
    expect(trackIndexFor(0, 32)).toBe(41)
    const wh = buildWahoo({
      phase: 'move',
      die: 2,
      seatArms: TWO_COLOR_SEATS,
      setOwners: TWO_COLOR_OWNERS,
      positions: {
        p1: [30, -1, -1, -1],
        'p1:2': [0, -1, -1, -1],
        p2: [-1, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
    })
    expect(
      legalMoves(wh.session.publicState, 'p1', 2).some(
        (m) => m.setId === 'p1' && m.marbleIdx === 0 && m.kind === 'advance',
      ),
    ).toBe(false)
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
    expect(r.outcome.ok).toBe(false)
  })

  it('coming OUT bumps the other color sitting on the acting set’s come-out hole (not its own start)', () => {
    // p1:2 (arm 2) at rel 32 sits on absolute 9 — p1's come-out hole — but rel
    // 32 is not ITS OWN start, so coming out bumps it.
    expect(trackIndexFor(2, 32)).toBe(9)
    const wh = buildWahoo({
      phase: 'move',
      die: 6,
      seatArms: TWO_COLOR_SEATS,
      setOwners: TWO_COLOR_OWNERS,
      positions: {
        p1: [-1, -1, -1, -1],
        'p1:2': [32, -1, -1, -1],
        p2: [-1, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
    })
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'out' } })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.positions['p1']).toEqual([0, -1, -1, -1])
    expect(pub.positions['p1:2']).toEqual([-1, -1, -1, -1])
    expect(pub.lastEvent).toEqual({ kind: 'out', by: 'p1', bumpedId: 'p1:2' })
  })
})

describe('center under two colors', () => {
  it('set A shortcuts into the center while set B holds it, sending set B home', () => {
    // p1 (arm 0) at rel 5, die 2 → the corner jump into the center; p1:2
    // (arm 2) is the center's current occupant and gets bumped home.
    const wh = buildWahoo({
      phase: 'move',
      die: 2,
      seatArms: TWO_COLOR_SEATS,
      setOwners: TWO_COLOR_OWNERS,
      positions: {
        p1: [5, -1, -1, -1],
        'p1:2': [-2, -1, -1, -1],
        p2: [-1, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
      centerBy: { setId: 'p1:2', marbleIdx: 0, entryCornerRel: SHORTCUT_ENTRIES[1] },
    })
    expect(legalMoves(wh.session.publicState, 'p1', 2)).toContainEqual({
      setId: 'p1',
      marbleIdx: 0,
      kind: 'shortcut',
    })
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'shortcut' } })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.positions['p1']).toEqual([-2, -1, -1, -1])
    expect(pub.positions['p1:2']).toEqual([-1, -1, -1, -1]) // bumped home out of the center
    expect(pub.centerBy).toEqual({ setId: 'p1', marbleIdx: 0, entryCornerRel: SHORTCUT_ENTRIES[0] })
    expect(pub.lastEvent).toEqual({ kind: 'shortcut', by: 'p1', bumpedId: 'p1:2' })
  })

  it('a SAME-set marble in the center still blocks that set’s shortcut', () => {
    const wh = buildWahoo({
      phase: 'move',
      die: 2,
      seatArms: TWO_COLOR_SEATS,
      setOwners: TWO_COLOR_OWNERS,
      positions: {
        p1: [5, -2, -1, -1],
        'p1:2': [-1, -1, -1, -1],
        p2: [-1, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
      centerBy: { setId: 'p1', marbleIdx: 1, entryCornerRel: SHORTCUT_ENTRIES[0] },
    })
    expect(legalMoves(wh.session.publicState, 'p1', 2).some((m) => m.kind === 'shortcut')).toBe(false)
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'shortcut' } })
    expect(r.outcome.ok).toBe(false)
  })

  it('exit is offered only for the set in the center and bumps via that set’s relative coordinates', () => {
    // p1:2 (arm 2) holds the center via entry 6; exiting lands rel 38 → abs
    // 15, exactly where p1 (arm 0, rel 6 → abs 15) sits — the bump resolves
    // through p1:2's own coordinates.
    expect(trackIndexFor(2, 38)).toBe(15)
    expect(trackIndexFor(0, 6)).toBe(15)
    const wh = buildWahoo({
      phase: 'move',
      die: 1,
      seatArms: TWO_COLOR_SEATS,
      setOwners: TWO_COLOR_OWNERS,
      positions: {
        p1: [6, -1, -1, -1],
        'p1:2': [-2, -1, -1, -1],
        p2: [-1, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
      centerBy: { setId: 'p1:2', marbleIdx: 0, entryCornerRel: SHORTCUT_ENTRIES[0] },
    })
    const moves = legalMoves(wh.session.publicState, 'p1', 1)
    expect(moves.some((m) => m.kind === 'exit' && m.setId === 'p1')).toBe(false) // not the set in the center
    expect(moves).toContainEqual({ setId: 'p1:2', marbleIdx: 0, kind: 'exit' })
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1:2', marbleIdx: 0, kind: 'exit' } })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.positions['p1:2']).toEqual([SHORTCUT_EXITS[SHORTCUT_ENTRIES[0]], -1, -1, -1])
    expect(pub.positions['p1']).toEqual([-1, -1, -1, -1]) // bumped via p1:2's exit coordinates
    expect(pub.centerBy).toBeNull()
    expect(pub.lastEvent).toEqual({ kind: 'exit', by: 'p1', bumpedId: 'p1' })
  })
})

describe('win requires all eight', () => {
  it('completing all four of one color does not end the game while the other color is unfinished', () => {
    const wh = buildWahoo({
      phase: 'move',
      die: 1,
      seatArms: TWO_COLOR_SEATS,
      setOwners: TWO_COLOR_OWNERS,
      positions: {
        p1: [HOME_ENTRANCE_REL, LANE_END, LANE_END - 1, LANE_END - 2],
        'p1:2': [LANE_START, -1, -1, -1],
        p2: [-1, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
    })
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1', marbleIdx: 0, kind: 'advance' } })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.positions['p1']).toEqual([LANE_START, LANE_END, LANE_END - 1, LANE_END - 2]) // one color complete
    expect(pub.positions['p1:2']).toEqual([LANE_START, -1, -1, -1]) // other color unfinished
    expect(pub.stage).toBe('play')
    expect(pub.winnerId).toBeNull()
    expect(pub.lastEvent).toEqual({ kind: 'move', by: 'p1', marbleIdx: 0, bumpedId: null })
    expect(currentPlayer(pub.turn)).toBe('p2') // the turn just passes on
  })

  it('the move completing the eighth marble ends the game with the controlling playerId', () => {
    const wh = buildWahoo({
      phase: 'move',
      die: 1,
      seatArms: TWO_COLOR_SEATS,
      setOwners: TWO_COLOR_OWNERS,
      positions: {
        p1: [LANE_START, LANE_END, LANE_END - 1, LANE_END - 2],
        'p1:2': [HOME_ENTRANCE_REL, LANE_END, LANE_END - 1, LANE_END - 2],
        p2: [-1, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
    })
    const r = applyWahooAction(wh, 'p1', { type: 'MOVE', move: { setId: 'p1:2', marbleIdx: 0, kind: 'advance' } })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.positions['p1:2'][0]).toBe(LANE_START)
    expect(pub.stage).toBe('over')
    expect(pub.winnerId).toBe('p1')
    expect(pub.lastEvent).toEqual({ kind: 'win', by: 'p1' })
  })
})

describe('triple-six bust across colors', () => {
  it('busts the actor’s second-set marble home when it was the last moved', () => {
    const wh = buildWahoo({
      phase: 'roll',
      rngSeed: 4, // first roll is a 6
      sixStreak: 2,
      seatArms: TWO_COLOR_SEATS,
      setOwners: TWO_COLOR_OWNERS,
      positions: {
        p1: [-1, -1, -1, -1],
        'p1:2': [5, 10, -1, -1],
        p2: [-1, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
      lastMoved: { playerId: 'p1', setId: 'p1:2', marbleIdx: 1 },
    })
    const r = applyWahooAction(wh, 'p1', { type: 'ROLL' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.positions['p1:2']).toEqual([5, -1, -1, -1]) // the second-set marble busts home
    expect(pub.positions['p1']).toEqual([-1, -1, -1, -1])
    expect(pub.lastEvent).toEqual({ kind: 'bust', by: 'p1', die: 6 })
    expect(pub.sixStreak).toBe(0)
    expect(pub.die).toBeNull()
    expect(currentPlayer(pub.turn)).toBe('p2')
  })

  it('clears centerBy when the busted marble is the one holding the center', () => {
    const wh = buildWahoo({
      phase: 'roll',
      rngSeed: 4, // first roll is a 6
      sixStreak: 2,
      seatArms: TWO_COLOR_SEATS,
      setOwners: TWO_COLOR_OWNERS,
      positions: {
        p1: [-1, -1, -1, -1],
        'p1:2': [-2, 10, -1, -1],
        p2: [-1, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
      centerBy: { setId: 'p1:2', marbleIdx: 0, entryCornerRel: SHORTCUT_ENTRIES[0] },
      lastMoved: { playerId: 'p1', setId: 'p1:2', marbleIdx: 0 },
    })
    const r = applyWahooAction(wh, 'p1', { type: 'ROLL' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.wh.session.publicState
    expect(pub.positions['p1:2']).toEqual([-1, 10, -1, -1]) // the center marble busts home
    expect(pub.centerBy).toBeNull()
    expect(pub.lastEvent).toEqual({ kind: 'bust', by: 'p1', die: 6 })
  })
})

describe('bot under two colors', () => {
  it('prefers a plain advance over a self-bump', () => {
    // die 6: p1 (arm 0) marble 0 advancing 30→36 lands on p1:2's marble at
    // abs 45 (a self-bump); p1:2 marble 0 advancing 4→10 bumps nobody. The
    // bot must take the plain advance.
    const pub = buildWahoo({
      phase: 'move',
      die: 6,
      seatArms: TWO_COLOR_SEATS,
      setOwners: TWO_COLOR_OWNERS,
      positions: {
        p1: [30, LANE_START, LANE_START + 1, LANE_START + 2],
        'p1:2': [4, LANE_START, LANE_START + 1, LANE_START + 2],
        p2: [-1, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
    }).session.publicState
    expect(wahooBotStrategy(pub, {}, 'p1')).toEqual({
      type: 'MOVE',
      move: { setId: 'p1:2', marbleIdx: 0, kind: 'advance' },
    })
  })

  it('takes the forced self-bump when it is the only move', () => {
    const pub = buildWahoo({
      phase: 'move',
      die: 6,
      seatArms: TWO_COLOR_SEATS,
      setOwners: TWO_COLOR_OWNERS,
      positions: {
        p1: [24, LANE_START, LANE_START + 1, LANE_START + 2],
        'p1:2': [62, LANE_START, LANE_START + 1, LANE_START + 2],
        p2: [-1, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
    }).session.publicState
    expect(wahooBotStrategy(pub, {}, 'p1')).toEqual({
      type: 'MOVE',
      move: { setId: 'p1', marbleIdx: 0, kind: 'advance' },
    })
  })

  it('bumps an opponent rather than its own other color', () => {
    // die 6: p1 marble 0 advancing 30→36 self-bumps p1:2 (abs 45); p1 marble
    // 1 advancing 40→46 bumps p2 (arm 1, rel 30 → abs 55). Both are legal —
    // the bot takes the opponent bump.
    const pub = buildWahoo({
      phase: 'move',
      die: 6,
      seatArms: TWO_COLOR_SEATS,
      setOwners: TWO_COLOR_OWNERS,
      positions: {
        p1: [30, 40, LANE_START, LANE_START + 1],
        'p1:2': [4, LANE_START, LANE_START + 1, LANE_START + 2],
        p2: [30, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
    }).session.publicState
    expect(wahooBotStrategy(pub, {}, 'p1')).toEqual({
      type: 'MOVE',
      move: { setId: 'p1', marbleIdx: 1, kind: 'advance' },
    })
  })

  it('winsNow fires only on the true eighth-marble completion, not on finishing one color', () => {
    // Finishing one color (p1 marble 0 → 63) is NOT a win: the bot skips it
    // and takes the available opponent bump (p1:2 marble 0 20→21 lands on p2
    // at abs 62) instead.
    expect(trackIndexFor(2, 21)).toBe(62)
    expect(trackIndexFor(1, 37)).toBe(62)
    const notYet = buildWahoo({
      phase: 'move',
      die: 1,
      seatArms: TWO_COLOR_SEATS,
      setOwners: TWO_COLOR_OWNERS,
      positions: {
        p1: [HOME_ENTRANCE_REL, LANE_END, LANE_END - 1, LANE_END - 2],
        'p1:2': [20, -1, -1, -1],
        p2: [37, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
    })
    const action = wahooBotStrategy(notYet.session.publicState, {}, 'p1')
    expect(action).toEqual({ type: 'MOVE', move: { setId: 'p1:2', marbleIdx: 0, kind: 'advance' } })
    const r = applyWahooAction(notYet, 'p1', action)
    expect(r.outcome.ok).toBe(true)
    expect(r.wh.session.publicState.stage).toBe('play') // one color complete, game continues
    expect(r.wh.session.publicState.winnerId).toBeNull()

    // The eighth marble: p1's set is complete, p1:2's last marble enters the
    // lane → winsNow fires and the bot takes the finishing advance.
    const eighth = buildWahoo({
      phase: 'move',
      die: 1,
      seatArms: TWO_COLOR_SEATS,
      setOwners: TWO_COLOR_OWNERS,
      positions: {
        p1: [LANE_START, LANE_END, LANE_END - 1, LANE_END - 2],
        'p1:2': [HOME_ENTRANCE_REL, LANE_END, LANE_END - 1, LANE_END - 2],
        p2: [-1, -1, -1, -1],
        'p2:2': [-1, -1, -1, -1],
      },
    })
    const action2 = wahooBotStrategy(eighth.session.publicState, {}, 'p1')
    expect(action2).toEqual({ type: 'MOVE', move: { setId: 'p1:2', marbleIdx: 0, kind: 'advance' } })
    const r2 = applyWahooAction(eighth, 'p1', action2)
    expect(r2.outcome.ok).toBe(true)
    expect(r2.wh.session.publicState.stage).toBe('over')
    expect(r2.wh.session.publicState.winnerId).toBe('p1')
  })
})

describe('serialization', () => {
  it('a mid-game two-color state round-trips losslessly through JSON', () => {
    const wh = buildWahoo({
      phase: 'roll',
      seatArms: TWO_COLOR_SEATS,
      setOwners: TWO_COLOR_OWNERS,
      positions: {
        p1: [5, 30, LANE_START, LANE_START + 1],
        'p1:2': [-2, -1, HOME_ENTRANCE_REL, LANE_END],
        p2: [10, -1, -1, -1],
        'p2:2': [0, 32, -1, -1],
      },
      centerBy: { setId: 'p1:2', marbleIdx: 0, entryCornerRel: SHORTCUT_ENTRIES[1] },
      lastMoved: { playerId: 'p1', setId: 'p1', marbleIdx: 1 },
      lastEvent: { kind: 'move', by: 'p1', marbleIdx: 1, bumpedId: null },
      sixStreak: 1,
      houseRules: { twoColors: true },
    })
    const pub = wh.session.publicState
    expect(isJsonSerializable(pub)).toBe(true)
    expect(JSON.parse(JSON.stringify(pub))).toEqual(pub)
  })
})
