import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  bearing, compassPoint, distance, distanceAlongRemaining, formatDistance, formatDuration, snapToPath,
} from '../lib/geo'
import { arrivalAt } from '../lib/format'
import { getRoute, getTripRoute, instruction } from '../lib/route'
import { colourFor, joinParty, seenAgo } from '../lib/party'
import { getFix, watchFix } from '../lib/gps'
import { buzz, fullScreen, notifyLocal } from '../lib/native'
import { startLiveTrip, stopLiveTrip } from '../lib/liveTrip'
import { pushToTrip } from '../lib/push'
import {
  DETAIL, downloadTiles, formatBytes, keepTiles, offlineTileTemplate, planRouteDownload, storageRoom,
  warmOfflineEngine,
} from '../lib/offline'
import { createMap, useMapsRefused } from '../lib/mapDrivers'
import { COLOURS, MODELS, baseOf, pickableVehicle, vehicleSvg } from '../lib/vehicleArt'
import { completeTrip, getPlace, isCompleted, selectSafety, selectSharing, setSharing, useStore } from '../lib/store'
import { hideRiderId, showRiderId } from '../lib/riderId'
import { syncNow } from '../lib/sync'
import { BackIcon, CalendarIcon, Logo } from './Icons'
import { VEHICLES } from './VehicleIcons'
import Voice from './Voice'
import { ALERT_LOOK, AlertButtons, AlertOverlay, playAlert, unlockAlertAudio } from './GroupAlerts'
import { requestCompass, watchCompass } from '../lib/compass'
import Portal from './Portal'
import { useMembership } from '../lib/membership'
import { isNativeApp, platform } from '../lib/platform'
import { cssUrl, esc } from '../lib/safe'
import { NATIVE_NAV_FAILED, nativeNavAvailable, startNativeNav, underPageLayout } from '../lib/nativeNav'
import { frameFor, spriteHtml, vehicleSprite } from '../lib/vehicleSprites'

// What the alert buttons say, for a notification when the app isn't in front.
const ALERT_WORDS = { stop: 'STOP', wait: 'WAIT', go: "LET'S GO" }

/** Street level. Esri imagery tops out at 18; 17 keeps a block of context. */
// A group screenshot build (VITE_DEMO_RIDERS) pulls back so the riders ahead are in view.
const NAV_ZOOM = import.meta.env.VITE_SIMULATE_NAV === '1' && Number(import.meta.env.VITE_DEMO_RIDERS) ? 15 : 17
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
  if (!m?.credit) return null
  return (
    <p className="text-[10px] text-mist">
      3D model by{' '}
      <a href={m.credit.url} target="_blank" rel="noreferrer" className="underline hover:text-white">{m.credit.by}</a>
      {' '}· {m.credit.license}
    </p>
  )
}

/** Another rider on Trekov's own map: their vehicle, and their name above it. */
const mateHtml = (m, isCaptain, frame) => `<div class="tk-mate${m.stale ? ' is-stale' : ''}${isCaptain ? ' is-captain' : ''}">
   <span class="tk-mate-name">${isCaptain ? '★ ' : ''}${esc(m.name)}${m.stale ? ` · ${seenAgo(m.at, true)}` : ''}</span>
   <span class="tk-me" style="--rot:${frame != null ? 0 : (Number(m.heading) || 0)}deg">
     <span class="tk-me-inner ${m.moving ? 'is-moving' : 'is-idle'}">
       ${m.moving && frame == null ? SPEED_STREAKS(m.model ?? m.vehicle) : ''}
       ${spriteHtml(m.model ?? m.vehicle, { frame, size: 52 })}
     </span>
   </span>
 </div>`

// The destination pin carries the place's photo, like the pins on the main map.
const pinHtml = (p) => {
  const src = cssUrl(p?.photo?.thumb)
  const bg = src ? ` style="background-image:url('${src}')"` : ''
  return `<div class="tk-pin"><div class="tk-pin-img"${bg}></div></div>`
}


const pref = (key, fallback) => localStorage.getItem(key) ?? fallback
const simulateFrom = (text) => {
  const [lat, lng] = String(text ?? '').split(',').map(Number)
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng) ? { lat, lng } : undefined
}

// Other riders on Google's map, as a share of your own vehicle's size.
const RIDER_SCALE = 0.6

// Store screenshots of a big group need more riders than we have test
// accounts. A testing build made with VITE_DEMO_RIDERS=n adds n made-up riders
// on the road ahead, drawn by the same rider code as real ones. Never in a
// release: it needs VITE_SIMULATE_NAV too, which android-release.sh refuses
// for a Play bundle.
const DEMO_RIDERS = import.meta.env.VITE_SIMULATE_NAV === '1' ? Math.min(Number(import.meta.env.VITE_DEMO_RIDERS) || 0, 8) : 0
const DEMO_CREW = [   // name, model, colour, metres ahead of you
  ['Aarav', 'classic', 'red', 220], ['Meera', 'sport', 'blue', 460], ['Kabir', 'suv', 'white', 720],
  ['Ishaan', 'cruiser', 'black', 990], ['Riya', 'tourer', 'orange', 1270], ['Vikram', 'offroad', 'green', 1560],
  ['Zoya', 'trail', 'yellow', 1860], ['Dev', 'roadster', 'silver', 2170],
]
function demoRiders(coords, pos) {
  const snap = snapToPath(coords, pos)
  if (!snap) return []
  const pt = (i) => ({ lat: coords[i][0], lng: coords[i][1] })
  const cum = [0]
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distance(pt(i - 1), pt(i)))
  const here = cum[snap.index] + distance(pt(snap.index), snap)
  return DEMO_CREW.slice(0, DEMO_RIDERS).map(([name, model, colour, ahead]) => {
    const at = Math.min(here + ahead, cum[cum.length - 1])
    let i = cum.findIndex((c) => c > at) - 1
    if (i < 0) i = cum.length - 2
    const a = pt(i), b = pt(i + 1)
    const t = cum[i + 1] > cum[i] ? (at - cum[i]) / (cum[i + 1] - cum[i]) : 0
    return {
      id: `demo-${name}`, name, model, vehicle: model === 'suv' || model === 'offroad' ? 'car' : 'bike', colour,
      lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t,
      heading: bearing(a, b), stale: false, at: Date.now(),
    }
  })
}

export default function Navigate({ place, trip, me, onClose, onPlans }) {
  // Once paid plans are on, riding live with the group needs an active account.
  // Navigation itself stays free.
  const membership = useMembership()
  const groupLocked = Boolean(trip && membership?.paywallOn && !membership.isMember)
  const host = useRef(null)
  const drv = useRef(null)            // the map driver, Google or MapLibre
  const meMarker = useRef(null)
  const meLook = useRef('')            // what the own marker currently shows
  const routeLines = useRef([])
  const trailLines = useRef([])
  const partyMarkers = useRef(new Map())   // rider id -> { marker, look }
  const partyRef = useRef(null)
  const sharing = useStore((s) => selectSharing(s, trip?.id))
  // The rider's emergency details go on the lock screen for as long as this
  // screen is open — the stretch where a crash is possible (lib/riderId.js).
  const safety = useStore(selectSafety)
  const myProfile = useStore((s) => s.profile)
  useEffect(() => {
    showRiderId(myProfile, safety)
    return () => { hideRiderId() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safety.bloodGroup, safety.emergencyPhone, safety.emergencyName, safety.insured, myProfile?.name])
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
  const [routeState, setRouteState] = useState('idle') // idle | loading | ready | retry | none
  const [online, setOnline] = useState(navigator.onLine)
  const [partyMembers, setMembers] = useState([])
  const members = useMemo(
    () => (DEMO_RIDERS && pos && route?.coordinates?.length
      ? [...partyMembers, ...demoRiders(route.coordinates, pos)]
      : partyMembers),
    [partyMembers, pos, route],
  )
  // A STOP / WAIT / LET'S GO from someone in the group, shown full screen.
  const [alertIn, setAlertIn] = useState(null)
  const [outgoing, setOutgoing] = useState(null)   // an alert waiting for signal
  const [turnOpen, setTurnOpen] = useState(false)  // the next-turn chip, expanded
  const [layersOpen, setLayersOpen] = useState(null)  // null, or where to open the map menu
  const dismissAlert = useCallback(() => setAlertIn(null), [])
  // Sound is only allowed after a tap; the first one on this screen unlocks it.
  // So is the compass on iPhone, which asks permission the same way.
  useEffect(() => {
    const unlock = () => { unlockAlertAudio(); requestCompass() }
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
  // The phone's compass, for the direction you face while standing still.
  const [compass, setCompass] = useState(null)
  useEffect(() => watchCompass(setCompass), [])
  // Heading up, as Google does it: the map turns so the way you face is up the
  // screen. Off gives a north-up map with the vehicle turning instead.
  const [headingUp, setHeadingUp] = useState(() => pref('trekov.headingUp', '1') === '1')
  const lastBearing = useRef(null)
  const mapBearingRef = useRef(0)
  // Whether this map can actually turn. Google only knows once it has picked
  // vector or raster, a moment after the map exists — so it is state, not a
  // question asked of the map while rendering.
  const [vector, setVector] = useState(false)
  const [moving, setMoving] = useState(false)
  const [vehicle, setVehicle] = useState(() => pickableVehicle(pref('trekov.vehicle', 'hatchback')))
  // Models keep their own paint now; the colour is still sent, for riders on
  // older versions whose drawn car or bike takes one.
  const colour = 'green'
  // Routing only cares about two wheels or four, not which model.
  const travelMode = baseOf(vehicle)
  const [mapType, setMapType] = useState(() => pref('trekov.navMapType', 'roadmap'))
  const [traffic, setTraffic] = useState(() => pref('trekov.traffic', '1') === '1')
  const [trafficShown, setTrafficShown] = useState(false)
  // Collapsed by default: the map is the thing you need while driving.
  const [expanded, setExpanded] = useState(false)
  // Vehicle and colour live behind the vehicle button rather than on the bar.
  const [picker, setPicker] = useState(false)
  // The first live group ride says plainly that the group can see you, and
  // where to stop it (launch audit, 2026-09-14).
  const [shareNotice, setShareNotice] = useState(() => pref('trekov.shareNotice', '0') !== '1')
  const dismissShareNotice = () => {
    setShareNotice(false)
    try { localStorage.setItem('trekov.shareNotice', '1') } catch { /* ignore */ }
  }
  // The vehicle is changed by tapping it on the map (Punit, 2026-09-14); the
  // button that did it from the bottom bar is gone. Say so once.
  const [tapHint, setTapHint] = useState(() => pref('trekov.vehicleTapHint', '0') !== '1')
  const openPicker = () => {
    setPicker((v) => !v)
    setTapHint(false)
    try { localStorage.setItem('trekov.vehicleTapHint', '1') } catch { /* ignore */ }
  }
  const [view3d, setView3d] = useState(() => pref('trekov.view3d', '0') === '1')

  // Google's own turn-by-turn in the Android and iPhone apps; Trekov's map elsewhere,
  // and whenever Google's can't start (lib/nativeNav.js). 'checking' holds the
  // map back for the moment it takes to ask.
  const [navMode, setNavMode] = useState(() => (isNativeApp ? 'checking' : 'web'))
  const native = navMode === 'native'
  // iPhone: Google's map fills the whole screen, under the status bar and the
  // home bar, and Trekov's panels float over it (Punit, 2026-09-15). Android
  // keeps the map between the panels — its map view sits above the page.
  const fullBleed = native && platform === 'ios'
  const topPanel = useRef(null)
  const bottomPanel = useRef(null)
  useEffect(() => {
    if (!fullBleed) return
    document.documentElement.classList.add('tk-see-through')
    return () => document.documentElement.classList.remove('tk-see-through')
  }, [fullBleed])
  const [nativeProgress, setNativeProgress] = useState(null)   // { meters, seconds }
  // iPhone: Google's next turn (Trekov draws the card) and whether the camera follows.
  const [nativeStep, setNativeStep] = useState(null)
  const [nativeFollow, setNativeFollow] = useState(true)
  const [navNotice, setNavNotice] = useState('')
  // Spoken directions in Google's navigation, and its map style — a row of
  // choices under the header (Punit, 2026-09-14).
  const [navVoice, setNavVoice] = useState(() => pref('trekov.navVoice', '1') === '1')
  const [styleOpen, setStyleOpen] = useState(false)
  const nativeNav = useRef(null)
  useEffect(() => {
    if (navMode !== 'checking') return
    let alive = true
    nativeNavAvailable().then((ok) => { if (alive) setNavMode(ok ? 'native' : 'web') })
    return () => { alive = false }
  }, [navMode])

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

  // At the trip's last stop, offer to mark it done (Punit, 2026-09-21): from
  // Google's own arrival on the phone apps, or within 150 m of it otherwise.
  // Only the host — the server keeps their copy of the trip.
  const account = useStore((s) => s.account)
  const lastStop = useMemo(() => (trip?.stops?.length ? getPlace(trip.stops.at(-1).placeId) : null), [trip])
  const [arrivedEnd, setArrivedEnd] = useState(false)
  const [endPrompt, setEndPrompt] = useState('ask')     // 'ask' | 'dismissed' | 'done'
  const mayComplete = Boolean(trip && lastStop && !isCompleted(trip) && (!trip.ownerId || !account || trip.ownerId === account.id))
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
  // Which way you face. On the move the road knows; standing still GPS has no
  // direction at all, so the compass does — turn the phone at a junction and the
  // map turns with it.
  const facing = !moving && compass != null ? compass : course
  // A Google map can only turn when it is a vector map (the same test 3D uses);
  // the offline MapLibre map always can.
  const canRotate = engine === 'maplibre' || (engine === 'google' && vector)
  const rotating = canRotate && (headingUp || view3d)
  const mapBearing = rotating ? facing : 0
  mapBearingRef.current = mapBearing
  const view3dRef = useRef(view3d)
  view3dRef.current = view3d

  /* --------------------------------------------------------- preferences */
  useEffect(() => { localStorage.setItem('trekov.vehicle', vehicle) }, [vehicle])
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
      if (!view3d && !headingUp) { drv.current?.setHeading(0); lastBearing.current = null }
    }
    apply()
    // A tilt set in the same tick the map is created is swallowed while the
    // vector renderer is still warming up, so 3D silently stayed flat until
    // the user toggled it. Re-apply once the map has settled.
    const t = setTimeout(apply, 600)
    return () => clearTimeout(t)
  }, [view3d, engine, headingUp])
  useEffect(() => { localStorage.setItem('trekov.headingUp', headingUp ? '1' : '0') }, [headingUp])

  // Turn the map. Separate from the vehicle marker, because standing still the
  // position does not change but the compass does. Nothing under two degrees:
  // a phone held in a hand never reads perfectly still.
  useEffect(() => {
    const d = drv.current
    if (!d || !rotating) { lastBearing.current = null; return }
    const prev = lastBearing.current
    const delta = prev == null ? 360 : Math.abs(((mapBearing - prev + 540) % 360) - 180)
    if (delta < 2) return
    lastBearing.current = mapBearing
    d.setHeading(mapBearing)
  }, [mapBearing, rotating, engine])

  // Riding takes the whole screen in the app: no status bar over the map.
  useEffect(() => {
    fullScreen(true)
    return () => fullScreen(false)
  }, [])

  /* ------------------------------------------------------------ position */
  useEffect(() => {
    // With Google's navigation the position comes from it, road-snapped.
    if (navMode !== 'web') return
    let stopWatching = null
    let gone = false
    let fixed = false
    const onFix = (fix) => {
      if (gone) return
      fixed = true
      setGpsError('')
      setPos({ lat: fix.lat, lng: fix.lng, acc: fix.accuracy, gpsSpeed: fix.speed, t: Date.now() })
    }
    const onError = (code) => setGpsError(code === 'denied'
      ? 'Location permission denied. Allow it to navigate.'
      : 'Waiting for a GPS fix…')

    // On a group trip the phone keeps reporting with the screen off — Android
    // hands that to a foreground service, which is why the rider sees an
    // ongoing notification (lib/liveTrip.js). Riding alone, or if the phone
    // won't, the ordinary watch does (lib/gps.js: the app's own location
    // service, the browser's on the web).
    if (trip) {
      startLiveTrip(onFix).then((live) => {
        if (gone) return
        if (!live) { stopWatching = watchFix(onFix, onError); return }
        // The live watcher throws away the phone's first, cached position and
        // then reports only after 10 m of movement — so a rider standing at the
        // meeting point sat on "Waiting for GPS" until they rode off (iPhone
        // simulator, 2026-09-13). One fresh fix gets them on the map straight away.
        getFix({ timeout: 20_000 }).then((fix) => { if (!fixed) onFix(fix) }, () => {})
      })
    } else {
      stopWatching = watchFix(onFix, onError)
    }
    return () => {
      gone = true
      stopLiveTrip()
      stopWatching?.()
    }
  }, [trip?.id, navMode])

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
    if (navMode !== 'web') return
    let alive = true
    let offDrag = () => {}
    let offRendering = () => {}
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
      // Whatever this map opened on, the next fix belongs at street zoom. It
      // used to be armed only when a position already existed, so a map built
      // before the first fix — or rebuilt when the signal dropped and the
      // offline engine took over — kept following the rider from 9, the view
      // you get of a whole district (found on the simulator, 2026-09-12).
      resetZoom.current = true
      // Only when this is a lone destination. On a trip it is stop 1 and is
      // drawn with the rest of the numbered sequence below — drawing both put
      // an unnumbered circle where the "1" should have been.
      if (!destIsTripStop.current) {
        d.htmlMarker([dest.lat, dest.lng], pinHtml(place), { size: [44, 58], anchor: [22, 41] })
      }
      offDrag = d.onDragStart(() => setFollow(false))
      const syncVector = () => setVector(Boolean(d.supports3D()))
      syncVector()
      offRendering = d.onRenderingType(syncVector)
      setEngine(d.kind)
    })
    return () => {
      alive = false
      offDrag()
      offRendering()
      setVector(false)
      drv.current?.destroy()
      drv.current = null
      meMarker.current = null
      routeLines.current = []
      trailLines.current = []
      // A Map since the markers are kept per rider (see the party effect below).
      partyMarkers.current = new Map()
      setEngine(null)
    }
    // mapType is read once at creation; later changes go through setMapType.
    // `online` is here on purpose: a Google map that has lost its network
    // stays on screen and fetches nothing, so the engine has to change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dest, online, mapsRefused, navMode])

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

  // Our own marker: the chosen vehicle. On a tilted (3D) map it is the rendered
  // model seen from the side the camera is on — the frame for the heading
  // against the map's bearing (lib/vehicleSprites.js). Flat, it is the view
  // from above, turned. Rotation lives on the outer node, motion on the inner.
  useEffect(() => {
    const d = drv.current
    if (!d || !shown) return
    const frame = view3d ? frameFor(facing, mapBearing) : null
    // When the map turns to face your direction the vehicle stays pointing up
    // the screen; on a north-up map the vehicle turns instead.
    const rotate = frame != null ? 0 : rotating ? 0 : facing
    // Speed streaks rather than a smoke plume: light trails read as motion,
    // where billowing particles just read as exhaust. Only from above: in 3D
    // they would trail the wrong way.
    const dust = moving && frame == null ? SPEED_STREAKS(vehicle) : ''
    const html = `<div class="tk-me" style="--rot:${rotate}deg">
                    <div class="tk-me-inner ${moving ? 'is-moving' : 'is-idle'}">
                      ${dust}
                      ${spriteHtml(vehicle, { frame, size: 86 })}
                    </div>
                  </div>`
    // Re-creating the image on every GPS fix made it flicker on iPhone; only a
    // change of vehicle, frame or moving/stopped rebuilds it.
    const look = `${moving}|${vehicle}|${frame}`
    if (!meMarker.current) {
      meMarker.current = d.htmlMarker([shown.lat, shown.lng], html, { size: [86, 86], zIndex: 1000, onClick: () => openPicker() })
      meLook.current = look
    } else {
      meMarker.current.setLatLng([shown.lat, shown.lng])
      if (meLook.current !== look) { meMarker.current.setHtml(html); meLook.current = look }
      else meMarker.current.el?.querySelector('.tk-me')?.style.setProperty('--rot', `${rotate}deg`)
    }
    if (follow) {
      const z = resetZoom.current ? NAV_ZOOM : d.getZoom()
      resetZoom.current = false
      // Dead centre: the vehicle is the fixed point and the map moves under
      // it, so it never drifts off while you are driving.
      d.setView([shown.lat, shown.lng], z)
    }
  }, [shown, facing, rotating, follow, vehicle, moving, engine, view3d, mapBearing])

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

  // Traffic changes by the minute, and each rider fetches their own route, so
  // without this two phones on the same road show whatever traffic there was
  // when each started. Every 3 minutes online the route is fetched again; the
  // current line stays on screen until the new one arrives.
  useEffect(() => {
    if (!online) return
    const timer = setInterval(() => setRouteState((s) => (s === 'ready' ? 'idle' : s)), 180_000)
    return () => clearInterval(timer)
  }, [online])

  useEffect(() => {
    // Google's navigation routes for itself; asking here too would pay twice.
    if (!pos || routeState !== 'idle' || (navMode !== 'web' && !DEMO_RIDERS)) return
    setRouteState('loading')
    const id = ++fetchSeq.current
    const ask = tripStops
      ? getTripRoute(pos, tripStops.map((p) => ({ lat: p.lat, lng: p.lng })), travelMode)
      : getRoute(pos, dest, travelMode)
    // A refresh that comes back empty — a dropped bar of signal, a router that
    // answers with nothing — is not a reason to throw away the route already on
    // the screen. The old line stays and we ask again shortly. It used to
    // replace the route with null, which wiped the blue line mid-ride and left
    // it wiped: 'none' was a dead end the three-minute refresh never revisited
    // (reported on an iPhone, 2026-09-13).
    const failed = () => {
      if (id !== fetchSeq.current) return
      setRouteState(route ? 'retry' : 'none')
    }
    ask.then((r) => {
      if (id !== fetchSeq.current) return
      if (r) { setRoute(r); setRouteState('ready') } else failed()
    }).catch(failed)
  }, [pos, dest, travelMode, routeState, tripStops, route, navMode])

  // Ask again after a failure, rather than sitting on a stale route for ever.
  useEffect(() => {
    if (routeState !== 'retry' && routeState !== 'none') return
    const timer = setTimeout(() => setRouteState('idle'), routeState === 'retry' ? 20_000 : 45_000)
    return () => clearTimeout(timer)
  }, [routeState])

  /* --------------------------------------------------------------- party */
  useEffect(() => {
    if (!trip || groupLocked) return
    partyRef.current = joinParty(trip.id, me, setMembers, undefined, (a) => {
      setAlertIn(a)
      playAlert(a.kind)
      // Phone in a pocket or another app in front: the alert still reaches them.
      if (document.hidden) {
        notifyLocal({ title: `${ALERT_WORDS[a.kind] ?? 'Alert'} — ${a.name}`, body: `On ${trip.title}` })
      }
    }, setOutgoing)
    return () => { partyRef.current?.leave(); partyRef.current = null; setOutgoing(null) }
  }, [trip, me, groupLocked])

  // Companions see the vehicle you actually chose, pointing the way you drive.
  useEffect(() => {
    if (shown && partyRef.current) {
      partyRef.current.update(shown, {
        vehicle: travelMode, model: vehicle, colour, heading: course, moving,
        share: sharing.on, hideFrom: sharing.hiddenFrom,
      })
    }
  }, [shown, vehicle, colour, course, moving, sharing.on, sharing.hiddenFrom])

  // A new map engine means new markers.
  useEffect(() => () => { partyMarkers.current.forEach((c) => c.marker.remove()); partyMarkers.current.clear() }, [engine])

  // The rider leading this trip: whoever the host named, or the host
  // (supabase/trip-roles.sql). Marked on the map so the group can find them.
  const captainId = trip ? trip.captainId ?? trip.ownerId ?? null : null

  useEffect(() => {
    const d = drv.current
    if (!d) return
    // One marker per rider, moved in place. Rebuilding every marker whenever
    // anyone moved made them all blink (seen on iPhone, 2026-09-11); a marker
    // is rebuilt only when that rider's look changes.
    const seen = new Set()
    for (const m of members) {
      seen.add(m.id)
      const isCaptain = m.id === captainId
      const frame = view3dRef.current ? frameFor(m.heading, mapBearingRef.current) : null
      const look = `${m.stale}|${m.moving}|${m.model ?? m.vehicle}|${m.name}|${isCaptain}|${m.stale ? seenAgo(m.at, true) : ''}|${frame}`
      const html = mateHtml(m, isCaptain, frame)
      const cur = partyMarkers.current.get(m.id)
      if (!cur) {
        partyMarkers.current.set(m.id, { marker: d.htmlMarker([m.lat, m.lng], html, { size: [52, 52], zIndex: 900 }), look, heading: m.heading, m, isCaptain })
      } else {
        cur.marker.setLatLng([m.lat, m.lng])
        cur.heading = m.heading
        cur.m = m
        cur.isCaptain = isCaptain
        if (cur.look !== look) { cur.marker.setHtml(html); cur.look = look }
        else if (frame == null) cur.marker.el?.querySelector('.tk-me')?.style.setProperty('--rot', `${(Number(m.heading) || 0) - mapBearingRef.current}deg`)
      }
    }
    for (const [id, cur] of partyMarkers.current) {
      if (!seen.has(id)) { cur.marker.remove(); partyMarkers.current.delete(id) }
    }
  }, [members, engine, captainId])

  // A rider heading north points up a north-up map, but not a turned one: when
  // the map turns, every other rider's vehicle turns back by the same amount.
  // It used to ignore this, so in 3D the group's vehicles pointed the wrong way.
  useEffect(() => {
    for (const cur of partyMarkers.current.values()) {
      if (view3d && cur.m) {
        // In 3D the frame changes instead: the camera now sees another side.
        const frame = frameFor(cur.heading, mapBearing)
        const look = cur.look.replace(/\|[^|]*$/, `|${frame}`)
        if (look !== cur.look) { cur.marker.setHtml(mateHtml(cur.m, cur.isCaptain, frame)); cur.look = look }
      } else {
        cur.marker.el?.querySelector('.tk-me')?.style.setProperty('--rot', `${(Number(cur.heading) || 0) - mapBearing}deg`)
      }
    }
  }, [mapBearing, view3d])

  /* ----------------------------------------------------- Google navigation */
  const nativeStops = useMemo(
    () => (tripStops ?? [place]).map((p) => ({ lat: p.lat, lng: p.lng, title: p.name ?? '' })),
    [tripStops, place],
  )
  // A trip object is rebuilt on every sync; restart guidance only when the
  // stops themselves change — each start is a billed route request.
  const nativeStopsKey = nativeStops.map((st) => `${st.lat.toFixed(5)},${st.lng.toFixed(5)}`).join('|')
  const nativeStopsRef = useRef(nativeStops)
  nativeStopsRef.current = nativeStops
  // Google's view sits on top of the page, so it steps aside for anything the
  // page puts over the map: a full-screen alert, the offline download dialog.
  const nativeVisible = !alertIn && !offlinePlan
  const nativeVisibleRef = useRef(nativeVisible)
  nativeVisibleRef.current = nativeVisible
  // Each rider on Google's map as their own vehicle, in 3D. A model's sheet is
  // sent the first time someone rides it.
  const sentIcons = useRef(new Set())
  const sendRiders = async (nav) => {
    const icons = {}
    const list = []
    for (const m of members) {
      if (!Number.isFinite(m.lat) || !Number.isFinite(m.lng)) continue
      let key = ''
      try {
        const sprite = await vehicleSprite(m.model ?? m.vehicle)
        key = sprite.key
        // Smaller than your own vehicle: at full size a group of them covered
        // the road you are meant to be reading (Punit, 2026-09-14).
        if (!sentIcons.current.has(key)) icons[key] = { ...sprite, cellDp: Math.round(sprite.cellDp * RIDER_SCALE) }
      } catch { /* a dot in their colour instead */ }
      list.push({
        id: m.id, name: m.name ?? 'Rider', lat: m.lat, lng: m.lng, heading: Number(m.heading) || 0,
        stale: Boolean(m.stale), captain: m.id === captainId,
        colour: (COLOURS.find((c) => c.id === m.colour) ?? COLOURS[0]).tint.mid,
        icon: key,
      })
    }
    if (nav !== nativeNav.current) return
    nav.riders(list, icons)
    Object.keys(icons).forEach((k) => sentIcons.current.add(k))
  }
  const sendRidersRef = useRef(sendRiders)
  sendRidersRef.current = sendRiders

  useEffect(() => {
    if (!native || !host.current) return
    let gone = false
    const el = host.current
    const nav = startNativeNav(el, {
      stops: nativeStopsRef.current,
      mode: travelMode,
      // Drive the route without moving, for testing at a desk: trekov.simulateNav = '1',
      // or a test build made with VITE_SIMULATE_NAV=1.
      // Only in a testing build; the native side also ignores it in a release.
      simulate: import.meta.env.VITE_SIMULATE_NAV === '1' && (Boolean(import.meta.env.VITE_SIMULATE_FROM) || pref('trekov.simulateNav', '1') === '1'),
      // "lat,lng" to start the simulated ride away from the tester's own street.
      simulateFrom: simulateFrom(import.meta.env.VITE_SIMULATE_NAV === '1' ? import.meta.env.VITE_SIMULATE_FROM : ''),
      voice: pref('trekov.navVoice', '1') === '1',
      mapType: pref('trekov.navMapType', 'roadmap'),
      traffic: pref('trekov.traffic', '1') === '1',
      layout: platform === 'ios' ? underPageLayout(topPanel.current, bottomPanel.current) : undefined,
      onLocation: (l) => {
        if (gone) return
        setGpsError('')
        setPos({ lat: l.lat, lng: l.lng, acc: l.accuracy, gpsSpeed: l.speed, t: Date.now() })
      },
      onProgress: (p) => { if (!gone) setNativeProgress(p) },
      onVehicleTap: () => { if (!gone) openPicker() },
      onStep: (st) => { if (!gone) setNativeStep(st) },
      onFollow: (on) => { if (!gone) setNativeFollow(on) },
      onArrival: (a) => { if (!gone && a?.final) setArrivedEnd(true) },
    })
    nativeNav.current = nav
    sentIcons.current = new Set()
    nav.ready.then(() => { if (!gone) sendRidersRef.current(nav) }, (e) => {
      if (gone) return
      nav.stop()
      nativeNav.current = null
      setNavNotice(NATIVE_NAV_FAILED[e?.code] ?? "Google's navigation couldn't start — using Trekov's map instead.")
      setNavMode('web')
    })
    const follow = () => nav.place(nativeVisibleRef.current)
    const ro = new ResizeObserver(follow)
    ro.observe(el)
    // Over a full-screen map the panels are what move: a picker opening, a notice.
    if (topPanel.current) ro.observe(topPanel.current)
    if (bottomPanel.current) ro.observe(bottomPanel.current)
    window.addEventListener('resize', follow)
    return () => {
      gone = true
      ro.disconnect()
      window.removeEventListener('resize', follow)
      nav.stop()
      nativeNav.current = null
      setNativeProgress(null)
      setNativeStep(null)
      setNativeFollow(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, nativeStopsKey, travelMode])

  // The map area moves when the panels above or below it change size.
  useEffect(() => {
    if (!native) return
    const id = requestAnimationFrame(() => nativeNav.current?.place(nativeVisible))
    return () => cancelAnimationFrame(id)
  }, [native, nativeVisible, expanded, picker, outgoing, gpsError, navNotice, saving, styleOpen])

  useEffect(() => {
    localStorage.setItem('trekov.navVoice', navVoice ? '1' : '0')
    if (native) nativeNav.current?.voice(navVoice)
  }, [native, navVoice])
  useEffect(() => {
    if (native) nativeNav.current?.mapStyle(mapType, traffic)
  }, [native, mapType, traffic])

  // The rest of the group, drawn on Google's map.
  useEffect(() => {
    if (native && nativeNav.current) sendRidersRef.current(nativeNav.current)
  }, [native, members, captainId])

  // Your own vehicle on Google's map, in 3D: the model picked below. Sent again
  // whenever the picker changes.
  useEffect(() => {
    if (!native) return
    let alive = true
    const nav = nativeNav.current
    vehicleSprite(vehicle).then((f) => { if (alive && nav === nativeNav.current) nav?.vehicle(f) }, () => {})
    return () => { alive = false }
  }, [native, vehicle, nativeStopsKey, travelMode])

  /* ---------------------------------------------------------- derivation */
  const straight = pos ? distance(pos, dest) : null
  const remainingRaw = snap && route ? distanceAlongRemaining(route.coordinates, snap) ?? straight : straight
  // Starting off-route adds the hop back onto it, which can read as more
  // distance left than the route is long. Never show that.
  const remaining = route && remainingRaw != null ? Math.min(remainingRaw, route.distance) : remainingRaw
  const offRoute = snap != null && !onRoute && snap.distance > 150
  const atEnd = arrivedEnd || Boolean(pos && lastStop && distance(pos, lastStop) < 150)
  function finishTrip() {
    completeTrip(trip.id)
    if (account) syncNow(account.id)
    setEndPrompt('done')
  }

  // Off the line: ask for a new route from here, as a rider expects after a
  // wrong turn. Only the three-minute refresh used to, so the old line, the
  // distance left and the ETA stayed wrong that long (iPhone, 2026-09-14).
  // Not more than every 15 s, so a weak fix wobbling around 150 m doesn't
  // hammer the router.
  const lastReroute = useRef(0)
  useEffect(() => {
    if (!offRoute || routeState !== 'ready' || !online) return
    if (Date.now() - lastReroute.current < 15_000) return
    lastReroute.current = Date.now()
    setRouteState('idle')
  }, [offRoute, routeState, online])

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
  const shownRemaining = native ? nativeProgress?.meters ?? null : remaining

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

  const mapTypes = engine === 'google' ? drv.current?.mapTypes() ?? [] : []
  const mapTypeLabel = mapTypes.find((t) => t.id === mapType)?.label ?? 'Map'

  return (
    <Portal>
      <div className={`fixed inset-0 z-[1400] flex justify-center ${fullBleed ? '' : 'bg-black'}`} role="dialog" aria-label={`Navigate to ${place.name}`}>
      <AlertOverlay alert={alertIn} onDismiss={dismissAlert} />
        <div className={`tk-shell h-full flex flex-col sm:border-x sm:border-line px-safe
                         ${fullBleed ? 'relative' : 'bg-ink pt-safe'}`}>
          {/* Over a full-screen map the top controls are one floating panel;
              otherwise they are rows of the column (display: contents). */}
          <div ref={topPanel}
               className={fullBleed ? 'absolute inset-x-0 top-0 z-[20] pt-safe px-safe bg-ink rounded-b-3xl shadow-2xl' : 'contents'}>
          <header className="flex items-center gap-2 px-3 h-14 border-b border-line shrink-0">
            <button onClick={onClose} className="grid place-items-center size-10 -ml-1.5 shrink-0 text-mist hover:text-white" aria-label="Stop navigating">
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
            {/* Google's map sits on top of the page, so its settings live up
                here rather than as buttons over the map. */}
            {native && (
              <>
                <button onClick={() => setNavVoice((v) => !v)} aria-pressed={navVoice}
                        aria-label={navVoice ? 'Voice directions on. Turn off' : 'Voice directions off. Turn on'}
                        title={navVoice ? 'Voice directions on' : 'Voice directions off'}
                        className={`grid place-items-center size-10 -mr-1 rounded-full shrink-0 transition
                                    ${navVoice ? 'text-brand' : 'text-mist'}`}>
                  <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.9"
                       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" fill="currentColor" fillOpacity=".15" />
                    {navVoice
                      ? <><path d="M15.5 9a4.2 4.2 0 0 1 0 6" /><path d="M18.3 6.5a8 8 0 0 1 0 11" /></>
                      : <path d="m16 9.5 5 5m0-5-5 5" />}
                  </svg>
                </button>
                <button onClick={() => setStyleOpen((v) => !v)} aria-expanded={styleOpen}
                        aria-label="Map type and traffic" title="Map type and traffic"
                        className={`grid place-items-center size-10 -mr-1.5 rounded-full shrink-0 transition
                                    ${styleOpen ? 'text-brand' : 'text-mist'}`}>
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9"
                       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" />
                  </svg>
                </button>
              </>
            )}
          </header>

          {native && styleOpen && (
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-line shrink-0 overflow-x-auto no-bar"
                 role="group" aria-label="Map type and traffic">
              {[['roadmap', 'Map'], ['satellite', 'Satellite'], ['hybrid', 'Hybrid'], ['terrain', 'Terrain']].map(([id, label]) => (
                <button key={id} onClick={() => setMapType(id)} aria-pressed={mapType === id}
                        className={`shrink-0 min-h-9 rounded-full border text-xs font-semibold px-3 transition
                                    ${mapType === id ? 'border-brand bg-brand/15 text-brand' : 'border-line text-mist'}`}>
                  {label}
                </button>
              ))}
              <span className="w-px h-5 bg-line mx-0.5 shrink-0" aria-hidden="true" />
              <button onClick={() => setTraffic((v) => !v)} aria-pressed={traffic}
                      className={`shrink-0 min-h-9 rounded-full border text-xs font-semibold px-3 transition
                                  ${traffic ? 'border-brand bg-brand/15 text-brand' : 'border-line text-mist'}`}>
                Traffic {traffic ? 'on' : 'off'}
              </button>
            </div>
          )}

          {/* Voice sits under the header rather than in it: this is the
              control people reach for with gloves on, and the header is
              already carrying the destination and GPS state.

              Every trip gets it, solo included — the same rule the live
              positions above follow. "Solo" describes how the trip was
              planned, not who ends up riding it: a solo trip that gets
              shared has someone on the other end of the link, and anyone
              opening it lands in the same room. */}
          {trip && !groupLocked && (
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line shrink-0">
              <AlertButtons
                      onSend={(kind) => {
                        buzz('alert')
                        partyRef.current?.alert(kind)
                        // Riders with Trekov closed get it as a notification.
                        pushToTrip({
                          tripId: trip.id, kind: 'alert',
                          title: `${ALERT_WORDS[kind] ?? 'Alert'} — ${me.name}`,
                          body: `On ${trip.title}`,
                        })
                      }}
                      waiting={outgoing?.kind} />
              {/* Its own full-width row, as big as the alert buttons above it. */}
              <div className="w-full">
                <Voice tripId={trip.id} me={me} />
              </div>
            </div>
          )}
          {trip && !groupLocked && outgoing && (
            <p className="px-3 py-1.5 text-[11px] font-semibold text-sun bg-sun/10 border-b border-line shrink-0" role="status">
              No signal — your {ALERT_LOOK[outgoing.kind].label} goes out as soon as there is (for the next 10 min).
            </p>
          )}
          {/* iPhone: Google's guidance, in Trekov's card — Google's own map
              view can't hide its arrow, so its turn card went with it. */}
          {fullBleed && nativeStep?.instruction && (
            <div className="flex items-center gap-3 px-4 py-3 border-t border-line" role="status" aria-live="polite">
              <span className="grid place-items-center size-11 rounded-2xl bg-brand/15 shrink-0">
                <TurnArrow step={{ type: nativeStep.maneuver }} size={28} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-2xl font-bold leading-none tabular-nums">
                  {nativeStep.meters >= 0 ? formatDistance(nativeStep.meters) : ''}
                </span>
                <span className="block text-sm leading-snug mt-1 line-clamp-2">{nativeStep.instruction}</span>
              </span>
              {nativeStep.nextManeuver && (
                <span className="shrink-0 flex flex-col items-center text-[10px] text-mist">
                  Then
                  <TurnArrow step={{ type: nativeStep.nextManeuver }} />
                </span>
              )}
            </div>
          )}
          </div>

          <div className={fullBleed ? 'absolute inset-0' : 'relative flex-1 min-h-0'}>
            <div ref={host} className={`absolute inset-0 ${fullBleed ? '' : 'bg-raised'}`} />

            {/* Google's navigation brings its own turn card, recentre and
                overview; these are Trekov's map's. */}
            {!native && (<>

            <div className="absolute inset-x-3 top-3 z-[500] space-y-2">
              {/* The next turn as a small chip (arrow + distance) so the map stays
                  visible; tap for the full instruction. Beside it, who is riding. */}
              <div className="flex items-start gap-2">
                {nextStep && (
                  <button onClick={() => setTurnOpen((v) => !v)} aria-expanded={turnOpen}
                          aria-label={`Next: ${instruction(nextStep)} in ${formatDistance(nextStep.away)}`}
                          className="shrink-0 max-w-[70%] rounded-2xl bg-ink/92 backdrop-blur-xl border border-line px-3 py-2 text-left">
                    <span className="flex items-center gap-2">
                      <TurnArrow step={nextStep} />
                      <span className="text-sm font-bold tabular-nums">{formatDistance(nextStep.away)}</span>
                    </span>
                    {turnOpen && <span className="block text-xs text-mist mt-1 leading-snug">{instruction(nextStep)}</span>}
                  </button>
                )}
                {/* Just the count while riding (Punit, 2026-09-11) — names and
                    distances are one tap away in the panel below. */}
                {trip && !groupLocked && members.length > 0 && (() => {
                  const live = members.filter((m) => !m.stale).length
                  const quiet = members.length - live
                  return (
                    <button onClick={() => setExpanded(true)}
                            aria-label={`${live} riding live${quiet ? `, ${quiet} not heard from recently` : ''} — show who`}
                            className="shrink-0 flex items-center gap-1.5 rounded-2xl bg-ink/92 backdrop-blur-xl border border-line px-3 py-2 text-sm font-bold">
                      <span className={`size-2 rounded-full ${live ? 'bg-brand animate-pulse' : 'bg-mist'}`} />
                      <GroupIcon />
                      {live} live
                      {quiet > 0 && <span className="text-xs font-semibold text-mist">· {quiet} away</span>}
                    </button>
                  )
                })()}
              </div>
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

            {layersOpen && mapTypes.length > 0 && (
              <>
                {/* Tap anywhere else on the map to close it. */}
                <button className="absolute inset-0 z-[590] cursor-default" aria-label="Close map options"
                        onClick={() => setLayersOpen(null)} />
                <div role="menu" aria-label="Map options"
                     style={{ right: layersOpen.right, bottom: layersOpen.bottom }}
                     className="absolute z-[600] w-48 max-h-[calc(100%-1rem)] overflow-y-auto no-bar rounded-2xl bg-ink/95
                                backdrop-blur-xl border border-line shadow-2xl p-1.5"
                     onKeyDown={(e) => { if (e.key === 'Escape') setLayersOpen(null) }}>
                  <p className="px-2.5 pt-1.5 pb-1 text-[10px] uppercase tracking-[0.14em] text-mist">Map type</p>
                  {mapTypes.map((t) => (
                    <button key={t.id} role="menuitemradio" aria-checked={mapType === t.id}
                            onClick={() => { setMapType(t.id); setLayersOpen(null) }}
                            className={`w-full flex items-center justify-between rounded-xl px-2.5 py-2 text-sm text-left
                                        ${mapType === t.id ? 'text-brand bg-brand/10' : 'hover:bg-raised'}`}>
                      {t.label}
                      {mapType === t.id && <span aria-hidden="true">✓</span>}
                    </button>
                  ))}
                  <div className="my-1.5 border-t border-line" />
                  {/* Traffic stays open on toggle: you check the map, then close it. */}
                  <label className="flex items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-sm cursor-pointer hover:bg-raised">
                    <span>Traffic</span>
                    <input type="checkbox" role="menuitemcheckbox" checked={traffic} aria-checked={traffic}
                           onChange={(e) => setTraffic(e.target.checked)}
                           className="size-4 accent-[#00C08B] cursor-pointer" />
                  </label>
                </div>
              </>
            )}

            {/* Scrolls rather than spilling over the Next card on a short
                (landscape) map; the room kept above it is that card's. */}
            <div className={`absolute right-3 bottom-3 z-[500] flex flex-col items-end gap-2 overflow-y-auto no-bar
                             ${nextStep || members.length ? 'max-h-[max(5.5rem,calc(100%-4.75rem))]' : 'max-h-[calc(100%-1.5rem)]'}`}>
              {canRotate && (
                <button onClick={() => { requestCompass(); setHeadingUp((v) => !v) }} aria-pressed={headingUp}
                        aria-label={headingUp ? 'Facing your direction. Switch to north up' : 'North up. Switch to facing your direction'}
                        title={headingUp ? 'Facing your direction — tap for north up' : 'North up — tap to face your direction'}
                        className={`size-10 grid place-items-center rounded-full backdrop-blur-xl border transition
                                    ${headingUp ? 'bg-ink/90 border-brand' : 'bg-ink/90 border-line hover:border-brand'}`}>
                  {/* The needle points at north on the screen, so it turns as the map does. */}
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"
                       style={{ transform: `rotate(${-mapBearing}deg)`, transition: 'transform .2s linear' }}>
                    <path d="M12 3 15.5 12H8.5Z" fill="#FF5C7A" />
                    <path d="M12 21 8.5 12h7Z" fill={headingUp ? '#EEF3F1' : '#8FA39C'} />
                  </svg>
                </button>
              )}
              {engine === 'google' && vector && (
                <button onClick={() => setView3d((v) => !v)} aria-pressed={view3d}
                        className={`min-h-10 min-w-10 rounded-full backdrop-blur-xl border text-xs font-semibold px-3 py-2 transition
                                    ${view3d ? 'bg-brand text-ink border-brand' : 'bg-ink/90 border-line hover:border-brand'}`}>
                  {view3d ? '3D' : '2D'}
                </button>
              )}
              {/* Map type and traffic live in one menu, so the map keeps its
                  corner: two buttons became one (Punit, 2026-09-13). */}
              {mapTypes.length > 0 && (
                <button onClick={(e) => {
                          if (layersOpen) return setLayersOpen(null)
                          // Open straight above the button, measured now: its width
                          // follows the label, so a fixed offset covered it.
                          const b = e.currentTarget.getBoundingClientRect()
                          const box = e.currentTarget.parentElement.parentElement.getBoundingClientRect()
                          setLayersOpen({ right: box.right - b.right, bottom: box.bottom - b.top + 8 })
                        }}
                        aria-expanded={Boolean(layersOpen)} aria-haspopup="menu"
                        className={`min-h-10 flex items-center gap-1.5 rounded-full backdrop-blur-xl border text-xs font-semibold px-3 py-2 transition
                                    ${layersOpen ? 'bg-ink border-brand' : 'bg-ink/90 border-line hover:border-brand'}`}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9"
                       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" />
                  </svg>
                  {mapTypeLabel} <span aria-hidden="true">{layersOpen ? '▴' : '▾'}</span>
                </button>
              )}
              <button onClick={overview}
                      className="min-h-10 rounded-full bg-ink/90 backdrop-blur-xl border border-line text-xs font-semibold px-3 py-2 hover:border-brand">
                Overview
              </button>
              {!follow && pos && (
                <button onClick={recentre} className="min-h-10 rounded-full bg-brand text-ink text-xs font-semibold px-3 py-2">
                  Recentre
                </button>
              )}
            </div>
            </>)}
          </div>

          <div ref={bottomPanel}
               className={fullBleed
                 ? 'absolute inset-x-0 bottom-0 z-[20] px-safe bg-ink rounded-t-3xl shadow-2xl pb-[max(.5rem,env(safe-area-inset-bottom))]'
                 : 'shrink-0 border-t border-line pb-[env(safe-area-inset-bottom)]'}>
            {fullBleed && (
              <div className="flex justify-end gap-2 px-3 pt-2.5">
                <button onClick={() => nativeNav.current?.overview()}
                        className="min-h-9 rounded-full border border-line text-xs font-semibold px-3 hover:border-brand">
                  Overview
                </button>
                {!nativeFollow && (
                  <button onClick={() => nativeNav.current?.recenter()}
                          className="min-h-9 rounded-full bg-brand text-ink text-xs font-semibold px-3">
                    Recentre
                  </button>
                )}
              </div>
            )}
            {route && (
              <div className="h-1 w-full bg-raised" aria-hidden="true">
                <div className="h-full bg-brand transition-[width] duration-500" style={{ width: `${donePct}%` }} />
              </div>
            )}
            {gpsError && <p className="px-3 pt-2 text-xs text-sun">{gpsError}</p>}
            {navNotice && <p className="px-3 pt-2 text-xs text-sun">{navNotice}</p>}
            {((mayComplete && atEnd && endPrompt === 'ask') || endPrompt === 'done') && (
              <div className="mx-3 mt-2.5 rounded-2xl border border-brand/40 bg-brand/10 p-3" role="status">
                {endPrompt === 'done' ? (
                  <div className="flex items-center gap-2">
                    <p className="flex-1 text-sm"><span className="font-semibold">Trip completed.</span> Nice ride!</p>
                    <button onClick={onClose} className="rounded-full bg-brand text-ink px-3.5 py-1.5 text-xs font-semibold">Finish</button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm">
                      <span className="font-semibold">You made it to {lastStop.name}</span>
                      <span className="text-mist"> — the last stop of “{trip.title}”.</span>
                    </p>
                    <div className="flex gap-2 justify-end mt-2">
                      <button onClick={() => setEndPrompt('dismissed')}
                              className="rounded-full border border-line px-3.5 py-1.5 text-xs font-semibold">Not yet</button>
                      <button onClick={finishTrip}
                              className="rounded-full bg-brand text-ink px-3.5 py-1.5 text-xs font-semibold">Mark trip completed</button>
                    </div>
                  </>
                )}
              </div>
            )}
            {trip && !groupLocked && sharing.on && shareNotice && (
              <div className="mx-3 mt-2 flex items-start gap-2 rounded-xl border border-brand/40 bg-brand/10 px-3 py-2">
                <p className="flex-1 text-[11px] leading-snug">
                  Only riders on this trip see your live location, and only while the ride is open. You can
                  switch it off here, or later on the trip page.
                </p>
                <button onClick={() => { setSharing(trip.id, false); dismissShareNotice() }}
                        className="text-xs text-mist shrink-0 min-h-8 px-1">Stop sharing</button>
                <button onClick={dismissShareNotice} className="text-xs font-semibold text-brand shrink-0 min-h-8 px-1">OK</button>
              </div>
            )}
            {tapHint && !picker && (pos || nativeProgress) && (
              <button onClick={() => setTapHint(false)} className="block w-full px-3 pt-2 text-left text-[11px] text-brand">
                Tip: tap your vehicle on the map to change it ✕
              </button>
            )}

            {/* Collapsed: one row. Everything else is one tap away, so the
                map keeps as much of the screen as possible while driving. */}
            <button onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
              {fullBleed ? (
                // No Google footer on the iPhone map, so the time and distance live here.
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2 tabular-nums">
                    <span className="text-xl font-bold text-brand leading-none">
                      {nativeProgress ? formatDuration(nativeProgress.seconds) : '—'}
                    </span>
                    <span className="text-sm font-semibold leading-none">
                      {nativeProgress ? formatDistance(nativeProgress.meters) : ''}
                    </span>
                    {nativeProgress && <span className="text-xs text-mist leading-none">· {arrivalAt(nativeProgress.seconds)}</span>}
                  </span>
                  <span className="block text-[11px] text-mist truncate mt-1">
                    {!nativeProgress ? 'Starting Google navigation…'
                      : members.some((m) => !m.stale) ? `${members.filter((m) => !m.stale).length} riding with you`
                      : trip?.kind === 'group' ? 'Riding with your group' : `To ${place.name}`}
                  </span>
                </span>
              ) : native ? (
                // Google's own card already shows the time left, the distance
                // and the arrival time right above this row; repeating them
                // here only took space from the map (Punit, 2026-09-14). The
                // row keeps what Google doesn't: the group.
                <span className="min-w-0 flex-1 flex items-center gap-2">
                  <GroupIcon />
                  <span className="text-sm font-semibold truncate">
                    {members.some((m) => !m.stale)
                      ? `${members.filter((m) => !m.stale).length} riding with you`
                      : trip?.kind === 'group' ? 'Riding with your group' : `To ${place.name}`}
                  </span>
                  {!nativeProgress && <span className="text-[11px] text-mist truncate">· Starting Google navigation…</span>}
                </span>
              ) : (<>
              <span className="relative size-9 rounded-full border border-line grid place-items-center shrink-0">
                <span className="text-base leading-none" style={{ transform: `rotate(${(bearingToDest ?? 0) - mapBearing}deg)` }}
                      aria-hidden="true">↑</span>
              </span>

              <span className="min-w-0 flex-1">
                {/* Remaining, travelled and the whole route side by side, so the
                    progress reads at a glance without opening the panel. */}
                <span className="flex items-end gap-3 tabular-nums">
                  <span className="shrink-0">
                    <span className="block text-xl font-semibold leading-none">
                      {shownRemaining != null ? formatDistance(shownRemaining) : '—'}
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
                  {native && (nativeProgress
                    ? <>{formatDuration(nativeProgress.seconds)} left
                        {members.some((m) => !m.stale) && ` · ${members.filter((m) => !m.stale).length} with you`}</>
                    : 'Starting Google navigation…')}
                  {!native && routeState === 'loading' && 'Finding a route…'}
                  {!native && routeState === 'none' && 'Straight-line direction only'}
                  {!native && routeState === 'idle' && 'Waiting for your location…'}
                  {/* A refresh that failed does not change what you are
                      riding: the route on screen is still the live one, so it
                      keeps its arrival time rather than being replaced by a
                      status message. */}
                  {!native && (routeState === 'ready' || routeState === 'retry') && route && (
                    <>
                      {eta}{route.durationInTraffic ? ' in traffic' : ''} left
                      {route.stale ? ' · cached' : ''}
                      {members.some((m) => !m.stale) && ` · ${members.filter((m) => !m.stale).length} with you`}
                    </>
                  )}
                </span>
              </span>
              </>)}

              <span className={`text-mist shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true">⌃</span>
            </button>

            {/* Picker and panel share one capped, scrolling area, so with both
                open the map still keeps part of the screen. dvh sits behind
                supports-[] because Tailwind emits [45dvh] before [45vh]. */}
            <div className="max-h-[45vh] supports-[height:1dvh]:max-h-[45dvh] [@media(max-height:480px)]:max-h-[30dvh]
                            overflow-y-auto overscroll-contain">
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
                <ModelCredit id={vehicle} />
              </div>
            )}

            {expanded && (
              <div className="px-3 pb-3 space-y-3 border-t border-line pt-3">
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
                    {captainId && (
                      <p className="text-[11px] text-mist mb-1">
                        {captainId === me.id
                          ? "You're the captain — the group follows you."
                          : `Captain: ${members.find((m) => m.id === captainId)?.name ?? 'not riding yet'}`}
                      </p>
                    )}
                    {groupLocked ? (
                      <p className="text-[11px] text-mist">
                        Live locations, alerts and voice need an active Trekov account.{' '}
                        {!isNativeApp && (
                          <button onClick={() => onPlans?.('rider')} className="text-brand font-semibold">
                            ₹{membership.riderPrice}/year
                          </button>
                        )}
                      </p>
                    ) : members.length === 0 ? (
                      <p className="text-[11px] text-mist">
                        Nobody else is navigating yet. Anyone who opens this trip shows up here.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {members.map((m) => (
                          <li key={m.id} className="flex items-center gap-2 text-xs">
                            <span className="size-2 rounded-full shrink-0" style={{ background: colourFor(m.id) }} />
                            <span className={`truncate ${m.stale ? 'text-mist' : ''}`}>{m.name}</span>
                            {m.id === captainId && (
                              <span className="shrink-0 rounded-full border border-brand/60 text-brand text-[10px] font-semibold px-1.5">
                                Captain
                              </span>
                            )}
                            <span className="flex-1" />
                            {m.stale && <span className="text-sun text-[11px] shrink-0">last seen {seenAgo(m.at)}</span>}
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
                    {/* Offline tiles are for Trekov's own map; Google's navigation
                        keeps its route by itself when the signal drops. */}
                    {!native && (
                      <button onClick={planOffline} disabled={downloading || !route?.coordinates?.length}
                              className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs font-semibold
                                         hover:border-brand hover:text-brand disabled:opacity-50">
                        <Logo size={13} /> Save map offline
                      </button>
                    )}
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
      </div>
    </Portal>
  )
}

/**
 * The arrow for a maneuver. Steps come from OSRM (type + modifier), Google
 * Routes (TURN_SLIGHT_LEFT…) or Directions (turn-slight-left…), so the words
 * are matched rather than exact values.
 */
function TurnArrow({ step, size = 20 }) {
  const m = `${step.type ?? ''} ${step.modifier ?? ''}`.toLowerCase().replace(/_/g, '-')
  const side = /left/.test(m) ? -1 : /right/.test(m) ? 1 : 0
  let icon
  if (/arrive|destination/.test(m)) {
    icon = <path d="M6 21V4h11l-2 4 2 4H6" />
  } else if (/uturn|u-turn/.test(m)) {
    icon = <path d={side > 0 ? 'M8 20V9a4 4 0 0 1 8 0v4m-3-3 3 3 3-3' : 'M16 20V9a4 4 0 0 0-8 0v4m3-3-3 3-3-3'} />
  } else if (/roundabout|rotary/.test(m)) {
    icon = <><circle cx="12" cy="13" r="4" /><path d="M12 9V3m-3 3 3-3 3 3" /></>
  } else {
    const angle = side * (/sharp/.test(m) ? 135 : /slight|keep|fork|ramp|merge/.test(m) ? 45 : side ? 90 : 0)
    icon = <path d="M12 20V5m-6 6 6-6 6 6" transform={`rotate(${angle} 12 12)`} />
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
         strokeLinecap="round" strokeLinejoin="round" className="text-brand shrink-0" aria-hidden="true">
      {icon}
    </svg>
  )
}

const GroupIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" className="text-mist" aria-hidden="true">
    <circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><circle cx="17" cy="9" r="2.5" /><path d="M15.5 14.2A5 5 0 0 1 21 19" />
  </svg>
)
