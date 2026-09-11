// What a business sells — rooms, rental bikes, a menu, repairs — with prices.
//
// The business listing is free. Listing products needs the monthly products
// plan: one flat fee, unlimited products. Whether a listing has the plan is
// Trekov's to say (listings.products_until, set from the dashboard until
// online payment exists), and supabase/listing-products.sql enforces it on
// the server, so nothing here decides who has paid.

import { supabase } from './supabase'
import { clearNearbyCache } from './nearby'

/** Monthly price of the products plan, in rupees. Placeholder until Punit confirms it. */
export const PRODUCTS_PLAN_INR = 299
/** Where a business asks for the plan until online payment is set up (same contact as the landing page). */
export const CONTACT_EMAIL = 'punit13690@gmail.com'
export const UNITS = ['per night', 'per day', 'per hour', 'per plate', 'per person', 'per service', 'each']

const today = () => new Date().toISOString().slice(0, 10)
export const planActive = (listing) => Boolean(listing?.products_until) && listing.products_until >= today()
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

/** Until online payment is set up, a business asks for the plan by email. */
export function activationMailto(listing) {
  const subject = `Products plan for ${listing.name}`
  const body = `Hi Trekov,\n\nPlease activate the products plan (${formatInr(PRODUCTS_PLAN_INR)}/month, unlimited products) `
    + `for my listing:\n\n${listing.name}\nListing ID: ${listing.id}\n\nThanks`
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
