import type { DealIntroCardBackProps } from './DealIntro'

export function ScrabbleTileBack({ size, style, className }: DealIntroCardBackProps) {
  const cls = ['scr-tile-back', `scr-tile-back--${size}`, className].filter(Boolean).join(' ')
  return <div className={cls} style={style} />
}
