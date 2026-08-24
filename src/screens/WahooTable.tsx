import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Hole, WahooBoard } from '../board-games/wahoo/board'
import { createBoard, LANE_START, OWNER_TRACK_LEN, trackIndexFor } from '../board-games/wahoo/board'
import { exitTargetRel, legalMoves, type WahooMove, type WahooPublicState } from '../board-games/wahoo/state'
import { currentPlayer } from '../engine/turn-engine'
import { Die } from '../components/Die'
import { SoundToggle } from '../components/SoundToggle'
import { TurnSoundToggle } from '../components/TurnSoundToggle'
import { Wordmark } from '../components/Wordmark'
import { WahooRulesOverlay } from './WahooRulesOverlay'
import { useSound } from '../hooks/useSound'
import { useTurnStartSound } from '../hooks/useTurnStartSound'
import './WahooTable.css'

// ---- Props ----

export interface WahooTableProps {
  code: string
  localPlayerId: string
  localName: string
  names: Record<string, string>        // playerId -> display name
  connection: 'connected' | 'disconnected'
  notice?: string | null
  publicState: WahooPublicState
  onRoll: () => void
  onMove: (move: WahooMove) => void
  onLeave: () => void
}

// ---- Arm palette (fixed per arm index 0..3, assigned at game start) ----

const ARM_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308']
const CORNER_RING = 'rgba(147, 51, 234, 0.5)' // brand-tinted ring on the four corner holes
const GREY_BORDER = 'var(--grey-border)' // unseated arms: grey instead of an arm color

function seatColor(publicState: WahooPublicState, playerId: string): string {
  return ARM_COLORS[publicState.seatArms[playerId]]
}

// Arm color as an rgba fill at the given alpha (home-lane holes use 0.45).
function armFill(arm: number, alpha: number): string {
  const hex = ARM_COLORS[arm]
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

// ---- Board scale (one source of truth) ----
// The pane is BOARD_SPAN units wide: content spans ±8 units, plus a margin.
// Every position on the board — holes, marbles, rings, and the cross — is a
// unit offset scaled by `unit = paneW / BOARD_SPAN`; the cross viewBox is
// built from BOARD_SPAN too, so no second scale can drift.
const BOARD_SPAN = 19 // total units across the pane (content ±8 + margin)
const ARM_HALF_WIDTH = 2.75 // bars contain columns at ±2 with margin
const ARM_LENGTH = 8.75 // bars reach past tip rows at ±8

// The solid cream cross is the two rounded bars only (no corner plates). Every
// shape is rendered twice in one SVG — a stroked pass then a fill-only pass —
// so the second pass covers the interior strokes and only the union's outer
// outline survives (a welded single-outline cross).
const CROSS_SHAPES: ReadonlyArray<{ x: number; y: number; width: number; height: number; rx: number }> = [
  { x: -ARM_LENGTH, y: -ARM_HALF_WIDTH, width: ARM_LENGTH * 2, height: ARM_HALF_WIDTH * 2, rx: 0.3 }, // horizontal bar
  { x: -ARM_HALF_WIDTH, y: -ARM_LENGTH, width: ARM_HALF_WIDTH * 2, height: ARM_LENGTH * 2, rx: 0.3 }, // vertical bar
]

function CrossRect({ shape, stroked }: { shape: (typeof CROSS_SHAPES)[number]; stroked: boolean }) {
  return (
    <rect
      x={shape.x}
      y={shape.y}
      width={shape.width}
      height={shape.height}
      rx={shape.rx}
      fill="#fbfaf6"
      {...(stroked ? { stroke: '#17173a', strokeWidth: 0.18 } : {})}
    />
  )
}

// ---- Geometry helpers ----

// The center hole's diameter in units: 0.9 vs 0.62 for track holes — larger
// than a track hole but no longer oversized; the brand ring marks it special.
// The center drop-target ring scales to this same size.
const CENTER_DIAMETER = 0.9

// The physical hole a marble currently occupies (-1 base, -2 center, 0..62
// track relative to the arm's come-out, 63..66 home lane, outermost first).
function marbleHole(board: WahooBoard, publicState: WahooPublicState, playerId: string, marbleIdx: number): Hole {
  const arm = publicState.seatArms[playerId]
  const p = publicState.positions[playerId][marbleIdx]
  if (p === -1) return board.bases[arm][marbleIdx]
  if (p === -2) return board.center
  if (p <= OWNER_TRACK_LEN - 1) return board.track[trackIndexFor(arm, p)]
  return board.homes[arm][p - LANE_START]
}

// The physical hole a legal move's marble ends at: out → the arm's entry hole,
// advance → the track/lane landing hole, shortcut → center, exit → the
// diagonal corner.
function destinationHole(board: WahooBoard, publicState: WahooPublicState, playerId: string, die: number, move: WahooMove): Hole {
  const arm = publicState.seatArms[playerId]
  if (move.kind === 'out') return board.track[trackIndexFor(arm, 0)]
  if (move.kind === 'shortcut') return board.center
  if (move.kind === 'exit') return board.track[trackIndexFor(arm, exitTargetRel(publicState.centerBy!.entryCornerRel))]
  const to = publicState.positions[playerId][move.marbleIdx] + die
  return to <= OWNER_TRACK_LEN - 1 ? board.track[trackIndexFor(arm, to)] : board.homes[arm][to - LANE_START]
}

// Destination target ring diameter in units: the standard 0.68 ring on
// track/lane/base holes; the center ring scales to the center hole so the
// target frames it the way the standard ring frames a 0.62 track hole.
function targetDiameter(board: WahooBoard, dest: Hole, unit: number): number {
  const isCenter = dest.x === board.center.x && dest.y === board.center.y
  return (isCenter ? CENTER_DIAMETER : 0.68) * unit
}

function BoardHole({ x, y, unit, fill = '#fff', border = 'rgba(23, 23, 58, 0.3)', borderWidth = 2, shadow, ringClass, ringColor, size = 0.62 }: {
  x: number
  y: number
  unit: number
  fill?: string
  border?: string
  borderWidth?: number
  shadow?: string // 2px box-shadow ring outside the border
  ringClass?: string // extra class for a distinct ring style (e.g. the entrance double ring)
  ringColor?: string // CSS var --ring-color consumed by the ring class
  size?: number
}) {
  return (
    <span
      className={ringClass !== undefined ? `wh-hole ${ringClass}` : 'wh-hole'}
      style={{
        left: `calc(50% + ${x * unit}px)`,
        top: `calc(50% + ${y * unit}px)`,
        width: size * unit,
        height: size * unit,
        background: fill,
        borderColor: border,
        borderWidth,
        ...(shadow !== undefined ? { boxShadow: `0 0 0 2px ${shadow}` } : {}),
        ...(ringColor !== undefined ? ({ '--ring-color': ringColor } as CSSProperties) : {}),
      }}
    />
  )
}

// ---- Status lines ----

function computeStatusLine(publicState: WahooPublicState, localPlayerId: string, names: Record<string, string>): string {
  const ev = publicState.lastEvent
  if (ev === null) {
    const cur = currentPlayer(publicState.turn)
    return cur === localPlayerId
      ? 'Your roll — bring a marble out on a 1 or 6.'
      : `${names[cur] ?? cur} rolls first.`
  }
  const actor = ev.by === localPlayerId ? 'You' : (names[ev.by] ?? ev.by)
  switch (ev.kind) {
    case 'roll':
      return `${actor} rolled a ${ev.die} — move a marble.`
    case 'move':
    case 'out':
    case 'shortcut':
    case 'exit':
      if (ev.bumpedId !== null) return `${actor} bumped ${names[ev.bumpedId] ?? ev.bumpedId}!`
      if (ev.kind === 'move') return `${actor} moved a marble.`
      if (ev.kind === 'out') return `${actor} brought a marble out.`
      if (ev.kind === 'shortcut') return `${actor} took the center shortcut!`
      return `${actor} left the center.`
    case 'bust':
      return `Three sixes — ${actor === 'You' ? 'your' : `${actor}'s`} marble goes home!`
    case 'pass':
      return `${actor} rolled a ${ev.die} — no move, passes.`
    case 'win':
      return actor === 'You' ? 'You win!' : `${actor} wins!`
  }
}

// ---- WahooTable ----

export function WahooTable({
  code,
  localPlayerId,
  localName,
  names,
  connection,
  notice,
  publicState,
  onRoll,
  onMove,
  onLeave,
}: WahooTableProps) {
  void localName // preserved in props for M4 wiring; unused in this presentational milestone

  // ---- Derived ----
  const myTurn = currentPlayer(publicState.turn) === localPlayerId
  const canRoll = publicState.stage === 'play' && myTurn && publicState.turn.phase === 'roll'
  const myMovePhase = publicState.stage === 'play' && myTurn && publicState.turn.phase === 'move' && publicState.die !== null
  const myMoves = useMemo(() => {
    if (!myMovePhase) return []
    return legalMoves(publicState, localPlayerId, publicState.die!)
  }, [myMovePhase, publicState, localPlayerId])

  // ---- Local state ----
  const { play, enabled, setEnabled, turnSoundEnabled, setTurnSoundEnabled, playTurnStart } = useSound()
  const humanCount = publicState.turn.playerOrder.filter((id) => !id.startsWith('bot')).length
  // While the die is still flickering (roll/pass/bust), hold off the "your
  // turn" chime — otherwise it can fire mid-animation when a pass/bust flips
  // turn ownership in the same state update as the flicker starts.
  const [rollAnimating, setRollAnimating] = useState(false)
  useTurnStartSound(myTurn && !rollAnimating, humanCount, playTurnStart)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [paneW, setPaneW] = useState(0)
  // The most recent roll, kept so the die still shows a (muted) value between
  // turns — blank only before the first roll of the game.
  const [lastRoll, setLastRoll] = useState<{ die: number; by: string } | null>(null)
  // Die flicker: non-null while a roll's 7×60ms random-face flicker runs, null
  // once settled on the real value. useDiceAnimation keys on a values-join, so
  // equal consecutive rolls wouldn't re-animate — keying on roll-event identity
  // (see the lastEvent effect) re-flickers every genuine roll.
  const [dieFlicker, setDieFlicker] = useState<number | null>(null)
  // Small per-settle rotation jitter (±5°, the legacy dice games' feel).
  const [dieRotation, setDieRotation] = useState(0)
  const flickerRun = useRef(0)
  // Marble-first selection for shared (contested) destinations: null = plain
  // destination-click mode; a marble index narrows the visible targets to that
  // marble's moves (see destGroups/pendingContest below).
  const [selectedMarbleIdx, setSelectedMarbleIdx] = useState<number | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)

  // Measure the square board pane; unit = pane/BOARD_SPAN (content ±8 + margin).
  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    const measure = () => setPaneW(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const board = useMemo(() => createBoard(), [])
  // One scale contract: unit derives from BOARD_SPAN and the cross viewBox is
  // built from the same constant — no other scale exists in this file.
  const unit = paneW / BOARD_SPAN
  const boardReady = paneW > 0

  // Sound effects — diff lastEvent identity (every accepted action replaces it;
  // the HostSession revision lives in App, not in publicState). Both players
  // hear everything — no wasMyTurn gate.
  const lastEventRef = useRef(publicState.lastEvent)
  useEffect(() => {
    const ev = publicState.lastEvent
    if (ev !== lastEventRef.current) {
      if (ev !== null) {
        // A pass is a roll with no legal move, and a bust is the 3rd-six
        // resolution: all three still show the die that was rolled, so they
        // play a sound, stick to lastRoll, and flicker like any roll.
        if (ev.kind === 'roll' || ev.kind === 'pass' || ev.kind === 'bust') {
          play(ev.kind === 'bust' ? 'farkle-bust' : 'dice-roll')
          setLastRoll({ die: ev.die, by: ev.by })
          // Replicate useDiceAnimation's flicker (7 frames × 60ms of random
          // faces, then the real value) keyed to this roll event, so equal
          // consecutive rolls re-animate. A newer roll bumps the run id, which
          // strands any in-flight tick from an earlier run.
          setRollAnimating(true)
          const id = ++flickerRun.current
          let frame = 0
          const tick = () => {
            if (flickerRun.current !== id) return
            if (frame < 7) {
              setDieFlicker(1 + Math.floor(Math.random() * 6))
              frame++
              setTimeout(tick, 60)
            } else {
              setDieFlicker(null)
              setDieRotation(Math.random() * 10 - 5)
              setRollAnimating(false)
            }
          }
          tick()
        }
        else if (ev.kind === 'move' || ev.kind === 'out' || ev.kind === 'shortcut' || ev.kind === 'exit') {
          if (ev.bumpedId !== null) play('farkle-bust')
          else play('piece-drop')
        }
      }
      lastEventRef.current = ev
    }
  }, [publicState.lastEvent, play])

  // ---- Board content ----
  // Arms with a seated player (2P leaves two arms empty, 3P one muted arm);
  // everything else renders grey per §4.
  const seatedArms = useMemo(() => new Set(Object.values(publicState.seatArms)), [publicState.seatArms])
  const entryByTrackIdx = useMemo(() => {
    const m = new Map<number, number>() // track index -> arm whose come-out (entry) it is
    board.entries.forEach((idx, arm) => m.set(idx, arm))
    return m
  }, [board])
  const entranceByTrackIdx = useMemo(() => {
    const m = new Map<number, number>() // track index -> arm whose home entrance it is
    board.entrances.forEach((idx, arm) => m.set(idx, arm))
    return m
  }, [board])

  // Destination targets, one pulsing ring per destination hole, grouped by
  // landing hole. A hole reached by exactly one move is a plain click-to-
  // execute target; a hole reached by several moves (several 'out' candidates
  // sharing the entry, or an 'exit' sharing the diagonal corner with an
  // 'advance' — see the oscar.test.ts probes) renders in the contested style
  // and defers to marble-first selection instead.
  const destGroups = useMemo(() => {
    const byDest = new Map<string, { dest: Hole; moves: WahooMove[] }>()
    for (const m of myMoves) {
      const dest = destinationHole(board, publicState, localPlayerId, publicState.die!, m)
      const key = `${dest.x}:${dest.y}`
      const group = byDest.get(key)
      if (group) group.moves.push(m)
      else byDest.set(key, { dest, moves: [m] })
    }
    return [...byDest.values()]
  }, [myMoves, board, publicState, localPlayerId])

  const uniqueTargets = useMemo(() => destGroups.filter((g) => g.moves.length === 1), [destGroups])
  const contestedTargets = useMemo(() => destGroups.filter((g) => g.moves.length >= 2), [destGroups])

  // The contested destination the selected marble is a candidate of, if any.
  // A marble can be a candidate of at most one shared hole, so this lookup is
  // unambiguous; that hole's candidate set gets the selectable (execute) rings.
  const pendingContest = useMemo(() => {
    if (selectedMarbleIdx === null) return null
    return contestedTargets.find((g) => g.moves.some((m) => m.marbleIdx === selectedMarbleIdx)) ?? null
  }, [selectedMarbleIdx, contestedTargets])

  const candidateIdxs = useMemo(() => {
    if (!pendingContest) return new Set<number>()
    return new Set(pendingContest.moves.map((m) => m.marbleIdx))
  }, [pendingContest])

  // With a marble selected, the visible targets narrow to that marble's moves.
  const selectedTargets = useMemo(() => {
    if (selectedMarbleIdx === null) return []
    const byDest = new Map<string, { dest: Hole; move: WahooMove }>()
    for (const m of myMoves) {
      if (m.marbleIdx !== selectedMarbleIdx) continue
      const dest = destinationHole(board, publicState, localPlayerId, publicState.die!, m)
      const key = `${dest.x}:${dest.y}`
      if (!byDest.has(key)) byDest.set(key, { dest, move: m })
    }
    return [...byDest.values()]
  }, [selectedMarbleIdx, myMoves, board, publicState, localPlayerId])

  // The selection only means something for the current legal-move set; any
  // action that changes it (a move, a roll, a turn hand-off) drops the
  // selection so a stale marble choice can't resurrect on a later turn.
  useEffect(() => {
    setSelectedMarbleIdx(null)
  }, [myMoves])

  // Marbles that have ≥1 legal move (ring buttons: click to filter to that
  // marble's targets, or — for a pending-contest candidate — click to execute
  // that marble's move to the shared hole).
  const movableMarbleIdxs = useMemo(() => {
    const seen = new Set<number>()
    for (const m of myMoves) seen.add(m.marbleIdx)
    return [...seen]
  }, [myMoves])

  const status = useMemo(
    () => computeStatusLine(publicState, localPlayerId, names),
    [publicState, localPlayerId, names],
  )

  // ---- Render ----
  return (
    <div className="wh-table">
      {/* Header */}
      <div className="wh-header">
        <div className="wh-header-left">
          <Wordmark small onClick={onLeave} />
          <span className="wh-game-label">Wahoo</span>
          <span className="wh-peer-strip">
            <span
              className="wh-peer-dot"
              style={{ background: connection === 'connected' ? 'var(--green)' : 'var(--coral)' }}
            />
            <span className="wh-peer-label">
              {connection === 'connected' ? 'Live' : 'Connection lost'}
            </span>
          </span>
        </div>
        <div className="wh-header-actions">
          <TurnSoundToggle enabled={turnSoundEnabled} onToggle={() => setTurnSoundEnabled(!turnSoundEnabled)} />
          <SoundToggle enabled={enabled} onToggle={() => setEnabled(!enabled)} />
          <button type="button" className="btn pill-small" onClick={() => setRulesOpen(true)}>Rules</button>
          <button type="button" className="btn btn-ghost" onClick={onLeave}>Leave</button>
        </div>
      </div>

      {/* Code chip */}
      <div style={{ marginBottom: 'clamp(16px, 2.4vw, 26px)' }}>
        <span className="chip" style={{ background: 'var(--yellow)', color: 'var(--ink)' }}>Wahoo · {code}</span>
      </div>

      {/* Error banner */}
      {notice && <div className="wh-error-banner">{notice}</div>}

      {/* Main table card: the board column with the die rail to its right.
          row-reverse puts the rail (DOM-first of the row pair) on the board's
          right; on narrow screens the rail wraps back to its own row above
          the board column. */}
      <div className="wh-table-card">
        {/* Rail: the house die (last-roller caption beneath it), the Roll
            button, the player legend, and the status lines, stacked in a
            ~200px column beside the board. row-reverse on the card puts it on
            the right; flex-start pins the stack to the top. The die is
            presentational — no onClick. On narrow screens (< 900px) the rail
            collapses back above the board. */}
        <div className="wh-rail">
          <div className="wh-die-col">
            <Die
              value={dieFlicker ?? publicState.die ?? lastRoll?.die ?? 0}
              muted={dieFlicker === null && !myMovePhase}
              rotation={dieRotation}
            />
            {lastRoll !== null && (
              <span className="wh-die-caption">
                {lastRoll.by === localPlayerId ? 'You' : (names[lastRoll.by] ?? lastRoll.by)}
              </span>
            )}
          </div>
          <button type="button" className="btn btn-coral wh-roll-btn" onClick={onRoll} disabled={!canRoll}>
            Roll
          </button>
          {/* Legend: the player pills, stacked beneath the die/Roll so the
              whole rail (die, Roll, players) fits beside the board on screen */}
          <div className="wh-legend">
            {publicState.turn.playerOrder.map((pid) => {
              const isTurn = pid === currentPlayer(publicState.turn)
              return (
                <div key={pid} className={`wh-seat-chip${isTurn ? ' wh-seat-chip--turn' : ''}`}>
                  <span className="wh-seat-dot" style={{ background: seatColor(publicState, pid) }} />
                  <span className="wh-seat-name">{names[pid] ?? pid}</span>
                  {isTurn && <span className="wh-turn-tag">turn</span>}
                </div>
              )
            })}
          </div>
          <div className="wh-status">{status}</div>
        </div>

        <div className="wh-board-col">
          {/* Board — clicking anywhere off a target or marble ring clears the selection */}
          <div className="wh-board" ref={boardRef} onClick={() => setSelectedMarbleIdx(null)}>
            {boardReady && (
              <>
                {/* Solid cream cross under the holes; the felt shows around it and
                    under the bases. Two passes per shape: stroked then fill-only,
                    so interior strokes vanish and one outer outline remains. */}
                <svg
                  className="wh-cross"
                  viewBox={`${-BOARD_SPAN / 2} ${-BOARD_SPAN / 2} ${BOARD_SPAN} ${BOARD_SPAN}`}
                  aria-hidden="true"
                >
                  {CROSS_SHAPES.map((s, i) => (
                    <CrossRect key={`o${i}`} shape={s} stroked />
                  ))}
                  {CROSS_SHAPES.map((s, i) => (
                    <CrossRect key={`f${i}`} shape={s} stroked={false} />
                  ))}
                </svg>

                {/* 64 track holes, drilled into the cross. Come-out (entry) holes
                    ring solid in their arm's color, home-entrance holes ring thin-
                    double in the arm color, corner holes ring in the brand tint */}
                {board.track.map((h, i) => {
                  const entryArm = entryByTrackIdx.get(i)
                  const entranceArm = entranceByTrackIdx.get(i)
                  if (entryArm !== undefined) {
                    const color = seatedArms.has(entryArm) ? ARM_COLORS[entryArm] : GREY_BORDER
                    return <BoardHole key={`t${i}`} x={h.x} y={h.y} unit={unit} shadow={color} />
                  }
                  if (entranceArm !== undefined) {
                    const color = seatedArms.has(entranceArm) ? ARM_COLORS[entranceArm] : GREY_BORDER
                    return (
                      <BoardHole
                        key={`t${i}`}
                        x={h.x}
                        y={h.y}
                        unit={unit}
                        ringClass="wh-hole--entrance"
                        ringColor={color}
                      />
                    )
                  }
                  const cornerRing = board.corners.includes(i) ? CORNER_RING : undefined
                  return <BoardHole key={`t${i}`} x={h.x} y={h.y} unit={unit} shadow={cornerRing} />
                })}

                {/* Home lane holes: arm color at 45% + arm border; unseated arms grey */}
                {board.homes.map((lane, arm) =>
                  lane.map((h, j) => {
                    const seated = seatedArms.has(arm)
                    return (
                      <BoardHole
                        key={`h${arm}-${j}`}
                        x={h.x}
                        y={h.y}
                        unit={unit}
                        fill={seated ? armFill(arm, 0.45) : 'var(--grey-fill)'}
                        border={seated ? ARM_COLORS[arm] : GREY_BORDER}
                      />
                    )
                  }),
                )}

                {/* Base holes on the felt: cream fill, 3px arm ring; unseated arms grey */}
                {board.bases.map((cluster, arm) =>
                  cluster.map((h, j) => {
                    const seated = seatedArms.has(arm)
                    return (
                      <BoardHole
                        key={`b${arm}-${j}`}
                        x={h.x}
                        y={h.y}
                        unit={unit}
                        fill="#fbfaf6"
                        border={seated ? ARM_COLORS[arm] : GREY_BORDER}
                        borderWidth={3}
                      />
                    )
                  }),
                )}

                {/* Center: hole with the brand ring, sized to CENTER_DIAMETER */}
                <span
                  className="wh-center"
                  style={{ width: CENTER_DIAMETER * unit, height: CENTER_DIAMETER * unit }}
                />

                {/* Marbles: 3D-shaded circles in seat color (radial gradient via
                    --marble-color), ink border + hard drop shadow */}
                {Object.entries(publicState.positions).map(([pid, positions]) =>
                  positions.map((_p, i) => {
                    const h = marbleHole(board, publicState, pid, i)
                    return (
                      <span
                        key={`${pid}-${i}`}
                        className="wh-marble"
                        style={{
                          width: 0.85 * unit,
                          height: 0.85 * unit,
                          // The seat color feeds the CSS radial gradient (see
                          // .wh-marble) — same color, spherical shading added.
                          ...({ '--marble-color': seatColor(publicState, pid) } as CSSProperties),
                          transform: `translate(calc(-50% + ${h.x * unit}px), calc(-50% + ${h.y * unit}px))`,
                        }}
                      />
                    )
                  }),
                )}

                {/* Movable marbles: ring buttons. A plain click filters to that
                    marble's targets; a candidate of the pending contested
                    destination executes its move instead. */}
                {movableMarbleIdxs.map((marbleIdx) => {
                  const h = marbleHole(board, publicState, localPlayerId, marbleIdx)
                  const isCandidate = candidateIdxs.has(marbleIdx)
                  const isSelected = selectedMarbleIdx === marbleIdx
                  return (
                    <button
                      key={`mr${marbleIdx}`}
                      type="button"
                      className={`wh-marble-ring${isCandidate ? ' wh-marble-ring--candidate' : isSelected ? ' wh-marble-ring--selected' : ''}`}
                      style={{
                        left: `calc(50% + ${h.x * unit}px)`,
                        top: `calc(50% + ${h.y * unit}px)`,
                        width: 0.96 * unit,
                        height: 0.96 * unit,
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (isCandidate && pendingContest) {
                          const move = pendingContest.moves.find((m) => m.marbleIdx === marbleIdx)
                          if (move) onMove(move)
                        } else {
                          setSelectedMarbleIdx(marbleIdx)
                        }
                      }}
                      aria-label={isCandidate ? 'Move this marble to the shared destination' : 'Show this marble’s destinations'}
                    />
                  )
                })}

                {/* Destination targets: unique holes click to move; shared holes
                    click to enter marble-first selection instead. With a marble
                    selected, only its destinations are shown — the contested one
                    becomes pending, and clicking it confirms that marble's move. */}
                {selectedMarbleIdx === null ? (
                  <>
                    {uniqueTargets.map((t) => (
                      <button
                        key={`t${t.dest.x}:${t.dest.y}`}
                        type="button"
                        className="wh-target"
                        style={{
                          left: `calc(50% + ${t.dest.x * unit}px)`,
                          top: `calc(50% + ${t.dest.y * unit}px)`,
                          width: targetDiameter(board, t.dest, unit),
                          height: targetDiameter(board, t.dest, unit),
                        }}
                        onClick={(e) => {
                          e.stopPropagation()
                          onMove(t.moves[0])
                        }}
                        aria-label="Move a marble here"
                      />
                    ))}
                    {contestedTargets.map((t) => (
                      <button
                        key={`c${t.dest.x}:${t.dest.y}`}
                        type="button"
                        className="wh-target wh-target--contested"
                        style={{
                          left: `calc(50% + ${t.dest.x * unit}px)`,
                          top: `calc(50% + ${t.dest.y * unit}px)`,
                          width: targetDiameter(board, t.dest, unit),
                          height: targetDiameter(board, t.dest, unit),
                        }}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedMarbleIdx(t.moves[0].marbleIdx)
                        }}
                        aria-label="Shared destination — choose a marble"
                      />
                    ))}
                  </>
                ) : (
                  selectedTargets.map((t) => {
                    const isPending = pendingContest !== null
                      && t.dest.x === pendingContest.dest.x
                      && t.dest.y === pendingContest.dest.y
                    return (
                      <button
                        key={`s${t.dest.x}:${t.dest.y}`}
                        type="button"
                        className={`wh-target${isPending ? ' wh-target--contested wh-target--pending' : ''}`}
                        style={{
                          left: `calc(50% + ${t.dest.x * unit}px)`,
                          top: `calc(50% + ${t.dest.y * unit}px)`,
                          width: targetDiameter(board, t.dest, unit),
                          height: targetDiameter(board, t.dest, unit),
                        }}
                        onClick={(e) => {
                          e.stopPropagation()
                          onMove(t.move)
                        }}
                        aria-label="Move the selected marble here"
                      />
                    )
                  })
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {rulesOpen && <WahooRulesOverlay onClose={() => setRulesOpen(false)} />}
    </div>
  )
}
