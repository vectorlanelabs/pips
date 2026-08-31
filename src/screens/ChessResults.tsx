import { useEffect } from 'react'
import type { ChessPublicState } from '../board-games/chess/state'
import { useSound } from '../hooks/useSound'

// ---- Props ----

export interface ChessResultsProps {
  localPlayerId: string
  localName: string
  opponentName: string
  publicState: ChessPublicState
  isHost: boolean
  notice?: string | null
  onRematch: () => void
  onBackToShelf: () => void
}

// ---- Row colour per player ----
// Local player → var(--green-text), opponent → the chess brand cyan.

const BRAND = '#0891b2'
const LOCAL_COLOR = 'var(--green-text)'

function playerColor(playerId: string, localPlayerId: string): string {
  return playerId === localPlayerId ? LOCAL_COLOR : BRAND
}

const DRAW_LEDE: Record<'agreement' | 'threefold' | 'fifty-move' | 'insufficient-material', string> = {
  agreement: 'Both players agreed to a draw.',
  threefold: 'Draw by repetition.',
  'fifty-move': 'Draw by the fifty-move rule.',
  'insufficient-material': 'Neither side had enough material to mate.',
}

// ---- ChessResults ----

export function ChessResults({
  localPlayerId,
  localName,
  opponentName,
  publicState,
  isHost,
  notice,
  onRematch,
  onBackToShelf,
}: ChessResultsProps) {
  const { play } = useSound()
  const o = publicState.outcome
  // Winner-only game-win — silence for a draw and for the loser, so the cue
  // encodes win/loss/draw semantics instead of sounding like a fanfare for
  // everyone. The table itself no longer plays a result cue (see ChessTable),
  // so this is the single place the outcome sound fires.
  const winnerSeat = o !== null && (o.kind === 'checkmate' || o.kind === 'resign') ? o.winnerSeat : null
  const isLocalWinner = winnerSeat !== null && publicState.seatOrder[winnerSeat] === localPlayerId
  useEffect(() => {
    if (isLocalWinner) play('game-win')
  }, [isLocalWinner, play])

  // Only render when the game is over
  if (publicState.stage !== 'over' || o === null) return null

  // Two fixed rows, one per player — winner first, or both neutral on a draw.
  interface ResultRow {
    id: string
    name: string
    label: string
  }

  const drawRows = (): ResultRow[] => publicState.seatOrder.map((id) => ({
    id,
    name: id === localPlayerId ? localName : opponentName,
    label: '½–½',
  }))

  let headline: string
  let headlineColor: string
  let lede: string
  let winnerId: string | null
  let rows: ResultRow[]
  if (o.kind === 'checkmate') {
    winnerId = publicState.seatOrder[o.winnerSeat]
    const loserId = publicState.seatOrder[o.winnerSeat === 0 ? 1 : 0]
    const isLocalWinner = winnerId === localPlayerId
    const winnerName = isLocalWinner ? localName : opponentName
    headline = isLocalWinner ? 'You win!' : `${winnerName} wins.`
    headlineColor = playerColor(winnerId, localPlayerId)
    lede = `${winnerName} won by checkmate.`
    rows = [
      { id: winnerId, name: winnerName, label: 'Won' },
      { id: loserId, name: loserId === localPlayerId ? localName : opponentName, label: 'Lost' },
    ]
  } else if (o.kind === 'resign') {
    winnerId = publicState.seatOrder[o.winnerSeat]
    const loserId = publicState.seatOrder[o.winnerSeat === 0 ? 1 : 0]
    const isLocalWinner = winnerId === localPlayerId
    const winnerName = isLocalWinner ? localName : opponentName
    const loserName = loserId === localPlayerId ? localName : opponentName
    headline = isLocalWinner ? 'You win!' : `${winnerName} wins.`
    headlineColor = playerColor(winnerId, localPlayerId)
    lede = `${loserName} resigned.`
    rows = [
      { id: winnerId, name: winnerName, label: 'Won' },
      { id: loserId, name: loserName, label: 'Lost' },
    ]
  } else if (o.kind === 'stalemate') {
    winnerId = null
    headline = "It's a draw."
    headlineColor = 'var(--ink)'
    lede = 'Stalemate. Nobody had a legal move.'
    rows = drawRows()
  } else {
    winnerId = null
    headline = "It's a draw."
    headlineColor = 'var(--ink)'
    lede = DRAW_LEDE[o.reason]
    rows = drawRows()
  }

  return (
    <div style={{
      maxWidth: 1120, margin: '0 auto',
      padding: 'clamp(28px,6vw,48px) clamp(18px,5vw,48px) 72px',
    }}>
      {notice && (
        <div style={{
          textAlign: 'center',
          background: 'var(--coral)',
          color: '#fff',
          fontWeight: 700,
          fontSize: 'clamp(14px, 1.8vw, 17px)',
          padding: '10px 22px',
          borderRadius: 999,
          border: '3px solid var(--ink)',
          boxShadow: '0 5px 0 var(--ink)',
          marginBottom: 'clamp(10px, 2vw, 18px)',
        }}>
          {notice}
        </div>
      )}
      <span className="chip" style={{ background: BRAND, color: '#fff' }}>
        Chess · match over
      </span>

      <h1 style={{
        fontSize: 'clamp(46px,10vw,116px)', fontWeight: 700, lineHeight: 0.92,
        letterSpacing: '-0.035em', color: headlineColor,
        margin: '16px 0 8px',
      }}>
        {headline}
      </h1>

      <p style={{ fontSize: 'clamp(17px, 2.4vw, 24px)', fontWeight: 600, margin: 0 }}>
        {lede}
      </p>

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        maxWidth: 660, marginTop: 24,
      }}>
        {rows.map((row) => {
          const isWinner = winnerId !== null && row.id === winnerId
          const color = playerColor(row.id, localPlayerId)
          return (
            <div
              key={row.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 16,
                padding: '14px 20px', borderRadius: 20,
                border: '4px solid var(--ink)',
                background: isWinner ? color : '#fff',
                color: isWinner ? '#fff' : 'var(--ink)',
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 18, flex: 1 }}>{row.name}</span>
              <span style={{ fontSize: 32, fontWeight: 700 }}>{row.label}</span>
            </div>
          )
        })}
      </div>

      <div style={{
        display: 'flex', gap: 12, marginTop: 32,
        alignItems: 'center', flexWrap: 'wrap',
      }}>
        {isHost && (
          <button type="button" className="btn btn-coral btn-lg" onClick={onRematch}>
            Again
          </button>
        )}
        <button type="button" className="btn btn-lg" onClick={onBackToShelf}>
          Back to the shelf
        </button>
        {!isHost && (
          <span style={{ color: 'var(--muted-text)', fontSize: 14 }}>
            Waiting for the host to start a rematch…
          </span>
        )}
      </div>
    </div>
  )
}
