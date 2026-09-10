// Pick an engine: Google when the key loads and we are online, Leaflet
// otherwise. Returns the same driver shape either way.
import { loadGoogleMaps } from '../gmaps'
import { createGoogleMap } from './google'
import { createLeafletMap } from './leaflet'

export const preferredMapType = () => localStorage.getItem('trekov.mapType') || 'hybrid'
export const rememberMapType = (t) => localStorage.setItem('trekov.mapType', t)

/**
 * Create a map inside `host`.
 *
 * Each call mounts its own child element rather than using `host` directly.
 * Creation is async (the Google script may still be loading), and React 18
 * StrictMode runs an effect's mount, cleanup and mount again synchronously —
 * so two creations raced for one element and Leaflet threw "Map container is
 * already initialized". With a private element per call, a creation that
 * turns out to be stale simply destroys its own element and nothing else.
 */
export async function createMap(host, opts) {
  const el = document.createElement('div')
  el.style.cssText = 'position:absolute;inset:0'
  host.appendChild(el)

  let driver
  try {
    // Once the Google script has loaded it stays loaded, so losing signal does
    // not make loadGoogleMaps fail — it hands back a map that cannot fetch a
    // single tile. Offline has to be asked for explicitly.
    if (opts.offline) throw new Error('offline requested')
    const gm = await loadGoogleMaps()
    driver = createGoogleMap(gm, el, { mapType: preferredMapType(), ...opts })
  } catch (e) {
    console.info('Trekov: using Leaflet —', e.message)
    driver = createLeafletMap(el, opts)
  }

  const teardown = driver.destroy
  driver.destroy = () => { try { teardown() } finally { el.remove() } }
  return driver
}
