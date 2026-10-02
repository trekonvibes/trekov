// Finding people to invite on a group trip.
//
// Supabase profiles when a project is configured; otherwise the users already
// known locally, so the invite flow is still demonstrable offline.

import { photoUrl, supabase } from './supabase'
import { getState } from './store'

export async function searchProfiles(query) {
  const q = query.trim()
  if (q.length < 2) return []

  if (supabase) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, handle, name, avatar')
      .ilike('handle', `%${q}%`)
      .limit(8)
    if (!error) return data ?? []
    console.info('Trekov: profile search unavailable —', error.message)
  }

  // Local fallback: whoever this device already knows about.
  const term = q.toLowerCase()
  return Object.values(getState().users)
    .filter((u) => u.id !== 'u_me' && `${u.handle} ${u.name}`.toLowerCase().includes(term))
    .slice(0, 8)
}

/**
 * Invite someone to a trip. It starts as pending; they accept or decline it
 * from their Trips tab, and only then can they open the trip or ride live
 * with it (supabase/trip-invites.sql enforces all of that).
 */
export async function inviteToTrip(tripId, userId) {
  if (!supabase) return { ok: false, reason: 'local' }
  const { error } = await supabase.from('trip_members').upsert({ trip_id: tripId, user_id: userId, status: 'pending' })
  if (error) {
    console.info('Trekov: could not send invite —', error.message)
    return { ok: false, reason: error.message }
  }
  return { ok: true }
}

/** { [userId]: { status: 'pending' | 'accepted' | 'declined', respondedAt } } for a trip you own. */
export async function tripInvites(tripId) {
  if (import.meta.env.DEV && window.__adDemo?.tripInvites) return window.__adDemo.tripInvites(tripId)
  if (!supabase) return {}
  const { data, error } = await supabase.from('trip_members')
    // trip_members links to profiles twice (the rider, and invited_by), so the
    // rider's link is named: a bare profiles(...) is ambiguous and the server
    // answered every one of these with HTTP 300 (PGRST201), found 2026-09-12.
    .select('user_id, status, responded_at, profile:profiles!trip_members_user_id_fkey(handle, name, avatar)').eq('trip_id', tripId)
  if (error) return {}
  return Object.fromEntries((data ?? []).map((r) => [r.user_id, {
    status: r.status, respondedAt: r.responded_at,
    handle: r.profile?.handle, name: r.profile?.name, avatar: r.profile?.avatar,
  }]))
}

/** Take someone off a trip on the server too, so they really lose access. */
export async function removeFromTrip(tripId, userId) {
  if (!supabase) return
  const { error } = await supabase.from('trip_members').delete().eq('trip_id', tripId).eq('user_id', userId)
  if (error) console.info('Trekov: could not remove member —', error.message)
}

/** Trips you've been invited to and haven't answered. */
export async function myInvites() {
  if (import.meta.env.DEV && window.__adDemo?.myInvites) return window.__adDemo.myInvites()
  if (!supabase) return []
  const { data, error } = await supabase.rpc('my_invites')
  return error ? [] : data ?? []
}

export async function respondInvite(tripId, accept) {
  const { error } = await supabase.rpc('respond_invite', { p_trip: tripId, p_accept: accept })
  if (error) throw new Error(error.message)
}

/**
 * The rides other people have opened up: title, dates, where they start and
 * end, how many are going, and whether you have already asked.
 *
 * It is a function on the server rather than a query, so a stranger reads this
 * much and no more — never the notes, the bookings or anyone's position
 * (supabase/trip-visibility.sql).
 */
export async function openRides(limit = 30) {
  if (import.meta.env.DEV && window.__adDemo?.openRides) return window.__adDemo.openRides()
  if (!supabase) return []
  const { data, error } = await supabase.rpc('open_rides', { p_limit: limit })
  if (error) {
    console.info('Trekov: open rides unavailable —', error.message)
    return []
  }
  return data ?? []
}

/**
 * Ask the host to come along. Returns 'requested' once they have your request;
 * nothing about the trip opens up until they say yes.
 */
export async function requestToJoin(tripId) {
  if (!supabase) return { ok: false, reason: 'local' }
  const { data, error } = await supabase.rpc('request_to_join', { p_trip: tripId })
  if (error) return { ok: false, reason: error.message }
  return { ok: true, status: data }
}

/** Take back a request the host hasn't answered. Your own row, nobody else's. */
export async function withdrawJoin(tripId) {
  if (!supabase) return { ok: false, reason: 'local' }
  const { data: { user } = {} } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'Sign in first.' }
  const { error } = await supabase.from('trip_members')
    .delete().eq('trip_id', tripId).eq('user_id', user.id)
  if (error) return { ok: false, reason: error.message }
  return { ok: true }
}

/** The host's answer to someone who asked to come along. */
export async function answerJoin(tripId, userId, accept) {
  if (!supabase) return { ok: false, reason: 'local' }
  const { error } = await supabase.from('trip_members')
    .update({ status: accept ? 'accepted' : 'declined' })
    .eq('trip_id', tripId).eq('user_id', userId)
  if (error) return { ok: false, reason: error.message }
  return { ok: true }
}

/**
 * Somebody else's profile, to look at: who they are and what they've posted.
 *
 * Read only — profiles and posts are world-readable (schema.sql), and nothing
 * here can change either. Their email, trips, saved places and location are
 * not part of it and never leave the server.
 */
export async function personProfile({ userId, handle }) {
  if (import.meta.env.DEV && window.__adDemo?.personProfile) return window.__adDemo.personProfile({ userId, handle })
  if (!supabase || (!userId && !handle)) return null
  const q = supabase.from('profiles').select('id, handle, name, bio, avatar').limit(1)
  const { data: rows, error } = await (userId ? q.eq('id', userId) : q.eq('handle', handle))
  const person = rows?.[0]
  if (error || !person) return null

  const { data: posts } = await supabase
    .from('posts').select('id, photo_path, caption, created_at, place_id')
    .eq('author_id', person.id).order('created_at', { ascending: false }).limit(36)
  return {
    ...person,
    photos: (posts ?? []).map((p) => ({
      id: p.id, src: photoUrl(p.photo_path), caption: p.caption, at: p.created_at, placeId: p.place_id,
    })).filter((p) => p.src),
  }
}

/**
 * Invite links, one per channel.
 *
 * These open the person's own WhatsApp / mail / messages app with the text
 * ready — nothing is sent on their behalf, and no contact list is read.
 */
export function inviteLinks(tripTitle, url) {
  const text = `Join me on "${tripTitle}" — our trip on Trekov. Open this to see the route and follow along live:\n${url}`
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
    email: `mailto:?subject=${encodeURIComponent(`Join my trip: ${tripTitle}`)}&body=${encodeURIComponent(text)}`,
    sms: `sms:?&body=${encodeURIComponent(text)}`,
    text,
  }
}
