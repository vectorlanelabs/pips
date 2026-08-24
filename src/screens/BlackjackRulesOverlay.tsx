export function BlackjackRulesOverlay({ onClose }: { onClose: () => void }) {
  const bullets = [
    'Starting chips: 1000. Bets: $10–$500 per hand.',
    'Blackjack (21 in two cards) pays 3:2.',
    'Dealer stands on all 17s, including soft 17.',
    'One split per hand. No resplits. No double after split.',
    'Insurance is offered only when the dealer shows an Ace, and pays 2:1.',
  ]

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: 'var(--coral)' }}>
            Blackjack rules
          </h2>
          <button type="button" className="btn pill-small" onClick={onClose}>Close</button>
        </div>
        <p style={{ color: 'var(--body-text)', lineHeight: 1.5, marginTop: 14 }}>
          Get 21 or closer than the dealer, without going over. Multiple players, standard 52-card decks.
        </p>
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
