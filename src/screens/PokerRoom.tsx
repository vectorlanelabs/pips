import { useState } from 'react'
import type { PokerVariant } from '../card-games/poker/state'
import { POKER_MIN_SEATS, maxSeatsFor } from '../card-games/poker/state'
import { PokerRulesOverlay } from './PokerRulesOverlay'
import { Wordmark } from '../components/Wordmark'
import { CardBackPicker } from '../components/CardBackPicker'

export const POKER_VARIANT_LABELS: Record<PokerVariant, string> = {
  holdem: "Texas Hold'em",
  omaha: 'Omaha',
  'five-draw': '5-Card Draw',
  'seven-draw': '7-Card Draw',
}

const VARIANT_DESCRIPTIONS: Record<PokerVariant, string> = {
  holdem: 'Community cards, no-limit betting. 2 to 8 players.',
  omaha: 'Four hole cards, exactly two play. 2 to 8 players.',
  'five-draw': 'One draw, best five wins. 2 to 6 players.',
  'seven-draw': 'Seven dealt, best five play. 2 to 5 players.',
}

const SEAT_COUNT_WORDS: Record<PokerVariant, string> = {
  holdem: 'eight',
  omaha: 'eight',
  'five-draw': 'six',
  'seven-draw': 'five',
}

export interface PokerRoomProps {
  code: string
  localName: string
  isHost: boolean
  seats: { name: string; isBot: boolean; isHost: boolean }[]
  notice?: string | null
  cardBack: string
  onSelectCardBack: (id: string) => void
  onAddHouseBot: () => void
  onStartGame: () => void
  onLeave: () => void
  variant?: PokerVariant
  onSelectVariant?: (v: PokerVariant) => void
}

const BRAND = 'var(--coral)'

export function PokerRoom({
  code,
  localName,
  isHost,
  seats,
  notice,
  cardBack,
  onSelectCardBack,
  onAddHouseBot,
  onStartGame,
  onLeave,
  variant = 'holdem',
  onSelectVariant,
}: PokerRoomProps) {
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
  const maxSeats = maxSeatsFor(variant)
  const slots = Array.from({ length: maxSeats }, (_, i) => seats[i] ?? null)

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

          <CardBackPicker
            cardBack={cardBack}
            onSelect={isHost ? onSelectCardBack : undefined}
            hostName={!isHost ? hostName : undefined}
          />

          {isHost ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 22 }}>
              <button type="button" className="btn btn-lg" onClick={onAddHouseBot} disabled={seats.length >= maxSeats}>
                Add house bot
              </button>
              <button type="button" className="btn btn-coral btn-lg" onClick={onStartGame} disabled={seats.length < POKER_MIN_SEATS || seats.length > maxSeats}>
                Start game
              </button>
            </div>
          ) : (
            <p style={{ marginTop: 22, fontSize: 15, color: 'var(--muted-text)' }}>
              Waiting for {hostName} to start…
            </p>
          )}
          {seats.length < maxSeats && (
            <p style={{ marginTop: 14, fontSize: 14, color: 'var(--muted-text)' }}>
              Two to {SEAT_COUNT_WORDS[variant]} seats. Bots can fill any of them.
            </p>
          )}
        </div>

        <div style={{ flex: '1 1 320px', maxWidth: 460 }}>
          {onSelectVariant ? (
            <div>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Game</div>
              <select
                className="input select-chevron"
                aria-label="Game variant"
                value={variant}
                onChange={(e) => onSelectVariant(e.target.value as PokerVariant)}
              >
                {Object.entries(POKER_VARIANT_LABELS).map(([key, label]) => (
                  <option key={key} value={key} disabled={seats.length > maxSeatsFor(key as PokerVariant)}>
                    {label}
                  </option>
                ))}
              </select>
              <p style={{ marginTop: 8, fontSize: 14, color: 'var(--muted-text)' }}>
                {VARIANT_DESCRIPTIONS[variant]}
              </p>
            </div>
          ) : (
            <>
              <div
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: BRAND, color: '#fff', fontWeight: 700, fontSize: 15,
                  padding: '8px 18px', borderRadius: 999, border: '3px solid var(--ink)', boxShadow: '0 5px 0 var(--ink)',
                  marginBottom: 14,
                }}
              >
                {POKER_VARIANT_LABELS[variant]}
              </div>
              <p style={{ marginTop: 8, fontSize: 14, color: 'var(--muted-text)' }}>
                {VARIANT_DESCRIPTIONS[variant]}
              </p>
            </>
          )}
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
            Small blind 5 / big blind 10, 1000 starting chips. Waiting for friends to type the code, or add a house bot.
          </p>
        </div>
      </div>

      {rulesOpen && <PokerRulesOverlay variant={variant} onClose={() => setRulesOpen(false)} />}
    </div>
  )
}
