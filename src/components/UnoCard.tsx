import type { JSX } from 'react'
import type { UnoCard, UnoColor } from '../card-games/uno/deck.ts'
import { findCardBack, cardBackImageStyle } from './cardBacks'
import './UnoCard.css'

// ---- UnoCardFace ----
//
// Coloured rounded-rect card. Bold corner value top-left and mirrored
// bottom-right (a real 180°-rotated duplicate — Uno's physical cards print
// both, so the card reads correctly from either end), big centre symbol on a
// tilted white badge circle. Wild cards swap the solid colour for Phase10's
// four-stop diagonal gradient and carry a single "WILD"/"+4" text label
// instead of corner marks (an earlier star-glyph draft read as unclear).
//
// Playability-agnostic: whether a card may be played is the caller's decision
// (spec 34e), expressed only by wiring an onClick or not — no opacity dimming,
// no highlight ring (both were tried and reverted in the prototype).

// Action-card corner/center marks — the handoff's real symbols, not word labels.
const ACTION_MARKS: Record<'skip' | 'reverse' | 'draw2', string> = {
  skip: '\u2298',
  reverse: '\u21c4',
  draw2: '+2',
}

export function UnoCardFace({
  card,
  size,
  activeColor,
  selected,
  onClick,
}: {
  card: UnoCard
  size: 'hand' | 'discard'
  /**
   * Discard-pile top card only. When the top card is a wild (color 'wild')
   * whose color has already been chosen, render it in that chosen solid
   * color instead of the generic wild gradient — the WILD/+4 label stays.
   * Never passed for hand cards: a wild still in a hand has no assigned
   * color yet.
   */
  activeColor?: UnoColor
  selected?: boolean
  onClick?: () => void
}): JSX.Element {
  // A wild on the discard pile whose color was chosen shows that color (the
  // generic gradient is only for wilds that haven't been colored yet).
  const faceColor = card.color === 'wild' && activeColor !== undefined ? activeColor : card.color
  const cls = [
    'uno-card-face',
    `uno-card-face--${size}`,
    `uno-card-face--${faceColor}`,
    selected && 'uno-card-face--selected',
  ]
    .filter(Boolean)
    .join(' ')

  const ariaLabel =
    card.kind === 'number'
      ? `${card.value}, ${card.color}`
      : card.kind === 'skip'
        ? `Skip, ${card.color}`
        : card.kind === 'reverse'
          ? `Reverse, ${card.color}`
          : card.kind === 'draw2'
            ? `Draw two, ${card.color}`
            : card.kind === 'wild'
              ? 'Wild'
              : 'Wild draw four'
  const finalAriaLabel = selected ? `${ariaLabel}, selected` : ariaLabel

  const renderContent = () => {
    switch (card.kind) {
      case 'number':
      case 'skip':
      case 'reverse':
      case 'draw2': {
        const mark = card.kind === 'number' ? String(card.value) : ACTION_MARKS[card.kind]
        return (
          <>
            <span className="uno-card-face__corner">{mark}</span>
            <span className="uno-card-face__corner uno-card-face__corner--flipped">
              {mark}
            </span>
            <span className="uno-card-face__badge">
              <span className="uno-card-face__center-symbol">{mark}</span>
            </span>
          </>
        )
      }
      case 'wild':
      case 'wild4':
        return (
          <span className="uno-card-face__badge">
            <span className="uno-card-face__center-label">
              {card.kind === 'wild4' ? '+4' : 'WILD'}
            </span>
          </span>
        )
    }
  }

  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={!onClick}
      aria-label={finalAriaLabel}
    >
      {renderContent()}
    </button>
  )
}

// ---- UnoCardBack ----
//
// `stock` (the draw pile) is the only interactive size: the caller wires an
// onClick when drawing is legal and the border turns gold via a class swap
// (Phase10CardBack's canDraw mechanic); `fan`/`small` are static face-down
// displays, and `hand` is a face-down card inside the player's OWN fan (the
// forced-draw reveal gate) — clickable to reveal. The art itself comes from
// the shared card-back registry (components/cardBacks.ts) — same design id,
// same images, as every other card game's back.

export function UnoCardBack({
  size,
  design,
  onClick,
  disabled,
  style,
  className,
}: {
  size: 'fan' | 'stock' | 'small' | 'hand'
  /** Design id from components/cardBacks.ts. Omitted or unknown → plain ink. */
  design?: string
  onClick?: () => void
  /**
   * Stock only. Explicit "draw is not legal right now" signal, separate from
   * omitting onClick — the stock pile is always rendered (with its count),
   * so the caller may pass disabled instead of leaving onClick unwired.
   * Phase10CardBack's `disabled={!onClick}` rule still applies underneath.
   */
  disabled?: boolean
  /** DealIntro and the fan renderers pass positioning via style/className. */
  style?: React.CSSProperties
  className?: string
}): JSX.Element {
  // Phase10CardBack's interplay: the button is disabled whenever no onClick
  // is wired; the gold "may draw" ring is a CSS modifier class swap, not a
  // separately-rendered ring element. The explicit `disabled` ORs in on top.
  const isDisabled = disabled || !onClick
  const backDef = findCardBack(design)

  const cls = [
    'uno-card-back',
    `uno-card-back--${size}`,
    size === 'stock' && !isDisabled && 'uno-card-back--can-draw',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  const imageStyle: React.CSSProperties = backDef ? cardBackImageStyle(backDef) : {}

  return (
    <button
      type="button"
      className={cls}
      style={{ ...imageStyle, ...style }}
      onClick={onClick}
      disabled={isDisabled}
      aria-label={size === 'stock' ? 'Stock pile' : 'Face-down card'}
    />
  )
}
