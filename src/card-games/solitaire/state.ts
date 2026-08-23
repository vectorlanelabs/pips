import type { Card } from '../../card-engine/cards.ts'
import { dealKlondike } from './klondike.ts'
import { dealFreeCell } from './freecell.ts'
import { dealSpider } from './spider.ts'
import { dealPyramid } from './pyramid.ts'

export type SolitaireMode = 'klondike' | 'klondike3' | 'freecell' | 'spider' | 'spider1' | 'pyramid'

// Modes that deal from a stock into a shared waste pile, one column-independent
// pile at a time (as opposed to spider's "deal one card to every column").
export const KLONDIKE_FAMILY: readonly SolitaireMode[] = ['klondike', 'klondike3']

// Modes sharing spider's rules engine (applySpiderMove/spiderLegalDestinations)
// — they differ only in how many suits the 104-card deck uses (1 = easiest,
// since any descending run is then guaranteed same-suit and always movable
// as a whole; 2 is the common default difficulty).
export const SPIDER_FAMILY: readonly SolitaireMode[] = ['spider', 'spider1']

export function tableauColumns(mode: SolitaireMode): number {
  switch (mode) {
    case 'klondike':
    case 'klondike3':
      return 7
    case 'freecell':
      return 8
    case 'spider':
    case 'spider1':
      return 10
    case 'pyramid':
      // Pyramid doesn't use `tableau`/`MOVE` at all (see `pyramidRows` below
      // and REMOVE_KING/REMOVE_PAIR) — never actually consulted.
      return 0
  }
}

export interface SolitaireState {
  mode: SolitaireMode
  seed: number
  tableau: Card[][]        // klondike(3): 7 columns; freecell: 8; spider: 10. index 0 = bottom, last = top.
                           // pyramid: unused ([]) — see `pyramidRows`.
  faceUp: number[]         // per column: how many cards at the TOP (end) of the column are face up.
                           // freecell: always equals tableau[i].length. klondike(3)/spider: ≥1 whenever
                           // the column is non-empty (the rules never leave a face-down top card).
                           // pyramid: unused ([]).
  foundations: Card[][]    // klondike(3)/freecell: exactly 4, in SUITS order, index 0 = A. spider: grows
                           // up to 8 as complete same-suit K→A runs are cleared off the tableau, one
                           // array per cleared run — order and length beyond 8 have no meaning.
                           // pyramid: unused ([]).
  stock: Card[]            // klondike(3)/pyramid: the draw pile, last = top. spider: the un-dealt reserve,
                           // dealt ACROSS all columns at once rather than into a waste. freecell: unused ([]).
  waste: Card[]            // klondike(3)/pyramid: last = top, the only waste card in play. freecell/spider: unused ([]).
  cells: (Card | null)[]   // freecell only: exactly 4. klondike(3)/spider/pyramid: unused ([]).
  pyramidRows: (Card | null)[][] // pyramid only: row r has r+1 slots (row 0 = apex, row 6 = base), null
                           // marks a removed card. Every other mode: unused ([]).
  moves: number            // successful DRAW + MOVE/REMOVE_KING/REMOVE_PAIR count
  won: boolean             // klondike(3)/freecell: every foundation holds 13. spider: 8 completed runs.
                           // pyramid: every pyramidRows slot is null.
}

export type SolitaireLoc =
  | { kind: 'tableau'; index: number }
  | { kind: 'foundation'; index: number }
  | { kind: 'waste' }
  | { kind: 'cell'; index: number }
  | { kind: 'pyramid'; row: number; col: number }

export type SolitaireMove =
  | { type: 'DRAW' }                                                  // klondike(3)/pyramid: stock -> waste.
                                                                        // spider: deal one row across all columns.
  | { type: 'MOVE'; from: SolitaireLoc; to: SolitaireLoc; count: number }
  | { type: 'REMOVE_KING'; loc: SolitaireLoc }                        // pyramid only: a King clears alone.
  | { type: 'REMOVE_PAIR'; a: SolitaireLoc; b: SolitaireLoc }         // pyramid only: two cards summing to 13.

export type MoveOutcome =
  | { ok: true; state: SolitaireState }
  | { ok: false; reason: string }

export function createSolitaireGame(mode: SolitaireMode, seed: number): SolitaireState {
  if (mode === 'klondike' || mode === 'klondike3') {
    return dealKlondike(seed, mode)
  } else if (mode === 'freecell') {
    return dealFreeCell(seed)
  } else if (mode === 'pyramid') {
    return dealPyramid(seed)
  } else {
    return dealSpider(seed, mode)
  }
}
