import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Three pages out of one build: the marketing site at /, the app at /app/,
// and the invite lander at /i/ that decides which of the two you get sent to.
// base is '/' because the custom domain (trekov.in) serves from the root.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  // Build output and the native projects are not source. Watching them meant
  // every `npm run android` or deploy rewrote an index.html the dev server
  // could see, and it answered by reloading whatever page was open.
  server: {
    watch: { ignored: ['**/dist/**', '**/dist-native/**', '**/android/**', '**/ios/**'] },
  },
  // MapLibre is loaded on demand, so the dev server would otherwise meet it
  // for the first time mid-session, re-optimise, and reject that first load as
  // an outdated dependency. Preparing it at startup avoids that.
  optimizeDeps: { include: ['maplibre-gl'] },
  // MapLibre starts its workers as ES modules; build them in that format so
  // the worker it is handed is one it can run.
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app/index.html'),
        invite: resolve(import.meta.dirname, 'i/index.html'),
      },
    },
  },
})
