export function MexicanTrainRulesOverlay({ onClose }: { onClose: () => void }) {
  const rows = [
    { label: 'Round end', text: 'unplayed pips added to your total' },
    { label: 'Going out', text: 'adds 0 for that round' },
    { label: 'Match', text: 'lowest total after 13 rounds wins' },
  ]

  const rules = [
    'You may always play on your own train or the Mexican train.',
    'Another player’s train is only playable when its signal turns green (marked open).',
    'Can’t play? Draw one tile; if it’s still no help, your train opens and your turn passes. If the boneyard is empty, your turn passes automatically.',
    'Playing a double earns you an extra play right away — you stay the active player until you resolve it (play again, or draw/pass if you’re stuck).',
    'The engine drops by one double each round, 12 down to 0.',
  ]

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: '#c2410c' }}>
            How Mexican Train works
          </h2>
          <button type="button" className="btn pill-small" onClick={onClose}>Close</button>
        </div>
        <p style={{ color: 'var(--body-text)', lineHeight: 1.5, marginTop: 14 }}>
          Double-12 set, two to eight players — hands scale with the table (16 tiles at two down to 9 at eight). Each round starts from a double
          'engine' — everyone builds their own train off it, and anyone can play on the shared
          Mexican train. Lowest total pips after all thirteen rounds wins.
        </p>
        <ul style={{ marginTop: 16, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((row) => (
            <li key={row.label} style={{ display: 'flex', gap: 10, fontSize: 15, lineHeight: 1.5, color: 'var(--body-text)' }}>
              <span style={{ color: '#c2410c' }}>●</span>
              <span>
                <strong>{row.label}</strong> — {row.text}
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
