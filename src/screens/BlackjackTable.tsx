import { useState, useEffect, useRef } from 'react'
import type { BlackjackPublicState } from '../card-games/blackjack/state'
import { BLACKJACK_MIN_BET, BLACKJACK_MAX_BET } from '../card-games/blackjack/state'
import { currentPlayer } from '../engine/turn-engine'
import { handValue } from '../card-games/blackjack/hand-value'
import { DealIntro } from '../components/DealIntro'
import { BlackjackCard } from '../components/BlackjackCard'
import { CardBack, PlayingCard } from '../components/PlayingCard'
import { Wordmark } from '../components/Wordmark'
import { SoundToggle } from '../components/SoundToggle'
import { BlackjackRulesOverlay } from './BlackjackRulesOverlay'
import { useSound } from '../hooks/useSound'
import './BlackjackTable.css'

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
    myBet: publicState.bets[localPlayerId] ?? 0,
    dealerHoleRevealed: publicState.dealerHoleRevealed,
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
    const myBet = publicState.bets[localPlayerId] ?? 0

    // Deal shuffle sound at start of round
    if (p.phase !== 'betting' && publicState.turn.phase === 'betting') {
      play('shuffle')
    }

    // Local bet placed
    if (p.myBet === 0 && myBet > 0) {
      play('chip-bet')
    }

    // Dealer hole card reveal
    if (!p.dealerHoleRevealed && publicState.dealerHoleRevealed) {
      play('card-flip')
    }

    // Round win/loss sounds, most notable outcome first
    if (p.roundResults === null && publicState.roundResults !== null) {
      const myResults = publicState.roundResults[localPlayerId] ?? []
      const myHands = publicState.hands[localPlayerId] ?? []
      const hasBlackjack = myResults.some((r) => r.result === 'blackjack')
      const hasBust = myResults.some((r) => {
        if (r.result !== 'lose') return false
        const hand = myHands[r.handIndex]
        return hand ? handValue(hand.cards).total > 21 : false
      })
      const hasWin = myResults.some((r) => r.result === 'win')
      const hasLoss = myResults.some((r) => r.result === 'lose')

      if (hasBlackjack) {
        play('blackjack')
      } else if (hasWin) {
        play('chip-win')
      } else if (hasBust) {
        play('bust')
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
      myBet,
      dealerHoleRevealed: publicState.dealerHoleRevealed,
    }
  }, [publicState.turn.phase, publicState.roundResults, publicState.bets, publicState.dealerHoleRevealed, publicState.hands, notice, play, localPlayerId])

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
    <div className="blackjack-table">
      {/* Header */}
      <div className="blackjack-header">
        <div className="blackjack-header-left">
          <Wordmark small onClick={onLeaveTable} />
          <span className="blackjack-game-label">Blackjack</span>
          <span className="blackjack-peer-strip">
            <span
              className="blackjack-peer-dot"
              style={{ background: connection === 'connected' ? 'var(--green)' : 'var(--coral)' }}
            />
            <span className="blackjack-peer-label">
              {connection === 'connected' ? `peer to peer · ${publicState.seatOrder.length} players` : 'connection lost'}
            </span>
          </span>
        </div>
        <div className="blackjack-header-actions">
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
        <div className="blackjack-error-banner">{notice}</div>
      )}

      {/* Main table card */}
      <div className="blackjack-table-card">
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
            {/* Opponent tiles: a wrapping grid, one tile per opponent seat */}
            <div className="blackjack-opp-rail">
              {publicState.seatOrder.filter((id) => id !== localPlayerId).map((seatId) => {
                const seatColor = colors[seatId] ?? 'var(--slate-pip)'
                const seatName = names[seatId] ?? seatId
                const seatHands = publicState.hands[seatId] ?? []
                const isTurn = seatId === currentPlayer(publicState.turn) && publicState.turn.phase === 'acting'
                const seatBet = publicState.bets[seatId] ?? 0
                const isSittingOut = publicState.sittingOut[seatId]
                const seatChips = publicState.chips[seatId] ?? 0

                return (
                  <div
                    key={seatId}
                    className={`blackjack-opp-tile${isTurn ? ' blackjack-opp-tile--turn' : ''}`}
                    style={isTurn ? { borderColor: seatColor } : undefined}
                  >
                    {/* Tile header: identity left, chip badge right -- uses the tile's
                        full width instead of stacking chips/bet as separate lines */}
                    <div className="blackjack-opp-tile-top">
                      <div className="blackjack-opp-identity">
                        <span className="blackjack-seat-dot" style={{ background: seatColor }} />
                        <span className="blackjack-opp-name" style={{ color: seatColor }}>{seatName}</span>
                        {isTurn && <span className="blackjack-turn-tag" style={{ background: seatColor, color: '#fff' }}>turn</span>}
                      </div>
                      <div className="blackjack-opp-chip-badge">
                        <span className="blackjack-opp-chip-value">{seatChips}</span>
                        {!isSittingOut && seatBet > 0 && (
                          <span className="blackjack-opp-bet-value">Bet {seatBet}</span>
                        )}
                        {isSittingOut && (
                          <span className="blackjack-opp-bet-value">Sitting out</span>
                        )}
                      </div>
                    </div>

                    {/* Hands */}
                    <div className="blackjack-opp-hands">
                      {seatHands.map((hand, handIdx) => (
                        <div key={hand.id} className="blackjack-opp-hand">
                          {/* Split hand separator */}
                          {handIdx > 0 && <div className="blackjack-opp-hand-separator" />}

                          {/* Cards at meld size */}
                          <div className="blackjack-opp-cards">
                            {hand.cards.map((card, i) => (
                              <PlayingCard
                                key={i}
                                rank={card.rank as any}
                                suit={card.suit as any}
                                size="meld"
                                style={{ marginLeft: i === 0 ? 0 : -8 }}
                              />
                            ))}
                          </div>

                          {/* Total */}
                          <div className="blackjack-opp-total">
                            Total: {handValue(hand.cards).total}
                          </div>

                          {/* Result badge */}
                          {publicState.roundResults && publicState.roundResults[seatId] && (
                            <div className={`blackjack-opp-result blackjack-opp-result--${hand.result}`}>
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

            {/* Centre band: dealer */}
            <div className="blackjack-centre">
              {/* Shoe: decorative only -- not clickable, no gameplay action draws from it directly */}
              <div className="blackjack-shoe-group">
                <div className="blackjack-shoe-caption">shoe {publicState.shoeCount}</div>
                <CardBack size="stock" design={publicState.cardBack} />
              </div>

              <div className="blackjack-dealer-group">
                <div className="blackjack-dealer-label">Dealer</div>
                <div className="blackjack-dealer-cards">
                  {publicState.dealerHand.map((card, i) => (
                    <div key={i} className="blackjack-dealer-card-wrapper">
                      <BlackjackCard
                        rank={card.rank as any}
                        suit={card.suit as any}
                        faceUp={i === 0 || publicState.dealerHoleRevealed}
                        design={publicState.cardBack}
                      />
                      {i === 0 && !publicState.dealerHoleRevealed && (
                        <div className="blackjack-dealer-hole-indicator">?</div>
                      )}
                    </div>
                  ))}
                </div>
                {publicState.dealerHoleRevealed && (
                  <div className="blackjack-dealer-total">
                    Total: {handValue(publicState.dealerHand).total}
                  </div>
                )}
              </div>
            </div>

            {/* Your side: local player's area. Two columns on wide viewports --
                hand on the left, chip bank + controls on the right, so the
                controls sit beside the cards instead of forcing a long
                scroll below them. */}
            <div className="blackjack-your-side">
              {/* Your hands */}
              <div className="blackjack-your-hands">
                {myHands.map((hand, handIdx) => (
                  <div key={hand.id} className="blackjack-your-hand">
                    {handIdx > 0 && <div className="blackjack-your-hand-separator" />}

                    <div className="blackjack-your-cards">
                      {hand.cards.map((card, i) => (
                        <BlackjackCard
                          key={i}
                          rank={card.rank as any}
                          suit={card.suit as any}
                          faceUp={true}
                          design={publicState.cardBack}
                        />
                      ))}
                    </div>

                    <div className="blackjack-your-total">
                      Total: {handValue(hand.cards).total}
                    </div>

                    {publicState.roundResults && publicState.roundResults[localPlayerId] && (
                      <div className={`blackjack-your-result blackjack-your-result--${hand.result}`}>
                        {hand.result === 'blackjack' && 'Blackjack!'}
                        {hand.result === 'win' && 'Win'}
                        {hand.result === 'lose' && 'Lose'}
                        {hand.result === 'push' && 'Push'}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Chip bank + action controls column */}
              <div className="blackjack-your-controls">
              <div className="blackjack-chip-bank">
                <div className="blackjack-chip-bank-label">Chips</div>
                <div className="blackjack-chip-bank-value">{myChips}</div>
              </div>

              {/* Action area */}
              {bettingPhase && !sittingOut && !hasBet && (
                <div className="blackjack-action-section">
                  <div className="blackjack-action-label">Place your bet</div>
                  <div className="blackjack-bet-controls">
                    <button
                      type="button"
                      className="blackjack-bet-button"
                      onClick={() => setBetAmount(Math.max(BLACKJACK_MIN_BET, betAmount - 10))}
                    >
                      −
                    </button>
                    <div className="blackjack-bet-amount">
                      ${betAmount}
                    </div>
                    <button
                      type="button"
                      className="blackjack-bet-button"
                      onClick={() => setBetAmount(Math.min(BLACKJACK_MAX_BET, myChips, betAmount + 10))}
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
                <div className="blackjack-action-section">
                  Bet placed: ${publicState.bets[localPlayerId]} — waiting on others
                </div>
              )}

              {insurancePhase && publicState.dealerHand[0]?.rank === 'A' && !publicState.hasResolvedInsurance[localPlayerId] && (
                <div className="blackjack-action-section">
                  <div className="blackjack-action-label">Dealer shows an Ace</div>
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
                <div className="blackjack-action-section">
                  Waiting for {names[currentPlayer(publicState.turn)] ?? 'a player'}…
                </div>
              )}

              {publicState.turn.phase === 'dealerPlay' && (
                <div className="blackjack-action-section">
                  Dealer is playing…
                </div>
              )}

              {isMyTurn && publicState.turn.phase === 'acting' && currentHand && (
                <div className="blackjack-action-section">
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
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
                </div>
              )}

              {/* Round-over banner */}
              {roundOverPhase && publicState.roundResults && publicState.roundResults[localPlayerId] && (
                <div className="blackjack-action-section">
                  <div className="blackjack-round-results">
                    {publicState.roundResults[localPlayerId].map((result, i) => {
                      const hand = publicState.hands[localPlayerId]?.[result.handIndex]
                      const net = result.chipDelta - (hand?.bet ?? 0)
                      const netStr = net > 0 ? `+${net}` : `${net}`
                      const resultStr = result.result === 'blackjack' ? 'Blackjack!' : result.result === 'win' ? 'Win' : result.result === 'lose' ? 'Lose' : 'Push'
                      const youStr = publicState.hands[localPlayerId]!.length > 1 ? ` (hand ${i + 1})` : ''

                      return (
                        <div key={i}>
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
              </div>
            </div>
          </>
        )}
      </div>

      {rulesOpen && <BlackjackRulesOverlay onClose={() => setRulesOpen(false)} />}
    </div>
  )
}
