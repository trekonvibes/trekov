// What a business sells — rooms, rental bikes, a menu, repairs — with prices.
// Products come with the business plan (unlimited listings and products);
// supabase/memberships.sql enforces that on the server.

import { supabase } from './supabase'
import { clearNearbyCache } from './nearby'

export const UNITS = ['per night', 'per day', 'per hour', 'per plate', 'per person', 'per service', 'each']
export const formatInr = (n) => `₹${Number(n).toLocaleString('en-IN')}`

const COLS = 'id, listing_id, name, price_inr, unit, description, available, position'

/** Every product on one of your own listings, including ones marked unavailable. */
export async function myProducts(listingId) {
  const { data, error } = await supabase.from('listing_products').select(COLS)
    .eq('listing_id', listingId).order('position').order('created_at')
  if (error) throw error
  return data ?? []
}

const newId = () => `p_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`

function friendly(error) {
  const m = error?.message ?? String(error)
  if (/listing_products_name_len/.test(m)) return new Error('The product name should be 2–80 characters.')
  if (/listing_products_price/.test(m)) return new Error('Enter the price in rupees.')
  if (/listing_products_text_len/.test(m)) return new Error('Keep the note under 300 characters.')
  return new Error(m)
}

export async function saveProduct(listingId, draft) {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) throw new Error('Sign in to manage your products.')
  const row = {
    name: draft.name.trim(),
    price_inr: Math.round(Number(draft.price_inr)),
    unit: draft.unit ?? '',
    description: (draft.description ?? '').trim(),
    available: draft.available !== false,
  }
  const { error } = draft.id
    ? await supabase.from('listing_products').update(row).eq('id', draft.id)
    : await supabase.from('listing_products').insert({
        id: newId(), listing_id: listingId, owner_id: auth.user.id, position: draft.position ?? 0, ...row,
      })
  if (error) throw friendly(error)
  clearNearbyCache()
}

export async function deleteProduct(id) {
  const { error } = await supabase.from('listing_products').delete().eq('id', id)
  if (error) throw friendly(error)
  clearNearbyCache()
}
