export function DominoesRulesOverlay({ onClose }: { onClose: () => void }) {
  const bullets = [
    'Double-six set, seven tiles each. The starter may lead any tile — leading a double makes it a spinner with all four sides open.',
    'Each tile must match the open end it extends. Doubles sit crosswise.',
    'Score whenever your play makes the open ends total a multiple of five — a double counts both its halves, and an untouched spinner counts once.',
    'No play? Draw from the boneyard until you can play — a playable draw must be played. Knock (pass) only when the boneyard is empty.',
    'Two knocks in a row block the round: the player with fewer remaining pips banks both hands\u2019 pips, rounded down to fives. Going out banks your opponent\u2019s pips the same way.',
    'First to 150 wins the match.',
  ]

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: '#5b5bd6' }}>
            All Fives — how to play
          </h2>
          <button type="button" className="btn pill-small" onClick={onClose}>Close</button>
        </div>
        <p style={{ color: 'var(--body-text)', lineHeight: 1.5, marginTop: 14 }}>
          Match the open ends, score multiples of five, go out or block the round. Two players, double-six set.
        </p>
        <ul style={{ marginTop: 16, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bullets.map((b) => (
            <li key={b} style={{ display: 'flex', gap: 10, fontSize: 15, lineHeight: 1.5, color: 'var(--body-text)' }}>
              <span style={{ color: '#5b5bd6' }}>●</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
