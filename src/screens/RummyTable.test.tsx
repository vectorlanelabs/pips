// @vitest-environment jsdom
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRummyGame } from '../card-games/rummy/state'
import { RummyTable, type RummyTableProps } from './RummyTable'

// DealIntro's real timing (setTimeout/requestAnimationFrame sequencing) is exercised by its own
// component tests. RummyTable only cares that it renders the intro while `showIntro` is true and
// swaps to the live table once `onComplete` fires — so the mock fires onComplete on mount and lets
// every test exercise the actual table content, not the shared animation.
vi.mock('../components/DealIntro', () => ({
  DealIntro: ({ onComplete }: { onComplete: () => void }) => {
    useEffect(() => { onComplete() }, [])
    return null
  },
}))

const playMock = vi.fn()
vi.mock('../hooks/useSound', () => ({
  useSound: () => ({
    play: playMock,
    enabled: true,
    setEnabled: vi.fn(),
    turnSoundEnabled: true,
    setTurnSoundEnabled: vi.fn(),
    playTurnStart: vi.fn(),
  }),
}))

afterEach(() => {
  cleanup()
  playMock.mockClear()
})

const NAMES = { p1: 'Alice', p2: 'Bob' }
const COLORS = { p1: '#111111', p2: '#222222' }

function baseProps(overrides: Partial<RummyTableProps> = {}): RummyTableProps {
  const { session } = createRummyGame(['p1', 'p2'], 1)
  return {
    code: 'ABCD',
    localPlayerId: 'p1',
    names: NAMES,
    colors: COLORS,
    connection: 'connected',
    notice: null,
    publicState: session.publicState,
    hand: session.privateStates.p1.hand.cards,
    onDrawStock: vi.fn(),
    onDrawDiscard: vi.fn(),
    onLayDownMeld: vi.fn(),
    onLayOffMeld: vi.fn(),
    onDiscard: vi.fn(),
    onLeave: vi.fn(),
    ...overrides,
  }
}

describe('RummyTable', () => {
  it('shows the deal intro then swaps to the live table once it completes', () => {
    render(<RummyTable {...baseProps()} />)
    // The mocked DealIntro fires onComplete synchronously on mount, so by the time
    // render() returns we should already be looking at the live table, not the intro.
    expect(screen.getByText('Your hand')).toBeInTheDocument()
  })

  it("shows 'Your turn' when it's the local player's turn", () => {
    const props = baseProps()
    render(<RummyTable {...props} />)
    expect(screen.getByText('Your turn')).toBeInTheDocument()
  })

  it("shows the opponent's name when it's not the local player's turn", () => {
    const { session } = createRummyGame(['p1', 'p2'], 1)
    // advance the turn to p2
    const publicState = {
      ...session.publicState,
      turn: { ...session.publicState.turn, currentIndex: 1 },
    }
    render(<RummyTable {...baseProps({ publicState, hand: session.privateStates.p1.hand.cards })} />)
    expect(document.querySelector('.rummy-turn-chip')).toHaveTextContent("Bob's turn")
  })

  it('renders a rejection notice banner and plays the error sound when a new notice arrives', () => {
    const { rerender } = render(<RummyTable {...baseProps({ notice: null })} />)
    expect(screen.queryByText('Not your turn.')).not.toBeInTheDocument()

    rerender(<RummyTable {...baseProps({ notice: 'Not your turn.' })} />)
    expect(screen.getByText('Not your turn.')).toBeInTheDocument()
    expect(playMock).toHaveBeenCalledWith('error')
  })

  it('shows the round-over banner naming the round winner and does not show it when the match is over', () => {
    const props = baseProps({
      publicState: {
        ...baseProps().publicState,
        roundOver: true,
        roundWinnerId: 'p1',
        matchWinnerId: null,
      },
    })
    render(<RummyTable {...props} />)
    expect(screen.getByText(/won this round/)).toBeInTheDocument()
    expect(screen.getByText(/Round 2 starts automatically/)).toBeInTheDocument()
  })

  it('shows the blocked-round banner when the round ended with no winner', () => {
    const props = baseProps({
      publicState: {
        ...baseProps().publicState,
        roundOver: true,
        roundWinnerId: null,
        matchWinnerId: null,
      },
    })
    render(<RummyTable {...props} />)
    expect(screen.getByText(/Round blocked, no score/)).toBeInTheDocument()
  })

  it('hides the lay down/discard actions once the round is over', () => {
    const props = baseProps({
      publicState: { ...baseProps().publicState, roundOver: true, roundWinnerId: 'p1' },
    })
    render(<RummyTable {...props} />)
    expect(screen.queryByRole('button', { name: /Discard/ })).not.toBeInTheDocument()
  })

  it('calls onDrawStock when the stock pile is clicked during the draw phase', () => {
    const onDrawStock = vi.fn()
    const props = baseProps({ onDrawStock })
    render(<RummyTable {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stock pile' }))
    expect(onDrawStock).toHaveBeenCalledTimes(1)
  })

  it('calls onLeave when Leave is clicked', () => {
    const onLeave = vi.fn()
    render(<RummyTable {...baseProps({ onLeave })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))
    expect(onLeave).toHaveBeenCalledTimes(1)
  })
})
