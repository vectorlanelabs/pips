import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import type { Card } from '../card-engine/cards'
import type { SkipBoPublicState } from '../card-games/skipbo/state'
import { isCardLegalOnPile } from '../card-games/skipbo/rules'
import { currentPlayer } from '../engine/turn-engine'
import { DealIntro } from '../components/DealIntro'
import { SkipBoCard, SkipBoCardBack } from '../components/SkipBoCard'
import { TableHeader } from '../components/TableHeader'
import { useSound } from '../hooks/useSound'
import { useTurnStartSound } from '../hooks/useTurnStartSound'
import { SkipBoRulesOverlay } from './SkipBoRulesOverlay'
import './SkipBoTable.css'

// ---- Props ----

export interface SkipBoTableProps {
  code: string
  localPlayerId: string
  localName: string
  names: Record<string, string>        // playerId -> display name
  colors: Record<string, string>       // playerId -> seat ink
  connection: 'connected' | 'disconnected'
  notice?: string | null
  publicState: SkipBoPublicState
  hand: Card[]                         // your private hand
  onPlayStock: (buildPileIndex: number) => void
  onPlayHand: (cardId: string, buildPileIndex: number) => void
  onPlayDiscard: (pileIndex: number, buildPileIndex: number) => void
  onDiscard: (cardId: string, pileIndex: number) => void
  onPass: () => void
  onLeave: () => void
}

// ---- Hand sort ----
//
// Spec 40 confirmed the engine leaves hand.cards in raw append order and
// deferred display sorting to the UI. Ascending by rank, with wilds last:
// a wild's rank is the string 'WILD', so Number('WILD') is NaN. Return 13
// (one past the highest real rank, 12) for any non-numeric card so wilds
// sort after every numbered card.

function skipBoSortValue(card: Card): number {
  const n = Number(card.rank)
  return Number.isFinite(n) ? n : 12 + 1
}

export function sortSkipBoHand(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const va = skipBoSortValue(a)
    const vb = skipBoSortValue(b)
    if (va !== vb) return va - vb
    // Stable for identical ranks (including multiple wilds) — engine append order wins.
    return 0
  })
}

// ---- Selection ----
//
// Skip-Bo has exactly three play sources (stockpile top / hand card / own
// discard-pile top). The select-then-confirm model holds ONE source at a
// time; clicking any other source replaces it.

type SkipBoSelection =
  | { kind: 'stock' }
  | { kind: 'hand'; cardId: string }
  | { kind: 'discard'; pileIndex: number }

function selectionMatches(selection: SkipBoSelection, next: SkipBoSelection): boolean {
  switch (selection.kind) {
    case 'stock':
      return next.kind === 'stock'
    case 'hand':
      return next.kind === 'hand' && selection.cardId === next.cardId
    case 'discard':
      return next.kind === 'discard' && selection.pileIndex === next.pileIndex
  }
}

function selectionCard(
  selection: SkipBoSelection | null,
  hand: Card[],
  stockTop: Card | null,
  discardTops: (Card | null)[],
): Card | null {
  if (!selection) return null
  if (selection.kind === 'stock') return stockTop
  if (selection.kind === 'hand') return hand.find((c) => c.id === selection.cardId) ?? null
  return discardTops[selection.pileIndex] ?? null
}

// ---- Status line ----

type StatusLine = { pre: string; post: string }

function computeStatus(
  publicState: SkipBoPublicState,
  isMyTurn: boolean,
  names: Record<string, string>,
  localPlayerId: string,
  selection: SkipBoSelection | null,
): StatusLine {
  if (publicState.roundOver) {
    const winnerId = publicState.winnerId
    const winnerName = winnerId === null
      ? 'Nobody'
      : winnerId === localPlayerId
        ? 'You'
        : (names[winnerId] ?? winnerId)
    return { pre: `${winnerName} emptied their stockpile!`, post: '' }
  }

  const currentId = currentPlayer(publicState.turn)
  if (!isMyTurn) {
    return { pre: `${names[currentId] ?? currentId}'s turn`, post: '' }
  }

  if (!selection) {
    return { pre: 'Select a card, then tap a highlighted pile — or select a hand card and tap a discard pile to end your turn.', post: '' }
  }

  if (selection.kind === 'hand') {
    return { pre: 'Selected: ', post: 'tap a highlighted build pile to play it, or one of your discard piles to end your turn there.' }
  }

  return { pre: 'Selected: ', post: 'tap a highlighted pile to play it there, or pick something else.' }
}

// ---- Status display sub-component ----

function StatusDisplay({ status }: { status: StatusLine }) {
  return (
    <div className="sb-status">
      {status.pre}
      {status.post}
    </div>
  )
}

// ---- SkipBoTable ----

export function SkipBoTable({
  code,
  localPlayerId,
  localName,
  names,
  colors,
  connection,
  notice,
  publicState,
  hand,
  onPlayStock,
  onPlayHand,
  onPlayDiscard,
  onDiscard,
  onPass,
  onLeave,
}: SkipBoTableProps) {
  void localName // kept in props for symmetry; names[localPlayerId] is the canonical local display name

  // ---- Derived ----
  const opponentIds = publicState.seatOrder.filter((id) => id !== localPlayerId)
  const currentId = currentPlayer(publicState.turn)
  const isMyTurn = currentId === localPlayerId
  const canAct = isMyTurn && !publicState.roundOver
  const myDiscardTops = publicState.discardTops[localPlayerId] ?? [null, null, null, null]
  const stockTop = publicState.stockTops[localPlayerId] ?? null
  const humanCount = publicState.seatOrder.filter((id) => !id.startsWith('bot')).length

  // ---- Local state ----
  const { play, enabled, setEnabled, turnSoundEnabled, setTurnSoundEnabled, playTurnStart } = useSound()
  useTurnStartSound(isMyTurn, humanCount, playTurnStart)
  const [selection, setSelection] = useState<SkipBoSelection | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [showIntro, setShowIntro] = useState(true)

  // ---- Effects ----
  // Clear the selection when the selected card is no longer present (e.g. it was played
  // by an accepted host action).
  useEffect(() => {
    if (!selection) return
    if (selectionCard(selection, hand, stockTop, myDiscardTops) === null) {
      setSelection(null)
    }
  }, [hand, stockTop, myDiscardTops, selection])

  // Clear selection on every turn boundary.
  useEffect(() => {
    setSelection(null)
  }, [publicState.turn.turnNumber])

  // A win can land mid-turn (the winning stockpile play never advances the
  // turn), so the turn-boundary clear above never fires for it — clear the
  // stale selected ring as soon as roundOver flips true.
  useEffect(() => {
    if (publicState.roundOver) setSelection(null)
  }, [publicState.roundOver])

  // Sound effects — diff room-state transitions, but only for my own actions
  // (never for an opponent's turn; otherwise a fast bot spams sound).
  const buildCardCount = publicState.buildPiles.reduce((total, p) => total + p.cards.length, 0)
  const myStockCount = publicState.stockCounts[localPlayerId] ?? 0
  const myHandCount = hand.length
  const drawCount = publicState.drawCount
  const soundSigRef = useRef({
    buildCardCount, myStockCount, myHandCount, drawCount,
    roundOver: publicState.roundOver, wasMyTurn: isMyTurn,
  })
  const noticeSeenRef = useRef(!!notice)

  useEffect(() => {
    const p = soundSigRef.current
    if (p.wasMyTurn) {
      if (buildCardCount > p.buildCardCount || myStockCount < p.myStockCount) {
        play('card-play')
      } else if (myHandCount < p.myHandCount) {
        // DISCARD: a hand card left the hand into one of my discard piles.
        play('card-play')
      }
    }
    // My own draw-back-to-5 fires on the transition where the previous seat
    // ends their turn and I become current — at that snapshot `wasMyTurn` is
    // false, so this cannot live behind the p.wasMyTurn guard above.
    if (myHandCount > p.myHandCount) {
      play('card-draw')
    }
    if (!p.roundOver && publicState.roundOver && publicState.winnerId !== null) {
      play('game-win')
    }
    if (notice && !noticeSeenRef.current) {
      play('error')
      noticeSeenRef.current = true
    } else if (!notice) {
      noticeSeenRef.current = false
    }
    soundSigRef.current = {
      buildCardCount, myStockCount, myHandCount, drawCount,
      roundOver: publicState.roundOver, wasMyTurn: isMyTurn,
    }
  }, [buildCardCount, myStockCount, myHandCount, drawCount, publicState.roundOver, publicState.winnerId, isMyTurn, notice, play])

  // ---- Computed ----
  const sortedHand = useMemo(() => sortSkipBoHand(hand), [hand])
  const selectedCard = selectionCard(selection, hand, stockTop, myDiscardTops)
  const legalPileIndices = canAct && selectedCard
    ? publicState.buildPiles
      .map((pile, i) => (isCardLegalOnPile(selectedCard, pile) ? i : -1))
      .filter((i) => i !== -1)
    : []
  const isHandSelection = selection?.kind === 'hand'

  const status = useMemo(
    () => computeStatus(publicState, isMyTurn, names, localPlayerId, selection),
    [publicState, isMyTurn, names, localPlayerId, selection],
  )

  // ---- Handlers ----
  const handleSelect = useCallback(
    (next: SkipBoSelection) => {
      if (!canAct) return
      setSelection((prev) => (prev && selectionMatches(prev, next) ? null : next))
    },
    [canAct],
  )

  const handlePlayOnto = useCallback(
    (buildPileIndex: number) => {
      if (!canAct || !selection || !legalPileIndices.includes(buildPileIndex)) return
      if (selection.kind === 'stock') onPlayStock(buildPileIndex)
      else if (selection.kind === 'hand') onPlayHand(selection.cardId, buildPileIndex)
      else onPlayDiscard(selection.pileIndex, buildPileIndex)
      setSelection(null)
    },
    [canAct, selection, legalPileIndices, onPlayStock, onPlayHand, onPlayDiscard],
  )

  const handleDiscardOnto = useCallback(
    (pileIndex: number) => {
      if (!canAct || selection?.kind !== 'hand') return
      onDiscard(selection.cardId, pileIndex)
      setSelection(null)
    },
    [canAct, selection, onDiscard],
  )

  // ---- Render ----
  const others = opponentIds.map((seatId) => ({
    id: seatId,
    name: names[seatId] ?? seatId,
    color: colors[seatId] ?? 'var(--slate-pip)',
    handSize: 5, // DealIntro animates starting hands only; Skip-Bo stockpiles are never part of it
  }))

  return (
    <div className="sb-table">
      {/* Header */}
      <TableHeader
        gameLabel="Skip-Bo"
        gameColor="#be185d"
        meta={connection === 'connected' ? `peer to peer · ${publicState.seatOrder.length} players` : 'connection lost'}
        onRules={() => setRulesOpen(true)}
        onLeave={onLeave}
        enabled={enabled}
        setEnabled={setEnabled}
        turnSoundEnabled={turnSoundEnabled}
        setTurnSoundEnabled={setTurnSoundEnabled}
      />

      {/* Code + cards-left chips */}
      <div className="sb-subheader">
        <span className="chip" style={{ background: 'var(--yellow)', color: 'var(--ink)' }}>Skip-Bo · {code}</span>
        <div className="sb-stock-row">
          {publicState.seatOrder.map((pid) => (
            <span key={pid} className="sb-stock-pill">
              <span className="sb-stock-dot" style={{ background: colors[pid] ?? 'var(--slate-pip)' }} />
              {names[pid] ?? pid} {publicState.stockCounts[pid] ?? 0}
            </span>
          ))}
          <span className="sb-stock-hint">fewest wins</span>
        </div>
      </div>

      {/* Error banner */}
      {notice && <div className="sb-error-banner">{notice}</div>}

      {/* Main table card */}
      <div className="sb-table-card">
        {showIntro ? (
          <DealIntro
            others={others}
            yourHandSize={5}
            renderCardBack={(p) => <SkipBoCardBack {...p} design={publicState.cardBack} />}
            onComplete={() => setShowIntro(false)}
            maxFlights={hand.length + others.reduce((s, o) => s + o.handSize, 0)}
          />
        ) : (
        <>
        {/* Opponent tile grid */}
        <div className="sb-opp-rail">
          {opponentIds.map((seatId) => {
            const seatColor = colors[seatId] ?? 'var(--slate-pip)'
            const seatName = names[seatId] ?? seatId
            const isTurn = seatId === currentId
            const handCount = publicState.handCounts[seatId] ?? 0
            const fanCount = Math.min(handCount, 14)
            const discardTops = publicState.discardTops[seatId] ?? [null, null, null, null]
            const seatStockTop = publicState.stockTops[seatId] ?? null

            return (
              <div
                key={seatId}
                className={`sb-opp-tile${isTurn ? ' sb-opp-tile--turn' : ''}`}
                style={isTurn ? { background: seatColor, borderColor: seatColor, color: '#fff' } : undefined}
              >
                <div className="sb-opp-tile-top">
                  <span
                    className="sb-seat-dot"
                    style={isTurn
                      ? { background: '#fff', borderColor: 'rgba(255, 255, 255, 0.85)' }
                      : { background: seatColor }}
                  />
                  <span className="sb-opp-name" style={isTurn ? undefined : { color: seatColor }}>{seatName}</span>
                  {isTurn && <span className="sb-turn-tag" style={{ background: '#fff', color: 'var(--ink)' }}>turn</span>}
                </div>

                <div className="sb-opp-tile-hand">
                  {fanCount > 0 && (
                    <div className="sb-opp-tile-fan">
                      {Array.from({ length: fanCount }, (_, i) => (
                        <SkipBoCardBack
                          key={i}
                          size="fan"
                          design={publicState.cardBack}
                          style={{ marginLeft: i === 0 ? 0 : -15 }}
                        />
                      ))}
                    </div>
                  )}
                  <span className="sb-opp-tile-count">{handCount} cards · hidden</span>
                </div>

                <div className="sb-opp-tile-stock">
                  {seatStockTop ? (
                    <SkipBoCard card={seatStockTop} size="tile" />
                  ) : (
                    <span className="sb-empty-tile" />
                  )}
                  <span className="sb-opp-tile-count">{publicState.stockCounts[seatId] ?? 0} left</span>
                </div>

                <div className="sb-opp-tile-discards">
                  {discardTops.map((card, i) => (
                    card ? (
                      <SkipBoCard key={i} card={card} size="tile" />
                    ) : (
                      <span key={i} className="sb-empty-tile" />
                    )
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* Building piles row + shared draw pile */}
        <div className="sb-build-band">
          <div className="sb-build-piles">
            {publicState.buildPiles.map((pile, i) => {
              const top = pile.cards.length > 0 ? pile.cards[pile.cards.length - 1] : null
              const playable = legalPileIndices.includes(i)
              return (
                <div key={i} className="sb-build-pile">
                  <div className="sb-build-caption">needs {pile.nextNeeded}</div>
                  <div
                    className={`sb-build-slot${playable ? ' sb-build-slot--playable' : ''}`}
                    role={playable ? 'button' : undefined}
                    tabIndex={playable ? 0 : undefined}
                    onClick={playable ? () => handlePlayOnto(i) : undefined}
                    onKeyDown={playable
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            handlePlayOnto(i)
                          }
                        }
                      : undefined}
                  >
                    {top ? (
                      <SkipBoCard card={top} size="tile" />
                    ) : (
                      <span className="sb-empty-tile" />
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="sb-draw-group">
            <div className="sb-draw-caption">draw {publicState.drawCount}</div>
            <div className="sb-draw-slot">
              <SkipBoCardBack size="stock" design={publicState.cardBack} />
            </div>
            <div className="sb-used-caption">used {publicState.usedCount}</div>
          </div>
        </div>

        {/* Your side */}
        <div className="sb-your-side">
          <div className="sb-your-band">
            {/* Stockpile top */}
            <div className="sb-source-group">
              <div className="sb-source-caption">Stockpile · {publicState.stockCounts[localPlayerId] ?? 0}</div>
              <div className="sb-source-slot">
                {stockTop ? (
                  <SkipBoCard
                    card={stockTop}
                    size="tile"
                    selected={selection?.kind === 'stock'}
                    onClick={canAct ? () => handleSelect({ kind: 'stock' }) : undefined}
                  />
                ) : (
                  <span className="sb-empty-tile" />
                )}
              </div>
            </div>

            {/* Own discard tops */}
            <div className="sb-source-group">
              <div className="sb-source-caption">Your discards</div>
              <div className="sb-discard-row">
                {myDiscardTops.map((card, i) => {
                  // Fix 3's disambiguation: with a hand card selected, every own
                  // discard pile is a discard TARGET (empty or not); otherwise a
                  // non-empty pile is clickable as a play SOURCE.
                  const discardTarget = isHandSelection
                  const sourceClickable = !discardTarget && card !== null
                  const clickable = canAct && (discardTarget || sourceClickable)
                  const selected = sourceClickable && selection?.kind === 'discard' && selection.pileIndex === i
                  const handleClick = discardTarget
                    ? () => handleDiscardOnto(i)
                    : () => handleSelect({ kind: 'discard', pileIndex: i })
                  return (
                    <div
                      key={i}
                      className={`sb-source-slot${discardTarget ? ' sb-source-slot--playable' : ''}`}
                      role={clickable ? 'button' : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      onClick={clickable ? handleClick : undefined}
                      onKeyDown={clickable
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              handleClick()
                            }
                          }
                        : undefined}
                    >
                      {card ? (
                        <SkipBoCard
                          card={card}
                          size="tile"
                          selected={selected}
                        />
                      ) : (
                        <span className="sb-empty-tile" />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Turn chip + status */}
            <div className="sb-your-right">
              <span
                className="sb-turn-chip"
                style={{ background: isMyTurn ? '#be185d' : (colors[currentId] ?? 'var(--slate-pip)') }}
              >
                {isMyTurn ? 'Your turn' : `${names[currentId] ?? currentId}'s turn`}
              </span>
              <StatusDisplay status={status} />
            </div>
          </div>

          {/* Hand */}
          <div className="sb-hand-section">
            <div className="sb-hand-header">
              <div className="sb-hand-header-left">
                <span className="sb-hand-label">Your hand</span>
                <span className="sb-hand-stats">{hand.length} cards</span>
              </div>
            </div>

            <div className="sb-hand-fan">
              {sortedHand.map((card, i) => (
                <SkipBoCard
                  key={card.id}
                  card={card}
                  size="hand"
                  selected={selection?.kind === 'hand' && selection.cardId === card.id}
                  onClick={canAct ? () => handleSelect({ kind: 'hand', cardId: card.id }) : undefined}
                  style={{ marginLeft: i === 0 ? 0 : -26 }}
                />
              ))}
            </div>

            {/* Actions row — only Pass remains; play/discard are pile-click actions now */}
            {!publicState.roundOver && hand.length === 0 && canAct && (
              <div className="sb-actions">
                <button
                  type="button"
                  className="btn btn-ghost sb-action-btn"
                  onClick={onPass}
                >
                  Pass
                </button>
              </div>
            )}
          </div>
        </div>
        </>
        )}
      </div>

      {/* Footnote */}
      <p className="sb-footnote">Your hand never leaves this device — only the play does.</p>

      {rulesOpen && <SkipBoRulesOverlay onClose={() => setRulesOpen(false)} />}
    </div>
  )
}
