// Pick an engine: Google when the key loads and we are online, MapLibre on
// OpenFreeMap otherwise. Returns the same driver shape either way.
import { useEffect, useState } from 'react'
import { MAPS_REFUSED, loadGoogleMaps } from '../gmaps'
import { createGoogleMap } from './google'

/**
 * A counter that ticks when Google refuses the key. Put it in a map effect's
 * dependencies and the screen rebuilds its map — and because the key is now
 * marked refused, the rebuild lands on the offline engine.
 */
export function useMapsRefused() {
  const [n, setN] = useState(0)
  useEffect(() => {
    const bump = () => setN((x) => x + 1)
    window.addEventListener(MAPS_REFUSED, bump)
    return () => window.removeEventListener(MAPS_REFUSED, bump)
  }, [])
  return n
}

export const preferredMapType = () => localStorage.getItem('trekov.mapType') || 'hybrid'
export const rememberMapType = (t) => localStorage.setItem('trekov.mapType', t)

/**
 * Create a map inside `host`.
 *
 * Each call mounts its own child element rather than using `host` directly.
 * Creation is async (the Google script may still be loading), and React 18
 * StrictMode runs an effect's mount, cleanup and mount again synchronously —
 * so two creations raced for one element and the engine threw "Map container is
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
    console.info('Trekov: using the offline map —', e.message)
    // Imported here rather than at the top so people on Google Maps never
    // download it until the moment they need it.
    const { createMaplibreMap } = await import('./maplibre')
    driver = createMaplibreMap(el, opts)
  }

  const teardown = driver.destroy
  driver.destroy = () => { try { teardown() } finally { el.remove() } }
  return driver
}
