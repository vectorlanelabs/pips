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
  // Every hand stages the same three beats before the table becomes
  // interactive: blinds post (paced, one seat at a time -- a forced action
  // is still a turn a human at that seat would watch happen), then the
  // shuffle+deal intro, then the real table. Keyed off handNumber (not a
  // phase-transition edge) so hand #1 gets the same staging as every hand
  // after it -- the old edge-detector only fired on handOver -> preflop,
  // which never happens for the very first hand.
  const [uiPhase, setUiPhase] = useState<'blinds' | 'deal' | 'table'>('blinds')
  const [blindStage, setBlindStage] = useState<'sb' | 'bb'>('sb')
  const [betAmount, setBetAmount] = useState(HOLDEM_BIG_BLIND * 2)
  const [raiseSizingOpen, setRaiseSizingOpen] = useState(false)

  const stagedForHandRef = useRef<number | null>(null)
  const noticeSeenRef = useRef(!!notice)
  const soundSigRef = useRef({
    phase: publicState.turn.phase,
    handOver: publicState.handOver,
    handResults: publicState.handResults,
    myBetThisStreet: publicState.hands[localPlayerId]?.betThisStreet ?? 0,
    myFolded: publicState.hands[localPlayerId]?.folded ?? false,
    revealedOpponentCount: 0,
    handResultsVisible: false,
  })

  // 900ms per blind matches BASE_MS, the app's standard single-action bot
  // pacing gap (App.tsx) -- long enough to actually read, short enough not
  // to drag out a forced, non-interactive beat.
  const BLIND_POST_REVEAL_MS = 900

  useEffect(() => {
    if (stagedForHandRef.current === publicState.handNumber) return
    stagedForHandRef.current = publicState.handNumber
    setBlindStage('sb')
    setUiPhase('blinds')
    const t1 = window.setTimeout(() => setBlindStage('bb'), BLIND_POST_REVEAL_MS)
    const t2 = window.setTimeout(() => setUiPhase('deal'), BLIND_POST_REVEAL_MS * 2)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [publicState.handNumber])

  // The hand's whole resolution -- every contesting opponent's hole cards,
  // the winner, and the payout -- is already fully computed the instant the
  // hand ends (conductShowdown settles everything in one state transition,
  // same as the deal). Left alone, a real showdown would flip every
  // opponent's cards and print the result in a single frame. This stages
  // the same final data as a sequence of beats: each contesting opponent's
  // cards flip one at a time, then the result appears -- same pattern as
  // the dealer-resolution reveal in Blackjack and the blind-posting reveal
  // above. A fold-out win (nobody left to show down) still gets one beat
  // before the result, instead of popping instantly.
  const HOLDEM_REVEAL_BEAT_MS = 800
  const showdownStagedForHandRef = useRef<number | null>(null)
  const [revealedOpponentCount, setRevealedOpponentCount] = useState(0)
  const [handResultsVisible, setHandResultsVisible] = useState(false)

  const contestingOpponents = publicState.seatOrder.filter(
    (id) => id !== localPlayerId && !publicState.hands[id]?.folded && (publicState.hands[id]?.cards.length ?? 0) > 0,
  )

  useEffect(() => {
    if (!publicState.handOver) return
    if (showdownStagedForHandRef.current === publicState.handNumber) return
    showdownStagedForHandRef.current = publicState.handNumber

    setRevealedOpponentCount(0)
    setHandResultsVisible(false)

    const timers: number[] = []
    let delay = 0
    for (let i = 1; i <= contestingOpponents.length; i++) {
      delay += HOLDEM_REVEAL_BEAT_MS
      const revealedCount = i
      timers.push(window.setTimeout(() => setRevealedOpponentCount(revealedCount), delay))
    }
    delay += 700
    timers.push(window.setTimeout(() => setHandResultsVisible(true), delay))

    return () => {
      timers.forEach((t) => window.clearTimeout(t))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicState.handOver, publicState.handNumber])

  // Guards the same one-frame stale-flash the Blackjack reveal guards
  // against: a fresh handOver can render before this effect has reset the
  // local staging state back to zero.
  const isFreshShowdown = publicState.handOver && showdownStagedForHandRef.current !== publicState.handNumber
  const revealedOpponentCountEffective = publicState.handOver ? (isFreshShowdown ? 0 : revealedOpponentCount) : 0
  const handResultsVisibleEffective = publicState.handOver ? (isFreshShowdown ? false : handResultsVisible) : false

  // Sound effects
  useEffect(() => {
    const p = soundSigRef.current
    const myHand = publicState.hands[localPlayerId]
    const myBetThisStreet = myHand?.betThisStreet ?? 0
    const myFolded = myHand?.folded ?? false

    // Shuffle sound plays from DealIntro itself now (see the uiPhase staging
    // above) -- it always shows, including hand #1, so a second manual
    // trigger here would double up with it.

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

    // Showdown reveal -- one flip per contesting opponent's cards actually
    // turning face-up (the staged reveal above), not the instant every
    // seat's cards exist in public state.
    if (revealedOpponentCountEffective > p.revealedOpponentCount) {
      play('card-flip')
    }

    // Hand-over win/loss sounds -- keyed off the staged results reveal
    // finishing, not raw handOver (which, like the showdown cards, is
    // already final the instant the hand ends).
    if (!p.handResultsVisible && handResultsVisibleEffective && publicState.handResults) {
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
      revealedOpponentCount: revealedOpponentCountEffective,
      handResultsVisible: handResultsVisibleEffective,
    }
  }, [publicState.turn.phase, publicState.handOver, publicState.handResults, publicState.hands, publicState.seatOrder, localPlayerId, notice, play, revealedOpponentCountEffective, handResultsVisibleEffective])

  // Derived state
  const isMyTurn = currentPlayer(publicState.turn) === localPlayerId
  const myChips = publicState.chips[localPlayerId] ?? 0
  const myBetThisStreet = publicState.hands[localPlayerId]?.betThisStreet ?? 0
  const currentPhase = publicState.turn.phase
  // A fold-out sole-winner and a genuine showdown both set handOver without
  // ever advancing turn.phase off whatever street it happened to be on (see
  // the FOLD sole-winner path and conductShowdown in rules.ts) -- excluding
  // handOver here is what actually retires the last actor's "Turn" tag and
  // action controls once the hand is over, not just re-checking phase.
  const isActionPhase = !publicState.handOver && ['preflop', 'flop', 'turn', 'river'].includes(currentPhase)
  const canAct = isMyTurn && isActionPhase

  // Button gating conditions based on rules.ts validators
  const callAmount = Math.min(publicState.currentBetThisStreet - myBetThisStreet, myChips)
  const canCall = canAct && callAmount > 0
  const canCheck = canAct && publicState.currentBetThisStreet <= myBetThisStreet
  const canFold = canAct
  const canBet = canAct && publicState.currentBetThisStreet === 0 && myChips > 0
  const canRaise = canAct && publicState.currentBetThisStreet > 0 && publicState.reRaiseEligible[localPlayerId] && myChips > 0

  // Close the raise sizing panel whenever it's no longer available, so it
  // can't get stuck open into a future turn or street.
  useEffect(() => {
    if (!canRaise) setRaiseSizingOpen(false)
  }, [canRaise, currentPhase])

  // Compute min/max for bet/raise slider
  let minBetAmount = 1
  let maxBetAmount = myChips

  if (canBet) {
    // Betting: min = one big blind (the stepper below moves in 10s, so
    // starting it anywhere off that grid -- e.g. the engine's true floor of
    // 1 chip -- means every step lands on an off-grid number: 1, 11, 21...).
    minBetAmount = Math.min(HOLDEM_BIG_BLIND, myChips)
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

  // Your own hole cards live in privateState while the hand is live, but
  // conductShowdown (and the FOLD sole-winner path) both wipe every seat's
  // privateState to {hand:[]} once the hand ends -- the canonical copy from
  // that point on is publicState.hands[you].cards, which conductShowdown
  // populates for every contesting seat as part of the reveal. Falling back
  // to privateState only while it's actually populated keeps your own hand
  // visible through hand-over instead of vanishing at the exact moment a
  // player wants to compare it against the board.
  const myHoleCards = publicState.hands[localPlayerId]?.cards.length
    ? publicState.hands[localPlayerId].cards
    : privateState.hand

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


      {/* Error banner */}
      {notice && (
        <div className="holdem-error-banner">{notice}</div>
      )}

      {/* Main table card */}
      <div className="holdem-table-card">
        {uiPhase === 'blinds' ? (
          /* Blinds are forced, not a choice -- but they're still a turn a
             human at that seat would watch happen, so each posts as its
             own paced beat instead of silently existing in the state the
             moment the hand starts. */
          <div className="holdem-blinds-stage">
            <div className="holdem-blinds-caption">Posting blinds…</div>
            <div
              className="holdem-blinds-seat"
              style={{ color: colors[blindStage === 'sb' ? publicState.smallBlindSeat : publicState.bigBlindSeat] ?? 'var(--ink)' }}
            >
              {(blindStage === 'sb' ? names[publicState.smallBlindSeat] : names[publicState.bigBlindSeat]) ?? 'A player'}
              {' posts the '}
              {blindStage === 'sb' ? 'small' : 'big'}
              {' blind: '}
              {blindStage === 'sb'
                ? publicState.hands[publicState.smallBlindSeat]?.betThisStreet ?? 0
                : publicState.hands[publicState.bigBlindSeat]?.betThisStreet ?? 0}
            </div>
          </div>
        ) : uiPhase === 'deal' ? (
          <DealIntro
            others={others}
            yourHandSize={privateState.hand.length}
            renderCardBack={(p) => <CardBack {...p} design={publicState.cardBack} />}
            onComplete={() => setUiPhase('table')}
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
                      </div>
                      <div className="holdem-opp-chip-badge">
                        <span className="holdem-opp-chip-value">{seatChips}</span>
                        {seatHand.betThisStreet > 0 && (
                          <span className="holdem-opp-bet-value">Bet {seatHand.betThisStreet}</span>
                        )}
                      </div>
                    </div>

                    {/* Turn tag: its own full-width row, so a long name never
                        has to share cramped space with it on the identity row. */}
                    {isTurn && (
                      <span className="holdem-turn-tag" style={{ background: seatColor, color: '#fff' }}>Turn</span>
                    )}

                    {/* Status badges */}
                    <div className="holdem-opp-badges">
                      {isFolded && <span className="chip" style={{ background: '#ddd', color: 'var(--muted-text)', fontSize: 12 }}>Folded</span>}
                      {isAllIn && !isFolded && <span className="chip" style={{ background: 'var(--yellow)', color: 'var(--ink)', fontSize: 12 }}>All in</span>}
                      {isEliminated && <span className="chip" style={{ background: '#ddd', color: 'var(--muted-text)', fontSize: 12 }}>Out</span>}
                    </div>

                    {/* Opacity state for folded/eliminated */}
                    <div className="holdem-opp-cards" style={{ opacity: isFolded || isEliminated ? 0.6 : 1 }}>
                      {seatHand.cards.length > 0 && contestingOpponents.indexOf(seatId) < revealedOpponentCountEffective ? (
                        // Showdown reveal - show real cards at meld size,
                        // paced one contesting opponent at a time (see the
                        // staged-reveal effect above).
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

            {/* Centre band: deck, then board (fixed left-justified slots),
                pot pushed to the far right -- restyled as the table's
                focal point, matching Blackjack's dealer band treatment. */}
            <div className="holdem-centre">
              {/* Decorative deck -- not clickable, no gameplay action draws from it directly */}
              <div className="holdem-deck-group">
                <div className="holdem-deck-caption">deck</div>
                <CardBack size="stock" design={publicState.cardBack} />
              </div>

              <div className="holdem-board-group">
                <HoldemBoard cards={publicState.board} />
              </div>

              <div className="holdem-pot">
                <span className="holdem-pot-label">Pot</span>
                <span className="holdem-pot-value">{publicState.pot}</span>
              </div>
            </div>

            {/* Your side: local player area. Two columns on wide viewports --
                hole cards on the left, chip bank + controls on the right, so
                the controls sit beside the cards instead of forcing a long
                scroll below them. */}
            <div className="holdem-your-side">
              {/* Your hole cards */}
              <div className="holdem-your-hand-col">
                {myHoleCards.length > 0 && (
                  <div className="holdem-your-cards">
                    {myHoleCards.map((card, i) => (
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
                  {!((canBet || canRaise) && raiseSizingOpen) ? (
                    /* Default row: exactly 3 controls -- Fold, Check-or-Call,
                       and Bet/Raise (which only opens the sizing panel
                       below, it doesn't submit anything itself). */
                    <div className="holdem-action-buttons">
                      <button
                        type="button"
                        className="btn btn-lg holdem-fold-btn"
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
                      {(canBet || canRaise) && (
                        <button
                          type="button"
                          className="btn btn-lg btn-coral"
                          onClick={() => {
                            setBetAmount(minBetAmount)
                            setRaiseSizingOpen(true)
                          }}
                        >
                          {canBet ? 'Bet' : 'Raise'}
                        </button>
                      )}
                    </div>
                  ) : (
                    /* Expanded sizing panel, replacing the default row while open. */
                    <div className="holdem-bet-section">
                      <div className="holdem-bet-section-header">
                        <div className="holdem-bet-label">
                          {canBet ? 'Bet' : 'Raise to'}
                        </div>
                        <button
                          type="button"
                          className="holdem-cancel-link"
                          onClick={() => setRaiseSizingOpen(false)}
                        >
                          Cancel
                        </button>
                      </div>
                      <div className="holdem-bet-stepper-group">
                        <button
                          type="button"
                          className="holdem-stepper-btn"
                          onClick={() => setBetAmount(Math.max(minBetAmount, clampedBetAmount - 10))}
                        >
                          −
                        </button>
                        <div className="holdem-bet-display">
                          {clampedBetAmount}
                        </div>
                        <button
                          type="button"
                          className="holdem-stepper-btn"
                          onClick={() => setBetAmount(Math.min(maxBetAmount, clampedBetAmount + 10))}
                        >
                          +
                        </button>
                      </div>
                      <div className="holdem-preset-buttons">
                        {quickPresets.map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            className="btn"
                            onClick={() => setBetAmount(preset.value)}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="btn btn-coral btn-lg"
                        onClick={() => {
                          canBet ? onBet(clampedBetAmount) : onRaise(clampedBetAmount)
                          setRaiseSizingOpen(false)
                        }}
                      >
                        {canBet ? `Confirm bet ${clampedBetAmount}` : `Confirm raise to ${clampedBetAmount}`}
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

              {!isMyTurn && isActionPhase && (
                <div className="holdem-action-section">
                  Waiting for {names[currentPlayer(publicState.turn)] ?? 'a player'}…
                </div>
              )}

              {/* Showdown reveal in progress: cards are flipping (or, on a
                  fold-out win, a short beat) before the result appears. */}
              {publicState.handOver && !handResultsVisibleEffective && (
                <div className="holdem-action-section">
                  {contestingOpponents.length > 0 ? 'Revealing hands…' : 'Hand over…'}
                </div>
              )}

              {/* Hand-over banner */}
              {publicState.handOver && handResultsVisibleEffective && publicState.handResults && (
                <div className="holdem-action-section">
                  <div className="holdem-hand-results">
                    {publicState.gameOverWinnerId ? (
                      <div className="holdem-game-over">
                        {publicState.gameOverWinnerId === localPlayerId ? 'You win' : `${names[publicState.gameOverWinnerId] ?? 'Someone'} wins`} the table!
                      </div>
                    ) : (
                      <div>
                        {publicState.handResults.potBreakdown.map((breakdown, i) => {
                          const winners = breakdown.winnerIds
                          const winnerNames = winners.map((id) => id === localPlayerId ? 'You' : names[id] ?? id)
                          const amountPerWinner = Math.floor(breakdown.amount / winners.length)

                          if (winners.length === 1) {
                            const winnerId = winners[0]
                            const isLocalWinner = winnerId === localPlayerId
                            const winnerName = isLocalWinner ? 'You' : names[winnerId] ?? winnerId
                            return (
                              <div key={i}>
                                {winnerName} {isLocalWinner ? 'win' : 'wins'} {breakdown.amount}
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
                  {/* Full-width stacked, not the same wrapping row the
                      Fold/Check/Call buttons use -- "Deal next hand" and
                      "Leave table" are too wide to reliably sit side by
                      side in this column, and letting them wrap onto their
                      own lines looked like a layout glitch rather than a
                      deliberate design. */}
                  <div className="holdem-hand-over-actions">
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
