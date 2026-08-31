import { useEffect, useMemo, useRef, useState } from 'react'
import type { BattleshipPublicState, CellMark, ShipId } from '../board-games/battleship/state'
import {
  BOARD_CELLS,
  BOARD_SIZE,
  SHIPS,
  fits,
  isShipDamaged,
  isShipSunk,
  randomFleet,
  shipCells,
  shipCellsAt,
} from '../board-games/battleship/state'
import { currentPlayer } from '../engine/turn-engine'
import { ScoreHeader } from '../components/ScoreHeader'
import { Wordmark } from '../components/Wordmark'
import { SoundToggle } from '../components/SoundToggle'
import { TurnSoundToggle } from '../components/TurnSoundToggle'
import { BattleshipRulesOverlay } from './BattleshipRulesOverlay'
import { useSound } from '../hooks/useSound'
import { useTurnStartSound } from '../hooks/useTurnStartSound'
import markers from '../assets/battleship/markers.png'
import carrierH from '../assets/battleship/ship-carrier-h.png'
import carrierV from '../assets/battleship/ship-carrier-v.png'
import battleshipH from '../assets/battleship/ship-battleship-h.png'
import battleshipV from '../assets/battleship/ship-battleship-v.png'
import cruiserH from '../assets/battleship/ship-cruiser-h.png'
import cruiserV from '../assets/battleship/ship-cruiser-v.png'
import submarineH from '../assets/battleship/ship-submarine-h.png'
import submarineV from '../assets/battleship/ship-submarine-v.png'
import destroyerH from '../assets/battleship/ship-destroyer-h.png'
import destroyerV from '../assets/battleship/ship-destroyer-v.png'
import './BattleshipTable.css'

// ---- Props ----

export interface BattleshipTableProps {
  code: string
  localPlayerId: string
  opponentName: string
  opponentColor: string
  connection: 'connected' | 'disconnected'
  notice?: string | null
  publicState: BattleshipPublicState
  board: (ShipId | null)[]     // your own board (privateState) — all null until your PLACE_FLEET is accepted
  onPlaceFleet: (board: (ShipId | null)[]) => void
  onFire: (cell: number) => void
  onLeave: () => void
}

// ---- Constants ----

const BRAND = '#1a6fae'
const COL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
const ROW_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

const SHIP_ART: Record<ShipId, { h: string; v: string }> = {
  carrier: { h: carrierH, v: carrierV },
  battleship: { h: battleshipH, v: battleshipV },
  cruiser: { h: cruiserH, v: cruiserV },
  submarine: { h: submarineH, v: submarineV },
  destroyer: { h: destroyerH, v: destroyerV },
}

// ---- Local helpers ----

// One cell's look: hit cells go dark navy when the ship is fully sunk, coral
// otherwise; miss cells go white; everything else stays the base wash.
function cellView(mark: CellMark | null, sunkHere: boolean): { bg: string; border: string; frame: number } {
  if (mark === 'hit') {
    return sunkHere
      ? { bg: '#17173a', border: '#17173a', frame: 3 }
      : { bg: '#ff5d73', border: '#17173a', frame: 1 }
  }
  if (mark === 'miss') return { bg: '#ffffff', border: '#c9c9e0', frame: 2 }
  return { bg: '#eafaff', border: '#c9c9e0', frame: 0 }
}

const PREVIEW_LEGAL = { bg: '#bcdcf2', border: '#17173a' }
const PREVIEW_ILLEGAL = { bg: '#ffd7dc', border: '#ff5d73' }

// Absolute-positioned ship art overlaying a grid. A ship spans from its
// top-left cell; horizontal iff all its cells share a row.
function ShipOverlays({ board, hits, alwaysDim }: {
  board: (ShipId | null)[]
  hits: (CellMark | null)[]
  alwaysDim: boolean
}) {
  return (
    <>
      {SHIPS.map((ship) => {
        const cells = shipCells(board, ship.id)
        if (cells.length === 0) return null
        const minR = Math.min(...cells.map((c) => Math.floor(c / BOARD_SIZE)))
        const minC = Math.min(...cells.map((c) => c % BOARD_SIZE))
        const horizontal = cells.every((c) => Math.floor(c / BOARD_SIZE) === minR)
        const sunk = isShipSunk(board, hits, ship.id)
        const art = horizontal ? SHIP_ART[ship.id].h : SHIP_ART[ship.id].v
        return (
          <img
            key={ship.id}
            src={art}
            alt=""
            className="bs-ship"
            style={{
              left: `${minC * 10}%`,
              top: `${minR * 10}%`,
              width: horizontal ? `${cells.length * 10}%` : '10%',
              height: horizontal ? '10%' : `${cells.length * 10}%`,
              opacity: alwaysDim || sunk ? 0.32 : 1,
            }}
          />
        )
      })}
    </>
  )
}

// ---- BattleshipTable ----

export function BattleshipTable({
  localPlayerId,
  opponentName,
  opponentColor,
  connection,
  notice,
  publicState,
  board,
  onPlaceFleet,
  onFire,
  onLeave,
}: BattleshipTableProps) {
  const opponentId = publicState.turn.playerOrder.find((id) => id !== localPlayerId)!
  const variant = publicState.variant
  const isMyTurn = currentPlayer(publicState.turn) === localPlayerId
  const placing = publicState.stage === 'placing'
  const drafting = placing && !publicState.placedReady[localPlayerId]

  // ---- Local state ----
  const { play, enabled, setEnabled, turnSoundEnabled, setTurnSoundEnabled, playTurnStart } = useSound()
  useTurnStartSound(isMyTurn, opponentId === 'bot' ? 1 : 2, playTurnStart)
  const [draft, setDraft] = useState<(ShipId | null)[]>(() => Array.from({ length: BOARD_CELLS }, () => null))
  const [placedIds, setPlacedIds] = useState<ShipId[]>([])
  const [selIdx, setSelIdx] = useState(-1)
  const [orient, setOrient] = useState<'h' | 'v'>('h')
  const [hoverCell, setHoverCell] = useState(-1)
  const [rulesOpen, setRulesOpen] = useState(false)

  // ---- Derived ----
  const displayBoard = drafting ? draft : board
  const myHits = publicState.hits[localPlayerId]
  const enemyHits = publicState.hits[opponentId]
  const sunkCells = useMemo(
    () => new Set((publicState.sunk[opponentId] ?? []).flatMap((r) => r.cells)),
    [publicState.sunk, opponentId],
  )
  const enemyRevealBoard = useMemo(() => {
    const b: (ShipId | null)[] = Array.from({ length: BOARD_CELLS }, () => null)
    for (const reveal of publicState.sunk[opponentId] ?? []) {
      for (const c of reveal.cells) b[c] = reveal.shipId
    }
    return b
  }, [publicState.sunk, opponentId])

  // ---- Effects ----
  // Spacebar rotates while placing
  useEffect(() => {
    if (!drafting) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      e.preventDefault()
      setOrient((o) => (o === 'h' ? 'v' : 'h'))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drafting])

  // Shot sounds — both players hear every shot (no wasMyTurn gate).
  const lastShot = publicState.lastShot
  const shotSig = lastShot ? `${publicState.turn.turnNumber}:${lastShot.by}:${lastShot.cell}` : 'none'
  const shotSigRef = useRef(shotSig)
  useEffect(() => {
    if (shotSig === shotSigRef.current) return
    shotSigRef.current = shotSig
    if (!lastShot) return
    if (lastShot.result === 'hit') play('ship-hit')
    else if (lastShot.result === 'miss') play('ship-miss')
    else play('ship-sunk')
  }, [shotSig, lastShot, play])

  // ---- Placement logic ----
  const selectedShip = selIdx >= 0 ? SHIPS[selIdx] : null

  const preview = useMemo(() => {
    if (!drafting || !selectedShip || hoverCell < 0) return null
    const cells = shipCellsAt(hoverCell, selectedShip.len, orient)
    if (cells === null) return { cells: [hoverCell], legal: false }
    return { cells, legal: fits(draft, cells) }
  }, [drafting, selectedShip, hoverCell, orient, draft])

  function handleGridClick(i: number) {
    if (!drafting || !selectedShip) return
    const cells = shipCellsAt(i, selectedShip.len, orient)
    if (!cells || !fits(draft, cells)) return
    const next = [...draft]
    for (const c of cells) next[c] = selectedShip.id
    setDraft(next)
    const nextPlaced = [...placedIds, selectedShip.id]
    setPlacedIds(nextPlaced)
    setSelIdx(SHIPS.findIndex((s) => !nextPlaced.includes(s.id)))
    setHoverCell(-1)
    play('piece-drop')
  }

  function handleRandomize() {
    setDraft(randomFleet(Math.random, draft, placedIds))
    setPlacedIds(SHIPS.map((s) => s.id))
    setSelIdx(-1)
    setHoverCell(-1)
    play('piece-drop')
  }

  function handleStartBattle() {
    onPlaceFleet(draft)
  }

  // ---- Status text ----
  let statusText: string
  let statusIsBanner = false
  if (drafting) {
    if (selectedShip) {
      statusText = `Placing: ${selectedShip.name} (${selectedShip.len}) — click your grid to drop it`
    } else if (placedIds.length === 5) {
      statusText = 'Fleet placed — start the battle when ready.'
    } else {
      statusText = 'Pick a ship below to place it.'
    }
  } else if (placing) {
    statusText = `Waiting for ${opponentName} to place their fleet…`
    statusIsBanner = true
  } else if (!lastShot) {
    statusText = variant === 'free'
      ? 'Fire at will!'
      : isMyTurn ? 'Your move — fire at the enemy waters.' : `${opponentName} fires first.`
  } else if (lastShot.result === 'sunk') {
    const shipName = SHIPS.find((s) => s.id === lastShot.shipId)?.name ?? ''
    statusText = publicState.stage === 'over'
      ? lastShot.by === localPlayerId
        ? 'You sank the whole enemy fleet!'
        : `${opponentName} sank your whole fleet!`
      : lastShot.by === localPlayerId
        ? variant === 'streak'
          ? `You sank their ${shipName}! Fire again.`
          : `You sank their ${shipName}!`
        : `${opponentName} sank your ${shipName}!`
  } else if (lastShot.result === 'hit') {
    statusText = lastShot.by === localPlayerId
      ? variant === 'streak'
        ? 'Direct hit! Fire again.'
        : 'Direct hit!'
      : `${opponentName} hit your fleet.`
  } else {
    statusText = lastShot.by === localPlayerId ? 'Miss.' : `${opponentName} missed.`
  }

  const chipTitle = placing
    ? 'Placing fleets'
    : variant === 'free'
      ? 'Free-for-all'
      : isMyTurn ? 'Your move' : `${opponentName}'s move`
  const chipColor = placing || variant === 'free' ? BRAND : isMyTurn ? 'var(--green-text)' : opponentColor
  const hint = publicState.stage === 'battle'
    ? variant === 'free'
      ? 'No turns — sink all five first.'
      : isMyTurn ? 'Click enemy waters to fire.' : `${opponentName} is aiming…`
    : ''

  // ---- Render ----
  return (
    <div className="bs-table">
      {/* Header */}
      <div className="bs-header">
        <div className="bs-header-left">
          <Wordmark small onClick={onLeave} />
          <span className="bs-game-label">Battleship</span>
          <span className="bs-peer-strip">
            <span
              className="bs-peer-dot"
              style={{ background: connection === 'connected' ? 'var(--green)' : 'var(--coral)' }}
            />
            <span className="bs-peer-label">
              {connection === 'connected' ? `peer to peer with ${opponentName}` : `connection to ${opponentName} lost`}
            </span>
          </span>
        </div>
        <ScoreHeader
          youScore={publicState.scores[localPlayerId] ?? 0}
          youColor="var(--green-text)"
          opponentName={opponentName}
          opponentScore={publicState.scores[opponentId] ?? 0}
          opponentColor={opponentColor}
          hint="ships sunk"
        />
        <div className="bs-header-actions">
          <TurnSoundToggle enabled={turnSoundEnabled} onToggle={() => setTurnSoundEnabled(!turnSoundEnabled)} />
          <SoundToggle enabled={enabled} onToggle={() => setEnabled(!enabled)} />
          <button type="button" className="btn pill-small" onClick={() => setRulesOpen(true)}>Rules</button>
          <button type="button" className="btn btn-ghost" onClick={onLeave}>Leave</button>
        </div>
      </div>


      {/* Error banner */}
      {notice && <div className="bs-error-banner">{notice}</div>}

      {/* Main table card */}
      <div className="bs-main-card">
        {/* Status area */}
        <div className="bs-status">
          <span className="bs-turn-chip" style={{ background: chipColor }}>{chipTitle}</span>
          <div className={statusIsBanner ? 'bs-status-text bs-banner' : 'bs-status-text'}>{statusText}</div>
          {hint && <div className="bs-hint">{hint}</div>}
        </div>

        {/* Boards */}
        <div className="bs-boards">
          {/* Your fleet */}
          <div className="bs-board">
            <div className="bs-board-title">Your fleet</div>
            <div className="bs-board-cols">
              {COL_LETTERS.map((l) => <span key={l}>{l}</span>)}
            </div>
            <div className="bs-board-body">
              <div className="bs-board-rows">
                {ROW_NUMBERS.map((n) => <span key={n}>{n}</span>)}
              </div>
              <div className="bs-grid-wrap">
                <div className="bs-grid">
                  {Array.from({ length: BOARD_CELLS }, (_, i) => {
                    const mark = myHits[i]
                    const shipId = displayBoard[i]
                    const sunkHere = mark === 'hit' && shipId !== null && isShipSunk(displayBoard, myHits, shipId)
                    const view = cellView(mark, sunkHere)
                    const previewStyle = preview && preview.cells.includes(i)
                      ? preview.legal ? PREVIEW_LEGAL : PREVIEW_ILLEGAL
                      : null
                    return (
                      <button
                        key={i}
                        type="button"
                        className="bs-cell"
                        style={{
                          background: previewStyle ? previewStyle.bg : view.bg,
                          borderColor: previewStyle ? previewStyle.border : view.border,
                        }}
                        disabled={!drafting}
                        onClick={drafting ? () => handleGridClick(i) : undefined}
                        onMouseEnter={drafting ? () => setHoverCell(i) : undefined}
                        onMouseLeave={drafting ? () => setHoverCell(-1) : undefined}
                      >
                        <span
                          className="bs-marker"
                          style={{
                            backgroundImage: `url(${markers})`,
                            backgroundPositionX: `${view.frame * (100 / 3)}%`,
                          }}
                        />
                      </button>
                    )
                  })}
                </div>
                <ShipOverlays board={displayBoard} hits={myHits} alwaysDim={false} />
              </div>
            </div>
            <div className="bs-pills">
              {SHIPS.map((ship) => {
                const sunk = isShipSunk(displayBoard, myHits, ship.id)
                const damaged = !sunk && isShipDamaged(displayBoard, myHits, ship.id)
                const pillStyle = sunk
                  ? { background: '#17173a', color: '#fff', borderColor: '#17173a' }
                  : damaged
                    ? { background: '#ffd23f', color: '#17173a', borderColor: '#17173a' }
                    : { background: BRAND, color: '#fff', borderColor: '#17173a' }
                return (
                  <span key={ship.id} className="bs-pill" style={pillStyle}>{ship.name}</span>
                )
              })}
            </div>
          </div>

          {/* Enemy waters */}
          <div className="bs-board">
            <div className="bs-board-title">Enemy waters</div>
            <div className="bs-board-cols">
              {COL_LETTERS.map((l) => <span key={l}>{l}</span>)}
            </div>
            <div className="bs-board-body">
              <div className="bs-board-rows">
                {ROW_NUMBERS.map((n) => <span key={n}>{n}</span>)}
              </div>
              <div className={`bs-grid-wrap${placing ? ' bs-grid-wrap--dimmed' : ''}`}>
                <div className="bs-grid">
                  {Array.from({ length: BOARD_CELLS }, (_, i) => {
                    const mark = enemyHits[i]
                    const view = cellView(mark, sunkCells.has(i))
                    const fired = mark !== null
                    const clickable = publicState.stage === 'battle' && (variant === 'free' || isMyTurn) && !fired
                    return (
                      <button
                        key={i}
                        type="button"
                        className="bs-cell"
                        style={{ background: view.bg, borderColor: view.border }}
                        disabled={placing || !clickable}
                        onClick={clickable ? () => onFire(i) : undefined}
                      >
                        <span
                          className="bs-marker"
                          style={{
                            backgroundImage: `url(${markers})`,
                            backgroundPositionX: `${view.frame * (100 / 3)}%`,
                          }}
                        />
                      </button>
                    )
                  })}
                </div>
                <ShipOverlays board={enemyRevealBoard} hits={enemyHits} alwaysDim />
              </div>
            </div>
            <div className="bs-pills">
              {SHIPS.map((ship) => {
                const sunk = (publicState.sunk[opponentId] ?? []).some((r) => r.shipId === ship.id)
                const pillStyle = sunk
                  ? { background: '#17173a', color: '#fff', borderColor: '#17173a' }
                  : { background: '#fff', color: '#c2c2d8', borderColor: '#e4e4f0' }
                return (
                  <span key={ship.id} className="bs-pill" style={pillStyle}>{ship.name}</span>
                )
              })}
            </div>
          </div>
        </div>

        {/* Placement tray + actions */}
        {drafting && (
          <>
            <div className="bs-tray">
              {SHIPS.map((ship, i) => {
                const placed = placedIds.includes(ship.id)
                const selected = selIdx === i
                return (
                  <button
                    key={ship.id}
                    type="button"
                    className={`bs-tray-row${selected ? ' bs-tray-row--selected' : ''}${placed ? ' bs-tray-row--placed' : ''}`}
                    onClick={placed ? undefined : () => setSelIdx(i)}
                    disabled={placed}
                  >
                    <div className="bs-tray-row-main">
                      <span className="bs-tray-row-name">{ship.name}</span>
                      <span className="bs-tray-row-chips">
                        {Array.from({ length: ship.len }, (_, j) => (
                          <span key={j} className="bs-tray-chip" />
                        ))}
                      </span>
                    </div>
                    <span className="bs-tray-row-sub">{placed ? 'Placed' : `${ship.len} squares`}</span>
                  </button>
                )
              })}
            </div>
            <div className="bs-placement-actions">
              <button type="button" className="btn" onClick={() => setOrient((o) => (o === 'h' ? 'v' : 'h'))}>
                {orient === 'h' ? 'Horizontal ↔' : 'Vertical ↕'}
              </button>
              <button type="button" className="btn" onClick={handleRandomize} disabled={placedIds.length === 5}>
                Randomize remaining
              </button>
              <button type="button" className="btn btn-coral" onClick={handleStartBattle} disabled={placedIds.length !== 5}>
                Start battle
              </button>
            </div>
          </>
        )}
      </div>


      {rulesOpen && <BattleshipRulesOverlay onClose={() => setRulesOpen(false)} />}
    </div>
  )
}
