// Leaflet + Esri imagery. The offline engine: tiles come from the service
// worker's cache when the network is gone.
import L from 'leaflet'

const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const LABELS  = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'

export function createLeafletMap(el, { center, zoom, labels = true, zoomControl = false, nativeZoomCap = null }) {
  const map = L.map(el, { zoomControl: false, attributionControl: true }).setView(center, zoom)
  // Offline, the deepest tiles on the phone are whatever was downloaded —
  // zoom 14 or 15 — while navigation sits at 17. maxNativeZoom has Leaflet
  // stretch the deepest saved tile rather than request one that is not there,
  // so the map goes soft at street level instead of going blank.
  const native = nativeZoomCap ? { maxNativeZoom: nativeZoomCap } : {}
  L.tileLayer(IMAGERY, { attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics', maxZoom: 18, ...native }).addTo(map)
  if (labels) L.tileLayer(LABELS, { maxZoom: 18, pane: 'shadowPane', ...native }).addTo(map)
  if (zoomControl) L.control.zoom({ position: 'bottomright' }).addTo(map)
  // The container has no final size until the pane lays out; but a map that
  // was destroyed before this fires must not be touched.
  let live = true
  setTimeout(() => { if (live) map.invalidateSize() }, 0)

  const off = (ev, fn) => () => map.off(ev, fn)

  return {
    kind: 'leaflet',
    raw: map,
    destroy: () => { live = false; map.remove() },
    invalidateSize: () => map.invalidateSize(),
    setView: (ll, z, { animate = true } = {}) => map.setView(ll, z ?? map.getZoom(), { animate, duration: .5 }),
    flyTo: (ll, z) => map.flyTo(ll, z, { duration: .7 }),
    getZoom: () => map.getZoom(),
    getCenter: () => { const c = map.getCenter(); return [c.lat, c.lng] },
    fitBounds: (lls, pad = 48) => map.fitBounds(L.latLngBounds(lls), { padding: [pad, pad] }),
    size: () => { const s = map.getSize(); return { x: s.x, y: s.y } },
    offsetLatLng: (ll, dx, dy) => {
      const z = map.getZoom()
      const p = map.project(ll, z).add(L.point(dx, dy))
      const r = map.unproject(p, z)
      return [r.lat, r.lng]
    },
    onClick: (fn) => { const h = (e) => fn([e.latlng.lat, e.latlng.lng]); map.on('click', h); return off('click', h) },
    onDragStart: (fn) => { map.on('dragstart', fn); return off('dragstart', fn) },
    onZoomEnd: (fn) => { const h = () => fn(map.getZoom()); map.on('zoomend', h); return off('zoomend', h) },

    htmlMarker: (ll, html, { size = [44, 44], anchor, zIndex = 0, className = 'tk-marker', onClick } = {}) => {
      const icon = (h) => L.divIcon({ className, html: h, iconSize: size, iconAnchor: anchor ?? [size[0] / 2, size[1] / 2] })
      const m = L.marker(ll, { icon: icon(html), zIndexOffset: zIndex, interactive: !!onClick }).addTo(map)
      if (onClick) m.on('click', onClick)
      return {
        setLatLng: (p) => m.setLatLng(p),
        setHtml: (h) => m.setIcon(icon(h)),
        remove: () => m.remove(),
      }
    },
    polyline: (lls, { color = '#00C08B', weight = 5, opacity = .9, back = false } = {}) => {
      const pl = L.polyline(lls, { color, weight, opacity, lineCap: 'round', interactive: false }).addTo(map)
      if (back) pl.bringToBack()
      return { remove: () => pl.remove(), setLatLngs: (p) => pl.setLatLngs(p), bounds: () => pl.getLatLngs().map((p) => [p.lat, p.lng]) }
    },
    // Google-only features are no-ops here; Leaflet has no tilt or rotation.
    supports3D: () => false,
    isVector: () => false,
    setTilt: () => {},
    setHeading: () => {},
    getTilt: () => 0,
    setTraffic: () => false,
    setMapType: () => {},
    mapTypes: () => [],
  }
}
