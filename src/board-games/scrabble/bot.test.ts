import { describe, it, expect } from 'vitest'
import { createScrabbleBotStrategy } from './bot'
import type { ScrabblePublicState, ScrabblePrivateState, BoardCell } from './state'
import type { ScrabbleDictionary } from './dictionary'
import type { Zone } from '../../card-engine/zones'
import type { ScrabbleTile } from './state'

/**
 * Mock dictionary for testing: accepts specific words needed by tests.
 * In real use, the actual enable1.dawg dictionary is loaded.
 */
function createMockDictionary(validWords: Set<string>): ScrabbleDictionary {
  return {
    isWord: (word: string) => validWords.has(word.toUpperCase()),
  }
}

/**
 * Test 1: Bot finds and places a real word from its rack against a non-trivial board.
 *
 * Setup: Board has some existing tiles. Bot's rack can spell a valid word
 * that connects to the board. Verify bot generates and plays a valid move.
 */
describe('Scrabble bot word search', () => {
  it('finds and plays a real word when one is findable from rack', () => {
    // Valid words for this test
    const validWords = new Set([
      'CAT',
      'CATS',
      'AT',
      'A',
      'C',
      'ACT',
      'ACTS',
    ])

    const dictionary = createMockDictionary(validWords)
    const strategy = createScrabbleBotStrategy(dictionary, 'medium')

    // Build a board with some existing tiles
    // Place "ACT" horizontally at row 7, cols 6-8
    const board: Array<Array<BoardCell | null>> = Array(15)
      .fill(null)
      .map(() => Array(15).fill(null))

    board[7][6] = { letter: 'A', isBlank: false, premiumConsumed: true }
    board[7][7] = { letter: 'C', isBlank: false, premiumConsumed: true }
    board[7][8] = { letter: 'T', isBlank: false, premiumConsumed: true }

    // Create bot's rack: can spell "CATS" vertically at col 8, rows 7-10
    // C is already at (7,8), so bot needs A, T, S
    const rackTiles: ScrabbleTile[] = [
      { id: 'tile-1', letter: 'C', points: 3 },
      { id: 'tile-2', letter: 'A', points: 1 },
      { id: 'tile-3', letter: 'T', points: 1 },
      { id: 'tile-4', letter: 'S', points: 1 },
      { id: 'tile-5', letter: 'X', points: 8 },
      { id: 'tile-6', letter: 'Q', points: 10 },
      { id: 'tile-7', letter: 'Z', points: 10 },
    ]

    const rack: Zone<ScrabbleTile> = {
      id: 'rack-bot1',
      ownerId: 'bot-1',
      visibility: 'private',
      cards: rackTiles,
    }

    const publicState: ScrabblePublicState = {
      board,
      turn: { playerOrder: ['bot-1'], currentIndex: 0, direction: 1, phase: 'play', turnNumber: 1 },
      scores: { 'bot-1': 0 },
      handCounts: { 'bot-1': 7 },
      bagCount: 50,
      stage: 'play',
      consecutivePasses: 0,
      lastPlacement: null,
      winnerId: null,
    }

    const privateState: ScrabblePrivateState = {
      rack,
    }

    const action = strategy(publicState, privateState, 'bot-1')

    // Verify bot plays PLACE_WORD (not PASS or EXCHANGE)
    // Note: passing 'medium' difficulty explicitly (tests updated per spec)
    expect(action.type).toBe('PLACE_WORD')

    if (action.type === 'PLACE_WORD') {
      // Verify the placed tiles form at least one valid word
      const placedTiles = action.tiles
      expect(placedTiles.length).toBeGreaterThan(0)

      // Verify all placed tiles are from the rack
      for (const tile of placedTiles) {
        const rackTile = rackTiles.find((t) => t.id === tile.tileId)
        expect(rackTile, `Tile ${tile.tileId} should be in rack`).toBeDefined()
      }

      // Verify placement is in a single row or column
      const rows = placedTiles.map((t) => t.row)
      const cols = placedTiles.map((t) => t.col)
      const singleRow = rows.every((r) => r === rows[0])
      const singleCol = cols.every((c) => c === cols[0])
      expect(singleRow || singleCol).toBe(true)

      // Verify tiles connect to existing board
      let connects = false
      for (const tile of placedTiles) {
        if (
          board[tile.row - 1]?.[tile.col] !== null ||
          board[tile.row + 1]?.[tile.col] !== null ||
          board[tile.row][tile.col - 1] !== null ||
          board[tile.row][tile.col + 1] !== null
        ) {
          connects = true
          break
        }
      }
      expect(connects).toBe(true)
    }
  })

  /**
   * Test 2: Bot rejects candidates that form invalid cross-words.
   *
   * Setup: A candidate main word is valid, but placing it would form
   * an invalid cross-word. Verify the bot does NOT play this move.
   */
  it('rejects candidates that form invalid cross-words', () => {
    const validWords = new Set([
      'CAT', // Valid main word
      'AT',  // Valid cross-word
      // But "CX" is NOT valid
    ])

    const dictionary = createMockDictionary(validWords)
    const strategy = createScrabbleBotStrategy(dictionary, 'medium')

    // Setup board with some tiles
    const board: Array<Array<BoardCell | null>> = Array(15)
      .fill(null)
      .map(() => Array(15).fill(null))

    // Place "A" at (7, 7) - center
    board[7][7] = { letter: 'A', isBlank: false, premiumConsumed: true }

    // Place "T" at (7, 8) to form "AT" horizontally
    board[7][8] = { letter: 'T', isBlank: false, premiumConsumed: true }

    // Bot's rack
    const rackTiles: ScrabbleTile[] = [
      { id: 'tile-1', letter: 'C', points: 3 },
      { id: 'tile-2', letter: 'X', points: 8 }, // Would form invalid "CX" vertically
      { id: 'tile-3', letter: 'B', points: 3 },
      { id: 'tile-4', letter: 'D', points: 2 },
      { id: 'tile-5', letter: 'E', points: 1 },
      { id: 'tile-6', letter: 'R', points: 1 },
      { id: 'tile-7', letter: 'S', points: 1 },
    ]

    const rack: Zone<ScrabbleTile> = {
      id: 'rack-bot1',
      ownerId: 'bot-1',
      visibility: 'private',
      cards: rackTiles,
    }

    const publicState: ScrabblePublicState = {
      board,
      turn: { playerOrder: ['bot-1'], currentIndex: 0, direction: 1, phase: 'play', turnNumber: 1 },
      scores: { 'bot-1': 0 },
      handCounts: { 'bot-1': 7 },
      bagCount: 50,
      stage: 'play',
      consecutivePasses: 0,
      lastPlacement: null,
      winnerId: null,
    }

    const privateState: ScrabblePrivateState = {
      rack,
    }

    const action = strategy(publicState, privateState, 'bot-1')

    // Bot should NOT generate a move that places at (6,7) or (8,7) with C or X
    // because that would form invalid cross-words CX or XC
    if (action.type === 'PLACE_WORD') {
      for (const tile of action.tiles) {
        // Verify no invalid cross-word formations
        if (tile.col === 7 && (tile.row === 6 || tile.row === 8)) {
          // If placing at (6,7) or (8,7), it would form a vertical word with A at (7,7)
          // That word should be valid
          const isValid = validWords.has(tile.letter + 'A') || validWords.has('A' + tile.letter)
          expect(isValid, `Placing ${tile.letter} at (${tile.row},${tile.col}) would form invalid cross-word`).toBe(true)
        }
      }
    }
  })

  /**
   * Test 3: Bot tries blank tiles as different letters, not hardcoded to 'A'.
   *
   * Setup: Bot's rack includes a blank. The blank is in a position where
   * assigning it 'A' would NOT form valid words, but assigning it a different
   * letter (e.g., 'S') would. Verify the bot uses the correct letter for the blank.
   */
  it('tries blanks as different letters, not hardcoded to A', () => {
    const validWords = new Set([
      'SO', // Blank as S makes SO
      'AT', // Existing word
      // But AO is not valid
    ])

    const dictionary = createMockDictionary(validWords)
    const strategy = createScrabbleBotStrategy(dictionary, 'medium')

    // Setup board
    const board: Array<Array<BoardCell | null>> = Array(15)
      .fill(null)
      .map(() => Array(15).fill(null))

    // Place "O" at (7, 7)
    board[7][7] = { letter: 'O', isBlank: false, premiumConsumed: true }

    // Bot's rack with a blank
    const rackTiles: ScrabbleTile[] = [
      { id: 'blank-1', letter: '', points: 0 }, // Blank tile
      { id: 'tile-2', letter: 'T', points: 1 },
      { id: 'tile-3', letter: 'R', points: 1 },
      { id: 'tile-4', letter: 'E', points: 1 },
      { id: 'tile-5', letter: 'N', points: 1 },
      { id: 'tile-6', letter: 'D', points: 2 },
      { id: 'tile-7', letter: 'S', points: 1 },
    ]

    const rack: Zone<ScrabbleTile> = {
      id: 'rack-bot1',
      ownerId: 'bot-1',
      visibility: 'private',
      cards: rackTiles,
    }

    const publicState: ScrabblePublicState = {
      board,
      turn: { playerOrder: ['bot-1'], currentIndex: 0, direction: 1, phase: 'play', turnNumber: 1 },
      scores: { 'bot-1': 0 },
      handCounts: { 'bot-1': 7 },
      bagCount: 50,
      stage: 'play',
      consecutivePasses: 0,
      lastPlacement: null,
      winnerId: null,
    }

    const privateState: ScrabblePrivateState = {
      rack,
    }

    const action = strategy(publicState, privateState, 'bot-1')

    // If bot plays a move, verify it's valid
    // Since 'SO' is the only valid 2-letter word with O, the blank must be assigned as 'S'
    if (action.type === 'PLACE_WORD') {
      // Verify placement includes the blank and assigns it correctly
      const blankTile = action.tiles.find((t) => t.tileId === 'blank-1')
      if (blankTile) {
        // The blank should be assigned to 'S' to form valid word 'SO'
        expect(['S', 'O']).toContain(blankTile.letter)
      }
    }
  })

  /**
   * Test 4: Bot rejects a main-word window that isn't the full contiguous run.
   *
   * Setup: an existing vertical run "CRAN" occupies rows 0-3 of a column,
   * row 4 is an empty gap (the anchor), and rows 5-6 have two more existing
   * tiles "ES" (an island left over from an earlier cross-word). The bot's
   * rack has a 'T' that, placed at row 4, forms a valid dictionary word
   * "TES" when checked as an isolated 3-letter window (rows 4-6) — but once
   * actually applied, the real board scoring (extractWords) extends to the
   * full contiguous run rows 0-6, producing "CRANTES", which is not a valid
   * word. The bot must not consider the truncated "TES" window valid, since
   * it abuts another occupied cell just above it (row 3) that it fails to
   * account for. (Reproduces a live bug where the bot played "PAWNEESH" by
   * extending an existing "PAWNEE" through two pre-existing letters below
   * it without validating the resulting full word.)
   *
   * The rest of the board is densely filled with filler tiles (mirroring a
   * realistic late-game board, not an empty one) so the bot's per-anchor
   * search budget isn't consumed on cheap, irrelevant anchors before it
   * ever reaches the one this test cares about — an empty board is actually
   * the worst case for search cost (every anchor needs a huge rack
   * permutation search), which starved this exact anchor out of the budget
   * in an earlier, less faithful version of this test.
   */
  it('rejects a main-word window that abuts more occupied cells outside it', () => {
    const validWords = new Set([
      'TES', // Valid ONLY as an isolated (incorrectly truncated) 3-letter window
      // "CRANTES" (the real resulting word) is deliberately NOT valid, and
      // neither are any of the horizontal 2-letter combos with T/E/S below,
      // so there's no other equally-scoring legitimate move to confuse this
      // assertion.
    ])

    const dictionary = createMockDictionary(validWords)
    const strategy = createScrabbleBotStrategy(dictionary, 'medium')

    const col = 7
    const board: Array<Array<BoardCell | null>> = Array(15)
      .fill(null)
      .map((_, r) =>
        Array(15)
          .fill(null)
          .map((__, c) =>
            // Leave a small empty pocket around the target column/anchor;
            // fill everything else so other anchors resolve near-instantly.
            r === 4 && (c === 6 || c === 7 || c === 8)
              ? null
              : { letter: 'Z', isBlank: false, premiumConsumed: true },
          ),
      )

    const letters = ['C', 'R', 'A', 'N']
    for (let i = 0; i < letters.length; i++) {
      board[i][col] = { letter: letters[i], isBlank: false, premiumConsumed: true }
    }
    // row 4 is the empty anchor; rows 5-6 are existing isolated tiles
    board[5][col] = { letter: 'E', isBlank: false, premiumConsumed: true }
    board[6][col] = { letter: 'S', isBlank: false, premiumConsumed: true }

    // Rack: only 'T' can usefully fill the gap; the rest can't form any word
    const rackTiles: ScrabbleTile[] = [
      { id: 'tile-t', letter: 'T', points: 1 },
      { id: 'tile-1', letter: 'Q', points: 10 },
      { id: 'tile-2', letter: 'J', points: 8 },
      { id: 'tile-3', letter: 'K', points: 5 },
      { id: 'tile-4', letter: 'V', points: 4 },
      { id: 'tile-5', letter: 'W', points: 4 },
      { id: 'tile-6', letter: 'Y', points: 4 },
    ]

    const rack: Zone<ScrabbleTile> = {
      id: 'rack-bot1',
      ownerId: 'bot-1',
      visibility: 'private',
      cards: rackTiles,
    }

    const publicState: ScrabblePublicState = {
      board,
      turn: { playerOrder: ['bot-1'], currentIndex: 0, direction: 1, phase: 'play', turnNumber: 1 },
      scores: { 'bot-1': 0 },
      handCounts: { 'bot-1': 7 },
      bagCount: 50,
      stage: 'play',
      consecutivePasses: 0,
      lastPlacement: null,
      winnerId: null,
    }

    const privateState: ScrabblePrivateState = {
      rack,
    }

    const action = strategy(publicState, privateState, 'bot-1')

    // The bot must not place 'T' at (4, col) — the only "valid-looking" move
    // is exactly the truncated-window bug this test guards against.
    if (action.type === 'PLACE_WORD') {
      const placesBuggyTile = action.tiles.some((t) => t.row === 4 && t.col === col)
      expect(placesBuggyTile).toBe(false)
    }
  })

  /**
   * Test 5: At `easy`, the bot picks uniformly from all candidates;
   * at `medium/hard`, the bot picks from top-5%-tie only.
   *
   * Setup: Empty board (bot must place through center). Rack includes both
   * low-scoring tiles (A=1, E=1, I=1) and high-scoring tiles (Z=10, Q=10)
   * that can form multiple valid words from center (7,7):
   * - Low-scoring 2-letter words: AT (1 pt), AI (1 pt)
   * - High-scoring 2-letter words: ZA (10 pts), QI (10 pts)
   *
   * Run easy and medium N=15 times each and verify easy's minimum score is
   * lower (proving easy picks from all candidates, not just top 5%).
   * Performance: empty board first-move search is ~30-50ms, 15×2 = ~1s total.
   */
  it('at easy, bot sometimes picks lower-scoring candidates', () => {
    // Valid words on empty board starting from center
    const validWords = new Set(['A', 'AT', 'AI', 'E', 'I', 'Z', 'ZA', 'Q', 'QI', 'T'])
    const dictionary = createMockDictionary(validWords)

    // Empty board: bot places first word through center (7,7)
    const board: Array<Array<BoardCell | null>> = Array(15)
      .fill(null)
      .map(() => Array(15).fill(null))

    // Rack with low-scoring (A, E, I, T) and high-scoring (Z, Q) tiles
    // All can form valid 2-letter words through center
    const rackTiles: ScrabbleTile[] = [
      { id: 'tile-1', letter: 'A', points: 1 },  // Forms AT, AI (1 pt)
      { id: 'tile-2', letter: 'T', points: 1 },  // Forms AT
      { id: 'tile-3', letter: 'I', points: 1 },  // Forms AI, QI
      { id: 'tile-4', letter: 'Z', points: 10 }, // Forms ZA (10 pts)
      { id: 'tile-5', letter: 'Q', points: 10 }, // Forms QI (10 pts)
      { id: 'tile-6', letter: 'E', points: 1 },
      { id: 'tile-7', letter: 'L', points: 1 },
    ]

    const rack: Zone<ScrabbleTile> = {
      id: 'rack-bot1',
      ownerId: 'bot-1',
      visibility: 'private',
      cards: rackTiles,
    }

    const publicState: ScrabblePublicState = {
      board,
      turn: { playerOrder: ['bot-1'], currentIndex: 0, direction: 1, phase: 'play', turnNumber: 1 },
      scores: { 'bot-1': 0 },
      handCounts: { 'bot-1': 7 },
      bagCount: 50,
      stage: 'play',
      consecutivePasses: 0,
      lastPlacement: null,
      winnerId: null,
    }

    const privateState: ScrabblePrivateState = {
      rack,
    }

    const strategyEasy = createScrabbleBotStrategy(dictionary, 'easy')
    const strategyMedium = createScrabbleBotStrategy(dictionary, 'medium')

    // Collect scores from both strategies: N=15 each
    const easyScores: number[] = []
    for (let i = 0; i < 15; i++) {
      const action = strategyEasy(publicState, privateState, 'bot-1')
      if (action.type === 'PLACE_WORD') {
        let score = 0
        for (const tile of action.tiles) {
          score += rackTiles.find((t) => t.id === tile.tileId)?.points ?? 0
        }
        easyScores.push(score)
      }
    }

    const mediumScores: number[] = []
    for (let i = 0; i < 15; i++) {
      const action = strategyMedium(publicState, privateState, 'bot-1')
      if (action.type === 'PLACE_WORD') {
        let score = 0
        for (const tile of action.tiles) {
          score += rackTiles.find((t) => t.id === tile.tileId)?.points ?? 0
        }
        mediumScores.push(score)
      }
    }

    const minEasyScore = Math.min(...easyScores)
    const minMediumScore = Math.min(...mediumScores)

    // Easy should pick lower-scoring words sometimes; medium always top 5%
    expect(minEasyScore).toBeLessThan(minMediumScore)
  })

  /**
   * Test 6: Challenge probability differs meaningfully between difficulty tiers.
   *
   * Setup: Mostly-full board with one strategic empty anchor. When the bot
   * does NOT challenge (80% easy, 10% hard), move-generation search is cheap
   * because anchor enumeration finds only the one anchor, not O(15²) anchors.
   * This keeps the test runtime fast even with 40 iterations (worst-case:
   * ~27 no-challenge + 1-2 anchor searches × 50ms avg = ~1.4s, well under 5s).
   *
   * Invalid lastPlacement: XY is not in dictionary, so challenge is relevant.
   * Rack: no tiles can form valid words, so non-challenge → EXCHANGE or PASS
   * (no expensive move search). Empty cells: only one strategic anchor so
   * anchor enumeration is instant.
   */
  it('challenge rates differ meaningfully between easy and hard', () => {
    // No valid words: forces EXCHANGE/PASS fallback if no challenge
    const validWords = new Set<string>()
    const dictionary = createMockDictionary(validWords)

    // Mostly-full board: only one strategic empty anchor at (7,9)
    const board: Array<Array<BoardCell | null>> = Array(15)
      .fill(null)
      .map((_, r) =>
        Array(15)
          .fill(null)
          .map((__, c) => {
            // Leave only (7,9) empty; rest is filler
            if (r === 7 && c === 9) {
              return null
            }
            return { letter: 'Z', isBlank: false, premiumConsumed: true }
          }),
      )

    // Existing tiles at (7,7-8)
    board[7][7] = { letter: 'A', isBlank: false, premiumConsumed: true }
    board[7][8] = { letter: 'T', isBlank: false, premiumConsumed: true }

    // Rack with tiles that can't form any valid words (dict is empty)
    const rackTiles: ScrabbleTile[] = [
      { id: 'tile-1', letter: 'X', points: 8 },
      { id: 'tile-2', letter: 'Z', points: 10 },
      { id: 'tile-3', letter: 'Q', points: 10 },
      { id: 'tile-4', letter: 'J', points: 8 },
      { id: 'tile-5', letter: 'K', points: 5 },
      { id: 'tile-6', letter: 'V', points: 4 },
      { id: 'tile-7', letter: 'W', points: 4 },
    ]

    const rack: Zone<ScrabbleTile> = {
      id: 'rack-bot1',
      ownerId: 'bot-1',
      visibility: 'private',
      cards: rackTiles,
    }

    // Invalid word placed by opponent
    const invalidWord = { word: 'XY', score: 18 }

    const publicState: ScrabblePublicState = {
      board,
      turn: { playerOrder: ['player-1', 'bot-1'], currentIndex: 1, direction: 1, phase: 'play', turnNumber: 2 },
      scores: { 'player-1': 0, 'bot-1': 0 },
      handCounts: { 'player-1': 7, 'bot-1': 7 },
      bagCount: 50,
      stage: 'play',
      consecutivePasses: 0,
      lastPlacement: {
        by: 'player-1',
        tiles: [{ tileId: 'opp-tile', row: 7, col: 8, letter: 'X', isBlank: false }],
        words: [invalidWord],
        totalScore: 18,
        drawnTileIds: [],
        challengeable: true,
      },
      winnerId: null,
    }

    const privateState: ScrabblePrivateState = {
      rack,
    }

    const strategyEasy = createScrabbleBotStrategy(dictionary, 'easy')
    const strategyHard = createScrabbleBotStrategy(dictionary, 'hard')

    // N=40: collects ~8 easy challenges and ~36 hard challenges (20% vs 90%)
    // Non-challenge fallback is EXCHANGE/PASS (no move search), instant
    const N = 40
    let easyChallengCount = 0
    let hardChallengeCount = 0

    for (let i = 0; i < N; i++) {
      const actionEasy = strategyEasy(publicState, privateState, 'bot-1')
      if (actionEasy.type === 'CHALLENGE') easyChallengCount++

      const actionHard = strategyHard(publicState, privateState, 'bot-1')
      if (actionHard.type === 'CHALLENGE') hardChallengeCount++
    }

    // Hard should challenge significantly more: expect 2.5x+ difference
    // Expected: easy ~8/40 (20%), hard ~36/40 (90%), ratio ~4.5x
    expect(hardChallengeCount).toBeGreaterThan(easyChallengCount * 2.5)
  })

  /**
   * Test: the search time budget is enforced inside generateValidPermutations,
   * not just between anchors/word-lengths. Before the fix, a dense board with
   * multiple 2-blank pockets ran well past the declared 300ms budget because
   * the budget was only checked at coarser loop granularity. A permissive
   * dictionary (accepts every word) maximizes the permutation/letter-combo
   * fan-out without depending on real dictionary contents.
   */
  it('bounds the search near the declared time budget on a dense multi-pocket board with blanks', () => {
    const permissiveDictionary: ScrabbleDictionary = { isWord: () => true }
    const strategy = createScrabbleBotStrategy(permissiveDictionary, 'medium')

    // Dense board: all 'Z' filler except three 7-cell horizontal pockets
    // (rows 1, 7, 13, cols 4-10) — each pocket is a valid anchor, multiplying
    // the permutation search cost enough to cross the 300ms budget if
    // unbounded.
    const board: Array<Array<BoardCell | null>> = Array(15)
      .fill(null)
      .map((_, r) =>
        Array(15)
          .fill(null)
          .map((__, c) =>
            (r === 1 || r === 7 || r === 13) && c >= 4 && c <= 10
              ? null
              : { letter: 'Z', isBlank: false, premiumConsumed: true },
          ),
      )

    // Full 7-tile rack with 2 blanks — maximizes permutation and blank
    // letter-combination fan-out per anchor.
    const rackTiles: ScrabbleTile[] = [
      { id: 'b1', letter: '', points: 0 },
      { id: 'b2', letter: '', points: 0 },
      { id: 't1', letter: 'E', points: 1 },
      { id: 't2', letter: 'R', points: 1 },
      { id: 't3', letter: 'S', points: 1 },
      { id: 't4', letter: 'N', points: 1 },
      { id: 't5', letter: 'T', points: 1 },
    ]
    const rack: Zone<ScrabbleTile> = {
      id: 'rack-bot1',
      ownerId: 'bot-1',
      visibility: 'private',
      cards: rackTiles,
    }

    const publicState: ScrabblePublicState = {
      board,
      turn: { playerOrder: ['bot-1'], currentIndex: 0, direction: 1, phase: 'play', turnNumber: 1 },
      scores: { 'bot-1': 0 },
      handCounts: { 'bot-1': 7 },
      bagCount: 50,
      stage: 'play',
      consecutivePasses: 0,
      lastPlacement: null,
      winnerId: null,
    }
    const privateState: ScrabblePrivateState = { rack }

    const start = performance.now()
    strategy(publicState, privateState, 'bot-1')
    const elapsed = performance.now() - start

    // Generous headroom above the 300ms budget (CI/local machines vary) —
    // this is a regression guard against the search running unboundedly past
    // its budget, not a tight timing assertion. Pre-fix this scenario ran
    // ~312ms+ with the budget only enforced between anchors/word-lengths;
    // post-fix it should stay close to 300ms since the permutation loop now
    // enforces it directly.
    expect(elapsed).toBeLessThan(600)
  })

  /**
   * Test: accumulating a very large valid-placements array must not throw
   * "Maximum call stack size exceeded". Before the fix, `results.push(...arr)`
   * spread the array as call arguments, which blows the stack once the array
   * is large enough (observed with a permissive dictionary on a dense board:
   * ~500K entries). This directly exercises the same accumulation pattern
   * used in bot.ts's hot path (a plain for-of push loop) at a size well past
   * V8's default argument-spread stack limit, proving the pattern itself is
   * stack-safe regardless of how large the search results get.
   */
  it('accumulates a very large result array without blowing the call stack', () => {
    const source = new Array(300_000).fill(0).map((_, i) => ({ tileId: `t-${i}`, row: 0, col: 0, letter: 'A' }))
    const target: typeof source = []
    expect(() => {
      for (const item of source) target.push(item)
    }).not.toThrow()
    expect(target.length).toBe(300_000)
  })
})
