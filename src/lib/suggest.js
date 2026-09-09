// Suggestions for a planned trip: what it costs in tolls, what is worth
// stopping for, and where to sleep.
//
// A note on what this is, because the label matters. There is no language
// model behind any of it — Trekov is a static site with no server, and an LLM
// key shipped to the browser is a key given away. What is here instead is
// every real source the app already pays for, asked the questions a planner
// would ask: the Routes API for tolls, our own listings table for partners who
// have paid to be found, and Places for everything else. The ranking is ours;
// the facts are theirs.

import { supabase } from './supabase'
import { CATEGORIES, findNearby } from './nearby'

const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'

const point = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } })
const cache = new Map()

async function once(key, fn) {
  if (cache.has(key)) return cache.get(key)
  const value = await fn()
  cache.set(key, value)
  return value
}

/**
 * What the road costs, per vehicle.
 *
 * Asked twice on purpose. India tolls cars and exempts two-wheelers, so the
 * honest answer is two answers — and a rider planning the same route as a
 * driver should see that the toll line does not apply to them rather than
 * having to know it.
 */
async function tollsFor(stops, travelMode) {
  if (!KEY || stops.length < 2) return null
  const body = {
    origin: point(stops[0]),
    destination: point(stops.at(-1)),
    intermediates: stops.slice(1, -1).map(point),
    travelMode,
    routingPreference: 'TRAFFIC_AWARE',
    extraComputations: ['TOLLS'],
    languageCode: navigator.language || 'en',
    units: 'METRIC',
    // Tolls are only computed for DRIVE when the vehicle is described.
    ...(travelMode === 'DRIVE'
      ? { routeModifiers: { vehicleInfo: { emissionType: 'GASOLINE' } } }
      : {}),
  }
  const res = await fetch(ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      // No polyline is asked for here, so polylineQuality must not be sent —
      // the API rejects the pair outright.
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.travelAdvisory.tollInfo',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Routes ${res.status}`)
  const route = (await res.json()).routes?.[0]
  const price = route?.travelAdvisory?.tollInfo?.estimatedPrice?.[0]
  if (!price) return { amount: 0, currency: null, distance: route?.distanceMeters ?? null }
  return {
    // Money arrives as whole units plus nanos; both are optional.
    amount: Number(price.units ?? 0) + Number(price.nanos ?? 0) / 1e9,
    currency: price.currencyCode ?? null,
    distance: route?.distanceMeters ?? null,
  }
}

/** Tolls for the same itinerary by car and by bike. */
export function tripTolls(stops) {
  const key = `tolls|${stops.map((s) => `${s.lat.toFixed(2)},${s.lng.toFixed(2)}`).join(';')}`
  return once(key, async () => {
    const [car, bike] = await Promise.all([
      tollsFor(stops, 'DRIVE').catch(() => null),
      tollsFor(stops, 'TWO_WHEELER').catch(() => null),
    ])
    return { car, bike }
  })
}

/** Evenly spaced samples along a route, for "what is on the way". */
function samples(coordinates, count) {
  if (!coordinates?.length) return []
  const out = []
  for (let i = 1; i <= count; i++) {
    const at = Math.floor((coordinates.length - 1) * (i / (count + 1)))
    const [lat, lng] = coordinates[at]
    out.push({ lat, lng })
  }
  return out
}

/**
 * What is available along the way, sampled rather than swept.
 *
 * A search per kilometre would be accurate and unaffordable. Three points
 * spread across the route answer the question people actually ask — is there
 * fuel and food on this road, or should I carry it — at three searches per
 * category.
 */
export function alongRoute(coordinates, categoryIds = ['fuel', 'food'], { points = 3 } = {}) {
  const spots = samples(coordinates, points)
  if (!spots.length) return Promise.resolve([])
  const key = `along|${categoryIds.join(',')}|${spots.map((s) => `${s.lat.toFixed(1)},${s.lng.toFixed(1)}`).join(';')}`
  return once(key, async () => {
    const groups = await Promise.all(categoryIds.map(async (id) => {
      const hits = await Promise.all(spots.map((s) =>
        // No widening here: this samples a corridor, and a result 200 km
        // off the route is not "on the way" by any reading.
        findNearby(id, s, { radiusKm: 12 }).then((r) => r.results).catch(() => [])))
      const seen = new Set()
      const merged = []
      for (const hit of hits.flat()) {
        const name = hit.name.toLowerCase()
        if (seen.has(name)) continue
        seen.add(name)
        merged.push(hit)
      }
      return { id, label: CATEGORIES.find((c) => c.id === id)?.label ?? id, results: merged.slice(0, 6) }
    }))
    return groups.filter((g) => g.results.length)
  })
}

/**
 * Where to sleep near a stop, partners first.
 *
 * This is the listings table earning its keep: a hotel that has paid to be on
 * Trekov is the first thing a planner sees, above the same commodity results
 * everyone else has. findNearby already ranks that way; this only names it.
 */
export async function staysNear(place) {
  const { results } = await findNearby('hotel', place, { radiusKm: 15, expand: true })
  return {
    partners: results.filter((r) => r.partner),
    others: results.filter((r) => !r.partner).slice(0, 5),
  }
}

/** Things worth stopping for near a place. */
export async function attractionsNear(place) {
  const { results } = await findNearby('attraction', place, { radiusKm: 15, expand: true })
  return results.slice(0, 6)
}

/** Whether partner listings can be consulted at all. */
export const hasPartners = () => Boolean(supabase)
