import type { Card } from '../../card-engine/cards.ts'
import { SUITS, RANKS } from '../../card-engine/cards.ts'
import type { SolitaireState, SolitaireLoc, SolitaireMove, MoveOutcome } from './state.ts'
import { KLONDIKE_FAMILY, tableauColumns } from './state.ts'
import { maxMovableCards } from './freecell.ts'

function isKlondikeFamily(mode: SolitaireState['mode']): boolean {
  return (KLONDIKE_FAMILY as string[]).includes(mode)
}

export function rankIndex(card: Card): number {
  return RANKS.indexOf(card.rank)
}

export function isRed(card: Card): boolean {
  return card.suit === 'hearts' || card.suit === 'diamonds'
}

export function foundationIndex(card: Card): number {
  return SUITS.indexOf(card.suit)
}

export function isTableauSequence(cards: Card[]): boolean {
  if (cards.length === 0) return false
  if (cards.length === 1) return true

  for (let i = 1; i < cards.length; i++) {
    const prev = cards[i - 1]
    const curr = cards[i]
    const prevRank = rankIndex(prev)
    const currRank = rankIndex(curr)

    if (currRank !== prevRank - 1) return false
    if (isRed(prev) === isRed(curr)) return false
  }

  return true
}

export function canStackOnTableau(moving: Card, onto: Card): boolean {
  const movingRank = rankIndex(moving)
  const ontoRank = rankIndex(onto)

  return movingRank === ontoRank - 1 && isRed(moving) !== isRed(onto)
}

export function canPlaceOnFoundation(card: Card, foundation: Card[], index: number): boolean {
  return foundationIndex(card) === index && rankIndex(card) === foundation.length
}

export function topOf(cards: Card[]): Card | undefined {
  return cards[cards.length - 1]
}

function locKey(loc: SolitaireLoc): string {
  return loc.kind === 'waste' ? 'waste' : `${loc.kind}:${loc.index}`
}

export function applyMove(state: SolitaireState, move: SolitaireMove): MoveOutcome {
  if (move.type === 'DRAW') {
    if (!isKlondikeFamily(state.mode)) {
      return { ok: false, reason: 'DRAW only in klondike' }
    }

    const newState = { ...state }

    if (state.stock.length > 0) {
      // Draw 1 (klondike) or up to 3 (klondike3) cards, chronologically:
      // the top of the stock is drawn FIRST, so it ends up buried under
      // any cards drawn after it — the LAST card drawn is the one on top
      // of the waste and the only one actually playable.
      const drawCount = state.mode === 'klondike3' ? 3 : 1
      const n = Math.min(drawCount, state.stock.length)
      const drawnChronological = state.stock.slice(state.stock.length - n).reverse()
      newState.stock = state.stock.slice(0, state.stock.length - n)
      newState.waste = [...state.waste, ...drawnChronological]
    } else if (state.waste.length > 0) {
      newState.stock = [...state.waste].reverse()
      newState.waste = []
    } else {
      return { ok: false, reason: 'nothing to draw' }
    }

    newState.moves = state.moves + 1
    return { ok: true, state: newState }
  }

  const { from, to, count } = move

  if (!Number.isInteger(count) || count < 1) {
    return { ok: false, reason: 'count must be a positive integer' }
  }

  if (locKey(from) === locKey(to)) {
    return { ok: false, reason: 'from and to must be different' }
  }

  if (to.kind === 'waste') {
    return { ok: false, reason: 'nothing moves onto the waste' }
  }

  let sourceCards: Card[]

  if (from.kind === 'waste') {
    if (!isKlondikeFamily(state.mode)) {
      return { ok: false, reason: 'waste only in klondike' }
    }
    if (count !== 1) {
      return { ok: false, reason: 'waste move count must be 1' }
    }
    if (state.waste.length === 0) {
      return { ok: false, reason: 'waste is empty' }
    }
    sourceCards = [topOf(state.waste)!]
  } else if (from.kind === 'cell') {
    if (state.mode !== 'freecell') {
      return { ok: false, reason: 'cell only in freecell' }
    }
    if (!Number.isInteger(from.index)) {
      return { ok: false, reason: 'cell index out of range' }
    }
    if (from.index < 0 || from.index > 3) {
      return { ok: false, reason: 'cell index out of range' }
    }
    if (count !== 1) {
      return { ok: false, reason: 'cell move count must be 1' }
    }
    if (state.cells[from.index] === null) {
      return { ok: false, reason: 'cell is empty' }
    }
    sourceCards = [state.cells[from.index]!]
  } else if (from.kind === 'foundation') {
    if (!Number.isInteger(from.index)) {
      return { ok: false, reason: 'foundation index out of range' }
    }
    if (from.index < 0 || from.index > 3) {
      return { ok: false, reason: 'foundation index out of range' }
    }
    if (count !== 1) {
      return { ok: false, reason: 'foundation move count must be 1' }
    }
    if (state.foundations[from.index].length === 0) {
      return { ok: false, reason: 'foundation is empty' }
    }
    sourceCards = [topOf(state.foundations[from.index])!]
  } else if (from.kind === 'tableau') {
    if (!Number.isInteger(from.index)) {
      return { ok: false, reason: 'tableau index out of range' }
    }
    const maxCol = tableauColumns(state.mode)
    if (from.index < 0 || from.index >= maxCol) {
      return { ok: false, reason: 'tableau index out of range' }
    }
    if (state.tableau[from.index].length === 0) {
      return { ok: false, reason: 'tableau column is empty' }
    }
    if (count > state.faceUp[from.index]) {
      return { ok: false, reason: 'count exceeds face-up cards' }
    }
    const start = state.tableau[from.index].length - count
    sourceCards = state.tableau[from.index].slice(start)

    if (!isTableauSequence(sourceCards)) {
      return { ok: false, reason: 'cards do not form a valid sequence' }
    }
  } else {
    return { ok: false, reason: 'invalid source' }
  }

  const sourceCard = sourceCards[0]

  if (to.kind === 'cell') {
    if (state.mode !== 'freecell') {
      return { ok: false, reason: 'cell only in freecell' }
    }
    if (!Number.isInteger(to.index)) {
      return { ok: false, reason: 'cell index out of range' }
    }
    if (to.index < 0 || to.index > 3) {
      return { ok: false, reason: 'cell index out of range' }
    }
    if (count !== 1) {
      return { ok: false, reason: 'can only move 1 card to a cell' }
    }
    if (state.cells[to.index] !== null) {
      return { ok: false, reason: 'cell is occupied' }
    }
  } else if (to.kind === 'foundation') {
    if (!Number.isInteger(to.index)) {
      return { ok: false, reason: 'foundation index out of range' }
    }
    if (to.index < 0 || to.index > 3) {
      return { ok: false, reason: 'foundation index out of range' }
    }
    if (count !== 1) {
      return { ok: false, reason: 'can only move 1 card to foundation' }
    }
    if (!canPlaceOnFoundation(sourceCard, state.foundations[to.index], to.index)) {
      return { ok: false, reason: 'card cannot be placed on foundation' }
    }
  } else if (to.kind === 'tableau') {
    if (!Number.isInteger(to.index)) {
      return { ok: false, reason: 'tableau index out of range' }
    }
    const maxCol = tableauColumns(state.mode)
    if (to.index < 0 || to.index >= maxCol) {
      return { ok: false, reason: 'tableau index out of range' }
    }

    if (state.tableau[to.index].length === 0) {
      if (isKlondikeFamily(state.mode)) {
        if (rankIndex(sourceCard) !== 12) {
          return { ok: false, reason: 'only Kings can be placed on empty columns in klondike' }
        }
      }
    } else {
      const topCard = topOf(state.tableau[to.index])!
      if (!canStackOnTableau(sourceCard, topCard)) {
        return { ok: false, reason: 'card cannot be stacked on tableau' }
      }
    }

    if (state.mode === 'freecell' && count > maxMovableCards(state, state.tableau[to.index].length === 0)) {
      return { ok: false, reason: 'supermove cap exceeded' }
    }
  }

  const newState: SolitaireState = {
    ...state,
    tableau: state.tableau.map((col) => [...col]),
    faceUp: [...state.faceUp],
    foundations: state.foundations.map((f) => [...f]),
    stock: [...state.stock],
    waste: [...state.waste],
    cells: state.cells.map((c) => c) as (Card | null)[],
  }

  if (from.kind === 'waste') {
    newState.waste = state.waste.slice(0, -1)
  } else if (from.kind === 'cell') {
    newState.cells[from.index] = null
  } else if (from.kind === 'foundation') {
    newState.foundations[from.index] = state.foundations[from.index].slice(0, -1)
  } else if (from.kind === 'tableau') {
    newState.tableau[from.index] = state.tableau[from.index].slice(0, state.tableau[from.index].length - count)

    if (isKlondikeFamily(state.mode)) {
      if (newState.tableau[from.index].length === 0) {
        newState.faceUp[from.index] = 0
      } else if (count === state.faceUp[from.index]) {
        newState.faceUp[from.index] = 1
      } else {
        newState.faceUp[from.index] -= count
      }
    } else {
      newState.faceUp[from.index] = newState.tableau[from.index].length
    }
  }

  if (to.kind === 'cell') {
    newState.cells[to.index] = sourceCard
  } else if (to.kind === 'foundation') {
    newState.foundations[to.index] = [...state.foundations[to.index], sourceCard]
  } else if (to.kind === 'tableau') {
    newState.tableau[to.index] = [...state.tableau[to.index], ...sourceCards]
    newState.faceUp[to.index] += count

    if (state.mode === 'freecell') {
      newState.faceUp[to.index] = newState.tableau[to.index].length
    }
  }

  newState.moves = state.moves + 1
  newState.won = newState.foundations.every((f) => f.length === 13)

  return { ok: true, state: newState }
}

export function findFoundationMove(state: SolitaireState, from: SolitaireLoc): SolitaireMove | null {
  let card: Card | null | undefined = undefined

  if (from.kind === 'waste') {
    if (state.waste.length === 0) return null
    card = topOf(state.waste)
  } else if (from.kind === 'cell') {
    card = state.cells[from.index]
  } else if (from.kind === 'foundation') {
    return null
  } else if (from.kind === 'tableau') {
    if (state.tableau[from.index].length === 0) return null
    card = topOf(state.tableau[from.index])
  }

  if (!card) return null

  const foundIdx = foundationIndex(card)
  if (canPlaceOnFoundation(card, state.foundations[foundIdx], foundIdx)) {
    return {
      type: 'MOVE',
      from,
      to: { kind: 'foundation', index: foundIdx },
      count: 1,
    }
  }

  return null
}

// Every currently-face-up top card that could be a move source: the waste top
// (klondike), each occupied cell (freecell), and each tableau column's top card.
function foundationSources(state: SolitaireState): SolitaireLoc[] {
  const sources: SolitaireLoc[] = []
  if (isKlondikeFamily(state.mode) && state.waste.length > 0) sources.push({ kind: 'waste' })
  if (state.mode === 'freecell') {
    for (let i = 0; i < state.cells.length; i++) {
      if (state.cells[i] !== null) sources.push({ kind: 'cell', index: i })
    }
  }
  for (let i = 0; i < state.tableau.length; i++) {
    if (state.tableau[i].length > 0) sources.push({ kind: 'tableau', index: i })
  }
  return sources
}

// Repeatedly sends any top card that has a legal foundation move there, until
// no more exist. Terminates because each successful move removes one card
// from play (bounded by the 52-card deck); returns the moves in the order
// they'd need to be applied, not the final state, so a caller can dispatch
// them one at a time through its own reducer.
export function autoCompleteMoves(state: SolitaireState): SolitaireMove[] {
  const moves: SolitaireMove[] = []
  let current = state
  let progressed = true

  while (progressed) {
    progressed = false
    for (const loc of foundationSources(current)) {
      const move = findFoundationMove(current, loc)
      if (!move) continue
      const outcome = applyMove(current, move)
      if (!outcome.ok) continue
      moves.push(move)
      current = outcome.state
      progressed = true
      break
    }
  }

  return moves
}

export function legalDestinations(state: SolitaireState, from: SolitaireLoc, count: number): SolitaireLoc[] {
  const destinations: SolitaireLoc[] = []

  const maxCol = tableauColumns(state.mode)
  for (let i = 0; i < maxCol; i++) {
    const move: SolitaireMove = {
      type: 'MOVE',
      from,
      to: { kind: 'tableau', index: i },
      count,
    }
    if (applyMove(state, move).ok) {
      destinations.push({ kind: 'tableau', index: i })
    }
  }

  for (let i = 0; i < 4; i++) {
    const move: SolitaireMove = {
      type: 'MOVE',
      from,
      to: { kind: 'foundation', index: i },
      count,
    }
    if (applyMove(state, move).ok) {
      destinations.push({ kind: 'foundation', index: i })
    }
  }

  if (state.mode === 'freecell') {
    for (let i = 0; i < 4; i++) {
      const move: SolitaireMove = {
        type: 'MOVE',
        from,
        to: { kind: 'cell', index: i },
        count,
      }
      if (applyMove(state, move).ok) {
        destinations.push({ kind: 'cell', index: i })
      }
    }
  }

  return destinations
}
