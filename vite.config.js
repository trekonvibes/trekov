import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Three pages out of one build: the marketing site at /, the app at /app/,
// and the invite lander at /i/ that decides which of the two you get sent to.
// base is '/' because the custom domain (trekov.in) serves from the root.
// Content-Security-Policy for the built pages (GitHub Pages can't send headers,
// so it goes in a <meta>). No inline scripts are allowed, so injected markup
// can't run code. Only production builds get it: the dev server relies on
// inline scripts for hot reload.
function csp(supabaseUrl) {
  const supa = supabaseUrl ? new URL(supabaseUrl).host : ''
  const policy = [
    "default-src 'self'",
    // Google Maps needs eval and blob: for its own scripts; Razorpay Checkout.
    "script-src 'self' https://maps.googleapis.com https://*.gstatic.com https://checkout.razorpay.com 'unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    // Photos come from many hosts (Supabase storage, Wikimedia, Google Places).
    "img-src 'self' data: blob: https:",
    `connect-src 'self' ${supa ? `https://${supa} wss://${supa}` : ''} https://*.googleapis.com https://*.gstatic.com https://*.google.com https://tiles.openfreemap.org https://elevation-tiles-prod.s3.amazonaws.com https://router.project-osrm.org https://*.razorpay.com data: blob:`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'self' https://*.google.com https://api.razorpay.com https://checkout.razorpay.com",
    "media-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
  return {
    name: 'trekov-csp',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }],
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), csp(loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL)],
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
}))
