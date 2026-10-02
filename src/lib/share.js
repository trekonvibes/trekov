import { shareText } from './native'
import { supabase } from './supabase'

// A shared trip is packed whole — the itinerary and any places the recipient
// has never seen, or their copy would render empty rows. Signed in, that pack
// is kept on the server under a seven-character code and the link is short
// (shortTripLink); otherwise, or offline, the link carries the pack itself
// (encodeTrip). Both open the same way, and links sent either way keep working.

const toB64Url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64Url = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))

/** Pack a trip and the places it references into a shareable link. */
export function encodeTrip(trip, places) {
  // Invites point at /i/ rather than straight at the app. The recipient is
  // usually on a phone, in a chat app's browser, and may not have Trekov at
  // all — /i/ works that out and forwards. Links already sent that point at
  // /app/#trip= keep working; the app reads the same hash either way.
  return `${location.origin}/i/#trip=${toB64Url(JSON.stringify(packTrip(trip, places)))}`
}

/**
 * The short link for a trip — trekov.com/i/#<code> — made or refreshed on the
 * server. Falls back to the long link when there is no account, no network,
 * or the server does not answer: sharing must never wait on it.
 */
export async function shortTripLink(trip, places) {
  const long = encodeTrip(trip, places)
  if (!supabase || !navigator.onLine) return long
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return long
    const { data: code, error } = await supabase.rpc('create_trip_link', { p_trip: trip.id, p_payload: packTrip(trip, places) })
    if (error || !CODE.test(code ?? '')) return long
    return `${location.origin}/i/#${code}`
  } catch {
    return long
  }
}

function packTrip(trip, places) {
  const used = trip.stops
    .map((s) => places[s.placeId])
    .filter(Boolean)
    // No blurb: it was most of the link's length, and a long link is the one a
    // chat app is likeliest to cut short. The recipient's app already has the
    // blurb for catalogue places; for the rest, a name and a position is what a
    // stop needs. Positions to 5 decimals — about a metre.
    .map(({ id, name, region, country, lat, lng, bestTime }) =>
      ({ id, name, region, country, lat: +(+lat).toFixed(5), lng: +(+lng).toFixed(5), bestTime }))

  const payload = {
    v: 1,
    title: trip.title, start: trip.start, end: trip.end, notes: trip.notes,
    // Whether it is a group ride, and whether that ride is open — the invite
    // page says so before anyone taps through.
    kind: trip.kind === 'group' ? 'group' : 'solo',
    visibility: trip.visibility === 'public' ? 'public' : 'private',
    stops: trip.stops.map((s) => ({ placeId: s.placeId, note: s.note })),
    places: used,
  }
  return payload
}

// A short link's code: seven characters from trip_link_code() in
// supabase/trip-links.sql. Ambiguous characters are left out there, so no
// hash the app already uses (#trips, #profile, #business) can look like one.
const CODE = /^[a-km-zA-HJ-NP-Z2-9]{7}$/

/** The short-link code in the current URL, or null. */
export function tripCodeFromHash(hash = location.hash) {
  const code = hash.replace(/^#/, '')
  return CODE.test(code) ? code : null
}

const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v, lo, hi) => (Number.isFinite(+v) && +v >= lo && +v <= hi ? +v : null)
const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Only the fields a trip link is meant to carry, each of the type and size it
 * should be. A link is written by whoever sent it: taking its places as they
 * came let one claim to have been added by the recipient (and be uploaded
 * under their name), carry a photo address that broke out of the map pin's
 * markup, or a javascript: link (launch audit, 2026-09-14).
 */
function cleanTrip(t) {
  if (t?.v !== 1 || !Array.isArray(t.stops)) return null
  const places = (Array.isArray(t.places) ? t.places : []).slice(0, 100).flatMap((p) => {
    const id = typeof p?.id === 'string' && /^[\w-]{1,64}$/.test(p.id) ? p.id : null
    const lat = num(p?.lat, -90, 90)
    const lng = num(p?.lng, -180, 180)
    if (!id || lat == null || lng == null) return []
    return [{ id, name: text(p.name, 120) || 'Stop', region: text(p.region, 120), country: text(p.country, 80), lat, lng, bestTime: text(p.bestTime, 80) }]
  })
  const ids = new Set(places.map((p) => p.id))
  return {
    v: 1,
    title: text(t.title, 120) || 'Shared trip',
    start: DATE.test(t.start) ? t.start : '',
    end: DATE.test(t.end) ? t.end : '',
    notes: text(t.notes, 5000),
    kind: t.kind === 'group' ? 'group' : 'solo',
    visibility: t.visibility === 'public' ? 'public' : 'private',
    stops: t.stops.slice(0, 100).flatMap((s) => (typeof s?.placeId === 'string' && /^[\w-]{1,64}$/.test(s.placeId)
      ? [{ placeId: s.placeId, note: text(s.note, 500) }] : [])),
    places: [...ids].map((id) => places.find((p) => p.id === id)),
  }
}

/** Read a trip out of the current URL, or null if there isn't one. */
export function decodeTripFromHash(hash = location.hash) {
  const match = hash.match(/[#&]trip=([A-Za-z0-9\-_]+)/)
  if (!match) return null
  try {
    return cleanTrip(JSON.parse(fromB64Url(match[1])))
  } catch {
    return null
  }
}

/**
 * The trip a short link points at, fetched from the server, or null: for a
 * code nobody made, a link cut short, or no network. What comes back is
 * cleaned exactly as a long link is — it was written by whoever shared it.
 */
export async function fetchTripByCode(code) {
  if (!supabase || !CODE.test(code)) return null
  try {
    const { data, error } = await supabase.rpc('trip_link', { p_code: code })
    return error || !data ? null : cleanTrip(data)
  } catch {
    return null
  }
}

/**
 * Hand the link to the OS share sheet where there is one, otherwise the
 * clipboard. Returns what actually happened so the UI can say so.
 */
export async function shareLink(url, title) {
  // In the app this opens the phone's own share sheet — every messaging app the
  // rider has — and on the web the browser's, falling back to the clipboard.
  return shareText({ title, text: `${title} — planned on Trekov`, url })
}
