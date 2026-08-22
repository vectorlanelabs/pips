import { useState, useEffect, useRef } from 'react'
import type { SolitaireState, SolitaireLoc, SolitaireMove } from '../card-games/solitaire/state'
import { applyMove, autoCompleteMoves, findFoundationMove, legalDestinations } from '../card-games/solitaire/shared'
import type { Rank, Suit } from '../card-engine/cards'
import { DealIntro } from '../components/DealIntro'
import { PlayingCard, CardBack, suitGlyph, suitColor } from '../components/PlayingCard'
import { TableHeader } from '../components/TableHeader'
import { useSound } from '../hooks/useSound'
import { SolitaireRulesOverlay } from './SolitaireRulesOverlay'
import { SOLITAIRE_MODE_LABELS } from './SolitaireRoom'
import './SolitaireTable.css'

export const SOLITAIRE_COLOR = '#4d7c0f'

// Tableau stacking offsets — 2× the discard-size numbers, since tableau
// cards are a flat 2× scale-up (100×140 vs 50×70). See SolitaireTable.css's
// .sol-column for the matching fixed column height derived from these.
const FACE_DOWN_OFFSET = 20
const FACE_UP_OFFSET = 48

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
  // The only in-progress "selection" left is a live drag — the browser's own
  // dragstart/dragend pair already tells click from drag apart, so there's no
  // multi-step click-to-select state left to revalidate after undo/redeal.
  const [dragFrom, setDragFrom] = useState<{ from: SolitaireLoc; count: number } | null>(null)
  const [showDealIntro, setShowDealIntro] = useState(true)
  const [rulesOpen, setRulesOpen] = useState(false)
  const introShownForDealIdRef = useRef<number>(-1)
  const prevStateRef = useRef<SolitaireState | null>(null)

  useEffect(() => {
    if (dealId !== introShownForDealIdRef.current) {
      setShowDealIntro(true)
      introShownForDealIdRef.current = dealId
    }
  }, [dealId])

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

  const faceDownCount = (col: number) => state.tableau[col].length - state.faceUp[col]
  const cardTop = (col: number, i: number) => {
    const down = faceDownCount(col)
    return i < down ? i * FACE_DOWN_OFFSET : down * FACE_DOWN_OFFSET + (i - down) * FACE_UP_OFFSET
  }

  // A plain click (no drag) on any card sends it home if that's legal — the
  // top card of a run always has count 1 against itself, so this naturally
  // does nothing for a click on a buried card without any extra bookkeeping.
  const handleClickHome = (loc: SolitaireLoc, count: number) => {
    if (count !== 1) return
    const home = findFoundationMove(state, loc)
    if (home) tryMove(home)
  }

  const handleDragStart = (from: SolitaireLoc, count: number) => (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', '') // required by some browsers for a drag to start at all
    setDragFrom({ from, count })
  }

  const handleDragEnd = () => setDragFrom(null)

  const handleDragOver = (e: React.DragEvent) => {
    if (dragFrom) e.preventDefault() // required to allow a drop at all
  }

  const handleDrop = (to: SolitaireLoc) => (e: React.DragEvent) => {
    e.preventDefault()
    if (!dragFrom) return
    tryMove({ type: 'MOVE', from: dragFrom.from, to, count: dragFrom.count })
    setDragFrom(null)
  }

  const getStatusLine = (): string => {
    if (state.won) {
      return `You won in ${state.moves} moves!`
    }
    if (dragFrom) {
      const cell = state.mode === 'freecell' ? ', or a free cell' : ''
      return `Drop it on a column, foundation${cell}.`
    }
    return 'Drag a card to move it, or click a card to send it to its foundation.'
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

  const targets = dragFrom ? legalDestinations(state, dragFrom.from, dragFrom.count) : []
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
          <button type="button" className="btn pill-small" onClick={handleAutoPlay} disabled={autoMoves.length === 0}>Auto-play</button>
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
              {state.mode === 'klondike' ? (
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
                      <PlayingCard
                        rank={state.waste[state.waste.length - 1].rank as Exclude<Rank, 'JOKER'>}
                        suit={state.waste[state.waste.length - 1].suit as Exclude<Suit, 'joker'>}
                        size="tableau"
                        onClick={() => handleClickHome({ kind: 'waste' }, 1)}
                        draggable
                        onDragStart={handleDragStart({ kind: 'waste' }, 1)}
                        onDragEnd={handleDragEnd}
                      />
                    ) : (
                      <div className="sol-empty">empty</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="sol-group">
                  <div className="sol-caption">free cells</div>
                  <div className="sol-row">
                    {state.cells.map((card, i) => (
                      card ? (
                        <div key={i} onDragOver={handleDragOver} onDrop={handleDrop({ kind: 'cell', index: i })}>
                          <PlayingCard
                            rank={card.rank as Exclude<Rank, 'JOKER'>}
                            suit={card.suit as Exclude<Suit, 'joker'>}
                            size="tableau"
                            onClick={() => handleClickHome({ kind: 'cell', index: i }, 1)}
                            draggable
                            onDragStart={handleDragStart({ kind: 'cell', index: i }, 1)}
                            onDragEnd={handleDragEnd}
                          />
                        </div>
                      ) : (
                        <div
                          key={i}
                          className={isTarget({ kind: 'cell', index: i }) ? 'sol-slot sol-target' : 'sol-slot'}
                          onDragOver={handleDragOver}
                          onDrop={handleDrop({ kind: 'cell', index: i })}
                        />
                      )
                    ))}
                  </div>
                </div>
              )}

              <div className="sol-group">
                <div className="sol-caption">foundations</div>
                <div className="sol-row">
                  {state.foundations.map((foundation, i) => {
                    const suit = ['clubs', 'diamonds', 'hearts', 'spades'][i] as Exclude<Suit, 'joker'>
                    return foundation.length === 0 ? (
                      <div
                        key={i}
                        className={isTarget({ kind: 'foundation', index: i }) ? 'sol-slot sol-target' : 'sol-slot'}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop({ kind: 'foundation', index: i })}
                      >
                        <span style={{ fontSize: 40, opacity: 0.45, color: suitColor(suit) }}>
                          {suitGlyph(suit)}
                        </span>
                      </div>
                    ) : (
                      <div key={i} onDragOver={handleDragOver} onDrop={handleDrop({ kind: 'foundation', index: i })}>
                        <PlayingCard
                          rank={foundation[foundation.length - 1].rank as Exclude<Rank, 'JOKER'>}
                          suit={foundation[foundation.length - 1].suit as Exclude<Suit, 'joker'>}
                          size="tableau"
                          onClick={() => handleClickHome({ kind: 'foundation', index: i }, 1)}
                          className={isTarget({ kind: 'foundation', index: i }) ? 'sol-target' : undefined}
                          draggable
                          onDragStart={handleDragStart({ kind: 'foundation', index: i }, 1)}
                          onDragEnd={handleDragEnd}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="sol-status">{getStatusLine()}</div>

            <div className="sol-tableau">
              {state.tableau.map((column, colIndex) => {
                const colLoc: SolitaireLoc = { kind: 'tableau', index: colIndex }
                return (
                  <div
                    key={colIndex}
                    className="sol-column"
                    onDragOver={handleDragOver}
                    onDrop={handleDrop(colLoc)}
                  >
                    {column.length === 0 ? (
                      <div className={isTarget(colLoc) ? 'sol-slot sol-target' : 'sol-slot'} />
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
                                onClick={() => handleClickHome(cardLoc, cardsFromHere)}
                                className={isTarget(cardLoc) && isTopCard ? 'sol-target' : undefined}
                                draggable
                                onDragStart={handleDragStart(cardLoc, cardsFromHere)}
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
    </div>
  )
}
