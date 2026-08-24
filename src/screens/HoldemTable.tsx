import { useState, useEffect, useRef } from 'react'
import type { HoldemPublicState, HoldemPrivateState } from '../card-games/holdem/state'
import { HOLDEM_BIG_BLIND } from '../card-games/holdem/state'
import { currentPlayer } from '../engine/turn-engine'
import { DealIntro } from '../components/DealIntro'
import { HoldemBoard } from '../components/HoldemBoard'
import { PlayingCard, CardBack } from '../components/PlayingCard'
import { Wordmark } from '../components/Wordmark'
import { SoundToggle } from '../components/SoundToggle'
import { HoldemRulesOverlay } from './HoldemRulesOverlay'
import { useSound } from '../hooks/useSound'
import './HoldemTable.css'

export interface HoldemTableProps {
  code: string
  localPlayerId: string
  names: Record<string, string>
  colors: Record<string, string>
  connection: 'connected' | 'disconnected'
  notice?: string | null
  publicState: HoldemPublicState
  privateState: HoldemPrivateState
  onFold: () => void
  onCheck: () => void
  onCall: () => void
  onBet: (amount: number) => void
  onRaise: (amount: number) => void
  onStartNextHand: () => void
  onLeaveTable: () => void
}

export function HoldemTable({
  code,
  localPlayerId,
  names,
  colors,
  connection,
  notice,
  publicState,
  privateState,
  onFold,
  onCheck,
  onCall,
  onBet,
  onRaise,
  onStartNextHand,
  onLeaveTable,
}: HoldemTableProps) {
  const { play, enabled, setEnabled } = useSound()
  const [rulesOpen, setRulesOpen] = useState(false)
  const [showIntro, setShowIntro] = useState(false)
  const [betAmount, setBetAmount] = useState(HOLDEM_BIG_BLIND * 2)

  const introShownForHandRef = useRef<number | null>(null)
  const prevPhaseRef = useRef<string>(publicState.turn.phase)
  const noticeSeenRef = useRef(!!notice)
  const soundSigRef = useRef({
    phase: publicState.turn.phase,
    handOver: publicState.handOver,
    handResults: publicState.handResults,
    myBetThisStreet: publicState.hands[localPlayerId]?.betThisStreet ?? 0,
    myFolded: publicState.hands[localPlayerId]?.folded ?? false,
  })

  // Show deal intro when transitioning from handOver to preflop
  useEffect(() => {
    const wasInHandOver = prevPhaseRef.current === 'handOver'
    const nowInPreflop = publicState.turn.phase === 'preflop'

    if (wasInHandOver && nowInPreflop) {
      if (introShownForHandRef.current !== publicState.handNumber) {
        introShownForHandRef.current = publicState.handNumber
        setShowIntro(true)
      }
    }

    prevPhaseRef.current = publicState.turn.phase
  }, [publicState.turn.phase, publicState.handNumber])

  // Sound effects
  useEffect(() => {
    const p = soundSigRef.current
    const myHand = publicState.hands[localPlayerId]
    const myBetThisStreet = myHand?.betThisStreet ?? 0
    const myFolded = myHand?.folded ?? false

    // Shuffle sound at start of new hand (when transitioning into preflop)
    if (p.phase !== 'preflop' && publicState.turn.phase === 'preflop') {
      play('shuffle')
    }

    // Card-draw sound when board cards are dealt (flop, turn, river)
    if (
      (p.phase === 'preflop' && publicState.turn.phase === 'flop') ||
      (p.phase === 'flop' && publicState.turn.phase === 'turn') ||
      (p.phase === 'turn' && publicState.turn.phase === 'river')
    ) {
      play('card-draw')
    }

    // Local player commits chips (bet/call/raise) -- only the local player's
    // own action, never a bot's, matching this codebase's "don't spam sound
    // for opponent turns" convention (see Rummy's own sound-effect comment).
    // Going all-in gets the bigger, more dramatic cue instead of the plain
    // chip sound.
    if (myBetThisStreet > p.myBetThisStreet) {
      play(myHand?.allIn ? 'all-in' : 'chip-bet')
    }

    // Local player folds
    if (!p.myFolded && myFolded) {
      play('fold')
    }

    // Showdown reveal: a genuine showdown (not a fold-out win) reveals real
    // cards for every contesting seat -- detect via any non-local, non-folded
    // seat's public cards becoming populated at the same moment the hand ends.
    if (!p.handOver && publicState.handOver) {
      const hadRealShowdown = publicState.seatOrder.some((id) =>
        id !== localPlayerId && !publicState.hands[id]?.folded && (publicState.hands[id]?.cards.length ?? 0) > 0,
      )
      if (hadRealShowdown) {
        play('card-flip')
      }
    }

    // Hand-over win/loss sounds
    if (!p.handOver && publicState.handOver && publicState.handResults) {
      const myResults = publicState.handResults.winners.find((w) => w.playerId === localPlayerId)
      if (myResults) {
        play('chip-win')
      } else {
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
      handOver: publicState.handOver,
      handResults: publicState.handResults,
      myBetThisStreet,
      myFolded,
    }
  }, [publicState.turn.phase, publicState.handOver, publicState.handResults, publicState.hands, publicState.seatOrder, localPlayerId, notice, play])

  // Derived state
  const isMyTurn = currentPlayer(publicState.turn) === localPlayerId
  const myChips = publicState.chips[localPlayerId] ?? 0
  const myBetThisStreet = publicState.hands[localPlayerId]?.betThisStreet ?? 0
  const currentPhase = publicState.turn.phase
  const isActionPhase = ['preflop', 'flop', 'turn', 'river'].includes(currentPhase)
  const canAct = isMyTurn && isActionPhase && !publicState.handOver

  // Button gating conditions based on rules.ts validators
  const callAmount = Math.min(publicState.currentBetThisStreet - myBetThisStreet, myChips)
  const canCall = canAct && callAmount > 0
  const canCheck = canAct && publicState.currentBetThisStreet <= myBetThisStreet
  const canFold = canAct
  const canBet = canAct && publicState.currentBetThisStreet === 0 && myChips > 0
  const canRaise = canAct && publicState.currentBetThisStreet > 0 && publicState.reRaiseEligible[localPlayerId] && myChips > 0

  // Compute min/max for bet/raise slider
  let minBetAmount = 1
  let maxBetAmount = myChips

  if (canBet) {
    // Betting: min = 1, max = myChips
    minBetAmount = 1
    maxBetAmount = myChips
  } else if (canRaise) {
    // Raising: min = currentBet + minRaise, max = myChips + myBetThisStreet (max possible bet-to)
    const minRaise = Math.max(publicState.lastFullRaiseIncrement, HOLDEM_BIG_BLIND)
    minBetAmount = publicState.currentBetThisStreet + minRaise
    maxBetAmount = myChips + myBetThisStreet
    // If min exceeds max (short all-in scenario), allow short all-in: clamp min to max
    if (minBetAmount > maxBetAmount) {
      minBetAmount = maxBetAmount
    }
  }

  // Clamp betAmount to valid range
  const clampedBetAmount = Math.min(Math.max(betAmount, minBetAmount), maxBetAmount)

  // Quick preset buttons
  const halfPotPreset = Math.floor(publicState.pot / 2)
  const potPreset = publicState.pot
  const allInPreset = myChips + myBetThisStreet

  const quickPresets = [
    { label: '½ pot', value: Math.min(Math.max(halfPotPreset, minBetAmount), maxBetAmount) },
    { label: 'Pot', value: Math.min(Math.max(potPreset, minBetAmount), maxBetAmount) },
    { label: 'All in', value: allInPreset },
  ]

  // Opponent data for DealIntro
  const others = publicState.seatOrder
    .filter((id) => id !== localPlayerId && !publicState.eliminated[id])
    .map((id) => ({
      id,
      name: names[id] ?? id,
      color: colors[id] ?? 'var(--slate-pip)',
      handSize: publicState.hands[id]?.folded ? 0 : 2,
    }))

  return (
    <div className="holdem-table">
      {/* Header */}
      <div className="holdem-header">
        <div className="holdem-header-left">
          <Wordmark small onClick={onLeaveTable} />
          <span className="holdem-game-label">Texas Hold'em</span>
          <span className="holdem-peer-strip">
            <span
              className="holdem-peer-dot"
              style={{ background: connection === 'connected' ? 'var(--green)' : 'var(--coral)' }}
            />
            <span className="holdem-peer-label">
              {connection === 'connected' ? `peer to peer · ${publicState.seatOrder.length} players` : 'connection lost'}
            </span>
          </span>
        </div>
        <div className="holdem-header-actions">
          <SoundToggle enabled={enabled} onToggle={() => setEnabled(!enabled)} />
          <button type="button" className="btn pill-small" onClick={() => setRulesOpen(true)}>Rules</button>
          <button type="button" className="btn btn-ghost" onClick={onLeaveTable}>Leave</button>
        </div>
      </div>

      {/* Code chip */}
      <div style={{ marginBottom: 'clamp(16px, 2.4vw, 26px)' }}>
        <span className="chip" style={{ background: 'var(--yellow)', color: 'var(--ink)' }}>Hold'em · {code}</span>
      </div>

      {/* Error banner */}
      {notice && (
        <div className="holdem-error-banner">{notice}</div>
      )}

      {/* Main table card */}
      <div className="holdem-table-card">
        {showIntro ? (
          <DealIntro
            others={others}
            yourHandSize={privateState.hand.length}
            renderCardBack={(p) => <CardBack {...p} design={publicState.cardBack} />}
            onComplete={() => setShowIntro(false)}
            maxFlights={publicState.seatOrder.length * 2}
          />
        ) : (
          <>
            {/* Opponent tiles: a wrapping grid, one tile per opponent seat */}
            <div className="holdem-opp-rail">
              {publicState.seatOrder.filter((id) => id !== localPlayerId).map((seatId) => {
                const seatColor = colors[seatId] ?? 'var(--slate-pip)'
                const seatName = names[seatId] ?? seatId
                const seatHand = publicState.hands[seatId]
                const isTurn = seatId === currentPlayer(publicState.turn) && isActionPhase
                const seatChips = publicState.chips[seatId] ?? 0
                const isFolded = seatHand.folded
                const isAllIn = seatHand.allIn
                const isEliminated = publicState.eliminated[seatId]

                return (
                  <div
                    key={seatId}
                    className={`holdem-opp-tile${isTurn ? ' holdem-opp-tile--turn' : ''}`}
                    style={isTurn ? { borderColor: seatColor } : undefined}
                  >
                    {/* Tile header: identity left, chip badge right -- uses the
                        tile's full width instead of stacking chips/bet as
                        separate lines below the name. */}
                    <div className="holdem-opp-tile-top">
                      <div className="holdem-opp-identity">
                        <span className="holdem-seat-dot" style={{ background: seatColor }} />
                        <span className="holdem-opp-name" style={{ color: seatColor }}>{seatName}</span>
                        {isTurn && <span className="holdem-turn-tag" style={{ background: seatColor, color: '#fff' }}>turn</span>}
                      </div>
                      <div className="holdem-opp-chip-badge">
                        <span className="holdem-opp-chip-value">{seatChips}</span>
                        {seatHand.betThisStreet > 0 && (
                          <span className="holdem-opp-bet-value">Bet {seatHand.betThisStreet}</span>
                        )}
                      </div>
                    </div>

                    {/* Status badges */}
                    <div className="holdem-opp-badges">
                      {isFolded && <span className="chip" style={{ background: '#ddd', color: 'var(--muted-text)', fontSize: 12 }}>Folded</span>}
                      {isAllIn && !isFolded && <span className="chip" style={{ background: 'var(--yellow)', color: 'var(--ink)', fontSize: 12 }}>All in</span>}
                      {isEliminated && <span className="chip" style={{ background: '#ddd', color: 'var(--muted-text)', fontSize: 12 }}>Out</span>}
                    </div>

                    {/* Opacity state for folded/eliminated */}
                    <div className="holdem-opp-cards" style={{ opacity: isFolded || isEliminated ? 0.6 : 1 }}>
                      {seatHand.cards.length > 0 ? (
                        // Showdown reveal - show real cards at meld size
                        seatHand.cards.map((card, i) => (
                          <PlayingCard
                            key={i}
                            rank={card.rank as any}
                            suit={card.suit as any}
                            size="meld"
                            style={{ marginLeft: i === 0 ? 0 : -8 }}
                          />
                        ))
                      ) : (
                        // Face-down cards at fan size
                        <>
                          <CardBack design={publicState.cardBack} size="fan" style={{ marginLeft: 0 }} />
                          <CardBack design={publicState.cardBack} size="fan" style={{ marginLeft: -15 }} />
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Centre band: deck + board + pot */}
            <div className="holdem-centre">
              <div className="holdem-deck-board-row">
                {/* Decorative deck -- not clickable, no gameplay action draws from it directly */}
                <div className="holdem-deck-group">
                  <div className="holdem-deck-caption">deck</div>
                  <CardBack size="stock" design={publicState.cardBack} />
                </div>

                <div className="holdem-board-group">
                  <HoldemBoard cards={publicState.board} />
                </div>
              </div>
              <div className="holdem-pot">
                Pot: {publicState.pot}
              </div>
            </div>

            {/* Your side: local player area. Two columns on wide viewports --
                hole cards on the left, chip bank + controls on the right, so
                the controls sit beside the cards instead of forcing a long
                scroll below them. */}
            <div className="holdem-your-side">
              {/* Your hole cards */}
              <div className="holdem-your-hand-col">
                {privateState.hand.length > 0 && (
                  <div className="holdem-your-cards">
                    {privateState.hand.map((card, i) => (
                      <PlayingCard
                        key={i}
                        rank={card.rank as any}
                        suit={card.suit as any}
                        size="hand"
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Chip bank + action controls column */}
              <div className="holdem-your-controls">
              <div className="holdem-chip-bank">
                <div className="holdem-chip-bank-label">Chips</div>
                <div className="holdem-chip-bank-value">{myChips}</div>
              </div>

              {/* Action area - fold/check/call/bet-raise */}
              {canAct && (
                <div className="holdem-action-section">
                  {/* Fold/Check/Call row */}
                  <div className="holdem-action-buttons">
                    <button
                      type="button"
                      className="btn btn-lg"
                      onClick={onFold}
                      disabled={!canFold}
                    >
                      Fold
                    </button>
                    {canCheck && (
                      <button
                        type="button"
                        className="btn btn-lg"
                        onClick={onCheck}
                      >
                        Check
                      </button>
                    )}
                    {canCall && (
                      <button
                        type="button"
                        className="btn btn-lg"
                        onClick={onCall}
                      >
                        Call {callAmount}
                      </button>
                    )}
                  </div>

                  {/* Bet/Raise section */}
                  {(canBet || canRaise) && (
                    <div className="holdem-bet-section">
                      <div className="holdem-bet-label">
                        {canBet ? 'Place your bet' : 'Raise to'}
                      </div>
                      <div className="holdem-bet-slider-group">
                        <input
                          type="range"
                          min={minBetAmount}
                          max={maxBetAmount}
                          step={1}
                          value={clampedBetAmount}
                          onChange={(e) => setBetAmount(Number(e.target.value))}
                          className="holdem-bet-slider"
                        />
                        <div className="holdem-bet-display">
                          {clampedBetAmount}
                        </div>
                      </div>
                      <div className="holdem-preset-buttons">
                        {quickPresets.map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            className="btn btn-lg"
                            onClick={() => setBetAmount(preset.value)}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="btn btn-coral btn-lg"
                        onClick={() => canBet ? onBet(clampedBetAmount) : onRaise(clampedBetAmount)}
                      >
                        {canBet ? `Bet ${clampedBetAmount}` : `Raise to ${clampedBetAmount}`}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Waiting status */}
              {isMyTurn && !canAct && !publicState.handOver && (
                <div className="holdem-action-section">
                  Game in progress…
                </div>
              )}

              {!isMyTurn && isActionPhase && !publicState.handOver && (
                <div className="holdem-action-section">
                  Waiting for {names[currentPlayer(publicState.turn)] ?? 'a player'}…
                </div>
              )}

              {/* Hand-over banner */}
              {publicState.handOver && publicState.handResults && (
                <div className="holdem-action-section">
                  <div className="holdem-hand-results">
                    {publicState.gameOverWinnerId ? (
                      <div className="holdem-game-over">
                        {publicState.gameOverWinnerId === localPlayerId ? 'You' : names[publicState.gameOverWinnerId] ?? 'Someone'} wins the table!
                      </div>
                    ) : (
                      <div>
                        {publicState.handResults.potBreakdown.map((breakdown, i) => {
                          const winners = breakdown.winnerIds
                          const winnerNames = winners.map((id) => id === localPlayerId ? 'You' : names[id] ?? id)
                          const amountPerWinner = Math.floor(breakdown.amount / winners.length)

                          if (winners.length === 1) {
                            const winnerId = winners[0]
                            const winnerName = winnerId === localPlayerId ? 'You' : names[winnerId] ?? winnerId
                            return (
                              <div key={i}>
                                {winnerName} wins {breakdown.amount}
                              </div>
                            )
                          } else {
                            return (
                              <div key={i}>
                                {winnerNames.join(' and ')} split the pot, {amountPerWinner} each
                              </div>
                            )
                          }
                        })}
                      </div>
                    )}
                  </div>
                  <div className="holdem-action-buttons">
                    {!publicState.gameOverWinnerId && (
                      <button
                        type="button"
                        className="btn btn-lg btn-coral"
                        onClick={onStartNextHand}
                      >
                        Deal next hand
                      </button>
                    )}
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

      {rulesOpen && <HoldemRulesOverlay onClose={() => setRulesOpen(false)} />}
    </div>
  )
}
