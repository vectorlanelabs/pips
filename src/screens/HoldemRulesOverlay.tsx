export function HoldemRulesOverlay({ onClose }: { onClose: () => void }) {
  const bullets = [
    'Starting chips: 1000. Small blind: 5, big blind: 10.',
    'No-limit betting: wager any amount from 1 chip to your entire stack.',
    'A raise must be at least as large as the previous bet or raise.',
    'All-in players (out of chips) can win their own pot only; side pots split among remaining players.',
    'Showdown reveals only the non-folded hands competing for each pot.',
  ]

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: 'var(--coral)' }}>
            Texas Hold'em rules
          </h2>
          <button type="button" className="btn pill-small" onClick={onClose}>Close</button>
        </div>
        <p style={{ color: 'var(--body-text)', lineHeight: 1.5, marginTop: 14 }}>
          Make the best five-card hand from your two hole cards and five community cards. Multiple players compete for a shared pot.
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
