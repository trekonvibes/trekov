// Handing navigation to a maps app.
//
// Trekov no longer drives the turn-by-turn itself. Tapping Navigate opens
// Mappls, which is the better map for Indian roads — its addressing, its
// house numbers, its village names.
//
// This is a URL handoff, not an SDK. Mappls' Android and iOS SDKs are native
// Kotlin and Swift; nothing in them can be called from a browser, and Trekov
// is a web app. The documented deep link is the whole of what a web app can
// use, and it needs no key.
//
//   https://developer.mappls.com/mappls-apps/ios/

/** Mappls understands driving, trucking, biking and walking. */
const MAPPLS_MODE = {
  // Not 'biking': that is a bicycle, and routing a motorcycle down a cycle
  // path is a worse error than sending it the way a car would go. Indian
  // two-wheelers take the same roads as cars for almost all of a trip.
  bike: 'driving',
  car: 'driving',
}

const coords = (p) => `${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}`

/**
 * A Mappls navigation link.
 *
 * The https form rather than the mappls:// scheme: it deep-links into the app
 * when it is installed, and lands on Mappls' own page when it is not, instead
 * of failing silently the way an unregistered scheme does.
 *
 * Only a single destination — Mappls does not document waypoints on this
 * endpoint, and inventing a parameter that happens to be ignored would send
 * people off on the wrong leg without telling them.
 */
export function mapplsUrl(place, mode = 'car') {
  const name = (place.name || '').replace(/[,&?#]/g, ' ').trim()
  const places = `${coords(place)}${name ? `,${encodeURIComponent(name)}` : ''}`
  return `https://mappls.com/navigation?places=${places}&isNav=true&mode=${MAPPLS_MODE[mode] ?? 'driving'}`
}

/**
 * Google Maps directions, kept as the way out.
 *
 * Mappls' deep link only starts navigation when the Mappls app is installed —
 * their documentation is explicit about it — so a rider without it needs
 * somewhere to go. This one also carries the whole itinerary, which is why a
 * multi-stop trip is offered here rather than through Mappls.
 */
export function googleMapsUrl(place, stops = [], mode = 'car') {
  const url = new URL('https://www.google.com/maps/dir/')
  url.searchParams.set('api', '1')
  url.searchParams.set('destination', coords(place))
  url.searchParams.set('travelmode', 'driving')
  url.searchParams.set('dir_action', 'navigate')
  const waypoints = stops.filter((s) => s && s.lat != null)
  if (waypoints.length) url.searchParams.set('waypoints', waypoints.map(coords).join('|'))
  return url.toString()
}

/** What the traveller last chose to ride, so the handoff matches it. */
export const currentVehicle = () => localStorage.getItem('trekov.vehicle') || 'car'
