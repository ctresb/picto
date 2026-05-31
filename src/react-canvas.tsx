// <PictoField /> — render MANY pictos into ONE <canvas> at 60fps.
//
//   <PictoField chars={chars} size={64} />                       a grid, auto-flowed
//   <PictoField chars={chars} layout={[{x,y}, ...]} />           explicit positions
//   <PictoField chars={chars} animate="breath" />                declarative "animate all"
//   <PictoField ref={r} chars={chars} />; r.current.blink('all') imperative handle
//
// This is the BATCH counterpart to <Picto> (src/react.tsx). <Picto> stays the
// right tool for one/few SVG pictos; <PictoField> drives a Canvas-2D cached-sprite
// renderer (src/canvas.ts) that visually matches the SVG output (same pixels at
// the rasterized size, same animation motion) but scales to hundreds-to-thousands.
//
// The component is a THIN React shell over the framework-agnostic renderer:
//   - owns exactly one <canvas> + its backing-store (DPR) sizing,
//   - instantiates the renderer in a layout effect and tears it down on unmount,
//   - feeds it items computed from chars + layout + size/cols/gap,
//   - applies the declarative `animate` prop via renderer.play('all', animate),
//   - forwards a ref to the imperative PictoRenderer handle.
//
// Animation parity: the renderer subscribes to each Character via the existing
// char._subscribe (done inside src/canvas.ts), so calling char.blink() animates
// BOTH a mounted <Picto char={char} /> and this canvas field. The declarative
// `animate` prop and the imperative ref handle are the other two paths — all
// three share the renderer's per-Character clock map.
//
// src/react.tsx (the SVG <Picto>) is intentionally NOT touched.

import * as React from 'react'
import type { Character } from './character'
import type { AnimName } from './character'
import type { Variant } from './engine'
import { createPictoRenderer } from './canvas'
import type { PictoItem, PictoRenderer } from './canvas'

/** Explicit per-tile top-left position in CSS px (matches PictoItem x/y). */
export interface PictoPosition {
  x: number
  y: number
}

export interface PictoFieldProps {
  /** The characters to render, one tile each (index order = layout order). */
  chars: Character[]
  /** Tile size in CSS px (uniform width = height). Default 64. */
  size?: number
  /** Render style forwarded to the renderer. 'fancy' (default) | 'flat'. */
  variant?: Variant
  /** Draw the background tile behind each picto. Default false (transparent). */
  background?: boolean
  /**
   * 'grid' (default) auto-flows tiles left-to-right, wrapping at `cols` (or the
   * column count derived from the canvas width). Or pass an explicit array of
   * top-left positions (CSS px), one per char (index-aligned); extra chars beyond
   * the array length are dropped.
   */
  layout?: 'grid' | PictoPosition[]
  /** Grid columns. When omitted, derived from the canvas width and size+gap. */
  cols?: number
  /** Gap between grid tiles in CSS px. Default 12. */
  gap?: number
  /** Declarative "animate all": plays this on every char (null/undefined = idle). */
  animate?: AnimName | null
  /**
   * Height of the self-owned overflow:auto scroller (CSS px number or any CSS
   * length string). Default '70vh'. The field's full content is taller than this;
   * the scroller clips it and scrolls natively while ONE viewport-tall sticky
   * canvas is reused for every frame.
   */
  height?: number | string
  /**
   * ADVANCED override. By default PictoField owns its own overflow:auto scroller
   * sized by `height`; pass scrollParentRef only to use an external scroll
   * ancestor instead (e.g. when the field must scroll inside a parent you already
   * control). When given, PictoField does NOT render its own scroller and instead
   * pins its canvas to and culls against the element this ref points at.
   */
  scrollParentRef?: React.RefObject<HTMLElement | null>
  /** Device pixel ratio override. Default window.devicePixelRatio. */
  dpr?: number
  /** Soft cap on the sprite cache, in bytes (forwarded to the renderer). */
  maxCacheBytes?: number
  style?: React.CSSProperties
  className?: string
}

const DEFAULT_SIZE = 64
const DEFAULT_GAP = 12

/** Read the current device pixel ratio, SSR-safe. */
function currentDpr(override?: number): number {
  if (override && override > 0) return override
  return typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
}

/**
 * Compute the items (char + top-left px) for the current chars/layout/size.
 *
 *  - Explicit layout: index-align chars to positions; drop any char past the
 *    positions array (a position with no char is simply unused).
 *  - Grid layout: auto-flow into `cols` columns. `cols` is the explicit prop when
 *    given, else derived from the canvas content width: floor((w + gap)/(size+gap)),
 *    clamped to >= 1. rowH = size + gap; x = col*(size+gap), y = row*rowH.
 */
function computeItems(
  chars: Character[],
  layout: 'grid' | PictoPosition[],
  size: number,
  gap: number,
  explicitCols: number | undefined,
  contentWidth: number,
): PictoItem[] {
  if (layout !== 'grid') {
    const n = Math.min(chars.length, layout.length)
    const items: PictoItem[] = new Array(n)
    for (let i = 0; i < n; i++) items[i] = { char: chars[i], x: layout[i].x, y: layout[i].y }
    return items
  }

  const step = size + gap
  const cols =
    explicitCols && explicitCols > 0
      ? Math.floor(explicitCols)
      : Math.max(1, Math.floor((contentWidth + gap) / step))

  const items: PictoItem[] = new Array(chars.length)
  for (let i = 0; i < chars.length; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    items[i] = { char: chars[i], x: col * step, y: row * step }
  }
  return items
}

/** Total grid height (CSS px) for `n` tiles at `cols` columns — used to size the canvas. */
function gridHeight(n: number, cols: number, size: number, gap: number): number {
  if (n === 0) return 0
  const rows = Math.ceil(n / Math.max(1, cols))
  return rows * (size + gap) - gap
}

/**
 * <PictoField> — a single <canvas> driving the batch renderer.
 *
 * Forwards a ref to the imperative PictoRenderer so callers can do
 * `ref.current?.blink('all')` / `ref.current?.play(char, 'dance')` / etc.
 */
export const PictoField = React.forwardRef<PictoRenderer, PictoFieldProps>(function PictoField(
  {
    chars,
    size = DEFAULT_SIZE,
    variant = 'fancy',
    background = false,
    layout = 'grid',
    cols,
    gap = DEFAULT_GAP,
    animate = null,
    height = '70vh',
    scrollParentRef,
    dpr,
    maxCacheBytes,
    style,
    className,
  },
  ref,
) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const rendererRef = React.useRef<PictoRenderer | null>(null)
  // The self-owned overflow:auto scroller. We read it via THIS ref inside OUR own
  // layout effect (same component, same render), so there is no cross-component
  // mount-order race like an external scrollParentRef set in a PARENT effect.
  const scrollerRef = React.useRef<HTMLDivElement>(null)

  // Forward the live renderer handle. We keep a stable proxy object whose methods
  // delegate to the current renderer, so the parent's ref stays valid across the
  // renderer's create/dispose lifecycle (the underlying renderer is recreated when
  // canvas-level options change) without the parent having to re-read ref.current.
  React.useImperativeHandle(
    ref,
    (): PictoRenderer => ({
      setItems: (items) => rendererRef.current?.setItems(items),
      setViewport: (rect) => rendererRef.current?.setViewport(rect),
      resize: (w, h, d) => rendererRef.current?.resize(w, h, d),
      setSize: (s) => rendererRef.current?.setSize(s),
      setVariant: (v) => rendererRef.current?.setVariant(v),
      setBackground: (b) => rendererRef.current?.setBackground(b),
      play: (target, name) => rendererRef.current?.play(target, name),
      blink: (t) => rendererRef.current?.blink(t),
      jump: (t) => rendererRef.current?.jump(t),
      breath: (t) => rendererRef.current?.breath(t),
      dance: (t) => rendererRef.current?.dance(t),
      sleep: (t) => rendererRef.current?.sleep(t),
      stop: (t) => rendererRef.current?.stop(t),
      start: () => rendererRef.current?.start(),
      dispose: () => rendererRef.current?.dispose(),
      metrics: () =>
        rendererRef.current?.metrics?.() ?? {
          visible: 0,
          draws: 0,
          cache: { entries: 0, bytes: 0, inflight: 0 },
        },
    }),
    [],
  )

  // The CSS content width of the canvas, tracked so grid auto-flow column counts
  // and the canvas height recompute on resize. Seeded 0; the layout effect's
  // initial measure sets it before the first draw.
  const [contentWidth, setContentWidth] = React.useState(0)

  // By DEFAULT PictoField owns its own overflow:auto scroller (selfScroll). The
  // <canvas> is PINNED (position:sticky) to that scroller's viewport top and sized
  // to the viewport height, while a full-field-height spacer makes the scroller
  // scroll natively. This keeps the backing store bounded to ONE viewport
  // regardless of count/size (a field-sized canvas would blow past the browser's
  // max canvas dimension at high counts). When scrollParentRef is passed instead,
  // selfScroll is false and the same pinning is applied against that external
  // ancestor. viewportH tracks the pinned (viewport) height in both modes.
  const selfScroll = scrollParentRef == null
  const [viewportH, setViewportH] = React.useState(0)

  // ---- create / dispose the renderer ----------------------------------------
  // The renderer is created ONCE (per dpr/maxCacheBytes). size/variant/background
  // are NOT in the deps: changing them used to dispose + recreate the renderer,
  // which flushed the sprite cache and the per-Character animation clocks → a
  // blank/placeholder flash + visible glitch on every size/style toggle. They are
  // now applied IN PLACE via setSize/setVariant/setBackground (effects below) so
  // the renderer (and its clocks) survives. Initial size/variant/background still
  // feed construction so the very first frame is already correct. Items, viewport,
  // and animations are pushed via their own effects.
  React.useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = createPictoRenderer({
      canvas,
      size,
      variant,
      background,
      dpr: currentDpr(dpr),
      ...(maxCacheBytes != null ? { maxCacheBytes } : {}),
      // Always provide a viewport: read the ACTIVE scroller — our own scrollerRef
      // in self-scroll mode (the default), or the external scrollParentRef when
      // overridden. The canvas.clientHeight fallback only covers the brief window
      // before the scroller is measured on the first synchronous layout pass.
      viewport: () => {
        const el = selfScroll ? scrollerRef.current : scrollParentRef?.current
        if (el) {
          return {
            scrollTop: el.scrollTop,
            scrollLeft: el.scrollLeft,
            height: el.clientHeight,
            width: el.clientWidth,
          }
        }
        return { scrollTop: 0, scrollLeft: 0, height: canvas.clientHeight, width: canvas.clientWidth }
      },
    })
    rendererRef.current = renderer
    renderer.start()

    return () => {
      renderer.dispose()
      if (rendererRef.current === renderer) rendererRef.current = null
    }
    // Only dpr/maxCacheBytes are true construction options (dpr re-keys the whole
    // sprite cache). size/variant/background apply in place (effects below).
    // selfScroll/scrollParentRef are read lazily inside the viewport closure (a
    // stable ref object), so they intentionally do not retrigger creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dpr, maxCacheBytes])

  // ---- in-place option updates (no renderer teardown) ------------------------
  // These re-key the sprite cache lazily (a new size/variant/background re-rasters
  // on the next cache miss) while keeping the renderer and every animation clock
  // alive — so toggling size or fancy<->flat no longer flashes/glitches. They are
  // no-ops on the create-effect's own first run (the renderer already constructed
  // with these values, so each setter early-returns on equal value).
  React.useEffect(() => {
    rendererRef.current?.setSize(size)
  }, [size])
  React.useEffect(() => {
    rendererRef.current?.setVariant(variant)
  }, [variant])
  React.useEffect(() => {
    rendererRef.current?.setBackground(background)
  }, [background])

  // ---- backing-store sizing + DPR + content-width tracking -------------------
  // ONE ResizeObserver on the canvas (width) AND the active scroller (viewport
  // height) drives: (1) the renderer's resize() with the live CSS box + dpr, (2)
  // the contentWidth state grid auto-flow reads, and (3) viewportH, the pinned
  // canvas's CSS height. We measure SYNCHRONOUSLY here (same component, same
  // render — the scroller is our own ref, so no parent-effect ordering race) and
  // seed viewportH before the first paint, so the very first frame is correctly
  // sized (the previous design read a null external ref here and deadlocked at
  // cssH=0 → a 1px backing store CSS-stretched into vertical smears).
  React.useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const apply = (): void => {
      const r = rendererRef.current
      const scroller = selfScroll ? scrollerRef.current : (scrollParentRef?.current ?? null)
      // Width comes from the canvas (100% of the content box). Height is the
      // VIEWPORT (scroller) height — NEVER canvas.clientHeight when a scroller
      // exists (the canvas height IS what we are setting → circular). The
      // canvas.clientHeight fallback only covers a brief pre-scroller window.
      const cssW = canvas.clientWidth
      const cssH = scroller ? scroller.clientHeight : canvas.clientHeight
      const d = currentDpr(dpr)
      r?.resize(cssW, cssH, d)
      r?.setViewport({
        scrollTop: scroller ? scroller.scrollTop : 0,
        scrollLeft: scroller ? scroller.scrollLeft : 0,
        height: cssH,
        width: cssW,
      })
      setContentWidth((prev) => (prev === cssW ? prev : cssW))
      // UNGATED (the old `if (sp)` gate is what deadlocked viewportH at 0): the
      // canvas is always pinned/viewport-sized now, so always track viewportH.
      setViewportH((prev) => (prev === cssH ? prev : cssH))
    }

    apply()

    // Observe the canvas (width) AND the active scroller (viewport height) — the
    // scroller resizing changes the pinned canvas height + cull window. In
    // self-scroll mode the scroller is our own element, present in this same
    // render, so there is no null hole.
    const ro = new ResizeObserver(apply)
    ro.observe(canvas)
    const scrollerForObserve = selfScroll ? scrollerRef.current : scrollParentRef?.current
    if (scrollerForObserve) ro.observe(scrollerForObserve)

    // React to DPR changes (e.g. dragging a window between monitors), since DPR
    // changes don't fire a ResizeObserver. Re-bind on each ratio change.
    let mq: MediaQueryList | null = null
    const onDprChange = (): void => {
      apply()
      bindDprListener()
    }
    function bindDprListener(): void {
      if (typeof window === 'undefined' || !window.matchMedia) return
      mq?.removeEventListener('change', onDprChange)
      mq = window.matchMedia(`(resolution: ${currentDpr(dpr)}dppx)`)
      mq.addEventListener('change', onDprChange)
    }
    bindDprListener()

    return () => {
      ro.disconnect()
      mq?.removeEventListener('change', onDprChange)
    }
  }, [dpr, selfScroll, scrollParentRef])

  // ---- culling: track the active scroller ------------------------------------
  // Push viewport rects to the renderer on scroll of the active scroller (rAF-
  // throttled) so off-screen tiles are skipped. The scroller is our own element in
  // self-scroll mode (the default), or the external scrollParentRef when overridden.
  React.useEffect(() => {
    const scroller = selfScroll ? scrollerRef.current : scrollParentRef?.current
    if (!scroller) return

    let pending = false
    const push = (): void => {
      rendererRef.current?.setViewport({
        scrollTop: scroller.scrollTop,
        scrollLeft: scroller.scrollLeft,
        height: scroller.clientHeight,
        width: scroller.clientWidth,
      })
    }
    const onScroll = (): void => {
      if (pending) return
      pending = true
      requestAnimationFrame(() => {
        pending = false
        push()
      })
    }

    push() // initial sync
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [selfScroll, scrollParentRef])

  // ---- items: chars + layout + size/cols/gap ---------------------------------
  // Recompute whenever the inputs change. For grid layout this depends on the
  // measured contentWidth (to derive columns when `cols` is not given). Stored so
  // the canvas height effect can size the element without recomputing.
  const items = React.useMemo(
    () => computeItems(chars, layout, size, gap, cols, contentWidth),
    [chars, layout, size, gap, cols, contentWidth],
  )

  React.useEffect(() => {
    rendererRef.current?.setItems(items)
  }, [items])

  // ---- declarative "animate all" ---------------------------------------------
  // play('all', animate) sets/clears the clock for every current char. Re-applied
  // when the char set changes so a freshly-supplied batch picks up the active
  // declarative animation (parity with <Picto>'s `animate` re-applying on rebuild).
  React.useEffect(() => {
    rendererRef.current?.play('all', animate ?? null)
  }, [animate, chars])

  // ---- canvas height: tall enough to lay out every tile ----------------------
  // Explicit layout: the max (y + size) across positions. Grid: derived rows.
  // The width is owned by CSS (the element is display:block, width:100%); height
  // is set inline so the scroll parent can scroll the full field.
  const fieldHeight = React.useMemo(() => {
    if (layout !== 'grid') {
      let max = 0
      const n = Math.min(chars.length, layout.length)
      for (let i = 0; i < n; i++) max = Math.max(max, layout[i].y + size)
      return max
    }
    const step = size + gap
    const c = cols && cols > 0 ? Math.floor(cols) : Math.max(1, Math.floor((contentWidth + gap) / step))
    return gridHeight(chars.length, c, size, gap)
  }, [chars.length, layout, size, gap, cols, contentWidth])

  // SELF-SCROLL (the default): PictoField owns its overflow:auto scroller (sized by
  // `height`). The <canvas> is FIRST and position:sticky top:0 — pinned to the
  // scroller's viewport top, sized to one viewport (viewportH). The spacer follows
  // with marginTop:-viewportH so it overlays the canvas's own box and supplies
  // exactly `fieldHeight` of native scroll range. One viewport-tall canvas is
  // reused for every frame; the renderer offsets each draw by scrollTop. Backing
  // store stays viewport-bounded (never field-sized), so any count is safe.
  if (selfScroll) {
    return (
      <div
        ref={scrollerRef}
        className={className}
        style={{ position: 'relative', width: '100%', height, overflow: 'auto' }}
      >
        <canvas
          ref={canvasRef}
          style={{
            position: 'sticky',
            top: 0,
            left: 0,
            display: 'block',
            width: '100%',
            height: viewportH,
            ...style,
          }}
        />
        <div style={{ width: '100%', height: fieldHeight, marginTop: -viewportH }} />
      </div>
    )
  }

  // EXTERNAL OVERRIDE (scrollParentRef given): the canvas is position:sticky at the
  // external scroller's viewport top, sized to viewportH, over a full-field-height
  // spacer wrapper so the external ancestor scrolls the whole field natively. The
  // sizing effect now measures that external scroller and seeds viewportH ungated,
  // so this path no longer deadlocks at cssH=0 (the old smear bug).
  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: fieldHeight }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'sticky', top: 0, display: 'block', width: '100%', height: viewportH, ...style }}
      />
    </div>
  )
})
