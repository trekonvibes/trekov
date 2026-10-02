// New releases for the web app (browser and Home Screen).
//
// An installed web app can stay open in the background for days and never load
// a new release: a phone kept running the old trip-delete code for hours after
// the fix went out, so deleted trips kept coming back (2026-09-12). So the app
// compares its own bundle with the one the live page now names. Just opened →
// it reloads straight into the new release. Already in use → it offers a
// refresh (UpdateNotice), because a surprise reload mid-ride would end the
// navigation. The Android/iOS apps update through lib/liveUpdate.js instead.

import { isNativeApp } from './platform'

const entryOf = (html) => html.match(/\/assets\/app-[\w-]+\.js/)?.[0] ?? null
const RELOADED = 'trekov.reloadedFor'
const JUST_OPENED_MS = 15_000

let ready = null
const subscribers = new Set()
const publish = (v) => { ready = v; subscribers.forEach((f) => f()) }
export const webRelease = () => ready
export const subscribeWebRelease = (f) => { subscribers.add(f); return () => subscribers.delete(f) }
export const dismissWebRelease = () => publish(null)
export const applyWebRelease = () => window.location.reload()

export function watchWebReleases() {
  if (isNativeApp || import.meta.env.DEV) return
  const running = entryOf(document.documentElement.innerHTML)
  if (!running) return
  const opened = Date.now()
  let checking = false

  const check = async () => {
    if (checking || document.hidden || !navigator.onLine) return
    checking = true
    try {
      // The service worker checks pages with the server too (sw.js), so this is the live page.
      const res = await fetch('/app/', { cache: 'no-store' })
      const live = res.ok ? entryOf(await res.text()) : null
      if (!live || live === running) return
      let seen = null
      try { seen = sessionStorage.getItem(RELOADED) } catch { /* private mode */ }
      // Once per release, so a CDN still serving the old page can't cause a reload loop.
      if (Date.now() - opened < JUST_OPENED_MS && seen !== live) {
        try { sessionStorage.setItem(RELOADED, live) } catch { /* private mode */ }
        window.location.reload()
        return
      }
      publish(live)
    } catch {
      // Offline or blocked — the next check will try again.
    } finally {
      checking = false
    }
  }

  check()
  document.addEventListener('visibilitychange', check)
  setInterval(check, 15 * 60_000)
}
