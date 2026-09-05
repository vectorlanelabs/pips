import type { ActionOutcome, ActionValidator } from '../../engine/sync.ts'
import { applyAction } from '../../engine/sync.ts'
import { runBotTurn, type BotStrategy } from '../../engine/bot.ts'
import { advanceTurn, currentPlayer } from '../../engine/turn-engine.ts'
import { moveCards, removeCardsById, addCards, cardCount, type Zone } from '../../card-engine/zones.ts'
import { shuffleDeck } from '../../card-engine/deck.ts'
import { premiumAt } from './board.ts'
import {
  LETTER_POINTS,
  RACK_SIZE,
  type ScrabbleTile,
  type ScrabbleAction,
  type ScrabblePrivateState,
  type ScrabblePublicState,
  type ScrabbleSession,
  type BoardCell,
  type LastPlacement,
} from './state.ts'
import type { ScrabbleDictionary } from './dictionary.ts'

interface ExtractedWord {
  word: string
  positions: Array<{ row: number; col: number }>
}

interface PlacementTile {
  tileId: string
  row: number
  col: number
  letter: string
  isBlank: boolean
}

// Word extraction: find main word and all cross-words
function extractWords(
  board: (BoardCell | null)[][],
  placement: PlacementTile[],
  isFirstPlacement: boolean,
): ExtractedWord[] {
  // Find the bounds of the placement
  const rows = placement.map((t) => t.row)
  const cols = placement.map((t) => t.col)
  const minRow = Math.min(...rows)
  const maxRow = Math.max(...rows)
  const minCol = Math.min(...cols)
  const maxCol = Math.max(...cols)

  const isHorizontal = minRow === maxRow

  const words: ExtractedWord[] = []

  if (isFirstPlacement) {
    // For first placement with center square, just extract main word
    if (isHorizontal) {
      const extractedWord = extractLineWord(board, minRow, minCol, maxCol, isHorizontal, placement)
      if (extractedWord.word.length >= 2) words.push(extractedWord)
    } else {
      const extractedWord = extractLineWord(board, minRow, minCol, maxRow, isHorizontal, placement)
      if (extractedWord.word.length >= 2) words.push(extractedWord)
    }
  } else {
    // Extract main word along the placement line
    if (isHorizontal) {
      // Find the full horizontal span including existing tiles
      let startCol = minCol
      let endCol = maxCol
      while (startCol > 0 && board[minRow][startCol - 1] !== null) startCol--
      while (endCol < 14 && board[minRow][endCol + 1] !== null) endCol++
      const word = extractLineWord(board, minRow, startCol, endCol, isHorizontal, placement)
      if (word.word.length >= 2) words.push(word)
    } else {
      // Find the full vertical span including existing tiles
      let startRow = minRow
      let endRow = maxRow
      while (startRow > 0 && board[startRow - 1][minCol] !== null) startRow--
      while (endRow < 14 && board[endRow + 1][minCol] !== null) endRow++
      const word = extractLineWord(board, startRow, minCol, endRow, isHorizontal, placement)
      if (word.word.length >= 2) words.push(word)
    }

    // Extract cross-words: for each newly placed tile, check perpendicular direction
    for (const tile of placement) {
      if (isHorizontal) {
        // Check vertical cross-word
        if ((tile.row > 0 && board[tile.row - 1][tile.col] !== null) ||
            (tile.row < 14 && board[tile.row + 1][tile.col] !== null)) {
          let startRow = tile.row
          let endRow = tile.row
          while (startRow > 0 && board[startRow - 1][tile.col] !== null) startRow--
          while (endRow < 14 && board[endRow + 1][tile.col] !== null) endRow++
          if (startRow < endRow) {
            const word = extractLineWord(board, startRow, tile.col, endRow, false, placement)
            if (word.word.length >= 2) words.push(word)
          }
        }
      } else {
        // Check horizontal cross-word
        if ((tile.col > 0 && board[tile.row][tile.col - 1] !== null) ||
            (tile.col < 14 && board[tile.row][tile.col + 1] !== null)) {
          let startCol = tile.col
          let endCol = tile.col
          while (startCol > 0 && board[tile.row][startCol - 1] !== null) startCol--
          while (endCol < 14 && board[tile.row][endCol + 1] !== null) endCol++
          if (startCol < endCol) {
            const word = extractLineWord(board, tile.row, startCol, endCol, true, placement)
            if (word.word.length >= 2) words.push(word)
          }
        }
      }
    }
  }

  // Note on duplicate prevention: A previous iteration added dedup logic here, but it was
  // unnecessary. Duplicate word extraction (same board position set) cannot occur given the
  // structure of extractWords:
  //
  // For horizontal placements (single row):
  //   - Main word: extracted once, horizontally
  //   - Cross-words: for each tile at unique column, check for vertical neighbors
  //   - Since tiles occupy different columns, each cross-word is at a different column
  //   - Main word and cross-words are geometrically distinct (horizontal vs vertical)
  //
  // For vertical placements (single column):
  //   - Main word: extracted once, vertically
  //   - Cross-words: for each tile at unique row, check for horizontal neighbors
  //   - Since tiles occupy different rows, each cross-word is at a different row
  //   - Main word and cross-words are geometrically distinct (vertical vs horizontal)
  //
  // extractLineWord processes each cell in its span exactly once, so no cell is duplicated
  // within a single extraction. The only way to get position-identical words would be to
  // extract the exact same cell range twice via different code paths, which the above
  // analysis shows cannot happen. Per CLAUDE.md, defensive code for impossible conditions
  // is removed.

  return words
}

// Extract a single word along a line (horizontal or vertical)
function extractLineWord(
  board: (BoardCell | null)[][],
  row: number,
  colStart: number,
  colEnd: number,
  isHorizontal: boolean,
  placement: PlacementTile[],
): ExtractedWord {
  const word: string[] = []
  const positions: Array<{ row: number; col: number }> = []

  if (isHorizontal) {
    for (let col = colStart; col <= colEnd; col++) {
      const tileInPlacement = placement.find((t) => t.row === row && t.col === col)
      if (tileInPlacement) {
        word.push(tileInPlacement.letter)
        positions.push({ row, col })
      } else {
        const cell = board[row][col]
        if (cell) {
          word.push(cell.letter)
          positions.push({ row, col })
        }
      }
    }
  } else {
    for (let r = row; r <= colEnd; r++) {
      const col = colStart
      const tileInPlacement = placement.find((t) => t.row === r && t.col === col)
      if (tileInPlacement) {
        word.push(tileInPlacement.letter)
        positions.push({ row: r, col })
      } else {
        const cell = board[r][col]
        if (cell) {
          word.push(cell.letter)
          positions.push({ row: r, col })
        }
      }
    }
  }

  return { word: word.join(''), positions }
}

// Score the extracted words, returning both total and per-word scores
export function scoreWords(
  board: (BoardCell | null)[][],
  words: ExtractedWord[],
  placement: PlacementTile[],
  numTilesPlaced: number,
): number {
  const { total } = scoreWordsWithBreakdown(board, words, placement, numTilesPlaced)
  return total
}

// Score the extracted words, returning both total and per-word breakdown
function scoreWordsWithBreakdown(
  board: (BoardCell | null)[][],
  words: ExtractedWord[],
  placement: PlacementTile[],
  numTilesPlaced: number,
): { wordScores: number[]; total: number } {
  const placedSet = new Set(placement.map((t) => `${t.row},${t.col}`))
  let totalScore = 0
  const wordScores: number[] = []

  for (const { positions } of words) {
    let wordScore = 0
    let wordMultiplier = 1
    let hasNewTile = false

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i]
      const key = `${pos.row},${pos.col}`
      const isNewTile = placedSet.has(key)

      const tile = placement.find((t) => t.row === pos.row && t.col === pos.col)
      const tilePoints = tile ? (tile.isBlank ? 0 : getTilePoints(tile.letter)) : getTilePoints(board[pos.row][pos.col]?.letter ?? '')

      if (isNewTile) {
        hasNewTile = true
        const premium = premiumAt(pos.row, pos.col)
        let letterMultiplier = 1
        if (premium === 'DL') letterMultiplier = 2
        else if (premium === 'TL') letterMultiplier = 3
        wordScore += tilePoints * letterMultiplier

        // Center square counts as DW
        if (pos.row === 7 && pos.col === 7) wordMultiplier *= 2
        else if (premium === 'DW') wordMultiplier *= 2
        else if (premium === 'TW') wordMultiplier *= 3
      } else {
        wordScore += tilePoints
      }
    }

    if (hasNewTile) {
      wordScore = wordScore * wordMultiplier
      wordScores.push(wordScore)
      totalScore += wordScore
    }
  }

  // Bingo bonus: 50 points if exactly 7 tiles placed (not attributed to any single word)
  if (numTilesPlaced === 7) {
    totalScore += 50
  }

  return { wordScores, total: totalScore }
}

// Helper to get tile points
function getTilePoints(letter: string): number {
  return LETTER_POINTS[letter] ?? 0
}

function makeValidator(
  bag: Zone<ScrabbleTile>,
  rng: () => number,
  setBag: (newBag: Zone<ScrabbleTile>) => void,
  dictionary: ScrabbleDictionary | null,
): ActionValidator<ScrabblePublicState, ScrabblePrivateState, ScrabbleAction> {
  return (session, playerId, action) => {
    const { publicState, privateStates } = session

    if (publicState.stage !== 'play') {
      return { ok: false, reason: 'game is over' }
    }

    // CHALLENGE is special: not gated by "is it your turn"
    if (action.type === 'CHALLENGE') {
      if (!Object.hasOwn(privateStates, playerId)) {
        return { ok: false, reason: 'not a player in this game' }
      }
      if (!publicState.lastPlacement) {
        return { ok: false, reason: 'nothing to challenge' }
      }
      if (!publicState.lastPlacement.challengeable) {
        return { ok: false, reason: 'this placement has already been challenged or locked in' }
      }
      if (publicState.lastPlacement.by === playerId) {
        return { ok: false, reason: 'you cannot challenge your own placement' }
      }

      if (!dictionary) {
        return { ok: false, reason: 'dictionary not loaded' }
      }

      // Check if any word is invalid
      const invalidWord = publicState.lastPlacement.words.some((w) => !dictionary.isWord(w.word))

      if (invalidWord) {
        // Challenge succeeds: undo placement
        const lastPlacement = publicState.lastPlacement
        const newBoard = publicState.board.map((row) => [...row])
        const originalPlacerId = lastPlacement.by

        // Remove tiles from board
        for (const tileInfo of lastPlacement.tiles) {
          newBoard[tileInfo.row][tileInfo.col] = null
        }

        // Return tiles to original placer's rack
        const originalRack = privateStates[originalPlacerId].rack

        // Create the returned tile objects
        const returnedTiles = lastPlacement.tiles.map((t): ScrabbleTile => {
          const isBlank = t.isBlank
          return {
            id: t.tileId,
            letter: isBlank ? '' : t.letter,
            points: isBlank ? 0 : getTilePoints(t.letter),
          }
        })

        // Remove the tiles that were drawn from the bag as refill for this placement
        // (recorded at placement time) — these go back into the bag. Driven by the
        // recorded ID list rather than a positional slice of the rack, which would be
        // wrong whenever the bag ran low and the placer got a partial refill.
        const { zone: shrunkRack, removed: removedTiles } = removeCardsById(originalRack, lastPlacement.drawnTileIds)

        // Add the removed tiles back to the bag
        let newBag = addCards(bag, removedTiles)
        setBag(newBag)

        // Add the returned (challenged) tiles to the now-shrunk rack
        const newRack = {
          ...shrunkRack,
          cards: [...shrunkRack.cards, ...returnedTiles],
        }

        // Update score
        const newScores = { ...publicState.scores }
        newScores[originalPlacerId] = publicState.scores[originalPlacerId] - lastPlacement.totalScore

        return {
          ok: true,
          publicState: {
            ...publicState,
            board: newBoard,
            scores: newScores,
            bagCount: cardCount(newBag),
            lastPlacement: null,
            lastNonPlacement: { by: playerId, kind: 'challenge', count: 0 },
            handCounts: { ...publicState.handCounts, [originalPlacerId]: cardCount(newRack) },
          },
          privateStates: {
            ...privateStates,
            [originalPlacerId]: { rack: newRack },
          },
        }
      } else {
        // Challenge fails: the challenger's own pending turn is forfeit.
        // currentIndex points at whoever's real turn is next to be taken
        // (CHALLENGE doesn't consume it -- a successful challenge leaves
        // `turn` untouched precisely because the challenger still gets to
        // act). When the challenger IS that pending player, a single
        // advanceTurn correctly moves past them to the next player -- that
        // single step IS the penalty. skipNext would be wrong here: its
        // real, tested semantics (see turn-engine.test.ts) are "skip the
        // player AFTER the current one," which would skip an unrelated
        // third player while leaving the challenger's own turn untouched.
        // CHALLENGE is deliberately not turn-gated (see above), so a
        // non-current player can challenge out of turn; they have no
        // pending turn to forfeit, so nothing to skip -- leave turn as is.
        return {
          ok: true,
          publicState: {
            ...publicState,
            turn: playerId === currentPlayer(publicState.turn) ? advanceTurn(publicState.turn, 'play') : publicState.turn,
            lastPlacement: { ...publicState.lastPlacement, challengeable: false },
          },
          privateStates,
        }
      }
    }

    // All other actions require it to be your turn
    if (currentPlayer(publicState.turn) !== playerId) {
      return { ok: false, reason: 'not your turn' }
    }

    const myRack = privateStates[playerId].rack

    if (action.type === 'PLACE_WORD') {
      // Validate structural legality
      const errors = validatePlacement(publicState, action, myRack)
      if (errors) {
        return { ok: false, reason: errors }
      }

      // Build placement info
      const placement: PlacementTile[] = action.tiles.map((t) => {
        const tile = myRack.cards.find((card) => card.id === t.tileId)!
        return {
          tileId: t.tileId,
          row: t.row,
          col: t.col,
          letter: t.letter,
          isBlank: tile.letter === '',
        }
      })

      // Extract words
      const isFirstPlacement = publicState.board.every((row) => row.every((cell) => cell === null))
      const extractedWords = extractWords(publicState.board, placement, isFirstPlacement)

      // Score words (with per-word breakdown)
      const { wordScores, total: placedScore } = scoreWordsWithBreakdown(publicState.board, extractedWords, placement, placement.length)

      // Apply placement to board
      const newBoard = publicState.board.map((row) => [...row])
      for (const tile of placement) {
        newBoard[tile.row][tile.col] = {
          letter: tile.letter,
          isBlank: tile.isBlank,
        }
      }

      // Remove tiles from rack
      const { zone: newRack } = removeCardsById(myRack, placement.map((t) => t.tileId))

      // Refill rack from bag
      const toRefill = RACK_SIZE - cardCount(newRack)
      let refilled = newRack
      let newBag = bag
      const drawnTileIds: string[] = []
      for (let i = 0; i < toRefill && cardCount(newBag) > 0; i++) {
        const tile = newBag.cards[newBag.cards.length - 1]
        drawnTileIds.push(tile.id)
        const { from, to } = moveCards(newBag, refilled, [tile.id])
        newBag = from
        refilled = to
      }
      setBag(newBag)

      // Update scores
      const newScores = { ...publicState.scores }
      newScores[playerId] = publicState.scores[playerId] + placedScore

      // Update hand counts
      const newHandCounts = { ...publicState.handCounts }
      for (const pid of publicState.turn.playerOrder) {
        if (pid === playerId) {
          newHandCounts[pid] = cardCount(refilled)
        }
      }

      const lastPlacement: LastPlacement = {
        by: playerId,
        tiles: placement,
        words: extractedWords.map((w, idx) => ({
          word: w.word,
          score: wordScores[idx] ?? 0,
        })),
        totalScore: placedScore,
        drawnTileIds,
        challengeable: true,
      }

      const newPublicState: ScrabblePublicState = {
        ...publicState,
        board: newBoard,
        scores: newScores,
        bagCount: cardCount(newBag),
        handCounts: newHandCounts,
        consecutivePasses: 0,
        lastPlacement,
        lastNonPlacement: null,
        turn: advanceTurn(publicState.turn, 'play'),
      }

      // Check end-game
      const endGameState = checkEndGame(newPublicState, { ...privateStates, [playerId]: { rack: refilled } }, newBag)
      if (endGameState) {
        return endGameState
      }

      return {
        ok: true,
        publicState: newPublicState,
        privateStates: { ...privateStates, [playerId]: { rack: refilled } },
      }
    }

    if (action.type === 'EXCHANGE_TILES') {
      if (action.tileIds.length === 0) {
        return { ok: false, reason: 'must exchange at least one tile' }
      }
      if (cardCount(bag) < action.tileIds.length) {
        return { ok: false, reason: 'not enough tiles in bag' }
      }
      if (!action.tileIds.every((id) => myRack.cards.some((t) => t.id === id))) {
        return { ok: false, reason: 'one or more tiles not in your rack' }
      }

      // Remove from rack, add to bag, reshuffle, draw same count
      const { zone: newRack, removed } = removeCardsById(myRack, action.tileIds)
      let newBag = addCards(bag, removed)
      newBag = { ...newBag, cards: shuffleDeck(newBag.cards, rng) }

      const toDraw = Math.min(removed.length, cardCount(newBag))
      let refilled = newRack
      for (let i = 0; i < toDraw; i++) {
        const tile = newBag.cards[newBag.cards.length - 1]
        const { from, to } = moveCards(newBag, refilled, [tile.id])
        newBag = from
        refilled = to
      }
      setBag(newBag)

      const newHandCounts = { ...publicState.handCounts }
      newHandCounts[playerId] = cardCount(refilled)

      const newPublicState: ScrabblePublicState = {
        ...publicState,
        bagCount: cardCount(newBag),
        handCounts: newHandCounts,
        consecutivePasses: publicState.consecutivePasses + 1,
        lastPlacement: null,
        lastNonPlacement: { by: playerId, kind: 'exchange', count: action.tileIds.length },
        turn: advanceTurn(publicState.turn, 'play'),
      }

      const endGameState = checkEndGame(newPublicState, { ...privateStates, [playerId]: { rack: refilled } }, newBag)
      if (endGameState) {
        return endGameState
      }

      return {
        ok: true,
        publicState: newPublicState,
        privateStates: { ...privateStates, [playerId]: { rack: refilled } },
      }
    }

    if (action.type === 'PASS') {
      const newPublicState: ScrabblePublicState = {
        ...publicState,
        consecutivePasses: publicState.consecutivePasses + 1,
        lastPlacement: null,
        lastNonPlacement: { by: playerId, kind: 'pass', count: 0 },
        turn: advanceTurn(publicState.turn, 'play'),
      }

      const endGameState = checkEndGame(newPublicState, privateStates, bag)
      if (endGameState) {
        return endGameState
      }

      return {
        ok: true,
        publicState: newPublicState,
        privateStates,
      }
    }

    return { ok: false, reason: 'unknown action' }
  }
}

// Validate PLACE_WORD structural legality
function validatePlacement(
  publicState: ScrabblePublicState,
  action: Extract<ScrabbleAction, { type: 'PLACE_WORD' }>,
  rack: Zone<ScrabbleTile>,
): string | null {
  // 1. Every tile is in rack
  for (const tile of action.tiles) {
    if (!rack.cards.find((t) => t.id === tile.tileId)) {
      return 'tile not in your rack'
    }
  }

  // 2. No two tiles share a target cell
  for (let i = 0; i < action.tiles.length; i++) {
    for (let j = i + 1; j < action.tiles.length; j++) {
      if (action.tiles[i].row === action.tiles[j].row && action.tiles[i].col === action.tiles[j].col) {
        return 'duplicate cell in placement'
      }
    }
  }

  // 3. No tile is used more than once
  for (let i = 0; i < action.tiles.length; i++) {
    for (let j = i + 1; j < action.tiles.length; j++) {
      if (action.tiles[i].tileId === action.tiles[j].tileId) {
        return 'duplicate tile in placement'
      }
    }
  }

  // 4. Every target cell is empty and in bounds
  for (const tile of action.tiles) {
    if (tile.row < 0 || tile.row >= 15 || tile.col < 0 || tile.col >= 15) {
      return 'placement out of bounds'
    }
    if (publicState.board[tile.row][tile.col] !== null) {
      return 'target cell already occupied'
    }
  }

  // 5. All placed cells in a single row or column
  const rows = action.tiles.map((t) => t.row)
  const cols = action.tiles.map((t) => t.col)
  const singleRow = rows.every((r) => r === rows[0])
  const singleCol = cols.every((c) => c === cols[0])
  if (!singleRow && !singleCol) {
    return 'tiles must be in a single row or column'
  }

  // 6. No gaps in the placement
  if (singleRow) {
    const minCol = Math.min(...cols)
    const maxCol = Math.max(...cols)
    for (let c = minCol; c <= maxCol; c++) {
      const tileHere = action.tiles.some((t) => t.row === rows[0] && t.col === c)
      const cellHere = publicState.board[rows[0]][c] !== null
      if (!tileHere && !cellHere) {
        return 'placement has gaps'
      }
    }
  } else {
    const minRow = Math.min(...rows)
    const maxRow = Math.max(...rows)
    for (let r = minRow; r <= maxRow; r++) {
      const tileHere = action.tiles.some((t) => t.row === r && t.col === cols[0])
      const cellHere = publicState.board[r][cols[0]] !== null
      if (!tileHere && !cellHere) {
        return 'placement has gaps'
      }
    }
  }

  const isFirstPlacement = publicState.board.every((row) => row.every((cell) => cell === null))

  // 7. First placement must cover center and be 2+ tiles
  if (isFirstPlacement) {
    if (action.tiles.length < 2) {
      return 'first placement must be at least 2 tiles'
    }
    const coverCenter = action.tiles.some((t) => t.row === 7 && t.col === 7)
    if (!coverCenter) {
      return 'first placement must cover the center square (7,7)'
    }
  } else {
    // 8. Must connect to existing tiles
    let connects = false
    for (const tile of action.tiles) {
      // Check orthogonal adjacency
      if (publicState.board[tile.row - 1]?.[tile.col] !== null ||
          publicState.board[tile.row + 1]?.[tile.col] !== null ||
          publicState.board[tile.row][tile.col - 1] !== null ||
          publicState.board[tile.row][tile.col + 1] !== null) {
        connects = true
        break
      }
    }
    if (!connects) {
      return 'placement must connect to existing tiles'
    }
  }

  // 9. Blank tile letter validation
  for (const placedTile of action.tiles) {
    const rackTile = rack.cards.find((t) => t.id === placedTile.tileId)!
    if (rackTile.letter === '') {
      // Blank tile: letter must be A-Z
      if (!/^[A-Z]$/.test(placedTile.letter)) {
        return 'blank tile letter must be A-Z'
      }
    } else {
      // Non-blank: letter must match
      if (placedTile.letter !== rackTile.letter) {
        return 'tile letter does not match'
      }
    }
  }

  return null
}

// End-game check
function checkEndGame(
  publicState: ScrabblePublicState,
  updatedPrivateStates: Record<string, ScrabblePrivateState>,
  bag: Zone<ScrabbleTile>,
): ActionOutcome<ScrabblePublicState, ScrabblePrivateState> | null {
  // Trigger 1: bag empty and some player's rack empty
  if (cardCount(bag) === 0) {
    for (const playerId of publicState.turn.playerOrder) {
      if (cardCount(updatedPrivateStates[playerId].rack) === 0) {
        // Game over: score adjustments
        let scores = { ...publicState.scores }
        for (const pid of publicState.turn.playerOrder) {
          if (pid !== playerId) {
            const rackSum = updatedPrivateStates[pid].rack.cards.reduce((sum, t) => sum + t.points, 0)
            scores[playerId] += rackSum
            scores[pid] -= rackSum
          }
        }

        // Find winner
        const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
        const winnerId = sorted[0][1] === sorted[1]?.[1] ? null : sorted[0][0]

        return {
          ok: true,
          publicState: {
            ...publicState,
            stage: 'over',
            scores,
            winnerId,
          },
          privateStates: updatedPrivateStates,
        }
      }
    }
  }

  // Trigger 2: consecutive passes/exchanges >= playerCount * 2
  if (publicState.consecutivePasses >= publicState.turn.playerOrder.length * 2) {
    const sorted = Object.entries(publicState.scores).sort((a, b) => b[1] - a[1])
    const winnerId = sorted[0][1] === sorted[1]?.[1] ? null : sorted[0][0]

    return {
      ok: true,
      publicState: {
        ...publicState,
        stage: 'over',
        winnerId,
      },
      privateStates: updatedPrivateStates,
    }
  }

  return null
}

export function applyScrabbleAction(
  session: ScrabbleSession,
  playerId: string,
  action: ScrabbleAction,
  dictionary: ScrabbleDictionary | null = null,
): { session: ScrabbleSession; outcome: ActionOutcome<ScrabblePublicState, ScrabblePrivateState> } {
  let candidateBag = session.bag
  const validate = makeValidator(session.bag, session.rng, (b) => { candidateBag = b }, dictionary)
  const { session: newSession, outcome } = applyAction(session.session, playerId, action, validate)
  const bag = outcome.ok ? candidateBag : session.bag
  return { session: { session: newSession, bag, rng: session.rng }, outcome }
}

export function runScrabbleBotTurn(
  session: ScrabbleSession,
  playerId: string,
  strategy: BotStrategy<ScrabblePublicState, ScrabblePrivateState, ScrabbleAction>,
  dictionary: ScrabbleDictionary | null = null,
): { session: ScrabbleSession; outcome: ActionOutcome<ScrabblePublicState, ScrabblePrivateState> } {
  let candidateBag = session.bag
  const validate = makeValidator(session.bag, session.rng, (b) => { candidateBag = b }, dictionary)
  const { session: newSession, outcome } = runBotTurn(session.session, playerId, strategy, validate)
  const bag = outcome.ok ? candidateBag : session.bag
  return { session: { session: newSession, bag, rng: session.rng }, outcome }
}
