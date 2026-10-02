// Keeps the screen on while Trekov is open and in front (Punit, 2026-09-11):
// riders glance at the map with gloves on, and a screen that goes dark costs
// them the next turn.
//
// Two ways, because iPhones don't reliably honour the first:
//   1. The Screen Wake Lock API (Chrome/Android, Safari 16.4+).
//   2. On iPhone/iPad, a tiny silent looping video (public/keepawake.mp4,
//      16x16 black, a few KB) — iOS doesn't lock the screen while media plays.
//      The same trick NoSleep.js uses; it's invisible and costs next to nothing.
// Both stop when the app goes to the background and resume when it returns.
// iPhone Low Power Mode forces auto-lock regardless; nothing a page can do.
// Inside the Android/iOS app neither is needed: the phone has an API for this,
// and the app asks for it directly (2026-09-12).

import { isNativeApp } from './platform'

const ua = navigator.userAgent
const iOS = !/Android/.test(ua) && (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

let lock = null
let video = null

async function acquireLock() {
  if (lock || document.hidden || !('wakeLock' in navigator)) return
  try {
    lock = await navigator.wakeLock.request('screen')
    lock.addEventListener('release', () => { lock = null })
  } catch { /* not allowed right now — try again on the next visit or tap */ }
}

function playVideo() {
  if (!iOS || document.hidden) return
  if (!video) {
    video = document.createElement('video')
    video.setAttribute('playsinline', '')
    video.setAttribute('webkit-playsinline', '')
    video.setAttribute('aria-hidden', 'true')
    video.muted = true
    video.loop = true
    video.src = '/keepawake.mp4'
    Object.assign(video.style, {
      position: 'fixed', left: '0', bottom: '0', width: '1px', height: '1px',
      opacity: '0.01', pointerEvents: 'none', zIndex: '-1',
    })
    document.body.appendChild(video)
  }
  if (video.paused) video.play().catch(() => { /* needs a tap first — the next pointerdown retries */ })
}

/** In the app, the phone's own API — no web tricks needed. */
async function nativeKeepAwake() {
  if (!isNativeApp) return false
  try {
    const { KeepAwake } = await import('@capacitor-community/keep-awake')
    await KeepAwake.keepAwake()
    return true
  } catch {
    return false
  }
}

async function keepOn() {
  if (await nativeKeepAwake()) return
  acquireLock()
  playVideo()
}

export function keepScreenOn() {
  keepOn()
  document.addEventListener('visibilitychange', () => { if (!document.hidden) keepOn() })
  // Some browsers (iOS especially) only allow it after a tap.
  window.addEventListener('pointerdown', keepOn, { passive: true })
  window.addEventListener('touchend', keepOn, { passive: true })
}
