// Google Maps JavaScript API, exposed through the same shape as the MapLibre
// driver so screens do not care which engine they got.
//
// Custom HTML markers use OverlayView rather than AdvancedMarkerElement: the
// latter needs a Map ID and does not accept an arbitrary rotated <div>.

function htmlOverlayClass(gm) {
  return class HtmlOverlay extends gm.OverlayView {
    constructor(latLng, html, { size, anchor, zIndex, className, onClick }) {
      super()
      this.latLng = latLng
      this.el = document.createElement('div')
      this.el.className = className
      this.el.style.cssText = `position:absolute;width:${size[0]}px;height:${size[1]}px;z-index:${zIndex};` +
                              `cursor:${onClick ? 'pointer' : 'default'}`
      this.el.innerHTML = html
      this.anchor = anchor
      if (onClick) {
        this.el.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
        // Stop the map from treating a tap on the marker as a drag start.
        for (const ev of ['mousedown', 'touchstart', 'pointerdown']) this.el.addEventListener(ev, (e) => e.stopPropagation())
      }
    }
    onAdd() { this.getPanes().overlayMouseTarget.appendChild(this.el) }
    onRemove() { this.el.remove() }
    draw() {
      const p = this.getProjection()?.fromLatLngToDivPixel(this.latLng)
      if (!p) return
      this.el.style.left = `${p.x - this.anchor[0]}px`
      this.el.style.top = `${p.y - this.anchor[1]}px`
    }
    move(latLng) { this.latLng = latLng; this.draw() }
  }
}

const TYPES = [
  { id: 'roadmap',   label: 'Map' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'hybrid',    label: 'Hybrid' },
  { id: 'terrain',   label: 'Terrain' },
]

/**
 * A Map ID switches Google to vector rendering, where tilt and heading work
 * everywhere. Without one we get raster tiles, whose 45-degree imagery only
 * exists for some cities — so `supports3D` reports what this map can do
 * rather than promising a tilt that silently no-ops.
 */
const MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID

export function createGoogleMap(gm, el, { center, zoom, mapType = 'hybrid', zoomControl = false }) {
  const map = new gm.Map(el, {
    center: { lat: center[0], lng: center[1] },
    zoom,
    ...(MAP_ID ? { mapId: MAP_ID } : {}),
    mapTypeId: mapType,
    disableDefaultUI: true,
    zoomControl,
    zoomControlOptions: zoomControl ? { position: gm.ControlPosition.RIGHT_BOTTOM } : undefined,
    gestureHandling: 'greedy',
    // The attribution and Google logo are required by the Maps Platform terms
    // and must stay; the keyboard-shortcuts affordance is ours to switch off.
    keyboardShortcuts: false,
    clickableIcons: false,
    backgroundColor: '#0E1413',
  })
  const Overlay = htmlOverlayClass(gm)
  let traffic = null
  const toLL = (ll) => ({ lat: ll[0], lng: ll[1] })
  // A map Google refused (bad key or referrer) can hand back no listener — unsubscribing must never throw.
  const listen = (ev, fn) => { const l = map.addListener(ev, fn); return () => l?.remove?.() }

  return {
    kind: 'google',
    raw: map,
    destroy: () => { traffic?.setMap(null); gm.event.clearInstanceListeners(map); el.innerHTML = '' },
    invalidateSize: () => gm.event.trigger(map, 'resize'),
    setView: (ll, z, { animate = true } = {}) => {
      if (z != null && z !== map.getZoom()) map.setZoom(z)
      animate ? map.panTo(toLL(ll)) : map.setCenter(toLL(ll))
    },
    flyTo: (ll, z) => { map.panTo(toLL(ll)); if (z != null) map.setZoom(z) },
    getZoom: () => map.getZoom(),
    getCenter: () => { const c = map.getCenter(); return [c.lat(), c.lng()] },
    fitBounds: (lls, pad = 48) => {
      const b = new gm.LatLngBounds()
      lls.forEach((p) => b.extend(toLL(p)))
      map.fitBounds(b, pad)
    },
    size: () => ({ x: el.clientWidth, y: el.clientHeight }),
    offsetLatLng: (ll, dx, dy) => {
      const proj = map.getProjection()
      if (!proj) return ll
      const s = 2 ** map.getZoom()
      const p = proj.fromLatLngToPoint(toLL(ll))
      const r = proj.fromPointToLatLng(new gm.Point(p.x + dx / s, p.y + dy / s))
      return [r.lat(), r.lng()]
    },
    onClick: (fn) => listen('click', (e) => fn([e.latLng.lat(), e.latLng.lng()])),
    onDragStart: (fn) => listen('dragstart', fn),
    onZoomEnd: (fn) => listen('zoom_changed', () => fn(map.getZoom())),

    htmlMarker: (ll, html, { size = [44, 44], anchor, zIndex = 0, className = 'tk-marker', onClick } = {}) => {
      const o = new Overlay(toLL(ll), html, { size, anchor: anchor ?? [size[0] / 2, size[1] / 2], zIndex, className, onClick })
      o.setMap(map)
      return {
        setLatLng: (p) => o.move(toLL(p)),
        setHtml: (h) => { o.el.innerHTML = h },
        remove: () => o.setMap(null),
      }
    },
    polyline: (lls, { color = '#00C08B', weight = 5, opacity = .9, back = false } = {}) => {
      const pl = new gm.Polyline({
        path: lls.map(toLL), strokeColor: color, strokeWeight: weight, strokeOpacity: opacity,
        clickable: false, zIndex: back ? 1 : 2, map,
      })
      return {
        remove: () => pl.setMap(null),
        setLatLngs: (p) => pl.setPath(p.map(toLL)),
        bounds: () => pl.getPath().getArray().map((p) => [p.lat(), p.lng()]),
      }
    },
    // Tilt and heading only *render* on vector maps, which need a Map ID.
    // Without one the API happily accepts setTilt(45) and getTilt() reads back
    // 45, but the raster tiles stay flat except in the few cities with 45°
    // aerial imagery — so gating on the map type showed a button that did
    // nothing almost everywhere.
    supports3D: () => Boolean(MAP_ID),
    isVector: () => Boolean(MAP_ID),
    setTilt: (deg) => { try { map.setTilt(deg) } catch {} },
    setHeading: (deg) => { try { map.setHeading(deg) } catch {} },
    getTilt: () => map.getTilt?.() ?? 0,
    setTraffic: (on) => {
      if (on && !traffic) traffic = new gm.TrafficLayer()
      traffic?.setMap(on ? map : null)
      return on
    },
    setMapType: (t) => map.setMapTypeId(t),
    mapTypes: () => TYPES,
  }
}
