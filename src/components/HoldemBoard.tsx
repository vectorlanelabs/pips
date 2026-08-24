import type { Card } from '../card-engine/cards'
import { PlayingCard } from './PlayingCard'

export interface HoldemBoardProps {
  cards: Card[]
}

export function HoldemBoard({ cards }: HoldemBoardProps) {
  return (
    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'flex-end', flexWrap: 'wrap' }}>
      {cards.map((card, i) => (
        <PlayingCard
          key={i}
          rank={card.rank as any}
          suit={card.suit as any}
          size="hand"
          style={{ fontSize: 11 }}
        />
      ))}
    </div>
  )
}
