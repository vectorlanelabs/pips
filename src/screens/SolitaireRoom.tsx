import { useState } from 'react'
import type { SolitaireMode } from '../card-games/solitaire/state'
import { SolitaireRulesOverlay } from './SolitaireRulesOverlay'
import { SOLITAIRE_COLOR } from './SolitaireTable'
import { Wordmark } from '../components/Wordmark'
import { CardBackPicker } from '../components/CardBackPicker'

export const SOLITAIRE_MODE_LABELS: Record<SolitaireMode, string> = {
  klondike: 'Klondike (Draw 1)',
  klondike3: 'Klondike (Draw 3)',
  freecell: 'FreeCell',
  spider: 'Spider (2 Suit)',
  spider1: 'Spider (1 Suit)',
}

const MODE_DESCRIPTIONS: Record<SolitaireMode, string> = {
  klondike: 'Seven columns, draw one at a time from the stock, unlimited passes.',
  klondike3: 'Seven columns, draw three at a time from the stock — only the last one drawn is playable.',
  freecell: 'Eight columns, every card face up, four free cells to park cards in.',
  spider: 'Ten columns, two suits, no free cells or foundations — build full King-to-Ace runs to clear them.',
  spider1: 'The easiest Spider: one suit only, so any descending run is always safe to move as a whole.',
}

export interface SolitaireRoomProps {
  localName: string
  cardBack: string
  onSelectCardBack: (id: string) => void
  mode: SolitaireMode
  onSelectMode: (mode: SolitaireMode) => void
  onStart: () => void
  onLeave: () => void
}

export function SolitaireRoom({
  localName,
  cardBack,
  onSelectCardBack,
  mode,
  onSelectMode,
  onStart,
  onLeave,
}: SolitaireRoomProps) {
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

          <div style={{ marginTop: 22, fontWeight: 600, fontSize: 15, marginBottom: 10 }}>Game mode</div>
          <select
            className="input card-back-select"
            aria-label="Game mode"
            value={mode}
            onChange={(e) => onSelectMode(e.target.value as SolitaireMode)}
          >
            {Object.entries(SOLITAIRE_MODE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <p style={{ marginTop: 10, fontSize: 14, color: 'var(--muted-text)' }}>
            {MODE_DESCRIPTIONS[mode]}
          </p>

          <button type="button" className="btn btn-coral btn-lg" onClick={onStart} style={{ width: '100%', marginTop: 22 }}>
            Start game
          </button>
        </div>

        <div style={{ flex: '1 1 320px', maxWidth: 460 }}>
          <div
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: SOLITAIRE_COLOR, color: '#fff', fontWeight: 700, fontSize: 15,
              padding: '8px 18px', borderRadius: 999, border: '3px solid var(--ink)', boxShadow: '0 5px 0 var(--ink)',
              marginBottom: 14,
            }}
          >
            Solitaire
          </div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10 }}>At the table</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, border: '4px solid var(--ink)', borderRadius: 20, padding: '12px 16px' }}>
            <span className="avatar" style={{ background: SOLITAIRE_COLOR }}>
              {(localName[0] ?? '?').toUpperCase()}
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>
                {localName} (you)
              </div>
              <div style={{ marginTop: 4 }}>
                <span className="chip" style={{ background: SOLITAIRE_COLOR, color: '#fff' }}>1 player</span>
              </div>
            </div>
          </div>
          <p style={{ marginTop: 16, fontSize: 15, color: 'var(--muted-text)' }}>
            Solitaire is just you and the deck — no code to share.
          </p>
        </div>
      </div>

      {rulesOpen && <SolitaireRulesOverlay mode={mode} onClose={() => setRulesOpen(false)} />}
    </div>
  )
}
