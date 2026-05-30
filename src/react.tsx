// <Picto /> — render a character and play its animations.
//
//   <Picto seed={7} />                              seed in, character out
//   <Picto config={{ color: 'blue', eyes: 'double' }} />
//   <Picto char={c} animate="breath" />             declarative loop
//   c.blink()                                       imperative (drives any mounted <Picto char={c} />)

import * as React from 'react'
import { Character } from './character'
import type { AnimName } from './character'
import type { CharInput } from './engine'

// progress p in 0..1 -> CSS transform for the target group
interface AnimDef {
  loop: boolean
  dur: number
  target: 'char' | 'eyes'
  f: (p: number) => string
}
const TAU = Math.PI * 2
const ANIMS: Record<AnimName, AnimDef> = {
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

// rAF tween on the .char / .eyes group. Returns a stop() that resets the transform.
function runAnim(svg: SVGElement, name: AnimName): () => void {
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
  config?: CharInput
  /** Rendered size in px (width = height). Default 120. */
  size?: number
  /** Include the background tile. Default true. */
  background?: boolean
  /** Play an animation declaratively. */
  animate?: AnimName
}

export const Picto = React.forwardRef<HTMLSpanElement, PictoProps>(function Picto(
  { char, seed, config, size = 120, background = true, animate, style, ...rest },
  ref,
) {
  // stable, SSR-safe id prefix (no colons — they break url(#id) refs)
  const uid = 'p' + React.useId().replace(/[^a-zA-Z0-9]/g, '') + '_'

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
