// Slippy-map tile maths and great-circle helpers, shared by routing,
// offline tile download and the navigation compass.

export const lngToTileX = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z)

export function latToTileY(lat, z) {
  const rad = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z)
}

const R = 6371e3 // metres

/** Great-circle distance in metres. */
export function distance(a, b) {
  const p1 = (a.lat * Math.PI) / 180
  const p2 = (b.lat * Math.PI) / 180
  const dp = p2 - p1
  const dl = ((b.lng - a.lng) * Math.PI) / 180
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Initial bearing from a to b, in degrees clockwise from north. */
export function bearing(a, b) {
  const p1 = (a.lat * Math.PI) / 180
  const p2 = (b.lat * Math.PI) / 180
  const dl = ((b.lng - a.lng) * Math.PI) / 180
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
}

// Rounded before choosing the unit, so 995 m reads "1.0 km" rather than "1000 m".
export const formatDistance = (m) => {
  const r = Math.round(m / 10) * 10
  return r < 1000 ? `${r} m` : `${(m / 1000).toFixed(m < 9950 ? 1 : 0)} km`
}

export function formatDuration(s) {
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

export const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
export const compassPoint = (deg) => COMPASS[Math.round(deg / 45) % 8]

/**
 * Project a point onto the segment a→b, in local metres.
 *
 * Uses an equirectangular approximation: over a road segment the error is far
 * below GPS noise, and it keeps this cheap enough to run on every fix.
 */
function projectOnSegment(p, a, b) {
  const latRad = (a.lat * Math.PI) / 180
  const mx = 111320 * Math.cos(latRad)   // metres per degree of longitude here
  const my = 110540                      // metres per degree of latitude
  const ax = 0, ay = 0
  const bx = (b.lng - a.lng) * mx, by = (b.lat - a.lat) * my
  const px = (p.lng - a.lng) * mx, py = (p.lat - a.lat) * my
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len2))
  const cx = t * dx, cy = t * dy
  return {
    t,
    distance: Math.hypot(px - cx, py - cy),
    lat: a.lat + (cy / my),
    lng: a.lng + (cx / mx),
  }
}

/**
 * Nearest point on a path to `p` — the map-matching step that keeps the
 * vehicle on the road instead of beside it.
 *
 * Returns { lat, lng, index, distance, bearing } where `index` is the segment
 * start and `bearing` is that segment's direction, which is far steadier than
 * a heading derived from consecutive GPS fixes.
 */
export function snapToPath(coords, p) {
  if (!coords?.length) return null
  let best = null
  for (let i = 0; i < coords.length - 1; i++) {
    const a = { lat: coords[i][0], lng: coords[i][1] }
    const b = { lat: coords[i + 1][0], lng: coords[i + 1][1] }
    const hit = projectOnSegment(p, a, b)
    if (!best || hit.distance < best.distance) {
      best = { ...hit, index: i, bearing: bearing(a, b) }
    }
  }
  return best
}

/** Metres remaining along `coords` from a snapped position. */
export function distanceAlongRemaining(coords, snap) {
  if (!coords?.length || !snap) return null
  let left = distance(snap, { lat: coords[snap.index + 1][0], lng: coords[snap.index + 1][1] })
  for (let i = snap.index + 1; i < coords.length - 1; i++) {
    left += distance(
      { lat: coords[i][0], lng: coords[i][1] },
      { lat: coords[i + 1][0], lng: coords[i + 1][1] },
    )
  }
  return left
}
