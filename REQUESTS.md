# Requests for the human

- [ ] 2026-08-31, cycle 2, non-blocking — the poker charter branch fixes
      TWO pre-existing Hold'em freezes that are LIVE on main (a 3+ player
      game freezes forever after any player busts; all-in seats get dead
      turns after a reopening raise). If you want these hotfixed to main
      before the whole charter lands, say so and the lead will cherry-pick
      the engine fixes onto a hotfix branch for a "push". Otherwise they
      ship with the charter.

- [x] 2026-08-24, Blackjack + Texas Hold'em charter wrap-up — RESOLVED
      2026-08-31: the user later said "push"; the worktree branch was
      merged to `main` and pushed (both games live on main). Item was
      stale-open, closed by the poker-variants charter lead. Original:
      **charter complete**, verified in the tree on `worktree-poker-blackjack-loop`
      (isolated worktree at `.claude/worktrees/poker-blackjack-loop`):
      6/6 milestones landed (Blackjack engine/screens/wiring, Hold'em
      engine/screens/wiring), 1398 tests / tsc / build green throughout,
      both games live-verified in a real browser at their max seat
      counts (Blackjack 6-seat, Hold'em 8-seat) including the CLAUDE.md-
      mandated bot-pacing check. Nothing merged/pushed yet per this
      project's standing git workflow — say "push" and I'll merge
      `worktree-poker-blackjack-loop` into `main` and push to `origin`,
      then prune the branch/worktree per the standing rule.

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

- [ ] 2026-08-23, Scrabble polish (spec 50) — 2 of 3 real bugs fixed and
      verified: deal-intro screen now shows the header during shuffle,
      and the bot rewrite actually searches for real dictionary words
      with cross-word validation instead of placing tiles in raw rack
      order (confirmed live: played "REBEC," a real word; also passed
      a hard performance bar — max 402ms across 120 test turns/3 seeds,
      well under the ~900ms pacing budget, after 3 rounds catching a
      real 11.3-second worst case and then a too-coarse time-budget
      fix). **The third bug — the table requiring scroll on normal
      viewports — is NOT fixed.** 4 fix rounds were attempted (vh-
      percentage sizing: still overflowed; flexbox intrinsic sizing:
      collapsed the board to an unusable 12px sliver while technically
      satisfying the no-scroll metric; JS-measured sizing: overlapped/
      broke the layout and hid the hand+action buttons entirely, worse
      than the original bug). Reverted the layout mechanism to the
      original safe (scrolling-required-but-fully-usable) baseline
      rather than land a broken intermediate state. This needs either
      a fresh, more careful attempt (possibly with tighter visual
      iteration than a single delegated round allows) or an explicit
      decision to accept scrolling for now — flagging rather than
      silently continuing to burn cycles on a slice that's failed 4
      times running.

- [x] 2026-08-23, Scrabble polish follow-up — the layout/scroll item
      above is now DONE too. Fixed personally by the lead (not
      delegated further, per the "4 failed rounds" note above) after
      actually reading the full component tree and doing the real
      height math rather than guessing: root cause was `.scr-table`
      using `min-height: 100vh` (a floor, not a ceiling) so oversized
      content just grew past it instead of ever being constrained —
      changed to a hard `height: 100vh`, switched `.scr-table-card`
      from a flex column to CSS Grid (`grid-template-rows: auto auto
      minmax(280px, 1fr) auto auto`, board in the flexible row), which
      handles an aspect-ratio child far more predictably than flex did
      across all 4 failed attempts. Also fixed two real, independent
      space hogs found along the way: a `.scr-code-chip` that
      duplicated the code `TableHeader`'s own `meta` prop already
      shows (no sibling game has this — a real, unnoticed pattern
      deviation, not just a space-saving hack) removed entirely; the
      opponent tile's 3-line stacked layout (name / score / a row of
      48px-tall tile-back fans) compacted to one line (dot, name,
      "N pts · M tiles") since the fan visual wasn't carrying
      information the text didn't already state. Verified live at
      1280×800 and 1440×900, both 2-seat and 4-seat: zero scroll,
      board a real legible size (280-321px depending on available
      room, not collapsed), a full turn played and a bot response
      ("WHEW" for 26) all visually confirmed correct in screenshots —
      not just the scrollHeight number, which is exactly what burned
      3 of the 4 prior attempts. 1214 tests / tsc / build green.
