import { useEffect } from 'react'
import type { UnoPublicState } from '../card-games/uno/state'
import { UNO_TARGET } from '../card-games/uno/state'
import { useSound } from '../hooks/useSound'

// ---- Props ----

export interface UnoResultsProps {
  localPlayerId: string
  localName: string
  names: Record<string, string>  // playerId -> display name
  colors: Record<string, string> // playerId -> seat ink (same map the table uses)
  publicState: UnoPublicState
  isHost: boolean
  notice?: string | null
  onRematch: () => void
  onBackToShelf: () => void
}

const BRAND = '#e11d2e'

// ---- UnoResults ----

export function UnoResults({
  localPlayerId,
  localName,
  names,
  colors,
  publicState,
  isHost,
  notice,
  onRematch,
  onBackToShelf,
}: UnoResultsProps) {
  void localName // kept in props for symmetry with the other results screens; the headline uses the winner's name
  const { play } = useSound()
  const isLocalWinner = publicState.matchWinnerId === localPlayerId
  // Only the winner hears the victory cue — the loser hearing the same 'game-win' fanfare
  // would contradict the "X takes it!" headline they're looking at.
  useEffect(() => { if (isLocalWinner) play('game-win') }, [isLocalWinner, play])

  // Only render when the match is over
  if (publicState.stage !== 'over' || publicState.matchWinnerId === null) return null

  const winnerId = publicState.matchWinnerId
  const headline = isLocalWinner ? 'You take it!' : `${names[winnerId] ?? winnerId} takes it!`
  const headlineColor = colors[winnerId] ?? BRAND
  const lede = `${names[winnerId] ?? winnerId} was first to ${UNO_TARGET} points.`
  const roundsPlayed = publicState.round + 1

  // Build ranked rows: every seated player by total score, DESCENDING (higher
  // score wins — first to UNO_TARGET, unlike Mexican Train's ascending pips).
  interface Row {
    id: string
    name: string
    color: string
    score: number
  }

  const rows: Row[] = publicState.seatOrder
    .map((id) => ({
      id,
      name: names[id] ?? id,
      color: colors[id] ?? BRAND,
      score: publicState.scores[id] ?? 0,
    }))
    .sort((a, b) => b.score - a.score)

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
        Uno · match over
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
        {rows.map((row, i) => {
          const isWinner = row.id === winnerId
          return (
            <div
              key={row.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 16,
                padding: '14px 20px', borderRadius: 20,
                border: '4px solid var(--ink)',
                background: isWinner ? row.color : '#fff',
                color: isWinner ? '#fff' : 'var(--ink)',
              }}
            >
              <span style={{ fontWeight: 700, width: 22 }}>{i + 1}</span>
              <span style={{
                width: 22, height: 22, borderRadius: '50%', flex: 'none',
                background: row.color,
                border: isWinner ? '3px solid rgba(255,255,255,0.85)' : '3px solid var(--ink)',
              }} />
              <span style={{ fontWeight: 700, fontSize: 18, flex: 1 }}>{row.name}</span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.85 }}>points</span>
                <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.6 }}>{roundsPlayed} rounds</span>
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
