import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const fromDemo = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^react$/, replacement: fromDemo('./node_modules/react/index.js') },
      { find: /^react\/jsx-dev-runtime$/, replacement: fromDemo('./node_modules/react/jsx-dev-runtime.js') },
      { find: /^react\/jsx-runtime$/, replacement: fromDemo('./node_modules/react/jsx-runtime.js') },
      { find: /^react-dom$/, replacement: fromDemo('./node_modules/react-dom/index.js') },
      { find: /^react-dom\/client$/, replacement: fromDemo('./node_modules/react-dom/client.js') },
    ],
  },
  // pictoguys is a local `file:../..` dep. Vite pre-bundles deps ONCE and caches
  // them under node_modules/.vite; an in-place `tsup` rebuild of the library does
  // NOT invalidate that cache (the file: version string is unchanged), so dev
  // would keep serving a STALE pre-bundle (this is why flat/seam fixes appeared
  // to "do nothing"). Excluding it from optimizeDeps makes Vite serve the live
  // dist on every reload — no stale bundle, ever.
  optimizeDeps: {
    exclude: ['pictoguys'],
  },
})
