// Live metrics overlay.
//
// Runs its OWN requestAnimationFrame loop purely as a measurement instrument —
// it is independent of whatever per-picto rAF loops the library spins up. The
// loop samples the real frame cadence and smooths FPS with an EMA so the number
// is readable under load.

import * as React from 'react'

export interface MetricsProps {
  /** Total pictos currently mounted in the grid. */
  count: number
  /** How many pictos are currently being animated (driven by toolbar state). */
  animating: number
  /** Wall-clock time (ms) it took to build the last batch of characters. */
  mountMs: number
}

export function Metrics({ count, animating, mountMs }: MetricsProps) {
  const [fps, setFps] = React.useState(0)
  const [frameMs, setFrameMs] = React.useState(0)

  React.useEffect(() => {
    let raf = 0
    let last = 0
    let ema = 0
    // Throttle React state updates to ~10/s so the overlay itself stays cheap
    // and does not become a confound in the measurement.
    let lastPaint = 0

    const step = (ts: number) => {
      if (last) {
        const dt = ts - last
        if (dt > 0) {
          const inst = 1000 / dt
          ema = ema ? ema * 0.9 + inst * 0.1 : inst
          if (ts - lastPaint > 100) {
            lastPaint = ts
            setFps(ema)
            setFrameMs(dt)
          }
        }
      }
      last = ts
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])

  const fpsClass = fps >= 55 ? 'fps-good' : fps >= 30 ? 'fps-mid' : 'fps-bad'

  return (
    <div className="metrics" aria-hidden="true">
      <div className="row">
        <span className="k">FPS</span>
        <span className={`v ${fpsClass}`}>{fps.toFixed(0)}</span>
      </div>
      <div className="row">
        <span className="k">frame</span>
        <span className="v">{frameMs.toFixed(1)} ms</span>
      </div>
      <div className="row">
        <span className="k">pictos</span>
        <span className="v">{count}</span>
      </div>
      <div className="row">
        <span className="k">animating</span>
        <span className="v">{animating}</span>
      </div>
      <div className="row">
        <span className="k">mount</span>
        <span className="v">{mountMs.toFixed(1)} ms</span>
      </div>
    </div>
  )
}
