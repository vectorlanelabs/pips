import type { SolitaireState, SolitaireLoc, SolitaireMove, MoveOutcome } from './state.ts'
import { applyMove, findFoundationMove, autoCompleteMoves, legalDestinations } from './shared.ts'
import { applySpiderMove, spiderLegalDestinations } from './spider.ts'

export function applyAnyMove(state: SolitaireState, move: SolitaireMove): MoveOutcome {
  return state.mode === 'spider' ? applySpiderMove(state, move) : applyMove(state, move)
}

export function anyLegalDestinations(state: SolitaireState, from: SolitaireLoc, count: number): SolitaireLoc[] {
  return state.mode === 'spider' ? spiderLegalDestinations(state, from, count) : legalDestinations(state, from, count)
}

// Spider has no explicit "send to foundation" move — a completed run clears
// itself automatically inside applySpiderMove — so there is nothing to shortcut.
export function findAnyFoundationMove(state: SolitaireState, from: SolitaireLoc): SolitaireMove | null {
  return state.mode === 'spider' ? null : findFoundationMove(state, from)
}

export function autoCompleteAnyMoves(state: SolitaireState): SolitaireMove[] {
  return state.mode === 'spider' ? [] : autoCompleteMoves(state)
}
