/* Trekov service worker.
 *
 * Two jobs:
 *   1. keep the app shell openable with no network
 *   2. serve the offline map — the tiles, fonts and icons a traveller saved
 *
 * The map comes from OpenFreeMap (OpenStreetMap data, ODbL, which permits
 * offline copies). Tiles, fonts and icons are cache-first: they are what lets
 * the map work with the radio off. The style and tile index change weekly, so
 * they are network-first and fall back to the saved copy. App files are
 * network-first so a deploy is picked up immediately.
 */
const SHELL = 'trekov-shell-v1'
// v1 held Esri imagery, which is not licensed for offline use. The new name
// means activate clears it along with every other cache not listed here.
const TILES = 'trekov-tiles-v2'
const MAP_HOST = 'tiles.openfreemap.org'

// Identical to canonicalTileKey in src/lib/offline.js, which this file cannot
// import — it is served exactly as written. OpenFreeMap puts a weekly build
// date in the tile path; tiles are stored without it so a saved route keeps
// matching after the next build.
const canonicalTileKey = (url) =>
  url.replace(/\/planet\/[^/]+\/(\d+\/\d+\/\d+\.pbf)$/, '/planet/_/$1')

// The style and the tile index name the current build; everything else under
// the map host is effectively immutable.
const isLive = (path) => path === '/planet' || path.startsWith('/styles/')

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

  if (url.hostname === MAP_HOST) {
    e.respondWith(serveMap(request, url))
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

async function serveMap(request, url) {
  const cache = await caches.open(TILES)

  if (isLive(url.pathname)) {
    try {
      const res = await fetch(request)
      if (res.ok) cache.put(request, res.clone())
      return res
    } catch {
      return (await cache.match(request)) ||
        new Response('', { status: 503, statusText: 'Offline, map index not saved' })
    }
  }

  const key = canonicalTileKey(request.url)
  const hit = await cache.match(key)
  if (hit) return hit
  try {
    const res = await fetch(request)
    if (res.ok) cache.put(key, res.clone())
    return res
  } catch {
    // Outside the saved corridor. 404 rather than an error: MapLibre draws a
    // 404 as an empty tile and carries on, where anything else is reported as
    // a failure for every blank square of map.
    return new Response(null, { status: 404, statusText: 'Not saved for offline' })
  }
}
