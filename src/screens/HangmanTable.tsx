import { useEffect, useRef, useState } from 'react'
import type { RoomState } from '../types'
import { isWordSolved } from '../games/hangman'
import { TableHeader } from '../components/TableHeader'
import { useSound } from '../hooks/useSound'
import { useTurnStartSound } from '../hooks/useTurnStartSound'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const PART_THRESHOLD = { head: 1, body: 2, armL: 3, armR: 4, legL: 5, legR: 6 }

// Mirrors the host's hangmanSetWord validation (src/state/room.ts) so the button disables
// before a submission would be rejected, rather than letting punctuation through only to
// have the host bounce it (docs/reviews/hangman-review.md minor: setter copy vs. behavior).
function isValidHangmanWord(raw: string): boolean {
  const clean = raw.trim().toUpperCase().replace(/\s+/g, ' ')
  return /^[A-Z ]*$/.test(clean) && clean.replace(/ /g, '').length >= 3
}

function Gallows({ wrong }: { wrong: number }) {
  const part = (show: boolean, style: React.CSSProperties) => (
    <div style={{ position: 'absolute', background: 'var(--coral)', borderRadius: 4, transition: 'opacity .2s', opacity: show ? 1 : 0, ...style }} />
  )
  return (
    <div style={{ position: 'relative', width: 150, height: 190, flex: 'none' }}>
      <div style={{ position: 'absolute', left: 10, bottom: 0, width: 96, height: 10, background: 'var(--ink)', borderRadius: 4 }} />
      <div style={{ position: 'absolute', left: 20, bottom: 0, width: 10, height: 184, background: 'var(--ink)', borderRadius: 4 }} />
      <div style={{ position: 'absolute', left: 20, top: 0, width: 70, height: 10, background: 'var(--ink)', borderRadius: 4 }} />
      <div style={{ position: 'absolute', left: 80, top: 10, width: 8, height: 22, background: 'var(--ink)', borderRadius: 4 }} />
      {part(wrong >= PART_THRESHOLD.head, { left: 64, top: 32, width: 40, height: 40, borderRadius: '50%', background: 'transparent', border: '6px solid var(--coral)' })}
      {part(wrong >= PART_THRESHOLD.body, { left: 80, top: 72, width: 8, height: 52 })}
      {part(wrong >= PART_THRESHOLD.armL, { left: 56, top: 82, width: 28, height: 8, transform: 'rotate(28deg)' })}
      {part(wrong >= PART_THRESHOLD.armR, { left: 86, top: 82, width: 28, height: 8, transform: 'rotate(-28deg)' })}
      {part(wrong >= PART_THRESHOLD.legL, { left: 62, top: 118, width: 30, height: 8, transform: 'rotate(-38deg)' })}
      {part(wrong >= PART_THRESHOLD.legR, { left: 84, top: 118, width: 30, height: 8, transform: 'rotate(38deg)' })}
    </div>
  )
}

export function HangmanTable({
  room, localSeatId, onSetWord, onGuess, onAdvanceRound, onOpenRules, onLeave,
}: {
  room: RoomState
  localSeatId: string | null
  onSetWord: (word: string) => void
  onGuess: (letter: string) => void
  onAdvanceRound: () => void
  onOpenRules: () => void
  onLeave: () => void
}) {
  const h = room.hangman
  const { play, enabled, setEnabled, turnSoundEnabled, setTurnSoundEnabled, playTurnStart } = useSound()
  const [wordInput, setWordInput] = useState('')
  const guesser = room.seats[h.guesserIdx]
  const setterIdx = h.guesserIdx === 0 ? 1 : 0
  const setter = room.seats[setterIdx]
  const iAmGuesser = guesser?.id === localSeatId
  const iAmSetter = setter?.id === localSeatId
  const isMyTurn = h.phase === 'setting' ? iAmSetter : h.phase !== 'roundOver' && iAmGuesser
  const humanCount = room.seats.filter((s) => !s.bot).length
  useTurnStartSound(isMyTurn, humanCount, playTurnStart)

  // Sound effects — diff room state transitions, but only for my own guesses
  // (never for the opponent's turn — otherwise a fast bot spams sound).
  const soundSigRef = useRef({ guessedLen: h.guessed.length, wrongLen: h.wrong.length, over: h.over, wasGuesser: iAmGuesser })

  useEffect(() => {
    const p = soundSigRef.current
    if (p.wasGuesser) {
      if (h.wrong.length > p.wrongLen) {
        play('letter-wrong')
      } else if (h.guessed.length > p.guessedLen) {
        play('letter-correct')
      }
    }
    if (!p.over && h.over && isWordSolved(h.word, h.guessed)) {
      play('round-win')
    }
    soundSigRef.current = { guessedLen: h.guessed.length, wrongLen: h.wrong.length, over: h.over, wasGuesser: iAmGuesser }
  }, [h.wrong.length, h.guessed.length, h.over, h.word, h.guessed, iAmGuesser, play])

  // Rejected actions (out-of-turn/out-of-phase word or guess, a duplicate letter, a malformed
  // guess payload, punctuation in a set word) are otherwise silent no-ops — surface them
  // briefly to the player who triggered them so a rejected attempt doesn't read as a dead
  // button. `rejection` is broadcast on the shared room state but only shown to the seat it
  // names (matches TttTable's precedent).
  const [rejectionText, setRejectionText] = useState<string | null>(null)
  const lastRejectionNonceRef = useRef<number | null>(null)
  useEffect(() => {
    if (!h.rejection || h.rejection.seatId !== localSeatId) return
    if (h.rejection.nonce === lastRejectionNonceRef.current) return
    lastRejectionNonceRef.current = h.rejection.nonce
    setRejectionText(h.rejection.reason)
    const timer = setTimeout(() => setRejectionText(null), 2200)
    return () => clearTimeout(timer)
  }, [h.rejection, localSeatId])

  // Active-seat highlight, matching TttTable/Connect4Table: the setter is "active" while
  // setting, the guesser while guessing; nobody is highlighted once the round is over.
  const activeSeatId = h.phase === 'setting' ? setter?.id : h.phase === 'guessing' ? guesser?.id : null

  return (
    <div style={{ maxWidth: 1260, margin: '0 auto', padding: 'clamp(28px,6vw,48px) clamp(18px,5vw,48px) 72px' }}>
      <TableHeader
        gameLabel="Hangman"
        gameColor="var(--coral)"
        meta={`${room.code} · first to two`}
        onRules={onOpenRules}
        onLeave={onLeave}
        enabled={enabled}
        setEnabled={setEnabled}
        turnSoundEnabled={turnSoundEnabled}
        setTurnSoundEnabled={setTurnSoundEnabled}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(18px,3vw,40px)' }}>
        <div style={{ flex: '1 1 480px' }}>
          <div className="card card-resting">
            {h.phase === 'setting' ? (
              <>
                <div style={{ fontSize: 'clamp(22px,3.2vw,30px)', fontWeight: 700, marginBottom: 16 }}>
                  {iAmSetter ? `Give ${guesser?.name} a word to guess.` : `${setter?.name} is picking a word…`}
                </div>
                {iAmSetter && (
                  <>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <input
                        className="input input-code"
                        style={{ maxWidth: 260 }}
                        value={wordInput}
                        onChange={(e) => setWordInput(e.target.value)}
                        placeholder="PEANUT BUTTER"
                      />
                      <button
                        type="button"
                        className="btn btn-coral"
                        disabled={!isValidHangmanWord(wordInput)}
                        onClick={() => { onSetWord(wordInput); setWordInput('') }}
                      >
                        Send it over
                      </button>
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--faint-text)', marginTop: 8 }}>Letters and spaces only.</p>
                    {rejectionText && (
                      <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--coral)', marginTop: 8 }}>{rejectionText}</p>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <div style={{
                  fontSize: 'clamp(22px,3.2vw,30px)', fontWeight: 700, marginBottom: 16,
                  color: h.phase === 'roundOver' ? (h.wrong.length >= 6 ? 'var(--coral)' : 'var(--green-text)') : 'var(--ink)',
                }}
                >
                  {h.phase === 'roundOver' ? h.status : iAmGuesser ? 'Guess the word.' : `Watching ${guesser?.name} guess.`}
                </div>
                {h.phase === 'roundOver' && (
                  <button type="button" className="btn btn-coral btn-lg" style={{ marginBottom: 16 }} onClick={onAdvanceRound}>
                    Continue
                  </button>
                )}
                {rejectionText && (
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--coral)', margin: '-8px 0 16px' }}>
                    {rejectionText}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Gallows wrong={h.wrong.length} />
                  <div>
                    <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', maxWidth: 460 }}>
                      {h.word.split(' ').map((word, wi) => (
                        <div key={wi} style={{ display: 'flex', flexWrap: 'nowrap', gap: 6 }}>
                          {word.split('').map((letter, li) => {
                            const revealed = h.guessed.includes(letter) || h.over
                            return (
                              <div key={li} style={{ width: 34, textAlign: 'center' }}>
                                <div style={{
                                  fontSize: 32, fontWeight: 700, height: 40,
                                  color: !h.guessed.includes(letter) && h.over ? 'var(--coral)' : 'var(--ink)',
                                }}
                                >
                                  {revealed ? letter : ''}
                                </div>
                                <div style={{ height: 5, background: 'var(--ink)', borderRadius: 3 }} />
                              </div>
                            )
                          })}
                        </div>
                      ))}
                    </div>
                    <p style={{ marginTop: 14, fontSize: 15 }}>
                      {h.wrong.length > 0 && <span style={{ color: 'var(--coral)', fontWeight: 600 }}>Wrong: {h.wrong.join(' ')} · </span>}
                      <span style={{ color: 'var(--muted-text)' }}>{6 - h.wrong.length} left</span>
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 22, maxWidth: 500 }}>
                  {ALPHABET.map((letter) => {
                    const used = h.guessed.includes(letter)
                    const correct = used && h.word.includes(letter)
                    const disabledReason = h.over
                      ? 'This round is already over.'
                      : used
                        ? `Already guessed — ${correct ? 'correct' : 'wrong'}.`
                        : !iAmGuesser
                          ? `Waiting on ${guesser?.name ?? 'the guesser'}.`
                          : undefined
                    return (
                      <button
                        key={letter}
                        type="button"
                        disabled={!iAmGuesser || used || h.over}
                        onClick={() => onGuess(letter)}
                        aria-label={`Guess the letter ${letter}`}
                        aria-disabled={!iAmGuesser || used || h.over}
                        title={disabledReason}
                        style={{
                          width: 42, height: 44, borderRadius: 12, fontWeight: 700,
                          border: correct ? '3px solid var(--ink)' : '3px solid transparent',
                          background: correct ? 'var(--green)' : used ? 'var(--grey-fill)' : '#fff',
                          color: used && !correct ? 'var(--disabled-text)' : 'var(--ink)',
                          boxShadow: used ? 'none' : '0 4px 0 var(--grey-border)',
                          cursor: !iAmGuesser || used ? 'default' : 'pointer',
                        }}
                      >
                        {letter}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <div style={{ flex: '1 1 230px', maxWidth: 330 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {room.seats.map((s) => {
              const isActive = s.id === activeSeatId
              return (
                <div
                  key={s.id}
                  style={{
                    border: '3px solid var(--ink)', borderRadius: 18, padding: '12px 16px',
                    background: isActive ? s.color : '#fff', color: isActive ? '#fff' : 'var(--body-text)',
                    boxShadow: isActive ? 'none' : '0 7px 0 var(--grey-border)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                    <span>{s.name}</span>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                      {isActive ? (s.id === localSeatId ? (h.phase === 'setting' ? 'your word' : 'your guess') : '') : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>
                    {h.wins[s.id] ?? 0}
                    <span style={{ fontSize: 13, fontWeight: 500, marginLeft: 6, color: isActive ? 'rgba(255,255,255,.8)' : 'var(--muted-text)' }}>first to 2</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
