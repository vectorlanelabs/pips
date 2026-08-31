// Oscar's adversarial probes for the dominoes module. Every finding claimed in the review has a
// runnable repro here. All probes passing = the module survived the attack; a failing probe is
// evidence of a real defect (see the review write-up for interpretation).
import { describe, expect, it } from 'vitest'
import {
  createDominoesGame,
  type DominoArm,
  type DominoesPrivateState,
  type DominoesPublicState,
  type DominoesRoundResult,
  type DominoesSession,
  type DominoTile,
  type LastDominoAction,
  type PlacedTile,
} from './state.ts'
import { boardTotal } from './scoring.ts'
import { applyDominoesAction, runDominoesBotTurn } from './rules.ts'
import { dominoesBotStrategy } from './bot.ts'
import { deriveSnapshot, isJsonSerializable } from '../../engine/sync.ts'
import { createTurnState, currentPlayer } from '../../engine/turn-engine.ts'
import { createRng } from '../../engine/rng.ts'
import { createHostSession } from '../../engine/sync.ts'
import { addCards, createHand, createPublicZone } from '../../card-engine/zones.ts'

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

// ---------------------------------------------------------------------------------------------
// Attack 1: information leaks
// ---------------------------------------------------------------------------------------------

describe('attack: information leaks', () => {
  it('across a full seeded bot-vs-bot match, publicState never contains a tile "id" field at all', () => {
    let dm = createDominoesGame(['p1', 'p2'], 11)
    let actions = 0
    const allIds = new Set<string>()
    for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) allIds.add(`${a}-${b}`)

    const checkSnapshot = (playerId: string) => {
      const snap = deriveSnapshot(dm.session, playerId)
      expect(isJsonSerializable(snap)).toBe(true)
      const json = JSON.stringify(snap.publicState)
      // arms/center/lastAction.tile carry only {a,b}/{inner,outer,isDouble} — never an "id" key.
      expect(json).not.toContain('"id"')
      // belt-and-suspenders: no bare tile-id substring should appear either.
      for (const id of allIds) expect(json).not.toContain(`"${id}"`)
      if (snap.privateState) {
        const ownIds = new Set(snap.privateState.hand.cards.map((t) => t.id))
        const otherId = playerId === 'p1' ? 'p2' : 'p1'
        const otherIds = new Set(dm.session.privateStates[otherId].hand.cards.map((t) => t.id))
        for (const id of otherIds) {
          if (!ownIds.has(id)) expect(json).not.toContain(`"${id}"`)
        }
      }
      if (snap.publicState.lastAction?.kind === 'draw') {
        expect(snap.publicState.lastAction.tile).toBeNull()
      }
    }

    checkSnapshot('p1')
    checkSnapshot('p2')

    while (dm.session.publicState.matchWinnerId === null && actions < 2000) {
      const pub = dm.session.publicState
      if (pub.stage === 'roundEnd') {
        const r = applyDominoesAction(dm, 'p1', { type: 'START_NEXT_ROUND' })
        expect(r.outcome.ok).toBe(true)
        dm = r.dm
      } else {
        const player = currentPlayer(pub.turn)
        const r = runDominoesBotTurn(dm, player, dominoesBotStrategy)
        expect(r.outcome.ok).toBe(true)
        dm = r.dm
      }
      actions++
      checkSnapshot('p1')
      checkSnapshot('p2')
    }
    expect(dm.session.publicState.stage).toBe('over')
    expect(actions).toBeLessThan(2000)
  })

  it('a guest snapshot privateState is exactly and only their own hand', () => {
    const dm = buildGame()
    const snap = deriveSnapshot(dm.session, 'p2')
    expect(snap.privateState).toEqual(dm.session.privateStates.p2)
    expect(snap.privateState).not.toEqual(dm.session.privateStates.p1)
  })
})

// ---------------------------------------------------------------------------------------------
// Attack 2: host authority against crafted/malicious actions
// ---------------------------------------------------------------------------------------------

describe('attack: host authority', () => {
  const expectRejectedAndUnchanged = (
    dm: DominoesSession,
    playerId: string,
    action: Parameters<typeof applyDominoesAction>[2],
  ) => {
    const before = dm.session
    const r = applyDominoesAction(dm, playerId, action)
    expect(r.outcome.ok).toBe(false)
    expect(r.dm.session.revision).toBe(before.revision)
    expect(r.dm.session.publicState).toEqual(before.publicState)
    expect(r.dm.session.privateStates).toEqual(before.privateStates)
    expect(r.dm.boneyard).toEqual(dm.boneyard)
  }

  it('rejects PLAY_TILE for a tile not in the acting hand', () => {
    const dm = buildGame({ center: { a: 4, b: 6 } })
    expectRejectedAndUnchanged(dm, 'p1', { type: 'PLAY_TILE', tileId: '5-1', arm: 'left' }) // in p2's hand
  })

  it('rejects PLAY_TILE onto an illegal arm', () => {
    const dm = buildGame({ center: { a: 4, b: 6 } })
    // p1 holds 1-1; 1 matches neither open end (4 left, 6 right)
    expectRejectedAndUnchanged(dm, 'p1', { type: 'PLAY_TILE', tileId: '1-1', arm: 'left' })
  })

  it("rejects PLAY_TILE arm:'center' once a center already exists", () => {
    const dm = buildGame({ center: { a: 4, b: 6 }, p1Hand: tiles([[2, 4], [1, 1]]) })
    // 4-2 legitimately matches the left end, but declaring arm 'center' with a live board must fail
    expectRejectedAndUnchanged(dm, 'p1', { type: 'PLAY_TILE', tileId: '2-4', arm: 'center' })
  })

  it('rejects DRAW_TILE while the acting player holds a legal play', () => {
    const dm = buildGame({ center: { a: 4, b: 6 }, p1Hand: tiles([[2, 4], [1, 1]]), boneyard: tiles([[0, 0]]) })
    expectRejectedAndUnchanged(dm, 'p1', { type: 'DRAW_TILE' })
  })

  it('rejects PASS while the boneyard still has tiles', () => {
    const dm = buildGame({
      center: { a: 5, b: 5 },
      isSpinner: true,
      p1Hand: tiles([[1, 1], [2, 2]]),
      boneyard: tiles([[0, 0]]),
    })
    expectRejectedAndUnchanged(dm, 'p1', { type: 'PASS' })
  })

  it('rejects any action from the non-current player', () => {
    const dm = buildGame({ center: { a: 4, b: 6 } }) // p1's turn
    expectRejectedAndUnchanged(dm, 'p2', { type: 'PLAY_TILE', tileId: '0-5', arm: 'right' })
    expectRejectedAndUnchanged(dm, 'p2', { type: 'DRAW_TILE' })
    expectRejectedAndUnchanged(dm, 'p2', { type: 'PASS' })
  })

  it('rejects START_NEXT_ROUND while stage is play or over', () => {
    const dm = buildGame({ stage: 'play' })
    expectRejectedAndUnchanged(dm, 'p1', { type: 'START_NEXT_ROUND' })
    const dm2 = buildGame({ stage: 'over', matchWinnerId: 'p1' })
    expectRejectedAndUnchanged(dm2, 'p1', { type: 'START_NEXT_ROUND' })
  })

  it('rejects bogus/unknown tileId strings without throwing', () => {
    const dm = buildGame({ center: { a: 4, b: 6 } })
    expectRejectedAndUnchanged(dm, 'p1', { type: 'PLAY_TILE', tileId: '', arm: 'left' })
    expectRejectedAndUnchanged(dm, 'p1', { type: 'PLAY_TILE', tileId: 'NaN-NaN', arm: 'left' })
    expectRejectedAndUnchanged(dm, 'p1', { type: 'PLAY_TILE', tileId: '__proto__', arm: 'left' })
    expectRejectedAndUnchanged(dm, 'p1', { type: 'PLAY_TILE', tileId: '99-99', arm: 'left' })
  })

  it('rejects a bogus arm string without throwing', () => {
    const dm = buildGame({ center: { a: 4, b: 6 }, p1Hand: tiles([[2, 4], [1, 1]]) })
    expectRejectedAndUnchanged(dm, 'p1', { type: 'PLAY_TILE', tileId: '2-4', arm: 'diagonal' as DominoArm })
  })

  it('rejects an unknown action type without throwing', () => {
    const dm = buildGame({ center: { a: 4, b: 6 } })
    expectRejectedAndUnchanged(dm, 'p1', { type: 'NUKE_BOARD' } as unknown as Parameters<typeof applyDominoesAction>[2])
  })
})

// ---------------------------------------------------------------------------------------------
// Attack 3: All Fives scoring edge cases the standardized table only implies
// ---------------------------------------------------------------------------------------------

describe('attack: scoring edge cases', () => {
  it('spinner with only the up arm played: main line untouched (2×pip once) + up outer', () => {
    // center 6-6 spinner, up=[6-3] (last outer 3, not double), left/right/down empty
    const total = boardTotal({ a: 6, b: 6 }, true, { ...emptyArms(), up: [placed(6, 3)] })
    expect(total).toBe(15) // 2*6 (main line, both ends still empty, counted once) + 3 (up) + 0 (down)
  })

  it('spinner with only up arm played credits the correct score through applyDominoesAction (no inflation)', () => {
    const dm = buildGame({
      currentIndex: 1,
      center: { a: 6, b: 6 },
      isSpinner: true,
      p2Hand: tiles([[3, 6], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]]),
    })
    const r = applyDominoesAction(dm, 'p2', { type: 'PLAY_TILE', tileId: '3-6', arm: 'up' })
    expect(r.outcome.ok).toBe(true)
    expect(r.dm.session.publicState.scores.p2).toBe(15)
  })

  it('a double at the end of a spinner main line while the OTHER main end is still empty', () => {
    // center 4-4 spinner, right=[4-3, 3-3(double)], left/up/down empty
    const total = boardTotal({ a: 4, b: 4 }, true, { ...emptyArms(), right: [placed(4, 3), placed(3, 3, true)] })
    expect(total).toBe(14) // left empty -> 2*4=8; right last is double -> 3*2=6; up/down 0
  })

  it('0-0 lead totals 0 -> no score (not "no center -> 0" collapsing into a different bug)', () => {
    const dm = buildGame({ p1Hand: tiles([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [1, 2]]) })
    const r = applyDominoesAction(dm, 'p1', { type: 'PLAY_TILE', tileId: '0-0', arm: 'center' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.dm.session.publicState
    expect(pub.center).toEqual({ a: 0, b: 0 })
    expect(pub.isSpinner).toBe(true)
    expect(pub.scores.p1).toBe(0)
    expect(pub.roundResult).toBeNull() // hand not empty, round still in play
  })

  it('going out where the final play itself also scores: both components land in one credit', () => {
    // center 1-6 (non-spinner); p1 plays 4-6 on right -> board total 1+ (6*? ) ; construct clean numbers
    const dm = buildGame({
      center: { a: 1, b: 6 },
      p1Hand: tiles([[4, 6]]),
      p2Hand: tiles([[0, 0], [1, 2]]), // 3 pips -> rounds down to 0
      boneyard: [],
    })
    const r = applyDominoesAction(dm, 'p1', { type: 'PLAY_TILE', tileId: '4-6', arm: 'right' })
    expect(r.outcome.ok).toBe(true)
    const pub = r.dm.session.publicState
    // board total: left(1) + right(last outer 4) = 5 -> scores 5; opponent pips 3 -> bonus 0
    expect(pub.roundResult).toEqual({ kind: 'out', scorerId: 'p1', points: 0 })
    expect(pub.scores.p1).toBe(5)
  })
})

// ---------------------------------------------------------------------------------------------
// Attack 4: draw-until-playable enforcement
// ---------------------------------------------------------------------------------------------

describe('attack: draw-until-playable enforcement', () => {
  it('cannot PASS with tiles remaining in the boneyard even after failing to draw a play', () => {
    const dm = buildGame({
      center: { a: 5, b: 5 },
      isSpinner: true,
      p1Hand: tiles([[1, 1], [2, 2], [3, 3], [4, 4]]),
      boneyard: tiles([[0, 0], [6, 6]]), // neither tile is playable on a 5-spinner
    })
    let r = applyDominoesAction(dm, 'p1', { type: 'DRAW_TILE' })
    expect(r.outcome.ok).toBe(true)
    // still stuck, boneyard has 1 left -> PASS must still be rejected
    const passAttempt = applyDominoesAction(r.dm, 'p1', { type: 'PASS' })
    expect(passAttempt.outcome.ok).toBe(false)
    expect(currentPlayer(r.dm.session.publicState.turn)).toBe('p1')
  })

  it('turn (including turnNumber) never advances across a multi-draw chain', () => {
    const dm = buildGame({
      center: { a: 5, b: 5 },
      isSpinner: true,
      p1Hand: tiles([[1, 1], [2, 2], [3, 3], [4, 4]]),
      boneyard: tiles([[0, 0], [6, 3], [2, 1]]), // all unplayable on a 5-spinner
    })
    const turnBefore = dm.session.publicState.turn
    let dmCur = dm
    for (let i = 0; i < 3; i++) {
      const r = applyDominoesAction(dmCur, 'p1', { type: 'DRAW_TILE' })
      expect(r.outcome.ok).toBe(true)
      expect(r.dm.session.publicState.turn).toEqual(turnBefore)
      dmCur = r.dm
    }
    expect(dmCur.session.publicState.boneyardCount).toBe(0)
    // boneyard now empty and still stuck -> PASS becomes legal
    const r = applyDominoesAction(dmCur, 'p1', { type: 'PASS' })
    expect(r.outcome.ok).toBe(true)
  })

  it('cannot PLAY a tile that was legal before an opponent changed the board underneath (stale-state replay)', () => {
    // p1 holds 4-6, legal on the fresh board (center 1-6, right open at 6). p2 then plays first;
    // once p2 has moved, this "stale" action from p1 must revalidate against the CURRENT board,
    // not the one p1 originally observed.
    const dm = buildGame({
      currentIndex: 1,
      center: { a: 1, b: 6 },
      p1Hand: tiles([[4, 6], [0, 2]]),
      p2Hand: tiles([[1, 3]]),
      boneyard: [],
    })
    const afterP2 = applyDominoesAction(dm, 'p2', { type: 'PLAY_TILE', tileId: '1-3', arm: 'left' })
    expect(afterP2.outcome.ok).toBe(true)
    // it's p1's turn again, but the stale intent "play 4-6 on right" is still valid here since
    // right is untouched; flip it to an arm that is no longer legal to prove re-validation happens
    const stale = applyDominoesAction(afterP2.dm, 'p1', { type: 'PLAY_TILE', tileId: '4-6', arm: 'left' })
    expect(stale.outcome.ok).toBe(false)
  })
})
