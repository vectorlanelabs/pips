import type { SolitaireMode } from '../card-games/solitaire/state'
import { SOLITAIRE_MODE_LABELS } from './SolitaireRoom'
import { SOLITAIRE_COLOR } from './SolitaireTable'

const RULES: Record<SolitaireMode, { intro: string; bullets: string[] }> = {
  klondike: {
    intro: 'Build the four foundations from Ace to King, one suit each.',
    bullets: [
      'Deal: seven columns, one to seven cards, only the top card face up. The rest is the stock.',
      'Tableau: stack cards in descending order, alternating red and black. Move any face-up run as a unit.',
      'Only a King (or a run starting with one) can move into an empty column.',
      'Stock: click to turn one card onto the waste. When the stock runs out, click it again to flip the waste back over — as many passes as you like.',
      'Click a card to select it, then click where it goes — or skip the two clicks and just drag it there instead. Click a selected card again to send it straight to its foundation. Cards can come back off a foundation if you need them.',
      'Auto-play lights up once every card is face up and the stock and waste are empty — it finishes off every remaining safe move for you.',
      'Undo is unlimited. Deal again starts a fresh shuffle.',
    ],
  },
  freecell: {
    intro: 'Every card is face up from the start — FreeCell is a game of pure planning.',
    bullets: [
      'Deal: eight columns, all face up. Four free cells on the left hold one card each.',
      'Tableau: descending order, alternating colors. Any card or run can move into an empty column.',
      'Moving a run at once is a shortcut for moving it card by card through the free cells — so you can move at most (empty cells + 1) × 2^(empty columns) cards, and an empty column you\'re moving INTO doesn\'t count.',
      'Click a card to select it, then click where it goes — or skip the two clicks and just drag it there instead. Click a selected card again to send it straight to its foundation.',
      'Auto-play lights up once there’s a safe move to make — FreeCell deals every card face up, so it’s often available early.',
      'Undo is unlimited. Deal again starts a fresh shuffle.',
    ],
  },
}

export function SolitaireRulesOverlay({
  mode,
  onClose,
}: {
  mode: SolitaireMode
  onClose: () => void
}) {
  const rules = RULES[mode]

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: SOLITAIRE_COLOR }}>
            {SOLITAIRE_MODE_LABELS[mode]} rules
          </h2>
          <button type="button" className="btn pill-small" onClick={onClose}>Close</button>
        </div>
        <p style={{ color: 'var(--body-text)', lineHeight: 1.5, marginTop: 14 }}>
          {rules.intro}
        </p>
        <ul style={{ marginTop: 16, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rules.bullets.map((bullet) => (
            <li key={bullet} style={{ display: 'flex', gap: 10, fontSize: 15, lineHeight: 1.5, color: 'var(--body-text)' }}>
              <span style={{ color: 'var(--coral)' }}>●</span>
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
