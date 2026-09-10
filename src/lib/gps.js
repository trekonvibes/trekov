// One fresh GPS fix, for proving a photo was taken where it says.
//
// Posting requires it: the camera is already in-app only, and the fix adds
// where. What a post keeps is the proof — when, how far from the place, how
// accurate — never the raw coordinates, so nobody learns exactly where you
// stood.

/** An existing place accepts photos from within this distance. */
export const PHOTO_RADIUS_M = 10_000
/** A new place's pin may sit this far from where you are, at most. */
export const NEW_PIN_RADIUS_M = 1_000
/** A fix older than this is taken again before posting. */
export const FIX_MAX_AGE_MS = 10 * 60_000

const MESSAGES = {
  denied: 'Location is off for Trekov. Turn it on to post — it proves the photo was taken here.',
  timeout: 'Getting your location took too long. Step outside or away from buildings and try again.',
  unavailable: "Your phone can't find its location right now. Try again in a moment.",
}

/** @returns Promise<{ lat, lng, accuracy, at }> — rejects with .code 'denied' | 'timeout' | 'unavailable' */
export function getFix({ timeout = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    const fail = (code) => reject(Object.assign(new Error(MESSAGES[code]), { code }))
    if (!('geolocation' in navigator)) return fail('unavailable')
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracy: Math.round(p.coords.accuracy),
        at: new Date(p.timestamp || Date.now()).toISOString(),
      }),
      (e) => fail(e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable'),
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    )
  })
}

export const gpsMessage = (code) => MESSAGES[code] ?? MESSAGES.unavailable

/** Great-circle distance in metres between two { lat, lng }. */
export function metresBetween(a, b) {
  const R = 6_371_000
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export const formatMetres = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`)
