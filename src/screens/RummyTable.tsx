import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import type { Card, Rank, Suit } from '../card-engine/cards'
import type { RummyLayoff, RummyPublicState } from '../card-games/rummy/state'
import { fullMeldCards } from '../card-games/rummy/state'
import { currentPlayer } from '../engine/turn-engine'
import { classifyMeld, isAceHighRun } from '../card-games/rummy/melds'
import { deadwood } from '../card-games/rummy/scoring'
import { rankValue, rankValueAceHigh } from '../card-games/rummy/rank'
import { DealIntro } from '../components/DealIntro'
import { PlayingCard, CardBack, suitGlyph, suitColor } from '../components/PlayingCard'
import { Wordmark } from '../components/Wordmark'
import { SoundToggle } from '../components/SoundToggle'
import { TurnSoundToggle } from '../components/TurnSoundToggle'
import { RummyRulesOverlay } from './RummyRulesOverlay'
import { useSound } from '../hooks/useSound'
import { useTurnStartSound } from '../hooks/useTurnStartSound'
import './RummyTable.css'

// ---- Props ----

export interface RummyTableProps {
  code: string
  localPlayerId: string
  names: Record<string, string>        // playerId -> display name
  colors: Record<string, string>       // playerId -> seat ink
  connection: 'connected' | 'disconnected'
  notice?: string | null
  publicState: RummyPublicState
  hand: Card[]                         // your private hand
  onDrawStock: () => void
  onDrawDiscard: (index: number) => void
  onLayDownMeld: (cardIds: string[]) => void
  onLayOffMeld: (targetPlayerId: string, meldIndex: number, cardIds: string[]) => void
  onDiscard: (cardId: string) => void
  onLeave: () => void
}

// ---- Local helpers ----

// Alternates black/red (spades, hearts, clubs, diamonds) rather than grouping
// the two red suits together, so a suit-sorted hand reads black-red-black-red.
const SUIT_ORDER: Record<Suit, number> = {
  spades: 0, hearts: 1, clubs: 2, diamonds: 3,
  joker: 4,
}

type StatusLine =
  | { pre: string; card: { rank: string; suit: Exclude<Suit, 'joker'> } | null; post: string }

function getReachedCard(pile: Card[], index: number): { rank: string; suit: Exclude<Suit, 'joker'> } {
  const c = pile[index]
  return { rank: c.rank, suit: c.suit as Exclude<Suit, 'joker'> }
}

function sortMeldForDisplay(cards: Card[]): Card[] {
  const allSameRank = cards.every((c) => c.rank === cards[0].rank)
  if (allSameRank) {
    const suitOrder: Record<string, number> = { spades: 0, hearts: 1, diamonds: 2, clubs: 3, joker: 4 }
    return [...cards].sort((a, b) => suitOrder[a.suit] - suitOrder[b.suit])
  }
  const valueFn = isAceHighRun(cards) ? rankValueAceHigh : rankValue
  return [...cards].sort((a, b) => valueFn(a.rank) - valueFn(b.rank))
}

// ---- Layoff generalization ----
//
// A layoff onto a meld's OWN OWNER's meld (self-extension) merges directly into
// that meld's cards — no caption, cards just appear as part of the cluster.
// This is keyed by `l.playerId === l.targetPlayerId`, which works at any seat
// count unchanged.
//
// A layoff by someone OTHER than the meld's owner (cross-layoff) renders in
// the LAYER's own section as a captioned mini-cluster. Multiple layoff
// records by the same layer onto the same target meld (they can chain across
// a round) are combined into ONE cluster per (layer, target) pair, not one
// cluster per record.

interface CrossLayoffGroup {
  key: string
  targetPlayerId: string
  targetMeldIndex: number
  cards: Card[]
}

function selfExtensionCards(layoffs: RummyLayoff[], playerId: string, meldIndex: number): Card[] {
  return layoffs
    .filter((l) => l.playerId === playerId && l.targetPlayerId === playerId && l.targetMeldIndex === meldIndex)
    .flatMap((l) => l.cards)
}

function crossLayoffGroups(layoffs: RummyLayoff[], layerId: string): CrossLayoffGroup[] {
  const groups = new Map<string, RummyLayoff[]>()
  for (const l of layoffs) {
    if (l.playerId !== layerId || l.targetPlayerId === layerId) continue
    const key = `${l.targetPlayerId}|${l.targetMeldIndex}`
    const list = groups.get(key) ?? []
    list.push(l)
    groups.set(key, list)
  }
  return [...groups.entries()].map(([key, list]) => {
    const [targetPlayerId, targetMeldIndex] = key.split('|')
    return {
      key,
      targetPlayerId,
      targetMeldIndex: Number(targetMeldIndex),
      cards: list.flatMap((l) => l.cards),
    }
  })
}

function crossLayoffCaption(
  targetPlayerId: string,
  localPlayerId: string,
  names: Record<string, string>,
): string {
  return targetPlayerId === localPlayerId ? 'on your group' : `on ${names[targetPlayerId] ?? targetPlayerId}'s group`
}

function computeStatus(
  publicState: RummyPublicState,
  isMyTurn: boolean,
  names: Record<string, string>,
  localPlayerId: string,
  hoverIndex: number | null,
  hand: Card[],
  justDrawn: Card | null,
): StatusLine {
  // Round over
  if (publicState.roundOver) {
    const winnerId = publicState.roundWinnerId
    const winnerName = winnerId === null
      ? 'Nobody'
      : winnerId === localPlayerId
        ? 'You'
        : (names[winnerId] ?? winnerId)
    return { pre: `${winnerName} went out!`, card: null, post: '' }
  }

  const currentId = currentPlayer(publicState.turn)

  // Not my turn
  if (!isMyTurn) {
    return { pre: `${names[currentId] ?? currentId}'s turn`, card: null, post: '' }
  }

  // My turn — draw phase
  if (publicState.turn.phase === 'draw') {
    // After reaching in — obligated card is set (this fires on the next render after draw)
    if (publicState.obligatedCardId) {
      const card = hand.find((c) => c.id === publicState.obligatedCardId)
      if (card) {
        return {
          pre: 'Lay down the ',
          card: { rank: card.rank, suit: card.suit as Exclude<Suit, 'joker'> },
          post: ' \u2014 that card has to be used.',
        }
      }
    }

    // Hovering a discard card. hoverIndex can be stale across a round boundary (clicking a
    // pile card removes it, so onMouseLeave never fires) — ignore it if it's out of range.
    if (hoverIndex !== null && hoverIndex < publicState.discardPile.cards.length) {
      const pile = publicState.discardPile.cards
      const n = pile.length - hoverIndex
      const reached = getReachedCard(pile, hoverIndex)
      if (n === 1) {
        return { pre: 'Take the ', card: reached, post: '.' }
      }
      return {
        pre: `Take ${n} cards \u2014 `,
        card: reached,
        post: ` and the ${n - 1} on top.`,
      }
    }

    // Idle — reach-in prompt
    return { pre: 'Reach in anywhere \u2014 you take that card and everything above it.', card: null, post: '' }
  }

  // My turn — discard phase
  if (publicState.obligatedCardId) {
    const card = hand.find((c) => c.id === publicState.obligatedCardId)
    if (card) {
      return {
        pre: 'Lay down the ',
        card: { rank: card.rank, suit: card.suit as Exclude<Suit, 'joker'> },
        post: ' \u2014 that card has to be used.',
      }
    }
  }

  if (justDrawn) {
    return {
      pre: 'You drew the ',
      card: { rank: justDrawn.rank, suit: justDrawn.suit as Exclude<Suit, 'joker'> },
      post: '.',
    }
  }

  return { pre: 'Select a card to discard.', card: null, post: '' }
}

function sortHand(cards: Card[], sortBy: 'suit' | 'rank'): Card[] {
  const sorted = [...cards]
  if (sortBy === 'suit') {
    sorted.sort((a, b) => {
      const s = SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit]
      if (s !== 0) return s
      return rankValue(a.rank) - rankValue(b.rank)
    })
  } else {
    sorted.sort((a, b) => {
      const r = rankValue(a.rank) - rankValue(b.rank)
      if (r !== 0) return r
      return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit]
    })
  }
  return sorted
}

function layDownHint(
  selectedIds: string[],
  hand: Card[],
  obligatedCardId: string | null,
  canLayOffSomewhere: boolean,
): string {
  if (obligatedCardId && !selectedIds.includes(obligatedCardId)) {
    const card = hand.find((c) => c.id === obligatedCardId)
    if (card) {
      return `Lay down the ${card.rank}${suitGlyph(card.suit as Exclude<Suit, 'joker'>)} you reached for`
    }
  }
  if (selectedIds.length > 0 && canLayOffSomewhere) {
    return 'Click a highlighted group to lay off, or select 3+ for a new group'
  }
  if (selectedIds.length < 3) {
    return 'Select 3+ cards that form a set or run'
  }
  const cards = selectedIds.map((id) => hand.find((c) => c.id === id)!).filter(Boolean)
  if (!classifyMeld(cards).valid) {
    return "Those don't form a set or run"
  }
  return ''
}

// True iff `selectedCards` (from hand) could all be laid off onto `meldCards` (an existing,
// already-valid meld) to form a still-valid, larger meld.
function canLayOffOnto(meldCards: Card[], selectedCards: Card[]): boolean {
  if (selectedCards.length === 0) return false
  return classifyMeld([...meldCards, ...selectedCards]).valid
}

function discardHint(
  selectedIds: string[],
  isMyTurn: boolean,
  phase: string,
  obligatedCardId: string | null,
  hand: Card[],
): string {
  if (!isMyTurn) return "Not your turn"
  if (phase !== 'discard') return 'Draw a card first'
  if (obligatedCardId) {
    const card = hand.find((c) => c.id === obligatedCardId)
    if (card) {
      return `Lay down the ${card.rank}${suitGlyph(card.suit as Exclude<Suit, 'joker'>)} you reached for`
    }
  }
  if (selectedIds.length === 0) return 'Select exactly one card'
  if (selectedIds.length > 1) return 'Select exactly one card'
  return ''
}

function layDownEnabled(selectedIds: string[], hand: Card[]): boolean {
  if (selectedIds.length < 3) return false
  const cards = selectedIds.map((id) => hand.find((c) => c.id === id)!).filter(Boolean)
  if (cards.length !== selectedIds.length) return false
  return classifyMeld(cards).valid
}

function discardEnabled(
  selectedIds: string[],
  isMyTurn: boolean,
  phase: string,
  obligatedCardId: string | null,
): boolean {
  return (
    selectedIds.length === 1 &&
    phase === 'discard' &&
    isMyTurn &&
    !obligatedCardId
  )
}

// ---- Meld cluster sub-component ----

function MeldCluster({ cards, ownerColor, ownerShadow, onLayOff }: {
  cards: Card[]
  ownerColor?: string
  ownerShadow?: string
  /** Present iff the current hand selection could validly be laid off onto this group. */
  onLayOff?: () => void
}) {
  const sorted = sortMeldForDisplay(cards)
  return (
    <div
      className={`rummy-meld-cluster${onLayOff ? ' rummy-meld-cluster--layoff' : ''}`}
      onClick={onLayOff}
      onKeyDown={onLayOff ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onLayOff()
        }
      } : undefined}
      role={onLayOff ? 'button' : undefined}
      tabIndex={onLayOff ? 0 : undefined}
    >
      {sorted.map((card, i) => (
        <PlayingCard
          key={card.id}
          rank={card.rank as Exclude<Rank, 'JOKER'>}
          suit={card.suit as Exclude<Suit, 'joker'>}
          size="meld"
          ownerColor={ownerColor}
          ownerShadow={ownerShadow}
          style={{ marginLeft: i === 0 ? 0 : -8 }}
        />
      ))}
    </div>
  )
}

// ---- Status display sub-component ----

function StatusDisplay({ status }: { status: StatusLine }) {
  return (
    <div className="rummy-status">
      {status.pre}
      {status.card && (
        <span style={{ color: suitColor(status.card.suit) }}>
          {status.card.rank}{suitGlyph(status.card.suit)}
        </span>
      )}
      {status.post}
    </div>
  )
}

// ---- RummyTable ----

export function RummyTable({
  localPlayerId,
  names,
  colors,
  connection,
  notice,
  publicState,
  hand,
  onDrawStock,
  onDrawDiscard,
  onLayDownMeld,
  onLayOffMeld,
  onDiscard,
  onLeave,
}: RummyTableProps) {
  // ---- Derived ----
  const opponentIds = publicState.seatOrder.filter((id) => id !== localPlayerId)
  const isMyTurn = currentPlayer(publicState.turn) === localPlayerId
  const canAct = isMyTurn && !publicState.roundOver
  const myMelds = publicState.melds[localPlayerId] ?? []
  const myDeadwood = deadwood(hand)
  const currentId = currentPlayer(publicState.turn)
  const humanCount = publicState.seatOrder.filter((id) => !id.startsWith('bot')).length

  // ---- Local state ----
  const { play, enabled, setEnabled, turnSoundEnabled, setTurnSoundEnabled, playTurnStart } = useSound()
  useTurnStartSound(isMyTurn, humanCount, playTurnStart)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [sortBy, setSortBy] = useState<'suit' | 'rank'>('suit')
  const [justDrawn, setJustDrawn] = useState<Card | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const prevHandRef = useRef<Card[]>(hand)
  const prevDiscardIdsRef = useRef<Set<string>>(new Set(publicState.discardPile.cards.map((c) => c.id)))

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

  // Clear selectedIds when hand changes in a way that invalidates the selection
  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => hand.some((c) => c.id === id)))
  }, [hand])

  // Auto-select the obligated card after a reach-in draw
  useEffect(() => {
    const obligId = publicState.obligatedCardId
    if (obligId && !selectedIds.includes(obligId)) {
      setSelectedIds((prev) => [...prev, obligId])
    }
  }, [publicState.obligatedCardId])

  // Reset hoverIndex on every turn boundary
  useEffect(() => {
    setHoverIndex(null)
  }, [publicState.turn.turnNumber])

  // Clear justDrawn on every turn boundary
  useEffect(() => {
    setJustDrawn(null)
  }, [publicState.turn.turnNumber])

  // Detect single-card draws for "you drew the X" feedback. A single card taken from the
  // discard pile is also pre-selected — it's the card you reached for, same as the
  // obligated card in a multi-card take (just without the must-meld obligation).
  useEffect(() => {
    const prev = prevHandRef.current
    const diff = hand.length - prev.length
    if (diff === 1 && publicState.turn.phase === 'discard' && !publicState.obligatedCardId) {
      const newCard = hand.find((c) => !prev.some((pc) => pc.id === c.id))
      if (newCard) {
        setJustDrawn(newCard)
        if (prevDiscardIdsRef.current.has(newCard.id)) {
          setSelectedIds((sel) => (sel.includes(newCard.id) ? sel : [...sel, newCard.id]))
        }
      }
    } else {
      setJustDrawn(null)
    }
    prevHandRef.current = hand
  }, [hand, publicState.turn.phase, publicState.obligatedCardId])

  // Runs after the hand-diff effect above, so that effect always sees the pile as it was
  // BEFORE the draw that grew the hand.
  useEffect(() => {
    prevDiscardIdsRef.current = new Set(publicState.discardPile.cards.map((c) => c.id))
  }, [publicState.discardPile])

  // Sound effects — diff room state transitions, but only for my own actions
  // (never for the opponent's turn — otherwise a fast bot spams sound).
  const meldCount = Object.values(publicState.melds).reduce(
    (total, zones) => total + zones.reduce((n, z) => n + z.cards.length, 0),
    0,
  )
  const stockCount = publicState.stockCount
  const discardLen = publicState.discardPile.cards.length
  const layoffCount = publicState.layoffs.length
  const soundSigRef = useRef({
    stockCount, discardLen, meldCount, layoffCount,
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
      } else if (meldCount > p.meldCount || layoffCount > p.layoffCount) {
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
      stockCount, discardLen, meldCount, layoffCount,
      roundOver: publicState.roundOver, matchWinnerId: publicState.matchWinnerId, wasMyTurn: isMyTurn,
    }
  }, [stockCount, discardLen, meldCount, layoffCount, publicState.roundOver, publicState.roundWinnerId, isMyTurn, notice, play])

  // ---- Computed ----
  const sortedHand = useMemo(() => {
    if (!justDrawn || !hand.some((c) => c.id === justDrawn.id)) {
      return sortHand(hand, sortBy)
    }
    const rest = hand.filter((c) => c.id !== justDrawn.id)
    return [...sortHand(rest, sortBy), justDrawn]
  }, [hand, sortBy, justDrawn])

  const status = useMemo(
    () => computeStatus(publicState, isMyTurn, names, localPlayerId, hoverIndex, hand, justDrawn),
    [publicState, isMyTurn, names, localPlayerId, hoverIndex, hand, justDrawn],
  )

  const showRoundBanner = publicState.roundOver && !publicState.matchWinnerId && publicState.roundWinnerId
  // Blocked round (stock AND discard both exhausted, nobody can draw): no round winner, but the
  // host still deals a fresh round automatically — same as a going-out round, just no score.
  const showBlockedRoundBanner = publicState.roundOver && !publicState.matchWinnerId && !publicState.roundWinnerId

  // Drawing from an empty stock is still legal (and necessary) when the discard pile
  // has 2+ cards — it recycles the pile (keeping the top card) into a fresh stock.
  // It's only actually blocked when stock is empty AND discard has exactly 1 card
  // (the player must take that lone discard card instead) — matches rules.ts exactly.
  const stockDrawBlocked = stockCount === 0 && discardLen === 1
  const canDrawStock = canAct && publicState.turn.phase === 'draw' && !stockDrawBlocked
  const canReachIn = canAct && publicState.turn.phase === 'draw'

  const lEnabled = layDownEnabled(selectedIds, hand)
  const dEnabled = discardEnabled(selectedIds, isMyTurn, publicState.turn.phase, publicState.obligatedCardId)

  // Laying off requires having already laid down at least one meld of your own this round
  // (matches the LAY_OFF validator in rules.ts) and picks up whatever's currently selected.
  const canLayOffAtAll = canAct && publicState.turn.phase === 'discard' && myMelds.length > 0
  const selectedCards = useMemo(
    () => selectedIds.map((id) => hand.find((c) => c.id === id)).filter((c): c is Card => c !== undefined),
    [selectedIds, hand],
  )
  const canLayOffSomewhere = useMemo(() => {
    if (!canLayOffAtAll) return false
    for (const pid of publicState.seatOrder) {
      const melds = publicState.melds[pid] ?? []
      for (let i = 0; i < melds.length; i++) {
        if (canLayOffOnto(fullMeldCards(publicState.melds, publicState.layoffs, pid, i), selectedCards)) return true
      }
    }
    return false
  }, [canLayOffAtAll, selectedCards, publicState.melds, publicState.layoffs, publicState.seatOrder])

  const lHint = lEnabled ? '' : layDownHint(selectedIds, hand, publicState.obligatedCardId, canLayOffSomewhere)
  const dHint = dEnabled ? '' : discardHint(selectedIds, isMyTurn, publicState.turn.phase, publicState.obligatedCardId, hand)

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

  const handleLayOff = useCallback(
    (targetPlayerId: string, meldIndex: number) => {
      onLayOffMeld(targetPlayerId, meldIndex, selectedIds)
      setSelectedIds([])
    },
    [onLayOffMeld, selectedIds],
  )

  const handleLayDown = useCallback(() => {
    onLayDownMeld(selectedIds)
    setSelectedIds([])
  }, [onLayDownMeld, selectedIds])

  const handleDiscard = useCallback(() => {
    onDiscard(selectedIds[0])
    setSelectedIds([])
  }, [onDiscard, selectedIds])

  // ---- Render ----
  const pile = publicState.discardPile.cards
  const others = publicState.seatOrder
    .filter((id) => id !== localPlayerId)
    .map((id) => ({
      id,
      name: names[id] ?? id,
      color: colors[id] ?? 'var(--slate-pip)',
      handSize: publicState.handCounts[id] ?? 0,
    }))

  return (
    <div className="rummy-table">
      {/* Header */}
      <div className="rummy-header">
        <div className="rummy-header-left">
          <Wordmark small onClick={onLeave} />
          <span className="rummy-game-label">Rummy</span>
          <span className="rummy-peer-strip">
            <span
              className="rummy-peer-dot"
              style={{ background: connection === 'connected' ? 'var(--green)' : 'var(--coral)' }}
            />
            <span className="rummy-peer-label">
              {connection === 'connected' ? `peer to peer · ${publicState.seatOrder.length} players` : 'connection lost'}
            </span>
          </span>
        </div>
        <div className="rummy-scoreboard">
          {publicState.seatOrder.map((pid) => (
            <span key={pid} className="rummy-score-pill">
              <span className="rummy-score-dot" style={{ background: colors[pid] ?? 'var(--slate-pip)' }} />
              {names[pid] ?? pid} {publicState.scores[pid] ?? 0}
            </span>
          ))}
          <span className="rummy-score-hint">to {publicState.target}</span>
        </div>
        <div className="rummy-header-actions">
          <TurnSoundToggle enabled={turnSoundEnabled} onToggle={() => setTurnSoundEnabled(!turnSoundEnabled)} />
          <SoundToggle enabled={enabled} onToggle={() => setEnabled(!enabled)} />
          <button type="button" className="btn pill-small" onClick={() => setRulesOpen(true)}>Rules</button>
          <button type="button" className="btn btn-ghost" onClick={onLeave}>Leave</button>
        </div>
      </div>


      {/* Error banner */}
      {notice && <div className="rummy-error-banner">{notice}</div>}

      {/* Main table card */}
      <div className="rummy-table-card">
        {showIntro ? (
          <DealIntro
            others={others}
            yourHandSize={hand.length}
            renderCardBack={(p) => <CardBack {...p} design={publicState.cardBack} />}
            onComplete={() => setShowIntro(false)}
          />
        ) : (
        <>
        {/* Opponent tiles: a wrapping grid, one tile per opponent seat */}
        <div className="rummy-opp-rail">
          {opponentIds.map((seatId) => {
            const seatColor = colors[seatId] ?? 'var(--slate-pip)'
            const seatName = names[seatId] ?? seatId
            const isTurn = seatId === currentId
            const handCount = publicState.handCounts[seatId] ?? 0
            const fanCount = Math.min(handCount, 14)
            const seatMelds = publicState.melds[seatId] ?? []
            const seatCrossGroups = crossLayoffGroups(publicState.layoffs, seatId)

            return (
              <div
                key={seatId}
                className={`rummy-opp-tile${opponentIds.length === 1 ? ' rummy-opp-tile--full' : ''}${opponentIds.length === 2 ? ' rummy-opp-tile--wide' : ''}${isTurn ? ' rummy-opp-tile--turn' : ''}`}
                style={isTurn ? { borderColor: seatColor } : undefined}
              >
                <div className="rummy-opp-tile-top">
                  <span className="rummy-seat-dot" style={{ background: seatColor }} />
                  <span className="rummy-opp-name" style={{ color: seatColor }}>{seatName}</span>
                  {isTurn && <span className="rummy-turn-tag" style={{ background: seatColor, color: '#fff' }}>turn</span>}
                </div>
                <div className="rummy-opp-tile-hand">
                  {fanCount > 0 && (
                    <div className="rummy-opp-tile-fan">
                      {Array.from({ length: fanCount }, (_, i) => (
                        <CardBack
                          key={i}
                          size="fan"
                          design={publicState.cardBack}
                          style={{ marginLeft: i === 0 ? 0 : -15 }}
                        />
                      ))}
                    </div>
                  )}
                  <span className="rummy-opp-tile-count">{handCount} cards · hidden</span>
                </div>
                <div className="rummy-opp-tile-melds">
                  {seatMelds.length > 0 ? (
                    seatMelds.map((meld, i) => {
                      const selfExt = selfExtensionCards(publicState.layoffs, seatId, i)
                      const eligible = canLayOffAtAll && canLayOffOnto(fullMeldCards(publicState.melds, publicState.layoffs, seatId, i), selectedCards)
                      return (
                        <MeldCluster
                          key={meld.id}
                          cards={[...meld.cards, ...selfExt]}
                          ownerColor={seatColor}
                          ownerShadow="var(--grey-border-3)"
                          onLayOff={eligible ? () => handleLayOff(seatId, i) : undefined}
                        />
                      )
                    })
                  ) : (
                    <span className="rummy-melds-empty">{seatName} has laid down nothing yet</span>
                  )}
                  {seatCrossGroups.map((group) => {
                    const eligible = canLayOffAtAll && canLayOffOnto(fullMeldCards(publicState.melds, publicState.layoffs, group.targetPlayerId, group.targetMeldIndex), selectedCards)
                    return (
                      <div key={group.key} className="rummy-meld-extension">
                        <div className="rummy-meld-extension-caption">{crossLayoffCaption(group.targetPlayerId, localPlayerId, names)}</div>
                        <MeldCluster
                          cards={group.cards}
                          ownerColor={seatColor}
                          ownerShadow="var(--grey-border-3)"
                          onLayOff={eligible ? () => handleLayOff(group.targetPlayerId, group.targetMeldIndex) : undefined}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Centre band */}
        <div className="rummy-centre">
          {/* Round-over banner */}
          {showRoundBanner && (
            <div className="rummy-round-banner">
              {publicState.roundWinnerId === localPlayerId ? 'You' : (names[publicState.roundWinnerId!] ?? publicState.roundWinnerId)}
              {' won this round — '}
              {publicState.scores[publicState.roundWinnerId!] ?? 0}
              {' points. Round '}
              {publicState.roundNumber + 1}
              {' starts automatically.'}
            </div>
          )}
          {showBlockedRoundBanner && (
            <div className="rummy-round-banner">
              {'Stock and discard pile both ran out — round blocked, no score. Round '}
              {publicState.roundNumber + 1}
              {' starts automatically.'}
            </div>
          )}

          <div className="rummy-centre-left">
            {/* Stock */}
            <div className="rummy-stock-group">
              <div className="rummy-stock-caption">stock {publicState.stockCount}</div>
              <div className="rummy-stock-card-wrapper">
                <CardBack
                  size="stock"
                  design={publicState.cardBack}
                  canDraw={canDrawStock}
                  empty={publicState.stockCount === 0}
                  onClick={canDrawStock ? onDrawStock : undefined}
                />
              </div>
            </div>

            {/* Discard */}
            <div className="rummy-discard-group">
              <div className="rummy-discard-caption">Discard · {pile.length} {pile.length === 1 ? 'card' : 'cards'}</div>
              <div className="rummy-discard-strip">
                {pile.length > 0 ? (
                  pile.map((card, i) => {
                    const isReachHover = hoverIndex !== null && i >= hoverIndex
                    const canHover = canReachIn
                    return (
                      <span
                        key={card.id}
                        className="rummy-discard-card-wrapper"
                        style={{
                          zIndex: i,
                          marginLeft: i === 0 ? 0 : -30,
                          paddingTop: 14,
                        }}
                        onMouseEnter={
                          canHover ? () => setHoverIndex(i) : undefined
                        }
                        onMouseLeave={
                          canHover
                            ? () => setHoverIndex((prev) => (prev === i ? null : prev))
                            : undefined
                        }
                      >
                        <PlayingCard
                          rank={card.rank as Exclude<Rank, 'JOKER'>}
                          suit={card.suit as Exclude<Suit, 'joker'>}
                          size="discard"
                          className={isReachHover ? 'playing-card--reach-hover' : undefined}
                          onClick={canHover ? () => onDrawDiscard(i) : undefined}
                        />
                      </span>
                    )
                  })
                ) : (
                  <span className="rummy-discard-empty">Discard pile empty</span>
                )}
              </div>
            </div>
          </div>

          {/* Right group: turn chip + status */}
          <div className="rummy-centre-right">
            <span
              className="rummy-turn-chip"
              style={{ background: isMyTurn ? 'var(--green-text)' : (colors[currentId] ?? 'var(--slate-pip)') }}
            >
              {isMyTurn ? 'Your turn' : `${names[currentId] ?? currentId}'s turn`}
            </span>
            <StatusDisplay status={status} />
          </div>
        </div>

        {/* Your side */}
        <div className="rummy-your-side">
          <div className="rummy-your-melds">
            {myMelds.length > 0 ? (
              myMelds.map((meld, i) => {
                const selfExt = selfExtensionCards(publicState.layoffs, localPlayerId, i)
                const eligible = canLayOffAtAll && canLayOffOnto(fullMeldCards(publicState.melds, publicState.layoffs, localPlayerId, i), selectedCards)
                return (
                  <MeldCluster
                    key={meld.id}
                    cards={[...meld.cards, ...selfExt]}
                    onLayOff={eligible ? () => handleLayOff(localPlayerId, i) : undefined}
                  />
                )
              })
            ) : (
              <span className="rummy-melds-empty">You have laid nothing down yet</span>
            )}
            {crossLayoffGroups(publicState.layoffs, localPlayerId).map((group) => {
              const eligible = canLayOffAtAll && canLayOffOnto(fullMeldCards(publicState.melds, publicState.layoffs, group.targetPlayerId, group.targetMeldIndex), selectedCards)
              return (
                <div key={group.key} className="rummy-meld-extension">
                  <div className="rummy-meld-extension-caption">{crossLayoffCaption(group.targetPlayerId, localPlayerId, names)}</div>
                  <MeldCluster
                    cards={group.cards}
                    onLayOff={eligible ? () => handleLayOff(group.targetPlayerId, group.targetMeldIndex) : undefined}
                  />
                </div>
              )
            })}
          </div>

          <div className="rummy-hand-section">
            {/* Hand header */}
            <div className="rummy-hand-header">
              <div className="rummy-hand-header-left">
                <span className="rummy-hand-label">Your hand</span>
                <span className="rummy-hand-stats">
                  {hand.length} cards · deadwood {myDeadwood}
                </span>
              </div>
              <div className="rummy-sort-toggle">
                <button
                  type="button"
                  className={`rummy-sort-btn ${sortBy === 'suit' ? 'rummy-sort-btn--active' : ''}`}
                  onClick={() => setSortBy('suit')}
                >
                  suit
                </button>
                <button
                  type="button"
                  className={`rummy-sort-btn ${sortBy === 'rank' ? 'rummy-sort-btn--active' : ''}`}
                  onClick={() => setSortBy('rank')}
                >
                  rank
                </button>
              </div>
            </div>

            {/* Hand cards */}
            <div className="rummy-hand-fan">
              {sortedHand.map((card, i) => {
                const isLast = i === sortedHand.length - 1
                const isSeparatedDraw = isLast && justDrawn && card.id === justDrawn.id
                const marginLeft = i === 0 ? 0 : isSeparatedDraw ? 16 : -26
                return (
                  <PlayingCard
                    key={card.id}
                    rank={card.rank as Exclude<Rank, 'JOKER'>}
                    suit={card.suit as Exclude<Suit, 'joker'>}
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
              <div className="rummy-actions">
                <button
                  type="button"
                  className="btn rummy-action-btn"
                  disabled={!lEnabled}
                  onClick={handleLayDown}
                >
                  Lay down {selectedIds.length}
                </button>
                <button
                  type="button"
                  className="btn btn-coral rummy-action-btn"
                  disabled={!dEnabled}
                  onClick={handleDiscard}
                >
                  Discard
                </button>
                <span className="rummy-action-hint">{lHint || dHint}</span>
              </div>
            )}
          </div>
        </div>
        </>
        )}
      </div>

      {/* Footnote */}
      <p className="rummy-footnote">Your hand never leaves this device — only the play does.</p>

      {rulesOpen && <RummyRulesOverlay onClose={() => setRulesOpen(false)} />}
    </div>
  )
}
