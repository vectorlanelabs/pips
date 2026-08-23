import type { Game } from '../types'
import { Wordmark } from '../components/Wordmark'

export function Landing({
  name, onNameChange, joinCode, onJoinCodeChange, onJoin, onPickGame, onPickRummy, onPickPhase10, onPickBattleship, onPickDominoes, onPickWahoo, onPickCheckers, onPickMexicanTrain, onPickChess, onPickUno, onPickSkipBo, onPickSolitaire, onPickScrabble, onPickPyramid, error,
}: {
  name: string
  onNameChange: (v: string) => void
  joinCode: string
  onJoinCodeChange: (v: string) => void
  onJoin: () => void
  onPickGame: (g: Game) => void
  onPickRummy: () => void
  onPickPhase10: () => void
  onPickBattleship: () => void
  onPickDominoes: () => void
  onPickWahoo: () => void
  onPickCheckers: () => void
  onPickMexicanTrain: () => void
  onPickChess: () => void
  onPickUno: () => void
  onPickSkipBo: () => void
  onPickSolitaire: () => void
  onPickScrabble: () => void
  onPickPyramid: () => void
  error: string | null
}) {
  const ready = name.trim().length > 0
  const canJoin = ready && joinCode.trim().length > 0
  // Grouped by game type so the shelf reads as a menu, not a wall of chips.
  // Each group is its own data-driven list — chip carries title, player
  // range, tile color, and pick handler.
  const SHELF_GROUPS: { label: string; games: { title: string; note: string; color: string; onClick: () => void }[] }[] = [
    {
      label: 'Dice',
      games: [
        { title: 'Farkle', note: '2–8 players', color: '#6c4cff', onClick: () => onPickGame('farkle') },
        { title: 'Yahtzee', note: '2–8 players', color: '#0fb5a0', onClick: () => onPickGame('yahtzee') },
      ],
    },
    {
      label: 'Board & word',
      games: [
        { title: 'Tic Tac Toe', note: '2 players', color: '#ff9f1c', onClick: () => onPickGame('ttt') },
        { title: 'Connect 4', note: '2 players', color: '#2f6fed', onClick: () => onPickGame('connect4') },
        { title: 'Battleship', note: '2 players', color: '#1a6fae', onClick: onPickBattleship },
        { title: 'Wahoo', note: '2–4 players', color: '#9333ea', onClick: onPickWahoo },
        { title: 'Checkers', note: '2 players', color: '#b45309', onClick: onPickCheckers },
        { title: 'Chess', note: '2 players', color: '#0891b2', onClick: onPickChess },
        { title: 'Hangman', note: '2 players', color: '#ff5d73', onClick: () => onPickGame('hangman') },
        { title: 'Scrabble', note: '2–4 players', color: '#8b6e47', onClick: onPickScrabble },
      ],
    },
    {
      label: 'Tiles',
      games: [
        { title: 'Dominoes', note: '2 players', color: '#5b5bd6', onClick: onPickDominoes },
        { title: 'Mexican Train', note: '2–8 players', color: '#c2410c', onClick: onPickMexicanTrain },
      ],
    },
    {
      label: 'Cards',
      games: [
        { title: 'Rummy', note: '2–4 players', color: '#1aa06d', onClick: onPickRummy },
        { title: 'Phase 10', note: '2–6 players', color: '#ff9f1c', onClick: onPickPhase10 },
        { title: 'Uno', note: '2–6 players', color: '#e11d2e', onClick: onPickUno },
        { title: 'Skip-Bo', note: '2–4 players', color: '#be185d', onClick: onPickSkipBo },
        { title: 'Solitaire', note: '1 player', color: '#4d7c0f', onClick: onPickSolitaire },
        { title: 'Pyramid Solitaire', note: '1 player', color: '#b8860b', onClick: onPickPyramid },
      ],
    },
  ]

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(28px,6vw,72px) clamp(18px,5vw,48px) 72px' }}>
      <Wordmark />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(24px,5vw,64px)', marginTop: 'clamp(20px,3vw,28px)', alignItems: 'flex-end' }}>
        <div style={{ flex: '2 1 380px' }}>
          <h1 style={{
            fontSize: 'clamp(34px,5vw,58px)', lineHeight: 1.02, letterSpacing: '-0.03em',
            margin: 0, fontWeight: 700, maxWidth: '18ch',
          }}
          >
            Small games. <span style={{ color: 'var(--violet)' }}>One code.</span>
          </h1>
          <p style={{
            fontSize: 'clamp(16px,1.9vw,18px)', lineHeight: 1.5, maxWidth: '46ch',
            marginTop: 12, color: 'var(--body-text)',
          }}
          >
            Dice, board and word games, tiles, and cards, whether you're playing solo or with a table full. Pick a game, share the code, play. No account, nothing to install.
          </p>
        </div>

        <div style={{ flex: '1 1 300px', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ fontWeight: 600, fontSize: 15 }}>
            Your name
            <input
              className="input"
              style={{ marginTop: 6 }}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Player One"
              autoComplete="off"
            />
          </label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <label style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>
              Join with a code
              <input
                className="input input-code"
                style={{ marginTop: 6 }}
                value={joinCode}
                onChange={(e) => onJoinCodeChange(e.target.value.toUpperCase())}
                placeholder="GG-CODE-52"
              />
            </label>
            <button type="button" className="btn btn-coral" style={{ height: 52 }} disabled={!canJoin} onClick={onJoin}>
              Join
            </button>
          </div>
          {!ready && <p style={{ fontSize: 14, color: 'var(--faint-text)', margin: 0 }}>Just a name — no account, no password.</p>}
          {error && <p style={{ fontSize: 14, color: 'var(--coral)', margin: 0, fontWeight: 600 }}>{error}</p>}
        </div>
      </div>

      <div style={{ marginTop: 'clamp(32px,5vw,48px)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>On the shelf</span>
          {!ready && (
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--faint-text)' }}>
              type a name to start one
            </span>
          )}
        </div>
        <style>{`
          .shelf-chip { cursor: pointer; }
          .shelf-chip:hover:not(:disabled) { filter: brightness(1.04); }
          .shelf-chip:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 2px 0 var(--tile-shadow, var(--ink)); }
          .shelf-chip:disabled { cursor: not-allowed; }
        `}</style>
        {SHELF_GROUPS.map((group) => (
          <div key={group.label} style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--faint-text)', marginBottom: 8 }}>
              {group.label}
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 190px))',
              gap: 10,
            }}
            >
              {group.games.map((item) => (
                <button
                  key={item.title}
                  type="button"
                  className="shelf-chip"
                  disabled={!ready}
                  onClick={item.onClick}
                  style={{
                    ['--tile-border' as string]: ready ? 'var(--ink)' : 'var(--grey-border)',
                    ['--tile-shadow' as string]: ready ? 'var(--ink)' : 'var(--grey-border-4)',
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    textAlign: 'left', padding: '10px 12px', borderRadius: 14,
                    border: '3px solid var(--tile-border)', boxShadow: '0 4px 0 var(--tile-shadow)',
                    background: ready ? item.color : 'var(--grey-fill)',
                    color: ready ? '#fff' : 'var(--disabled-text)',
                  }}
                >
                  <span style={{ flex: 1, fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>{item.title}</span>
                  <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.8, whiteSpace: 'nowrap' }}>{item.note}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
