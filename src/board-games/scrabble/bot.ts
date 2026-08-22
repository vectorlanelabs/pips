import type { BotStrategy } from '../../engine/bot.ts'
import type { ScrabbleAction, ScrabblePrivateState, ScrabblePublicState } from './state.ts'
import type { ScrabbleDictionary } from './dictionary.ts'

interface FoundWord {
  word: string
  positions: Array<{ row: number; col: number }>
}

interface Candidate {
  action: Exclude<ScrabbleAction, { type: 'CHALLENGE' }>
  score: number
}

export function createScrabbleBotStrategy(
  dictionary: ScrabbleDictionary,
): BotStrategy<ScrabblePublicState, ScrabblePrivateState, ScrabbleAction> {
  return (publicState, privateState, playerId) => {
    // 1. Challenge check first
    if (publicState.lastPlacement !== null &&
        publicState.lastPlacement.challengeable &&
        publicState.lastPlacement.by !== playerId) {
      // Check if any word is invalid
      const hasInvalid = publicState.lastPlacement.words.some((w) => !dictionary.isWord(w.word))
      if (hasInvalid) {
        return { type: 'CHALLENGE' }
      }
    }

    // 2. Generate legal placements
    const candidates: Candidate[] = []
    const rack = privateState.rack.cards

    if (publicState.board.every((row) => row.every((cell) => cell === null))) {
      // Empty board: must place through center (7,7)
      const placements = generateMovesForAnchor(
        7, 7,
        rack,
        publicState.board,
        dictionary,
      )
      for (const placement of placements) {
        const score = calculatePlacementScore(placement)
        candidates.push({ action: { type: 'PLACE_WORD', tiles: placement }, score })
      }
    } else {
      // Find all anchor squares (empty cells adjacent to occupied cells)
      const anchors: Array<{ row: number; col: number }> = []
      for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
          if (publicState.board[r][c] === null) {
            const isAdjacent = (
              (r > 0 && publicState.board[r - 1][c] !== null) ||
              (r < 14 && publicState.board[r + 1][c] !== null) ||
              (c > 0 && publicState.board[r][c - 1] !== null) ||
              (c < 14 && publicState.board[r][c + 1] !== null)
            )
            if (isAdjacent) {
              anchors.push({ row: r, col: c })
            }
          }
        }
      }

      for (const anchor of anchors) {
        const placements = generateMovesForAnchor(
          anchor.row, anchor.col,
          rack,
          publicState.board,
          dictionary,
        )
        for (const placement of placements) {
          const score = calculatePlacementScore(placement)
          candidates.push({ action: { type: 'PLACE_WORD', tiles: placement }, score })
        }
      }
    }

    if (candidates.length > 0) {
      // Sort by score descending, pick from top few
      candidates.sort((a, b) => b.score - a.score)
      const topScore = candidates[0].score
      const topCandidates = candidates.filter((c) => c.score >= topScore * 0.95) // Within 5% of top
      const picked = topCandidates[Math.floor(Math.random() * topCandidates.length)]
      return picked.action
    }

    // 3. No placement: exchange or pass
    if (publicState.bagCount > 0 && rack.length > 0) {
      const exchangeCount = Math.min(3, Math.max(1, Math.floor(Math.random() * 4)), rack.length)
      const toExchange = []
      for (let i = 0; i < exchangeCount && i < rack.length; i++) {
        toExchange.push(rack[Math.floor(Math.random() * rack.length)].id)
      }
      return { type: 'EXCHANGE_TILES', tileIds: toExchange }
    }

    return { type: 'PASS' }
  }
}

interface PlacedTile {
  tileId: string
  row: number
  col: number
  letter: string
}

// Generate all valid moves for a given anchor square
function generateMovesForAnchor(
  row: number,
  col: number,
  rack: Array<{ id: string; letter: string; points: number }>,
  board: (import('./state.ts').BoardCell | null)[][],
  dictionary: ScrabbleDictionary,
): PlacedTile[][] {
  const moves: PlacedTile[][] = []

  // Try horizontal placements through this anchor
  const hMoves = generateMovesInDirection(row, col, rack, board, dictionary, true)
  moves.push(...hMoves)

  // Try vertical placements through this anchor
  const vMoves = generateMovesInDirection(row, col, rack, board, dictionary, false)
  moves.push(...vMoves)

  return moves
}

function generateMovesInDirection(
  row: number,
  col: number,
  rack: Array<{ id: string; letter: string; points: number }>,
  board: (import('./state.ts').BoardCell | null)[][],
  dictionary: ScrabbleDictionary,
  isHorizontal: boolean,
): PlacedTile[][] {
  const results: PlacedTile[][] = []

  // For each rack tile, try placing it at this anchor and extending the word
  for (let rackIdx = 0; rackIdx < rack.length; rackIdx++) {
    const tile = rack[rackIdx]

    // Try different word positions that include this tile at this anchor
    const maxLen = isHorizontal ? 15 - col : 15 - row
    for (let wordPos = 0; wordPos < maxLen; wordPos++) {
      // This word position means the tile goes wordPos cells before the anchor
      const startPos = (isHorizontal ? col : row) - wordPos
      if (startPos < 0 || startPos + 7 > (isHorizontal ? 15 : 15)) continue

      // Try to build a word of length 2-7 starting at startPos, with this tile at anchor
      for (let len = 2; len <= 7; len++) {
        if (startPos + len > (isHorizontal ? 15 : 15)) break

        // Check if this placement is valid
        const placement: PlacedTile[] = []
        const used = new Set<number>([rackIdx])

        // Place the main tile at anchor
        placement.push({
          tileId: tile.id,
          row,
          col,
          letter: tile.letter === '' ? 'A' : tile.letter, // Bot uses 'A' for blanks (simplification)
        })

        // Try to fill the word with other rack tiles
        let isValid = true
        for (let offset = 0; offset < len; offset++) {
          if (offset === wordPos) continue // Already placed
          const pos = isHorizontal ? startPos + offset : (offset === 0 ? row : row + offset)
          const posCol = isHorizontal ? startPos + offset : col

          const existingCell = isHorizontal
            ? board[row][startPos + offset]
            : board[row + offset][col]

          if (existingCell) {
            placement.push({
              tileId: `existing-${pos}-${posCol}`,
              row: isHorizontal ? row : row + offset,
              col: isHorizontal ? startPos + offset : col,
              letter: existingCell.letter,
            })
          } else {
            // Need a rack tile
            let found = false
            for (let i = 0; i < rack.length; i++) {
              if (i !== rackIdx && !used.has(i)) {
                const candidate = rack[i]
                used.add(i)
                placement.push({
                  tileId: candidate.id,
                  row: isHorizontal ? row : row + offset,
                  col: isHorizontal ? startPos + offset : col,
                  letter: candidate.letter === '' ? 'A' : candidate.letter,
                })
                found = true
                break
              }
            }
            if (!found) {
              isValid = false
              break
            }
          }
        }

        if (isValid && placement.length >= 2) {
          // Check if this placement forms valid words
          const newTiles = placement.filter((p) => !p.tileId.startsWith('existing-'))
          if (newTiles.length > 0) {
            // Extract and validate all words formed
            const words = extractPlacedWords(board, placement)
            let allValid = true
            for (const w of words) {
              if (!dictionary.isWord(w.word)) {
                allValid = false
                break
              }
            }
            if (allValid && words.length > 0) {
              results.push(newTiles)
            }
          }
        }
      }
    }
  }

  return results
}

function extractPlacedWords(
  board: (import('./state.ts').BoardCell | null)[][],
  placement: PlacedTile[],
): FoundWord[] {
  // Simplified word extraction for bot move generation
  const words: FoundWord[] = []
  const rows = placement.map((p) => p.row)
  const cols = placement.map((p) => p.col)
  const minRow = Math.min(...rows)
  const maxRow = Math.max(...rows)
  const minCol = Math.min(...cols)
  const maxCol = Math.max(...cols)

  const isHorizontal = minRow === maxRow

  if (isHorizontal) {
    let startCol = minCol
    let endCol = maxCol
    while (startCol > 0 && board[minRow][startCol - 1] !== null) startCol--
    while (endCol < 14 && board[minRow][endCol + 1] !== null) endCol++

    let word = ''
    const positions: Array<{ row: number; col: number }> = []
    for (let c = startCol; c <= endCol; c++) {
      const placed = placement.find((p) => p.row === minRow && p.col === c)
      if (placed) {
        word += placed.letter
        positions.push({ row: minRow, col: c })
      } else if (board[minRow][c]) {
        word += board[minRow][c]!.letter
        positions.push({ row: minRow, col: c })
      }
    }
    if (word.length >= 2) {
      words.push({ word, positions })
    }
  } else {
    let startRow = minRow
    let endRow = maxRow
    while (startRow > 0 && board[startRow - 1][minCol] !== null) startRow--
    while (endRow < 14 && board[endRow + 1][minCol] !== null) endRow++

    let word = ''
    const positions: Array<{ row: number; col: number }> = []
    for (let r = startRow; r <= endRow; r++) {
      const placed = placement.find((p) => p.row === r && p.col === minCol)
      if (placed) {
        word += placed.letter
        positions.push({ row: r, col: minCol })
      } else if (board[r][minCol]) {
        word += board[r][minCol]!.letter
        positions.push({ row: r, col: minCol })
      }
    }
    if (word.length >= 2) {
      words.push({ word, positions })
    }
  }

  return words
}

function calculatePlacementScore(
  placement: PlacedTile[],
): number {
  // Simplified scoring for bot move selection (just raw points, not full multiplier calc)
  let score = 0
  for (const tile of placement) {
    if (!tile.tileId.startsWith('existing-')) {
      const points = getLetterPoints(tile.letter)
      score += points
    }
  }
  return score
}

function getLetterPoints(letter: string): number {
  const points: Record<string, number> = {
    A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
    K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
    U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
  }
  return points[letter] ?? 0
}
