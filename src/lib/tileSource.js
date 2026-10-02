// Where the offline map's tiles and style come from.
//
// A leaf on purpose: mapDrivers/maplibre.js needs the style URL and lib/offline.js
// needs to warm the driver, so each used to import the other and the two formed
// a cycle. Nothing imports anything here, so that cannot come back.

export const TILE_HOST = 'https://tiles.openfreemap.org'
export const STYLE_URL = `${TILE_HOST}/styles/liberty`
export const TILE_CACHE = 'trekov-tiles-v2'
