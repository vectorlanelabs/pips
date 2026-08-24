import { useEffect } from 'react'
import type { RoomState, Seat } from '../types'
import { GAME_LABEL } from '../types'
import { upperTotal } from '../games/yahtzee'
import { useSound } from '../hooks/useSound'

function pillDetail(room: RoomState): string {
  switch (room.game) {
    case 'farkle': return `${room.farkle.round} rounds`
    case 'yahtzee': return '13 turns'
    case 'ttt': return 'first to 3'
    case 'connect4': return 'first to 3'
    case 'hangman': return 'first to 2'
  }
}

function rowDetail(room: RoomState, seatId: string): string {
  switch (room.game) {
    case 'farkle': {
      const seat = room.seats.find((s) => s.id === seatId)!
      return `${seat.farkles} farkles · best ${seat.best}`
    }
    case 'yahtzee':
      return `upper ${upperTotal(room.yahtzee.cards[seatId] ?? {})}`
    case 'ttt':
      return `${room.ttt.wins[seatId] ?? 0} games won`
    case 'connect4':
      return `${room.connect4.wins[seatId] ?? 0} games won`
    case 'hangman':
      return `${room.hangman.wins[seatId] ?? 0} words solved`
  }
}

function ledeText(room: RoomState, winner: Seat): string {
  switch (room.game) {
    case 'farkle':
      return `Won at ${winner.score.toLocaleString()} after ${room.farkle.round} rounds.`
    case 'yahtzee':
      return `Final total ${winner.score}, upper section ${upperTotal(room.yahtzee.cards[winner.id] ?? {})}.`
    case 'ttt': {
      const others = room.seats.filter((s) => s.id !== winner.id).map((s) => room.ttt.wins[s.id] ?? 0)
      return `Match score ${room.ttt.wins[winner.id] ?? 0}–${Math.max(0, ...others)}.`
    }
    case 'connect4': {
      const others = room.seats.filter((s) => s.id !== winner.id).map((s) => room.connect4.wins[s.id] ?? 0)
      return `Match score ${room.connect4.wins[winner.id] ?? 0}–${Math.max(0, ...others)}.`
    }
    case 'hangman':
      return `${room.hangman.wins[winner.id] ?? 0} words solved.`
  }
}

export function Results({
  room, localSeatId, isHost, onRematch, onBackToShelf,
}: {
  room: RoomState
  localSeatId: string | null
  isHost: boolean
  onRematch: () => void
  onBackToShelf: () => void
}) {
  const { play } = useSound()
  const winner = room.seats.find((s) => s.id === room.winnerId) ?? room.seats[0]
  const ranked = [...room.seats].sort((a, b) => b.score - a.score)
  const isMe = winner.id === localSeatId
  // Only the actual winner hears the win cue — every game reaching this screen shares it,
  // so a losing player must not get a victory sound just because someone at the table won.
  useEffect(() => { if (isMe) play('game-win') }, [])

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(28px,6vw,48px) clamp(18px,5vw,48px) 72px' }}>
      <span className="chip" style={{ background: 'var(--yellow)', color: 'var(--ink)' }}>
        {GAME_LABEL[room.game]} · {room.code} · {pillDetail(room)}
      </span>
      <h1 style={{
        fontSize: 'clamp(46px,10vw,116px)', fontWeight: 700, lineHeight: 0.92,
        letterSpacing: '-0.035em', color: winner.color, margin: '16px 0 8px',
      }}
      >
        {isMe ? 'You take it!' : `${winner.name} takes it!`}
      </h1>

      <p style={{ fontSize: 'clamp(16px,1.9vw,18px)', lineHeight: 1.5, maxWidth: '46ch', margin: '0 0 8px', color: 'var(--body-text)' }}>
        {ledeText(room, winner)}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 660, marginTop: 24 }}>
        {ranked.map((seat, i) => (
          <div
            key={seat.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px', borderRadius: 20,
              border: '4px solid var(--ink)',
              background: seat.id === winner.id ? seat.color : '#fff',
              color: seat.id === winner.id ? '#fff' : 'var(--ink)',
            }}
          >
            <span style={{ fontWeight: 700, width: 22 }}>{i + 1}</span>
            <span style={{ fontWeight: 700, fontSize: 18, flex: 1 }}>{seat.name}</span>
            <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.85 }}>{rowDetail(room, seat.id)}</span>
            <span style={{ fontSize: 32, fontWeight: 700 }}>{seat.score}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 32, alignItems: 'center', flexWrap: 'wrap' }}>
        {isHost && <button type="button" className="btn btn-coral btn-lg" onClick={onRematch}>Again</button>}
        <button type="button" className="btn btn-lg" onClick={onBackToShelf}>Back to the shelf</button>
        {!isHost && <span style={{ color: 'var(--muted-text)', fontSize: 14 }}>Waiting for the host to start a rematch…</span>}
      </div>
    </div>
  )
}
