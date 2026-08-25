// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { RummyPublicState } from '../card-games/rummy/state'
import { RummyResults, type RummyResultsProps } from './RummyResults'
import { createTurnState } from '../engine/turn-engine'

const playMock = vi.fn()
vi.mock('../hooks/useSound', () => ({
  useSound: () => ({ play: playMock }),
}))

afterEach(() => {
  cleanup()
  playMock.mockClear()
})

const NAMES = { p1: 'Alice', p2: 'Bob' }
const COLORS = { p1: '#111111', p2: '#222222' }

function publicState(overrides: Partial<RummyPublicState> = {}): RummyPublicState {
  return {
    turn: createTurnState(['p1', 'p2'], 'draw'),
    seatOrder: ['p1', 'p2'],
    discardPile: { id: 'discard', visibility: 'public', ownerId: null, cards: [] },
    stockCount: 0,
    melds: { p1: [], p2: [] },
    layoffs: [],
    obligatedCardId: null,
    scores: { p1: 500, p2: 320 },
    target: 500,
    roundNumber: 3,
    roundOver: true,
    roundWinnerId: 'p1',
    matchWinnerId: 'p1',
    handCounts: { p1: 0, p2: 5 },
    cardBack: 'pips_default',
    ...overrides,
  }
}

function baseProps(overrides: Partial<RummyResultsProps> = {}): RummyResultsProps {
  return {
    localPlayerId: 'p1',
    localName: 'Alice',
    names: NAMES,
    colors: COLORS,
    publicState: publicState(),
    isHost: true,
    notice: null,
    onRematch: vi.fn(),
    onBackToShelf: vi.fn(),
    ...overrides,
  }
}

describe('RummyResults', () => {
  it('renders nothing when the match is not yet over', () => {
    const { container } = render(
      <RummyResults {...baseProps({ publicState: publicState({ matchWinnerId: null }) })} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(playMock).not.toHaveBeenCalled()
  })

  it("shows 'You win!' and plays the win cue for the local winner", () => {
    render(<RummyResults {...baseProps({ localPlayerId: 'p1' })} />)
    expect(screen.getByText('You win!')).toBeInTheDocument()
    expect(playMock).toHaveBeenCalledWith('game-win')
  })

  it("shows the winner's name and does NOT play the win cue for the local loser", () => {
    render(<RummyResults {...baseProps({ localPlayerId: 'p2' })} />)
    expect(screen.getByText('Alice wins!')).toBeInTheDocument()
    expect(playMock).not.toHaveBeenCalled()
  })

  it('ranks players by score, descending', () => {
    render(<RummyResults {...baseProps()} />)
    const names = screen.getAllByText(/Alice|Bob/).map((el) => el.textContent)
    expect(names.indexOf('Alice')).toBeLessThan(names.indexOf('Bob'))
  })

  it('shows the rematch button for the host and clicking it calls onRematch', () => {
    const onRematch = vi.fn()
    render(<RummyResults {...baseProps({ isHost: true, onRematch })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Again' }))
    expect(onRematch).toHaveBeenCalledTimes(1)
  })

  it('hides the rematch button and shows a waiting message for a guest', () => {
    render(<RummyResults {...baseProps({ isHost: false })} />)
    expect(screen.queryByRole('button', { name: 'Again' })).not.toBeInTheDocument()
    expect(screen.getByText(/Waiting for the host/)).toBeInTheDocument()
  })

  it('renders a notice banner when present', () => {
    render(<RummyResults {...baseProps({ notice: 'Connection restored.' })} />)
    expect(screen.getByText('Connection restored.')).toBeInTheDocument()
  })
})
