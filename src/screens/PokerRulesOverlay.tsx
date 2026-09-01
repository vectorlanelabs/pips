import type { PokerVariant } from '../card-games/poker/state'
import { POKER_VARIANT_LABELS } from './PokerRoom'

const HOLDEM_BULLETS = [
  'Starting chips: 1000. Small blind: 5, big blind: 10.',
  'No-limit betting: wager any amount from 1 chip to your entire stack.',
  'A raise must be at least as large as the previous bet or raise.',
  'All-in players (out of chips) can win their own pot only; side pots split among remaining players.',
  'Showdown reveals only the non-folded hands competing for each pot.',
]

const DRAW_BULLETS: Record<'five-draw' | 'seven-draw', string[]> = {
  'five-draw': [
    'Everyone is dealt 5 cards face down. 2 to 6 players.',
    "Blinds and betting work exactly like Texas Hold'em: small blind 5, big blind 10, no-limit raises.",
    'After the first betting round, each player still in discards up to 3 cards and draws replacements. Standing pat (drawing none) is allowed.',
    'How many cards each player drew is public. The cards are not.',
    "A second betting round follows the draw, then showdown: best five-card hand wins the pot. Side pots work exactly like Hold'em.",
    'Players who are all-in still draw.',
  ],
  'seven-draw': [
    'Everyone is dealt 7 cards face down; your best five play at showdown. 2 to 5 players.',
    "Blinds and betting work exactly like Texas Hold'em: small blind 5, big blind 10, no-limit raises.",
    'After the first betting round, each player still in discards up to 3 cards and draws replacements. Standing pat (drawing none) is allowed.',
    'How many cards each player drew is public. The cards are not.',
    "A second betting round follows the draw, then showdown: best five-card hand wins the pot. Side pots work exactly like Hold'em.",
    'Players who are all-in still draw.',
  ],
}

export function PokerRulesOverlay({
  variant = 'holdem',
  onClose,
}: {
  variant?: PokerVariant
  onClose: () => void
}) {
  const bullets = variant === 'holdem' ? HOLDEM_BULLETS : DRAW_BULLETS[variant]

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: 'var(--coral)' }}>
            {POKER_VARIANT_LABELS[variant]} rules
          </h2>
          <button type="button" className="btn pill-small" onClick={onClose}>Close</button>
        </div>
        {variant === 'holdem' && (
          <p style={{ color: 'var(--body-text)', lineHeight: 1.5, marginTop: 14 }}>
            Make the best five-card hand from your two hole cards and five community cards. Multiple players compete for a shared pot.
          </p>
        )}
        <ul style={{ marginTop: 16, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bullets.map((b) => (
            <li key={b} style={{ display: 'flex', gap: 10, fontSize: 15, lineHeight: 1.5, color: 'var(--body-text)' }}>
              <span style={{ color: 'var(--coral)' }}>●</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
