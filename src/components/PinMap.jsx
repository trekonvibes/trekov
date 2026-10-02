import { useEffect, useRef } from 'react'
import { createMap, useMapsRefused } from '../lib/mapDrivers'

const PIN_HTML = '<div class="tk-pin"><div class="tk-pin-img"></div></div>'

/**
 * A small map you tap to place a single pin, for giving a new place its
 * coordinates. Opens at street level (zoom 16): a new place is pinned where
 * you stand and moved at most a kilometre, which a country-wide view made
 * impossible to do.
 */
export default function PinMap({ lat, lng, onMove, zoom = 16 }) {
  const mapsRefused = useMapsRefused()
  const host = useRef(null)

  useEffect(() => {
    let alive = true
    let off = () => {}
    let drv = null
    createMap(host.current, { center: [lat, lng], zoom, zoomControl: true, mapType: 'hybrid' }).then((d) => {
      if (!alive) { d.destroy(); return }
      drv = d
      const pin = d.htmlMarker([lat, lng], PIN_HTML, { size: [44, 58], anchor: [22, 41] })
      off = d.onClick(([a, b]) => {
        pin.setLatLng([a, b])
        onMove(+a.toFixed(5), +b.toFixed(5))
      })
    })
    return () => { alive = false; off(); drv?.destroy() }
    // Created once; later lat/lng changes come from this map itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsRefused])

  // `relative`: createMap puts the map in an absolutely positioned child, which
  // without it filled the whole Post / Business screen and hid everything on it
  // (Punit's screenshot, 2026-09-12).
  return <div ref={host} className="relative h-52 rounded-2xl overflow-hidden border border-line" />
}
