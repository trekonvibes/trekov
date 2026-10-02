// The route reel: a trip, drawn as a video a rider can post.
//
// The map is MapLibre on OpenStreetMap data (lib/tileSource.js), never Google.
// Google's terms do not allow their map inside a video someone publishes;
// OpenStreetMap's do, with credit — so the credit is painted into every frame
// rather than sitting in a corner of the app.
//
// Frames are rendered one at a time, not recorded in real time: the camera is
// moved, the map is given as long as it needs to draw that view, and only then
// is the frame encoded. A recording would drop frames on a phone busy
// downloading tiles, which is exactly when a rider would be making one.
//
// Always H.264 in MP4: Instagram will not take the WebM that MediaRecorder
// produces on Android, and a video a rider cannot post is not a feature.

import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
// MapLibre parses tiles and GeoJSON in a worker, and Vite cannot follow the
// address it works out for itself. Without this the reel rendered the style's
// background colour and nothing else: no roads, no route line.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { TILE_HOST } from './tileSource'
import { formatDuration } from './geo'
import { spriteId, SHEET, frameFor } from './vehicleSprites'

/**
 * Map styles the reel can wear. Dark is the default: white type over the light
 * street style was unreadable without covering most of the frame in a scrim,
 * and dark is what Trekov looks like anyway.
 */
export const STYLES = {
  dark:     { url: `${TILE_HOST}/styles/dark`,     label: 'Dark',   ink: '#0B0F0E' },
  fiord:    { url: `${TILE_HOST}/styles/fiord`,    label: 'Slate',  ink: '#10141C' },
  liberty:  { url: `${TILE_HOST}/styles/liberty`,  label: 'Street', ink: '#F4F1EA' },
  positron: { url: `${TILE_HOST}/styles/positron`, label: 'Light',  ink: '#F6F6F4' },
}

/** Frame shapes, each at two resolutions. 4K is four times the work of 1080p. */
export const SHAPES = {
  reel: { label: '9:16', hd: [1080, 1920], uhd: [2160, 3840] },
  post: { label: '1:1',  hd: [1080, 1080], uhd: [2160, 2160] },
  wide: { label: '16:9', hd: [1920, 1080], uhd: [3840, 2160] },
}

/** Dash patterns are measured in line widths, so they hold at any thickness. */
export const PATH_STYLES = {
  solid:  { label: 'Solid',  dash: null },
  dashed: { label: 'Dashed', dash: [2.2, 1.4] },
  bars:   { label: 'Bars',   dash: [1.1, 0.7] },
  dotted: { label: 'Dotted', dash: [0.01, 1.8] },   // a hair of line under a round cap
}

export const PATH_COLOURS = [
  { id: 'brand',  hex: '#00C08B' },
  { id: 'white',  hex: '#FFFFFF' },
  { id: 'red',    hex: '#FF3B4E' },
  { id: 'orange', hex: '#F2711C' },
  { id: 'yellow', hex: '#FFC61A' },
  { id: 'blue',   hex: '#2F7DE1' },
  { id: 'violet', hex: '#8B5CF6' },
]

export const WIDTHS = { thin: 0.55, medium: 1, thick: 1.7 }
export const ANGLES = { flat: 0, high: 32, tilted: 45, low: 62 }

// Elevation for 3D: the open Terrain Tiles on AWS (Mapzen's terrarium set —
// SRTM, GMTED and others), free and keyless. Credited in the frame.
const DEM_TILES = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'
export const LABEL_SIZES = { small: 0.7, medium: 1, large: 1.4 }
export const MODEL_SIZES = { small: 0.7, medium: 1, large: 1.35 }

const FPS = 30
const BRAND = '#00C08B'

/** Can this device encode an MP4? Everything else is a fallback nobody wants. */
export const canMakeMp4 = () =>
  typeof window !== 'undefined' && typeof window.VideoEncoder === 'function'

/* ------------------------------------------------------------------ helpers */

const lerp = (a, b, t) => a + (b - a) * t
// Ease in and out: a camera that starts and stops abruptly reads as a glitch.
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

/** Metres between two [lat, lng] points. */
function metres([lat1, lng1], [lat2, lng2]) {
  const R = 6371000
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dp = p2 - p1
  const dl = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** The shortest turn from one bearing to another, -180..180. */
const turnBy = (from, to) => ((to - from + 540) % 360) - 180

/** Compass bearing from one point to the next, for the vehicle's sprite. */
function bearing([lat1, lng1], [lat2, lng2]) {
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dl = ((lng2 - lng1) * Math.PI) / 180
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Distance in the rider's unit. */
export function distanceIn(m, unit = 'km') {
  if (unit === 'mi') {
    const mi = m / 1609.344
    return mi < 0.1 ? `${Math.round(m / 0.9144)} yd` : `${mi.toFixed(mi < 9.95 ? 1 : 0)} mi`
  }
  const r = Math.round(m / 10) * 10
  return r < 1000 ? `${r} m` : `${(m / 1000).toFixed(m < 9950 ? 1 : 0)} km`
}

/**
 * Stops joined by straight lines, for a rider who wants the shape of the trip
 * rather than the road — and for one with no signal to fetch a route with.
 * Points along each leg, so the camera still turns through the corners.
 */
export function directPath(stops, perLeg = 48) {
  // Smooth curves between the stops, not straight lines with a corner at each
  // one (Punit, 2026-09-21): a Catmull-Rom curve through every stop, so the
  // vehicle sweeps through them. With just two stops it bows gently, the way a
  // flight path is drawn, rather than running dead straight.
  const pts = stops.map((s) => [s.lat, s.lng])
  if (pts.length < 2) return pts
  if (pts.length === 2) {
    const [a, b] = pts
    const bow = 0.12
    const c = [(a[0] + b[0]) / 2 - (b[1] - a[1]) * bow, (a[1] + b[1]) / 2 + (b[0] - a[0]) * bow]
    const out = []
    for (let s = 0; s <= perLeg * 2; s++) {
      const t = s / (perLeg * 2)
      out.push([
        (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
        (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1],
      ])
    }
    return out
  }
  const at = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))]
  const out = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2)
    for (let s = 0; s < perLeg; s++) {
      const t = s / perLeg, t2 = t * t, t3 = t2 * t
      out.push([0, 1].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t
        + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
        + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)))
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

/**
 * The path measured once: cumulative distance at every point, so a moment in
 * the video maps to a place on the road rather than to a point index. Points
 * are not evenly spaced — a motorway stretch is two points and a ghat section
 * is two hundred — and stepping by index crawls through the bends and
 * teleports down the straights.
 */
function measure(coordinates) {
  const at = [0]
  for (let i = 1; i < coordinates.length; i++) {
    at.push(at[i - 1] + metres(coordinates[i - 1], coordinates[i]))
  }
  return { at, total: at[at.length - 1] || 0 }
}

/** Where the rider is after `d` metres, and which way they are pointing. */
function pointAt(coordinates, { at, total }, d) {
  const want = Math.max(0, Math.min(total, d))
  let i = 1
  while (i < at.length - 1 && at[i] < want) i++
  const span = at[i] - at[i - 1] || 1
  const t = (want - at[i - 1]) / span
  const a = coordinates[i - 1]
  const b = coordinates[i]
  return {
    point: [lerp(a[0], b[0], t), lerp(a[1], b[1], t)],
    heading: bearing(a, b),
    index: i,
  }
}

/** Ground metres per video pixel around the route's middle, at a zoom (512px tiles). */
function groundPerPixel(coordinates, zoom) {
  const lat = coordinates[Math.floor(coordinates.length / 2)][0]
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom)
}

/** Drop points closer than `metres` to the last one kept; the ends always stay. */
function thin(coordinates, metres) {
  if (coordinates.length < 3 || !(metres > 0)) return coordinates
  const out = [coordinates[0]]
  let [plat, plng] = coordinates[0]
  for (let i = 1; i < coordinates.length - 1; i++) {
    const [lat, lng] = coordinates[i]
    const dx = (lng - plng) * 111320 * Math.cos((lat * Math.PI) / 180)
    const dy = (lat - plat) * 110540
    if (dx * dx + dy * dy >= metres * metres) { out.push(coordinates[i]); plat = lat; plng = lng }
  }
  out.push(coordinates[coordinates.length - 1])
  return out
}

/** A zoom that fits the whole route in the frame, so the intro shows the trip. */
function fitZoom(coordinates, w, h) {
  let n = -90, s = 90, e = -180, west = 180
  for (const [lat, lng] of coordinates) {
    n = Math.max(n, lat); s = Math.min(s, lat)
    e = Math.max(e, lng); west = Math.min(west, lng)
  }
  const centre = [(n + s) / 2, (e + west) / 2]
  const latSpan = Math.max(n - s, 0.0005)
  const lngSpan = Math.max(e - west, 0.0005)
  // 360° of longitude spans 512px at zoom 0 in MapLibre (it was 256 here, a
  // whole zoom level too close: the opening shot cut the route off). Latitude
  // is stretched by Mercator, so it is measured there. A fifth is margin.
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
  const zx = Math.log2((w * 0.8) / (512 * (lngSpan / 360)))
  const zy = Math.log2((h * 0.8) / (512 * ((merc(n) - merc(s)) / (2 * Math.PI) || latSpan / 360)))
  return { centre, zoom: Math.max(2, Math.min(15, Math.min(zx, zy))) }
}

/**
 * Where the camera looks while the vehicle rides (Punit, 2026-09-21): the
 * average of the road a short way either side of it. North stays up, so the
 * map never spins; averaging the road means a switchback moves the vehicle,
 * not the camera. It never falls behind — a camera that glided after the
 * vehicle lost it off the edge of the frame on a long, fast ride.
 */
function roadCentre(coordinates, path, ridden, span) {
  let lat = 0, lng = 0, n = 0
  for (let k = -4; k <= 4; k++) {
    const [a, b] = pointAt(coordinates, path, ridden + (span * k) / 4).point
    lat += a; lng += b; n++
  }
  return [lat / n, lng / n]
}

/**
 * What the camera and the drawing are doing at each moment. Three acts: the
 * whole trip with its title, the ride itself, and the finish with the numbers.
 * Lengths are fractions of the whole, so a 10-second reel and a 30-second one
 * have the same shape — and how fast the vehicle moves follows from the length.
 */
function storyboard(seconds) {
  const intro = Math.min(2.2, seconds * 0.16)
  const outro = Math.min(2.6, seconds * 0.2)
  return { intro, ride: Math.max(1, seconds - intro - outro), outro }
}

/* ------------------------------------------------------------------- the map */

/** An off-screen MapLibre at video size, ready to be photographed frame by frame. */
async function offscreenMap({ w, h, style, ink, view, pathColour, pathWidth, pathStyle }) {
  const maplibre = await import('maplibre-gl')
  maplibre.setWorkerUrl(workerUrl)
  const host = document.createElement('div')
  // In the viewport but invisible, and behind everything. Not display:none and
  // not parked off-screen: MapLibre needs a laid-out element it will actually
  // draw, and the frames are copied out of its canvas, not off the screen.
  host.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;`
    + 'opacity:.01;pointer-events:none;z-index:-1;transform:scale(.05);transform-origin:0 0'
  document.body.appendChild(host)

  const map = new maplibre.Map({
    container: host,
    style,
    center: [77, 23],
    zoom: 4,
    attributionControl: false,
    interactive: false,
    fadeDuration: 0,
    // Frames are read back with drawImage, which needs the buffer kept. This
    // moved inside canvasContextAttributes in MapLibre 5; left at the top
    // level it is quietly ignored and every frame comes back black.
    canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
    // One device pixel per video pixel. Left alone, a 2x phone allocates a
    // buffer four times the frame and risks running out of memory — and at 4K
    // it would try for sixteen times.
    pixelRatio: 1,
    // Enough tiles kept that the warm-up is still there when the ride reaches them.
    maxTileCacheSize: 600,
  })
  // style.load, not load: with these styles MapLibre never reports load or idle
  // (map.loaded() stays false), and waiting on it hung the render before the
  // first frame. Tiles are waited for per frame instead.
  await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('The map did not load — check your connection.')), 15_000)
    map.once('style.load', () => { clearTimeout(timer); done() })
    map.once('error', (e) => { clearTimeout(timer); fail(new Error(e?.error?.message || 'The map could not load')) })
  })

  if (view === '3d') add3d(map, ink)

  return { map, host }
}

/**
 * The route (Punit, 2026-09-21): the whole of it solid in the rider's colour,
 * and what has been ridden faded to 30% behind the vehicle.
 *
 * Drawn on the frame, not on the map: each point is projected where the map
 * puts it — terrain height included — and stroked here. Both ways of doing it
 * inside MapLibre failed on a phone: rebuilding the ridden line every frame had
 * to be waited for, and fading it through a colour ramp rebuilt a texture per
 * tile per frame — a 15-second reel of a 1,400 km ride took six minutes on
 * Punit's F966B, and the line dropped out of some frames altogether.
 */
function drawRoute(ctx, w, h, map, lngLat, { colour, width, dash, upTo, detail = 0 }) {
  // Only what is in view is placed. Placing every point of a 1,400 km road on
  // the terrain each frame was 86% of the render on a slow CPU; the ride only
  // ever shows a sliver of it. A margin keeps lines running off the edge.
  const b = map.getBounds()
  const padLng = (b.getEast() - b.getWest()) * 0.35
  const padLat = (b.getNorth() - b.getSouth()) * 0.35
  const west = b.getWest() - padLng, east = b.getEast() + padLng
  const south = b.getSouth() - padLat, north = b.getNorth() + padLat
  const inView = (p) => p[0] >= west && p[0] <= east && p[1] >= south && p[1] <= north
  const xs = new Float32Array(lngLat.length).fill(NaN)
  const ys = new Float32Array(lngLat.length).fill(NaN)
  // Full detail near the vehicle; further off — toward the horizon, where a
  // tilted camera squeezes many kilometres into a few pixels — every 3rd,
  // then every 8th point. (Every 16th showed as a zigzag on the far road.)
  const near = upTo ? upTo.index : -1
  const keep = (i) => {
    if (near < 0 || !detail) return true
    const d = Math.abs(i - near)
    return d < detail || (d < detail * 6 ? i % 3 === 0 : i % 8 === 0) || i === lngLat.length - 1
  }
  // Thinned-out points are passed over; points out of view lift the pen.
  const skipped = new Uint8Array(lngLat.length)
  for (let i = 0; i < lngLat.length; i++) {
    if (!keep(i)) { skipped[i] = 1; continue }
    // A point out of view is still placed when its neighbour is in view, so the
    // line reaches the edge of the frame instead of stopping short of it.
    if (!inView(lngLat[i]) && !(i > 0 && inView(lngLat[i - 1])) && !(i < lngLat.length - 1 && inView(lngLat[i + 1]))) continue
    const p = map.project(lngLat[i])
    xs[i] = p.x; ys[i] = p.y
  }
  const onScreen = (x, y) => Number.isFinite(x) && Number.isFinite(y) && y > -h * 2 && y < h * 3 && x > -w * 3 && x < w * 4
  // A run of points as one stroke, broken wherever a point can't be placed.
  const stroke = (from, to, head, tail, style, alpha) => {
    ctx.globalAlpha = alpha
    ctx.strokeStyle = style
    ctx.beginPath()
    let pen = false
    const step = (x, y) => {
      if (!onScreen(x, y)) { pen = false; return }
      if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true }
    }
    if (head) step(head.x, head.y)
    for (let i = from; i < to; i++) if (!skipped[i]) step(xs[i], ys[i])
    if (tail) step(tail.x, tail.y)
    ctx.stroke()
  }
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = width
  ctx.setLineDash(dash ? dash.map((d) => Math.max(d * width, 0.01)) : [])
  if (!upTo) {
    stroke(0, lngLat.length, null, null, colour, 1)
  } else {
    const at = map.project([upTo.point[1], upTo.point[0]])
    stroke(0, upTo.index, null, at, colour, 0.3)
    stroke(upTo.index, lngLat.length, at, null, colour, 1)
  }
  ctx.restore()
}

/**
 * The 3D look: the ground raised from elevation data, shaded so the ridges
 * read, buildings stood up in towns, and a sky where a tilted camera sees the
 * horizon. Anything a style or device refuses is left out rather than failing
 * the reel — a flat 3D reel is still a reel.
 */
function add3d(map, ink) {
  const dark = isDark(ink)
  try {
    map.addSource('dem', { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 14 })
    // One elevation source for both the terrain and its shading: a second copy
    // of the same tiles was decoded and uploaded twice, for no visible gain.
    const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
    map.addLayer({
      id: 'trekov-hills', type: 'hillshade', source: 'dem',
      paint: {
        // Strong on purpose: on the dark map the shading is the only thing that
        // shows the mountains are there at all.
        'hillshade-exaggeration': dark ? 0.9 : 0.6,
        'hillshade-shadow-color': dark ? '#000000' : '#4a4a4a',
        'hillshade-highlight-color': dark ? '#5d7370' : '#ffffff',
        'hillshade-accent-color': dark ? '#0b0f0e' : '#7a7a7a',
        'hillshade-illumination-direction': 315,
      },
    }, firstSymbol)
    map.setTerrain({ source: 'dem', exaggeration: 1.4 })
  } catch { /* no terrain: still tilted */ }
  try {
    const layers = map.getStyle().layers
    if (!layers.some((l) => l.type === 'fill-extrusion') && map.getSource('openmaptiles')) {
      map.addLayer({
        id: 'trekov-buildings', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13,
        paint: {
          'fill-extrusion-color': dark ? '#26302e' : '#d9d4c9',
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.85,
        },
      }, layers.find((l) => l.type === 'symbol')?.id)
    }
  } catch { /* no buildings */ }
  try {
    map.setSky(dark
      ? { 'sky-color': '#1d3440', 'horizon-color': '#3c5a5c', 'fog-color': '#0b0f0e', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.8 }
      : { 'sky-color': '#9cc9e8', 'horizon-color': '#e8f0f2', 'fog-color': '#f4f1ea', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.75 })
  } catch { /* older MapLibre: no sky */ }
}

const isDark = (hex) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16) < 384

/**
 * Set the camera and wait until the buffer really holds that view.
 *
 * Three things have to line up: the tiles have to arrive (areTilesLoaded — the
 * idle event never fires for these styles), MapLibre has to draw them, and the
 * draw has to land in the preserved buffer before it is copied. Waiting on
 * frames alone copied the previous view, so the buffer itself is sampled until
 * it stops looking like bare background. Everything is capped: in a dead zone
 * the frame goes out blurry rather than the render stopping.
 */
const raf = () => new Promise((r) => requestAnimationFrame(() => r()))

const sampler = document.createElement('canvas')
sampler.width = 96
sampler.height = 160
const sampleCtx = sampler.getContext('2d', { willReadFrequently: true })
function hasContent(canvas, floor) {
  sampleCtx.drawImage(canvas, 0, 0, 96, 160)
  const d = sampleCtx.getImageData(0, 0, 96, 160).data
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] + d[i + 1] + d[i + 2] - floor) > 90) return true
  }
  return false
}

async function settle(map, camera, cap, floor) {
  map.jumpTo(camera)
  const tilesBy = performance.now() + cap
  let waited = false
  while (!map.areTilesLoaded() && performance.now() < tilesBy) { waited = true; await raf() }
  // Drawn now, not at the next screen refresh: the frame is copied straight
  // after, so waiting a refresh (and reading pixels back to check it had
  // landed) only cost time. A frame that had to wait for tiles is still
  // checked — that is when a half-drawn buffer used to slip through.
  map.redraw()
  if (!waited) return
  const drawnBy = performance.now() + 250
  while (!hasContent(map.getCanvas(), floor) && performance.now() < drawnBy) { await raf(); map.redraw() }
}

/**
 * Walk the camera along the route before rendering, so the tiles the reel needs
 * are already in MapLibre's cache when the frames are drawn. Fetching them
 * during the render meant every frame paid for a round trip.
 */
async function warmTiles(map, coordinates, path, camera, onProgress) {
  // One stop per half a frame of road, so every tile the ride passes is asked
  // for. It was a fixed 18 — on a long ride most tiles were still fetched
  // mid-render — and it never drew, so MapLibre never asked for any tiles at
  // all: the warm-up finished in no time and warmed nothing.
  const reach = groundPerPixel(coordinates, camera.zoom) * (camera.h ?? 1920) * 0.5
  const steps = Math.max(12, Math.min(120, Math.ceil(path.total / Math.max(reach, 1))))
  for (let i = 0; i <= steps; i++) {
    const { point, heading } = pointAt(coordinates, path, (path.total * i) / steps)
    map.jumpTo({ center: [point[1], point[0]], zoom: camera.zoom, bearing: camera.bearing ?? heading, pitch: camera.pitch })
    map.redraw()
    const until = performance.now() + 1500
    while (!map.areTilesLoaded() && performance.now() < until) await raf()
    onProgress?.(i / steps)
  }
}

/* ---------------------------------------------------------------- the overlay */

const round = (ctx, x, y, w, h, r) => {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Just enough ground for the type to sit on. */
function shade(ctx, w, h, veil = 0) {
  const top = ctx.createLinearGradient(0, 0, 0, h * 0.24)
  top.addColorStop(0, 'rgba(11,15,14,.72)')
  top.addColorStop(1, 'rgba(11,15,14,0)')
  ctx.fillStyle = top
  ctx.fillRect(0, 0, w, h * 0.24)
  const bottom = ctx.createLinearGradient(0, h, 0, h * 0.74)
  bottom.addColorStop(0, 'rgba(11,15,14,.8)')
  bottom.addColorStop(1, 'rgba(11,15,14,0)')
  ctx.fillStyle = bottom
  ctx.fillRect(0, h * 0.74, w, h * 0.26)
  // The title card dims the whole frame instead, so the name can sit anywhere.
  if (veil > 0) {
    ctx.fillStyle = `rgba(11,15,14,${veil})`
    ctx.fillRect(0, 0, w, h)
  }
}

/** The Trekov pin, drawn rather than loaded: one less thing to fetch mid-render. */
function pin(ctx, x, y, size, colour = BRAND) {
  const s = size / 64
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(s, s)
  ctx.fillStyle = colour
  ctx.beginPath()
  ctx.moveTo(32, 61)
  ctx.bezierCurveTo(32, 61, 53, 40.5, 53, 25)
  ctx.arc(32, 25, 21, 0, Math.PI, true)
  ctx.bezierCurveTo(11, 40.5, 32, 61, 32, 61)
  ctx.fill()
  ctx.fillStyle = '#0B0F0E'
  ctx.beginPath()
  ctx.moveTo(17, 34.5); ctx.lineTo(26.5, 20); ctx.lineTo(31.5, 28)
  ctx.lineTo(37.5, 11.5); ctx.lineTo(47, 34.5); ctx.closePath()
  ctx.fill()
  ctx.restore()
}

const font = (px, weight = 600) => `${weight} ${px}px Outfit, ui-sans-serif, system-ui, sans-serif`

function credit(ctx, w, h, terrain) {
  // OpenStreetMap's licence asks for credit wherever the map appears. In a
  // video that means in the video, not in the app that made it.
  ctx.font = font(Math.round(w / 52), 500)
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(255,255,255,.62)'
  ctx.fillText(terrain ? '© OpenStreetMap · OpenFreeMap · terrain Mapzen/AWS' : '© OpenStreetMap · OpenFreeMap', w - w * 0.04, h - h * 0.018)
  ctx.textAlign = 'left'
}

function watermark(ctx, w, h) {
  const size = Math.round(w / 16)
  pin(ctx, w * 0.04, h - h * 0.018 - size * 1.06, size)
  ctx.font = font(Math.round(w / 20), 600)
  ctx.fillStyle = 'rgba(255,255,255,.92)'
  ctx.fillText('trekov', w * 0.04 + size * 0.92, h - h * 0.018 - size * 0.12)
}

function wrap(ctx, text, x, y, maxW, lineH) {
  const words = String(text).split(/\s+/)
  const lines = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > maxW && line) { lines.push(line); line = word } else line = next
  }
  if (line) lines.push(line)
  lines.slice(0, 3).forEach((l, i) => ctx.fillText(l, x, y + i * lineH))
}

function drawTitle(ctx, w, h, { title, when }, t) {
  const fade = t < 0.18 ? t / 0.18 : t > 0.86 ? Math.max(0, (1 - t) / 0.14) : 1
  ctx.globalAlpha = fade
  ctx.shadowColor = 'rgba(0,0,0,.55)'
  ctx.shadowBlur = w / 40
  ctx.textAlign = 'center'
  ctx.fillStyle = BRAND
  ctx.font = font(Math.round(w / 34), 600)
  ctx.fillText((when || 'A ride on Trekov').toUpperCase(), w / 2, h * 0.36)
  ctx.fillStyle = '#FFFFFF'
  const size = title.length > 26 ? w / 15 : title.length > 16 ? w / 12 : w / 9.5
  ctx.font = font(Math.round(size), 700)
  wrap(ctx, title, w / 2, h * 0.44, w * 0.86, size * 1.16)
  ctx.shadowBlur = 0
  ctx.textAlign = 'left'
  ctx.globalAlpha = 1
}

/** Distance ridden so far, counting up as the line draws. */
function drawProgress(ctx, w, h, { done, total, unit }) {
  ctx.textAlign = 'left'
  ctx.shadowColor = 'rgba(0,0,0,.5)'
  ctx.shadowBlur = w / 60
  ctx.fillStyle = '#FFFFFF'
  ctx.font = font(Math.round(w / 10), 700)
  ctx.fillText(distanceIn(done, unit), w * 0.06, h * 0.115)
  ctx.fillStyle = 'rgba(255,255,255,.72)'
  ctx.font = font(Math.round(w / 28), 500)
  ctx.fillText(`of ${distanceIn(total, unit)}`, w * 0.06, h * 0.148)
  ctx.shadowBlur = 0
}

/**
 * The stops, pinned where they actually are on the map.
 *
 * map.project turns a position into a place in the frame, so a label rides with
 * the map as the camera turns instead of floating in a corner. Anything off the
 * frame is skipped rather than pushed to the edge, where it would read as a
 * stop that is not there.
 */
function drawLabels(ctx, w, h, map, stops, scale) {
  const size = Math.round((w / 30) * scale)
  ctx.font = font(size, 600)
  ctx.textAlign = 'left'
  for (const s of stops) {
    const p = map.project([s.lng, s.lat])
    if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) continue
    const tw = ctx.measureText(s.name).width
    const padX = size * 0.6
    const padY = size * 0.42
    const boxW = tw + padX * 2
    const boxH = size + padY * 2
    const x = Math.min(Math.max(p.x - boxW / 2, w * 0.02), w * 0.98 - boxW)
    const y = Math.max(h * 0.02, p.y - boxH - size * 0.9)
    ctx.shadowColor = 'rgba(0,0,0,.45)'
    ctx.shadowBlur = size * 0.8
    round(ctx, x, y, boxW, boxH, boxH / 2)
    ctx.fillStyle = 'rgba(11,15,14,.88)'
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.strokeStyle = 'rgba(255,255,255,.22)'
    ctx.lineWidth = Math.max(1, size / 16)
    ctx.stroke()
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(s.name, x + padX, y + padY + size * 0.82)
    ctx.beginPath()
    ctx.arc(p.x, p.y, size * 0.26, 0, Math.PI * 2)
    ctx.fillStyle = BRAND
    ctx.fill()
  }
}

function drawStats(ctx, w, h, { distance, duration, stops, title, unit }, t) {
  ctx.globalAlpha = Math.min(1, t / 0.25)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#FFFFFF'
  ctx.shadowColor = 'rgba(0,0,0,.5)'
  ctx.shadowBlur = w / 50
  ctx.font = font(Math.round(w / 13), 700)
  wrap(ctx, title, w / 2, h * 0.79, w * 0.86, w / 12)

  const cells = [
    [distanceIn(distance, unit), 'RIDDEN'],
    [duration ? formatDuration(duration) : String(stops), duration ? 'ON THE ROAD' : 'STOPS'],
    [String(stops), 'STOPS'],
  ].slice(0, duration ? 3 : 2)

  const y = h * 0.875
  const each = (w * 0.86) / cells.length
  cells.forEach(([value, label], i) => {
    const x = w * 0.07 + each * i + each / 2
    ctx.fillStyle = BRAND
    ctx.font = font(Math.round(w / 15), 700)
    ctx.fillText(value, x, y)
    ctx.fillStyle = 'rgba(255,255,255,.72)'
    ctx.font = font(Math.round(w / 38), 600)
    ctx.fillText(label, x, y + h * 0.03)
  })
  ctx.shadowBlur = 0
  ctx.textAlign = 'left'
  ctx.globalAlpha = 1
}

/** The rider's own vehicle, from the sprite sheet the map already uses. */
function drawVehicle(ctx, w, h, sheet, heading, mapBearing, scale, x = w / 2, y = h * 0.52) {
  if (!sheet) return
  // A soft halo first: the models are dark, and so is the map under them.
  const halo = ctx.createRadialGradient(x, y, 0, x, y, w * 0.16 * scale)
  halo.addColorStop(0, 'rgba(0,192,139,.34)')
  halo.addColorStop(1, 'rgba(0,192,139,0)')
  ctx.fillStyle = halo
  ctx.fillRect(x - w * 0.16 * scale, y - w * 0.16 * scale, w * 0.32 * scale, w * 0.32 * scale)

  const frame = frameFor(heading, mapBearing)
  const col = frame % SHEET.cols
  const row = Math.floor(frame / SHEET.cols)
  const cw = sheet.width / SHEET.cols
  const ch = sheet.height / SHEET.rows
  const size = w * 0.23 * scale
  ctx.drawImage(sheet, col * cw, row * ch, cw, ch, x - size / 2, y - size / 2, size, size)
}

async function loadSheet(vehicle) {
  try {
    const sheets = import.meta.glob('../assets/vehicles3d/*.webp', { eager: true, import: 'default' })
    const src = sheets[`../assets/vehicles3d/${spriteId(vehicle)}.webp`]
    if (!src) return null
    const img = new Image()
    img.src = src
    await img.decode()
    return img
  } catch {
    return null
  }
}

/* --------------------------------------------------------------------- render */

/**
 * Make the reel. `onProgress(fraction)` is called as frames go by — a rider
 * watching a blank screen for a minute assumes it has hung.
 */
export async function renderRouteVideo({
  coordinates, stops = [], title = 'My ride', when = '',
  vehicle = 'hatchback', modelSize = 'medium',
  distance = 0, duration = 0,
  shape = 'reel', quality = 'hd', seconds = 15,
  style = 'dark', pathStyle = 'solid', pathColour = BRAND, pathWidth = 'medium',
  angle = 'tilted', view = '3d', showDistance = true, showLabels = true, labelSize = 'medium',
  unit = 'km', onProgress = () => {}, signal,
}) {
  if (!coordinates?.length || coordinates.length < 2) throw new Error('This trip has no route to animate yet.')
  if (!canMakeMp4()) throw new Error('This device cannot make an MP4. Update the app or its browser and try again.')

  const [w, h] = (SHAPES[shape] ?? SHAPES.reel)[quality === 'uhd' ? 'uhd' : 'hd']
  const chosen = STYLES[style] ?? STYLES.dark
  // A long road comes back as thousands of points, and the ridden line is
  // rebuilt from them every frame. MapLibre does that off the main thread, so
  // with too many the frame was photographed before the line was back — on
  // Ahmedabad to Manali (1,400 km) it vanished in every few frames. Points
  // closer than three pixels at the riding zoom make no visible difference.
  coordinates = thin(coordinates, groundPerPixel(coordinates, fitZoom(coordinates, w, h).zoom + 3.2) * 3)
  const path = measure(coordinates)
  const total = distance || path.total
  const board = storyboard(seconds)
  const frames = Math.round(seconds * FPS)
  // 2D looks straight down all the way. 3D rides tilted, and keeps some tilt
  // over the whole trip too, so the opening and closing shots show the hills.
  const flat = view === '2d'
  const pitch = flat ? 0 : (angle === 'flat' ? ANGLES.tilted : ANGLES[angle] ?? ANGLES.tilted)
  const widePitch = flat ? 0 : Math.min(pitch, 40)
  const labelScale = LABEL_SIZES[labelSize] ?? 1
  const vehicleScale = MODEL_SIZES[modelSize] ?? 1
  const lineWidth = Math.max(3, Math.round((w / 108) * (WIDTHS[pathWidth] ?? 1)))
  const dash = PATH_STYLES[pathStyle]?.dash

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { alpha: false })
  ctx.textBaseline = 'alphabetic'

  const sheet = await loadSheet(vehicle)
  const { map, host } = await offscreenMap({
    w, h, style: chosen.url, ink: chosen.ink, view: flat ? '2d' : '3d', pathColour, pathWidth: WIDTHS[pathWidth] ?? 1, pathStyle,
  })
  // What bare map looks like, so a half-drawn frame can be told from a real one.
  const floor = (parseInt(chosen.ink.slice(1, 3), 16) + parseInt(chosen.ink.slice(3, 5), 16) + parseInt(chosen.ink.slice(5, 7), 16))
  const encoder = await startEncoder({ w, h })

  try {
    const lngLat = coordinates.map(([lat, lng]) => [lng, lat])
    const whole = fitZoom(coordinates, w, h)
    // The opening and closing shots show the whole trip at once: a point a
    // pixel from the last one there adds nothing but time.
    const wideLngLat = thin(coordinates, groundPerPixel(coordinates, whole.zoom) * 1.5).map(([lat, lng]) => [lng, lat])
    // Close in on the vehicle after the whole-trip shot (Punit, 2026-09-21).
    // North stays up, so the map slides under it but never spins.
    // Capped in 3D: any closer on a short mountain ride and one ridge fills the
    // frame.
    const rideZoom = Math.min(Math.max(whole.zoom + (flat ? 3.2 : 2.9), 8.5), flat ? 14 : 12.5)
    // How many points of road cover about a frame's height at the riding zoom.
    const nearPoints = Math.max(40, Math.round((groundPerPixel(coordinates, rideZoom) * h) / Math.max(1, path.total / coordinates.length)))
    // Road averaged over about a sixth of the frame's height either side.
    const span = groundPerPixel(coordinates, rideZoom) * h * 0.16
    let lastCam = null
    let heading = null
    // About 70 video pixels of road at the riding zoom.
    const lookAhead = groundPerPixel(coordinates, rideZoom) * 70

    // Tiles first. A rider watching a progress bar would rather it move slowly
    // from the start than stall at 40% while the road downloads.
    const warmFrom = performance.now()
    await warmTiles(map, coordinates, path, { zoom: rideZoom, pitch, bearing: 0, h }, (t) => onProgress(t * 0.15))
    if (globalThis.__reelStats) globalThis.__reelStats.warm = performance.now() - warmFrom

    for (let f = 0; f < frames; f++) {
      if (signal?.aborted) throw new Error('cancelled')
      const time = f / FPS
      let camera
      let act

      if (time < board.intro) {
        // Act one: the whole trip, the full route drawn — turning gently, so it
        // reads as a map, not a still.
        const t = time / board.intro
        act = { kind: 'intro', t }
        camera = { center: [whole.centre[1], whole.centre[0]], zoom: whole.zoom - 0.5 + ease(t) * 0.5, bearing: -8 + ease(t) * 8, pitch: widePitch }
      } else if (time < board.intro + board.ride) {
        // Act two: the ride. The camera closes in on the vehicle and follows
        // it; the road behind it fades.
        const t = (time - board.intro) / board.ride
        const ridden = path.total * ease(t)
        const { point, index } = pointAt(coordinates, path, ridden)
        // Pointed at the road a little way ahead, and turned gradually: aimed at
        // the next point alone, the vehicle flicked left and right through
        // every wiggle of a hill road (Punit, 2026-09-21).
        const ahead = pointAt(coordinates, path, ridden + lookAhead).point
        const want = metres(point, ahead) > 1 ? bearing(point, ahead) : heading ?? 0
        heading = heading == null ? want : heading + turnBy(heading, want) * 0.18
        heading = (heading + 360) % 360
        act = { kind: 'ride', ridden: total * ease(t), heading }
        // The first moment and a half swoops in from the whole-trip shot.
        const inRaw = Math.min(1, (time - board.intro) / Math.min(1.6, board.ride * 0.25))
        const inT = ease(inRaw)
        // The camera reaches the vehicle before the zoom does, so it is never
        // left at the edge of the frame on the way in.
        const onT = ease(Math.min(1, inRaw * 2))
        const centre = roadCentre(coordinates, path, ridden, span)
        camera = {
          center: [lerp(whole.centre[1], centre[1], onT), lerp(whole.centre[0], centre[0], onT)],
          zoom: lerp(whole.zoom, rideZoom, inT),
          bearing: 0,
          pitch: lerp(widePitch, pitch, inT),
        }
        act.point = point
        act.index = index
        lastCam = camera
      } else {
        // Act three: back out to the whole trip, with the numbers.
        const t = (time - board.intro - board.ride) / board.outro
        const e = ease(Math.min(1, t * 1.4))
        act = { kind: 'outro', t }
        const from = lastCam ?? { center: [whole.centre[1], whole.centre[0]], zoom: rideZoom, pitch }
        camera = {
          center: [lerp(from.center[0], whole.centre[1], e), lerp(from.center[1], whole.centre[0], e)],
          zoom: lerp(from.zoom, whole.zoom, e),
          bearing: 0,
          pitch: lerp(from.pitch, widePitch, e),
        }
      }

      // A test can ask where the time goes (globalThis.__reelStats = {}).
      const stats = globalThis.__reelStats
      let t0 = stats ? performance.now() : 0
      const lap = (k) => { if (stats) { const n = performance.now(); stats[k] = (stats[k] || 0) + n - t0; t0 = n } }
      await settle(map, camera, 400, floor)
      lap('settle')
      ctx.fillStyle = chosen.ink
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(map.getCanvas(), 0, 0, w, h)
      lap('copy')
      shade(ctx, w, h, act.kind === 'intro' ? 0.42 : 0)
      // The whole route solid at the start and the finish; on the ride, faded
      // behind the vehicle.
      drawRoute(ctx, w, h, map, act.kind === 'ride' ? lngLat : wideLngLat, {
        colour: pathColour, width: lineWidth, dash,
        upTo: act.kind === 'ride' ? { index: act.index, point: act.point } : null,
        detail: nearPoints,
      })
      lap('route_' + act.kind)

      if (showLabels) drawLabels(ctx, w, h, map, stops, labelScale)
      if (act.kind === 'intro') drawTitle(ctx, w, h, { title, when }, act.t)
      if (act.kind === 'ride') {
        const at = map.project([act.point[1], act.point[0]])
        drawVehicle(ctx, w, h, sheet, act.heading, camera.bearing, vehicleScale, at.x, at.y)
        if (showDistance) drawProgress(ctx, w, h, { done: act.ridden, total, unit })
      }
      if (act.kind === 'outro') drawStats(ctx, w, h, { distance: total, duration, stops: stops.length, title, unit }, act.t)

      watermark(ctx, w, h)
      credit(ctx, w, h, !flat)
      lap('overlay')

      await encoder.add(canvas, f)
      lap('encode')
      onProgress(0.15 + ((f + 1) / frames) * 0.85)
    }
    return await encoder.finish()
  } finally {
    try { map.remove() } catch { /* already gone */ }
    host.remove()
  }
}

/* -------------------------------------------------------------------- encoding */

/**
 * H.264 in MP4 through WebCodecs. The bitrate follows the frame size, so 4K is
 * not a 1080p video stretched over four times the pixels.
 */
async function startEncoder({ w, h }) {
  const target = new ArrayBufferTarget()
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: w, height: h },
    fastStart: 'in-memory',   // the moov atom up front: phones play it straight away
  })
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e },
  })
  // Level 5.1 covers 4K; baseline plays on anything that can decode at all.
  const codec = w * h > 1920 * 1080 ? 'avc1.420033' : 'avc1.42002A'
  encoder.configure({ codec, width: w, height: h, bitrate: Math.round(w * h * 3), framerate: FPS })
  return {
    async add(canvas, i) {
      const frame = new VideoFrame(canvas, { timestamp: (i * 1e6) / FPS, duration: 1e6 / FPS })
      // A keyframe every two seconds keeps scrubbing responsive.
      encoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 })
      frame.close()
      // Let the encoder drain: queueing every frame at once on a phone runs it
      // out of memory on a long reel, and 4K frames are four times the weight.
      while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 8))
    },
    async finish() {
      await encoder.flush()
      muxer.finalize()
      return { blob: new Blob([target.buffer], { type: 'video/mp4' }), type: 'mp4' }
    },
  }
}
