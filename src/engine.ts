// Generation engine: derive the asset catalog from PARTS, build palettes,
// recolor + compose an SVG, and resolve a seed or config into a concrete spec.
// Framework-agnostic — no React, no DOM. Ported from the original lab.

import { PARTS } from './parts'
import { anchorOf, arc, hexToOklch, oklchToHex, stopsOf } from './color'
import { hashSeed, mulberry32 } from './rng'

// ---------------- catalog (derived from the bundled parts) ----------------

/** Artist body colors, e.g. "blue", "pink". */
export const COLORS = [...new Set(Object.keys(PARTS.bodies).map((k) => k.split('_')[0]))].sort()
/** Body shape variants, "1".."4". */
export const SHAPES = [...new Set(Object.keys(PARTS.bodies).map((k) => k.split('_')[1]))].sort()
/** Background keys, "1".."5". */
export const BGS = Object.keys(PARTS.backgrounds).sort()

const PUPILS: Record<string, number> = { single: 1, double: 2, triple: 3 }

function byPrefix(o: Record<string, string>): Record<string, string[]> {
  const d: Record<string, string[]> = {}
  Object.keys(o)
    .sort()
    .forEach((k) => {
      ;(d[k.split('_')[0]] ??= []).push(k)
    })
  return d
}
export const EYE_FILES = byPrefix(PARTS.eyes)
export const BROW_FILES = byPrefix(PARTS.eyebrows)
/** Eye kinds that have both eyes and matching eyebrows: "single" | "double" | "triple". */
export const PREFIXES = Object.keys(EYE_FILES).filter((p) => BROW_FILES[p]).sort()

// ---------------- palette (anchors + generated hues) ----------------

export interface PalEntry {
  name: string
  light: string
  dark: string
  gen: boolean
}

// The artist anchors plus `extra` hues interpolated into the widest hue gaps,
// so generated colors still read as hand-tuned.
export function buildPalette(selColors: string[], extra: number): PalEntry[] {
  const anchors = selColors.map((c) => ({ name: c, ...anchorOf(PARTS.bodies[c + '_' + SHAPES[0]]) }))
  const pal: PalEntry[] = anchors.map((a) => ({ name: a.name, light: a.light, dark: a.dark, gen: false }))
  if (anchors.length >= 2 && extra > 0) {
    const ring = [...anchors].sort((a, b) => a.p[2] - b.p[2])
    const gaps = ring
      .map((a, i) => {
        const b = ring[(i + 1) % ring.length]
        return { span: (((b.p[2] - a.p[2]) % 360) + 360) % 360, i }
      })
      .sort((x, y) => y.span - x.span)
    for (let n = 0; n < extra; n++) {
      const { i } = gaps[n % gaps.length]
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const reps = gaps.filter((_, k) => gaps[k % gaps.length].i === i && k < extra).length || 1
      const seq = (() => {
        let c = 0
        for (let k = 0; k <= n; k++) if (gaps[k % gaps.length].i === i) c++
        return c
      })()
      const t = seq / (reps + 1)
      const L = a.p[0] + (b.p[0] - a.p[0]) * t
      const C = a.p[1] + (b.p[1] - a.p[1]) * t
      const H = (((a.p[2] + arc(b.p[2] - a.p[2]) * t) % 360) + 360) % 360
      const dL = a.p[3] + (b.p[3] - a.p[3]) * t
      const dC = a.p[4] + (b.p[4] - a.p[4]) * t
      const dH = a.p[5] + arc(b.p[5] - a.p[5]) * t
      pal.push({
        name: 'gen' + Math.round(H),
        light: oklchToHex(L, C, H),
        dark: oklchToHex(L + dL, Math.max(0, C + dC), H + dH),
        gen: true,
      })
    }
  }
  return pal
}

// Interpolate a single arbitrary hue (deg) into the anchor envelope -> {light, dark}.
function hueEntry(hue: number): { light: string; dark: string } {
  const anchors = COLORS.map((c) => ({ name: c, ...anchorOf(PARTS.bodies[c + '_' + SHAPES[0]]) })).sort(
    (a, b) => a.p[2] - b.p[2],
  )
  hue = ((hue % 360) + 360) % 360
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]
    const b = anchors[(i + 1) % anchors.length]
    const lo = a.p[2]
    const hi = b.p[2] < a.p[2] ? b.p[2] + 360 : b.p[2]
    const h = hue < lo ? hue + 360 : hue
    if (h >= lo && h <= hi) {
      const t = (h - lo) / (hi - lo || 1)
      const L = a.p[0] + (b.p[0] - a.p[0]) * t
      const C = a.p[1] + (b.p[1] - a.p[1]) * t
      const dL = a.p[3] + (b.p[3] - a.p[3]) * t
      const dC = a.p[4] + (b.p[4] - a.p[4]) * t
      const dH = a.p[5] + arc(b.p[5] - a.p[5]) * t
      return { light: oklchToHex(L, C, hue), dark: oklchToHex(L + dL, Math.max(0, C + dC), hue + dH) }
    }
  }
  const a = anchors[0]
  return { light: a.light, dark: a.dark }
}

// ---------------- recolor / compose ----------------

// Prefix every id (and url(#id) ref) so multiple composed SVGs can share a DOM
// without their filters/gradients colliding.
function nsIds(svg: string, pfx: string): string {
  for (const id of new Set([...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1])))
    svg = svg.split(`id="${id}"`).join(`id="${pfx}${id}"`).split(`url(#${id})`).join(`url(#${pfx}${id})`)
  return svg
}
const innerSVG = (svg: string) => svg.replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')

function recolorBody(shapeSvg: string, light: string, dark: string): string {
  const st = stopsOf(shapeSvg)
  const L = st.reduce((a, b) => (hexToOklch(b)[0] > hexToOklch(a)[0] ? b : a))
  const D = st.reduce((a, b) => (hexToOklch(b)[0] < hexToOklch(a)[0] ? b : a))
  return shapeSvg
    .split(`stop-color="${L}"`)
    .join(`stop-color="${light}"`)
    .split(`stop-color="${D}"`)
    .join(`stop-color="${dark}"`)
}

export interface Tuning {
  /** feature (outline) lightness, 10..45 */
  featL: number
  /** feature tint chroma, 0..12 */
  featC: number
  /** lit pupil lightness, 60..95 */
  litL: number
  /** pupil chroma, 4..22 */
  pupC: number
}
export const DEFAULT_TUNING: Tuning = { featL: 26, featC: 4, litL: 84, pupC: 13 }

const featureDark = (hue: number, cfg: Tuning) => oklchToHex(cfg.featL / 100, cfg.featC / 100, hue)

function elemMinX(el: string): number {
  const m = el.match(/d="M(-?\d+(?:\.\d+)?)/) || el.match(/<rect[^>]*x="(-?\d+(?:\.\d+)?)"/)
  return m ? +m[1] : 20
}
// Which pupil group an element belongs to, by its x position, for k eyes.
const groupOf = (x: number, k: number) =>
  k === 1 ? 0 : k === 2 ? (x < 20 ? 0 : 1) : x < 17 ? 0 : x < 24 ? 1 : 2

function recolorEyes(svg: string, k: number, mode: string, bodyH: number, feat: string, cfg: Tuning): string {
  if (mode === 'mono') return svg.split('fill="#282B2D"').join(`fill="${feat}"`)
  let hues: Record<number, number>
  if (mode === 'hetero')
    hues = k === 3 ? { 0: bodyH, 1: (bodyH + 180) % 360, 2: bodyH } : { 0: bodyH, 1: (bodyH + 180) % 360 }
  else hues = { 0: bodyH, 1: (bodyH + 120) % 360, 2: (bodyH + 240) % 360 }
  const lit: Record<number, string> = {}
  const shd: Record<number, string> = {}
  for (const gk of Object.keys(hues)) {
    const g = Number(gk)
    lit[g] = oklchToHex(cfg.litL / 100, cfg.pupC / 100, hues[g])
    shd[g] = oklchToHex(0.52, cfg.pupC / 100, hues[g])
  }
  return svg.replace(/<(?:path|rect)\b[^>]*\/>/g, (el) => {
    if (el.includes('fill="#282B2D"')) return el.split('fill="#282B2D"').join(`fill="${feat}"`)
    const g = groupOf(elemMinX(el), k)
    if (el.includes('fill="white"')) return el.split('fill="white"').join(`fill="${lit[g]}"`)
    if (el.includes('fill="#222128"')) return el.split('fill="#222128"').join(`fill="${shd[g]}"`)
    return el
  })
}

const recolorBrows = (svg: string, feat: string) => svg.split('fill="#2F282B"').join(`fill="${feat}"`)

export interface ComposeArgs {
  light: string
  dark: string
  shape: string
  bg: string
  eye: string
  brow: string
  mode: string
  tuning: Tuning
  uid: string
  background: boolean
}

// Assemble background + recolored body/eyes/brows into one <svg> string.
// The animatable groups are .char (body+eyes+brows) and .eyes (just the eyes).
export function compose(a: ComposeArgs): string {
  const bodyH = hexToOklch(a.light)[2]
  const feat = featureDark(hexToOklch(a.dark)[2], a.tuning)
  const k = PUPILS[a.eye.split('_')[0]]
  const body = innerSVG(nsIds(recolorBody(PARTS.bodies[COLORS[0] + '_' + a.shape], a.light, a.dark), a.uid + 'b_'))
  const eyes = innerSVG(nsIds(recolorEyes(PARTS.eyes[a.eye], k, a.mode, bodyH, feat, a.tuning), a.uid + 'e_'))
  const wb = innerSVG(nsIds(recolorBrows(PARTS.eyebrows[a.brow], feat), a.uid + 'w_'))
  const back = a.background ? innerSVG(nsIds(PARTS.backgrounds[a.bg], a.uid + 'g_')) : ''
  return (
    `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">` +
    `${back}<g class="char">${body}<g class="eyes">${eyes}</g>${wb}</g></svg>`
  )
}

// ---------------- config + resolution ----------------

export type Mode = 'mono' | 'hetero' | 'triad'
export type EyeKind = 'single' | 'double' | 'triple'

/**
 * A constraint value. Three ways to use any field:
 *  - omit it           -> fully random (picked from the seed)
 *  - one value         -> locked to that value
 *  - an array of values -> random, but only from that set (picked from the seed)
 */
export type OneOrMany<T> = T | readonly T[]

export interface CharConfig {
  /** Explicit seed. Omit to derive a stable seed from the other fields. */
  seed?: number | string
  /**
   * Body color. An anchor name ("blue"), OR a brand hex ("#19c37d") which gets a
   * matching darker shade auto-generated. Array = pick one at random.
   */
  color?: OneOrMany<string>
  /** Body hue in degrees. Array = pick one. Used when `color` is absent. */
  hue?: OneOrMany<number>
  /** Explicit gradient stops. Full manual lock, wins over color/hue. */
  light?: string
  dark?: string
  /** Body shape, 1..4. Array = pick one. */
  shape?: OneOrMany<number | string>
  /** Eye kind. Array = pick one. */
  eyes?: OneOrMany<EyeKind>
  /** Exact eye file key, e.g. "double_2" (implies `eyes`). Array = pick one. */
  eye?: OneOrMany<string>
  /** Exact eyebrow file key. Array = pick one. */
  brow?: OneOrMany<string>
  /** Background, 1..5. Array = pick one. */
  bg?: OneOrMany<number | string>
  /** Eye coloring mode. Array = pick one. Invalid combos fall back to "mono". */
  mode?: OneOrMany<Mode>
  /** OKLCH fine-tuning overrides. */
  tuning?: Partial<Tuning>
  /** Generated-hue variety for seeded picks (default 8). */
  genHues?: number
}

export type CharInput = number | string | CharConfig

/** A fully-resolved, concrete character spec. */
export interface Resolved {
  color: string
  light: string
  dark: string
  shape: string
  eyes: EyeKind
  eye: string
  brow: string
  bg: string
  mode: Mode
  hue: number
  tuning: Tuning
}

function stableHash(cfg: CharConfig): number {
  return hashSeed(JSON.stringify(cfg))
}

const isHex = (s: string) => /^#?[0-9a-fA-F]{6}$/.test(s)

// The anchor whose hue is closest to H, for borrowing a tasteful light->dark delta.
function nearestAnchorByHue(H: number) {
  return COLORS.map((c) => anchorOf(PARTS.bodies[c + '_' + SHAPES[0]])).reduce((m, x) =>
    Math.abs(arc(x.p[2] - H)) < Math.abs(arc(m.p[2] - H)) ? x : m,
  )
}

// Turn one brand hex into a {light, dark} gradient: the hex is the light stop, the
// dark stop borrows the lightness/chroma/hue drop of the nearest artist color.
function deriveGradient(hex: string): { light: string; dark: string } {
  const light = hex[0] === '#' ? hex : '#' + hex
  const [L, C, H] = hexToOklch(light)
  const a = nearestAnchorByHue(H)
  return { light, dark: oklchToHex(L + a.p[3], Math.max(0, C + a.p[4]), H + a.p[5]) }
}

/**
 * Build a body gradient from a single brand color (hex) or a hue (degrees).
 * Handy for inspecting or reusing what `color: '#hex'` would produce.
 */
export function gradient(input: string | number): { light: string; dark: string } {
  return typeof input === 'number' ? hueEntry(input) : deriveGradient(input)
}

// Turn a seed, string, or config object into a concrete Resolved spec.
// Provided fields win; everything else is filled deterministically from the seed.
export function resolve(input: CharInput): Resolved {
  const cfg: CharConfig = typeof input === 'object' ? input : { seed: input }
  const seed = hashSeed(cfg.seed ?? (typeof input === 'object' ? stableHash(cfg) : 0))
  const rnd = mulberry32(seed)
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]
  // resolve a constraint: undefined -> fallback (random), array -> pick from set, value -> locked
  const pickOne = <T,>(v: OneOrMany<T> | undefined, fallback: () => T): T =>
    v === undefined ? fallback() : Array.isArray(v) ? (v.length ? pick(v) : fallback()) : (v as T)

  const palette = buildPalette(COLORS, cfg.genHues ?? 8)

  // eye kind ("prefix") — weighted toward double, then triple, then single
  const weights: Record<string, number> = { single: 1, double: 9, triple: 4 }
  const prefixPool: string[] = []
  PREFIXES.forEach((p) => {
    for (let i = 0; i < (weights[p] || 0); i++) prefixPool.push(p)
  })
  const pickPrefix = (): EyeKind => (prefixPool.length ? pick(prefixPool) : PREFIXES[0]) as EyeKind

  // eyes / eye file / eyebrow (an exact `eye` decides the kind)
  let eyes: EyeKind
  let eye: string
  if (cfg.eye !== undefined) {
    eye = pickOne(cfg.eye, () => pick(EYE_FILES[pickPrefix()]))
    if (!PARTS.eyes[eye]) eye = pick(EYE_FILES[pickPrefix()])
    eyes = eye.split('_')[0] as EyeKind
  } else {
    eyes = pickOne(cfg.eyes, pickPrefix)
    if (!EYE_FILES[eyes]) eyes = PREFIXES[0] as EyeKind
    eye = pick(EYE_FILES[eyes])
  }
  let brow = pickOne(cfg.brow, () => pick(BROW_FILES[eyes]))
  if (!PARTS.eyebrows[brow]) brow = pick(BROW_FILES[eyes])

  let shape = String(pickOne(cfg.shape, () => pick(SHAPES)))
  if (!SHAPES.includes(shape)) shape = pick(SHAPES)
  let bg = String(pickOne(cfg.bg, () => pick(BGS)))
  if (!BGS.includes(bg)) bg = pick(BGS)

  // body palette — manual stops win, then color (name or hex), then hue, then random
  let light: string
  let dark: string
  let colorName: string
  if (cfg.light && cfg.dark) {
    light = cfg.light
    dark = cfg.dark
    colorName = typeof cfg.color === 'string' ? cfg.color : 'custom'
  } else if (cfg.color !== undefined) {
    const c = pickOne(cfg.color, () => pick(palette).name)
    if (isHex(c)) {
      const g = deriveGradient(c)
      light = g.light
      dark = g.dark
      colorName = 'custom'
    } else if (PARTS.bodies[c + '_' + SHAPES[0]]) {
      const a = anchorOf(PARTS.bodies[c + '_' + SHAPES[0]])
      light = a.light
      dark = a.dark
      colorName = c
    } else {
      const pe = pick(palette)
      light = pe.light
      dark = pe.dark
      colorName = pe.name
    }
  } else if (cfg.hue !== undefined) {
    const h = pickOne(cfg.hue, () => Math.round(hexToOklch(pick(palette).light)[2]))
    const g = hueEntry(h)
    light = g.light
    dark = g.dark
    colorName = 'hue' + Math.round(((h % 360) + 360) % 360)
  } else {
    const pe = pick(palette)
    light = pe.light
    dark = pe.dark
    colorName = pe.name
  }

  // mode — only what the eye count supports
  const k = PUPILS[eyes]
  const avail: Mode[] = ['mono']
  if (k >= 2) avail.push('hetero')
  if (k === 3) avail.push('triad')
  let mode: Mode = pickOne(cfg.mode, () =>
    avail.length > 1 && rnd() < 0.5 ? pick(avail.slice(1)) : 'mono',
  )
  if (!avail.includes(mode)) mode = 'mono'

  const tuning: Tuning = { ...DEFAULT_TUNING, ...cfg.tuning }
  const hue = Math.round(hexToOklch(light)[2])
  return { color: colorName, light, dark, shape, eyes, eye, brow, bg, mode, hue, tuning }
}
