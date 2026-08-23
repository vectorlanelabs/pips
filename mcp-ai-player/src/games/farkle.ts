import { z } from 'zod'
import type { Action, RoomState } from '../../../src/types.js'

// The Farkle slice of RoomState.Action (../../../src/types.ts:182-185),
// duplicated as a zod schema so submit_move can validate before sending —
// see registry.ts for how a second game plugs in alongside this one.
export const farkleMoveSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('farkleRoll') }),
  z.object({ type: z.literal('farkleToggle'), dieId: z.number() }),
  z.object({ type: z.literal('farkleBank') }),
  z.object({ type: z.literal('farkleEndTurn') }),
])

export type FarkleMove = z.infer<typeof farkleMoveSchema>

export function parseFarkleMove(input: unknown): Action {
  return farkleMoveSchema.parse(input)
}

export function trimFarkleState(room: RoomState, seatId: string) {
  const seatIdx = room.seats.findIndex((s) => s.id === seatId)
  return {
    screen: room.screen,
    yourTurn: room.screen === 'farkle' && seatIdx === room.turnIdx,
    turnOrder: room.seats.map((s) => ({ id: s.id, name: s.name, score: s.score })),
    dice: room.farkle.dice.map((d) => ({ id: d.id, val: d.val, kept: d.sel })),
    turnScore: room.farkle.turnScore,
    farkled: room.farkle.farkle,
    finalRound: room.farkle.finalRound,
    status: room.farkle.status,
    winningScore: room.farkle.winningScore,
    openingScore: room.farkle.openingScore,
    log: room.farkle.log.slice(-10),
  }
}
