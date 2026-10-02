// The invite landing page.
//
// Deliberately outside the React app: this is what a stranger loads first, on
// mobile data, usually inside WhatsApp's browser. Pulling the whole app bundle
// down just to decide where to send them would be the slowest possible way to
// answer a question we can answer in a few kilobytes.

import { decodeTripFromHash, tripCodeFromHash } from './lib/share'
import {
  hasNativeApp, isInAppBrowser, isIOS, isStandalone, storeUrl, tryNativeApp,
} from './lib/appLink'

const $ = (id) => document.getElementById(id)

// The trip rides in the hash, so it never reaches a server log — either packed
// whole after "trip=", or as a seven-character code that names a pack kept on
// the server (supabase/trip-links.sql). The app is handed the same hash.
const payload = location.hash.match(/[#&]trip=([A-Za-z0-9\-_]+)/)?.[1] ?? ''
const code = tripCodeFromHash()
const appUrl = payload ? `/app/#trip=${payload}` : code ? `/app/#${code}` : '/app/'

// This page stays a few kilobytes: no Supabase client, one fetch to the
// function that serves a code. It renders what it can if that fetch fails —
// the app resolves the code again on its own once opened.
async function fetchByCode(c) {
  const base = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!base || !key) return null
  try {
    const res = await fetch(`${base}/rest/v1/rpc/trip_link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ p_code: c }),
    })
    if (!res.ok) return null
    const data = await res.json()
    // Re-read through the same cleaner a long link goes through.
    return data ? decodeTripFromHash(`#trip=${btoa(unescape(encodeURIComponent(JSON.stringify(data)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`) : null
  } catch {
    return null
  }
}

/* ------------------------------------------------------ what they're joining */

// A packed link renders at once; a code renders when the server answers. The
// buttons below never wait on either.
const packed = decodeTripFromHash()
if (packed || !code) render(packed)
else fetchByCode(code).then(render)

function render(trip) {
if (trip) {
  $('title').textContent = trip.title || 'Join the trip'
  // Public or private, said up front. Links sent before this was added carry
  // neither field, and say nothing rather than guess.
  if (trip.visibility || trip.kind) {
    const open = trip.visibility === 'public'
    const group = trip.kind === 'group'
    $('access').hidden = false
    $('access').className = `access ${open ? 'public' : 'private'}`
    $('access').textContent = open
      ? '● Public ride — anyone on Trekov can ask to join'
      : group ? '● Private ride — invite only' : '● Private trip'
  }
  const when = [trip.start, trip.end].filter(Boolean).join(' → ')
  $('sub').textContent = when
    ? `${when} · open it to see the route and follow along live.`
    : 'Open it to see the route, the stops and where everyone is.'

  // Show the itinerary. Someone deciding whether to tap an unknown link
  // deserves to see what is behind it first.
  const named = trip.stops
    .map((s) => trip.places?.find((p) => p.id === s.placeId))
    .filter(Boolean)
  if (named.length) {
    $('stops').hidden = false
    $('stops').innerHTML = named.slice(0, 6).map((p, i) =>
      `<li><b>${i + 1}. ${esc(p.name)}</b>${p.region ? ` · ${esc(p.region)}` : ''}</li>`,
    ).join('') + (named.length > 6
      ? `<li>+ ${named.length - 6} more</li>`
      : '')
  }
} else {
  // The trip rides after "#trip=" in the link. Arriving without it almost always
  // means the link was cut short on the way — so ask for it again, rather than
  // implying there was never a trip.
  const cut = /[#&]trip=/.test(location.hash) || /trip=/.test(location.search)
  $('kicker').textContent = 'Trekov'
  // A code that came back empty is most likely a network hiccup on this page;
  // the app will ask the server again, so send them on rather than turn them away.
  $('title').textContent = cut ? 'This link was cut short' : code ? 'Join the trip' : 'Open Trekov'
  $('sub').textContent = cut
    ? 'Part of the trip got lost on the way. Ask whoever sent it to share it again — or open Trekov to plan your own.'
    : code
      ? 'Open it to see the route, the stops and where everyone is.'
      : 'This link does not include a trip. Ask whoever sent it to share it again from the trip itself — or open Trekov to plan your own.'
}
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

/* ------------------------------------------------------------------ routing */

$('open').href = appUrl
$('browser').href = appUrl

// Already inside the installed app — nothing to decide.
if (isStandalone()) {
  location.replace(appUrl)
}

// A chat app's browser cannot install a web app and handles custom schemes
// poorly. Say so plainly instead of letting the install silently do nothing.
if (isInAppBrowser()) {
  $('warn').style.display = 'flex'
  $('warn-text').textContent = isIOS()
    ? 'You are in an in-app browser. Tap the ⋯ menu and choose "Open in Safari" to install Trekov.'
    : 'You are in an in-app browser. Tap the ⋮ menu and choose "Open in Chrome" to install Trekov.'
}

// When a native build exists, give it first refusal on the link — but only
// then. Firing an unregistered scheme raises a browser error dialog.
$('open').addEventListener('click', async (e) => {
  if (!hasNativeApp()) return          // web app handles it; let the href run
  e.preventDefault()
  if (await tryNativeApp(payload ? `trip?d=${payload}` : `i/#${code}`)) return
  location.href = storeUrl() || appUrl
})

// The store button only exists once there is something in the store.
const store = storeUrl()
if (store) {
  $('store').hidden = false
  $('store').href = store
  $('store').textContent = isIOS() ? 'Get it on the App Store' : 'Get it on Google Play'
  $('browser').hidden = false
}

/* ------------------------------------------------------------------ install */

// Chrome and Edge offer a real install. The event only fires when the app is
// installable and not already installed, so it doubles as the "not installed"
// signal — there is no API that answers that question directly.
let prompt = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  prompt = e
  if (!hasNativeApp()) $('install').hidden = false
})

$('install').addEventListener('click', async () => {
  if (!prompt) return
  $('install').hidden = true
  prompt.prompt()
  await prompt.userChoice
  prompt = null
})

window.addEventListener('appinstalled', () => { $('install').hidden = true })

// iOS has no install prompt at all — Add to Home Screen is manual, and only
// from Safari. Spell out the steps rather than offering a button that cannot
// work.
if (isIOS() && !hasNativeApp() && !isInAppBrowser() && !isStandalone()) {
  $('note').innerHTML =
    'To keep Trekov on your home screen: tap <b>Share</b>, then <b>Add to Home Screen</b>. ' +
    'The trip opens either way — no account needed.'
}
