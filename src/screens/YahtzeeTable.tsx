import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RoomState, YCategory } from '../types'
import { Y_CATEGORIES, Y_LABEL, Y_SUBLABEL, partitionDiceOrder, scoreCategory, upperTotal } from '../games/yahtzee'
import { Die } from '../components/Die'
import { TableHeader } from '../components/TableHeader'
import { useDiceAnimation } from '../hooks/useDiceAnimation'
import { useSound } from '../hooks/useSound'
import { useTurnStartSound } from '../hooks/useTurnStartSound'

export function YahtzeeTable({
  room, localSeatId, onRoll, onToggleHold, onScore, onOpenRules, onLeave,
}: {
  room: RoomState
  localSeatId: string | null
  onRoll: () => void
  onToggleHold: (dieId: number) => void
  onScore: (category: YCategory) => void
  onOpenRules: () => void
  onLeave: () => void
}) {
  const y = room.yahtzee
  const { play, enabled, setEnabled, turnSoundEnabled, setTurnSoundEnabled, playTurnStart } = useSound()
  const activeSeat = room.seats[room.turnIdx]
  const isMyTurn = activeSeat?.id === localSeatId
  const humanCount = room.seats.filter((s) => !s.bot).length
  useTurnStartSound(isMyTurn, humanCount, playTurnStart)
  const displayVals = useDiceAnimation(y.dice, y.rollsLeft)
  const vals = y.dice.map((d) => d.val)

  const [diceOrder, setDiceOrder] = useState<{ ids: number[]; heldCount: number }>({ ids: [], heldCount: 0 })

  // Re-partition only when a roll lands (or the dice are cleared) — never on a hold toggle,
  // so holding a die doesn't make it jump; it moves left on the next roll.
  useLayoutEffect(() => {
    setDiceOrder(partitionDiceOrder(y.dice))
  }, [y.rollsLeft, y.dice.length])

  const rollLabel = y.dice.length === 0 ? 'Roll five' : y.rollsLeft > 0 ? `Roll again (${y.rollsLeft} left)` : 'No rolls left'
  const canRoll = isMyTurn && y.rollsLeft > 0

  // Sound effects — diff room state transitions, but only for my own actions
  // (never for a bot's or opponent's turn — otherwise a fast bot spams sound).
  const selKey = y.dice.map((d) => d.sel).join(',')
  const lastTurnRef = y.lastTurn ? `${y.lastTurn.name}:${y.lastTurn.category}:${y.lastTurn.points}` : ''
  const soundSigRef = useRef({ selKey, rollsLeft: y.rollsLeft, lastTurnRef, wasMyTurn: isMyTurn })

  useEffect(() => {
    const p = soundSigRef.current
    if (p.wasMyTurn) {
      if (y.rollsLeft !== p.rollsLeft && y.dice.length > 0) {
        play('dice-roll')
      } else if (selKey !== p.selKey && y.rollsLeft === p.rollsLeft) {
        play('die-select')
      }
      if (lastTurnRef !== p.lastTurnRef && lastTurnRef !== '') {
        if (y.lastTurn?.points === 50) play('hot-dice')
        else play('bank-points')
      }
    }
    soundSigRef.current = { selKey, rollsLeft: y.rollsLeft, lastTurnRef, wasMyTurn: isMyTurn }
  }, [y.rollsLeft, selKey, lastTurnRef, y.dice.length, y.lastTurn, isMyTurn, play])

  // Rejected actions (out-of-turn, no rolls left, an already-filled category, or scoring before
  // the first roll) are otherwise silent no-ops — surface them briefly to the player who
  // triggered them so a rejected attempt doesn't read as a dead button. `rejection` is broadcast
  // on the shared room state but only shown to the seat it names (matches TttTable/FarkleTable).
  const [rejectionText, setRejectionText] = useState<string | null>(null)
  const lastRejectionNonceRef = useRef<number | null>(null)
  useEffect(() => {
    if (!y.rejection || y.rejection.seatId !== localSeatId) return
    if (y.rejection.nonce === lastRejectionNonceRef.current) return
    lastRejectionNonceRef.current = y.rejection.nonce
    setRejectionText(y.rejection.reason)
    const timer = setTimeout(() => setRejectionText(null), 2200)
    return () => clearTimeout(timer)
  }, [y.rejection, localSeatId])

  return (
    <div style={{ maxWidth: 1260, margin: '0 auto', padding: 'clamp(28px,6vw,48px) clamp(18px,5vw,48px) 72px' }}>
      <TableHeader
        gameLabel="Yahtzee"
        gameColor="var(--teal)"
        meta={`Turn ${y.round} of 13`}
        onRules={onOpenRules}
        onLeave={onLeave}
        enabled={enabled}
        setEnabled={setEnabled}
        turnSoundEnabled={turnSoundEnabled}
        setTurnSoundEnabled={setTurnSoundEnabled}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(18px,3vw,40px)', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 480px' }}>
          <div className="card card-resting">
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <span className="chip" style={{ background: activeSeat?.color }}>
                  {isMyTurn ? 'Your throw' : `${activeSeat?.name}'s throw`}
                </span>
                <div style={{ fontSize: 'clamp(22px,3.2vw,30px)', fontWeight: 700, marginTop: 10 }}>
                  {isMyTurn ? y.status : `${activeSeat?.name} is thinking…`}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted-text)', marginBottom: 6 }}>Rolls left</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      style={{
                        width: 22, height: 22, borderRadius: '50%',
                        background: i < y.rollsLeft ? 'var(--yellow)' : 'var(--grey-fill)',
                        border: '2px solid var(--ink)',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {rejectionText && (
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--coral)', marginTop: 12 }}>
                {rejectionText}
              </div>
            )}

            {y.dice.length === 0 && y.lastTurn !== null && (
              <div style={{
                marginTop: 16, padding: '10px 16px', background: 'var(--surface-alt)', borderRadius: 12,
                fontSize: 14, fontWeight: 500, border: '3px solid var(--grey-fill)',
              }}>
                <span style={{ color: y.lastTurn.color, fontWeight: 700 }}>{y.lastTurn.name}</span>
                {' scored '}
                <strong>{y.lastTurn.points}</strong>
                {' on '}
                <strong>{Y_LABEL[y.lastTurn.category]}</strong>.
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: y.dice.length === 0 && y.lastTurn !== null ? 12 : 24, minHeight: 96 }}>
              {y.dice.length === 0 && <span style={{ color: 'var(--faint-text)', alignSelf: 'center' }}>No dice rolled yet.</span>}
              {y.dice.length > 0 && (() => {
                const displayMap = new Map(y.dice.map((d, i) => [d.id, displayVals[i] ?? d.val]))
                const byId = new Map(y.dice.map((d) => [d.id, d]))
                return (
                  <>
                    {diceOrder.ids.map((id, i) => {
                      const d = byId.get(id)!
                      return (
                        <Fragment key={id}>
                          {i === diceOrder.heldCount && diceOrder.heldCount > 0 && (
                            <div style={{ width: 3, background: 'var(--grey-fill)', borderRadius: 2, alignSelf: 'stretch', margin: '6px 4px' }} />
                          )}
                          <Die
                            value={displayMap.get(d.id) ?? d.val}
                            selected={d.sel}
                            rotation={d.rot}
                            onClick={isMyTurn ? () => onToggleHold(d.id) : undefined}
                          />
                        </Fragment>
                      )
                    })}
                  </>
                )
              })()}
            </div>
            {y.dice.length > 0 && (
              <p style={{ fontSize: 14, color: 'var(--muted-text)', marginTop: 12 }}>
                {y.rollsLeft > 0 ? 'Tap a die to hold it for the next roll.' : 'No rolls left — pick a box on the card.'}
              </p>
            )}
          </div>

          <button type="button" className="btn btn-teal btn-lg" style={{ marginTop: 18 }} disabled={!canRoll} onClick={onRoll}>
            {rollLabel}
          </button>
        </div>

        <div style={{ flex: room.seats.length <= 4 ? '1 1 360px' : '1 1 100%' }}>
          <div style={{ width: 'fit-content', maxWidth: '100%', background: '#fff', border: '4px solid var(--ink)', borderRadius: 24, boxShadow: '0 9px 0 var(--grey-border)', padding: '14px 16px', overflowX: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: `minmax(160px, 260px) repeat(${room.seats.length}, 74px)`, gap: 6, alignItems: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Scorecard</div>
              {room.seats.map((s) => {
                const isActive = s.id === activeSeat?.id
                return (
                  <div
                    key={s.id}
                    style={{
                      textAlign: 'center', fontWeight: 700, fontSize: 13, borderRadius: 8, padding: '4px 2px',
                      color: isActive ? '#fff' : s.color,
                      background: isActive ? s.color : 'transparent',
                    }}
                  >
                    {s.name}
                  </div>
                )
              })}

              {Y_CATEGORIES.map((cat, ci) => (
                <YRow key={cat} cat={cat} room={room} activeSeat={activeSeat} isMyTurn={isMyTurn} vals={vals} onScore={onScore} injectBonus={ci === 6} />
              ))}

              <div style={{ fontSize: 13, color: 'var(--faint-text)' }}>Yahtzee bonus <span style={{ display: 'block', fontSize: 11 }}>+100 each extra</span></div>
              {room.seats.map((s) => {
                const bonus = y.bonuses[s.id] ?? 0
                return (
                  <div key={s.id} style={{ textAlign: 'center', fontSize: 13, fontWeight: 600, color: bonus > 0 ? 'var(--green-text)' : '#c2c2d8' }}>
                    {bonus > 0 ? `+${bonus}` : '·'}
                  </div>
                )
              })}

              <div style={{ fontWeight: 700, fontSize: 15, marginTop: 4 }}>Total</div>
              {room.seats.map((s) => (
                <div key={s.id} style={{ textAlign: 'center', fontWeight: 700, fontSize: 16, color: s.color, marginTop: 4 }}>{s.score}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function YRow({
  cat, room, activeSeat, isMyTurn, vals, onScore, injectBonus,
}: {
  cat: YCategory
  room: RoomState
  activeSeat: RoomState['seats'][number]
  isMyTurn: boolean
  vals: number[]
  onScore: (c: YCategory) => void
  injectBonus: boolean
}) {
  const y = room.yahtzee
  return (
    <>
      {injectBonus && (
        <>
          <div style={{ fontSize: 13, color: 'var(--faint-text)' }}>Upper bonus <span style={{ display: 'block', fontSize: 11 }}>35 at 63 or more</span></div>
          {room.seats.map((s) => {
            const upper = upperTotal(y.cards[s.id] ?? {})
            return (
              <div key={s.id} style={{ textAlign: 'center', fontSize: 13, fontWeight: 600, color: upper >= 63 ? 'var(--green-text)' : 'var(--grey-border)' }}>
                {upper >= 63 ? '35' : `${upper}/63`}
              </div>
            )
          })}
        </>
      )}
      <div>
        <div style={{ fontSize: 15, fontWeight: 500 }}>{Y_LABEL[cat]}</div>
        <div style={{ fontSize: 12, color: 'var(--faint-text)' }}>{Y_SUBLABEL[cat]}</div>
      </div>
      {room.seats.map((s) => {
        const filled = y.cards[s.id]?.[cat]
        if (filled !== undefined) {
          return (
            <div key={s.id} style={{ height: 38, background: 'var(--surface-alt)', color: 'var(--body-text)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>
              {filled}
            </div>
          )
        }
        const live = s.id === activeSeat?.id && isMyTurn && y.dice.length > 0
        if (live) {
          const val = scoreCategory(vals, cat, y.cards[activeSeat.id] ?? {})
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onScore(cat)}
              style={{
                height: 38, borderRadius: 8, border: '3px solid var(--ink)', fontWeight: 700, cursor: 'pointer',
                background: val > 0 ? 'var(--yellow)' : '#fff', boxShadow: '0 3px 0 var(--ink)',
              }}
            >
              {val}
            </button>
          )
        }
        return (
          <div key={s.id} style={{ height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c2c2d8' }}>·</div>
        )
      })}
    </>
  )
}
