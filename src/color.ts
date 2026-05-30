// OKLCH color core — ported from the original generator. Used to read the
// light/dark anchors out of a body SVG's gradient stops and to synthesize new
// hues that match the artists' hand-tuned envelope.

const sRGBlin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linSRGB = (c: number) => {
  c = Math.max(0, Math.min(1, c))
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
}

export function hexToOklch(h: string): [number, number, number] {
  h = h.replace('#', '')
  const r = sRGBlin(parseInt(h.slice(0, 2), 16) / 255)
  const g = sRGBlin(parseInt(h.slice(2, 4), 16) / 255)
  const b = sRGBlin(parseInt(h.slice(4, 6), 16) / 255)
  let l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  let m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  let s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  l = Math.cbrt(l)
  m = Math.cbrt(m)
  s = Math.cbrt(s)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [L, Math.hypot(a, bb), ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360]
}

function oklchRGB(L: number, C: number, H: number): number[] {
  const a = C * Math.cos((H * Math.PI) / 180)
  const b = C * Math.sin((H * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(linSRGB)
}

// Convert OKLCH back to a hex string, walking chroma down until it fits sRGB gamut.
export function oklchToHex(L: number, C: number, H: number): string {
  let r = 0
  let g = 0
  let b = 0
  for (let i = 0; i < 40; i++) {
    ;[r, g, b] = oklchRGB(L, C, H)
    if (Math.min(r, g, b) >= -0.0008 && Math.max(r, g, b) <= 1.0008) break
    C *= 0.93
  }
  const f = (c: number) =>
    Math.round(Math.max(0, Math.min(1, c)) * 255)
      .toString(16)
      .padStart(2, '0')
  return '#' + f(r) + f(g) + f(b)
}

// Shortest signed hue delta, in (-180, 180].
export const arc = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180

export const stopsOf = (svg: string) =>
  [...svg.matchAll(/stop-color="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1])

export interface Anchor {
  /** [L, C, H, dL, dC, dH] — lightest stop + delta to the darkest stop. */
  p: [number, number, number, number, number, number]
  light: string
  dark: string
}

// Read the lightest/darkest gradient stops of a body SVG as an OKLCH anchor.
export function anchorOf(svg: string): Anchor {
  const st = stopsOf(svg)
  const light = st.reduce((a, b) => (hexToOklch(b)[0] > hexToOklch(a)[0] ? b : a))
  const dark = st.reduce((a, b) => (hexToOklch(b)[0] < hexToOklch(a)[0] ? b : a))
  const [Ll, Cl, Hl] = hexToOklch(light)
  const [Ld, Cd, Hd] = hexToOklch(dark)
  return { p: [Ll, Cl, Hl, Ld - Ll, Cd - Cl, arc(Hd - Hl)], light, dark }
}
