# @pips/mcp-ai-player

An MCP server that lets an AI agent join a live [Pips](../) Farkle room as a
real player — the same PeerJS room code a human uses to join from a browser.

## Setup

From this directory:

```bash
npm install
npm run build
```

Then point any MCP-capable agent at `node dist/index.js` (stdio transport),
or run it directly during development with `npm run dev`.

## How it works

This is a real remote peer, not a scripted bot: it connects over PeerJS
using [`node-datachannel`](https://github.com/murat-dogan/node-datachannel)
as a WebRTC polyfill (Node has no native WebRTC), joins with an `agent: true`
flag the join protocol now supports, and submits the exact same actions a
human's clicks would (`farkleRoll`, `farkleToggle`, `farkleBank`,
`farkleEndTurn`).

Because the join is flagged as an agent, the host sees an Accept/Decline
prompt in the room lobby before the AI is seated — an agent can't self-seat
just by knowing the room code the way a human guest can.

## Tools

- `join_room({ code, name })` — request to join a room; resolves once the
  host accepts.
- `get_state()` — the current game state, trimmed to what's relevant for a
  move, including `yourTurn`.
- `submit_move({ action })` — send one Farkle action.
- `leave_room()` — disconnect.

The server also pushes an MCP notification the moment it becomes your turn,
so an agent doesn't have to poll on a blind timer (though polling
`get_state()` works too).

## Adding a second game

`src/games/farkle.ts` is the only populated entry in what's meant to grow
into a per-game registry (move schema + state trimming). A new game adds a
sibling file and a branch in `index.ts`'s tool handlers — the join/state
transport in `src/peerClient.ts` doesn't change.
