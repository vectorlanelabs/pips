import { useEffect, useMemo, useRef, useState } from 'react'
import type { CheckersPublicState } from '../board-games/checkers/state'
import { capturesFrom, movesFrom } from '../board-games/checkers/state'
import { currentPlayer } from '../engine/turn-engine'
import { SoundToggle } from '../components/SoundToggle'
import { TurnSoundToggle } from '../components/TurnSoundToggle'
import { Wordmark } from '../components/Wordmark'
import { CheckersRulesOverlay } from './CheckersRulesOverlay'
import { useSound } from '../hooks/useSound'
import { useTurnStartSound } from '../hooks/useTurnStartSound'
import './CheckersTable.css'

// ---- Props ----

export interface CheckersTableProps {
  code: string
  localPlayerId: string
  names: Record<string, string>          // playerId -> display name
  colors: Record<string, string>         // playerId -> seat ink color
  connection: 'connected' | 'disconnected'
  notice?: string | null
  publicState: CheckersPublicState
  onMove: (from: number, to: number) => void
  onLeave: () => void
}

// ---- Constants ----

const BOARD_CELLS = 64
const DARK_SQUARE = '#8a6045'
const LIGHT_SQUARE = '#f4ecdd'

// ---- CheckersTable ----

export function CheckersTable({
  localPlayerId,
  names,
  colors,
  connection,
  notice,
  publicState,
  onMove,
  onLeave,
}: CheckersTableProps) {
  // ---- Local state ----
  const { play, enabled, setEnabled, turnSoundEnabled, setTurnSoundEnabled, playTurnStart } = useSound()
  const [rulesOpen, setRulesOpen] = useState(false)
  const [selectedCell, setSelectedCell] = useState<number | null>(null)

  // ---- Derived ----
  const opponentId = publicState.seatOrder.find((id) => id !== localPlayerId)!
  const opponentName = names[opponentId] ?? opponentId
  const mySeat = publicState.seatOrder.indexOf(localPlayerId) as 0 | 1
  const myTurn = currentPlayer(publicState.turn) === localPlayerId
  useTurnStartSound(myTurn, opponentId === 'bot' ? 1 : 2, playTurnStart)
  const chainCell = publicState.chainCell
  const currentId = currentPlayer(publicState.turn)
  const currentName = names[currentId] ?? currentId

  // Mid-chain the selection is locked to the chained square — clicks elsewhere
  // don't change it. Elsewhere the local selection state applies.
  const selected = chainCell !== null && myTurn ? chainCell : selectedCell

  // Drop stale selection whenever the turn, stage, or chain changes.
  useEffect(() => {
    setSelectedCell(null)
  }, [myTurn, publicState.stage, chainCell])

  // ---- Sounds ----
  // Diff lastMove identity (turnNumber:by:from:to — replaced by every accepted
  // MOVE, and reset to null by NEXT_GAME so a repeated opening move across
  // games still plays) plus stage transitions. Both players hear everything —
  // no wasMyTurn gate, mirroring the Battleship/Wahoo guards.
  const lastMove = publicState.lastMove
  const moveSig = lastMove ? `${publicState.turn.turnNumber}:${lastMove.by}:${lastMove.from}:${lastMove.to}` : 'none'
  const moveSigRef = useRef(moveSig)
  const stageRef = useRef(publicState.stage)
  useEffect(() => {
    if (moveSig !== moveSigRef.current) {
      moveSigRef.current = moveSig
      if (lastMove) {
        if (lastMove.captured !== null) play('checker-jump')
        else play('checker-move')
        if (lastMove.crowned) play('king-me')
      }
    }
    if (publicState.stage !== stageRef.current) {
      stageRef.current = publicState.stage
      if (publicState.stage === 'gameEnd') play('round-win')
      else if (publicState.stage === 'over') play('game-win')
    }
  }, [moveSig, lastMove, publicState.stage, play])

  // ---- Board interaction ----
  // Selectable pieces: mine, in play, on my turn — the chained square only
  // while a multi-jump is in progress.
  const selectablePieces = useMemo(() => {
    const set = new Set<number>()
    if (publicState.stage !== 'play' || !myTurn) return set
    for (let i = 0; i < BOARD_CELLS; i++) {
      const piece = publicState.board[i]
      if (!piece || piece.seat !== mySeat) continue
      if (chainCell !== null && i !== chainCell) continue
      set.add(i)
    }
    return set
  }, [publicState, myTurn, mySeat, chainCell])

  // Legal destinations of the selected piece: captures always; simple moves
  // only when there's no chain in progress.
  const destinations = useMemo(() => {
    const set = new Set<number>()
    if (publicState.stage !== 'play' || !myTurn || selected === null) return set
    const piece = publicState.board[selected]
    if (!piece) return set
    if (chainCell !== null) {
      if (selected !== chainCell) return set
      for (const c of capturesFrom(publicState.board, selected)) set.add(c.to)
      return set
    }
    for (const c of capturesFrom(publicState.board, selected)) set.add(c.to)
    for (const m of movesFrom(publicState.board, selected)) set.add(m.to)
    return set
  }, [publicState, myTurn, selected, chainCell])

  // ---- Status text ----
  let statusText: string
  let hint: string
  if (publicState.stage === 'over') {
    const winner = publicState.matchWinnerId
    statusText = winner === localPlayerId
      ? 'You win the match!'
      : `${winner !== null ? (names[winner] ?? winner) : ''} wins the match!`
    hint = ''
  } else if (publicState.stage === 'gameEnd') {
    const winner = publicState.gameWinnerId
    statusText = winner === localPlayerId
      ? 'You win this game.'
      : `${winner !== null ? (names[winner] ?? winner) : ''} wins this game.`
    hint = ''
  } else if (chainCell !== null) {
    statusText = myTurn ? 'You must continue jumping.' : `${currentName} must continue jumping.`
    hint = 'Keep jumping with the highlighted piece.'
  } else if (myTurn) {
    statusText = publicState.gameNumber === 1 && publicState.turn.turnNumber === 1
      ? 'Your move. Captures are optional, but a jump must keep jumping while it can.'
      : 'Your move.'
    hint = 'Tap a piece, then tap a highlighted square.'
  } else {
    statusText = `${currentName} is thinking…`
    hint = ''
  }

  // ---- Render ----
  return (
    <div className="ck-table">
      {/* Header */}
      <div className="ck-header">
        <div className="ck-header-left">
          <Wordmark small onClick={onLeave} />
          <span className="ck-game-label">Checkers</span>
          <span className="ck-peer-strip">
            <span
              className="ck-peer-dot"
              style={{ background: connection === 'connected' ? 'var(--green)' : 'var(--coral)' }}
            />
            <span className="ck-peer-label">
              {connection === 'connected' ? `peer to peer with ${opponentName}` : `connection to ${opponentName} lost`}
            </span>
          </span>
        </div>
        <div className="ck-header-actions">
          <TurnSoundToggle enabled={turnSoundEnabled} onToggle={() => setTurnSoundEnabled(!turnSoundEnabled)} />
          <SoundToggle enabled={enabled} onToggle={() => setEnabled(!enabled)} />
          <button type="button" className="btn pill-small" onClick={() => setRulesOpen(true)}>Rules</button>
          <button type="button" className="btn btn-ghost" onClick={onLeave}>Leave</button>
        </div>
      </div>


      {/* Error banner */}
      {notice && <div className="ck-error-banner">{notice}</div>}

      {/* Main table card */}
      <div className="ck-main-card">
        {/* Scoreboard cards — the current player's card fills with their seat color */}
        <div className="ck-scores">
          {publicState.seatOrder.map((pid) => {
            const isTurn = pid === currentId
            return (
              <div
                key={pid}
                className={`ck-score-card${isTurn ? ' ck-score-card--turn' : ''}`}
                style={isTurn ? { background: colors[pid] } : undefined}
              >
                <div className="ck-score-name">{names[pid] ?? pid}</div>
                <div className="ck-score-count">{publicState.gamesWon[pid] ?? 0}</div>
                <div className="ck-score-sub">games won</div>
              </div>
            )
          })}
        </div>

        {/* Board */}
        <div className="ck-board">
          {Array.from({ length: BOARD_CELLS }, (_, i) => {
            const row = Math.floor(i / 8)
            const col = i % 8
            const dark = (row + col) % 2 === 1
            const piece = publicState.board[i]
            const pieceColor = piece !== null ? colors[publicState.seatOrder[piece.seat]] : undefined
            const isSelectable = piece !== null && selectablePieces.has(i)
            const isSelected = selected === i
            const isDest = destinations.has(i)
            return (
              <div key={i} className="ck-cell" style={{ background: dark ? DARK_SQUARE : LIGHT_SQUARE }}>
                {piece && (
                  isSelectable ? (
                    <button
                      type="button"
                      className="ck-piece"
                      style={{ background: pieceColor }}
                      onClick={() => setSelectedCell(i)}
                      aria-label={isSelected ? 'Selected piece' : 'Select this piece'}
                    >
                      {piece.king && <span className="ck-crown">♛</span>}
                    </button>
                  ) : (
                    <span className="ck-piece" style={{ background: pieceColor }}>
                      {piece.king && <span className="ck-crown">♛</span>}
                    </span>
                  )
                )}
                {isSelected && <span className="ck-ring ck-ring--selected" />}
                {isDest && (
                  <button
                    type="button"
                    className="ck-dest"
                    onClick={() => {
                      if (selected !== null) onMove(selected, i)
                    }}
                    aria-label="Move here"
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Status + hint */}
        <div className="ck-status">
          <div className="ck-status-text">{statusText}</div>
          {hint && <div className="ck-hint">{hint}</div>}
        </div>
      </div>

      {rulesOpen && <CheckersRulesOverlay onClose={() => setRulesOpen(false)} />}
    </div>
  )
}
