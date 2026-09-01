# Roadmap

Charter: Poker round 2 (Omaha + Deuces Wild + Ante) — see `CHARTER.md`.

## Charter: Poker round 2 (2026-09-01) — active

Branch `charter/poker-omaha-house-rules`.

### Done (this charter)
- [cycle 2] M8 — house-rules engine (fd9c97f). Wilds evaluator with
  oracle proofs, ante-replaces-blinds, sweeps per rule. Review found a
  BLOCKING all-in-on-ante hang (lead-reproduced; fixed via the standard
  closure machinery + regressions). 1814 tests.
- FOLLOW-UP (deferred, tracked): bot pre-river flush-draw heuristics
  ignore wilds — strategy quality only, never legality. Candidate for
  a polish cycle or the next charter.
- [cycle 1] M6+M7 — Omaha Hold'em (5fff56d). Exactly-2+3 evaluator with
  pinned gotcha tests; isDrawVariant refactor; TWO more latent holdem
  bot bugs found by sweeps/review (short-stack illegal raise in both
  new and holdem branches; PokerTable isDraw straggler) — all fixed;
  flop render live-verified. 1778 tests.

### Next up
1. M9 — house-rules screens + wiring.
2. M10 — live verification; wrap-up for owner play-test.

## Charter: Poker variants (2026-08-31) — done (merged & pushed 2026-08-31)

Branch `charter/poker-variants`. Plan: `specs/60-poker-draw-variants.md`.
All six milestones complete; definition of done met; live-verified.

### Done (this charter)
- [cycle 2] M8 — house-rules engine (fd9c97f). Wilds evaluator with
  oracle proofs, ante-replaces-blinds, sweeps per rule. Review found a
  BLOCKING all-in-on-ante hang (lead-reproduced; fixed via the standard
  closure machinery + regressions). 1814 tests.
- FOLLOW-UP (deferred, tracked): bot pre-river flush-draw heuristics
  ignore wilds — strategy quality only, never legality. Candidate for
  a polish cycle or the next charter.
- [cycle 5] M4 — Battleship Mode dropdown (a3ebaab; lead removed the
  stale 'House rules' heading the implementer left). M5 — full live
  verification (a82d4e1): five-draw at max 6 seats end to end, bot draw
  pacing MEASURED at 911-918ms gaps (=BASE_MS) across 5 consecutive bot
  draws; seven-draw at max 5 seats through a 4-way all-in with two-tier
  side pots paid to the chip; heads-up five-draw on the fixed selection
  path; holdem regression (board deals, betting normal); Battleship
  dropdown functional. Two live findings fixed: nested-button DOM
  violation (now PlayingCard's native selected/onClick, the Rummy
  sibling pattern the M2 spec should have cited) and a bot min-raise
  war throttle (8BB cap; a live hand ran ~25 min-raises to a 4-way
  all-in before it).
- [cycle 4] M3 — wiring (see git log). Variant through room flow,
  variant-aware caps, deal-hold scales with hand size, draw-round bot
  fallback. Review: clean with receipts.
- [cycle 3] M2 — variant screens (3b3e193). Dropdown room, draw UI,
  sort toggle, variant overlay, Poker landing tile. Review: wiring
  findings rejected-as-designed (=M3); double-submit guard fixed.
- [cycle 2] M1 — draw-poker engine (ef8e01a). 1757 tests (all 1723
  pre-existing pass unmodified). Sweeps exposed TWO pre-existing holdem
  freezes (eliminated-seat rotations; all-in dead turns) — both fixed
  at the engine with regressions. Review: 2 blocking (deck commit on
  rejected action; missing seat-cap enforcement) fixed + regressions.
- [cycle 1] M0 — mechanical rename holdem→poker (de91b44). 247 diff
  lines, all proven pure token substitution; 1723 tests untouched.

## Charter: Blackjack + Texas Hold'em (2026-08-23) — done (merged & pushed)

**Charter complete.** Both Blackjack (2-6 players, vs. the house) and
Texas Hold'em (2-8 players, no-limit cash game) are fully playable end
to end — engine, screens, and wiring for both, live-verified in a real
browser at each game's max seat count. Running in isolated worktree
`.claude/worktrees/poker-blackjack-loop` (branch
`worktree-poker-blackjack-loop`) per explicit user instruction.
Uncommitted to `main`/`origin` — pending the user's explicit "push".

## Done
- [cycle 8] M5 — Hold'em wiring (spec 57): App.tsx per-guest sendTo
  broadcast (privacy-correct, not Blackjack's single-broadcast
  shortcut), single-current-player bot loop, route/Landing/README.
  Found and fixed a permanent-hang risk (bot strategy could propose an
  illegal re-raise; fixed at the source plus a wiring-level fallback-
  to-fold safety net). **Full live playthrough at a maxed 8-seat table**:
  multiple hands, correct betting/privacy/side-pot payout/hand
  advancement, zero errors, bot pacing measured at 845-951ms gaps
  (matches BASE_MS). 1398 tests / tsc / build clean.
- [cycle 7] M4 — Hold'em screens (spec 56): Room/Table/Board/
  RulesOverlay, correct private-hand rendering (mirrors Rummy, not
  Blackjack). One severe bug found and fixed: the action area made
  Fold/Check/Call mutually exclusive with the bet/raise slider,
  making the game unplayable in its most common turns. 1398 tests /
  tsc / build clean.
- [cycle 6] M3 — Hold'em engine (spec 55 + 55b): shoe/blinds/betting/
  side-pots/hand-eval/elimination. 4 severe bugs found and fixed
  beyond the delegated fix round (2 by the lead personally, past the
  "fails twice, fix it yourself" threshold): a regression the fix
  round itself introduced (hand freezes forever once exactly 1 live
  player remains), FOLD never checking for street closure, and the
  "short all-in doesn't reopen re-raising" rule being completely
  unenforced (with its own test vacuous). 1395 tests / tsc / build
  clean.
- [cycle 5] Blackjack live-verified in a real browser (Playwright
  ad-hoc driver, MCP browser tab's visibilityState was permanently
  'hidden' so DealIntro's rAF-gated animation couldn't be checked
  there). Found and fixed the charter's most severe bug: settleRound's
  chipDelta math treated chips as pre-bet when they were already
  post-bet-escrow, so every win netted $0 profit, every bust cost 2x
  the bet, and pushes lost the entire bet — invisible to 75 passing
  unit tests since none asserted a real post-settlement chip total.
  Fixed with hand-verified arithmetic + 8 new tests; also fixed two
  small round-over-banner display bugs (double plus-sign, confusing
  "lose 0" display) found in the same live re-check. Blackjack (M0-M2)
  now genuinely complete and live-verified. 1329 tests / tsc / build
  clean.
- [cycle 4] M2 — Blackjack wiring (spec 54): App.tsx host/guest session,
  novel multi-phase bot loop (betting/insurance/acting), route/Landing/
  README. One bug found in review (card-back picker wired to a dead
  ref) and fixed. 1321 tests / tsc / build clean.
- [cycle 3] M1 — Blackjack screens (spec 53): Room/Table/RulesOverlay,
  no Results screen (deliberate — no match winner concept). One bug
  found in review (deal-intro animation desynced from the real deal
  event) and fixed. 1321 tests / tsc / build clean.
- [cycle 2] M0 — Blackjack engine (spec 52): shoe/betting/insurance/
  splits/doubles/dealer-play/payouts. One blocking bug found in review
  (order-dependent insurance resolution) and fixed. 1321 tests / tsc
  clean. Commit `6479144`.

## Charter: Scrabble (2026-08-22) — done

**Charter complete.** Scrabble is a real, playable 2-4 player game end
to end — engine, screens, and wiring all landed, following this
codebase's established conventions throughout (Skip-Bo's N-seat lobby/
broadcast/bot-loop shape, Dominoes' select-then-confirm interaction
language, Chess's inert forced-choice overlay pattern) with every
deliberate departure (the challenge-mechanic bot scheduler, the
dictionary-loading lifecycle) explicitly locked in a spec first, not
improvised. Uncommitted to `main`/`origin` — pending the user's
explicit "push" per this project's standing git workflow.
- [x] M0 — engine (spec 47): dictionary generator + real ENABLE1
      DAWG asset (168,551 words, 362.2 KB gzipped), board.ts premium
      layout, state/rules/bot. 1127 tests / tsc / build green.
      Implementer: Haiku (deepseek unavailable in this session, its
      documented fallback used from cycle 1). Review: the lead,
      personally, fallback adversarial persona (no ai-grouch-claude
      installed) — genuinely adversarial across 2 rounds, not a
      rubber stamp: round 1 live-reproduced 2 blocking bugs
      (EXCHANGE_TILES silently destroying a tile every use;
      a successful CHALLENGE ballooning the placer's rack past
      RACK_SIZE) plus 2 majors (per-word scores hardcoded to 0;
      missing/vacuous required tests) the implementer's own "all
      green" report had missed entirely. Round 2's fix for the
      rack-ballooning bug introduced a NEW bug (publicState.bagCount
      left stale after a successful challenge, caught only because
      the lead's repro checked the actual public field rather than
      the internal session state) — fixed in a third scoped round.
      One nit (dead branch in dictionary.ts's isWord) confirmed
      genuinely unreachable-by-design against all 52,928 real DAWG
      nodes and rejected rather than fixed, same disposition class as
      Skip-Bo's precedent. The real dictionary asset itself was built
      by the lead directly (not delegated) after the implementer's
      sandbox turned out to have no network access — fetched ENABLE1
      from a public mirror, vendored it, ran the already-written
      generator script.
- [x] M1 — screens (spec 48): ScrabbleRoom (SkipBoRoom mirror),
      ScrabbleTable (board/rack/staged-placement flow, blank-tile A-Z
      overlay, opponent rail, status block), ScrabbleResults (handles
      the tied-winner case no sibling needs), ScrabbleRulesOverlay,
      ScrabbleTileBack. Brand color `#8b6e47` (grepped existing
      colors first, picked an unused warm-brown "paper/wood board"
      tone). 1127 tests (unchanged, screens get no dedicated tests
      here) / tsc / build green. Review (lead, personally): 2 rounds.
      Round 1 found 2 blocking bugs the implementer's own "all green"
      report missed — the deal-intro shuffle animation replaying on
      EVERY turn (keyed off `turnNumber`, which increments every move,
      not once at game start; a severe violation of CLAUDE.md's
      mandatory bot-pacing top-priority rule) and the Table screen's
      Rules button being a dead no-op despite `ScrabbleRulesOverlay`
      existing and being correctly wired in Room — plus a major
      (opponent names/colors had no props to receive them at all,
      making 3-4 player games visually indistinguishable) and a minor
      (duplicate score display). All 4 fixed and independently
      re-verified by reading the actual diff, not trusting the report.
      No live browser check possible yet (not wired into App.tsx) —
      the wiring spec is where that finally happens.
- [x] M2 — wiring (spec 49): App.tsx lobby/broadcast/bot-per-seat,
      Landing.tsx shelf tile, route.ts, README. One genuine departure
      from Skip-Bo's bot-loop shape (locked in the spec): CHALLENGE
      isn't turn-gated, so the bot scheduler scans all bot seats for
      challenge eligibility each tick rather than only waking the
      current-turn bot. Host-only async dictionary loading, awaited
      before game start. 1128 tests (1127+1, a kept deterministic
      geometry test from the duplicate-word investigation below) /
      tsc / build green. Review (lead, personally, highest risk tier
      of the charter — host-authoritative state + private-rack
      delivery + real bot scheduling): found and fixed, across several
      rounds, the most consequential defects of this entire charter,
      all via a live browser check the implementer's own sandbox
      couldn't perform (no chromium-cli/project run-skill existed
      here, so the lead wrote a self-contained Playwright driver in
      an isolated scratch dir against this environment's pre-installed
      Chromium):
      1. A tie-routing bug (Results screen required `winnerId`
         truthy, blanking out on a real tied-game outcome) — caught by
         direct code reading before the live check even started.
      2. **Scrabble was completely unplayable**: the composite
         "show Landing" guard in App.tsx enumerated every other game's
         role flag but never got `!scrabbleRole` added, so the app
         silently never left the shelf screen no matter what state
         Scrabble's own wiring set — invisible to tsc/test/build and
         to a code read that didn't specifically trace that one
         guard's full boolean chain against the newest game.
      3. The dictionary asset fetch hardcoded an absolute root path,
         ignoring this site's configured `/pips/` Vite base — would
         have 404'd in the real deployed site too, not just this
         sandbox; fixed to use `import.meta.env.BASE_URL`.
      4. A live-observed scoring anomaly (a cross-word appearing twice
         in one placement's summary) got a proper multi-round
         investigation rather than a quick patch: round 1's fix
         (unverified defensive dedup + a vacuous RNG-gated test) was
         REJECTED on independent review and sent back; round 2
         constructed a deterministic reproduction attempt, found no
         mechanism could produce a genuine same-position duplicate,
         and correctly removed the unverified dedup per CLAUDE.md's
         "no defensive code for conditions that can't occur" rather
         than keeping a fix that was never actually proven necessary.
      Full live playthrough otherwise confirmed correct: deal intro
      fires exactly once, a 2-tile first placement scores and turn-
      advances correctly, the host correctly rejects an invalid
      1-tile first move, and — the CLAUDE.md-mandated pacing check —
      real wall-clock gaps between 5 consecutive bot actions at a
      maxed 4-seat table measured 831-1050ms, matching the intended
      ~900ms per-action pacing with no stacked/instant actions.
      Blank-tile popup and the challenge/results paths were verified
      via direct code reading (already reviewed correct in the spec-
      48 round) rather than a forced live repro of a random blank-
      tile draw or an engineered challenge — noted honestly as a
      live-verification gap, not claimed as performed.

## Charter: Solitaire (2026-08-21) — done
- [x] Spec 47 — rules engine: `src/card-games/solitaire/` (state.ts,
      shared.ts, klondike.ts, freecell.ts + tests). Both modes' deal,
      move validation, auto-flip, stock/waste recycle, supermove cap,
      win detection. Pure, serializable. 1136 tests (1087 + 49) /
      tsc / build green. Oscar review (lead): 1 minor defect with a
      live repro (validator threw on non-integer indexes) + 4 slop
      items, all fixed — see DEVLOG Cycle 23.
- [x] Spec 48 — screens: SolitaireRoom (1-player, card back, mode),
      SolitaireTable (+css), SolitaireRulesOverlay, SolitaireResults,
      plus CardBackPicker extracted from RummyRoom (shared by both
      lobbies) and a 50×70 `pile` CardBack size. 1136 tests / tsc /
      build green. Oscar review (lead): 2 blocking + 6 major + nits,
      all fixed over two implementer passes — see DEVLOG Cycle 24.
      First implementer retired (committed despite the git ban).
- [x] Spec 49 — wiring: shelf tile (last on the shelf, "1 player",
      olive), `/pips/solitaire` route + test, App state (history-of-
      states undo, shared `setCardBackPreference`), lobby/table/results
      render blocks. 1137 tests / tsc / build green. Lead review of the
      full diff (small, decision-locked wiring): clean. Live check of
      BOTH modes in the browser — see DEVLOG Cycle 25.
- [x] Spec 50 — polish: NOT needed. Live play surfaced nothing that
      contradicts a sibling convention; two accepted deviations are
      recorded in DEVLOG Cycle 25 (DealIntro's "You · 7/8" pile label,
      results screen not reachable in a live session without winning a
      deal).
- [x] Pushed to `main` together with the Scrabble charter (both were
      awaiting "push"; the user authorized it once, covering both).

## Charter: Skip-Bo (2026-08-17) — done, see below

## Charter: Skip-Bo (2026-08-17) — done
- [x] Card-engine module (spec 40): deck.ts (162-card deck), state.ts,
      rules.ts, bot.ts + tests. 2-4 seats, no scores/match layer —
      single-round instant win when a stockpile empties. Mirrors
      Phase10/Rummy's exact engine conventions (Zone/Card primitives,
      TurnState, HostSession) — the shared draw pile's full card
      identity lives host-only outside HostSession, matching Rummy's
      own `stock` precedent, with only its count public. Auto-targeting
      (furthest-along build pile, ties -> lowest index) shared by all
      three play sources; mid-turn win check fires the instant
      PLAY_STOCK empties a stockpile, before any turn advance or
      discard step. 1017 tests (963+54) / tsc / build green. Oscar
      review (lead, personally — engine correctness, same tier as
      Rummy/Phase10's own engine specs): approve, two nits, no
      blockers — both given an explicit disposition per the new
      "nothing gets left behind" rule (see DEVLOG Cycle 17b): one
      fixed (validator closure-mutation refactored to a direct return
      shape), one rejected with reasoning (an unreachable-by-design
      branch in an otherwise-correct, independently-tested exported
      helper).
- [x] Screens (spec 41): SkipBoCard.tsx/.css, SkipBoRoom.tsx,
      SkipBoTable.tsx/.css, SkipBoResults.tsx (+ SkipBoRulesOverlay.tsx,
      a reasonable sibling-pattern addition beyond the spec's file
      list). Established seat-tile grid + DealIntro conventions, NOT
      the design handoff's three-panel layout or borrowed Dominoes/MT
      shuffle. 1017 tests (unchanged) / tsc / build green. Oscar review
      (deepseek — no host-authoritative/privacy risk in this spec):
      genuinely adversarial, found 2 blocking + 2 major + 5 minor real
      issues (selection ring missing entirely for 2 of 3 selectable
      sources; ring rendered in the wrong color; Play/Discard not
      gated on whose turn it is; discard and the player's own draw-to-
      5 both silently missing their sound cues; DealIntro's flight cap
      silently truncating a 4-seat deal; dead status-line code; a dead
      prop and a wrongly-voided one; three comment/narrowing nits).
      Every item fixed per the new "nothing gets left behind" rule
      (see DEVLOG Cycle 18 for the full 9-item disposition list) before
      landing — nothing deferred, nothing silently dropped.
- [x] Wiring (spec 42): App.tsx, Landing.tsx, README.md, plus route.ts
      (a new routed-game segment, a necessary addition beyond the
      spec's literal file list). Mirrors Rummy's lobby/broadcast/
      `sendTo`/bot-per-seat wiring shape exactly, with two deliberate
      deviations: a fresh-game rematch (no score carryover, matching
      Battleship/Dominoes/Checkers/Chess's precedent, not Rummy's
      next-round model) and — the spec's own flagged hardest problem —
      per-ACTION bot pacing rather than per-turn, since Skip-Bo is the
      first game where one turn can chain many consecutive plays.
      1017 tests (unchanged) / tsc / build green. Oscar review (lead,
      personally — highest risk tier of the charter, host-authoritative
      state + private-hand delivery): approve, two nits, both accepted
      with no fix needed (an inherited, already-precedented lobby-view
      guard omission; a cosmetic bot-id counter gap with zero
      correctness impact) — recorded per the "nothing gets left behind"
      rule even though neither warranted a code change.

**Charter complete.** Skip-Bo is a real, playable 2-4 player game end
to end — engine, screens, and wiring all landed, following this
codebase's established card-game conventions throughout rather than
the design handoff's rejected three-panel layout and borrowed
Dominoes/Mexican-Train shuffle animation.

Design handoff (`Design Handoff/SKIPBO.md`) is authoritative for rules
and card art only — its layout and deal/shuffle animation are
explicitly rejected per user instruction, see CHARTER.md for the full
reasoning. Pre-approved at invocation ("adhere specifically to how
we're handling other card games... /autonomous-dev-loop like always").

## Charter: house-bot ID collision fix (2026-08-16) — done
- [x] Single slice (spec 39): fixed a real, pre-existing bug surfaced
      during the Rummy+Phase10 charter (see Cycle 15 below) —
      `addXHouseBot()` in 5 games (Rummy, Phase10, Wahoo, Mexican
      Train, Uno) derived a new bot's `playerId` from the current
      seats-array length (`bot-${seats.length}`), which could collide
      with an already-used id after a pre-start guest leave compacted
      the array (traced: add bot → `bot-1` → guest joins → add bot →
      `bot-3` → guest leaves, array compacts to length 3 → add bot
      again → regenerates `bot-3`, a duplicate `playerId` that would
      corrupt `seatOrder` and every per-player state map). Fixed
      identically across all 5 with a monotonic per-room counter ref
      (increment-then-use, reset alongside each game's existing
      `xBotSeatsRef.current.clear()` in `resetToEntry`) — never reuses
      a suffix within one room's lifetime regardless of array
      compaction. Confirmed Battleship/Dominoes/Checkers/Chess use an
      unrelated single-bot `'bot'` scheme with no bug, correctly left
      untouched. `src/App.tsx` only, 962 tests unchanged (screens/
      wiring convention, no dedicated test file) / tsc / build green,
      independently re-verified by the lead. Review: delegated to
      deepseek-as-Oscar (low risk — mechanical, no privacy/protocol
      surface) — approve, no blockers; genuinely adversarial, not a
      rubber stamp: it traced every `startXHost` call site (Landing
      picks, deep-link boot, legacy rematch) to prove no path could
      ever start a room with a stale counter, confirmed the id
      namespace can't collide with host/guest/other-game ids, and
      caught one harmless inaccuracy in the lead's own spec (a
      parenthetical claiming `startXHost()` also clears the seats/bot-
      seats pair — it doesn't; only `resetToEntry` does, which is
      where the diff actually put the resets).

## Charter: Rummy + Phase 10 N-player expansion (2026-08-16) — done
- [x] Rummy engine (spec 35): `playerIds` tuple → array, 2–4 seats
      (deck-math derived: 52-card deck, 10-card hands, 5 players leaves
      only 1 stock card — degenerate; 4 leaves 11, playable). New
      `seatOrder` field + `RUMMY_MIN/MAX_SEATS` exports, mirroring
      Uno's pattern. `finishRoundByGoingOut` collapsed from a 2-formula
      split into one uniform per-seat loop (provably identical at 2
      players — going-out player's empty hand makes deadwood 0
      automatically). Caught and fixed a real bug in the LEAD's OWN
      spec mid-cycle: the first-drafted match-win rule ("going-out
      player always wins outright") would have silently changed
      existing 2-player behavior in a real case (both cross target,
      opponent scores strictly higher — old code gave the win to the
      higher scorer); corrected to preserve exact 2-player parity
      (strictly-highest-scorer wins, going-out player only wins a tie),
      generalized properly to N candidates. 958 tests (953+5) / tsc /
      build green. Oscar review: approve, no blockers — independently
      re-verified the match-win logic against all 2-player branches and
      spot-checked test arithmetic against the actual rank/meld value
      tables rather than trusting the implementer's report.
- [x] Rummy screens + wiring (spec 36, combined — screen prop changes
      would have broken App.tsx's existing 2-player caller if landed
      separately, so unlike Uno's charter these couldn't be split).
      RummyRoom → N-seat lobby (Uno pattern). RummyTable opponent area
      → wrapping tile grid, content-height-driven, showing every real
      meld card (not a hidden count) — the trickiest part, a full
      layoff generalization (`crossLayoffGroups`/`selfExtensionCards`/
      `crossLayoffCaption`) replacing the old 2-boolean 2-player logic:
      self-extensions merge silently, cross-layoffs render on the
      LAYER's own section (opponent tile or "your melds") captioned
      "on your group"/"on {name}'s group", multiple layoff records from
      the same layer onto the same meld combined into one cluster.
      RummyResults → N-player standings loop. App.tsx wiring fully
      rewritten to Uno's lobby/`sendTo`/bot-per-seat model, replacing
      the old single-guest-or-single-bot direct-connect flow. 958 tests
      (unchanged, screens/wiring don't get dedicated test files here)
      / tsc / build green. Oscar review: approve, no blockers (the
      lead independently verified the layoff generalization by reading
      the code directly; Oscar's adversarial pass focused on the
      wiring's private-hand delivery, lobby gating, and rematch/seat-
      order preservation). Live-verified: full 4-player match, N-seat
      lobby cap enforcement, real melds rendering in content-driven
      tiles, layoff-eligible highlighting, host-side rule enforcement
      correctly rejecting an illegal lay-off attempt (no meld of my own
      down yet) — zero console errors throughout.
- [x] Phase 10 engine (spec 37): same generalization as Rummy's spec
      35, mirrored technique-for-technique (seatOrder field, dealRound/
      createGame loop generalization, START_NEXT_ROUND rotation via
      createTurnState+advanceTurn). 2–6 seats (108-card deck
      comfortably supports 6; matches real Phase 10's own official cap
      independently). `finishRoundByGoingOut`'s scoring loop generalizes
      cleanly (Phase 10 has no meld-contribution complexity like Rummy
      — going-out player always +0, every other player += their OWN
      hand penalty). Match-win/phase-advancement/tiebreak logic was
      ALREADY N-player-safe and needed zero changes — confirmed
      unchanged via a byte-level function-body diff, not just
      "untouched in spirit." One correct comment-only fix (Skip-card
      behavior description at 3+ players). 962 tests (958+4) / tsc /
      build green. Review: delegated to deepseek-as-Oscar (lower risk,
      proven mirror pattern) — approve, no blockers, genuinely
      rigorous (re-derived rotation arithmetic independently, byte-
      diffed the unchanged match-win logic with a script rather than
      trusting the claim, verified test arithmetic against real deck/
      scoring values).
- [x] Phase 10 screens + wiring (spec 38, combined for the same reason
      as Rummy's spec 36 — Phase 10 already has working 2-player
      wiring, so screen prop changes had to land with App.tsx in the
      same commit to keep tsc green). Direct mirror of spec 36's
      pattern: Phase10Room → N-seat lobby, Phase10Table opponent area
      → wrapping content-height tile grid, hits generalization
      (`selfExtensionCards`/`crossHitGroups`/`crossHitCaption`) as the
      `layoffs`-equivalent — self-hits merge silently, cross-hits
      render on the hitter's own section grouped by
      `(hitter, targetPlayerId, targetGroupIndex)`, captioned "on your
      group"/"on {name}'s group". App.tsx rewritten to the lobby/
      `sendTo`/bot-per-seat model. Two genuinely new pieces with no
      Rummy precedent: (1) the Phase Ladder generalized from a single
      opponent marker to an `opponents[]` array — a shared ring drawn
      once per phase step plus one dot per opponent sitting there,
      wrapping instead of blobbing when several share a step; (2)
      Phase10Results' winner-pinned-first-then-ascending sort
      preserved verbatim (NOT collapsed into Rummy's plain descending
      sort — Phase 10 is lower-wins and the match winner isn't always
      the lowest scorer). Implementer hit the 25-tool-iteration cap
      three times on this spec (once mid-exploration, once mid-edit,
      plus one `ECONNRESET` transient disconnect recovered with a
      retry) — each resumed with a precise, narrow continuation prompt.
      It also self-caught and correctly did NOT fix a real pre-existing
      bug: house-bot IDs are index-derived (`bot-${seats.length}`) and
      can collide after a pre-start guest leave compresses the seats
      array — confirmed identical in Rummy/Wahoo/Mexican Train/Uno, so
      out of scope here; flagged for a dedicated cross-game follow-up
      rather than a Phase10-only patch. 962 tests (unchanged) / tsc /
      build green, independently re-verified by the lead directly, not
      just trusted from the implementer's report. Oscar review (lead,
      personally — same risk tier as Rummy's wiring pass): approve, no
      blockers; independently traced `phase10Broadcast` for hand-
      privacy leaks (none — per-seat `sendTo`, host's own view from a
      local snapshot, bots skipped), confirmed the bot-ID collision is
      real and reproducible but genuinely pre-existing/shared. Live-
      verified: 6-seat lobby cap and lobby copy, full 6-bot deal intro,
      opponent tile grid (5 tiles in a clean wrapping 4+1 layout, per-
      seat colors/hidden fans), turn-highlight fill on the active
      bot's tile, and the N-wide Phase Ladder with all 6 seats sharing
      phase 1 rendering as a legible, non-overlapping row of dots — zero
      console errors throughout.

This closes every item in the charter's definition of done. Charter
complete: both Rummy (2–4 seats) and Phase 10 (2–6 seats) now support
N-player matches end to end, mirroring the same patterns established
for Uno.

Pre-approved by the user at charter creation ("go ahead... just use the
same basic patterns... get this going while I'm gone"); ran via
/autonomous-dev-loop, deepseek implementing (Haiku fallback never
needed — deepseek recovered from every cap-hit and the one transient
disconnect), deepseek or the lead reviewing per risk level.

## Charter: Uno seat-tile table redesign (2026-08-16) — done
- [x] Single slice (spec 34i): `UNO_MAX_SEATS` 10→6, opponent rail
      redesigned from a vertical row list to a wrapping 3-column seat-
      tile grid, per two Claude-Design mockups the user reviewed and
      gave specific feedback on. All three explicitly-locked
      requirements verified preserved: the card-back hand-fan visual
      (`.uno-opp-stack`, shrunk to fit but still a real fanned pile,
      confirmed legible in live screenshots), the always-visible-but-
      quiet call button (`UnoCallButton`/`unoCallDisabled` untouched),
      and the centered deck+discard band (untouched by this diff).
      3 test assertions fixed for the new 6-seat ceiling (verified by
      hand: 108-card deck, 6×7=42 dealt + 1 starter = 65 stock
      remainder). 953 tests unchanged / tsc / build green throughout.
      Oscar review: approve, no blockers — one initial suspicion (could
      the flex-wrap tile grid ever produce 4-per-row instead of 3 at a
      wide viewport) investigated and disproven via live DOM
      measurement, not just CSS-spec reasoning. Live-verified visually
      at both extremes: full 6-player match (clean 3+2 grid, no
      scrolling) and 2-player match (single tile stays compact, doesn't
      stretch/look sparse). First of a planned Uno→Rummy→Phase10 rollout
      of this shared visual direction — Rummy/Phase10 explicitly wait on
      this one working out in the user's own judgment, not started here.

## Charter: Uno (2026-08-15) — done
- [x] M1 — Uno module (spec 34): 108-card deck, N-player (2-10) state/rules/
      bot, 68 tests. Oscar review: approve, no blockers (two nits, neither
      requiring action). 899 tests total / tsc / build green.
- [x] M1 cleanup (spec 34a) — both Oscar nits closed anyway (user: "I don't
      like leaving anything behind"): documented the stale turn/
      hasDrawnThisTurn fields, added a 50-trial × 300-action property test
      (every seat a bot, real deals, 2-10 players) proving stockCount/
      conservation/handCounts/wire-safety invariants generatively — zero
      rejections, zero violations across ~15,000 actions. 900 tests total.
- [x] M2 — Uno-call race mechanism (spec 34b): single-window invariant
      (`unoWindow: {playerId}|null`, not a record — enforced by the type
      itself), opens on every turn-ending branch at exactly 1 card for the
      ACTING player, destroyed by CALL_UNO (self or catch, not turn-gated)
      or the next player's first action. 25 new tests incl. the critical
      open→null→reopen sequence and sequential double-call rejection.
      Oscar review: approve, no blockers, one nit (dead-but-harmless
      code, left as-is deliberately). 925 tests total.
- [x] M3 — House rules structure (spec 34c): generic `UNO_HOUSE_RULE_DEFS`
      array + `resolveHouseRules()` overlay-defaults pattern, one real
      rule ("draw until you can play") confined entirely to DRAW_CARD's
      handler. 14 new tests. Oscar review: approve, no findings (traced
      the loop-termination proof, the rule-OFF regression equivalence,
      and houseRules survival across START_NEXT_ROUND/CALL_UNO/go-out
      directly against the code). 939 tests total.
- [ ] M4 — Screens + multi-seat wiring (split into 34d/34e/34f, matching
      this project's established screens-then-wiring pattern)
  - [x] 34d — UnoCardFace/UnoCardBack components. Mirrored Phase10Card's
        exact click/disabled mechanics and the wild-gradient technique
        verbatim. Caught and fixed one real deviation myself before
        landing: the implementer substituted Phase10's palette for the
        four solid face colors instead of Uno's actual locked brand
        colors (`#e11d2e/#eab308/#16a34a/#2f6fed` from the design
        prototype's `UNO_COLORS` constant) — corrected, wild gradient
        left untouched. tsc/build clean.
  - [x] 34e — UnoTable screen: N-player opponent seat rail, deck/discard,
        wild color picker, fanned hand, uncolored Uno-call button (self
        immediate / catch staggered 1s via `useCatchStagger`, re-keyed
        correctly on window→different-window). Oscar review: approve, no
        blockers, one forward-looking note on sound-branch coupling. 944
        tests / tsc / build green.
  - [x] 34f — UnoRoom/Results/RulesOverlay: house-rules toggle list
        (generic `UNO_HOUSE_RULE_DEFS.map()`, card+pill, no precedent
        existed so designed from scratch) and bot-reflex difficulty
        picker (Room.tsx pill convention), 10-slot seat list, results
        sorted descending (higher-score-wins, unlike MT's ascending
        pips). 944 tests / tsc / build green, verified directly.
  - [x] 34g — App.tsx/route/landing/README wiring: full PeerJS host/
        guest lifecycle mirroring Mexican Train (variable 2-10 seats,
        per-guest private-hand sendTo), plus the novel bot Uno-call
        reflex system (generation-counter timer invalidation, verified
        airtight by direct trace of every unoSessionRef mutation site).
        Oscar review: approve with caveats — one real-but-benign edge
        case (disconnect-while-vulnerable then replaced-with-bot could
        leave a stale reflex-scheduling gap), fixed immediately (one-
        line `unoWindowKeyRef` reset in `unoReplaceWithBot`). 947 tests
        / tsc / build green. Live-verified: 6-player match (host + 5
        bots, well past the old 4-player cap), skip/draw2/multi-draw
        all fired correctly, zero console errors.
- **Uno charter definition of done: reached.** All four milestones
  (module, call mechanism, house rules, screens+wiring) shipped and
  independently verified. Nothing has been committed or pushed this
  entire charter, per the standing no-auto-commit rule — commit/push
  authorization requested via REQUESTS.md + chat.

## Next up (after Uno)
- Lift the 2-player cap on Rummy/Phase 10/Dominoes seating using the
  Wahoo/Mexican Train multi-seat pattern (Mexican Train and Farkle
  already got this treatment — specs 25/25b — Rummy/Phase10/Dominoes
  are the remaining 2-player-only card/board games).

## Done (prior charter: Checkers + Mexican Train, Chess, various fixes)
- Chess (specs 27/27b/28/29/30) — full rules via chess.js, 3 bot tiers,
  slide animation. Mexican Train lifted to 2-8 (specs 25/25b), pacing +
  open-signals polish (spec 26). Landing shelf compaction (spec 24).
  Farkle final-round fix, Dominoes snake-overflow fix, dice roll-signal
  fix, lobby rework, rebrand — various un-spec'd interactive-session fixes
  landed and pushed directly (see git log / docs/DEVLOG.md for detail;
  not all interactive-session work got a spec file).

## Done (prior charter: Wahoo)
- [wahoo] specs 18/18b–18e — generated board (proven symmetry), full
  rules incl. user's center/triple-six corrections, multi-guest lobby
  wiring + spectator block, contested-target fix. 664 tests, module
  CLEAN + wiring approve, live 4-seat verification.

## Done (prior charter: Dominoes)
- [dominoes] specs 17/17a–17h — module (standardized All Fives scoring,
  common draw rule), snake layout with flush corners, screens with
  domino-back deal intro, App wiring. 597 tests, two approve reviews,
  live-verified vs bot through round transition. ~$0.85 implementer cost.

## Done (prior charter: containers prep)
- [containers] spec 16 — Zone/deck helpers generic over id-bearing
  items, Card default, zero call-site churn. 534 tests. Review CLEAN.

## Done (prior charter: Battleship variants)
- [variants] specs 15/15a/15b/15c — standard / make-it-take-it /
  free-for-all, host-picked in the room, validator-enforced, bot loop
  free-mode cadence with starvation fix. 523 tests. Streak + free
  live-verified (chain status, turnless racing, full FFA match to 5–0).
  Review: approve, no blockers.

## Done (prior charter: Battleship)
- [cycle 1] M1 — game module (state/rules/bot + 25 tests incl. snapshot
  no-leak). Two implementer test-harness bugs lead-diagnosed, fixed via
  spec 13a. Review (sonnet, adversarial, live-repro rule): CLEAN on leaks;
  8-test oscar.test.ts kept in suite; one informational finding
  (playerId membership is the wiring layer's guard) carried into spec 14b.
- [cycle 1] M2 — screens (spec 14a: Room/Table/Results/RulesOverlay + CSS,
  ship-hit/miss/sunk sound registry) + App/Landing wiring (spec 14b: BS-
  prefix, bot loop, guest snapshot broadcast, onAction peer guard).
- [cycle 1] M3 — full host-vs-bot match live-verified in the browser
  (placement manual + randomize, rotate, hunt/target bot, sunk reveals,
  pills, 5–4 win, results, rematch reset; zero console errors). UI/wiring
  review (sonnet): approve, no blockers; 320px nit measured and accepted.
  docs/battleship.md + README updated. 514 tests / tsc / build green.

## Cut / deferred
- Grid engine — still no; index math lives in the game module.
- Real hit/miss/sunk audio — placeholders shipped; list delivered to user.
- Two-browser guest session live test — snapshot-level tests + review
  stand in (established repo practice); the wire path is byte-identical
  to Rummy's.

## Done (prior charters)
- Engine-core promotion (2026-08-09) — committed 41fa325/12e3d22, pushed.
- Connect 4 (2026-08-08); Card engine + Rummy + Phase 10 (08-05..07).

## Charter: Checkers + Mexican Train (2026-08-10) — in progress
- [x] M1 checkers module — spec 20, 35 tests (731 total), Oscar CLEAN.
- [x] M2 checkers screens + wiring — specs 21/21b, live 3-game match vs bot,
      Oscar visual review (ring fix applied). 732 tests.
- [x] M3 mexican train module — spec 22, 39 tests (771 total), prototype
      deadlock/deal bugs fixed by design. Oscar review in flight.
- [x] M4 mexican train screens + wiring — specs 23/23b + HostHandle.sendTo,
      live 3-round soak, Oscar code APPROVE + visual review (track-height
      and star fixes applied). 772 tests.
- [x] M5 landing count label — folded into 21b ("11 games").
