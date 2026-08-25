// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RummyRoom, type RummyRoomProps } from './RummyRoom'

afterEach(cleanup)

function baseProps(overrides: Partial<RummyRoomProps> = {}): RummyRoomProps {
  return {
    code: 'WXYZ',
    localName: 'Alice',
    isHost: true,
    seats: [{ name: 'Alice', isBot: false, isHost: true }],
    notice: null,
    cardBack: 'pips_default',
    onSelectCardBack: vi.fn(),
    onAddHouseBot: vi.fn(),
    onStartGame: vi.fn(),
    onLeave: vi.fn(),
    ...overrides,
  }
}

describe('RummyRoom', () => {
  it('shows the room code', () => {
    render(<RummyRoom {...baseProps()} />)
    expect(screen.getByText('WXYZ')).toBeInTheDocument()
  })

  it('shows host controls, disabling Start game below the seat minimum', () => {
    render(<RummyRoom {...baseProps({ seats: [{ name: 'Alice', isBot: false, isHost: true }] })} />)
    expect(screen.getByRole('button', { name: 'Start game' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add house bot' })).toBeEnabled()
  })

  it('enables Start game once the seat minimum is met and calls onStartGame', () => {
    const onStartGame = vi.fn()
    render(
      <RummyRoom
        {...baseProps({
          seats: [
            { name: 'Alice', isBot: false, isHost: true },
            { name: 'Bot 1', isBot: true, isHost: false },
          ],
          onStartGame,
        })}
      />,
    )
    const startBtn = screen.getByRole('button', { name: 'Start game' })
    expect(startBtn).toBeEnabled()
    fireEvent.click(startBtn)
    expect(onStartGame).toHaveBeenCalledTimes(1)
  })

  it('shows a waiting message instead of host controls for a guest', () => {
    render(<RummyRoom {...baseProps({ isHost: false })} />)
    expect(screen.queryByRole('button', { name: 'Start game' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add house bot' })).not.toBeInTheDocument()
    expect(screen.getByText(/Waiting for .* to start/)).toBeInTheDocument()
  })

  it('renders seat chips for host and bot seats, and open seats for empty slots', () => {
    render(
      <RummyRoom
        {...baseProps({
          seats: [
            { name: 'Alice', isBot: false, isHost: true },
            { name: 'Bot 1', isBot: true, isHost: false },
          ],
        })}
      />,
    )
    expect(screen.getByText('Host')).toBeInTheDocument()
    expect(screen.getByText('House bot')).toBeInTheDocument()
    expect(screen.getAllByText('Open seat')).toHaveLength(2) // 4-seat max, 2 filled
  })

  it('renders a notice banner when present', () => {
    render(<RummyRoom {...baseProps({ notice: 'A player disconnected.' })} />)
    expect(screen.getByText('A player disconnected.')).toBeInTheDocument()
  })

  it('calls onLeave when Leave is clicked', () => {
    const onLeave = vi.fn()
    render(<RummyRoom {...baseProps({ onLeave })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))
    expect(onLeave).toHaveBeenCalledTimes(1)
  })
})
