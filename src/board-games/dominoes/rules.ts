import type { ActionOutcome, ActionValidator } from '../../engine/sync.ts'
import { applyAction } from '../../engine/sync.ts'
import { runBotTurn, type BotStrategy } from '../../engine/bot.ts'
import { advanceTurn, currentPlayer, createTurnState } from '../../engine/turn-engine.ts'
import { moveCards, removeCardsById, topCard, cardCount, type Zone } from '../../card-engine/zones.ts'
import { boardTotal, scoreForTotal, pipSum, roundDownToFive } from './scoring.ts'
import { dealRound, endValue, legalArms, handHasLegalPlay } from './state.ts'
import type {
  DominoTile,
  DominoesAction,
  DominoesPrivateState,
  DominoesPublicState,
  DominoesRoundResult,
  DominoesSession,
  DominoesStage,
  PlacedTile,
} from './state.ts'

// Sets stage 'roundEnd' (or 'over' with a match winner) and records the round result. A round
// closes with the match only when some score is at/above target AND the scores are not equal —
// a tied ≥ target keeps playing.
function finishRound(
  publicState: DominoesPublicState,
  privateStates: Record<string, DominoesPrivateState>,
  kind: DominoesRoundResult['kind'],
  scorerId: string | null,
  points: number,
): ActionOutcome<DominoesPublicState, DominoesPrivateState> {
  const scores =
    scorerId === null
      ? publicState.scores
      : { ...publicState.scores, [scorerId]: publicState.scores[scorerId] + points }
  const seatOrder = publicState.seatOrder
  const atTarget = seatOrder.some((p) => scores[p] >= publicState.target)
  const maxScore = Math.max(...seatOrder.map((p) => scores[p]))
  const leaders = seatOrder.filter((p) => scores[p] === maxScore)
  const stage: DominoesStage = atTarget && leaders.length === 1 ? 'over' : 'roundEnd'
  const matchWinnerId = stage === 'over' ? leaders[0] : null
  return {
    ok: true,
    publicState: {
      ...publicState,
      stage,
      matchWinnerId,
      roundResult: { kind, scorerId, points },
      scores,
    },
    privateStates,
  }
}

function makeValidator(
  boneyard: Zone<DominoTile>,
  rng: () => number,
  setBoneyard: (newBoneyard: Zone<DominoTile>) => void,
): ActionValidator<DominoesPublicState, DominoesPrivateState, DominoesAction> {
  return (session, playerId, action) => {
    const { publicState, privateStates } = session

    // START_NEXT_ROUND is the one action NOT gated by "is it your turn" — either player may
    // trigger dealing a fresh round once the current one is over and the match isn't decided.
    if (action.type === 'START_NEXT_ROUND') {
      if (!Object.hasOwn(privateStates, playerId)) return { ok: false, reason: 'not a player in this match' }
      if (publicState.stage !== 'roundEnd') return { ok: false, reason: 'the round is not over' }
      const { hands, boneyard: newBoneyard } = dealRound(publicState.seatOrder, rng)
      setBoneyard(newBoneyard)
      // The next round's starter rotates through the FIXED seatOrder (never the previous round's
      // turn order) — same pattern as Rummy's START_NEXT_ROUND: build the turn fresh from
      // seatOrder, then advanceTurn exactly (roundNumber % seatOrder.length) times.
      let turn = createTurnState<'play'>(publicState.seatOrder, 'play')
      for (let i = 0; i < publicState.roundNumber % publicState.seatOrder.length; i++) turn = advanceTurn(turn, 'play')
      const starter = currentPlayer(turn)
      const handCounts: Record<string, number> = {}
      const newPrivateStates: Record<string, DominoesPrivateState> = {}
      for (const seatedPlayer of publicState.seatOrder) {
        handCounts[seatedPlayer] = cardCount(hands[seatedPlayer])
        newPrivateStates[seatedPlayer] = { hand: hands[seatedPlayer] }
      }
      return {
        ok: true,
        publicState: {
          ...publicState,
          stage: 'play',
          turn,
          center: null,
          isSpinner: false,
          arms: { right: [], left: [], up: [], down: [] },
          boneyardCount: cardCount(newBoneyard),
          handCounts,
          passStreak: 0,
          roundNumber: publicState.roundNumber + 1,
          roundStarterId: starter,
          roundResult: null,
          lastAction: null,
        },
        privateStates: newPrivateStates,
      }
    }

    if (publicState.stage !== 'play') return { ok: false, reason: 'the round is not in play' }
    if (currentPlayer(publicState.turn) !== playerId) return { ok: false, reason: 'not your turn' }

    const myHand = privateStates[playerId].hand

    if (action.type === 'PLAY_TILE') {
      const tile = myHand.cards.find((t) => t.id === action.tileId)
      if (!tile) return { ok: false, reason: 'tile not in hand' }
      const arms = legalArms(tile, publicState)
      if (!arms.includes(action.arm)) return { ok: false, reason: 'tile cannot be played there' }

      const { zone: newHand } = removeCardsById(myHand, [tile.id])

      let center = publicState.center
      let isSpinner = publicState.isSpinner
      let newArms = publicState.arms
      if (action.arm === 'center') {
        center = { a: tile.a, b: tile.b }
        isSpinner = tile.a === tile.b
      } else {
        const value = endValue(center, isSpinner, publicState.arms, action.arm)!
        const placedTile: PlacedTile = {
          inner: value,
          outer: value === tile.a ? tile.b : tile.a,
          isDouble: tile.a === tile.b,
        }
        newArms = { ...publicState.arms, [action.arm]: [...publicState.arms[action.arm], placedTile] }
      }

      const scored = scoreForTotal(boardTotal(center, isSpinner, newArms))
      const newPublicState: DominoesPublicState = {
        ...publicState,
        center,
        isSpinner,
        arms: newArms,
        handCounts: { ...publicState.handCounts, [playerId]: cardCount(newHand) },
        passStreak: 0,
        scores: { ...publicState.scores, [playerId]: publicState.scores[playerId] + scored },
        lastAction: {
          by: playerId,
          kind: action.arm === 'center' ? 'lead' : 'play',
          tile: { a: tile.a, b: tile.b },
          arm: action.arm,
          scored,
        },
      }
      const newPrivateStates = { ...privateStates, [playerId]: { hand: newHand } }

      // Going out: all other seated players' remaining pips (rounded down) are credited on top of any
      // points the final play itself scored.
      if (cardCount(newHand) === 0) {
        const opponents = publicState.seatOrder.filter((p) => p !== playerId)
        const totalPips = opponents.reduce((sum, p) => sum + pipSum(privateStates[p].hand.cards), 0)
        const points = roundDownToFive(totalPips)
        return finishRound(newPublicState, newPrivateStates, 'out', playerId, points)
      }

      return {
        ok: true,
        publicState: { ...newPublicState, turn: advanceTurn(publicState.turn, 'play') },
        privateStates: newPrivateStates,
      }
    }

    if (action.type === 'DRAW_TILE') {
      if (handHasLegalPlay(myHand.cards, publicState)) return { ok: false, reason: 'you have a legal play' }
      if (cardCount(boneyard) === 0) return { ok: false, reason: 'the boneyard is empty — pass' }
      const top = topCard(boneyard)!
      const { from: newBoneyard, to: newHand } = moveCards(boneyard, myHand, [top.id])
      setBoneyard(newBoneyard)
      // Turn unchanged — the same player keeps acting until they can play (or pass).
      return {
        ok: true,
        publicState: {
          ...publicState,
          boneyardCount: cardCount(newBoneyard),
          handCounts: { ...publicState.handCounts, [playerId]: cardCount(newHand) },
          passStreak: 0,
          lastAction: { by: playerId, kind: 'draw', tile: null, arm: null, scored: 0 },
        },
        privateStates: { ...privateStates, [playerId]: { hand: newHand } },
      }
    }

    if (action.type === 'PASS') {
      if (handHasLegalPlay(myHand.cards, publicState)) return { ok: false, reason: 'you have a legal play' }
      if (cardCount(boneyard) > 0) return { ok: false, reason: 'the boneyard is not empty — draw' }
      const newPublicState: DominoesPublicState = {
        ...publicState,
        passStreak: publicState.passStreak + 1,
        lastAction: { by: playerId, kind: 'pass', tile: null, arm: null, scored: 0 },
      }
      if (newPublicState.passStreak >= publicState.seatOrder.length) {
        // Blocked: the player with the (unique) lowest pip total scores everyone's combined
        // pips, rounded down; if the lowest is tied across 2+ players, nobody scores.
        const seatOrder = publicState.seatOrder
        const pipsByPlayer = Object.fromEntries(seatOrder.map((p) => [p, pipSum(privateStates[p].hand.cards)]))
        const minPips = Math.min(...seatOrder.map((p) => pipsByPlayer[p]))
        const lowest = seatOrder.filter((p) => pipsByPlayer[p] === minPips)
        if (lowest.length !== 1) {
          return finishRound(newPublicState, privateStates, 'blocked', null, 0)
        }
        const totalPips = seatOrder.reduce((sum, p) => sum + pipsByPlayer[p], 0)
        return finishRound(newPublicState, privateStates, 'blocked', lowest[0], roundDownToFive(totalPips))
      }
      return {
        ok: true,
        publicState: { ...newPublicState, turn: advanceTurn(publicState.turn, 'play') },
        privateStates,
      }
    }

    return { ok: false, reason: 'unknown action' }
  }
}

export function applyDominoesAction(
  dm: DominoesSession,
  playerId: string,
  action: DominoesAction,
): { dm: DominoesSession; outcome: ActionOutcome<DominoesPublicState, DominoesPrivateState> } {
  let candidateBoneyard = dm.boneyard
  const validate = makeValidator(dm.boneyard, dm.rng, (b) => { candidateBoneyard = b })
  const { session, outcome } = applyAction(dm.session, playerId, action, validate)
  const boneyard = outcome.ok ? candidateBoneyard : dm.boneyard
  return { dm: { session, boneyard, rng: dm.rng }, outcome }
}

export function runDominoesBotTurn(
  dm: DominoesSession,
  playerId: string,
  strategy: BotStrategy<DominoesPublicState, DominoesPrivateState, DominoesAction>,
): { dm: DominoesSession; outcome: ActionOutcome<DominoesPublicState, DominoesPrivateState> } {
  let candidateBoneyard = dm.boneyard
  const validate = makeValidator(dm.boneyard, dm.rng, (b) => { candidateBoneyard = b })
  const { session, outcome } = runBotTurn(dm.session, playerId, strategy, validate)
  const boneyard = outcome.ok ? candidateBoneyard : dm.boneyard
  return { dm: { session, boneyard, rng: dm.rng }, outcome }
}
