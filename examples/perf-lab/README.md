# Picto Perf Lab

A stress harness for `pictoguys` — mount hundreds-to-thousands of distinct-seed
pictos, animate them, scroll the batch, and read real frame cadence from the
live Metrics overlay (FPS / frame ms / count / animating / mount ms).

## DOM vs Canvas (the A/B)

The toolbar has a **`renderer` segmented control: DOM | Canvas** (next to
FANCY | FLAT). It defaults to **Canvas** — the high-performance path this lab
demonstrates.

- **DOM** renders the existing windowed `<Picto>` SVG-in-DOM grid. It caps out:
  ~250 pictos ≈ 20fps / ~270ms frames even in a production build.
- **Canvas** renders the SAME N-grid as **one** `<canvas>` via the library's
  `<PictoField>` batch renderer (Canvas 2D + cached sprites). Culling to the
  visible window is internal to the renderer (driven by the `.grid-wrap` scroll
  element), so there is **no per-tile mount/unmount** — it should hold the field
  at **60fps** for hundreds-to-thousands of animated pictos.

Both modes are fed by the SAME controls — count (slider + presets), size,
background, variant (flat | fancy), auto-animate (breath), and the ACTIONS
toolbar (Blink / Jump / Breath / Dance / Sleep / Stop) — and both surface the
same `chars[]` handle, so the toolbar fan-out and the Metrics overlay are
mode-agnostic.

**To A/B:** set count = 1000, pick a size + variant + auto-animate, then flip
DOM ↔ Canvas and read FPS/frame in the overlay. The Canvas field stays at 60fps
where DOM falls over.

Canvas mode visually matches the SVG output: it rasterizes the same composed SVG
layers (`character.layers()`) to cached sprites and mirrors the SVG's
`transform-box: fill-box` animation math (`character.contentBox()` + the shared
`ZZZ` data), so the pixels at the rasterized size and the motion match `<Picto>`.

## Running

```sh
pnpm install
pnpm dev        # React DEV build (slower; good for iterating)
```

For representative perf numbers, measure a production build:

```sh
pnpm build && pnpm preview   # vite build && vite preview
```

> `pnpm dev` is a React DEV build and runs slower than production. The overlay's
> FPS reflects the dev build's overhead too.

## Refreshing the local library after a rebuild

`pictoguys` is a **`file:../..` COPY dependency** here, so pnpm copies the
library's `dist/` into this example's `node_modules` at install time. After you
rebuild the library at the repo root (`pnpm build` / `npm run build` — which
runs `tsup`, including the new `react-canvas` and `canvas` entries), you **must
re-run `pnpm install`** in this example to refresh the copied `dist/`:

```sh
# at the repo root
pnpm build
# then, in examples/perf-lab
pnpm install
```

(`vite.config.ts` already lists `optimizeDeps.exclude: ['pictoguys']`, so once
the copied `dist/` is refreshed Vite serves the live build on every reload — no
stale pre-bundle.)
