import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UnoCard, UnoColor } from '../card-games/uno/deck.ts'
import type { UnoLastAction, UnoPublicState } from '../card-games/uno/state.ts'
import { UNO_TARGET, handHasLegalPlay, isUnoPlayable } from '../card-games/uno/state.ts'
import { currentPlayer } from '../engine/turn-engine.ts'
import { topCard } from '../card-engine/zones.ts'
import { DealIntro } from '../components/DealIntro'
import { UnoCardBack, UnoCardFace } from '../components/UnoCard'
import { Wordmark } from '../components/Wordmark'
import { SoundToggle } from '../components/SoundToggle'
import { TurnSoundToggle } from '../components/TurnSoundToggle'
import { useSound } from '../hooks/useSound'
import { useTurnStartSound } from '../hooks/useTurnStartSound'
import './UnoTable.css'

// ---- Props ----

export interface UnoTableProps {
  code: string
  localPlayerId: string
  names: Record<string, string>        // playerId -> display name
  colors: Record<string, string>       // playerId -> seat ink
  connection: 'connected' | 'disconnected'
  notice?: string | null
  publicState: UnoPublicState
  hand: UnoCard[]                      // your private hand
  onPlayCard: (cardId: string) => void
  onChooseColor: (color: UnoColor) => void
  onChooseSwapTarget: (targetPlayerId: string) => void
  onDraw: () => void
  onPass: () => void
  onCallUno: (targetPlayerId: string) => void
  onStartNextRound: () => void
  onOpenRules: () => void
  onLeave: () => void
}

// ---- Constants ----

// The four picker swatches — the same locked brand hexes as UnoCard.css.
const COLOR_SWATCHES: ReadonlyArray<{ color: UnoColor; hex: string }> = [
  { color: 'red', hex: '#e11d2e' },
  { color: 'yellow', hex: '#eab308' },
  { color: 'green', hex: '#16a34a' },
  { color: 'blue', hex: '#2f6fed' },
]

// ---- Canonical hand sort ----
//
// Uno's ONE fixed order, always applied (no user toggle like Rummy/Phase10):
// grouped by color in the fixed order red, yellow, green, blue; within a
// color group, number cards ascending by value (0-9) first, then that
// color's action cards in the fixed sub-order skip, reverse, draw2. Wild
// and wild4 belong to no color group — they always sort to the very end
// (wild before wild4). Exported only for the unit test; callers outside
// this module have no use for it.
export function sortUnoHand(cards: UnoCard[]): UnoCard[] {
  const COLOR_ORDER: ReadonlyArray<UnoColor> = ['red', 'yellow', 'green', 'blue']
  const ACTION_ORDER: ReadonlyArray<'skip' | 'reverse' | 'draw2'> = ['skip', 'reverse', 'draw2']
  return [...cards].sort((a, b) => {
    // Wilds form their own final group; everything else sorts by color.
    const aColorRank = a.color === 'wild' ? COLOR_ORDER.length : COLOR_ORDER.indexOf(a.color)
    const bColorRank = b.color === 'wild' ? COLOR_ORDER.length : COLOR_ORDER.indexOf(b.color)
    if (aColorRank !== bColorRank) return aColorRank - bColorRank
    if (a.color === 'wild') {
      return (a.kind === 'wild' ? 0 : 1) - (b.kind === 'wild' ? 0 : 1)
    }
    // Numbers before action cards within a color.
    const aIsNumber = a.kind === 'number' ? 1 : 0
    const bIsNumber = b.kind === 'number' ? 1 : 0
    if (aIsNumber !== bIsNumber) return bIsNumber - aIsNumber
    if (aIsNumber === 1) return (a.value ?? 0) - (b.value ?? 0)
    return ACTION_ORDER.indexOf(a.kind as 'skip' | 'reverse' | 'draw2') - ACTION_ORDER.indexOf(b.kind as 'skip' | 'reverse' | 'draw2')
  })
}

// ---- Uno-call button ----
//
// One quiet, uncolored button reused for every hand row (yours and each
// opponent's): a self-call on your own row, a catch on an opponent's — same
// callback, different targetPlayerId. Grayed out when there is nothing to
// call; the only enabled-state change is a subtle shift toward white/full
// opacity (see .uno-call-btn in UnoTable.css) — deliberately NOT the loud
// dark-pill sort-toggle treatment.

function UnoCallButton({ disabled, onClick, ariaLabel }: {
  disabled: boolean
  onClick: () => void
  ariaLabel: string
}) {
  return (
    <button type="button" className="uno-call-btn" disabled={disabled} onClick={onClick} aria-label={ariaLabel}>
      UNO!
    </button>
  )
}

// 1s self-priority stagger for CATCH buttons (someone else's window). Your
// own window is callable the instant it appears; catching another player is
// enabled only once the LOCAL client has seen that specific window for 1000ms.
// Re-keys off unoWindow.playerId — including a window closing and a DIFFERENT
// one opening directly (per spec 34b that can happen: player A's window dies
// uncalled and player B's turn immediately ends at 1 card too) — so the timer
// restarts instead of incorrectly staying "already elapsed" from a stale
// previous window. Uno-specific UI timing; deliberately not a shared hook.
function useCatchStagger(unoWindow: { playerId: string } | null, localPlayerId: string): boolean {
  const [staggerElapsed, setStaggerElapsed] = useState(false)
  useEffect(() => {
    setStaggerElapsed(false)
    if (unoWindow === null || unoWindow.playerId === localPlayerId) return
    const t = setTimeout(() => setStaggerElapsed(true), 1000)
    return () => clearTimeout(t)
  }, [unoWindow?.playerId, localPlayerId])
  return staggerElapsed
}

// ---- Log + status text helpers ----

function describeCard(card: NonNullable<UnoLastAction['card']>): string {
  switch (card.kind) {
    case 'number':
      return `${card.color} ${card.value}`
    case 'skip':
      return `${card.color} skip`
    case 'reverse':
      return `${card.color} reverse`
    case 'draw2':
      return `${card.color} +2`
    case 'wild':
      return 'Wild'
    case 'wild4':
      return 'Wild +4'
  }
}

function formatLastAction(
  lastAction: UnoLastAction | null,
  localPlayerId: string,
  names: Record<string, string>,
  sevenZero: boolean,
): string {
  if (lastAction === null) return 'No plays yet'
  const who = lastAction.by === localPlayerId ? 'You' : (names[lastAction.by] ?? lastAction.by)
  switch (lastAction.kind) {
    case 'play': {
      if (lastAction.card === null) return `${who} played a card`
      // Check for 7-swap (only when sevenZero rule is enabled and swap actually happened)
      if (sevenZero && lastAction.card.value === 7 && lastAction.swapTargetPlayerId !== undefined) {
        const targetName = lastAction.swapTargetPlayerId === localPlayerId ? 'you' : (names[lastAction.swapTargetPlayerId] ?? lastAction.swapTargetPlayerId)
        return `${who} swapped hands with ${targetName}`
      }
      // Check for 0-rotation (only when sevenZero rule is enabled)
      if (sevenZero && lastAction.card.value === 0) {
        return `${who} played a 0 — hands rotated`
      }
      const base = `${who} played ${describeCard(lastAction.card)}`
      // drewCount records how many the NEXT player drew after a draw2/wild4.
      return lastAction.drewCount > 0 ? `${base} — ${lastAction.drewCount} cards drawn` : base
    }
    case 'draw': {
      const n = lastAction.drewCount
      return `${who} drew ${n} ${n === 1 ? 'card' : 'cards'}`
    }
    case 'pass':
      return `${who} passed`
  }
}

// A stable fingerprint for "is this the same action as last render".
// Ignores drewCount so a wild4's CHOOSE_COLOR (which merges drewCount: 4 into
// the same play) doesn't read as a second, new play. Includes swapTargetPlayerId
// to distinguish different 7-swap targets.
function lastActionSignature(lastAction: UnoLastAction | null): string {
  if (lastAction === null) return 'none'
  const c = lastAction.card
  return `${lastAction.by}|${lastAction.kind}|${c?.kind ?? 'none'}|${c?.color ?? 'none'}|${c?.value ?? 'none'}|${lastAction.swapTargetPlayerId ?? 'none'}`
}

function computeStatus(
  publicState: UnoPublicState,
  isMyTurn: boolean,
  localPlayerId: string,
  names: Record<string, string>,
  hasPlayable: boolean,
): string {
  if (publicState.stage === 'roundOver') {
    if (publicState.roundResult === null) return 'Round blocked — no cards left to draw.'
    const outId = publicState.roundResult.outPlayerId
    const outName = outId === localPlayerId ? 'You' : (names[outId] ?? outId)
    return `${outName} went out — round over.`
  }
  if (publicState.stage === 'over') {
    const winnerId = publicState.matchWinnerId
    if (winnerId === null) return 'Match over.'
    return winnerId === localPlayerId ? 'You won the match!' : `${names[winnerId] ?? winnerId} won the match!`
  }
  if (publicState.unoWindow !== null) {
    const vulnId = publicState.unoWindow.playerId
    return vulnId === localPlayerId
      ? 'You have UNO! Call it before someone catches you.'
      : `${names[vulnId] ?? vulnId} has UNO!`
  }
  const currentId = currentPlayer(publicState.turn)
  if (publicState.pendingSevenSwap !== null) {
    return isMyTurn ? 'Choose a player to swap hands with.' : `${names[currentId] ?? currentId} is choosing a swap target…`
  }
  if (publicState.pendingWild !== null) {
    return isMyTurn ? 'Choose a color to finish your play.' : `${names[currentId] ?? currentId} is choosing a color…`
  }
  if (!isMyTurn) return `${names[currentId] ?? currentId} is thinking…`
  if (publicState.hasDrawnThisTurn) return 'Play the card you drew, or pass.'
  return hasPlayable ? 'Play a card, or draw if you can’t.' : 'No playable cards — click the deck to draw.'
}

function computeRoundBanner(
  publicState: UnoPublicState,
  localPlayerId: string,
  names: Record<string, string>,
): string {
  if (publicState.stage === 'over') {
    const winnerId = publicState.matchWinnerId
    if (winnerId === null) return ''
    const winnerName = winnerId === localPlayerId ? 'You' : (names[winnerId] ?? winnerId)
    return `${winnerName} won the match with ${publicState.scores[winnerId] ?? 0} points!`
  }
  if (publicState.roundResult === null) return 'Round blocked — no cards left to draw.'
  const outId = publicState.roundResult.outPlayerId
  const outName = outId === localPlayerId ? 'You' : (names[outId] ?? outId)
  // pointsAdded[outPlayerId] is ALWAYS 0 by contract (it records each OTHER
  // player's contribution). Sum every entry to get the out-player's gain.
  const gained = Object.values(publicState.roundResult.pointsAdded).reduce((a, b) => a + b, 0)
  return `${outName} went out and scored ${gained} points!`
}

// ---- UnoTable ----

export function UnoTable({
  code,
  localPlayerId,
  names,
  colors,
  connection,
  notice,
  publicState,
  hand,
  onPlayCard,
  onChooseColor,
  onChooseSwapTarget,
  onDraw,
  onPass,
  onCallUno,
  onStartNextRound,
  onOpenRules,
  onLeave,
}: UnoTableProps) {
  // ---- Derived ----
  const isMyTurn = currentPlayer(publicState.turn) === localPlayerId
  // Same bot-id convention as every other multi-seat game in this codebase.
  const humanCount = publicState.seatOrder.filter((id) => !id.startsWith('bot')).length
  const top = topCard(publicState.discardPile)
  const hasPlayable = top !== undefined && handHasLegalPlay(hand, top, publicState.activeColor)
  const canAct = isMyTurn && publicState.stage === 'play'
  const canDraw = canAct && publicState.pendingWild === null && publicState.pendingSevenSwap === null && (publicState.pendingStack !== null || (!publicState.hasDrawnThisTurn && !hasPlayable))
  const showColorPicker = canAct && publicState.pendingWild !== null
  const showSwapTargetPicker = canAct && publicState.pendingSevenSwap !== null
  // pendingStack check is redundant: hasDrawnThisTurn is false while a stack is pending (set together in rules.ts,
  // see the PLAY_CARD draw2 branch and the CHOOSE_COLOR wild4 branch in rules.ts), so it's already enforced above.
  // Kept for defensive clarity that showPass must be false during a stack.
  const showPass = canAct && publicState.hasDrawnThisTurn && publicState.pendingWild === null && publicState.pendingSevenSwap === null && publicState.pendingStack === null
  const targetText = `first to ${UNO_TARGET}`
  const catchStaggered = useCatchStagger(publicState.unoWindow, localPlayerId)

  // ---- Local state ----
  const { play, enabled, setEnabled, turnSoundEnabled, setTurnSoundEnabled, playTurnStart } = useSound()
  useTurnStartSound(isMyTurn, humanCount, playTurnStart)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Card ids already shown face-up. New ids that arrive from someone ELSE's
  // draw2/wild4 stay out of this set until the local player reveals them.
  const [knownCardIds, setKnownCardIds] = useState<Set<string>>(() => new Set(hand.map((c) => c.id)))

  // Fresh-round detection: show the deal intro exactly once per distinct
  // round this component instance ever sees.
  const introShownForRoundRef = useRef<number | null>(null)
  const [showIntro, setShowIntro] = useState(false)

  const revealPrevRoundRef = useRef(publicState.round)
  const revealPrevHandLenRef = useRef(hand.length)

  // ---- Effects ----
  // Show the deal intro on mount and on every START_NEXT_ROUND transition;
  // never re-fires for the same round on an unrelated re-render.
  useEffect(() => {
    if (introShownForRoundRef.current !== publicState.round) {
      introShownForRoundRef.current = publicState.round
      setShowIntro(true)
    }
  }, [publicState.round])

  // Clear the selection whenever it stops being valid: the selected card
  // leaves the hand, the turn changes, a wild color picker opens, a stack
  // becomes pending (blocking non-matching cards), the discard top/active
  // color makes it illegal, or the stage leaves 'play'. Keep this logic in
  // sync with cardClickable to prevent divergence.
  useEffect(() => {
    setSelectedId((prev) => {
      if (prev === null) return null
      const card = hand.find((c) => c.id === prev)
      if (!card) return null
      if (!canAct || publicState.pendingWild !== null || top === undefined) return null
      // While a stack is pending, only matching cards remain valid
      if (publicState.pendingStack !== null && card.kind !== publicState.pendingStack.kind) return null
      if (!isUnoPlayable(card, top, publicState.activeColor)) return null
      return prev
    })
  }, [hand, canAct, publicState.pendingWild, publicState.pendingStack, top, publicState.activeColor])

  // Forced-draw reveal gate (spec 34h §8) — purely client-side presentation.
  // The engine already put the drawn cards in the hand; we only delay SHOWING
  // them face-up. Own deliberate DRAW_CARDs reveal immediately; a fresh round
  // is fully revealed by the DealIntro.
  useEffect(() => {
    const roundChanged = publicState.round !== revealPrevRoundRef.current
    const handGrew = hand.length > revealPrevHandLenRef.current
    const lastAction = publicState.lastAction
    const ownDraw = lastAction !== null && lastAction.kind === 'draw' && lastAction.by === localPlayerId

    if (roundChanged) {
      setKnownCardIds(new Set(hand.map((c) => c.id)))
    } else if (handGrew && ownDraw) {
      // My own deck draw — already required a click, no double gating.
      setKnownCardIds((prev) => {
        const next = new Set(prev)
        for (const c of hand) next.add(c.id)
        return next
      })
    } else {
      // Hand shrank (prune played ids) OR a forced draw grew it (leave the
      // new ids unknown so they render face-down until revealed).
      setKnownCardIds((prev) => {
        const currentIds = new Set(hand.map((c) => c.id))
        const kept = new Set([...prev].filter((id) => currentIds.has(id)))
        return kept.size === prev.size ? prev : kept
      })
    }

    revealPrevRoundRef.current = publicState.round
    revealPrevHandLenRef.current = hand.length
  }, [hand, publicState.round, publicState.lastAction, localPlayerId])

  // ---- Sounds ----
  // Diff room-state transitions, but only for my own actions (never for an
  // opponent's turn — otherwise a fast bot spams sound), the same
  // soundSigRef pattern Rummy/Phase10 use. Stock up = a fresh deal
  // (shuffle); discard growing = a play; stock shrinking = cards drawn.
  const stockCount = publicState.stockCount
  const discardLen = publicState.discardPile.cards.length
  const actionSig = lastActionSignature(publicState.lastAction)
  const soundSigRef = useRef({
    stockCount, discardLen,
    stage: publicState.stage, matchWinnerId: publicState.matchWinnerId, wasMyTurn: isMyTurn,
    round: publicState.round, handLen: hand.length,
    unoWindowPlayerId: publicState.unoWindow?.playerId ?? null,
    actionSig,
  })
  const noticeSeenRef = useRef(!!notice)

  useEffect(() => {
    const p = soundSigRef.current
    const roundChanged = publicState.round !== p.round
    const la = publicState.lastAction

    // While the deal-intro overlay is showing, the real table (and this
    // effect) still runs every render underneath it — bot turns don't pause
    // for a client-side animation. Playing sounds for actions the player
    // can't see yet, or catching up on all of them at once the instant the
    // overlay drops, both read as broken. So: keep the ref baseline current
    // every render (below), but skip every play() call while showIntro is
    // true — nothing "catches up" once it closes, since the baseline never
    // fell behind.
    if (!showIntro) {
      // Own-action diffs — draws always use the same generic 'card-draw'
      // every other card game uses; there is no Uno-specific "I drew"
      // sound. (uno-draw is reserved for draw-two/wild-four landing, below,
      // heard by everyone at the table, not just the drawer.)
      if (p.wasMyTurn) {
        if (stockCount > p.stockCount) {
          play('shuffle')
        } else if (discardLen > p.discardLen) {
          play('card-play')
        } else if (stockCount < p.stockCount) {
          // When the stock shrank because I resolved a draw2/wild4, the NEXT
          // player drew those cards, not me — suppress my own draw sound
          // (the action-flavored block below already covers that landing).
          const drewForNext = la !== null && la.kind === 'play' && la.by === localPlayerId && la.drewCount > 0
          if (!drewForNext) play('card-draw')
        }
      }

      // Action-flavored sounds — everyone witnesses a skip/reverse/wild/draw
      // landing, once per distinct new play. A wild4 plays BOTH uno-wild and
      // uno-draw together (it's simultaneously a color choice and a forced
      // draw); a plain draw2 plays only uno-draw.
      if (!roundChanged && actionSig !== p.actionSig && la !== null && la.kind === 'play' && la.card !== null) {
        if (la.card.kind === 'skip') play('uno-skip')
        else if (la.card.kind === 'reverse') play('uno-reverse')
        else if (la.card.kind === 'wild') play('uno-wild')
        else if (la.card.kind === 'wild4') { play('uno-wild'); play('uno-draw') }
        else if (la.card.kind === 'draw2') play('uno-draw')
      }

      // Uno-window sounds.
      const windowClosed = p.unoWindowPlayerId !== null && publicState.unoWindow === null && publicState.stage === 'play' && !roundChanged
      if (windowClosed) {
        // Caught: MY window closed while my hand grew by exactly 2 with no new
        // lastAction — a CALL_UNO catch. (A draw2/wild4 would change lastAction.)
        const caughtMe = p.unoWindowPlayerId === localPlayerId && hand.length - p.handLen === 2 && actionSig === p.actionSig
        // Self-call: a window closed with NO other state change at all.
        const selfCall = !caughtMe && actionSig === p.actionSig && stockCount === p.stockCount && discardLen === p.discardLen
        if (caughtMe) play('uno-called-on')
        else if (selfCall) play('uno-call')
      }

      if (p.stage !== 'roundOver' && publicState.stage === 'roundOver' && publicState.roundResult !== null) {
        play('round-win')
      }
      if (p.matchWinnerId === null && publicState.matchWinnerId !== null) {
        play('game-win')
      }
      if (notice && !noticeSeenRef.current) {
        play('error')
        noticeSeenRef.current = true
      } else if (!notice) {
        noticeSeenRef.current = false
      }
    }

    soundSigRef.current = {
      stockCount, discardLen,
      stage: publicState.stage, matchWinnerId: publicState.matchWinnerId, wasMyTurn: isMyTurn,
      round: publicState.round, handLen: hand.length,
      unoWindowPlayerId: publicState.unoWindow?.playerId ?? null,
      actionSig,
    }
  }, [stockCount, discardLen, publicState.stage, publicState.roundResult, publicState.matchWinnerId, publicState.unoWindow, publicState.lastAction, publicState.round, isMyTurn, notice, hand.length, localPlayerId, actionSig, play, showIntro])

  // ---- Computed ----
  const sortedHand = useMemo(() => sortUnoHand(hand), [hand])
  const unrevealedIds = useMemo(
    () => hand.filter((c) => !knownCardIds.has(c.id)).map((c) => c.id),
    [hand, knownCardIds],
  )
  const logLine = useMemo(
    () => formatLastAction(publicState.lastAction, localPlayerId, names, publicState.houseRules.sevenZero),
    [publicState.lastAction, localPlayerId, names, publicState.houseRules.sevenZero],
  )
  const status = useMemo(
    () => computeStatus(publicState, isMyTurn, localPlayerId, names, hasPlayable),
    [publicState, isMyTurn, localPlayerId, names, hasPlayable],
  )
  const roundBanner = useMemo(
    () => (publicState.stage === 'roundOver' || publicState.stage === 'over'
      ? computeRoundBanner(publicState, localPlayerId, names)
      : null),
    [publicState, localPlayerId, names],
  )
  const handHint = (() => {
    if (publicState.stage !== 'play' || !isMyTurn) return null
    if (publicState.pendingSevenSwap !== null) return 'Choose a player to swap hands with.'
    if (publicState.pendingWild !== null) return 'Choose a color to finish your play.'
    if (publicState.hasDrawnThisTurn) return 'Play the card you drew, or pass.'
    if (unrevealedIds.length > 0) return 'Reveal the drawn cards first.'
    return hasPlayable ? 'Select a card to play.' : 'No playable cards — click the deck to draw.'
  })()

  // Client-side legality prediction only — the host is still the authority
  // and rejects an illegally-timed draw/play regardless. The card's onClick
  // is either wired or omitted entirely (per spec 34d, no opacity/ring
  // styling differs, only whether a click handler exists).
  const cardClickable = (card: UnoCard): boolean => {
    if (!canAct || publicState.pendingWild !== null || publicState.pendingSevenSwap !== null || top === undefined) return false
    // While a stack is pending, only matching cards are clickable
    if (publicState.pendingStack !== null) {
      return card.kind === publicState.pendingStack.kind
    }
    // Normal playability check
    return isUnoPlayable(card, top, publicState.activeColor)
  }

  // Per-seat Uno-call enable logic (client-side only; the host does not
  // enforce timing — see spec 34b). No window for this seat → always gray.
  // My own window → enabled immediately. Someone else's window → enabled
  // only after the 1s catch stagger.
  const unoCallDisabled = (seatPlayerId: string): boolean => {
    if (publicState.unoWindow === null || publicState.unoWindow.playerId !== seatPlayerId) return true
    if (seatPlayerId === localPlayerId) return false
    return !catchStaggered
  }

  // ---- Handlers ----
  const handleCardClick = useCallback((cardId: string) => {
    setSelectedId((prev) => (prev === cardId ? null : cardId))
  }, [])

  const handlePlay = useCallback(() => {
    if (selectedId === null) return
    onPlayCard(selectedId)
    setSelectedId(null)
  }, [onPlayCard, selectedId])

  const handleReveal = useCallback((clickedCardId?: string) => {
    setKnownCardIds(new Set(hand.map((c) => c.id)))
    if (clickedCardId !== undefined) {
      const card = hand.find((c) => c.id === clickedCardId)
      if (card && cardClickable(card)) setSelectedId(clickedCardId)
    }
  }, [hand, cardClickable])

  // ---- Render ----
  const opponentIds = publicState.seatOrder.filter((id) => id !== localPlayerId)
  const others = publicState.seatOrder
    .filter((id) => id !== localPlayerId)
    .map((id) => ({
      id,
      name: names[id] ?? id,
      color: colors[id] ?? 'var(--slate-pip)',
      handSize: publicState.handCounts[id] ?? 0,
    }))

  return (
    <div className="uno-table">
      {/* Header */}
      <div className="uno-header">
        <div className="uno-header-left">
          <Wordmark small onClick={onLeave} />
          <span className="uno-game-label">Uno</span>
          <span className="uno-peer-strip">
            <span
              className="uno-peer-dot"
              style={{ background: connection === 'connected' ? 'var(--green)' : 'var(--coral)' }}
            />
            <span className="uno-peer-label">
              {connection === 'connected' ? 'Live' : 'Connection lost'}
            </span>
          </span>
        </div>
        <div className="uno-header-actions">
          <TurnSoundToggle enabled={turnSoundEnabled} onToggle={() => setTurnSoundEnabled(!turnSoundEnabled)} />
          <SoundToggle enabled={enabled} onToggle={() => setEnabled(!enabled)} />
          <button type="button" className="btn pill-small" onClick={onOpenRules}>Rules</button>
          <button type="button" className="btn btn-ghost" onClick={onLeave}>Leave</button>
        </div>
      </div>

      {/* Code chip */}
      <div style={{ marginBottom: 'clamp(16px, 2.4vw, 26px)' }}>
        <span className="chip" style={{ background: 'var(--yellow)', color: 'var(--ink)' }}>Uno · {code}</span>
      </div>

      {/* Error banner */}
      {notice && <div className="uno-error-banner">{notice}</div>}

      {/* Main table card: the board column with the rail to its right.
          row-reverse puts the rail (DOM-first of the row pair) on the table's
          right while keeping wrap order — on narrow screens the rail wraps
          back to its own row above the board column. */}
      <div className="uno-table-card">
        {showIntro ? (
          <DealIntro
            others={others}
            yourHandSize={hand.length}
            shuffleSound="shuffle"
            renderCardBack={(p) => <UnoCardBack {...p} design={publicState.cardBack} />}
            onComplete={() => setShowIntro(false)}
            // Default cap (10) truncates well short of a real deal once seat
            // count × UNO_HAND_SIZE (7) grows past a couple of players — the
            // rest of the hand would silently pop in the instant the capped
            // animation ends. Pass the real total so every card gets a flight.
            maxFlights={hand.length + others.reduce((sum, o) => sum + o.handSize, 0)}
          />
        ) : (
        <>
        {/* Right rail: scoreboard + turn log + status */}
        <div className="uno-rail">
          <span className="uno-rail-caption">Round {publicState.round + 1} · {targetText}</span>

          <div className="uno-scoreboard">
            {publicState.seatOrder.map((pid) => {
              const isTurn = pid === currentPlayer(publicState.turn)
              const color = colors[pid] ?? 'var(--slate-pip)'
              const isVulnerable = publicState.unoWindow?.playerId === pid
              const sub = isTurn
                ? (pid === localPlayerId ? 'your turn' : 'their turn')
                : isVulnerable
                  ? 'has UNO!'
                  : targetText
              return (
                <div
                  key={pid}
                  className={`uno-score-row${isTurn ? ' uno-score-row--turn' : ''}`}
                  style={isTurn ? { background: color, borderColor: color, color: '#fff' } : undefined}
                >
                  <span
                    className="uno-seat-dot"
                    style={isTurn
                      ? { background: '#fff', borderColor: 'rgba(255, 255, 255, 0.85)' }
                      : { background: color }}
                  />
                  <div className="uno-score-info">
                    <span className="uno-score-name">{names[pid] ?? pid}{pid === localPlayerId ? ' (you)' : ''}</span>
                    <span className="uno-score-sub">{sub}</span>
                  </div>
                  <span className="uno-score-value">{publicState.scores[pid] ?? 0}</span>
                </div>
              )
            })}
          </div>

          <div className="uno-log">
            <span className="uno-rail-title">Turn log</span>
            <span className="uno-log-line">{logLine}</span>
          </div>

          <div className="uno-status">{status}</div>
        </div>

        {/* Board column: opponents, deck + discard, your hand */}
        <div className="uno-board-col">
          {/* Round-over banner — this screen renders the state and the
              continue button; pacing/auto-advance belongs to the wiring
              layer (spec 34f), same separation as every sibling Table. */}
          {roundBanner !== null && (
            <div className="uno-round-banner">
              <span>{roundBanner}</span>
              {publicState.stage === 'roundOver' && (
                <button type="button" className="btn pill-small" onClick={onStartNextRound}>
                  Next round
                </button>
              )}
            </div>
          )}

          {/* Opponent tiles: a wrapping grid, 3 compact tiles per row; the
              current seat's tile is filled with the seat color + a turn tag */}
          <div className="uno-opp-rail">
            {opponentIds.map((seatId) => {
              const color = colors[seatId] ?? 'var(--slate-pip)'
              const isTurn = seatId === currentPlayer(publicState.turn)
              const count = publicState.handCounts[seatId] ?? 0
              // Visual cap for the compact tile (Rummy/Phase10 fan 14 on their
              // full-width rows); the count label carries the real number.
              const stackCount = Math.min(count, 8)
              return (
                <div
                  key={seatId}
                  className={`uno-opp-tile${isTurn ? ' uno-opp-tile--turn' : ''}`}
                  style={isTurn ? { background: color, borderColor: color, color: '#fff' } : undefined}
                >
                  <div className="uno-opp-tile-top">
                    <span
                      className="uno-seat-dot"
                      style={isTurn
                        ? { background: '#fff', borderColor: 'rgba(255, 255, 255, 0.85)' }
                        : { background: color }}
                    />
                    <span className="uno-opp-name" style={isTurn ? undefined : { color }}>{names[seatId] ?? seatId}</span>
                    {isTurn && <span className="uno-turn-tag" style={{ background: '#fff', color: 'var(--ink)' }}>turn</span>}
                  </div>
                  <div className="uno-opp-tile-bottom">
                    <div className="uno-opp-stack">
                      {Array.from({ length: stackCount }, (_, i) => (
                        <UnoCardBack key={i} size="small" design={publicState.cardBack} />
                      ))}
                    </div>
                    <span className="uno-opp-count">{count} cards</span>
                    <UnoCallButton
                      disabled={unoCallDisabled(seatId)}
                      onClick={() => onCallUno(seatId)}
                      ariaLabel={`Call UNO on ${names[seatId] ?? seatId}`}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Centre band: deck + discard, and the color picker when a wild
              is pending on YOUR turn (the only time this screen shows it) */}
          <div className="uno-centre">
            <div className="uno-centre-left">
              <div className="uno-stock-group">
                <div className="uno-stock-caption">
                  stock {publicState.stockCount} · {publicState.pendingStack !== null ? `Draw ${publicState.pendingStack.total}` : (publicState.houseRules.drawUntilPlayable ? 'Draw until you can play' : 'Draw a card')}
                </div>
                <div className="uno-stock-card-wrapper">
                  <UnoCardBack
                    size="stock"
                    design={publicState.cardBack}
                    onClick={canDraw ? onDraw : undefined}
                    disabled={!canDraw}
                  />
                </div>
              </div>

              <div className="uno-discard-group">
                <div className="uno-discard-caption">
                  Discard · {publicState.discardPile.cards.length} {publicState.discardPile.cards.length === 1 ? 'card' : 'cards'}
                </div>
                <div className="uno-discard-slot">
                  {top ? (
                    <UnoCardFace card={top} size="discard" activeColor={publicState.activeColor} />
                  ) : (
                    <span className="uno-discard-empty">Discard pile empty</span>
                  )}
                </div>
              </div>
            </div>

            {showColorPicker && (
              <div className="uno-centre-right">
                <div className="uno-color-picker">
                  <span className="uno-color-picker-label">Choose a color</span>
                  <div className="uno-color-swatches">
                    {COLOR_SWATCHES.map(({ color, hex }) => (
                      <button
                        key={color}
                        type="button"
                        className="uno-color-swatch"
                        style={{ background: hex }}
                        onClick={() => onChooseColor(color)}
                        aria-label={`Choose ${color}`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {showSwapTargetPicker && (
              <div className="uno-centre-right">
                <div className="uno-color-picker">
                  <span className="uno-color-picker-label">Choose a player to swap with</span>
                  <div className="uno-color-swatches">
                    {others.map(({ id, name, color }) => (
                      <div key={id} className="uno-swap-target-button">
                        <button
                          type="button"
                          className="uno-color-swatch"
                          style={{ background: color }}
                          onClick={() => onChooseSwapTarget(id)}
                          aria-label={`Swap with ${name}`}
                          title={name}
                        />
                        <span className="uno-swap-target-name">{name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Your hand */}
          <div className="uno-hand-section">
            <div className="uno-hand-header">
              <div className="uno-hand-header-left">
                <span className="uno-hand-label">Your hand</span>
                <span className="uno-hand-stats">{hand.length} {hand.length === 1 ? 'card' : 'cards'}</span>
              </div>
              <UnoCallButton
                disabled={unoCallDisabled(localPlayerId)}
                onClick={() => onCallUno(localPlayerId)}
                ariaLabel="Call your own UNO"
              />
            </div>

            <div className="uno-hand-fan">
              {sortedHand.map((card) => {
                if (unrevealedIds.includes(card.id)) {
                  // Face-down until the local player reveals the forced draw.
                  return (
                    <UnoCardBack
                      key={card.id}
                      size="hand"
                      design={publicState.cardBack}
                      onClick={() => handleReveal(card.id)}
                    />
                  )
                }
                const clickable = cardClickable(card)
                return (
                  <UnoCardFace
                    key={card.id}
                    card={card}
                    size="hand"
                    selected={selectedId === card.id}
                    onClick={clickable ? () => handleCardClick(card.id) : undefined}
                  />
                )
              })}
            </div>

            {(showPass || selectedId !== null || unrevealedIds.length > 0 || handHint !== null) && (
              <div className="uno-actions">
                {selectedId !== null && (
                  <button type="button" className="btn uno-action-btn uno-play-btn" onClick={handlePlay}>Play</button>
                )}
                {showPass && (
                  <button type="button" className="btn uno-action-btn" onClick={onPass}>Pass</button>
                )}
                {unrevealedIds.length > 0 && (
                  <button type="button" className="btn uno-action-btn uno-reveal-btn" onClick={() => handleReveal()}>
                    Reveal {unrevealedIds.length} {unrevealedIds.length === 1 ? 'card' : 'cards'}
                  </button>
                )}
                {handHint !== null && <span className="uno-action-hint">{handHint}</span>}
              </div>
            )}
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  )
}
