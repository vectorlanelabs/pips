import { useEffect, useMemo, useRef, useState } from 'react'
import type { MTLaneKey, MTPublicState, MTTile } from '../board-games/mexican-train/state'
import { handHasLegalPlay, legalLanes } from '../board-games/mexican-train/state'
import { currentPlayer } from '../engine/turn-engine'
import { DealIntro, type DealIntroCardBackProps } from '../components/DealIntro'
import { SoundToggle } from '../components/SoundToggle'
import { TurnSoundToggle } from '../components/TurnSoundToggle'
import { Wordmark } from '../components/Wordmark'
import { MexicanTrainRulesOverlay } from './MexicanTrainRulesOverlay'
import { useSound } from '../hooks/useSound'
import { useTurnStartSound } from '../hooks/useTurnStartSound'
import './MexicanTrainTable.css'

// ---- Props ----

export interface MexicanTrainTableProps {
  code: string
  localPlayerId: string
  names: Record<string, string>
  colors: Record<string, string>        // playerId -> seat ink
  connection: 'connected' | 'disconnected'
  notice?: string | null
  publicState: MTPublicState
  hand: MTTile[]                        // your private hand
  onPlayTile: (tileId: string, lane: MTLaneKey) => void
  onDraw: () => void
  onLeave: () => void
}

// ---- Brand + seat helpers ----

const MEX_COLOR = '#c2410c'

// ---- Numeral tile (placed cars + the station's engine double) ----

function NumeralTile({ a, b, size }: { a: number; b: number; size: 'car' | 'engine' }) {
  return (
    <div className={`mt-numeral mt-numeral--${size}`} aria-hidden="true">
      <span className="mt-numeral-half">{a}</span>
      <span className="mt-numeral-bar" />
      <span className="mt-numeral-half">{b}</span>
    </div>
  )
}

// ---- Locomotive: chunky side-view engine, faces RIGHT ----

function Loco({ color, star = false }: { color: string; star?: boolean }) {
  return (
    <svg className="mt-loco" viewBox="0 0 64 40" aria-hidden="true">
      {/* cab */}
      <rect x="2" y="6" width="18" height="27" rx="3" fill={color} stroke="#17173a" strokeWidth="3" />
      {/* boiler with rounded nose */}
      <rect x="20" y="15" width="30" height="17" rx="7" fill={color} stroke="#17173a" strokeWidth="3" />
      {/* chimney */}
      <rect x="38" y="3" width="7" height="12" rx="2" fill={color} stroke="#17173a" strokeWidth="3" />
      {/* steam dome */}
      <circle cx="29" cy="12" r="4.5" fill={color} stroke="#17173a" strokeWidth="3" />
      {/* cowcatcher wedge */}
      <polygon points="50,29 50,34 62,36" fill={color} stroke="#17173a" strokeWidth="3" />
      {/* wheels */}
      <circle cx="14" cy="32" r="6" fill={color} stroke="#17173a" strokeWidth="3" />
      <circle cx="44" cy="32" r="6" fill={color} stroke="#17173a" strokeWidth="3" />
      {star && (
        <polygon
          points="11,17.5 9.2,22.6 3.9,22.7 8.1,25.9 6.6,31.1 11,28 15.4,31.1 13.9,25.9 18.1,22.7 12.8,22.6"
          fill="#fff"
          stroke="#17173a"
          strokeWidth="1.5"
        />
      )}
    </svg>
  )
}

// ---- Signal post: coral when the train is closed, green when open ----

function Signal({ open }: { open: boolean }) {
  return (
    <span className={`mt-signal${open ? ' mt-signal--open' : ''}`} title={open ? 'open' : 'closed'} aria-hidden="true">
      <span className="mt-signal-mast" />
      <span className="mt-signal-disc" />
    </span>
  )
}

// ---- Tile back (deal intro) ----

interface MTTileBackProps {
  size: DealIntroCardBackProps['size']
  style?: DealIntroCardBackProps['style']
  className?: string
}

// A simple rounded-rect back in the rail's coral, with an ink border —
// MT's own visual language, distinct from Dominoes' white/brand-dot back.
function MTTileBack({ size, style, className }: MTTileBackProps) {
  const cls = ['mt-tile-back', `mt-tile-back--${size}`, className].filter(Boolean).join(' ')
  return <div className={cls} style={style} />
}

// ---- Rail status line ----

function computeRailStatus(
  publicState: MTPublicState,
  localPlayerId: string,
  names: Record<string, string>,
): string {
  const currentId = currentPlayer(publicState.turn)
  const currentName = names[currentId] ?? currentId
  if (publicState.stage === 'over') {
    const winnerId = publicState.matchWinnerId
    if (winnerId === null) return ''
    return `${names[winnerId] ?? winnerId} takes it with the fewest pips!`
  }
  if (publicState.stage === 'roundEnd') {
    const result = publicState.roundResult
    if (result === null) return ''
    if (result.kind === 'blocked') return 'Nobody can play — round blocked.'
    if (result.outPlayerId === localPlayerId) return 'You went out — round over.'
    return `${names[result.outPlayerId!] ?? result.outPlayerId} went out — round over.`
  }
  if (publicState.doublePending) {
    return currentId === localPlayerId
      ? 'Double! Play again.'
      : `${currentName} played a double — they play again.`
  }
  return currentId === localPlayerId ? 'Your move.' : `${currentName} is thinking…`
}

// ---- MexicanTrainTable ----

export function MexicanTrainTable({
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
  onLeave,
}: MexicanTrainTableProps) {
  // ---- Derived ----
  const mySeat = publicState.seatOrder.indexOf(localPlayerId)
  const myLane = ('p' + mySeat) as MTLaneKey
  const myTurn = currentPlayer(publicState.turn) === localPlayerId
  const canAct = myTurn && publicState.stage === 'play'
  const noLegalPlay = useMemo(
    () => !handHasLegalPlay(hand, mySeat, publicState),
    [hand, mySeat, publicState],
  )
  // Lane order: your train first, then the other seats in seat order, then mex.
  const laneOrder = useMemo<MTLaneKey[]>(() => {
    const rest: MTLaneKey[] = []
    for (let i = 0; i < publicState.seatOrder.length; i++) {
      const lane = ('p' + i) as MTLaneKey
      if (lane !== myLane) rest.push(lane)
    }
    return [myLane, ...rest, 'mex']
  }, [myLane, publicState.seatOrder])

  // ---- Local state ----
  const { play, enabled, setEnabled, turnSoundEnabled, setTurnSoundEnabled, playTurnStart } = useSound()
  const humanCount = publicState.seatOrder.filter((id) => !id.startsWith('bot')).length
  useTurnStartSound(myTurn, humanCount, playTurnStart)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedTile = useMemo(() => hand.find((t) => t.id === selectedId) ?? null, [hand, selectedId])
  const selectedLegal = useMemo(
    () => (selectedTile === null ? [] : legalLanes(selectedTile, mySeat, publicState)),
    [selectedTile, mySeat, publicState],
  )

  // Coupler rows: which car index starts a wrapped row in each lane's track
  // (its offsetTop differs from the previous car's) — those don't get a coupler.
  const trackEls = useRef<Record<string, HTMLDivElement | null>>({})
  const [rowStartMap, setRowStartMap] = useState<Record<string, number[]>>({})

  // Fresh-round detection: show the deal intro exactly once per distinct
  // round this component instance ever sees (including on mount for round 0).
  const introShownForRoundRef = useRef<number | null>(null)
  const [showIntro, setShowIntro] = useState(false)
  useEffect(() => {
    if (introShownForRoundRef.current !== publicState.round) {
      introShownForRoundRef.current = publicState.round
      setShowIntro(true)
    }
  }, [publicState.round])

  // Clear the selection once the turn/stage moves on, or the tile leaves the hand.
  useEffect(() => {
    setSelectedId(null)
  }, [myTurn, publicState.stage])
  useEffect(() => {
    setSelectedId((prev) => (prev !== null && hand.some((t) => t.id === prev) ? prev : null))
  }, [hand])

  // Measure wrapped rows in every track (trains change per action; the
  // ResizeObserver catches card width changes that re-wrap a long train).
  useEffect(() => {
    const measure = () => {
      const next: Record<string, number[]> = {}
      for (const lane of laneOrder) {
        const el = trackEls.current[lane]
        if (!el) continue
        const starts: number[] = []
        let prevTop: number | null = null
        let i = 0
        for (const child of Array.from(el.children)) {
          if (!(child instanceof HTMLElement) || !child.classList.contains('mt-car')) continue
          if (i > 0 && prevTop !== null && child.offsetTop !== prevTop) starts.push(i)
          prevTop = child.offsetTop
          i++
        }
        next[lane] = starts
      }
      setRowStartMap(next)
    }
    measure()
    const observers = laneOrder.map((lane) => {
      const el = trackEls.current[lane]
      if (!el) return null
      const ro = new ResizeObserver(measure)
      ro.observe(el)
      return ro
    })
    return () => {
      for (const ro of observers) if (ro !== null) ro.disconnect()
    }
  }, [laneOrder, publicState.trains])

  // ---- Sounds ----
  // Diff lastAction identity (every accepted action replaces it), plus stage,
  // roundResult, and round transitions. Both players hear everything — no
  // wasMyTurn gate, mirroring the Checkers/Battleship ref-guard.
  const lastActionRef = useRef(publicState.lastAction)
  const stageRef = useRef(publicState.stage)
  const roundResultRef = useRef(publicState.roundResult)
  useEffect(() => {
    let hornPlayed = false
    const action = publicState.lastAction
    if (action !== lastActionRef.current) {
      lastActionRef.current = action
      if (action?.kind === 'play') play('domino-play')
      else if (action?.kind === 'draw') play('domino-draw')
      if (action !== null && action.opened !== null) {
        play('train-horn')
        hornPlayed = true
      }
    }
    if (publicState.stage !== stageRef.current) {
      stageRef.current = publicState.stage
      if (publicState.stage === 'roundEnd') play('round-win')
      else if (publicState.stage === 'over') play('game-win')
    }
    if (publicState.roundResult !== roundResultRef.current) {
      roundResultRef.current = publicState.roundResult
      if (publicState.roundResult?.kind === 'blocked' && !hornPlayed) play('train-horn')
    }
  }, [publicState.lastAction, publicState.stage, publicState.roundResult, play])

  // ---- Hand interaction ----
  const handleTileClick = (tile: MTTile) => {
    if (!canAct) return
    if (legalLanes(tile, mySeat, publicState).length === 0) return
    setSelectedId((prev) => (prev === tile.id ? null : tile.id))
  }

  // ---- Status ----
  const status = useMemo(
    () => computeRailStatus(publicState, localPlayerId, names),
    [publicState, localPlayerId, names],
  )
  // Boneyard empty + no legal play: the host auto-applies PASS for you after a short beat
  // (see App.tsx's auto-pass effect) — nothing to click, so say so instead of leaving the
  // player wondering why the table went quiet.
  const autoPassing = canAct && noLegalPlay && publicState.boneyardCount === 0
  const hint = canAct
    ? (autoPassing
        ? 'No move — passing…'
        : selectedTile !== null ? 'Tap a glowing train to place it.' : 'Pick a tile from your hand.')
    : null
  const canDraw = canAct && noLegalPlay && publicState.boneyardCount > 0

  // ---- Deal intro ----
  const others = useMemo(
    () =>
      publicState.seatOrder
        .filter((id) => id !== localPlayerId)
        .map((id) => ({
          id,
          name: names[id] ?? id,
          color: colors[id] ?? MEX_COLOR,
          handSize: publicState.handCounts[id] ?? 0,
        })),
    [publicState.seatOrder, publicState.handCounts, localPlayerId, names, colors],
  )

  // ---- Round-end banner ----
  // Only shows for stage 'roundEnd' — MexicanTrainTable is never mounted for
  // stage 'over' (App.tsx routes that to MexicanTrainResults instead).
  const roundBannerText = useMemo(() => {
    if (publicState.stage !== 'roundEnd') return null
    const result = publicState.roundResult
    if (result === null) return null
    const nextRoundNumber = publicState.round + 2
    if (result.kind === 'out') {
      const name =
        result.outPlayerId === localPlayerId ? 'You' : names[result.outPlayerId!] ?? result.outPlayerId
      return `${name} went out — round over. Round ${nextRoundNumber} starts automatically.`
    }
    return `Nobody could play — round blocked. Round ${nextRoundNumber} starts automatically.`
  }, [publicState.stage, publicState.roundResult, publicState.round, localPlayerId, names])

  // ---- Render ----
  return (
    <div className="mt-table">
      {/* Header */}
      <div className="mt-header">
        <div className="mt-header-left">
          <Wordmark small onClick={onLeave} />
          <span className="mt-game-label">Mexican Train</span>
          <span className="mt-peer-strip">
            <span
              className="mt-peer-dot"
              style={{ background: connection === 'connected' ? 'var(--green)' : 'var(--coral)' }}
            />
            <span className="mt-peer-label">
              {connection === 'connected' ? 'Live' : 'Connection lost'}
            </span>
          </span>
        </div>
        <div className="mt-header-actions">
          <TurnSoundToggle enabled={turnSoundEnabled} onToggle={() => setTurnSoundEnabled(!turnSoundEnabled)} />
          <SoundToggle enabled={enabled} onToggle={() => setEnabled(!enabled)} />
          <button type="button" className="btn pill-small" onClick={() => setRulesOpen(true)}>Rules</button>
          <button type="button" className="btn btn-ghost" onClick={onLeave}>Leave</button>
        </div>
      </div>

      {/* Chips */}
      <div className="mt-chips">
        <span className="chip" style={{ background: 'var(--yellow)', color: 'var(--ink)' }}>Mexican Train · {code}</span>
        <span className="chip" style={{ background: 'transparent', color: 'var(--muted-text)' }}>
          Round {publicState.round + 1} of 13 · double-{publicState.engine}
        </span>
      </div>

      {/* Error banner */}
      {notice && <div className="mt-error-banner">{notice}</div>}

      {/* Main table card: the board column with the rail to its right.
          row-reverse puts the rail (DOM-first of the row pair) on the board's
          right; on narrow screens the rail wraps back to its own row above the
          board column. */}
      <div className="mt-table-card">
        {showIntro ? (
          <DealIntro
            others={others}
            yourHandSize={hand.length}
            shuffleSound="domino-shuffle"
            renderCardBack={(p) => <MTTileBack {...p} />}
            onComplete={() => setShowIntro(false)}
            maxFlights={hand.length + others.reduce((sum, o) => sum + o.handSize, 0)}
          />
        ) : (
        <>
        {/* Round-end banner */}
        {roundBannerText !== null && (
          <div className="mt-round-banner">{roundBannerText}</div>
        )}

        {/* Rail: one seat card per seat + the general status line, in a ~200px column */}
        <div className="mt-rail">
          {publicState.seatOrder.map((playerId) => {
            const isTurn = playerId === currentPlayer(publicState.turn)
            const color = colors[playerId] ?? 'var(--slate-pip)'
            const sub = isTurn
              ? (playerId === localPlayerId ? 'your move' : 'their move')
              : 'pips (lower wins)'
            return (
              <div
                key={playerId}
                className={`mt-seat-card${isTurn ? ' mt-seat-card--active' : ''}`}
                style={isTurn ? { background: color, borderColor: color, color: '#fff' } : undefined}
              >
                <span className="mt-seat-dot" style={{ background: color }} />
                <div className="mt-seat-info">
                  <span className="mt-seat-name">
                    {names[playerId] ?? playerId}{playerId === localPlayerId ? ' (you)' : ''}
                  </span>
                  <span className="mt-seat-score">{publicState.scores[playerId] ?? 0}</span>
                  <span className="mt-seat-sub">{sub}</span>
                </div>
              </div>
            )
          })}
          <div className="mt-status">{status}</div>
        </div>

        {/* Board column: depot, the five lanes, then your hand */}
        <div className="mt-board-col">
          {/* Depot (station): the building holds the engine double; a short
              track stub below feeds the lanes */}
          <div className="mt-depot">
            <div className="mt-station">
              <div className="mt-station-roof" />
              <div className="mt-station-body">
                <span className="mt-station-label">Station</span>
                <NumeralTile a={publicState.engine} b={publicState.engine} size="engine" />
              </div>
            </div>
            <div className="mt-track-stub" />
          </div>

          {/* The lanes: one Mexican train shared by everyone, plus one train per seat */}
          <div className="mt-lanes">
            {laneOrder.map((lane) => {
              const isMex = lane === 'mex'
              const seatIdx = isMex ? -1 : Number(lane.slice(1))
              const playerId = isMex ? null : publicState.seatOrder[seatIdx]
              const color = isMex ? MEX_COLOR : (colors[playerId!] ?? 'var(--slate-pip)')
              const open = isMex ? true : publicState.open[lane]
              const label = isMex
                ? 'Mexican train'
                : seatIdx === mySeat
                  ? 'Your train'
                  : `${names[playerId!] ?? playerId}’s train`
              const ghost = selectedTile !== null && canAct && selectedLegal.includes(lane)
              return (
                <div key={lane} className="mt-lane">
                  <div className="mt-lane-label">
                    <span className={`mt-loco-dock${!isMex && open ? ' mt-loco-dock--open' : ''}`}>
                      <Loco color={color} star={isMex} />
                    </span>
                    <Signal open={open} />
                    <span className="mt-lane-name">{label}</span>
                  </div>
                  <div className="mt-track" ref={(el) => { trackEls.current[lane] = el }}>
                    {publicState.trains[lane].map((tile, i) => (
                      <div
                        key={i}
                        className={`mt-car${rowStartMap[lane]?.includes(i) ? ' mt-car--row-start' : ''}`}
                      >
                        <NumeralTile a={tile.inner} b={tile.outer} size="car" />
                      </div>
                    ))}
                    {ghost && (
                      <button
                        type="button"
                        className="mt-ghost"
                        onClick={() => onPlayTile(selectedTile.id, lane)}
                        aria-label={`Play selected tile on ${label}`}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Hand + draw controls */}
          <div className="mt-hand-block">
            <div className="mt-hand-row">
              {hand.map((tile) => {
                const selected = selectedId === tile.id
                const canSelect = canAct && legalLanes(tile, mySeat, publicState).length > 0
                return (
                  <button
                    key={tile.id}
                    type="button"
                    className={`mt-hand-tile${selected ? ' mt-hand-tile--selected' : ''}${!canSelect ? ' mt-hand-tile--dead' : ''}`}
                    onClick={() => handleTileClick(tile)}
                    disabled={!canSelect}
                    aria-label={`Domino ${tile.a} ${tile.b}${selected ? ', selected' : ''}`}
                  >
                    <span className="mt-hand-half">{tile.a}</span>
                    <span className="mt-hand-bar" />
                    <span className="mt-hand-half">{tile.b}</span>
                  </button>
                )
              })}
            </div>
            <div className="mt-draw-row">
              <span className="mt-boneyard-stats">
                Boneyard: {publicState.boneyardCount} · your hand: {hand.length}
              </span>
              <button type="button" className="btn btn-coral" onClick={onDraw} disabled={!canDraw}>
                Draw a tile
              </button>
            </div>
          </div>

          {/* Hint (yours, under the board) */}
          {hint !== null && <div className="mt-hint">{hint}</div>}
        </div>
        </>
        )}
      </div>

      {rulesOpen && <MexicanTrainRulesOverlay onClose={() => setRulesOpen(false)} />}
    </div>
  )
}
