// The scrollable grid of pictos — the thing under test.
//
// Builds `count` DISTINCT-seed Characters via picto.character(i) for seeds
// 0..count-1, memoized by count so changing the count rebuilds the whole batch
// (and we time that rebuild). The FULL chars[] is always surfaced to the parent
// via useImperativeHandle, so the toolbar can fan an imperative call out to all
// of them regardless of which tiles are currently mounted.
//
// WINDOWING (P6) — the grid is uniform-row-height, so we hand-roll virtualization
// (no new dep): only the tiles whose row is in view (+ a small overscan) are
// mounted; everything else is just empty space reserved by a full-height spacer.
// This caps mounted <Picto> instances to ~visible+overscan (tens to low
// hundreds) for ANY count, which fixes BOTH the ~500ms initial mount (only the
// visible SVGs parse, not all 1000) and scroll paint, and bounds memory.
//
//   cols   = floor((innerW + gap) / (tile + gap))   (min 1)
//   rowH   = tile + gap
//   rows   = ceil(count / cols)
//   spacer height = rows * rowH - gap
//
// The visible row range is derived from the scroll container's scrollTop /
// clientHeight; we recompute on scroll (rAF-throttled) and on ResizeObserver of
// the container. Each mounted tile is absolutely positioned inside the spacer
// via translate(col*(tile+gap), row*rowH).
//
// Tiles that scroll out of the window UNMOUNT (tearing down any one-shot anim in
// flight on them) — acceptable in a perf lab; the library's shared-ticker
// already resets torn-down (disconnected) targets. Looping animations are driven
// declaratively via the `autoAnimate`/`currentAnim` props so a tile that scrolls
// back IN re-mounts already playing the active animation — see App's wiring.
//
// There is NO content-visibility on .tile (it was removed — it clipped the
// Jump/Dance/Sleep draws that intentionally exit the tile box). Instead, scroll
// churn is bounded three ways: (1) a larger OVERSCAN so jitter near a row
// boundary doesn't repeatedly mount/unmount heavy tiles; (2) ROW-CHUNK
// HYSTERESIS in measure() that quantizes the window to CHUNK-row steps, so most
// scroll ticks resolve to the same slice (zero remounts) and the window only
// re-slices when the viewport crosses a chunk boundary; (3) `contain: layout
// style` on .tile (styles.css) to isolate per-tile layout/style recalc. With
// the lab defaulting to the flat (filterless) variant, mounting overscan rows
// is cheap, so a generous overscan is a net win.
//
// Wrapped in React.memo so toolbar re-renders that only change overlay state
// never rebuild the tiles; `variant` is part of props so toggling it rebuilds.

import * as React from 'react'
import { Picto, picto } from 'pictoguys'
import type { Character } from 'pictoguys'
import type { AnimName } from 'pictoguys'

type Variant = 'fancy' | 'flat'

/** Grid gap in px — kept in sync with `.grid { gap }` in styles.css. */
const GAP = 12
/** Extra rows rendered above & below the viewport to hide scroll seams. Kept
 *  generous (6) so jitter near a row boundary doesn't repeatedly mount/unmount
 *  heavy tiles — cheap now that the lab defaults to the flat (filterless) style. */
const OVERSCAN = 6
/** Row-chunk hysteresis: the mounted window is quantized to CHUNK-row steps so
 *  the slice only changes when the viewport crosses a chunk boundary, collapsing
 *  most rAF scroll ticks to zero remounts (the setView dedupe then bails). */
const CHUNK = 4

export interface PictoGridHandle {
  /** The live Character instances backing ALL tiles (mounted or windowed-out). */
  readonly chars: readonly Character[]
}

export interface PictoGridProps {
  count: number
  size: number
  background: boolean
  /** Visual style forwarded to every <Picto>. 'fancy' (default) is byte-identical. */
  variant: Variant
  /** When set, every mounted tile plays this animation declaratively. */
  autoAnimate: AnimName | null
  /** Called after a batch is (re)built with the wall-clock build time in ms. */
  onBuilt?: (mountMs: number) => void
}

interface ViewState {
  /** First row index to mount (already includes the overscan margin). */
  firstRow: number
  /** Last row index to mount, inclusive (already includes overscan). */
  lastRow: number
  /** Columns per row at the current width. */
  cols: number
}

export const PictoGrid = React.memo(
  React.forwardRef<PictoGridHandle, PictoGridProps>(function PictoGrid(
    { count, size, background, variant, autoAnimate, onBuilt },
    ref,
  ) {
    // Build (and time) the FULL batch. Re-runs only when `count` changes, so
    // this is a clean measurement of constructing `count` Characters. chars[]
    // is always complete — windowing only changes which tiles MOUNT, never
    // which Characters exist, so toolbar fan-out still reaches every one.
    const chars = React.useMemo(() => {
      const t0 = performance.now()
      const arr: Character[] = new Array(count)
      for (let i = 0; i < count; i++) arr[i] = picto.character(i)
      const dt = performance.now() - t0
      // Defer the report so we don't call setState during another component's render.
      queueMicrotask(() => onBuilt?.(dt))
      return arr
      // onBuilt is intentionally excluded: we only want to rebuild on count change.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [count])

    React.useImperativeHandle(ref, () => ({ chars }), [chars])

    const gridRef = React.useRef<HTMLDivElement>(null)
    const rowH = size + GAP

    const [view, setView] = React.useState<ViewState>({ firstRow: 0, lastRow: 0, cols: 1 })

    // Recompute the visible window from the scroll container's geometry. Reads
    // the live scroll parent each call so it survives remounts/resizes.
    const measure = React.useCallback(() => {
      const grid = gridRef.current
      if (!grid) return
      // The scroll container is the nearest scrollable ancestor (.grid-wrap).
      const scroller = grid.parentElement
      if (!scroller) return

      const cs = getComputedStyle(scroller)
      const padL = parseFloat(cs.paddingLeft) || 0
      const padR = parseFloat(cs.paddingRight) || 0
      const padT = parseFloat(cs.paddingTop) || 0
      // Inner content width available to the grid (client width minus h-padding).
      const innerW = scroller.clientWidth - padL - padR

      const cols = Math.max(1, Math.floor((innerW + GAP) / (size + GAP)))

      // scrollTop is measured from the top of the scroller's content; the grid
      // starts after the scroller's top padding, so offset by it.
      const viewTop = scroller.scrollTop - padT
      const viewBottom = viewTop + scroller.clientHeight

      const firstVisible = Math.floor(viewTop / rowH)
      const lastVisible = Math.floor(viewBottom / rowH)

      // Row-chunk hysteresis: snap the overscanned window OUTWARD to CHUNK-row
      // boundaries. The mounted slice then only changes when the viewport
      // crosses a chunk boundary, so most scroll ticks produce the same
      // firstRow/lastRow and the setView dedupe below bails (zero remounts).
      const firstRow = Math.max(0, Math.floor((firstVisible - OVERSCAN) / CHUNK) * CHUNK)
      const lastRow = Math.ceil((lastVisible + OVERSCAN) / CHUNK) * CHUNK

      setView((prev) =>
        prev.firstRow === firstRow && prev.lastRow === lastRow && prev.cols === cols
          ? prev
          : { firstRow, lastRow, cols },
      )
    }, [size, rowH])

    // Wire scroll (rAF-throttled) + resize to the recompute.
    React.useEffect(() => {
      const grid = gridRef.current
      const scroller = grid?.parentElement
      if (!scroller) return

      let rafPending = false
      const onScroll = () => {
        if (rafPending) return
        rafPending = true
        requestAnimationFrame(() => {
          rafPending = false
          measure()
        })
      }

      measure() // initial sync
      scroller.addEventListener('scroll', onScroll, { passive: true })

      const ro = new ResizeObserver(() => measure())
      ro.observe(scroller)

      return () => {
        scroller.removeEventListener('scroll', onScroll)
        ro.disconnect()
      }
    }, [measure])

    // Measure on mount and whenever count/size change (row count / row height
    // changed). useLayoutEffect so the correct window is computed BEFORE the
    // first paint — otherwise the initial {0,0,1} view flashes a single tile for
    // one frame. The count change also rebuilds chars; the render clamps the
    // window down so we never try to render rows that no longer exist on shrink.
    React.useLayoutEffect(() => {
      measure()
    }, [count, size, measure])

    // Derive the slice to mount from the current window, clamped to count.
    const { cols } = view
    const totalRows = Math.max(1, Math.ceil(count / cols))
    const firstRow = Math.min(view.firstRow, Math.max(0, totalRows - 1))
    const lastRow = Math.min(view.lastRow, totalRows - 1)
    const start = firstRow * cols
    const end = Math.min(count, (lastRow + 1) * cols)
    const spacerHeight = totalRows * rowH - GAP

    const tiles: React.ReactNode[] = []
    for (let i = start; i < end; i++) {
      const c = chars[i]
      if (!c) continue
      const row = Math.floor(i / cols)
      const col = i % cols
      const x = col * (size + GAP)
      const y = row * rowH
      tiles.push(
        <div
          className="tile windowed"
          key={i}
          style={{ transform: `translate(${x}px, ${y}px)` }}
        >
          <Picto
            char={c}
            size={size}
            background={background}
            variant={variant}
            animate={autoAnimate ?? undefined}
          />
        </div>,
      )
    }

    return (
      <div
        ref={gridRef}
        className="grid"
        style={{ ['--tile' as string]: `${size}px`, height: `${spacerHeight}px` }}
      >
        {tiles}
      </div>
    )
  }),
)
