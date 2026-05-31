// High-performance BATCH renderer — Canvas 2D + cached sprites.
//
// Renders hundreds-to-thousands of animated pictos at 60fps on ONE <canvas>,
// VISUALLY MATCHING the existing SVG-in-DOM <Picto> output (same pixels at the
// rasterized size; same animation motion). Framework-agnostic core — no React,
// no JSX. The React wrapper lives in react-canvas.tsx (<PictoField>).
//
// HOW PARITY IS GUARANTEED
//   The browser rasterizes the SAME SVG the DOM renderer would. For the common
//   case (static, or a CHAR-only animation: jump/breath/dance) we bake ONE
//   COMBINED sprite = the EXACT compose() string → pixel-identical to <Picto> →
//   1 drawImage/frame. Only while an EYE animation (blink / sleeping) is active
//   do we lazily build the LAYERED sprites (bg / body / eyes / brows via
//   engine.layers) so the eyes can be transformed independently of the char.
//
// ANIMATION PARITY (mirrors react.tsx ANIMS exactly; numbers MUST stay in sync)
//   The SVG animates via CSS transform-box:fill-box, so % translations and the
//   transform-origin are relative to the animated element's CONTENT bbox (NOT
//   the 40x40 viewBox). We replicate this with engine.contentBox() — a
//   geometry-derived (exact for crispEdges rects) source-space bbox — and apply
//   the same transforms about the same origin with the same % basis:
//     - .char (jump/breath/dance/sleeping-breath): origin = char bbox 50% 100%
//       (bottom-center); % is relative to char bbox W/H.
//     - .eyes (blink squish / sleeping hold): origin = eyes bbox center.
//   Per-frame z-order, bottom->top: bg (untransformed sibling) ; then under the
//   char transform: body, then (under the additional eyes transform) eyes, then
//   brows ; then zzz (sleeping only, overflow:visible, above everything).

import { compose, layers as engineLayers, ZZZ } from './engine'
import type { ComposeArgs, ContentBox, LayerBox, Variant } from './engine'
import { hashSeed } from './rng'
import type { Character, AnimName } from './character'

const TAU = Math.PI * 2
const VIEW = 40 // the SVG viewBox is always 0 0 40 40

const hasDOM = typeof document !== 'undefined' && typeof window !== 'undefined'
const hasCreateImageBitmap = typeof createImageBitmap === 'function'

// ============================================================================
// Sprite cache
//
// A cache ENTRY is a ready, drawable bitmap (ImageBitmap preferred; an
// OffscreenCanvas/Canvas fallback otherwise) at the device-pixel tile size.
// Entries are stored ONLY when fully decoded — the draw loop never sees a
// half-decoded bitmap. Async builds are deduped by an in-flight Promise map.
// Memory is bounded by an LRU (Map insertion-order) over an estimated-bytes
// budget; on eviction we bitmap.close() (ImageBitmap is NOT promptly GC'd and
// pins GPU memory — three.js #23953, FF 1312148).
// ============================================================================

type Drawable = ImageBitmap | HTMLCanvasElement | OffscreenCanvas

interface CacheEntry {
  bitmap: Drawable
  bytes: number
}

class SpriteCache {
  // Insertion-order Map == LRU; read re-inserts to mark recency.
  private map = new Map<string, CacheEntry>()
  private inflight = new Map<string, Promise<void>>()
  private bytes = 0
  private maxBytes: number
  /** Keys that must never be evicted (the shared zzz sprites). */
  private pinned = new Set<string>()
  /** Set once the owning renderer is disposed; late-resolving rasters self-close. */
  private closed = false

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes
  }

  /** Ready bitmap or undefined. Marks recency on hit. */
  get(key: string): Drawable | undefined {
    const e = this.map.get(key)
    if (!e) return undefined
    this.map.delete(key)
    this.map.set(key, e)
    return e.bitmap
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  isBuilding(key: string): boolean {
    return this.inflight.has(key)
  }

  pin(key: string): void {
    this.pinned.add(key)
  }

  /** Make a previously-pinned key evictable again (e.g. old-size zzz tiles). */
  unpin(key: string): void {
    this.pinned.delete(key)
  }

  /**
   * Kick off (or join) an async build of `key` from `svg` at devW×devH device px.
   * Resolves when stored. Safe to call every frame (deduped). The optional
   * `onReady` fires once the bitmap is cached (used to wake the draw loop).
   */
  build(key: string, svg: string, devW: number, devH: number, onReady?: () => void): void {
    if (this.map.has(key) || this.inflight.has(key)) return
    const bytes = devW * devH * 4
    const p = rasterize(svg, devW, devH)
      .then((bitmap) => {
        this.store(key, { bitmap, bytes })
        onReady?.()
      })
      .catch(() => {
        // Swallow — the loop retries (placeholder meanwhile). Dropping the
        // inflight entry lets a later frame re-attempt instead of wedging.
      })
      .finally(() => {
        this.inflight.delete(key)
      })
    this.inflight.set(key, p)
  }

  private store(key: string, entry: CacheEntry): void {
    // A raster started before dispose()/flush() can resolve afterward; don't
    // repopulate a dead cache (it would pin GPU memory until GC). Close it.
    if (this.closed || this.map.has(key)) {
      closeDrawable(entry.bitmap)
      return
    }
    this.map.set(key, entry)
    this.bytes += entry.bytes
    this.evict()
  }

  private evict(): void {
    if (this.bytes <= this.maxBytes) return
    for (const key of this.map.keys()) {
      if (this.bytes <= this.maxBytes) break
      if (this.pinned.has(key)) continue
      const e = this.map.get(key)
      if (!e) continue
      this.map.delete(key)
      this.bytes -= e.bytes
      closeDrawable(e.bitmap)
    }
  }

  /** Drop EVERY entry (e.g. on dpr change) and close bitmaps. Re-fillable. */
  flush(): void {
    for (const e of this.map.values()) closeDrawable(e.bitmap)
    this.map.clear()
    this.inflight.clear()
    this.pinned.clear()
    this.bytes = 0
  }

  /** Permanent teardown: flush AND mark closed so late rasters self-close. */
  dispose(): void {
    this.flush()
    this.closed = true
  }

  stats(): { entries: number; bytes: number; inflight: number } {
    return { entries: this.map.size, bytes: this.bytes, inflight: this.inflight.size }
  }
}

function closeDrawable(d: Drawable): void {
  if (typeof ImageBitmap !== 'undefined' && d instanceof ImageBitmap) d.close()
}

// ---------------------------------------------------------------------------
// Rasterization (off the hot path).
//   Primary: createImageBitmap(Blob(svg), { resizeWidth/Height, resizeQuality }).
//   Fallback: <img>.decode() then drawImage into a canvas (Safari quirks path).
// The SVG viewBox is 0 0 40 40, so resizing to devSize px rasterizes at the
// exact device-pixel display size. NEVER draw before decode()/the bitmap
// promise resolves.
// ---------------------------------------------------------------------------

function svgDataUrl(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

async function rasterize(svg: string, devW: number, devH: number): Promise<Drawable> {
  if (hasCreateImageBitmap) {
    try {
      const blob = new Blob([svg], { type: 'image/svg+xml' })
      return await createImageBitmap(blob, {
        resizeWidth: devW,
        resizeHeight: devH,
        resizeQuality: 'high',
      })
    } catch {
      // Fall through — some Safari builds reject SVG blobs in createImageBitmap.
    }
  }
  return rasterizeViaImage(svg, devW, devH)
}

async function rasterizeViaImage(svg: string, devW: number, devH: number): Promise<Drawable> {
  const img = new Image()
  img.width = devW
  img.height = devH
  img.decoding = 'async'
  img.src = svgDataUrl(svg)
  if (img.decode) {
    await img.decode()
  } else {
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('picto canvas: svg image load failed'))
    })
  }
  const cv = makeOffscreen(devW, devH)
  const cx = cv.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!cx) throw new Error('picto canvas: no 2d context for sprite raster')
  cx.imageSmoothingEnabled = false
  cx.drawImage(img, 0, 0, devW, devH)
  return cv
}

function makeOffscreen(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  return cv
}

// ============================================================================
// Animation math — MIRRORS react.tsx ANIMS exactly (durations, loop, f(p)).
// Kept here (not imported) so the canvas core has zero React dependency, but
// the numbers MUST stay in lockstep with src/react.tsx.
// ============================================================================

interface AnimMeta {
  dur: number
  loop: boolean
  /** Transforms the EYES independently of the char → needs layered sprites. */
  eyeAnim: boolean
}
const ANIM_META: Record<AnimName, AnimMeta> = {
  blink: { dur: 280, loop: false, eyeAnim: true },
  jump: { dur: 640, loop: false, eyeAnim: false },
  breath: { dur: 2400, loop: true, eyeAnim: false },
  dance: { dur: 720, loop: true, eyeAnim: false },
  sleeping: { dur: 2800, loop: true, eyeAnim: true },
}

/** Char-group transform about the fill-box bottom-center origin, in CSS px.
 *  `bw`/`bh` are the char content-bbox width/height in CSS px (the % BASIS). */
interface CharTransform {
  /** post-origin translate */
  dx: number
  dy: number
  rad: number
  sx: number
  sy: number
}
const IDENTITY: CharTransform = { dx: 0, dy: 0, rad: 0, sx: 1, sy: 1 }

function charTransform(name: AnimName, p: number, bw: number, bh: number): CharTransform {
  switch (name) {
    case 'jump': {
      // translateY(-28%·y) scaleX(1-0.06·y) scaleY(1+0.08·y), y=sin(π·p)
      const y = Math.sin(Math.PI * p)
      return { dx: 0, dy: -0.28 * bh * y, rad: 0, sx: 1 - 0.06 * y, sy: 1 + 0.08 * y }
    }
    case 'breath': {
      // scaleY(1+0.06·s) scaleX(1-0.03·s), s=sin(TAU·p)
      const s = Math.sin(TAU * p)
      return { dx: 0, dy: 0, rad: 0, sx: 1 - 0.03 * s, sy: 1 + 0.06 * s }
    }
    case 'dance': {
      // translateX(6%·s) translateY(-4%·|s|) rotate(9·s deg), s=sin(TAU·p)
      const s = Math.sin(TAU * p)
      return { dx: 0.06 * bw * s, dy: -0.04 * bh * Math.abs(s), rad: (9 * s * Math.PI) / 180, sx: 1, sy: 1 }
    }
    case 'sleeping': {
      // char scaleY(1+0.025·b) scaleX(1-0.012·b), b=sin(TAU·p)
      const b = Math.sin(TAU * p)
      return { dx: 0, dy: 0, rad: 0, sx: 1 - 0.012 * b, sy: 1 + 0.025 * b }
    }
    default:
      return IDENTITY
  }
}

/** blink eyes scaleY: 1 - sin(π·p)·0.92. */
const blinkEyesScaleY = (p: number): number => 1 - Math.sin(Math.PI * p) * 0.92
/** sleeping eyes are HELD at scaleY(0.08). */
const SLEEP_EYES_SCALE_Y = 0.08

// zzz (sleeping): fixed paths/fills shared via engine.ZZZ. We bake each of the
// three sub-groups onto its own device-px tile (config-independent, so the 3
// bitmaps are shared across all pictos) and place them per-frame by their animated
// Y offset. CRITICAL: the three sub-groups use ABSOLUTE coords in ONE shared
// space — group 0 spans y 0..12, group 1 y 13..21, group 2 y 22..26 (x 0..26).
// So each sub-tile MUST cover the FULL extent (28×27) and keep its paths at their
// true position; drawing all three at the same local origin then reproduces the
// SVG's down-left cascade (a short 28×13 tile would clip groups 1 and 2 to empty
// and collapse the cascade — see makeSleepZzz in react.tsx).
const ZZZ_TILE_W = 28
const ZZZ_TILE_H = 27

function zzzSubSvg(i: number): string {
  const paths = ZZZ.paths[i].map((d) => `<path d="${d}" fill="${ZZZ.fills[i]}"/>`).join('')
  return (
    `<svg viewBox="0 0 ${ZZZ_TILE_W} ${ZZZ_TILE_H}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">` +
    paths +
    '</svg>'
  )
}

// ============================================================================
// Public types
// ============================================================================

/** One picto in the field: a character + its tile top-left in CSS px (content space). */
export interface PictoItem {
  char: Character
  x: number
  y: number
}

/** Culling viewport: a scroll window relative to the field's content origin. */
export interface ViewportRect {
  /** Scroll offset of the field's content top, in CSS px (>= 0). */
  scrollTop: number
  /** Visible window height in CSS px. */
  height: number
  /** Visible window width in CSS px. */
  width: number
  /** Optional horizontal scroll offset (default 0). */
  scrollLeft?: number
}

/** Animation target: a specific character, or every character in the field. */
export type AnimTarget = Character | 'all'

export interface RendererOptions {
  /** The target canvas element. */
  canvas: HTMLCanvasElement
  /** Tile size in CSS px (width == height). Default 64. */
  size?: number
  /** Render style. Default 'fancy'. */
  variant?: Variant
  /** Draw the per-character background tile. Default false. */
  background?: boolean
  /** Opaque canvas (alpha:false) — faster compositing. Default false. */
  opaqueBackground?: boolean
  /** Device pixel ratio. Default window.devicePixelRatio (clamped 1..3). */
  dpr?: number
  /**
   * Culling window provider. Called each frame; return the visible scroll rect
   * (relative to the field's content origin), or undefined to cull against the
   * canvas's own box.
   */
  viewport?: () => ViewportRect | undefined
  /** Extra px around the visible rect to pre-warm/draw. Default = one tile. */
  overscan?: number
  /** Sprite-cache byte budget. Default 256MB. */
  maxCacheBytes?: number
}

/** The imperative renderer handle (the React wrapper forwards this as a ref). */
export interface PictoRenderer {
  /** Replace the full picto list (animation clocks survive for kept characters). */
  setItems(items: PictoItem[]): void
  /** Set the culling viewport (CSS px, relative to content origin). */
  setViewport(rect: ViewportRect): void
  /** Resize the backing store to a CSS box + dpr. */
  resize(cssW: number, cssH: number, dpr?: number): void
  /** Change tile size IN PLACE (re-keys/re-rasters sprites; keeps anim clocks). */
  setSize(size: number): void
  /** Change render style IN PLACE (re-keys/re-rasters sprites; keeps anim clocks). */
  setVariant(variant: Variant): void
  /** Toggle the per-char background IN PLACE (re-keys/re-rasters; keeps clocks). */
  setBackground(background: boolean): void
  /** Play (or with null, stop) an animation on a target (a Character or 'all'). */
  play(target: AnimTarget, name: AnimName | null): void
  blink(target: AnimTarget): void
  jump(target: AnimTarget): void
  breath(target: AnimTarget): void
  dance(target: AnimTarget): void
  sleep(target: AnimTarget): void
  stop(target: AnimTarget): void
  /** Start the rAF loop (idempotent). */
  start(): void
  /** Tear down: stop the loop, close every bitmap, drop subscriptions. */
  dispose(): void
  /**
   * Lightweight live metrics for an overlay. Optional on the interface so a thin
   * forwarding proxy (the React wrapper's imperative handle) need not implement
   * it; the concrete renderer always does.
   */
  metrics?(): { visible: number; draws: number; cache: { entries: number; bytes: number; inflight: number } }
}

// ============================================================================
// Per-picto state
// ============================================================================

interface PictoState {
  char: Character
  x: number
  y: number
  /** Active animation, or null when idle. */
  anim: AnimName | null
  /** rAF timestamp (ms) the current anim started; 0 = unseeded (set on first step). */
  start: number
  /** Stable config hash for sprite keys (== Character._uid sans trailing '_'). */
  hash: string
  /** ComposeArgs (sans uid/background/variant) cached from the character spec. */
  base: Omit<ComposeArgs, 'uid' | 'background' | 'variant'>
  /** Lazily-resolved content boxes (source/40-unit space). */
  box?: ContentBox
  /** Unsubscribe from the character's imperative emitter. */
  off: () => void
}

function clampDpr(dpr: number): number {
  // Bucket to 0.5 steps, clamp 1..3 (backing store grows with dpr²; memory cap).
  const c = Math.max(1, Math.min(3, dpr || 1))
  return Math.round(c * 2) / 2
}

function configHashOf(char: Character): string {
  // Matches Character's private _uid derivation so sprite keys are stable.
  return 'p' + hashSeed(JSON.stringify(char.config)).toString(36)
}

function baseArgsOf(char: Character): Omit<ComposeArgs, 'uid' | 'background' | 'variant'> {
  const c = char.config
  return {
    light: c.light,
    dark: c.dark,
    shape: c.shape,
    bg: c.bg,
    eye: c.eye,
    brow: c.brow,
    mode: c.mode,
    tuning: c.tuning,
  }
}

// Which slice of a picto a sprite represents.
type LayerKind = 'combined' | 'charCombined' | 'body' | 'eyes' | 'brows' | 'bg'

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024
const DEFAULT_SIZE = 64
const SUPPORTED = hasDOM && typeof HTMLCanvasElement !== 'undefined'

// ============================================================================
// Renderer
// ============================================================================

class Renderer implements PictoRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D | null
  private cache: SpriteCache
  private states: PictoState[] = []
  private size: number
  private variant: Variant
  private background: boolean
  private viewportFn?: () => ViewportRect | undefined
  private viewportRect: ViewportRect | null = null
  private overscan: number

  private cssW = 0
  private cssH = 0
  private dpr = 1
  private rafId = 0
  private disposed = false

  private lastVisible = 0
  private lastDraws = 0

  /** Pinned zzz cache keys (so a size change can unpin the old-size tiles). */
  private zzzKeys: string[] = []
  /** Prev key-fields snapshot, used to fall back to the old sprite during re-raster. */
  private prevKey: { variant: Variant; background: boolean; size: number } | null = null

  constructor(opts: RendererOptions) {
    this.canvas = opts.canvas
    this.size = opts.size ?? DEFAULT_SIZE
    this.variant = opts.variant ?? 'fancy'
    this.background = opts.background ?? false
    this.viewportFn = opts.viewport
    this.overscan = opts.overscan ?? this.size
    this.cache = new SpriteCache(opts.maxCacheBytes ?? DEFAULT_MAX_BYTES)

    if (!SUPPORTED) {
      this.ctx = null
      return
    }
    this.ctx = this.canvas.getContext('2d', {
      alpha: !(opts.opaqueBackground ?? false),
    }) as CanvasRenderingContext2D | null
    this.dpr = clampDpr(opts.dpr ?? (hasDOM ? window.devicePixelRatio : 1))
    this.pinZzz()
  }

  // ---- public imperative API ----

  setItems(items: PictoItem[]): void {
    if (!this.ctx) return
    const prev = new Map<Character, PictoState>()
    for (const s of this.states) prev.set(s.char, s)
    const next: PictoState[] = []
    const seen = new Set<Character>()
    for (const it of items) {
      seen.add(it.char)
      const old = prev.get(it.char)
      if (old) {
        old.x = it.x
        old.y = it.y
        next.push(old)
      } else {
        next.push(this.makeState(it))
      }
    }
    for (const s of this.states) if (!seen.has(s.char)) s.off()
    this.states = next
    this.ensureRunning()
  }

  setViewport(rect: ViewportRect): void {
    this.viewportRect = rect
    this.ensureRunning()
  }

  resize(cssW: number, cssH: number, dpr?: number): void {
    if (!this.ctx) return
    const nextDpr = clampDpr(dpr ?? this.dpr)
    const dprChanged = nextDpr !== this.dpr
    if (dprChanged) {
      // Keys embed dpr; old entries are now dead → flush + close them, re-pin zzz.
      this.dpr = nextDpr
      this.cache.flush() // also clears the cache's pinned set
      this.unpinZzz() // drop stale (now-flushed) zzz key tracking before re-pin
      this.pinZzz()
    }
    if (cssW === this.cssW && cssH === this.cssH && !dprChanged) return
    this.cssW = cssW
    this.cssH = cssH
    // Device backing store only. React owns the CSS inline size (width:100% +
    // height) — writing canvas.style.* here would fight React's inline styles
    // (clobbered every re-render/resize) and is the source of the sizing churn.
    this.canvas.width = Math.max(1, Math.round(cssW * this.dpr))
    this.canvas.height = Math.max(1, Math.round(cssH * this.dpr))
    this.ensureRunning()
  }

  play(target: AnimTarget, name: AnimName | null): void {
    if (target === 'all') {
      for (const s of this.states) {
        s.anim = name
        s.start = 0
      }
    } else {
      for (const s of this.states) {
        if (s.char === target) {
          s.anim = name
          s.start = 0
          break
        }
      }
    }
    this.ensureRunning()
  }

  blink(t: AnimTarget): void {
    this.play(t, 'blink')
  }
  jump(t: AnimTarget): void {
    this.play(t, 'jump')
  }
  breath(t: AnimTarget): void {
    this.play(t, 'breath')
  }
  dance(t: AnimTarget): void {
    this.play(t, 'dance')
  }
  sleep(t: AnimTarget): void {
    this.play(t, 'sleeping')
  }
  stop(t: AnimTarget): void {
    this.play(t, null)
  }

  // ---- in-place option setters --------------------------------------------
  // Change size/variant/background WITHOUT tearing the renderer down: no cache
  // flush, no dispose, no state-identity change (anim clocks s.anim/s.start +
  // char subscriptions survive). Sprites re-key on the next draw and re-raster
  // on the cache miss; the prev-key fallback keeps the OLD bitmap visible until
  // the new one decodes (no blank/placeholder flash). Old-key entries age out of
  // the LRU on their own.

  setSize(size: number): void {
    if (!this.ctx) return
    if (size === this.size) return
    this.snapshotPrevKeyFields()
    const old = this.size
    this.size = size
    // `overscan` defaults to the size; track that default through size changes.
    if (this.overscan === old) this.overscan = size
    // box is in SOURCE (40-unit) space (k=size/VIEW applied per-frame) → size does
    // NOT invalidate it, so we keep s.box. But the shared zzz tiles ARE size-keyed:
    // unpin the old-size tiles (so they're evictable) before pinning the new size.
    this.unpinZzz()
    this.pinZzz()
    this.prewarmVisible()
    this.ensureRunning()
  }

  setVariant(variant: Variant): void {
    if (!this.ctx) return
    if (variant === this.variant) return
    this.snapshotPrevKeyFields()
    this.variant = variant
    // contentBox depends on variant (char.contentBox) → clear so eye/char anims
    // transform about the correct origin, not a stale one.
    for (const s of this.states) s.box = undefined
    this.prewarmVisible()
    this.ensureRunning()
  }

  setBackground(background: boolean): void {
    if (!this.ctx) return
    if (background === this.background) return
    this.snapshotPrevKeyFields()
    this.background = background
    // contentBox depends on background (the bg shifts the content bbox origin).
    for (const s of this.states) s.box = undefined
    this.prewarmVisible()
    this.ensureRunning()
  }

  start(): void {
    this.ensureRunning()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.rafId) cancelAnimationFrame(this.rafId)
    this.rafId = 0
    for (const s of this.states) s.off()
    this.states = []
    this.cache.dispose()
  }

  metrics(): { visible: number; draws: number; cache: { entries: number; bytes: number; inflight: number } } {
    return { visible: this.lastVisible, draws: this.lastDraws, cache: this.cache.stats() }
  }

  // ---- internals ----

  private makeState(it: PictoItem): PictoState {
    const st: PictoState = {
      char: it.char,
      x: it.x,
      y: it.y,
      anim: null,
      start: 0,
      hash: configHashOf(it.char),
      base: baseArgsOf(it.char),
      off: () => {},
    }
    // Subscribe so char.blink()/dance()/stop() drive this picto too — exactly
    // like a mounted <Picto char={char} />.
    st.off = it.char._subscribe((e) => {
      st.anim = e.name
      st.start = 0
      this.ensureRunning()
    })
    return st
  }

  // ---- sprite keys ----

  private keyPrefix(s: PictoState): string {
    const px = Math.round(this.size)
    return `${s.hash}|${this.variant}|${this.background ? 1 : 0}|${px}|${this.dpr}`
  }

  private layerKey(s: PictoState, layer: LayerKind): string {
    // With no background, charCombined (body+eyes+brows, no bg) is byte-identical
    // to combined, so share one bitmap rather than baking two of the same.
    if (layer === 'charCombined' && !this.background) layer = 'combined'
    return `${this.keyPrefix(s)}|${layer}`
  }

  /** Snapshot the key-deriving fields BEFORE a setter mutates them, so getSprite
   *  can fall back to the prior-key bitmap during async re-raster (no blank frame). */
  private snapshotPrevKeyFields(): void {
    this.prevKey = { variant: this.variant, background: this.background, size: Math.round(this.size) }
  }

  /** layerKey for a state under the PREVIOUS key-fields snapshot (mirrors
   *  layerKey/keyPrefix but reads prevKey, NOT this.*). Returns null if none. */
  private prevLayerKey(s: PictoState, layer: LayerKind): string | null {
    const pk = this.prevKey
    if (!pk) return null
    // Mirror layerKey's charCombined↔combined sharing using the prev background.
    if (layer === 'charCombined' && !pk.background) layer = 'combined'
    const prefix = `${s.hash}|${pk.variant}|${pk.background ? 1 : 0}|${pk.size}|${this.dpr}`
    return `${prefix}|${layer}`
  }

  private zzzKey(i: number): string {
    return `zzz${i}|${Math.round(this.size)}|${this.dpr}`
  }

  private pinZzz(): void {
    // Build + pin the 3 shared zzz sub-sprites (config-independent).
    const devScale = (this.size / VIEW) * this.dpr
    const devW = Math.max(1, Math.round(ZZZ_TILE_W * devScale))
    const devH = Math.max(1, Math.round(ZZZ_TILE_H * devScale))
    for (let i = 0; i < 3; i++) {
      const key = this.zzzKey(i)
      this.cache.pin(key)
      this.zzzKeys.push(key)
      if (!this.cache.has(key) && !this.cache.isBuilding(key)) {
        this.cache.build(key, zzzSubSvg(i), devW, devH, () => this.ensureRunning())
      }
    }
  }

  /** Unpin (make evictable) the currently-tracked zzz tiles and forget them.
   *  Called before re-pinning at a new size so old-size zzz bitmaps don't leak
   *  as un-evictable entries across repeated size toggles. */
  private unpinZzz(): void {
    for (const key of this.zzzKeys) this.cache.unpin(key)
    this.zzzKeys = []
  }

  // ---- sprite acquisition (cache get + lazy async build) ----

  private getSprite(s: PictoState, layer: LayerKind): Drawable | undefined {
    const key = this.layerKey(s, layer)
    const ready = this.cache.get(key)
    if (ready) return ready
    if (!this.cache.isBuilding(key)) {
      const svg = this.svgFor(s, layer)
      if (svg) {
        const dev = Math.max(1, Math.round(this.size * this.dpr))
        this.cache.build(key, svg, dev, dev, () => this.ensureRunning())
      }
    }
    // NO BLANK FRAME during in-place re-raster (size/variant/background change):
    // fall back to the SAME layer's bitmap at the PRIOR key (still cached — just
    // made evict-eligible, not yet LRU-evicted). drawImage rescales it to S, so an
    // old-size/old-style picto stays visible until the new sprite decodes. Self-
    // heals as old entries age out; prevKey is left set (cheap, bounded).
    if (this.prevKey) {
      const priorKey = this.prevLayerKey(s, layer)
      if (priorKey) {
        const old = this.cache.get(priorKey)
        if (old) return old
      }
    }
    return undefined
  }

  /** SVG string for a layer slice (byte-identical to compose() / engine.layers()). */
  private svgFor(s: PictoState, layer: LayerKind): string | null {
    const uid = s.hash + '_'
    if (layer === 'combined') {
      // combined == the exact compose() string (incl. bg if enabled) → pixel-
      // identical to <Picto>. With no bg, combined IS the char content too.
      return compose({ ...s.base, uid, background: this.background, variant: this.variant })
    }
    if (layer === 'charCombined') {
      // body+eyes+brows merged, NO bg (the char fill-box content only).
      return compose({ ...s.base, uid, background: false, variant: this.variant })
    }
    const ls = engineLayers({ ...s.base, uid, background: this.background, variant: this.variant })
    switch (layer) {
      case 'body':
        return ls.body
      case 'eyes':
        return ls.eyes
      case 'brows':
        return ls.brows
      case 'bg':
        // PictoLayers.background is present only when background was requested.
        return ls.background ?? null
      default:
        return null
    }
  }

  /** Geometry-derived content boxes in source (40-unit) space; cached per picto. */
  private ensureBox(s: PictoState): ContentBox {
    if (s.box) return s.box
    s.box = s.char.contentBox({ background: this.background, variant: this.variant, uid: s.hash + '_' })
    return s.box
  }

  /** The current cull window (CSS px) + scroll offsets — shared by draw() and
   *  prewarmVisible() so both use the SAME visible set. */
  private cullWindow(): { offX: number; offY: number; left: number; right: number; top: number; bottom: number } {
    const o = this.overscan
    const vp = this.viewportRect ?? (this.viewportFn ? this.viewportFn() : undefined)
    const offX = vp ? (vp.scrollLeft ?? 0) : 0
    const offY = vp ? vp.scrollTop : 0
    return {
      offX,
      offY,
      left: vp ? offX - o : -o,
      right: vp ? offX + vp.width + o : this.cssW + o,
      top: vp ? offY - o : -o,
      bottom: vp ? offY + vp.height + o : this.cssH + o,
    }
  }

  /** Pre-warm the new-size/new-style sprite for every ON-SCREEN picto so the new
   *  bitmap is usually ready by the next rAF (smooths size-slider drags + style
   *  toggles). Reuses the live cull window; cheap (only the visible set, and
   *  cache.build() is a no-op when already cached/in-flight). */
  private prewarmVisible(): void {
    if (!this.ctx || this.states.length === 0) return
    const S = this.size
    const w = this.cullWindow()
    for (const s of this.states) {
      const onScreen = s.x + S >= w.left && s.x <= w.right && s.y + S >= w.top && s.y <= w.bottom
      if (!onScreen) continue
      // Kick the PRIMARY layer(s) so the static fast path is ready: combined when
      // no bg; bg + charCombined when bg (eye-anim layers stay lazy as before).
      if (this.background) {
        this.getSprite(s, 'bg')
        this.getSprite(s, 'charCombined')
      } else {
        this.getSprite(s, 'combined')
      }
    }
  }

  // ---- the shared draw loop ----

  private ensureRunning(): void {
    if (this.disposed || !this.ctx) return
    if (!this.rafId) this.rafId = requestAnimationFrame(this.loop)
  }

  private loop = (ts: number): void => {
    if (this.disposed || !this.ctx) {
      this.rafId = 0
      return
    }
    this.draw(ts)
    // Keep ticking while anything animates OR anything is on-screen (so a newly
    // scrolled-in static picto still gets its one draw / pre-warm). Idle otherwise.
    const anyAnim = this.states.some((s) => s.anim !== null)
    this.rafId = anyAnim || this.lastVisible > 0 ? requestAnimationFrame(this.loop) : 0
  }

  private draw(ts: number): void {
    const ctx = this.ctx as CanvasRenderingContext2D
    // Work in CSS px; crisp. setTransform once per frame applies the dpr scale.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.cssW, this.cssH)
    ctx.imageSmoothingEnabled = false

    const S = this.size
    const k = S / VIEW

    // When a scroll viewport is provided the canvas is PINNED to it (viewport-
    // sized, not field-sized — so the backing store never exceeds the browser's
    // max canvas dimension). Items live in field content space, so we draw each
    // at (content-pos − scroll) and cull against the scrolled window. With no
    // viewport the canvas IS the field: offsets are 0, cull against the canvas box.
    const w = this.cullWindow()
    const offX = w.offX
    const offY = w.offY

    let visible = 0
    let draws = 0

    for (const s of this.states) {
      // advance / one-shot-complete the clock regardless of visibility (loops
      // resume phase-correct; mirrors react.tsx's always-advancing ticker).
      const anim = this.advanceClock(s, ts)

      // cull: only draw pictos whose tile intersects the visible window.
      const onScreen = s.x + S >= w.left && s.x <= w.right && s.y + S >= w.top && s.y <= w.bottom
      if (!onScreen) continue
      visible++

      // Draw at content-position minus the viewport scroll (canvas is pinned).
      const px = Math.floor(s.x - offX)
      const py = Math.floor(s.y - offY)

      if (!anim) {
        // STATIC FAST PATH — one drawImage of the combined sprite.
        const combined = this.getSprite(s, 'combined')
        if (combined) {
          ctx.drawImage(combined, px, py, S, S)
          draws++
        } else {
          this.placeholder(ctx, px, py, S)
        }
        continue
      }

      const meta = ANIM_META[anim]
      const p = progress(s, ts, meta)
      const box = this.ensureBox(s)
      const charOX = (box.char.x + box.char.w / 2) * k
      const charOY = (box.char.y + box.char.h) * k // bottom-center
      const bw = box.char.w * k
      const bh = box.char.h * k

      // Per-sprite anti-aliasing (smoothOn/smoothOff at each transformed drawImage)
      // is handled INSIDE drawCharAnim/drawEyeAnim/drawZzz — the untransformed bg
      // sibling stays crisp while the transformed char/eyes/zzz sample smooth.
      if (!meta.eyeAnim) {
        draws += this.drawCharAnim(ctx, s, anim, p, px, py, S, charOX, charOY, bw, bh)
      } else {
        draws += this.drawEyeAnim(ctx, s, anim, p, px, py, S, k, box, charOX, charOY, bw, bh)
      }
    }

    this.lastVisible = visible
    this.lastDraws = draws
  }

  /** Advance (and one-shot-complete) the clock; returns the still-active anim. */
  private advanceClock(s: PictoState, ts: number): AnimName | null {
    if (!s.anim) return null
    const meta = ANIM_META[s.anim]
    if (!s.start) s.start = ts
    if (!meta.loop && (ts - s.start) / meta.dur >= 1) {
      // One-shot completion clears the anim (mirrors stepEntry's terminal clear).
      s.anim = null
      s.start = 0
      return null
    }
    return s.anim
  }

  // ---- char anim (jump/breath/dance): transform the whole char content ----
  private drawCharAnim(
    ctx: CanvasRenderingContext2D,
    s: PictoState,
    anim: AnimName,
    p: number,
    px: number,
    py: number,
    S: number,
    charOX: number,
    charOY: number,
    bw: number,
    bh: number,
  ): number {
    const xf = charTransform(anim, p, bw, bh)
    let draws = 0
    if (this.background) {
      // BG PARITY: the SVG transforms ONLY .char, never the bg sibling. Draw a
      // static bg, then charCombined (body+eyes+brows, no bg) under the xform.
      const bg = this.getSprite(s, 'bg')
      if (bg) {
        ctx.drawImage(bg, px, py, S, S)
        draws++
      }
      const charCombined = this.getSprite(s, 'charCombined')
      if (charCombined) {
        // Transformed char content → smooth sampling (the bg above stayed crisp).
        ctx.save()
        ctx.translate(px, py)
        applyXform(ctx, xf, charOX, charOY)
        smoothOn(ctx)
        ctx.drawImage(charCombined, 0, 0, S, S)
        ctx.restore()
        smoothOff(ctx) // restore() does NOT reset smoothing — do it explicitly.
        draws++
      } else if (!bg) {
        this.placeholder(ctx, px, py, S)
      }
    } else {
      // No bg: the combined sprite IS the char content → 1 transformed drawImage.
      const combined = this.getSprite(s, 'combined')
      if (combined) {
        ctx.save()
        ctx.translate(px, py)
        applyXform(ctx, xf, charOX, charOY)
        smoothOn(ctx)
        ctx.drawImage(combined, 0, 0, S, S)
        ctx.restore()
        smoothOff(ctx) // restore() does NOT reset smoothing — do it explicitly.
        draws++
      } else {
        this.placeholder(ctx, px, py, S)
      }
    }
    return draws
  }

  // ---- eye anim (blink/sleeping): layered draw, eyes transformed independently ----
  private drawEyeAnim(
    ctx: CanvasRenderingContext2D,
    s: PictoState,
    anim: AnimName,
    p: number,
    px: number,
    py: number,
    S: number,
    k: number,
    box: ContentBox,
    charOX: number,
    charOY: number,
    bw: number,
    bh: number,
  ): number {
    const body = this.getSprite(s, 'body')
    const eyes = this.getSprite(s, 'eyes')
    const brows = this.getSprite(s, 'brows')
    const bg = this.background ? this.getSprite(s, 'bg') : undefined

    // Layered sprites not all ready yet — fall back to a static combined draw so
    // the picto stays visible (no blank flash) until the eye layers decode.
    if (!body || !eyes || !brows) {
      const fallback = this.getSprite(s, this.background ? 'combined' : 'charCombined')
      if (fallback) {
        ctx.drawImage(fallback, px, py, S, S)
        return 1
      }
      this.placeholder(ctx, px, py, S)
      return 0
    }

    let draws = 0
    const eyesCX = (box.eyes.x + box.eyes.w / 2) * k
    const eyesCY = (box.eyes.y + box.eyes.h / 2) * k
    const outer = anim === 'sleeping' ? charTransform('sleeping', p, bw, bh) : IDENTITY
    const eyesSY = anim === 'sleeping' ? SLEEP_EYES_SCALE_Y : blinkEyesScaleY(p)

    ctx.save()
    ctx.translate(px, py)

    // BG is a .char sibling (outside the fill-box) → untransformed, drawn first.
    if (bg) {
      ctx.drawImage(bg, 0, 0, S, S)
      draws++
    }

    // Char wrap (sleeping breath scale; identity for blink). Everything under
    // this wrap is transformed (and the eyes carry an extra scaleY) → smooth.
    ctx.save()
    applyXform(ctx, outer, charOX, charOY)
    smoothOn(ctx)

    ctx.drawImage(body, 0, 0, S, S)
    draws++

    // eyes: scaleY about eyes center, drawn BETWEEN body and brows.
    ctx.save()
    ctx.translate(eyesCX, eyesCY)
    ctx.scale(1, eyesSY)
    ctx.translate(-eyesCX, -eyesCY)
    ctx.drawImage(eyes, 0, 0, S, S)
    ctx.restore()
    draws++

    // brows: ON TOP of eyes, inside the char wrap.
    ctx.drawImage(brows, 0, 0, S, S)
    draws++

    ctx.restore() // close char wrap
    smoothOff(ctx) // restore() does NOT reset smoothing — reset before zzz/next item.

    // zzz (sleeping only): AFTER brows, NOT clipped to the tile (overflow:visible).
    // drawZzz manages its own smoothing toggle.
    if (anim === 'sleeping') draws += this.drawZzz(ctx, p, k)

    ctx.restore() // close tile translate
    return draws
  }

  private drawZzz(ctx: CanvasRenderingContext2D, p: number, k: number): number {
    // base transform: translate(24·k, -2·k) then scale(0.55). Each sub-group i is
    // offset translateY(sin(TAU·p + i·phase)·amp) in SOURCE units.
    const [bx, by] = ZZZ.base.translate
    let draws = 0
    for (let i = 0; i < 3; i++) {
      const sprite = this.cache.get(this.zzzKey(i))
      if (!sprite) continue
      const offY = Math.sin(TAU * p + i * ZZZ.phase) * ZZZ.amp
      // zzz is drawn under a non-integer scale (ZZZ.base.scale · k) → smooth.
      ctx.save()
      ctx.translate(bx * k, by * k)
      ctx.scale(ZZZ.base.scale, ZZZ.base.scale)
      ctx.translate(0, offY * k)
      smoothOn(ctx)
      ctx.drawImage(sprite, 0, 0, ZZZ_TILE_W * k, ZZZ_TILE_H * k)
      ctx.restore()
      smoothOff(ctx) // restore() does NOT reset smoothing — do it explicitly.
      draws++
    }
    return draws
  }

  /** Faint placeholder while a sprite decodes (pre-warm makes this rare). */
  private placeholder(ctx: CanvasRenderingContext2D, x: number, y: number, S: number): void {
    ctx.save()
    ctx.globalAlpha = 0.08
    ctx.fillStyle = '#888'
    const r = Math.min(8, S * 0.12)
    roundRect(ctx, x + S * 0.1, y + S * 0.1, S * 0.8, S * 0.8, r)
    ctx.fill()
    ctx.restore()
  }
}

// ============================================================================
// matrix application — replicate the CSS transform list about the fill-box origin.
//   CSS applies the listed ops L→R about transform-origin. We replicate by
//   translate(origin) → translate(per-op) → rotate → scale → translate(-origin).
//   Each anim uses a disjoint op subset (jump/breath: translate+scale ; dance:
//   translate+rotate), so folding into one (dx,dy)+(rad)+(sx,sy) tuple applied
//   translate→rotate→scale is equivalent to the listed order.
// ============================================================================
function applyXform(ctx: CanvasRenderingContext2D, xf: CharTransform, ox: number, oy: number): void {
  ctx.translate(ox, oy)
  if (xf.dx !== 0 || xf.dy !== 0) ctx.translate(xf.dx, xf.dy)
  if (xf.rad !== 0) ctx.rotate(xf.rad)
  if (xf.sx !== 1 || xf.sy !== 1) ctx.scale(xf.sx, xf.sy)
  ctx.translate(-ox, -oy)
}

// Anti-aliasing toggles. The SVG <Picto> switches shape-rendering to
// geometricPrecision WHILE animating (react.tsx) and back to crispEdges when
// static; we mirror that on the canvas: smooth (bilinear) sampling for a
// TRANSFORMED/animated sprite, crisp (nearest-neighbor) for a static 1:1 blit.
// CRITICAL: imageSmoothingEnabled/Quality are NOT saved/restored by ctx.save()/
// restore(), so every transformed block MUST smoothOff() explicitly afterward —
// relying on restore() leaks smoothing into the next item's static draw.
function smoothOn(ctx: CanvasRenderingContext2D): void {
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
}
function smoothOff(ctx: CanvasRenderingContext2D): void {
  ctx.imageSmoothingEnabled = false
}

function progress(s: PictoState, ts: number, meta: AnimMeta): number {
  if (!s.start) s.start = ts
  const el = (ts - s.start) / meta.dur
  return meta.loop ? el % 1 : Math.min(1, el)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// ============================================================================
// Factory (SSR / no-canvas safe). On unsupported environments every method is a
// no-op so callers don't need to branch.
// ============================================================================

const NOOP_RENDERER: PictoRenderer = {
  setItems() {},
  setViewport() {},
  resize() {},
  setSize() {},
  setVariant() {},
  setBackground() {},
  play() {},
  blink() {},
  jump() {},
  breath() {},
  dance() {},
  sleep() {},
  stop() {},
  start() {},
  dispose() {},
  metrics: () => ({ visible: 0, draws: 0, cache: { entries: 0, bytes: 0, inflight: 0 } }),
}

/** Create a batch renderer for `opts.canvas`. Returns a no-op stub on SSR/no-canvas. */
export function createPictoRenderer(opts: RendererOptions): PictoRenderer {
  if (!SUPPORTED) return NOOP_RENDERER
  return new Renderer(opts)
}

/** Whether the canvas batch renderer is usable in this environment. */
export const canvasSupported = SUPPORTED

// Re-export the source-space box type for consumers that read renderer geometry.
export type { LayerBox, ContentBox }
