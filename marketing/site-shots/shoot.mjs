// Stills of the app for trekov.com (Punit, 2026-09-13): a Ladakh group ride
// with more riders on the road than the ad had, navigating live, and the same
// trip's itinerary. Same rig as the ad — a separate headless Chrome, the app
// with no account server, riders simulated in the page — see ../ad-60s.
//
//   node shoot.mjs            — writes nav.png and trip.png next to this file
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from '../ad-60s/cdp.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP = process.env.APP_URL || 'http://localhost:5173/app/'
const c = await connect()
const { ev, wait, shot } = c

// Copied from the ad script: fake GPS, and the helpers for clicking and for
// walking a position along the cached route.
const GEO = `(() => {
  window.__geo = window.__geo || { lat: 34.0476, lng: 77.9340, heading: 52 }
  const fix = () => ({ coords: { latitude: window.__geo.lat, longitude: window.__geo.lng, accuracy: 5, heading: window.__geo.heading, speed: 16, altitude: null, altitudeAccuracy: null }, timestamp: Date.now() })
  const watchers = new Map(); let n = 0
  const geo = {
    getCurrentPosition: (ok) => setTimeout(() => ok(fix()), 30),
    watchPosition: (ok) => { const id = ++n; ok(fix()); watchers.set(id, setInterval(() => ok(fix()), 250)); return id },
    clearWatch: (id) => clearInterval(watchers.get(id)),
  }
  Object.defineProperty(Navigator.prototype, 'geolocation', { configurable: true, get: () => geo })
  // The app asks the browser whether location is allowed (LocationGate); a
  // headless browser answers "denied" whatever it's granted, so answer "granted".
  const perms = navigator.permissions
  if (perms?.query) {
    const query = perms.query.bind(perms)
    perms.query = (d) => d && d.name === 'geolocation'
      ? Promise.resolve({ state: 'granted', onchange: null, addEventListener() {}, removeEventListener() {} })
      : query(d)
  }
})()`

const HELPERS = `(() => {
  const txt = (e) => (e.innerText || e.textContent || '').trim()
  window.__q = (re, sel = 'button, a, [role=button], [role=radio]') =>
    [...document.querySelectorAll(sel)].find((e) => re.test(txt(e)) || re.test(e.getAttribute('aria-label') || ''))
  window.__click = (re, sel) => { const e = window.__q(re, sel); if (!e) throw new Error('no element ' + re); e.click(); return txt(e).slice(0, 40) }
  window.__type = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  window.__scroller = () => [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)).sort((a, b) => b.clientHeight - a.clientHeight)[0] || document.scrollingElement
  window.__scroll = (dy, ms = 1200, el = window.__scroller()) => new Promise((done) => {
    const y0 = el.scrollTop, t0 = performance.now()
    const step = (t) => { const k = Math.min(1, (t - t0) / ms), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; el.scrollTop = y0 + dy * e; k < 1 ? requestAnimationFrame(step) : done() }
    requestAnimationFrame(step)
  })
  window.__initRoute = () => {
    const raw = JSON.parse(localStorage.getItem('trekov.routes.v1') || '{}')
    const v = Object.values(raw).filter((x) => x && x.coordinates).sort((a, b) => (b.at || 0) - (a.at || 0))[0]
    if (!v) return 0
    const C = v.coordinates, R = 6371000, rad = Math.PI / 180
    const dist = (a, b) => { const dl = (b[0] - a[0]) * rad, dn = (b[1] - a[1]) * rad; const h = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)) }
    const brg = (a, b) => { const y = Math.sin((b[1] - a[1]) * rad) * Math.cos(b[0] * rad), x = Math.cos(a[0] * rad) * Math.sin(b[0] * rad) - Math.sin(a[0] * rad) * Math.cos(b[0] * rad) * Math.cos((b[1] - a[1]) * rad); return (Math.atan2(y, x) / rad + 360) % 360 }
    const cum = [0]; for (let i = 1; i < Math.min(C.length, 4000); i++) cum.push(cum[i - 1] + dist(C[i - 1], C[i]))
    window.__cum = cum
    window.__atD = (m) => { let i = cum.findIndex((x) => x >= m); if (i <= 0) i = 1; const k = (m - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]); const a = C[i - 1], b = C[i]; return { lat: a[0] + (b[0] - a[0]) * k, lng: a[1] + (b[1] - a[1]) * k, heading: brg(a, b) } }
    return C.length
  }
  window.__drive = (D0, mps) => {
    window.__D = D0; clearInterval(window.__driveT)
    const put = () => { const p = window.__atD(window.__D); Object.assign(window.__geo, p) }
    put(); window.__driveT = setInterval(() => { window.__D += mps / 4; put() }, 250)
  }
  return 'ok'
})()`

// Eight riders and you: nine on the road, spread over a few hundred metres so
// the whole group fits on one street-level screen.
const CREW = [
  { id: 'u_s_kabir', name: 'Kabir', handle: 'kabir_rides', off: 150, model: 'cruiser' },
  { id: 'u_s_meera', name: 'Meera', handle: 'meera_moves', off: 105, model: 'scooter' },
  { id: 'u_s_vikram', name: 'Vikram', handle: 'vikram_4x4', off: 200, model: 'suv' },
  { id: 'u_s_rohan', name: 'Rohan', handle: 'rohan_revs', off: 60, model: 'sport' },
  { id: 'u_s_ananya', name: 'Ananya', handle: 'ananya_trails', off: -45, model: 'commuter' },
  { id: 'u_s_zoya', name: 'Zoya', handle: 'zoya_on_wheels', off: -95, model: 'classic' },
  { id: 'u_s_tenzin', name: 'Tenzin', handle: 'tenzin_highpass', off: -150, model: 'cruiser' },
  { id: 'u_s_ishaan', name: 'Ishaan', handle: 'ishaan_2wheels', off: 250, model: 'sport' },
]
const TRIP = {
  id: 't_site_ladakh', title: 'Ladakh Ride', kind: 'group', start: '2026-09-20', end: '2026-09-27', notes: 'Permits for Pangong sorted. Fuel up in Leh — next pump is Tangtse.',
  stops: [{ placeId: 'wd_Q1032254', note: '' }, { placeId: 'wd_Q2087758', note: '' }, { placeId: 'wd_Q1604804', note: '' }],
  bookings: [], sharing: true, visibility: 'public',
  members: CREW.map(({ id, handle, name }) => ({ id, handle, name, avatar: '' })),
}

async function setup() {
  await c.send('Page.enable')
  // 405 wide at a device scale of 2.6: a 1053 x 2080 image, the shape of the
  // phone frames on the landing page.
  await c.send('Emulation.setDeviceMetricsOverride', { width: 405, height: 800, deviceScaleFactor: 2.6, mobile: true })
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: GEO })
  await c.send('Page.navigate', { url: APP + '#map' }); await wait(4000)
  const state = {
    users: Object.fromEntries(CREW.map(({ id, name, handle }) => [id, { id, name, handle, avatar: '' }])),
    places: {}, posts: [], reviews: [], savedPlaces: [], trips: [TRIP], notifications: [],
    profile: { name: 'Aarav', handle: 'aarav_rides', bio: 'Riding the Himalayas, one pass at a time.' },
  }
  await ev(`localStorage.clear();
    localStorage.setItem('trekov.state.v2', ${JSON.stringify(JSON.stringify(state))});
    localStorage.setItem('trekov.vehicle', 'classic'); localStorage.setItem('trekov.vehicleColour', 'orange');
    localStorage.setItem('trekov.navMapType', 'hybrid'); localStorage.setItem('trekov.groupCardHidden', 't_site_ladakh');
    localStorage.setItem('trekov.locationOk', '1'); localStorage.setItem('trekov.cameraStep', '1'); localStorage.setItem('trekov.installBanner', 'done');
    setTimeout(() => location.reload(), 10); 'seeded'`)
  await wait(7000)
  await ev(HELPERS)
  console.log('setup', await ev(`JSON.stringify({ google: !!window.google?.maps, trips: JSON.parse(localStorage.getItem('trekov.state.v2')).trips.length })`))
}

async function trip() {
  await ev(`location.hash = '#trips'`); await wait(1800)
  await ev(`[...document.querySelectorAll('button')].find((b) => /^Ladakh Ride/.test(b.innerText.trim()) && !/Go live/i.test(b.innerText)).click(); 'opened'`)
  await wait(4000)
  await shot(path.join(HERE, 'trip.png'))
  console.log('trip', await ev(`(document.body.innerText.match(/Travelling with[^\\n]*/) || [''])[0]`))
  await ev(`history.back(); 'back'`); await wait(1500)
}

async function nav() {
  await ev(HELPERS)
  await ev(`location.hash = '#trips'`); await wait(1500)
  await ev(`__click(/Go live with the group|^Go live$/i)`)
  let n = 0
  for (let i = 0; i < 40 && n < 100; i++) { await wait(1000); n = await ev('window.__initRoute ? window.__initRoute() : 0') }
  console.log('route points', n)
  await ev(`__click(/Stop navigating/i)`); await wait(1200)
  await ev(HELPERS)
  await ev(`window.__initRoute()`)
  await ev(`(async () => {
    const D0 = window.__cum[90] || 5000
    window.__drive(D0, 12)
    const { joinParty } = await import('/src/lib/party.js')
    const crew = ${JSON.stringify(CREW)}
    ;(window.__riders || []).forEach((r) => r.party.leave()); clearInterval(window.__ridersT)
    window.__riders = crew.map((r) => ({ ...r, party: joinParty('t_site_ladakh', { id: r.id, name: r.name }, () => {}) }))
    const tick = () => { for (const r of window.__riders) { const p = window.__atD(window.__D + r.off); r.party.update({ lat: p.lat, lng: p.lng }, { vehicle: r.model === 'suv' ? 'car' : 'bike', model: r.model, colour: 'green', heading: p.heading, moving: true }) } }
    tick(); window.__ridersT = setInterval(tick, 250)
    return D0
  })()`)
  await ev(`location.hash = '#trips'`); await wait(1200)
  await ev(`__click(/Go live with the group|^Go live$/i)`); await wait(12000)
  console.log('nav', await ev(`document.querySelectorAll('.tk-mate').length + ' riders on the map'`))
  await shot(path.join(HERE, 'nav.png'))
}

await setup()
await trip()
await nav()
process.exit(0)
