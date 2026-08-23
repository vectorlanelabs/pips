# AI Player MCP Bridge — Test Findings & The Journey

Date: 2026-08-23
Scope: `mcp-ai-player` (the `@pips/mcp-ai-player` MCP server) on branch `ai-player-farkle-mcp`.
Author: live-testing by the (Hermes) tester agent; the intended product design is the
engineer/developer agent's.

> This document records **what was tested, what broke, what was fixed, and the reasoning
> behind the current state** — including a genuine misunderstanding during testing that
> led to a detour. It is written so the engineer agent reviewing this branch gets the full
> picture, not just the diff.

---

## 0. TL;DR

- **The intended product is a PUBLIC, reusable MCP server.** Anyone loads it onto their own
  MCP-capable harness (Claude Desktop, Cursor, ChatGPT, etc.), tells *their* AI "here's the
  room code, play Farkle with me," and **their model becomes the opponent** — non-deterministic,
  varied, because it's whatever AI the user brings. Repeatable, anyone anywhere.
- **The MCP server's four tools + turn notification IS that product, and it is correct.** It is
  harness-agnostic and model-agnostic by design.
- **Testing surfaced four real bugs** (all fixed — see §4) **and one architectural gap** (the
  reactivity problem — see §5).
- **The tester took a detour** in response to the reactivity gap: a deterministic auto-play
  engine that runs a fixed bot inside the bridge. This is the **wrong layer** for the goal (it
  hardcodes a local opponent, the opposite of "the user's own AI plays"). It is left in place
  deliberately so the engineer can decide whether to keep or remove it (§6). It is **not** the
  deliverable.
- **The "what would have worked" insight:** a cheap poller that checks state and wakes the LLM
  only when it's the AI's turn would close the reactivity gap while keeping the **LLM as the
  decision-maker** (§5). Whether that plays out automatically on *any* harness is the open
  question for the public goal (§5.3).

---

## 1. The goal (what we're building)

Give an AI the ability to join a live Pips game as a real player — over the same PeerJS/WebRTC
protocol a browser guest uses — so that "playing against an AI" is possible when no human is
available. The AI is the user's own model, driven through standard MCP tools, and the whole thing
is a reusable server anyone can load.

---

## 2. The journey (and the misunderstanding) — important to preserve

- The **engineer agent** designed `mcp-ai-player` for exactly that public use case: an MCP server
  exposing `join_room` / `get_state` / `submit_move` / `leave_room`, plus a turn notification so a
  harness agent knows when it's the AI's turn. That design is sound and is the product.
- The **tester (this doc's author)** misread the goal during live testing. Faced with the
  reactivity problem (§5), the tester concluded the bridge needed to be *self-driving* and added a
  **deterministic auto-play** engine that reuses the host's `decideFarkleBot` heuristic. That is
  the wrong layer: it hardcodes a local bot as the opponent, which is precisely the behavior the
  project is trying to get *away* from (flat, deterministic) and which the user can already get for
  free from the built-in house bots in their own browser.
- **Why the misunderstanding happened:** the tester was validating the pipeline in a chat-driven
  loop where the agent only runs when the user sends a message, so the agent could not react to the
  turn notification in real time. Rather than recognize that as a harness limitation, the tester
  "fixed" it by making the bridge not need the agent at all — which defeats the purpose.
- **Outcome:** the misunderstanding is understood; the auto-play engine is left in place for now so
  the engineer can decide (keep as a dev/test harness, or remove) once we've settled the direction
  from this testing. Nothing in this doc asserts that auto-play is the product.

---

## 3. Environment & Setup

- Node **v26.5.1**, npm **11.17.0**, git 2.47.3.
- `npm install` — 137 packages; `esbuild@0.24.2` and `node-datachannel@0.10.1` native binaries both
  present (verified at `node_modules/@esbuild/linux-x64/bin/esbuild` and
  `node_modules/node-datachannel/build/Release/node_datachannel.node`).
- npm 11 `allow-scripts` warnings appear for esbuild + node-datachannel, but the install scripts did
  run / the binaries were available, so build and runtime both work.
- `npm run build` = `tsc -b --noEmit && node esbuild.config.js`. Build is clean.

---

## 4. Bugs Found & Fixed

### B1 — `Peer is not a constructor` (runtime, on `join_room`)

**Symptom:** `join_room` returned `isError: true` with `"Peer is not a constructor"`.

**Root cause:** `peerjs@1.5.5` ships its CJS build as `pkg.main` (`dist/bundler.cjs`) with **no**
`exports` map and `pkg.type` unset. Under Node ESM, `import Peer from 'peerjs'` resolves to the CJS
module and binds the **exports namespace object** as the default, not the `Peer` class, so
`new Peer()` threw. (The peerjs ESM build at `dist/bundler.mjs` exists but is only reached via the
`module` field, which Node ignores for bare imports.)

**Fix:** in `src/peerClient.ts`, normalize the constructor from whichever shape Node hands over:
`moduleNS.default?.Peer ?? moduleNS.default ?? moduleNS`, keeping the `Peer` type via
`typeof import('peerjs').Peer`. (Later folded into the lazy loader in B2 — one code path for both.)

### B2 — `The current browser does not support WebRTC` (runtime, on `join_room`)

**Symptom:** after B1 was fixed, `join_room` failed with `"The current browser does not support
WebRTC"` (a peerjs `BrowserIncompatible` abort).

**Root cause:** peerjs probes WebRTC support **at module-load time** (its `supports()` function runs
in the module body, checking `RTCPeerConnection` etc. on `globalThis`). The bridge installs the
node-datachannel polyfill via `Object.assign(globalThis, wrtc)` at the top of `peerClient.ts`, but
esbuild **hoists all static imports above module bodies**, so `import ... from 'peerjs'` evaluated
*before* that `Object.assign` ran — the WebRTC globals weren't installed yet, `supports.webRTC` was
false, and `new Peer()` aborted.

**Fix:** load peerjs **lazily** with `await import('peerjs')` inside `joinAsAiPlayer` (first use),
guaranteeing the polyfill globals are already installed. This also subsumes B1's default-export
normalization in one place. (`node-datachannel` stays a static import — it's the polyfill source,
not a consumer.)

### B3 — `Server does not support logging (required for notifications/message)` — server crash

**Symptom:** after a successful join and the first AI turn, the whole server **crashed** (uncaught
throw in `maybeNotifyTurn` → `onState`), killing the live seat mid-game.

**Root cause:** the turn notification called
`server.server.notification({ method: 'notifications/message', ... })`. The MCP SDK's
`Server.assertNotificationCapability` requires the **`logging` capability** to be declared before it
will send a `notifications/message`. The `McpServer` was constructed with only `{ name, version }`
and never registered `logging`, so the SDK threw. Because it threw from inside the peerjs `onState`
callback, it propagated as an uncaught exception and took the process (and the game connection) down.

**Fix:** (a) declare the capability once at startup:
`server.server.registerCapabilities({ logging: {} })`; (b) use the SDK's `sendLoggingMessage(...)`
helper; (c) wrap the notification so a failure is logged and swallowed — a turn notification must
never be able to kill a live game connection.

### B4 — The reactivity gap (the reason the agent-first flow didn't "take off")

**Symptom (as reported):** "after each of your turns, you're waiting for me to tell you it's your
turn instead of receiving the notification from the game." The AI acted on **stale state** — it would
respond to a snapshot where it was actually someone else's turn.

**Root cause:** the MCP `notifications/message` turn notification only helps an **event-driven MCP
client**. In this test the notifier was a chat-driven agent injecting JSON-RPC into the bridge over
stdio; that agent only runs when the user sends a message, so it never wakes on the notification and
always lags one turn behind. This is an architecture limitation of the "manual agent / chat loop"
calling pattern, **not** a bug in the notification itself.

---

## 5. The reactivity gap, in detail, and "what would have worked"

### 5.1 The core question
How does an AI know when to act (it's its turn) in a way that works for a *generic* harness?

### 5.2 Would "check every 5 seconds" have worked?
**Yes — but only if the checking is done by a real poller, not by the LLM "remembering to check."**

When you tell an AI agent "check every 5 seconds," it cannot hold an indefinite loop inside a normal
chat turn: it calls `get_state` a few times and then its turn ends (the assistant response
completes). It has no persistent timer. So "poll every 5 seconds" as an instruction to a *chat agent*
does not sustain on its own.

**What actually would have worked:** a *dumb* poller separate from the LLM.

1. A cheap loop/script (in Hermes: a background watcher or a `monitor_script` cron) checks state
   every ~5s.
2. When it's **not** the AI's turn → it stays quiet (near-zero cost, no agent run).
3. When it **is** the AI's turn → it wakes the LLM, which reads the board and decides via
   `submit_move` (`roll` / `toggle dieId` / `bank` / `end`). The user's model, non-deterministic.
4. Repeat until the game ends.

That closes the reactivity gap (no human nudge needed), keeps the **LLM as the decision-maker**
(not a bot), and is cheap because the poller is a script and the model only fires when it's genuinely
the AI's turn. **This is the transparent pattern that would have worked and is what should have been
built** (it is not what was built — see §6).

### 5.3 The harness-autonomy caveat (the real open question for the public goal)
Whether *any given harness* lets its agent run that poll loop or react to the turn notification is up
to the **harness** — Claude Desktop / Cursor / ChatGPT each handle MCP server events differently. The
MCP server is correct either way because it exposes **both**:
- `get_state` — so an agent/harness can **poll**; and
- the turn notification — so an **event-driven** harness can react.

The autonomy lives on the harness/client side; the server just makes both vectors available. **This
should be verified against real harnesses (Claude Desktop / Cursor / ChatGPT) before finalizing the
UX**, and it is worth a note in the README for users so they know what "the game takes off on its own"
looks like on their setup.

---

## 6. Autonomous auto-play (the detour) — current state

New file `src/games/farkleBot.ts` — a standalone copy of the host's Farkle scoring + decision logic
(`scoreSelection`, `bestSubset`, `hasAnyScore`, `decideFarkleBot`). Deliberately duplicated (not
imported) because the package is published standalone via npx and can't reach into `../../src` at
runtime — the same constraint the existing move-schema and state-trimming code already follow.

Config (env vars): `PIPS_AUTO_PLAY=1`, `PIPS_ROOM` (auto-joins on start), `PIPS_NAME` (default
`Ziggy`), `PIPS_DIFFICULTY` (`easy|medium|hard`, default `medium`), `PIPS_DELAY_MS` (default `1600`;
toggles at 50%).

Behavior (in `onState`, `src/index.ts:maybeAutoPlay`): only acts when it's the AI seat's turn; sends
`farkleEndTurn` on a bust, `farkleRoll` at the start of a turn, and on a live roll computes
`decideFarkleBot(...)`, toggles the kept dice, then `farkleBank` or `farkleRoll`. Guarded by
`lastRollSig` so each distinct roll is acted on once. Human-paced waits.

Also added: **auto-join** at startup, and **exit-on-disconnect** in auto-play mode (the host is
authoritative, so a host disconnect ends the room; the bridge exits rather than idling).

> **Status: this is a dev/test harness, NOT the product.** It hardcodes a deterministic bot as the
> opponent, which contradicts the intended goal (the user's own AI plays). It is left in place
> deliberately so the engineer can decide — keep it (as a local test harness) or remove it — based
> on the direction settled after this testing.

---

## 7. Other Changes

- `mcp-ai-player/tsconfig.json` — added `"types": ["node"]` (the code now uses `process.env` for
  auto-play config; `@types/node` was not previously in the build).
- `mcp-ai-player/package.json` — added `@types/node@^22` as a `devDependency`.
- `mcp-ai-player/package-lock.json` — updated by the above install.

---

## 8. Observations Worth the Engineer's Attention

1. **`turnScore` under-reports the live value.** In the trimmed state, `turnScore` stays `0` while
   scoring dice are *selected/kept* — the host only folds kept-dice score into `turnScore` at **bank
   or reroll**, not on toggle. So an AI reading `get_state` cannot tell from `turnScore` what it's
   currently worth; it must recompute via `scoreSelection` on the kept dice. Consider exposing a
   computed `selectedScore` in `trimFarkleState` so a client agent doesn't have to reimplement Farkle
   scoring.

2. **No mid-game rejoin.** Each new peer/instance is a new guest; the host is authoritative and a guest
   cannot rejoin an in-progress game — the host must generate a fresh room code for each new AI
   instance. (Confirmed live: abandoning a room ends the AI's game; the bridge reports "Not in a room"
   afterwards.)

3. **Auto-play is as deterministic as the built-in bots.** Same state → same decision. This is the
   detour (§6) and is not what the project is after.

4. **Opening-500 rule → frequent early farkles.** Until a player's first bank reaches `openingScore`
   (500), they cannot bank, so every turn is a push toward 500 or a bust. The medium bot therefore
   farkles a lot before its opening score. Inherent to the game, not a logic bug. (Notably, an LLM
   opponent will do the same if it plays by the rules — "less deterministic" also means "will take
   human-style risks and bust.")

5. **Pacing.** With `AUTO_DELAY_MS=1600` and half-delay toggles, a turn takes a few seconds. Confirm it
   reads as human-speed at a full table and does not race ahead of client-side animations (per the repo
   rule in `CLAUDE.md`).

---

## 9. Verification Performed

- `npm install` — clean; native binaries present.
- `npm run build` — clean (`tsc -b --noEmit` + `esbuild`).
- MCP `initialize` — responds with `pips-ai-player` v0.1.0, capabilities `{ logging, tools }`.
- MCP `tools/list` — `join_room`, `get_state`, `submit_move`, `leave_room` with correct input schemas
  (including the `farkleToggle{dieId}` / `farkleRoll` / `farkleBank` / `farkleEndTurn` union).
- **Live join** — joined a human-hosted room, host accepted, seated.
- **Full manual turn** — `roll → toggle(×3) → bank`; host updated score (banked) and advanced the turn.
- **Autonomous play** — joined a second room and played multiple turns with no external input
  (rolled / kept / rerolled / farkled / farkleEndTurn), driven purely by the state stream. The turn
  notification (logging) fires correctly and no longer crashes.
- **Disconnect** — host abandoned; `get_state` returned `"Not in a room"`; bridge exits (auto-play mode).

---

## 10. Recommendations / Path Forward (for the engineer/developer agent)

1. **Reconfirm the public-product framing.** The deliverable is the MCP server (tools + turn
   notification) so any harness's AI can be the opponent. The deterministic auto-play is a test harness
   (§6) and its fate should be decided once the direction is settled.
2. **Drive the "AI plays on its own" via a poller that wakes an LLM** (the §5.2 pattern) rather than the
   deterministic bot — poll cheaply, wake the model only on the AI's turn, and let the model decide.
   This is the LLM-driven, non-deterministic behavior the project wants.
3. **Verify harness autonomy.** Confirm against real harnesses (Claude Desktop / Cursor / ChatGPT)
   whether the agent reacts to the turn notification or needs a poll/nudge, and document the reality in
   the README.
4. **Confidence tests** for the auto-play harness (if kept): hot-dice reset, farkle → `farkleEndTurn`
   transition, and the `lastRollSig` guard against re-acting on a re-broadcast of the same roll.
5. **Consider exposing a computed `selectedScore`** in `trimFarkleState` (§8.1) so an LLM client gets
   the live turn value without reimplementing Farkle scoring.

---

_Produced from live testing on branch `ai-player-farkle-mcp`. The journey and misunderstood detour are
documented so the engineer reviewing this branch has the complete context and can decide the next step
from an informed position._
