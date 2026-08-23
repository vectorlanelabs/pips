import { useState } from 'react'
import type { BotDifficulty } from '../types'
import { SCRABBLE_MAX_SEATS, SCRABBLE_MIN_SEATS } from '../board-games/scrabble/state'
import { ScrabbleRulesOverlay } from './ScrabbleRulesOverlay'
import { Wordmark } from '../components/Wordmark'

export interface ScrabbleRoomProps {
  code: string
  localName: string
  isHost: boolean
  seats: { name: string; isBot: boolean; isHost: boolean }[]
  notice?: string | null
  difficulty: BotDifficulty
  onAddHouseBot: () => void
  onSetDifficulty: (d: BotDifficulty) => void
  onStartGame: () => void
  onLeave: () => void
}

const BRAND = '#8b6e47'

export function ScrabbleRoom({
  code,
  localName,
  isHost,
  seats,
  notice,
  difficulty,
  onAddHouseBot,
  onSetDifficulty,
  onStartGame,
  onLeave,
}: ScrabbleRoomProps) {
  const [copied, setCopied] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)

  function copyLink() {
    const url = `${location.origin}${location.pathname}?join=${code}`
    navigator.clipboard?.writeText(url).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const hostName = seats.find((s) => s.isHost)?.name ?? 'the host'
  const slots = Array.from({ length: SCRABBLE_MAX_SEATS }, (_, i) => seats[i] ?? null)

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
          <div style={{ background: 'var(--yellow)', border: '4px solid var(--ink)', borderRadius: 24, boxShadow: '0 6px 0 var(--ink)', padding: 20 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Give them this code</div>
            <div style={{ fontSize: 'clamp(26px,4.5vw,38px)', fontWeight: 700, letterSpacing: '-0.02em' }}>{code}</div>
          </div>
          <button type="button" className="btn" style={{ width: '100%', marginTop: 14 }} onClick={copyLink}>
            {copied ? 'Copied!' : 'Copy invite link'}
          </button>

          <div style={{ marginTop: 22 }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10 }}>House bot difficulty</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['easy', 'medium', 'hard'] as const).map((d) => (
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
                  {d.charAt(0).toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>
            <p style={{ marginTop: 8, marginBottom: 0, fontSize: 13, fontWeight: 500, color: 'var(--muted-text)' }}>
              How good a move house bots play, and how often they call a bad word.
            </p>
          </div>

          {isHost ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 22 }}>
              <button type="button" className="btn btn-lg" onClick={onAddHouseBot} disabled={seats.length >= SCRABBLE_MAX_SEATS}>
                Add house bot
              </button>
              <button type="button" className="btn btn-coral btn-lg" onClick={onStartGame} disabled={seats.length < SCRABBLE_MIN_SEATS}>
                Start game
              </button>
            </div>
          ) : (
            <p style={{ marginTop: 22, fontSize: 15, color: 'var(--muted-text)' }}>
              Waiting for {hostName} to start…
            </p>
          )}
          {seats.length < SCRABBLE_MAX_SEATS && (
            <p style={{ marginTop: 14, fontSize: 14, color: 'var(--muted-text)' }}>
              Two to four seats — bots can fill any of them.
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
            Scrabble
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

      {rulesOpen && <ScrabbleRulesOverlay onClose={() => setRulesOpen(false)} />}
    </div>
  )
}
