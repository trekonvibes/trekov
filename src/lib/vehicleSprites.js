// The map vehicles in 3D (Punit, 2026-09-14: "the car and bikes should be in
// 3d on the map, not look like 2d").
//
// A map can only show flat pictures, so each model was rendered in Blender from
// 36 directions at the navigation camera's tilt (scripts/vehicles/sprites3d.py)
// and packed into one sheet (scripts/vehicles/sheets.py): a 6 x 7 grid, frame k
// is the vehicle turned k * 10 degrees clockwise on screen, and the cell after
// the last frame is the same vehicle straight from above. The ground point the
// vehicle stands on is the middle of every cell.
//
// Whoever draws it picks the frame for (heading - map bearing): Google's
// navigation map in the Android app (TrekovNavPlugin.java) and Trekov's own map
// (Navigate.jsx, spriteHtml below).

import { MODELS, baseOf, pickableVehicle } from './vehicleArt'

const SHEETS = import.meta.glob('../assets/vehicles3d/*.webp', { eager: true, import: 'default' })
const sheetUrl = (id) => SHEETS[`../assets/vehicles3d/${id}.webp`]

export const SHEET = { cols: 6, rows: 7, frames: 36 }

/** A vehicle id that has a sheet; old or unknown ids get the nearest one. */
export const spriteId = (id) => {
  const picked = pickableVehicle(id)
  if (sheetUrl(picked)) return picked
  return baseOf(id) === 'bike' ? 'classic' : 'hatchback'
}

/** Cars are drawn longer than bikes, but not four times: a bike must stay easy to see. */
export const cellDpFor = (id) => (baseOf(spriteId(id)) === 'bike' ? 84 : 98)

/** 0-35: which frame shows a vehicle pointing `heading` on a map turned to `mapBearing`. */
export function frameFor(heading, mapBearing) {
  const rel = (((Number(heading) || 0) - (Number(mapBearing) || 0)) % 360 + 360) % 360
  return Math.round(rel / (360 / SHEET.frames)) % SHEET.frames
}

/**
 * Markup for one vehicle on Trekov's own map, `size` pixels square. `frame`
 * 0-35 for a tilted map, or null for the top view (turn the element yourself).
 */
export function spriteHtml(id, { frame = null, size = 56 } = {}) {
  const sid = spriteId(id)
  const k = frame == null ? SHEET.frames : frame
  const col = k % SHEET.cols
  const row = Math.floor(k / SHEET.cols)
  const x = SHEET.cols > 1 ? (col / (SHEET.cols - 1)) * 100 : 0
  const y = SHEET.rows > 1 ? (row / (SHEET.rows - 1)) * 100 : 0
  return `<span aria-hidden="true" style="display:block;width:${size}px;height:${size}px;`
    + `background:url('${sheetUrl(sid)}') ${x}% ${y}% / ${SHEET.cols * 100}% ${SHEET.rows * 100}% no-repeat"></span>`
}

const cache = new Map()

async function base64Of(url) {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** { key, sheet: base64 webp, cols, rows, frames, cellDp } for the native map. */
export function vehicleSprite(id) {
  const sid = spriteId(id)
  if (!cache.has(sid)) {
    cache.set(sid, base64Of(sheetUrl(sid)).then(
      (sheet) => ({ key: sid, sheet, ...SHEET, cellDp: cellDpFor(sid) }),
      (e) => { cache.delete(sid); throw e },
    ))
  }
  return cache.get(sid)
}

export { MODELS }
