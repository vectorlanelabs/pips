import Peer, { type DataConnection } from 'peerjs'
import { assertWireSafe } from '../engine/sync'

type GuestToHost<TAction> = { kind: 'join'; name: string; agent?: boolean } | { kind: 'action'; action: TAction }
type HostToGuest<TState> = { kind: 'state'; state: TState } | { kind: 'rejected'; reason: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export function peerIdForCode(code: string): string {
  return `pips-${code.toLowerCase().replace(/[^a-z0-9-]/g, '')}`
}

export interface HostCallbacks<_TState, TAction> {
  onJoin: (guestId: string, name: string, agent: boolean) => void
  onAction: (guestId: string, action: TAction) => void
  onLeave: (guestId: string) => void
  onError?: (message: string) => void
}

export interface HostHandle<TState> {
  broadcast: (state: TState) => void
  sendTo: (guestId: string, state: TState) => void
  reject: (guestId: string, reason: string) => void
  destroy: () => void
}

export function createHost<TState, TAction>(code: string, callbacks: HostCallbacks<TState, TAction>): HostHandle<TState> {
  const peer = new Peer(peerIdForCode(code))
  const conns = new Map<string, DataConnection>()

  peer.on('error', (err) => callbacks.onError?.(err.message))

  peer.on('connection', (conn) => {
    conns.set(conn.peer, conn)
    conn.on('data', (raw) => {
      if (!isRecord(raw)) return
      if (raw.kind === 'join' && typeof raw.name === 'string') callbacks.onJoin(conn.peer, raw.name, raw.agent === true)
      else if (raw.kind === 'action' && isRecord(raw.action)) callbacks.onAction(conn.peer, raw.action as TAction)
    })
    conn.on('close', () => {
      conns.delete(conn.peer)
      callbacks.onLeave(conn.peer)
    })
  })

  return {
    broadcast(state) {
      assertWireSafe(state, 'HostHandle.broadcast')
      const msg: HostToGuest<TState> = { kind: 'state', state }
      conns.forEach((conn) => {
        if (conn.open) conn.send(msg)
      })
    },
    sendTo(guestId, state) {
      assertWireSafe(state, 'HostHandle.sendTo')
      const conn = conns.get(guestId)
      if (conn?.open) conn.send({ kind: 'state', state })
    },
    reject(guestId, reason) {
      const conn = conns.get(guestId)
      if (conn?.open) conn.send({ kind: 'rejected', reason })
    },
    destroy() {
      conns.forEach((c) => c.close())
      peer.destroy()
    },
  }
}

export interface GuestCallbacks<TState> {
  onState: (state: TState) => void
  onConnected?: () => void
  onDisconnected?: () => void
  onRejected?: (reason: string) => void
  onError?: (message: string) => void
}

export interface GuestHandle<TAction> {
  peerId: Promise<string>
  sendAction: (action: TAction) => void
  destroy: () => void
}

export function joinHost<TState, TAction>(code: string, name: string, callbacks: GuestCallbacks<TState>): GuestHandle<TAction> {
  const peer = new Peer()
  let conn: DataConnection | null = null

  const peerId = new Promise<string>((resolve, reject) => {
    peer.on('open', (id) => {
      conn = peer.connect(peerIdForCode(code), { reliable: true })
      conn.on('open', () => {
        conn!.send({ kind: 'join', name } satisfies GuestToHost<TAction>)
        callbacks.onConnected?.()
      })
      conn.on('data', (raw) => {
        if (!isRecord(raw)) return
        if (raw.kind === 'state' && 'state' in raw) callbacks.onState(raw.state as TState)
        else if (raw.kind === 'rejected' && typeof raw.reason === 'string') callbacks.onRejected?.(raw.reason)
      })
      conn.on('close', () => callbacks.onDisconnected?.())
      resolve(id)
    })
    peer.on('error', (err) => {
      callbacks.onError?.(err.message)
      reject(err)
    })
  })

  return {
    peerId,
    sendAction(action) {
      assertWireSafe(action, 'GuestHandle.sendAction')
      if (conn?.open) conn.send({ kind: 'action', action } satisfies GuestToHost<TAction>)
    },
    destroy() {
      conn?.close()
      peer.destroy()
    },
  }
}
