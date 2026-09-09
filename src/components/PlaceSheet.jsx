import { useState } from 'react'
import {
  selectPlace, selectLatestAt, selectOthersAt, selectTrips, addStop, createTrip, getUser,
  meId, RATING_CATEGORIES, selectRatingsAt, toggleSavePlace, useStore,
} from '../lib/store'
import { ago, compact, formatDateTime, mapsUrl } from '../lib/format'
import { CalendarIcon, CloseIcon, HeartIcon, NavIcon, PlusIcon, SaveIcon, StarIcon } from './Icons'
import Media from './Media'
import Portal from './Portal'
import PhotoViewer from './PhotoViewer'
import ReviewSheet from './ReviewSheet'

/** What you get when you tap a place on the map: its photos, newest first. */
export default function PlaceSheet({ placeId, onClose, onNavigate }) {
  const [openPost, setOpenPost] = useState(null)
  const [rating, setRating] = useState(false)
  const [tripMenu, setTripMenu] = useState(false)
  const [toast, setToast] = useState('')

  const place = useStore((s) => selectPlace(s, placeId))
  // The newest photo holds the banner; the rest are listed beneath it.
  const post = useStore((s) => selectLatestAt(s, placeId))
  const others = useStore((s) => selectOthersAt(s, placeId))
  const ratings = useStore((s) => selectRatingsAt(s, placeId))
  const trips = useStore(selectTrips)

  if (!place) return null

  const author = post ? getUser(post.authorId) : null

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 1700) }

  function addTo(tripId) {
    addStop(tripId, place.id)
    setTripMenu(false)
    flash(`Added to ${trips.find((t) => t.id === tripId).title}`)
  }

  function addToNewTrip() {
    const id = createTrip({ title: `${place.region} trip`, stops: [{ placeId: place.id, note: '' }] })
    setTripMenu(false)
    flash('New trip started')
    return id
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[1000] flex items-end justify-center" role="dialog" aria-label={place.name}>
        <button className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} aria-label="Close" />

        <div className="sheet-up relative tk-shell h-[86vh] flex flex-col rounded-t-3xl border-t border-line
                        bg-ink overflow-hidden">
          {/* The photo leads.
              A place sheet where the picture sits below the fold is a page
              about a place; the picture is the reason anyone opened it, and
              on this app it is also the thing people compete for. */}
          <div className="relative shrink-0">
            {post ? (
              <button onClick={() => setOpenPost(post.id)} className="block w-full text-left">
                <Media media={post.media} alt={place.name}
                       className="w-full aspect-[16/11] object-cover bg-raised" />
                <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-brand text-ink
                                 text-[10px] font-bold uppercase tracking-[0.1em] px-2.5 py-1">
                  <StarIcon size={11} filled /> Featured
                  {post.authorId === meId && <span className="font-extrabold">· yours</span>}
                </span>
              </button>
            ) : (
              <div className="w-full aspect-[16/11] bg-raised flex flex-col items-center justify-center
                              text-center px-8">
                <p className="text-sm text-mist">No photo here yet.</p>
                <p className="mt-1 text-xs text-mist">Take the first one and it holds the banner.</p>
              </div>
            )}

            {/* The name sits on the image, so the picture keeps the full width
                instead of a title bar taking a slice off the top. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 pt-16 px-5 pb-3
                            bg-gradient-to-t from-ink via-ink/85 to-transparent">
              <h2 className="text-xl font-semibold leading-tight truncate">{place.name}</h2>
              <p className="text-sm text-mist truncate">{place.region} · {place.country}</p>
            </div>

            <button onClick={onClose}
                    className="absolute top-3 right-3 rounded-full bg-black/55 backdrop-blur-sm p-1.5
                               text-white/90 hover:text-white"
                    aria-label="Close">
              <CloseIcon size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="px-5 pt-3 pb-4 border-b border-line">
              {place.blurb && <p className="text-sm text-white/85 leading-snug">{place.blurb}</p>}

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {place.bestTime && (
                  <span className="inline-flex items-center gap-1.5 text-sun/90 bg-sun/10 rounded-full px-2.5 py-1">
                    <CalendarIcon size={13} /> Best {place.bestTime}
                  </span>
                )}
                <span className="text-mist">
                  {place.postCount} photo{place.postCount === 1 ? '' : 's'}
                </span>
                <a href={mapsUrl(place)} target="_blank" rel="noreferrer" className="text-mist ml-auto">
                  Open in Google Maps
                </a>
              </div>

              {/* Navigating is the point of opening a place, so it gets the
                  primary button rather than a link buried in the meta row. */}
              <button onClick={() => onNavigate?.(place.id)}
                      className="mt-3 w-full flex items-center justify-center gap-2 rounded-full bg-brand text-ink
                                 py-3 text-sm font-semibold active:scale-[.99] transition">
                <NavIcon size={18} filled /> Navigate here
              </button>

              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => flash(toggleSavePlace(place.id) ? 'Saved to To Visit' : 'Removed from To Visit')}
                  aria-pressed={place.saved}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold border transition
                              ${place.saved ? 'bg-brand/15 text-brand border-brand' : 'border-line hover:border-brand hover:text-brand'}`}>
                  <SaveIcon size={18} filled={place.saved} />
                  {place.saved ? 'Saved' : 'Save place'}
                </button>
                <button onClick={() => setTripMenu((v) => !v)}
                        className="flex-1 flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold
                                   border border-line hover:border-brand hover:text-brand transition">
                  <PlusIcon size={18} /> Add to trip
                </button>
              </div>

              {tripMenu && (
                <ul className="mt-2 rounded-2xl border border-line bg-surface divide-y divide-line overflow-hidden">
                  {trips.map((t) => (
                    <li key={t.id}>
                      <button onClick={() => addTo(t.id)} className="w-full text-left px-4 py-2.5 text-sm hover:bg-raised">
                        {t.title} <span className="text-mist">· {t.stops.length} stops</span>
                      </button>
                    </li>
                  ))}
                  <li>
                    <button onClick={addToNewTrip} className="w-full text-left px-4 py-2.5 text-sm text-brand font-medium hover:bg-raised">
                      + Start a new trip
                    </button>
                  </li>
                </ul>
              )}

              <button onClick={() => setRating(true)}
                      className="mt-2 w-full rounded-2xl border border-line hover:border-brand/60 transition p-3 text-left">
                {ratings ? (
                  <>
                    <div className="flex items-baseline gap-2">
                      <span className="text-lg font-semibold tabular-nums">{ratings.overall.toFixed(1)}</span>
                      <span className="text-xs text-mist">/ 5 · {ratings.count} review{ratings.count === 1 ? '' : 's'}</span>
                      <span className="ml-auto text-xs text-brand font-semibold">Rate it</span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {RATING_CATEGORIES.filter((c) => ratings.byCategory[c.id] != null).map((c) => (
                        <div key={c.id} className="flex items-center gap-2">
                          <span className="text-[11px] text-mist w-24 shrink-0">{c.label}</span>
                          <span className="h-1.5 flex-1 rounded-full bg-raised overflow-hidden">
                            <span className="block h-full bg-brand"
                                  style={{ width: `${(ratings.byCategory[c.id] / 5) * 100}%` }} />
                          </span>
                          <span className="text-[11px] text-mist tabular-nums w-7 text-right">
                            {ratings.byCategory[c.id].toFixed(1)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <span className="flex items-center justify-between">
                    <span className="text-sm text-mist">No ratings yet</span>
                    <span className="text-xs text-brand font-semibold">Be the first to rate</span>
                  </span>
                )}
              </button>
            </div>

            {post && (
              <>
                {/* Whose photo is on the banner, and when they took it. */}
                <button onClick={() => setOpenPost(post.id)} className="w-full text-left">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <img src={getUser(post.authorId).avatar} alt="" className="size-9 rounded-full object-cover shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate leading-tight">@{getUser(post.authorId).handle}</p>
                      <p className="text-xs text-mist truncate">
                        {formatDateTime(post.createdAt)} · {ago(post.createdAt)}
                      </p>
                    </div>
                    <span className="flex items-center gap-1 text-xs text-mist shrink-0">
                      <HeartIcon size={12} /> {compact(post.likes)}
                    </span>
                  </div>
                  {post.caption && (
                    <p className="px-4 pb-3 text-sm text-white/85 leading-snug">{post.caption}</p>
                  )}
                </button>

                <p className="px-4 pb-3 text-[11px] text-mist">
                  The newest photo holds the banner. Post one here to take it.
                </p>

                {others.length > 0 && (
                  <div className="border-t border-line">
                    <h3 className="px-4 pt-3 pb-2 text-xs uppercase tracking-[0.14em] text-mist">
                      Also shot here · {others.length}
                    </h3>
                    <ul className="pb-2">
                      {others.map((o) => {
                        const u = getUser(o.authorId)
                        return (
                          <li key={o.id}>
                            <button onClick={() => setOpenPost(o.id)}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface">
                              <Media media={o.media} alt="" className="size-14 rounded-xl object-cover shrink-0 bg-raised" />
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium truncate">
                                  @{u.handle}{o.authorId === meId && <span className="text-brand"> · you</span>}
                                </span>
                                <span className="block text-[11px] text-mist truncate">
                                  {formatDateTime(o.createdAt)}
                                </span>
                              </span>
                              <span className="flex items-center gap-1 text-[11px] text-mist shrink-0">
                                <HeartIcon size={11} /> {compact(o.likes)}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>

          {toast && (
            <div className="absolute left-1/2 -translate-x-1/2 bottom-6 rounded-full bg-white text-ink
                            text-sm font-medium px-4 py-2 shadow-lg pointer-events-none">
              {toast}
            </div>
          )}
        </div>

        {openPost && <PhotoViewer postId={openPost} onClose={() => setOpenPost(null)} />}
        {rating && <ReviewSheet place={place} onClose={() => setRating(false)} />}
      </div>
    </Portal>
  )
}
