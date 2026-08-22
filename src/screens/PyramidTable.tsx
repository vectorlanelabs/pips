import { useState, useEffect, useRef } from 'react'
import type { PyramidState, PyramidLoc, PyramidMove } from '../card-games/pyramid/state'
import { applyMove, cardAt, isExposed, legalPartners, rankValue } from '../card-games/pyramid/state'
import type { Rank, Suit } from '../card-engine/cards'
import { DealIntro } from '../components/DealIntro'
import { PlayingCard, CardBack } from '../components/PlayingCard'
import { TableHeader } from '../components/TableHeader'
import { useSound } from '../hooks/useSound'
import { PyramidRulesOverlay } from './PyramidRulesOverlay'
import './PyramidTable.css'

export const PYRAMID_COLOR = '#b8860b'

// Cards overlap slightly within and between rows, same "fixed play area,
// never resizes as you play" convention as Solitaire's .sol-column — see
// PyramidTable.css's .pyr-pyramid for the matching fixed container size.
const CARD_WIDTH = 75
const CARD_HEIGHT = 105
const COL_STEP = 60
const ROW_STEP = 40
const ROWS = 7

function locKey(loc: PyramidLoc): string {
  return loc.kind === 'waste' ? 'waste' : `${loc.row},${loc.col}`
}

function isSameLoc(a: PyramidLoc, b: PyramidLoc): boolean {
  return locKey(a) === locKey(b)
}

export interface PyramidTableProps {
  localName: string
  state: PyramidState
  cardBack: string
  dealId: number
  canUndo: boolean
  onMove: (move: PyramidMove) => void
  onUndo: () => void
  onDealAgain: () => void
  onLeave: () => void
}

export function PyramidTable({
  localName,
  state,
  cardBack,
  dealId,
  canUndo,
  onMove,
  onUndo,
  onDealAgain,
  onLeave,
}: PyramidTableProps) {
  void localName
  const { play, enabled, setEnabled, turnSoundEnabled, setTurnSoundEnabled } = useSound()
  // Same two-path convention as Solitaire: click-to-select-then-click (with
  // click-the-same-card-again-to-confirm for a lone King) AND drag, either
  // usable any time, starting one clears the other.
  const [selection, setSelection] = useState<PyramidLoc | null>(null)
  const [dragFrom, setDragFrom] = useState<PyramidLoc | null>(null)
  const [showDealIntro, setShowDealIntro] = useState(true)
  const [rulesOpen, setRulesOpen] = useState(false)
  const introShownForDealIdRef = useRef<number>(-1)
  const prevStateRef = useRef<PyramidState | null>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const dragFromRef = useRef<PyramidLoc | null>(null)
  const dragRevealTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    if (dealId !== introShownForDealIdRef.current) {
      setShowDealIntro(true)
      introShownForDealIdRef.current = dealId
    }
  }, [dealId])

  useEffect(() => {
    if (selection && !isExposed(state, selection)) {
      setSelection(null)
    }
  }, [state, selection])

  useEffect(() => {
    if (prevStateRef.current) {
      const prev = prevStateRef.current
      const reshuffled = prev.stock.length === 0 && prev.waste.length > 0 && state.stock.length > 0 && state.waste.length === 0
      if (prev.stock.length > state.stock.length && !reshuffled) play('card-draw')
      else if (reshuffled) play('shuffle')
      else if (state.moves > prev.moves) play('card-play')
    }
    prevStateRef.current = state
  }, [state, play])

  const tryMove = (move: PyramidMove) => {
    const result = applyMove(state, move)
    if (result.ok) {
      onMove(move)
      setSelection(null)
    } else {
      play('error')
    }
  }

  const tryStock = () => {
    if (state.stock.length > 0 || state.waste.length > 0) {
      tryMove({ type: 'DRAW' })
    }
  }

  const handleCardClick = (loc: PyramidLoc) => {
    if (!selection) {
      setSelection(loc)
      return
    }
    if (isSameLoc(selection, loc)) {
      const card = cardAt(state, loc)
      if (card && rankValue(card.rank) === 13) {
        tryMove({ type: 'REMOVE_KING', loc })
      } else {
        setSelection(null)
      }
      return
    }
    const move: PyramidMove = { type: 'REMOVE_PAIR', a: selection, b: loc }
    const result = applyMove(state, move)
    if (result.ok) {
      tryMove(move)
    } else {
      setSelection(loc)
    }
  }

  const startDrag = (e: React.DragEvent, loc: PyramidLoc) => {
    const sourceEl = e.currentTarget as HTMLElement
    const ghost = ghostRef.current
    if (!ghost) return

    ghost.replaceChildren()
    const clone = sourceEl.cloneNode(true) as HTMLElement
    clone.style.position = 'absolute'
    clone.style.top = '0px'
    clone.style.left = '0px'
    ghost.appendChild(clone)
    ghost.style.width = `${CARD_WIDTH}px`
    ghost.style.height = `${CARD_HEIGHT}px`

    const rect = sourceEl.getBoundingClientRect()
    e.dataTransfer.setDragImage(ghost, e.clientX - rect.left, e.clientY - rect.top)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', '')

    setSelection(null)
    dragFromRef.current = loc
    if (dragRevealTimeoutRef.current !== null) window.clearTimeout(dragRevealTimeoutRef.current)
    dragRevealTimeoutRef.current = window.setTimeout(() => {
      dragRevealTimeoutRef.current = null
      setDragFrom(loc)
    }, 0)
  }

  const clearDrag = () => {
    if (dragRevealTimeoutRef.current !== null) {
      window.clearTimeout(dragRevealTimeoutRef.current)
      dragRevealTimeoutRef.current = null
    }
    dragFromRef.current = null
    setDragFrom(null)
    ghostRef.current?.replaceChildren()
  }

  const handleDragEnd = () => clearDrag()

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (loc: PyramidLoc) => (e: React.DragEvent) => {
    e.preventDefault()
    const from = dragFromRef.current
    if (!from || isSameLoc(from, loc)) {
      clearDrag()
      return
    }
    tryMove({ type: 'REMOVE_PAIR', a: from, b: loc })
    clearDrag()
  }

  const isDragSource = (loc: PyramidLoc): boolean => !!dragFrom && isSameLoc(dragFrom, loc)

  const activeSource = dragFrom ?? selection
  const targets = activeSource ? legalPartners(state, activeSource) : []
  const isTarget = (loc: PyramidLoc): boolean => targets.some((t) => isSameLoc(t, loc))

  const remaining = state.pyramid.flat().filter((c) => c !== null).length

  const getStatusLine = (): string => {
    if (state.won) return `You cleared the pyramid in ${state.moves} moves!`
    if (dragFrom) return 'Drop it on a card that adds up to 13.'
    if (selection) {
      const card = cardAt(state, selection)
      if (card && rankValue(card.rank) === 13) return 'Click it again to remove it.'
      return 'Click a card that adds up to 13 with it — or just drag it there.'
    }
    return 'Click a card to select it, then click one that adds up to 13 — or just drag it there. Kings clear alone.'
  }

  const positionFor = (row: number, col: number) => ({
    left: `calc(50% + ${(col - row / 2) * COL_STEP}px - ${CARD_WIDTH / 2}px)`,
    top: row * ROW_STEP,
    zIndex: ROWS - row,
  })

  return (
    <div className="pyr-table">
      <TableHeader
        gameLabel="Pyramid"
        gameColor={PYRAMID_COLOR}
        meta="1 player · Solitaire"
        onRules={() => setRulesOpen(true)}
        onLeave={onLeave}
        enabled={enabled}
        setEnabled={setEnabled}
        turnSoundEnabled={turnSoundEnabled}
        setTurnSoundEnabled={setTurnSoundEnabled}
      />

      <div className="pyr-subheader">
        <div>
          <span className="chip" style={{ background: 'var(--yellow)', color: 'var(--ink)', fontWeight: 700 }}>
            Pyramid Solitaire
          </span>
          <span className="pyr-pill" style={{ marginLeft: 8 }}>
            <span>cards left</span>
            <span style={{ fontWeight: 700 }}>{remaining}</span>
          </span>
          <span className="pyr-pill" style={{ marginLeft: 8 }}>
            <span>moves</span>
            <span style={{ fontWeight: 700 }}>{state.moves}</span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn pill-small" onClick={onUndo} disabled={!canUndo}>Undo</button>
          <button type="button" className="btn pill-small" onClick={onDealAgain}>Deal again</button>
        </div>
      </div>

      <div className="pyr-table-card">
        {showDealIntro ? (
          <DealIntro
            others={[]}
            yourHandSize={state.pyramid.flat().length}
            maxFlights={28}
            renderCardBack={(p) => <CardBack {...p} design={cardBack} />}
            onComplete={() => setShowDealIntro(false)}
          />
        ) : (
          <>
            <div className="pyr-top">
              <div className="pyr-group">
                <div className="pyr-caption">stock {state.stock.length}</div>
                <CardBack
                  size="pile"
                  design={cardBack}
                  canDraw={state.stock.length > 0 || state.waste.length > 0}
                  empty={state.stock.length === 0}
                  ariaLabel={state.stock.length === 0 ? 'Stock pile (empty)' : 'Stock pile'}
                  onClick={tryStock}
                />
              </div>
              <div className="pyr-group">
                <div className="pyr-caption">waste {state.waste.length}</div>
                {state.waste.length > 0 ? (
                  <PlayingCard
                    rank={state.waste[state.waste.length - 1].rank as Exclude<Rank, 'JOKER'>}
                    suit={state.waste[state.waste.length - 1].suit as Exclude<Suit, 'joker'>}
                    size="tableau"
                    selected={!!selection && selection.kind === 'waste'}
                    className={
                      isDragSource({ kind: 'waste' })
                        ? 'pyr-dragging'
                        : (isTarget({ kind: 'waste' }) ? 'pyr-target' : undefined)
                    }
                    onClick={() => handleCardClick({ kind: 'waste' })}
                    draggable
                    onDragStart={(e) => startDrag(e, { kind: 'waste' })}
                    onDragEnd={handleDragEnd}
                  />
                ) : (
                  <div className="pyr-empty">empty</div>
                )}
              </div>
            </div>

            <div className="pyr-status">{getStatusLine()}</div>

            <div
              className="pyr-pyramid"
              onDragOver={handleDragOver}
              onDrop={(e) => {
                e.preventDefault()
                clearDrag()
              }}
            >
              {state.pyramid.map((row, rowIndex) =>
                row.map((card, colIndex) => {
                  if (!card) return null
                  const loc: PyramidLoc = { kind: 'pyramid', row: rowIndex, col: colIndex }
                  const exposed = isExposed(state, loc)
                  const pos = positionFor(rowIndex, colIndex)
                  return (
                    <div
                      key={card.id}
                      style={{ position: 'absolute', left: pos.left, top: pos.top, zIndex: pos.zIndex }}
                      onDragOver={exposed ? handleDragOver : undefined}
                      onDrop={exposed ? handleDrop(loc) : undefined}
                    >
                      <PlayingCard
                        rank={card.rank as Exclude<Rank, 'JOKER'>}
                        suit={card.suit as Exclude<Suit, 'joker'>}
                        size="tableau"
                        selected={!!selection && isSameLoc(selection, loc)}
                        className={[
                          !exposed && 'pyr-covered',
                          isDragSource(loc) && 'pyr-dragging',
                          exposed && isTarget(loc) && 'pyr-target',
                        ].filter(Boolean).join(' ') || undefined}
                        onClick={exposed ? () => handleCardClick(loc) : undefined}
                        draggable={exposed}
                        onDragStart={exposed ? (e) => startDrag(e, loc) : undefined}
                        onDragEnd={exposed ? handleDragEnd : undefined}
                      />
                    </div>
                  )
                }),
              )}
            </div>
          </>
        )}
      </div>

      {rulesOpen && <PyramidRulesOverlay onClose={() => setRulesOpen(false)} />}

      <div ref={ghostRef} style={{ position: 'fixed', top: -9999, left: -9999, pointerEvents: 'none' }} aria-hidden="true" />
    </div>
  )
}
