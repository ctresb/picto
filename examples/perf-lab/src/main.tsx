// Picto Perf Lab — a stress harness for the <Picto> renderer + its shared
// animation ticker.
//
// What it exercises:
//   - Mounting hundreds/thousands of distinct-seed pictos at once (mount cost).
//   - A scrollable, fixed-height grid so most tiles sit OFF-SCREEN — the library
//     drives every active picto from ONE shared requestAnimationFrame loop and a
//     shared IntersectionObserver gates the per-frame transform WRITE by
//     visibility (clock keeps advancing, so loops resume with no phase jump),
//     plus will-change is bound to on-screen animating tiles. Scrolling a big
//     animating batch shows how cheap off-screen pictos stay.
//   - Fanning a single imperative call (blink/jump/breath/dance/sleep/stop) out
//     to EVERY held Character instance at once.
//   - A steady-state "auto-animate (breath) on mount" mode via the declarative
//     `animate` prop for continuous load.
//
// A fixed metrics overlay runs its own rAF loop to report real frame cadence
// (FPS via EMA), instantaneous frame time, picto count, # animating, and the
// last batch build time.
//
// Note on React.StrictMode: it is intentionally OFF here. This lab is a
// BENCHMARK, not a correctness harness — StrictMode double-invokes effects in
// dev (mount -> cleanup -> mount), which would re-run the library's
// subscribe/unsubscribe + IntersectionObserver wiring (react.tsx) twice for
// EVERY heavy tile, doubling the mount/unmount churn that windowing already
// stresses and inflating the reported frame times. Rendering <App /> directly
// keeps the numbers representative. (Also note: `npm run dev` is still a React
// DEV build; for true production cadence, measure `vite build && vite preview`.)

import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { picto } from 'pictoguys'
import type { Character } from 'pictoguys'
import type { AnimName } from 'pictoguys'
import { PictoGrid } from './PictoGrid'
import type { PictoGridHandle } from './PictoGrid'
import { PictoCanvasGrid } from './PictoCanvasGrid'
import { Metrics } from './Metrics'
import './styles.css'

const PRESETS = [50, 100, 250, 500, 1000] as const

type Variant = 'fancy' | 'flat'
/** Which renderer backs the count-grid. */
type Renderer = 'dom' | 'canvas'

// Imperative actions the toolbar fans out to every Character.
// `loops` marks the ones that keep running (so we can report # animating).
// `declare` (for the looping ones) is the AnimName we ALSO push into the grid's
// declarative `animate` prop — because the grid is windowed, a tile that scrolls
// back into view RE-MOUNTS, and the library does NOT replay a past imperative
// loop on a fresh mount. Driving loops declaratively makes re-mounted tiles
// resume the active animation. One-shots (Blink/Jump) need no such persistence,
// and Stop clears the declarative loop. (Note: c.sleep() emits 'sleeping'.)
const ACTIONS: {
  name: string
  loops: boolean
  declare: AnimName | null
  run: (c: Character) => void
}[] = [
  { name: 'Blink', loops: false, declare: null, run: (c) => c.blink() },
  { name: 'Jump', loops: false, declare: null, run: (c) => c.jump() },
  { name: 'Breath', loops: true, declare: 'breath', run: (c) => c.breath() },
  { name: 'Dance', loops: true, declare: 'dance', run: (c) => c.dance() },
  { name: 'Sleep', loops: true, declare: 'sleeping', run: (c) => c.sleep() },
  { name: 'Stop', loops: false, declare: null, run: (c) => c.stop() },
]

function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.min(1000, Math.round(n)))
}

function clampSize(n: number): number {
  if (!Number.isFinite(n)) return 64
  return Math.max(24, Math.min(160, Math.round(n)))
}

function App() {
  const [count, setCount] = React.useState(100)
  const [size, setSize] = React.useState(64)
  const [background, setBackground] = React.useState(false)
  // The renderer backing the count-grid. DEFAULTS to 'canvas' — the peak-perf
  // path this lab demonstrates (one <canvas>, internal culling, no per-tile
  // mount/unmount). 'dom' falls back to the existing windowed <Picto> grid. Both
  // grids surface the same PictoGridHandle (chars[]) so runAction()/Metrics are
  // fully mode-agnostic and every other control feeds both.
  const [renderer, setRenderer] = React.useState<Renderer>('canvas')
  // The lab DEFAULTS to 'flat': flat removes the body inner-shadow filter +
  // gradient, which is the single biggest per-visible-tile paint win (SVG
  // filters force CPU raster and cannot be GPU-composited, so they re-raster on
  // every scroll repaint). This is purely the EXAMPLE's default — the library
  // default stays variant='fancy' (react.tsx PictoProps), so nothing about the
  // byte-identical fancy output changes. Toggle to Fancy for single/hero pictos.
  const [variant, setVariant] = React.useState<Variant>('flat')
  const [autoAnimate, setAutoAnimate] = React.useState(false)
  // The looping animation driven DECLARATIVELY into the (windowed) grid, so
  // tiles that scroll back into view re-mount already playing it. A null value
  // means no toolbar-driven loop is active. The auto-animate checkbox layers a
  // 'breath' loop on top of this (see the effective `autoName` below).
  const [loopAnim, setLoopAnim] = React.useState<AnimName | null>(null)
  const [currentAnim, setCurrentAnim] = React.useState<string>('idle')
  const [animating, setAnimating] = React.useState(0)
  const [mountMs, setMountMs] = React.useState(0)

  const gridRef = React.useRef<PictoGridHandle>(null)

  const onBuilt = React.useCallback((ms: number) => setMountMs(ms), [])

  // Fan an imperative action out to every held Character instance (the FULL
  // chars[] — even windowed-out tiles' Characters get the call). For LOOPING
  // actions we also set the declarative loop so re-mounted tiles resume it;
  // one-shots clear it; Stop clears it and halts everything.
  const runAction = React.useCallback(
    (action: (typeof ACTIONS)[number]) => {
      const chars = gridRef.current?.chars ?? []
      for (let i = 0; i < chars.length; i++) action.run(chars[i])
      // Stop and one-shots end the persistent loop; looping actions set it.
      setLoopAnim(action.declare)
      setCurrentAnim(action.name.toLowerCase())
      setAnimating(action.loops ? chars.length : 0)
    },
    [],
  )

  // When the batch size changes, any per-picto loop on the old (replaced)
  // instances is torn down, so the "animating" tally and declarative loop reset.
  React.useEffect(() => {
    setLoopAnim(null)
    setAnimating(0)
    setCurrentAnim('idle')
  }, [count])

  // Effective declarative animation fed to the grid: the auto-animate (breath)
  // checkbox wins when checked; otherwise the last toolbar-triggered loop (if
  // any). Either way, windowed-in tiles re-mount already playing it.
  const autoName: AnimName | null = autoAnimate ? 'breath' : loopAnim
  React.useEffect(() => {
    if (autoAnimate) {
      setAnimating(count)
      setCurrentAnim('breath (auto)')
    }
  }, [autoAnimate, count])

  return (
    <main className="shell">
      <header className="bar">
        <h1>Picto Perf Lab</h1>

        <div className="group">
          <label htmlFor="count">count</label>
          <input
            id="count"
            type="number"
            min={1}
            max={1000}
            value={count}
            onChange={(e) => setCount(clampCount(e.currentTarget.valueAsNumber))}
          />
          <div className="presets">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className={count === p ? 'active' : undefined}
                onClick={() => setCount(p)}
              >
                {p}
              </button>
            ))}
          </div>
          <input
            type="range"
            min={1}
            max={1000}
            value={count}
            onChange={(e) => setCount(clampCount(e.currentTarget.valueAsNumber))}
            aria-label="picto count"
          />
        </div>

        <span className="sep" />

        <div className="group">
          <label htmlFor="size">size</label>
          <input
            id="size"
            type="range"
            min={24}
            max={160}
            value={size}
            onChange={(e) => setSize(clampSize(e.currentTarget.valueAsNumber))}
            aria-label="picto size"
          />
          <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 44 }}>{size}px</span>
        </div>

        <span className="sep" />

        <div className="group">
          <label>
            <input
              type="checkbox"
              checked={background}
              onChange={(e) => setBackground(e.currentTarget.checked)}
            />{' '}
            background
          </label>
          <label>
            <input
              type="checkbox"
              checked={autoAnimate}
              onChange={(e) => setAutoAnimate(e.currentTarget.checked)}
            />{' '}
            auto-animate (breath)
          </label>
        </div>

        <span className="sep" />

        {/* DOM|Canvas renderer segmented control (mirrors the FANCY|FLAT markup).
            Defaults to Canvas — the high-performance path: the whole count-grid
            is ONE <canvas> (the library's <PictoField> batch renderer) that culls
            to the visible window itself, so it holds hundreds-to-thousands of
            animated pictos at 60fps. DOM falls back to the windowed <Picto> grid
            (which caps ~250@20fps). Every other control feeds both modes. */}
        <div className="group">
          <label id="renderer-label">renderer</label>
          <div className="segmented" role="group" aria-labelledby="renderer-label">
            <button
              type="button"
              className={renderer === 'dom' ? 'active' : undefined}
              aria-pressed={renderer === 'dom'}
              onClick={() => setRenderer('dom')}
              title="DOM: the existing windowed <Picto> SVG-in-DOM grid (caps ~250 pictos at ~20fps)"
            >
              DOM
            </button>
            <button
              type="button"
              className={renderer === 'canvas' ? 'active' : undefined}
              aria-pressed={renderer === 'canvas'}
              onClick={() => setRenderer('canvas')}
              title="Canvas (default, high-performance): ONE <canvas> batch renderer (PictoField) — holds the full field at 60fps"
            >
              Canvas
            </button>
          </div>
          <span className="hint">Canvas is the high-performance path · DOM caps ~250@20fps</span>
        </div>

        <span className="sep" />

        {/* FANCY|FLAT segmented control. The lab DEFAULTS to 'flat' (cheapest
            paint at scale: no body inner-shadow filter, no gradient). 'fancy'
            renders byte-identically to the library default and is best for a
            single/hero picto where the richer look matters. Both stay fully
            selectable. */}
        <div className="group">
          <label id="variant-label">style</label>
          <div className="segmented" role="group" aria-labelledby="variant-label">
            <button
              type="button"
              className={variant === 'fancy' ? 'active' : undefined}
              aria-pressed={variant === 'fancy'}
              onClick={() => setVariant('fancy')}
              title="Fancy: inner-shadow filters + gradient body (richest look, best for a single/hero picto)"
            >
              Fancy
            </button>
            <button
              type="button"
              className={variant === 'flat' ? 'active' : undefined}
              aria-pressed={variant === 'flat'}
              onClick={() => setVariant('flat')}
              title="Flat (lab default): no body gradient, no body shadow (keeps eye shadow), solid body fill — the biggest scroll-paint win for big grids"
            >
              Flat
            </button>
          </div>
          <span className="hint">flat (default) for big grids · fancy for hero pictos</span>
        </div>

        <span className="sep" />

        <div className="group actions">
          {ACTIONS.map((a) => (
            <button key={a.name} type="button" onClick={() => runAction(a)}>
              {a.name}
            </button>
          ))}
        </div>

        <span
          className="hint"
          style={{ marginLeft: 'auto' }}
          title="`npm run dev` is a React DEV build and runs slower than production. For representative perf, measure a production build: `npm run build` then `npm run preview` (vite build && vite preview)."
        >
          dev build — measure perf via `npm run build` + `npm run preview`
        </span>

        <span style={{ fontSize: 13, opacity: 0.7 }}>
          state: <strong>{currentAnim}</strong>
        </span>
      </header>

      <section className="grid-wrap" aria-label="picto stress grid">
        {/* Both grids take the IDENTICAL props + the same gridRef handle (they
            each surface PictoGridHandle.chars), so the ACTIONS toolbar fan-out
            and the Metrics overlay are mode-agnostic. DOM = windowed <Picto>
            grid; Canvas = ONE <PictoField> canvas with internal culling. */}
        {renderer === 'dom' ? (
          <PictoGrid
            ref={gridRef}
            count={count}
            size={size}
            background={background}
            variant={variant}
            autoAnimate={autoName}
            onBuilt={onBuilt}
          />
        ) : (
          <PictoCanvasGrid
            ref={gridRef}
            count={count}
            size={size}
            background={background}
            variant={variant}
            autoAnimate={autoName}
            onBuilt={onBuilt}
          />
        )}
      </section>

      <Metrics count={count} animating={animating} mountMs={mountMs} />
    </main>
  )
}

// StrictMode is intentionally omitted (see header note): it would double-invoke
// effects in dev and inflate the benchmark's mount/unmount churn + frame times.
createRoot(document.getElementById('root') as HTMLElement).render(<App />)
