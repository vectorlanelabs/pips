# AI Player MCP Bridge — Test Findings & Changes

Date: 2026-08-23
Scope: `mcp-ai-player` (the `@pips/mcp-ai-player` MCP server) on branch `ai-player-farkle-mcp`.
Tester role: live-testing the bridge by driving it against a real, human-hosted Farkle room.

---

## 1. Context

The goal was to give an AI agent the ability to join a live Pips Farkle room as a real
player over the same PeerJS/WebRTC protocol a browser guest uses, so that "playing against
the AI" is an option when no human is available. The bridge exposes four MCP tools
(`join_room`, `get_state`, `submit_move`, `leave_room`) and is meant to be driven by an
MCP-capable agent, with a turn notification pushed when it becomes the AI's turn.

The bridge was built and tested end-to-end, including a full live match against a human
host. Several real bugs were found and fixed, and one architectural gap (the actual reason
the experiment initially "failed") was identified and addressed with a new autonomous mode.

---

## 2. Environment & Setup

- Node **v26.5.1**, npm **11.17.0**, git 2.47.3.
- `npm install` — 137 packages; `esbuild@0.24.2` and `node-datachannel@0.10.1` native
  binaries both present (verified at `node_modules/@esbuild/linux-x64/bin/esbuild` and
  `node_modules/node-datachannel/build/Release/node_datachannel.node`).
- npm 11 `allow-scripts` warnings appear for esbuild + node-datachannel, but the install
  scripts did run / the binaries were available, so the build and runtime both work.
- `npm run build` = `tsc -b --noEmit && node esbuild.config.js`. Build is clean.

---

## 3. Bugs Found & Fixed

### B1 — `Peer is not a constructor` (runtime, on `join_room`)

**Symptom:** `join_room` returned `isError: true` with `"Peer is not a constructor"`.

**Root cause:** `peerjs@1.5.5` ships its CJS build as `pkg.main` (`dist/bundler.cjs`) with
**no** `exports` map and `pkg.type` unset. Under Node ESM, `import Peer from 'peerjs'`
resolves to the CJS module and binds the **exports namespace object** as the default, not
the `Peer` class. `new Peer()` then threw. (The peerjs ESM build at `dist/bundler.mjs`
exists but is only reached via the `module` field, which Node ignores for bare imports.)

**Fix:** in `src/peerClient.ts`, normalize the constructor from whatever shape Node hands
over: `moduleNS.default?.Peer ?? moduleNS.default ?? moduleNS`. Kept the `Peer` type via
`typeof import('peerjs').Peer` so `new Peer()` stays type-safe. (This later became part of
the lazy loader in B2 — one code path for both issues.)

### B2 — `The current browser does not support WebRTC` (runtime, on `join_room`)

**Symptom:** after B1 was fixed, `join_room` next failed with
`"The current browser does not support WebRTC"` (a peerjs `BrowserIncompatible` abort).

**Root cause:** peerjs probes WebRTC support **at module-load time** (its `supports()`
function runs in the module body, checking `RTCPeerConnection` etc. on `globalThis`). The
bridge installs the node-datachannel polyfill via `Object.assign(globalThis, wrtc)` at the
top of `peerClient.ts`. But esbuild **hoists all static imports above module bodies**, so
`import ... from 'peerjs'` was evaluated *before* that `Object.assign` ran — the WebRTC
globals weren't installed yet, `supports.webRTC` was false, and `new Peer()` aborted.

**Fix:** load peerjs **lazily** with `await import('peerjs')` inside `joinAsAiPlayer` (first
use), which guarantees the polyfill globals are already installed. This also subsumes B1's
default-export normalization in a single place. (`node-datachannel` remains a static import
since it's the polyfill source, not a consumer.)

### B3 — `Server does not support logging (required for notifications/message)` — server crash

**Symptom:** after a successful join and the first AI turn, the whole server **crashed**
(uncaught throw in `maybeNotifyTurn` → `onState`), killing the live seat mid-game.

**Root cause:** `maybeNotifyTurn` called
`server.server.notification({ method: 'notifications/message', ... })`. The MCP SDK's
`Server.assertNotificationCapability` requires the **`logging` capability** to be declared
before it will send a `notifications/message` (a logging notification). The `McpServer` was
constructed with only `{ name, version }` and never registered `logging`, so the SDK threw.
Because it was thrown from inside the peerjs `onState` callback, it propagated as an
uncaught exception and took the process (and the game connection) down.

**Fix:** (a) declare the capability once at startup:
`server.server.registerCapabilities({ logging: {} })`; (b) use the SDK's
`sendLoggingMessage(...)` helper; (c) wrap the notification so that a failure is logged and
swallowed — a turn notification must never be able to kill a live game connection.

### B4 — The reactivity gap (the real reason the experiment first "failed")

**Symptom (as reported):** "after each of your turns, you're waiting for me to tell you it's
your turn instead of receiving the notification from the game." The AI acted on **stale
state** — it would respond to a snapshot where it was actually someone else's turn.

**Root cause:** the MCP `notifications/message` turn notification only helps an **event-driven
MCP client**. In this test the notifier was a chat-driven agent injecting JSON-RPC into the
bridge over stdio; that agent only runs when the user sends a message, so it never wakes on
the notification and always lags one turn behind. This is an architecture limitation of the
"manual agent / chat loop" calling pattern, not a bug in the notification itself.

**Fix:** add an **autonomous auto-play** mode so the bridge plays the AI seat by itself,
driven purely by the peerjs state stream (see §4). This removes the dependency on an
external agent reacting in real time and is what makes the AI a genuine self-playing player.

---

## 4. New Feature — Autonomous Auto-play

New file: `src/games/farkleBot.ts` — a standalone copy of the host's Farkle scoring +
decision logic (`scoreSelection`, `bestSubset`, `hasAnyScore`, `decideFarkleBot`). This is
deliberately duplicated (not imported) because the package is published standalone via npx
and cannot reach into `../../src` at runtime — the same constraint the existing move-schema
and state-trimming code already follow.

Config (env vars):
- `PIPS_AUTO_PLAY=1` — enable autonomous play.
- `PIPS_ROOM` — room code; when set with auto-play, the bridge auto-joins on start.
- `PIPS_NAME` — display name (default `Ziggy`).
- `PIPS_DIFFICULTY` — `easy | medium | hard` (default `medium`).
- `PIPS_DELAY_MS` — base delay per action (default `1600`; toggles at 50%).

Behavior (in `onState`, `src/index.ts:maybeAutoPlay`):
- Only acts when it's the AI seat's turn (`state.seats[state.turnIdx].id === seatId`).
- **Bust** (`farkle` true) → send `farkleEndTurn`.
- **Start of turn** (dice empty) → send `farkleRoll`.
- **Roll on the table** → compute `decideFarkleBot(...)`, toggle each kept die, then
  `farkleBank` or `farkleRoll`. Guarded by `lastRollSig` (sort of vals + turnScore) so each
  distinct roll is acted on once — this ignores intermediate "toggle artifact" states.
- Human-paced: waits `AUTO_DELAY_MS` before each decision, `AUTO_DELAY_MS*0.5` between
  toggles. Mirrors the host's `runFarkleBot` decision + pacing so the AI reads as a real
  player, not an instant responder.

Also added:
- **Auto-join** at startup when `PIPS_AUTO_PLAY=1` and `PIPS_ROOM` is set (runs alongside
  the stdio MCP server).
- **Exit-on-disconnect** in auto-play mode: since the host is authoritative, when the host
  leaves the connection closes and the room is gone; the bridge now exits cleanly instead
  of idling. (One process per live room.)

The four MCP tools remain available and unchanged for interactive / LLM-driven play;
auto-play is opt-in via env and does not remove them.

---

## 5. Other Changes

- `mcp-ai-player/tsconfig.json` — added `"types": ["node"]` (the code now uses
  `process.env` for auto-play config; `@types/node` was not previously in the build).
- `mcp-ai-player/package.json` — added `@types/node@^22` as a `devDependency`.
- `mcp-ai-player/package-lock.json` — updated by the above install.

---

## 6. Observations Worth a Reviewer's Eye

1. **`turnScore` under-reports the live value.** In the trimmed state, `turnScore` stays
   `0` while scoring dice are *selected/kept* — the host only folds kept-dice score into
   `turnScore` at **bank or reroll**, not on toggle. So an AI reading `get_state` cannot
   tell from `turnScore` what it's currently worth; it must recompute via `scoreSelection`
   on the kept dice. Consider exposing a computed `selectedScore` in `trimFarkleState` so a
   client agent doesn't have to reimplement Farkle scoring.

2. **No mid-game rejoin.** Each new peer/instance is a new guest; the host is authoritative
   and a guest cannot rejoin an in-progress game — the host must generate a fresh room code
   for each new AI instance. So an auto-play instance must be started fresh per room and
   kept alive for the whole game. (Confirmed live: abandoning a room ends the AI's game; the
   bridge reports "Not in a room" afterwards.)

3. **Auto-play is currently as deterministic as the built-in bots.** It uses the same
   `decideFarkleBot` heuristic. Same state → same decision. That is *flat, deterministic*
   play — the exact thing the experiment hoped to move away from. Getting genuinely
   less-deterministic play requires the decision to come from an LLM, not a fixed rule (see
   §8).

4. **Opening-500 rule → frequent early farkles.** Until a player's first bank reaches the
   `openingScore` (500), they cannot bank, so every turn is a push toward 500 or a bust. The
   medium bot therefore farkles a lot before its opening score. This is inherent to the
   game, not a logic bug.

5. **Pacing** — with `AUTO_DELAY_MS=1600` and half-delay toggles, a turn takes a few
   seconds. Confirm this reads as human-speed at a full table and does not race ahead of
   client-side animations (per the repo rule in `CLAUDE.md`).

---

## 7. Verification Performed

- `npm install` — clean; native binaries present.
- `npm run build` — clean (`tsc -b --noEmit` + `esbuild`).
- MCP `initialize` — responds with `pips-ai-player` v0.1.0, capabilities
  `{ logging, tools }`.
- MCP `tools/list` — `join_room`, `get_state`, `submit_move`, `leave_room` with correct
  input schemas (including the `farkleToggle{dieId}` / `farkleRoll` / `farkleBank` /
  `farkleEndTurn` discriminated union).
- **Live join** — joined a human-hosted room, host accepted, seated.
- **Full manual turn** — `roll → toggle(×3) → bank`; host updated score (banked) and
  advanced the turn.
- **Autonomous play** — joined a second room and played multiple turns with no external
  input (rolled / kept / rerolled / farkled / farkleEndTurn), driven purely by the state
  stream. Turn notification (logging) fires correctly and no longer crashes.
- **Disconnect** — host abandoned; `get_state` returned `"Not in a room"`; bridge exits.

---

## 8. Recommendations / Future Work (for the dev agent)

1. **True non-deterministic play.** To get varied, human-like play, route the turn decision
   to an LLM instead of the heuristic. Two viable shapes:
   - **(a)** The bridge calls an LLM with the trimmed state (e.g. via a configured model
     API) and executes the returned `{ type, dieId }` action. Keeps everything inside one
     process; latency and cost are the trade-offs.
   - **(b)** A reactive MCP-client host where the agent genuinely acts on the
     `notifications/message` turn notification and calls `get_state` / `submit_move`. This
     is the design the tools already target; the current chat-loop calling pattern just
     wasn't event-driven.
   Option (a) is the most self-contained and would run the same way the heuristic auto-play
   does, but with live LLM decisions.
2. **Confidence tests for auto-play** — hot-dice reset (all 6 used → back to 6), the
   farkle → `farkleEndTurn` transition, and the `lastRollSig` guard against re-acting on a
   re-broadcast of the same roll.
3. **Consider splitting modes** — keep the MCP tools (interactive / LLM-driven) and the
   auto-play engine as separate binaries, or gate them cleanly, so an operator doesn't get
   both at once.

---

_This file was produced from live testing on branch `ai-player-farkle-mcp`. All changes are
uncommitted on the branch (reviewed and landed by the developer agent)._
