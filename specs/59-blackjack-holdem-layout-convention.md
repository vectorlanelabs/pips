# Spec 59 — Blackjack & Hold'em: adopt the Rummy table-layout convention

Both `BlackjackTable.tsx` and `HoldemTable.tsx` were built with a flat
wrapping seat-tile grid (mirroring Blackjack's own screens spec, which
itself never checked Rummy) instead of this codebase's actual
established convention. Per CLAUDE.md's "new games must pattern-match
existing games" rule, **`RummyTable.tsx` + `RummyTable.css` is the
authoritative reference** — read both in full before writing anything.
This spec corrects both tables to match it structurally, fixes
Blackjack's card-overlap bug (a direct consequence of the wrong
structure), and makes each local player's chip stack properly
prominent.

## The reference pattern (Rummy), exactly

Three vertical tiers inside `.rummy-table-card`, in this order:
1. **`.rummy-opp-rail`** (top) — a wrapping grid of small tiles, one per
   OTHER seat. Each tile: seat-color dot + name + turn tag, small
   content (Rummy: a hidden-hand fan + count; a game with visible
   per-seat state shows THAT instead), sized `size='meld'` (38×54px)
   for any card shown in a tile — never `size='hand'` (74×104px),
   which is reserved for the local player's own hand and is exactly
   why Blackjack's tiles currently overlap (5+ cards at 74px wide
   packed into a ~200px tile).
2. **`.rummy-centre`** (middle) — the SHARED play area everyone is
   looking at: a bordered band (`border-top`/`border-bottom: 3px solid
   var(--grey-fill)`) containing whatever state belongs to the table
   itself, not any one seat.
3. **`.rummy-your-side`** (bottom) — the local player's own area: any
   of their own face-up state, then a clearly-labeled hand/action
   section using the full `size='hand'` cards and the real action
   buttons.

Read `src/screens/RummyTable.css` fully for the exact spacing/sizing
values (gap clamps, border widths, the `--rummy-opp-gap` custom
property, tile `max-width` capping) — reuse the same values, don't
invent new ones. Each game in this codebase has its OWN dedicated CSS
file with game-prefixed class names (`.rummy-*`, and now `.blackjack-*`
/ `.holdem-*`) even though the shapes are structurally identical — this
is the established convention (see Phase10Table.css, SkipBoTable.css
for two more parallel, independently-authored examples of the exact
same tier structure), not a shortcut to skip.

## Files you own
- `src/screens/BlackjackTable.tsx` (rewrite the render, keep all
  existing state/derived-value/handler logic — this is a structural/
  visual pass, not a rules change)
- `src/screens/BlackjackTable.css` (new file)
- `src/screens/HoldemTable.tsx` (same: rewrite render only)
- `src/screens/HoldemTable.css` (new file)

Do not touch any engine file, any other screen, or `App.tsx`. Do not
run `git`.

## Blackjack's three tiers

1. **Opponent rail (top)**: one tile per OTHER seat (not the local
   player). Each shows: seat color + name, turn tag, chip stack
   (prominent — see "Chip prominence" below), current bet if in the
   betting phase, folded/all-in/sitting-out equivalent badges (this
   game's actual state: `sittingOut`), and that seat's hand(s) using
   `size='meld'` cards, each hand's running total, and (once
   `roundResults` exists) the win/lose/push/blackjack badge already
   built — just re-sized into the tile format. A split hand shows two
   small card clusters side by side within the tile, same as today,
   just at meld size instead of hand size.
2. **Centre band (middle) = the dealer**: dealer label, dealer's cards
   (the hole card face-down/revealed exactly as today), dealer total
   once revealed. This is the one seat that isn't a player — it
   belongs in the shared centre band, not a seat tile.
3. **Your side (bottom)**: the LOCAL seat's own chip stack (prominent),
   its own hand(s) at full `size='hand'`, running total(s), result
   badge(s), and the existing action area (bet stepper / hit-stand-
   double-split, unchanged logic) below the hand — mirroring exactly
   where Rummy puts its action row below the hand fan.

## Hold'em's three tiers

1. **Opponent rail (top)**: one tile per OTHER seat. Seat color + name,
   turn tag, chip stack (prominent), current `betThisStreet`,
   folded/all-in/eliminated badges (unchanged logic), and that seat's
   2 hole cards at `size='meld'` — face-down `CardBack` (also render
   these at the smaller matching size — check `CardBackSize`, use
   `'fan'` for the tile-sized backs, not `'pile'`) unless a genuine
   showdown reveal populated `publicState.hands[seatId].cards`, in
   which case show the real cards at the same small size.
2. **Centre band (middle) = board + pot**: `HoldemBoard` (community
   cards) and the pot total — this is literally what the user asked
   for ("shared play area (dealer area) in the middle") and is exactly
   analogous to Rummy's stock+discard band.
3. **Your side (bottom)**: the LOCAL seat's own chip stack (prominent),
   its own 2 hole cards at full `size='hand'`, and the existing action
   area (fold/check/call + bet-or-raise slider, unchanged logic —
   including the additive-not-exclusive fix already landed) below them.

## Chip prominence (both games)

The user's second complaint: chip totals aren't prominent enough
anywhere, opponent or local. Fix:
- In opponent tiles: the chip count is the second line after the name
  (already roughly true) but bump it to a real weight/size — `font-
  weight: 700`, not the current thin body-text treatment; a small
  coin/chip glyph or just bold black-on-white numerals reads fine, no
  new icon needed.
- In the LOCAL player's own area (bottom tier): the chip stack needs
  its own visually distinct, larger treatment — not just another line
  of text in a card. Give it a small standalone "chip bank" element:
  bold, large (`font-size: 22-26px` range), with the existing chunky-
  border/box-shadow treatment this codebase uses for emphasis elements
  (4px `var(--ink)` border, small `box-shadow: 0 Npx 0 var(--ink)`,
  `var(--yellow)` or similar accent background) — look at how
  `BlackjackRoom.tsx`'s room-code display or `RummyRoom.tsx`'s
  code-copy button gets this exact chunky-emphasis treatment and reuse
  that visual language, don't invent a new one.

## Do NOT
- Change any game logic, state derivation, button-gating condition, or
  action handler — this spec is a render/CSS restructuring only. Every
  `can*`/`is*` boolean and every `on*` handler call stays exactly as-is.
- Touch the engine, `App.tsx`, or any other screen.
- Add a shared cross-game CSS file — each game keeps its own, matching
  convention.
- Add new dependencies.

## Verify before reporting
Run, in the working directory (`/Users/charlie/Desktop/Projects/pips`):
```
npx tsc -b --noEmit
npx vitest run
npm run build
```
Expected: tsc clean, full suite unchanged, build succeeds. Report all
three commands' real final output.

This is fundamentally a VISUAL fix — the lead will verify with actual
browser screenshots at a maxed seat count for each game (Blackjack
6-seat, Hold'em 8-seat) before accepting it, the same way the original
bug was discovered. Get the structure right per this spec, but do not
claim it looks correct without having actually rendered it — if you
have a way to preview the page yourself, use it; if not, say so plainly
in your report rather than asserting an unverified visual claim.

## Report format
- Files changed
- tsc / vitest / build real output
- Confirmation that no logic/handler/gating code changed, only render
  structure and CSS
- Anything the spec didn't cover or you were unsure about
