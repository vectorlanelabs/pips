import { PHASES } from '../card-games/phase10/phases'

export function Phase10RulesOverlay({ onClose }: { onClose: () => void }) {
  const bullets = [
    'Deck: 108 cards — 24 each of red, blue, green and yellow numbered 1–12, 4 Skip cards, 8 Wild cards.',
    'Deal: 10 cards each, 1 card flipped to start the discard pile.',
    'The 10 phases are completed in order. You must complete your current phase before moving to the next — fail a hand and you repeat the same phase next round.',
    'Your turn: draw from the stock, or take the top of the discard pile — never a Skip, those can never be picked up from discard.',
    'You may lay your whole phase from your hand at once (once per hand), then hit cards onto any laid group — yours or the opponent’s — once your own phase is down. Discard exactly one card to end your turn.',
    'A discarded Skip card skips the opponent’s next turn — no limit per round, so repeated Skips against the same player keep stacking.',
    'Scoring: every round, whoever didn’t go out scores the point value of what’s left in their hand — numbers 1–9 cost 5, 10–12 cost 10, Skip costs 15, Wild costs 25. The round winner scores 0. Lower total is better.',
    'First to complete Phase 10 and go out wins the match. If more than one player completes Phase 10 in the same hand, the lowest total score wins.',
    'If the stock runs out, drawing recycles the discard pile (keeping the top card in place). If that’s not possible either, the round ends with no score and a new one deals.',
  ]

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: 'var(--violet)' }}>
            Phase 10 rules
          </h2>
          <button type="button" className="btn pill-small" onClick={onClose}>Close</button>
        </div>
        <p style={{ color: 'var(--body-text)', lineHeight: 1.5, marginTop: 14 }}>
          Work up the phase ladder, one hand at a time. Two to six players, a dedicated 108-card deck.
        </p>
        <ul style={{ marginTop: 16, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bullets.map((b) => (
            <li key={b} style={{ display: 'flex', gap: 10, fontSize: 15, lineHeight: 1.5, color: 'var(--body-text)' }}>
              <span style={{ color: 'var(--coral)' }}>●</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>

        <h3 style={{ margin: '20px 0 10px', fontSize: 17, fontWeight: 700, color: 'var(--violet)' }}>
          The 10 phases
        </h3>
        <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {PHASES.map((p) => (
            <li
              key={p.phase}
              style={{ display: 'flex', gap: 10, fontSize: 15, lineHeight: 1.4, color: 'var(--body-text)' }}
            >
              <span style={{ fontWeight: 700, color: 'var(--violet)', width: 22 }}>{p.phase}.</span>
              <span>{p.label}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
