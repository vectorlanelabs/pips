// Card-back designs, from "Design Handoff/Card Back Designs.dc.html" — 20 image-based
// backs, each a .webp in src/assets/cardbacks/. The chosen id travels over the wire in
// game state, so it's a plain string; PlayingCard.tsx's CardBack looks it up here to
// find the image to render.

import colorBlocks from '../assets/cardbacks/color_blocks.webp'
import retroPark from '../assets/cardbacks/retro_park.webp'
import pride from '../assets/cardbacks/pride.webp'
import retro8BitPlatforms from '../assets/cardbacks/retro_8-bit_platforms.webp'
import cozyMagic from '../assets/cardbacks/cozy_magic.webp'
import casinoRed from '../assets/cardbacks/casino_red.webp'
import retro8Bit from '../assets/cardbacks/retro_8-bit.webp'
import casinoBlue from '../assets/cardbacks/casino_blue.webp'
import pipsDefault from '../assets/cardbacks/pips_default.webp'
import woodblock from '../assets/cardbacks/woodblock.webp'
import darkDiamond from '../assets/cardbacks/dark_diamond.webp'
import darkCathedral from '../assets/cardbacks/dark_cathedral.webp'
import pipsRetro from '../assets/cardbacks/pips_retro.webp'
import cathedral from '../assets/cardbacks/cathedral.webp'
import witchyWonders from '../assets/cardbacks/witchy_wonders.webp'
import pipsClassic from '../assets/cardbacks/pips_classic.webp'
import mushroom from '../assets/cardbacks/mushroom.webp'
import stainedGlass from '../assets/cardbacks/stained_glass.webp'
import forest from '../assets/cardbacks/forest.webp'
import darkConfetti from '../assets/cardbacks/dark_confetti.webp'

export interface CardBackDef {
  id: string
  name: string
  image: string
}

export const DEFAULT_CARD_BACK = 'pips_default'

export const CARD_BACKS: CardBackDef[] = [
  { id: 'color_blocks', name: 'Color Blocks', image: colorBlocks },
  { id: 'retro_park', name: 'Retro Park', image: retroPark },
  { id: 'pride', name: 'Pride', image: pride },
  { id: 'retro_8-bit_platforms', name: 'Retro 8-Bit Platforms', image: retro8BitPlatforms },
  { id: 'cozy_magic', name: 'Cozy Magic', image: cozyMagic },
  { id: 'casino_red', name: 'Casino Red', image: casinoRed },
  { id: 'retro_8-bit', name: 'Retro 8-Bit', image: retro8Bit },
  { id: 'casino_blue', name: 'Casino Blue', image: casinoBlue },
  { id: 'pips_default', name: 'Pips Default', image: pipsDefault },
  { id: 'woodblock', name: 'Woodblock', image: woodblock },
  { id: 'dark_diamond', name: 'Dark Diamond', image: darkDiamond },
  { id: 'dark_cathedral', name: 'Dark Cathedral', image: darkCathedral },
  { id: 'pips_retro', name: 'Pips Retro', image: pipsRetro },
  { id: 'cathedral', name: 'Cathedral', image: cathedral },
  { id: 'witchy_wonders', name: 'Witchy Wonders', image: witchyWonders },
  { id: 'pips_classic', name: 'Pips Classic', image: pipsClassic },
  { id: 'mushroom', name: 'Mushroom', image: mushroom },
  { id: 'stained_glass', name: 'Stained Glass', image: stainedGlass },
  { id: 'forest', name: 'Forest', image: forest },
  { id: 'dark_confetti', name: 'Dark Confetti', image: darkConfetti },
]
