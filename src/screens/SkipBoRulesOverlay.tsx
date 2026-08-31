export function SkipBoRulesOverlay({ onClose }: { onClose: () => void }) {
  const bullets = [
    'Deal: each player gets a face-down stockpile (30 cards for 2 players, 20 for 3–4) and a 5-card starting hand.',
    'Four shared building piles run from 1 up to 12. A numbered card can only be played on the pile that needs exactly that number; a Skip-Bo wild card can be any number.',
    'A building pile that reaches 12 is cleared into the used pile and restarts at 1.',
    'Your turn: play as many legal cards as you can, from your stockpile top, your own discard-pile tops, and your hand, in any order.',
    'After you are done playing, discard exactly one hand card onto one of your four discard piles, or pass only when your hand is empty.',
    'The next player then draws back up to 5 cards from the shared draw pile. When the draw pile empties, the used pile is shuffled and recycled into it.',
    'The first player to empty their stockpile wins immediately, even mid-turn.',
    'No scores, no next round. A rematch is a fresh deal.',
  ]

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: '#be185d' }}>
            Skip-Bo rules
          </h2>
          <button type="button" className="btn pill-small" onClick={onClose}>Close</button>
        </div>
        <p style={{ color: 'var(--body-text)', lineHeight: 1.5, marginTop: 14 }}>
          Empty your stockpile first. Two to four players, one shared 162-card deck.
        </p>
        <ul style={{ marginTop: 16, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bullets.map((b) => (
            <li key={b} style={{ display: 'flex', gap: 10, fontSize: 15, lineHeight: 1.5, color: 'var(--body-text)' }}>
              <span style={{ color: '#be185d' }}>●</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
