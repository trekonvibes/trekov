// A shared trip travels inside the URL itself. There is no backend, so the
// link has to carry the whole itinerary — including any places the recipient
// has never seen, or their copy would render empty rows.

const toB64Url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64Url = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))) 

/** Pack a trip and the places it references into a shareable link. */
export function encodeTrip(trip, places) {
  const used = trip.stops
    .map((s) => places[s.placeId])
    .filter(Boolean)
    .map(({ id, name, region, country, lat, lng, bestTime, blurb }) =>
      ({ id, name, region, country, lat, lng, bestTime, blurb }))

  const payload = {
    v: 1,
    title: trip.title, start: trip.start, end: trip.end, notes: trip.notes,
    stops: trip.stops.map((s) => ({ placeId: s.placeId, note: s.note })),
    places: used,
  }
  // Invites point at /i/ rather than straight at the app. The recipient is
  // usually on a phone, in a chat app's browser, and may not have Trekov at
  // all — /i/ works that out and forwards. Links already sent that point at
  // /app/#trip= keep working; the app reads the same hash either way.
  return `${location.origin}/i/#trip=${toB64Url(JSON.stringify(payload))}`
}

/** Read a trip out of the current URL, or null if there isn't one. */
export function decodeTripFromHash(hash = location.hash) {
  const match = hash.match(/[#&]trip=([A-Za-z0-9\-_]+)/)
  if (!match) return null
  try {
    const trip = JSON.parse(fromB64Url(match[1]))
    if (trip?.v !== 1 || !Array.isArray(trip.stops)) return null
    return trip
  } catch {
    return null
  }
}

/**
 * Hand the link to the OS share sheet where there is one, otherwise the
 * clipboard. Returns what actually happened so the UI can say so.
 */
export async function shareLink(url, title) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text: `${title} — planned on Trekov`, url })
      return 'shared'
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled'
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}
