import { useState } from 'react'
import { PyramidRulesOverlay } from './PyramidRulesOverlay'
import { PYRAMID_COLOR } from './PyramidTable'
import { Wordmark } from '../components/Wordmark'
import { CardBackPicker } from '../components/CardBackPicker'

export interface PyramidRoomProps {
  localName: string
  cardBack: string
  onSelectCardBack: (id: string) => void
  onStart: () => void
  onLeave: () => void
}

export function PyramidRoom({
  localName,
  cardBack,
  onSelectCardBack,
  onStart,
  onLeave,
}: PyramidRoomProps) {
  const [rulesOpen, setRulesOpen] = useState(false)

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(28px,6vw,48px) clamp(18px,5vw,48px) 72px' }}>
      <div className="header-row">
        <div className="header-left">
          <Wordmark small onClick={onLeave} />
        </div>
        <div className="header-actions">
          <button type="button" className="btn pill-small" onClick={() => setRulesOpen(true)}>Rules</button>
          <button type="button" className="btn btn-ghost" onClick={onLeave}>Leave</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(18px,3vw,40px)' }}>
        <div style={{ flex: '1 1 380px', maxWidth: 460 }}>
          <div style={{ background: 'var(--yellow)', border: '4px solid var(--ink)', borderRadius: 24, boxShadow: '0 6px 0 var(--ink)', padding: 20 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Just you</div>
            <div style={{ fontSize: 'clamp(26px,4.5vw,38px)', fontWeight: 700, letterSpacing: '-0.02em' }}>1 player</div>
          </div>

          <CardBackPicker cardBack={cardBack} onSelect={onSelectCardBack} />

          <p style={{ marginTop: 22, fontSize: 14, color: 'var(--muted-text)' }}>
            Clear the 28-card pyramid by pairing exposed cards that add up to 13. Kings clear alone.
          </p>

          <button type="button" className="btn btn-coral btn-lg" onClick={onStart} style={{ width: '100%', marginTop: 22 }}>
            Start game
          </button>
        </div>

        <div style={{ flex: '1 1 320px', maxWidth: 460 }}>
          <div
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: PYRAMID_COLOR, color: '#fff', fontWeight: 700, fontSize: 15,
              padding: '8px 18px', borderRadius: 999, border: '3px solid var(--ink)', boxShadow: '0 5px 0 var(--ink)',
              marginBottom: 14,
            }}
          >
            Pyramid Solitaire
          </div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10 }}>At the table</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, border: '4px solid var(--ink)', borderRadius: 20, padding: '12px 16px' }}>
            <span className="avatar" style={{ background: PYRAMID_COLOR }}>
              {(localName[0] ?? '?').toUpperCase()}
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>
                {localName} (you)
              </div>
              <div style={{ marginTop: 4 }}>
                <span className="chip" style={{ background: PYRAMID_COLOR, color: '#fff' }}>1 player</span>
              </div>
            </div>
          </div>
          <p style={{ marginTop: 16, fontSize: 15, color: 'var(--muted-text)' }}>
            Pyramid Solitaire is just you and the deck — no code to share.
          </p>
        </div>
      </div>

      {rulesOpen && <PyramidRulesOverlay onClose={() => setRulesOpen(false)} />}
    </div>
  )
}
