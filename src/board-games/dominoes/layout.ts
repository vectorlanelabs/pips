import type { DominoArm, PlacedTile } from './state.ts'

// Pure board geometry in unit space: 1 unit = one half-tile square (a tile is
// 2×1 units), origin = the opening tile's center, +x right, +y down. The
// screen layer multiplies by a pixel scale and centers the bounds in the pane.

export interface LaidTile {
  x: number
  y: number // center, units
  w: number
  h: number // footprint, units
  horizontal: boolean // run orientation of THIS tile (doubles: the crosswise orientation actually drawn)
  inner: number
  outer: number // pip halves; inner faces back toward the start of the arm
  isDouble: boolean
  // direction the run was travelling when this tile was placed — the screen
  // uses it to decide which half of the tile art shows `inner`
  dir: 'right' | 'left' | 'up' | 'down'
}

export interface EndTarget {
  arm: DominoArm | 'center'
  x: number
  y: number
  r: number
}

export interface BoardLayout {
  tiles: LaidTile[] // center tile first, then arms in order right,left,up,down
  targets: EndTarget[] // one per open arm (4 when spinner, 2 otherwise); single center target when no center
  minX: number
  maxX: number
  minY: number
  maxY: number // bounds over tile footprints AND targets
}

const H_MAX = 11 // horizontal travel limit from origin, units
const V_MAX = 4 // vertical travel limit from origin, units
const SPIRAL_STEP = 10 // extra units of headroom each bend past leg 0 gets
const MAX_BENDS = 8 // hard ceiling on bends per arm; the last leg extends unbounded past it
const TARGET_R = 0.8

const DIR: Record<DominoArm, { x: number; y: number }> = {
  right: { x: 1, y: 0 },
  left: { x: -1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
}

// Pinwheel: right→up, up→left, left→down, down→right.
const BEND: Record<DominoArm, DominoArm> = {
  right: 'up',
  up: 'left',
  left: 'down',
  down: 'right',
}

// The limit is an absolute distance from origin along the leg's axis. Leg 0
// (every arm's very first, un-bent run) always uses the plain H_MAX/V_MAX —
// byte-identical to the original single-bend design, for all four arms
// equally, so the overwhelming majority of games render exactly as before.
// Leg 1 onward grows via SPIRAL_STEP immediately (not just from leg 2), which
// is what actually prevents cross-arm collisions: two DIFFERENT arms' first
// bends inherently line up on the same axis (the pinwheel sends right→up,
// up→left, left→down, down→right, so e.g. right's post-bend run and up's own
// un-bent run both live on the vertical axis) — an EARLIER attempt tried to
// fix this by pushing the cursor sideways only for legIndex>=2, which relocated
// the boundary AFTER the preceding leg had already fixed the corner's position
// and left a visible gap in the chain. Growing every bend's limit immediately
// instead keeps every corner perfectly flush (no gap, ever) while still
// separating arms enough that an 8000-trial fuzz over the realistic ≤27-tile
// bound found zero overlaps across every arm-count split and pairing.
function legLimit(horizontal: boolean, legIndex: number): number {
  const base = horizontal ? H_MAX : V_MAX
  if (legIndex === 0) return base // leg 0: byte-identical to today, every arm
  return base + SPIRAL_STEP * legIndex // leg 1+: grows immediately, not just from leg 2
}

const ARM_ORDER: DominoArm[] = ['right', 'left', 'up', 'down']

function armStart(arm: DominoArm, isSpinner: boolean): { x: number; y: number } {
  if (arm === 'right') return { x: isSpinner ? 0.5 : 1, y: 0 }
  if (arm === 'left') return { x: isSpinner ? -0.5 : -1, y: 0 }
  if (arm === 'up') return { x: 0, y: -1 }
  return { x: 0, y: 1 }
}

interface ArmRun {
  tiles: LaidTile[]
  cursorX: number
  cursorY: number
  dirX: number
  dirY: number
}

function layArm(arm: DominoArm, isSpinner: boolean, placed: PlacedTile[]): ArmRun {
  const start = armStart(arm, isSpinner)
  let x = start.x
  let y = start.y
  let dir = arm
  let legIndex = 0
  let prevIsDouble = false // the tile behind the cursor; bends are never triggered by the first tile
  const tiles: LaidTile[] = []
  for (const p of placed) {
    const d = DIR[dir]
    const len = p.isDouble ? 1 : 2
    // Before placing, bend if advancing would push the cursor's distance from
    // origin along the current leg's axis beyond THAT leg's limit. Leg 0 uses
    // the fixed H_MAX/V_MAX exactly as before; every bend from leg 1 on widens
    // the ring (legLimit), so a long arm spirals outward instead of extending
    // forever in the post-bend direction. MAX_BENDS is a hard ceiling — beyond
    // it the last leg keeps extending unbounded, and the scale clamp absorbs
    // the rest.
    if (legIndex < MAX_BENDS && x * d.x + y * d.y + len > legLimit(d.x !== 0, legIndex)) {
      dir = BEND[dir]
      legIndex++
      // Physical corner: the bent run sits flush BESIDE the straight run's end.
      // Shift the cursor so the first new-leg tile's near edges meet the last
      // old-leg tile's end edges. Each side's perpendicular half-extent is 1
      // for a double (laid crosswise, 2 units wide), 0.5 for a plain tile —
      // using the actual halves (not a fixed 0.5) keeps doubles flush instead
      // of overlapping the corner. For two plain tiles this reduces to the
      // original half-unit shift, unchanged.
      const prevHalf = prevIsDouble ? 1 : 0.5
      const nextHalf = p.isDouble ? 1 : 0.5
      x += d.x * nextHalf - DIR[dir].x * prevHalf
      y += d.y * nextHalf - DIR[dir].y * prevHalf
    }
    const nd = DIR[dir]
    const cx = x + nd.x * (len / 2)
    const cy = y + nd.y * (len / 2)
    const runHorizontal = dir === 'right' || dir === 'left'
    const horizontal = runHorizontal !== p.isDouble
    tiles.push({
      x: cx,
      y: cy,
      w: horizontal ? 2 : 1,
      h: horizontal ? 1 : 2,
      horizontal,
      inner: p.inner,
      outer: p.outer,
      isDouble: p.isDouble,
      dir,
    })
    x += nd.x * len
    y += nd.y * len
    prevIsDouble = p.isDouble
  }
  const fd = DIR[dir]
  return { tiles, cursorX: x, cursorY: y, dirX: fd.x, dirY: fd.y }
}

export function layoutBoard(
  center: { a: number; b: number } | null,
  isSpinner: boolean,
  arms: Record<DominoArm, PlacedTile[]>,
): BoardLayout {
  const tiles: LaidTile[] = []
  const targets: EndTarget[] = []
  if (center === null) {
    targets.push({ arm: 'center', x: 0, y: 0, r: TARGET_R })
  } else {
    tiles.push({
      x: 0,
      y: 0,
      w: isSpinner ? 1 : 2,
      h: isSpinner ? 2 : 1,
      horizontal: !isSpinner,
      inner: center.a,
      outer: center.b,
      isDouble: center.a === center.b,
      dir: 'right',
    })
    const openArms: DominoArm[] = isSpinner ? ARM_ORDER : ['right', 'left']
    for (const arm of openArms) {
      const run = layArm(arm, isSpinner, arms[arm])
      tiles.push(...run.tiles)
      // Targets sit 1 unit beyond the arm's final cursor, on its current axis.
      targets.push({ arm, x: run.cursorX + run.dirX, y: run.cursorY + run.dirY, r: TARGET_R })
    }
  }
  const first = targets[0]
  let minX = first.x - first.r
  let maxX = first.x + first.r
  let minY = first.y - first.r
  let maxY = first.y + first.r
  for (const t of tiles) {
    minX = Math.min(minX, t.x - t.w / 2)
    maxX = Math.max(maxX, t.x + t.w / 2)
    minY = Math.min(minY, t.y - t.h / 2)
    maxY = Math.max(maxY, t.y + t.h / 2)
  }
  for (let i = 1; i < targets.length; i++) {
    minX = Math.min(minX, targets[i].x - targets[i].r)
    maxX = Math.max(maxX, targets[i].x + targets[i].r)
    minY = Math.min(minY, targets[i].y - targets[i].r)
    maxY = Math.max(maxY, targets[i].y + targets[i].r)
  }
  return { tiles, targets, minX, maxX, minY, maxY }
}

// Largest scale ≤ 1 that fits the bounds (padded by 1 unit each side) into
// paneW×paneH at unitPx pixels per unit, clamped to ≥ 0.35.
export function scaleToFit(layout: BoardLayout, paneW: number, paneH: number, unitPx: number): number {
  const widthUnits = layout.maxX - layout.minX + 2
  const heightUnits = layout.maxY - layout.minY + 2
  const scale = Math.min(1, paneW / (widthUnits * unitPx), paneH / (heightUnits * unitPx))
  return Math.max(0.35, scale)
}

// Pane height (px) that shows the layout at the scale the pane's WIDTH alone
// allows (≤ 1). A fixed-height pane crushed long games toward the 0.35 scale
// floor — the spiral's vertical legs make the layout taller than any fixed
// pane — so the screen grows the pane to this height (within its own min/max)
// and scaleToFit then lands on the width-driven scale instead.
export function paneHeightToFit(layout: BoardLayout, paneW: number, unitPx: number): number {
  const widthUnits = layout.maxX - layout.minX + 2
  const heightUnits = layout.maxY - layout.minY + 2
  const widthScale = Math.min(1, paneW / (widthUnits * unitPx))
  return Math.ceil(heightUnits * unitPx * widthScale)
}
