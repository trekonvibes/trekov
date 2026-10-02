/**
 * Vehicle artwork as SVG strings — top-down, shaded to read as solid objects.
 *
 * Top-down rather than 3/4 isometric because the same artwork is the rotating
 * map marker, and an isometric view looks wrong the moment it turns.
 *
 * Strings, not React: MapLibre's Marker element and the Google OverlayView both take
 * HTML, and rendering components through react-dom/server for two icons
 * pulled 77KB into the client bundle.
 *
 * Gradient ids are suffixed per instance so several copies can coexist.
 */

import hatchbackPng from '../assets/vehicles/hatchback.webp'
import compactPng from '../assets/vehicles/compact.webp'
import sedanPng from '../assets/vehicles/sedan.webp'
import suvPng from '../assets/vehicles/suv.webp'
import offroadPng from '../assets/vehicles/offroad.webp'
import minivanPng from '../assets/vehicles/minivan.webp'
import pickupPng from '../assets/vehicles/pickup.webp'
import sportscarPng from '../assets/vehicles/sportscar.webp'
import classicPng from '../assets/vehicles/classic.webp'
import roadsterPng from '../assets/vehicles/roadster.webp'
import cruiserPng from '../assets/vehicles/cruiser.webp'
import trailPng from '../assets/vehicles/trail.webp'
import tourerPng from '../assets/vehicles/tourer.webp'
import sportPng from '../assets/vehicles/sport.webp'
import hyperPng from '../assets/vehicles/hyper.webp'

// Every vehicle you can drive, all real 3D models rendered in Blender
// (scripts/vehicles/). Punit supplied them (2026-09-14): the Generic Passenger
// Car Pack and downloaded motorcycle models; normalize.py lines
// each one up and fixups.py repairs its materials. Each keeps its own paint —
// "colours changing not needed". Punit confirmed no credits are needed for these
// models (2026-09-14). Names are generic, not makes, and tanks and
// fairings are painted without logos. The 3D map images come from sprites3d.py.
//
// `car` and `bike` are the old drawn vehicles. They are not offered any more,
// but a rider on an older version may still be driving one, so they still draw.
export const MODELS = [
  { id: 'hatchback', base: 'car',  label: 'Hatchback',   src: hatchbackPng },
  { id: 'compact',   base: 'car',  label: 'Compact',     src: compactPng },
  { id: 'sedan',     base: 'car',  label: 'Sedan',       src: sedanPng },
  { id: 'suv',       base: 'car',  label: 'SUV',         src: suvPng },
  { id: 'offroad',   base: 'car',  label: 'Off-roader',  src: offroadPng },
  { id: 'minivan',   base: 'car',  label: 'MPV',         src: minivanPng },
  { id: 'pickup',    base: 'car',  label: 'Pickup',      src: pickupPng },
  { id: 'sportscar', base: 'car',  label: 'Sports car',  src: sportscarPng },
  { id: 'classic',   base: 'bike', label: 'Classic',     src: classicPng },
  { id: 'roadster',  base: 'bike', label: 'Roadster',    src: roadsterPng },
  { id: 'cruiser',   base: 'bike', label: 'Cruiser',     src: cruiserPng },
  { id: 'trail',     base: 'bike', label: 'Trail',       src: trailPng },
  { id: 'tourer',    base: 'bike', label: 'Sport tourer', src: tourerPng },
  { id: 'sport',     base: 'bike', label: 'Superbike',   src: sportPng },
  { id: 'hyper',     base: 'bike', label: 'Hyperbike',   src: hyperPng },
]
/** What someone who had picked a vehicle that is no longer offered now drives. */
export const pickableVehicle = (id) =>
  MODELS.some((m) => m.id === id) ? id : (RETIRED.find((m) => m.id === id)?.base === 'bike' ? 'classic' : 'hatchback')
// Vehicles from earlier versions, still sent by riders who have not updated.
const RETIRED = [{ id: 'car', base: 'car' }, { id: 'bike', base: 'bike' }, { id: 'commuter', base: 'bike' }, { id: 'scooter', base: 'bike' },
  // The retro coupe went (Punit, 2026-09-16); anyone still on it drives a hatchback.
  { id: 'coupe', base: 'car' }]
const MODEL = Object.fromEntries([...MODELS, ...RETIRED].map((m) => [m.id, m]))

/** 'car' or 'bike' — all routing and the speed streaks need to know. */
export const baseOf = (kind) => MODEL[kind]?.base ?? (kind === 'bike' ? 'bike' : 'car')

export const COLOURS = [
  { id: 'green',  label: 'Trek green', tint: { hi: '#8CF3CE', mid: '#00C08B', lo: '#0A6E51' } },
  { id: 'red',    label: 'Red',        tint: { hi: '#FF9A94', mid: '#E0342E', lo: '#7A1512' } },
  { id: 'blue',   label: 'Blue',       tint: { hi: '#9CCBFF', mid: '#2F7DE1', lo: '#12407D' } },
  { id: 'yellow', label: 'Yellow',     tint: { hi: '#FFF3A6', mid: '#FFC61A', lo: '#8F6A00' } },
  { id: 'orange', label: 'Orange',     tint: { hi: '#FFC896', mid: '#F2711C', lo: '#7E3608' } },
  { id: 'white',  label: 'White',      tint: { hi: '#FFFFFF', mid: '#E4E9E7', lo: '#9AA4A0' } },
  { id: 'silver', label: 'Silver',     tint: { hi: '#F6F8F7', mid: '#B4BDBA', lo: '#5F6864' } },
  { id: 'black',  label: 'Black',      tint: { hi: '#7B8288', mid: '#2A2F34', lo: '#0A0C0E' } },
]
export const colourById = (id) => COLOURS.find((c) => c.id === id) ?? COLOURS[0]

const RIM = '#4C5B56'
const TYRE = '#1B2622'
const TYRE_EDGE = '#3E4E48'
const GLASS_HI = '#D8F7EC'
const GLASS_LO = '#10332B'
const LAMP = '#FFF8DC'
const TAIL = '#FF3B4E'
const CHROME_HI = '#EEF2F0'
const CHROME_LO = '#8E9A96'

const defs = (id, t) => `
  <defs>
    <linearGradient id="body-${id}" x1="12" y1="3" x2="38" y2="46" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${t.hi}"/><stop offset=".42" stop-color="${t.mid}"/><stop offset="1" stop-color="${t.lo}"/>
    </linearGradient>
    <linearGradient id="glass-${id}" x1="16" y1="10" x2="32" y2="22" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${GLASS_HI}"/><stop offset=".55" stop-color="#3F7A6B"/><stop offset="1" stop-color="${GLASS_LO}"/>
    </linearGradient>
    <linearGradient id="shine-${id}" x1="13" y1="4" x2="21" y2="44" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="chrome-${id}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${CHROME_LO}"/><stop offset=".5" stop-color="${CHROME_HI}"/><stop offset="1" stop-color="${CHROME_LO}"/>
    </linearGradient>
    <radialGradient id="shadow-${id}" cx="24" cy="25" r="22" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#000" stop-opacity=".5"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="lamp-${id}" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="${LAMP}"/>
    </radialGradient>
  </defs>`

const wheel = (x, y, w, h) => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w / 2.4}" fill="${TYRE}" stroke="${TYRE_EDGE}" stroke-width=".7"/>
  <rect x="${x + w / 2 - 1}" y="${y + 2.2}" width="2" height="${h - 4.4}" rx="1" fill="${RIM}"/>`

/* A modern hatchback. The body is inset to x 11–37 so the wheels and mirrors
   genuinely protrude, which is what makes the silhouette read from above. */
const CAR = (id, t) => `
  <ellipse cx="24" cy="25" rx="17" ry="22" fill="url(#shadow-${id})"/>
  ${wheel(5.4, 9.5, 7.2, 10)}${wheel(35.4, 9.5, 7.2, 10)}${wheel(5.4, 28, 7.2, 10)}${wheel(35.4, 28, 7.2, 10)}
  <ellipse cx="10" cy="17.8" rx="2.1" ry="1.3" fill="${t.lo}"/><ellipse cx="38" cy="17.8" rx="2.1" ry="1.3" fill="${t.lo}"/>
  <path d="M24 2.5c6 0 10 2.6 11.2 7.6l.9 4.2c.7 3.3 1 6.8 1 10.2s-.3 6.9-1 10.2l-.7 3.4c-.8 3.6-3.6 5.4-11.4 5.4s-10.6-1.8-11.4-5.4l-.7-3.4c-.7-3.3-1-6.8-1-10.2s.3-6.9 1-10.2l.9-4.2C14 5.1 18 2.5 24 2.5Z"
        fill="url(#body-${id})" stroke="#fff" stroke-opacity=".28" stroke-width=".6"/>
  <path d="M16.6 13.6c1.4-4.6 3.8-6.8 7.4-6.8s6 2.2 7.4 6.8" fill="none" stroke="#000" stroke-opacity=".14" stroke-width=".8"/>
  <path d="M20.2 7.4l-1.1 5.8M27.8 7.4l1.1 5.8" stroke="#000" stroke-opacity=".12" stroke-width=".7" stroke-linecap="round"/>
  <path d="M16.4 14.8c1.3-2.4 4-3.6 7.6-3.6s6.3 1.2 7.6 3.6l1.6 3.2c.4.8-.2 1.6-1 1.5a62 62 0 0 0-16.4 0c-.8.1-1.4-.7-1-1.5Z" fill="url(#glass-${id})"/>
  <path d="M18.3 18.6l3.2-6.4h1.9l-3.3 6.4Z" fill="#fff" opacity=".22"/>
  <rect x="12.3" y="19" width="1.7" height="13" rx=".85" fill="${GLASS_LO}" opacity=".9"/>
  <rect x="34" y="19" width="1.7" height="13" rx=".85" fill="${GLASS_LO}" opacity=".9"/>
  <rect x="15.2" y="19.6" width="17.6" height="12.8" rx="3.6" fill="#000" opacity=".08"/>
  <rect x="18" y="21.4" width="12" height="6.2" rx="1.6" fill="${GLASS_LO}" opacity=".6"/>
  <path d="M16.9 33.4c-.5-.7 0-1.6.9-1.5a56 56 0 0 0 12.4 0c.9-.1 1.4.8.9 1.5l-1.1 1.7c-.9 1.3-3 2-6 2s-5.1-.7-6-2Z" fill="url(#glass-${id})"/>
  <path d="M15.4 38.8h17.2" stroke="#000" stroke-opacity=".16" stroke-width=".7" stroke-linecap="round"/>
  <path d="M24 2.5c-6 0-10 2.6-11.2 7.6l-.9 4.2c-.7 3.3-1 6.8-1 10.2s.3 6.9 1 10.2l.7 3.4c.3 1.2.8 2.1 1.7 2.8-2.3-1-3.2-2.6-3.6-4.4l-.7-3.4c-.7-3.3-1-6.8-1-10.2s.3-6.9 1-10.2l.9-4.2C12.3 5.1 17.4 2.5 24 2.5Z" fill="url(#shine-${id})"/>
  <path d="M14.4 7.4l4.7-1.2c.7-.2 1.2.4.9 1l-.9 2.3c-.2.5-.8.7-1.3.5l-3.7-1.4c-.6-.2-.5-1 .3-1.2Z" fill="url(#lamp-${id})"/>
  <path d="M33.6 7.4l-4.7-1.2c-.7-.2-1.2.4-.9 1l.9 2.3c.2.5.8.7 1.3.5l3.7-1.4c.6-.2.5-1-.3-1.2Z" fill="url(#lamp-${id})"/>
  <rect x="14.6" y="41.2" width="6" height="1.9" rx=".9" fill="${TAIL}"/>
  <rect x="27.4" y="41.2" width="6" height="1.9" rx=".9" fill="${TAIL}"/>
  <rect x="20.8" y="41.6" width="6.4" height="1.1" rx=".5" fill="#B32332" opacity=".85"/>`

/* A naked motorcycle: forks, bars with mirrors, teardrop tank, stepped seat,
   a chrome exhaust down the right side. Narrow — that is the whole read. */
const BIKE = (id, t) => `
  <ellipse cx="24" cy="25" rx="12" ry="20" fill="url(#shadow-${id})"/>
  ${wheel(20.4, 31.5, 7.2, 13.5)}${wheel(21, 2.5, 6, 13)}
  <path d="M21.2 6q2.8-2.2 5.6 0v4.6q-2.8-1.6-5.6 0Z" fill="${t.lo}"/>
  <path d="M22.4 8.5v8M25.6 8.5v8" stroke="url(#chrome-${id})" stroke-width="1.2" stroke-linecap="round"/>
  <circle cx="24" cy="10.6" r="2.2" fill="url(#lamp-${id})"/>
  <path d="M11 15.6L7.4 11.2M37 15.6l3.6-4.4" stroke="${CHROME_LO}" stroke-width=".9" stroke-linecap="round"/>
  <ellipse cx="6.8" cy="10.2" rx="2.5" ry="1.5" fill="#1B2825" stroke="${CHROME_LO}" stroke-width=".5"/>
  <ellipse cx="41.2" cy="10.2" rx="2.5" ry="1.5" fill="#1B2825" stroke="${CHROME_LO}" stroke-width=".5"/>
  <rect x="8" y="15" width="32" height="3.2" rx="1.6" fill="#1B2825"/>
  <rect x="8" y="15" width="32" height="1.3" rx=".65" fill="#fff" opacity=".18"/>
  <rect x="8" y="14.5" width="5.6" height="4.2" rx="2.1" fill="#0B120F"/>
  <rect x="34.4" y="14.5" width="5.6" height="4.2" rx="2.1" fill="#0B120F"/>
  <path d="M29.2 25.5c2.3 3.4 3.1 8 2.7 14.6" fill="none" stroke="${CHROME_LO}" stroke-width="2.3" stroke-linecap="round"/>
  <path d="M29.2 25.5c2.3 3.4 3.1 8 2.7 14.6" fill="none" stroke="${CHROME_HI}" stroke-width=".8" stroke-linecap="round" opacity=".75"/>
  <path d="M24 17c3.4 0 5.6 1.8 6.2 5l.5 3.2c.3 2-.1 3.7-1.3 5-1.5 1.7-3.3 2.4-5.4 2.4s-3.9-.7-5.4-2.4c-1.2-1.3-1.6-3-1.3-5l.5-3.2c.6-3.2 2.8-5 6.2-5Z"
        fill="url(#body-${id})" stroke="#fff" stroke-opacity=".28" stroke-width=".6"/>
  <path d="M20.6 20.8c.6-1.6 1.7-2.5 3.2-2.7" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1" stroke-linecap="round"/>
  <path d="M24 17c-3.4 0-5.6 1.8-6.2 5l-.5 3.2c-.3 2 .1 3.7 1.3 5 .5.6 1.1 1.1 1.7 1.4-1.6-.4-2.6-1.2-3.2-2.3-1.2-1.3-1.6-3-1.3-5l.5-3.2c.6-3.2 3.3-5 7.7-5Z" fill="url(#shine-${id})"/>
  <rect x="20.2" y="28.6" width="7.6" height="9.6" rx="3.2" fill="#14201C"/>
  <path d="M24 30.4v6.4" stroke="#2C3B36" stroke-width=".8" stroke-linecap="round"/>
  <path d="M20.6 38q3.4 1.8 6.8 0v2.8q-3.4-1.6-6.8 0Z" fill="${t.lo}"/>
  <rect x="22.3" y="40.6" width="3.4" height="1.6" rx=".8" fill="${TAIL}"/>`

const ART = { car: CAR, bike: BIKE }

/** Markup for one vehicle. `colour` is a COLOURS id; `ring` adds the colour glow under 3D models. */
// A companion on an older or newer version may send a kind we don't know;
// it falls back to the drawn car or bike rather than breaking the map.
export function vehicleSvg(kind, { colour = 'green', size = 40, id = 'v', ring = false } = {}) {
  const t = colourById(colour).tint
  const model = MODEL[kind]
  if (model?.src) {
    // Bikes are narrow, so they are drawn a touch smaller than the box. The
    // models carry their own paint, so there is no colour glow under them.
    const px = Math.round(size * (model.base === 'bike' ? 1.05 : 1.2))
    return `<span style="display:inline-grid;place-items:center;width:${size}px;height:${size}px;border-radius:50%" aria-hidden="true">`
      + `<img src="${model.src}" width="${px}" height="${px}" alt="" draggable="false" style="max-width:none;display:block;pointer-events:none"></span>`
  }
  if (!ART[kind]) kind = baseOf(kind)
  return `<svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true">${defs(id, t)}${ART[kind](id, t)}</svg>`
}

// Older call shape, kept for the preview page and the icon components.
export const carSvg = (id, size, tint) => `<svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true">${defs(id, tint ?? COLOURS[0].tint)}${CAR(id, tint ?? COLOURS[0].tint)}</svg>`
export const bikeSvg = (id, size, tint) => `<svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true">${defs(id, tint ?? COLOURS[0].tint)}${BIKE(id, tint ?? COLOURS[0].tint)}</svg>`

/** Default-colour markup for the map marker; Navigate uses vehicleSvg directly. */
export const VEHICLE_SVG = { car: vehicleSvg('car', { id: 'mk-car' }), bike: vehicleSvg('bike', { id: 'mk-bike' }) }
