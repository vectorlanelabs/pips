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
// Resolvers for pending submit_move calls — see waitForBroadcasts below:
// submit_move returns the resulting state instead of making the agent call
// get_state separately after every action.
let stateWaiters: (() => void)[] = []

function notifyStateWaiters() {
  for (const w of [...stateWaiters]) w()
}

// Resolves once `n` state broadcasts have arrived (or the timeout elapses).
// The host broadcasts once per processed action, in order, over the same
// reliable ordered channel actions are sent on — so after firing n actions
// in a row, waiting for n broadcasts reliably lands on the result of the
// last one, not a premature one from the first.
function waitForBroadcasts(n: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let remaining = n
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stateWaiters = stateWaiters.filter((w) => w !== onEach)
      resolve(ok)
    }
    const onEach = () => {
      remaining--
      if (remaining <= 0) finish(true)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    stateWaiters.push(onEach)
  })
}

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
      notifyStateWaiters()
    },
    onRejected() {
      handle = null
    },
    onDisconnected() {
      handle = null
      // Optional standalone lifecycle: when running as a one-room player process
      // (PIPS_EXIT_ON_DISCONNECT=1), exit cleanly when the host goes away rather
      // than idling. Left off by default so a persistent MCP server (loaded by a
      // harness) can keep serving future join_room calls.
      if (process.env.PIPS_EXIT_ON_DISCONNECT === '1') {
        console.error('[pips] disconnected — room ended; exiting')
        setTimeout(() => process.exit(0), 300)
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
    title: 'Submit a Farkle move (single or batched)',
    description:
      'Submit one action, or several in order, and get back the resulting state — no separate get_state call needed. ' +
      'Batch whenever you already know every dieId you want from the board you were just given: e.g. after a roll, ' +
      'keeping four dice and rerolling is one call — [{type:"farkleToggle",dieId},×4, {type:"farkleRoll"}] — not five. ' +
      'Only chain actions whose targets you already know; never guess a dieId from a roll you have not seen yet.',
    inputSchema: { action: z.union([farkleMoveSchema, z.array(farkleMoveSchema).min(1).max(10)]) },
  },
  async ({ action }) => {
    const h = requireHandle()
    const actions = (Array.isArray(action) ? action : [action]).map(parseFarkleMove)
    for (const a of actions) h.sendAction(a)
    const arrived = await waitForBroadcasts(actions.length, 5000)
    if (!arrived || !latestState) return { content: [{ type: 'text', text: `Sent ${actions.length} action(s), but did not hear back in time — call get_state to check.` }] }
    return { content: [{ type: 'text', text: JSON.stringify(trimFarkleState(latestState, h.seatId)) }] }
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
