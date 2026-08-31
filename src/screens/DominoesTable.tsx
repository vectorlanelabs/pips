import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DominoArm, DominoesPublicState, DominoTile } from '../board-games/dominoes/state'
import { handHasLegalPlay, legalArms } from '../board-games/dominoes/state'
import { layoutBoard, scaleToFit, type LaidTile } from '../board-games/dominoes/layout'
import { currentPlayer } from '../engine/turn-engine'
import { DealIntro, type DealIntroCardBackProps } from '../components/DealIntro'
import { Wordmark } from '../components/Wordmark'
import { SoundToggle } from '../components/SoundToggle'
import { TurnSoundToggle } from '../components/TurnSoundToggle'
import { DominoesRulesOverlay } from './DominoesRulesOverlay'
import { useSound } from '../hooks/useSound'
import { useTurnStartSound } from '../hooks/useTurnStartSound'
import './DominoesTable.css'

// ---- Props ----

export interface DominoesTableProps {
  code: string
  localPlayerId: string
  names: Record<string, string>
  colors: Record<string, string>
  connection: 'connected' | 'disconnected'
  notice?: string | null
  publicState: DominoesPublicState
  hand: DominoTile[]              // your private hand (zone.cards)
  onPlayTile: (tileId: string, arm: DominoArm | 'center') => void
  onDraw: () => void
  onPass: () => void
  onLeave: () => void
}

// ---- Pip art ----

// Pip positions (index 0–8, row-major in a 3×3 grid) for each half value 0–6.
const PIPS: number[][] = [
  [], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8],
]

function TileHalf({ pips }: { pips: number }) {
  return (
    <div className="dm-tile-half">
      {(PIPS[pips] ?? []).map((i) => (
        <span
          key={i}
          className="dm-tile-pip"
          style={{
            left: `${(i % 3) * 33.333 + 16.667}%`,
            top: `${Math.floor(i / 3) * 33.333 + 16.667}%`,
          }}
        />
      ))}
    </div>
  )
}

// Which pip half faces back along the run: dir 'right' → inner on the LEFT
// half; 'left' → inner right; 'up' (travel −y) → inner bottom; 'down' → inner
// top. Doubles sit crosswise and split along their long axis — order cosmetic.
function halfOrder(tile: LaidTile): [number, number] {
  if (tile.isDouble) return [tile.inner, tile.outer]
  if (tile.horizontal) {
    return tile.dir === 'right' ? [tile.inner, tile.outer] : [tile.outer, tile.inner]
  }
  return tile.dir === 'up' ? [tile.outer, tile.inner] : [tile.inner, tile.outer]
}

function BoardTile({ tile, unit, cx, cy }: { tile: LaidTile; unit: number; cx: number; cy: number }) {
  const [first, second] = halfOrder(tile)
  return (
    <div
      className={`dm-tile ${tile.horizontal ? 'dm-tile--horizontal' : 'dm-tile--vertical'}`}
      style={{
        left: `calc(50% + ${(tile.x - cx) * unit}px)`,
        top: `calc(50% + ${(tile.y - cy) * unit}px)`,
        width: tile.w * unit,
        height: tile.h * unit,
      }}
    >
      <TileHalf pips={first} />
      <TileHalf pips={second} />
    </div>
  )
}

// ---- Domino tile back (deal intro + opponent hand) ----

type DominoTileBackSize = 'fan' | 'stock' | 'small'

interface DominoTileBackProps {
  size: DominoTileBackSize
  style?: DealIntroCardBackProps['style']
  className?: string
}

// 46×88-proportioned rounded-rect back in #fff with an ink border and a centred
// brand #5b5bd6 pips-logo dot. `fan`/`stock` serve DealIntro's renderCardBack,
// and `small` renders the opponent's hidden hand.
function DominoTileBack({ size, style, className }: DominoTileBackProps) {
  const cls = ['dm-tile-back', `dm-tile-back--${size}`, className].filter(Boolean).join(' ')
  return (
    <div className={cls} style={style}>
      <span className="dm-tile-back__dot" />
    </div>
  )
}

// ---- Status lines ----

function actorName(actorId: string, localPlayerId: string, names: Record<string, string>): string {
  return actorId === localPlayerId ? 'You' : (names[actorId] ?? actorId)
}

// Event line: the last action (null → this round just opened).
function computeEventLine(
  publicState: DominoesPublicState,
  localPlayerId: string,
  names: Record<string, string>,
): string {
  const action = publicState.lastAction
  if (action === null) {
    return publicState.roundStarterId === localPlayerId
      ? 'Your lead — play any tile to open the board.'
      : `${names[publicState.roundStarterId] ?? publicState.roundStarterId} opens the board…`
  }
  const name = actorName(action.by, localPlayerId, names)
  if (action.kind === 'lead' || action.kind === 'play') {
    const tile = action.tile
    const pipText = tile ? `${tile.a}·${tile.b}` : ''
    const bank = action.scored > 0 ? ` Bank +${action.scored}!` : ''
    return `${name} played ${pipText}.${bank}`
  }
  if (action.kind === 'draw') return `${name} drew from the boneyard.`
  return `${name} knocked.`
}

// Prompt line: what to do now ('play' stage) or how the round ended (roundEnd/over).
function computePromptLine(
  publicState: DominoesPublicState,
  localPlayerId: string,
  names: Record<string, string>,
  noLegalPlay: boolean,
): string {
  if (publicState.stage === 'play') {
    if (currentPlayer(publicState.turn) === localPlayerId) {
      if (noLegalPlay) {
        return publicState.boneyardCount > 0
          ? 'No match — draw from the boneyard.'
          : "No match, boneyard's empty — knock."
      }
      return 'Your move.'
    }
    const currentId = currentPlayer(publicState.turn)
    return `${names[currentId] ?? currentId} is thinking…`
  }

  const result = publicState.roundResult
  if (!result) return ''
  let line: string
  if (result.kind === 'out') {
    const name = actorName(result.scorerId ?? '', localPlayerId, names)
    line = `${name} went out — +${result.points}.`
  } else if (result.scorerId === null) {
    line = 'Blocked — nobody scores.'
  } else {
    const name = actorName(result.scorerId, localPlayerId, names)
    const verb = result.scorerId === localPlayerId ? 'bank' : 'banks'
    line = `Blocked — ${name} ${verb} +${result.points}.`
  }
  if (publicState.matchWinnerId === null) {
    line += ' Next round coming up…'
  }
  return line
}

// ---- DominoesTable ----

export function DominoesTable({
  code,
  localPlayerId,
  names,
  colors,
  connection,
  notice,
  publicState,
  hand,
  onPlayTile,
  onDraw,
  onPass,
  onLeave,
}: DominoesTableProps) {
  // ---- Derived ----
  const opponentIds = publicState.seatOrder.filter((id) => id !== localPlayerId)
  const isMyTurn = currentPlayer(publicState.turn) === localPlayerId
  const canAct = isMyTurn && publicState.stage === 'play'
  const isMyLead = publicState.center === null && isMyTurn
  const noLegalPlay = useMemo(() => !handHasLegalPlay(hand, publicState), [hand, publicState])
  const humanCount = publicState.seatOrder.filter((id) => !id.startsWith('bot')).length

  // ---- Local state ----
  const { play, enabled, setEnabled, turnSoundEnabled, setTurnSoundEnabled, playTurnStart } = useSound()
  useTurnStartSound(isMyTurn, humanCount, playTurnStart)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [paneSize, setPaneSize] = useState({ w: 0, h: 0 })
  const boardRef = useRef<HTMLDivElement>(null)

  // Fresh-round detection: show the deal intro exactly once per distinct
  // roundNumber this component instance ever sees.
  const introShownForRoundRef = useRef<number | null>(null)
  const [showIntro, setShowIntro] = useState(false)

  // ---- Effects ----
  // Show the deal intro on mount and on every START_NEXT_ROUND transition
  // (DealIntro plays the dominoes-flavoured shuffle sound at its shuffle phase).
  useEffect(() => {
    if (introShownForRoundRef.current !== publicState.roundNumber) {
      introShownForRoundRef.current = publicState.roundNumber
      setShowIntro(true)
    }
  }, [publicState.roundNumber])

  // Clear the selection when the hand changes in a way that invalidates it
  // (new deal, tile played) or once the round stops being live.
  useEffect(() => {
    setSelectedId((prev) => (prev !== null && hand.some((t) => t.id === prev) ? prev : null))
  }, [hand])
  useEffect(() => {
    if (publicState.stage !== 'play') setSelectedId(null)
  }, [publicState.stage])

  // Measure the board pane (unit = 40px × scaleToFit) on mount and on resize.
  // Deps include showIntro: while the deal intro is showing the board subtree
  // isn't mounted (boardRef.current is null) and the effect bails, so re-run
  // when the intro finishes and the board actually mounts.
  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    const measure = () => setPaneSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [showIntro])

  // Sound effects — diff room state transitions. Every accepted action replaces
  // lastAction (the HostSession revision lives in App, not in publicState), so
  // lastAction identity is the per-action marker; the stage catches round ends.
  // Both players hear everything — no wasMyTurn gate.
  const lastActionRef = useRef(publicState.lastAction)
  const prevStageRef = useRef(publicState.stage)
  useEffect(() => {
    const action = publicState.lastAction
    if (action !== lastActionRef.current) {
      if (action?.kind === 'lead' || action?.kind === 'play') play('domino-play')
      else if (action?.kind === 'draw') play('domino-draw')
      else if (action?.kind === 'pass') play('knock')
      lastActionRef.current = action
    }
    if (
      prevStageRef.current === 'play' &&
      publicState.stage !== 'play' &&
      publicState.roundResult !== null &&
      publicState.roundResult.scorerId !== null
    ) {
      play('round-win')
    }
    prevStageRef.current = publicState.stage
  }, [publicState.lastAction, publicState.stage, publicState.roundResult, play])

  // ---- Board geometry ----
  const layout = useMemo(
    () => layoutBoard(publicState.center, publicState.isSpinner, publicState.arms),
    [publicState.center, publicState.isSpinner, publicState.arms],
  )
  const scale = useMemo(
    () => (paneSize.w > 0 && paneSize.h > 0 ? scaleToFit(layout, paneSize.w, paneSize.h, 40) : 0),
    [layout, paneSize],
  )
  const unit = scale * 40
  const boardReady = scale > 0
  // Content-bounds midpoint: render everything offset by this so the board
  // centers itself as it grows (scaleToFit sizes by true bounds, so the
  // midpoint — not the origin — must sit at the pane center).
  const cx = (layout.minX + layout.maxX) / 2
  const cy = (layout.minY + layout.maxY) / 2

  // ---- Selection / legal targets ----
  const selectedTile = useMemo(() => hand.find((t) => t.id === selectedId) ?? null, [hand, selectedId])
  const selectedLegal = useMemo(
    () => (selectedTile ? legalArms(selectedTile, publicState) : []),
    [selectedTile, publicState],
  )
  const isLiveTarget = useCallback(
    (arm: DominoArm | 'center') => canAct && selectedTile !== null && selectedLegal.includes(arm),
    [canAct, selectedTile, selectedLegal],
  )

  // Hand tiles: enabled while the round is live and it's your turn, and the
  // tile has ≥1 legal arm (or it's your lead — every tile can open the board).
  const tileCanSelect = useCallback(
    (tile: DominoTile): boolean =>
      canAct && (publicState.center === null || legalArms(tile, publicState).length > 0),
    [canAct, publicState],
  )

  const handleTileClick = useCallback(
    (tile: DominoTile) => {
      if (!tileCanSelect(tile)) return
      if (publicState.center === null) {
        // Leading with an empty board: clicking a tile plays it to the center
        // immediately (matching the prototype) — no selection state.
        onPlayTile(tile.id, 'center')
        setSelectedId(null)
      } else {
        setSelectedId((prev) => (prev === tile.id ? null : tile.id))
      }
    },
    [tileCanSelect, publicState.center, onPlayTile],
  )

  // ---- Boneyard actions ----
  const canDraw = canAct && noLegalPlay && publicState.boneyardCount > 0
  const canKnock = canAct && noLegalPlay && publicState.boneyardCount === 0

  // ---- Status ----
  const eventLine = useMemo(
    () => computeEventLine(publicState, localPlayerId, names),
    [publicState, localPlayerId, names],
  )
  const promptLine = useMemo(
    () => computePromptLine(publicState, localPlayerId, names, noLegalPlay),
    [publicState, localPlayerId, names, noLegalPlay],
  )

  // ---- Render ----
  return (
    <div className="dm-table">
      {/* Header */}
      <div className="dm-header">
        <div className="dm-header-left">
          <Wordmark small onClick={onLeave} />
          <span className="dm-game-label">Dominoes</span>
          <span className="dm-peer-strip">
            <span
              className="dm-peer-dot"
              style={{ background: connection === 'connected' ? 'var(--green)' : 'var(--coral)' }}
            />
            <span className="dm-peer-label">
              {connection === 'connected' ? (
                opponentIds.length === 1
                  ? `peer to peer with ${names[opponentIds[0]] ?? opponentIds[0]}`
                  : `peer to peer with ${opponentIds.length} others`
              ) : 'connection lost'}
            </span>
          </span>
        </div>
        <div className="dm-scoreboard">
          {publicState.seatOrder.map((pid) => (
            <span key={pid} className="dm-score-pill">
              <span className="dm-score-dot" style={{ background: colors[pid] ?? '#5b5bd6' }} />
              {names[pid] ?? pid} {publicState.scores[pid] ?? 0}
            </span>
          ))}
          <span className="dm-score-hint">to {publicState.target}</span>
        </div>
        <div className="dm-header-actions">
          <TurnSoundToggle enabled={turnSoundEnabled} onToggle={() => setTurnSoundEnabled(!turnSoundEnabled)} />
          <SoundToggle enabled={enabled} onToggle={() => setEnabled(!enabled)} />
          <button type="button" className="btn pill-small" onClick={() => setRulesOpen(true)}>Rules</button>
          <button type="button" className="btn btn-ghost" onClick={onLeave}>Leave</button>
        </div>
      </div>

      {/* Code chip */}
      <div style={{ marginBottom: 'clamp(16px, 2.4vw, 26px)' }}>
        <span className="chip" style={{ background: 'var(--yellow)', color: 'var(--ink)' }}>Dominoes · {code}</span>
      </div>

      {/* Error banner */}
      {notice && <div className="dm-error-banner">{notice}</div>}

      {/* Main table card */}
      <div className="dm-table-card">
        {showIntro ? (
          <DealIntro
            others={opponentIds.map((id) => ({
              id,
              name: names[id] ?? id,
              color: colors[id] ?? '#5b5bd6',
              handSize: publicState.handCounts[id] ?? 0,
            }))}
            yourHandSize={hand.length}
            shuffleSound="domino-shuffle"
            renderCardBack={(p) => <DominoTileBack {...p} />}
            onComplete={() => setShowIntro(false)}
            maxFlights={hand.length + opponentIds.reduce((sum, id) => sum + (publicState.handCounts[id] ?? 0), 0)}
          />
        ) : (
        <>
        {/* Opponent rail */}
        <div className="dm-opp-rail">
          {opponentIds.map((seatId) => {
            const seatColor = colors[seatId] ?? '#5b5bd6'
            const seatName = names[seatId] ?? seatId
            const isTurn = seatId === currentPlayer(publicState.turn)
            const handCount = publicState.handCounts[seatId] ?? 0

            return (
              <div
                key={seatId}
                className={`dm-opp-tile${opponentIds.length <= 2 ? ' dm-opp-tile--wide' : ''}${isTurn ? ' dm-opp-tile--turn' : ''}`}
                style={isTurn ? { borderColor: seatColor } : undefined}
              >
                <div className="dm-opp-tile-top">
                  <span className="dm-seat-dot" style={{ background: seatColor }} />
                  <span className="dm-opp-name" style={{ color: seatColor }}>{seatName}</span>
                  {isTurn && <span className="dm-turn-tag" style={{ background: seatColor, color: '#fff' }}>turn</span>}
                </div>
                <div className="dm-opp-tile-hand">
                  {handCount > 0 && (
                    <div className="dm-opp-tile-fan">
                      {Array.from({ length: handCount }, (_, i) => (
                        <DominoTileBack key={i} size="small" />
                      ))}
                    </div>
                  )}
                  <span className="dm-opp-tile-count">{handCount} tiles · hidden</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Status — two lines above the board */}
        <div className="dm-status-block">
          <div className="dm-status-event">{eventLine}</div>
          <div className="dm-status-prompt">{promptLine}</div>
        </div>

        {/* Board */}
        <div className="dm-board" ref={boardRef}>
          {boardReady && (
            <>
              {layout.tiles.map((tile, i) => (
                <BoardTile key={i} tile={tile} unit={unit} cx={cx} cy={cy} />
              ))}
              {layout.targets.map((target) => {
                // The center target only shows while the board is empty and it
                // is your lead — clicking plays the selected tile to 'center'.
                if (target.arm === 'center' && !isMyLead) return null
                const live = isLiveTarget(target.arm)
                const diameter = target.r * 2 * unit
                return (
                  <button
                    key={target.arm}
                    type="button"
                    className={`dm-target${live ? ' dm-target--live' : ''}`}
                    style={{
                      left: `calc(50% + ${(target.x - cx) * unit}px)`,
                      top: `calc(50% + ${(target.y - cy) * unit}px)`,
                      width: diameter,
                      height: diameter,
                    }}
                    onClick={live && selectedTile ? () => onPlayTile(selectedTile.id, target.arm) : undefined}
                    disabled={!live}
                    aria-label={live ? 'Play selected tile here' : 'Play target'}
                  />
                )
              })}
            </>
          )}
        </div>

        {/* Hand + boneyard rail */}
        <div className="dm-hand-rail">
          <div className="dm-hand">
            <div className="dm-hand-header">
              <span className="dm-hand-label">Your hand</span>
              <span className="dm-hand-stats">{hand.length} tiles</span>
            </div>
            <div className="dm-hand-row">
              {hand.map((tile) => {
                const selected = selectedId === tile.id
                const canSelect = tileCanSelect(tile)
                return (
                  <button
                    key={tile.id}
                    type="button"
                    className={`dm-hand-tile${selected ? ' dm-hand-tile--selected' : ''}`}
                    onClick={() => handleTileClick(tile)}
                    disabled={!canSelect}
                    aria-label={`Domino ${tile.a} ${tile.b}${selected ? ', selected' : ''}`}
                  >
                    <TileHalf pips={tile.a} />
                    <TileHalf pips={tile.b} />
                  </button>
                )
              })}
            </div>
          </div>

          <div className="dm-boneyard">
            <span className="dm-boneyard-label">Boneyard · {publicState.boneyardCount}</span>
            <div className="dm-boneyard-actions">
              <button
                type="button"
                className="btn btn-teal dm-boneyard-btn"
                disabled={!canDraw}
                onClick={onDraw}
              >
                Draw
              </button>
              <button
                type="button"
                className="btn btn-coral dm-boneyard-btn"
                disabled={!canKnock}
                onClick={onPass}
              >
                Knock
              </button>
            </div>
          </div>
        </div>
        </>
        )}
      </div>

      {/* Footnote */}
      <p className="dm-footnote">Your hand never leaves this device — only the play does.</p>

      {rulesOpen && <DominoesRulesOverlay onClose={() => setRulesOpen(false)} />}
    </div>
  )
}
