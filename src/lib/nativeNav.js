// Google's own turn-by-turn navigation in the Android and iPhone apps (Punit,
// 2026-09-14: "the app should use the real Google Maps, not the web version";
// iOS 2026-09-15).
//
// The native side (android/…/nav/TrekovNavPlugin.java, ios/App/App/
// TrekovNavPlugin.swift) lays Google's navigation view over the map area of
// Navigate.jsx and reports the rider's road-snapped position and progress back.
// Everything else on that screen — alerts, voice, the riders panel — stays
// here. The website, and an app built without a Navigation SDK key, keep the
// web navigation.

import { registerPlugin } from '@capacitor/core'
import { isNativeApp, platform } from './platform'

const TrekovNav = registerPlugin('TrekovNav')

let available = null

/** Whether this app can hand the map to Google's navigation. */
export async function nativeNavAvailable() {
  if (!isNativeApp || (platform !== 'android' && platform !== 'ios')) return false
  // An escape hatch while developing: localStorage trekov.webNav = '1'.
  if (import.meta.env.DEV) { try { if (localStorage.getItem('trekov.webNav') === '1') return false } catch { /* ignore */ } }
  if (available == null) {
    available = TrekovNav.isAvailable().then((r) => Boolean(r?.available), () => false)
  }
  return available
}

const box = (r) => ({ x: r.left, y: r.top, width: r.width, height: r.height })
const rectOf = (el, visible = true, layout) => ({ ...box(el.getBoundingClientRect()), visible, ...(layout?.() ?? {}) })

/**
 * The iPhone layout: Google's map under the whole screen with the page's
 * panels floating over it. `panels` are the elements over the map — touches on
 * them stay with the page, and Google keeps its own cards clear of them.
 */
export const underPageLayout = (top, bottom) => () => {
  const t = top?.getBoundingClientRect()
  const b = bottom?.getBoundingClientRect()
  return {
    overlay: true,
    holes: [t, b].filter((r) => r && r.width && r.height).map(box),
    insets: { top: t ? Math.max(0, t.bottom) : 0, bottom: b ? Math.max(0, window.innerHeight - b.top) : 0 },
  }
}

/**
 * Starts guidance through `stops` ([{ lat, lng, title }]) inside `el`.
 * Handlers: onLocation({ lat, lng, accuracy, speed, heading, time }),
 * onProgress({ meters, seconds }), onArrival({ final, title }).
 * Returns { ready: Promise, place(visible), riders(list), stop() }. `ready`
 * rejects with an error whose .code is terms | unauthorized | network |
 * location | no_route | unavailable | error.
 */
export function startNativeNav(el, { stops, mode, simulate, simulateFrom, voice = true, mapType = 'roadmap', traffic = true, layout, onLocation, onProgress, onArrival, onVehicleTap, onStep, onFollow }) {
  const subs = [
    TrekovNav.addListener('location', (l) => onLocation?.(l)),
    TrekovNav.addListener('progress', (p) => onProgress?.(p)),
    TrekovNav.addListener('arrival', (a) => onArrival?.(a)),
    TrekovNav.addListener('vehicleTap', () => onVehicleTap?.()),
    // iPhone only: the next turn for the page's own turn card, and whether the
    // camera is still riding with the vehicle.
    TrekovNav.addListener('step', (st) => onStep?.(st)),
    TrekovNav.addListener('follow', (f) => onFollow?.(Boolean(f?.on))),
  ]
  let stopped = false
  const ready = TrekovNav.start({ stops, mode, simulate: Boolean(simulate), simulateFrom, voice, mapType, traffic, rect: rectOf(el, true, layout) })
  return {
    ready,
    place(visible = true) {
      if (!stopped) TrekovNav.setRect(rectOf(el, visible, layout)).catch(() => {})
    },
    /** [{ id, name, lat, lng, heading, stale, captain, icon }], plus images for new icon keys. */
    riders(list, icons) {
      if (!stopped) TrekovNav.setRiders({ riders: list, icons: icons ?? {} }).catch(() => {})
    },
    /** The rider's own vehicle in 3D, from lib/vehicleSprites.js. */
    vehicle(frames) {
      if (!stopped && frames) TrekovNav.setVehicle(frames).catch(() => {})
    },
    voice(on) {
      if (!stopped) TrekovNav.setVoice({ on: Boolean(on) }).catch(() => {})
    },
    mapStyle(type, trafficOn) {
      if (!stopped) TrekovNav.setMapStyle({ mapType: type, traffic: Boolean(trafficOn) }).catch(() => {})
    },
    recenter() {
      if (!stopped) TrekovNav.recenter().catch(() => {})
    },
    overview() {
      if (!stopped) TrekovNav.overview().catch(() => {})
    },
    stop() {
      if (stopped) return
      stopped = true
      subs.forEach((s) => Promise.resolve(s).then((h) => h.remove()).catch(() => {}))
      TrekovNav.stop().catch(() => {})
    },
  }
}

/** What a rider sees when Google's navigation could not start. */
export const NATIVE_NAV_FAILED = {
  terms: "Google's navigation needs its terms accepted — using Trekov's map instead.",
  unauthorized: "Google's navigation isn't set up for this app yet — using Trekov's map instead.",
  network: "No connection for Google's navigation — using Trekov's map instead.",
  location: 'Location is off — using Trekov\'s map instead.',
  no_route: "Google couldn't find a route — using Trekov's map instead.",
}
