import { useState } from 'react'
import type { BattleshipVariant } from '../board-games/battleship/state'
import { BattleshipRulesOverlay } from './BattleshipRulesOverlay'
import { Wordmark } from '../components/Wordmark'
import './BattleshipTable.css'

const VARIANTS: { id: BattleshipVariant; name: string; desc: string }[] = [
  { id: 'standard', name: 'Standard turn-based', desc: 'One shot each, hit or miss.' },
  { id: 'streak', name: 'Make it, take it', desc: 'Keep firing as long as you hit.' },
  { id: 'free', name: 'Free-for-all', desc: 'No turns: both fleets fire at will. First to sink five wins.' },
]

export function BattleshipRoom({
  code, localName, notice, variant, onSetVariant, onAddHouseBot, onLeave,
}: {
  code: string
  localName: string
  notice?: string | null
  variant: BattleshipVariant
  onSetVariant: (v: BattleshipVariant) => void
  onAddHouseBot: () => void
  onLeave: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)

  function copyLink() {
    const url = `${location.origin}${location.pathname}?join=${code}`
    navigator.clipboard?.writeText(url).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  function copyCode() {
    navigator.clipboard?.writeText(code).catch(() => {})
    setCodeCopied(true)
    setTimeout(() => setCodeCopied(false), 1800)
  }

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

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(18px,3vw,40px)' }}>
        <div style={{ flex: '1 1 380px', maxWidth: 460 }}>
          <button
            type="button"
            onClick={copyCode}
            aria-label="Copy room code"
            style={{ display: 'block', width: '100%', textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer', background: 'var(--yellow)', border: '4px solid var(--ink)', borderRadius: 24, boxShadow: '0 6px 0 var(--ink)', padding: 20 }}
          >
            <div style={{ fontWeight: 600, fontSize: 14 }}>{codeCopied ? 'Copied!' : 'Give them this code'}</div>
            <div style={{ fontSize: 'clamp(26px,4.5vw,38px)', fontWeight: 700, letterSpacing: '-0.02em' }}>{code}</div>
          </button>
          <button type="button" className="btn" style={{ width: '100%', marginTop: 14 }} onClick={copyLink}>
            {copied ? 'Copied!' : 'Copy invite link'}
          </button>

          <div style={{ marginTop: 26, fontWeight: 600, fontSize: 15 }}>House rules</div>
          <div className="bs-variant-list">
            {VARIANTS.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`bs-variant-option${v.id === variant ? ' bs-variant-option--selected' : ''}`}
                onClick={() => onSetVariant(v.id)}
              >
                <span className="bs-variant-name">{v.name}</span>
                <span className="bs-variant-desc">{v.desc}</span>
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 22 }}>
            <button type="button" className="btn btn-coral btn-lg" onClick={onAddHouseBot}>
              Play the house
            </button>
          </div>
        </div>

        <div style={{ flex: '1 1 320px', maxWidth: 460 }}>
          <div
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: 'var(--green-text)', color: '#fff', fontWeight: 700, fontSize: 15,
              padding: '8px 18px', borderRadius: 999, border: '3px solid var(--ink)', boxShadow: '0 5px 0 var(--ink)',
              marginBottom: 14,
            }}
          >
            Battleship
          </div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10 }}>At the table</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, border: '4px solid var(--ink)', borderRadius: 20, padding: '12px 16px' }}>
              <span className="avatar" style={{ background: 'var(--green-text)' }}>{(localName[0] ?? '?').toUpperCase()}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{localName} (you)</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted-text)' }}>Host</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, border: '4px solid var(--grey-border)', borderRadius: 20, padding: '12px 16px', color: 'var(--disabled-text)' }}>
              <span className="avatar" style={{ background: 'var(--grey-fill)', color: 'var(--disabled-text)' }}>?</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>Waiting…</div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Open seat</div>
              </div>
            </div>
          </div>
          <p style={{ marginTop: 16, fontSize: 15, color: 'var(--muted-text)' }}>
            Waiting for someone to type the code, or add a house player.
          </p>
        </div>
      </div>

      {rulesOpen && <BattleshipRulesOverlay onClose={() => setRulesOpen(false)} />}
    </div>
  )
}
