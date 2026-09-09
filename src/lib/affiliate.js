// Booking links that pay a commission.
//
// This is gap-fill revenue, and the order matters: a hotel paying to be a
// Trekov partner keeps the top of the Stays list, and a commission link only
// appears where there is no partner to displace. Selling a subscription for
// placement and then putting a paid link above it would be selling the same
// slot twice, to two people, with opposite interests.
//
// Nothing here is live until it is configured. MakeMyTrip's affiliate
// programme runs through networks — Admitad, vCommission, Cuelinks — and each
// issues its own id and its own link shape, so the whole URL is a template
// rather than a guess baked into the code. An invented deep link would look
// perfectly plausible and earn nothing.

const ID = import.meta.env.VITE_MMT_AFFILIATE_ID ?? ''

/**
 * The link shape from whichever network approved you, with placeholders.
 *
 * Supported: {id} {q} {lat} {lng} {checkin} {checkout}
 *
 * A tracking link usually wraps the destination, so expect something like
 *   https://<network>/g/<campaign>/?ulp={q}
 * where the MakeMyTrip URL is itself URL-encoded into a parameter. Each
 * placeholder is encoded on substitution, so a wrapped URL survives intact.
 */
const TEMPLATE = import.meta.env.VITE_MMT_LINK_TEMPLATE ?? ''

/** Both halves are needed: an id with no link shape cannot be used. */
export const hasBooking = () => Boolean(ID && TEMPLATE)

const iso = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '')

/**
 * A booking link for a place, carrying the trip's dates when it has them.
 *
 * Returns '' when unconfigured, so callers can render nothing rather than a
 * dead button.
 */
export function bookingUrl({ name, region, lat, lng, checkIn, checkOut } = {}) {
  if (!hasBooking()) return ''
  const values = {
    id: ID,
    q: [name, region].filter(Boolean).join(' '),
    lat: lat == null ? '' : String(lat),
    lng: lng == null ? '' : String(lng),
    checkin: iso(checkIn),
    checkout: iso(checkOut),
  }
  return TEMPLATE.replace(/\{(\w+)\}/g, (whole, key) =>
    (key in values ? encodeURIComponent(values[key]) : whole))
}

/**
 * Disclosure text. Shown wherever a commission link is, because it is a paid
 * link and saying so is both the rule and the decent thing.
 */
export const BOOKING_DISCLOSURE = 'Booking link — Trekov may earn a commission.'
