import { describe, expect, it } from 'vitest'
import {
  createDominoSet,
  createDominoesGame,
  dealRound,
  endValue,
  legalArms,
  handHasLegalPlay,
  type DominoArm,
  type DominoesPrivateState,
  type DominoesPublicState,
  type DominoesRoundResult,
  type DominoesSession,
  type DominoTile,
  type LastDominoAction,
  type PlacedTile,
} from './state.ts'
import { boardTotal, scoreForTotal, pipSum, roundDownToFive } from './scoring.ts'
import { applyDominoesAction, runDominoesBotTurn } from './rules.ts'
import { dominoesBotStrategy } from './bot.ts'
import { createHostSession, deriveSnapshot, isJsonSerializable } from '../../engine/sync.ts'
import { createTurnState, currentPlayer } from '../../engine/turn-engine.ts'
import { createRng } from '../../engine/rng.ts'
import { addCards, cardCount, createHand, createPublicZone } from '../../card-engine/zones.ts'

const emptyArms = (): Record<DominoArm, PlacedTile[]> => ({ right: [], left: [], up: [], down: [] })

function tile(a: number, b: number): DominoTile {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return { id: `${lo}-${hi}`, a: lo, b: hi }
}

function tiles(pairs: [number, number][]): DominoTile[] {
  return pairs.map(([a, b]) => tile(a, b))
}

function placed(inner: number, outer: number, isDouble = false): PlacedTile {
  return { inner, outer, isDouble }
}

// Hand-built session with a known board, hands, and boneyard (battleship-test style).
function buildGame(config: {
  stage?: DominoesPublicState['stage']
  currentIndex?: number
  center?: { a: number; b: number } | null
  isSpinner?: boolean
  arms?: Partial<Record<DominoArm, PlacedTile[]>>
  p1Hand?: DominoTile[]
  p2Hand?: DominoTile[]
  boneyard?: DominoTile[]
  scores?: Record<string, number>
  passStreak?: number
  roundNumber?: number
  roundStarterId?: string
  roundResult?: DominoesRoundResult | null
  lastAction?: LastDominoAction | null
  matchWinnerId?: string | null
} = {}): DominoesSession {
  const playerOrder: [string, string] = ['p1', 'p2']
  const turn = createTurnState<'play'>(playerOrder, 'play')
  if (config.currentIndex != null) {
    ;(turn as { currentIndex: number }).currentIndex = config.currentIndex
  }
  const p1Hand = addCards(createHand<DominoTile>('p1'), config.p1Hand ?? tiles([[5, 5], [1, 1], [2, 2], [3, 3], [4, 4], [0, 0], [1, 2]]))
  const p2Hand = addCards(createHand<DominoTile>('p2'), config.p2Hand ?? tiles([[5, 1], [6, 6], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]]))
  const boneyard = addCards(createPublicZone<DominoTile>('boneyard', 'private'), config.boneyard ?? [])
  const publicState: DominoesPublicState = {
    stage: config.stage ?? 'play',
    seatOrder: ['p1', 'p2'],
    turn,
    center: config.center ?? null,
    isSpinner: config.isSpinner ?? false,
    arms: { ...emptyArms(), ...config.arms },
    boneyardCount: boneyard.cards.length,
    handCounts: { p1: p1Hand.cards.length, p2: p2Hand.cards.length },
    passStreak: config.passStreak ?? 0,
    scores: config.scores ?? { p1: 0, p2: 0 },
    target: 150,
    roundNumber: config.roundNumber ?? 1,
    roundStarterId: config.roundStarterId ?? 'p1',
    roundResult: config.roundResult ?? null,
    lastAction: config.lastAction ?? null,
    matchWinnerId: config.matchWinnerId ?? null,
  }
  const privateStates: Record<string, DominoesPrivateState> = {
    p1: { hand: p1Hand },
    p2: { hand: p2Hand },
  }
  return { session: createHostSession(publicState, privateStates), boneyard, rng: createRng(0) }
}

describe('createDominoSet', () => {
  it('produces all 28 unique double-six tiles in deterministic order', () => {
    const set = createDominoSet()
    expect(set).toHaveLength(28)
    expect(new Set(set.map((t) => t.id)).size).toBe(28)
    expect(set.every((t) => t.a <= t.b && t.a >= 0 && t.b <= 6)).toBe(true)
    expect(set[0]).toEqual(tile(0, 0))
    expect(set[6]).toEqual(tile(0, 6))
    expect(set[7]).toEqual(tile(1, 1))
    expect(set[27]).toEqual(tile(6, 6))
    const seen = new Set(set.map((t) => t.id))
    for (let a = 0; a <= 6; a++) {
      for (let b = a; b <= 6; b++) {
        expect(seen.has(`${a}-${b}`)).toBe(true)
      }
    }
  })
})

describe('deal', () => {
  it('deals 7/7 and leaves 14 in the boneyard, disjoint and deterministic per seed', () => {
    const dm = createDominoesGame(['p1', 'p2'], 42)
    const p1 = dm.session.privateStates.p1.hand.cards
    const p2 = dm.session.privateStates.p2.hand.cards
    const yard = dm.boneyard.cards
    expect(p1).toHaveLength(7)
    expect(p2).toHaveLength(7)
    expect(yard).toHaveLength(14)
    expect(dm.session.publicState.boneyardCount).toBe(14)
    const all = new Set([...p1, ...p2, ...yard].map((t) => t.id))
    expect(all.size).toBe(28)

    const dm2 = createDominoesGame(['p1', 'p2'], 42)
    expect(dm2.session.privateStates.p1.hand.cards.map((t) => t.id)).toEqual(p1.map((t) => t.id))
    expect(dm2.boneyard.cards.map((t) => t.id)).toEqual(yard.map((t) => t.id))

    const dm3 = createDominoesGame(['p1', 'p2'], 43)
    expect(dm3.session.privateStates.p1.hand.cards.map((t) => t.id)).not.toEqual(p1.map((t) => t.id))
  })

  it('dealRound is the shared deal logic', () => {
    const { hands, boneyard } = dealRound(['p1', 'p2'], createRng(42))
    expect(hands.p1.cards).toHaveLength(7)
    expect(hands.p2.cards).toHaveLength(7)
    expect(boneyard.cards).toHaveLength(14)
  })

  it('3-player deal: 5 tiles each (15 total dealt), 13 in boneyard', () => {
    const dm = createDominoesGame(['p1', 'p2', 'p3'], 42)
    const p1 = dm.session.privateStates.p1.hand.cards
    const p2 = dm.session.privateStates.p2.hand.cards
    const p3 = dm.session.privateStates.p3.hand.cards
    const yard = dm.boneyard.cards
    expect(p1).toHaveLength(5)
    expect(p2).toHaveLength(5)
    expect(p3).toHaveLength(5)
    expect(yard).toHaveLength(13)
    expect(dm.session.publicState.boneyardCount).toBe(13)
    const all = new Set([...p1, ...p2, ...p3, ...yard].map((t) => t.id))
    expect(all.size).toBe(28)
  })

  it('4-player deal: 5 tiles each (20 total dealt), 8 in boneyard', () => {
    const dm = createDominoesGame(['p1', 'p2', 'p3', 'p4'], 42)
    const p1 = dm.session.privateStates.p1.hand.cards
    const p2 = dm.session.privateStates.p2.hand.cards
    const p3 = dm.session.privateStates.p3.hand.cards
    const p4 = dm.session.privateStates.p4.hand.cards
    const yard = dm.boneyard.cards
    expect(p1).toHaveLength(5)
    expect(p2).toHaveLength(5)
    expect(p3).toHaveLength(5)
    expect(p4).toHaveLength(5)
    expect(yard).toHaveLength(8)
    expect(dm.session.publicState.boneyardCount).toBe(8)
    const all = new Set([...p1, ...p2, ...p3, ...p4, ...yard].map((t) => t.id))
    expect(all.size).toBe(28)
  })

  it('dealRound for 3 players returns hands with correct keys and sizes', () => {
    const { hands, boneyard } = dealRound(['p1', 'p2', 'p3'], createRng(42))
    expect(hands.p1.cards).toHaveLength(5)
    expect(hands.p2.cards).toHaveLength(5)
    expect(hands.p3.cards).toHaveLength(5)
    expect(boneyard.cards).toHaveLength(13)
  })

  it('dealRound for 4 players returns hands with correct keys and sizes', () => {
    const { hands, boneyard } = dealRound(['p1', 'p2', 'p3', 'p4'], createRng(42))
    expect(hands.p1.cards).toHaveLength(5)
    expect(hands.p2.cards).toHaveLength(5)
    expect(hands.p3.cards).toHaveLength(5)
    expect(hands.p4.cards).toHaveLength(5)
    expect(boneyard.cards).toHaveLength(8)
  })
})

describe('endValue and legalArms', () => {
  it('endValue exposes center halves on a non-spinner and last outer on a played arm', () => {
    const center = { a: 4, b: 6 }
    const arms = { ...emptyArms(), right: [placed(6, 2)] }
    expect(endValue(center, false, arms, 'left')).toBe(4)
    expect(endValue(center, false, arms, 'right')).toBe(2)
    expect(endValue(center, false, arms, 'up')).toBeNull()
    expect(endValue(center, false, arms, 'down')).toBeNull()
    expect(endValue(null, false, arms, 'left')).toBeNull()
  })

  it('endValue exposes the center pip on all four arms of a spinner', () => {
    const center = { a: 5, b: 5 }
    expect(endValue(center, true, emptyArms(), 'right')).toBe(5)
    expect(endValue(center, true, emptyArms(), 'left')).toBe(5)
    expect(endValue(center, true, emptyArms(), 'up')).toBe(5)
    expect(endValue(center, true, emptyArms(), 'down')).toBe(5)
    expect(endValue(center, true, { ...emptyArms(), up: [placed(5, 3)] }, 'up')).toBe(3)
  })

  it('legalArms is center-only with no center, and matches only open arms otherwise', () => {
    expect(legalArms(tile(3, 4), buildGame().session.publicState)).toEqual(['center'])
    const nonSpinner = buildGame({ center: { a: 4, b: 6 } }).session.publicState
    expect(legalArms(tile(6, 2), nonSpinner)).toEqual(['right'])
    expect(legalArms(tile(2, 4), nonSpinner)).toEqual(['left'])
    expect(legalArms(tile(2, 2), nonSpinner)).toEqual([])
    const spinner = buildGame({ center: { a: 5, b: 5 }, isSpinner: true }).session.publicState
    expect(legalArms(tile(5, 2), spinner)).toEqual(['right', 'left', 'up', 'down'])
  })

  it('a double lead sets isSpinner and opens all four arms; a non-double lead does not', () => {
    const dm = buildGame({ p1Hand: tiles([[5, 5], [1, 1], [2, 2], [3, 3], [4, 4], [0, 0], [1, 2]]) })
    const r = applyDominoesAction(dm, 'p1', { type: 'PLAY_TILE', tileId: '5-5', arm: 'center' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.dm.session.publicState
    expect(pub.isSpinner).toBe(true)
    expect(pub.center).toEqual({ a: 5, b: 5 })
    expect(legalArms(tile(5, 1), pub)).toEqual(['right', 'left', 'up', 'down'])

    const dm2 = buildGame({ p1Hand: tiles([[6, 4], [1, 1], [2, 2], [3, 3], [4, 4], [0, 0], [1, 2]]) })
    const r2 = applyDominoesAction(dm2, 'p1', { type: 'PLAY_TILE', tileId: '4-6', arm: 'center' })
    expect(r2.outcome.ok).toBe(true)
    const pub2 = r2.dm.session.publicState
    expect(pub2.isSpinner).toBe(false)
    expect(legalArms(tile(4, 1), pub2)).toEqual(['left'])
    expect(legalArms(tile(6, 1), pub2)).toEqual(['right'])
    expect(legalArms(tile(1, 1), pub2)).toEqual([])
  })

  it('handHasLegalPlay', () => {
    const pub = buildGame({ center: { a: 4, b: 6 } }).session.publicState
    expect(handHasLegalPlay(tiles([[6, 2]]), pub)).toBe(true)
    expect(handHasLegalPlay(tiles([[1, 1]]), pub)).toBe(false)
  })
})

describe('standardized All Fives scoring', () => {
  it('boardTotal matches the standardized table', () => {
    expect(boardTotal(null, false, emptyArms())).toBe(0)
    // 5-5 lead → 10 (counted once)
    expect(boardTotal({ a: 5, b: 5 }, true, emptyArms())).toBe(10)
    // 6-6 lead → 12
    expect(boardTotal({ a: 6, b: 6 }, true, emptyArms())).toBe(12)
    // 5-5 then 5-0 right → 10 + 0
    expect(boardTotal({ a: 5, b: 5 }, true, { ...emptyArms(), right: [placed(5, 0)] })).toBe(10)
    // 5-5 then 5-3 right → 10 + 3 = 13
    expect(boardTotal({ a: 5, b: 5 }, true, { ...emptyArms(), right: [placed(5, 3)] })).toBe(13)
    // non-spinner 4-6 lead → 4 + 6 = 10
    expect(boardTotal({ a: 4, b: 6 }, false, emptyArms())).toBe(10)
    // 3-3 at the end of an arm counts 6: spinner 4-4, right [4-3, 3-3], up [4-1] → 8 + 6 + 1 = 15
    expect(boardTotal({ a: 4, b: 4 }, true, { ...emptyArms(), right: [placed(4, 3), placed(3, 3, true)], up: [placed(4, 1)] })).toBe(15)
    // unstarted spinner side arms contribute 0: 5-5, left [5-0], up [5-2] → 0 + 10 + 2 + 0 = 12
    expect(boardTotal({ a: 5, b: 5 }, true, { ...emptyArms(), left: [placed(5, 0)], up: [placed(5, 2)] })).toBe(12)
  })

  it('scoreForTotal is the positive multiple-of-five gate', () => {
    expect(scoreForTotal(10)).toBe(10)
    expect(scoreForTotal(15)).toBe(15)
    expect(scoreForTotal(12)).toBe(0)
    expect(scoreForTotal(0)).toBe(0)
    expect(scoreForTotal(-5)).toBe(0)
  })

  it('pipSum and roundDownToFive', () => {
    expect(pipSum(tiles([[1, 2], [3, 4], [6, 6]]))).toBe(22)
    expect(roundDownToFive(12)).toBe(10)
    expect(roundDownToFive(8)).toBe(5)
    expect(roundDownToFive(4)).toBe(0)
    expect(roundDownToFive(0)).toBe(0)
  })

  it('lead scoring is credited through applyDominoesAction', () => {
    const lead = (leadTile: [number, number], expected: number) => {
      const dm = buildGame({ p1Hand: tiles([leadTile, [1, 1], [2, 2], [3, 3], [4, 4], [0, 0], [1, 2]]) })
      const r = applyDominoesAction(dm, 'p1', { type: 'PLAY_TILE', tileId: `${Math.min(...leadTile)}-${Math.max(...leadTile)}`, arm: 'center' })
      expect(r.outcome.ok).toBe(true)
      expect(r.dm.session.publicState.scores.p1).toBe(expected)
    }
    lead([5, 5], 10)
    lead([6, 6], 0)
    lead([6, 4], 10)
  })

  it('5-5 then 5-0 right scores 10; 5-5 then 5-3 right scores 0', () => {
    const dm = buildGame({
      p1Hand: tiles([[5, 5], [1, 1], [2, 2], [3, 3], [4, 4], [0, 0], [1, 2]]),
      p2Hand: tiles([[5, 0], [6, 6], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]]),
    })
    const r1 = applyDominoesAction(dm, 'p1', { type: 'PLAY_TILE', tileId: '5-5', arm: 'center' })
    expect(r1.outcome.ok).toBe(true)
    const r2 = applyDominoesAction(r1.dm, 'p2', { type: 'PLAY_TILE', tileId: '0-5', arm: 'right' })
    expect(r2.outcome.ok).toBe(true)
    expect(r2.dm.session.publicState.scores.p2).toBe(10)

    const dm2 = buildGame({
      p1Hand: tiles([[5, 5], [1, 1], [2, 2], [3, 3], [4, 4], [0, 0], [1, 2]]),
      p2Hand: tiles([[5, 3], [6, 6], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]]),
    })
    const s1 = applyDominoesAction(dm2, 'p1', { type: 'PLAY_TILE', tileId: '5-5', arm: 'center' })
    const s2 = applyDominoesAction(s1.dm, 'p2', { type: 'PLAY_TILE', tileId: '3-5', arm: 'right' })
    expect(s2.outcome.ok).toBe(true)
    expect(s2.dm.session.publicState.scores.p2).toBe(0)
  })

  it('a 3-3 at the end of an arm counts 6 → board total 15 → 15 points', () => {
    const dm = buildGame({
      currentIndex: 1,
      center: { a: 4, b: 4 },
      isSpinner: true,
      arms: { right: [placed(4, 3)], up: [placed(4, 1)] },
      p2Hand: tiles([[3, 3], [6, 6], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]]),
    })
    const r = applyDominoesAction(dm, 'p2', { type: 'PLAY_TILE', tileId: '3-3', arm: 'right' })
    expect(r.outcome.ok).toBe(true)
    expect(r.dm.session.publicState.scores.p2).toBe(15)
  })
})

describe('draw-until-playable', () => {
  it('a stuck player must draw; a playable draw must be played; the turn never moves on a draw', () => {
    const dm = buildGame({
      center: { a: 5, b: 5 },
      isSpinner: true,
      p1Hand: tiles([[1, 1], [2, 2], [3, 3], [4, 4]]),
      p2Hand: tiles([[6, 6], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 2]]),
      boneyard: tiles([[0, 0], [5, 2]]),   // top = 5-2, playable
    })
    const before = dm.session.publicState.turn
    expect(currentPlayer(before)).toBe('p1')

    let r = applyDominoesAction(dm, 'p1', { type: 'PASS' })
    expect(r.outcome.ok).toBe(false)
    r = applyDominoesAction(dm, 'p1', { type: 'PLAY_TILE', tileId: '1-1', arm: 'right' })
    expect(r.outcome.ok).toBe(false)

    r = applyDominoesAction(dm, 'p1', { type: 'DRAW_TILE' })
    expect(r.outcome.ok).toBe(true)
    let pub = r.dm.session.publicState
    expect(pub.boneyardCount).toBe(1)
    expect(pub.handCounts.p1).toBe(5)
    expect(pub.turn).toEqual(before)
    expect(pub.lastAction).toEqual({ by: 'p1', kind: 'draw', tile: null, arm: null, scored: 0 })

    // a legal play now exists → drawing again is rejected, playing the drawn tile succeeds
    r = applyDominoesAction(r.dm, 'p1', { type: 'DRAW_TILE' })
    expect(r.outcome.ok).toBe(false)
    r = applyDominoesAction(r.dm, 'p1', { type: 'PLAY_TILE', tileId: '2-5', arm: 'right' })
    expect(r.outcome.ok).toBe(true)
    pub = r.dm.session.publicState
    expect(pub.arms.right).toEqual([placed(5, 2)])
    expect(pub.handCounts.p1).toBe(4)
    expect(pub.lastAction).toEqual({ by: 'p1', kind: 'play', tile: { a: 2, b: 5 }, arm: 'right', scored: 0 })
    expect(currentPlayer(pub.turn)).toBe('p2')
  })

  it('after drawing an unplayable tile the same player draws again', () => {
    const dm = buildGame({
      center: { a: 5, b: 5 },
      isSpinner: true,
      p1Hand: tiles([[1, 1], [2, 2], [3, 3], [4, 4]]),
      p2Hand: tiles([[6, 6], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 2]]),
      boneyard: tiles([[5, 1], [0, 0]]),   // top = 0-0, unplayable; then 5-1 playable
    })
    let r = applyDominoesAction(dm, 'p1', { type: 'DRAW_TILE' })
    expect(r.outcome.ok).toBe(true)
    expect(r.dm.session.publicState.handCounts.p1).toBe(5)
    expect(currentPlayer(r.dm.session.publicState.turn)).toBe('p1')
    r = applyDominoesAction(r.dm, 'p1', { type: 'DRAW_TILE' })
    expect(r.outcome.ok).toBe(true)
    expect(r.dm.session.publicState.handCounts.p1).toBe(6)
    expect(r.dm.session.publicState.boneyardCount).toBe(0)
    expect(currentPlayer(r.dm.session.publicState.turn)).toBe('p1')
    r = applyDominoesAction(r.dm, 'p1', { type: 'PLAY_TILE', tileId: '1-5', arm: 'up' })
    expect(r.outcome.ok).toBe(true)
    expect(currentPlayer(r.dm.session.publicState.turn)).toBe('p2')
  })
})

describe('PASS and blocked rounds', () => {
  it('PASS is rejected when a legal play exists', () => {
    const dm = buildGame({
      center: { a: 5, b: 5 },
      isSpinner: true,
      p1Hand: tiles([[5, 1], [1, 1], [2, 2]]),
      boneyard: [],
    })
    expect(applyDominoesAction(dm, 'p1', { type: 'PASS' }).outcome.ok).toBe(false)
  })

  it('DRAW is rejected when the boneyard is empty', () => {
    const dm = buildGame({
      center: { a: 5, b: 5 },
      isSpinner: true,
      p1Hand: tiles([[1, 1], [2, 2], [3, 3]]),
      boneyard: [],
    })
    expect(applyDominoesAction(dm, 'p1', { type: 'DRAW_TILE' }).outcome.ok).toBe(false)
  })

  it('two passes with equal pip totals block the round with nobody scoring', () => {
    const dm = buildGame({
      center: { a: 5, b: 5 },
      isSpinner: true,
      p1Hand: tiles([[1, 1], [2, 2]]),        // 6 pips
      p2Hand: tiles([[0, 0], [3, 3]]),        // 6 pips
      boneyard: [],
    })
    let r = applyDominoesAction(dm, 'p1', { type: 'PASS' })
    expect(r.outcome.ok).toBe(true)
    let pub = r.dm.session.publicState
    expect(pub.passStreak).toBe(1)
    expect(pub.lastAction).toEqual({ by: 'p1', kind: 'pass', tile: null, arm: null, scored: 0 })
    expect(currentPlayer(pub.turn)).toBe('p2')

    r = applyDominoesAction(r.dm, 'p2', { type: 'PASS' })
    expect(r.outcome.ok).toBe(true)
    pub = r.dm.session.publicState
    expect(pub.stage).toBe('roundEnd')
    expect(pub.roundResult).toEqual({ kind: 'blocked', scorerId: null, points: 0 })
    expect(pub.scores).toEqual({ p1: 0, p2: 0 })
    expect(pub.matchWinnerId).toBeNull()
  })

  it('blocked round: the lower pip total scores both hands rounded down to 5', () => {
    const dm = buildGame({
      center: { a: 5, b: 5 },
      isSpinner: true,
      p1Hand: tiles([[1, 1], [2, 2]]),        // 6 pips
      p2Hand: tiles([[0, 0], [0, 1]]),        // 1 pip
      boneyard: [],
    })
    let r = applyDominoesAction(dm, 'p1', { type: 'PASS' })
    expect(r.outcome.ok).toBe(true)
    r = applyDominoesAction(r.dm, 'p2', { type: 'PASS' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.dm.session.publicState
    expect(pub.roundResult).toEqual({ kind: 'blocked', scorerId: 'p2', points: 5 })
    expect(pub.scores).toEqual({ p1: 0, p2: 5 })
  })

  it('3-player blocked: requires ALL three players to pass, not just 2', () => {
    // All players must have no legal plays: center is 5-5 spinner, all hands have no 5s
    const p1Hand = addCards(createHand<DominoTile>('p1'), tiles([[1, 1], [2, 2]]))
    const p2Hand = addCards(createHand<DominoTile>('p2'), tiles([[0, 0], [3, 3]]))
    const p3Hand = addCards(createHand<DominoTile>('p3'), tiles([[4, 4], [6, 6]]))
    const boneyard = addCards(createPublicZone<DominoTile>('boneyard', 'private'), [])
    const turn = createTurnState<'play'>(['p1', 'p2', 'p3'], 'play')
    const publicState: DominoesPublicState = {
      stage: 'play',
      seatOrder: ['p1', 'p2', 'p3'],
      turn,
      center: { a: 5, b: 5 },
      isSpinner: true,
      arms: emptyArms(),
      boneyardCount: 0,
      handCounts: { p1: 2, p2: 2, p3: 2 },
      passStreak: 0,
      scores: { p1: 0, p2: 0, p3: 0 },
      target: 150,
      roundNumber: 1,
      roundStarterId: 'p1',
      roundResult: null,
      lastAction: null,
      matchWinnerId: null,
    }
    const privateStates: Record<string, DominoesPrivateState> = {
      p1: { hand: p1Hand },
      p2: { hand: p2Hand },
      p3: { hand: p3Hand },
    }
    const dm = { session: createHostSession(publicState, privateStates), boneyard, rng: createRng(0) }
    // p1 passes
    let r = applyDominoesAction(dm, 'p1', { type: 'PASS' })
    expect(r.outcome.ok).toBe(true)
    expect(r.dm.session.publicState.passStreak).toBe(1)
    expect(r.dm.session.publicState.stage).toBe('play')  // NOT over yet
    // p2 passes
    r = applyDominoesAction(r.dm, 'p2', { type: 'PASS' })
    expect(r.outcome.ok).toBe(true)
    expect(r.dm.session.publicState.passStreak).toBe(2)
    expect(r.dm.session.publicState.stage).toBe('play')  // Still NOT over (need 3 passes)
    // p3 passes
    r = applyDominoesAction(r.dm, 'p3', { type: 'PASS' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.dm.session.publicState
    expect(pub.passStreak).toBe(3)
    expect(pub.stage).toBe('roundEnd')  // NOW it's over
    expect(pub.roundResult).not.toBeNull()
    expect(pub.roundResult!.kind).toBe('blocked')
  })

  it('3-player blocked round: lowest pip holder scores everyone\'s pips (ties prevent scoring)', () => {
    // p1: 1+1+2+2=6 pips
    // p2: 0+0+0+1=1 pip (lowest, unique)
    // p3: 4+4+4+0=12 pips
    // total = 6+1+12 = 19 → 15 points for p2
    const p1Hand = addCards(createHand<DominoTile>('p1'), tiles([[1, 1], [2, 2]]))
    const p2Hand = addCards(createHand<DominoTile>('p2'), tiles([[0, 0], [0, 1]]))
    const p3Hand = addCards(createHand<DominoTile>('p3'), tiles([[4, 4], [4, 0]]))
    const boneyard = addCards(createPublicZone<DominoTile>('boneyard', 'private'), [])
    const turn = createTurnState<'play'>(['p1', 'p2', 'p3'], 'play')
    const publicState: DominoesPublicState = {
      stage: 'play',
      seatOrder: ['p1', 'p2', 'p3'],
      turn,
      center: { a: 5, b: 5 },
      isSpinner: true,
      arms: emptyArms(),
      boneyardCount: 0,
      handCounts: { p1: 2, p2: 2, p3: 2 },
      passStreak: 0,
      scores: { p1: 0, p2: 0, p3: 0 },
      target: 150,
      roundNumber: 1,
      roundStarterId: 'p1',
      roundResult: null,
      lastAction: null,
      matchWinnerId: null,
    }
    const privateStates: Record<string, DominoesPrivateState> = {
      p1: { hand: p1Hand },
      p2: { hand: p2Hand },
      p3: { hand: p3Hand },
    }
    const dm = { session: createHostSession(publicState, privateStates), boneyard, rng: createRng(0) }
    let r = applyDominoesAction(dm, 'p1', { type: 'PASS' })
    r = applyDominoesAction(r.dm, 'p2', { type: 'PASS' })
    r = applyDominoesAction(r.dm, 'p3', { type: 'PASS' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.dm.session.publicState
    expect(pub.roundResult).toEqual({ kind: 'blocked', scorerId: 'p2', points: 15 })
    expect(pub.scores).toEqual({ p1: 0, p2: 15, p3: 0 })
  })

  it('4-player blocked: requires all 4 players to pass', () => {
    const p1Hand = addCards(createHand<DominoTile>('p1'), tiles([[1, 1]]))
    const p2Hand = addCards(createHand<DominoTile>('p2'), tiles([[2, 2]]))
    const p3Hand = addCards(createHand<DominoTile>('p3'), tiles([[3, 3]]))
    const p4Hand = addCards(createHand<DominoTile>('p4'), tiles([[4, 4]]))
    const boneyard = addCards(createPublicZone<DominoTile>('boneyard', 'private'), [])
    const turn = createTurnState<'play'>(['p1', 'p2', 'p3', 'p4'], 'play')
    const publicState: DominoesPublicState = {
      stage: 'play',
      seatOrder: ['p1', 'p2', 'p3', 'p4'],
      turn,
      center: { a: 5, b: 5 },
      isSpinner: true,
      arms: emptyArms(),
      boneyardCount: 0,
      handCounts: { p1: 1, p2: 1, p3: 1, p4: 1 },
      passStreak: 0,
      scores: { p1: 0, p2: 0, p3: 0, p4: 0 },
      target: 150,
      roundNumber: 1,
      roundStarterId: 'p1',
      roundResult: null,
      lastAction: null,
      matchWinnerId: null,
    }
    const privateStates: Record<string, DominoesPrivateState> = {
      p1: { hand: p1Hand },
      p2: { hand: p2Hand },
      p3: { hand: p3Hand },
      p4: { hand: p4Hand },
    }
    const dm = { session: createHostSession(publicState, privateStates), boneyard, rng: createRng(0) }
    let r = applyDominoesAction(dm, 'p1', { type: 'PASS' })
    expect(r.dm.session.publicState.stage).toBe('play')
    r = applyDominoesAction(r.dm, 'p2', { type: 'PASS' })
    expect(r.dm.session.publicState.stage).toBe('play')
    r = applyDominoesAction(r.dm, 'p3', { type: 'PASS' })
    expect(r.dm.session.publicState.stage).toBe('play')
    r = applyDominoesAction(r.dm, 'p4', { type: 'PASS' })
    expect(r.outcome.ok).toBe(true)
    expect(r.dm.session.publicState.stage).toBe('roundEnd')  // NOW it's over
  })
})

describe('going out', () => {
  it('credits the final-play score AND the opponent-pips bonus, rounded down', () => {
    const dm = buildGame({
      p1Hand: tiles([[5, 5]]),
      p2Hand: tiles([[6, 1], [2, 3]]),   // 7 + 5 = 12 pips → bonus 10
      boneyard: [],
    })
    const r = applyDominoesAction(dm, 'p1', { type: 'PLAY_TILE', tileId: '5-5', arm: 'center' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.dm.session.publicState
    expect(pub.scores.p1).toBe(20)          // 10 from the play + 10 go-out bonus
    expect(pub.roundResult).toEqual({ kind: 'out', scorerId: 'p1', points: 10 })
    expect(pub.stage).toBe('roundEnd')
    expect(pub.matchWinnerId).toBeNull()    // 20 < 150
  })

  it('3-player going out: scores all opponents\' combined pips, rounded down', () => {
    // p1 goes out: p2 has 5+7=12 pips, p3 has 1+2=3 pips → 12+3=15 → 15
    const p1Hand = addCards(createHand<DominoTile>('p1'), tiles([[5, 5]]))
    const p2Hand = addCards(createHand<DominoTile>('p2'), tiles([[6, 1], [2, 3]]))
    const p3Hand = addCards(createHand<DominoTile>('p3'), tiles([[0, 1], [0, 2]]))
    const boneyard = addCards(createPublicZone<DominoTile>('boneyard', 'private'), [])
    const turn = createTurnState<'play'>(['p1', 'p2', 'p3'], 'play')
    const publicState: DominoesPublicState = {
      stage: 'play',
      seatOrder: ['p1', 'p2', 'p3'],
      turn,
      center: null,
      isSpinner: false,
      arms: emptyArms(),
      boneyardCount: 0,
      handCounts: { p1: 1, p2: 2, p3: 2 },
      passStreak: 0,
      scores: { p1: 0, p2: 0, p3: 0 },
      target: 150,
      roundNumber: 1,
      roundStarterId: 'p1',
      roundResult: null,
      lastAction: null,
      matchWinnerId: null,
    }
    const privateStates: Record<string, DominoesPrivateState> = {
      p1: { hand: p1Hand },
      p2: { hand: p2Hand },
      p3: { hand: p3Hand },
    }
    const dm = { session: createHostSession(publicState, privateStates), boneyard, rng: createRng(0) }
    const r = applyDominoesAction(dm, 'p1', { type: 'PLAY_TILE', tileId: '5-5', arm: 'center' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.dm.session.publicState
    expect(pub.scores.p1).toBe(25)          // 10 from the play + 15 go-out bonus
    expect(pub.roundResult).toEqual({ kind: 'out', scorerId: 'p1', points: 15 })
    expect(pub.stage).toBe('roundEnd')
  })

  it('4-player going out: scores all three opponents\' combined pips, rounded down', () => {
    // p1 goes out with 6-6 lead: p2 has 5 pips, p3 has 3+4+1+1=9 pips, p4 has 2 pips
    // p1 lead 6-6 (double, spinner): board total 12 (not divisible by 5) → scores 0
    // opponents total: 5+9+2=16 → rounded down to 15
    // p1 total: 0 + 15 = 15
    const p1Hand = addCards(createHand<DominoTile>('p1'), tiles([[6, 6]]))
    const p2Hand = addCards(createHand<DominoTile>('p2'), tiles([[0, 5]]))
    const p3Hand = addCards(createHand<DominoTile>('p3'), tiles([[3, 4], [1, 1]]))
    const p4Hand = addCards(createHand<DominoTile>('p4'), tiles([[0, 2]]))
    const boneyard = addCards(createPublicZone<DominoTile>('boneyard', 'private'), [])
    const turn = createTurnState<'play'>(['p1', 'p2', 'p3', 'p4'], 'play')
    const publicState: DominoesPublicState = {
      stage: 'play',
      seatOrder: ['p1', 'p2', 'p3', 'p4'],
      turn,
      center: null,
      isSpinner: false,
      arms: emptyArms(),
      boneyardCount: 0,
      handCounts: { p1: 1, p2: 1, p3: 2, p4: 1 },
      passStreak: 0,
      scores: { p1: 0, p2: 0, p3: 0, p4: 0 },
      target: 150,
      roundNumber: 1,
      roundStarterId: 'p1',
      roundResult: null,
      lastAction: null,
      matchWinnerId: null,
    }
    const privateStates: Record<string, DominoesPrivateState> = {
      p1: { hand: p1Hand },
      p2: { hand: p2Hand },
      p3: { hand: p3Hand },
      p4: { hand: p4Hand },
    }
    const dm = { session: createHostSession(publicState, privateStates), boneyard, rng: createRng(0) }
    const r = applyDominoesAction(dm, 'p1', { type: 'PLAY_TILE', tileId: '6-6', arm: 'center' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.dm.session.publicState
    expect(pub.scores.p1).toBe(15)          // 0 from the lead + 15 go-out bonus
    expect(pub.roundResult).toEqual({ kind: 'out', scorerId: 'p1', points: 15 })
    expect(pub.stage).toBe('roundEnd')
  })
})

describe('rounds', () => {
  it('START_NEXT_ROUND redeals 7/7/14 with a fresh board, alternating starter, scores persist', () => {
    const dm = buildGame({
      stage: 'roundEnd',
      scores: { p1: 40, p2: 60 },
      roundNumber: 1,
      roundStarterId: 'p1',
      roundResult: { kind: 'out', scorerId: 'p1', points: 10 },
      lastAction: { by: 'p1', kind: 'play', tile: { a: 5, b: 5 }, arm: 'center', scored: 10 },
    })
    const r = applyDominoesAction(dm, 'p2', { type: 'START_NEXT_ROUND' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.dm.session.publicState
    expect(pub.stage).toBe('play')
    expect(pub.roundNumber).toBe(2)
    expect(pub.roundStarterId).toBe('p2')
    expect(currentPlayer(pub.turn)).toBe('p2')
    expect(pub.center).toBeNull()
    expect(pub.isSpinner).toBe(false)
    expect(pub.arms).toEqual(emptyArms())
    expect(pub.passStreak).toBe(0)
    expect(pub.lastAction).toBeNull()
    expect(pub.roundResult).toBeNull()
    expect(pub.boneyardCount).toBe(14)
    expect(pub.handCounts).toEqual({ p1: 7, p2: 7 })
    expect(pub.scores).toEqual({ p1: 40, p2: 60 })
    expect(cardCount(r.dm.session.privateStates.p1.hand)).toBe(7)
    expect(cardCount(r.dm.session.privateStates.p2.hand)).toBe(7)
    expect(r.dm.boneyard.cards).toHaveLength(14)
    const all = new Set([
      ...r.dm.session.privateStates.p1.hand.cards,
      ...r.dm.session.privateStates.p2.hand.cards,
      ...r.dm.boneyard.cards,
    ].map((t) => t.id))
    expect(all.size).toBe(28)
  })

  it('START_NEXT_ROUND is rejected during play and over', () => {
    const dm = buildGame()
    expect(applyDominoesAction(dm, 'p1', { type: 'START_NEXT_ROUND' }).outcome.ok).toBe(false)
    const dm2 = buildGame({ stage: 'over', matchWinnerId: 'p1' })
    expect(applyDominoesAction(dm2, 'p1', { type: 'START_NEXT_ROUND' }).outcome.ok).toBe(false)
  })

  it('reaching ≥150 at a round close ends the match with a winner', () => {
    const dm = buildGame({
      scores: { p1: 145, p2: 145 },
      p1Hand: tiles([[5, 5]]),
      p2Hand: tiles([[6, 1], [2, 3]]),   // 12 pips → 10 bonus
      boneyard: [],
    })
    const r = applyDominoesAction(dm, 'p1', { type: 'PLAY_TILE', tileId: '5-5', arm: 'center' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.dm.session.publicState
    expect(pub.stage).toBe('over')
    expect(pub.matchWinnerId).toBe('p1')
    expect(pub.scores.p1).toBe(165)   // 145 + 10 play + 10 bonus
  })

  it('a tied ≥150 round close keeps playing', () => {
    const dm = buildGame({
      scores: { p1: 150, p2: 150 },
      center: { a: 5, b: 5 },
      isSpinner: true,
      p1Hand: tiles([[1, 1], [2, 2]]),
      p2Hand: tiles([[0, 0], [3, 3]]),
      boneyard: [],
    })
    let r = applyDominoesAction(dm, 'p1', { type: 'PASS' })
    expect(r.outcome.ok).toBe(true)
    r = applyDominoesAction(r.dm, 'p2', { type: 'PASS' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.dm.session.publicState
    expect(pub.stage).toBe('roundEnd')
    expect(pub.matchWinnerId).toBeNull()
    expect(pub.scores).toEqual({ p1: 150, p2: 150 })
  })

  it('3-player round-starter rotation: p1→p2→p3→p1', () => {
    let dm = createDominoesGame(['p1', 'p2', 'p3'], 42)
    expect(dm.session.publicState.roundStarterId).toBe('p1')
    expect(currentPlayer(dm.session.publicState.turn)).toBe('p1')

    // Advance to roundEnd (easiest: one immediate pass from each player)
    dm.session.publicState.center = { a: 5, b: 5 }
    dm.session.publicState.isSpinner = true
    // Simulate game state where all hands are empty except current player (blocked round)
    const p1StateEmpty = { hand: addCards(createHand<DominoTile>('p1'), []) }
    const p2StateEmpty = { hand: addCards(createHand<DominoTile>('p2'), []) }
    const p3StateEmpty = { hand: addCards(createHand<DominoTile>('p3'), []) }
    const boneyardEmpty = addCards(createPublicZone<DominoTile>('boneyard', 'private'), [])

    dm.session.publicState.boneyardCount = 0
    dm.session.publicState.handCounts = { p1: 0, p2: 0, p3: 0 }
    dm.session.privateStates.p1 = p1StateEmpty
    dm.session.privateStates.p2 = p2StateEmpty
    dm.session.privateStates.p3 = p3StateEmpty
    dm.boneyard = boneyardEmpty

    let r = applyDominoesAction(dm, 'p1', { type: 'PASS' })
    expect(r.outcome.ok).toBe(true)
    r = applyDominoesAction(r.dm, 'p2', { type: 'PASS' })
    expect(r.outcome.ok).toBe(true)
    r = applyDominoesAction(r.dm, 'p3', { type: 'PASS' })
    expect(r.outcome.ok).toBe(true)
    expect(r.dm.session.publicState.stage).toBe('roundEnd')

    // Start round 2
    r = applyDominoesAction(r.dm, 'p1', { type: 'START_NEXT_ROUND' })
    expect(r.outcome.ok).toBe(true)
    expect(r.dm.session.publicState.roundNumber).toBe(2)
    expect(r.dm.session.publicState.roundStarterId).toBe('p2')  // rotates to p2
    expect(currentPlayer(r.dm.session.publicState.turn)).toBe('p2')

    // Move to round 3 (skip to roundEnd quickly by dealing empty hands again)
    const dm2 = r.dm
    dm2.session.publicState.center = { a: 5, b: 5 }
    dm2.session.publicState.isSpinner = true
    dm2.session.publicState.boneyardCount = 0
    dm2.session.publicState.handCounts = { p1: 0, p2: 0, p3: 0 }
    dm2.session.privateStates.p1 = p1StateEmpty
    dm2.session.privateStates.p2 = p2StateEmpty
    dm2.session.privateStates.p3 = p3StateEmpty
    dm2.boneyard = boneyardEmpty

    r = applyDominoesAction(dm2, 'p2', { type: 'PASS' })
    r = applyDominoesAction(r.dm, 'p3', { type: 'PASS' })
    r = applyDominoesAction(r.dm, 'p1', { type: 'PASS' })
    expect(r.dm.session.publicState.stage).toBe('roundEnd')

    // Start round 3
    r = applyDominoesAction(r.dm, 'p1', { type: 'START_NEXT_ROUND' })
    expect(r.outcome.ok).toBe(true)
    expect(r.dm.session.publicState.roundNumber).toBe(3)
    expect(r.dm.session.publicState.roundStarterId).toBe('p3')  // rotates to p3
    expect(currentPlayer(r.dm.session.publicState.turn)).toBe('p3')
  })

  it('3-player tied ≥150 keeps the match going', () => {
    // p1 and p2 tied at 150 (leaders); p3 at 100 (behind)
    // p3 has lowest pips (1), scores: stays at 100-110, p1 and p2 remain tied at 150
    // All tiles must avoid 5 (no legal play on 5-5 spinner)
    const p1Hand = addCards(createHand<DominoTile>('p1'), tiles([[1, 4]]))  // 5 pips (no 5)
    const p2Hand = addCards(createHand<DominoTile>('p2'), tiles([[3, 3]]))  // 6 pips (no 5)
    const p3Hand = addCards(createHand<DominoTile>('p3'), tiles([[0, 1]]))  // 1 pip (lowest, unique, no 5)
    const boneyard = addCards(createPublicZone<DominoTile>('boneyard', 'private'), [])
    const turn = createTurnState<'play'>(['p1', 'p2', 'p3'], 'play')
    const publicState: DominoesPublicState = {
      stage: 'play',
      seatOrder: ['p1', 'p2', 'p3'],
      turn,
      center: { a: 5, b: 5 },
      isSpinner: true,
      arms: emptyArms(),
      boneyardCount: 0,
      handCounts: { p1: 1, p2: 1, p3: 1 },
      passStreak: 0,
      scores: { p1: 150, p2: 150, p3: 100 },  // p1 and p2 tied at 150
      target: 150,
      roundNumber: 1,
      roundStarterId: 'p1',
      roundResult: null,
      lastAction: null,
      matchWinnerId: null,
    }
    const privateStates: Record<string, DominoesPrivateState> = {
      p1: { hand: p1Hand },
      p2: { hand: p2Hand },
      p3: { hand: p3Hand },
    }
    const dm = { session: createHostSession(publicState, privateStates), boneyard, rng: createRng(0) }
    let r = applyDominoesAction(dm, 'p1', { type: 'PASS' })
    r = applyDominoesAction(r.dm, 'p2', { type: 'PASS' })
    r = applyDominoesAction(r.dm, 'p3', { type: 'PASS' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.dm.session.publicState
    expect(pub.stage).toBe('roundEnd')
    expect(pub.matchWinnerId).toBeNull()  // Tied at 150, match continues
    // p3 scores (5+6+1)=12→10 points: 100+10=110. p1, p2 stay at 150 tied.
    expect(pub.scores).toEqual({ p1: 150, p2: 150, p3: 110 })
  })

  it('4-player tied ≥150 keeps the match going', () => {
    // p1 and p2 tied for lowest pips, so neither scores in blocked round
    const p1Hand = addCards(createHand<DominoTile>('p1'), tiles([[0, 2]]))  // 2 pips (tied for lowest)
    const p2Hand = addCards(createHand<DominoTile>('p2'), tiles([[1, 1]]))  // 2 pips (tied for lowest)
    const p3Hand = addCards(createHand<DominoTile>('p3'), tiles([[0, 3]]))  // 3 pips
    const p4Hand = addCards(createHand<DominoTile>('p4'), tiles([[0, 4]]))  // 4 pips
    const boneyard = addCards(createPublicZone<DominoTile>('boneyard', 'private'), [])
    const turn = createTurnState<'play'>(['p1', 'p2', 'p3', 'p4'], 'play')
    const publicState: DominoesPublicState = {
      stage: 'play',
      seatOrder: ['p1', 'p2', 'p3', 'p4'],
      turn,
      center: { a: 5, b: 5 },
      isSpinner: true,
      arms: emptyArms(),
      boneyardCount: 0,
      handCounts: { p1: 1, p2: 1, p3: 1, p4: 1 },
      passStreak: 0,
      scores: { p1: 150, p2: 150, p3: 100, p4: 100 },  // p1 and p2 tied at 150
      target: 150,
      roundNumber: 1,
      roundStarterId: 'p1',
      roundResult: null,
      lastAction: null,
      matchWinnerId: null,
    }
    const privateStates: Record<string, DominoesPrivateState> = {
      p1: { hand: p1Hand },
      p2: { hand: p2Hand },
      p3: { hand: p3Hand },
      p4: { hand: p4Hand },
    }
    const dm = { session: createHostSession(publicState, privateStates), boneyard, rng: createRng(0) }
    let r = applyDominoesAction(dm, 'p1', { type: 'PASS' })
    r = applyDominoesAction(r.dm, 'p2', { type: 'PASS' })
    r = applyDominoesAction(r.dm, 'p3', { type: 'PASS' })
    r = applyDominoesAction(r.dm, 'p4', { type: 'PASS' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.dm.session.publicState
    expect(pub.stage).toBe('roundEnd')
    expect(pub.matchWinnerId).toBeNull()  // Tied at 150, match continues
    expect(pub.scores).toEqual({ p1: 150, p2: 150, p3: 100, p4: 100 })  // No one scored (four-way tie for lowest)
  })
})

describe('bot', () => {
  it('leads its highest double, else the highest pip-sum tile', () => {
    const pub = buildGame().session.publicState   // center null
    const priv1: DominoesPrivateState = { hand: addCards(createHand<DominoTile>('p1'), tiles([[2, 2], [5, 5], [3, 4]])) }
    expect(dominoesBotStrategy(pub, priv1, 'p1')).toEqual({ type: 'PLAY_TILE', tileId: '5-5', arm: 'center' })
    const priv2: DominoesPrivateState = { hand: addCards(createHand<DominoTile>('p1'), tiles([[6, 4], [6, 5], [2, 3]])) }
    expect(dominoesBotStrategy(pub, priv2, 'p1')).toEqual({ type: 'PLAY_TILE', tileId: '5-6', arm: 'center' })
  })

  it('picks the scoring play over a non-scoring one', () => {
    // center 1-6: 4-6 right → 1 + 4 = 5 (scores); 1-2 left → 2 + 6 = 8 (nothing)
    const pub = buildGame({ center: { a: 1, b: 6 } }).session.publicState
    const priv: DominoesPrivateState = { hand: addCards(createHand<DominoTile>('p1'), tiles([[6, 4], [1, 2]])) }
    expect(dominoesBotStrategy(pub, priv, 'p1')).toEqual({ type: 'PLAY_TILE', tileId: '4-6', arm: 'right' })
  })

  it('breaks ties doubles-first, then higher pip sum, then hand/arm order', () => {
    // center 1-2: 2-2 right → 1 + 4 = 5 and 1-3 left → 3 + 2 = 5 — the double wins
    const pub = buildGame({ center: { a: 1, b: 2 } }).session.publicState
    const priv: DominoesPrivateState = { hand: addCards(createHand<DominoTile>('p1'), tiles([[2, 2], [1, 3]])) }
    expect(dominoesBotStrategy(pub, priv, 'p1')).toEqual({ type: 'PLAY_TILE', tileId: '2-2', arm: 'right' })
    // spinner 5-5: 1-5 scores 11 on every arm — first arm in right,left,up,down order
    const pub2 = buildGame({ center: { a: 5, b: 5 }, isSpinner: true }).session.publicState
    const priv2: DominoesPrivateState = { hand: addCards(createHand<DominoTile>('p1'), tiles([[5, 1], [1, 1]])) }
    expect(dominoesBotStrategy(pub2, priv2, 'p1')).toEqual({ type: 'PLAY_TILE', tileId: '1-5', arm: 'right' })
  })

  it('draws when stuck and passes when stuck with an empty boneyard', () => {
    const pub = buildGame({ center: { a: 5, b: 5 }, isSpinner: true }).session.publicState
    const priv: DominoesPrivateState = { hand: addCards(createHand<DominoTile>('p1'), tiles([[1, 1], [2, 2], [3, 3]])) }
    expect(dominoesBotStrategy({ ...pub, boneyardCount: 3 }, priv, 'p1')).toEqual({ type: 'DRAW_TILE' })
    expect(dominoesBotStrategy({ ...pub, boneyardCount: 0 }, priv, 'p1')).toEqual({ type: 'PASS' })
  })

  it('a full bot-vs-bot match runs to completion with all actions accepted', () => {
    let dm = createDominoesGame(['p1', 'p2'], 7)
    let actions = 0
    while (dm.session.publicState.matchWinnerId === null && actions < 2000) {
      const pub = dm.session.publicState
      if (pub.stage === 'roundEnd') {
        const r = applyDominoesAction(dm, 'p1', { type: 'START_NEXT_ROUND' })
        expect(r.outcome.ok).toBe(true)
        dm = r.dm
        actions++
        continue
      }
      const player = currentPlayer(pub.turn)
      const r = runDominoesBotTurn(dm, player, dominoesBotStrategy)
      expect(r.outcome.ok).toBe(true)
      dm = r.dm
      actions++
    }
    expect(dm.session.publicState.stage).toBe('over')
    expect(dm.session.publicState.matchWinnerId).not.toBeNull()
    expect(actions).toBeLessThan(2000)
  })
})

describe('no leak', () => {
  it('snapshots expose only the guest hand; no boneyard or opponent tile ids in public state', () => {
    const dm = buildGame({
      p1Hand: tiles([[5, 5], [1, 1], [2, 2], [3, 3], [4, 4], [0, 0], [1, 2]]),
      p2Hand: tiles([[5, 1], [6, 6], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]]),
      boneyard: tiles([[5, 2], [5, 3], [5, 4], [5, 6], [1, 3], [1, 4], [1, 5], [1, 6], [2, 3], [2, 4], [2, 5], [2, 6], [3, 4], [3, 5]]),
    })
    let r = applyDominoesAction(dm, 'p1', { type: 'PLAY_TILE', tileId: '5-5', arm: 'center' })
    expect(r.outcome.ok).toBe(true)
    r = applyDominoesAction(r.dm, 'p2', { type: 'PLAY_TILE', tileId: '1-5', arm: 'right' })
    expect(r.outcome.ok).toBe(true)

    const snap = deriveSnapshot(r.dm.session, 'p2')
    expect(snap.privateState).toEqual(r.dm.session.privateStates.p2)
    expect(snap.privateState?.hand.cards).toHaveLength(6)

    const p1Ids = new Set(r.dm.session.privateStates.p1.hand.cards.map((t) => t.id))
    const boneyardIds = new Set(r.dm.boneyard.cards.map((t) => t.id))
    const json = JSON.stringify(snap.publicState)
    for (const id of p1Ids) expect(json).not.toContain(id)
    for (const id of boneyardIds) expect(json).not.toContain(id)

    const pub = snap.publicState
    expect(typeof pub.boneyardCount).toBe('number')
    expect(pub.handCounts).toEqual({ p1: 6, p2: 6 })
    expect(isJsonSerializable(snap)).toBe(true)
  })

  it('a DRAW lastAction never names the drawn tile', () => {
    const dm = buildGame({
      center: { a: 5, b: 5 },
      isSpinner: true,
      p1Hand: tiles([[1, 1], [2, 2], [3, 3]]),
      boneyard: tiles([[0, 0], [5, 2]]),
    })
    const r = applyDominoesAction(dm, 'p1', { type: 'DRAW_TILE' })
    expect(r.outcome.ok).toBe(true)
    expect(r.dm.session.publicState.lastAction).toEqual({ by: 'p1', kind: 'draw', tile: null, arm: null, scored: 0 })
  })
})

describe('revision', () => {
  it('increments only on accepted actions', () => {
    const dm = buildGame({
      p1Hand: tiles([[5, 5], [1, 1], [2, 2], [3, 3], [4, 4], [0, 0], [1, 2]]),
      p2Hand: tiles([[5, 1], [6, 6], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]]),
    })
    expect(dm.session.revision).toBe(0)

    let r = applyDominoesAction(dm, 'p1', { type: 'PLAY_TILE', tileId: '0-1', arm: 'center' })  // not in p1's hand
    expect(r.outcome.ok).toBe(false)
    expect(r.dm.session.revision).toBe(0)

    r = applyDominoesAction(dm, 'p1', { type: 'PLAY_TILE', tileId: '5-5', arm: 'center' })
    expect(r.outcome.ok).toBe(true)
    expect(r.dm.session.revision).toBe(1)

    r = applyDominoesAction(r.dm, 'p1', { type: 'PLAY_TILE', tileId: '1-1', arm: 'right' })   // not p1's turn
    expect(r.outcome.ok).toBe(false)
    expect(r.dm.session.revision).toBe(1)

    r = applyDominoesAction(r.dm, 'p2', { type: 'PLAY_TILE', tileId: '1-1', arm: 'right' })   // 1-1 matches no end
    expect(r.outcome.ok).toBe(false)
    expect(r.dm.session.revision).toBe(1)

    r = applyDominoesAction(r.dm, 'p2', { type: 'PLAY_TILE', tileId: '1-5', arm: 'right' })
    expect(r.outcome.ok).toBe(true)
    expect(r.dm.session.revision).toBe(2)
  })
})
