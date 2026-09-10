// Offline map support.
//
// Tiles, fonts and icons live in the Cache Storage API, where the service
// worker hands them straight back to MapLibre once the network is gone. The
// map data is OpenStreetMap via OpenFreeMap: ODbL permits offline copies with
// credit, and OpenFreeMap sets no limits on use. The imagery this replaced,
// Esri's World Imagery, is not licensed for exporting tiles offline.

import { latToTileY, lngToTileX } from './geo'

export const TILE_CACHE = 'trekov-tiles-v2'
const LEGACY_CACHES = ['trekov-tiles-v1']

const HOST = 'https://tiles.openfreemap.org'
export const STYLE_URL = `${HOST}/styles/liberty`
const TILEJSON_URL = `${HOST}/planet`
const SPRITE = `${HOST}/sprites/ofm_f384/ofm`
const FONTS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic']

/**
 * Glyph blocks to keep. The style prints each place's native-script name
 * beside its Latin one, so a route from Gujarat to Kashmir needs Gujarati,
 * Devanagari, Gurmukhi and Urdu — without these, half of every label would
 * be missing offline. Latin, Latin Extended, Arabic (for Urdu), every Indian
 * script block and general punctuation; each checked to exist for all three
 * fonts.
 */
const GLYPH_RANGES = ['0-255', '256-511', '1536-1791', '2304-2559', '2560-2815',
  '2816-3071', '3072-3327', '3328-3583', '8192-8447']

/**
 * Bytes a vector tile takes once stored, by zoom — measured by downloading
 * tiles along Ahmedabad to Jaipur, cities and open highway both, not guessed.
 * Low zooms are heavy per tile but there are few; zoom 14 is where the count,
 * and so the size, lives.
 */
const BYTES_PER_TILE = {
  6: 161_000, 7: 122_000, 8: 80_000, 9: 65_000, 10: 47_000,
  11: 37_000, 12: 55_000, 13: 30_000, 14: 34_000,
}

/** Style, tile index, icons and fonts: paid once, whatever the route. */
const FIXED_BYTES = 42_000 + 19_000 + 218_000 + FONTS.length * GLYPH_RANGES.length * 60_000

const MIN_ZOOM = 6
/**
 * The deepest zoom OpenFreeMap serves. Beyond it MapLibre draws from these
 * same tiles, so nothing deeper is needed to stay sharp at street level.
 */
const MAX_ZOOM = 14

/**
 * How far either side of the road to keep. Width, not zoom: zoom 14 is
 * already every detail there is, so the real choice is how far from the route
 * the map should reach. A zoom-14 tile is about 2.2 km across in India.
 */
export const DETAIL = {
  standard: { label: 'Standard', radius: 1, blurb: 'The road and about 3 km either side' },
  wide:     { label: 'Wide',     radius: 3, blurb: 'Out to about 7 km — nearby towns too' },
}

/**
 * The same tile under every weekly build.
 *
 * OpenFreeMap puts its build date in the tile path — /planet/20260906_080001_pt/
 * — and publishes a new build weekly. Saved under the dated address, a route
 * would stop matching the week the tile index moved on, and the offline map
 * would go blank with no error to say why. This file and public/sw.js both
 * store tiles under the date-free form; keep the two in step.
 */
export const canonicalTileKey = (url) =>
  url.replace(/\/planet\/[^/]+\/(\d+\/\d+\/\d+\.pbf)$/, '/planet/_/$1')

/** The current build's tile address, read from the tile index. */
export async function offlineTileTemplate() {
  const res = await fetch(TILEJSON_URL).catch(() => null)
  const tiles = res?.ok ? (await res.json())?.tiles?.[0] : null
  if (!tiles) throw new Error('Could not reach the map server to plan this download.')
  return tiles
}

/** Everything the map needs besides tiles: style, index, icons, fonts. */
export function fixedAssetUrls() {
  return [
    STYLE_URL, TILEJSON_URL,
    `${SPRITE}.json`, `${SPRITE}.png`, `${SPRITE}@2x.json`, `${SPRITE}@2x.png`,
    ...FONTS.flatMap((f) => GLYPH_RANGES.map((r) => `${HOST}/fonts/${encodeURIComponent(f)}/${r}.pbf`)),
  ]
}

/**
 * Every tile a route's corridor needs, from the country view to zoom 14,
 * costed without fetching anything.
 *
 * Every zoom in the band, not every other one: a missing zoom is a blank map
 * at that zoom. Consecutive route points are interpolated in tile space so a
 * sparse polyline cannot skip a tile between two of its vertices.
 */
export function planRouteDownload(coordinates, level, tileTemplate) {
  const depthRadius = DETAIL[level]?.radius ?? 1
  const pts = coordinates ?? []
  const keys = new Set()
  const byZoom = {}

  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
    // Width only matters close in: at zoom 8 one tile already spans ~150 km.
    const radius = z >= 12 ? depthRadius : 1
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

  const tile = (z, x, y) => tileTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y)
  // Fixed assets first: a download stopped early should still leave a map that
  // can draw its labels and icons over whatever tiles did arrive.
  const urls = fixedAssetUrls()
  let bytes = FIXED_BYTES
  for (const key of keys) {
    const [z, x, y] = key.split('/').map(Number)
    urls.push(tile(z, x, y))
    bytes += BYTES_PER_TILE[z] ?? 40_000
  }
  return { urls, positions: keys.size, bytes, byZoom, level }
}

/** How much room the browser will give us. */
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

export const formatBytes = (b) =>
  b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.round(b / 1e3)} KB`

/** Fetch the offline engine while there is signal. See mapDrivers/maplibre.js. */
export async function warmOfflineEngine() {
  try { (await import('./mapDrivers/maplibre')).warm() } catch {}
}

const supported = () => typeof caches !== 'undefined'

/**
 * Download into the cache, reporting progress. Already-saved items are
 * skipped, so re-running over an overlapping route is cheap.
 */
export async function downloadTiles(urls, onProgress, { signal } = {}) {
  if (!supported()) throw new Error('This browser cannot store maps offline.')
  const cache = await caches.open(TILE_CACHE)
  let done = 0
  let failed = 0

  // Small batches: hundreds of parallel requests get throttled or dropped.
  const BATCH = 6
  for (let i = 0; i < urls.length; i += BATCH) {
    // What is already saved stays saved; stopping only skips the rest.
    if (signal?.aborted) return { total: urls.length, failed, cancelled: true, done }
    await Promise.all(urls.slice(i, i + BATCH).map(async (url) => {
      try {
        // Fetched from the dated address the server has; stored under the
        // date-free key the service worker will look up.
        const key = canonicalTileKey(url)
        if (!(await cache.match(key))) {
          const res = await fetch(url, { signal })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          await cache.put(key, res)
        }
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
  return { count, approxMB: +((count * 40_000) / 1e6).toFixed(1) }
}

export async function clearTiles() {
  if (!supported()) return
  await Promise.all([TILE_CACHE, ...LEGACY_CACHES].map((c) => caches.delete(c)))
}
