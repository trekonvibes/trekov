import { useEffect, useRef, useState } from 'react'
import { cssUrl, esc } from '../lib/safe'
import {
  addStop, createTrip, getPlace, selectPlaceSearch, selectPlaces, canEditTrip, selectTrips,
  toggleSavePlace, useStore,
} from '../lib/store'
import { createMap, preferredMapType, rememberMapType, useMapsRefused } from '../lib/mapDrivers'
import { adoptHit } from '../lib/adopt'
import { endSearchSession, resolveHit, searchAll, searchAnywhere } from '../lib/geocode'
import { getFix } from '../lib/gps'
import { distance, formatDistance } from '../lib/geo'
import { CloseIcon, NavIcon, PlusIcon, RouteIcon, SaveIcon, SearchIcon, Wordmark } from './Icons'

const INDIA = [22.6, 79.0]

/** Screen pixels per degree of longitude at a zoom level (Web Mercator, 256px tiles). */
const pxPerDeg = (zoom) => (256 * 2 ** zoom) / 360
/** Markers closer than this on screen merge into one cluster, so none overlap. */
const MERGE_PX = 56
/** From this zoom on, every place stands alone. */
const CLOSE_ZOOM = 15
/** Zoomed in this close, pins shrink to small dots so the streets around them show. */
const SMALL_PIN_ZOOM = 13

/**
 * Markers are grouped by their distance on screen, at every zoom: two places
 * closer than a marker's width become one counted cluster instead of two
 * circles piled on each other. Zooming in splits them apart until each place
 * stands alone. (A fixed grid used to pack 52px bubbles into ~28px cells, so
 * at the India view they covered the whole map.)
 */
function cluster(places, zoom) {
  if (zoom >= CLOSE_ZOOM) return places.map((p) => ({ key: p.id, lat: p.lat, lng: p.lng, places: [p] }))
  const ppd = pxPerDeg(zoom)
  const groups = []
  for (const p of places) {
    // A Mercator map stretches latitude by 1/cos(latitude).
    const sec = 1 / Math.cos((p.lat * Math.PI) / 180)
    const g = groups.find((c) => Math.hypot((p.lng - c.lng0) * ppd, (p.lat - c.lat0) * ppd * sec) < MERGE_PX)
    if (g) g.places.push(p)
    else groups.push({ lat0: p.lat, lng0: p.lng, places: [p] })
  }
  return groups.map((g) => ({
    key: g.places[0].id,
    lat: g.places.reduce((n, p) => n + p.lat, 0) / g.places.length,
    lng: g.places.reduce((n, p) => n + p.lng, 0) / g.places.length,
    places: g.places,
  }))
}

/** Marker box and tip for each look, so a marker is only rebuilt when its look changes. */
const SHAPES = {
  pin: { size: [44, 58], anchor: [22, 41] },   // one place
  sm:  { size: [44, 42], anchor: [22, 26] },   // one place, zoomed right in
  cl:  { size: [40, 40], anchor: [20, 20] },   // a cluster
  lg:  { size: [46, 46], anchor: [23, 23] },   // a big cluster
}


function markerHtml(node, zoom) {
  const { places } = node
  if (places.length === 1) {
    const p = places[0]
    const thumb = p.cover && !p.cover.blobKey ? cssUrl(p.cover.src) : ''
    return `<div class="tk-pin ${p.saved ? 'is-saved' : ''} ${zoom >= SMALL_PIN_ZOOM ? 'is-sm' : ''}">
              <div class="tk-pin-img" ${thumb ? `style="background-image:url('${thumb}')"` : ''}></div>
              ${p.postCount ? `<span class="tk-pin-count">${p.postCount}</span>` : ''}
              <span class="tk-pin-label">${esc(p.name)}</span>
            </div>`
  }
  const total = places.reduce((n, p) => n + p.postCount, 0)
  // Just the count: the photo tally moved to the tooltip, and the bubble shrank with it.
  const title = `${places.length} places${total ? ` · ${total} photo${total === 1 ? '' : 's'}` : ''}`
  return `<div class="tk-cluster ${places.length >= 25 ? 'is-lg' : ''}" title="${title}"><b>${places.length}</b></div>`
}

export default function MapView({ onOpenPlace, onNewPlace, onNavigate, onGoLive, onOpenTrip, onStartGroup }) {
  const mapsRefused = useMapsRefused()
  const host = useRef(null)
  const drv = useRef(null)
  const markers = useRef(new Map())   // cluster key + look -> { marker, html, handler }
  const [engine, setEngine] = useState(null)
  const [zoom, setZoom] = useState(4)
  const [q, setQ] = useState('')
  const [mapType, setMapType] = useState(preferredMapType)
  const [traffic, setTraffic] = useState(false)
  // Anywhere in the world, not only the places Trekov already knows.
  const [world, setWorld] = useState([])
  const [searching, setSearching] = useState(false)
  // Where you are, so a search finds the Palladium in your city rather than the
  // one nearest the middle of the India map (Punit, 2026-09-15). Asked for once
  // you start typing; without it, search leans on what the map shows.
  const here = useRef(null)
  const askedHere = useRef(false)
  const [pending, setPending] = useState(null)   // a searched spot, not yet a place
  const [tripMenu, setTripMenu] = useState(false)
  const [toast, setToast] = useState('')
  const dropped = useRef(null)
  // Pressing search: every match near you as a pin, the way Google Maps does.
  const resultPins = useRef([])
  const [results, setResults] = useState(null)   // null, or the list on the map
  const account = useStore((s) => s.account)
  // Only trips this rider may change: the host's and the captain's (Punit, 2026-09-21).
  const allTrips = useStore(selectTrips)
  const trips = allTrips.filter((t) => canEditTrip(t, account?.id))

  const places = useStore(selectPlaces)
  const matches = useStore((s) => selectPlaceSearch(s, q))
  // A Google place someone already put on Trekov is listed once, as Trekov's.
  const onTrekov = new Set(matches.map((p) => p.id))

  useEffect(() => {
    let alive = true
    let offZoom = () => {}
    // The India view is as far out as the map goes: further, whole continents
    // shrink onto the screen (Punit, 2026-09-11).
    createMap(host.current, { center: INDIA, zoom: 4, minZoom: 4, zoomControl: true, mapType }).then((d) => {
      if (!alive) { d.destroy(); return }
      drv.current = d
      offZoom = d.onZoomEnd(setZoom)
      setEngine(d.kind)
    })
    return () => {
      alive = false
      // Tearing down a map Google refused must not take the whole app with it.
      try { offZoom(); drv.current?.destroy() } catch (e) { console.info("Trekov: map teardown —", e?.message) }
      drv.current = null; markers.current = new Map(); setEngine(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsRefused])

  useEffect(() => { rememberMapType(mapType); drv.current?.setMapType(mapType) }, [mapType, engine])
  useEffect(() => { drv.current?.setTraffic(traffic) }, [traffic, engine])

  // Markers follow the data and the settled zoom level, updated in place: a
  // marker that is still there keeps its element and only moves or changes
  // its content. Tearing down and re-making every marker (hundreds of DOM
  // overlays) at each zoom step made pinching stutter and flicker (2026-09-11).
  useEffect(() => {
    const d = drv.current
    if (!d) return
    const next = new Map()
    for (const node of cluster(places, zoom)) {
      const single = node.places.length === 1
      const look = single ? (zoom >= SMALL_PIN_ZOOM ? 'sm' : 'pin') : node.places.length >= 25 ? 'lg' : 'cl'
      const key = `${node.key}:${look}`
      const html = markerHtml(node, zoom)
      const onClick = () => (single
        ? onOpenPlace(node.places[0].id)
        : d.flyTo([node.lat, node.lng], Math.min(zoom + 2, CLOSE_ZOOM)))
      const kept = markers.current.get(key)
      if (kept) {
        markers.current.delete(key)
        kept.marker.setLatLng([node.lat, node.lng])
        if (kept.html !== html) { kept.marker.setHtml(html); kept.html = html }
        kept.handler.fn = onClick
        next.set(key, kept)
      } else {
        const handler = { fn: onClick }
        // Anchors sit on the pin's tip (see .tk-pin in index.css), so the point
        // is the exact location rather than 12px below it.
        const marker = d.htmlMarker([node.lat, node.lng], html, { ...SHAPES[look], onClick: () => handler.fn() })
        next.set(key, { marker, html, handler })
      }
    }
    markers.current.forEach((m) => m.marker.remove())
    markers.current = next
  }, [places, zoom, onOpenPlace, engine])

  // Debounced: typing fires a lot of lookups and geocoding is billed per call.
  useEffect(() => {
    const term = q.trim()
    if (!term) endSearchSession()
    if (term.length < 2) { setWorld([]); setSearching(false); return }
    if (!askedHere.current) {
      askedHere.current = true
      getFix({ timeout: 8000 }).then((f) => { here.current = { lat: f.lat, lng: f.lng } }).catch(() => {})
    }
    setSearching(true)
    let live = true
    const timer = setTimeout(() => {
      // Zoomed in, the map is where you are looking; zoomed out to the country,
      // where you are matters more.
      searchAnywhere(term, { near: nearNow() })
        .then((hits) => { if (live) { setWorld(hits); setSearching(false) } })
    }, 250)
    return () => { live = false; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const nearNow = () => {
    const centre = drv.current?.getCenter?.()
    const lookingAt = centre && zoom >= 9 ? { lat: centre[0], lng: centre[1] } : null
    return lookingAt ?? here.current ?? (centre ? { lat: centre[0], lng: centre[1] } : undefined)
  }

  const clearResults = () => {
    resultPins.current.forEach((m) => m.remove())
    resultPins.current = []
    setResults(null)
  }

  async function searchEverything(term) {
    if (!term.trim()) return
    setSearching(true)
    const near = nearNow()
    const hits = await searchAll(term, { near })
    setSearching(false)
    if (!hits.length) { flash(`Nothing found for “${term}”`); return }
    clearResults()
    setPending(null)
    dropped.current?.remove()
    dropped.current = null
    const from = here.current ?? near
    const list = hits.map((h) => ({ ...h, distance: from ? distance(from, h) : null }))
      .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))
    resultPins.current = list.map((h) => drv.current?.htmlMarker(
      [h.lat, h.lng],
      `<div class="tk-drop"><i></i><u>${esc(h.name)}</u></div>`,
      { size: [30, 40], anchor: [15, 36], zIndex: 400, onClick: () => { clearResults(); goToWorld(h) } },
    )).filter(Boolean)
    drv.current?.fitBounds?.(list.map((h) => [h.lat, h.lng]))
    setResults({ term, list })
    setQ('')
    setWorld([])
    // The keyboard goes, so the map and its pins can be seen.
    document.activeElement?.blur?.()
  }

  function goTo(place) {
    setQ('')
    setWorld([])
    setPending(null)
    dropped.current?.remove()
    dropped.current = null
    drv.current?.flyTo([place.lat, place.lng], 9)
    onOpenPlace(place.id)
  }

  /**
   * Adopt a searched spot into Trekov, and announce it.
   *
   * A spot someone went looking for on the map is a genuine addition to the
   * atlas, so it is worth telling other users about. Nearby results are
   * adopted through the same helper without the announcement.
   */
  function adopt(hit) {
    const existing = getPlace(`pl_g_${hit.id}`)
    const id = adoptHit(hit)
    if (!existing) onNewPlace?.(getPlace(id))
    return id
  }

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 1800) }

  function savePending() {
    const id = adopt(pending)
    flash(toggleSavePlace(id) ? `${pending.name} saved to To Visit` : 'Removed from To Visit')
  }

  function addPendingToTrip(tripId) {
    const id = adopt(pending)
    addStop(tripId, id)
    setTripMenu(false)
    flash(`${pending.name} added to ${trips.find((t) => t.id === tripId).title}`)
  }

  function addPendingToNewTrip() {
    const id = adopt(pending)
    createTrip({ title: `${pending.name} trip`, stops: [{ placeId: id, note: '' }] })
    setTripMenu(false)
    flash('New trip started')
  }

  /** Fly to a geocoded result and mark it. It is not a Trekov place yet. */
  async function goToWorld(picked) {
    let hit
    try {
      hit = await resolveHit(picked)
    } catch {
      flash("Couldn't open that place — try again")
      return
    }
    setQ('')
    setWorld([])
    setPending(hit)
    setTripMenu(false)
    dropped.current?.remove()
    dropped.current = drv.current?.htmlMarker(
      [hit.lat, hit.lng],
      `<div class="tk-drop"><i></i><u>${esc(hit.name)}</u></div>`,
      { size: [30, 40], anchor: [15, 36], zIndex: 400 },
    )
    drv.current?.flyTo([hit.lat, hit.lng], 13)
  }

  const types = drv.current?.mapTypes() ?? []
  const shownWorld = world.filter((h) => !onTrekov.has(`pl_g_${h.id}`))

  return (
    <div className="relative h-full">
      <div ref={host} className="absolute inset-0 bg-raised" />
      {/* Solid enough behind the wordmark that map labels do not show through
          it: on an iPhone the lockup sits below the Dynamic Island, where the
          old 80%-and-fading scrim let "Islamabad" run into "trekov" (simulator,
          2026-09-13). Even 95%-fading-to-75% still showed the label, so the
          band behind the wordmark is solid and only the part behind the search
          bar fades. */}
      <div className="absolute inset-x-0 top-0 z-[400] pointer-events-none">
        <div className="h-[calc(3.25rem+max(.75rem,env(safe-area-inset-top)))] bg-ink" />
        <div className="h-16 bg-gradient-to-b from-ink to-transparent" />
      </div>

      <div className="absolute inset-x-0 top-0 z-[500] p-3 pt-[max(.75rem,env(safe-area-inset-top))]">
        {/* The dark lockup rides over the map on a scrim, so the map screen
            carries the brand without spending a whole header on it. */}
        <div className="flex items-center justify-between pb-2.5 pt-0.5 px-1 [text-shadow:0_1px_6px_rgba(0,0,0,.9)]">
          <Wordmark size={19} />
          <span className="text-[11px] text-mist">Ride together, live</span>
        </div>

        <div className="flex items-center gap-2 bg-ink/90 backdrop-blur-xl border border-line rounded-full px-4 py-2.5 shadow-lg">
          <SearchIcon size={18} className="text-mist shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a place or region…"
                 enterKeyHint="search" type="search"
                 onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); searchEverything(q) } }}
                 className="bg-transparent flex-1 text-sm outline-none placeholder:text-mist min-w-0" />
          {/* Negative margin: a 40px target without making the bar taller. */}
          {q && <button onClick={() => setQ('')} className="text-xs text-mist shrink-0 min-h-10 px-2 -my-2.5 -mr-2">Clear</button>}
        </div>

        {q && (
          <ul className="mt-2 max-h-[min(18rem,calc(100dvh-14rem))] overflow-y-auto rounded-2xl border border-line bg-surface shadow-xl divide-y divide-line">
            <li>
              <button onClick={() => searchEverything(q)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-raised">
                <SearchIcon size={16} className="text-brand shrink-0" />
                <span className="text-sm truncate">Show all results for “{q.trim()}” near you</span>
              </button>
            </li>
            {matches.length === 0 && shownWorld.length === 0 && (
              <li className="px-4 py-4 text-sm text-mist">
                {searching ? 'Searching…' : `Nothing found for “${q}”.`}
              </li>
            )}
            {matches.length > 0 && (
              <li className="px-4 pt-2.5 pb-1 text-[10px] uppercase tracking-[0.14em] text-mist">On Trekov</li>
            )}
            {matches.map((p) => (
              <li key={p.id}>
                <button onClick={() => goTo(p)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-raised">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate">{p.name}</span>
                    <span className="block text-xs text-mist truncate">{p.region} · {p.country}</span>
                  </span>
                  <span className="text-xs text-mist shrink-0">{p.postCount} photos</span>
                </button>
              </li>
            ))}

            {shownWorld.length > 0 && (
              <li className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-[0.14em] text-mist">
                {matches.length ? 'On Google Maps' : 'Places'}
              </li>
            )}
            {shownWorld.map((hit) => (
              <li key={hit.id}>
                <button onClick={() => goToWorld(hit)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-raised">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate">{hit.name}</span>
                    <span className="block text-xs text-mist truncate">{hit.detail}</span>
                  </span>
                  <span className="text-[11px] text-mist shrink-0 tabular-nums">
                    {hit.distance != null ? formatDistance(hit.distance) : 'Go'}
                  </span>
                </button>
              </li>
            ))}
            {shownWorld.length > 0 && (
              <li className="px-4 pb-3 pt-1 text-[11px] text-mist leading-relaxed">
                Not on Trekov yet — take a photo there to put it on the map.
              </li>
            )}
          </ul>
        )}

        {/* Map style and live traffic — Google only; the offline MapLibre map has neither. */}
        {!q && engine === 'google' && (
          <div className="mt-2 flex gap-1.5 overflow-x-auto no-bar">
            {types.map((t) => (
              <button key={t.id} onClick={() => setMapType(t.id)} aria-pressed={mapType === t.id}
                      className={`shrink-0 min-h-10 rounded-full px-3 py-1.5 text-xs border backdrop-blur-xl transition
                                  ${mapType === t.id ? 'bg-brand text-ink border-brand font-semibold' : 'bg-ink/80 border-line text-mist hover:text-white'}`}>
                {t.label}
              </button>
            ))}
            <button onClick={() => setTraffic((v) => !v)} aria-pressed={traffic}
                    className={`shrink-0 ml-auto min-h-10 rounded-full px-3 py-1.5 text-xs border backdrop-blur-xl transition
                                ${traffic ? 'bg-brand text-ink border-brand font-semibold' : 'bg-ink/80 border-line text-mist hover:text-white'}`}>
              Traffic
            </button>
          </div>
        )}
      </div>

      {/* Search results on the map, nearest first. */}
      {results && !pending && (
        <div className="absolute inset-x-3 bottom-4 z-[600] rounded-2xl border border-line bg-ink/95
                        backdrop-blur-xl shadow-xl rise max-h-[40%] flex flex-col">
          <div className="flex items-center gap-2 px-3 pt-3 pb-2">
            <p className="min-w-0 flex-1 text-sm font-semibold truncate">
              {results.list.length} results for “{results.term}”
            </p>
            <button onClick={clearResults} className="grid place-items-center size-10 -m-2 shrink-0 text-mist hover:text-white"
                    aria-label="Clear results">
              <CloseIcon size={16} />
            </button>
          </div>
          <ul className="overflow-y-auto divide-y divide-line">
            {results.list.map((h) => (
              <li key={h.id} className="flex items-center gap-2 px-3 py-2">
                <button onClick={() => { clearResults(); goToWorld(h) }} className="min-w-0 flex-1 text-left">
                  <span className="block text-sm font-medium truncate">{h.name}</span>
                  <span className="block text-xs text-mist truncate">
                    {h.distance != null && `${formatDistance(h.distance)} · `}{h.detail}
                  </span>
                </button>
                {onNavigate && (
                  <button onClick={() => { const id = adopt(h); clearResults(); onNavigate(id) }}
                          aria-label={`Navigate to ${h.name}`}
                          className="grid place-items-center size-10 shrink-0 rounded-full bg-brand text-ink">
                    <NavIcon size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* A searched spot: save it or put it in a trip without leaving the map. */}
      {pending && (
        <div className="absolute inset-x-3 bottom-4 z-[600] rounded-2xl border border-line bg-ink/95
                        backdrop-blur-xl shadow-xl p-3 rise">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{pending.name}</p>
              <p className="text-xs text-mist truncate">{pending.detail}</p>
            </div>
            <button onClick={() => { setPending(null); setTripMenu(false); dropped.current?.remove(); dropped.current = null }}
                    className="grid place-items-center size-10 -m-2 shrink-0 text-mist hover:text-white" aria-label="Dismiss">
              <CloseIcon size={16} />
            </button>
          </div>

          <div className="flex gap-2 mt-2.5">
            <button onClick={savePending}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-full border border-line
                               py-2 text-xs font-semibold hover:border-brand hover:text-brand">
              <SaveIcon size={15} /> Save place
            </button>
            <button onClick={() => setTripMenu((v) => !v)} aria-expanded={tripMenu}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-full border border-line
                               py-2 text-xs font-semibold hover:border-brand hover:text-brand">
              <PlusIcon size={15} /> Add to trip
            </button>
            <button onClick={() => { const id = adopt(pending); setPending(null); onOpenPlace(id) }}
                    className="flex-1 rounded-full border border-line py-2 text-xs font-semibold hover:border-brand hover:text-brand">
              Details
            </button>
          </div>
          {/* Straight into navigation: a search for somewhere is usually to go
              there (Punit, 2026-09-15: "it was not showing it to navigate directly"). */}
          {onNavigate && (
            <button onClick={() => {
                      const id = adopt(pending)
                      setPending(null); setTripMenu(false); dropped.current?.remove(); dropped.current = null
                      onNavigate(id)
                    }}
                    className="mt-2 w-full flex items-center justify-center gap-2 rounded-full bg-brand text-ink py-2.5 text-sm font-semibold">
              <NavIcon size={16} /> Navigate
            </button>
          )}

          {tripMenu && (
            <ul className="mt-2 rounded-xl border border-line bg-surface divide-y divide-line overflow-hidden max-h-40 overflow-y-auto">
              {trips.map((t) => (
                <li key={t.id}>
                  <button onClick={() => addPendingToTrip(t.id)}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-raised">
                    {t.title} <span className="text-mist">· {t.stops.length} stops</span>
                  </button>
                </li>
              ))}
              <li>
                <button onClick={addPendingToNewTrip}
                        className="w-full text-left px-3 py-2 text-xs text-brand font-semibold hover:bg-raised">
                  + Start a new trip
                </button>
              </li>
            </ul>
          )}
        </div>
      )}

      {/* Live group trips are the heart of Trekov, so one is always a tap away. */}
      {!q && !pending && !results && (
        <GroupTripCard
          trip={allTrips.find((t) => t.kind === 'group' && t.stops.length) ?? allTrips.find((t) => t.kind === 'group')}
          onGoLive={onGoLive} onOpenTrip={onOpenTrip} onStartGroup={onStartGroup} />
      )}

      {toast && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-40 z-[700] rounded-full bg-white text-ink
                        text-sm font-medium px-4 py-2 shadow-lg pointer-events-none">
          {toast}
        </div>
      )}

      {zoom < 6 && !q && !pending && !results && (
        <p className="absolute inset-x-0 bottom-36 z-[500] text-center text-xs text-mist pointer-events-none [text-shadow:0_1px_6px_rgba(0,0,0,.9)]">
          Zoom in to split clusters into places
        </p>
      )}
    </div>
  )
}

// Closing the card is remembered on this device: the promo stays closed for
// good; a particular trip's card stays closed for that trip only.
const HIDE_KEY = 'trekov.groupCardHidden'
const hiddenCards = () => { try { return JSON.parse(localStorage.getItem(HIDE_KEY) || '[]') } catch { return [] } }

function GroupTripCard({ trip, onGoLive, onOpenTrip, onStartGroup }) {
  const cardId = trip ? trip.id : 'promo'
  const [hidden, setHidden] = useState(() => hiddenCards().includes(cardId))
  useEffect(() => { setHidden(hiddenCards().includes(cardId)) }, [cardId])
  if (hidden) return null
  const close = () => {
    try { localStorage.setItem(HIDE_KEY, JSON.stringify([...new Set([...hiddenCards(), cardId])])) } catch { /* private mode */ }
    setHidden(true)
  }
  const closeBtn = (
    <button onClick={close} aria-label="Close" className="absolute top-0 right-0 grid place-items-center size-10 text-mist hover:text-white">
      <CloseIcon size={16} />
    </button>
  )
  // On a landscape phone the card would cover most of the map, so it steps aside.
  const shell = 'absolute inset-x-3 bottom-4 z-[600] rounded-2xl border border-brand/40 bg-ink/95 backdrop-blur-xl shadow-xl p-3.5 rise [@media(max-height:480px)]:hidden'
  if (!trip) {
    return (
      <div className={shell}>
        {closeBtn}
        <div className="flex items-start gap-3 pr-6">
          <span className="grid place-items-center size-10 rounded-xl bg-brand/15 text-brand shrink-0"><RouteIcon size={20} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Ride together, live</p>
            <p className="text-xs text-mist leading-snug mt-0.5">
              Start a group trip: everyone on one map, live locations and push-to-talk voice on the road.
            </p>
          </div>
        </div>
        <button onClick={onStartGroup} className="mt-3 w-full rounded-full bg-brand text-ink py-2.5 text-sm font-semibold">
          Start a group trip
        </button>
      </div>
    )
  }
  const riders = trip.members?.length ?? 0
  return (
    <div className={shell}>
      {closeBtn}
      <div className="flex items-center gap-3 pr-6">
        <span className="relative grid place-items-center size-10 rounded-xl bg-brand/15 text-brand shrink-0">
          <RouteIcon size={20} />
          <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-brand animate-pulse" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand">Group trip</p>
          <p className="text-sm font-semibold truncate">{trip.title}</p>
          <p className="text-xs text-mist">
            {trip.stops.length} stop{trip.stops.length === 1 ? '' : 's'}
            {riders > 0 ? ` · ${riders} rider${riders === 1 ? '' : 's'}` : ' · invite your crew'}
          </p>
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={() => onOpenTrip?.(trip.id)}
                className="flex-1 rounded-full border border-line py-2 text-xs font-semibold hover:border-brand hover:text-brand">
          Open trip
        </button>
        {trip.stops.length > 0 ? (
          <button onClick={() => onGoLive?.(trip)}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-full bg-brand text-ink py-2 text-xs font-semibold">
            <NavIcon size={14} filled /> Go live
          </button>
        ) : (
          <button onClick={() => onOpenTrip?.(trip.id)}
                  className="flex-1 rounded-full bg-brand/20 text-brand py-2 text-xs font-semibold">
            Add a stop to go live
          </button>
        )}
      </div>
    </div>
  )
}
