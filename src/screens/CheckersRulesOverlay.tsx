export function CheckersRulesOverlay({ onClose }: { onClose: () => void }) {
  const rows = [
    { label: 'Capture', text: 'jump an adjacent enemy piece' },
    { label: 'King', text: 'reach the opposite back row' },
    { label: 'Win', text: 'opponent has no pieces or no legal move' },
  ]

  const rules = [
    'Captures are optional, but once you jump, that piece must keep jumping while it can.',
    'Kings move and capture one square in any diagonal direction.',
    'The starter alternates between games.',
  ]

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: '#b45309' }}>
            Checkers rules
          </h2>
          <button type="button" className="btn pill-small" onClick={onClose}>Close</button>
        </div>
        <p style={{ color: 'var(--body-text)', lineHeight: 1.5, marginTop: 14 }}>
          Standard 8×8 checkers, two players, twelve pieces each. Move diagonally on the dark
          squares; jump an adjacent enemy piece to capture it. Reach the far row to crown a piece
          king. First to win 3 games takes the match.
        </p>
        <ul style={{ marginTop: 16, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((row) => (
            <li key={row.label} style={{ display: 'flex', gap: 10, fontSize: 15, lineHeight: 1.5, color: 'var(--body-text)' }}>
              <span style={{ color: '#b45309' }}>●</span>
              <span>
                <strong>{row.label}:</strong> {row.text}
              </span>
            </li>
          ))}
        </ul>
        <div style={{
          marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8,
          background: 'var(--surface-alt)', border: '2px solid var(--grey-border)',
          borderRadius: 14, padding: '12px 16px',
        }}>
          {rules.map((rule) => (
            <p key={rule} style={{ margin: 0, fontSize: 14, fontWeight: 500, lineHeight: 1.5, color: 'var(--muted-text)' }}>
              {rule}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}
