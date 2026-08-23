import type { SolitaireState, SolitaireLoc, SolitaireMove, MoveOutcome } from './state.ts'
import { SPIDER_FAMILY } from './state.ts'
import { applyMove, findFoundationMove, autoCompleteMoves, legalDestinations } from './shared.ts'
import { applySpiderMove, spiderLegalDestinations } from './spider.ts'

function isSpiderFamily(mode: SolitaireState['mode']): boolean {
  return (SPIDER_FAMILY as string[]).includes(mode)
}

export function applyAnyMove(state: SolitaireState, move: SolitaireMove): MoveOutcome {
  return isSpiderFamily(state.mode) ? applySpiderMove(state, move) : applyMove(state, move)
}

export function anyLegalDestinations(state: SolitaireState, from: SolitaireLoc, count: number): SolitaireLoc[] {
  return isSpiderFamily(state.mode) ? spiderLegalDestinations(state, from, count) : legalDestinations(state, from, count)
}

// Spider has no explicit "send to foundation" move — a completed run clears
// itself automatically inside applySpiderMove — so there is nothing to shortcut.
export function findAnyFoundationMove(state: SolitaireState, from: SolitaireLoc): SolitaireMove | null {
  return isSpiderFamily(state.mode) ? null : findFoundationMove(state, from)
}

export function autoCompleteAnyMoves(state: SolitaireState): SolitaireMove[] {
  return isSpiderFamily(state.mode) ? [] : autoCompleteMoves(state)
}
