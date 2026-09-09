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
