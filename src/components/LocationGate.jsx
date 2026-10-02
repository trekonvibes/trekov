import { useCallback, useEffect, useRef, useState } from 'react'
import { isNativeApp, platform } from '../lib/platform'
import { getFix } from '../lib/gps'
import { Logo } from './Icons'

// Shown after sign-in (App.jsx): account first, then location, then the app.
//
// Trekov needs your location to work: the map starts where you are,
// navigation follows you, Discover shows what is near and a group sees you
// on a live trip. So the app opens on this screen until location is allowed
// and switched on (Punit's rule, 2026-09-11).
//
// The camera has its own step next (CameraStep.jsx), which can be skipped —
// store review rejects apps that force a permission before the feature needs it.

const REMEMBER = 'trekov.locationOk'
const remembered = () => { try { return localStorage.getItem(REMEMBER) === '1' } catch { return false } }
const remember = (ok) => {
  try { if (ok) localStorage.setItem(REMEMBER, '1'); else localStorage.removeItem(REMEMBER) } catch { /* ignore */ }
}

async function permissionStatus() {
  // In the app, ask iOS or Android — not the web view, which keeps its own
  // record for "trekov.com" and asks the person a second time.
  if (isNativeApp) {
    try {
      const { Geolocation } = await import('@capacitor/geolocation')
      const { location } = await Geolocation.checkPermissions()
      return { state: location === 'granted' ? 'granted' : location === 'denied' ? 'denied' : 'prompt' }
    } catch { return null }
  }
  try {
    const query = navigator.permissions?.query({ name: 'geolocation' })
    if (!query) return null
    // This is a shortcut, not a requirement: it tells us whether to ask. In
    // WKWebView it can stay pending for ever, and because the gate waited for
    // it before drawing anything, the app sat on an empty screen and never
    // reached the button (found on the iOS simulator, 2026-09-12). Give up on
    // it quickly and ask the phone directly instead.
    return await Promise.race([
      query,
      new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
    ])
  } catch { return null }
}

/** 'ok' | 'denied' | 'off' */
function locate() {
  // The app uses the phone's own location service, so iPhone asks once — as
  // "Trekov" — rather than again as "trekov.com" through the web view (found on
  // the simulator, 2026-09-13).
  if (isNativeApp) {
    return getFix({ timeout: 15_000 }).then(() => 'ok', (e) =>
      // A timeout only starts once permission is given, so it still means yes.
      e?.code === 'denied' ? 'denied' : e?.code === 'timeout' ? 'ok' : 'off')
  }
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve('off')
    navigator.geolocation.getCurrentPosition(
      () => resolve('ok'),
      // 1 denied · 2 no position (location switched off) · 3 timed out — the
      // timeout only starts once permission is given, so it still means yes.
      (e) => resolve(e.code === 1 ? 'denied' : e.code === 2 ? 'off' : 'ok'),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 10 * 60_000 },
    )
  })
}

const iosBrowser = platform === 'web' && /iPhone|iPad|iPod/.test(navigator.userAgent)
const HOW_TO =
  platform === 'android' ? 'Open Settings → Apps → Trekov → Permissions → Location, and choose “Allow only while using the app”.'
  : platform === 'ios' ? 'Open Settings → Trekov → Location, and choose “While Using the App”.'
  : iosBrowser ? 'In Safari, tap aA in the address bar → Website Settings → Location → Allow. If that is greyed out: Settings → Privacy & Security → Location Services → Safari Websites → While Using the App.'
  : 'Click the icon at the left of the address bar, set Location to Allow, then try again.'

// "Location is off" is the phone's own switch, not Trekov's permission — and
// it lives somewhere different on each platform. iOS has no quick settings,
// which is what this said to everyone until an iPhone showed it (2026-09-12).
const TURN_ON =
  platform === 'android' ? "Switch on Location (GPS) from your phone's quick settings, then try again."
  : platform === 'ios' || iosBrowser ? 'Switch on Location Services in Settings → Privacy & Security, then try again.'
  : 'Switch on location for this device, then try again.'

export default function LocationGate({ children }) {
  const [state, setState] = useState('checking')   // checking | ask | asking | denied | off | ok
  const status = useRef(null)

  const check = useCallback(async () => {
    const s = status.current ?? (status.current = await permissionStatus())
    if (s?.state === 'denied') { remember(false); return setState('denied') }
    // Granted — or unknown but allowed before (app WebViews often report
    // "prompt" even once the app has the permission): open straight away,
    // then confirm the phone can actually find itself.
    if (s?.state === 'granted' || remembered()) {
      remember(true)
      setState((v) => (v === 'checking' || v === 'ask' ? 'ok' : v))
      const r = await locate()
      if (r !== 'ok') { if (r === 'denied') remember(false); setState(r) }
      return
    }
    setState('ask')
  }, [])

  useEffect(() => {
    check()
    const onVisible = () => { if (!document.hidden) check() }   // back from Settings
    document.addEventListener('visibilitychange', onVisible)
    let s = null
    permissionStatus().then((p) => { s = p; if (p) p.onchange = check })
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      if (s) s.onchange = null
    }
  }, [check])

  async function request() {
    setState('asking')
    const r = await locate()
    if (r === 'ok') remember(true)
    setState(r)
  }

  if (state === 'ok') return children
  if (state === 'checking') return <div className="h-full bg-ink" />

  const denied = state === 'denied'
  const off = state === 'off'
  return (
    <div className="h-full flex justify-center bg-black">
      <div className="tk-shell h-full w-full flex flex-col bg-ink sm:border-x sm:border-line pt-safe px-safe">
        <div className="flex-1 overflow-y-auto">
          <div className="min-h-full flex flex-col justify-center px-6 py-10 max-w-md mx-auto w-full">
            <Logo size={40} />
            <h1 className="mt-6 text-2xl font-semibold leading-tight">
              {denied ? 'Location is turned off for Trekov' : off ? "Your phone's location is off" : 'Trekov needs your location'}
            </h1>
            <p className="mt-3 text-sm text-mist leading-relaxed">
              The map starts where you are, navigation follows you turn by turn, Discover shows what is nearby,
              and your group sees you on a live trip. Trekov never sells your location, and your group sees it
              only while you ride live together.
            </p>
            {denied && <p className="mt-4 text-sm leading-relaxed">{HOW_TO}</p>}
            {off && <p className="mt-4 text-sm leading-relaxed">{TURN_ON}</p>}
            <button onClick={request} disabled={state === 'asking'}
                    className="mt-8 w-full min-h-12 rounded-full bg-brand text-ink py-3 text-sm font-semibold disabled:opacity-50">
              {state === 'asking' ? 'Waiting for your phone…' : denied || off ? 'Try again' : 'Allow location'}
            </button>
            <p className="mt-4 text-[11px] text-mist leading-relaxed">
              Next, Trekov asks for the camera, for taking photos — you can skip that one.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
