// Records the app scenes for the 60 s ad in a headless Chrome (see cdp.mjs).
//   node shoot.mjs <scene>   — scenes below; each leaves the app where the next begins.
import path from 'node:path'
import { connect, TMP } from './cdp.mjs'

const APP = 'http://localhost:5173/app/'
const c = await connect()
const { ev, wait, shot, record } = c

// Fake GPS, installed before the app loads: reads window.__geo, which the
// scenes move along the real route.
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

const CREW = [
  { id: 'u_ad_kabir', name: 'Kabir', handle: 'kabir_rides', off: 80, model: 'cruiser' },
  { id: 'u_ad_meera', name: 'Meera', handle: 'meera_moves', off: 40, model: 'scooter' },
  { id: 'u_ad_vikram', name: 'Vikram', handle: 'vikram_4x4', off: 130, model: 'suv' },
  { id: 'u_ad_rohan', name: 'Rohan', handle: 'rohan_revs', off: -40, model: 'sport' },
  { id: 'u_ad_ananya', name: 'Ananya', handle: 'ananya_trails', off: -75, model: 'commuter' },
  { id: 'u_ad_zoya', name: 'Zoya', handle: 'zoya_on_wheels', off: -115, model: 'classic' },
]
const TRIP = {
  id: 't_ad_ladakh', title: 'Ladakh Ride', kind: 'group', start: '2026-09-20', end: '2026-09-27', notes: '',
  stops: [{ placeId: 'wd_Q1032254', note: '' }, { placeId: 'wd_Q2087758', note: '' }, { placeId: 'wd_Q1604804', note: '' }],
  bookings: [], sharing: true, members: CREW.map(({ id, handle, name }) => ({ id, handle, name, avatar: '' })),
}

const scenes = {
  async setup() {
    await c.send('Page.enable')
    await c.send('Emulation.setDeviceMetricsOverride', { width: 405, height: 720, deviceScaleFactor: 1080 / 405, mobile: true })
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: GEO })
    await c.send('Page.navigate', { url: APP + '#map' }); await wait(4000)
    const state = {
      users: Object.fromEntries(CREW.map(({ id, name, handle }) => [id, { id, name, handle, avatar: '' }])),
      places: {}, posts: [], reviews: [], savedPlaces: ['wd_Q1032254'], trips: [TRIP], notifications: [],
      profile: { name: 'Aarav', handle: 'aarav_rides', bio: 'Riding the Himalayas, one pass at a time.' },
    }
    await ev(`localStorage.setItem('trekov.state.v2', ${JSON.stringify(JSON.stringify(state))});
      localStorage.setItem('trekov.vehicle', 'classic'); localStorage.setItem('trekov.vehicleColour', 'orange');
      localStorage.setItem('trekov.navMapType', 'hybrid'); localStorage.setItem('trekov.groupCardHidden', 't_ad_ladakh');
      setTimeout(() => location.reload(), 10); 'seeded'`)
    await wait(7000)
    console.log(await ev(`JSON.stringify({ vis: document.visibilityState, w: innerWidth, h: innerHeight, google: !!window.google?.maps, trips: JSON.parse(localStorage.getItem('trekov.state.v2')).trips.length })`))
    await shot(path.join(TMP, 'h-setup.png'))
  },
  // Go live once so the route from Leh is cached, then start everyone 4 km up
  // the road on it and go live again, so the trail starts clean.
  async navprep() {
    await scenes.reset()
    await ev(`location.hash = '#trips'`); await wait(1500)
    await ev(`__click(/Go live with the group/i)`)
    let n = 0
    for (let i = 0; i < 30 && n < 100; i++) { await wait(1000); n = await ev('window.__initRoute()') }
    console.log('route points', n)
    await ev(`__click(/Stop navigating/i)`); await wait(1200)
    await ev(`(async () => {
      const D0 = window.__cum[70] || 4000
      window.__drive(D0, 14)
      const { joinParty, realtimeTransport } = await import('/src/lib/party.js')
      const { supabase } = await import('/src/lib/supabase.js')
      const { createClient } = await import('/node_modules/.vite/deps/@supabase_supabase-js.js')
      const crew = ${JSON.stringify(CREW)}
      ;(window.__riders || []).forEach((r) => r.party.leave()); clearInterval(window.__ridersT)
      window.__riders = crew.map((r) => ({ ...r, party: joinParty('t_ad_ladakh', { id: r.id, name: r.name }, () => {},
        realtimeTransport(createClient(supabase.supabaseUrl, supabase.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'ad-' + r.id } }))) }))
      const tick = () => { for (const r of window.__riders) { const p = window.__atD(window.__D + r.off); r.party.update({ lat: p.lat, lng: p.lng }, { vehicle: r.model === 'suv' ? 'car' : 'bike', model: r.model, colour: 'green', heading: p.heading, moving: true }) } }
      tick(); window.__ridersT = setInterval(tick, 250)
      return D0
    })()`)
    await ev(`location.hash = '#trips'`); await wait(1200)
    await ev(`__click(/Go live with the group/i)`); await wait(9000)
    await shot(path.join(TMP, 'h-nav.png'))
    console.log(await ev(`document.querySelectorAll('.tk-mate').length + ' mates'`))
  },
  // Driving, then the vehicle picker: classic -> cruiser -> SUV -> classic.
  async nav() {
    await record.start('nav'); await wait(5500)
    await ev(`__click(/Change vehicle/i)`); await wait(1100)
    await ev(`__click(/^Cruiser$/)`); await wait(1200)
    await ev(`__click(/^SUV$/)`); await wait(1200)
    await ev(`__click(/^Classic$/)`); await wait(900)
    await ev(`__click(/Change vehicle/i)`); await wait(4000)
    await record.stop()
  },
  async alert() {
    await record.start('alert'); await wait(700)
    await ev(`window.__riders[0].party.alert('stop'); 'sent'`); await wait(3800)
    await record.stop()
    await ev(`document.querySelector('[role=alert]')?.click(); 'ok'`); await wait(800)
  },
  async offline() {
    await ev(`__click(/remaining/i)`); await wait(900)
    await ev(`(window.__q(/Save map offline/i) || {}).scrollIntoView?.({ block: 'center' }); 'ok'`); await wait(500)
    await record.start('offline'); await wait(700)
    await ev(`__click(/Save map offline/i)`); await wait(1300)
    await ev(`(() => { const bs = [...document.querySelectorAll('button')].filter((b) => /~\\s*[\\d.]+\\s*(KB|MB|GB)/.test(b.innerText) && !b.disabled); const size = (b) => { const m = b.innerText.match(/~\\s*([\\d.]+)\\s*(KB|MB|GB)/); return +m[1] * { KB: 1, MB: 1e3, GB: 1e6 }[m[2]] }; bs.sort((a, b) => size(a) - size(b)); bs[0]?.click(); return bs.map((b) => b.innerText.replace(/\\s+/g, ' ')).join(' | ') })()`).then((t) => console.log('offline options:', t)); await wait(3500)
    await record.stop()
    await ev(`__click(/remaining/i)`); await wait(600)
  },
  // Trip planning: the itinerary with road distance between stops, then a
  // stop added live and its leg appearing.
  async trip() {
    await ev(`__click(/Stop navigating/i)`).catch(() => {}); await wait(1000)
    await ev(`location.hash = '#trips'`); await wait(1200)
    await ev(`[...document.querySelectorAll('button')].find((b) => /^Ladakh Ride/.test(b.innerText.trim()) && !/Go live/i.test(b.innerText)).click(); 'ok'`); await wait(4500)
    await record.start('trip'); await wait(500)
    await ev(`__scroll(160, 1200)`); await wait(700)
    await ev(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Add' || /^\\+\\s*Add$/.test(b.innerText.trim())).click(); 'ok'`); await wait(700)
    await ev(`(() => { const i = document.querySelector('input[placeholder*="Search a place"]'); i.focus(); __type(i, 'Leh Palace'); return 'typed' })()`); await wait(900)
    await ev(`__click(/Leh Palace/, 'button')`); await wait(3200)
    await record.stop()
  },
  // Travelling with: the crew, invite by username, WhatsApp / Message / Email.
  async invite() {
    await record.start('invite'); await wait(300)
    await ev(`(() => { const h = [...document.querySelectorAll('h2, h3, p, span')].find((e) => /^Travelling with/i.test(e.innerText.trim())); const sc = __scroller(); const y = h.getBoundingClientRect().top - sc.getBoundingClientRect().top - 60; return __scroll(y, 1600) })()`); await wait(1000)
    await ev(`(() => { const i = document.querySelector('input[placeholder*="handle"]'); i && i.focus(); return 'ok' })()`); await wait(2200)
    await record.stop()
  },
  // Discover: petrol pumps near you (Google Places around the rider).
  async discover() {
    await ev(`location.hash = '#discover'`); await wait(1800)
    await record.start('discover'); await wait(600)
    await ev(`__click(/^Fuel/)`); await wait(2200)
    await ev(`__scroll(260, 1200)`); await wait(1500)
    await record.stop()
  },
  // Live photo: the camera (fake feed of the lake), the shot, GPS confirmed, posted.
  async post() {
    await ev(`clearInterval(window.__driveT); Object.assign(window.__geo, { lat: 33.9306, lng: 78.4408, heading: 0 }); 'at pangong'`)
    await ev(`location.hash = '#map'`); await wait(1500)
    await record.start('post'); await wait(400)
    await ev(`__click(/Post a photo/i)`); await wait(2300)
    await ev(`__click(/^Capture$|Take a photo/i, 'button')`); await wait(2600)
    await ev(`(() => { const p = window.__q(/Pangong Tso/, 'button'); p && p.click(); return !!p })()`); await wait(700)
    await ev(`(() => { const t = document.querySelector('textarea'); if (t) __type(t, 'Pangong at golden hour — worth every hairpin.'); return !!t })()`); await wait(1300)
    await ev(`__click(/^Post$/, 'button')`); await wait(3000)
    await record.stop()
    await shot(path.join(TMP, 'h-post.png'))
  },
  // The place page: your photo is now the banner.
  async place() {
    await ev(`location.hash = '#map'`); await wait(800)
    await ev(`(() => { const i = document.querySelector('input[placeholder*="Search"]'); i.focus(); __type(i, 'Pangong'); return 'ok' })()`); await wait(1500)
    await ev(`__click(/Pangong Tso/, 'button')`); await wait(2500)
    await record.start('place'); await wait(1400)
    await ev(`__scroll(420, 1800)`); await wait(1800)
    await record.stop()
    await ev(`__click(/^Close$/i)`).catch(() => {}); await wait(600)
  },
  // The map of India full of photo pins, zooming in by tapping clusters.
  async map() {
    await ev(`(() => { const i = document.querySelector('input[placeholder*="Search"]'); if (i) __type(i, ''); location.hash = '#map'; return 'ok' })()`); await wait(2500)
    const tapNorth = `(() => { const cs = [...document.querySelectorAll('div, button')].filter((e) => /^\\d+\\s*places?$/.test((e.innerText || '').trim().replace(/\\s+/g, ' ')) && e.getBoundingClientRect().top > 330); cs.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top); const e = cs[0]; if (!e) return 'none'; e.click(); return e.innerText.trim() })()`
    await record.start('map'); await wait(1200)
    console.log('tap1', await ev(tapNorth)); await wait(1800)
    console.log('tap2', await ev(tapNorth)); await wait(2200)
    await record.stop()
  },
  async reset() {
    await ev(`(() => { for (const re of [/^Cancel$/, /^Close$/i, /Stop navigating/i]) { const e = window.__q(re, 'button'); if (e) e.click() } location.hash = '#map'; return 'ok' })()`); await wait(1500)
  },
  async alertdebug() {
    console.log(await ev(`(async () => {
      const { supabase } = await import('/src/lib/supabase.js')
      const { createClient } = await import('/node_modules/.vite/deps/@supabase_supabase-js.js')
      const got = []
      const cl = createClient(supabase.supabaseUrl, supabase.supabaseKey, { auth: { persistSession: false, storageKey: 'ad-debug' } })
      const ch = cl.channel('trip:t_ad_ladakh', { config: { broadcast: { self: false } } }).on('broadcast', { event: 'alert' }, ({ payload }) => got.push(payload.name + ':' + payload.kind))
      await new Promise((ok) => ch.subscribe((st) => st === 'SUBSCRIBED' && ok()))
      window.__riders[0].party.alert('stop')
      await new Promise((r) => setTimeout(r, 2500))
      cl.removeChannel(ch)
      return JSON.stringify({ got, overlay: !!document.querySelector('[role=alert]') })
    })()`))
  },
  async shot() { await shot(path.join(TMP, 'h-shot.png')); console.log(await ev('location.hash')) },
}

const name = process.argv[2]
if (!scenes[name]) { console.log('scenes:', Object.keys(scenes).join(', ')); process.exit(1) }
await ev(HELPERS).catch(() => {})
await scenes[name]()
c.close()
