import type { Suit, Rank } from '../card-engine/cards'
import { findCardBack } from './cardBacks'
import './PlayingCard.css'

// ---- Suit helpers (exported for M4 reuse in status-line, etc.) ----

const GLYPHS: Record<Suit, string> = {
  clubs: '\u2663',
  diamonds: '\u2666',
  hearts: '\u2665',
  spades: '\u2660',
  joker: '\uD83C\uDCCF',
}

const RED_SUITS = new Set<Suit>(['hearts', 'diamonds'])

export function suitGlyph(suit: Suit): string {
  return GLYPHS[suit]
}

/** Returns a CSS `var(…)` reference: `var(--coral)` for hearts/diamonds, `var(--ink)` otherwise. */
export function suitColor(suit: Suit): string {
  return RED_SUITS.has(suit) ? 'var(--coral)' : 'var(--ink)'
}

const SUIT_NAMES: Record<Suit, string> = {
  clubs: 'Clubs',
  diamonds: 'Diamonds',
  hearts: 'Hearts',
  spades: 'Spades',
  joker: 'Joker',
}

// ---- PlayingCard ----

export type PlayingCardSize = 'hand' | 'meld' | 'discard' | 'tableau'

export interface PlayingCardProps {
  rank: Exclude<Rank, 'JOKER'>
  suit: Exclude<Suit, 'joker'>
  size: PlayingCardSize
  selected?: boolean
  /**
   * Border + shadow base colour for meld cards.
   * Defaults to `var(--green-text)` (“your” meld colour). Ignored for hand / discard.
   */
  ownerColor?: string
  /**
   * Shadow tint override for meld cards.
   * Falls back to `var(--grey-border)` when `ownerColor` is set without this,
   * and to the local `#b7e6d1` green tint when neither is set.
   * Ignored for hand / discard.
   */
  ownerShadow?: string
  className?: string
  style?: React.CSSProperties
  onClick?: () => void
  /** Native HTML5 drag-and-drop — currently used only by Solitaire's tableau. */
  draggable?: boolean
  onDragStart?: (e: React.DragEvent<HTMLButtonElement>) => void
  onDragEnd?: () => void
}

export function PlayingCard({
  rank,
  suit,
  size,
  selected,
  ownerColor,
  ownerShadow,
  className,
  style,
  onClick,
  draggable,
  onDragStart,
  onDragEnd,
}: PlayingCardProps) {
  const cls = [
    'playing-card',
    `playing-card--${size}`,
    selected && 'playing-card--selected',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const customProps: Record<string, string | undefined> = {}
  if (size === 'meld') {
    if (ownerColor) customProps['--card-owner-color'] = ownerColor
    if (ownerShadow) {
      customProps['--card-owner-shadow'] = ownerShadow
    } else if (ownerColor) {
      customProps['--card-owner-shadow'] = 'var(--grey-border)'
    }
  }

  const cardStyle = { ...style, ...customProps } as React.CSSProperties

  const glyph = suitGlyph(suit)
  const color = suitColor(suit)

  const renderContent = () => {
    switch (size) {
      case 'hand':
        return (
          <>
            <span className="playing-card__corner playing-card__corner--stacked" style={{ color }}>
              <span className="playing-card__rank">{rank}</span>
              <span className="playing-card__suit">{glyph}</span>
            </span>
            <span className="playing-card__bottom-suit" style={{ color }}>
              {glyph}
            </span>
          </>
        )
      case 'meld':
        return (
          <span className="playing-card__center" style={{ color }}>
            <span className="playing-card__rank">{rank}</span>
            <span className="playing-card__suit">{glyph}</span>
          </span>
        )
      case 'discard':
        return (
          <>
            <span className="playing-card__corner playing-card__corner--stacked" style={{ color }}>
              <span className="playing-card__rank">{rank}</span>
              <span className="playing-card__suit">{glyph}</span>
            </span>
            <span className="playing-card__bottom-suit playing-card__bottom-suit--discard" style={{ color }}>
              {glyph}
            </span>
          </>
        )
      case 'tableau':
        return (
          <>
            <span className="playing-card__corner playing-card__corner--stacked" style={{ color }}>
              <span className="playing-card__rank">{rank}</span>
              <span className="playing-card__suit">{glyph}</span>
            </span>
            <span className="playing-card__bottom-suit playing-card__bottom-suit--tableau" style={{ color }}>
              {glyph}
            </span>
          </>
        )
    }
  }

  const ariaLabel = selected
    ? `${rank} of ${SUIT_NAMES[suit]}, selected`
    : `${rank} of ${SUIT_NAMES[suit]}`

  return (
    <button
      type="button"
      className={cls}
      style={cardStyle}
      onClick={onClick}
      disabled={!onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-label={ariaLabel}
    >
      {renderContent()}
    </button>
  )
}

// ---- CardBack ----

export type CardBackSize = 'fan' | 'stock' | 'pile'

export interface CardBackProps {
  size: CardBackSize
  /** When true the stock border turns `var(--yellow)` signalling the player may draw. Ignored for fan. */
  canDraw?: boolean
  /** Stock only: renders an empty outline instead of a full pile when the stock has run out. */
  empty?: boolean
  /** Design id from components/cardBacks.ts. Omitted or unknown → the plain violet dot back. */
  design?: string
  /** Overrides the default aria-label (e.g. a 'pile' reused as a stock draw pile). */
  ariaLabel?: string
  className?: string
  style?: React.CSSProperties
  onClick?: () => void
}

export function CardBack({ size, canDraw, empty, design, ariaLabel, className, style, onClick }: CardBackProps) {
  const isEmpty = (size === 'stock' || size === 'pile') && empty
  const backDef = findCardBack(design)
  const cls = [
    'card-back',
    `card-back--${size}`,
    canDraw && 'card-back--can-draw',
    isEmpty && 'card-back--empty',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  const imageStyle: React.CSSProperties =
    backDef && !isEmpty
      ? { backgroundImage: `url(${backDef.image})`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : {}

  return (
    <button
      type="button"
      className={cls}
      style={{ ...imageStyle, ...style }}
      onClick={onClick}
      disabled={!onClick}
      aria-label={ariaLabel ?? (size === 'stock' ? (empty ? 'Stock pile (empty)' : 'Stock pile') : 'Face-down card')}
    >
      {!backDef && size === 'stock' && !empty && <span className="card-back__mark" />}
    </button>
  )
}
