// The friendly entry point: picto.character(...), picto.preset(...), picto.gradient(...).

import { Character } from './character'
import { gradient } from './engine'
import type { CharConfig, CharInput } from './engine'

/** Create a picto from a seed, a string, or an explicit config object. */
export function character(input: CharInput = 0): Character {
  return new Character(input)
}

export interface Preset {
  /** Make a picto with the preset baked in, plus a per-call seed (or a config object to add more locks). */
  character(input?: CharInput): Character
  /** The constraints this preset locks in. */
  readonly config: CharConfig
}

/**
 * Lock in some constraints once (brand color, a fixed shape, allowed sets...) and
 * stamp out many pictos that all obey them. Per-call values win over the preset.
 *
 *   const brand = picto.preset({ color: '#19c37d' })
 *   brand.character(userId)                       // brand body, everything else random per user
 *   brand.character({ seed: userId, mode: 'mono' }) // ...and also lock the mode
 */
export function preset(base: CharConfig): Preset {
  return {
    config: base,
    character(input: CharInput = 0): Character {
      const over: CharConfig = typeof input === 'object' ? input : { seed: input }
      return new Character({ ...base, ...over })
    },
  }
}

export const picto = { character, preset, gradient }
