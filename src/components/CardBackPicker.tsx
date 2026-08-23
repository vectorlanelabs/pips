import { CardBack } from './PlayingCard'
import { CARD_BACKS } from './cardBacks'
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
      {onSelect ? (
        <div className="card-back-grid" role="radiogroup" aria-label="Card back">
          {CARD_BACKS.map((def) => (
            <CardBack
              key={def.id}
              size="stock"
              design={def.id}
              ariaLabel={def.name}
              className={def.id === cardBack ? 'card-back-swatch card-back-swatch--selected' : 'card-back-swatch'}
              onClick={() => onSelect(def.id)}
            />
          ))}
        </div>
      ) : (
        <div className="card-back-picker">
          <CardBack size="stock" design={cardBack} />
          <span style={{ fontSize: 17, fontWeight: 600 }}>
            {CARD_BACKS.find((d) => d.id === cardBack)?.name ?? 'Pips Default'}
          </span>
        </div>
      )}
    </div>
  )
}
