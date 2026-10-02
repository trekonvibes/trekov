// Riding live with the screen off (Punit, 2026-09-12).
//
// A group trip is only useful if the others keep seeing you, and Android stops
// handing locations to a sleeping web view. The fix is a foreground service:
// the phone keeps sending positions and, in exchange, shows an ongoing
// notification — which is honest anyway, since the group is watching the rider
// move. It stops the moment navigation closes.
//
// No ACCESS_BACKGROUND_LOCATION: the service runs only while a trip is open,
// which is also the simpler promise to make to Google Play.

import { registerPlugin } from '@capacitor/core'
import { isNativeApp } from './platform'

// The plugin ships native code only — no JavaScript entry point — so it is
// reached through Capacitor's registry rather than imported.
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation')

let watcher = null

/**
 * Follow the rider until `stopLiveTrip()`. Returns false when the phone can't
 * (no plugin, permission refused), so navigation falls back to the ordinary watch.
 */
export async function startLiveTrip(onFix) {
  if (!isNativeApp || watcher) return false
  try {
    watcher = await BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: 'Trekov — riding live',
        backgroundMessage: 'Your group can see you on the map.',
        requestPermissions: true,
        stale: false,
        distanceFilter: 10,
      },
      (location, error) => {
        if (error || !location) return
        onFix({
          lat: location.latitude,
          lng: location.longitude,
          accuracy: Math.round(location.accuracy ?? 0),
          speed: Number.isFinite(location.speed) ? location.speed : null,
          heading: Number.isFinite(location.bearing) ? location.bearing : null,
          at: new Date(location.time ?? Date.now()).toISOString(),
        })
      },
    )
    return true
  } catch {
    watcher = null
    return false
  }
}

export async function stopLiveTrip() {
  if (!watcher) return
  const id = watcher
  watcher = null
  try {
    await BackgroundGeolocation.removeWatcher({ id })
  } catch { /* already gone */ }
}
