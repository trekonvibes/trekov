// Values from other people — shared links, posts, profiles — that end up
// inside HTML strings built for map markers (audit before launch, 2026-09-14).

/** Text for HTML content or a quoted attribute. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/**
 * A URL safe inside style="background-image:url('…')". HTML entities are
 * decoded before CSS reads the attribute, so escaping a quote as &#39; does not
 * stop it closing the url(); percent-encoding does. Only web, blob and inline
 * image URLs are allowed; anything else gives ''.
 */
export function cssUrl(u) {
  const s = String(u ?? '')
  if (!/^(https:\/\/|blob:|data:image\/(jpeg|png|webp|gif);base64,)/i.test(s)) return ''
  return s.replace(/['"()\\\s<>]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
}

/** A link target a user may supply: http(s) only. */
export const safeHref = (u) => (/^https?:\/\//i.test(String(u ?? '')) ? String(u) : undefined)
