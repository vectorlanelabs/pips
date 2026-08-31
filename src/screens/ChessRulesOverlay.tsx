const BRAND = '#0891b2'

export function ChessRulesOverlay({ onClose }: { onClose: () => void }) {
  const rows = [
    { label: 'Checkmate', text: 'the side to move has no legal way out of check' },
    { label: 'Stalemate', text: "the side to move has no legal move and isn't in check (a draw)" },
    { label: 'Draw', text: 'by agreement, repetition, the fifty-move rule, or insufficient material' },
  ]

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: BRAND }}>
            Chess rules
          </h2>
          <button type="button" className="btn pill-small" onClick={onClose}>Close</button>
        </div>
        <p style={{ color: 'var(--body-text)', lineHeight: 1.5, marginTop: 14 }}>
          Full standard rules: every piece moves the normal way, including castling, en passant,
          and pawn promotion. Check, checkmate, stalemate, and draws all apply. Resign or offer a
          draw any time it's your move.
        </p>
        <ul style={{ marginTop: 16, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((row) => (
            <li key={row.label} style={{ display: 'flex', gap: 10, fontSize: 15, lineHeight: 1.5, color: 'var(--body-text)' }}>
              <span style={{ color: BRAND }}>●</span>
              <span>
                <strong>{row.label}:</strong> {row.text}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
