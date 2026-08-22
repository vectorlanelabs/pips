import { PYRAMID_COLOR } from './PyramidTable'

const INTRO = 'Clear all 28 cards out of the pyramid by pairing exposed cards that add up to 13.'

const BULLETS = [
  'Deal: 7 rows in a triangle (1 card at the top, 7 along the base — 28 total), all face up. The other 24 cards are the stock.',
  'A card is exposed once both cards it rests on — the two just below it — are gone. The base row is always exposed.',
  'Remove any two exposed cards whose ranks add up to 13 (A=1, J=11, Q=12). A King is worth 13 all on its own, so it clears alone.',
  'The waste pile\'s top card counts as exposed too, so it can pair with an exposed pyramid card.',
  'Stock: click to turn one card onto the waste. When the stock runs out, click it again to flip the waste back over — as many passes as you like.',
  'Click a card to select it, then click one that adds up to 13 with it — or skip the two clicks and just drag it there instead. Click a selected King again to clear it.',
  'Undo is unlimited. Deal again starts a fresh shuffle.',
]

export function PyramidRulesOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: PYRAMID_COLOR }}>
            Pyramid Solitaire rules
          </h2>
          <button type="button" className="btn pill-small" onClick={onClose}>Close</button>
        </div>
        <p style={{ color: 'var(--body-text)', lineHeight: 1.5, marginTop: 14 }}>
          {INTRO}
        </p>
        <ul style={{ marginTop: 16, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {BULLETS.map((bullet) => (
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
