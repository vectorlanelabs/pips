// Mirrors the guest half of ../../src/net/peer.ts's PeerJS protocol
// (join / action / state / rejected), reimplemented locally rather than
// imported: this package is published standalone via npx, and `npm pack`
// only includes files inside this package directory, so it can't reach
// back into ../../src at runtime. Keep this in sync with peer.ts's wire
// shapes if that protocol ever changes.
//
// PeerJS assumes a browser (WebRTC + WebSocket globals). node-datachannel's
// polyfill module exports the WebRTC classes directly (there's no
// polyfill() function) — assign them onto globalThis ourselves, the same
// role browsers play natively. Node 21+ ships a stable global WebSocket,
// which PeerJS's socket layer picks up on its own.
import * as wrtc from 'node-datachannel/polyfill'
Object.assign(globalThis, wrtc)

// PeerJS is a browser-oriented CJS package. We load it lazily rather than with a
// static import, for two reasons:
//
//  1. The bundler hoists any static `import ... from 'peerjs'` above this module's
//     own body, so peerjs would evaluate its WebRTC-support probe before the
//     node-datachannel polyfill globals (assigned just above) are installed.
//     That makes `supports.webRTC` false and `new Peer()` throw "The current
//     browser does not support WebRTC". Loading peerjs on first use guarantees
//     the globals are already present.
//
//  2. Node resolves peerjs to its CJS build (no "exports" map, so pkg.main wins),
//     which makes the module namespace's `default` the exports *object* rather
//     than the class. The Peer constructor is reachable as `.Peer` on that
//     object (or is the default itself under peerjs's ESM build) — normalize
//     whichever shape Node hands us.
type PeerClass = typeof import('peerjs').Peer
let peerClass: PeerClass | null = null
async function getPeerClass(): Promise<PeerClass> {
  if (peerClass) return peerClass
  const mod = (await import('peerjs')) as unknown as { default?: PeerClass & { Peer?: PeerClass } }
  peerClass = mod.default?.Peer ?? mod.default ?? (mod as unknown as PeerClass)
  return peerClass
}
import type { DataConnection, PeerError } from 'peerjs'
import type { Action, RoomState } from '../../src/types.js'

function peerIdForCode(code: string): string {
  return `pips-${code.toLowerCase().replace(/[^a-z0-9-]/g, '')}`
}

export interface AiPlayerCallbacks {
  onState: (state: RoomState) => void
  onRejected: (reason: string) => void
  onDisconnected: () => void
}

export interface AiPlayerHandle {
  seatId: string
  sendAction: (action: Action) => void
  destroy: () => void
}

export async function joinAsAiPlayer(code: string, name: string, callbacks: AiPlayerCallbacks): Promise<AiPlayerHandle> {
  const Peer = await getPeerClass()
  return new Promise((resolve, reject) => {
    const peer = new Peer()
    let conn: DataConnection | null = null
    let settled = false

    peer.on('open', (seatId: string) => {
      const c = peer.connect(peerIdForCode(code), { reliable: true })
      conn = c
      c.on('open', () => {
        c.send({ kind: 'join', name, agent: true })
      })
      c.on('data', (raw: unknown) => {
        if (typeof raw !== 'object' || raw === null) return
        const msg = raw as Record<string, unknown>
        if (msg.kind === 'state' && 'state' in msg) {
          callbacks.onState(msg.state as RoomState)
          if (!settled) {
            settled = true
            resolve({
              seatId,
              sendAction(action) {
                if (conn?.open) conn.send({ kind: 'action', action })
              },
              destroy() {
                conn?.close()
                peer.destroy()
              },
            })
          }
        } else if (msg.kind === 'rejected' && typeof msg.reason === 'string') {
          callbacks.onRejected(msg.reason)
          if (!settled) {
            settled = true
            reject(new Error(msg.reason))
          }
        }
      })
      c.on('close', () => callbacks.onDisconnected())
    })
    peer.on('error', (err: PeerError<string>) => {
      if (!settled) {
        settled = true
        reject(err)
      }
    })
  })
}
