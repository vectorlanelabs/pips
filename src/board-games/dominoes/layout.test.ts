import { describe, expect, it } from 'vitest'
import { layoutBoard, scaleToFit, paneHeightToFit, type LaidTile } from './layout.ts'
import type { DominoArm, PlacedTile } from './state.ts'

const emptyArms = (): Record<DominoArm, PlacedTile[]> => ({ right: [], left: [], up: [], down: [] })

function placed(inner: number, outer: number, isDouble = false): PlacedTile {
  return { inner, outer, isDouble }
}

// Strict interior intersection — shared edges do not count.
function interiorOverlap(a: LaidTile, b: LaidTile): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2
}

describe('layoutBoard', () => {
  it('lays a non-double lead 2×1 at the origin with two targets', () => {
    const layout = layoutBoard({ a: 6, b: 4 }, false, emptyArms())
    expect(layout.tiles).toHaveLength(1)
    expect(layout.tiles[0]).toMatchObject({
      x: 0,
      y: 0,
      w: 2,
      h: 1,
      horizontal: true,
      inner: 6,
      outer: 4,
      isDouble: false,
      dir: 'right',
    })
    expect(layout.targets).toEqual([
      { arm: 'right', x: 2, y: 0, r: 0.8 },
      { arm: 'left', x: -2, y: 0, r: 0.8 },
    ])
  })

  it('lays a spinner lead crosswise with four targets', () => {
    const layout = layoutBoard({ a: 5, b: 5 }, true, emptyArms())
    expect(layout.tiles[0]).toMatchObject({
      x: 0,
      y: 0,
      w: 1,
      h: 2,
      horizontal: false,
      isDouble: true,
      dir: 'right',
    })
    expect(layout.targets).toEqual([
      { arm: 'right', x: 1.5, y: 0, r: 0.8 },
      { arm: 'left', x: -1.5, y: 0, r: 0.8 },
      { arm: 'up', x: 0, y: -2, r: 0.8 },
      { arm: 'down', x: 0, y: 2, r: 0.8 },
    ])
  })

  it('lays a single center target on an empty board', () => {
    const layout = layoutBoard(null, false, emptyArms())
    expect(layout.tiles).toEqual([])
    expect(layout.targets).toEqual([{ arm: 'center', x: 0, y: 0, r: 0.8 }])
    expect([layout.minX, layout.maxX, layout.minY, layout.maxY]).toEqual([-0.8, 0.8, -0.8, 0.8])
  })

  it('advances a right arm of three non-doubles by one tile length each', () => {
    const layout = layoutBoard({ a: 6, b: 4 }, false, {
      ...emptyArms(),
      right: [placed(4, 5), placed(5, 3), placed(3, 2)],
    })
    expect(layout.tiles.slice(1).map((t) => [t.x, t.y])).toEqual([
      [2, 0],
      [4, 0],
      [6, 0],
    ])
    // inner faces back toward the center; the run travels right
    expect(layout.tiles[1]).toMatchObject({ inner: 4, outer: 5, horizontal: true, dir: 'right' })
    expect(layout.targets[0]).toEqual({ arm: 'right', x: 8, y: 0, r: 0.8 })
  })

  it('places doubles crosswise consuming one unit of run length', () => {
    const layout = layoutBoard({ a: 6, b: 4 }, false, {
      ...emptyArms(),
      right: [placed(4, 5), placed(5, 5, true), placed(5, 2)],
    })
    const [first, dbl, last] = layout.tiles.slice(1)
    expect([first.x, dbl.x, last.x]).toEqual([2, 3.5, 5])
    expect(first).toMatchObject({ w: 2, h: 1, horizontal: true, isDouble: false })
    expect(dbl).toMatchObject({ w: 1, h: 2, horizontal: false, isDouble: true })
    expect(last).toMatchObject({ w: 2, h: 1, horizontal: true })
    // run length 5 units (cursor 1 → 6); target sits 1 unit beyond
    expect(layout.targets[0]).toEqual({ arm: 'right', x: 7, y: 0, r: 0.8 })
  })

  it('bends a right arm up once it would cross H_MAX = 11', () => {
    const layout = layoutBoard({ a: 6, b: 4 }, false, {
      ...emptyArms(),
      right: [
        placed(4, 5),
        placed(5, 3),
        placed(3, 2),
        placed(2, 1),
        placed(1, 0),
        placed(0, 6),
        placed(6, 6, true),
      ],
    })
    const arm = layout.tiles.slice(1)
    expect(arm).toHaveLength(7)
    // five non-doubles advance +x at y = 0
    expect(arm.slice(0, 5).map((t) => [t.x, t.y])).toEqual([
      [2, 0],
      [4, 0],
      [6, 0],
      [8, 0],
      [10, 0],
    ])
    expect(arm.slice(0, 5).every((t) => t.horizontal && t.dir === 'right')).toBe(true)
    // the sixth triggers the bend: the vertical run sits half a unit beyond the
    // straight run's end, its near edge flush with the last straight tile
    expect(arm[5]).toMatchObject({ x: 11.5, y: -0.5, w: 1, h: 2, horizontal: false, dir: 'up' })
    // a double after the bend sits crosswise to the vertical run: 2 wide × 1 tall
    expect(arm[6]).toMatchObject({ x: 11.5, y: -2, w: 2, h: 1, horizontal: true, isDouble: true, dir: 'up' })
    // no tile's x-extent exceeds the straight-run threshold plus the bend's
    // cross-axis offset: the bent run overhangs +1 beyond H_MAX and a
    // crosswise double adds another half unit
    const maxExtent = Math.max(...layout.tiles.map((t) => t.x + t.w / 2))
    expect(maxExtent).toBeLessThanOrEqual(12.5)
    expect(layout.targets[0]).toEqual({ arm: 'right', x: 11.5, y: -3.5, r: 0.8 })
  })

  it('bends arms in the pinwheel direction', () => {
    const layout = layoutBoard({ a: 5, b: 5 }, true, {
      ...emptyArms(),
      left: [placed(5, 4), placed(4, 3), placed(3, 2), placed(2, 1), placed(1, 0), placed(0, 6)],
      up: [placed(5, 4), placed(4, 3)],
      down: [placed(5, 4), placed(4, 3)],
    })
    // tiles: center, right (empty), left (6), up (2), down (2)
    const left = layout.tiles.slice(1, 7)
    const up = layout.tiles.slice(7, 9)
    const down = layout.tiles.slice(9, 11)
    // left arm travels −x, then bends down (left→down), offset half a unit
    // beyond the straight run's end
    expect(left.slice(0, 5).every((t) => t.dir === 'left' && t.y === 0)).toBe(true)
    expect(left[5]).toMatchObject({ x: -11, y: 0.5, dir: 'down', horizontal: false })
    // up arm travels −y, then bends left (up→left)
    expect(up[0]).toMatchObject({ y: -2, dir: 'up' })
    expect(up[1]).toMatchObject({ x: -0.5, y: -3.5, dir: 'left', horizontal: true })
    // down arm travels +y, then bends right (down→right)
    expect(down[0]).toMatchObject({ y: 2, dir: 'down' })
    expect(down[1]).toMatchObject({ x: 0.5, y: 3.5, dir: 'right', horizontal: true })
  })

  it('keeps a busy board free of overlaps', () => {
    const arms = {
      right: [placed(5, 4), placed(4, 4, true), placed(4, 3), placed(3, 2), placed(2, 1), placed(1, 0)],
      left: [placed(5, 4), placed(4, 3), placed(3, 2), placed(2, 1), placed(1, 0), placed(0, 6)],
      up: [placed(5, 4), placed(4, 3), placed(3, 3, true), placed(3, 2)],
      down: [placed(5, 4), placed(4, 3), placed(3, 2), placed(2, 2, true)],
    }
    const layout = layoutBoard({ a: 5, b: 5 }, true, arms)
    // every arm is long enough that at least one bends
    expect(layout.tiles.some((t) => t.dir === 'up' || t.dir === 'down')).toBe(true)

    // the full guarantee: no two tiles on the busy board intersect in their
    // interiors — straight runs, cross-arm neighbours, and every bend corner
    // included (shared edges do not count)
    for (let i = 0; i < layout.tiles.length; i++) {
      for (let j = i + 1; j < layout.tiles.length; j++) {
        expect(interiorOverlap(layout.tiles[i], layout.tiles[j])).toBe(false)
      }
    }
  })

  it('keeps a double landing on a bend corner flush instead of overlapping', () => {
    // A double is 2 units wide crosswise (half-extent 1, not the plain tile's
    // 0.5), so the corner-flush offset must account for whichever side of the
    // bend is a double or the two runs overlap. First: the tile that triggers
    // the bend is a double (first tile of the new leg).
    const postBend = layoutBoard({ a: 5, b: 5 }, true, {
      ...emptyArms(),
      right: [placed(5, 4), placed(4, 3), placed(3, 2), placed(2, 1), placed(1, 0), placed(0, 0, true), placed(0, 6), placed(6, 5)],
    })
    const post = postBend.tiles.slice(1)
    // five non-doubles run +x to the H_MAX threshold; the double bends and is
    // the first up tile, its 2-wide footprint meeting the straight run's end
    // flush at x = 10.5 instead of overlapping it
    expect(post[5]).toMatchObject({ x: 11.5, y: 0, w: 2, h: 1, isDouble: true, dir: 'up' })
    expect(post[6]).toMatchObject({ x: 11.5, y: -1.5, dir: 'up' })
    // leg 1 (post-bend) now grows immediately via SPIRAL_STEP (not just from
    // leg 2 on), so it takes much longer to need a second bend; the 8th tile
    // is still travelling flush up the same leg, not yet bent again.
    expect(post[7]).toMatchObject({ x: 11.5, y: -3.5, dir: 'up' })

    // Second: a double ends the old leg AND the next leg opens with a double
    // (the all-doubles corner the original fuzz probe caught).
    const bothDbl = layoutBoard({ a: 5, b: 5 }, true, {
      ...emptyArms(),
      right: Array.from({ length: 17 }, () => placed(0, 0, true)),
    })
    // 10 doubles reach H_MAX, the 11th opens the up leg as a double; leg 1's
    // immediate SPIRAL_STEP growth means 17 doubles (8.5 units) isn't enough
    // to need a second bend, so the 16th tile is still flush up the same leg.
    expect(bothDbl.tiles[11]).toMatchObject({ x: 11.5, y: 0.5, w: 2, h: 1, isDouble: true, dir: 'up' })
    expect(bothDbl.tiles[16]).toMatchObject({ x: 11.5, y: -4.5, w: 2, h: 1, isDouble: true, dir: 'up' })

    // zero tolerance: no interior overlap anywhere on either board
    for (const layout of [postBend, bothDbl]) {
      for (let i = 0; i < layout.tiles.length; i++) {
        for (let j = i + 1; j < layout.tiles.length; j++) {
          expect(interiorOverlap(layout.tiles[i], layout.tiles[j])).toBe(false)
        }
      }
    }
  })

  it('spirals a single arm that absorbs nearly the whole set instead of running off', () => {
    // The reported bug: one arm chains ~27 tiles (nearly the whole double-6
    // set, weighted toward non-doubles) after a single bend and then extends
    // forever in the new direction, off past the visible pane. Pre-fix this
    // input ran ~41 units up past the origin in a straight line with only two
    // directions; the spiral must keep bending and stay bounded.
    const arm = [
      ...Array.from({ length: 24 }, (_, i) => placed(i % 6, (i + 1) % 6)),
      placed(4, 4, true),
      placed(5, 5, true),
      placed(6, 6, true),
    ]
    expect(arm).toHaveLength(27)
    const layout = layoutBoard({ a: 5, b: 5 }, true, { ...emptyArms(), right: arm })

    // (a) bent more than once: the arm's tiles show multiple distinct dirs
    const dirs = new Set(layout.tiles.slice(1).map((t) => t.dir))
    expect(dirs.size).toBeGreaterThanOrEqual(3)

    // (b) no two tiles overlap in their interiors, every bend corner included
    for (let i = 0; i < layout.tiles.length; i++) {
      for (let j = i + 1; j < layout.tiles.length; j++) {
        expect(interiorOverlap(layout.tiles[i], layout.tiles[j])).toBe(false)
      }
    }

    // (c) the spiral stayed bounded instead of running off — sane envelope
    expect(layout.maxX - layout.minX).toBeLessThan(120)
    expect(layout.maxY - layout.minY).toBeLessThan(120)
  })

  it('keeps up and left arms clear of each other once up bends onto left\'s axis (up=12, left=8)', () => {
    // Cross-arm collision #1: up's own leg 1 (its first bend, up→left) travels
    // the same horizontal axis left's leg 0 already occupies. Growing the
    // limit from leg 1 onward (not just leg 2+) pushes up's bend far enough
    // out that it clears left's own run instead of crossing it. 12 + 8 = 20
    // tiles, well within a 28-tile set — this exact split used to overlap.
    const layout = layoutBoard({ a: 5, b: 5 }, true, {
      ...emptyArms(),
      left: Array.from({ length: 8 }, (_, i) => placed(i % 6, (i + 1) % 6)),
      up: Array.from({ length: 12 }, (_, i) => placed(i % 6, (i + 1) % 6)),
    })
    const left = layout.tiles.slice(1, 9)
    const up = layout.tiles.slice(9)
    // left arm: five left tiles, then leg 1 bends down at x = -11 (unchanged
    // from the original single-bend design — leg 0's limit never grows)
    expect(left.slice(0, 5).every((t) => t.dir === 'left' && t.y === 0)).toBe(true)
    expect(left[5]).toMatchObject({ x: -11, y: 0.5, dir: 'down' })
    // up arm: leg 0 up, then bends left at its own (unchanged) H_MAX boundary
    expect(up[0]).toMatchObject({ y: -2, dir: 'up' })
    expect(up[1]).toMatchObject({ x: -0.5, y: -3.5, dir: 'left' })
    // no overlap anywhere, including where up's leg 1 passes near left's territory
    for (let i = 0; i < layout.tiles.length; i++) {
      for (let j = i + 1; j < layout.tiles.length; j++) {
        expect(interiorOverlap(layout.tiles[i], layout.tiles[j])).toBe(false)
      }
    }
  })

  it('keeps right and up arms clear of each other once right bends onto up\'s axis (right=16, up=5, left=5, down=1)', () => {
    // Cross-arm collision #2 (the one Oscar's exhaustive sweep found): right's
    // own leg 1 (right→up) shares up's vertical axis; without leg 1 growing
    // immediately, right's later bend-corner could land exactly where up's own
    // run sits. 16+5+5+1 = 27, the full realistic set, spread across all four
    // arms — this exact split used to overlap between right and up.
    const layout = layoutBoard({ a: 5, b: 5 }, true, {
      ...emptyArms(),
      right: Array.from({ length: 16 }, (_, i) => placed(i % 6, (i + 1) % 6, i % 7 === 0)),
      up: Array.from({ length: 5 }, (_, i) => placed(i % 6, (i + 1) % 6)),
      left: Array.from({ length: 5 }, (_, i) => placed(i % 6, (i + 1) % 6)),
      down: [placed(0, 1)],
    })
    for (let i = 0; i < layout.tiles.length; i++) {
      for (let j = i + 1; j < layout.tiles.length; j++) {
        expect(interiorOverlap(layout.tiles[i], layout.tiles[j])).toBe(false)
      }
    }
  })

  it('keeps left and down arms clear of each other once left bends onto down\'s axis (left=15, down=3)', () => {
    // Mirror of the up/left case on the other diagonal: left's leg 1
    // (left→down) shares down's vertical axis.
    const layout = layoutBoard({ a: 5, b: 5 }, true, {
      ...emptyArms(),
      left: Array.from({ length: 15 }, (_, i) => placed(i % 6, (i + 1) % 6)),
      down: Array.from({ length: 3 }, (_, i) => placed(i % 6, (i + 1) % 6)),
    })
    const left = layout.tiles.slice(1, 16)
    const down = layout.tiles.slice(16)
    expect(left.slice(0, 5).every((t) => t.dir === 'left' && t.y === 0)).toBe(true)
    expect(left[5]).toMatchObject({ x: -11, y: 0.5, dir: 'down' })
    expect(down[0]).toMatchObject({ y: 2, dir: 'down' })
    for (let i = 0; i < layout.tiles.length; i++) {
      for (let j = i + 1; j < layout.tiles.length; j++) {
        expect(interiorOverlap(layout.tiles[i], layout.tiles[j])).toBe(false)
      }
    }
  })
})

describe('scaleToFit', () => {
  it('includes targets in the bounds and fits a small board at scale 1', () => {
    const small = layoutBoard({ a: 6, b: 4 }, false, emptyArms())
    // bounds cover tile footprints AND target circles (targets at (±2, 0), r = 0.8)
    expect([small.minX, small.maxX, small.minY, small.maxY]).toEqual([-2.8, 2.8, -0.8, 0.8])
    expect(scaleToFit(small, 800, 600, 20)).toBe(1)
  })

  it('scales a huge board down but never below 0.35', () => {
    // An arm long enough to exhaust all 8 spiral bends keeps extending along
    // its last leg, so this board is genuinely huge even with the spiral fix —
    // the floor must shrink it (not clip) and never go below 0.35.
    const huge = layoutBoard({ a: 5, b: 5 }, true, {
      ...emptyArms(),
      right: Array.from({ length: 500 }, () => placed(5, 4)),
    })
    expect(scaleToFit(huge, 600, 600, 20)).toBe(0.35)
    // a tiny pane would need even less → clamped to the same floor
    expect(scaleToFit(huge, 100, 100, 20)).toBe(0.35)
  })

  it('never shrinks below the 0.35 floor for an even huger board', () => {
    const huger = layoutBoard({ a: 5, b: 5 }, true, {
      ...emptyArms(),
      right: Array.from({ length: 1000 }, () => placed(5, 4)),
    })
    expect(scaleToFit(huger, 600, 600, 20)).toBe(0.35)
  })
})

describe('paneHeightToFit', () => {
  it('a realistic long-game layout keeps the width-driven scale instead of the fixed-pane crush', () => {
    // Both arms of a 2-player game deep into the round: the right arm has bent
    // up (a 14-unit vertical leg) and back left. In the old fixed 400px-ish
    // pane this layout was height-bound and crushed toward the 0.35 floor;
    // sized by paneHeightToFit, scaleToFit lands on the width-driven scale.
    const layout = layoutBoard({ a: 6, b: 5 }, false, {
      ...emptyArms(),
      right: Array.from({ length: 12 }, () => placed(3, 2)),
      left: Array.from({ length: 6 }, () => placed(4, 1)),
    })
    const paneW = 1100
    const widthUnits = layout.maxX - layout.minX + 2
    const widthScale = Math.min(1, paneW / (widthUnits * 40))
    const paneH = paneHeightToFit(layout, paneW, 40)
    expect(scaleToFit(layout, paneW, paneH, 40)).toBeCloseTo(widthScale, 2)
    // and the width-driven scale is actually readable, not floor-crushed
    expect(widthScale).toBeGreaterThan(0.7)
    // sanity: the old fixed pane really was worse for this layout
    expect(scaleToFit(layout, paneW, 400, 40)).toBeLessThan(widthScale)
  })

  it('a fresh board needs less height than the CSS minimum and gets clamped by the screen', () => {
    const small = layoutBoard({ a: 6, b: 4 }, false, emptyArms())
    // 2.8-unit half-spans → ~3.6 height units → 144px: far under the 280px CSS
    // floor the screen clamps to, so early game keeps the familiar pane.
    expect(paneHeightToFit(small, 1100, 40)).toBeLessThan(280)
  })
})
