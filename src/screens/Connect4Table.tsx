import { useEffect, useRef, useState } from 'react'
import type { RoomState } from '../types'
import { lowestOpenRow } from '../games/connect4'
import { TableHeader } from '../components/TableHeader'
import { useSound } from '../hooks/useSound'
import { useTurnStartSound } from '../hooks/useTurnStartSound'

export function Connect4Table({
  room, localSeatId, onPlay, onOpenRules, onLeave,
}: {
  room: RoomState
  localSeatId: string | null
  onPlay: (col: number) => void
  onOpenRules: () => void
  onLeave: () => void
}) {
  const c = room.connect4
  const { play, enabled, setEnabled, turnSoundEnabled, setTurnSoundEnabled, playTurnStart } = useSound()
  const activeSeat = room.seats[room.turnIdx]
  const isMyTurn = activeSeat?.id === localSeatId
  const humanCount = room.seats.filter((s) => !s.bot).length
  useTurnStartSound(isMyTurn, humanCount, playTurnStart)
  const roundWinner = c.roundOver && c.winLine.length > 0 ? room.seats[c.board[c.winLine[0]]!] : null
  const roundStatus = c.roundOver
    ? roundWinner
      ? roundWinner.id === localSeatId ? 'You connect four!' : `${roundWinner.name} connects four!`
      : "It's a draw — playing again."
    : null
  const [hoverCol, setHoverCol] = useState<number | null>(null)
  const previewRow = hoverCol !== null && isMyTurn && !c.roundOver ? lowestOpenRow(c.board, hoverCol) : -1
  const previewIndex = previewRow >= 0 && hoverCol !== null ? previewRow * 7 + hoverCol : null

  const discCount = c.board.filter((cell) => cell !== null).length
  const soundSigRef = useRef({ roundOver: c.roundOver, discCount, wasMyTurn: isMyTurn })

  useEffect(() => {
    const p = soundSigRef.current
    const roundJustEnded = !p.roundOver && c.roundOver
    // A move that ends the round is a single event, not two — playing piece-drop and
    // round-win together clips both. round-win alone stands in for the drop on a
    // terminal move; an ordinary (non-terminal) drop still gets its own cue.
    if (roundJustEnded) {
      play('round-win')
    } else if (p.wasMyTurn && discCount > p.discCount) {
      play('piece-drop')
    }
    soundSigRef.current = { roundOver: c.roundOver, discCount, wasMyTurn: isMyTurn }
  }, [c.roundOver, discCount, isMyTurn, play])

  // Rejected actions (full column, out of turn, round already over, a stale/malformed click)
  // are otherwise silent no-ops — surface them briefly to the player who triggered them so a
  // rejected attempt doesn't read as a dead button. `rejection` is broadcast on the shared
  // room state but only shown to the seat it names.
  const [rejectionText, setRejectionText] = useState<string | null>(null)
  const lastRejectionNonceRef = useRef<number | null>(null)
  useEffect(() => {
    if (!c.rejection || c.rejection.seatId !== localSeatId) return
    if (c.rejection.nonce === lastRejectionNonceRef.current) return
    lastRejectionNonceRef.current = c.rejection.nonce
    setRejectionText(c.rejection.reason)
    const timer = setTimeout(() => setRejectionText(null), 2200)
    return () => clearTimeout(timer)
  }, [c.rejection, localSeatId])

  return (
    <div style={{ maxWidth: 1260, margin: '0 auto', padding: 'clamp(28px,6vw,48px) clamp(18px,5vw,48px) 72px' }}>
      <TableHeader
        gameLabel="Connect 4"
        gameColor="var(--connect4-color)"
        meta={`${room.code} · first to three`}
        onRules={onOpenRules}
        onLeave={onLeave}
        enabled={enabled}
        setEnabled={setEnabled}
        turnSoundEnabled={turnSoundEnabled}
        setTurnSoundEnabled={setTurnSoundEnabled}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(18px,3vw,40px)' }}>
        <div style={{ flex: '1 1 460px' }}>
          <div className="card card-resting">
            <span className="chip" style={{ background: (roundWinner ?? activeSeat)?.color }}>
              {roundStatus ? 'Round over' : isMyTurn ? 'Your move' : `${activeSeat?.name}'s move`}
            </span>
            <div style={{
              fontSize: 'clamp(22px,3.2vw,30px)', fontWeight: 700, margin: '10px 0 20px',
              color: roundStatus ? (roundWinner ? roundWinner.color : 'var(--muted-text)') : 'var(--ink)',
            }}
            >
              {roundStatus ?? (isMyTurn ? 'Pick a column.' : `${activeSeat?.name} is thinking…`)}
            </div>
            {rejectionText && (
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--coral)', margin: '-12px 0 16px' }}>
                {rejectionText}
              </div>
            )}
            <div style={{ background: 'var(--page-base)', border: '4px solid var(--ink)', borderRadius: 20, padding: 'clamp(10px,1.6vw,16px)', maxWidth: 560 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'clamp(6px,1vw,10px)' }}>
                {c.board.map((cell, i) => {
                  const col = i % 7
                  const owner = cell !== null ? room.seats[cell] : null
                  const isWin = c.winLine.includes(i)
                  const isPreview = i === previewIndex
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onPlay(col)}
                      onMouseEnter={() => setHoverCol(col)}
                      onMouseLeave={() => setHoverCol(null)}
                      disabled={!isMyTurn || c.roundOver || lowestOpenRow(c.board, col) < 0}
                      style={{
                        aspectRatio: '1', borderRadius: '50%', padding: 0,
                        transition: 'transform .15s ease',
                        cursor: !isMyTurn || c.roundOver || lowestOpenRow(c.board, col) < 0 ? 'default' : 'pointer',
                        background: cell !== null
                          ? `radial-gradient(circle at 32% 26%, rgba(255,255,255,0.55), ${owner!.color} 62%)`
                          : isPreview ? activeSeat!.color : '#fff',
                        border: cell !== null ? '4px solid var(--ink)' : '4px solid var(--grey-border)',
                        boxShadow: cell !== null
                          ? isWin
                            ? '0 6px 0 var(--yellow), inset 0 -5px 0 rgba(23,23,58,0.22), inset 0 4px 0 rgba(255,255,255,0.30)'
                            : '0 5px 0 rgba(23,23,58,0.30), inset 0 -5px 0 rgba(23,23,58,0.22), inset 0 4px 0 rgba(255,255,255,0.30)'
                          : 'inset 0 4px 6px rgba(23,23,58,0.12)',
                        opacity: isPreview ? 0.3 : 1,
                        transform: isWin ? 'translateY(-4px)' : undefined,
                      }}
                    />
                  )
                })}
              </div>
            </div>
            <p style={{ fontSize: 14, color: 'var(--muted-text)', marginTop: 14, minHeight: 20 }}>
              {isMyTurn && !c.roundOver ? 'Click a column to drop your disc.' : ''}
            </p>
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
                  <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{c.wins[s.id] ?? 0}<span style={{ fontSize: 13, fontWeight: 500, marginLeft: 6 }}>first to 3</span></div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
