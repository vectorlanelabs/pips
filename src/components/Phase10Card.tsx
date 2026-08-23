import type { Card } from '../card-engine/cards'
import type { JSX } from 'react'
import { findCardBack, cardBackImageStyle } from './cardBacks'
import './Phase10Card.css'

// ---- Phase 10 color lookup (exported for M4 reuse in non-card UI, e.g. a color-coded phase requirement icon) ----

export const PHASE10_COLORS: Record<'red' | 'blue' | 'green' | 'yellow', string> = {
  red: '#ff5d73',
  blue: '#6c4cff',
  green: '#1aa06d',
  yellow: '#ffd23f',
}

// ---- Phase10Card ----

export type Phase10CardSize = 'hand' | 'group' | 'discard'

export interface Phase10CardProps {
  card: Card
  size: Phase10CardSize
  selected?: boolean
  /**
   * Border + shadow base colour for group cards.
   * Defaults to `var(--green-text)` ("your" group colour). Ignored for hand / discard.
   */
  ownerColor?: string
  /**
   * Shadow tint override for group cards.
   * Falls back to `var(--grey-border)` when `ownerColor` is set without this,
   * and to the local `#b7e6d1` green tint when neither is set.
   * Ignored for hand / discard.
   */
  ownerShadow?: string
  className?: string
  style?: React.CSSProperties
  onClick?: () => void
}

export function Phase10Card({
  card,
  size,
  selected,
  ownerColor,
  ownerShadow,
  className,
  style,
  onClick,
}: Phase10CardProps): JSX.Element {
  const kind = card.meta?.kind

  const cls = [
    'phase10-card',
    `phase10-card--${size}`,
    kind === 'skip' && 'phase10-card--skip',
    kind === 'wild' && 'phase10-card--wild',
    selected && 'phase10-card--selected',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  // Per-owner group colouring — same custom-property pattern as PlayingCard's meld size.
  const customProps: Record<string, string | undefined> = {}
  if (size === 'group') {
    if (ownerColor) customProps['--card-owner-color'] = ownerColor
    if (ownerShadow) {
      customProps['--card-owner-shadow'] = ownerShadow
    } else if (ownerColor) {
      customProps['--card-owner-shadow'] = 'var(--grey-border)'
    }
  }

  // Number tiles carry their colour as an inline background from the exported
  // lookup so M4's non-card UI shares the same hex values.
  const faceStyle: React.CSSProperties =
    kind === 'number'
      ? { background: PHASE10_COLORS[card.suit as 'red' | 'blue' | 'green' | 'yellow'] }
      : {}

  const cardStyle = { ...style, ...faceStyle, ...customProps } as React.CSSProperties

  const ariaLabel =
    kind === 'number'
      ? `${card.rank}, ${card.suit}`
      : kind === 'skip'
        ? 'Skip'
        : 'Wild'
  const finalAriaLabel = selected ? `${ariaLabel}, selected` : ariaLabel

  const renderContent = () => {
    switch (kind) {
      case 'number':
        return (
          <span
            className="phase10-card__number"
            style={{ color: card.suit === 'yellow' ? 'var(--ink)' : '#fff' }}
          >
            {card.rank}
          </span>
        )
      case 'skip':
        return <span className="phase10-card__word">SKIP</span>
      case 'wild':
        return <span className="phase10-card__word">WILD</span>
    }
  }

  return (
    <button
      type="button"
      className={cls}
      style={cardStyle}
      onClick={onClick}
      disabled={!onClick}
      aria-label={finalAriaLabel}
    >
      {renderContent()}
    </button>
  )
}

// ---- Phase10CardBack ----

export type Phase10CardBackSize = 'fan' | 'stock'

export interface Phase10CardBackProps {
  size: Phase10CardBackSize
  /** When true the stock border turns `var(--yellow)` signalling the player may draw. Ignored for fan. */
  canDraw?: boolean
  /** Design id from components/cardBacks.ts. Omitted or unknown → plain ink. */
  design?: string
  className?: string
  style?: React.CSSProperties
  onClick?: () => void
}

export function Phase10CardBack({
  size,
  canDraw,
  design,
  className,
  style,
  onClick,
}: Phase10CardBackProps): JSX.Element {
  const backDef = findCardBack(design)
  const cls = [
    'phase10-card-back',
    `phase10-card-back--${size}`,
    canDraw && 'phase10-card-back--can-draw',
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
