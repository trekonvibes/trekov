// Sync between the local store and Supabase.
//
// The store stays the synchronous source of truth the UI reads, and this layer
// pushes writes up and pulls changes down. That ordering is deliberate: the
// app has to keep working with no network — offline navigation and the tile
// cache depend on it — so remote is a mirror of local, never a prerequisite.
//
// Conflict rule: last write wins, per row. Fine for photos, reviews and a
// personal trip; if trips ever become collaboratively edited in real time this
// needs revisiting.

import { photoUrl, supabase } from './supabase'
import { getBlob } from './media'
import {
  applyRemote, getState, meId as LOCAL_ME, setSyncState,
} from './store'
import { PLACES as CATALOGUE } from './seed'

const CATALOGUE_IDS = new Set(CATALOGUE.map((p) => p.id))

const CHUNK = 500

/* ------------------------------------------------------------------ read */

async function pullAll(userId) {
  const [places, posts, reviews, saves, trips, likes, comments, profiles] = await Promise.all([
    supabase.from('places').select('*').limit(CHUNK),
    supabase.from('posts').select('*').order('created_at', { ascending: false }).limit(CHUNK),
    supabase.from('reviews').select('*').limit(CHUNK),
    supabase.from('saves').select('*').eq('user_id', userId),
    supabase.from('trips').select('*'),
    supabase.from('likes').select('*').limit(CHUNK),
    supabase.from('comments').select('*').limit(CHUNK),
    supabase.from('profiles').select('*').limit(CHUNK),
  ])

  const failed = [places, posts, reviews, saves, trips, likes, comments, profiles].find((r) => r.error)
  if (failed) throw failed.error

  const likesByPost = likes.data.reduce((acc, l) => {
    ;(acc[l.post_id] ||= []).push(l.user_id)
    return acc
  }, {})
  const commentsByPost = comments.data.reduce((acc, c) => {
    ;(acc[c.post_id] ||= []).push({ id: c.id, userId: c.user_id, text: c.body, createdAt: c.created_at })
    return acc
  }, {})

  return {
    users: Object.fromEntries(profiles.data.map((p) => [
      p.id, { id: p.id, name: p.name || p.handle, handle: p.handle, avatar: p.avatar },
    ])),
    places: Object.fromEntries(places.data.map((p) => [p.id, {
      id: p.id, name: p.name, region: p.region, country: p.country,
      lat: p.lat, lng: p.lng, bestTime: p.best_time, blurb: p.blurb,
      addedBy: p.added_by, addedAt: p.added_at,
    }])),
    posts: posts.data.map((p) => ({
      id: p.id, placeId: p.place_id, authorId: p.author_id,
      media: { type: 'image', src: photoUrl(p.photo_path), path: p.photo_path },
      caption: p.caption, tags: p.tags ?? [],
      located: p.located_at ? { at: p.located_at, distanceM: p.located_distance_m, accuracyM: p.located_accuracy_m } : null,
      likes: likesByPost[p.id]?.length ?? 0,
      likedByMe: Boolean(likesByPost[p.id]?.includes(userId)),
      comments: (commentsByPost[p.id] ?? []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
      createdAt: p.created_at,
    })),
    reviews: reviews.data.map((r) => ({
      id: r.id, placeId: r.place_id, userId: r.user_id,
      ratings: r.ratings ?? {}, facts: r.facts ?? {}, note: r.note, createdAt: r.created_at,
    })),
    savedPlaces: saves.data
      .sort((a, b) => new Date(b.saved_at) - new Date(a.saved_at))
      .map((s) => s.place_id),
    trips: trips.data.map((t) => ({
      id: t.id, title: t.title, start: t.starts_on ?? '', end: t.ends_on ?? '',
      notes: t.notes, stops: t.stops ?? [], bookings: t.bookings ?? [],
    })),
  }
}

/* ----------------------------------------------------------------- write */

/** Photos live in IndexedDB until they can be uploaded under <uid>/<post>.jpg. */
async function uploadPhoto(post, userId) {
  if (!post.media?.blobKey) return post.media?.path ?? null
  const blob = await getBlob(post.media.blobKey)
  if (!blob) return null
  const path = `${userId}/${post.id}.jpg`
  const { error } = await supabase.storage.from('photos')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) throw error
  return path
}

/**
 * Push everything this user owns. Runs on sign-in and after local writes;
 * upserts make it idempotent, so a failed run can simply be retried.
 */
async function pushMine(userId) {
  const s = getState()
  const mine = (rows, key = 'authorId') => rows.filter((r) => r[key] === LOCAL_ME || r[key] === userId)

  // Places I added, before the posts that reference them. Catalogue places
  // are loaded on the server separately (supabase/catalogue-places.sql).
  const row = (p) => ({
    id: p.id, name: p.name, region: p.region ?? '', country: p.country ?? '',
    lat: p.lat, lng: p.lng, best_time: p.bestTime ?? '', blurb: p.blurb ?? '',
    added_by: userId, added_at: p.addedAt ?? new Date().toISOString(),
  })
  const places = Object.values(s.places)
    .filter((p) => (p.addedBy === LOCAL_ME || p.addedBy === userId) && !CATALOGUE_IDS.has(p.id))
  // A Google place (pl_g_) may already be on the server from someone else who
  // found it first; theirs stands, and updating it would be refused.
  const [google, created] = [places.filter((p) => p.id.startsWith('pl_g_')), places.filter((p) => !p.id.startsWith('pl_g_'))]
  if (created.length) {
    const { error } = await supabase.from('places').upsert(created.map(row))
    if (error) throw error
  }
  if (google.length) {
    const { error } = await supabase.from('places').upsert(google.map(row), { onConflict: 'id', ignoreDuplicates: true })
    if (error) throw error
  }

  // Only send rows whose place the server has. One missing place used to
  // fail the whole sync ("violates foreign key constraint saves_place_id_fkey");
  // now that row waits on the device and everything else goes through.
  const wanted = [...new Set([
    ...s.savedPlaces, ...mine(s.posts).map((p) => p.placeId), ...mine(s.reviews, 'userId').map((r) => r.placeId),
  ])]
  const onServer = new Set()
  for (let i = 0; i < wanted.length; i += 150) {
    const { data, error } = await supabase.from('places').select('id').in('id', wanted.slice(i, i + 150))
    if (error) throw error
    data.forEach((r) => onServer.add(r.id))
  }
  const held = wanted.filter((id) => !onServer.has(id))
  if (held.length) console.warn('Trekov: waiting for these places to reach the server:', held)

  for (const post of mine(s.posts).filter((p) => onServer.has(p.placeId))) {
    const path = await uploadPhoto(post, userId)
    if (!path) continue
    const { error } = await supabase.from('posts').upsert({
      id: post.id, place_id: post.placeId, author_id: userId, photo_path: path,
      caption: post.caption ?? '', tags: post.tags ?? [], created_at: post.createdAt,
      located_at: post.located?.at ?? null,
      located_distance_m: post.located?.distanceM ?? null,
      located_accuracy_m: post.located?.accuracyM ?? null,
    })
    if (error) throw error
  }

  const reviews = mine(s.reviews, 'userId').filter((r) => onServer.has(r.placeId))
  if (reviews.length) {
    const { error } = await supabase.from('reviews').upsert(
      reviews.map((r) => ({
        id: r.id, place_id: r.placeId, user_id: userId,
        ratings: r.ratings ?? {}, facts: r.facts ?? {}, note: r.note ?? '', created_at: r.createdAt,
      })),
      { onConflict: 'place_id,user_id' },
    )
    if (error) throw error
  }

  const saves = s.savedPlaces.filter((id) => onServer.has(id))
  if (saves.length) {
    const { error } = await supabase.from('saves').upsert(
      saves.map((placeId) => ({ place_id: placeId, user_id: userId })),
    )
    if (error) throw error
  }

  if (s.trips.length) {
    const { error } = await supabase.from('trips').upsert(s.trips.map((t) => ({
      id: t.id, owner_id: userId, title: t.title,
      starts_on: t.start || null, ends_on: t.end || null,
      notes: t.notes ?? '', stops: t.stops ?? [], bookings: t.bookings ?? [],
      updated_at: new Date().toISOString(),
    })))
    if (error) throw error
  }
  return { held }
}

/* -------------------------------------------------------------- lifecycle */

let channel = null

/** Bring local and remote together, then watch for other people's changes. */
export async function syncNow(userId) {
  if (!supabase || !userId) return
  setSyncState({ status: 'syncing', error: null })
  try {
    const { held } = await pushMine(userId)
    applyRemote({ ...(await pullAll(userId)), heldSaves: held }, userId)
    setSyncState({ status: 'synced', at: new Date().toISOString(), error: null })
  } catch (e) {
    console.warn('Trekov: sync failed', e)
    // Local data is untouched, so the app keeps working; say so and move on.
    setSyncState({ status: 'error', error: e.message ?? 'Sync failed' })
  }
}

export function watchRemote(userId, onChange) {
  if (!supabase || channel) return
  channel = supabase.channel('trekov-public')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'places' },
        (p) => onChange?.({ type: 'place', row: p.new }))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' },
        () => syncNow(userId))
    .subscribe()
}

export function stopWatching() {
  if (channel) { supabase.removeChannel(channel); channel = null }
}
