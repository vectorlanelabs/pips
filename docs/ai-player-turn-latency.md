# AI Player Turn Latency — Tool-Call Analysis

Date: 2026-08-23
Scope: `mcp-ai-player` (branch `ai-player-farkle-mcp`), live testing against a human-hosted Farkle room.
Purpose: document why the AI opponent's turns are slower than a human's, based on the **exact tool-call sequence** required to play one turn, and propose bridge-level optimizations.

---

## 1. TL;DR

- One AI turn requires **many separate MCP tool calls** (a 3-reroll turn took **18 round-trips**).
- Each round-trip is one LLM inference + tool call in the agent loop, so turn time ≈ **steps × per-step latency**.
- The step **count** (not the model "thinking") is the dominant cost. A faster model helps per-step but the sequence stays heavy.
- Two bridge-level trims would roughly halve (or better) the round-trips:
  1. `submit_move` returns the resulting state (kills the separate `get_state` calls).
  2. A multi-die "keep" action (kills the one-call-per-die `farkleToggle` storm).

---

## 2. The exact tool-call sequence for one turn

Observed live (the turn that banked 650). Each row is a distinct MCP tool call = one round-trip:

| # | Tool | Args | What it did |
|---|------|------|-------------|
| 1 | `wait_for_turn` | `{timeoutMs:30000}` | Blocked until it was Ziggy's turn; returned board (dice empty) |
| 2 | `submit_move` | `{action:{type:"farkleRoll"}}` | Rolled 6 dice |
| 3 | `get_state` | `{}` | Read roll → 2,2,2,5,4,6 |
| 4 | `submit_move` | `{action:{type:"farkleToggle",dieId:0}}` | Keep a 2 |
| 5 | `submit_move` | `{action:{type:"farkleToggle",dieId:1}}` | Keep a 2 |
| 6 | `submit_move` | `{action:{type:"farkleToggle",dieId:2}}` | Keep a 2 |
| 7 | `submit_move` | `{action:{type:"farkleToggle",dieId:3}}` | Keep the 5 |
| 8 | `submit_move` | `{action:{type:"farkleRoll"}}` | Reroll 2 dice (4,6) |
| 9 | `get_state` | `{}` | Read reroll → 5,5, turnScore 250 |
| 10 | `submit_move` | `{action:{type:"farkleToggle",dieId:0}}` | Keep a 5 |
| 11 | `submit_move` | `{action:{type:"farkleToggle",dieId:1}}` | Keep a 5 |
| 12 | `submit_move` | `{action:{type:"farkleRoll"}}` | Hot dice — reroll all 6 |
| 13 | `get_state` | `{}` | Read reroll → 3,3,4,6,3,2, turnScore 350 |
| 14 | `submit_move` | `{action:{type:"farkleToggle",dieId:0}}` | Keep a 3 |
| 15 | `submit_move` | `{action:{type:"farkleToggle",dieId:1}}` | Keep a 3 |
| 16 | `submit_move` | `{action:{type:"farkleToggle",dieId:4}}` | Keep a 3 |
| 17 | `submit_move` | `{action:{type:"farkleBank"}}` | Banked 650 |
| 18 | `get_state` | `{}` | Verified Ziggy=650, turn passed |

**18 round-trips for one turn:** 3 `farkleRoll` + 4 `get_state` + 9 `farkleToggle` + 1 `farkleBank` + 1 `wait_for_turn`.

---

## 3. Why it's slow

- **Step count dominates.** Every reroll forces a `roll → get_state (read) → toggle keep → ...` cycle; every kept die adds a `farkleToggle`. Farkle turns with several rerolls (or hot-dice runs) multiply the steps.
- **Per-step latency** = one LLM inference + tool call, and it grows as the session context accumulates (full chat history + large system prompt) across the turn.
- **Model choice matters secondarily.** Switching from a vision model to a fast text-only low-reasoning model cut per-step time but did not change the step count, so multi-reroll turns stayed slow.

### Observed turn durations (approx., from process uptime deltas)
| Turn shape | Duration |
|------------|----------|
| 1-reroll, bank immediately | ~20s |
| 2-reroll, bank | ~50s |
| 3-reroll (the 650 bank above) | ~80s |

---

## 4. The waste — and how to trim it

1. **`submit_move` returns the resulting state.** Today it returns only `"Sent farkleRoll."`, so the agent must call `get_state` after *every* action (roll, and again just to verify a bank). If `submit_move` (or a combined "roll-and-return-board" tool) returned the updated trimmed state, 3 of the 4 `get_state` calls disappear. **Biggest single win.**
2. **A multi-die "keep" action.** Today keeping N dice is N `farkleToggle` calls. A `keep [dieIds]` (or an action where the agent submits its chosen move and the host applies it) collapses 9 toggles into ~1.
3. **(Model-side, not the bridge)** a fast text-only model + keeping the session context lean reduces per-step latency. This is a harness/model config knob, not a server change.

### Expected effect
- 3-reroll turn: **18 → ~6 round-trips**, ~80s → ~20–30s.
- 1-reroll turn: ~8 → ~3–4 round-trips, ~20s → ~8–12s.

---

## 5. Recommended action for the engineer

- Have `submit_move` return the post-action trimmed state (so the client agent doesn't re-query).
- Consider a batched `keep` action (or a "make my move" action the host applies in one step).
- Optionally expose a `get_state`-in-the-response flag so the agent never needs an extra round-trip to read the board.

This is the difference between the AI reading as "cautiously slow" vs. "a normal player." The latency is a round-trip-count problem, not a reasoning problem.
