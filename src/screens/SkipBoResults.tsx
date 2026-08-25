import { useEffect } from 'react'
import type { SkipBoPublicState } from '../card-games/skipbo/state'
import { useSound } from '../hooks/useSound'

// ---- Props ----

export interface SkipBoResultsProps {
  localPlayerId: string
  localName: string
  names: Record<string, string>   // playerId -> display name
  colors: Record<string, string>  // playerId -> seat ink (same map the table uses)
  publicState: SkipBoPublicState
  isHost: boolean
  notice?: string | null
  onRematch: () => void
  onBackToShelf: () => void
}

const BRAND = '#be185d'

// ---- SkipBoResults ----

export function SkipBoResults({
  localPlayerId,
  localName,
  names,
  colors,
  publicState,
  isHost,
  notice,
  onRematch,
  onBackToShelf,
}: SkipBoResultsProps) {
  void localName // kept in props for symmetry with the other results screens; the headline uses the winner's name
  const { play } = useSound()
  // Every game reaching a results screen shares this cue — only the actual winner hears it,
  // never the loser (see docs/reviews/skipbo-review.md Major #2).
  useEffect(() => { if (publicState.winnerId === localPlayerId) play('game-win') }, [])

  // Only render when the game is over
  if (!publicState.roundOver || !publicState.winnerId) return null

  const winnerId = publicState.winnerId
  const winnerName = winnerId === localPlayerId ? 'You' : (names[winnerId] ?? winnerId)
  const isLocalWinner = winnerId === localPlayerId
  const headline = isLocalWinner ? 'You went out first!' : `${winnerName} went out first!`
  const headlineColor = colors[winnerId] ?? BRAND

  // Final stockpile counts as a fun stat, ascending by cards left — the game is already
  // decided by whoever emptied their stockpile first, not by this count, so this is
  // deliberately NOT a numbered 1st/2nd/3rd finishing-order ranking table.
  const rows = publicState.seatOrder
    .map((id) => ({
      id,
      name: names[id] ?? id,
      color: colors[id] ?? BRAND,
      remaining: publicState.stockCounts[id] ?? 0,
    }))
    .sort((a, b) => a.remaining - b.remaining)

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
        Skip-Bo · game over
      </span>

      <h1 style={{
        fontSize: 'clamp(46px,10vw,116px)', fontWeight: 700, lineHeight: 0.92,
        letterSpacing: '-0.035em', color: headlineColor,
        margin: '16px 0 8px',
      }}>
        {headline}
      </h1>

      <p style={{ fontSize: 'clamp(17px, 2.4vw, 24px)', fontWeight: 600, margin: 0 }}>
        First empty stockpile takes it.
      </p>

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        maxWidth: 660, marginTop: 24,
      }}>
        {rows.map((row) => {
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
              <span style={{
                width: 22, height: 22, borderRadius: '50%', flex: 'none',
                background: row.color,
                border: isWinner ? '3px solid rgba(255,255,255,0.85)' : '3px solid var(--ink)',
              }} />
              <span style={{ fontWeight: 700, fontSize: 18, flex: 1 }}>{row.name}</span>
              <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.85 }}>
                cards left in stockpile
              </span>
              <span style={{ fontSize: 32, fontWeight: 700 }}>{row.remaining}</span>
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
