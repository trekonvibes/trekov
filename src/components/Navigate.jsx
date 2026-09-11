import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  bearing, compassPoint, distance, distanceAlongRemaining, formatDistance, formatDuration, snapToPath,
} from '../lib/geo'
import { arrivalAt } from '../lib/format'
import { getRoute, getTripRoute, instruction } from '../lib/route'
import { colourFor, joinParty } from '../lib/party'
import {
  DETAIL, downloadTiles, formatBytes, keepTiles, offlineTileTemplate, planRouteDownload, storageRoom,
  warmOfflineEngine,
} from '../lib/offline'
import { createMap, useMapsRefused } from '../lib/mapDrivers'
import { COLOURS, MODELS, baseOf, vehicleSvg } from '../lib/vehicleArt'
import { getPlace, selectSharing, useStore } from '../lib/store'
import { BackIcon, CalendarIcon, Logo } from './Icons'
import { VEHICLES } from './VehicleIcons'
import Voice from './Voice'
import { AlertButtons, AlertOverlay, playAlert, unlockAlertAudio } from './GroupAlerts'
import Portal from './Portal'
import { currentVehicle, mapplsUrl } from '../lib/handoff'

/** Street level. Esri imagery tops out at 18; 17 keeps a block of context. */
const NAV_ZOOM = 17
/** Beyond this the GPS is genuinely off-route, not just noisy. */
const SNAP_M = 60
/** Speed streaks, shared by our own marker and every companion's. */
const SPEED_STREAKS = (vehicle) =>
  `<span class="tk-speed ${baseOf(vehicle) === 'bike' ? 'is-bike' : ''}">
     <i style="--dx:-8px;--d:0ms"></i><i style="--dx:0px;--d:110ms"></i>
     <i style="--dx:8px;--d:220ms"></i><i style="--dx:-4px;--d:330ms"></i><i style="--dx:4px;--d:440ms"></i>
   </span>`

/** Who made the 3D model you are driving — the CC-BY ones require it. */
function ModelCredit({ id }) {
  const m = MODELS.find((x) => x.id === id)
  if (!m?.credit) return <p className="text-[10px] text-mist">Colour applies to Car and Bike; 3D models glow in it.</p>
  return (
    <p className="text-[10px] text-mist">
      3D model by{' '}
      <a href={m.credit.url} target="_blank" rel="noreferrer" className="underline hover:text-white">{m.credit.by}</a>
      {' '}· {m.credit.license} · colour shows as the glow under it
    </p>
  )
}

// The destination pin carries the place's photo, like the pins on the main map.
const pinHtml = (p) => {
  const src = p?.photo?.thumb
  const bg = src ? ` style="background-image:url('${src.replace(/'/g, '%27')}')"` : ''
  return `<div class="tk-pin"><div class="tk-pin-img"${bg}></div></div>`
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const pref = (key, fallback) => localStorage.getItem(key) ?? fallback

export default function Navigate({ place, trip, me, onClose }) {
  const host = useRef(null)
  const drv = useRef(null)            // the map driver, Google or MapLibre
  const meMarker = useRef(null)
  const routeLines = useRef([])
  const trailLines = useRef([])
  const partyMarkers = useRef([])
  const partyRef = useRef(null)
  const sharing = useStore((s) => selectSharing(s, trip?.id))
  const lastPos = useRef(null)
  const trail = useRef([])
  // Snap to NAV_ZOOM on the first fix and whenever the user recentres; in
  // between, respect whatever zoom they pinched to.
  const resetZoom = useRef(true)
  const idleTimer = useRef(null)

  const [engine, setEngine] = useState(null)   // 'google' | 'maplibre' once ready
  const [pos, setPos] = useState(null)
  const [gpsError, setGpsError] = useState('')
  const [route, setRoute] = useState(null)
  const [routeState, setRouteState] = useState('idle') // idle | loading | ready | none
  const [online, setOnline] = useState(navigator.onLine)
  const [members, setMembers] = useState([])
  // A STOP / WAIT / LET'S GO from someone in the group, shown full screen.
  const [alertIn, setAlertIn] = useState(null)
  const dismissAlert = useCallback(() => setAlertIn(null), [])
  // Sound is only allowed after a tap; the first one on this screen unlocks it.
  useEffect(() => {
    const unlock = () => unlockAlertAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])
  const [saving, setSaving] = useState(null)
  const mapsRefused = useMapsRefused()
  // The two download sizes, worked out before anything is fetched.
  const [offlinePlan, setOfflinePlan] = useState(null)
  const downloadAbort = useRef(null)
  const [follow, setFollow] = useState(true)
  const [heading, setHeading] = useState(null)
  const [moving, setMoving] = useState(false)
  const [vehicle, setVehicle] = useState(() => pref('trekov.vehicle', 'car'))
  const [colour, setColour] = useState(() => pref('trekov.vehicleColour', 'green'))
  // Routing only cares about two wheels or four, not which model.
  const travelMode = baseOf(vehicle)
  const [mapType, setMapType] = useState(() => pref('trekov.navMapType', 'roadmap'))
  const [traffic, setTraffic] = useState(() => pref('trekov.traffic', '1') === '1')
  const [trafficShown, setTrafficShown] = useState(false)
  // Collapsed by default: the map is the thing you need while driving.
  const [expanded, setExpanded] = useState(false)
  // Vehicle and colour live behind the vehicle button rather than on the bar.
  const [picker, setPicker] = useState(false)
  const [view3d, setView3d] = useState(() => pref('trekov.view3d', '0') === '1')

  // In a trip we route through every remaining stop; the "destination" is
  // simply the next one, so the existing single-place path still applies.
  const tripStops = useMemo(() => {
    if (!trip?.stops?.length) return null
    const places = trip.stops.map((st) => getPlace(st.placeId)).filter(Boolean)
    const from = places.findIndex((p) => p.id === place.id)
    const remaining = from >= 0 ? places.slice(from) : places
    return remaining.length > 1 ? remaining : null
  }, [trip, place.id])

  const dest = useMemo(() => ({ lat: place.lat, lng: place.lng }), [place.lat, place.lng])
  // Read inside the map-creation effect, which must not re-run when the
  // itinerary changes — a ref rather than a dependency.
  const destIsTripStop = useRef(false)
  destIsTripStop.current = Boolean(tripStops)
  const bearingToDest = pos ? bearing(pos, dest) : null

  // Map-matching: ride the route line rather than the raw fix. Consumer GPS is
  // routinely tens of metres out, which otherwise parks the vehicle in the
  // buildings beside the road.
  const snap = pos && route?.coordinates?.length ? snapToPath(route.coordinates, pos) : null
  const onRoute = snap != null && snap.distance <= SNAP_M
  const shown = onRoute ? { lat: snap.lat, lng: snap.lng } : pos
  // A segment's own direction is far steadier than one derived from
  // consecutive fixes, so prefer it while we are on the road.
  const course = (onRoute ? snap.bearing : heading) ?? bearingToDest ?? 0

  /* --------------------------------------------------------- preferences */
  useEffect(() => { localStorage.setItem('trekov.vehicle', vehicle) }, [vehicle])
  useEffect(() => { localStorage.setItem('trekov.vehicleColour', colour) }, [colour])
  useEffect(() => { localStorage.setItem('trekov.navMapType', mapType); drv.current?.setMapType(mapType) }, [mapType, engine])
  // setTraffic reports whether the layer is actually showing — Google has one,
  // the offline MapLibre engine does not — and the route style follows that
  // rather than the button, so the offline map keeps its solid line.
  useEffect(() => {
    localStorage.setItem('trekov.traffic', traffic ? '1' : '0')
    setTrafficShown(Boolean(drv.current?.setTraffic(traffic)))
  }, [traffic, engine])
  useEffect(() => {
    localStorage.setItem('trekov.view3d', view3d ? '1' : '0')
    const apply = () => {
      drv.current?.setTilt(view3d ? 45 : 0)
      if (!view3d) drv.current?.setHeading(0)
    }
    apply()
    // A tilt set in the same tick the map is created is swallowed while the
    // vector renderer is still warming up, so 3D silently stayed flat until
    // the user toggled it. Re-apply once the map has settled.
    const t = setTimeout(apply, 600)
    return () => clearTimeout(t)
  }, [view3d, engine])

  /* ------------------------------------------------------------ position */
  useEffect(() => {
    if (!navigator.geolocation) return setGpsError('This device has no location support.')
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setGpsError('')
        setPos({
          lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy,
          gpsSpeed: Number.isFinite(p.coords.speed) ? p.coords.speed : null,
          t: Date.now(),
        })
      },
      (e) => setGpsError(e.code === 1 ? 'Location permission denied. Allow it to navigate.' : 'Waiting for a GPS fix…'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  useEffect(() => {
    if (!pos) return
    const prev = lastPos.current
    if (prev) {
      const metres = distance(prev, pos)
      if (metres > 5) setHeading(bearing(prev, pos))       // below ~5m it is jitter
      const secs = Math.max((pos.t - prev.t) / 1000, 0.001)
      const isMoving = (pos.gpsSpeed ?? metres / secs) > 0.7   // ~2.5 km/h
      setMoving(isMoving)

      // Standing still, a receiver stops emitting new fixes (or repeats the
      // same one), so this effect stops running and `moving` would stay true
      // forever — the vehicle kept throwing speed streaks at a red light.
      // Fall back to idle unless movement keeps arriving.
      clearTimeout(idleTimer.current)
      if (isMoving) idleTimer.current = setTimeout(() => setMoving(false), 3000)
    }
    lastPos.current = pos
    trail.current = [...trail.current, pos].slice(-14)
  }, [pos])

  useEffect(() => () => clearTimeout(idleTimer.current), [])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  /* ----------------------------------------------------------------- map */
  useEffect(() => {
    let alive = true
    let offDrag = () => {}
    // Losing signal rebuilds the map on the offline engine, and getting it
    // back rebuilds it on Google. Either way the new map opens on the rider at
    // street zoom — reopening on the destination at country zoom mid-ride
    // would throw away exactly the view someone was navigating by.
    const here = lastPos.current
    createMap(host.current, {
      center: here ? [here.lat, here.lng] : [dest.lat, dest.lng],
      zoom: here ? NAV_ZOOM : 9,
      mapType,
      offline: !online,
    }).then((d) => {
      if (!alive) { d.destroy(); return }
      drv.current = d
      if (here) resetZoom.current = true
      // Only when this is a lone destination. On a trip it is stop 1 and is
      // drawn with the rest of the numbered sequence below — drawing both put
      // an unnumbered circle where the "1" should have been.
      if (!destIsTripStop.current) {
        d.htmlMarker([dest.lat, dest.lng], pinHtml(place), { size: [44, 58], anchor: [22, 41] })
      }
      offDrag = d.onDragStart(() => setFollow(false))
      setEngine(d.kind)
    })
    return () => {
      alive = false
      offDrag()
      drv.current?.destroy()
      drv.current = null
      meMarker.current = null
      routeLines.current = []
      trailLines.current = []
      partyMarkers.current = []
      setEngine(null)
    }
    // mapType is read once at creation; later changes go through setMapType.
    // `online` is here on purpose: a Google map that has lost its network
    // stays on screen and fetches nothing, so the engine has to change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dest, online, mapsRefused])

  // Numbered markers for the other stops on a multi-stop trip.
  useEffect(() => {
    const d = drv.current
    if (!d || !tripStops) return
    // From one, not two. The first remaining stop is where you are heading
    // right now, and skipping it left the sequence starting at 2 with a blank
    // circle in front of it.
    const markers = tripStops.map((p, i) => d.htmlMarker(
      [p.lat, p.lng],
      `<div class="tk-stop${i === 0 ? ' is-next' : ''}"><b>${i + 1}</b><u>${esc(p.name)}</u></div>`,
      { size: [30, 30], zIndex: 500 + (i === 0 ? 1 : 0) },
    ))
    return () => markers.forEach((m) => m.remove())
  }, [tripStops, engine])

  // Route line. Deliberately no fitBounds: a 600km route would zoom the map
  // out to the whole country, and on a laptop the next GPS fix that would
  // zoom it back in may never come. Overview is a button instead.
  useEffect(() => {
    const d = drv.current
    if (!d) return
    routeLines.current.forEach((l) => l.remove())
    routeLines.current = []
    if (!route?.coordinates?.length) return
    // How Google does it: the route stays a solid, opaque line, and traffic is
    // painted onto the route itself rather than left to show through from the
    // road underneath. Dimming the line to reveal the map below cost more
    // legibility than it bought.
    //
    // Only the slow stretches are drawn over the base line — clear road is
    // already the route's own colour.
    const lines = [
      // Google-style: a blue route with a darker casing, traffic painted on top.
      d.polyline(route.coordinates, { color: '#1A4FA8', weight: 11, opacity: .9, back: true }),
      d.polyline(route.coordinates, { color: '#4285F4', weight: 7, opacity: 1 }),
    ]

    if (trafficShown) {
      for (const jam of route.traffic ?? []) {
        const part = route.coordinates.slice(jam.start, jam.end + 1)
        if (part.length < 2) continue
        lines.push(d.polyline(part, {
          color: jam.speed === 'TRAFFIC_JAM' ? '#D93025' : '#F29900',
          weight: 7,
          opacity: 1,
        }))
      }
    }

    routeLines.current = lines
  }, [route, engine, trafficShown])

  // Comet trail of recent fixes: one line per segment, since neither engine
  // can gradient a single polyline.
  useEffect(() => {
    const d = drv.current
    if (!d) return
    trailLines.current.forEach((l) => l.remove())
    trailLines.current = []
    const pts = trail.current
    if (!moving || pts.length < 2) return
    for (let i = 1; i < pts.length; i++) {
      const k = i / (pts.length - 1)
      trailLines.current.push(d.polyline(
        [[pts[i - 1].lat, pts[i - 1].lng], [pts[i].lat, pts[i].lng]],
        { color: '#3DDC97', opacity: 0.08 + k * 0.55, weight: 2 + k * 4 },
      ))
    }
  }, [pos, moving, engine])

  // Our own marker: the chosen vehicle in the chosen colour, rotated to the
  // way we are moving. Rotation lives on the outer node, motion on the inner.
  useEffect(() => {
    const d = drv.current
    if (!d || !shown) return
    // In 3D the map itself rotates to your heading, so the vehicle stays
    // pointing up the screen; in 2D the map is north-up and the vehicle turns.
    const rotate = view3d ? 0 : course
    if (view3d) d.setHeading(course)
    // Speed streaks rather than a smoke plume: light trails read as motion,
    // where billowing particles just read as exhaust.
    const dust = moving ? SPEED_STREAKS(vehicle) : ''
    const html = `<div class="tk-me" style="--rot:${rotate}deg">
                    <div class="tk-me-inner ${moving ? 'is-moving' : 'is-idle'}">
                      ${dust}
                      ${vehicleSvg(vehicle, { colour, size: 40, id: 'mk', ring: true })}
                    </div>
                  </div>`
    if (!meMarker.current) {
      meMarker.current = d.htmlMarker([shown.lat, shown.lng], html, { size: [44, 44], zIndex: 1000 })
    } else {
      meMarker.current.setLatLng([shown.lat, shown.lng])
      meMarker.current.setHtml(html)
    }
    if (follow) {
      const z = resetZoom.current ? NAV_ZOOM : d.getZoom()
      resetZoom.current = false
      // Dead centre: the vehicle is the fixed point and the map moves under
      // it, so it never drifts off while you are driving.
      d.setView([shown.lat, shown.lng], z)
    }
  }, [shown, course, follow, vehicle, colour, moving, engine, view3d])

  /* --------------------------------------------------------------- route */
  // The route depends on the vehicle (Google serves bikes differently), so a
  // vehicle change invalidates any fetch in flight and starts over.
  //
  // Staleness is a sequence number, not an effect cleanup: the fetch effect
  // depends on `pos`, and a cleanup there would cancel the request on every
  // GPS tick — so the route would never land while the vehicle was moving.
  const fetchSeq = useRef(0)
  useEffect(() => { fetchSeq.current++; setRoute(null); setRouteState('idle') }, [travelMode])
  useEffect(() => () => { fetchSeq.current++ }, [])

  useEffect(() => {
    if (!pos || routeState !== 'idle') return
    setRouteState('loading')
    const id = ++fetchSeq.current
    const ask = tripStops
      ? getTripRoute(pos, tripStops.map((p) => ({ lat: p.lat, lng: p.lng })), travelMode)
      : getRoute(pos, dest, travelMode)
    ask.then((r) => {
      if (id !== fetchSeq.current) return
      setRoute(r)
      setRouteState(r ? 'ready' : 'none')
    })
  }, [pos, dest, travelMode, routeState, tripStops])

  /* --------------------------------------------------------------- party */
  useEffect(() => {
    if (!trip) return
    partyRef.current = joinParty(trip.id, me, setMembers, undefined, (a) => {
      setAlertIn(a)
      playAlert(a.kind, a.name)
    })
    return () => { partyRef.current?.leave(); partyRef.current = null }
  }, [trip, me])

  // Companions see the vehicle you actually chose, pointing the way you drive.
  useEffect(() => {
    if (shown && partyRef.current) {
      partyRef.current.update(shown, {
        vehicle: travelMode, model: vehicle, colour, heading: course, moving,
        share: sharing.on, hideFrom: sharing.hiddenFrom,
      })
    }
  }, [shown, vehicle, colour, course, moving, sharing.on, sharing.hiddenFrom])

  useEffect(() => {
    const d = drv.current
    if (!d) return
    partyMarkers.current.forEach((m) => m.remove())
    // Companions reuse our own marker's markup, so they get the same speed
    // streaks and engine idle rather than sitting frozen on the map.
    partyMarkers.current = members.map((m) => d.htmlMarker(
      [m.lat, m.lng],
      `<div class="tk-mate">
         <span class="tk-mate-name">${esc(m.name)}</span>
         <span class="tk-me" style="--rot:${m.heading ?? 0}deg">
           <span class="tk-me-inner ${m.moving ? 'is-moving' : 'is-idle'}">
             ${m.moving ? SPEED_STREAKS(m.model ?? m.vehicle) : ''}
             ${vehicleSvg(m.model ?? m.vehicle ?? 'car', { colour: m.colour ?? 'green', size: 34, id: `mate-${m.id}`, ring: true })}
           </span>
         </span>
       </div>`,
      { size: [44, 44], zIndex: 900 },
    ))
  }, [members, engine])

  /* ---------------------------------------------------------- derivation */
  const straight = pos ? distance(pos, dest) : null
  const remainingRaw = snap && route ? distanceAlongRemaining(route.coordinates, snap) ?? straight : straight
  // Starting off-route adds the hop back onto it, which can read as more
  // distance left than the route is long. Never show that.
  const remaining = route && remainingRaw != null ? Math.min(remainingRaw, route.distance) : remainingRaw
  const offRoute = snap != null && !onRoute && snap.distance > 150

  const nextStep = useMemo(() => {
    if (!pos || !route?.steps?.length) return null
    let best = null
    let bestD = Infinity
    for (const s of route.steps) {
      if (s.lat == null) continue
      const d = distance(pos, { lat: s.lat, lng: s.lng })
      if (d < bestD) { bestD = d; best = { ...s, away: d } }
    }
    return best
  }, [pos, route])

  const frac = route && remaining != null ? remaining / Math.max(route.distance, 1) : 0
  const eta = route ? formatDuration((route.durationInTraffic ?? route.duration) * frac) : null
  // Progress along the route, derived rather than odometered: distance left is
  // measured from the nearest point on the line, so the rest is behind you.
  const travelled = route && remaining != null ? Math.max(0, route.distance - remaining) : null
  const donePct = route ? Math.min(100, Math.max(0, (1 - frac) * 100)) : 0

  /* ------------------------------------------------------------- actions */
  function recentre() { resetZoom.current = true; setFollow(true) }

  function overview() {
    const d = drv.current
    if (!d) return
    setFollow(false)
    const line = routeLines.current[1]
    if (line) d.fitBounds(line.bounds())
    else if (pos) d.fitBounds([[pos.lat, pos.lng], [dest.lat, dest.lng]])
  }

  function cycleMapType() {
    const types = drv.current?.mapTypes() ?? []
    if (!types.length) return
    const i = types.findIndex((t) => t.id === mapType)
    setMapType(types[(i + 1) % types.length].id)
  }

  /** Cost out both corridor widths for this route before fetching anything. */
  async function planOffline() {
    if (!route?.coordinates?.length) return
    try {
      // The tile index names this week's build; the plan fetches from it.
      const [{ free }, template] = await Promise.all([storageRoom(), offlineTileTemplate()])
      setOfflinePlan({
        standard: planRouteDownload(route.coordinates, 'standard', template),
        wide: planRouteDownload(route.coordinates, 'wide', template),
        free,
      })
    } catch (e) {
      setSaving({ error: e.message })
    }
  }

  async function saveOffline(level) {
    const plan = offlinePlan?.[level]
    if (!plan) return
    setOfflinePlan(null)
    // Ask the browser not to evict these under storage pressure — otherwise a
    // phone low on space can clear the map before the signal ever drops.
    await keepTiles()
    // The offline engine itself has to be on the phone too, not just its tiles.
    warmOfflineEngine()
    const ctrl = new AbortController()
    downloadAbort.current = ctrl
    setSaving({ done: 0, total: plan.urls.length })
    try {
      const res = await downloadTiles(
        plan.urls,
        (done, total, failed) => setSaving({ done, total, failed }),
        { signal: ctrl.signal },
      )
      setSaving({
        total: plan.urls.length, done: res.done ?? plan.urls.length, failed: res.failed,
        finished: !res.cancelled, cancelled: Boolean(res.cancelled),
      })
    } catch (e) {
      setSaving({ error: e.message })
    } finally {
      downloadAbort.current = null
    }
  }

  // Leaving the screen stops the download rather than orphaning it with no
  // progress and no way to cancel. Tiles already saved are kept.
  useEffect(() => () => downloadAbort.current?.abort(), [])

  const downloading = Boolean(saving && !saving.finished && !saving.cancelled && !saving.error)

  const mapTypeLabel = drv.current?.mapTypes().find((t) => t.id === mapType)?.label ?? 'Map'
  const CurrentVehicle = (VEHICLES.find((v) => v.id === vehicle) ?? VEHICLES[0]).Icon

  return (
    <Portal>
      <div className="fixed inset-0 z-[1400] bg-black flex justify-center" role="dialog" aria-label={`Navigate to ${place.name}`}>
      <AlertOverlay alert={alertIn} onDismiss={dismissAlert} />
        <div className="tk-shell h-full bg-ink flex flex-col sm:border-x sm:border-line">
          <header className="flex items-center gap-2 px-3 h-14 border-b border-line shrink-0">
            <button onClick={onClose} className="text-mist hover:text-white p-1" aria-label="Stop navigating">
              <BackIcon size={22} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-tight truncate">{place.name}</p>
              <p className="text-xs text-mist truncate">{place.region}</p>
            </div>
            {/* Guidance starts as soon as this screen opens — say so, since
                there is no button to press and people look for one. */}
            <span className={`flex items-center gap-1.5 text-[10px] font-semibold rounded-full px-2 py-1 shrink-0
                              ${pos ? 'text-brand bg-brand/15' : 'text-mist bg-raised'}`}>
              <span className={`size-1.5 rounded-full ${pos ? 'bg-brand animate-pulse' : 'bg-mist'}`} />
              {pos ? 'NAVIGATING' : 'WAITING FOR GPS'}
            </span>
            {!online && (
              <span className="text-[10px] font-semibold text-sun bg-sun/15 rounded-full px-2 py-1 shrink-0">OFFLINE</span>
            )}
          </header>

          {/* Voice sits under the header rather than in it: this is the
              control people reach for with gloves on, and the header is
              already carrying the destination and GPS state.

              Every trip gets it, solo included — the same rule the live
              positions above follow. "Solo" describes how the trip was
              planned, not who ends up riding it: a solo trip that gets
              shared has someone on the other end of the link, and anyone
              opening it lands in the same room. */}
          {trip && (
            <div className="flex items-center gap-2 px-3 py-2 border-b border-line shrink-0">
              <AlertButtons onSend={(kind) => partyRef.current?.alert(kind)} />
              <Voice tripId={trip.id} me={me} />
            </div>
          )}

          <div className="relative flex-1 min-h-0">
            <div ref={host} className="absolute inset-0 bg-raised" />

            <div className="absolute inset-x-3 top-3 z-[500] space-y-2">
              {nextStep && (
                <div className="rounded-2xl bg-ink/92 backdrop-blur-xl border border-line p-3">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-brand mb-1">Next</p>
                  <p className="text-sm font-semibold leading-tight">{instruction(nextStep)}</p>
                  <p className="text-xs text-mist mt-0.5">in {formatDistance(nextStep.away)}</p>
                </div>
              )}
              {offRoute && (
                <p className="rounded-xl bg-rose/20 backdrop-blur-xl border border-rose/40 text-rose text-xs px-3 py-2">
                  You're more than 150 m off the route.
                </p>
              )}
              {route?.modeFallback && travelMode === 'bike' && (
                <p className="rounded-xl bg-sun/15 backdrop-blur-xl border border-sun/40 text-sun text-xs px-3 py-2">
                  Bike routing isn't available here — showing the car route.
                </p>
              )}
            </div>

            <div className="absolute right-3 bottom-3 z-[500] flex flex-col items-end gap-2">
              {engine === 'google' && drv.current?.supports3D() && (
                <button onClick={() => setView3d((v) => !v)} aria-pressed={view3d}
                        className={`rounded-full backdrop-blur-xl border text-xs font-semibold px-3 py-2 transition
                                    ${view3d ? 'bg-brand text-ink border-brand' : 'bg-ink/90 border-line hover:border-brand'}`}>
                  {view3d ? '3D' : '2D'}
                </button>
              )}
              {engine === 'google' && (
                <>
                  <button onClick={() => setTraffic((v) => !v)} aria-pressed={traffic}
                          className={`rounded-full backdrop-blur-xl border text-xs font-semibold px-3 py-2 transition
                                      ${traffic ? 'bg-brand text-ink border-brand' : 'bg-ink/90 border-line hover:border-brand'}`}>
                    Traffic
                  </button>
                  <button onClick={cycleMapType}
                          className="rounded-full bg-ink/90 backdrop-blur-xl border border-line text-xs font-semibold px-3 py-2 hover:border-brand">
                    {mapTypeLabel} ▾
                  </button>
                </>
              )}
              <button onClick={overview}
                      className="rounded-full bg-ink/90 backdrop-blur-xl border border-line text-xs font-semibold px-3 py-2 hover:border-brand">
                Overview
              </button>
              {/* Trekov drives the navigation; Mappls is here for anyone who
                  would rather finish the journey in their app, and for the
                  house numbers it knows and we do not. A link, not the
                  default. */}
              <a href={mapplsUrl(place, currentVehicle())} target="_blank" rel="noreferrer"
                 className="rounded-full bg-ink/90 backdrop-blur-xl border border-line text-xs
                            font-semibold px-3 py-2 hover:border-brand text-center">
                Mappls
              </a>
              {!follow && pos && (
                <button onClick={recentre} className="rounded-full bg-brand text-ink text-xs font-semibold px-3 py-2">
                  Recentre
                </button>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-line pb-[env(safe-area-inset-bottom)]">
            {route && (
              <div className="h-1 w-full bg-raised" aria-hidden="true">
                <div className="h-full bg-brand transition-[width] duration-500" style={{ width: `${donePct}%` }} />
              </div>
            )}
            {gpsError && <p className="px-3 pt-2 text-xs text-sun">{gpsError}</p>}

            {/* Collapsed: one row. Everything else is one tap away, so the
                map keeps as much of the screen as possible while driving. */}
            <button onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
              <span className="relative size-9 rounded-full border border-line grid place-items-center shrink-0">
                <span className="text-base leading-none" style={{ transform: `rotate(${bearingToDest ?? 0}deg)` }}
                      aria-hidden="true">↑</span>
              </span>

              <span className="min-w-0 flex-1">
                {/* Remaining, travelled and the whole route side by side, so the
                    progress reads at a glance without opening the panel. */}
                <span className="flex items-end gap-3 tabular-nums">
                  <span className="shrink-0">
                    <span className="block text-xl font-semibold leading-none">
                      {remaining != null ? formatDistance(remaining) : '—'}
                    </span>
                    <span className="block text-[9px] uppercase tracking-[0.1em] text-mist mt-1">Remaining</span>
                  </span>
                  {route && (
                    <>
                      <span className="shrink-0 border-l border-line pl-3">
                        <span className="block text-sm font-semibold leading-none">
                          {travelled != null ? formatDistance(travelled) : '—'}
                        </span>
                        <span className="block text-[9px] uppercase tracking-[0.1em] text-mist mt-1">Travelled</span>
                      </span>
                      <span className="shrink-0 border-l border-line pl-3">
                        <span className="block text-sm font-semibold leading-none">{formatDistance(route.distance)}</span>
                        <span className="block text-[9px] uppercase tracking-[0.1em] text-mist mt-1">Total</span>
                      </span>
                    </>
                  )}
                </span>
                <span className="block text-[11px] text-mist truncate mt-1">
                  {routeState === 'loading' && 'Finding a route…'}
                  {routeState === 'none' && 'Straight-line direction only'}
                  {routeState === 'idle' && 'Waiting for your location…'}
                  {routeState === 'ready' && route && (
                    <>
                      {eta}{route.durationInTraffic ? ' in traffic' : ''} left
                      {route.stale ? ' · cached' : ''}
                      {members.length > 0 && ` · ${members.length} with you`}
                    </>
                  )}
                </span>
              </span>

              {/* One button showing what you are driving; tapping it opens the
                  vehicle and colour picker. */}
              <span role="button" tabIndex={0} aria-label="Change vehicle" aria-expanded={picker}
                    onClick={(e) => { e.stopPropagation(); setPicker((v) => !v) }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setPicker((v) => !v) } }}
                    className={`grid place-items-center size-10 rounded-xl border shrink-0 cursor-pointer transition
                                ${picker ? 'border-brand bg-brand/12' : 'border-line hover:border-mist'}`}>
                <CurrentVehicle size={28} id="sel-cur" colour={colour} />
              </span>

              <span className={`text-mist shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true">⌃</span>
            </button>

            {picker && (
              <div className="px-3 pb-3 space-y-2.5 border-t border-line pt-3">
                {['car', 'bike'].map((base) => (
                  <div key={base} className="flex items-stretch gap-1.5 overflow-x-auto no-bar" role="radiogroup"
                       aria-label={base === 'car' ? 'Cars' : 'Bikes'}>
                    {VEHICLES.filter((v) => v.base === base).map(({ id, label, Icon }) => (
                      <button key={id} onClick={() => setVehicle(id)} role="radio" aria-checked={vehicle === id}
                              className={`shrink-0 w-[4.25rem] flex flex-col items-center gap-0.5 rounded-xl border py-1.5 transition
                                          ${vehicle === id ? 'border-brand bg-brand/12' : 'border-line hover:border-mist'}`}>
                        <Icon size={30} id={`pick-${id}`} colour={colour} />
                        <span className={`text-[10px] font-semibold ${vehicle === id ? 'text-brand' : 'text-mist'}`}>{label}</span>
                      </button>
                    ))}
                  </div>
                ))}
                <div className="flex items-center gap-2 overflow-x-auto no-bar" role="radiogroup" aria-label="Vehicle colour">
                  {COLOURS.map((c) => (
                    <button key={c.id} onClick={() => setColour(c.id)} role="radio" aria-checked={colour === c.id}
                            aria-label={c.label} title={c.label}
                            className={`shrink-0 size-6 rounded-full border-2 transition
                                        ${colour === c.id ? 'border-white scale-110' : 'border-transparent hover:border-mist'}`}
                            style={{ background: `linear-gradient(135deg, ${c.tint.hi}, ${c.tint.mid} 55%, ${c.tint.lo})` }} />
                  ))}
                </div>
                <ModelCredit id={vehicle} />
              </div>
            )}

            {expanded && (
              <div className="px-3 pb-3 space-y-3 max-h-[42vh] overflow-y-auto border-t border-line pt-3">
                {tripStops && route?.legs?.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.14em] text-mist mb-2">
                      {trip.title} · {route.legs.length} stop{route.legs.length === 1 ? '' : 's'} left
                    </p>
                    <ol className="space-y-1.5">
                      {route.legs.map((leg, i) => {
                        const stop = tripStops[i]
                        if (!stop) return null

                        return (
                          <li key={stop.id} className="flex items-center gap-2.5 rounded-xl bg-surface border border-line px-2.5 py-2">
                            <span className="grid place-items-center size-6 rounded-full bg-brand/15 text-brand
                                             text-[10px] font-bold shrink-0 tabular-nums">{i + 1}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium truncate">{stop.name}</span>
                              <span className="block text-[11px] text-mist truncate">
                                {formatDistance(leg.distance)} · {formatDuration(leg.duration)}
                                {leg.inTraffic ? ' in traffic' : ''}
                              </span>
                            </span>
                            <span className="text-right shrink-0">
                              <span className="block text-xs font-semibold tabular-nums">
                                {arrivalAt(leg.cumulative)}
                              </span>
                              <span className="block text-[10px] text-mist">arrive</span>
                            </span>
                          </li>
                        )
                      })}
                    </ol>
                  </div>
                )}
                <p className="text-[11px] text-mist tabular-nums">{formatDistance(straight)} straight-line</p>

                {place.bestTime && (
                  <p className="inline-flex items-center gap-1.5 text-[11px] text-sun/90 bg-sun/10 rounded-full px-2.5 py-1">
                    <CalendarIcon size={12} /> Best {place.bestTime}
                  </p>
                )}

                {trip && (
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.14em] text-mist mb-1.5">
                      Travelling together · {trip.title}
                    </p>
                    {members.length === 0 ? (
                      <p className="text-[11px] text-mist">
                        Nobody else is navigating yet. Anyone who opens this trip shows up here.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {members.map((m) => (
                          <li key={m.id} className="flex items-center gap-2 text-xs">
                            <span className="size-2 rounded-full shrink-0" style={{ background: colourFor(m.id) }} />
                            <span className="truncate flex-1">{m.name}</span>
                            <span className="text-mist tabular-nums shrink-0">
                              {pos ? formatDistance(distance(pos, m)) : '—'} away
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {offlinePlan ? (
                  <div className="rounded-2xl border border-line bg-surface p-3">
                    <p className="text-xs font-semibold">Save this route for offline</p>
                    <p className="text-[11px] text-mist mb-2.5 leading-snug mt-0.5">
                      The whole corridor, from the country view down to the turnings.
                      {offlinePlan.free != null && ` ${formatBytes(offlinePlan.free)} free on this device.`}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(DETAIL).map(([id, d]) => {
                        const p = offlinePlan[id]
                        const tooBig = offlinePlan.free != null && p.bytes > offlinePlan.free
                        return (
                          <button key={id} onClick={() => saveOffline(id)} disabled={tooBig}
                                  className="rounded-xl border border-line p-2.5 text-left hover:border-brand
                                             disabled:opacity-40 disabled:hover:border-line">
                            <span className="block text-sm font-semibold">{d.label}</span>
                            <span className="block text-[11px] text-mist">{d.blurb}</span>
                            <span className="block text-xs font-semibold text-brand mt-1 tabular-nums">
                              ~{formatBytes(p.bytes)}
                            </span>
                            {tooBig && <span className="block text-[10px] text-rose">Not enough space</span>}
                          </button>
                        )
                      })}
                    </div>
                    <button onClick={() => setOfflinePlan(null)} className="text-[11px] text-mist mt-2 hover:text-white">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={planOffline} disabled={downloading || !route?.coordinates?.length}
                            className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs font-semibold
                                       hover:border-brand hover:text-brand disabled:opacity-50">
                      <Logo size={13} /> Save map offline
                    </button>
                    {downloading && (
                      <>
                        <span className="text-[11px] text-mist tabular-nums">
                          {Math.round((saving.done / saving.total) * 100)}% · {saving.done}/{saving.total}
                        </span>
                        <button onClick={() => downloadAbort.current?.abort()}
                                className="text-[11px] text-rose font-semibold">
                          Stop
                        </button>
                      </>
                    )}
                    {saving?.finished && (
                      <span className="text-[11px] text-brand">
                        Saved for offline{saving.failed ? ` · ${saving.failed} tiles missed` : ''}
                      </span>
                    )}
                    {saving?.cancelled && (
                      <span className="text-[11px] text-mist">Stopped — what downloaded is kept</span>
                    )}
                    {saving?.error && <span className="text-[11px] text-rose">{saving.error}</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Portal>
  )
}
