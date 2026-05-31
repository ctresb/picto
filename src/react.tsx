// <Picto /> — render a character and play its animations.
//
//   <Picto seed={7} />                              seed in, character out
//   <Picto config={{ color: 'blue', eyes: 'double' }} />
//   <Picto char={c} animate="breath" />             declarative loop
//   c.blink()                                       imperative (drives any mounted <Picto char={c} />)

import * as React from 'react'
import { Character } from './character'
import type { AnimName } from './character'
import type { CharConfig } from './engine'

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
    z.style.willChange = 'transform'

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

function runSleepingAnim(svg: SVGElement): () => void {
  const char = svg.querySelector<SVGElement>('.char')
  const eyes = svg.querySelector<SVGElement>('.eyes')
  if (!char || !eyes) return () => {}

  const zzz = makeSleepZzz()
  svg.appendChild(zzz)
  svg.style.overflow = 'visible'

  char.style.transformBox = 'fill-box'
  char.style.transformOrigin = '50% 100%'
  char.style.willChange = 'transform'
  eyes.style.transformBox = 'fill-box'
  eyes.style.transformOrigin = 'center'
  eyes.style.willChange = 'transform'
  eyes.style.transform = 'scaleY(0.08)'

  const zs = Array.from(zzz.children) as SVGGElement[]
  let raf = 0
  let start = 0
  const step = (ts: number) => {
    if (!char.isConnected || !eyes.isConnected || !zzz.isConnected) return
    if (!start) start = ts
    const p = ((ts - start) / 2800) % 1
    const breath = Math.sin(TAU * p)
    char.style.transform = `scaleY(${1 + 0.025 * breath}) scaleX(${1 - 0.012 * breath})`

    for (let i = 0; i < zs.length; i++) {
      const y = Math.sin(TAU * p + i * 0.85) * 1.6
      zs[i].style.transform = `translateY(${y}px)`
    }

    raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)

  return () => {
    cancelAnimationFrame(raf)
    char.style.transform = ''
    eyes.style.transform = ''
    zzz.remove()
  }
}

const reactUseId = (React as unknown as { useId?: () => string }).useId
let fallbackId = 0

function usePictoUid(): string {
  const id = reactUseId ? reactUseId() : React.useMemo(() => `r${++fallbackId}`, [])
  return 'p' + id.replace(/[^a-zA-Z0-9_-]/g, '') + '_'
}

// rAF tween on the .char / .eyes group. Returns a stop() that resets the transform.
function runAnim(svg: SVGElement, name: AnimName): () => void {
  if (name === 'sleeping') return runSleepingAnim(svg)

  const a = ANIMS[name]
  const target = svg.querySelector<SVGElement>('.' + a.target)
  if (!target) return () => {}
  svg.style.overflow = 'visible'
  target.style.transformBox = 'fill-box'
  target.style.transformOrigin = a.target === 'char' ? '50% 100%' : 'center'
  target.style.willChange = 'transform'
  let raf = 0
  let start = 0
  const step = (ts: number) => {
    if (!target.isConnected) return // svg was replaced/unmounted — drop the loop
    if (!start) start = ts
    const el = (ts - start) / a.dur
    const p = a.loop ? el % 1 : Math.min(1, el)
    target.style.transform = a.f(p)
    if (!a.loop && el >= 1) {
      target.style.transform = ''
      return
    }
    raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
  return () => {
    cancelAnimationFrame(raf)
    target.style.transform = ''
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
}

export const Picto = React.forwardRef<HTMLSpanElement, PictoProps>(function Picto(
  { char, seed, config, size = 120, background = false, animate, style, ...rest },
  ref,
) {
  // React 18+ uses useId for SSR-safe IDs; React 17 falls back to a client-stable id.
  const uid = usePictoUid()

  const character = React.useMemo(() => {
    if (char) return char
    if (config != null) return new Character(config)
    return new Character(seed ?? 0)
  }, [char, config, seed])

  const html = React.useMemo(() => character.svg({ background, uid }), [character, background, uid])

  const hostRef = React.useRef<HTMLSpanElement>(null)
  React.useImperativeHandle(ref, () => hostRef.current as HTMLSpanElement, [])

  const stopRef = React.useRef<(() => void) | null>(null)
  const play = React.useCallback((name: AnimName | null) => {
    stopRef.current?.()
    stopRef.current = null
    const svg = hostRef.current?.querySelector('svg') as SVGElement | null
    if (svg && name) stopRef.current = runAnim(svg, name)
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
