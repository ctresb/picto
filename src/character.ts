// A Character is a resolved spec + an SVG renderer + a tiny animation emitter.
// The emitter lets `char.blink()` drive a mounted <Picto char={char} />.

import { compose, resolve } from './engine'
import { hashSeed } from './rng'
import type { CharInput, Resolved, Variant } from './engine'

export type AnimName = 'blink' | 'jump' | 'breath' | 'dance' | 'sleeping'

/** name = animation to play, or null to stop. */
export interface AnimEvent {
  name: AnimName | null
}
type Listener = (e: AnimEvent) => void

export interface SvgOptions {
  /** Add a background tile (default false). Omit/false -> transparent. */
  background?: boolean
  /** Id prefix to keep filters/gradients unique across SVGs in one document. */
  uid?: string
  /**
   * Render style (default 'fancy'). 'flat' drops filters + the body gradient for
   * cheaper paint — use it when rendering large grids that must stay smooth.
   */
  variant?: Variant
}

function safeUid(uid: string): string {
  return uid.replace(/[^a-zA-Z0-9_-]/g, '') || 'p_'
}

export class Character {
  /** The fully-resolved, concrete spec. */
  readonly config: Resolved
  /** Stable id prefix derived from the spec — keeps .svg() deterministic. */
  private readonly _uid: string
  private _listeners = new Set<Listener>()

  constructor(input: CharInput = 0) {
    this.config = resolve(input)
    this._uid = 'p' + hashSeed(JSON.stringify(this.config)).toString(36) + '_'
  }

  /** Render this character to a standalone SVG string. */
  svg(opts: SvgOptions = {}): string {
    const c = this.config
    const { background = false, variant = 'fancy' } = opts
    const uid = safeUid(opts.uid ?? this._uid)
    return compose({
      light: c.light,
      dark: c.dark,
      shape: c.shape,
      bg: c.bg,
      eye: c.eye,
      brow: c.brow,
      mode: c.mode,
      tuning: c.tuning,
      uid,
      background,
      variant,
    })
  }

  toString(): string {
    return this.svg()
  }

  // ---- imperative animation (no-ops unless a <Picto> is mounted) ----
  /** Blink once. */
  blink(): this {
    return this._emit('blink')
  }
  /** Hop once. */
  jump(): this {
    return this._emit('jump')
  }
  /** Breathe (loops until stop or another animation). */
  breath(): this {
    return this._emit('breath')
  }
  /** Dance (loops until stop or another animation). */
  dance(): this {
    return this._emit('dance')
  }
  /** Sleep (loops until stop or another animation). */
  sleep(): this {
    return this._emit('sleeping')
  }
  /** Stop any running animation. */
  stop(): this {
    return this._emit(null)
  }

  /** @internal — used by <Picto> to react to animation calls. */
  _subscribe(fn: Listener): () => void {
    this._listeners.add(fn)
    return () => {
      this._listeners.delete(fn)
    }
  }

  private _emit(name: AnimName | null): this {
    this._listeners.forEach((l) => l({ name }))
    return this
  }
}
