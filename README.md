# Pips

Little games for two people and one code. Pick a game, share a room code, play — no
account, no sign-in, nothing to install. Each game lives at its own
URL (`/pips/<game>`) — refresh lands you on that game's fresh room,
and Back returns to the shelf.

Sixteen games: **Farkle**, **Yahtzee**, **Tic Tac Toe**, **Hangman**, **Connect 4**,
**Rummy**, **Phase 10**, **Battleship**, **Dominoes**, **Wahoo**, **Checkers**,
**Mexican Train**, **Chess**, **Uno**, **Skip-Bo**, and **Scrabble**. Farkle and Yahtzee seat up to 8, Wahoo seats 2–4,
Rummy seats 2–4, Phase 10 seats 2–6, Mexican Train seats 2–8, Uno seats 2–6, Skip-Bo seats 2–4, and Scrabble seats 2–4; the rest are two-player (for now).
Every game can be played solo against house bots.

Rummy and Phase 10 are built on a reusable card-game engine (`src/card-engine/`),
itself built on a game-agnostic core (`src/engine/`: seeded RNG, turn order, and
host-authoritative sync with hidden per-player state) that future non-card games
(Battleship, Wahoo) will share. Designed so new games don't reimplement decks, hands,
hidden information, and turn order each time — see
[docs/card-engine.md](docs/card-engine.md), [docs/rummy.md](docs/rummy.md), and
[docs/phase10.md](docs/phase10.md).

## Stack

- React + TypeScript + Vite
- [PeerJS](https://peerjs.com/) for peer-to-peer multiplayer — the room host holds the
  authoritative game state and streams it to guests over WebRTC data channels. No backend,
  no server to run or pay for.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Deploys to GitHub Pages automatically on push to `main` via
[.github/workflows/deploy.yml](.github/workflows/deploy.yml).

## Design

See the [Design Handoff](Design%20Handoff) folder (gitignored, local only) for the original
design reference and full game-rules spec this app was built from.
