// One fresh GPS fix, for proving a photo was taken where it says.
//
// Posting requires it: the camera is already in-app only, and the fix adds
// where. What a post keeps is the proof — when, how far from the place, how
// accurate — never the raw coordinates, so nobody learns exactly where you
// stood.

import { isNativeApp } from './platform'

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

const shape = (coords, timestamp) => ({
  lat: coords.latitude,
  lng: coords.longitude,
  accuracy: Math.round(coords.accuracy),
  // Navigation leans on these two when they are there.
  speed: Number.isFinite(coords.speed) ? coords.speed : null,
  heading: Number.isFinite(coords.heading) ? coords.heading : null,
  at: new Date(timestamp || Date.now()).toISOString(),
})

/**
 * In the app, the phone's own location service (Capacitor): it asks with the
 * system permission dialog and gives a better fix than the web view's, which is
 * what "a proper app" means here (2026-09-12). The browser path is unchanged.
 */
async function nativeFix(timeout) {
  const { Geolocation } = await import('@capacitor/geolocation')
  const asked = await Geolocation.requestPermissions({ permissions: ['location'] }).catch(() => null)
  if (asked && asked.location === 'denied') throw Object.assign(new Error(MESSAGES.denied), { code: 'denied' })
  const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout, maximumAge: 0 })
  return shape(p.coords, p.timestamp)
}

/** @returns Promise<{ lat, lng, accuracy, at }> — rejects with .code 'denied' | 'timeout' | 'unavailable' */
export async function getFix({ timeout = 20_000 } = {}) {
  if (isNativeApp) {
    try {
      return await nativeFix(timeout)
    } catch (e) {
      if (e?.code === 'denied') throw e
      const message = e?.message ?? ''
      if (/denied|permission/i.test(message)) throw Object.assign(new Error(MESSAGES.denied), { code: 'denied' })
      // Only an app too old to have the location plugin falls back to the web
      // view's location. Falling back on a timeout as well made iPhone ask a
      // second time — "trekov.com would like to use your current location" —
      // right after the app had been allowed (found on the simulator, 2026-09-13).
      if (!/not implemented|unimplemented/i.test(message)) {
        throw Object.assign(new Error(MESSAGES[/timeout/i.test(message) ? 'timeout' : 'unavailable']),
          { code: /timeout/i.test(message) ? 'timeout' : 'unavailable' })
      }
    }
  }
  return new Promise((resolve, reject) => {
    const fail = (code) => reject(Object.assign(new Error(MESSAGES[code]), { code }))
    if (!('geolocation' in navigator)) return fail('unavailable')
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(shape(p.coords, p.timestamp)),
      (e) => fail(e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable'),
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    )
  })
}

/**
 * Follow the rider. Hands back a stop function. Navigation uses this rather
 * than navigator.geolocation directly, so the app gets the phone's own
 * service and the website keeps the browser's.
 */
export function watchFix(onFix, onError) {
  let stop = () => {}
  if (isNativeApp) {
    let id = null
    let dropped = false
    import('@capacitor/geolocation')
      .then(({ Geolocation }) => Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 20_000 }, (p, err) => {
        if (dropped) return
        if (err) return onError?.(/denied|permission/i.test(err?.message ?? '') ? 'denied' : 'unavailable')
        if (p) onFix(shape(p.coords, p.timestamp))
      }))
      .then((watchId) => { id = watchId; if (dropped && id) import('@capacitor/geolocation').then(({ Geolocation }) => Geolocation.clearWatch({ id })) })
      .catch(() => { if (!dropped) stop = watchInBrowser(onFix, onError) })
    return () => {
      dropped = true
      if (id) import('@capacitor/geolocation').then(({ Geolocation }) => Geolocation.clearWatch({ id })).catch(() => {})
      stop()
    }
  }
  return watchInBrowser(onFix, onError)
}

function watchInBrowser(onFix, onError) {
  if (!('geolocation' in navigator)) { onError?.('unavailable'); return () => {} }
  const id = navigator.geolocation.watchPosition(
    (p) => onFix(shape(p.coords, p.timestamp)),
    (e) => onError?.(e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable'),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 },
  )
  return () => navigator.geolocation.clearWatch(id)
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
