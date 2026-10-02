// "Search anywhere", not just the places Trekov already knows.
//
// As you type: Google's own Places Autocomplete — the suggestions Google Maps
// shows, so half a word ("rohta") already offers Rohtang Pass. The old Text
// Search treated every pause in typing as a finished search: "rohta" found a
// village called Rohta, and "palladium mall" from the India view found the one
// in Mumbai first (Punit, 2026-09-15). Suggestions carry no coordinates, so a
// picked one is looked up once (resolveHit) inside the same session, which is
// how Google bills a search as one.
//
// Text Search stays as the fallback — for a query autocomplete has nothing
// for — and Geocoding after that, for plain addresses and PIN codes.
//
// Results are cached per query: typing fires a lot of lookups.

import { loadGoogleMaps } from './gmaps'

const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY
const API = 'https://places.googleapis.com/v1'
const FIELDS = 'places.id,places.displayName,places.formattedAddress,places.location'

const cache = new Map()
const MAX_CACHE = 80

// One session per search: from the first letter typed to the place picked.
let session = null
const sessionToken = () => (session ??= crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
/** Call once a suggestion has been picked or the search box is cleared. */
export const endSearchSession = () => { session = null }

// Near you when we know where you are; otherwise near what the map shows.
// 30 km keeps a city's own mall ahead of a same-named one elsewhere.
const bias = (near) => (near
  ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 30000 } } }
  : {})

const post = async (path, body, fieldMask) => {
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}) },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Places ${res.status}`)
  return res.json()
}

async function suggest(q, near) {
  if (!KEY) return []
  const data = await post('places:autocomplete', {
    input: q,
    sessionToken: sessionToken(),
    languageCode: 'en',
    ...bias(near),
    ...(near ? { origin: { latitude: near.lat, longitude: near.lng } } : {}),
  })
  return (data.suggestions ?? []).map((s) => s.placePrediction).filter(Boolean).slice(0, 7).map((p) => ({
    id: p.placeId,
    name: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
    detail: p.structuredFormat?.secondaryText?.text ?? '',
    distance: Number.isFinite(p.distanceMeters) ? p.distanceMeters : null,
    // Coordinates arrive when it is picked (resolveHit).
    lat: null,
    lng: null,
  }))
}

async function searchPlaces(q, near) {
  if (!KEY) return []
  const { places = [] } = await post('places:searchText', { textQuery: q, maxResultCount: 6, languageCode: 'en', ...bias(near) }, FIELDS)
  return places.filter((p) => p.location).map((p) => {
    const name = p.displayName?.text || p.formattedAddress
    return {
      id: p.id,
      name,
      // Some addresses start with the business name again; don't show it twice.
      detail: (p.formattedAddress ?? '').replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},\\s*`), ''),
      lat: p.location.latitude,
      lng: p.location.longitude,
    }
  })
}

async function geocodeAddress(q, near) {
  const gm = await loadGoogleMaps()
  const geocoder = new gm.Geocoder()
  const { results } = await geocoder.geocode({
    address: q,
    ...(near ? { bounds: new gm.LatLngBounds(
      new gm.LatLng(near.lat - 2, near.lng - 2),
      new gm.LatLng(near.lat + 2, near.lng + 2),
    ) } : {}),
  })
  return (results ?? []).slice(0, 6).map((r) => {
    const loc = r.geometry.location
    const parts = r.formatted_address.split(',').map((p) => p.trim())
    return {
      id: r.place_id,
      name: parts[0] || r.formatted_address,
      detail: parts.slice(1).join(', '),
      lat: loc.lat(),
      lng: loc.lng(),
    }
  })
}

/**
 * A picked result with its coordinates. Suggestions need one Place Details
 * look-up (in the same session); results that already have them come back as they are.
 */
export async function resolveHit(hit) {
  if (Number.isFinite(hit.lat) && Number.isFinite(hit.lng)) return hit
  const url = `${API}/places/${encodeURIComponent(hit.id)}?sessionToken=${encodeURIComponent(sessionToken())}&languageCode=en`
  const res = await fetch(url, { headers: { 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'id,displayName,formattedAddress,location' } })
  endSearchSession()
  if (!res.ok) throw new Error(`Places ${res.status}`)
  const p = await res.json()
  if (!p.location) throw new Error('No location')
  return {
    ...hit,
    name: p.displayName?.text || hit.name,
    detail: hit.detail || p.formattedAddress || '',
    lat: p.location.latitude,
    lng: p.location.longitude,
  }
}

/**
 * Everything that matches near you — what Google Maps shows when you press
 * search on "petrol pump" or "palladium" rather than picking a suggestion.
 */
export async function searchAll(query, { near } = {}) {
  const q = query.trim()
  if (!q || !navigator.onLine || !KEY) return []
  endSearchSession()
  try {
    const { places = [] } = await post('places:searchText',
      { textQuery: q, maxResultCount: 12, languageCode: 'en', ...bias(near) }, FIELDS)
    return places.filter((p) => p.location).map((p) => ({
      id: p.id,
      name: p.displayName?.text || p.formattedAddress,
      detail: p.formattedAddress ?? '',
      lat: p.location.latitude,
      lng: p.location.longitude,
    }))
  } catch (e) {
    console.info('Trekov: place search unavailable —', e.message)
    return []
  }
}

export async function searchAnywhere(query, { near } = {}) {
  const q = query.trim()
  if (q.length < 2) return []
  const key = `${q}|${near ? `${near.lat.toFixed(1)},${near.lng.toFixed(1)}` : ''}`
  if (cache.has(key)) return cache.get(key)
  if (!navigator.onLine) return []

  let hits = []
  for (const find of [suggest, searchPlaces]) {
    try {
      hits = await find(q, near)
    } catch (e) {
      console.info('Trekov: place search unavailable —', e.message)
    }
    if (hits.length) break
  }
  if (!hits.length) {
    try {
      hits = await geocodeAddress(q, near)
    } catch (e) {
      // Not fatal: the app's own places still match, so search keeps working.
      console.info('Trekov: geocoding unavailable —', e.message)
      return []
    }
  }

  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value)
  cache.set(key, hits)
  return hits
}
