import { useEffect, useState } from 'react'
import {
  deleteTrip, getPlace, moveStop, removeStop, setStopNote, updateTrip, useStore,
} from '../lib/store'
import { encodeTrip, shareLink } from '../lib/share'
import { mapsUrl } from '../lib/format'
import { distance as straightLine, formatDistance, formatDuration } from '../lib/geo'
import { getTripRoute } from '../lib/route'
import { baseOf } from '../lib/vehicleArt'
import { BackIcon, CalendarIcon, CloseIcon, PlusIcon, SendIcon } from './Icons'
import AddStop from './AddStop'
import Bookings from './Bookings'
import TripSuggestions from './TripSuggestions'
import Invite from './Invite'

// Road distance and time between consecutive stops, for the vehicle chosen
// last in navigation (bikes route as two-wheelers). Kept for the session so
// reopening a trip doesn't pay for another routing call.
const legCache = new Map()
const lastVehicle = () => { try { return localStorage.getItem('trekov.vehicle') || 'car' } catch { return 'car' } }
const routeMode = baseOf

function useLegs(stops) {
  const mode = routeMode(lastVehicle())
  const pts = stops.map((s) => ({ lat: s.place.lat, lng: s.place.lng }))
  const key = mode + '|' + pts.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(';')
  const [legs, setLegs] = useState(() => legCache.get(key) ?? null)
  useEffect(() => {
    if (pts.length < 2) { setLegs(null); return }
    if (legCache.has(key)) { setLegs(legCache.get(key)); return }
    // Straight-line first, so there is always something to show; replaced by
    // the road route when it arrives.
    const rough = pts.slice(1).map((p, i) => ({ distance: straightLine(pts[i], p), duration: null, rough: true }))
    setLegs(rough)
    let live = true
    getTripRoute(pts[0], pts.slice(1), mode)
      .then((r) => {
        const road = r?.legs?.length === pts.length - 1 ? r.legs.map((l) => ({ distance: l.distance, duration: l.duration })) : null
        if (road) legCache.set(key, road)
        if (live && road) setLegs(road)
      })
      .catch(() => {})
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return { legs, mode }
}

const MSG = {
  shared: 'Shared.',
  copied: 'Link copied — paste it to anyone.',
  cancelled: '',
  failed: 'Could not copy. Long-press the link to copy it by hand.',
}

export default function TripDetail({ trip, onBack, onOpenPlace, onNavigate }) {
  const places = useStore((s) => s.places)
  const [msg, setMsg] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [addingStop, setAddingStop] = useState(false)
  const [link, setLink] = useState('')

  const stops = trip.stops.map((s) => ({ ...s, place: getPlace(s.placeId) })).filter((s) => s.place)
  const { legs, mode } = useLegs(stops)
  const total = legs?.reduce((n, l) => n + l.distance, 0)
  const totalTime = legs?.every((l) => l.duration != null) ? legs.reduce((n, l) => n + l.duration, 0) : null

  async function share() {
    const url = encodeTrip(trip, places)
    setLink(url)
    const result = await shareLink(url, trip.title)
    setMsg(MSG[result])
    if (result !== 'failed') setTimeout(() => setMsg(''), 2600)
  }

  const flash = (text) => { setMsg(text); setTimeout(() => setMsg(''), 2200) }

  const field = 'bg-raised rounded-xl px-3 py-2 text-sm outline-none placeholder:text-mist focus:ring-2 focus:ring-brand/50'

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-2 px-3 h-14
                         bg-ink/85 backdrop-blur-xl border-b border-line">
        <button onClick={onBack} className="text-mist hover:text-white p-1" aria-label="Back to trips">
          <BackIcon size={22} />
        </button>
        <input
          value={trip.title}
          onChange={(e) => updateTrip(trip.id, { title: e.target.value })}
          aria-label="Trip name"
          className="flex-1 min-w-0 bg-transparent text-lg font-semibold outline-none focus:bg-raised rounded-lg px-2 py-1"
        />
        <button onClick={share} className="flex items-center gap-1.5 text-sm font-semibold text-brand px-2" aria-label="Share trip">
          <SendIcon size={19} /> Share
        </button>
      </header>

      {/* Floats over the page: an inline banner pushed everything down and then
          snapped it back, so the next tap landed on the wrong button (a stop's
          remove ×, in testing). */}
      {msg && (
        <p role="status" className="fixed left-1/2 -translate-x-1/2 bottom-24 z-50 rounded-full bg-white text-ink
                                     text-sm font-medium px-4 py-2 shadow-lg pointer-events-none">{msg}</p>
      )}
      {link && (
        <p className="px-4 py-2 text-[11px] text-mist break-all border-b border-line">{link}</p>
      )}

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-mist">
            <span className="flex items-center gap-1.5"><CalendarIcon size={13} /> From</span>
            <input type="date" value={trip.start} onChange={(e) => updateTrip(trip.id, { start: e.target.value })} className={field} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-mist">
            <span className="flex items-center gap-1.5"><CalendarIcon size={13} /> To</span>
            <input type="date" value={trip.end} onChange={(e) => updateTrip(trip.id, { end: e.target.value })} className={field} />
          </label>
        </div>

        <textarea
          value={trip.notes} onChange={(e) => updateTrip(trip.id, { notes: e.target.value })}
          placeholder="Trip notes — permits, who's driving, what to book first…"
          className={`${field} w-full min-h-20 resize-none`}
        />

        <div className="flex items-center justify-between pt-2">
          <h2 className="text-xs uppercase tracking-[0.14em] text-mist">
            Itinerary{stops.length > 0 && ` · ${stops.length}`}
            {total > 0 && (
              <span className="normal-case tracking-normal text-mist">
                {' '}· {legs.some((l) => l.rough) ? '~' : ''}{formatDistance(total)}{totalTime ? ` · ${formatDuration(totalTime)}` : ''}
              </span>
            )}
          </h2>
          <button onClick={() => setAddingStop((v) => !v)}
                  className="flex items-center gap-1 text-xs font-semibold text-brand">
            <PlusIcon size={14} /> Add
          </button>
        </div>

        {addingStop && (
          <AddStop trip={trip} onAdded={(name) => { setAddingStop(false); flash(`${name} added`) }} />
        )}

        {stops.length === 0 && !addingStop ? (
          <p className="text-sm text-mist leading-relaxed py-6">
            No stops yet. Add one above, or open a place on the map and choose{' '}
            <span className="text-brand">Add to trip</span>.
          </p>
        ) : stops.length === 0 ? null : (
          <ol className="space-y-3">
            {stops.map((s, i) => (
              <li key={s.placeId}>
                {i > 0 && legs?.[i - 1] && (
                  <p className="flex items-center gap-2 pl-3 -mt-1 mb-2 text-xs text-mist tabular-nums">
                    <span className="text-brand">↓</span>
                    {legs[i - 1].rough
                      ? `~${formatDistance(legs[i - 1].distance)} straight line`
                      : `${formatDistance(legs[i - 1].distance)} · ${formatDuration(legs[i - 1].duration)} by ${mode}`}
                  </p>
                )}
              <div className="bg-surface border border-line rounded-2xl p-3">
                <div className="flex items-start gap-3">
                  <span className="grid place-items-center size-7 rounded-full bg-brand/15 text-brand
                                   text-xs font-bold shrink-0 tabular-nums">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <button onClick={() => onOpenPlace(s.placeId)} className="text-left">
                      <p className="font-semibold leading-tight truncate">{s.place.name}</p>
                      <p className="text-xs text-mist truncate">{s.place.region}</p>
                    </button>
                    {s.place.bestTime && (
                      <p className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-sun/90 bg-sun/10 rounded-full px-2 py-0.5">
                        <CalendarIcon size={11} /> {s.place.bestTime}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <button onClick={() => moveStop(trip.id, i, -1)} disabled={i === 0}
                            className="text-mist hover:text-white disabled:opacity-25 text-xs" aria-label="Move up">▲</button>
                    <button onClick={() => moveStop(trip.id, i, 1)} disabled={i === stops.length - 1}
                            className="text-mist hover:text-white disabled:opacity-25 text-xs" aria-label="Move down">▼</button>
                  </div>
                  <button onClick={() => removeStop(trip.id, s.placeId)}
                          className="text-mist hover:text-rose p-1 shrink-0" aria-label={`Remove ${s.place.name}`}>
                    <CloseIcon size={16} />
                  </button>
                </div>

                <input
                  value={s.note}
                  onChange={(e) => setStopNote(trip.id, s.placeId, e.target.value)}
                  placeholder="Note — nights, booking, who to call…"
                  className={`${field} w-full mt-2 text-xs`}
                />
                <div className="flex items-center gap-3 mt-2">
                  <button onClick={() => onNavigate?.(s.placeId, trip.id)}
                          className="text-xs text-brand font-semibold">Navigate here</button>
                  <a href={mapsUrl(s.place)} target="_blank" rel="noreferrer"
                     className="text-xs text-mist">Maps</a>
                </div>
              </div>
              </li>
            ))}
          </ol>
        )}

        <TripSuggestions trip={trip} places={places} onOpenPlace={onOpenPlace} />

        {trip.kind === 'group' ? (
          <Invite trip={trip} />
        ) : (
          <button onClick={() => updateTrip(trip.id, { kind: 'group' })}
                  className="w-full rounded-2xl border border-line hover:border-brand/60 transition p-3 text-left">
            <span className="block text-sm font-semibold">Make this a group trip</span>
            <span className="block text-[11px] text-mist mt-0.5">
              Invite people and see each other live on the map while you travel.
            </span>
          </button>
        )}

        <Bookings trip={trip} destination={stops.at(-1)?.place?.name ?? ''} />

        {/* An inline confirm, not window.confirm: Chrome suppresses native
            dialogs after a page has shown a few, and a suppressed confirm()
            returns false silently — so deleting simply stopped working with
            nothing to explain why. */}
        {confirmDelete ? (
          <div className="flex items-center gap-2 pt-4">
            <span className="text-xs text-mist flex-1">Delete “{trip.title}” for good?</span>
            <button onClick={() => setConfirmDelete(false)}
                    className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold">
              Keep
            </button>
            <button onClick={() => { deleteTrip(trip.id); onBack() }}
                    className="rounded-full bg-rose text-white px-3 py-1.5 text-xs font-semibold">
              Delete
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)}
                  className="text-xs text-mist underline underline-offset-4 hover:text-rose pt-4">
            Delete trip
          </button>
        )}
      </div>
    </>
  )
}
