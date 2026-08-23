import { CardBack } from './PlayingCard'
import { CARD_BACKS, findCardBack } from './cardBacks'
import './CardBackPicker.css'

export function CardBackPicker({
  cardBack,
  onSelect,
  hostName,
}: {
  cardBack: string
  onSelect?: (id: string) => void
  hostName?: string
}) {
  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10 }}>
        Card back
        {!onSelect && hostName && <span style={{ fontWeight: 500, color: 'var(--muted-text)' }}> · {hostName} picks</span>}
      </div>
      <div className="card-back-picker">
        <CardBack size="stock" design={cardBack} />
        {onSelect ? (
          <select
            className="input select-chevron card-back-select"
            aria-label="Card back"
            value={cardBack}
            onChange={(e) => onSelect(e.target.value)}
          >
            {CARD_BACKS.map((def) => (
              <option key={def.id} value={def.id}>{def.name}</option>
            ))}
          </select>
        ) : (
          <span style={{ fontSize: 17, fontWeight: 600 }}>
            {findCardBack(cardBack)?.name ?? 'Pips Default'}
          </span>
        )}
      </div>
    </div>
  )
}
