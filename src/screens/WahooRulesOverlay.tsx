export function WahooRulesOverlay({ onClose }: { onClose: () => void }) {
  const bullets = [
    'Four marbles each. Roll a 1 or 6 to bring one out; move the exact count you roll.',
    'Land on an opponent and they go back to base. You can never land on your own marble.',
    'Roll a 6, roll again — but three 6s in a row sends the marble you just moved home.',
    'The center is a shortcut: land on it exactly (one step past a corner on your way around) and leave on a 1 or 6, coming out at the diagonally opposite corner.',
    'Get all four marbles up your home lane to win. Exact counts, no jumping your own.',
    'With three players, one arm sits unused and greyed out for the match — nobody starts there.',
  ]

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: '#9333ea' }}>
            Wahoo — how to play
          </h2>
          <button type="button" className="btn pill-small" onClick={onClose}>Close</button>
        </div>
        <p style={{ color: 'var(--body-text)', lineHeight: 1.5, marginTop: 14 }}>
          Race four marbles around the board and up your home lane. Two to four players, one die.
        </p>
        <ul style={{ marginTop: 16, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bullets.map((b) => (
            <li key={b} style={{ display: 'flex', gap: 10, fontSize: 15, lineHeight: 1.5, color: 'var(--body-text)' }}>
              <span style={{ color: '#9333ea' }}>●</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
