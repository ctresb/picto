// The friendly entry point: `picto.character(seed)` or `picto.character({...})`.

import { Character } from './character'
import type { CharInput } from './engine'

/** Create a character from a seed, a string, or an explicit config object. */
export function character(input: CharInput = 0): Character {
  return new Character(input)
}

export const picto = { character }
