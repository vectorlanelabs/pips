import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { joinAsAiPlayer, type AiPlayerHandle, type AiPlayerCallbacks } from './peerClient.js'
import { farkleMoveSchema, parseFarkleMove, trimFarkleState } from './games/farkle.js'
import type { RoomState } from '../../src/types.js'

const server = new McpServer({ name: 'pips-ai-player', version: '0.1.0' })
// Declare the logging capability up front: we push a notifications/message
// (logging) notification whenever it becomes the AI's turn, and the SDK refuses
// to send that unless the server advertises it supports logging.
server.server.registerCapabilities({ logging: {} })

let handle: AiPlayerHandle | null = null
let latestState: RoomState | null = null
let wasYourTurn = false
// Resolvers for pending wait_for_turn calls — fired the moment the state
// stream shows it's become the AI's turn. See wait_for_turn below: this is
// what lets a chat-driven agent (which can't hold its own timer/poll loop
// across turns) block on a single tool call instead.
let turnWaiters: (() => void)[] = []

function requireHandle(): AiPlayerHandle {
  if (!handle) throw new Error('Not in a room — call join_room first.')
  return handle
}

function isYourTurnNow(): boolean {
  return !!handle && !!latestState && latestState.game === 'farkle' && trimFarkleState(latestState, handle.seatId).yourTurn
}

function makeCallbacks(): AiPlayerCallbacks {
  return {
    onState(state) {
      latestState = state
      onTurnCheck()
    },
    onRejected() {
      handle = null
    },
    onDisconnected() {
      handle = null
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
  'wait_for_turn',
  {
    title: 'Wait until it is your turn',
    description:
      "Blocks until it becomes your turn, then returns the state — the same shape get_state returns, plus yourTurn. " +
      'A chat-driven agent has no way to hold its own timer between turns (its run ends when it replies), so call this ' +
      'in a loop between moves instead of polling get_state on an interval: call wait_for_turn, act on the result if ' +
      "yourTurn is true, then call wait_for_turn again. Returns early with timedOut:true if the timeout elapses first — " +
      'call it again to keep waiting.',
    inputSchema: { timeoutMs: z.number().optional().describe('Max time to wait, in ms (default 25000, max 55000)') },
  },
  async ({ timeoutMs }) => {
    const h = requireHandle()
    if (isYourTurnNow()) {
      return { content: [{ type: 'text', text: JSON.stringify(trimFarkleState(latestState!, h.seatId)) }] }
    }
    const cap = Math.min(Math.max(timeoutMs ?? 25000, 1000), 55000)
    const timedOut = await new Promise<boolean>((resolve) => {
      const onTurn = () => {
        clearTimeout(timer)
        resolve(false)
      }
      const timer = setTimeout(() => {
        turnWaiters = turnWaiters.filter((w) => w !== onTurn)
        resolve(true)
      }, cap)
      turnWaiters.push(onTurn)
    })
    if (timedOut || !latestState) return { content: [{ type: 'text', text: JSON.stringify({ yourTurn: false, timedOut: true }) }] }
    return { content: [{ type: 'text', text: JSON.stringify(trimFarkleState(latestState, h.seatId)) }] }
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

// Single edge-detector shared by the push notification (for event-driven
// harnesses) and wait_for_turn's waiters (for chat-driven ones) — both react
// to the same "it just became your turn" moment.
function onTurnCheck() {
  const isYourTurn = isYourTurnNow()
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
    const waiters = turnWaiters
    turnWaiters = []
    waiters.forEach((w) => w())
  }
  wasYourTurn = isYourTurn
}

const transport = new StdioServerTransport()
await server.connect(transport)
