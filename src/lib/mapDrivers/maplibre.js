// MapLibre + OpenFreeMap: the offline engine, and the fallback whenever
// Google will not load.
//
// Vector tiles built from OpenStreetMap, drawn on the device. Two things make
// this the right offline engine where Esri imagery was not. The terms allow
// it — the data is ODbL, which permits offline copies with credit, and
// OpenFreeMap sets no limits on use. And a vector tile at zoom 14 carries
// everything that exists at that spot, so the map stays sharp at street level
// instead of stretching a photograph.
//
// Loaded on demand by mapDrivers/index.js, so nobody on Google Maps downloads
// it until they need it.

import * as maplibre from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// The worker, bundled with the shared code it imports. MapLibre works out its
// worker's address from a variable, which Vite cannot follow, so without this
// the production build shipped no worker at all and the offline map could
// never start. `?worker&url` bundles it and hands back where it landed.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { STYLE_URL } from '../tileSource'

maplibre.setWorkerUrl(workerUrl)

let seq = 0

/**
 * Start MapLibre's background workers now, while there is signal.
 *
 * The worker script is fetched the first time a map is built, not when this
 * module loads. Someone who has only ever seen the Google map would reach
 * their first dead zone with the engine cached and its workers not — and the
 * offline map would never start. Warming them during a route download puts
 * the worker in the service worker's cache while it still can be.
 */
export function warm() {
  maplibre.prewarm?.()
  // Workers only need to live long enough to be fetched and cached.
  setTimeout(() => maplibre.clearPrewarmedResources?.(), 15_000)
}

const lineFeature = (lls) => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: lls.map(([lat, lng]) => [lng, lat]) },
})

export function createMaplibreMap(el, { center, zoom, zoomControl = false, minZoom = 3 }) {
  const map = new maplibre.Map({
    container: el,
    style: STYLE_URL,
    center: [center[1], center[0]],
    zoom,
    // Further out the world just repeats, tiny, across the screen.
    minZoom,
    // OpenStreetMap's licence needs the credit visible. Compact folds it
    // behind an (i) on a phone instead of dropping it.
    attributionControl: { compact: true },
    // Navigation sets the bearing itself when it wants one; a map a rider
    // turned by accident with two fingers is just disorienting.
    dragRotate: false,
  })
  map.touchZoomRotate.disableRotation()
  if (zoomControl) map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'bottom-right')

  // Missing tiles are expected offline — the corridor saved is not the whole
  // country — and arrive as 404s, which MapLibre draws as empty. Anything else
  // is worth one line in the console rather than one per blank square.
  map.on('error', (e) => {
    const msg = e?.error?.message || ''
    if (!/404|Failed to fetch|NetworkError/i.test(msg)) console.info('Trekov: map —', msg)
  })

  // Sources and layers can only be added once the style has arrived, and
  // route lines are usually asked for before that, so they wait in line.
  let loaded = false
  let gone = false
  const pending = []
  map.once('load', () => { loaded = true; pending.splice(0).forEach((fn) => fn()) })
  const whenReady = (fn) => { if (gone) return; if (loaded) fn(); else pending.push(fn) }

  // Our lines sit under the style's labels, so a route never hides a town
  // name. Casings go under the lines they outline.
  let lineIds = []
  const firstSymbol = () => map.getStyle()?.layers?.find((l) => l.type === 'symbol')?.id

  setTimeout(() => { if (!gone) map.resize() }, 0)

  return {
    kind: 'maplibre',
    raw: map,
    destroy: () => { gone = true; pending.length = 0; map.remove() },
    invalidateSize: () => map.resize(),
    setView: (ll, z, { animate = true } = {}) =>
      map.easeTo({ center: [ll[1], ll[0]], zoom: z ?? map.getZoom(), duration: animate ? 500 : 0 }),
    flyTo: (ll, z) => map.flyTo({ center: [ll[1], ll[0]], zoom: z ?? map.getZoom(), duration: 700 }),
    getZoom: () => map.getZoom(),
    getCenter: () => { const c = map.getCenter(); return [c.lat, c.lng] },
    fitBounds: (lls, pad = 48) => {
      if (!lls?.length) return
      const b = new maplibre.LngLatBounds()
      for (const [lat, lng] of lls) b.extend([lng, lat])
      map.fitBounds(b, { padding: pad, duration: 500 })
    },
    size: () => ({ x: el.clientWidth, y: el.clientHeight }),
    // Screen space, so it stays right when the map is rotated or tilted.
    offsetLatLng: (ll, dx, dy) => {
      const p = map.project([ll[1], ll[0]])
      const r = map.unproject([p.x + dx, p.y + dy])
      return [r.lat, r.lng]
    },
    onClick: (fn) => {
      const h = (e) => fn([e.lngLat.lat, e.lngLat.lng])
      map.on('click', h)
      return () => map.off('click', h)
    },
    onDragStart: (fn) => { map.on('dragstart', fn); return () => map.off('dragstart', fn) },
    onZoomEnd: (fn) => {
      const h = () => fn(map.getZoom())
      map.on('zoomend', h)
      return () => map.off('zoomend', h)
    },

    htmlMarker: (ll, html, { size = [44, 44], anchor, zIndex = 0, className = 'tk-marker', onClick } = {}) => {
      const [ax, ay] = anchor ?? [size[0] / 2, size[1] / 2]
      const box = document.createElement('div')
      box.className = className
      box.style.width = `${size[0]}px`
      box.style.height = `${size[1]}px`
      box.style.zIndex = String(zIndex)
      box.style.cursor = onClick ? 'pointer' : 'default'
      box.innerHTML = html
      if (onClick) box.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
      const m = new maplibre.Marker({ element: box, anchor: 'top-left', offset: [-ax, -ay] })
        .setLngLat([ll[1], ll[0]])
        .addTo(map)
      return {
        setLatLng: (p) => m.setLngLat([p[1], p[0]]),
        el: box,
        setHtml: (h) => { box.innerHTML = h },
        remove: () => m.remove(),
      }
    },

    polyline: (lls, { color = '#00C08B', weight = 5, opacity = 0.9, back = false } = {}) => {
      const id = `tk-line-${++seq}`
      let current = lls
      let live = true
      whenReady(() => {
        if (!live) return
        map.addSource(id, { type: 'geojson', data: lineFeature(current) })
        const before = back ? (lineIds[0] ?? firstSymbol()) : firstSymbol()
        map.addLayer({
          id, type: 'line', source: id,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': color, 'line-width': weight, 'line-opacity': opacity },
        }, before)
        lineIds = back ? [id, ...lineIds] : [...lineIds, id]
      })
      return {
        remove: () => {
          live = false
          whenReady(() => {
            if (map.getLayer(id)) map.removeLayer(id)
            if (map.getSource(id)) map.removeSource(id)
            lineIds = lineIds.filter((x) => x !== id)
          })
        },
        setLatLngs: (p) => {
          current = p
          whenReady(() => map.getSource(id)?.setData(lineFeature(current)))
        },
        bounds: () => current,
      }
    },

    // A vector map can tilt and turn, so the 2D/3D control works offline too.
    supports3D: () => true,
    isVector: () => true,
    onRenderingType: () => () => {},      // always vector: nothing to wait for
    setTilt: (deg) => map.setPitch(deg),
    setHeading: (deg) => map.setBearing(deg),
    getTilt: () => map.getPitch(),
    // Traffic is a Google service; there is none to show offline.
    setTraffic: () => false,
    setMapType: () => {},
    mapTypes: () => [],
  }
}
