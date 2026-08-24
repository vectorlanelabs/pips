import { useState, useEffect, useRef } from 'react'
import type { BlackjackPublicState } from '../card-games/blackjack/state'
import { BLACKJACK_MIN_BET, BLACKJACK_MAX_BET } from '../card-games/blackjack/state'
import { currentPlayer } from '../engine/turn-engine'
import { handValue } from '../card-games/blackjack/hand-value'
import { DealIntro } from '../components/DealIntro'
import { BlackjackCard } from '../components/BlackjackCard'
import { CardBack } from '../components/PlayingCard'
import { Wordmark } from '../components/Wordmark'
import { SoundToggle } from '../components/SoundToggle'
import { BlackjackRulesOverlay } from './BlackjackRulesOverlay'
import { useSound } from '../hooks/useSound'

export interface BlackjackTableProps {
  code: string
  localPlayerId: string
  localName: string
  names: Record<string, string>
  colors: Record<string, string>
  connection: 'connected' | 'disconnected'
  notice?: string | null
  publicState: BlackjackPublicState
  onPlaceBet: (amount: number) => void
  onTakeInsurance: () => void
  onDeclineInsurance: () => void
  onHit: () => void
  onStand: () => void
  onDouble: () => void
  onSplit: () => void
  onStartNextRound: () => void
  onLeaveTable: () => void
}

export function BlackjackTable({
  code,
  localPlayerId,
  names,
  colors,
  connection,
  notice,
  publicState,
  onPlaceBet,
  onTakeInsurance,
  onDeclineInsurance,
  onHit,
  onStand,
  onDouble,
  onSplit,
  onStartNextRound,
  onLeaveTable,
}: BlackjackTableProps) {
  const { play, enabled, setEnabled } = useSound()
  const [betAmount, setBetAmount] = useState(50)
  const [rulesOpen, setRulesOpen] = useState(false)

  const introShownForRoundRef = useRef<number | null>(null)
  const prevPhaseRef = useRef<string>(publicState.turn.phase)
  const [showIntro, setShowIntro] = useState(false)

  const noticeSeenRef = useRef(!!notice)
  const soundSigRef = useRef({
    phase: publicState.turn.phase,
    roundResults: publicState.roundResults,
  })

  // Show deal intro when phase transitions out of 'betting' (when dealing completes)
  useEffect(() => {
    const wasInBetting = prevPhaseRef.current === 'betting'
    const nowNotInBetting = publicState.turn.phase !== 'betting'

    if (wasInBetting && nowNotInBetting) {
      // Phase just transitioned out of betting - this is when the deal completes
      if (introShownForRoundRef.current !== publicState.roundNumber) {
        introShownForRoundRef.current = publicState.roundNumber
        setShowIntro(true)
      }
    }

    prevPhaseRef.current = publicState.turn.phase
  }, [publicState.turn.phase, publicState.roundNumber])

  // Sound effects
  useEffect(() => {
    const p = soundSigRef.current

    // Deal shuffle sound at start of round
    if (p.phase !== 'betting' && publicState.turn.phase === 'betting') {
      play('shuffle')
    }

    // Round win/loss sounds
    if (p.roundResults === null && publicState.roundResults !== null) {
      const myResults = publicState.roundResults[localPlayerId] ?? []
      const hasWin = myResults.some((r) => r.result === 'win' || r.result === 'blackjack')
      const hasLoss = myResults.some((r) => r.result === 'lose')

      if (hasWin) {
        play('round-win')
      } else if (hasLoss) {
        play('error')
      }
    }

    // Error banner
    if (notice && !noticeSeenRef.current) {
      play('error')
      noticeSeenRef.current = true
    } else if (!notice) {
      noticeSeenRef.current = false
    }

    soundSigRef.current = {
      phase: publicState.turn.phase,
      roundResults: publicState.roundResults,
    }
  }, [publicState.turn.phase, publicState.roundResults, notice, play, localPlayerId])

  // Derived state
  const isMyTurn = currentPlayer(publicState.turn) === localPlayerId
  const canAct = isMyTurn && publicState.turn.phase === 'acting'
  const myHands = publicState.hands[localPlayerId] ?? []
  const activeHandIndex = publicState.activeHandIndex[localPlayerId] ?? 0
  const currentHand = myHands[activeHandIndex]
  const myChips = publicState.chips[localPlayerId] ?? 0
  const bettingPhase = publicState.turn.phase === 'betting'
  const insurancePhase = publicState.turn.phase === 'insurance'
  const roundOverPhase = publicState.turn.phase === 'roundOver'

  // Button gating conditions from rules.ts
  const canHit = canAct && currentHand && !currentHand.done
  const canStand = canAct && currentHand && !currentHand.done
  const canDouble = canAct && currentHand && !currentHand.done && currentHand.cards.length === 2
    && !currentHand.doubled && myChips >= currentHand.bet
  const canSplit = canAct && currentHand && !currentHand.done && currentHand.cards.length === 2
    && !currentHand.isSplitHand && currentHand.cards[0].rank === currentHand.cards[1].rank
    && myChips >= currentHand.bet

  // Insurance gating
  const canTakeInsurance = insurancePhase && !publicState.hasResolvedInsurance[localPlayerId]
    && publicState.dealerHand[0]?.rank === 'A'
    && myChips >= Math.floor(publicState.bets[localPlayerId] / 2)
  const canDeclineInsurance = insurancePhase && !publicState.hasResolvedInsurance[localPlayerId]
    && publicState.dealerHand[0]?.rank === 'A'

  // Bet placement
  const hasBet = publicState.bets[localPlayerId] > 0
  const sittingOut = publicState.sittingOut[localPlayerId]
  const canPlaceBet = bettingPhase && !sittingOut && !hasBet && betAmount >= BLACKJACK_MIN_BET
    && betAmount <= BLACKJACK_MAX_BET && betAmount <= myChips

  // Opponent data for DealIntro
  const others = publicState.seatOrder
    .filter((id) => id !== localPlayerId)
    .map((id) => ({
      id,
      name: names[id] ?? id,
      color: colors[id] ?? 'var(--slate-pip)',
      handSize: publicState.hands[id]?.[0]?.cards.length ?? 0,
    }))

  return (
    <div style={{ maxWidth: 1260, margin: '0 auto', padding: 'clamp(28px, 6vw, 48px) clamp(16px, 4vw, 44px) 72px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 'clamp(16px, 2.4vw, 26px)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <Wordmark small onClick={onLeaveTable} />
          <span style={{ fontWeight: 700, fontSize: 22, color: 'var(--coral)' }}>Blackjack</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                display: 'block',
                background: connection === 'connected' ? 'var(--green)' : 'var(--coral)',
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted-text)' }}>
              {connection === 'connected' ? `peer to peer · ${publicState.seatOrder.length} players` : 'connection lost'}
            </span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SoundToggle enabled={enabled} onToggle={() => setEnabled(!enabled)} />
          <button type="button" className="btn pill-small" onClick={() => setRulesOpen(true)}>Rules</button>
          <button type="button" className="btn btn-ghost" onClick={onLeaveTable}>Leave</button>
        </div>
      </div>

      {/* Code chip */}
      <div style={{ marginBottom: 'clamp(16px, 2.4vw, 26px)' }}>
        <span className="chip" style={{ background: 'var(--yellow)', color: 'var(--ink)' }}>Blackjack · {code}</span>
      </div>

      {/* Error banner */}
      {notice && (
        <div style={{
          background: '#fff',
          border: '4px solid var(--coral)',
          borderRadius: 16,
          padding: '12px 16px',
          marginBottom: 'clamp(12px, 2vw, 20px)',
          color: 'var(--coral)',
          fontWeight: 700,
          fontSize: 14,
        }}>
          {notice}
        </div>
      )}

      {/* Main table */}
      <div style={{
        background: 'var(--surface)',
        border: '4px solid var(--ink)',
        borderRadius: 28,
        boxShadow: '0 10px 0 var(--ink)',
        padding: 'clamp(16px, 2.4vw, 26px)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {showIntro ? (
          <DealIntro
            others={others}
            yourHandSize={publicState.hands[localPlayerId]?.[0]?.cards.length ?? 0}
            renderCardBack={(p) => <CardBack {...p} design={publicState.cardBack} />}
            onComplete={() => setShowIntro(false)}
            maxFlights={publicState.seatOrder.length * 2}
          />
        ) : (
          <>
            {/* Dealer area */}
            <div style={{ marginBottom: 'clamp(20px, 3vw, 32px)' }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--body-text)', marginBottom: 8 }}>Dealer</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                {publicState.dealerHand.map((card, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <BlackjackCard
                      rank={card.rank as any}
                      suit={card.suit as any}
                      faceUp={i === 0 || publicState.dealerHoleRevealed}
                      design={publicState.cardBack}
                    />
                    {i === 0 && !publicState.dealerHoleRevealed && (
                      <div style={{ fontSize: 12, color: 'var(--body-text)' }}>?</div>
                    )}
                  </div>
                ))}
              </div>
              {publicState.dealerHoleRevealed && (
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--body-text)', marginTop: 8 }}>
                  Total: {handValue(publicState.dealerHand).total}
                </div>
              )}
            </div>

            {/* Seat rail */}
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'clamp(10px, 1.6vw, 14px)',
              paddingBottom: 'clamp(12px, 2vw, 20px)',
              marginBottom: 'clamp(20px, 3vw, 32px)',
              borderBottom: '2px solid var(--grey-border)',
            }}>
              {publicState.seatOrder.map((seatId) => {
                const seatColor = colors[seatId] ?? 'var(--slate-pip)'
                const seatName = names[seatId] ?? seatId
                const isYou = seatId === localPlayerId
                const seatHands = publicState.hands[seatId] ?? []
                const isTurn = seatId === currentPlayer(publicState.turn) && publicState.turn.phase === 'acting'
                const seatBet = publicState.bets[seatId] ?? 0
                const isSittingOut = publicState.sittingOut[seatId]

                return (
                  <div
                    key={seatId}
                    style={{
                      flex: '1 1 200px',
                      maxWidth: 'calc((100% - 3 * clamp(10px, 1.6vw, 14px)) / 4)',
                      minWidth: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      border: `3px solid ${isTurn ? seatColor : 'var(--grey-border)'}`,
                      borderRadius: 16,
                      padding: '12px 14px',
                      background: '#fff',
                    }}
                  >
                    {/* Seat header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        display: 'block',
                        background: seatColor,
                      }} />
                      <span style={{ fontWeight: 700, fontSize: 15, color: seatColor }}>
                        {seatName}
                      </span>
                      {isYou && <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--muted-text)' }}>(you)</span>}
                      {isTurn && <span style={{ fontWeight: 600, fontSize: 11, background: seatColor, color: '#fff', padding: '2px 8px', borderRadius: 999 }}>turn</span>}
                    </div>

                    {/* Chips and bet info */}
                    <div style={{ fontSize: 13, color: 'var(--body-text)' }}>
                      <div>{publicState.chips[seatId] ?? 0} chips</div>
                      <div>
                        {isSittingOut ? (
                          <span style={{ color: 'var(--muted-text)' }}>Sitting out</span>
                        ) : (
                          <span>Bet: ${seatBet}</span>
                        )}
                      </div>
                    </div>

                    {/* Hands */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {seatHands.map((hand, handIdx) => (
                        <div key={hand.id} style={{
                          paddingTop: handIdx > 0 ? 8 : 0,
                          borderTop: handIdx > 0 ? '1px solid var(--grey-border)' : 'none',
                        }}>
                          <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                            {hand.cards.map((card, i) => (
                              <BlackjackCard
                                key={i}
                                rank={card.rank as any}
                                suit={card.suit as any}
                                faceUp={true}
                                design={publicState.cardBack}
                                style={{ fontSize: 11 }}
                              />
                            ))}
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--body-text)' }}>
                            Total: {handValue(hand.cards).total}
                          </div>
                          {publicState.roundResults && publicState.roundResults[seatId] && (
                            <div style={{
                              fontSize: 11,
                              fontWeight: 600,
                              marginTop: 4,
                              padding: '2px 6px',
                              borderRadius: 6,
                              backgroundColor: hand.result === 'win' || hand.result === 'blackjack' ? '#d4f0e8' : hand.result === 'lose' ? '#ffe8e8' : '#f5f5f5',
                              color: hand.result === 'win' || hand.result === 'blackjack' ? '#0a6b42' : hand.result === 'lose' ? '#a00' : '#666',
                            }}>
                              {hand.result === 'blackjack' && 'Blackjack!'}
                              {hand.result === 'win' && 'Win'}
                              {hand.result === 'lose' && 'Lose'}
                              {hand.result === 'push' && 'Push'}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Action area */}
            {bettingPhase && !sittingOut && !hasBet && (
              <div style={{ marginBottom: 'clamp(16px, 2.4vw, 26px)' }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: 'var(--body-text)' }}>Place your bet</div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => setBetAmount(Math.max(BLACKJACK_MIN_BET, betAmount - 10))}
                    style={{
                      width: 40,
                      height: 40,
                      border: '3px solid var(--ink)',
                      borderRadius: 8,
                      background: '#fff',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    −
                  </button>
                  <div style={{ fontWeight: 700, fontSize: 18, minWidth: 60, textAlign: 'center' }}>
                    ${betAmount}
                  </div>
                  <button
                    type="button"
                    onClick={() => setBetAmount(Math.min(BLACKJACK_MAX_BET, myChips, betAmount + 10))}
                    style={{
                      width: 40,
                      height: 40,
                      border: '3px solid var(--ink)',
                      borderRadius: 8,
                      background: '#fff',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="btn btn-coral"
                    onClick={() => onPlaceBet(betAmount)}
                    disabled={!canPlaceBet}
                  >
                    Place bet
                  </button>
                </div>
              </div>
            )}

            {bettingPhase && hasBet && (
              <div style={{ marginBottom: 'clamp(16px, 2.4vw, 26px)', fontSize: 14, color: 'var(--body-text)' }}>
                Bet placed: ${publicState.bets[localPlayerId]} — waiting on others
              </div>
            )}

            {insurancePhase && publicState.dealerHand[0]?.rank === 'A' && !publicState.hasResolvedInsurance[localPlayerId] && (
              <div style={{ marginBottom: 'clamp(16px, 2.4vw, 26px)' }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: 'var(--body-text)' }}>
                  Dealer shows an Ace
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    className="btn btn-lg"
                    onClick={onTakeInsurance}
                    disabled={!canTakeInsurance}
                  >
                    Insurance (${Math.floor(publicState.bets[localPlayerId] / 2)})
                  </button>
                  <button
                    type="button"
                    className="btn btn-lg btn-ghost"
                    onClick={onDeclineInsurance}
                    disabled={!canDeclineInsurance}
                  >
                    No insurance
                  </button>
                </div>
              </div>
            )}

            {publicState.turn.phase === 'acting' && !isMyTurn && (
              <div style={{ marginBottom: 'clamp(16px, 2.4vw, 26px)', fontSize: 14, color: 'var(--body-text)' }}>
                Waiting for {names[currentPlayer(publicState.turn)] ?? 'a player'}…
              </div>
            )}

            {publicState.turn.phase === 'dealerPlay' && (
              <div style={{ marginBottom: 'clamp(16px, 2.4vw, 26px)', fontSize: 14, color: 'var(--body-text)' }}>
                Dealer is playing…
              </div>
            )}

            {isMyTurn && publicState.turn.phase === 'acting' && currentHand && (
              <div style={{ marginBottom: 'clamp(16px, 2.4vw, 26px)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-lg"
                  onClick={onHit}
                  disabled={!canHit}
                >
                  Hit
                </button>
                <button
                  type="button"
                  className="btn btn-lg"
                  onClick={onStand}
                  disabled={!canStand}
                >
                  Stand
                </button>
                <button
                  type="button"
                  className="btn btn-lg"
                  onClick={onDouble}
                  disabled={!canDouble}
                  title={!canDouble ? 'Can only double on 2 cards with enough chips' : ''}
                >
                  Double
                </button>
                <button
                  type="button"
                  className="btn btn-lg"
                  onClick={onSplit}
                  disabled={!canSplit}
                  title={!canSplit ? 'Can only split matching ranks with enough chips' : ''}
                >
                  Split
                </button>
              </div>
            )}

            {/* Round-over banner */}
            {roundOverPhase && publicState.roundResults && publicState.roundResults[localPlayerId] && (
              <div style={{ marginBottom: 'clamp(16px, 2.4vw, 26px)' }}>
                <div style={{
                  background: '#f5f5f5',
                  border: '2px solid var(--grey-border)',
                  borderRadius: 12,
                  padding: '14px 16px',
                  marginBottom: 12,
                }}>
                  {publicState.roundResults[localPlayerId].map((result, i) => {
                    // chipDelta is credit applied ON TOP OF the already-escrowed bet
                    // (see rules.ts settleRound) — subtract the bet back out to get
                    // this hand's true net change for the round (e.g. a push shows 0,
                    // a plain win shows +bet, not the raw post-escrow credit).
                    const hand = publicState.hands[localPlayerId]?.[result.handIndex]
                    const net = result.chipDelta - (hand?.bet ?? 0)
                    const netStr = net > 0 ? `+${net}` : `${net}`
                    const resultStr = result.result === 'blackjack' ? 'Blackjack!' : result.result === 'win' ? 'Win' : result.result === 'lose' ? 'Lose' : 'Push'
                    const youStr = publicState.hands[localPlayerId]!.length > 1 ? ` (hand ${i + 1})` : ''

                    return (
                      <div key={i} style={{ fontSize: 14, color: 'var(--body-text)' }}>
                        You {resultStr === 'Push' ? resultStr : resultStr.toLowerCase()}{youStr} {netStr}
                      </div>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-lg btn-coral"
                    onClick={onStartNextRound}
                  >
                    Deal next round
                  </button>
                  <button
                    type="button"
                    className="btn btn-lg"
                    onClick={onLeaveTable}
                  >
                    Leave table
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {rulesOpen && <BlackjackRulesOverlay onClose={() => setRulesOpen(false)} />}
    </div>
  )
}
