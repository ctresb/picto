// picto — tiny React library for procedural SVG characters.

export { picto, character } from './picto'
export { Character } from './character'
export type { AnimName, AnimEvent, SvgOptions } from './character'

export { Picto } from './react'
export type { PictoProps } from './react'

// engine: catalog + types for advanced / framework-agnostic use
export { COLORS, SHAPES, BGS, PREFIXES, DEFAULT_TUNING, compose, resolve, buildPalette } from './engine'
export type { CharInput, CharConfig, Resolved, Tuning, Mode, EyeKind, PalEntry, ComposeArgs } from './engine'
export { mulberry32, hashSeed } from './rng'

export { PARTS } from './parts'
export type { Parts } from './parts'
