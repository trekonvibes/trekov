// Turning a result from somewhere else into a Trekov place.
//
// Map search and Discover's Nearby both surface spots that are not Trekov
// records yet — Google Places results and partner listings. Navigating to one,
// saving it or putting it in a trip all need a real place, so it gets adopted
// on the way.

import { getPlace, upsertPlace } from './store'

/**
 * Adopt a search or nearby result so it can be navigated to, saved or added
 * to a trip. Returns the place id.
 *
 * The id is derived from the source id, so adopting the same spot twice lands
 * on the same record instead of quietly creating a duplicate. The `pl_g_`
 * prefix predates partner listings and is kept as-is: changing it would orphan
 * every place already saved from map search.
 *
 * Adopting deliberately does not announce. A hotel picked out of Nearby is not
 * a discovery worth pushing to every user — the caller decides that.
 */
export function adoptHit(hit) {
  const id = `pl_g_${hit.id}`
  if (getPlace(id)) return id
  const [region, ...rest] = (hit.detail || '').split(',').map((x) => x.trim())
  upsertPlace({
    id,
    name: hit.name,
    region: region || '',
    country: rest.at(-1) || '',
    lat: hit.lat,
    lng: hit.lng,
    bestTime: '',
    blurb: '',
  })
  return id
}
