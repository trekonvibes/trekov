// Offline map support.
//
// Tiles are stored in the Cache Storage API (not IndexedDB) so the service
// worker can serve them straight back to Leaflet on a cache-first rule, with
// no involvement from app code once they are down.

import { TILE_URL, latToTileY, lngToTileX } from './geo'

export const TILE_CACHE = 'trekov-tiles-v1'

const LABEL_URL = (z, x, y) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`

/**
 * Bytes per tile, imagery plus its label overlay, measured by downloading
 * real tiles along Ahmedabad to Jaipur rather than guessed. Imagery sits
 * between 15 and 21 KB; labels are heavy at low zoom (whole country names)
 * and nearly empty at street level.
 */
const BYTES_PER_TILE = { 8: 23_300, 9: 23_200, 10: 23_100, 11: 21_500, 12: 19_900, 13: 21_400, 14: 22_900, 15: 21_700 }

/** Download levels a traveller can choose between. */
export const DETAIL = {
  standard: { label: 'Standard', maxZoom: 14, blurb: 'Roads, towns and turnings' },
  detailed: { label: 'Detailed', maxZoom: 15, blurb: 'Closer in at junctions' },
}

const CAP_KEY = 'trekov.offlineMaxZoom'
/** The highest zoom that has been saved, so the offline map knows where to stop. */
export const savedMaxZoom = () => Number(localStorage.getItem(CAP_KEY)) || null

/** Zoom levels worth keeping: enough to see the region and the final approach. */
const ZOOMS = [8, 10, 12, 14]
const RADIUS = 2 // tiles either side at each zoom

export function tilesFor(lat, lng, zooms = ZOOMS, radius = RADIUS) {
  const urls = []
  for (const z of zooms) {
    const cx = lngToTileX(lng, z)
    const cy = latToTileY(lat, z)
    const max = 2 ** z
    for (let x = cx - radius; x <= cx + radius; x++) {
      for (let y = cy - radius; y <= cy + radius; y++) {
        if (y < 0 || y >= max) continue
        urls.push(TILE_URL(z, ((x % max) + max) % max, y))
      }
    }
  }
  return urls
}

/** Tiles covering a whole route, sampled so a long route stays affordable. */
export function tilesForRoute(coordinates, zooms = [10, 12]) {
  const step = Math.max(1, Math.floor(coordinates.length / 60))
  const seen = new Set()
  for (let i = 0; i < coordinates.length; i += step) {
    const [lat, lng] = coordinates[i]
    for (const url of tilesFor(lat, lng, zooms, 1)) seen.add(url)
  }
  return [...seen]
}

/**
 * Every tile a route's corridor needs, from the country view down to
 * `maxZoom`, without downloading anything.
 *
 * Every zoom in the band, not every other one: Leaflet does not fall back to
 * a coarser tile when one is missing, so a gap at zoom 13 is a blank map at
 * zoom 13. The old download cached 10 and 12 only, which meant offline
 * navigation at street level showed nothing at all.
 *
 * Consecutive route points are interpolated in tile space, so a sparse
 * polyline cannot skip a tile between two of its vertices.
 */
export function planRouteDownload(coordinates, maxZoom = DETAIL.standard.maxZoom, { minZoom = 8, radius = 1 } = {}) {
  const pts = coordinates?.length ? coordinates : []
  const keys = new Set()
  const byZoom = {}

  for (let z = minZoom; z <= maxZoom; z++) {
    const max = 2 ** z
    const before = keys.size
    const add = (x, y) => {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          const ty = y + dy
          if (ty < 0 || ty >= max) continue
          keys.add(`${z}/${(((x + dx) % max) + max) % max}/${ty}`)
        }
      }
    }
    for (let i = 0; i < pts.length; i++) {
      const x1 = lngToTileX(pts[i][1], z)
      const y1 = latToTileY(pts[i][0], z)
      if (i === 0) { add(x1, y1); continue }
      const x0 = lngToTileX(pts[i - 1][1], z)
      const y0 = latToTileY(pts[i - 1][0], z)
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
      for (let k = 1; k <= steps; k++) {
        add(Math.round(x0 + ((x1 - x0) * k) / steps), Math.round(y0 + ((y1 - y0) * k) / steps))
      }
    }
    byZoom[z] = keys.size - before
  }

  const urls = []
  let bytes = 0
  for (const key of keys) {
    const [z, x, y] = key.split('/').map(Number)
    urls.push(TILE_URL(z, x, y), LABEL_URL(z, x, y))
    bytes += BYTES_PER_TILE[z] ?? 22_000
  }
  return { urls, positions: keys.size, bytes, byZoom, maxZoom }
}

/** How much room the browser will give us, and whether it may evict it. */
export async function storageRoom() {
  try {
    const { quota = 0, usage = 0 } = (await navigator.storage?.estimate?.()) ?? {}
    return { free: Math.max(0, quota - usage), quota }
  } catch {
    return { free: null, quota: null }
  }
}

/**
 * Ask the browser not to clear our tiles under storage pressure.
 *
 * Without this a phone low on space can quietly evict the map someone
 * downloaded for a trip, and they find out when the signal drops.
 */
export async function keepTiles() {
  try { return (await navigator.storage?.persist?.()) ?? false } catch { return false }
}

export const rememberSavedZoom = (z) => {
  if (z > (savedMaxZoom() ?? 0)) localStorage.setItem(CAP_KEY, String(z))
}

export const formatBytes = (b) =>
  b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.round(b / 1e3)} KB`

const supported = () => typeof caches !== 'undefined'

/**
 * Download tiles into the cache, reporting progress. Already-cached tiles are
 * skipped, so re-running over an overlapping area is cheap.
 */
export async function downloadTiles(urls, onProgress, { signal } = {}) {
  if (!supported()) throw new Error('This browser cannot store maps offline.')
  const cache = await caches.open(TILE_CACHE)
  let done = 0
  let failed = 0

  // Small batches: hundreds of parallel requests get throttled or dropped.
  const BATCH = 6
  for (let i = 0; i < urls.length; i += BATCH) {
    // Tiles already saved stay saved; cancelling only stops the rest.
    if (signal?.aborted) return { total: urls.length, failed, cancelled: true, done }
    await Promise.all(urls.slice(i, i + BATCH).map(async (url) => {
      try {
        if (!(await cache.match(url))) await cache.add(url)
      } catch {
        failed++
      } finally {
        done++
        onProgress?.(done, urls.length, failed)
      }
    }))
  }
  return { total: urls.length, failed }
}

export async function cachedTileCount() {
  if (!supported()) return 0
  const cache = await caches.open(TILE_CACHE)
  return (await cache.keys()).length
}

/** Rough size on disk. Cache Storage has no per-entry size, so estimate. */
export async function cacheEstimate() {
  const count = await cachedTileCount()
  return { count, approxMB: +((count * 18_000) / 1e6).toFixed(1) }
}

export async function clearTiles() {
  if (!supported()) return
  await caches.delete(TILE_CACHE)
}
