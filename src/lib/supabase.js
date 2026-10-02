// Supabase client, created only when credentials exist.
//
// Absent them the app is exactly what it was: local-first, offline-capable,
// no account needed. That fallback is not a stopgap — offline navigation
// depends on the app working with no network and no session.

import { createClient } from '@supabase/supabase-js'
import { deviceId } from './device'

const URL = import.meta.env.VITE_SUPABASE_URL
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

export const hasSupabase = Boolean(URL && ANON)

export const supabase = hasSupabase
  ? createClient(URL, ANON, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 5 } },
      // Lets the server keep an account to one device at a time (memberships.sql).
      global: { headers: { 'x-device-id': deviceId() } },
    })
  : null

/** Public URL for a stored photo. */
export const photoUrl = (path) =>
  path && supabase ? supabase.storage.from('photos').getPublicUrl(path).data.publicUrl : ''
