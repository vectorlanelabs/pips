import { useState, useEffect, useMemo, useCallback, useRef, type CSSProperties } from 'react'
import type { Card } from '../card-engine/cards'
import type { Phase10Hit, Phase10PublicState } from '../card-games/phase10/state'
import { fullGroupCards } from '../card-games/phase10/state'
import { currentPlayer } from '../engine/turn-engine'
import { classifyPhaseHand, validateGroupExtension, orderColorGroupForDisplay, orderRunForDisplay, type GroupType } from '../card-games/phase10/classify'
import { PHASES, type PhaseRequirement } from '../card-games/phase10/phases'
import { DealIntro } from '../components/DealIntro'
import { Phase10Card, Phase10CardBack, PHASE10_COLORS } from '../components/Phase10Card'
import { Wordmark } from '../components/Wordmark'
import { SoundToggle } from '../components/SoundToggle'
import { TurnSoundToggle } from '../components/TurnSoundToggle'
import { Phase10RulesOverlay } from './Phase10RulesOverlay'
import { useSound } from '../hooks/useSound'
import { useTurnStartSound } from '../hooks/useTurnStartSound'
import './Phase10Table.css'

// ---- Props ----

export interface Phase10TableProps {
  code: string
  localPlayerId: string
  localName: string
  names: Record<string, string>        // playerId -> display name
  colors: Record<string, string>       // playerId -> seat ink
  connection: 'connected' | 'disconnected'
  notice?: string | null
  publicState: Phase10PublicState
  hand: Card[]
  onDrawStock: () => void
  onDrawDiscard: () => void          // top card only, no index — unlike Rummy
  onLayPhase: (cardIds: string[]) => void
  onHit: (targetPlayerId: string, groupIndex: number, cardIds: string[]) => void
  onDiscard: (cardId: string) => void
  onLeave: () => void
}

// ---- Local helpers ----

const COLOR_ORDER: Record<string, number> = { red: 0, blue: 1, green: 2, yellow: 3, special: 4 }

type StatusLine = {
  pre: string
  card: { rank: string; suit: string } | null
  post: string
}

function computeStatus(
  publicState: Phase10PublicState,
  isMyTurn: boolean,
  names: Record<string, string>,
  localPlayerId: string,
  justDrawn: Card | null,
): StatusLine {
  // Round over
  if (publicState.roundOver) {
    if (publicState.roundWinnerId === null) {
      return { pre: 'Round blocked — no cards left to draw.', card: null, post: '' }
    }
    const winnerName = publicState.roundWinnerId === localPlayerId ? 'You' : (names[publicState.roundWinnerId] ?? publicState.roundWinnerId)
    return { pre: `${winnerName} went out!`, card: null, post: '' }
  }

  const currentId = currentPlayer(publicState.turn)

  // Not my turn
  if (!isMyTurn) {
    return { pre: `${names[currentId] ?? currentId}'s turn`, card: null, post: '' }
  }

  // My turn — draw phase
  if (publicState.turn.phase === 'draw') {
    return { pre: 'Draw from the stock, or take the top of the discard.', card: null, post: '' }
  }

  // My turn — discard phase, just drew a card
  if (justDrawn) {
    return { pre: 'You drew the ', card: { rank: justDrawn.rank, suit: justDrawn.suit }, post: '.' }
  }

  return { pre: 'Select cards to lay your phase, hit, or discard.', card: null, post: '' }
}

// The round-over banner text. Shows for every ended round that isn't a match end —
// including the blocked round (roundWinnerId === null), which still needs its own copy.
function computeRoundBanner(
  publicState: Phase10PublicState,
  localPlayerId: string,
  names: Record<string, string>,
): string {
  if (publicState.roundWinnerId === null) {
    return 'Round blocked — no cards left to draw. Dealing a new round…'
  }
  const winnerName = publicState.roundWinnerId === localPlayerId ? 'You' : (names[publicState.roundWinnerId] ?? publicState.roundWinnerId)
  const scoreLine = publicState.seatOrder
    .map((id) => `${names[id] ?? id}: ${publicState.scores[id] ?? 0} pts`)
    .join(' · ')
  return `${winnerName} went out! ${scoreLine}. Next round starts automatically.`
}

// 'color' groups number cards by colour first, then rank — sets and colour groups read as
// contiguous blocks. 'rank' groups by rank first, then colour — runs (which ignore colour)
// read as contiguous blocks instead. Skip/Wild (suit 'special') always sort last either way.
function sortHandForDisplay(cards: Card[], sortBy: 'color' | 'rank'): Card[] {
  return [...cards].sort((a, b) => {
    const ca = COLOR_ORDER[a.suit] ?? 4
    const cb = COLOR_ORDER[b.suit] ?? 4
    const na = Number(a.rank)
    const nb = Number(b.rank)
    const aIsNumber = !Number.isNaN(na)
    const bIsNumber = !Number.isNaN(nb)
    const rankCmp = aIsNumber && bIsNumber ? na - nb : aIsNumber !== bIsNumber ? (aIsNumber ? -1 : 1) : 0
    if (sortBy === 'color') {
      if (ca !== cb) return ca - cb
      return rankCmp
    }
    if (rankCmp !== 0) return rankCmp
    return ca - cb
  })
}

// Within a laid group: sets read best sorted by colour, runs and colour groups by number.
function sortGroupForDisplay(cards: Card[], type: GroupType): Card[] {
  if (type === 'set') {
    return [...cards].sort((a, b) => (COLOR_ORDER[a.suit] ?? 4) - (COLOR_ORDER[b.suit] ?? 4))
  }
  if (type === 'run') return orderRunForDisplay(cards)
  return orderColorGroupForDisplay(cards)
}

function layPhaseEnabled(selectedIds: string[], hand: Card[], requirement: PhaseRequirement): boolean {
  const cards = selectedIds.map((id) => hand.find((c) => c.id === id)).filter((c): c is Card => c !== undefined)
  if (cards.length !== selectedIds.length) return false
  return classifyPhaseHand(cards, requirement).valid
}

// validateGroupExtension is the same predicate the host validator runs, so an
// enabled hit target can never be rejected server-side (the bare isValid* checks
// used before missed the runLockedRange rule and offered doomed hits).
function canHitGroup(groupCards: Card[], groupType: GroupType, selectedCards: Card[]): boolean {
  return validateGroupExtension(groupCards, groupType, selectedCards).ok
}

function layPhaseHint(
  selectedIds: string[],
  hand: Card[],
  requirement: PhaseRequirement,
  isMyTurn: boolean,
  phase: string,
  hasLaid: boolean,
): string {
  if (!isMyTurn) return 'Not your turn'
  if (phase !== 'discard') return 'Draw a card first'
  if (hasLaid) return 'Phase already laid this hand'
  const total = requirement.parts.reduce((sum, p) => sum + p.count, 0)
  if (selectedIds.length === 0) return `Select ${total} cards that form your phase`
  // Laying a phase takes EXACTLY the required count — no more, no less. Extra matching
  // cards (e.g. a 4th card of a kind you're using for a set of 3) go on later via a hit,
  // once your phase is down, not into this selection. Tell the player the exact count
  // rather than a generic "doesn't complete" — that message reads as "your cards are
  // wrong" when the real issue is just "you selected the wrong number of cards."
  if (selectedIds.length !== total) return `Select exactly ${total} cards (you have ${selectedIds.length})`
  const cards = selectedIds.map((id) => hand.find((c) => c.id === id)).filter((c): c is Card => c !== undefined)
  if (cards.length !== selectedIds.length) return `Select exactly ${total} cards (you have ${selectedIds.length})`
  if (!classifyPhaseHand(cards, requirement).valid) return "Those don't complete your phase"
  return ''
}

function discardHint(selectedIds: string[], isMyTurn: boolean, phase: string): string {
  if (!isMyTurn) return 'Not your turn'
  if (phase !== 'discard') return 'Draw a card first'
  if (selectedIds.length === 0) return 'Select exactly one card'
  if (selectedIds.length > 1) return 'Select exactly one card'
  return ''
}

// ---- Hit generalization ----
//
// A hit onto a group's OWN OWNER's group (self-extension) merges directly into
// that group's cards — no caption, cards just appear as part of the cluster.
// This is keyed by `h.playerId === h.targetPlayerId`, which works at any seat
// count unchanged.
//
// A hit by someone OTHER than the group's owner (cross-hit) renders in the
// HITTER's own section as a captioned mini-cluster. Multiple hit records by
// the same hitter onto the same target group (they can chain across a round)
// are combined into ONE cluster per (hitter, target) pair, not one cluster
// per record.

interface CrossHitGroup {
  key: string
  targetPlayerId: string
  targetGroupIndex: number
  cards: Card[]
}

function selfExtensionCards(hits: Phase10Hit[], playerId: string, groupIndex: number): Card[] {
  return hits
    .filter((h) => h.playerId === playerId && h.targetPlayerId === playerId && h.targetGroupIndex === groupIndex)
    .flatMap((h) => h.cards)
}

function crossHitGroups(hits: Phase10Hit[], hitterId: string): CrossHitGroup[] {
  const groups = new Map<string, Phase10Hit[]>()
  for (const h of hits) {
    if (h.playerId !== hitterId || h.targetPlayerId === hitterId) continue
    const key = `${h.targetPlayerId}|${h.targetGroupIndex}`
    const list = groups.get(key) ?? []
    list.push(h)
    groups.set(key, list)
  }
  return [...groups.entries()].map(([key, list]) => {
    const [targetPlayerId, targetGroupIndex] = key.split('|')
    return {
      key,
      targetPlayerId,
      targetGroupIndex: Number(targetGroupIndex),
      cards: list.flatMap((h) => h.cards),
    }
  })
}

function crossHitCaption(
  targetPlayerId: string,
  localPlayerId: string,
  names: Record<string, string>,
): string {
  return targetPlayerId === localPlayerId ? 'on your group' : `on ${names[targetPlayerId] ?? targetPlayerId}'s group`
}

// ---- Group cluster sub-component ----

function GroupCluster({ cards, type, ownerColor, ownerShadow, caption, onHit }: {
  cards: Card[]
  type: GroupType
  ownerColor?: string
  ownerShadow?: string
  /** "Phase N" caption above the group, coloured with the owner's seat colour. */
  caption?: string
  /** Present iff the single selected card could validly be hit onto this group. */
  onHit?: () => void
}) {
  const sorted = sortGroupForDisplay(cards, type)
  return (
    <div className="p10-group-wrap">
      {caption && <div className="p10-group-caption" style={{ color: ownerColor }}>{caption}</div>}
      <div
        className={`p10-group${onHit ? ' p10-group--hittable' : ''}`}
        onClick={onHit}
        onKeyDown={onHit ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onHit()
          }
        } : undefined}
        role={onHit ? 'button' : undefined}
        tabIndex={onHit ? 0 : undefined}
      >
        {sorted.map((card, i) => (
          <Phase10Card
            key={card.id}
            card={card}
            size="group"
            ownerColor={ownerColor}
            ownerShadow={ownerShadow}
            style={{ marginLeft: i === 0 ? 0 : -8 }}
          />
        ))}
      </div>
    </div>
  )
}

// ---- Phase ladder sub-component ----

function PhaseLadder({
  localPhaseIdx,
  localColor,
  opponents,
}: {
  localPhaseIdx: number
  localColor: string
  opponents: { seatId: string; phaseIdx: number; color: string }[]
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  return (
    <div className="p10-ladder">
      <div className="p10-ladder-chips">
        {PHASES.map((p, i) => {
          const fill = i < localPhaseIdx ? 'done' : i === localPhaseIdx ? 'current' : 'ahead'
          const atStep = opponents.filter((o) => o.phaseIdx === i)
          const opponentHere = atStep.length > 0
          const chipStyle: CSSProperties = {}
          if (opponentHere) {
            chipStyle.boxShadow = `0 0 0 3px var(--surface), 0 0 0 6px ${atStep[0].color}`
          }
          if (i === localPhaseIdx) {
            chipStyle.background = localColor
            chipStyle.borderColor = localColor
          }
          return (
            <div
              key={p.phase}
              className="p10-ladder-chip-wrap"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <div
                className={`p10-ladder-chip p10-ladder-chip--${fill}${opponentHere ? ' p10-ladder-chip--opponent-here' : ''}`}
                style={chipStyle}
              >
                {p.phase}
              </div>
              <div className="p10-ladder-dots">
                {i === localPhaseIdx && <span className="p10-ladder-dot" style={{ background: localColor }} />}
                {atStep.map((o) => (
                  <span key={o.seatId} className="p10-ladder-dot" style={{ background: o.color }} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <div className="p10-ladder-caption">
        {hovered !== null ? `Phase ${PHASES[hovered].phase} — ${PHASES[hovered].label}` : '\u00a0'}
      </div>
    </div>
  )
}

// ---- Status display sub-component ----

function StatusDisplay({ status }: { status: StatusLine }) {
  return (
    <div className="p10-status">
      {status.pre}
      {status.card && (
        <span
          className="p10-status-card"
          style={{ color: PHASE10_COLORS[status.card.suit as 'red' | 'blue' | 'green' | 'yellow'] ?? 'var(--ink)' }}
        >
          {status.card.rank}
          {status.card.suit !== 'special' ? ` ${status.card.suit}` : ''}
        </span>
      )}
      {status.post}
    </div>
  )
}

// ---- Phase10Table ----

export function Phase10Table({
  code,
  localPlayerId,
  localName,
  names,
  colors,
  connection,
  notice,
  publicState,
  hand,
  onDrawStock,
  onDrawDiscard,
  onLayPhase,
  onHit,
  onDiscard,
  onLeave,
}: Phase10TableProps) {
  void localName // kept in props for symmetry; names[localPlayerId] is the canonical local display name

  // ---- Derived ----
  const opponentIds = publicState.seatOrder.filter((id) => id !== localPlayerId)
  const currentId = currentPlayer(publicState.turn)
  const isMyTurn = currentId === localPlayerId
  const canAct = isMyTurn && !publicState.roundOver
  const myPhaseIdx = publicState.phaseIdx[localPlayerId] ?? 0
  const myRequirement = PHASES[myPhaseIdx]
  const hasLaid = publicState.hasLaidPhase[localPlayerId] ?? false
  const myColor = colors[localPlayerId] ?? 'var(--violet)'
  const myGroups = publicState.groups[localPlayerId] ?? []
  const humanCount = publicState.seatOrder.filter((id) => !id.startsWith('bot')).length

  // ---- Local state ----
  const { play, enabled, setEnabled, turnSoundEnabled, setTurnSoundEnabled, playTurnStart } = useSound()
  useTurnStartSound(isMyTurn, humanCount, playTurnStart)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [justDrawn, setJustDrawn] = useState<Card | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [sortBy, setSortBy] = useState<'color' | 'rank'>('color')
  const prevHandRef = useRef<Card[]>(hand)

  // Fresh-round detection: show the deal intro exactly once per distinct
  // roundNumber this component instance ever sees.
  const introShownForRoundRef = useRef<number | null>(null)
  const [showIntro, setShowIntro] = useState(false)

  // ---- Effects ----
  // Show the deal intro on mount and on every START_NEXT_ROUND transition;
  // never re-fires for the same round on an unrelated re-render.
  useEffect(() => {
    if (introShownForRoundRef.current !== publicState.roundNumber) {
      introShownForRoundRef.current = publicState.roundNumber
      setShowIntro(true)
    }
  }, [publicState.roundNumber])

  // Clear selectedIds when the hand changes in a way that invalidates the selection
  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => hand.some((c) => c.id === id)))
  }, [hand])

  // Clear justDrawn on every turn boundary
  useEffect(() => {
    setJustDrawn(null)
  }, [publicState.turn.turnNumber])

  // Detect single-card draws for "you drew the X" feedback
  useEffect(() => {
    const prev = prevHandRef.current
    const diff = hand.length - prev.length
    if (diff === 1 && publicState.turn.phase === 'discard') {
      const newCard = hand.find((c) => !prev.some((pc) => pc.id === c.id))
      if (newCard) setJustDrawn(newCard)
    } else {
      setJustDrawn(null)
    }
    prevHandRef.current = hand
  }, [hand, publicState.turn.phase])

  // Sound effects — diff room state transitions, but only for my own actions
  // (never for the opponent's turn — otherwise a fast bot spams sound).
  const groupCount = Object.values(publicState.groups).reduce(
    (total, gs) => total + gs.reduce((n, g) => n + g.zone.cards.length, 0),
    0,
  )
  const stockCount = publicState.stockCount
  const discardLen = publicState.discardPile.cards.length
  const hitCount = publicState.hits.length
  const soundSigRef = useRef({
    stockCount, discardLen, groupCount, hitCount,
    roundOver: publicState.roundOver, matchWinnerId: publicState.matchWinnerId, wasMyTurn: isMyTurn,
  })
  const noticeSeenRef = useRef(!!notice)

  useEffect(() => {
    const p = soundSigRef.current
    if (p.wasMyTurn) {
      if (stockCount > p.stockCount) {
        play('shuffle')
      } else if (stockCount < p.stockCount) {
        play('card-draw')
      } else if (discardLen < p.discardLen) {
        play('card-draw')
      } else if (discardLen > p.discardLen) {
        play('card-play')
      } else if (groupCount > p.groupCount || hitCount > p.hitCount) {
        play('card-play')
      }
    }
    if (!p.roundOver && publicState.roundOver && publicState.roundWinnerId !== null) {
      play('round-win')
    }
    if (notice && !noticeSeenRef.current) {
      play('error')
      noticeSeenRef.current = true
    } else if (!notice) {
      noticeSeenRef.current = false
    }
    soundSigRef.current = {
      stockCount, discardLen, groupCount, hitCount,
      roundOver: publicState.roundOver, matchWinnerId: publicState.matchWinnerId, wasMyTurn: isMyTurn,
    }
  }, [stockCount, discardLen, groupCount, hitCount, publicState.roundOver, publicState.roundWinnerId, isMyTurn, notice, play])

  // ---- Computed ----
  const sortedHand = useMemo(() => {
    if (!justDrawn || !hand.some((c) => c.id === justDrawn.id)) {
      return sortHandForDisplay(hand, sortBy)
    }
    const rest = hand.filter((c) => c.id !== justDrawn.id)
    return [...sortHandForDisplay(rest, sortBy), justDrawn]
  }, [hand, justDrawn, sortBy])

  const selectedCards = useMemo(
    () => selectedIds.map((id) => hand.find((c) => c.id === id)).filter((c): c is Card => c !== undefined),
    [selectedIds, hand],
  )

  const status = useMemo(
    () => computeStatus(publicState, isMyTurn, names, localPlayerId, justDrawn),
    [publicState, isMyTurn, names, localPlayerId, justDrawn],
  )

  const showRoundBanner = publicState.roundOver && !publicState.matchWinnerId
  const roundBannerText = useMemo(
    () => computeRoundBanner(publicState, localPlayerId, names),
    [publicState, localPlayerId, names],
  )

  const pile = publicState.discardPile.cards
  const discardTop = pile.length > 0 ? pile[pile.length - 1] : null
  // DRAW_FROM_STOCK is a legal attempt during the draw phase in every empty-stock state
  // EXCEPT one: stock empty + exactly one non-Skip card on the discard pile. There, the
  // validator rejects it outright — a lone drawable discard card must be taken via
  // DRAW_FROM_DISCARD instead, not recycled (recycling needs >= 2 discard cards; a lone
  // Skip or an empty discard blocks the round rather than rejecting). Every other empty-stock
  // case (0 discard cards, a lone Skip, or 2+ discard cards) the engine resolves itself, so
  // gating on stockCount > 0 in general would make the stock unclickable in states it's
  // designed to handle — only this one exact rejection case needs disabling here.
  const stockDrawBlockedByLoneDiscard =
    publicState.stockCount === 0 && pile.length === 1 && discardTop?.meta?.kind !== 'skip'
  const canDrawStock = canAct && publicState.turn.phase === 'draw' && !stockDrawBlockedByLoneDiscard
  // Top card only, and a Skip can never be taken off the discard pile.
  const canDrawDiscard = canAct && publicState.turn.phase === 'draw' && discardTop !== null && discardTop.meta?.kind !== 'skip'

  const canLayPhase = canAct && publicState.turn.phase === 'discard' && !hasLaid
  const lEnabled = canLayPhase && layPhaseEnabled(selectedIds, hand, myRequirement)
  const dEnabled = selectedIds.length === 1 && publicState.turn.phase === 'discard' && isMyTurn

  const lHint = lEnabled ? '' : layPhaseHint(selectedIds, hand, myRequirement, isMyTurn, publicState.turn.phase, hasLaid)
  const dHint = dEnabled ? '' : discardHint(selectedIds, isMyTurn, publicState.turn.phase)

  // True iff every currently selected card, together, could validly be hit onto the given
  // group in one action — any positive number of selected cards, not just one.
  const groupHittable = (targetPlayerId: string, groupIndex: number): boolean => {
    if (!canAct || publicState.turn.phase !== 'discard') return false
    if (!hasLaid || selectedCards.length === 0) return false
    const group = publicState.groups[targetPlayerId]?.[groupIndex]
    if (!group) return false
    const full = fullGroupCards(publicState.groups, publicState.hits, targetPlayerId, groupIndex)
    return canHitGroup(full, group.type, selectedCards)
  }

  // ---- Handlers ----
  const handleCardClick = useCallback(
    (cardId: string) => {
      if (!canAct) return
      setSelectedIds((prev) =>
        prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId],
      )
    },
    [canAct],
  )

  const handleLayPhase = useCallback(() => {
    onLayPhase(selectedIds)
    setSelectedIds([])
  }, [onLayPhase, selectedIds])

  const handleHit = useCallback(
    (targetPlayerId: string, groupIndex: number) => {
      if (selectedCards.length === 0) return
      onHit(targetPlayerId, groupIndex, selectedCards.map((c) => c.id))
      setSelectedIds([])
    },
    [onHit, selectedCards],
  )

  const handleDiscard = useCallback(() => {
    onDiscard(selectedIds[0])
    setSelectedIds([])
  }, [onDiscard, selectedIds])

  // ---- Render ----
  const others = opponentIds.map((seatId) => ({
    id: seatId,
    name: names[seatId] ?? seatId,
    color: colors[seatId] ?? 'var(--slate-pip)',
    handSize: publicState.handCounts[seatId] ?? 0,
  }))

  return (
    <div className="p10-table">
      {/* Header */}
      <div className="p10-header">
        <div className="p10-header-left">
          <Wordmark small onClick={onLeave} />
          <span className="p10-game-label">Phase 10</span>
          <span className="p10-peer-strip">
            <span
              className="p10-peer-dot"
              style={{ background: connection === 'connected' ? 'var(--green)' : 'var(--coral)' }}
            />
            <span className="p10-peer-label">
              {connection === 'connected' ? `peer to peer · ${publicState.seatOrder.length} players` : 'connection lost'}
            </span>
          </span>
        </div>
        <div className="p10-scoreboard">
          {publicState.seatOrder.map((pid) => (
            <span key={pid} className="p10-score-pill">
              <span className="p10-score-dot" style={{ background: colors[pid] ?? 'var(--slate-pip)' }} />
              {names[pid] ?? pid} {publicState.scores[pid] ?? 0}
            </span>
          ))}
          <span className="p10-score-hint">lower wins</span>
        </div>
        <div className="p10-header-actions">
          <TurnSoundToggle enabled={turnSoundEnabled} onToggle={() => setTurnSoundEnabled(!turnSoundEnabled)} />
          <SoundToggle enabled={enabled} onToggle={() => setEnabled(!enabled)} />
          <button type="button" className="btn pill-small" onClick={() => setRulesOpen(true)}>Rules</button>
          <button type="button" className="btn btn-ghost" onClick={onLeave}>Leave</button>
        </div>
      </div>

      {/* Code chip */}
      <div style={{ marginBottom: 'clamp(16px, 2.4vw, 26px)' }}>
        <span className="chip" style={{ background: 'var(--yellow)', color: 'var(--ink)' }}>Phase 10 · {code}</span>
      </div>

      {/* Error banner */}
      {notice && <div className="p10-error-banner">{notice}</div>}

      {/* Main table card */}
      <div className="p10-table-card">
        {showIntro ? (
          <DealIntro
            others={others}
            yourHandSize={hand.length}
            renderCardBack={(p) => <Phase10CardBack {...p} design={publicState.cardBack} />}
            onComplete={() => setShowIntro(false)}
          />
        ) : (
        <>
        {/* Opponent tiles: a wrapping grid, one tile per opponent seat */}
        <div className="p10-opp-rail">
          {opponentIds.map((seatId) => {
            const seatColor = colors[seatId] ?? 'var(--slate-pip)'
            const seatName = names[seatId] ?? seatId
            const isTurn = seatId === currentId
            const handCount = publicState.handCounts[seatId] ?? 0
            const fanCount = Math.min(handCount, 14)
            const seatGroups = publicState.groups[seatId] ?? []
            const seatCrossGroups = crossHitGroups(publicState.hits, seatId)

            return (
              <div
                key={seatId}
                className={`p10-opp-tile${opponentIds.length === 1 ? ' p10-opp-tile--full' : ''}${opponentIds.length === 2 ? ' p10-opp-tile--wide' : ''}${isTurn ? ' p10-opp-tile--turn' : ''}`}
                style={isTurn ? { borderColor: seatColor } : undefined}
              >
                <div className="p10-opp-tile-top">
                  <span className="p10-seat-dot" style={{ background: seatColor }} />
                  <span className="p10-opp-name" style={{ color: seatColor }}>{seatName}</span>
                  {isTurn && <span className="p10-turn-tag" style={{ background: seatColor, color: '#fff' }}>turn</span>}
                </div>
                <div className="p10-opp-tile-hand">
                  {fanCount > 0 && (
                    <div className="p10-opp-tile-fan">
                      {Array.from({ length: fanCount }, (_, i) => (
                        <Phase10CardBack
                          key={i}
                          size="fan"
                          design={publicState.cardBack}
                          style={{ marginLeft: i === 0 ? 0 : -15 }}
                        />
                      ))}
                    </div>
                  )}
                  <span className="p10-opp-tile-count">{handCount} cards · hidden</span>
                </div>
                <div className="p10-opp-tile-groups">
                  {seatGroups.length > 0 ? (
                    seatGroups.map((group, i) => {
                      const selfExt = selfExtensionCards(publicState.hits, seatId, i)
                      const hitTarget = groupHittable(seatId, i)
                      return (
                        <GroupCluster
                          key={group.zone.id}
                          cards={[...group.zone.cards, ...selfExt]}
                          type={group.type}
                          ownerColor={seatColor}
                          ownerShadow="var(--grey-border-3)"
                          caption={`Phase ${group.phaseNumber}`}
                          onHit={hitTarget ? () => handleHit(seatId, i) : undefined}
                        />
                      )
                    })
                  ) : (
                    <span className="p10-groups-empty">{seatName} has laid nothing down yet</span>
                  )}
                  {seatCrossGroups.map((group) => {
                    const targetGroup = publicState.groups[group.targetPlayerId]?.[group.targetGroupIndex]
                    const eligible = groupHittable(group.targetPlayerId, group.targetGroupIndex)
                    return (
                      <div key={group.key} className="p10-group-extension">
                        <div className="p10-group-extension-caption">{crossHitCaption(group.targetPlayerId, localPlayerId, names)}</div>
                        <GroupCluster
                          cards={group.cards}
                          type={targetGroup?.type ?? 'set'}
                          ownerColor={seatColor}
                          ownerShadow="var(--grey-border-3)"
                          onHit={eligible ? () => handleHit(group.targetPlayerId, group.targetGroupIndex) : undefined}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Ladder band */}
        <div className="p10-ladder-band">
          <PhaseLadder
            localPhaseIdx={myPhaseIdx}
            localColor={myColor}
            opponents={opponentIds.map((seatId) => ({
              seatId,
              phaseIdx: publicState.phaseIdx[seatId] ?? 0,
              color: colors[seatId] ?? 'var(--slate-pip)',
            }))}
          />
        </div>

        {/* Centre band */}
        <div className="p10-centre">
          {/* Round-over banner */}
          {showRoundBanner && (
            <div className="p10-round-banner">{roundBannerText}</div>
          )}

          <div className="p10-centre-left">
            {/* Stock */}
            <div className="p10-stock-group">
              <div className="p10-stock-caption">stock {publicState.stockCount}</div>
              <div className="p10-stock-card-wrapper">
                <Phase10CardBack
                  size="stock"
                  design={publicState.cardBack}
                  canDraw={canDrawStock}
                  onClick={canDrawStock ? onDrawStock : undefined}
                />
              </div>
            </div>

            {/* Discard — top card only, no reach-in */}
            <div className="p10-discard-group">
              <div className="p10-discard-caption">Discard · {pile.length} {pile.length === 1 ? 'card' : 'cards'}</div>
              <div className="p10-discard-slot">
                {discardTop ? (
                  <Phase10Card
                    card={discardTop}
                    size="discard"
                    onClick={canDrawDiscard ? onDrawDiscard : undefined}
                  />
                ) : (
                  <span className="p10-discard-empty">Discard pile empty</span>
                )}
              </div>
            </div>
          </div>

          {/* Right group: turn chip + status */}
          <div className="p10-centre-right">
            <span
              className="p10-turn-chip"
              style={{ background: isMyTurn ? 'var(--green-text)' : (colors[currentId] ?? 'var(--slate-pip)') }}
            >
              {isMyTurn ? 'Your turn' : `${names[currentId] ?? currentId}'s turn`}
            </span>
            <StatusDisplay status={status} />
          </div>
        </div>

        {/* Your side */}
        <div className="p10-your-side">
          <div className="p10-your-band">
            <div className="p10-your-groups">
              {myGroups.length > 0 ? (
                myGroups.map((group, i) => {
                  const selfExt = selfExtensionCards(publicState.hits, localPlayerId, i)
                  const hitTarget = groupHittable(localPlayerId, i)
                  return (
                    <GroupCluster
                      key={group.zone.id}
                      cards={[...group.zone.cards, ...selfExt]}
                      type={group.type}
                      ownerColor={myColor}
                      caption={`Phase ${group.phaseNumber}`}
                      onHit={hitTarget ? () => handleHit(localPlayerId, i) : undefined}
                    />
                  )
                })
              ) : (
                <span className="p10-groups-empty">You have laid nothing down yet</span>
              )}
              {crossHitGroups(publicState.hits, localPlayerId).map((group) => {
                const targetType = publicState.groups[group.targetPlayerId]?.[group.targetGroupIndex]?.type ?? 'set'
                const eligible = groupHittable(group.targetPlayerId, group.targetGroupIndex)
                return (
                  <div key={group.key} className="p10-group-extension">
                    <div className="p10-group-extension-caption">{crossHitCaption(group.targetPlayerId, localPlayerId, names)}</div>
                    <GroupCluster
                      cards={group.cards}
                      type={targetType}
                      ownerColor={myColor}
                      onHit={eligible ? () => handleHit(group.targetPlayerId, group.targetGroupIndex) : undefined}
                    />
                  </div>
                )
              })}
            </div>

            {/* Current phase pill */}
            <span className="p10-phase-pill">
              <span className="p10-phase-pill-dot" style={{ background: myColor }} />
              Phase {myRequirement.phase} — {myRequirement.label}
            </span>
          </div>

          <div className="p10-hand-section">
            {/* Hand header */}
            <div className="p10-hand-header">
              <div className="p10-hand-header-left">
                <span className="p10-hand-label">Your hand</span>
                <span className="p10-hand-stats">{hand.length} cards</span>
              </div>
              <div className="p10-sort-toggle">
                <button
                  type="button"
                  className={`p10-sort-btn ${sortBy === 'color' ? 'p10-sort-btn--active' : ''}`}
                  onClick={() => setSortBy('color')}
                >
                  color
                </button>
                <button
                  type="button"
                  className={`p10-sort-btn ${sortBy === 'rank' ? 'p10-sort-btn--active' : ''}`}
                  onClick={() => setSortBy('rank')}
                >
                  order
                </button>
              </div>
            </div>

            {/* Hand cards */}
            <div className="p10-hand-fan">
              {sortedHand.map((card, i) => {
                const isLast = i === sortedHand.length - 1
                const isSeparatedDraw = isLast && justDrawn && card.id === justDrawn.id
                const marginLeft = i === 0 ? 0 : isSeparatedDraw ? 16 : -26
                return (
                  <Phase10Card
                    key={card.id}
                    card={card}
                    size="hand"
                    selected={selectedIds.includes(card.id)}
                    onClick={canAct ? () => handleCardClick(card.id) : undefined}
                    style={{ marginLeft }}
                  />
                )
              })}
            </div>

            {/* Actions row */}
            {!publicState.roundOver && (
              <div className="p10-actions">
                <button
                  type="button"
                  className="btn p10-action-btn"
                  disabled={!lEnabled}
                  onClick={handleLayPhase}
                >
                  {hasLaid ? 'Phase laid' : `Lay phase ${myRequirement.phase}`}
                </button>
                <button
                  type="button"
                  className="btn btn-coral p10-action-btn"
                  disabled={!dEnabled}
                  onClick={handleDiscard}
                >
                  Discard
                </button>
                <span className="p10-action-hint">{lHint || dHint}</span>
              </div>
            )}
          </div>
        </div>
        </>
        )}
      </div>

      {/* Footnote */}
      <p className="p10-footnote">Your hand never leaves this device — only the play does.</p>

      {rulesOpen && <Phase10RulesOverlay onClose={() => setRulesOpen(false)} />}
    </div>
  )
}