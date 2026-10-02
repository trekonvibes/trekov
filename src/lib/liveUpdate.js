// Live updates for the Android and iOS apps.
//
// The app ships with its code, so it works offline from the first launch.
// After that it checks trekov.com for a newer build, downloads it in the
// background and switches to it the next time the app is opened or comes
// back to the screen — never in the middle of a screen someone is using.
// The website needs none of this: its service worker is network-first.
//
// What cannot travel this way is the native shell (plugins, permissions).
// Those need a new app release; the manifest says which native version a
// bundle needs, older apps keep their current code, and the notice below
// tells Android users a new app is out.
//
// The manifest and bundle come from scripts/build-update.mjs via deploy.sh.

import { CapacitorHttp, registerPlugin } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { isNativeApp, platform } from './platform'

// Fetched with the phone's own HTTP client: inside the app the WebView serves
// trekov.com from the bundled files, so a WebView fetch would never leave it.
const MANIFEST = 'https://trekov.com/updates/latest.json'
/** Live updates are only ever taken from here, whatever a manifest says. */
const BUNDLES = 'https://trekov.com/updates/'

const TrekovApp = registerPlugin('TrekovApp')
// Installed from Google Play: Play updates the app, and an app from Play must
// not offer to install a new version itself (Play policy; launch audit).
let fromPlay = null
const installedFromPlay = async () => {
  if (fromPlay == null) fromPlay = await TrekovApp.installSource().then((r) => Boolean(r?.play), () => false)
  return fromPlay
}

/** "1.10" is newer than "1.9". */
function newer(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d > 0
  }
  return false
}

/** { version, builtAt } stamped into the running bundle by build-update.mjs. */
async function runningBundle() {
  try { return await (await fetch('/bundle-version.json', { cache: 'no-store' })).json() } catch { return {} }
}

// A newer app release (native change) — shown by UpdateNotice.
let release = null
const subscribers = new Set()
const publish = (r) => { release = r; subscribers.forEach((f) => f()) }
export const nativeRelease = () => release
export const subscribeRelease = (f) => { subscribers.add(f); return () => subscribers.delete(f) }
export const dismissRelease = () => publish(null)

let checking = false
async function check() {
  if (checking || !navigator.onLine) return
  checking = true
  try {
    const res = await CapacitorHttp.get({ url: `${MANIFEST}?t=${Date.now()}`, responseType: 'json' })
    const m = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
    if (!m?.version || !m?.url) return
    // A manifest pointing anywhere else is not ours to run.
    if (!String(m.url).startsWith(BUNDLES) || !/^[\w.-]+$/.test(String(m.version))) return
    if (m.androidDownload && !String(m.androidDownload).startsWith('https://trekov.com/download/')) m.androidDownload = null
    const { native } = await CapacitorUpdater.current()

    if (platform === 'android' && m.nativeLatest && m.androidDownload && newer(m.nativeLatest, native) && !(await installedFromPlay())) {
      publish({ version: m.nativeLatest, url: m.androidDownload })
    }
    // This bundle relies on native parts the installed app doesn't have.
    if (m.minNative && newer(m.minNative, native)) return
    const running = await runningBundle()
    if (m.version === running.version) return
    // Never go back in time. A new app release built before the website was
    // deployed carries newer code than the live update there, and swapping
    // it in took Google navigation away from the 2.10 app (2026-09-14).
    if (running.builtAt && m.builtAt && m.builtAt < running.builtAt) return

    const { bundles } = await CapacitorUpdater.list()
    const ready = bundles.find((b) => b.version === m.version && b.status === 'success')
    const bundle = ready ?? await CapacitorUpdater.download({ url: m.url, version: m.version })
    await CapacitorUpdater.next({ id: bundle.id })
  } catch (e) {
    console.info('Trekov: update check failed —', e?.message ?? e)
  } finally {
    checking = false
  }
}

export function startLiveUpdates() {
  if (!isNativeApp) return
  // Tells the updater this bundle started fine; without it a broken update
  // is rolled back to the previous one automatically.
  CapacitorUpdater.notifyAppReady().catch(() => {})
  check()
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check() })
  window.addEventListener('online', check)
}
