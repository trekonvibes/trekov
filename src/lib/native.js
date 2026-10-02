// What makes Trekov behave like an app rather than a page (Punit, 2026-09-12:
// "a proper app, not a web view").
//
// Every call here does nothing in a browser, and the plugins are imported only
// when the app actually uses them, so nobody on the website downloads a line of
// this. One codebase still serves the website and both apps.

import { isNativeApp, platform } from './platform'

const INK = '#0B0F0E'

/** System bars in Trekov's ink, so the app doesn't wear Android's white. */
export async function paintSystemBars() {
  if (!isNativeApp) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: Style.Dark })
    if (platform === 'android') await StatusBar.setBackgroundColor({ color: INK })
  } catch { /* older shell without the plugin — the theme colours still apply */ }
  // Capacitor's own system-bar handler keeps a style of its own and puts it
  // back on every configuration change — turning the phone, for one. Left on
  // its default it follows the phone's theme, so a phone in light mode got dark
  // icons on Trekov's ink, clock and battery nearly invisible (Android,
  // 2026-09-14). Tell it too; capacitor.config.json says so from the next build.
  try {
    const { SystemBars, SystemBarsStyle } = await import('@capacitor/core')
    await SystemBars?.setStyle({ style: SystemBarsStyle.Dark })
  } catch { /* a shell from before Capacitor 8 */ }
}

/**
 * Android's back button, which a real app answers itself: `handle()` closes
 * whatever is open and says what it did. Only when it returns 'exit' does the
 * app close — otherwise Android would drop the rider out of a live trip.
 */
export function onBackButton(handle) {
  if (!isNativeApp || platform !== 'android') return () => {}
  let off = () => {}
  import('@capacitor/app')
    .then(({ App }) => App.addListener('backButton', async () => {
      if (handle() !== 'exit') return
      await App.exitApp()
    }))
    .then((listener) => { off = () => listener.remove() })
    .catch(() => {})
  return () => off()
}

// Sheets and pages opened inside a screen — a profile, a report, a photo, a
// trip — close on Android's back button before the screen behind them does.
// Back used to skip them and leave the tab, or close the app (launch testing,
// 2026-09-14). The most recently opened one closes first.
const backLayers = []
/** Registers `close` for as long as the component is mounted; returns the cleanup. */
export function pushBackLayer(close) {
  const entry = { close }
  backLayers.push(entry)
  return () => { const i = backLayers.indexOf(entry); if (i >= 0) backLayers.splice(i, 1) }
}
/** Closes the top layer, if there is one. */
export function popBackLayer() {
  const top = backLayers[backLayers.length - 1]
  if (!top) return false
  top.close()
  return true
}

/** A tap you can feel — worth it for the alert buttons riders hit wearing gloves. */
export async function buzz(kind = 'light') {
  if (!isNativeApp) return
  try {
    const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics')
    if (kind === 'alert') await Haptics.notification({ type: NotificationType.Warning })
    else await Haptics.impact({ style: kind === 'heavy' ? ImpactStyle.Heavy : ImpactStyle.Light })
  } catch { /* the phone has no vibration motor, or refused */ }
}

/**
 * The phone's own share sheet — every messaging app the rider has, rather than
 * a link they must copy. Falls back to the browser's sheet, then the clipboard.
 * @returns 'shared' | 'cancelled' | 'copied' | 'failed'
 */
export async function shareText({ title = '', text = '', url = '' }) {
  if (isNativeApp) {
    try {
      const { Share } = await import('@capacitor/share')
      await Share.share({ title, text, url, dialogTitle: title })
      return 'shared'
    } catch (e) {
      if (/cancel/i.test(e?.message ?? '')) return 'cancelled'
    }
  }
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return 'shared' } catch { return 'cancelled' }
  }
  try { await navigator.clipboard.writeText(url || text); return 'copied' } catch { return 'failed' }
}

/**
 * A finished reel, two ways (Punit, 2026-09-21): kept on the phone, or sent on.
 *
 * Filesystem is a native plugin: in a web build, or in an app built before it
 * shipped, the import fails and the browser's way takes over — which is why
 * the failure is caught rather than guarded by a version check.
 */
async function nativeFiles() {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ])
  return { Filesystem, Directory, Share }
}

/**
 * Save the reel on the phone. Movies/Trekov first, which the Gallery picks up
 * on its own (Android 11+ files the video in MediaStore as it is written);
 * Documents if that is refused. Returns { result, where }.
 */
export async function saveVideo(blob, { name = 'trekov-ride.mp4', title = 'My ride' } = {}) {
  // An iPhone app's own folder is hidden from Files; the share sheet's "Save
  // Video" is how a video reaches Photos there.
  if (isNativeApp && platform === 'ios') {
    const r = await shareVideo(blob, { name, title })
    return { result: r === 'shared' ? 'saved' : r, where: '' }
  }
  if (isNativeApp) {
    try {
      const { Filesystem, Directory } = await nativeFiles()
      const data = await toBase64(blob)
      const places = [
        [Directory.ExternalStorage, `Movies/Trekov/${name}`, 'Gallery · Movies/Trekov'],
        [Directory.Documents, name, 'Files · Documents'],
      ]
      for (const [directory, path, where] of places) {
        try {
          await Filesystem.writeFile({ path, data, directory, recursive: true })
          return { result: 'saved', where }
        } catch { /* try the next place */ }
      }
    } catch { /* no plugin: the browser's way below */ }
  }

  // A real "choose the folder" dialog where the browser has one (Chrome, Edge).
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'Video', accept: { 'video/mp4': ['.mp4'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return { result: 'saved', where: '' }
    } catch (e) {
      if (/abort/i.test(e?.name ?? '')) return { result: 'cancelled' }
    }
  }
  return download(blob, name) ? { result: 'saved', where: 'Downloads' } : { result: 'failed' }
}

/**
 * Send the reel on: the phone's share sheet in the app, the browser's where
 * there is one. In the app the file is written to the cache first — the only
 * place the app's FileProvider shares from (res/xml/file_paths.xml). Writing it
 * to Documents and sharing that was refused every time: "Couldn't share"
 * (Punit's F966B, 2026-09-21).
 */
export async function shareVideo(blob, { name = 'trekov-ride.mp4', title = 'My ride' } = {}) {
  if (isNativeApp) {
    try {
      const { Filesystem, Directory, Share } = await nativeFiles()
      const { uri } = await Filesystem.writeFile({ path: `reels/${name}`, data: await toBase64(blob), directory: Directory.Cache, recursive: true })
      await Share.share({ title, text: `${title} — made in Trekov`, files: [uri], dialogTitle: 'Share your reel' })
      return 'shared'
    } catch (e) {
      if (/cancel/i.test(e?.message ?? '')) return 'cancelled'
      console.warn('Trekov: sharing the reel failed —', e?.message ?? e)
    }
  }
  const file = new File([blob], name, { type: blob.type })
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title, text: `${title} — made in Trekov` }); return 'shared' } catch { return 'cancelled' }
  }
  return download(blob, name) ? 'saved' : 'failed'
}

function download(blob, name) {
  try {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Revoked late: Safari cancels a download whose blob went away too soon.
    setTimeout(() => URL.revokeObjectURL(url), 20_000)
    return true
  } catch {
    return false
  }
}

const toBase64 = (blob) => new Promise((done, fail) => {
  const reader = new FileReader()
  reader.onload = () => done(String(reader.result).split(',')[1])
  reader.onerror = () => fail(reader.error)
  reader.readAsDataURL(blob)
})

/**
 * A Trekov link tapped in another app — a trip invite in WhatsApp, say. The
 * link is claimed in AndroidManifest.xml and verified against
 * /.well-known/assetlinks.json, so it opens Trekov instead of a browser tab.
 */
export function onDeepLink(handle) {
  if (!isNativeApp) return () => {}
  let off = () => {}
  import('@capacitor/app')
    .then(({ App }) => App.addListener('appUrlOpen', ({ url }) => handle(url)))
    .then((listener) => { off = () => listener.remove() })
    .catch(() => {})
  return () => off()
}

/** Turn-by-turn deserves the whole screen; the system bars come back after. */
export async function fullScreen(on) {
  if (!isNativeApp) return
  try {
    const { StatusBar } = await import('@capacitor/status-bar')
    if (on) return await StatusBar.hide()
    await StatusBar.show()
    // Coming back, Android forgets the light-on-dark icons: after navigation the
    // clock and battery were dark grey on Trekov's ink, all but invisible
    // (Android, 2026-09-13). Paint the bars again.
    await paintSystemBars()
  } catch { /* no status bar to hide */ }
}

/**
 * A notification from the phone itself — for an alert that arrives while the
 * rider is looking at something else. Local only: no account, no server, no
 * Firebase. It needs the app to be running, which during a live trip it is
 * (lib/liveTrip.js keeps it alive).
 */
export async function notifyLocal({ title, body }) {
  if (!isNativeApp) return false
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const asked = await LocalNotifications.checkPermissions()
    if (asked.display !== 'granted') {
      const granted = await LocalNotifications.requestPermissions()
      if (granted.display !== 'granted') return false
    }
    await LocalNotifications.schedule({
      notifications: [{
        id: Date.now() % 2147483647,
        title,
        body,
        // Straight away.
        schedule: { at: new Date(Date.now() + 100) },
      }],
    })
    return true
  } catch {
    return false
  }
}
