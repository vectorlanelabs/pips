import type { SolitaireState, SolitaireLoc, SolitaireMove, MoveOutcome } from './state.ts'
import { SPIDER_FAMILY } from './state.ts'
import { applyMove, findFoundationMove, autoCompleteMoves, legalDestinations } from './shared.ts'
import { applySpiderMove, spiderLegalDestinations } from './spider.ts'
import { applyPyramidMove, pyramidLegalDestinations, pyramidKingMove } from './pyramid.ts'

function isSpiderFamily(mode: SolitaireState['mode']): boolean {
  return (SPIDER_FAMILY as string[]).includes(mode)
}

export function applyAnyMove(state: SolitaireState, move: SolitaireMove): MoveOutcome {
  if (state.mode === 'pyramid') return applyPyramidMove(state, move)
  return isSpiderFamily(state.mode) ? applySpiderMove(state, move) : applyMove(state, move)
}

export function anyLegalDestinations(state: SolitaireState, from: SolitaireLoc, count: number): SolitaireLoc[] {
  if (state.mode === 'pyramid') return pyramidLegalDestinations(state, from)
  return isSpiderFamily(state.mode) ? spiderLegalDestinations(state, from, count) : legalDestinations(state, from, count)
}

// Spider has no explicit "send to foundation" move — a completed run clears
// itself automatically inside applySpiderMove — so there is nothing to
// shortcut. Pyramid's equivalent shortcut is a King clearing itself.
export function findAnyFoundationMove(state: SolitaireState, from: SolitaireLoc): SolitaireMove | null {
  if (state.mode === 'pyramid') return pyramidKingMove(state, from)
  return isSpiderFamily(state.mode) ? null : findFoundationMove(state, from)
}

export function autoCompleteAnyMoves(state: SolitaireState): SolitaireMove[] {
  return isSpiderFamily(state.mode) || state.mode === 'pyramid' ? [] : autoCompleteMoves(state)
}
