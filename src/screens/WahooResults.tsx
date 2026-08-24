import { useEffect } from 'react'
import { LANE_START } from '../board-games/wahoo/board'
import type { WahooPublicState } from '../board-games/wahoo/state'
import { useSound } from '../hooks/useSound'

// ---- Props ----

export interface WahooResultsProps {
  localPlayerId: string
  localName: string
  names: Record<string, string>  // playerId -> display name
  publicState: WahooPublicState
  isHost: boolean
  notice?: string | null
  onRematch: () => void
  onBackToShelf: () => void
}

// ---- Arm palette (fixed per arm index 0..3) ----

const ARM_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308']

// ---- Ranking ----

export interface WahooResultRow {
  id: string
  name: string
  color: string
  home: number
  base: number
}

// Ranked rows: every seated player by marbles home (descending). "Home" must use the engine's
// actual win threshold (LANE_START, 63) — a marble at 52..62 is still on the shared track, not
// in the lane, even though it's close. Extracted as a pure function so the boundary (52 vs 63)
// is unit-testable without rendering the component.
export function rankWahooResults(publicState: WahooPublicState, names: Record<string, string>): WahooResultRow[] {
  return publicState.turn.playerOrder
    .map((id) => ({
      id,
      name: names[id] ?? id,
      color: ARM_COLORS[publicState.seatArms[id]],
      home: (publicState.positions[id] ?? []).filter((p) => p >= LANE_START).length,
      base: (publicState.positions[id] ?? []).filter((p) => p === -1).length,
    }))
    .sort((a, b) => b.home - a.home)
}

// ---- WahooResults ----

export function WahooResults({
  localPlayerId,
  localName,
  names,
  publicState,
  isHost,
  notice,
  onRematch,
  onBackToShelf,
}: WahooResultsProps) {
  void localName // kept in props for symmetry with the other results screens; the headline uses the winner's name
  const { play } = useSound()
  const isLocalWinner = publicState.winnerId === localPlayerId
  // Only the winner hears the victory cue — the loser hearing the same 'game-win' fanfare would
  // contradict the "X takes it!" headline they're looking at.
  useEffect(() => { if (isLocalWinner) play('game-win') }, [isLocalWinner, play])

  // Only render when the match is over
  if (publicState.stage !== 'over' || publicState.winnerId === null) return null

  const winnerId = publicState.winnerId
  const headline = isLocalWinner ? 'You take it!' : `${names[winnerId] ?? winnerId} takes it!`
  const headlineColor = ARM_COLORS[publicState.seatArms[winnerId]]

  const rows = rankWahooResults(publicState, names)

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
      <span className="chip" style={{ background: '#9333ea', color: '#fff' }}>
        Wahoo · {publicState.turn.playerOrder.length} players
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
                {row.home} home · {row.base} base
              </span>
              <span style={{ fontSize: 32, fontWeight: 700 }}>{row.home}</span>
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
