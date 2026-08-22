export type PremiumKind = 'none' | 'DL' | 'TL' | 'DW' | 'TW'

// Standard 15x15 Scrabble board premium square layout (symmetric under 90-degree rotation).
// The center square (7,7) counts as a double-word square and is where the first word must cover.
// Encoded as a static lookup table (row-major, 15x15).
const PREMIUM_BOARD: PremiumKind[][] = [
  ['TW', 'none', 'none', 'DL', 'none', 'none', 'none', 'TW', 'none', 'none', 'none', 'DL', 'none', 'none', 'TW'],
  ['none', 'DW', 'none', 'none', 'none', 'TL', 'none', 'none', 'none', 'TL', 'none', 'none', 'none', 'DW', 'none'],
  ['none', 'none', 'DW', 'none', 'none', 'none', 'DL', 'none', 'DL', 'none', 'none', 'none', 'DW', 'none', 'none'],
  ['DL', 'none', 'none', 'DW', 'none', 'none', 'none', 'DL', 'none', 'none', 'none', 'DW', 'none', 'none', 'DL'],
  ['none', 'none', 'none', 'none', 'DW', 'none', 'none', 'none', 'none', 'none', 'DW', 'none', 'none', 'none', 'none'],
  ['none', 'TL', 'none', 'none', 'none', 'TL', 'none', 'none', 'none', 'TL', 'none', 'none', 'none', 'TL', 'none'],
  ['none', 'none', 'DL', 'none', 'none', 'none', 'DL', 'none', 'DL', 'none', 'none', 'none', 'DL', 'none', 'none'],
  ['TW', 'none', 'none', 'DL', 'none', 'none', 'none', 'none', 'none', 'none', 'none', 'DL', 'none', 'none', 'TW'],
  ['none', 'none', 'DL', 'none', 'none', 'none', 'DL', 'none', 'DL', 'none', 'none', 'none', 'DL', 'none', 'none'],
  ['none', 'TL', 'none', 'none', 'none', 'TL', 'none', 'none', 'none', 'TL', 'none', 'none', 'none', 'TL', 'none'],
  ['none', 'none', 'none', 'none', 'DW', 'none', 'none', 'none', 'none', 'none', 'DW', 'none', 'none', 'none', 'none'],
  ['DL', 'none', 'none', 'DW', 'none', 'none', 'none', 'DL', 'none', 'none', 'none', 'DW', 'none', 'none', 'DL'],
  ['none', 'none', 'DW', 'none', 'none', 'none', 'DL', 'none', 'DL', 'none', 'none', 'none', 'DW', 'none', 'none'],
  ['none', 'DW', 'none', 'none', 'none', 'TL', 'none', 'none', 'none', 'TL', 'none', 'none', 'none', 'DW', 'none'],
  ['TW', 'none', 'none', 'DL', 'none', 'none', 'none', 'TW', 'none', 'none', 'none', 'DL', 'none', 'none', 'TW'],
]

export function premiumAt(row: number, col: number): PremiumKind {
  if (row < 0 || row >= 15 || col < 0 || col >= 15) return 'none'
  const premium = PREMIUM_BOARD[row]?.[col]
  return premium ?? 'none'
}
