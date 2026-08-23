import type { Card } from '../card-engine/cards'
import type { JSX } from 'react'
import { findCardBack, cardBackImageStyle, DEFAULT_CARD_BACK } from './cardBacks'
import './SkipBoCard.css'

// ---- Skip-Bo number colour lookup ----
//
// The handoff locks three number ranges:
//   1–4  teal  #0fb5a0, white text
//   5–8  amber #ff9f1c, ink text
//   9–12 violet #6c4cff, white text

export function skipBoNumberColor(rank: string): string {
  const n = Number(rank)
  if (n <= 4) return '#0fb5a0'
  if (n <= 8) return '#ff9f1c'
  return '#6c4cff'
}

export function skipBoNumberTextColor(rank: string): string {
  const n = Number(rank)
  return n >= 5 && n <= 8 ? 'var(--ink)' : '#fff'
}

// ---- SkipBoCard ----

export type SkipBoCardSize = 'hand' | 'tile'

export interface SkipBoCardProps {
  card: Card
  size: SkipBoCardSize
  selected?: boolean
  className?: string
  style?: React.CSSProperties
  onClick?: () => void
}

export function SkipBoCard({
  card,
  size,
  selected,
  className,
  style,
  onClick,
}: SkipBoCardProps): JSX.Element {
  const kind = card.meta?.kind === 'wild' ? 'wild' : 'number'
  const rankLabel = kind === 'wild' ? 'SB' : card.rank

  const cls = [
    'skipbo-card',
    `skipbo-card--${size}`,
    kind === 'wild' && 'skipbo-card--wild',
    selected && 'skipbo-card--selected',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const faceStyle: React.CSSProperties =
    kind === 'number'
      ? {
          background: skipBoNumberColor(card.rank),
          '--sb-face-text': skipBoNumberTextColor(card.rank),
        } as React.CSSProperties
      : {}

  const ariaLabel =
    kind === 'number' ? `${card.rank}, Skip-Bo number` : 'Skip-Bo wild'
  const finalAriaLabel = selected ? `${ariaLabel}, selected` : ariaLabel

  // Hand cards are real two-corner playing-card-style faces; the smaller
  // table tiles (building / discard / stockpile) are centred-number tiles.
  const showCorners = size === 'hand'

  return (
    <button
      type="button"
      className={cls}
      style={{ ...style, ...faceStyle }}
      onClick={onClick}
      disabled={!onClick}
      aria-label={finalAriaLabel}
    >
      {showCorners && (
        <>
          <span className="skipbo-card__corner">{rankLabel}</span>
          <span className="skipbo-card__corner skipbo-card__corner--flipped">
            {rankLabel}
          </span>
        </>
      )}
      {kind === 'wild' ? (
        <span className="skipbo-card__wild-badge">
          <span className="skipbo-card__wild-label">SB</span>
        </span>
      ) : (
        <span className="skipbo-card__number">{card.rank}</span>
      )}
    </button>
  )
}

// ---- SkipBoCardBack ----

export type SkipBoCardBackSize = 'fan' | 'stock'

export interface SkipBoCardBackProps {
  size: SkipBoCardBackSize
  /** When true the stock border turns yellow signalling the player may draw. Ignored for fan. */
  canDraw?: boolean
  /** Design id from components/cardBacks.ts. Omitted or unknown → plain navy. */
  design?: string
  className?: string
  style?: React.CSSProperties
  onClick?: () => void
}

export function SkipBoCardBack({
  size,
  canDraw,
  design,
  className,
  style,
  onClick,
}: SkipBoCardBackProps): JSX.Element {
  // Every card back is a real image — an unrecognized/missing id still
  // resolves to a real image (the default's), never a plain-color fallback.
  const backDef = findCardBack(design) ?? findCardBack(DEFAULT_CARD_BACK)
  const cls = [
    'skipbo-card-back',
    `skipbo-card-back--${size}`,
    canDraw && 'skipbo-card-back--can-draw',
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
      disabled={!onClick}
      aria-label={size === 'stock' ? 'Stock pile' : 'Face-down card'}
    />
  )
}
