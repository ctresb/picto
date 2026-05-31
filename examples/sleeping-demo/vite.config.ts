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
})
