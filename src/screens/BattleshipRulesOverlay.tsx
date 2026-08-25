export function BattleshipRulesOverlay({ onClose }: { onClose: () => void }) {
  const bullets = [
    'Place your five ships on your grid: Carrier (5), Battleship (4), Cruiser (3), Submarine (3), Destroyer (2). Rotate with the button or spacebar. Ships may touch — there’s no no-touch rule here.',
    'Take turns firing one shot at the enemy waters. Hit or miss, the turn passes.',
    'A ship goes down when every one of its squares is hit — sinking it scores you a point and reveals its shape.',
    'Your fleet panel shows your true damage; the enemy\u2019s only lights up as you sink their ships.',
    'Sink all five enemy ships to win the match.',
    'Three ways to play \u2014 Standard (one shot each), Make it take it (keep firing while you hit), Free-for-all (no turns; first to sink all five wins).',
  ]

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: '#1a6fae' }}>
            Battleship — how to play
          </h2>
          <button type="button" className="btn pill-small" onClick={onClose}>Close</button>
        </div>
        <p style={{ color: 'var(--body-text)', lineHeight: 1.5, marginTop: 14 }}>
          Classic naval combat, two players, one fleet each. Out-think your rival and sink every ship.
        </p>
        <ul style={{ marginTop: 16, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bullets.map((b) => (
            <li key={b} style={{ display: 'flex', gap: 10, fontSize: 15, lineHeight: 1.5, color: 'var(--body-text)' }}>
              <span style={{ color: '#1a6fae' }}>●</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
