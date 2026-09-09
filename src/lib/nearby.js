// What is around a place: hotels, food, repair shops, other attractions.
//
// Two sources, deliberately ranked:
//   1. Partner listings from our own table — businesses paying to be listed
//   2. Google Places — so a category is never empty anywhere
//
// Partners come first and are labelled. That ordering is the product: the
// subscription buys placement above commodity data, not the existence of a
// result. Nothing here is ever invented — an empty category shows as empty.

import { supabase } from './supabase'

const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY
const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText'
// Field mask, which is also the bill: Places charges by the most expensive
// field asked for. nationalPhoneNumber sits in the Enterprise tier, so this
// request costs more than one without it — worth it, because a number you can
// tap is the whole point of finding a garage on a road you do not know.
const FIELDS = [
  'places.id', 'places.displayName', 'places.rating', 'places.userRatingCount',
  'places.location', 'places.shortFormattedAddress', 'places.priceLevel',
  'places.currentOpeningHours.openNow', 'places.nationalPhoneNumber',
].join(',')

/**
 * Text search rather than `includedTypes`: Google has no type for "bike
 * repair" or "street food stall", and those are exactly the categories a
 * travel app in India needs.
 */
export const CATEGORIES = [
  { id: 'hotel',        label: 'Stays',       blurb: 'Hotels and guest houses',   query: 'hotel or guest house' },
  { id: 'food',         label: 'Restaurants', blurb: 'Sit-down places to eat',    query: 'restaurant' },
  { id: 'street_food',  label: 'Street food', blurb: 'Stalls and local vendors',  query: 'street food stall' },
  { id: 'bike_service', label: 'Bike',        blurb: 'Service, spares, accessories', query: 'motorcycle service spares and accessories' },
  { id: 'car_service',  label: 'Car',         blurb: 'Garages and accessories',      query: 'car repair garage and accessories' },
  { id: 'fuel',         label: 'Fuel',        blurb: 'Petrol pumps and charging',  query: 'petrol pump or fuel station or ev charging' },
  { id: 'rental',       label: 'Rentals',     blurb: 'Bike, car and taxi hire',      query: 'bike and car rental service' },
  { id: 'attraction',   label: 'Attractions', blurb: 'Other things to see',       query: 'tourist attraction' },
]

const cache = new Map()
const cacheKey = (c, lat, lng) => `${c}|${lat.toFixed(2)},${lng.toFixed(2)}`

/** Roughly degrees per km, for a cheap bounding box. */
const KM = 1 / 111

async function partnerListings(category, { lat, lng }, radiusKm) {
  if (!supabase) return []
  const d = radiusKm * KM
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('category', category)
    .gte('lat', lat - d).lte('lat', lat + d)
    .gte('lng', lng - d).lte('lng', lng + d)
    .limit(10)
  if (error) { console.info('Trekov: listings unavailable —', error.message); return [] }
  return (data ?? []).map((l) => ({
    id: `partner-${l.id}`,
    partner: true,
    verified: l.verified,
    name: l.name,
    detail: l.address || l.description,
    phone: l.phone,
    url: l.url,
    rating: null,
    lat: l.lat,
    lng: l.lng,
  }))
}

async function googlePlaces(query, { lat, lng }, radiusKm) {
  if (!KEY || !navigator.onLine) return []
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': FIELDS },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 8,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusKm * 1000 } },
    }),
  })
  if (!res.ok) throw new Error(`Places ${res.status}`)
  const data = await res.json()
  return (data.places ?? []).map((p) => ({
    id: p.id,
    partner: false,
    name: p.displayName?.text ?? 'Unnamed',
    detail: p.shortFormattedAddress ?? '',
    rating: p.rating ?? null,
    reviews: p.userRatingCount ?? 0,
    openNow: p.currentOpeningHours?.openNow ?? null,
    // Local format: it is dialled from the same country nearly every time,
    // and it is what a person would read out.
    phone: p.nationalPhoneNumber ?? '',
    lat: p.location?.latitude,
    lng: p.location?.longitude,
  }))
}

/** Partner listings first, then Google, de-duplicated by name. */
export async function findNearby(categoryId, centre, { radiusKm = 8 } = {}) {
  const category = CATEGORIES.find((c) => c.id === categoryId)
  if (!category || !centre) return []
  const key = cacheKey(categoryId, centre.lat, centre.lng)
  if (cache.has(key)) return cache.get(key)

  const [partners, google] = await Promise.all([
    partnerListings(categoryId, centre, radiusKm),
    googlePlaces(category.query, centre, radiusKm).catch((e) => {
      console.info('Trekov: places search failed —', e.message)
      return []
    }),
  ])

  const seen = new Set(partners.map((p) => p.name.toLowerCase()))
  const merged = [...partners, ...google.filter((g) => !seen.has(g.name.toLowerCase()))]
  cache.set(key, merged)
  return merged
}
