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
  applyRemote, applyRemoteSafety, captainEditSent, forgetDeleted, forgetDeletedTrips, getState, meId as LOCAL_ME, setSyncState,
} from './store'
import { PLACES as CATALOGUE } from './seed'
import { sendBlock } from './safety'

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
    supabase.from('profiles').select('id, handle, name, avatar').limit(CHUNK),
  ])

  const failed = [places, posts, reviews, saves, trips, likes, comments, profiles].find((r) => r.error)
  if (failed) throw failed.error

  // The rider's own emergency details (supabase/rider-safety.sql). A server
  // without that table yet must not fail the whole sync.
  try {
    const { data } = await supabase.from('rider_safety')
      .select('blood_group, emergency_name, emergency_phone, insured, updated_at')
      .eq('user_id', userId).maybeSingle()
    if (data) {
      applyRemoteSafety({
        bloodGroup: data.blood_group ?? '', emergencyName: data.emergency_name ?? '',
        emergencyPhone: data.emergency_phone ?? '', insured: Boolean(data.insured),
        updatedAt: new Date(data.updated_at).getTime() || 0,
      })
    }
  } catch (e) {
    console.warn('Trekov: emergency details will sync next time —', e?.message ?? e)
  }
  // Blocks live in their own table (launch-hardening.sql). A server without it
  // yet must not stop the rest of the sync.
  const blocks = await supabase.from('blocks').select('blocked_id').eq('blocker_id', userId)
  const blocked = blocks.error ? [] : blocks.data.map((b) => b.blocked_id)

  const likesByPost = likes.data.reduce((acc, l) => {
    ;(acc[l.post_id] ||= []).push(l.user_id)
    return acc
  }, {})
  const commentsByPost = comments.data.reduce((acc, c) => {
    ;(acc[c.post_id] ||= []).push({ id: c.id, userId: c.user_id, text: c.body, createdAt: c.created_at })
    return acc
  }, {})

  return {
    blocked,
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
      id: t.id, ownerId: t.owner_id, title: t.title, start: t.starts_on ?? '', end: t.ends_on ?? '',
      notes: t.notes, stops: t.stops ?? [], bookings: t.bookings ?? [],
      // Who leads the ride, named by the host (supabase/trip-roles.sql).
      captainId: t.captain_id ?? null,
      // Whether other riders can find it (supabase/trip-visibility.sql).
      visibility: t.visibility === 'public' ? 'public' : 'private',
      // The server has no column for group or solo. A group trip always has a
      // captain — the host until someone else is named (see the push below) —
      // and only a group trip can be opened up, so either one says "group".
      groupHint: Boolean(t.captain_id) || t.visibility === 'public',
      // When the ride was marked done (supabase/trip-completed.sql). Left off
      // when the server has no such column, so the phone keeps its own answer.
      ...('completed_at' in t ? { completedAt: t.completed_at ?? null } : {}),
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

  // Likes and comments. Until 2026-09-12 they never left the phone, so they
  // vanished at the next pull and nobody else saw them. Only for photos the
  // server has; a failure here waits for the next sync instead of failing this one.
  const liked = s.posts.filter((p) => p.likedByMe).map((p) => p.id)
  const said = s.posts.flatMap((p) => (p.comments ?? [])
    .filter((c) => c.userId === LOCAL_ME || c.userId === userId)
    .map((c) => ({ ...c, postId: p.id })))
  const talkedAbout = [...new Set([...liked, ...said.map((c) => c.postId)])]
  if (talkedAbout.length) {
    try {
      const known = new Set()
      for (let i = 0; i < talkedAbout.length; i += 150) {
        const { data, error } = await supabase.from('posts').select('id').in('id', talkedAbout.slice(i, i + 150))
        if (error) throw error
        data.forEach((r) => known.add(r.id))
      }
      const likeRows = liked.filter((id) => known.has(id)).map((id) => ({ post_id: id, user_id: userId }))
      if (likeRows.length) {
        const { error } = await supabase.from('likes').upsert(likeRows, { onConflict: 'post_id,user_id', ignoreDuplicates: true })
        if (error) throw error
      }
      const commentRows = said.filter((c) => known.has(c.postId)).map((c) => ({
        id: c.id, post_id: c.postId, user_id: userId, body: c.text, created_at: c.createdAt,
      }))
      if (commentRows.length) {
        const { error } = await supabase.from('comments').upsert(commentRows, { onConflict: 'id', ignoreDuplicates: true })
        if (error) throw error
      }
    } catch (e) {
      console.warn('Trekov: likes and comments will sync next time —', e?.message ?? e)
    }
  }

  // Only our own trips. One we were invited to belongs to its owner: saving it
  // under our id is refused by the server, and that refusal used to fail the
  // whole sync — so an invited rider's phone stopped syncing altogether. The
  // server is asked who owns what first, because a copy downloaded by an older
  // version of the app doesn't carry its owner.
  let ours = s.trips.filter((t) => !t.ownerId || t.ownerId === userId)
  if (ours.length) {
    const { data: known } = await supabase.from('trips').select('id, owner_id').in('id', ours.map((t) => t.id))
    const theirs = new Set((known ?? []).filter((r) => r.owner_id !== userId).map((r) => r.id))
    ours = ours.filter((t) => !theirs.has(t.id))
  }
  if (ours.length) {
    const tripRow = (t) => {
      // The host leads a group trip until they name someone. Recording that
      // tells the owner's other phones it is a group trip: signed in on a
      // second device, a group trip came down as solo — no badge, "Start trip"
      // instead of "Go live" (iPhone, 2026-09-14).
      const captain = t.captainId ?? (t.kind === 'group' ? userId : null)
      return {
        id: t.id, owner_id: userId, title: t.title,
        starts_on: t.start || null, ends_on: t.end || null,
        notes: t.notes ?? '', stops: t.stops ?? [], bookings: t.bookings ?? [],
        // Left out, not sent as null, when this phone has no captain for it:
        // the app never clears a captain (the server does, when that rider
        // leaves), and a second phone that still took the trip for solo was
        // wiping the host's captain every minute, before it could read it back.
        ...(captain ? { captain_id: captain } : {}),
        visibility: t.visibility === 'public' ? 'public' : 'private',
        completed_at: t.completedAt || null,
        updated_at: new Date().toISOString(),
      }
    }
    // A server that hasn't had trip-roles.sql, trip-visibility.sql or trip-completed.sql run on it
    // yet must not stop everything else from syncing: drop the column it doesn't
    // know about and send the rest.
    const NEWER = ['captain_id', 'visibility', 'completed_at']
    const upsert = async (batch) => {
      let rows = batch
      for (;;) {
        const { error } = await supabase.from('trips').upsert(rows)
        if (!error) return
        const missing = NEWER.find((c) => error.message?.includes(c) && rows.some((r) => c in r))
        if (!missing) throw error
        rows = rows.map(({ [missing]: _skip, ...rest }) => rest)
      }
    }
    // Rows with and without a captain go separately: in one request every row
    // is given every column, which would send the missing captains as null.
    const rows = ours.map(tripRow)
    const withCaptain = rows.filter((r) => 'captain_id' in r)
    const without = rows.filter((r) => !('captain_id' in r))
    if (withCaptain.length) await upsert(withCaptain)
    if (without.length) await upsert(without)
  }
  // A captain's edits to a trip the host owns (supabase/trip-captain-edit.sql):
  // only the plan and the bookings, and only once they have changed here.
  const led = s.trips.filter((t) => t.captainEdit && t.ownerId && t.ownerId !== userId && t.captainId === userId)
  for (const t of led) {
    const at = t.captainEdit
    const plan = {
      p_trip: t.id, p_title: t.title, p_starts: t.start || null, p_ends: t.end || null,
      p_notes: t.notes ?? '', p_stops: t.stops ?? [],
    }
    let { error } = await supabase.rpc('edit_trip_as_captain', { ...plan, p_bookings: t.bookings ?? [] })
    // A server from before bookings joined the captain's edit takes the rest.
    if (error && /could not find the function/i.test(error.message ?? '')) ({ error } = await supabase.rpc('edit_trip_as_captain', plan))
    // No longer the captain (or the server hasn't had the SQL yet): the host's
    // copy wins at the next pull, which is the honest outcome.
    if (!error || /not_captain|could not find the function/i.test(error.message ?? '')) captainEditSent(t.id, at)
    else console.warn('Trekov: the captain\'s changes will sync next time —', error.message)
  }
  // The rider's emergency details, when this phone's copy is the newer one.
  const safety = s.safety
  if (safety?.updatedAt) {
    const { error } = await supabase.from('rider_safety').upsert({
      user_id: userId,
      blood_group: safety.bloodGroup || null,
      emergency_name: safety.emergencyName || null,
      emergency_phone: safety.emergencyPhone || null,
      insured: Boolean(safety.insured),
      updated_at: new Date(safety.updatedAt).toISOString(),
    })
    if (error) console.warn('Trekov: emergency details will sync next time —', error.message)
  }
  return { held }
}

/**
 * Removals made on this phone, sent before anything else so that neither the
 * push nor the pull brings them back. Each kind is forgotten once the server
 * has it; one that fails waits for the next sync without holding up the rest.
 *
 * Trips: ours are deleted (with their invites). One someone else owns, we
 * leave — our place on it is removed (trip-invites.sql leave_trip), so it drops
 * off our list everywhere and off the owner's rider list; one we couldn't
 * leave stays hidden here. Also: places taken off To Visit (they came back
 * after every sync until 2026-09-12), deleted photos and reviews, likes taken back.
 */
async function pushDeletions(userId) {
  const s = getState()
  const run = async (label, ids, fn) => {
    if (!ids?.length) return
    try { await fn(ids) } catch (e) { console.warn(`Trekov: could not remove ${label} on the server yet —`, e?.message ?? e) }
  }

  await run('trips', s.deletedTrips, async (gone) => {
    const { data, error } = await supabase.from('trips').select('id, owner_id').in('id', gone)
    if (error) throw error
    const ours = data.filter((r) => r.owner_id === userId).map((r) => r.id)
    const theirs = data.filter((r) => r.owner_id !== userId).map((r) => r.id)
    if (ours.length) {
      const { error: delError } = await supabase.from('trips').delete().in('id', ours)
      if (delError) throw delError
    }
    let left = []
    if (theirs.length) {
      const { data: rows, error: leaveError } = await supabase.from('trip_members').delete()
        .in('trip_id', theirs).eq('user_id', userId).select('trip_id')
      if (leaveError) throw leaveError
      left = (rows ?? []).map((r) => r.trip_id)
    }
    const stuck = new Set(theirs.filter((id) => !left.includes(id)))
    forgetDeletedTrips(gone.filter((id) => !stuck.has(id)))
  })

  await run('places taken off To Visit', s.unsavedPlaces, async (ids) => {
    const { error } = await supabase.from('saves').delete().eq('user_id', userId).in('place_id', ids)
    if (error) throw error
    forgetDeleted('unsavedPlaces', ids)
  })

  await run('photos', s.deletedPosts, async (ids) => {
    const { error } = await supabase.from('posts').delete().eq('author_id', userId).in('id', ids)
    if (error) throw error
    // And their files (uploadPhoto keeps them at <uid>/<post>.jpg); one left behind is only wasted space.
    await supabase.storage.from('photos').remove(ids.map((id) => `${userId}/${id}.jpg`)).catch(() => {})
    forgetDeleted('deletedPosts', ids)
  })

  await run('reviews', s.deletedReviews, async (ids) => {
    const { error } = await supabase.from('reviews').delete().eq('user_id', userId).in('id', ids)
    if (error) throw error
    forgetDeleted('deletedReviews', ids)
  })

  await run('likes', s.unliked, async (ids) => {
    const { error } = await supabase.from('likes').delete().eq('user_id', userId).in('post_id', ids)
    if (error) throw error
    forgetDeleted('unliked', ids)
  })
}

/* -------------------------------------------------------------- lifecycle */

let channel = null
let timer = null

/** Bring local and remote together, then watch for other people's changes. */
// One sync at a time: live updates can ask for several in a row.
let running = null
export async function syncNow(userId) {
  if (!supabase || !userId) return
  if (running) return running
  running = (async () => {
    setSyncState({ status: 'syncing', error: null })
    try {
      // Deletions first, so neither the push nor the pull brings a deleted trip back.
      await pushDeletions(userId)
      // Blocks made while offline, before anything else can reach that person.
      for (const p of getState().pendingBlocks ?? []) await sendBlock(p.id, p.on)
      const { held } = await pushMine(userId)
      applyRemote({ ...(await pullAll(userId)), heldSaves: held }, userId)
      setSyncState({ status: 'synced', at: new Date().toISOString(), error: null })
    } catch (e) {
      console.warn('Trekov: sync failed', e)
      // Local data is untouched, so the app keeps working; say so and move on.
      setSyncState({ status: 'error', error: e.message ?? 'Sync failed' })
    }
  })().finally(() => { running = null })
  return running
}

export function watchRemote(userId, onChange) {
  if (!supabase || channel) return
  // private: any signed-in user may listen (security-hardening.sql); with
  // Realtime public access off, only private channels are allowed.
  // Other people's changes arrive as they happen — new posts, and trips you
  // own or ride on — bundled so a burst means one sync. Our own writes are
  // ignored: every sync saves our trips again, and reacting to that would
  // loop. A full sync each minute catches anything a dropped connection missed.
  let soon = null
  const syncSoon = () => { clearTimeout(soon); soon = setTimeout(() => syncNow(userId), 1500) }
  const fromOthers = (key) => (p) => { if ((p.new?.[key] ?? p.old?.[key]) !== userId) syncSoon() }
  channel = supabase.channel('trekov-public', { config: { private: true } })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'places' },
        (p) => onChange?.({ type: 'place', row: p.new }))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, fromOthers('author_id'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, fromOthers('owner_id'))
    .subscribe()
  timer = setInterval(() => { if (!document.hidden && navigator.onLine) syncNow(userId) }, 60_000)
}

export function stopWatching() {
  if (channel) { supabase.removeChannel(channel); channel = null }
  clearInterval(timer)
  timer = null
}

/**
 * Riders waiting to be let onto a trip you host, for the badge on the Trips tab.
 *
 * Here rather than in lib/people.js only because App.jsx already imports this
 * module and not that one.
 */
export async function joinRequestCount() {
  if (import.meta.env.DEV && window.__adDemo?.joinRequestCount) return window.__adDemo.joinRequestCount()
  if (!supabase) return 0
  const { data: { user } = {} } = await supabase.auth.getUser()
  if (!user) return 0
  // The server decides what is visible: a host reads the rows of their own
  // trips, everyone reads their own row — so 'requested' rows that are not
  // yours are exactly the people waiting on you.
  const { count, error } = await supabase
    .from('trip_members')
    .select('trip_id', { count: 'exact', head: true })
    .eq('status', 'requested')
    .neq('user_id', user.id)
  return error ? 0 : (count ?? 0)
}
