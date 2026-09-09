// Where an invite link should actually land.
//
// A link shared in WhatsApp is opened by whoever taps it, on whatever they
// happen to be holding, usually inside a chat app's own browser. Four cases
// matter and they need different answers:
//
//   1. Trekov is installed  → open it there
//   2. It is not installed  → offer the install, then open the trip
//   3. An in-app browser    → neither install nor deep link works; get out first
//   4. Desktop              → just open the web app
//
// Nothing here guesses. Each check is a real capability test, and where the
// platform gives no honest answer (whether a PWA is installed on iOS, say) the
// page offers a choice instead of pretending to know.

/**
 * Native app coordinates. Both are empty because Trekov ships as an
 * installable web app today and has no App Store or Play Store listing.
 *
 * Filling either one in is all that is needed to switch that platform over:
 * the store button appears, and the custom scheme is attempted before falling
 * back to the web app. Until then the scheme is never tried — an unregistered
 * scheme on iOS raises a browser error dialog, which is worse than not trying.
 */
export const NATIVE = {
  scheme: 'trekov',
  ios: { appId: '' },      // e.g. '1234567890' → apps.apple.com/app/id1234567890
  android: { pkg: '' },    // e.g. 'com.trekov.app' → play.google.com/store/apps/details?id=…
}

const ua = () => navigator.userAgent || ''

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(ua()) ||
  // iPadOS 13+ reports as a Mac; the touch points give it away.
  (/Macintosh/.test(ua()) && navigator.maxTouchPoints > 1)

export const isAndroid = () => /Android/.test(ua())
export const isMobile = () => isIOS() || isAndroid()

/**
 * Chat apps and social apps render links in an embedded WebView. Installing a
 * web app is impossible there and custom schemes are unreliable, so the page
 * has to say "open this in your browser" before anything else will work.
 */
export const isInAppBrowser = () => {
  const s = ua()
  if (/FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|Pinterest/i.test(s)) return true
  // WhatsApp's Android WebView says "wv"; its iOS one has no marker at all,
  // so on iOS fall back to "a WebKit browser that is not Safari or Chrome".
  if (isAndroid()) return /\bwv\b/.test(s)
  if (isIOS()) return !/Safari/.test(s) && !/CriOS|FxiOS|EdgiOS/.test(s)
  return false
}

/** True when this page is already running as the installed app. */
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  window.navigator.standalone === true

/** The store listing for this device, or '' when there is nothing to link to. */
export function storeUrl() {
  if (isIOS() && NATIVE.ios.appId) return `https://apps.apple.com/app/id${NATIVE.ios.appId}`
  if (isAndroid() && NATIVE.android.pkg) {
    return `https://play.google.com/store/apps/details?id=${NATIVE.android.pkg}`
  }
  return ''
}

/** Whether a native build exists for this device at all. */
export const hasNativeApp = () => storeUrl() !== ''

/**
 * Ask the installed native app to take the link, and report whether it did.
 *
 * There is no callback for "the scheme opened", so this uses the standard
 * signal: if the app takes over, the page is backgrounded and loses
 * visibility. Still visible after the timeout means nothing handled it.
 */
export function tryNativeApp(path, { timeout = 1200 } = {}) {
  if (!hasNativeApp()) return Promise.resolve(false)
  return new Promise((resolve) => {
    let settled = false
    const done = (opened) => {
      if (settled) return
      settled = true
      document.removeEventListener('visibilitychange', hidden)
      resolve(opened)
    }
    const hidden = () => document.hidden && done(true)
    document.addEventListener('visibilitychange', hidden)
    setTimeout(() => done(false), timeout)
    window.location.href = `${NATIVE.scheme}://${path}`
  })
}
