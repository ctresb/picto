import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/rng.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: true,
  minify: false,
  external: ['react', 'react/jsx-runtime'],
})
