// picto — tiny React library for procedural SVG characters.

export * from './core'
export { Picto } from './react'
export type { PictoProps } from './react'

// Batch canvas renderer (high-perf path for hundreds-to-thousands of pictos).
export { PictoField } from './react-canvas'
export type { PictoFieldProps, PictoPosition } from './react-canvas'
export { createPictoRenderer, canvasSupported } from './canvas'
export type { PictoRenderer, PictoItem, ViewportRect, AnimTarget, RendererOptions } from './canvas'
