import type { Rank, Suit } from '../card-engine/cards'
import { PlayingCard } from './PlayingCard'
import { CardBack } from './PlayingCard'

export interface BlackjackCardProps {
  rank?: Exclude<Rank, 'JOKER'>
  suit?: Exclude<Suit, 'joker'>
  faceUp: boolean
  design?: string
  style?: React.CSSProperties
}

export function BlackjackCard({
  rank,
  suit,
  faceUp,
  design,
  style,
}: BlackjackCardProps) {
  if (faceUp && rank && suit) {
    return (
      <PlayingCard
        rank={rank}
        suit={suit}
        size="hand"
        style={style}
      />
    )
  }

  return (
    <CardBack
      size="stock"
      design={design}
      style={style}
    />
  )
}
