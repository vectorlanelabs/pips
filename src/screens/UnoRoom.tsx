import { useState } from 'react'
import type { BotDifficulty } from '../types'
import type { UnoHouseRuleKey } from '../card-games/uno/state'
import { UNO_HOUSE_RULE_DEFS, UNO_MAX_SEATS, UNO_MIN_SEATS } from '../card-games/uno/state'
import { UnoRulesOverlay } from './UnoRulesOverlay'
import { Wordmark } from '../components/Wordmark'
import './UnoRoom.css'

export interface UnoRoomProps {
  code: string
  localName: string
  isHost: boolean
  seats: { name: string; isBot: boolean; isHost: boolean }[]  // host first, join order
  notice?: string | null
  houseRules: Record<UnoHouseRuleKey, boolean>       // host's currently-chosen overrides (guests see these read-only)
  difficulty: BotDifficulty                          // room-wide setting for every house bot's Uno-call reflex timing
  onAddHouseBot: () => void       // host-only
  onToggleHouseRule: (key: UnoHouseRuleKey) => void   // host-only
  onSetDifficulty: (d: BotDifficulty) => void         // host-only
  onStartGame: () => void         // host-only
  onLeave: () => void
}

const BRAND = '#e11d2e'
const DIFFICULTIES: BotDifficulty[] = ['easy', 'medium', 'hard']
const DIFFICULTY_LABEL: Record<BotDifficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }

export function UnoRoom({
  code,
  localName,
  isHost,
  seats,
  notice,
  houseRules,
  difficulty,
  onAddHouseBot,
  onToggleHouseRule,
  onSetDifficulty,
  onStartGame,
  onLeave,
}: UnoRoomProps) {
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

  const hostName = seats.find((s) => s.isHost)?.name ?? 'the host'
  const slots = Array.from({ length: UNO_MAX_SEATS }, (_, i) => seats[i] ?? null)

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

          <div style={{ marginTop: 26 }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10 }}>House rules</div>
            <div className="uno-house-rules">
              {UNO_HOUSE_RULE_DEFS.map((def) => {
                const on = houseRules[def.key]
                return (
                  <button
                    key={def.key}
                    type="button"
                    disabled={!isHost}
                    aria-pressed={on}
                    className={`uno-house-rule${on ? ' uno-house-rule--on' : ''}`}
                    onClick={() => onToggleHouseRule(def.key)}
                  >
                    <span className="uno-house-rule-text">
                      <span className="uno-house-rule-label">{def.label}</span>
                      <span className="uno-house-rule-desc">{def.description}</span>
                    </span>
                    <span className="uno-house-rule-pill">{on ? 'On' : 'Off'}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ marginTop: 22 }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10 }}>House bot reflex</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {DIFFICULTIES.map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={!isHost}
                  onClick={() => onSetDifficulty(d)}
                  className="btn pill-small"
                  style={{
                    flex: 1,
                    background: difficulty === d ? 'var(--ink)' : '#fff',
                    color: difficulty === d ? '#fff' : 'var(--ink)',
                  }}
                >
                  {DIFFICULTY_LABEL[d]}
                </button>
              ))}
            </div>
            <p style={{ marginTop: 8, marginBottom: 0, fontSize: 13, fontWeight: 500, color: 'var(--muted-text)' }}>
              How quickly house bots call Uno.
            </p>
          </div>

          {isHost ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 22 }}>
              <button type="button" className="btn btn-lg" onClick={onAddHouseBot} disabled={seats.length >= UNO_MAX_SEATS}>
                Add house bot
              </button>
              <button type="button" className="btn btn-coral btn-lg" onClick={onStartGame} disabled={seats.length < UNO_MIN_SEATS}>
                Start game
              </button>
            </div>
          ) : (
            <p style={{ marginTop: 22, fontSize: 15, color: 'var(--muted-text)' }}>
              Waiting for {hostName} to start…
            </p>
          )}
          {seats.length < UNO_MAX_SEATS && (
            <p style={{ marginTop: 14, fontSize: 14, color: 'var(--muted-text)' }}>
              Two to six seats — bots can fill any of them.
            </p>
          )}
        </div>

        <div style={{ flex: '1 1 320px', maxWidth: 460 }}>
          <div
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: BRAND, color: '#fff', fontWeight: 700, fontSize: 15,
              padding: '8px 18px', borderRadius: 999, border: '3px solid var(--ink)', boxShadow: '0 5px 0 var(--ink)',
              marginBottom: 14,
            }}
          >
            Uno
          </div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10 }}>At the table</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {slots.map((seat, i) =>
              seat === null ? (
                <div
                  key={`empty-${i}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, border: '4px solid var(--grey-border)', borderRadius: 20, padding: '12px 16px', color: 'var(--disabled-text)' }}
                >
                  <span className="avatar" style={{ background: 'var(--grey-fill)', color: 'var(--disabled-text)' }}>?</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 18 }}>Open seat</div>
                  </div>
                </div>
              ) : (
                <div
                  key={`seat-${i}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, border: '4px solid var(--ink)', borderRadius: 20, padding: '12px 16px' }}
                >
                  <span className="avatar" style={{ background: BRAND }}>{(seat.name[0] ?? '?').toUpperCase()}</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 18 }}>
                      {seat.name}{seat.name === localName ? ' (you)' : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      {seat.isHost && <span className="chip" style={{ background: BRAND, color: '#fff' }}>Host</span>}
                      {seat.isBot && <span className="chip" style={{ background: 'var(--slate-pip)', color: '#fff' }}>House bot</span>}
                    </div>
                  </div>
                </div>
              ),
            )}
          </div>
          <p style={{ marginTop: 16, fontSize: 15, color: 'var(--muted-text)' }}>
            Waiting for friends to type the code, or add a house bot.
          </p>
        </div>
      </div>

      {rulesOpen && <UnoRulesOverlay onClose={() => setRulesOpen(false)} />}
    </div>
  )
}
