// Which way the phone is pointing, in degrees clockwise from north.
//
// Navigation turns the map to face your direction the way Google Maps does.
// While you are moving, the road tells us which way that is. Standing still —
// at a junction, at a viewpoint, getting your bearings — GPS has no direction
// at all, and that is what the compass is for (Punit, 2026-09-13).
//
// Browsers report orientation two ways. Android's is `deviceorientationabsolute`,
// whose `alpha` is anticlockwise from north. iOS only gives a north-referenced
// value as `webkitCompassHeading`, on the ordinary event, and only after the
// person has allowed it from a tap — see requestCompass().

let permission = null   // null: not asked · true · false

const screenAngle = () => {
  try { return screen.orientation?.angle ?? window.orientation ?? 0 } catch { return 0 }
}

/**
 * Ask for motion access where the platform demands it (iOS 13+). Must run
 * inside a tap or click handler; anywhere else iOS refuses without asking.
 */
export async function requestCompass() {
  if (permission !== null) return permission
  const ask = window.DeviceOrientationEvent?.requestPermission
  if (typeof ask !== 'function') return (permission = true)   // Android, desktop: nothing to ask
  try { permission = (await ask.call(window.DeviceOrientationEvent)) === 'granted' } catch { permission = false }
  return permission
}

/**
 * Calls onHeading(degrees) as the phone turns, smoothed, and at most ten times
 * a second. Returns a function that stops it. Nothing is called at all on a
 * device without a compass — the caller keeps using the direction of travel.
 */
export function watchCompass(onHeading) {
  // Smooth on the unit circle, not the number: averaging 359° and 1° must give
  // 0°, not 180°.
  let x = null, y = null, lastSent = null, lastAt = 0

  const take = (deg) => {
    if (!Number.isFinite(deg)) return
    const r = (deg * Math.PI) / 180
    if (x === null) { x = Math.cos(r); y = Math.sin(r) }
    else { x += (Math.cos(r) - x) * 0.25; y += (Math.sin(r) - y) * 0.25 }
    const smooth = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
    const now = performance.now()
    const moved = lastSent === null ? 360 : Math.abs(((smooth - lastSent + 540) % 360) - 180)
    if (moved < 1 || now - lastAt < 100) return
    lastSent = smooth; lastAt = now
    onHeading(smooth)
  }

  // The screen's own rotation: in landscape the top of the display is not the
  // top of the phone.
  const onAbsolute = (e) => {
    if (e.alpha == null) return
    take((360 - e.alpha + screenAngle()) % 360)
  }
  const onIos = (e) => {
    if (typeof e.webkitCompassHeading !== 'number') return
    take((e.webkitCompassHeading + screenAngle()) % 360)
  }

  const hasAbsolute = 'ondeviceorientationabsolute' in window
  if (hasAbsolute) window.addEventListener('deviceorientationabsolute', onAbsolute)
  else window.addEventListener('deviceorientation', onIos)
  return () => {
    window.removeEventListener('deviceorientationabsolute', onAbsolute)
    window.removeEventListener('deviceorientation', onIos)
  }
}
