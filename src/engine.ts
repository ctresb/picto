// Generation engine: derive the asset catalog from PARTS, build palettes,
// recolor + compose an SVG, and resolve a seed or config into a concrete spec.
// Framework-agnostic — no React, no DOM. Ported from the original lab.

import { PARTS } from './parts'
import { anchorOf, arc, hexToOklch, oklchToHex, stopsOf } from './color'
import type { Anchor } from './color'
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

// Body anchors (COLORS x SHAPES[0]) are a pure function of the constant body SVG
// strings, but were recomputed in four hot paths. Memoize per body-part key.
const ANCHOR_CACHE = new Map<string, Anchor>()
function anchorFor(color: string): Anchor {
  const key = color + '_' + SHAPES[0]
  let a = ANCHOR_CACHE.get(key)
  if (!a) {
    a = anchorOf(PARTS.bodies[key])
    ANCHOR_CACHE.set(key, a)
  }
  return a
}

// ---------------- palette (anchors + generated hues) ----------------

export interface PalEntry {
  name: string
  light: string
  dark: string
  gen: boolean
}

// The artist anchors plus `extra` hues interpolated into the widest hue gaps,
// so generated colors still read as hand-tuned.
// Pure over (selColors, extra) given the constant PARTS/SHAPES, so the public
// entry point memoizes the whole result by its full input (see below).
function computePalette(selColors: string[], extra: number): PalEntry[] {
  const anchors = selColors.map((c) => ({ name: c, ...anchorFor(c) }))
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

// Memoize buildPalette by its full input. COLORS is a frozen constant and
// genHues defaults to 8, so default constructions hit after the first.
// Returned PalEntry[] is read-only downstream (pick(palette) only reads
// .name/.light/.dark/.gen), so sharing the same array reference is safe.
const PALETTE_CACHE = new Map<string, PalEntry[]>()
export function buildPalette(selColors: string[], extra: number): PalEntry[] {
  const key = selColors.join(',') + '|' + extra
  let p = PALETTE_CACHE.get(key)
  if (!p) {
    p = computePalette(selColors, extra)
    PALETTE_CACHE.set(key, p)
  }
  return p
}

// Interpolate a single arbitrary hue (deg) into the anchor envelope -> {light, dark}.
// Memoized by the normalized hue (mirrors the internal normalization), so two raw
// hues that normalize equal share a result — identical to today's behavior.
const HUE_CACHE = new Map<number, { light: string; dark: string }>()
function hueEntry(hue: number): { light: string; dark: string } {
  hue = ((hue % 360) + 360) % 360
  let r = HUE_CACHE.get(hue)
  if (r) return r
  const anchors = COLORS.map((c) => ({ name: c, ...anchorFor(c) })).sort((a, b) => a.p[2] - b.p[2])
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
      r = { light: oklchToHex(L, C, hue), dark: oklchToHex(L + dL, Math.max(0, C + dC), hue + dH) }
      HUE_CACHE.set(hue, r)
      return r
    }
  }
  const a = anchors[0]
  r = { light: a.light, dark: a.dark }
  HUE_CACHE.set(hue, r)
  return r
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

// The lightest (L) / darkest (D) source stops depend only on the source SVG
// string (a constant per shape), so cache that detection. The actual substitution
// still runs every call with the live target light/dark.
const LD_CACHE = new Map<string, { L: string; D: string }>()
function bodyLD(shapeSvg: string): { L: string; D: string } {
  let r = LD_CACHE.get(shapeSvg)
  if (!r) {
    const st = stopsOf(shapeSvg)
    const L = st.reduce((a, b) => (hexToOklch(b)[0] > hexToOklch(a)[0] ? b : a))
    const D = st.reduce((a, b) => (hexToOklch(b)[0] < hexToOklch(a)[0] ? b : a))
    r = { L, D }
    LD_CACHE.set(shapeSvg, r)
  }
  return r
}

function recolorBody(shapeSvg: string, light: string, dark: string): string {
  const { L, D } = bodyLD(shapeSvg)
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

/** Render style. 'fancy' = full filters + body gradient (default, the original
 * look). 'flat' = no filters, no gradients, solid fills only — far cheaper to
 * paint, so large grids stay smooth while scrolling. */
export type Variant = 'flat' | 'fancy'

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
  variant: Variant
}

// Post-process a fully-composed fancy SVG string into its flat equivalent:
// strip ONLY the BODY gradient + BODY inner-shadow filter — the dominant
// per-paint raster cost — and KEEP the per-pupil eye inner-shadow (e_filter)
// untouched, leaving the body as a solid fill. Body vs eye are distinguished by
// the verified b_ / paint0_radial (body-only) vs e_ (eye-only) id namespacing.
// Running this on the final string keeps every fancy fragment cache and the
// per-uid nsIds untouched (so fancy stays byte-identical), and the surviving
// namespaced background clip id stays correct. Deterministic, validated against
// real compose() output (0 tag-balance issues; body filter/gradient defs+refs
// gone; e_filter eye-shadow refs/defs + bg clipPath preserved). `light` is the
// gradient's lightest stop, so the flat body equals the lightest fancy body pixel.
function flatten(s: string, light: string): string {
  // 1) drop the body <g>'s filter= attr ONLY (leading \s* eats the space). Eye
  //    pupil filter= attrs (e_filter) are left intact.
  s = s.replace(/\s*filter="url\(#[^"]*b_filter[^"]*\)"/g, '')
  // 2) body radial gradient ref -> solid light (paint0_radial is body-only).
  s = s.replace(/fill="url\(#[^"]*paint0_radial_[^"]*\)"/g, `fill="${light}"`)
  // 3) remove the body inner-shadow <filter> def ONLY (matched by its b_filter id);
  //    the two e_filter pupil <filter> defs survive.
  s = s.replace(/<filter\b[^>]*\bid="[^"]*b_filter[^"]*"[\s\S]*?<\/filter>/g, '')
  // 4) remove the body radialGradient def ONLY.
  s = s.replace(/<radialGradient\b[^>]*\bid="[^"]*paint0_radial_[^"]*"[\s\S]*?<\/radialGradient>/g, '')
  // 5) drop a now-empty body <defs>; the bg clipPath <defs> and the eye-filter
  //    <defs> are non-empty so they are preserved.
  s = s.replace(/<defs>\s*<\/defs>/g, '')
  return s
}

// uid-INDEPENDENT recolored inner fragments. The expensive recolor + innerSVG
// work is a pure function of the keyed inputs; only the per-uid id-namespacing
// (nsIds) varies, so it runs per call AFTER the cache lookup. Folding innerSVG
// into the cache is safe: the part root <svg> tag carries no id=/url(# tokens
// (verified), so nsIds never touches what innerSVG strips.
const BODY_FRAG = new Map<string, string>()
const EYES_FRAG = new Map<string, string>()
const BROW_FRAG = new Map<string, string>()
const BG_FRAG = new Map<string, string>()

// Assemble background + recolored body/eyes/brows into one <svg> string.
// The animatable groups are .char (body+eyes+brows) and .eyes (just the eyes).
export function compose(a: ComposeArgs): string {
  const bodyH = hexToOklch(a.light)[2]
  const feat = featureDark(hexToOklch(a.dark)[2], a.tuning)
  const k = PUPILS[a.eye.split('_')[0]]

  const bodyKey = `${a.shape}|${a.light}|${a.dark}`
  let bodyFrag = BODY_FRAG.get(bodyKey)
  if (bodyFrag === undefined) {
    bodyFrag = innerSVG(recolorBody(PARTS.bodies[COLORS[0] + '_' + a.shape], a.light, a.dark))
    BODY_FRAG.set(bodyKey, bodyFrag)
  }

  // bodyH (exact float) and feat (exact hex) fully determine recolorEyes given eye/mode;
  // k is derived from eye so it is covered by eye.
  const eyesKey = `${a.eye}|${a.mode}|${bodyH}|${feat}|${a.tuning.litL}|${a.tuning.pupC}`
  let eyesFrag = EYES_FRAG.get(eyesKey)
  if (eyesFrag === undefined) {
    eyesFrag = innerSVG(recolorEyes(PARTS.eyes[a.eye], k, a.mode, bodyH, feat, a.tuning))
    EYES_FRAG.set(eyesKey, eyesFrag)
  }

  const browKey = `${a.brow}|${feat}`
  let browFrag = BROW_FRAG.get(browKey)
  if (browFrag === undefined) {
    browFrag = innerSVG(recolorBrows(PARTS.eyebrows[a.brow], feat))
    BROW_FRAG.set(browKey, browFrag)
  }

  const body = nsIds(bodyFrag, a.uid + 'b_')
  const eyes = nsIds(eyesFrag, a.uid + 'e_')
  const wb = nsIds(browFrag, a.uid + 'w_')

  let back = ''
  if (a.background) {
    let bgFrag = BG_FRAG.get(a.bg)
    if (bgFrag === undefined) {
      bgFrag = innerSVG(PARTS.backgrounds[a.bg])
      BG_FRAG.set(a.bg, bgFrag)
    }
    back = nsIds(bgFrag, a.uid + 'g_')
  }
  const svg =
    `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">` +
    `${back}<g class="char">${body}<g class="eyes">${eyes}</g>${wb}</g></svg>`
  if (a.variant === 'flat') return flatten(svg, a.light)
  return svg
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
const normalizeHex = (s: string): string | null => (isHex(s) ? (s[0] === '#' ? s : '#' + s).toLowerCase() : null)

// The anchor whose hue is closest to H, for borrowing a tasteful light->dark delta.
function nearestAnchorByHue(H: number) {
  return COLORS.map((c) => anchorFor(c)).reduce((m, x) =>
    Math.abs(arc(x.p[2] - H)) < Math.abs(arc(m.p[2] - H)) ? x : m,
  )
}

// Turn one brand hex into a {light, dark} gradient: the hex is the light stop, the
// dark stop borrows the lightness/chroma/hue drop of the nearest artist color.
// Memoized by the normalized lowercased hex (the only varying input given the
// constant anchors), so repeated color:'#hex' constructions reuse the result.
const GRAD_CACHE = new Map<string, { light: string; dark: string }>()
function deriveGradient(hex: string): { light: string; dark: string } {
  const light = normalizeHex(hex)
  if (!light) throw new TypeError('picto.gradient(...) expects a 6-digit hex color.')
  let r = GRAD_CACHE.get(light)
  if (r) return r
  const [L, C, H] = hexToOklch(light)
  const a = nearestAnchorByHue(H)
  r = { light, dark: oklchToHex(L + a.p[3], Math.max(0, C + a.p[4]), H + a.p[5]) }
  GRAD_CACHE.set(light, r)
  return r
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
  const manualLight = cfg.light ? normalizeHex(cfg.light) : null
  const manualDark = cfg.dark ? normalizeHex(cfg.dark) : null
  if (manualLight && manualDark) {
    light = manualLight
    dark = manualDark
    colorName = typeof cfg.color === 'string' ? cfg.color : 'custom'
  } else if (cfg.color !== undefined) {
    const c = pickOne(cfg.color, () => pick(palette).name)
    const hex = normalizeHex(c)
    if (hex) {
      const g = deriveGradient(hex)
      light = g.light
      dark = g.dark
      colorName = 'custom'
    } else if (PARTS.bodies[c + '_' + SHAPES[0]]) {
      const a = anchorFor(c)
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
