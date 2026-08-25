import { useEffect } from 'react'
import type { DominoesPublicState } from '../board-games/dominoes/state'
import { useSound } from '../hooks/useSound'

// ---- Props ----

export interface DominoesResultsProps {
  localPlayerId: string
  localName: string
  opponentName: string
  publicState: DominoesPublicState
  isHost: boolean
  notice?: string | null
  onRematch: () => void
  onBackToShelf: () => void
}

// ---- Row colour per player ----
// Local player → var(--green-text), opponent → the dominoes brand colour #5b5bd6.

const LOCAL_COLOR = 'var(--green-text)'
const OPPONENT_COLOR = '#5b5bd6'

function playerColor(playerId: string, localPlayerId: string): string {
  return playerId === localPlayerId ? LOCAL_COLOR : OPPONENT_COLOR
}

// ---- DominoesResults ----

export function DominoesResults({
  localPlayerId,
  localName,
  opponentName,
  publicState,
  isHost,
  notice,
  onRematch,
  onBackToShelf,
}: DominoesResultsProps) {
  const { play } = useSound()
  const isLocalWinner = publicState.matchWinnerId === localPlayerId
  // Only the winner hears the victory cue — the loser hearing the same 'game-win' fanfare
  // contradicts what their own screen says happened.
  useEffect(() => { if (isLocalWinner) play('game-win') }, [isLocalWinner, play])

  // Only render when the match is over
  if (publicState.stage !== 'over' || !publicState.matchWinnerId) return null
  const headline = isLocalWinner ? 'You take the match!' : `${opponentName} takes the match.`
  const headlineColor = isLocalWinner ? LOCAL_COLOR : OPPONENT_COLOR

  const opponentId = publicState.turn.playerOrder.find((id) => id !== localPlayerId) ?? ''

  // Build ranked rows (2 players)
  interface RankedRow {
    id: string
    name: string
    score: number
  }

  const rows: RankedRow[] = [
    { id: localPlayerId, name: localName, score: publicState.scores[localPlayerId] ?? 0 },
    { id: opponentId, name: opponentName, score: publicState.scores[opponentId] ?? 0 },
  ].sort((a, b) => b.score - a.score)

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
      <span className="chip" style={{ background: 'var(--yellow)', color: 'var(--ink)' }}>
        All Fives · {publicState.target} target · round {publicState.roundNumber}
      </span>

      <h1 style={{
        fontSize: 'clamp(46px,10vw,116px)', fontWeight: 700, lineHeight: 0.92,
        letterSpacing: '-0.035em', color: headlineColor,
        margin: '16px 0 8px',
      }}>
        {headline}
      </h1>

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        maxWidth: 660, marginTop: 24,
      }}>
        {rows.map((row, i) => {
          const isWinner = row.id === publicState.matchWinnerId
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
              <span style={{ fontWeight: 700, width: 22 }}>{i + 1}</span>
              <span style={{ fontWeight: 700, fontSize: 18, flex: 1 }}>{row.name}</span>
              <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.85 }}>
                {row.score} points
              </span>
              <span style={{ fontSize: 32, fontWeight: 700 }}>{row.score}</span>
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
