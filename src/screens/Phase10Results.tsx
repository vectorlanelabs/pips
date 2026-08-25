import { useEffect } from 'react'
import type { Phase10PublicState } from '../card-games/phase10/state'
import { PHASES } from '../card-games/phase10/phases'
import { useSound } from '../hooks/useSound'

// ---- Props ----

export interface Phase10ResultsProps {
  localPlayerId: string
  localName: string
  names: Record<string, string>   // playerId -> display name
  colors: Record<string, string>  // playerId -> seat ink (same map the table uses)
  publicState: Phase10PublicState
  isHost: boolean
  notice?: string | null
  onRematch: () => void
  onBackToShelf: () => void
}

const BRAND = 'var(--violet)'

// ---- Phase10Results ----

export function Phase10Results({
  localPlayerId,
  localName,
  names,
  colors,
  publicState,
  isHost,
  notice,
  onRematch,
  onBackToShelf,
}: Phase10ResultsProps) {
  void localName // kept in props for symmetry with the other results screens; the headline uses the winner's name
  const { play } = useSound()
  const isLocalWinner = publicState.matchWinnerId === localPlayerId
  // Only the winner hears the victory cue — the loser hearing the same 'game-win' fanfare
  // would contradict the "X wins!" headline they're looking at.
  useEffect(() => { if (isLocalWinner) play('game-win') }, [isLocalWinner, play])

  // Only render when the match is over
  if (!publicState.matchWinnerId) return null

  const winnerId = publicState.matchWinnerId
  const headline = isLocalWinner ? 'You win!' : `${names[winnerId] ?? winnerId} wins!`
  const headlineColor = colors[winnerId] ?? BRAND

  // The 1-based phase number each player reached — the winner's reads 10.
  const phaseOf = (playerId: string): number => PHASES[publicState.phaseIdx[playerId] ?? 0].phase

  // Build ranked rows from seatOrder. The match winner is whoever completed Phase 10 —
  // score only breaks a tie between simultaneous completers in the SAME hand
  // (rules.ts's finishRoundByGoingOut), it is NOT a general ranking metric across the
  // whole match. So the winner always ranks first, never sorted purely by score —
  // a lower-phase player can finish with a lower cumulative score than the actual
  // winner without having won anything.
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
    .sort((a, b) => {
      if (a.id === winnerId) return -1
      if (b.id === winnerId) return 1
      return a.score - b.score
    })

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
        Phase 10 · round {publicState.roundNumber}
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
              <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.85 }}>
                Phase {phaseOf(row.id)}
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