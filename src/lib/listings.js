// A business's own listings on Trekov.
//
// Listing is free — there is no sign-up fee. What an owner cannot do is
// promote their own listing: verification, boosts and moderation are
// Trekov's, and supabase/listings-selfserve.sql enforces that on the server
// whatever this file sends. Photos come from the in-app camera, like every
// other photo in Trekov.

import { photoUrl, supabase } from './supabase'
import { clearNearbyCache } from './nearby'

export const MAX_LISTINGS = 5
const COLUMNS = 'id, category, name, description, phone, address, lat, lng, url, photo_path, verified, hidden, plan, subscribed_until, products_until, created_at'

async function uid() {
  const { data } = await supabase.auth.getUser()
  if (!data?.user) throw new Error('Sign in to manage your listings.')
  return data.user.id
}

export async function myListings() {
  const owner = await uid()
  const { data, error } = await supabase.from('listings').select(COLUMNS).eq('owner_id', owner)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((l) => ({ ...l, photo: photoUrl(l.photo_path) }))
}

export const normaliseUrl = (u) => {
  const s = (u ?? '').trim()
  return !s ? '' : /^https?:\/\//i.test(s) ? s : `https://${s}`
}
export const validPhone = (p) => !(p ?? '').trim() || /^\+?[\d\s-]{7,16}$/.test(p.trim())

const newId = () => `l_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`

// A fresh path per photo, so a replaced photo isn't served from cache.
async function uploadPhoto(owner, id, file) {
  const path = `${owner}/listing-${id}-${Date.now()}.jpg`
  const { error } = await supabase.storage.from('photos').upload(path, file, { contentType: 'image/jpeg' })
  if (error) throw error
  return path
}

function friendly(error) {
  const m = error?.message ?? String(error)
  if (/listings_name_len/.test(m)) return new Error('The name should be 2–80 characters.')
  if (/listings_description_len/.test(m)) return new Error('Keep the description under 300 characters.')
  if (/listings_category_check/.test(m)) return new Error('Pick one of the listed kinds of place.')
  return new Error(m)
}

/** Creates or updates a listing. `photoFile` is a camera capture, or null to keep the current photo. */
export async function saveListing(draft, photoFile) {
  const owner = await uid()
  const id = draft.id ?? newId()
  const previous = draft.photo_path ?? ''
  let photo_path = draft.removePhoto ? '' : previous
  if (photoFile) photo_path = await uploadPhoto(owner, id, photoFile)
  const row = {
    category: draft.category,
    name: draft.name.trim(),
    description: (draft.description ?? '').trim(),
    phone: (draft.phone ?? '').trim(),
    address: (draft.address ?? '').trim(),
    lat: draft.lat,
    lng: draft.lng,
    url: normaliseUrl(draft.url),
    photo_path,
  }
  const { error } = draft.id
    ? await supabase.from('listings').update(row).eq('id', id)
    : await supabase.from('listings').insert({ id, owner_id: owner, ...row })
  if (error) {
    if (photoFile) supabase.storage.from('photos').remove([photo_path]).catch(() => {})
    throw friendly(error)
  }
  if (previous && previous !== photo_path) supabase.storage.from('photos').remove([previous]).catch(() => {})
  clearNearbyCache()
  return id
}

export async function deleteListing(listing) {
  const { error } = await supabase.from('listings').delete().eq('id', listing.id)
  if (error) throw friendly(error)
  if (listing.photo_path) supabase.storage.from('photos').remove([listing.photo_path]).catch(() => {})
  clearNearbyCache()
}
