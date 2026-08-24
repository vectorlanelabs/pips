import type { Card } from '../card-engine/cards'
import { PlayingCard } from './PlayingCard'

export interface HoldemBoardProps {
  cards: Card[]
}

const BOARD_SLOTS = 5

export function HoldemBoard({ cards }: HoldemBoardProps) {
  return (
    <div className="holdem-board">
      {Array.from({ length: BOARD_SLOTS }, (_, i) => {
        const card = cards[i]
        if (!card) {
          return <div key={i} className="holdem-board-slot holdem-board-slot--empty" />
        }
        return (
          <PlayingCard
            key={i}
            rank={card.rank as any}
            suit={card.suit as any}
            size="hand"
          />
        )
      })}
    </div>
  )
}
