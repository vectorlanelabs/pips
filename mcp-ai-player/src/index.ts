import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { joinAsAiPlayer, type AiPlayerHandle, type AiPlayerCallbacks } from './peerClient.js'
import { farkleMoveSchema, parseFarkleMove, trimFarkleState } from './games/farkle.js'
import { decideFarkleBot } from './games/farkleBot.js'
import type { BotDifficulty, RoomState } from '../../src/types.js'

const server = new McpServer({ name: 'pips-ai-player', version: '0.1.0' })
// Declare the logging capability up front: we push a notifications/message
// (logging) notification whenever it becomes the AI's turn, and the SDK refuses
// to send that unless the server advertises it supports logging.
server.server.registerCapabilities({ logging: {} })

// ---- Autonomous auto-play ----
// The bridge can drive the AI seat by itself, reacting to the state stream the
// moment it's the AI's turn — no external agent, no polling, no human nudge.
// This is what makes it a real self-playing player. Enable with PIPS_AUTO_PLAY=1;
// PIPS_ROOM auto-joins on start. Decision logic + pacing mirror the host's
// runFarkleBot so the AI reads as a human-speed player. (Without auto-play the
// bridge still exposes the MCP tools for a client agent to drive interactively.)
const AUTO_PLAY = process.env.PIPS_AUTO_PLAY === '1'
const AUTO_DIFFICULTY = (process.env.PIPS_DIFFICULTY || 'medium') as BotDifficulty
const AUTO_DELAY_MS = Number(process.env.PIPS_DELAY_MS || 1600)

let handle: AiPlayerHandle | null = null
let latestState: RoomState | null = null
let wasYourTurn = false
let lastRollSig = ''

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function requireHandle(): AiPlayerHandle {
  if (!handle) throw new Error('Not in a room — call join_room first.')
  return handle
}

function makeCallbacks(): AiPlayerCallbacks {
  return {
    onState(state) {
      latestState = state
      maybeNotifyTurn()
      if (AUTO_PLAY) void maybeAutoPlay(state)
    },
    onRejected() {
      handle = null
    },
    onDisconnected() {
      handle = null
      // One room per process: when the host goes away the authoritative room is
      // gone, so shut the autonomous player down cleanly rather than idling.
      if (AUTO_PLAY) {
        console.error('[auto] disconnected — room ended; exiting')
        setTimeout(() => process.exit(0), 200)
      }
    },
  }
}

server.registerTool(
  'join_room',
  {
    title: 'Join a Pips Farkle room',
    description: 'Join a live Pips Farkle room by its room code, as an AI player. The host must accept the join before you are seated.',
    inputSchema: { code: z.string().describe("Room code, e.g. 'FK-CORAL-42'"), name: z.string().describe('Display name shown to the host and other players') },
  },
  async ({ code, name }) => {
    handle?.destroy()
    handle = await joinAsAiPlayer(code, name, makeCallbacks())
    return { content: [{ type: 'text', text: `Joined as seat ${handle.seatId}. Waiting on host acceptance if not already seated.` }] }
  },
)

server.registerTool(
  'get_state',
  {
    title: 'Get the current Farkle game state',
    description: "Returns the current room/game state, trimmed to what's relevant for deciding a move, including whether it is your turn.",
    inputSchema: {},
  },
  async () => {
    requireHandle()
    if (!latestState) return { content: [{ type: 'text', text: 'No state received yet.' }] }
    if (latestState.game !== 'farkle') return { content: [{ type: 'text', text: `This room is playing ${latestState.game}, which this AI player does not support yet.` }] }
    return { content: [{ type: 'text', text: JSON.stringify(trimFarkleState(latestState, requireHandle().seatId)) }] }
  },
)

server.registerTool(
  'submit_move',
  {
    title: 'Submit a Farkle move',
    description: 'Submit one action: roll the dice, toggle a die kept for scoring, bank your turn score, or end your turn after a bust.',
    inputSchema: { action: farkleMoveSchema },
  },
  async ({ action }) => {
    const h = requireHandle()
    h.sendAction(parseFarkleMove(action))
    return { content: [{ type: 'text', text: `Sent ${action.type}.` }] }
  },
)

server.registerTool(
  'leave_room',
  { title: 'Leave the room', description: 'Disconnect from the current room.', inputSchema: {} },
  async () => {
    handle?.destroy()
    handle = null
    latestState = null
    return { content: [{ type: 'text', text: 'Left the room.' }] }
  },
)

function maybeNotifyTurn() {
  if (!handle || !latestState || latestState.game !== 'farkle') return
  const isYourTurn = trimFarkleState(latestState, handle.seatId).yourTurn
  if (isYourTurn && !wasYourTurn) {
    // Best-effort: a failed/unsupported notification must never take down the
    // live room connection, so swallow both sync throws and async rejections.
    try {
      void server.server
        .sendLoggingMessage({ level: 'info', data: "It's your turn — call get_state to see the board." })
        .catch((err) => console.error('Turn notification failed:', err))
    } catch (err) {
      console.error('Turn notification failed:', err)
    }
  }
  wasYourTurn = isYourTurn
}

// Autonomous turn-taker. Called on every state update while AUTO_PLAY is on; it
// only acts when it's the AI seat's turn, and acts exactly once per distinct
// roll (guarded by lastRollSig), mirroring the host's runFarkleBot decision and
// pacing. Waits a beat before each action so the AI reads as human-speed.
async function maybeAutoPlay(state: RoomState): Promise<void> {
  if (!handle) return
  if (state.game !== 'farkle' || !state.farkle) return
  const seatIdx = state.seats.findIndex((s) => s.id === handle!.seatId)
  if (seatIdx === -1 || state.seats[state.turnIdx]?.id !== handle.seatId) return // not my turn
  const f = state.farkle

  // Bust: end the turn so the seat passes on.
  if (f.farkle) {
    await wait(AUTO_DELAY_MS)
    handle.sendAction({ type: 'farkleEndTurn' })
    lastRollSig = ''
    return
  }

  // Start of my turn (nothing rolled yet): roll the dice.
  if (f.dice.length === 0) {
    await wait(AUTO_DELAY_MS)
    handle.sendAction({ type: 'farkleRoll' })
    return
  }

  // A roll is on the table — decide once per distinct roll.
  const vals = f.dice.map((d) => d.val)
  const sig = JSON.stringify({ vals: [...vals].sort((a, b) => a - b), ts: f.turnScore })
  if (sig === lastRollSig) return
  lastRollSig = sig

  const seat = state.seats[seatIdx]
  const move = decideFarkleBot(vals, f.turnScore, seat.score, f.openingScore, f.winningScore, AUTO_DIFFICULTY)
  await wait(AUTO_DELAY_MS)
  for (const idx of move.keepIndices) {
    handle.sendAction({ type: 'farkleToggle', dieId: f.dice[idx].id })
    await wait(AUTO_DELAY_MS * 0.5)
  }
  await wait(AUTO_DELAY_MS * 0.5)
  if (move.bank) handle.sendAction({ type: 'farkleBank' })
  else handle.sendAction({ type: 'farkleRoll' })
}

const transport = new StdioServerTransport()
await server.connect(transport)

// Auto-join when configured as a self-playing player (PIPS_ROOM + PIPS_AUTO_PLAY).
// Runs alongside the stdio server; auto-play is driven purely by the state
// stream, so it works even with no MCP client attached.
if (AUTO_PLAY && process.env.PIPS_ROOM) {
  const name = process.env.PIPS_NAME || 'Ziggy'
  joinAsAiPlayer(process.env.PIPS_ROOM, name, makeCallbacks())
    .then((h) => {
      handle = h
      console.error(`[auto] joined ${process.env.PIPS_ROOM} as seat ${h.seatId}`)
    })
    .catch((err) => console.error('[auto] join failed:', err))
}
