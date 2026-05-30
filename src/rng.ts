// Deterministic RNG + seed hashing. Kept in its own module (no part-data
// dependency) so importing just these does not pull in the SVG catalog.

export function mulberry32(a: number): () => number {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Fold any string/number into a uint32 seed (FNV-1a for strings).
export function hashSeed(s: string | number): number {
  if (typeof s === 'number') return s >>> 0
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
