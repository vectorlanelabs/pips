import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { joinAsAiPlayer, type AiPlayerHandle } from './peerClient.js'
import { farkleMoveSchema, parseFarkleMove, trimFarkleState } from './games/farkle.js'
import type { RoomState } from '../../src/types.js'

const server = new McpServer({ name: 'pips-ai-player', version: '0.1.0' })

let handle: AiPlayerHandle | null = null
let latestState: RoomState | null = null
let wasYourTurn = false

function requireHandle(): AiPlayerHandle {
  if (!handle) throw new Error('Not in a room — call join_room first.')
  return handle
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
    handle = await joinAsAiPlayer(code, name, {
      onState(state) {
        latestState = state
        maybeNotifyTurn()
      },
      onRejected() {
        handle = null
      },
      onDisconnected() {
        handle = null
      },
    })
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
    server.server.notification({ method: 'notifications/message', params: { level: 'info', data: "It's your turn — call get_state to see the board." } })
  }
  wasYourTurn = isYourTurn
}

const transport = new StdioServerTransport()
await server.connect(transport)
