import { useEffect, useRef } from 'react'
import { createMap, useMapsRefused } from '../lib/mapDrivers'

const PIN_HTML = '<div class="tk-pin"><div class="tk-pin-img"></div></div>'

/** A small map you tap to place a single pin, for giving a new place its coordinates. */
export default function PinMap({ lat, lng, onMove }) {
  const mapsRefused = useMapsRefused()
  const host = useRef(null)

  useEffect(() => {
    let alive = true
    let off = () => {}
    let drv = null
    createMap(host.current, { center: [lat, lng], zoom: 5, zoomControl: true, mapType: 'hybrid' }).then((d) => {
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

  return <div ref={host} className="h-52 rounded-2xl overflow-hidden border border-line" />
}
