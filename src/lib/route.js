// Routing via the public OSRM demo server, cached so a route stays usable
// after you lose signal.
//
// OSRM's demo instance is rate-limited and not for production traffic — swap
// the host for your own OSRM/Valhalla instance (or a commercial key) before
// this carries real users.

import { loadGoogleMaps } from './gmaps'

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY
const HOST = 'https://router.project-osrm.org'
const TRAVEL = { car: 'DRIVING', bike: 'TWO_WHEELER' }
const stripHtml = (h) => (h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const KEY = 'trekov.routes.v1'
const MAX_CACHED = 40

const routeKey = (from, to, profile) =>
  [profile, from.lat.toFixed(3), from.lng.toFixed(3), to.lat.toFixed(3), to.lng.toFixed(3)].join('|')

function readCache() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}

function writeCache(cache) {
  // Keep the newest N so a long-lived install cannot fill the quota.
  const entries = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_CACHED)
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries))) } catch {}
}

export const cachedRoute = (from, to, profile = 'driving') =>
  hydrate(readCache()[routeKey(from, to, profile)]) ?? null

async function osrmRoute(from, to, mode) {
  // The demo server only carries the driving profile; a bike gets the same
  // road route, and says so.
  const url = `${HOST}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}` +
              `?overview=full&geometries=geojson&steps=true`
  const res = await fetch(url)
  if (!res.ok) throw new Error(res.status)
  const data = await res.json()
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error(data.code || 'no route')
  const r = data.routes[0]
  return {
    at: Date.now(), via: 'osrm', mode, modeFallback: mode === 'bike',
    distance: r.distance, duration: r.duration, durationInTraffic: null,
    // Our drivers take [lat, lng]; GeoJSON gives [lng, lat].
    coordinates: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    steps: (r.legs?.[0]?.steps ?? []).map((s) => ({
      text: '', name: s.name, distance: s.distance,
      type: s.maneuver?.type, modifier: s.maneuver?.modifier,
      lat: s.maneuver?.location?.[1], lng: s.maneuver?.location?.[0],
    })),
  }
}

/**
 * Routes API v2, which is the only Google endpoint that reports traffic along
 * the route rather than just a slower total.
 *
 * TRAFFIC_ON_POLYLINE comes back as speed readings over ranges of polyline
 * points — NORMAL, SLOW, TRAFFIC_JAM — which is exactly how Google's own
 * navigation paints amber and red onto the line you are following. Legacy
 * Directions cannot do this at all; it only ever returned duration_in_traffic.
 *
 * Needs the Routes API enabled on the key, separately from Directions. When it
 * is not, this throws and the caller drops to Directions without traffic
 * colouring.
 */
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'
const ROUTES_FIELDS = [
  'routes.distanceMeters', 'routes.duration', 'routes.staticDuration',
  'routes.polyline.encodedPolyline',
  'routes.legs.steps.navigationInstruction', 'routes.legs.steps.distanceMeters',
  'routes.legs.steps.startLocation',
  'routes.travelAdvisory.speedReadingIntervals',
].join(',')

const seconds = (s) => (typeof s === 'string' ? Number(s.replace('s', '')) : null)

/**
 * Decode Google's encoded polyline.
 *
 * Written out rather than borrowed from gm.geometry so a cached route can be
 * rehydrated with no network: Google Maps cannot load offline, which is
 * exactly when the cache matters. It also lets the cache hold the encoded
 * string — a third the size of the decoded pairs, which is the difference
 * between fitting in localStorage and quietly failing to save.
 */
function decodePolyline(str) {
  const out = []
  let i = 0, lat = 0, lng = 0
  while (i < str.length) {
    let b, shift = 0, result = 0
    do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lat += (result & 1) ? ~(result >> 1) : (result >> 1)
    shift = 0; result = 0
    do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lng += (result & 1) ? ~(result >> 1) : (result >> 1)
    out.push([lat / 1e5, lng / 1e5])
  }
  return out
}

/** Cached routes travel encoded; the coordinates come back on read. */
const hydrate = (r) =>
  r && r.encoded && !r.coordinates?.length ? { ...r, coordinates: decodePolyline(r.encoded) } : r
const dehydrate = (r) => (r?.encoded ? { ...r, coordinates: undefined } : r)

async function routesApiRoute(gm, from, to, mode) {
  if (!MAPS_KEY) throw new Error('no key')
  const body = {
    origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
    destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
    travelMode: mode === 'bike' ? 'TWO_WHEELER' : 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    extraComputations: ['TRAFFIC_ON_POLYLINE'],
    // OVERVIEW, not HIGH_QUALITY: the same traffic intervals come back either
    // way, and HIGH_QUALITY's 59,000 points for one long route is more than
    // the map needs to draw and far more than the cache can hold.
    polylineQuality: 'OVERVIEW',
    // Without these the Routes API picks a language from where the route is,
    // not from who is reading it — an English phone routing through Gujarat
    // came back with Assamese turn instructions.
    languageCode: navigator.language || 'en',
    units: 'METRIC',
  }
  const res = await fetch(ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': MAPS_KEY,
      'X-Goog-FieldMask': ROUTES_FIELDS,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Routes ${res.status}`)
  const data = await res.json()
  const r = data.routes?.[0]
  if (!r?.polyline?.encodedPolyline) throw new Error('no route')

  const encoded = r.polyline.encodedPolyline
  const coordinates = decodePolyline(encoded)

  const total = seconds(r.duration)
  const free = seconds(r.staticDuration)

  return {
    at: Date.now(), via: 'routes', mode, modeFallback: false,
    distance: r.distanceMeters,
    duration: free ?? total,
    // Only meaningful when traffic is actually costing time.
    durationInTraffic: total != null && free != null && total > free ? total : null,
    encoded,
    coordinates,
    // Point ranges into `coordinates`. NORMAL stretches are left out: the
    // route's own colour already says "clear", and carrying them would mean
    // redrawing the whole line in the colour it already is.
    traffic: (r.travelAdvisory?.speedReadingIntervals ?? [])
      .filter((i) => i.speed && i.speed !== 'NORMAL')
      .map((i) => ({
        start: i.startPolylinePointIndex ?? 0,
        end: i.endPolylinePointIndex ?? 0,
        speed: i.speed,
      })),
    steps: (r.legs?.[0]?.steps ?? []).map((s) => ({
      text: s.navigationInstruction?.instructions ?? '',
      name: '', distance: s.distanceMeters ?? 0,
      type: s.navigationInstruction?.maneuver || '', modifier: '',
      lat: s.startLocation?.latLng?.latitude,
      lng: s.startLocation?.latLng?.longitude,
    })),
  }
}

/**
 * Google Directions. Bikes ask for TWO_WHEELER, which Google serves in India
 * and a handful of other countries; anywhere else it is refused and we fall
 * back to a car route and say so, rather than inventing a bike one.
 */
async function googleRoute(gm, from, to, mode) {
  const svc = new gm.DirectionsService()
  const ask = (travelMode) => svc.route({
    origin: from, destination: to, travelMode,
    ...(travelMode === 'DRIVING'
      ? { drivingOptions: { departureTime: new Date(), trafficModel: 'BEST_GUESS' } }
      : {}),
  })
  let res
  let modeFallback = false
  try {
    res = await ask(TRAVEL[mode] ?? 'DRIVING')
  } catch (e) {
    if (mode !== 'bike') throw e
    res = await ask('DRIVING')
    modeFallback = true
  }
  const r = res.routes?.[0]
  const leg = r?.legs?.[0]
  if (!leg) throw new Error('no route')
  return {
    at: Date.now(), via: 'google', mode, modeFallback,
    distance: leg.distance.value, duration: leg.duration.value,
    durationInTraffic: leg.duration_in_traffic?.value ?? null,
    coordinates: r.overview_path.map((p) => [p.lat(), p.lng()]),
    steps: leg.steps.map((s) => ({
      text: stripHtml(s.instructions), name: '', distance: s.distance.value,
      type: s.maneuver || '', modifier: '',
      lat: s.start_location.lat(), lng: s.start_location.lng(),
    })),
  }
}

/**
 * Fetch a route: Google when its key loads, the OSRM demo otherwise, and the
 * cached copy when offline or when both fail. `mode` is 'car' or 'bike'.
 * Returns { distance, duration, durationInTraffic, coordinates, steps, via,
 * modeFallback, cached, stale }.
 */
export async function getRoute(from, to, mode = 'car') {
  if (mode === 'driving') mode = 'car'
  const key = routeKey(from, to, mode)
  const cache = readCache()
  const hit = cache[key]

  // A cached route's traffic is as old as the cache. Showing yesterday's jam
  // as though it were live is worse than showing none.
  if (!navigator.onLine) return hit ? { ...hydrate(hit), traffic: [], cached: true, stale: true } : null

  try {
    let route
    const gm = await loadGoogleMaps().catch(() => null)
    try {
      if (!gm) throw new Error('Google Maps unavailable')
      try {
        route = await routesApiRoute(gm, from, to, mode)
      } catch (e) {
        // Most often the Routes API is simply not enabled on the key. The
        // route still works; it just arrives without traffic colouring.
        console.info('Trekov: Routes API unavailable, falling back —', e.message)
        route = await googleRoute(gm, from, to, mode)
      }
    } catch (e) {
      console.info('Trekov: Google directions unavailable —', e.message)
      route = await osrmRoute(from, to, mode)
    }
    cache[key] = dehydrate(route)
    writeCache(cache)
    return { ...route, cached: false, stale: false }
  } catch (e) {
    console.warn('Trekov: routing failed', e)
    return hit ? { ...hydrate(hit), traffic: [], cached: true, stale: true } : null
  }
}

/** Plain-English instruction for an OSRM maneuver. */
export function instruction(step) {
  if (!step) return 'Continue'
  if (step.text) return step.text          // Google already wrote the sentence
  const road = step.name ? ` onto ${step.name}` : ''
  // OSRM emits modifier "straight" on a turn maneuver, which reads as
  // "Turn straight" unless it is special-cased.
  const straight = step.modifier === 'straight' || !step.modifier
  const dir = step.modifier && !straight ? ` ${step.modifier}` : ''
  switch (step.type) {
    case 'depart':   return step.name ? `Set off along ${step.name}` : 'Set off toward your route'
    case 'arrive':   return 'Arrive at your destination'
    case 'turn':     return straight ? `Continue straight${road}` : `Turn${dir}${road}`
    case 'merge':    return `Merge${dir}${road}`
    case 'fork':     return `Keep${dir}${road}`
    case 'roundabout':
    case 'rotary':   return `Take the roundabout${road}`
    case 'new name': return `Continue${road}`
    default:         return `Continue${dir}${road}`
  }
}

/** The previous waypoint route, kept for keys without the Routes API. */
async function directionsTrip(origin, stops, mode) {
  const gm = await loadGoogleMaps()
  const svc = new gm.DirectionsService()
  const res = await svc.route({
    origin,
    destination: stops.at(-1),
    waypoints: stops.slice(0, -1).map((s) => ({ location: s, stopover: true })),
    travelMode: TRAVEL[mode] ?? 'DRIVING',
    ...(mode === 'car'
      ? { drivingOptions: { departureTime: new Date(), trafficModel: 'BEST_GUESS' } }
      : {}),
  })
  const r = res.routes?.[0]
  if (!r?.legs?.length) throw new Error('no route')

  let cumulative = 0
  return {
    at: Date.now(), via: 'google', mode,
    coordinates: r.overview_path.map((p) => [p.lat(), p.lng()]),
    legs: r.legs.map((leg, i) => {
      // Named `secs` rather than `seconds`: that is a module-level helper for
      // the Routes API's "123s" strings, and shadowing it here invites a very
      // quiet bug the day someone reaches for it.
      const secs = leg.duration_in_traffic?.value ?? leg.duration.value
      cumulative += secs
      return {
        index: i,
        distance: leg.distance.value,
        duration: secs,
        cumulative,
        inTraffic: Boolean(leg.duration_in_traffic),
      }
    }),
    steps: (r.legs[0]?.steps ?? []).map((st) => ({
      text: stripHtml(st.instructions), name: '', distance: st.distance.value,
      type: st.maneuver || '', modifier: '',
      lat: st.start_location.lat(), lng: st.start_location.lng(),
    })),
  }
}

/**
 * The same Routes API call, but through every stop in order.
 *
 * `intermediates` gives one leg per hop — which is what the itinerary panel
 * needs for per-destination distance and ETA — while the speed readings still
 * come back for the whole polyline, so a trip route is coloured exactly like a
 * single-destination one.
 */
const ROUTES_TRIP_FIELDS = [
  'routes.distanceMeters', 'routes.duration', 'routes.staticDuration',
  'routes.polyline.encodedPolyline',
  'routes.legs.distanceMeters', 'routes.legs.duration', 'routes.legs.staticDuration',
  'routes.legs.steps.navigationInstruction', 'routes.legs.steps.distanceMeters',
  'routes.legs.steps.startLocation',
  'routes.travelAdvisory.speedReadingIntervals',
].join(',')

const asPoint = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } })

async function routesApiTrip(origin, stops, mode) {
  if (!MAPS_KEY) throw new Error('no key')
  const res = await fetch(ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': MAPS_KEY,
      'X-Goog-FieldMask': ROUTES_TRIP_FIELDS,
    },
    body: JSON.stringify({
      origin: asPoint(origin),
      destination: asPoint(stops.at(-1)),
      intermediates: stops.slice(0, -1).map(asPoint),
      travelMode: mode === 'bike' ? 'TWO_WHEELER' : 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      extraComputations: ['TRAFFIC_ON_POLYLINE'],
      polylineQuality: 'OVERVIEW',
      languageCode: navigator.language || 'en',
      units: 'METRIC',
    }),
  })
  if (!res.ok) throw new Error(`Routes ${res.status}`)
  const data = await res.json()
  const r = data.routes?.[0]
  if (!r?.polyline?.encodedPolyline || !r.legs?.length) throw new Error('no route')

  const encoded = r.polyline.encodedPolyline
  let cumulative = 0
  return {
    at: Date.now(), via: 'routes', mode,
    encoded,
    coordinates: decodePolyline(encoded),
    traffic: (r.travelAdvisory?.speedReadingIntervals ?? [])
      .filter((i) => i.speed && i.speed !== 'NORMAL')
      .map((i) => ({
        start: i.startPolylinePointIndex ?? 0,
        end: i.endPolylinePointIndex ?? 0,
        speed: i.speed,
      })),
    legs: r.legs.map((leg, i) => {
      const withTraffic = seconds(leg.duration)
      const free = seconds(leg.staticDuration)
      cumulative += withTraffic
      return {
        index: i,
        distance: leg.distanceMeters ?? 0,
        duration: withTraffic,
        cumulative,
        // Flagged only when traffic is actually costing this leg time.
        inTraffic: free != null && withTraffic > free,
      }
    }),
    // Parity with what this returned before: the first leg's turns. Guidance
    // past the first stop is a separate gap, not something to change here.
    steps: (r.legs[0]?.steps ?? []).map((st) => ({
      text: st.navigationInstruction?.instructions ?? '',
      name: '', distance: st.distanceMeters ?? 0,
      type: st.navigationInstruction?.maneuver || '', modifier: '',
      lat: st.startLocation?.latLng?.latitude,
      lng: st.startLocation?.latLng?.longitude,
    })),
  }
}

/**
 * A route through every remaining stop of a trip, in order.
 *
 * Google returns one leg per hop, which is exactly what the itinerary panel
 * needs — per-destination distance and ETA, and a cumulative arrival time.
 * OSRM's demo server has no waypoint support worth relying on, so without a
 * Google key this falls back to routing each hop separately.
 */
export async function getTripRoute(origin, stops, mode = 'car') {
  if (!stops?.length) return null
  const key = `trip|${mode}|${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}|` +
              stops.map((s) => `${s.lat.toFixed(3)},${s.lng.toFixed(3)}`).join(';')
  const cache = readCache()
  const hit = cache[key]
  if (!navigator.onLine) return hit ? { ...hydrate(hit), traffic: [], cached: true, stale: true } : null

  try {
    let route
    try {
      try {
        route = await routesApiTrip(origin, stops, mode)
      } catch (e) {
        console.info('Trekov: Routes API trip unavailable, falling back —', e.message)
        route = await directionsTrip(origin, stops, mode)
      }
    } catch (e) {
      console.info('Trekov: waypoint routing unavailable —', e.message)
      // One hop at a time, chained: slower and no traffic, but honest numbers.
      const coordinates = []
      const legs = []
      let from = origin
      let cumulative = 0
      for (const [i, stop] of stops.entries()) {
        const hop = await osrmRoute(from, stop, mode)
        coordinates.push(...hop.coordinates)
        cumulative += hop.duration
        legs.push({ index: i, distance: hop.distance, duration: hop.duration, cumulative, inTraffic: false })
        from = stop
      }
      route = { at: Date.now(), via: 'osrm', mode, coordinates, legs, steps: [] }
    }

    route.distance = route.legs.reduce((n, l) => n + l.distance, 0)
    route.duration = route.legs.reduce((n, l) => n + l.duration, 0)
    cache[key] = dehydrate(route)
    writeCache(cache)
    return { ...route, cached: false, stale: false }
  } catch (e) {
    console.warn('Trekov: trip routing failed', e)
    return hit ? { ...hydrate(hit), traffic: [], cached: true, stale: true } : null
  }
}
