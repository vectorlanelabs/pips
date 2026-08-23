import type { BotStrategy } from '../../engine/bot.ts'
import type { ScrabbleAction, ScrabblePrivateState, ScrabblePublicState } from './state.ts'
import type { ScrabbleDictionary } from './dictionary.ts'
import type { BotDifficulty } from '../../types.ts'

interface Candidate {
  action: Exclude<ScrabbleAction, { type: 'CHALLENGE' }>
  score: number
}

interface PlacedTile {
  tileId: string
  row: number
  col: number
  letter: string
  isBlank?: boolean
}

interface RackTile {
  id: string
  letter: string
  points: number
}

export function createScrabbleBotStrategy(
  dictionary: ScrabbleDictionary,
  difficulty: BotDifficulty,
): BotStrategy<ScrabblePublicState, ScrabblePrivateState, ScrabbleAction> {
  return (publicState, privateState, playerId) => {
    // 1. Challenge check first
    if (publicState.lastPlacement !== null &&
        publicState.lastPlacement.challengeable &&
        publicState.lastPlacement.by !== playerId) {
      // Check if any word is invalid
      const hasInvalid = publicState.lastPlacement.words.some((w) => !dictionary.isWord(w.word))
      if (hasInvalid) {
        // Gate the challenge on difficulty-based probability
        const challengeProbability = difficulty === 'easy' ? 0.2 : difficulty === 'medium' ? 0.55 : 0.9
        if (Math.random() < challengeProbability) {
          return { type: 'CHALLENGE' }
        }
      }
    }

    // 2. Generate legal placements
    // Part A: Create memoization cache for rack permutations (fixed for this entire turn)
    const permutationCache = new Map<number, RackTile[][]>()
    const candidates: Candidate[] = []
    const rack = privateState.rack.cards
    const searchStartTime = performance.now()
    const SEARCH_TIME_BUDGET_MS = 300 // 300ms budget with finer-grained checking (budget at word-length loop)

    if (publicState.board.every((row) => row.every((cell) => cell === null))) {
      // Empty board: must place through center (7,7)
      const placements = generateMovesForAnchor(
        7, 7,
        rack,
        publicState.board,
        dictionary,
        permutationCache,
        searchStartTime,
        SEARCH_TIME_BUDGET_MS,
      )
      for (const placement of placements) {
        const score = calculatePlacementScore(placement)
        candidates.push({ action: { type: 'PLACE_WORD', tiles: placement }, score })
      }
    } else {
      // Find all anchor squares (empty cells adjacent to occupied cells)
      const anchorsWithSlots: Array<{ row: number; col: number; emptySlots: number }> = []
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
              // Count empty slots around this anchor (heuristic for search cost)
              let emptyCount = 0
              for (let i = Math.max(0, r - 7); i < Math.min(15, r + 8); i++) {
                for (let j = Math.max(0, c - 7); j < Math.min(15, c + 8); j++) {
                  if (publicState.board[i][j] === null) emptyCount++
                }
              }
              anchorsWithSlots.push({ row: r, col: c, emptySlots: emptyCount })
            }
          }
        }
      }

      // Sort anchors by fewest empty slots first (cheaper searches are tried first)
      // This ensures early cutoff doesn't starve the search of good options
      anchorsWithSlots.sort((a, b) => a.emptySlots - b.emptySlots)

      // Part B: Apply time budget - stop searching anchors if we exceed budget
      for (const anchor of anchorsWithSlots) {
        // Check time budget at the top of each anchor (coarse-grained, not in inner loops)
        if (performance.now() - searchStartTime > SEARCH_TIME_BUDGET_MS) {
          break // Time budget exceeded, stop searching further anchors
        }

        const placements = generateMovesForAnchor(
          anchor.row, anchor.col,
          rack,
          publicState.board,
          dictionary,
          permutationCache,
          searchStartTime,
          SEARCH_TIME_BUDGET_MS,
        )
        for (const placement of placements) {
          const score = calculatePlacementScore(placement)
          candidates.push({ action: { type: 'PLACE_WORD', tiles: placement }, score })
        }
      }
    }

    if (candidates.length > 0) {
      if (difficulty === 'easy') {
        // Easy: pick uniformly at random from ALL valid candidates
        const picked = candidates[Math.floor(Math.random() * candidates.length)]
        return picked.action
      } else {
        // Medium/hard: keep existing top-5%-tie behavior unchanged
        candidates.sort((a, b) => b.score - a.score)
        const topScore = candidates[0].score
        const topCandidates = candidates.filter((c) => c.score >= topScore * 0.95) // Within 5% of top
        const picked = topCandidates[Math.floor(Math.random() * topCandidates.length)]
        return picked.action
      }
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

// Generate all valid moves for a given anchor square
function generateMovesForAnchor(
  row: number,
  col: number,
  rack: RackTile[],
  board: (import('./state.ts').BoardCell | null)[][],
  dictionary: ScrabbleDictionary,
  permutationCache: Map<number, RackTile[][]>,
  searchStartTime: number,
  budgetMs: number,
): PlacedTile[][] {
  const moves: PlacedTile[][] = []

  // Try horizontal placements through this anchor
  const hMoves = generateMovesInDirection(row, col, rack, board, dictionary, true, permutationCache, searchStartTime, budgetMs)
  moves.push(...hMoves)

  // Try vertical placements through this anchor
  const vMoves = generateMovesInDirection(row, col, rack, board, dictionary, false, permutationCache, searchStartTime, budgetMs)
  moves.push(...vMoves)

  return moves
}

/**
 * Generate valid word placements in a given direction from an anchor square.
 *
 * Uses permutation-based search: tries different permutations of rack tile subsets
 * to fill empty slots, validates blanks against dictionary, and checks cross-words.
 * Permutation bound is reasonable since rack size ≤ 7 (7! = 5040 max per anchor/dir).
 *
 * Time budget is checked at the top of each word-length iteration to prevent
 * a single anchor from exceeding the search budget.
 */
function generateMovesInDirection(
  anchorRow: number,
  anchorCol: number,
  rack: RackTile[],
  board: (import('./state.ts').BoardCell | null)[][],
  dictionary: ScrabbleDictionary,
  isHorizontal: boolean,
  permutationCache: Map<number, RackTile[][]>,
  searchStartTime: number,
  budgetMs: number,
): PlacedTile[][] {
  const results: PlacedTile[][] = []

  // For each possible word length and starting position
  const maxLen = isHorizontal ? 15 - anchorCol : 15 - anchorRow

  for (let wordLen = 2; wordLen <= 7 && wordLen <= maxLen; wordLen++) {
    // Check time budget at the top of each word-length iteration (finer granularity)
    if (performance.now() - searchStartTime > budgetMs) {
      break // Time budget exceeded, return what we've found so far
    }
    for (let startPos = Math.max(0, (isHorizontal ? anchorCol : anchorRow) - wordLen + 1);
         startPos <= (isHorizontal ? anchorCol : anchorRow) && startPos + wordLen <= 15;
         startPos++) {

      const anchorPosInWord = (isHorizontal ? anchorCol : anchorRow) - startPos

      // The window [startPos, startPos + wordLen) must be the FULL contiguous
      // run, not an arbitrary slice of it — if it abuts another occupied cell
      // just outside either edge, the real word once applied (extractWords in
      // rules.ts extends to the full run) would be longer than what's being
      // validated here, so this window must be skipped rather than checked.
      const beforePos = startPos - 1
      const afterPos = startPos + wordLen
      const beforeOccupied = isHorizontal
        ? beforePos >= 0 && board[anchorRow][beforePos] !== null
        : beforePos >= 0 && board[beforePos][anchorCol] !== null
      const afterOccupied = isHorizontal
        ? afterPos <= 14 && board[anchorRow][afterPos] !== null
        : afterPos <= 14 && board[afterPos][anchorCol] !== null
      if (beforeOccupied || afterOccupied) continue

      // Extract fixed board tiles and identify empty slots that need filling
      const wordSlots: Array<{ pos: number; letter: string | null; row: number; col: number }> = []
      for (let i = 0; i < wordLen; i++) {
        const row = isHorizontal ? anchorRow : startPos + i
        const col = isHorizontal ? startPos + i : anchorCol
        const cell = board[row][col]

        wordSlots.push({
          pos: i,
          letter: cell ? cell.letter : null,
          row,
          col,
        })
      }

      // Identify empty slots (need rack tiles)
      const emptySlots = wordSlots.filter((s) => s.letter === null)
      if (emptySlots.length === 0) continue // Already filled, can't place here

      // Verify anchor is in this word
      if (wordSlots[anchorPosInWord].letter !== null) {
        // Anchor is already filled (existing board tile), skip
        continue
      }

      // Try all permutations of rack subsets that fit the empty slots
      const validPlacements = generateValidPermutations(
        rack,
        emptySlots,
        wordSlots,
        board,
        dictionary,
        isHorizontal,
        permutationCache,
      )

      results.push(...validPlacements)
    }
  }

  return results
}

/**
 * Generate valid permutations of rack tiles to fill empty slots in a word.
 *
 * For each permutation that forms a valid main word, extract and validate
 * all cross-words. Only return placements where main word AND all cross-words
 * are valid dictionary words.
 *
 * Uses permutationCache to avoid recomputing the same rack permutations
 * multiple times within a single bot strategy call.
 */
function generateValidPermutations(
  rack: RackTile[],
  emptySlots: Array<{ pos: number; letter: string | null; row: number; col: number }>,
  wordSlots: Array<{ pos: number; letter: string | null; row: number; col: number }>,
  board: (import('./state.ts').BoardCell | null)[][],
  dictionary: ScrabbleDictionary,
  isHorizontal: boolean,
  permutationCache: Map<number, RackTile[][]>,
): PlacedTile[][] {
  const validPlacements: PlacedTile[][] = []

  // Generate permutations of rack subsets for empty slots
  // Part A: Use cached permutations if already computed for this neededCount value
  const neededCount = emptySlots.length
  let permutations = permutationCache.get(neededCount)
  if (!permutations) {
    permutations = generateRackPermutations(rack, neededCount)
    permutationCache.set(neededCount, permutations)
  }

  for (const permutation of permutations) {
    if (permutation.length < emptySlots.length) continue

    // Identify which slots have blanks (need multiple letter assignments)
    const blankSlots: Array<{ wordSlotIdx: number; emptyIdx: number }> = []
    for (let i = 0; i < wordSlots.length; i++) {
      const slot = wordSlots[i]
      if (slot.letter === null) {
        const emptyIdx = emptySlots.findIndex((s) => s.pos === i)
        const rackTile = permutation[emptyIdx]
        if (rackTile.letter === '') {
          blankSlots.push({ wordSlotIdx: i, emptyIdx })
        }
      }
    }

    // If there are blanks, try different letter combinations
    // Otherwise, just use the permutation as-is
    const letterCombinations = blankSlots.length > 0
      ? generateBlankLetterCombinations(blankSlots.length)
      : [[]]

    for (const letterCombo of letterCombinations) {
      // Build placement tiles and main word
      const placement: PlacedTile[] = []
      let mainWord = ''
      let blankIdx = 0

      for (let i = 0; i < wordSlots.length; i++) {
        const slot = wordSlots[i]
        if (slot.letter !== null) {
          // Use board tile
          placement.push({
            tileId: `board-${slot.row}-${slot.col}`,
            row: slot.row,
            col: slot.col,
            letter: slot.letter,
            isBlank: false,
          })
          mainWord += slot.letter
        } else {
          // Use rack tile from permutation
          const emptyIdx = emptySlots.findIndex((s) => s.pos === i)
          const rackTile = permutation[emptyIdx]

          if (rackTile.letter === '') {
            // Blank tile: use letter from combination
            const letter = letterCombo[blankIdx] || 'A'
            blankIdx++
            placement.push({
              tileId: rackTile.id,
              row: slot.row,
              col: slot.col,
              letter,
              isBlank: true,
            })
            mainWord += letter
          } else {
            placement.push({
              tileId: rackTile.id,
              row: slot.row,
              col: slot.col,
              letter: rackTile.letter,
              isBlank: false,
            })
            mainWord += rackTile.letter
          }
        }
      }

      // Validate main word
      if (!dictionary.isWord(mainWord)) {
        continue
      }

      // Extract and validate all cross-words
      const allWordsValid = validateCrossWords(
        board,
        placement,
        isHorizontal,
        dictionary,
      )

      if (allWordsValid) {
        // Only include newly placed tiles (not board tiles)
        const newTiles = placement.filter((p) => !p.tileId.startsWith('board-'))
        if (newTiles.length > 0) {
          validPlacements.push(newTiles)
        }
      }
    }
  }

  return validPlacements
}

/**
 * Validate that all cross-words formed by the placement are valid dictionary words.
 *
 * Mirrors the extractWords logic from rules.ts: for each newly placed tile,
 * check perpendicular direction for existing tiles and extract cross-words.
 */
function validateCrossWords(
  board: (import('./state.ts').BoardCell | null)[][],
  placement: PlacedTile[],
  mainIsHorizontal: boolean,
  dictionary: ScrabbleDictionary,
): boolean {
  // For each newly placed tile, check if it forms a cross-word
  for (const tile of placement.filter((t) => !t.tileId.startsWith('board-'))) {
    if (mainIsHorizontal) {
      // Main word is horizontal, so cross-words are vertical
      const hasVerticalNeighbor = (
        (tile.row > 0 && board[tile.row - 1][tile.col] !== null) ||
        (tile.row < 14 && board[tile.row + 1][tile.col] !== null)
      )

      if (hasVerticalNeighbor) {
        // Extract vertical word including this tile
        let startRow = tile.row
        let endRow = tile.row
        while (startRow > 0 && board[startRow - 1][tile.col] !== null) startRow--
        while (endRow < 14 && board[endRow + 1][tile.col] !== null) endRow++

        if (startRow < endRow) {
          let crossWord = ''
          for (let r = startRow; r <= endRow; r++) {
            if (r === tile.row) {
              crossWord += tile.letter
            } else {
              const cell = board[r][tile.col]
              if (cell) {
                crossWord += cell.letter
              }
            }
          }

          if (crossWord.length >= 2 && !dictionary.isWord(crossWord)) {
            return false
          }
        }
      }
    } else {
      // Main word is vertical, so cross-words are horizontal
      const hasHorizontalNeighbor = (
        (tile.col > 0 && board[tile.row][tile.col - 1] !== null) ||
        (tile.col < 14 && board[tile.row][tile.col + 1] !== null)
      )

      if (hasHorizontalNeighbor) {
        // Extract horizontal word including this tile
        let startCol = tile.col
        let endCol = tile.col
        while (startCol > 0 && board[tile.row][startCol - 1] !== null) startCol--
        while (endCol < 14 && board[tile.row][endCol + 1] !== null) endCol++

        if (startCol < endCol) {
          let crossWord = ''
          for (let c = startCol; c <= endCol; c++) {
            if (c === tile.col) {
              crossWord += tile.letter
            } else {
              const cell = board[tile.row][c]
              if (cell) {
                crossWord += cell.letter
              }
            }
          }

          if (crossWord.length >= 2 && !dictionary.isWord(crossWord)) {
            return false
          }
        }
      }
    }
  }

  return true
}

/**
 * Generate letter combinations for blank tiles.
 *
 * For blanks, we try different letter assignments. To keep work bounded,
 * we try the 10 most common Scrabble letters for each blank position.
 * This balances search coverage with reasonable computation time.
 */
function generateBlankLetterCombinations(numBlanks: number): string[][] {
  // Most common letters in English (by frequency)
  const commonLetters = ['E', 'A', 'R', 'I', 'O', 'T', 'N', 'S', 'H', 'L']

  if (numBlanks === 0) return [[]]
  if (numBlanks === 1) return commonLetters.map((l) => [l])

  // For multiple blanks, try combinations (cartesian product)
  // Limit to avoid explosion: cap at 10^numBlanks
  const maxCombos = Math.min(1000, Math.pow(commonLetters.length, numBlanks))

  const result: string[][] = []
  let count = 0

  function generate(depth: number, current: string[]) {
    if (count >= maxCombos) return
    if (depth === numBlanks) {
      result.push([...current])
      count++
      return
    }

    for (const letter of commonLetters) {
      if (count >= maxCombos) return
      current.push(letter)
      generate(depth + 1, current)
      current.pop()
    }
  }

  generate(0, [])
  return result
}

/**
 * Generate permutations of rack tile subsets of a given size.
 *
 * For a rack of size N and needing K tiles, generates all N choose K
 * combinations, then all permutations of each combination.
 * Bounded by max subset size (matched to word length cap of 7).
 */
function generateRackPermutations(rack: RackTile[], neededCount: number): RackTile[][] {
  if (neededCount <= 0) return [[]]
  if (neededCount > rack.length) return []

  const permutations: RackTile[][] = []

  // Generate all combinations of neededCount items from rack
  const combinations = generateCombinations(rack, neededCount)

  // For each combination, generate all permutations
  for (const combination of combinations) {
    const perms = generatePermutations(combination)
    permutations.push(...perms)
  }

  return permutations
}

/**
 * Generate all combinations of k items from array.
 */
function generateCombinations<T>(array: T[], k: number): T[][] {
  if (k === 1) return array.map((item) => [item])
  if (k === array.length) return [array]

  const result: T[][] = []
  for (let i = 0; i <= array.length - k; i++) {
    const head = array[i]
    const tail = array.slice(i + 1)
    const combos = generateCombinations(tail, k - 1)
    for (const combo of combos) {
      result.push([head, ...combo])
    }
  }
  return result
}

/**
 * Generate all permutations of an array.
 */
function generatePermutations<T>(array: T[]): T[][] {
  if (array.length <= 1) return [array]

  const result: T[][] = []
  for (let i = 0; i < array.length; i++) {
    const [head] = array.splice(i, 1)
    const perms = generatePermutations(array)
    for (const perm of perms) {
      result.push([head, ...perm])
    }
    array.splice(i, 0, head)
  }
  return result
}

function calculatePlacementScore(
  placement: PlacedTile[],
): number {
  // Simplified scoring for bot move selection (just raw points)
  let score = 0
  for (const tile of placement) {
    const points = getLetterPoints(tile.letter)
    score += points
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
