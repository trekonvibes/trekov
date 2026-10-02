import { useState, useSyncExternalStore } from 'react'
import { isNativeApp } from '../lib/platform'
import { CloseIcon } from './Icons'

// Until the store versions are out, Trekov is installed from the browser:
// it goes on the Home Screen and opens full-screen like an app, with the
// offline map and automatic updates — nothing to download.
//
// Android (Chrome, Edge, Samsung Internet) lets a page offer the browser's
// own install prompt, so there it's one tap. iOS has no such prompt, so the
// banner shows the two taps instead. On iPhone the Home Screen app keeps its
// own sign-in, which is why this banner sits above the sign-in screen
// (z-1500): the moment to add it is before signing in.
//
// trekov.com/app/?install-help always shows it — a link to send someone, and
// what the website's install buttons open.

const ua = navigator.userAgent
const isAndroid = /Android/.test(ua)
// iPadOS reports itself as a Mac; a touch-screen "Mac" that isn't Android is an iPad.
const isIOS = !isAndroid && (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
const standalone = navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches
// In-app browsers (Instagram, Facebook, LINE, Android WebViews) can't install.
const inAppBrowser = /Instagram|FBAN|FBAV|Line\/|; wv\)/.test(ua)
const inChromeIOS = /CriOS/.test(ua)
const samsung = /SamsungBrowser/.test(ua)
const asked = new URLSearchParams(window.location.search).has('install-help')

const KEY = 'trekov.installBanner'
const SNOOZE_MS = 14 * 24 * 60 * 60_000
function hidden() {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'done' || (v && Date.now() < Number(v))
  } catch { return false }
}
const hide = (value) => { try { localStorage.setItem(KEY, value) } catch { /* ignore */ } }

// The browser's install prompt, held until someone taps Install. Captured at
// load, because the browser fires it once, early.
let deferred = null
const subscribers = new Set()
const notify = () => subscribers.forEach((f) => f())
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; notify() })
window.addEventListener('appinstalled', () => { deferred = null; hide('done'); notify() })
const useInstallPrompt = () =>
  useSyncExternalStore((f) => { subscribers.add(f); return () => subscribers.delete(f) }, () => deferred)

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9"
         strokeLinecap="round" strokeLinejoin="round" aria-label="Share" className="inline -mt-1 text-brand">
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M7 10H6a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18 10h-1" />
    </svg>
  )
}

export default function InstallBanner() {
  const prompt = useInstallPrompt()
  const [open, setOpen] = useState(() => !isNativeApp && !standalone && (asked || ((isIOS || isAndroid) && !hidden())))
  if (!open) return null

  const close = (value) => { hide(value); setOpen(false) }
  async function install() {
    prompt.prompt()
    const { outcome } = await prompt.userChoice
    deferred = null
    notify()
    if (outcome === 'accepted') close('done')
  }

  return (
    <div className="fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[1600] flex justify-center px-safe pointer-events-none">
      <div className="pointer-events-auto mx-3 w-full max-w-md rounded-2xl border border-brand/40 bg-ink/95 backdrop-blur-xl shadow-xl p-4"
           role="dialog" aria-label="Add Trekov to your Home Screen">
        <div className="flex items-start gap-3">
          <img src="/apple-touch-icon.png" alt="" className="size-11 rounded-xl shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Add Trekov to your Home Screen</p>
            <p className="text-xs text-mist mt-0.5">
              {isIOS
                ? 'It opens full-screen like an app. Add it first, then sign in there — the Home Screen app keeps its own sign-in. The App Store version is coming soon.'
                : 'It opens full-screen like an app, straight from your Home screen — nothing to download. The Google Play version is coming soon.'}
            </p>
          </div>
          <button onClick={() => close(String(Date.now() + SNOOZE_MS))} aria-label="Not now"
                  className="grid place-items-center size-10 -mt-2 -mr-2 text-mist hover:text-white shrink-0">
            <CloseIcon size={16} />
          </button>
        </div>

        {prompt && !inAppBrowser ? (
          <button onClick={install}
                  className="mt-3 w-full min-h-11 rounded-full bg-brand text-ink text-sm font-semibold">
            Install app
          </button>
        ) : (
          <ol className="mt-3 space-y-1.5 text-xs leading-relaxed list-decimal pl-5">
            {inAppBrowser ? (
              <>
                <li>Tap <b>⋯</b> or <b>⋮</b> and choose <b>Open in {isIOS ? 'Safari' : 'Chrome'}</b>.</li>
                <li>Then add Trekov to your Home Screen from there.</li>
              </>
            ) : isIOS ? (
              <>
                <li>Tap <ShareIcon /> <b>Share</b> {inChromeIOS ? 'in the address bar' : 'at the bottom of Safari'}.</li>
                <li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
              </>
            ) : samsung ? (
              <>
                <li>Tap the <b>≡</b> menu at the bottom.</li>
                <li>Tap <b>Add page to</b> → <b>Home screen</b>.</li>
              </>
            ) : (
              <>
                <li>Tap the <b>⋮</b> menu at the top right.</li>
                <li>Tap <b>Install app</b> or <b>Add to Home screen</b>, then <b>Install</b>.</li>
              </>
            )}
          </ol>
        )}
        <button onClick={() => close('done')}
                className="mt-2 w-full min-h-10 rounded-full border border-line text-xs font-semibold hover:border-brand hover:text-brand">
          I've added it
        </button>
      </div>
    </div>
  )
}
