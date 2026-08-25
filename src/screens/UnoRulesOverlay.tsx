export function UnoRulesOverlay({ onClose }: { onClose: () => void }) {
  const bullets = [
    'Match the top discard by color, number, or type — or play a wild any time, even if you have another legal play (a deliberate house-rule looseness — official Wild Draw Four rules restrict it to when you have no other play). Skip, Reverse, and Draw Two hit the next player immediately; with two players, Reverse just acts as a second Skip.',
    'No playable card? Draw one from the deck — if it’s playable you may play it right away, otherwise your turn passes.',
    'Going out empties your hand and scores you the value of everyone else’s remaining cards: numbers at face value, action cards 20, wilds 50.',
    'First to 500 points wins the match; rounds repeat until someone gets there.',
    'Down to one card? You must call "Uno!" before anyone catches you — miss it and you draw two as a penalty.',
    'Optional house rules are chosen in the lobby: "draw until you can play" keeps you drawing until you can play instead of drawing once and passing; "stack draw cards" lets you play a Draw Two on a Draw Two (or a Wild Draw Four on a Wild Draw Four) to pass the growing penalty along instead of drawing; "7-0" lets a played 7 swap hands with an opponent of your choice, and a played 0 passes every hand one seat around the table.',
  ]

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: '#e11d2e' }}>
            Uno — how to play
          </h2>
          <button type="button" className="btn pill-small" onClick={onClose}>Close</button>
        </div>
        <p style={{ color: 'var(--body-text)', lineHeight: 1.5, marginTop: 14 }}>
          Empty your hand before anyone else, one card at a time. Two to six players, one 108-card deck.
        </p>
        <ul style={{ marginTop: 16, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bullets.map((b) => (
            <li key={b} style={{ display: 'flex', gap: 10, fontSize: 15, lineHeight: 1.5, color: 'var(--body-text)' }}>
              <span style={{ color: '#e11d2e' }}>●</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
