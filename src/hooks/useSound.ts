import { useCallback, useState } from 'react'
import diceRoll from '../assets/sounds/dice-roll.mp3'
import dieSelect from '../assets/sounds/die-select.mp3'
import turnStart from '../assets/sounds/turn-start.mp3'
import drawnX from '../assets/sounds/drawn-x.mp3'
import drawnCircle from '../assets/sounds/drawn-circle.mp3'
import pieceDrop from '../assets/sounds/piece-drop.mp3'
import farkleBust from '../assets/sounds/farkle-bust.mp3'
import bankPoints from '../assets/sounds/bank-points.mp3'
import hotDice from '../assets/sounds/hot-dice.mp3'
import cardDraw from '../assets/sounds/card-draw.mp3'
import cardPlay from '../assets/sounds/card-play.mp3'
import shuffle from '../assets/sounds/shuffle.mp3'
import letterCorrect from '../assets/sounds/letter-correct.mp3'
import letterWrong from '../assets/sounds/letter-wrong.mp3'
import roundWin from '../assets/sounds/round-win.mp3'
import gameWin from '../assets/sounds/game-win.mp3'
import error from '../assets/sounds/error.mp3'
import shipHit from '../assets/sounds/ship-hit.mp3'
import shipMiss from '../assets/sounds/ship-miss.mp3'
import shipSunk from '../assets/sounds/ship-sunk.mp3'
import dominoesShuffling from '../assets/sounds/dominoes-shuffling.mp3'
import dominoDraw from '../assets/sounds/domino-draw.mp3'
import dominoPlay from '../assets/sounds/domino-play.mp3'
import knock from '../assets/sounds/knock.mp3'
import checkerMove from '../assets/sounds/checker-moving.mp3'
import checkerJump from '../assets/sounds/checker-jumping-over.mp3'
import kingMe from '../assets/sounds/king-me.mp3'
import trainHorn from '../assets/sounds/train-horn.mp3'
import unoCall from '../assets/sounds/uno-call.mp3'
import unoCalledOn from '../assets/sounds/uno-called-on.mp3'
import unoSkip from '../assets/sounds/uno-skip.mp3'
import unoReverse from '../assets/sounds/uno-reverse.mp3'
import unoDraw from '../assets/sounds/uno-draw.mp3'
import unoWild from '../assets/sounds/uno-wild.mp3'
import chipBet from '../assets/sounds/chip-bet.mp3'
import chipWin from '../assets/sounds/chip-win.mp3'
import cardFlip from '../assets/sounds/card-flip.mp3'
import bust from '../assets/sounds/bust.mp3'
import blackjack from '../assets/sounds/blackjack.mp3'
import fold from '../assets/sounds/fold.mp3'
import allIn from '../assets/sounds/all-in.mp3'

export type SoundName =
  | 'dice-roll' | 'die-select' | 'drawn-x' | 'drawn-circle' | 'piece-drop' | 'farkle-bust' | 'bank-points'
  | 'hot-dice' | 'card-draw' | 'card-play' | 'shuffle' | 'letter-correct'
  | 'letter-wrong' | 'round-win' | 'game-win' | 'error' | 'ship-hit' | 'ship-miss' | 'ship-sunk'
  | 'domino-shuffle' | 'domino-draw' | 'domino-play' | 'knock'
  | 'checker-move' | 'checker-jump' | 'king-me'
  | 'train-horn' | 'turn-start'
  | 'uno-call' | 'uno-called-on' | 'uno-skip' | 'uno-reverse' | 'uno-draw' | 'uno-wild'
  | 'chip-bet' | 'chip-win' | 'card-flip' | 'bust' | 'blackjack' | 'fold' | 'all-in'

const SOUND_FILES: Record<SoundName, string> = {
  'dice-roll': diceRoll,
  'die-select': dieSelect,
  'drawn-x': drawnX,
  'drawn-circle': drawnCircle,
  'piece-drop': pieceDrop,
  'farkle-bust': farkleBust,
  'bank-points': bankPoints,
  'hot-dice': hotDice,
  'card-draw': cardDraw,
  'card-play': cardPlay,
  'shuffle': shuffle,
  'letter-correct': letterCorrect,
  'letter-wrong': letterWrong,
  'round-win': roundWin,
  'game-win': gameWin,
  'error': error,
  'ship-hit': shipHit,
  'ship-miss': shipMiss,
  'ship-sunk': shipSunk,
  'domino-shuffle': dominoesShuffling,
  'domino-draw': dominoDraw,
  'domino-play': dominoPlay,
  'knock': knock,
  'checker-move': checkerMove,
  'checker-jump': checkerJump,
  'king-me': kingMe,
  'train-horn': trainHorn,
  'turn-start': turnStart,
  'uno-call': unoCall,
  'uno-called-on': unoCalledOn,
  'uno-skip': unoSkip,
  'uno-reverse': unoReverse,
  'uno-draw': unoDraw,
  'uno-wild': unoWild,
  'chip-bet': chipBet,
  'chip-win': chipWin,
  'card-flip': cardFlip,
  'bust': bust,
  'blackjack': blackjack,
  'fold': fold,
  'all-in': allIn,
}

const COOKIE_NAME = 'pips-sound'
const TURN_COOKIE_NAME = 'pips-turn-sound'

function readCookie(name: string): boolean {
  if (typeof document === 'undefined') return true
  const match = document.cookie.split('; ').find((row) => row.startsWith(`${name}=`))
  if (!match) return true
  return match.split('=')[1] === 'on'
}

function writeCookie(name: string, value: boolean): void {
  document.cookie = `${name}=${value ? 'on' : 'off'}; path=/; max-age=31536000; samesite=lax`
}

export function useSound() {
  const [enabled, setEnabledState] = useState<boolean>(() => readCookie(COOKIE_NAME))
  const [turnSoundEnabled, setTurnSoundEnabledState] = useState<boolean>(() => readCookie(TURN_COOKIE_NAME))

  const setEnabled = useCallback((value: boolean) => {
    writeCookie(COOKIE_NAME, value)
    setEnabledState(value)
  }, [])

  const setTurnSoundEnabled = useCallback((value: boolean) => {
    writeCookie(TURN_COOKIE_NAME, value)
    setTurnSoundEnabledState(value)
  }, [])

  const play = useCallback((name: SoundName) => {
    if (!enabled) return
    const audio = new Audio(SOUND_FILES[name])
    void audio.play().catch(() => {})
  }, [enabled])

  // Separate gate from `play`: the master toggle still blocks it (enabled), but
  // it also respects its own independent toggle — see TurnSoundToggle.
  const playTurnStart = useCallback(() => {
    if (!enabled || !turnSoundEnabled) return
    const audio = new Audio(SOUND_FILES['turn-start'])
    void audio.play().catch(() => {})
  }, [enabled, turnSoundEnabled])

  return { enabled, setEnabled, turnSoundEnabled, setTurnSoundEnabled, play, playTurnStart }
}
