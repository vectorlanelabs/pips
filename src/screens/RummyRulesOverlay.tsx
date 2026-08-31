export function RummyRulesOverlay({ onClose }: { onClose: () => void }) {
  const bullets = [
    'Deal: 10 cards each, 1 card flipped to start the discard pile.',
    'Your turn: draw from the stock, or take any card from the discard pile. You also take every card stacked above it.',
    'Reaching for anything but the top card obligates you to use that card in a meld before you can discard.',
    'A set is 3-4 cards of the same rank, different suits. A run is 3+ consecutive same-suit cards. Aces can be low (A-2-3) or high (Q-K-A), but a run can\u2019t wrap past both ends.',
    'Lay down any melds you can, then discard exactly one card to end your turn.',
    'Every turn ends with a discard. Discarding your last card goes out, ending the round. Melding your whole hand away only ends your turn. You draw again next turn, and only a final discard can end the round.',
    'Scoring: every round, every seated player scores the point value of what they\u2019ve melded, minus a penalty for whatever\u2019s left in their hand. Aces are worth 5 melded low, 15 melded high or in a set of aces, and cost 15 if left unmelded. Other cards: 10s and face cards are worth 10, 2\u20139 are worth 5.',
    'First to 500 points wins the match.',
    'If the stock runs out, drawing recycles the discard pile (keeping the top card in place). If that\u2019s not possible either, the round is blocked with no score, and a new one deals automatically.',
  ]

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: 'var(--green-text)' }}>
            Rummy rules
          </h2>
          <button type="button" className="btn pill-small" onClick={onClose}>Close</button>
        </div>
        <p style={{ color: 'var(--body-text)', lineHeight: 1.5, marginTop: 14 }}>
          Draw, meld, discard, go out first. Two to four players, standard 52-card deck, no jokers.
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
