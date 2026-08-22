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
  const [selection, setSelection] = useState<{ from: SolitaireLoc; count: number } | null>(null)
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

  const getStatusLine = (): string => {
    if (state.won) {
      return `You won in ${state.moves} moves!`
    }

    if (!selection) {
      return 'Select a card, then click where it goes.'
    }

    if (selection.count === 1) {
      const homeMove = findFoundationMove(state, selection.from)
      if (homeMove) {
        return 'Click it again to send it to its foundation.'
      }
    }

    const cell = state.mode === 'freecell' ? ', or free cell' : ''
    return `Click a column, foundation${cell} to move ${selection.count} card(s).`
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

  const targets = selection ? legalDestinations(state, selection.from, selection.count) : []
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
                        selected={selection?.from.kind === 'waste'}
                        onClick={() => handleCardClick({ kind: 'waste' }, 1)}
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
                        <PlayingCard
                          key={i}
                          rank={card.rank as Exclude<Rank, 'JOKER'>}
                          suit={card.suit as Exclude<Suit, 'joker'>}
                          size="tableau"
                          selected={selection?.from.kind === 'cell' && selection.from.index === i}
                          onClick={() => handleCardClick({ kind: 'cell', index: i }, 1)}
                        />
                      ) : (
                        <button
                          key={i}
                          type="button"
                          className={isTarget({ kind: 'cell', index: i }) ? 'sol-slot sol-target' : 'sol-slot'}
                          disabled={!selection}
                          onClick={() => handleSlotClick({ kind: 'cell', index: i })}
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
                      <button
                        key={i}
                        type="button"
                        className={isTarget({ kind: 'foundation', index: i }) ? 'sol-slot sol-target' : 'sol-slot'}
                        disabled={!selection}
                        onClick={() => handleSlotClick({ kind: 'foundation', index: i })}
                      >
                        <span style={{ fontSize: 40, opacity: 0.45, color: suitColor(suit) }}>
                          {suitGlyph(suit)}
                        </span>
                      </button>
                    ) : (
                      <PlayingCard
                        key={i}
                        rank={foundation[foundation.length - 1].rank as Exclude<Rank, 'JOKER'>}
                        suit={foundation[foundation.length - 1].suit as Exclude<Suit, 'joker'>}
                        size="tableau"
                        selected={selection?.from.kind === 'foundation' && selection.from.index === i}
                        onClick={() => handleCardClick({ kind: 'foundation', index: i }, 1)}
                        className={isTarget({ kind: 'foundation', index: i }) ? 'sol-target' : undefined}
                      />
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="sol-status">{getStatusLine()}</div>

            <div className="sol-tableau">
              {state.tableau.map((column, colIndex) => {
                return (
                  <div key={colIndex} className="sol-column">
                    {column.length === 0 ? (
                      <button
                        type="button"
                        className={isTarget({ kind: 'tableau', index: colIndex }) ? 'sol-slot sol-target' : 'sol-slot'}
                        disabled={!selection}
                        onClick={() => handleSlotClick({ kind: 'tableau', index: colIndex })}
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
                                onClick={() => handleCardClick(cardLoc, cardsFromHere, isTopCard)}
                                className={isTarget(cardLoc) && isTopCard ? 'sol-target' : undefined}
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
