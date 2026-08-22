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
  klondike3: {
    intro: 'Same Klondike, tighter stock — draw three at a time and only the last one drawn is in play.',
    bullets: [
      'Deal: seven columns, one to seven cards, only the top card face up. The rest is the stock.',
      'Stock: click to turn up to three cards onto the waste at once. Only the top (most recently drawn) card is playable — dig through the other two by drawing again. When the stock runs out, click it again to flip the waste back over.',
      'Tableau: stack cards in descending order, alternating red and black. Move any face-up run as a unit.',
      'Only a King (or a run starting with one) can move into an empty column.',
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
  spider: {
    intro: 'Ten columns, two suits, one goal: build eight complete King-to-Ace runs.',
    bullets: [
      'Deal: ten columns — the first four get six cards, the rest five, only the top card of each face up. The remaining 50 cards are the stock.',
      'Tableau: any card can stack on a card one rank higher, regardless of suit. But you can only pick up and move a multi-card run if every card in it is the same suit in strict descending order.',
      'Any card or run can move into an empty column.',
      'Stock: click to deal one card face up onto every column at once — blocked if any column is empty. There is no waste and no reshuffle; the stock is a fixed 5 deals.',
      'A complete same-suit run from King down to Ace clears itself off the tableau automatically the moment you finish it.',
      'Click a card to select it, then click where it goes — or skip the two clicks and just drag it there instead. There\'s no foundation shortcut or Auto-play here since completed runs clear on their own.',
      'Win by clearing all eight runs. Undo is unlimited. Deal again starts a fresh shuffle.',
    ],
  },
  spider1: {
    intro: 'The easiest Spider: one suit only, so every run you build is automatically movable as a whole.',
    bullets: [
      'Deal: ten columns — the first four get six cards, the rest five, only the top card of each face up. The remaining 50 cards are the stock.',
      'Every card is the same suit, so any descending run — however you built it — can always be picked up and moved together.',
      'Any card or run can move into an empty column.',
      'Stock: click to deal one card face up onto every column at once — blocked if any column is empty. There is no waste and no reshuffle; the stock is a fixed 5 deals.',
      'A complete run from King down to Ace clears itself off the tableau automatically the moment you finish it.',
      'Click a card to select it, then click where it goes — or skip the two clicks and just drag it there instead. There\'s no foundation shortcut or Auto-play here since completed runs clear on their own.',
      'Win by clearing all eight runs. Undo is unlimited. Deal again starts a fresh shuffle.',
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
