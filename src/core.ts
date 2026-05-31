// Framework-agnostic entry point. Import this path when you want SVG strings,
// seeded characters, or catalog helpers without loading React.

export { picto, character, preset } from './picto'
export type { Preset } from './picto'
export { Character } from './character'
export type { AnimName, AnimEvent, SvgOptions } from './character'

export {
  COLORS,
  SHAPES,
  BGS,
  PREFIXES,
  DEFAULT_TUNING,
  compose,
  layers,
  contentBox,
  resolve,
  buildPalette,
  gradient,
  ZZZ,
} from './engine'
export type {
  CharInput,
  CharConfig,
  Resolved,
  Tuning,
  Mode,
  EyeKind,
  OneOrMany,
  PalEntry,
  ComposeArgs,
  Variant,
  PictoLayers,
  LayerBox,
  ContentBox,
} from './engine'
export { mulberry32, hashSeed } from './rng'

export { PARTS } from './parts'
export type { Parts } from './parts'
