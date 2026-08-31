import { useEffect, useRef, useState } from 'react'
import type { RoomState } from '../types'
import { TTT_MARKS } from '../games/ttt'
import { TableHeader } from '../components/TableHeader'
import { useSound } from '../hooks/useSound'
import { useTurnStartSound } from '../hooks/useTurnStartSound'

// Small fixed per-cell rotation so the hand-drawn marks don't line up too neatly.
const CELL_ROT = [-4, 3, -2, 4, -3, 2, -4, 3, -2]

export function TttTable({
  room, localSeatId, onPlay, onOpenRules, onLeave,
}: {
  room: RoomState
  localSeatId: string | null
  onPlay: (cell: number) => void
  onOpenRules: () => void
  onLeave: () => void
}) {
  const t = room.ttt
  const { play, enabled, setEnabled, turnSoundEnabled, setTurnSoundEnabled, playTurnStart } = useSound()
  const activeSeat = room.seats[room.turnIdx]
  const isMyTurn = activeSeat?.id === localSeatId
  const humanCount = room.seats.filter((s) => !s.bot).length
  useTurnStartSound(isMyTurn, humanCount, playTurnStart)
  const mySeatIdx = room.seats.findIndex((s) => s.id === localSeatId)
  const roundWinner = t.roundOver && t.winLine.length > 0 ? room.seats[t.board[t.winLine[0]]!] : null
  const roundStatus = t.roundOver
    ? roundWinner
      ? roundWinner.id === localSeatId ? 'You win this one!' : `${roundWinner.name} wins this one!`
      : "It's a draw — playing again."
    : null

  // Sound effects — diff room state transitions, but only for my own actions
  // (never for a bot's or opponent's turn — otherwise a fast bot spams sound).
  const markCount = t.board.filter((c) => c !== null).length
  const soundSigRef = useRef({ roundOver: t.roundOver, markCount, wasMyTurn: isMyTurn })

  useEffect(() => {
    const p = soundSigRef.current
    if (p.wasMyTurn && markCount > p.markCount) {
      play(mySeatIdx === 1 ? 'drawn-circle' : 'drawn-x')
    }
    // A draw has no winLine — it's not a win, so it doesn't get the win cue.
    if (!p.roundOver && t.roundOver && t.winLine.length > 0) {
      play('round-win')
    }
    soundSigRef.current = { roundOver: t.roundOver, markCount, wasMyTurn: isMyTurn }
  }, [t.roundOver, t.winLine, markCount, isMyTurn, play])

  // Rejected actions (occupied square, out of turn, round already over, a stale/malformed
  // click) are otherwise silent no-ops — surface them briefly to the player who triggered
  // them so a rejected attempt doesn't read as a dead button. `rejection` is broadcast on
  // the shared room state but only shown to the seat it names.
  const [rejectionText, setRejectionText] = useState<string | null>(null)
  const lastRejectionNonceRef = useRef<number | null>(null)
  useEffect(() => {
    if (!t.rejection || t.rejection.seatId !== localSeatId) return
    if (t.rejection.nonce === lastRejectionNonceRef.current) return
    lastRejectionNonceRef.current = t.rejection.nonce
    setRejectionText(t.rejection.reason)
    const timer = setTimeout(() => setRejectionText(null), 2200)
    return () => clearTimeout(timer)
  }, [t.rejection, localSeatId])

  return (
    <div style={{ maxWidth: 1260, margin: '0 auto', padding: 'clamp(28px,6vw,48px) clamp(18px,5vw,48px) 72px' }}>
      <TableHeader
        gameLabel="Tic Tac Toe"
        gameColor="var(--amber)"
        meta="first to three"
        onRules={onOpenRules}
        onLeave={onLeave}
        enabled={enabled}
        setEnabled={setEnabled}
        turnSoundEnabled={turnSoundEnabled}
        setTurnSoundEnabled={setTurnSoundEnabled}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(18px,3vw,40px)' }}>
        <div style={{ flex: '1 1 420px' }}>
          <div className="card card-resting">
            <span className="chip" style={{ background: (roundWinner ?? activeSeat)?.color }}>
              {roundStatus ? 'Round over' : isMyTurn ? 'Your move' : `${activeSeat?.name}'s move`}
            </span>
            <div style={{
              fontSize: 'clamp(22px,3.2vw,30px)', fontWeight: 700, margin: '10px 0 20px',
              color: roundStatus ? (roundWinner ? roundWinner.color : 'var(--muted-text)') : 'var(--ink)',
            }}
            >
              {roundStatus ?? (isMyTurn ? 'Pick a square.' : `${activeSeat?.name} is thinking…`)}
            </div>
            {rejectionText && (
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--coral)', margin: '-12px 0 16px' }}>
                {rejectionText}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'clamp(10px,1.4vw,16px)', maxWidth: 400 }}>
              {t.board.map((cell, i) => {
                const isWin = t.winLine.includes(i)
                const owner = cell !== null ? room.seats[cell] : null
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onPlay(i)}
                    disabled={!isMyTurn || cell !== null || t.over}
                    style={{
                      aspectRatio: '1', borderRadius: 22, border: '4px solid var(--ink)',
                      background: isWin ? 'var(--yellow)' : '#fff',
                      boxShadow: isWin ? '0 7px 0 var(--ink)' : '0 7px 0 var(--grey-border)',
                      fontSize: 'clamp(38px,6vw,58px)', fontWeight: 700,
                      color: isWin ? 'var(--ink)' : owner?.color ?? 'var(--ink)',
                      cursor: !isMyTurn || cell !== null ? 'default' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {cell === 0 ? (
                      <svg viewBox="0 0 100 100" style={{ width: '56%', height: '56%', transform: `rotate(${CELL_ROT[i]}deg)`, display: 'block' }}>
                        <path d="M22 20 C33 36,45 50,58 64 C66 73,73 79,81 85" fill="none" stroke="currentColor" strokeWidth={10} strokeLinecap="round" />
                        <path d="M80 17 C68 33,55 49,43 62 C35 70,27 78,19 84" fill="none" stroke="currentColor" strokeWidth={10} strokeLinecap="round" />
                      </svg>
                    ) : cell === 1 ? (
                      <svg viewBox="0 0 100 100" style={{ width: '56%', height: '56%', transform: `rotate(${CELL_ROT[i]}deg)`, display: 'block' }}>
                        <path d="M54 14 C76 17,89 34,85 55 C82 76,64 90,45 86 C27 82,13 66,17 47 C21 30,35 15,52 16 C55 16,50 13,44 19" fill="none" stroke="currentColor" strokeWidth={10} strokeLinecap="round" />
                      </svg>
                    ) : cell !== null ? TTT_MARKS[cell] : null}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div style={{ flex: '1 1 230px', maxWidth: 330 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {room.seats.map((s) => {
              const isActive = s.id === activeSeat?.id
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
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{isActive ? (s.id === localSeatId ? 'your move' : '') : ''}</span>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{t.wins[s.id] ?? 0}<span style={{ fontSize: 13, fontWeight: 500, marginLeft: 6 }}>first to 3</span></div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
