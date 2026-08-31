import type { Card } from '../../card-engine/cards.ts'
import type { PhaseRequirement } from './phases.ts'

export type GroupType = 'set' | 'run' | 'color'

export interface PhaseGroup {
  type: GroupType
  cards: Card[]
}

// Orders a valid run's cards for display: naturals ascending by rank, with
// each Wild placed at the exact gap position it fills. Wilds beyond what's
// needed to fill internal gaps are pure range-extensions with no single
// correct side — split them deterministically, floor(extra/2) before the
// naturals and the rest after. Deterministic and stable: the same card set
// always produces the same order, unlike the broken NaN-comparator sort it
// replaces.
//
// `cards` is not guaranteed to be a complete, self-contained valid run: a
// caller may pass only a subset (e.g. a group's own zone plus same-player
// hits, excluding another player's cross-hits that also target the same
// group and fill some of its gaps — see Phase10Table's GroupCluster
// callers). A gap in THIS subset may therefore have no natural or wild
// available to fill it even though the true full accumulated group (per
// fullGroupCards) is valid. Silently skip an unfillable gap rather than
// indexing wilds[] out of bounds and returning `undefined` in the array —
// that undefined previously reached callers' `.map(card => card.id)` and
// crashed the whole screen.
export function orderRunForDisplay(cards: Card[]): Card[] {
  const naturals = cards.filter((c) => c.meta?.kind === 'number').sort((a, b) => Number(a.rank) - Number(b.rank))
  const wilds = cards.filter((c) => c.meta?.kind !== 'number')
  if (naturals.length === 0) return wilds
  const minNum = Number(naturals[0].rank)
  const maxNum = Number(naturals[naturals.length - 1].rank)
  const byValue = new Map(naturals.map((c) => [Number(c.rank), c]))
  const filled: Card[] = []
  let wildIdx = 0
  for (let v = minNum; v <= maxNum; v++) {
    const natural = byValue.get(v)
    if (natural) {
      filled.push(natural)
    } else if (wildIdx < wilds.length) {
      filled.push(wilds[wildIdx++])
    }
  }
  const extra = wilds.slice(wildIdx)
  const before = Math.floor(extra.length / 2)
  return [...extra.slice(0, before), ...filled, ...extra.slice(before)]
}

// Orders a valid color group's cards for display: naturals ascending by
// rank, then any Wilds appended at the end. A color group has no run
// semantic (no "gap" a Wild fills), so this is simpler than orderRunForDisplay
// — just deterministic instead of NaN-driven.
export function orderColorGroupForDisplay(cards: Card[]): Card[] {
  const naturals = cards.filter((c) => c.meta?.kind === 'number').sort((a, b) => Number(a.rank) - Number(b.rank))
  const wilds = cards.filter((c) => c.meta?.kind !== 'number')
  return [...naturals, ...wilds]
}

// True iff at least 2 cards, at least one natural (kind === 'number'), and every
// natural shares the same rank. Wilds impose no constraint (they always fit);
// a group made entirely of wilds is NOT valid.
export function isValidSet(cards: Card[]): boolean {
  const naturals = cards.filter((c) => c.meta?.kind === 'number')
  const wildCount = cards.filter((c) => c.meta?.kind === 'wild').length
  if (naturals.length + wildCount !== cards.length) return false
  if (cards.length < 2) return false
  if (naturals.length === 0) return false
  const firstRank = naturals[0].rank
  return naturals.every((c) => c.rank === firstRank)
}

// The [min,max] rank span already established by a run's naturals, or null if
// the run has no naturals yet (nothing pins any Wild to a value yet). Every
// rank inside this span is necessarily already occupied — by a natural, or by
// a Wild filling that gap — since the run is valid. Used to lock a Wild's
// implied value in place: once a Wild is filling gap N in a laid-down run, no
// later HIT may add a natural N and bump it loose to represent something
// else. Only extending the range below min or above max is still open.
export function runLockedRange(cards: Card[]): { min: number; max: number } | null {
  const numbers = cards.filter((c) => c.meta?.kind === 'number').map((c) => Number(c.rank))
  if (numbers.length === 0) return null
  return { min: Math.min(...numbers), max: Math.max(...numbers) }
}

// True iff a contiguous run of consecutive integers in [1,12] (no wraparound)
// can be formed using every card, with wilds filling any gaps or extending
// either end.
export function isValidRun(cards: Card[]): boolean {
  const naturals = cards.filter((c) => c.meta?.kind === 'number')
  const wildCount = cards.filter((c) => c.meta?.kind === 'wild').length
  if (naturals.length + wildCount !== cards.length) return false

  // A run can't repeat a number.
  const seen = new Set<string>()
  for (const c of naturals) {
    if (seen.has(c.rank)) return false
    seen.add(c.rank)
  }

  // All-wild: any run of that length fits inside 1..12 for Phase 10's max run of 9.
  if (naturals.length === 0) {
    return cards.length >= 1 && cards.length <= 12
  }

  const numbers = naturals.map((c) => Number(c.rank))
  const minNum = Math.min(...numbers)
  const maxNum = Math.max(...numbers)

  const span = maxNum - minNum + 1
  if (span > cards.length) return false

  const gapsToFill = span - naturals.length
  if (gapsToFill > wildCount) return false

  const extraWilds = wildCount - gapsToFill
  const roomBefore = minNum - 1
  const roomAfter = 12 - maxNum
  return extraWilds <= roomBefore + roomAfter
}

// True iff at least 1 card, at least one natural, and every natural shares the
// same suit (color). Wilds fit any color.
export function isValidColorGroup(cards: Card[]): boolean {
  const naturals = cards.filter((c) => c.meta?.kind === 'number')
  const wildCount = cards.filter((c) => c.meta?.kind === 'wild').length
  if (naturals.length + wildCount !== cards.length) return false
  if (cards.length < 1) return false
  if (naturals.length === 0) return false
  const firstSuit = naturals[0].suit
  return naturals.every((c) => c.suit === firstSuit)
}

// The single source of truth for "may these hand cards extend this laid group?"
// Used by the rules' HIT validator, the bot's hit search, AND the table UI's
// hit-eligibility check — all three previously re-derived legality from the bare
// isValid* predicates and missed the runLockedRange rule, which let the bot
// propose (and the UI offer) hits the validator then rejected. A bot whose
// proposal is rejected re-proposes the identical move forever and freezes, so
// legality must come from exactly one place.
export function validateGroupExtension(
  currentFull: Card[],
  type: GroupType,
  cards: Card[],
): { ok: true } | { ok: false; reason: string } {
  if (cards.some((c) => c.meta?.kind === 'skip')) {
    return { ok: false, reason: 'a Skip card cannot be used in a phase' }
  }
  // A run's already-established range is off-limits to new naturals: every rank
  // in it is already covered (by a natural, or by a Wild filling that gap), so a
  // new natural landing in-range would silently evict a Wild from the slot it
  // was locked into — see runLockedRange.
  if (type === 'run') {
    const locked = runLockedRange(currentFull)
    if (locked) {
      const intruder = cards.find((c) => c.meta?.kind === 'number' && Number(c.rank) >= locked.min && Number(c.rank) <= locked.max)
      if (intruder) return { ok: false, reason: 'that number is already covered by a Wild in this run' }
    }
  }
  const combined = [...currentFull, ...cards]
  const valid =
    type === 'set' ? isValidSet(combined)
    : type === 'run' ? isValidRun(combined)
    : isValidColorGroup(combined)
  if (!valid) return { ok: false, reason: 'those cards cannot be added to that group' }
  return { ok: true }
}

// Exact-count wrapper: the group must have exactly `exactCount` cards AND pass
// the matching isValid* predicate.
export function classifyGroup(cards: Card[], type: GroupType, exactCount: number): boolean {
  if (cards.length !== exactCount) return false
  switch (type) {
    case 'set':
      return isValidSet(cards)
    case 'run':
      return isValidRun(cards)
    case 'color':
      return isValidColorGroup(cards)
  }
}

export function classifyPhaseHand(
  cards: Card[],
  requirement: PhaseRequirement,
): { valid: boolean; groups?: PhaseGroup[] } {
  const total = requirement.parts.reduce((sum, p) => sum + p.count, 0)
  if (cards.length !== total) {
    return { valid: false }
  }

  if (requirement.parts.length === 1) {
    const part = requirement.parts[0]
    if (classifyGroup(cards, part.type, part.count)) {
      return { valid: true, groups: [{ type: part.type, cards }] }
    }
    return { valid: false }
  }

  // Two parts: try every size-`count` subset of `cards` as group0; group1 is the
  // remaining cards. Hand-relevant sizes are ~8-9 cards, so brute force is fine.
  const part0 = requirement.parts[0]
  const part1 = requirement.parts[1]
  for (const group0 of combinations(cards, part0.count)) {
    const group0Ids = new Set(group0.map((c) => c.id))
    const group1 = cards.filter((c) => !group0Ids.has(c.id))
    if (classifyGroup(group0, part0.type, part0.count) && classifyGroup(group1, part1.type, part1.count)) {
      return {
        valid: true,
        groups: [
          { type: part0.type, cards: group0 },
          { type: part1.type, cards: group1 },
        ],
      }
    }
  }
  return { valid: false }
}

function combinations<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  const indices: number[] = []
  function build(start: number): void {
    if (indices.length === size) {
      result.push(indices.map((i) => items[i]))
      return
    }
    const remaining = size - indices.length
    for (let i = start; i <= items.length - remaining; i++) {
      indices.push(i)
      build(i + 1)
      indices.pop()
    }
  }
  build(0)
  return result
}
