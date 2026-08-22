# Requests for the human

- [x] 2026-08-09, Wahoo wrap-up — commit the charter: done, pushed
      (verified: full Wahoo commit sequence on `main`, HEAD == origin/main).
- [x] 2026-08-09, Wahoo wrap-up — real audio: done, user confirmed fine.
- [ ] 2026-08-09, non-blocking, cross-game — peer.ts systemic notes from
      the Wahoo review: `reject()` doesn't close the connection, and
      `onAction` keys purely on conn.peer (a reconnecting peer that
      knows a departed seat's old id could act for it — only that
      seat's former occupant in practice). Worth a small hardening pass
      affecting all multiplayer games.
- [ ] 2026-08-09, non-blocking — the app bundle crossed Vite's 500 kB
      chunk warning (ten games in one chunk). Consider per-game dynamic
      import() code-splitting in a future charter.

- [x] 2026-08-09, Battleship wrap-up — commit: done (13577cc, pushed).
- [x] 2026-08-09, Battleship wrap-up — real audio: done — user supplied
      ship-hit / ship-miss / ship-destroyed mp3s; installed as
      ship-hit / ship-miss / ship-sunk. Placement still reuses
      `piece-drop` by design.

- [x] 2026-08-09, engine-core wrap-up (done — user approved; committed 41fa325)
      was:  — **commit the charter**: the
      `src/engine/` promotion sits verified in the working tree (renames
      staged, imports + docs modified, 481 tests / tsc / build green). The
      loop can't commit (project CLAUDE.md). Say the word and it lands as
      one commit on `main`.
- [x] 2026-08-09 (done — constraint bullet added to CLAUDE.md) — CLAUDE.md's card-engine constraint
      paragraph predates `src/engine/`; consider codifying: `src/engine/`
      must not import React, screens/components, card-engine, card-games,
      or games — it is the bottom layer. (CLAUDE.md is user-owned, so the
      loop didn't touch it.)
- [x] 2026-08-09 (done — promoted, spec 12) — `src/card-engine/bot.ts` (`runBotTurn`) is
      fully generic; promote it to `src/engine/` whenever the first
      non-card game grows a house bot.

- [x] 2026-08-08, Connect 4 wrap-up — real audio: done — user supplied a
      real disc-drop mp3; placeholder replaced.
- [x] 2026-08-08, Connect 4 wrap-up — commit the charter: done — user
      authorized commit + push after wrap-up.

- [x] 2026-08-07 (done 2026-08-09 — user approved "run the requests"; everything pushed to origin/main) — the card-engine charter is complete
      (all 6 milestones, 165 tests, 12 commits on `main`). Nothing was pushed
      to GitHub — this project's standing policy is to ask first. Say the
      word and I'll push everything (this run's commits plus the earlier
      landing/bot-difficulty work) to `origin/main`.
- [x] 2026-08-07 (obsolete — full Rummy and Phase 10 shipped in later charters) — for whenever you want to pick this
      back up: the next piece is full Rummy (melds/sets/runs/scoring/
      multiple rounds) plus wiring a card-game session into the live lobby
      UI — neither started in this run by design. `docs/card-engine.md` §5
      is the precise handoff: what exists, what doesn't, and the one
      non-obvious pattern (the stock-visible-to-nobody closure wrapper) the
      next implementation needs to reuse rather than reinvent.

- [x] 2026-08-11 (done — e5dccc4, pushed) Checkers + Mexican Train charter — **commit the
      charter**: both games verified in the tree (772 tests / tsc / build
      green, four Oscar reviews — module CLEAN ×2, wiring CLEAN, MT
      screens+wiring APPROVE — plus two visual reviews with all findings
      fixed, live full checkers match + multi-round MT soak). Everything
      is uncommitted awaiting your morning look. Suggested: one commit per
      milestone (checkers module / checkers screens+wiring / MT module /
      MT screens+wiring+peer.sendTo) or a single charter commit — say
      which and "push".
- [x] 2026-08-11 (done — single horn per update, in e5dccc4) MT double-horn
      on a blocked round.
- [x] 2026-08-15, Uno charter — commit the charter: done, pushed
      (verified: full Uno commit sequence on `main`, HEAD == origin/main).

- [x] 2026-08-21, Solitaire charter — done, already merged to
      `origin/main` (confirmed present in the fetch ahead of the
      Scrabble merge below).
- [x] 2026-08-22, Scrabble charter wrap-up — done: all three
      milestones (engine spec 47, screens spec 48, wiring spec 49)
      verified in the tree on `claude/scrabble-engine-loop` (1128
      tests / tsc / build green throughout, live browser match-
      verified including the mandatory 4-seat bot-pacing check), user
      said "push" — merged into `main` and pushed to `origin`. Branch/
      worktree intentionally NOT pruned yet per explicit instruction.
