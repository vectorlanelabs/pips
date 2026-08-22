export function ScrabbleRulesOverlay({ onClose }: { onClose: () => void }) {
  const bullets = [
    'Each player draws seven tiles. The player with the highest letter goes first.',
    'Play words on the board, placing your tiles in a single row or column. Your first word must cover the center square and be at least two tiles.',
    'Each word played must connect to existing tiles (except the first move). Premium squares multiply letter or word scores: double/triple letter (DL/TL) and double/triple word (DW/TW).',
    'When you place seven tiles in one turn, you earn a 50-point bonus.',
    "A played word is NOT automatically checked. Any other player can challenge it before the next player takes a non-challenge action. If challenged and found invalid, the tiles return to the player's rack and they lose their turn. If valid, the challenger's next turn is skipped.",
    'Exchange tiles instead of playing: select any number from your rack, and they are replaced with random tiles from the bag.',
    'Pass your turn without playing or exchanging.',
    'The game ends when either (1) the bag is empty and one player has no tiles, or (2) all players have passed twice in a row. Final scores adjust: unplayed tiles in other racks are deducted from them and awarded to the player who went out.',
  ]

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: '#8b6e47' }}>
            Scrabble — how to play
          </h2>
          <button type="button" className="btn pill-small" onClick={onClose}>Close</button>
        </div>
        <p style={{ color: 'var(--body-text)', lineHeight: 1.5, marginTop: 14 }}>
          Form words, score points, and challenge suspicious plays. Two to four players, seven tiles each.
        </p>
        <ul style={{ marginTop: 16, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bullets.map((b) => (
            <li key={b} style={{ display: 'flex', gap: 10, fontSize: 15, lineHeight: 1.5, color: 'var(--body-text)' }}>
              <span style={{ color: '#8b6e47' }}>●</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
