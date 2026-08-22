import { useState, useEffect, useRef } from 'react'
import type { SolitaireState, SolitaireLoc, SolitaireMove } from '../card-games/solitaire/state'
import { applyAnyMove as applyMove, autoCompleteAnyMoves as autoCompleteMoves, findAnyFoundationMove as findFoundationMove, anyLegalDestinations as legalDestinations } from '../card-games/solitaire/dispatch'
import type { Rank, Suit } from '../card-engine/cards'
import { DealIntro } from '../components/DealIntro'
import { PlayingCard, CardBack, suitGlyph, suitColor } from '../components/PlayingCard'
import { TableHeader } from '../components/TableHeader'
import { useSound } from '../hooks/useSound'
import { SolitaireRulesOverlay } from './SolitaireRulesOverlay'
import { SOLITAIRE_MODE_LABELS } from './SolitaireRoom'
import './SolitaireTable.css'

export const SOLITAIRE_COLOR = '#4d7c0f'

// Tableau stacking offsets and the card's own width — all 1.5× discard's
// numbers, since tableau cards are a flat 1.5× scale-up (75×105 vs 50×70).
// See SolitaireTable.css's .sol-column for the matching fixed column height
// derived from these, and startDrag below for the drag-ghost stacking.
const FACE_DOWN_OFFSET = 15
const FACE_UP_OFFSET = 36
const CARD_WIDTH = 75
const CARD_HEIGHT = 105

export interface SolitaireTableProps {
  localName: string
  state: SolitaireState
  cardBack: string
  dealId: number
  canUndo: boolean
  onMove: (move: SolitaireMove) => void
  onUndo: () => void
  onDealAgain: () => void
  onLeave: () => void
}

export function SolitaireTable({
  localName,
  state,
  cardBack,
  dealId,
  canUndo,
  onMove,
  onUndo,
  onDealAgain,
  onLeave,
}: SolitaireTableProps) {
  void localName
  const { play, enabled, setEnabled, turnSoundEnabled, setTurnSoundEnabled } = useSound()
  // Two independent interaction paths can each put a card "in flight":
  // `selection` for click-to-select-then-click-a-destination (with the
  // classic click-the-same-card-again-to-send-it-home shortcut), and
  // `dragFrom` for an in-progress native drag. Either can be used at any
  // time; starting one clears the other.
  const [selection, setSelection] = useState<{ from: SolitaireLoc; count: number } | null>(null)
  const [dragFrom, setDragFrom] = useState<{ from: SolitaireLoc; count: number } | null>(null)
  const [showDealIntro, setShowDealIntro] = useState(true)
  const [rulesOpen, setRulesOpen] = useState(false)
  const introShownForDealIdRef = useRef<number>(-1)
  const prevStateRef = useRef<SolitaireState | null>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  // A real drag fires dragover/drop continuously as the mouse moves, often
  // faster than React's async state updates land — `dragFrom` (state) can
  // still read stale/null on the very first dragover after dragstart, which
  // would skip preventDefault() and have the browser cancel the whole drag
  // before a drop ever happens. This ref updates synchronously in the same
  // tick as dragstart, so the native handlers below never see a stale value.
  const dragFromRef = useRef<{ from: SolitaireLoc; count: number } | null>(null)
  // Chrome aborts a drag outright if its source element goes invisible before
  // the drag session finishes initializing — hiding the source synchronously
  // in the dragstart handler (via .sol-dragging, driven by `dragFrom` state)
  // killed every drag before it began. Deferring that one state update by a
  // tick lets Chrome finish starting the drag first; the ref above is what
  // actually gates drop logic, so this delay never touches functionality.
  const dragRevealTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    if (dealId !== introShownForDealIdRef.current) {
      setShowDealIntro(true)
      introShownForDealIdRef.current = dealId
    }
  }, [dealId])

  // A click-selection can outlive the card it pointed at (undo, deal again)
  // — a live drag can't, since dropping or dragend always resolves it within
  // the same gesture, well before any of those state changes could land.
  useEffect(() => {
    if (selection) {
      const { from, count } = selection
      let isValid = false

      if (from.kind === 'tableau') {
        isValid = count <= state.faceUp[from.index] && state.tableau[from.index].length > 0
      } else if (from.kind === 'waste') {
        isValid = state.waste.length > 0
      } else if (from.kind === 'cell') {
        isValid = state.cells[from.index] !== null
      } else if (from.kind === 'foundation') {
        isValid = state.foundations[from.index].length > 0
      }

      if (!isValid) {
        setSelection(null)
      }
    }
  }, [state, selection])

  useEffect(() => {
    if (prevStateRef.current) {
      const prev = prevStateRef.current
      if (prev.stock.length > state.stock.length) play('card-draw')
      else if (state.stock.length > prev.stock.length) play('shuffle')
      else if (state.moves > prev.moves) play('card-play')
      else if (state.moves < prev.moves) play('card-draw')
    }
    prevStateRef.current = state
  }, [state, play])

  const tryMove = (move: SolitaireMove) => {
    const result = applyMove(state, move)
    if (result.ok) {
      onMove(move)
      setSelection(null)
    } else {
      play('error')
    }
  }

  const tryStock = () => {
    const canDraw = state.stock.length > 0 || state.waste.length > 0
    if (canDraw) {
      tryMove({ type: 'DRAW' })
    }
  }

  const isSameLocation = (a: SolitaireLoc, b: SolitaireLoc): boolean => {
    if (a.kind !== b.kind) return false
    if (a.kind === 'waste') return true
    return (a as Exclude<SolitaireLoc, { kind: 'waste' }>).index === (b as Exclude<SolitaireLoc, { kind: 'waste' }>).index
  }

  const faceDownCount = (col: number) => state.tableau[col].length - state.faceUp[col]
  const cardTop = (col: number, i: number) => {
    const down = faceDownCount(col)
    return i < down ? i * FACE_DOWN_OFFSET : down * FACE_DOWN_OFFSET + (i - down) * FACE_UP_OFFSET
  }

  const handleCardClick = (loc: SolitaireLoc, count: number, isTop: boolean = true) => {
    if (!selection) {
      setSelection({ from: loc, count })
    } else {
      if (isSameLocation(selection.from, loc) && selection.count === count) {
        if (selection.count === 1) {
          const homeMove = findFoundationMove(state, selection.from)
          if (homeMove) {
            tryMove(homeMove)
            return
          }
        }
        setSelection(null)
      } else if (loc.kind === 'tableau' && !isTop) {
        setSelection({ from: loc, count })
      } else if (isTop || loc.kind !== 'tableau') {
        const move: SolitaireMove = { type: 'MOVE', from: selection.from, to: loc, count: selection.count }
        const result = applyMove(state, move)
        if (result.ok) {
          tryMove(move)
        } else {
          setSelection({ from: loc, count })
        }
      }
    }
  }

  const handleSlotClick = (loc: SolitaireLoc) => {
    if (selection) {
      const move: SolitaireMove = { type: 'MOVE', from: selection.from, to: loc, count: selection.count }
      tryMove(move)
    }
  }

  // Builds a floating drag image out of clones of the ACTUAL dragged cards
  // (so it looks exactly like the run being moved, not just its top card),
  // stacked into the always-present, off-screen `ghostRef` container, then
  // hands that to the browser as the native drag image. The real cards stay
  // in the DOM underneath — `.sol-dragging` (driven by `dragFrom`, set right
  // after) hides them so there's never a visible duplicate.
  const startDrag = (e: React.DragEvent, from: SolitaireLoc, count: number) => {
    const sourceEl = e.currentTarget as HTMLElement
    const ghost = ghostRef.current
    if (!ghost) return

    let cardEls: HTMLElement[] = [sourceEl]
    if (from.kind === 'tableau') {
      const column = sourceEl.closest('.sol-column')
      if (column) {
        const allCards = [...column.querySelectorAll('.playing-card')] as HTMLElement[]
        cardEls = allCards.slice(Math.max(0, allCards.length - count))
      }
    }

    ghost.replaceChildren()
    cardEls.forEach((el, i) => {
      const clone = el.cloneNode(true) as HTMLElement
      clone.style.position = 'absolute'
      clone.style.top = `${i * FACE_UP_OFFSET}px`
      clone.style.left = '0px'
      ghost.appendChild(clone)
    })
    ghost.style.width = `${CARD_WIDTH}px`
    ghost.style.height = `${(cardEls.length - 1) * FACE_UP_OFFSET + CARD_HEIGHT}px`

    const rect = sourceEl.getBoundingClientRect()
    e.dataTransfer.setDragImage(ghost, e.clientX - rect.left, e.clientY - rect.top)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', '') // required by some browsers for a drag to start at all

    setSelection(null)
    dragFromRef.current = { from, count }
    if (dragRevealTimeoutRef.current !== null) window.clearTimeout(dragRevealTimeoutRef.current)
    dragRevealTimeoutRef.current = window.setTimeout(() => {
      dragRevealTimeoutRef.current = null
      setDragFrom({ from, count })
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

  const handleDragEnd = () => {
    clearDrag()
  }

  // Always allow the drop — every element this is attached to is one of our
  // own drop targets, and the only thing that ever drags in this app is one
  // of our own cards, so there's nothing to conditionally reject here. (See
  // dragFromRef's comment: gating this on React state was the actual bug.)
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (to: SolitaireLoc) => (e: React.DragEvent) => {
    e.preventDefault()
    const from = dragFromRef.current
    if (!from) return
    tryMove({ type: 'MOVE', from: from.from, to, count: from.count })
    // Clear here rather than waiting on dragend: a successful drop can move the
    // dragged card(s) to a different parent in the tree (a different tableau
    // column), which React remounts rather than relocates, so the source
    // element's own dragend may never bubble to a listener that still exists.
    clearDrag()
  }

  // Is this rendered card one of the ones currently being dragged (and so
  // should hide at its source position)? `cardsFromHere` mirrors the same
  // "distance from the top" count used everywhere else for a tableau run.
  const isDragSource = (loc: SolitaireLoc, cardsFromHere = 1): boolean => {
    if (!dragFrom) return false
    if (loc.kind === 'tableau' && dragFrom.from.kind === 'tableau') {
      return dragFrom.from.index === loc.index && cardsFromHere <= dragFrom.count
    }
    return isSameLocation(dragFrom.from, loc)
  }

  const getStatusLine = (): string => {
    if (state.won) {
      return `You won in ${state.moves} moves!`
    }
    if (dragFrom) {
      const cell = state.mode === 'freecell' ? ', or a free cell' : ''
      return `Drop it on a column, foundation${cell}.`
    }
    if (selection) {
      if (selection.count === 1) {
        const homeMove = findFoundationMove(state, selection.from)
        if (homeMove) {
          return 'Click it again to send it to its foundation.'
        }
      }
      const cell = state.mode === 'freecell' ? ', or free cell' : ''
      return `Click a column, foundation${cell} to move ${selection.count} card(s).`
    }
    return 'Click a card to select it, then click where it goes — or just drag it there.'
  }

  // Auto-play only offers itself once there's no hidden information left to
  // reveal by playing on: every tableau card is face up, and (klondike) the
  // stock/waste are empty — at that point the rest of the game is fully
  // known, so cascading every remaining safe foundation move is risk-free.
  const noHiddenCardsLeft = state.stock.length === 0
    && state.waste.length === 0
    && state.tableau.every((col, i) => state.faceUp[i] === col.length)
  const autoMoves = noHiddenCardsLeft ? autoCompleteMoves(state) : []

  const handleAutoPlay = () => {
    if (autoMoves.length === 0) return
    play('shuffle')
    autoMoves.forEach(onMove)
  }

  const activeSource = dragFrom ?? selection
  const targets = activeSource ? legalDestinations(state, activeSource.from, activeSource.count) : []
  const isTarget = (loc: SolitaireLoc): boolean => {
    for (const target of targets) {
      if (target.kind === loc.kind) {
        if (loc.kind === 'waste') {
          return true
        } else if ((loc as Exclude<SolitaireLoc, { kind: 'waste' }>).index === (target as Exclude<SolitaireLoc, { kind: 'waste' }>).index) {
          return true
        }
      }
    }
    return false
  }

  return (
    <div className="sol-table">
      <TableHeader
        gameLabel="Solitaire"
        gameColor={SOLITAIRE_COLOR}
        meta={`1 player · ${SOLITAIRE_MODE_LABELS[state.mode]}`}
        onRules={() => setRulesOpen(true)}
        onLeave={onLeave}
        enabled={enabled}
        setEnabled={setEnabled}
        turnSoundEnabled={turnSoundEnabled}
        setTurnSoundEnabled={setTurnSoundEnabled}
      />

      <div className="sol-subheader">
        <div>
          <span className="chip" style={{ background: 'var(--yellow)', color: 'var(--ink)', fontWeight: 700 }}>
            Solitaire · {SOLITAIRE_MODE_LABELS[state.mode]}
          </span>
          <span className="sol-pill" style={{ marginLeft: 8 }}>
            <span>moves</span>
            <span style={{ fontWeight: 700 }}>{state.moves}</span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn pill-small" onClick={onUndo} disabled={!canUndo}>Undo</button>
          {state.mode !== 'spider' && (
            <button type="button" className="btn pill-small" onClick={handleAutoPlay} disabled={autoMoves.length === 0}>Auto-play</button>
          )}
          <button type="button" className="btn pill-small" onClick={onDealAgain}>Deal again</button>
        </div>
      </div>

      <div className="sol-table-card">
        {showDealIntro ? (
          <DealIntro
            others={[]}
            yourHandSize={state.tableau.length}
            renderCardBack={(p) => <CardBack {...p} design={cardBack} />}
            onComplete={() => setShowDealIntro(false)}
          />
        ) : (
          <>
            <div className="sol-top">
              {state.mode === 'klondike' || state.mode === 'klondike3' ? (
                <div className="sol-row" style={{ gap: 16 }}>
                  <div className="sol-group">
                    <div className="sol-caption">stock {state.stock.length}</div>
                    <CardBack
                      size="pile"
                      design={cardBack}
                      canDraw={state.stock.length > 0 || state.waste.length > 0}
                      empty={state.stock.length === 0}
                      ariaLabel={state.stock.length === 0 ? 'Stock pile (empty)' : 'Stock pile'}
                      onClick={tryStock}
                    />
                  </div>
                  <div className="sol-group">
                    <div className="sol-caption">waste {state.waste.length}</div>
                    {state.waste.length > 0 ? (
                      <div style={{ position: 'relative', width: CARD_WIDTH, height: CARD_HEIGHT }}>
                        {/* The card just underneath the top of the waste — normally fully
                            covered by the top card rendered below, so it only becomes
                            visible while that top card is hidden mid-drag. Otherwise
                            dragging the top waste card away made the whole pile look
                            empty even with cards still underneath it. */}
                        {state.waste.length > 1 && (
                          <div style={{ position: 'absolute', top: 0, left: 0 }}>
                            <PlayingCard
                              rank={state.waste[state.waste.length - 2].rank as Exclude<Rank, 'JOKER'>}
                              suit={state.waste[state.waste.length - 2].suit as Exclude<Suit, 'joker'>}
                              size="tableau"
                            />
                          </div>
                        )}
                        <div style={{ position: 'absolute', top: 0, left: 0 }}>
                          <PlayingCard
                            rank={state.waste[state.waste.length - 1].rank as Exclude<Rank, 'JOKER'>}
                            suit={state.waste[state.waste.length - 1].suit as Exclude<Suit, 'joker'>}
                            size="tableau"
                            selected={selection?.from.kind === 'waste'}
                            className={isDragSource({ kind: 'waste' }) ? 'sol-dragging' : undefined}
                            onClick={() => handleCardClick({ kind: 'waste' }, 1)}
                            draggable
                            onDragStart={(e) => startDrag(e, { kind: 'waste' }, 1)}
                            onDragEnd={handleDragEnd}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="sol-empty">empty</div>
                    )}
                  </div>
                </div>
              ) : state.mode === 'freecell' ? (
                <div className="sol-group">
                  <div className="sol-caption">free cells</div>
                  <div className="sol-row">
                    {state.cells.map((card, i) => (
                      card ? (
                        <div
                          key={i}
                          onDragOver={handleDragOver}
                          onDrop={handleDrop({ kind: 'cell', index: i })}
                        >
                          <PlayingCard
                            rank={card.rank as Exclude<Rank, 'JOKER'>}
                            suit={card.suit as Exclude<Suit, 'joker'>}
                            size="tableau"
                            selected={selection?.from.kind === 'cell' && selection.from.index === i}
                            className={isDragSource({ kind: 'cell', index: i }) ? 'sol-dragging' : undefined}
                            onClick={() => handleCardClick({ kind: 'cell', index: i }, 1)}
                            draggable
                            onDragStart={(e) => startDrag(e, { kind: 'cell', index: i }, 1)}
                            onDragEnd={handleDragEnd}
                          />
                        </div>
                      ) : (
                        <button
                          key={i}
                          type="button"
                          className={isTarget({ kind: 'cell', index: i }) ? 'sol-slot sol-target' : 'sol-slot'}
                          onClick={() => handleSlotClick({ kind: 'cell', index: i })}
                          onDragOver={handleDragOver}
                          onDrop={handleDrop({ kind: 'cell', index: i })}
                        />
                      )
                    ))}
                  </div>
                </div>
              ) : (
                <div className="sol-group">
                  <div className="sol-caption">stock {state.stock.length}</div>
                  <CardBack
                    size="pile"
                    design={cardBack}
                    canDraw={state.stock.length > 0}
                    empty={state.stock.length === 0}
                    ariaLabel={state.stock.length === 0 ? 'Stock pile (empty)' : 'Stock pile — deals one card to every column'}
                    onClick={tryStock}
                  />
                </div>
              )}

              {state.mode === 'spider' ? (
                <div className="sol-group">
                  <div className="sol-caption">completed runs</div>
                  <div className="sol-pill">
                    <span style={{ fontWeight: 700 }}>{state.foundations.length} / 8</span>
                  </div>
                </div>
              ) : (
                <div className="sol-group">
                  <div className="sol-caption">foundations</div>
                  <div className="sol-row">
                    {state.foundations.map((foundation, i) => {
                      const suit = ['clubs', 'diamonds', 'hearts', 'spades'][i] as Exclude<Suit, 'joker'>
                      return foundation.length === 0 ? (
                        <button
                          key={i}
                          type="button"
                          className={isTarget({ kind: 'foundation', index: i }) ? 'sol-slot sol-target' : 'sol-slot'}
                          onClick={() => handleSlotClick({ kind: 'foundation', index: i })}
                          onDragOver={handleDragOver}
                          onDrop={handleDrop({ kind: 'foundation', index: i })}
                        >
                          <span style={{ fontSize: 30, opacity: 0.45, color: suitColor(suit) }}>
                            {suitGlyph(suit)}
                          </span>
                        </button>
                      ) : (
                        <div key={i} onDragOver={handleDragOver} onDrop={handleDrop({ kind: 'foundation', index: i })}>
                          <PlayingCard
                            rank={foundation[foundation.length - 1].rank as Exclude<Rank, 'JOKER'>}
                            suit={foundation[foundation.length - 1].suit as Exclude<Suit, 'joker'>}
                            size="tableau"
                            selected={selection?.from.kind === 'foundation' && selection.from.index === i}
                            className={
                              isDragSource({ kind: 'foundation', index: i })
                                ? 'sol-dragging'
                                : (isTarget({ kind: 'foundation', index: i }) ? 'sol-target' : undefined)
                            }
                            onClick={() => handleCardClick({ kind: 'foundation', index: i }, 1)}
                            draggable
                            onDragStart={(e) => startDrag(e, { kind: 'foundation', index: i }, 1)}
                            onDragEnd={handleDragEnd}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="sol-status">{getStatusLine()}</div>

            <div className="sol-tableau">
              {state.tableau.map((column, colIndex) => {
                const colLoc: SolitaireLoc = { kind: 'tableau', index: colIndex }
                return (
                  <div
                    key={colIndex}
                    className={state.mode === 'spider' ? 'sol-column sol-column--spider' : 'sol-column'}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop(colLoc)}
                  >
                    {column.length === 0 ? (
                      <button
                        type="button"
                        className={isTarget(colLoc) ? 'sol-slot sol-target' : 'sol-slot'}
                        onClick={() => handleSlotClick(colLoc)}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop(colLoc)}
                      />
                    ) : (
                      column.map((card, cardIndex) => {
                        const down = faceDownCount(colIndex)
                        const isFaceUp = cardIndex >= down
                        const offset = cardTop(colIndex, cardIndex)
                        const isTopCard = cardIndex === column.length - 1
                        const cardLoc: SolitaireLoc = { kind: 'tableau', index: colIndex }
                        const cardsFromHere = column.length - cardIndex

                        return (
                          <div
                            key={card.id}
                            style={{
                              position: 'absolute',
                              top: offset,
                              left: 0,
                              zIndex: cardIndex,
                            }}
                          >
                            {!isFaceUp ? (
                              <CardBack size="pile" design={cardBack} />
                            ) : (
                              <PlayingCard
                                rank={card.rank as Exclude<Rank, 'JOKER'>}
                                suit={card.suit as Exclude<Suit, 'joker'>}
                                size="tableau"
                                selected={selection?.from.kind === 'tableau' && selection.from.index === colIndex && selection.count === cardsFromHere}
                                className={
                                  isDragSource(cardLoc, cardsFromHere)
                                    ? 'sol-dragging'
                                    : (isTarget(cardLoc) && isTopCard ? 'sol-target' : undefined)
                                }
                                onClick={() => handleCardClick(cardLoc, cardsFromHere, isTopCard)}
                                draggable
                                onDragStart={(e) => startDrag(e, cardLoc, cardsFromHere)}
                                onDragEnd={handleDragEnd}
                              />
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {rulesOpen && <SolitaireRulesOverlay mode={state.mode} onClose={() => setRulesOpen(false)} />}

      {/* Off-screen mount point for the native drag image — see startDrag. */}
      <div ref={ghostRef} style={{ position: 'fixed', top: -9999, left: -9999, pointerEvents: 'none' }} aria-hidden="true" />
    </div>
  )
}
