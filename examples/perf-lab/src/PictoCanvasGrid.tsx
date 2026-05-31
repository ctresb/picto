// The CANVAS counterpart to PictoGrid.tsx — the high-performance path under test.
//
// Builds the SAME `count` DISTINCT-seed Characters via picto.character(i) for
// seeds 0..count-1 (memoized by count, and timed the same way -> onBuilt), then
// renders the WHOLE batch as ONE <canvas> via the library's <PictoField> batch
// renderer (Canvas 2D + cached sprites). Unlike the DOM PictoGrid there is NO
// per-tile mount/unmount: the field is a single canvas and culling to the
// visible window is INTERNAL to the renderer.
//
// SELF-CONTAINED SCROLLER: <PictoField> is given an explicit `height` so it owns
// its OWN overflow:auto scroller (the canvas is pinned to that viewport; a
// full-field spacer scrolls natively). We pass height="100%" so the field's
// scroller fills the surrounding `.grid-wrap` (height:70vh) and is the SINGLE
// scroll context in canvas mode — `.grid-wrap` switches to overflow:hidden so
// there is no nested double-scroller. This deliberately REPLACES the previous
// design where this component found the scroll parent via
// wrapRef.current.parentElement inside a layout effect and passed it down as
// scrollParentRef: React runs CHILD effects before PARENT effects, so the child
// <PictoField> saw a null scroll parent at mount and mis-sized its backing store
// (the vertical-smear / trails bug). Owning the scroller inside <PictoField>
// removes that cross-component mount-order race entirely.
//
// The full chars[] is surfaced via useImperativeHandle (PictoGridHandle), so the
// ACTIONS toolbar fan-out in main.tsx works IDENTICALLY in both modes: it calls
// c.blink()/c.jump()/c.breath()/... on every Character, and the canvas renderer
// (which subscribes to each char._subscribe) drives the canvas exactly like a
// mounted <Picto char={c} /> drives the DOM. The declarative looping animation
// is fed via the same `autoAnimate` prop so it persists across scroll (the
// canvas never unmounts, so there is no re-mount replay concern — but the prop
// is still honored for parity with the DOM mode's wiring).
//
// Props are IDENTICAL to PictoGrid's, and the handle is the same PictoGridHandle,
// so main.tsx's runAction()/Metrics are fully mode-agnostic.
//
// Wrapped in React.memo so toolbar re-renders that only change overlay state
// never rebuild the chars[].

import * as React from 'react'
import { picto } from 'pictoguys'
import type { Character } from 'pictoguys'
import type { AnimName } from 'pictoguys'
import { PictoField } from 'pictoguys/react-canvas'
import type { PictoGridHandle } from './PictoGrid'

type Variant = 'fancy' | 'flat'

/** Grid gap in px — kept in sync with PictoField's default GAP + the DOM grid. */
const GAP = 12

export interface PictoCanvasGridProps {
  count: number
  size: number
  background: boolean
  /** Visual style forwarded to <PictoField>. 'fancy' | 'flat'. */
  variant: Variant
  /** When set, every char plays this animation declaratively on the canvas. */
  autoAnimate: AnimName | null
  /** Called after a batch is (re)built with the wall-clock build time in ms. */
  onBuilt?: (mountMs: number) => void
}

export const PictoCanvasGrid = React.memo(
  React.forwardRef<PictoGridHandle, PictoCanvasGridProps>(function PictoCanvasGrid(
    { count, size, background, variant, autoAnimate, onBuilt },
    ref,
  ) {
    // Build (and time) the FULL batch. Re-runs only when `count` changes — a clean
    // measurement of constructing `count` Characters, identical to PictoGrid so the
    // two modes' mount numbers are comparable.
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

    // Surface the FULL chars[] so the toolbar can fan an imperative call out to
    // every Character (the renderer subscribes to char._subscribe internally).
    React.useImperativeHandle(ref, () => ({ chars }), [chars])

    // <PictoField> is self-contained: passing `height="100%"` makes it own its
    // OWN overflow:auto scroller (filling the `.grid-wrap` height:70vh box), so it
    // culls to its visible window with NO external scrollParentRef and NO
    // cross-component mount-order race. The wrapper div still carries the --tile
    // var + fills the height so the field's scroller fills the stage.
    return (
      <div className="canvas-grid" style={{ ['--tile' as string]: `${size}px`, height: '100%' }}>
        <PictoField
          chars={chars}
          size={size}
          background={background}
          variant={variant}
          animate={autoAnimate}
          gap={GAP}
          height="100%"
        />
      </div>
    )
  }),
)
