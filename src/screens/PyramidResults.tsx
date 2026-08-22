import { useEffect } from 'react'
import { PYRAMID_COLOR } from './PyramidTable'
import { useSound } from '../hooks/useSound'

export interface PyramidResultsProps {
  moves: number
  onDealAgain: () => void
  onBackToShelf: () => void
}

export function PyramidResults({
  moves,
  onDealAgain,
  onBackToShelf,
}: PyramidResultsProps) {
  const { play } = useSound()

  useEffect(() => {
    play('game-win')
  }, [play])

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(28px,6vw,48px) clamp(18px,5vw,48px) 72px' }}>
      <span className="chip" style={{ background: 'var(--yellow)', color: 'var(--ink)' }}>
        Pyramid Solitaire
      </span>

      <h1 style={{
        fontSize: 'clamp(46px,10vw,116px)',
        fontWeight: 700,
        lineHeight: 0.92,
        letterSpacing: '-0.035em',
        color: PYRAMID_COLOR,
        margin: '16px 0 8px',
      }}>
        You win!
      </h1>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        border: '4px solid var(--ink)', borderRadius: 20,
        padding: '14px 20px',
        marginTop: 24,
        background: PYRAMID_COLOR,
        color: '#fff',
      }}>
        <span style={{ fontWeight: 700, width: 22 }}>1</span>
        <span style={{
          width: 22, height: 22, borderRadius: '50%', flex: 'none',
          background: PYRAMID_COLOR,
          border: '3px solid rgba(255,255,255,0.85)',
        }} />
        <span style={{ fontWeight: 700, fontSize: 18, flex: 1 }}>Solved</span>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: 32, fontWeight: 700 }}>{moves}</span>
          <div style={{ fontSize: 13, fontWeight: 500, opacity: 0.85 }}>moves</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 32, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-coral btn-lg" onClick={onDealAgain}>
          Deal again
        </button>
        <button type="button" className="btn btn-lg" onClick={onBackToShelf}>
          Back to the shelf
        </button>
      </div>
    </div>
  )
}
