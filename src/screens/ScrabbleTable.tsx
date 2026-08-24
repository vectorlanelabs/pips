import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LETTER_POINTS, type ScrabblePublicState, type ScrabbleTile } from '../board-games/scrabble/state'
import { premiumAt } from '../board-games/scrabble/board'
import { currentPlayer } from '../engine/turn-engine'
import { DealIntro } from '../components/DealIntro'
import { ScrabbleTileBack } from '../components/ScrabbleTileBack'
import { ScrabbleRulesOverlay } from './ScrabbleRulesOverlay'
import { TableHeader } from '../components/TableHeader'
import { useSound } from '../hooks/useSound'
import { useTurnStartSound } from '../hooks/useTurnStartSound'
import './ScrabbleTable.css'

const BRAND = '#8b6e47'

export interface ScrabbleTableProps {
  code: string
  localPlayerId: string
  localName: string
  publicState: ScrabblePublicState
  myRack: ScrabbleTile[]
  connection: 'connected' | 'disconnected'
  notice?: string | null
  opponentNames?: Record<string, string>
  opponentColors?: Record<string, string>
  onPlaceWord: (tiles: { tileId: string; row: number; col: number; letter: string }[]) => void
  onExchange: (tileIds: string[]) => void
  onPass: () => void
  onChallenge: () => void
  onLeave: () => void
}

interface StagedPlacement {
  tileId: string
  row: number
  col: number
  letter: string
}

interface BlankAssignment {
  tileId: string
  letter: string | null
}

function computeEventLine(
  publicState: ScrabblePublicState,
  localPlayerId: string,
): string {
  const placement = publicState.lastPlacement
  if (!placement) {
    return publicState.turn.playerOrder[0] === localPlayerId
      ? 'Your move.'
      : 'Waiting for the first play…'
  }

  const playerName = placement.by === localPlayerId ? 'You' : 'They'
  const mainWord = placement.words[0]?.word ?? ''
  const mainScore = placement.words[0]?.score ?? 0
  const crossWords = placement.words.slice(1)

  let line = `${playerName} played ${mainWord} for ${mainScore}`
  if (crossWords.length > 0) {
    const crossSummary = crossWords.map((w) => `${w.word} for ${w.score}`).join(', ')
    line += ` (+ ${crossSummary})`
  }
  line += '.'
  return line
}

function computePromptLine(
  isMyTurn: boolean,
  hasStagedTiles: boolean,
  canPlayWord: boolean,
): string {
  if (!isMyTurn) {
    return 'Their move…'
  }

  if (hasStagedTiles) {
    if (!canPlayWord) {
      return 'Tiles not in a single line.'
    }
    return 'Click Play word to submit, or Clear to undo.'
  }

  return 'Your move.'
}

export function ScrabbleTable({
  code,
  localPlayerId,
  localName,
  publicState,
  myRack,
  connection,
  notice,
  opponentNames,
  opponentColors,
  onPlaceWord,
  onExchange,
  onPass,
  onChallenge,
  onLeave,
}: ScrabbleTableProps) {
  void localName // preserved in props for future wiring (matches RummyTable's identical M4b-deferred pattern)
  const { play, enabled, setEnabled, turnSoundEnabled, setTurnSoundEnabled, playTurnStart } = useSound()
  const [showIntro, setShowIntro] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null)
  const [stagedPlacements, setStagedPlacements] = useState<StagedPlacement[]>([])
  const [blankAssignments, setBlankAssignments] = useState<BlankAssignment[]>([])
  const [blankPrompt, setBlankPrompt] = useState<{ tileId: string } | null>(null)
  const [selectedExchangeTileIds, setSelectedExchangeTileIds] = useState<Set<string>>(new Set())
  const [isExchanging, setIsExchanging] = useState(false)

  const lastPlacementRef = useRef(publicState.lastPlacement)
  const prevStageRef = useRef(publicState.stage)

  // Derived
  const isMyTurn = currentPlayer(publicState.turn) === localPlayerId
  const canAct = isMyTurn && publicState.stage === 'play'
  const opponentIds = publicState.turn.playerOrder.filter((id) => id !== localPlayerId)

  // Deal intro on mount only (when board is empty)
  useEffect(() => {
    const isBoardEmpty = publicState.board.every((row) => row.every((cell) => cell === null))
    if (isBoardEmpty) {
      setShowIntro(true)
    }
  }, [])

  // Turn start sound
  useTurnStartSound(isMyTurn, opponentIds.length, playTurnStart)

  // Clear selection when it's no longer your turn or stage changes
  useEffect(() => {
    if (!isMyTurn || publicState.stage !== 'play') {
      setSelectedTileId(null)
      setStagedPlacements([])
      setBlankAssignments([])
      setBlankPrompt(null)
      setSelectedExchangeTileIds(new Set())
      setIsExchanging(false)
    }
  }, [isMyTurn, publicState.stage])

  // Sound effects
  useEffect(() => {
    const placement = publicState.lastPlacement
    if (placement !== lastPlacementRef.current) {
      lastPlacementRef.current = placement
      if (placement) {
        play('piece-drop')
      }
    }
  }, [publicState.lastPlacement, play])

  useEffect(() => {
    if (prevStageRef.current === 'play' && publicState.stage === 'over') {
      prevStageRef.current = publicState.stage
    } else if (publicState.stage !== prevStageRef.current) {
      prevStageRef.current = publicState.stage
    }
  }, [publicState.stage])

  // Check if staged tiles are in a single line
  const canPlayWord = useMemo(() => {
    if (stagedPlacements.length === 0) return false
    const rows = stagedPlacements.map((p) => p.row)
    const cols = stagedPlacements.map((p) => p.col)
    const singleRow = rows.every((r) => r === rows[0])
    const singleCol = cols.every((c) => c === cols[0])
    return singleRow || singleCol
  }, [stagedPlacements])

  const handleBoardCellClick = useCallback((row: number, col: number) => {
    if (!canAct) return
    if (isExchanging) return

    // If cell is already occupied, can't place
    if (publicState.board[row][col] !== null) return

    // If a tile is selected, place it
    if (selectedTileId !== null) {
      const tile = myRack.find((t) => t.id === selectedTileId)
      if (!tile) return

      // Check if this position is already staged
      if (stagedPlacements.some((p) => p.row === row && p.col === col)) return

      const letter = tile.letter || '' // blank has empty letter
      const newPlacement: StagedPlacement = { tileId: selectedTileId, row, col, letter: letter || 'A' }
      setStagedPlacements([...stagedPlacements, newPlacement])

      // If blank, show assignment overlay
      if (tile.letter === '') {
        setBlankPrompt({ tileId: selectedTileId })
      }

      setSelectedTileId(null)
    }
  }, [canAct, isExchanging, publicState.board, selectedTileId, myRack, stagedPlacements])

  const handleRackTileClick = useCallback((tileId: string) => {
    if (isExchanging) {
      setSelectedExchangeTileIds((prev) => {
        const next = new Set(prev)
        if (next.has(tileId)) {
          next.delete(tileId)
        } else {
          next.add(tileId)
        }
        return next
      })
      return
    }

    if (!canAct) return

    // Check if tile is staged
    const isStaged = stagedPlacements.some((p) => p.tileId === tileId)
    if (isStaged) {
      // Un-stage it
      setStagedPlacements(stagedPlacements.filter((p) => p.tileId !== tileId))
      setBlankAssignments(blankAssignments.filter((a) => a.tileId !== tileId))
      setSelectedTileId(null)
    } else {
      // Select it
      setSelectedTileId((prev) => (prev === tileId ? null : tileId))
    }
  }, [canAct, isExchanging, stagedPlacements, blankAssignments])

  const handlePlayWord = useCallback(() => {
    if (!canPlayWord || stagedPlacements.length === 0) return

    const tiles = stagedPlacements.map((p) => {
      const assignment = blankAssignments.find((a) => a.tileId === p.tileId)
      return {
        tileId: p.tileId,
        row: p.row,
        col: p.col,
        letter: assignment?.letter || p.letter,
      }
    })

    onPlaceWord(tiles)
    setStagedPlacements([])
    setBlankAssignments([])
    setSelectedTileId(null)
  }, [canPlayWord, stagedPlacements, blankAssignments, onPlaceWord])

  const handleClear = useCallback(() => {
    setStagedPlacements([])
    setBlankAssignments([])
    setSelectedTileId(null)
  }, [])

  const handleExchange = useCallback(() => {
    if (selectedExchangeTileIds.size === 0) return
    onExchange(Array.from(selectedExchangeTileIds))
    setSelectedExchangeTileIds(new Set())
    setIsExchanging(false)
  }, [selectedExchangeTileIds, onExchange])

  const handleStartExchange = useCallback(() => {
    setIsExchanging(true)
    setStagedPlacements([])
    setBlankAssignments([])
    setSelectedTileId(null)
  }, [])

  const handleCancelExchange = useCallback(() => {
    setIsExchanging(false)
    setSelectedExchangeTileIds(new Set())
  }, [])

  const canChallenge = useMemo(
    () =>
      publicState.stage === 'play' &&
      publicState.lastPlacement !== null &&
      publicState.lastPlacement.challengeable &&
      publicState.lastPlacement.by !== localPlayerId,
    [publicState.stage, publicState.lastPlacement, localPlayerId],
  )

  const eventLine = useMemo(
    () => computeEventLine(publicState, localPlayerId),
    [publicState, localPlayerId],
  )

  const promptLine = useMemo(
    () =>
      computePromptLine(
        isMyTurn,
        stagedPlacements.length > 0,
        canPlayWord,
      ),
    [isMyTurn, stagedPlacements, canPlayWord],
  )

  // Render the board
  const boardCells = useMemo(() => {
    const cells = []
    for (let row = 0; row < 15; row++) {
      for (let col = 0; col < 15; col++) {
        const cell = publicState.board[row][col]
        const staged = stagedPlacements.find((p) => p.row === row && p.col === col)
        const blank = blankAssignments.find((a) => a.tileId === staged?.tileId)
        const premium = premiumAt(row, col)
        const isCenter = row === 7 && col === 7

        cells.push({ row, col, cell, staged, blank, premium, isCenter })
      }
    }
    return cells
  }, [publicState.board, stagedPlacements, blankAssignments])

  return (
    <div className="scr-table">
      <TableHeader
        gameLabel="Scrabble"
        gameColor={BRAND}
        meta={connection === 'connected' ? `${code} · ${publicState.turn.playerOrder.length} players` : 'connection lost'}
        onRules={() => setRulesOpen(true)}
        onLeave={onLeave}
        enabled={enabled}
        setEnabled={setEnabled}
        turnSoundEnabled={turnSoundEnabled}
        setTurnSoundEnabled={setTurnSoundEnabled}
      />

      {notice && <div className="scr-error-banner">{notice}</div>}

      <div className="scr-table-card">
        {showIntro ? (
          <DealIntro
            others={opponentIds.map((id) => ({
              id,
              name: opponentNames?.[id] ?? 'Opponent',
              color: opponentColors?.[id] ?? BRAND,
              handSize: publicState.handCounts[id] ?? 0,
            }))}
            yourHandSize={myRack.length}
            renderCardBack={(p) => <ScrabbleTileBack {...p} />}
            onComplete={() => setShowIntro(false)}
          />
        ) : (
          <>
            {/* Board (left column on wide viewports) */}
            <div className="scr-board-col">
              <div className="scr-board">
                {boardCells.map(({ row, col, cell, staged, premium, isCenter }) => (
                  <div
                    key={`${row}-${col}`}
                    className={`scr-board-cell${
                      cell || staged ? ' scr-board-cell--occupied' : ''
                    }${!cell && !staged && premium !== 'none' ? ` scr-board-cell--${premium}` : ''}${
                      isCenter ? ' scr-board-cell--center' : ''
                    }`}
                    onClick={() => handleBoardCellClick(row, col)}
                  >
                    {cell || staged ? (
                      <div
                        className={`scr-tile-face${
                          (cell?.isBlank || (staged && myRack.find((t) => t.id === staged.tileId)?.letter === ''))
                            ? ' scr-tile-face--blank'
                            : ''
                        }`}
                      >
                        {(cell?.letter || staged?.letter || '').toUpperCase()}
                        <span className="scr-tile-points">
                          {(() => {
                            if (staged) {
                              const tile = myRack.find((t) => t.id === staged.tileId)
                              return tile?.points ?? 0
                            }
                            return cell?.letter
                              ? LETTER_POINTS[cell.letter] ?? 0
                              : 0
                          })()}
                        </span>
                      </div>
                    ) : (
                      <span className="scr-premium-label">
                        {isCenter ? '' : premium !== 'none' ? premium : ''}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Sidebar (right column on wide viewports): opponents, status, hand, actions */}
            <div className="scr-sidebar">
              <div className="scr-opp-rail">
                {opponentIds.map((oppId) => {
                  const isOppTurn = currentPlayer(publicState.turn) === oppId
                  const oppScore = publicState.scores[oppId] ?? 0
                  const oppRackCount = publicState.handCounts[oppId] ?? 0
                  const oppName = opponentNames?.[oppId] ?? 'Opponent'
                  const oppColor = opponentColors?.[oppId] ?? BRAND

                  return (
                    <div
                      key={oppId}
                      className={`scr-opp-tile${isOppTurn ? ' scr-opp-tile--turn' : ''}`}
                      style={
                        isOppTurn
                          ? {
                              background: oppColor,
                              color: '#fff',
                              borderColor: oppColor,
                            }
                          : {}
                      }
                    >
                      <div className="scr-opp-tile-top">
                        <span className="scr-seat-dot" style={{ background: oppColor }} />
                        <span className="scr-opp-name">{oppName}</span>
                        {isOppTurn && <span className="scr-turn-tag" style={{ background: oppColor }}>Turn</span>}
                      </div>
                      <div className="scr-opp-tile-score">
                        <span className="scr-opp-tile-count">{oppScore} pts · {oppRackCount} tiles</span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Status block */}
              <div className="scr-status-block">
                <div className="scr-status-event">{eventLine}</div>
                <div className="scr-status-prompt">{promptLine}</div>
              </div>

              {/* Hand */}
              <div className="scr-hand-section">
                <div className="scr-hand-header">
                  <div className="scr-hand-label">Your hand</div>
                  <span className="scr-hand-stats">
                    {publicState.scores[localPlayerId] ?? 0} pts · {myRack.length} tiles
                  </span>
                </div>
                <div className="scr-hand-row">
                  {myRack.map((tile) => {
                    const isSelected = selectedTileId === tile.id
                    const isStaged = stagedPlacements.some((p) => p.tileId === tile.id)
                    const isExchangeSelected = selectedExchangeTileIds.has(tile.id)
                    const canSelect = canAct && !isExchanging

                    return (
                      <button
                        key={tile.id}
                        type="button"
                        className={`scr-hand-tile${isSelected ? ' scr-hand-tile--selected' : ''}${
                          tile.letter === '' ? ' scr-hand-tile--blank' : ''
                        }`}
                        onClick={() => handleRackTileClick(tile.id)}
                        style={
                          isExchanging && isExchangeSelected
                            ? { background: 'var(--yellow)', borderColor: 'var(--ink)' }
                            : isStaged
                              ? { opacity: 0.5 }
                              : {}
                        }
                        disabled={isStaged || (!canSelect && !isExchanging) || (isExchanging && !canAct)}
                        aria-label={`${tile.letter || 'blank'} tile${isSelected ? ', selected' : ''}${
                          isStaged ? ', placed' : ''
                        }`}
                      >
                        {(tile.letter || '').toUpperCase()}
                        <span className="scr-hand-tile-points">{tile.points}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Actions */}
              <div className="scr-actions">
          {!isExchanging && stagedPlacements.length > 0 && (
            <>
              <button
                type="button"
                className="btn btn-coral scr-action-btn"
                onClick={handlePlayWord}
                disabled={!canPlayWord || !canAct}
                title={!canPlayWord ? 'Tiles must be in a single row or column' : ''}
              >
                Play word
              </button>
              <button type="button" className="btn scr-action-btn" onClick={handleClear} disabled={!canAct}>
                Clear
              </button>
            </>
          )}

          {!isExchanging && stagedPlacements.length === 0 && canAct && (
            <>
              <button
                type="button"
                className="btn btn-teal scr-action-btn"
                onClick={handleStartExchange}
              >
                Exchange
              </button>
              <button type="button" className="btn scr-action-btn" onClick={onPass}>
                Pass
              </button>
            </>
          )}

          {isExchanging && (
            <>
              <button
                type="button"
                className="btn btn-coral scr-action-btn"
                onClick={handleExchange}
                disabled={selectedExchangeTileIds.size === 0}
              >
                Exchange ({selectedExchangeTileIds.size})
              </button>
              <button type="button" className="btn scr-action-btn" onClick={handleCancelExchange}>
                Cancel
              </button>
            </>
          )}

          {canChallenge && (
            <button type="button" className="btn btn-coral scr-action-btn" onClick={onChallenge}>
              Challenge!
            </button>
          )}
        </div>
            </div>
          </>
        )}
      </div>

      <p className="scr-footnote">Your hand never leaves this device — only the play does.</p>

      {/* Blank assignment overlay */}
      {blankPrompt && (
        <div className="scr-blank-overlay-backdrop" onClick={() => {}}>
          <div className="scr-blank-overlay-panel">
            <h3 className="scr-blank-overlay-title">Assign a letter to your blank</h3>
            <div className="scr-blank-overlay-grid">
              {Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ').map((letter) => (
                <button
                  key={letter}
                  type="button"
                  className="scr-blank-letter-btn"
                  onClick={() => {
                    setBlankAssignments([
                      ...blankAssignments.filter((a) => a.tileId !== blankPrompt.tileId),
                      { tileId: blankPrompt.tileId, letter },
                    ])
                    setBlankPrompt(null)
                  }}
                >
                  {letter}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {rulesOpen && <ScrabbleRulesOverlay onClose={() => setRulesOpen(false)} />}
    </div>
  )
}
