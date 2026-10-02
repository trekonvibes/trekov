// Google's own photos of a place, fetched live when its sheet opens.
//
// Google's terms allow showing these but not keeping them, so nothing here is
// stored beyond this session: one Text Search for the place, then image URLs
// the browser loads (and caches the ordinary way). Each photo keeps its
// author credit, which Google requires us to show.

import { platform } from './platform'

const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY
const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText'
const session = new Map()

/** @returns Promise<Array<{ src, authors: [{ name, uri }] }>> — [] when unavailable */
export async function googlePhotos(place, { max = 6 } = {}) {
  if (!KEY || !navigator.onLine) return []
  if (session.has(place.id)) return session.get(place.id)
  const pending = (async () => {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'places.id,places.photos' },
        body: JSON.stringify({
          textQuery: `${place.name}, ${place.region}`,
          pageSize: 1,
          locationBias: { circle: { center: { latitude: place.lat, longitude: place.lng }, radius: 5000 } },
        }),
      })
      if (!res.ok) return []
      const data = await res.json()
      const photos = (data.places?.[0]?.photos ?? []).slice(0, max).map((ph) => ({
        src: `https://places.googleapis.com/v1/${ph.name}/media?maxWidthPx=640&key=${KEY}`,
        authors: (ph.authorAttributions ?? []).map((a) => ({ name: a.displayName, uri: a.uri })),
      }))
      // The iPhone app's web view sends no referrer with an <img>, so Google's
      // key restriction refused every photo there (broken images, 2026-09-15).
      // A fetch does carry it: ask for the image's own address instead.
      if (platform !== 'ios') return photos
      const direct = await Promise.all(photos.map(async (ph) => {
        try {
          const r = await fetch(`${ph.src}&skipHttpRedirect=true`)
          const uri = r.ok ? (await r.json()).photoUri : null
          return uri ? { ...ph, src: uri } : null
        } catch {
          return null
        }
      }))
      return direct.filter(Boolean)
    } catch {
      return []
    }
  })()
  session.set(place.id, pending)
  return pending
}
