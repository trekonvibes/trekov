/* Trekov service worker.
 *
 * Two jobs:
 *   1. keep the app shell openable with no network
 *   2. serve map tiles the user downloaded for offline use
 *
 * Tiles are cache-first and never revalidated — satellite imagery does not
 * change, and the point is that they work with the radio off. App files are
 * network-first so a deploy is picked up immediately, falling back to cache.
 */
const SHELL = 'trekov-shell-v1'
const TILES = 'trekov-tiles-v1'
const TILE_HOST = 'server.arcgisonline.com'

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(['/', '/app/', '/i/', '/favicon.svg']))
      .catch(() => {})            // a missing shell file must not block install
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL && k !== TILES).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const { request } = e
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  if (url.hostname === TILE_HOST) {
    e.respondWith(
      caches.open(TILES).then(async (cache) => {
        const hit = await cache.match(request)
        if (hit) return hit
        try {
          const res = await fetch(request)
          if (res.ok) cache.put(request, res.clone())
          return res
        } catch {
          // Offline with no tile for this square: let Leaflet show its gap.
          return new Response('', { status: 504, statusText: 'Offline, tile not cached' })
        }
      }),
    )
    return
  }

  if (url.origin !== self.location.origin) return

  e.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone()
        caches.open(SHELL).then((c) => c.put(request, copy)).catch(() => {})
        return res
      })
      .catch(async () =>
        (await caches.match(request)) ||
        (await caches.match('/app/')) ||
        new Response('Offline', { status: 503 })),
  )
})
