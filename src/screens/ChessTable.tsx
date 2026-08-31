import { useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import type { ChessPublicState } from '../board-games/chess/state'
import { seatToColor } from '../board-games/chess/state'
import { currentPlayer } from '../engine/turn-engine'
import { SoundToggle } from '../components/SoundToggle'
import { TurnSoundToggle } from '../components/TurnSoundToggle'
import { Wordmark } from '../components/Wordmark'
import { ChessRulesOverlay } from './ChessRulesOverlay'
import { useSound } from '../hooks/useSound'
import { useTurnStartSound } from '../hooks/useTurnStartSound'
import './ChessTable.css'

// ---- Props ----

export interface ChessTableProps {
  code: string
  localPlayerId: string
  names: Record<string, string>          // playerId -> display name
  colors: Record<string, string>         // playerId -> seat ink color
  connection: 'connected' | 'disconnected'
  notice?: string | null
  publicState: ChessPublicState
  onMove: (from: string, to: string, promotion?: 'q' | 'r' | 'b' | 'n') => void
  onResign: () => void
  onOfferDraw: () => void
  onAcceptDraw: () => void
  onDeclineDraw: () => void
  onLeave: () => void
}

// ---- Constants ----

const LIGHT_SQUARE = 'var(--surface)'
const DARK_SQUARE = 'var(--grey-fill)'

// White unicode glyphs — the token fill carries the owner's seat color.
const GLYPHS: Record<string, string> = {
  p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔',
}

const PROMOTIONS = ['q', 'r', 'b', 'n'] as const

// Algebraic square -> board grid coordinates, same convention as the render
// loop below (row 0 = rank 8 at the top, col 0 = file a on the left).
function squareToRowCol(square: string): { row: number; col: number } {
  return { row: 8 - Number(square[1]), col: 'abcdefgh'.indexOf(square[0]) }
}

// ---- ChessTable ----

export function ChessTable({
  localPlayerId,
  names,
  colors,
  connection,
  notice,
  publicState,
  onMove,
  onResign,
  onOfferDraw,
  onAcceptDraw,
  onDeclineDraw,
  onLeave,
}: ChessTableProps) {
  // ---- Local state ----
  const { play, enabled, setEnabled, turnSoundEnabled, setTurnSoundEnabled, playTurnStart } = useSound()
  const [rulesOpen, setRulesOpen] = useState(false)
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null)
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null)

  // ---- Derived ----
  const opponentId = publicState.seatOrder.find((id) => id !== localPlayerId)!
  const opponentName = names[opponentId] ?? opponentId
  const mySeat = publicState.seatOrder.indexOf(localPlayerId) as 0 | 1
  const myTurn = currentPlayer(publicState.turn) === localPlayerId
  useTurnStartSound(myTurn, opponentId === 'bot' ? 1 : 2, playTurnStart)
  const currentId = currentPlayer(publicState.turn)
  const currentName = names[currentId] ?? currentId
  const drawOfferBy = publicState.drawOfferBy

  // The FEN is the only board truth — chess.js is used read-only to render
  // pieces and compute legal destinations. All moves go through onMove.
  const chess = useMemo(() => new Chess(publicState.fen), [publicState.fen])

  // Drop stale selection/promotion whenever the turn or stage changes.
  useEffect(() => {
    setSelectedSquare(null)
    setPromotion(null)
  }, [myTurn, publicState.stage])

  // ---- Sounds ----
  // Diff lastMove identity (turnNumber:by:san — replaced by every accepted
  // MOVE) plus stage transitions, mirroring the Checkers guards. Both players
  // hear everything — no wasMyTurn gate.
  // Result sound (winner-only game-win, or silence for a draw/loss) is centralized
  // in ChessResults, keyed off publicState.outcome — not played here, so a game-
  // ending move's transition to the results screen never fires it twice.
  const lastMove = publicState.lastMove
  const moveSig = lastMove ? `${publicState.turn.turnNumber}:${lastMove.by}:${lastMove.san}` : 'none'
  const moveSigRef = useRef(moveSig)
  useEffect(() => {
    if (moveSig !== moveSigRef.current) {
      moveSigRef.current = moveSig
      if (lastMove) {
        // publicState only stores san/check — derive capture ('x') and
        // promotion ('=') from the SAN.
        if (lastMove.san.includes('x')) play('checker-jump')
        else play('piece-drop')
        if (lastMove.san.includes('=')) play('king-me')
      }
    }
  }, [moveSig, lastMove, play])

  // ---- Board interaction ----
  // Legal destinations of the selected piece (promotions included — they
  // carry a `promotion` field in the verbose move).
  const legalMoves = useMemo(() => {
    if (publicState.stage !== 'play' || !myTurn || selectedSquare === null) return []
    return chess.moves({ square: selectedSquare, verbose: true })
  }, [chess, publicState.stage, myTurn, selectedSquare])

  const destinations = useMemo(() => {
    const set = new Set<Square>()
    for (const m of legalMoves) set.add(m.to)
    return set
  }, [legalMoves])

  function handleDestTap(square: Square) {
    const promoMove = legalMoves.find((m) => m.to === square && m.promotion !== undefined)
    if (promoMove) {
      setPromotion({ from: promoMove.from, to: promoMove.to })
    } else {
      setPromotion(null)
      if (selectedSquare !== null) onMove(selectedSquare, square)
    }
  }

  // ---- Status text ----
  let statusText: string
  let hint: string
  if (publicState.stage === 'over') {
    const o = publicState.outcome
    if (o === null) {
      statusText = 'Game over.'
    } else if (o.kind === 'checkmate') {
      const winnerId = publicState.seatOrder[o.winnerSeat]
      statusText = winnerId === localPlayerId
        ? 'You win by checkmate!'
        : `${names[winnerId] ?? winnerId} wins by checkmate.`
    } else if (o.kind === 'resign') {
      const winnerId = publicState.seatOrder[o.winnerSeat]
      statusText = winnerId === localPlayerId
        ? `You win. ${opponentName} resigned.`
        : 'You resigned.'
    } else if (o.kind === 'stalemate') {
      statusText = 'Draw by stalemate.'
    } else if (o.reason === 'agreement') {
      statusText = 'Draw by agreement.'
    } else if (o.reason === 'threefold') {
      statusText = 'Draw by repetition.'
    } else if (o.reason === 'fifty-move') {
      statusText = 'Draw by the fifty-move rule.'
    } else {
      statusText = 'Draw by insufficient material.'
    }
    hint = ''
  } else if (myTurn) {
    statusText = publicState.lastMove?.check ? 'Check! Your move.' : 'Your move.'
    hint = 'Tap a piece, then tap a highlighted square.'
  } else {
    statusText = publicState.lastMove?.check
      ? `Check! ${currentName}'s move.`
      : `${currentName} is thinking…`
    hint = ''
  }

  // ---- Render ----
  return (
    <div className="ch-table">
      {/* Header */}
      <div className="ch-header">
        <div className="ch-header-left">
          <Wordmark small onClick={onLeave} />
          <span className="ch-game-label">Chess</span>
          <span className="ch-peer-strip">
            <span
              className="ch-peer-dot"
              style={{ background: connection === 'connected' ? 'var(--green)' : 'var(--coral)' }}
            />
            <span className="ch-peer-label">
              {connection === 'connected' ? `peer to peer with ${opponentName}` : `connection to ${opponentName} lost`}
            </span>
          </span>
        </div>
        <div className="ch-header-actions">
          <TurnSoundToggle enabled={turnSoundEnabled} onToggle={() => setTurnSoundEnabled(!turnSoundEnabled)} />
          <SoundToggle enabled={enabled} onToggle={() => setEnabled(!enabled)} />
          <button type="button" className="btn pill-small" onClick={() => setRulesOpen(true)}>Rules</button>
          <button type="button" className="btn btn-ghost" onClick={onLeave}>Leave</button>
        </div>
      </div>


      {/* Error banner */}
      {notice && <div className="ch-error-banner">{notice}</div>}

      {/* Main table card */}
      <div className="ch-main-card">
        {/* Board */}
        <div className="ch-board">
          {chess.board().flat().map((cell, i) => {
            const row = Math.floor(i / 8)
            const col = i % 8
            const dark = (row + col) % 2 === 1
            // board() returns null for empty cells, so derive the algebraic
            // square from the position (row 0 = rank 8, col 0 = file a) — it
            // must be defined for empty destination squares too.
            const square = `${'abcdefgh'[col]}${8 - row}` as Square
            const pieceColor = cell !== null ? colors[publicState.seatOrder[cell.color === 'w' ? 0 : 1]] : undefined
            const isSelectable = cell !== null && publicState.stage === 'play' && myTurn && cell.color === seatToColor(mySeat)
            const isSelected = square === selectedSquare
            const isDest = destinations.has(square)
            // The just-landed move's destination gets a fresh slot keyed by
            // moveSig, so the CSS slide animation plays exactly once per move.
            const origin =
              lastMove !== null && lastMove.to === square ? squareToRowCol(lastMove.from) : null
            return (
              <div key={i} className="ch-cell" style={{ background: dark ? DARK_SQUARE : LIGHT_SQUARE }}>
                {cell && (
                  <span
                    key={origin !== null ? `${square}:${moveSig}` : square}
                    className={origin !== null ? 'ch-piece-slot ch-piece-slot--sliding' : 'ch-piece-slot'}
                    style={
                      origin !== null
                        ? { ['--dx' as string]: origin.col - col, ['--dy' as string]: origin.row - row }
                        : undefined
                    }
                  >
                    {isSelectable ? (
                      <button
                        type="button"
                        className="ch-piece"
                        style={{ background: pieceColor }}
                        onClick={() => {
                          setPromotion(null)
                          setSelectedSquare(cell.square)
                        }}
                        aria-label={isSelected ? 'Selected piece' : 'Select this piece'}
                      >
                        <span className="ch-glyph">{GLYPHS[cell.type]}</span>
                      </button>
                    ) : (
                      <span className="ch-piece" style={{ background: pieceColor }}>
                        <span className="ch-glyph">{GLYPHS[cell.type]}</span>
                      </span>
                    )}
                  </span>
                )}
                {isSelected && <span className="ch-ring ch-ring--selected" />}
                {isDest && (
                  <button
                    type="button"
                    className="ch-dest"
                    onClick={() => handleDestTap(square)}
                    aria-label="Move here"
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Status + hint (promotion renders as a fixed overlay below) */}
        <div className="ch-status">
          <div className="ch-status-text">{statusText}</div>
          {!promotion && hint && <div className="ch-hint">{hint}</div>}
        </div>

        {/* Controls: resign / draw offer */}
        <div className="ch-controls">
          {drawOfferBy !== null ? (
            drawOfferBy === localPlayerId ? (
              <span className="ch-control-text">Draw offer sent.</span>
            ) : (
              <>
                <span className="ch-control-text">{names[drawOfferBy] ?? drawOfferBy} offers a draw.</span>
                <button type="button" className="btn pill-small" onClick={onAcceptDraw}>Accept</button>
                <button type="button" className="btn pill-small" onClick={onDeclineDraw}>Decline</button>
              </>
            )
          ) : publicState.stage === 'play' ? (
            <>
              <button type="button" className="btn pill-small" onClick={onResign}>Resign</button>
              {myTurn && (
                <button type="button" className="btn pill-small" onClick={onOfferDraw}>Offer draw</button>
              )}
            </>
          ) : null}
        </div>
      </div>

      {/* Promotion overlay — fixed, centered, always on top. The move is
          already committed (from/to chosen), so the backdrop is inert: the
          player must pick a piece, there is no cancel path. */}
      {promotion && (
        <div className="overlay-backdrop">
          <div className="overlay-panel">
            <div className="ch-promo-label">Promote to:</div>
            <div className="ch-promo">
              {PROMOTIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="ch-promo-piece"
                  style={{ background: colors[localPlayerId] }}
                  onClick={() => {
                    onMove(promotion.from, promotion.to, p)
                    setPromotion(null)
                  }}
                  aria-label={`Promote to ${p}`}
                >
                  <span className="ch-glyph">{GLYPHS[p]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {rulesOpen && <ChessRulesOverlay onClose={() => setRulesOpen(false)} />}
    </div>
  )
}
