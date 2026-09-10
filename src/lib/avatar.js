// The drawn avatar everyone starts with. No imports on purpose: the store,
// the seed and the profile editor all need it.

/**
 * The picture someone has when they have no picture.
 *
 * Drawn rather than fetched: a placeholder that needs the network is the wrong
 * thing to fall back to, and this one is a few hundred bytes that renders
 * offline and everywhere an <img> already points at the avatar field. Removing
 * a photo lands here, so no code has to cope with an empty src.
 */
export function defaultAvatar(seed = '') {
  const first = seed.trim()[0] ?? ''
  // Only letters and digits reach the markup, so the initial can never carry
  // characters that would break the SVG it is embedded in.
  const letter = /[a-z0-9]/i.test(first) ? first.toUpperCase() : '?'
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const hue = h % 360
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">` +
    `<rect width="96" height="96" rx="48" fill="hsl(${hue} 38% 20%)"/>` +
    `<text x="48" y="64" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif"` +
    ` font-size="44" font-weight="600" fill="hsl(${hue} 65% 70%)">${letter}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
