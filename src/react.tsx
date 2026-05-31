// <Picto /> — render a character and play its animations.
//
//   <Picto seed={7} />                              seed in, character out
//   <Picto config={{ color: 'blue', eyes: 'double' }} />
//   <Picto char={c} animate="breath" />             declarative loop
//   c.blink()                                       imperative (drives any mounted <Picto char={c} />)

import * as React from 'react'
import { Character } from './character'
import type { AnimName } from './character'
import type { CharConfig, Variant } from './engine'

// progress p in 0..1 -> CSS transform for the target group
interface AnimDef {
  loop: boolean
  dur: number
  target: 'char' | 'eyes'
  f: (p: number) => string
}
const TAU = Math.PI * 2
const ANIMS: Record<Exclude<AnimName, 'sleeping'>, AnimDef> = {
  blink: { loop: false, dur: 280, target: 'eyes', f: (p) => `scaleY(${1 - Math.sin(Math.PI * p) * 0.92})` },
  jump: {
    loop: false,
    dur: 640,
    target: 'char',
    f: (p) => {
      const y = Math.sin(Math.PI * p)
      return `translateY(${-28 * y}%) scaleX(${1 - 0.06 * y}) scaleY(${1 + 0.08 * y})`
    },
  },
  breath: {
    loop: true,
    dur: 2400,
    target: 'char',
    f: (p) => {
      const s = Math.sin(TAU * p)
      return `scaleY(${1 + 0.06 * s}) scaleX(${1 - 0.03 * s})`
    },
  },
  dance: {
    loop: true,
    dur: 720,
    target: 'char',
    f: (p) => {
      const s = Math.sin(TAU * p)
      return `translateX(${6 * s}%) translateY(${-4 * Math.abs(s)}%) rotate(${9 * s}deg)`
    },
  },
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const ZZZ_PATHS = [
  [
    'M20 3H14V0H26V3H23V6H20V3Z',
    'M14 9H17V6H20V9H26V12H14V9Z',
  ],
  [
    'M9 15H5V13H13V15H11V17H9V15Z',
    'M5 19H7V17H9V19H13V21H5V19Z',
  ],
  [
    'M3 23V24H2V23H0V22H4V23H3Z',
    'M0 25H1V24H2V25H4V26H0V25Z',
  ],
]

function makeSleepZzz(): SVGGElement {
  const wrap = document.createElementNS(SVG_NS, 'g')
  wrap.setAttribute('class', 'sleep-zzz')
  wrap.setAttribute('transform', 'translate(24 -2) scale(0.55)')
  wrap.style.pointerEvents = 'none'

  for (let i = 0; i < ZZZ_PATHS.length; i++) {
    const z = document.createElementNS(SVG_NS, 'g')
    z.setAttribute('class', `sleep-zzz-${i}`)

    for (const d of ZZZ_PATHS[i]) {
      const path = document.createElementNS(SVG_NS, 'path')
      path.setAttribute('d', d)
      path.setAttribute('fill', i === 0 ? '#3B2199' : i === 1 ? '#4F6FC4' : '#6CA3E2')
      z.appendChild(path)
    }

    wrap.appendChild(z)
  }

  return wrap
}

// ---- shared rAF ticker -----------------------------------------------------
// One module-level requestAnimationFrame loop drives every active picto, instead
// of N self-rescheduling loops. Each Entry keeps its OWN lazily-seeded start, so
// the per-target per-frame transform value is byte-identical to the old per-loop
// `if (!start) start = ts` behaviour. A single IntersectionObserver toggles
// `e.visible` to gate only the per-frame style WRITE (the clock always advances),
// and will-change is bound to actively-animating, on-screen targets.
interface Entry {
  /** The host <span> we observe for visibility. */
  host: Element
  /** The animated target group (.char or .eyes). */
  target: SVGElement
  /** The owning <svg> root, so every exit path can clear the AA shape-rendering override. */
  svg?: SVGElement
  isSleeping: boolean
  /** Sleeping only: the three zzz groups (tweened) and the eyes group (static pose). */
  zzzGroups?: SVGGElement[]
  eyes?: SVGElement
  /** Non-sleeping only. */
  dur?: number
  loop?: boolean
  f?: (p: number) => string
  /** 0 = unseeded; set to the first ts this entry is processed. */
  start: number
  visible: boolean
  done: boolean
}

const ENTRIES = new Set<Entry>()
let rafId = 0

// host span -> its active entries (a host has at most one active entry given
// stopRef, but an array keeps unregister robust).
const IO_TARGETS = new WeakMap<Element, Entry[]>()

const io =
  typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver(
        (records) => {
          for (const rec of records) {
            const list = IO_TARGETS.get(rec.target)
            if (!list) continue
            for (const e of list) {
              e.visible = rec.isIntersecting
              // Bound will-change to on-screen, actively-animating targets.
              setWillChange(e, e.visible ? 'transform' : '')
            }
          }
        },
        { rootMargin: '200px' },
      )
    : null

function setWillChange(e: Entry, v: string): void {
  e.target.style.willChange = v
  if (e.isSleeping) {
    if (e.eyes) e.eyes.style.willChange = v
    if (e.zzzGroups) for (const z of e.zzzGroups) z.style.willChange = v
  }
}

function register(e: Entry): () => void {
  ENTRIES.add(e)
  // Default visible=true so pre-observer frames render (identical to today, which
  // always writes). Promote the layer immediately; the observer demotes off-screen.
  setWillChange(e, 'transform')
  if (io) {
    const list = IO_TARGETS.get(e.host)
    if (list) list.push(e)
    else {
      IO_TARGETS.set(e.host, [e])
      io.observe(e.host)
    }
  }
  ensureRunning()
  return () => unregister(e)
}

function unregister(e: Entry): void {
  if (!ENTRIES.delete(e)) return
  if (io) {
    const list = IO_TARGETS.get(e.host)
    if (list) {
      const i = list.indexOf(e)
      if (i >= 0) list.splice(i, 1)
      if (list.length === 0) {
        IO_TARGETS.delete(e.host)
        io.unobserve(e.host)
      }
    }
  }
}

function tick(ts: number): void {
  for (const e of ENTRIES) stepEntry(e, ts)
  rafId = ENTRIES.size ? requestAnimationFrame(tick) : 0
}

function ensureRunning(): void {
  if (!rafId && ENTRIES.size) rafId = requestAnimationFrame(tick)
}

function stepEntry(e: Entry, ts: number): void {
  if (e.isSleeping) {
    const eyes = e.eyes as SVGElement
    const zs = e.zzzGroups as SVGGElement[]
    if (!e.target.isConnected || !eyes.isConnected || !zs[0]?.isConnected) {
      unregister(e)
      resetSleeping(e)
      return
    }
    if (!e.start) e.start = ts
    const p = ((ts - e.start) / 2800) % 1
    const breath = Math.sin(TAU * p)
    if (e.visible) {
      e.target.style.transform = `scaleY(${1 + 0.025 * breath}) scaleX(${1 - 0.012 * breath})`
      for (let i = 0; i < zs.length; i++) {
        const y = Math.sin(TAU * p + i * 0.85) * 1.6
        zs[i].style.transform = `translateY(${y}px)`
      }
    }
    return
  }

  if (!e.target.isConnected) {
    unregister(e)
    resetNonSleeping(e)
    return
  }
  if (!e.start) e.start = ts
  const el = (ts - e.start) / (e.dur as number)
  const p = e.loop ? el % 1 : Math.min(1, el)
  if (e.visible) e.target.style.transform = (e.f as (p: number) => string)(p)
  // Non-loop completion: the terminal '' clear MUST run regardless of visibility,
  // so a one-shot that finished off-screen is never stuck mid-pose.
  if (!e.loop && el >= 1) {
    e.target.style.transform = ''
    e.target.style.willChange = ''
    e.svg && (e.svg.style.shapeRendering = '')
    unregister(e)
  }
}

function resetNonSleeping(e: Entry): void {
  e.target.style.transform = ''
  e.target.style.willChange = ''
  e.svg && (e.svg.style.shapeRendering = '')
}

function resetSleeping(e: Entry): void {
  e.target.style.transform = ''
  e.target.style.willChange = ''
  if (e.eyes) {
    e.eyes.style.transform = ''
    e.eyes.style.willChange = ''
  }
  if (e.zzzGroups) {
    for (const z of e.zzzGroups) z.remove()
  }
  e.svg && (e.svg.style.shapeRendering = '')
}

function runSleepingAnim(svg: SVGElement, host: Element): () => void {
  const char = svg.querySelector<SVGElement>('.char')
  const eyes = svg.querySelector<SVGElement>('.eyes')
  if (!char || !eyes) return () => {}

  const zzz = makeSleepZzz()
  svg.appendChild(zzz)
  svg.style.overflow = 'visible'
  svg.style.shapeRendering = 'geometricPrecision'

  char.style.transformBox = 'fill-box'
  char.style.transformOrigin = '50% 100%'
  eyes.style.transformBox = 'fill-box'
  eyes.style.transformOrigin = 'center'
  eyes.style.transform = 'scaleY(0.08)'

  const zs = Array.from(zzz.children) as SVGGElement[]
  const entry: Entry = {
    host,
    target: char,
    svg,
    isSleeping: true,
    zzzGroups: zs,
    eyes,
    start: 0,
    visible: true,
    done: false,
  }
  const off = register(entry)

  return () => {
    off()
    char.style.transform = ''
    char.style.willChange = ''
    eyes.style.transform = ''
    eyes.style.willChange = ''
    zzz.remove()
    svg.style.shapeRendering = ''
  }
}

const reactUseId = (React as unknown as { useId?: () => string }).useId
let fallbackId = 0

function usePictoUid(): string {
  const id = reactUseId ? reactUseId() : React.useMemo(() => `r${++fallbackId}`, [])
  return 'p' + id.replace(/[^a-zA-Z0-9_-]/g, '') + '_'
}

// Registers a tween on the .char / .eyes group with the shared ticker.
// Returns a stop() that unregisters and resets the transform.
function runAnim(svg: SVGElement, name: AnimName, host: Element): () => void {
  if (name === 'sleeping') return runSleepingAnim(svg, host)

  const a = ANIMS[name]
  const target = svg.querySelector<SVGElement>('.' + a.target)
  if (!target) return () => {}
  svg.style.overflow = 'visible'
  svg.style.shapeRendering = 'geometricPrecision'
  target.style.transformBox = 'fill-box'
  target.style.transformOrigin = a.target === 'char' ? '50% 100%' : 'center'

  const entry: Entry = {
    host,
    target,
    svg,
    isSleeping: false,
    dur: a.dur,
    loop: a.loop,
    f: a.f,
    start: 0,
    visible: true,
    done: false,
  }
  const off = register(entry)

  return () => {
    off()
    target.style.transform = ''
    target.style.willChange = ''
    svg.style.shapeRendering = ''
  }
}

export interface PictoProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** An existing character (e.g. from picto.character). Wins over seed/config. */
  char?: Character
  /** Seed for a fresh character. */
  seed?: number | string
  /** Explicit config for a fresh character. */
  config?: CharConfig
  /** Rendered size in px (width = height). Default 120. */
  size?: number
  /** Add a background tile behind the picto. Default false (transparent). */
  background?: boolean
  /** Play an animation declaratively. */
  animate?: AnimName
  /**
   * Render style. 'fancy' (default) = filtered, gradient body — byte-identical to
   * prior output. 'flat' = no-filter, no-gradient, solid-fill (cheap to paint at scale).
   */
  variant?: Variant
}

export const Picto = React.forwardRef<HTMLSpanElement, PictoProps>(function Picto(
  { char, seed, config, size = 120, background = false, animate, variant = 'fancy', style, ...rest },
  ref,
) {
  // React 18+ uses useId for SSR-safe IDs; React 17 falls back to a client-stable id.
  const uid = usePictoUid()

  const character = React.useMemo(() => {
    if (char) return char
    if (config != null) return new Character(config)
    return new Character(seed ?? 0)
  }, [char, config, seed])

  const html = React.useMemo(
    () => character.svg({ background, uid, variant }),
    [character, background, uid, variant],
  )

  const hostRef = React.useRef<HTMLSpanElement>(null)
  React.useImperativeHandle(ref, () => hostRef.current as HTMLSpanElement, [])

  const stopRef = React.useRef<(() => void) | null>(null)
  const play = React.useCallback((name: AnimName | null) => {
    stopRef.current?.()
    stopRef.current = null
    const host = hostRef.current
    const svg = host?.querySelector('svg') as SVGElement | null
    if (host && svg && name) stopRef.current = runAnim(svg, name, host)
  }, [])

  // imperative: char.blink() / char.dance() / char.stop()
  React.useEffect(() => {
    return character._subscribe((e) => play(e.name))
  }, [character, play])

  // declarative: animate prop (re-applied when the SVG is rebuilt)
  React.useEffect(() => {
    play(animate ?? null)
    return () => {
      stopRef.current?.()
      stopRef.current = null
    }
  }, [animate, html, play])

  return (
    <span
      {...rest}
      ref={hostRef}
      style={{ display: 'inline-block', width: size, height: size, lineHeight: 0, overflow: 'visible', ...style }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})
