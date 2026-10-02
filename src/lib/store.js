// Single source of truth.
//
// A *place* is the primary record: you browse the map, open a place, and see
// what people shot there. Posts hang off places; saved places and trips are
// both just ordered lists of place ids.
//
// Everything is client-side (localStorage for records, IndexedDB for media) so
// the app works with no backend. Every read and write goes through this file,
// so a real backend replaces this module alone.

import { useSyncExternalStore } from 'react'
import { PLACES, POSTS, RETIRED_DEMO, SEED_REVIEWS, USERS } from './seed'
import { putBlob, delBlob } from './media'
import { defaultAvatar } from './avatar'

const KEY = 'trekov.state.v2'
const CATALOGUE_BY_ID = Object.fromEntries(PLACES.map((p) => [p.id, p]))
const ME = 'u_me'

/**
 * Ids must be unique across devices, not just within one.
 * `Date.now()` collides the moment two people post in the same millisecond —
 * fine while everything was local, wrong as soon as rows sync to Postgres.
 */
export const newId = (prefix) =>
  `${prefix}_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random().toString(36).slice(2, 10)}`}`

function initial() {
  return {
    users: USERS,
    places: Object.fromEntries(PLACES.map((p) => [p.id, p])),
    posts: POSTS.map((p) => ({ ...p, likedByMe: false })),
    savedPlaces: [],   // place ids, newest first
    // { id, title, start, end, notes, stops: [{ placeId, note }],
    //   bookings: [{ id, kind, mode, provider, ref, from, to, start, end, cost, url, notes }] }
    trips: [],
    notifications: [], // { id, type, placeId, by, at, read }
    // One review per person per place: { id, placeId, userId, ratings, note, createdAt }
    reviews: SEED_REVIEWS,
    profile: { name: 'You', handle: 'you', bio: 'Collecting places, one at a time.', avatar: USERS.u_me.avatar },
    // Who is signed in, and how the last sync went. Null account = local only.
    account: null,
    sync: { status: 'idle', at: null, error: null },
    // Trips deleted on this phone that the server may still have (see deleteTrip).
    deletedTrips: [],
    // Other removals the server may not have yet — kept so a pull can't bring
    // them back (sync.js pushDeletions): places taken off To Visit, deleted
    // photos and reviews, likes taken back.
    unsavedPlaces: [], deletedPosts: [], deletedReviews: [], unliked: [],
    // People this account has blocked: their photos, comments and reviews are
    // not shown, and they cannot add you to a trip (lib/safety.js).
    blocked: [],
    // Blocks and unblocks the server hasn't confirmed yet: [{ id, on }].
    pendingBlocks: [],
    // The rider's emergency details, shown on the phone's lock screen while a
    // ride is on (lib/riderId.js). Health data: it syncs to the rider's own
    // account and nowhere else (supabase/rider-safety.sql).
    safety: { bloodGroup: '', emergencyName: '', emergencyPhone: '', insured: false, updatedAt: 0 },
  }
}

/* ------------------------------------------------------- emergency details */

export const selectSafety = memo((s) => s.safety ?? { bloodGroup: '', emergencyName: '', emergencyPhone: '', insured: false, updatedAt: 0 })

/** Saved here first; sync.js sends it to the rider's own row when signed in. */
export function setRiderSafety(patch) {
  set({ ...state, safety: { ...selectSafety(state), ...patch, updatedAt: Date.now() } })
}

/** The server's copy, when it is newer than this phone's. */
export function applyRemoteSafety(row) {
  const at = row?.updatedAt ?? 0
  if (at <= (state.safety?.updatedAt ?? 0)) return
  set({ ...state, safety: { ...selectSafety(state), ...row } })
}

/** Raw state, for the sync layer. Components use useStore instead. */
export const getState = () => state

export function setSyncState(patch) {
  set({ ...state, sync: { ...state.sync, ...patch } })
}

export function setAccount(account) {
  set({
    ...state,
    account,
    profile: account
      ? { ...state.profile, name: account.name ?? state.profile.name, handle: account.handle ?? state.profile.handle }
      : state.profile,
  })
}

/**
 * Fold a server snapshot into local state.
 *
 * Anything of mine that has not reached the server yet is kept: a photo taken
 * in a tunnel must not vanish because the pull that followed did not include
 * it. Remote wins for everything else.
 */
export function applyRemote(remote, userId) {
  const mineLocally = (rows, key) => rows.filter((r) => r[key] === ME || r[key] === userId)
  const remoteIds = new Set(remote.posts.map((p) => p.id))
  const unsynced = mineLocally(state.posts, 'authorId').filter((p) => !remoteIds.has(p.id))

  const remoteReviewIds = new Set(remote.reviews.map((r) => r.id))
  const unsyncedReviews = mineLocally(state.reviews, 'userId').filter((r) => !remoteReviewIds.has(r.id))

  // A trip deleted here stays deleted, even if this snapshot still has it.
  const deleted = new Set(state.deletedTrips ?? [])
  const remoteTrips = remote.trips.filter((t) => !deleted.has(t.id))
  // Same for everything else removed here that the server may not have caught up with.
  const gonePosts = new Set(state.deletedPosts ?? [])
  const goneReviews = new Set(state.deletedReviews ?? [])
  const unsaved = new Set(state.unsavedPlaces ?? [])
  const unliked = new Set(state.unliked ?? [])
  // What the server has, with this phone's changes it hasn't taken yet on top.
  const blocked = new Set(remote.blocked ?? state.blocked ?? [])
  for (const p of state.pendingBlocks ?? []) { if (p.on) blocked.add(p.id); else blocked.delete(p.id) }
  const remotePosts = remote.posts
    .filter((p) => !gonePosts.has(p.id) && !blocked.has(p.authorId))
    .map((p) => (blocked.size ? { ...p, comments: p.comments.filter((c) => !blocked.has(c.userId)) } : p))
    .map((p) => (unliked.has(p.id) && p.likedByMe ? { ...p, likedByMe: false, likes: Math.max(0, p.likes - 1) } : p))
  const remoteReviews = remote.reviews.filter((r) => !goneReviews.has(r.id) && !blocked.has(r.userId))

  set({
    ...state,
    users: { ...state.users, ...remote.users },
    // The server keeps only a catalogue place's name and position; the
    // build's copy (photo, credits, kind) stays.
    places: { ...state.places, ...remote.places, ...CATALOGUE_BY_ID },
    posts: [...unsynced, ...remotePosts],
    blocked: [...blocked],
    reviews: [...unsyncedReviews, ...remoteReviews],
    // Saves the server couldn't take yet stay, rather than vanishing on pull;
    // a place taken off To Visit here stays off.
    savedPlaces: [...new Set([
      ...remote.savedPlaces,
      ...state.savedPlaces.filter((id) => remote.heldSaves?.includes(id)),
    ])].filter((id) => !unsaved.has(id)),
    // The server holds the itinerary; the phone holds what the server doesn't —
    // whether it's a group trip and who was added. Replacing the list outright
    // turned every group trip back into a solo one with nobody on it. A trip
    // someone else owns is always a group trip. Our own trips that haven't
    // reached the server yet are kept.
    trips: [
      ...remoteTrips.map(({ groupHint, ...rt }) => {
        const local = state.trips.find((t) => t.id === rt.id)
        const shared = Boolean(rt.ownerId && userId && rt.ownerId !== userId)
        return {
          ...rt, kind: shared || groupHint ? 'group' : local?.kind ?? 'solo', members: local?.members ?? [],
          // Who may see you is decided on this phone and never sent anywhere,
          // so the server's copy of a trip knows nothing about it. Rebuilding
          // the trip from that copy dropped both fields, and a missing
          // `sharing` reads as on: turn sharing off and the next sync — every
          // few seconds with the rider panel open — switched it back on and
          // started broadcasting again (reported 2026-09-13).
          ...(local && 'sharing' in local ? { sharing: local.sharing } : {}),
          ...(local?.hiddenFrom ? { hiddenFrom: local.hiddenFrom } : {}),
          // A server without the completed_at column (trip-completed.sql not
          // run yet) says nothing about it; the phone's answer stands.
          ...(!('completedAt' in rt) && local?.completedAt ? { completedAt: local.completedAt } : {}),
          // A captain's change not yet sent stands over the server's copy.
          ...(local?.captainEdit ? {
            title: local.title, start: local.start, end: local.end, notes: local.notes, stops: local.stops, bookings: local.bookings,
            captainEdit: local.captainEdit,
          } : {}),
        }
      }),
      ...state.trips.filter((t) => !remote.trips.some((rt) => rt.id === t.id) && (!t.ownerId || t.ownerId === userId)),
    ],
  })
}

// Early installs started everyone on a stock photo of a stranger. Anyone still
// carrying it gets the drawn initial instead; a photo they chose is untouched.
const STOCK_ME = /^https:\/\/i\.pravatar\.cc\/.*trekov-me/
const ownAvatar = (avatar, handle) => (!avatar || STOCK_ME.test(avatar) ? defaultAvatar(handle || 'you') : avatar)

/**
 * Clear out the made-up demo users, their posts and reviews, and the demo
 * places — unless the traveller's own content (a photo, a save, a trip stop)
 * points at one, in which case that place stays.
 */
function retireDemo(st) {
  const fake = new Set(RETIRED_DEMO.users)
  const posts = st.posts.filter((p) => !fake.has(p.authorId))
  const reviews = (st.reviews ?? []).filter((r) => !fake.has(r.userId))
  const used = new Set([
    ...posts.map((p) => p.placeId), ...(st.savedPlaces ?? []),
    ...(st.trips ?? []).flatMap((t) => t.stops.map((x) => x.placeId)),
  ])
  const places = Object.fromEntries(Object.entries(st.places)
    .filter(([id]) => !RETIRED_DEMO.places.includes(id) || used.has(id)))
  const users = Object.fromEntries(Object.entries(st.users ?? {}).filter(([id]) => !fake.has(id)))
  const notifications = (st.notifications ?? []).filter((n) => !fake.has(n.by))
  return { ...st, posts, reviews, places, users, notifications }
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!saved) return initial()
    const base = initial()
    // Reconcile with the seed so demo content added since the last visit shows
    // up, without touching anything the user made.
    const seenPosts = new Set(saved.posts.map((p) => p.id))
    const seedById = new Map(POSTS.map((p) => [p.id, p]))
    // Seeded reviews gained `facts` after some installs had already saved them,
    // so refresh seed rows from the seed and keep the user's own untouched.
    const seedReviews = new Map(SEED_REVIEWS.map((r) => [r.id, r]))
    const savedReviews = saved.reviews ?? []
    const seenReviews = new Set(savedReviews.map((r) => r.id))
    const reviews = [
      ...savedReviews.map((r) => seedReviews.get(r.id) ?? r),
      ...SEED_REVIEWS.filter((r) => !seenReviews.has(r.id)),
    ]
    const profile = { ...base.profile, ...saved.profile }
    profile.avatar = ownAvatar(profile.avatar, profile.handle)
    const users = { ...base.users, ...saved.users }
    users.u_me = { ...users.u_me, avatar: ownAvatar(users.u_me?.avatar, profile.handle) }
    return retireDemo({
      ...base,
      ...saved,
      profile,
      users,
      // Catalogue places come from the build, so the build's copy wins (fixed
      // coordinates, new photos); places the traveller added stay as saved.
      // Catalogue places the build no longer has (removed as unreachable,
      // say) go too, or they would linger in everyone's saved state.
      places: {
        ...Object.fromEntries(Object.entries(saved.places ?? {}).filter(([, p]) => p.source !== 'catalogue')),
        ...base.places,
      },
      reviews,
      posts: ([
        ...saved.posts.map((p) => (seedById.has(p.id) ? { ...p, media: seedById.get(p.id).media } : p)),
        ...POSTS.filter((p) => !seenPosts.has(p.id)).map((p) => ({ ...p, likedByMe: false })),
      ]),
    })
  } catch {
    return initial()
  }
}

let state = load()
const listeners = new Set()

// load() may have collapsed or reconciled things; write that back now rather
// than leaving superseded records on disk until the user's next action.
try { localStorage.setItem(KEY, JSON.stringify(state)) } catch {}

function set(next) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(state)) }
  catch (e) { console.warn('Trekov: could not persist state', e) }
  listeners.forEach((l) => l())
}

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l) }

export function useStore(selector = (s) => s) {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state))
}

/* --------------------------------- reads ---------------------------------- */

export const meId = ME
/** The id rows are written under: the account when signed in, else local. */
export const currentUserId = () => state.account?.id ?? ME
/** True for rows authored by this person, local or remote id. */
export const isMine = (id) => id === ME || (state.account && id === state.account.id)
export const getUser = (id) => state.users[id] ?? { id, name: 'Traveller', handle: id, avatar: '' }
export const getPlace = (id) => state.places[id]
export const getPost = (id) => state.posts.find((p) => p.id === id)

// Selectors build new arrays, so they must be memoised: useSyncExternalStore
// compares snapshots by identity. `state` only changes identity inside set(),
// which makes it a sound cache key.
function memo(fn) {
  let lastState, lastArg, lastResult, primed = false
  return (s, arg) => {
    if (primed && s === lastState && arg === lastArg) return lastResult
    lastState = s; lastArg = arg; lastResult = fn(s, arg); primed = true
    return lastResult
  }
}

const newest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt)

/** Every place, with the numbers the map markers need. */
export const selectPlaces = memo((s) => {
  const byPlace = new Map()
  for (const post of s.posts) {
    if (!byPlace.has(post.placeId)) byPlace.set(post.placeId, [])
    byPlace.get(post.placeId).push(post)
  }
  return Object.values(s.places).map((place) => {
    const posts = (byPlace.get(place.id) ?? []).sort(newest)
    return {
      ...place,
      postCount: posts.length,
      // No Trekov photo yet: the place's credited reference photo stands in
      // until someone posts a live one.
      cover: posts[0]?.media ?? (place.photo ? { type: 'image', src: place.photo.thumb, reference: true } : null),
      latestAt: posts[0]?.createdAt ?? null,
      saved: s.savedPlaces.includes(place.id),
    }
  })
})

export const selectPlace = memo((s, id) => selectPlaces(s).find((p) => p.id === id) ?? null)

/** Posts at one place, most recent first. A place keeps only one. */
export const selectPostsAt = memo((s, placeId) =>
  s.posts.filter((p) => p.placeId === placeId).sort(newest))

/** The photo currently holding a place's banner — the most recent one. */
export const selectLatestAt = memo((s, placeId) => selectPostsAt(s, placeId)[0] ?? null)

/** Everything else shot at a place, newest first, below the banner. */
export const selectOthersAt = memo((s, placeId) => selectPostsAt(s, placeId).slice(1))

/** How many of a place's photos are yours — the competitive bit. */
export const selectMyShareAt = memo((s, placeId) => {
  const all = selectPostsAt(s, placeId)
  return { mine: all.filter((p) => p.authorId === ME).length, total: all.length }
})

export const selectSavedPlaces = memo((s) =>
  s.savedPlaces.map((id) => selectPlaces(s).find((p) => p.id === id)).filter(Boolean))

export const selectMyPosts = memo((s) => s.posts.filter((p) => p.authorId === ME).sort(newest))

/**
 * Most visited: ranked by how many *different people* have photographed a
 * place. Photos can only be taken in the app, at the place, so a distinct
 * photographer is the closest thing to a verified visit we have — far more
 * honest than counting saves, which are just intent.
 */
export const selectMostVisited = memo((s) => {
  const visitors = new Map()
  for (const post of s.posts) {
    if (!visitors.has(post.placeId)) visitors.set(post.placeId, new Set())
    visitors.get(post.placeId).add(post.authorId)
  }
  return selectPlaces(s)
    .map((p) => ({ ...p, visitors: visitors.get(p.id)?.size ?? 0 }))
    .filter((p) => p.visitors > 0)
    .sort((a, b) => b.visitors - a.visitors || b.postCount - a.postCount)
})

/**
 * Attraction of the month: most activity inside the current calendar month —
 * photos posted, then saves, then likes as a tie-break. Deterministic, and it
 * rotates on its own as the month turns.
 */
export const selectAttractionOfMonth = memo((s) => {
  const now = new Date()
  const sameMonth = (iso) => {
    const d = new Date(iso)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }
  const scored = selectPlaces(s).map((place) => {
    const posts = s.posts.filter((p) => p.placeId === place.id)
    const thisMonth = posts.filter((p) => sameMonth(p.createdAt))
    return {
      ...place,
      monthPhotos: thisMonth.length,
      monthLikes: thisMonth.reduce((n, p) => n + p.likes, 0),
      saved: s.savedPlaces.includes(place.id),
    }
  })
  const ranked = scored
    .filter((p) => p.monthPhotos > 0)
    .sort((a, b) => b.monthPhotos - a.monthPhotos || b.monthLikes - a.monthLikes)
  // Nothing shot this month yet: fall back to the most photographed overall
  // rather than showing an empty slot.
  return ranked[0] ?? selectMostVisited(s)[0] ?? null
})

/** Places added recently, newest first — what the "new place" alerts point at. */
export const selectNewPlaces = memo((s) =>
  Object.values(s.places)
    .filter((p) => p.addedAt)
    .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))
    .slice(0, 12)
    .map((p) => selectPlaces(s).find((x) => x.id === p.id) ?? p))

export const selectNotifications = memo((s) =>
  [...s.notifications].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 40))

export const selectUnreadCount = memo((s) => s.notifications.filter((n) => !n.read).length)

/* -------------------------------- reviews --------------------------------- */

/** What a place is rated on. Order is the display order. */
export const RATING_CATEGORIES = [
  { id: 'view',        label: 'View' },
  { id: 'cleanliness', label: 'Cleanliness' },
  { id: 'access',      label: 'Easy to visit' },
  { id: 'safety',      label: 'Safety' },
  { id: 'facilities',  label: 'Facilities' },
]

/**
 * Practical facts travellers report about a place, alongside their ratings.
 * Each is a single choice, so the place's answer is simply what most people
 * reported — with the count shown, because "3 of 4 say" is honest and "yes"
 * on its own is not.
 */
export const FACT_FIELDS = [
  {
    id: 'transport', label: 'Best way in',
    options: [
      ['car', 'Car'], ['bike', 'Bike'], ['4x4', '4x4 only'],
      ['public', 'Bus / train'], ['trek', 'On foot'],
    ],
  },
  {
    id: 'food', label: 'Food nearby',
    options: [['plenty', 'Plenty'], ['limited', 'Limited'], ['none', 'None — carry it']],
  },
  {
    id: 'water', label: 'Drinking water',
    options: [['available', 'Available'], ['carry', 'Carry your own']],
  },
  {
    id: 'camping', label: 'Camping',
    options: [['yes', 'Allowed'], ['permit', 'With a permit'], ['no', 'Not allowed']],
  },
]

/** Majority answer per fact, with how many agreed out of how many reported. */
export const selectFactsAt = memo((s, placeId) => {
  const reviews = s.reviews.filter((r) => r.placeId === placeId)
  const out = {}
  for (const field of FACT_FIELDS) {
    const answers = reviews.map((r) => r.facts?.[field.id]).filter(Boolean)
    if (!answers.length) continue
    const tally = answers.reduce((acc, a) => ({ ...acc, [a]: (acc[a] ?? 0) + 1 }), {})
    const [value, agree] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]
    out[field.id] = {
      value,
      label: field.options.find(([id]) => id === value)?.[1] ?? value,
      agree,
      of: answers.length,
    }
  }
  return Object.keys(out).length ? out : null
})

export const selectReviewsAt = memo((s, placeId) =>
  s.reviews.filter((r) => r.placeId === placeId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)))

export const selectMyReviewAt = memo((s, placeId) =>
  s.reviews.find((r) => r.placeId === placeId && r.userId === ME) ?? null)

/** Per-category averages and an overall, or null when nobody has rated it. */
export const selectRatingsAt = memo((s, placeId) => {
  const reviews = selectReviewsAt(s, placeId)
  if (!reviews.length) return null
  const byCategory = {}
  for (const { id } of RATING_CATEGORIES) {
    const scores = reviews.map((r) => r.ratings?.[id]).filter((n) => typeof n === 'number')
    if (scores.length) byCategory[id] = scores.reduce((a, b) => a + b, 0) / scores.length
  }
  const all = Object.values(byCategory)
  return {
    count: reviews.length,
    byCategory,
    overall: all.length ? all.reduce((a, b) => a + b, 0) / all.length : null,
  }
})

/** Write or replace your review of a place — one per person, per place. */
export function upsertReview(placeId, { ratings, note, facts }) {
  const existing = state.reviews.find((r) => r.placeId === placeId && r.userId === ME)
  const review = {
    id: existing?.id ?? newId('r'),
    placeId, userId: ME,
    ratings: { ...existing?.ratings, ...ratings },
    facts: { ...existing?.facts, ...facts },
    note: note ?? existing?.note ?? '',
    createdAt: new Date().toISOString(),
  }
  set({
    ...state,
    reviews: existing
      ? state.reviews.map((r) => (r.id === existing.id ? review : r))
      : [review, ...state.reviews],
  })
  return review.id
}

// Pending-removal lists (see initial()): add an id, or drop it when undone.
const addId = (list, id) => [...new Set([...(list ?? []), id])]
const dropId = (list, id) => (list ?? []).filter((x) => x !== id)

export function removeReview(reviewId) {
  set({
    ...state,
    reviews: state.reviews.filter((r) => r.id !== reviewId),
    deletedReviews: addId(state.deletedReviews, reviewId),
  })
}

export const selectTrips = memo((s) => s.trips)
export const selectTrip = memo((s, id) => s.trips.find((t) => t.id === id) ?? null)

// Must be memoised: `?? []` hands back a fresh array on every call, and
// useSyncExternalStore compares snapshots by identity — unmemoised it
// re-renders forever.
export const selectBookings = memo((s, tripId) => s.trips.find((t) => t.id === tripId)?.bookings ?? [])

export const selectPlaceSearch = memo((s, q) => {
  const term = (q ?? '').trim().toLowerCase()
  const all = selectPlaces(s)
  if (!term) return all
  return all.filter((p) =>
    `${p.name} ${p.region} ${p.country} ${p.blurb ?? ''}`.toLowerCase().includes(term))
})

/* --------------------------------- writes --------------------------------- */

export function toggleLike(postId) {
  const liked = Boolean(state.posts.find((p) => p.id === postId)?.likedByMe)
  set({
    ...state,
    posts: state.posts.map((p) =>
      p.id === postId
        ? { ...p, likedByMe: !p.likedByMe, likes: p.likes + (p.likedByMe ? -1 : 1) }
        : p),
    // Taking a like back has to reach the server too, or the next pull restores it.
    unliked: liked ? addId(state.unliked, postId) : dropId(state.unliked, postId),
  })
}

export function addComment(postId, text) {
  const body = text.trim()
  if (!body) return
  const comment = { id: newId('c'), userId: ME, text: body, createdAt: new Date().toISOString() }
  set({
    ...state,
    posts: state.posts.map((p) => (p.id === postId ? { ...p, comments: [...p.comments, comment] } : p)),
  })
}

/** The core action: put a place on your To Visit list. */
export function toggleSavePlace(placeId) {
  const saved = state.savedPlaces.includes(placeId)
  set({
    ...state,
    savedPlaces: saved
      ? state.savedPlaces.filter((id) => id !== placeId)
      : [placeId, ...state.savedPlaces],
    // Taking a place off To Visit is sent to the server (sync.js pushDeletions);
    // before, the next pull put it straight back (Punit, 2026-09-12).
    unsavedPlaces: saved ? addId(state.unsavedPlaces, placeId) : dropId(state.unsavedPlaces, placeId),
  })
  return !saved
}

export function upsertPlace(place) {
  const id = place.id ?? newId('pl')
  const existing = state.places[id]
  set({
    ...state,
    places: {
      ...state.places,
      [id]: {
        ...place,
        id,
        // Provenance, so "new places" can be listed and announced.
        addedAt: existing?.addedAt ?? new Date().toISOString(),
        addedBy: existing?.addedBy ?? ME,
      },
    },
  })
  return id
}

/* ----------------------------- notifications ------------------------------ */

/** Record an announcement locally. `incoming` marks one that arrived from elsewhere. */
export function addNotification({ type, placeId, by, at, id }, { incoming = false } = {}) {
  const note = {
    id: id ?? newId('n'),
    type, placeId, by,
    at: at ?? new Date().toISOString(),
    // Your own actions are not news to you.
    read: !incoming,
  }
  if (state.notifications.some((n) => n.id === note.id)) return note
  set({ ...state, notifications: [note, ...state.notifications].slice(0, 60) })
  return note
}

export function markNotificationsRead() {
  if (!state.notifications.some((n) => !n.read)) return
  set({ ...state, notifications: state.notifications.map((n) => ({ ...n, read: true })) })
}

/** Adopt a place announced by someone else so their alert resolves to something. */
export function adoptPlace(place) {
  if (!place?.id || state.places[place.id]) return
  set({ ...state, places: { ...state.places, [place.id]: place } })
}

/* -------------------------------- bookings -------------------------------- */

export function addBooking(tripId, booking) {
  const entry = { id: newId('b'), ...booking }
  editPlan(tripId, (t) => ({ ...t, bookings: [...(t.bookings ?? []), entry] }))
  return entry.id
}

export const updateBooking = (tripId, bookingId, patch) =>
  editPlan(tripId, (t) => ({
    ...t, bookings: (t.bookings ?? []).map((b) => (b.id === bookingId ? { ...b, ...patch } : b)),
  }))

export const removeBooking = (tripId, bookingId) =>
  editPlan(tripId, (t) => ({ ...t, bookings: (t.bookings ?? []).filter((b) => b.id !== bookingId) }))

/**
 * Post a photo to a place. The newest photo takes the place's banner; earlier
 * ones stay, credited, in the list beneath it — so the banner is something to
 * win rather than something that destroys what came before.
 */
export async function createPost({ file, placeId, caption, tags, located = null }) {
  const id = newId('p')
  await putBlob(id, file)
  set({
    ...state,
    posts: [{
      id, placeId, authorId: ME, createdAt: new Date().toISOString(),
      media: { type: file.type.startsWith('video') ? 'video' : 'image', src: '', blobKey: id },
      caption, tags, likes: 0, likedByMe: false, comments: [],
      // { at, distanceM, accuracyM } — proof it was taken at the place
      located,
    }, ...state.posts],
  })
  return id
}

export async function deletePost(id) {
  const post = getPost(id)
  if (post?.media.blobKey) await delBlob(post.media.blobKey).catch(() => {})
  set({ ...state, posts: state.posts.filter((p) => p.id !== id), deletedPosts: addId(state.deletedPosts, id) })
}

/* ---------------------------------- trips --------------------------------- */

export function createTrip({ title, kind = 'solo', start = '', end = '', stops = [], notes = '' }) {
  const trip = {
    id: newId('t'), title: title.trim() || 'Untitled trip',
    // 'solo' or 'group' — a group trip carries companions and shares live
    // position while everyone is navigating it.
    kind,
    // The host is whoever made it; captainId is the rider they ask to lead.
    members: [], captainId: null, start, end, notes, stops, bookings: [],
    // Private unless the host opens it: see setVisibility.
    visibility: 'private',
  }
  set({ ...state, trips: [trip, ...state.trips] })
  return trip.id
}

const patchTrip = (id, fn) => set({ ...state, trips: state.trips.map((t) => (t.id === id ? fn(t) : t)) })

/**
 * Who may change a trip's name, dates, notes, itinerary and bookings (Punit,
 * 2026-09-21): the host, and the captain they named. Everyone else on a group
 * or public trip sees it as it is. A trip that has never reached the server
 * has no owner yet and is the maker's own.
 */
export function canEditTrip(trip, userId) {
  if (!trip) return false
  if (!trip.ownerId || !userId) return true
  return trip.ownerId === userId || (Boolean(trip.captainId) && trip.captainId === userId)
}

// The fields the captain may change — bookings too (Punit, 2026-09-21). The server keeps the host's copy, so a
// captain's edit is marked until sync.js has sent it (edit_trip_as_captain).
const PLAN_FIELDS = ['title', 'start', 'end', 'notes', 'stops', 'bookings']
const editPlan = (id, fn) => patchTrip(id, (t) => {
  const next = fn(t)
  if (next === t) return t
  const me = state.account?.id
  const captainOnly = t.ownerId && me && t.ownerId !== me && t.captainId === me
  return captainOnly ? { ...next, captainEdit: Date.now() } : next
})

export const updateTrip = (id, patch) => {
  if (Object.keys(patch).some((k) => PLAN_FIELDS.includes(k))) editPlan(id, (t) => ({ ...t, ...patch }))
  else patchTrip(id, (t) => ({ ...t, ...patch }))
}

/** A captain's edit has reached the server. */
export const captainEditSent = (id, at) =>
  patchTrip(id, (t) => (t.captainEdit && t.captainEdit <= at ? (({ captainEdit, ...rest }) => rest)(t) : t))

/**
 * A trip that has been ridden (Punit, 2026-09-21). It stays in the list, under
 * Completed, with its route, notes and reel — it just stops offering "Go live".
 * Finishing a public ride also takes it off Open Rides: nobody should be asking
 * to join a ride that is over. Reopening leaves it private; the host can open
 * it up again if it is on for another run.
 */
export const completeTrip = (id) =>
  patchTrip(id, (t) => ({ ...t, completedAt: new Date().toISOString(), visibility: 'private' }))
export const reopenTrip = (id) => patchTrip(id, (t) => ({ ...t, completedAt: null }))
export const isCompleted = (trip) => Boolean(trip?.completedAt)

/** Companions on a group trip. Stored on the trip; mirrored to Supabase when signed in. */
export function addMember(tripId, person) {
  patchTrip(tripId, (t) => (
    (t.members ?? []).some((m) => m.id === person.id)
      ? t
      : { ...t, kind: 'group', members: [...(t.members ?? []), person] }
  ))
}

export const removeMember = (tripId, personId) =>
  patchTrip(tripId, (t) => ({ ...t, members: (t.members ?? []).filter((m) => m.id !== personId) }))

export const selectMembers = memo((s, tripId) => s.trips.find((t) => t.id === tripId)?.members ?? [])

/**
 * Who leads the ride.
 *
 * The host — the trip's owner — names the captain: themselves, or any rider who
 * has accepted. It is kept on the trip so every phone shows the same one
 * (supabase/trip-roles.sql), and the server refuses anyone else's choice.
 */
export const setCaptain = (tripId, personId) =>
  patchTrip(tripId, (t) => ({ ...t, captainId: personId || null }))

/** The captain of a trip: whoever the host named, or the host until they name one. */
export const captainOf = (trip) => trip?.captainId ?? trip?.ownerId ?? null

/**
 * Who can find the ride.
 *
 * 'private' is the default and the old behaviour: only the host and the riders
 * they invited know it exists. 'public' lists it under Open rides — title,
 * dates, where it starts and ends, how many are going — so other riders can ask
 * to come along. It opens nothing else: the notes, the bookings, the live
 * positions and the voice channel stay with the people on the trip, and the
 * host still approves every rider (supabase/trip-visibility.sql).
 */
export const setVisibility = (tripId, visibility) =>
  patchTrip(tripId, (t) => ({ ...t, visibility: visibility === 'public' ? 'public' : 'private' }))

/** A trip is private unless its host has opened it. */
export const isPublic = (trip) => trip?.visibility === 'public'

/* ------------------------------------------------------ location sharing --
 * Who on a trip may see where you are.
 *
 * Two switches rather than one, because "I am on this trip" and "you may
 * watch me move" are different consents. `sharing` is the master: off means
 * nobody sees you, whatever else is set. `hiddenFrom` excludes named people
 * while the rest of the group still sees you — for the times you want the
 * group map without one particular person on it.
 *
 * Default is on, because a group trip whose map is empty by default is a
 * feature nobody finds. It is one tap to leave.
 */
export const selectSharing = memo((s, tripId) => {
  const t = s.trips.find((x) => x.id === tripId)
  return { on: t?.sharing !== false, hiddenFrom: t?.hiddenFrom ?? [] }
})

export const setSharing = (tripId, on) => patchTrip(tripId, (t) => ({ ...t, sharing: on }))

export const toggleSharingWith = (tripId, memberId) =>
  patchTrip(tripId, (t) => {
    const hidden = t.hiddenFrom ?? []
    return {
      ...t,
      hiddenFrom: hidden.includes(memberId)
        ? hidden.filter((id) => id !== memberId)
        : [...hidden, memberId],
    }
  })

/** True when this trip's position may be broadcast at all. */
export const isSharing = (tripId) => {
  const t = state.trips.find((x) => x.id === tripId)
  return t?.sharing !== false
}
/**
 * Deletes a trip here and remembers that it did, until the server has caught
 * up (sync.js pushDeletions). Dropping it from the list alone meant the next
 * sync pulled it straight back from the server (Punit, 2026-09-11).
 */
export const deleteTrip = (id) => set({
  ...state,
  trips: state.trips.filter((t) => t.id !== id),
  deletedTrips: [...new Set([...(state.deletedTrips ?? []), id])],
})

/**
 * The server has caught up with these removals, so there is nothing left to
 * remember. `kind`: deletedTrips, unsavedPlaces, deletedPosts, deletedReviews or unliked.
 */
export function forgetDeleted(kind, ids) {
  if (!ids.length) return
  set({ ...state, [kind]: (state[kind] ?? []).filter((id) => !ids.includes(id)) })
}
export const forgetDeletedTrips = (ids) => forgetDeleted('deletedTrips', ids)

export function addStop(tripId, placeId) {
  editPlan(tripId, (t) =>
    t.stops.some((s) => s.placeId === placeId) ? t : { ...t, stops: [...t.stops, { placeId, note: '' }] })
}

export const removeStop = (tripId, placeId) =>
  editPlan(tripId, (t) => ({ ...t, stops: t.stops.filter((s) => s.placeId !== placeId) }))

export const setStopNote = (tripId, placeId, note) =>
  editPlan(tripId, (t) => ({
    ...t, stops: t.stops.map((s) => (s.placeId === placeId ? { ...s, note } : s)),
  }))

/** Move a stop up or down the itinerary. */
export function moveStop(tripId, index, delta) {
  editPlan(tripId, (t) => {
    const to = index + delta
    if (to < 0 || to >= t.stops.length) return t
    const stops = [...t.stops]
    ;[stops[index], stops[to]] = [stops[to], stops[index]]
    return { ...t, stops }
  })
}

/** Adopt a trip that arrived over a share link. */
export function importTrip(trip) {
  const places = { ...state.places }
  for (const p of trip.places ?? []) if (!places[p.id]) places[p.id] = p
  const copy = {
    id: newId('t'),
    title: trip.title, start: trip.start ?? '', end: trip.end ?? '', notes: trip.notes ?? '',
    stops: (trip.stops ?? []).filter((s) => places[s.placeId]),
    // A copy from a link is your own plan, not a seat on someone's group ride —
    // links carry the original's kind (for the invite page to show), but the
    // copy stays solo, as it always has.
    kind: 'solo',
    members: [],
    bookings: [],
  }
  set({ ...state, places, trips: [copy, ...state.trips] })
  return copy.id
}

/** The server has a block (or unblock) now; stop retrying it. */
export function forgetPendingBlock(userId, on) {
  set({ ...state, pendingBlocks: (state.pendingBlocks ?? []).filter((p) => !(p.id === userId && p.on === on)) })
}

/** Hide everything from someone at once; lib/safety.js tells the server. */
export function setBlocked(userId, on) {
  const blocked = new Set(state.blocked ?? [])
  if (on) blocked.add(userId); else blocked.delete(userId)
  set({
    ...state,
    blocked: [...blocked],
    pendingBlocks: [...(state.pendingBlocks ?? []).filter((p) => p.id !== userId), { id: userId, on }],
    posts: on
      ? state.posts.filter((p) => p.authorId !== userId).map((p) => ({ ...p, comments: p.comments.filter((c) => c.userId !== userId) }))
      : state.posts,
    reviews: on ? state.reviews.filter((r) => r.userId !== userId) : state.reviews,
  })
}

export function updateProfile(patch) {
  set({ ...state, profile: { ...state.profile, ...patch } })
}

export function resetAll() {
  localStorage.removeItem(KEY)
  set(initial())
}
