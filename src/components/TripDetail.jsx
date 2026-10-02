import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  canEditTrip, completeTrip, deleteTrip, getPlace, isCompleted, moveStop, removeStop, reopenTrip, setStopNote, updateTrip, useStore,
} from '../lib/store'
import { shareLink, shortTripLink } from '../lib/share'
import { syncNow } from '../lib/sync'
import { mapsUrl } from '../lib/format'
import { distance as straightLine, formatDistance, formatDuration } from '../lib/geo'
import { getTripRoute } from '../lib/route'
import { baseOf } from '../lib/vehicleArt'
import { BackIcon, CalendarIcon, CloseIcon, DoneIcon, NavIcon, PlusIcon, ReelIcon, SendIcon } from './Icons'
import AddStop from './AddStop'
import Bookings from './Bookings'
import TripSuggestions from './TripSuggestions'
import Invite from './Invite'
import RouteVideo from './RouteVideo'

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
  // Where two-wheeler routing isn't available the car route stands in; say so.
  const [fellBack, setFellBack] = useState(false)
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
        if (live && road) { setLegs(road); setFellBack(Boolean(r.modeFallback)) }
      })
      .catch(() => {})
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return { legs, mode: fellBack ? 'car' : mode }
}

const MSG = {
  shared: 'Shared.',
  copied: 'Link copied — paste it to anyone.',
  cancelled: '',
  failed: 'Could not copy. Long-press the link to copy it by hand.',
}

export default function TripDetail({ trip, onBack, onOpenPlace, onNavigate }) {
  const places = useStore((s) => s.places)
  const account = useStore((s) => s.account)
  // A group trip if it says so, has members, or someone else owns it.
  const group = trip.kind === 'group' || trip.members?.length > 0 || Boolean(trip.ownerId && trip.ownerId !== account?.id)
  const [msg, setMsg] = useState('')
  const [addingStop, setAddingStop] = useState(false)
  const [link, setLink] = useState('')
  const [makingVideo, setMakingVideo] = useState(false)
  // Only the host and the captain change the plan (Punit, 2026-09-21).
  const editable = canEditTrip(trip, account?.id)

  const stops = trip.stops.map((s) => ({ ...s, place: getPlace(s.placeId) })).filter((s) => s.place)
  const { legs, mode } = useLegs(stops)
  const total = legs?.reduce((n, l) => n + l.distance, 0)
  const totalTime = legs?.every((l) => l.duration != null) ? legs.reduce((n, l) => n + l.duration, 0) : null

  async function share() {
    // Short when signed in and online; the long, self-contained link otherwise.
    const url = await shortTripLink(trip, places)
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
          readOnly={!editable}
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
        <p role="status" className="fixed left-1/2 -translate-x-1/2 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-50 rounded-full bg-white text-ink
                                     text-sm font-medium px-4 py-2 shadow-lg pointer-events-none">{msg}</p>
      )}
      {link && (
        <p className="px-4 py-2 text-[11px] text-mist break-all border-b border-line">{link}</p>
      )}

      <div className="p-4 space-y-4">
        <CompletedBanner trip={trip} />

        {!editable && (
          <p className="rounded-xl border border-line px-3 py-2 text-xs text-mist">
            Only the host and the captain can change this trip's name, dates, itinerary and bookings.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-mist min-w-0">
            <span className="flex items-center gap-1.5"><CalendarIcon size={13} /> From</span>
            <DateField value={trip.start} onChange={(start) => updateTrip(trip.id, { start })} className={field} disabled={!editable} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-mist min-w-0">
            <span className="flex items-center gap-1.5"><CalendarIcon size={13} /> To</span>
            <DateField value={trip.end} onChange={(end) => updateTrip(trip.id, { end })} className={field} disabled={!editable} />
          </label>
        </div>

        <NotesBox value={trip.notes} onChange={(notes) => updateTrip(trip.id, { notes })} className={field} readOnly={!editable} />

        <div className="flex items-center justify-between pt-2">
          <h2 className="text-xs uppercase tracking-[0.14em] text-mist">
            Itinerary{stops.length > 0 && ` · ${stops.length}`}
            {total > 0 && (
              <span className="normal-case tracking-normal text-mist">
                {' '}· {legs.some((l) => l.rough) ? '~' : ''}{formatDistance(total)}{totalTime ? ` · ${formatDuration(totalTime)}` : ''}
              </span>
            )}
          </h2>
          {editable && (
            <button onClick={() => setAddingStop((v) => !v)}
                    className="flex items-center gap-1 text-xs font-semibold text-brand">
              <PlusIcon size={14} /> Add
            </button>
          )}
        </div>

        {/* The whole trip, every stop in order from the first. A finished trip
            doesn't offer to go live again; "Navigate here" on a stop still works. */}
        {stops.length > 0 && !isCompleted(trip) && (
          <button onClick={() => onNavigate?.(stops[0].placeId, trip.id)}
                  className="w-full min-h-12 flex items-center justify-center gap-2 rounded-full bg-brand text-ink py-3 text-sm font-semibold shadow-lg active:scale-[0.98] transition">
            {group
              ? <><span className="size-2 rounded-full bg-ink animate-pulse" aria-hidden /> Go live with the group</>
              : <><NavIcon size={16} filled /> Start trip</>}
            <span className="font-normal opacity-80">· {stops.length} stop{stops.length === 1 ? '' : 's'}</span>
          </button>
        )}

        {/* Riders were already screenshotting the map to post it. Two stops is
            the least that makes a route worth watching. */}
        {stops.length > 1 && (
          <button onClick={() => setMakingVideo(true)}
                  className="w-full min-h-11 flex items-center justify-center gap-2 rounded-full border border-line
                             text-sm font-semibold text-mist hover:text-white hover:border-brand/60 transition">
            <ReelIcon size={16} /> Route animator
          </button>
        )}

        <CompleteTrip trip={trip} stops={stops} onDone={() => flash('Trip completed. Nice ride!')} />

        {makingVideo && <RouteVideo trip={trip} onClose={() => setMakingVideo(false)} />}

        {addingStop && editable && (
          <AddStop trip={trip} onAdded={(name) => { setAddingStop(false); flash(`${name} added`) }} />
        )}

        {stops.length === 0 && !addingStop ? (
          <p className="text-sm text-mist leading-relaxed py-6">
            {editable ? (
              <>No stops yet. Add one above, or open a place on the map and choose{' '}
                <span className="text-brand">Add to trip</span>.</>
            ) : 'No stops yet. The host or the captain will add them.'}
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
                  {/* 40px targets; the negative margins keep the card its size.
                      Side by side, not stacked: stacked they were taller than the
                      name and left a blank band above the note (iPhone,
                      2026-09-13). Nothing to reorder with one stop. */}
                  {editable && stops.length > 1 && (
                    <div className="flex items-center -my-2 shrink-0">
                      <button onClick={() => moveStop(trip.id, i, -1)} disabled={i === 0}
                              className="grid place-items-center size-10 text-mist hover:text-white disabled:opacity-25 text-xs" aria-label="Move up">▲</button>
                      <button onClick={() => moveStop(trip.id, i, 1)} disabled={i === stops.length - 1}
                              className="grid place-items-center size-10 text-mist hover:text-white disabled:opacity-25 text-xs" aria-label="Move down">▼</button>
                    </div>
                  )}
                  {editable && (
                    <button onClick={() => removeStop(trip.id, s.placeId)}
                            className="grid place-items-center size-10 -m-2 shrink-0 text-mist hover:text-rose" aria-label={`Remove ${s.place.name}`}>
                      <CloseIcon size={16} />
                    </button>
                  )}
                </div>

                {editable ? (
                  <input
                    value={s.note}
                    onChange={(e) => setStopNote(trip.id, s.placeId, e.target.value)}
                    placeholder="Note — nights, booking, who to call…"
                    className={`${field} w-full mt-2 text-xs`}
                  />
                ) : s.note ? (
                  <p className="mt-2 text-xs text-mist whitespace-pre-line">{s.note}</p>
                ) : null}
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

        {editable && <TripSuggestions trip={trip} places={places} onOpenPlace={onOpenPlace} />}

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

        <Bookings trip={trip} destination={stops.at(-1)?.place?.name ?? ''} editable={editable} />

        <DeleteTrip trip={trip} onDeleted={onBack} />
      </div>
    </>
  )
}

const doneOn = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
}

/** Only the host marks a group trip done — the server keeps their copy (see sync.js). */
const canComplete = (trip, account) => !trip.ownerId || !account || trip.ownerId === account.id

/**
 * "Mark as completed" (Punit, 2026-09-21). Offered once the trip has somewhere
 * to go; confirmed inline, as with delete, because it ends the ride for the
 * whole group.
 */
function CompleteTrip({ trip, stops, onDone }) {
  const account = useStore((s) => s.account)
  const [confirm, setConfirm] = useState(false)
  if (isCompleted(trip) || stops.length === 0 || !canComplete(trip, account)) return null
  const group = trip.kind === 'group' || trip.members?.length > 0

  function done() {
    completeTrip(trip.id)
    if (account) syncNow(account.id)
    setConfirm(false)
    onDone?.()
  }

  if (!confirm) {
    return (
      <button onClick={() => setConfirm(true)}
              className="w-full min-h-11 flex items-center justify-center gap-2 rounded-full border border-line
                         text-sm font-semibold text-mist hover:text-white hover:border-brand/60 transition">
        <DoneIcon size={17} /> Mark trip as completed
      </button>
    )
  }
  return (
    <div className="rounded-2xl border border-brand/40 bg-brand/10 p-3 space-y-2">
      <p className="text-sm">
        Done with “{trip.title}”? It moves to Completed{group ? ' for everyone on it' : ''}
        {trip.visibility === 'public' ? ' and comes off Open Rides' : ''}. You can reopen it any time.
      </p>
      <div className="flex gap-2 justify-end">
        <button onClick={() => setConfirm(false)}
                className="rounded-full border border-line px-3.5 py-1.5 text-xs font-semibold">Not yet</button>
        <button onClick={done}
                className="rounded-full bg-brand text-ink px-3.5 py-1.5 text-xs font-semibold">Mark completed</button>
      </div>
    </div>
  )
}

function CompletedBanner({ trip }) {
  const account = useStore((s) => s.account)
  if (!isCompleted(trip)) return null
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-brand/40 bg-brand/10 px-3.5 py-3">
      <DoneIcon size={22} className="text-brand shrink-0" />
      <p className="flex-1 min-w-0 text-sm">
        <span className="font-semibold">Completed</span>
        {doneOn(trip.completedAt) && <span className="text-mist"> · {doneOn(trip.completedAt)}</span>}
      </p>
      {canComplete(trip, account) && (
        <button onClick={() => { reopenTrip(trip.id); if (account) syncNow(account.id) }}
                className="text-xs font-semibold text-brand px-2 py-1">Reopen</button>
      )}
    </div>
  )
}

/**
 * Deleting a trip reaches the server too — before, the next sync brought it
 * straight back (Punit, 2026-09-11). A trip someone else owns isn't yours to
 * delete: you leave it instead (sync.js pushDeletions), and it drops off the
 * owner's rider list.
 */
function DeleteTrip({ trip, onDeleted }) {
  const account = useStore((s) => s.account)
  const [confirm, setConfirm] = useState(false)
  const theirs = Boolean(trip.ownerId && account && trip.ownerId !== account.id)
  const shared = trip.kind === 'group' || trip.members?.length > 0

  function remove() {
    deleteTrip(trip.id)
    if (account) syncNow(account.id)
    onDeleted()
  }

  // An inline confirm, not window.confirm: Chrome suppresses native dialogs
  // after a page has shown a few, and a suppressed confirm() returns false
  // silently — so deleting simply stopped working with nothing to explain why.
  if (!confirm) {
    return (
      <button onClick={() => setConfirm(true)}
              className="text-xs text-mist underline underline-offset-4 hover:text-rose pt-4">
        {theirs ? 'Leave trip' : 'Delete trip'}
      </button>
    )
  }
  return (
    <div className="flex items-center gap-2 pt-4">
      <span className="text-xs text-mist flex-1">
        {theirs
          ? `Leave “${trip.title}”? It goes from your trips and the group stops seeing you on it. The owner can invite you again.`
          : `Delete “${trip.title}” for good?${shared ? ' It goes for everyone on it.' : ''}`}
      </span>
      <button onClick={() => setConfirm(false)}
              className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold">
        Keep
      </button>
      <button onClick={remove} className="rounded-full bg-rose text-white px-3 py-1.5 text-xs font-semibold">
        {theirs ? 'Leave' : 'Delete'}
      </button>
    </div>
  )
}

/**
 * Trip notes, folded until you want them.
 *
 * A group's notes are often a whole invite — dates, venue, fees, what is
 * included, who to call. A fixed three-line box hid most of it; growing the box
 * to fit then covered the whole screen (Punit, 2026-09-13). So the trip shows the
 * first few lines, and a tap opens the full note to read or edit; Done folds it
 * away again. With no notes yet it is a single "Add trip notes" line.
 */
function NotesBox({ value, onChange, className, readOnly = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const cardRef = useRef(null)
  const typeNow = useRef(false)   // an empty note is opened to write in, so the cursor goes straight in
  useEffect(() => {
    if (open && typeNow.current) { typeNow.current = false; ref.current?.focus({ preventScroll: true }) }
  }, [open])
  useLayoutEffect(() => {
    const el = ref.current
    if (!open || !el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, window.innerHeight * 0.6)}px`
  }, [value, open])
  // Opening a note is for reading it, so no cursor and no keyboard: tap into
  // the text to edit. It used to focus straight away, and on iPhone the
  // keyboard that brought up is what wrecked the page when Done folded it.

  // Fold in order: let the keyboard go first, then drop the box, then nudge the
  // scroll by a pixel. Safari on iPhone does not always repaint a scrolling
  // area that just lost a tall box under an open keyboard — it left the whole
  // trip below the notes blank until you scrolled (reported 2026-09-13).
  const fold = () => {
    ref.current?.blur()
    requestAnimationFrame(() => {
      setOpen(false)
      requestAnimationFrame(() => {
        const card = cardRef.current
        if (!card) return
        let el = card.parentElement
        while (el && !(el.scrollHeight > el.clientHeight && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement
        if (el) { el.scrollTop += 1; el.scrollTop -= 1 }
        card.scrollIntoView({ block: 'nearest' })
      })
    })
  }

  const text = (value ?? '').trim()
  // The preview skips blank lines, so three lines of it are three lines of the
  // note — an invite that opens with a title and a gap previewed one line.
  // The note itself is left exactly as written.
  const preview = text.replace(/\n\s*\n+/g, '\n')

  // A rider who can't change the notes reads them, and sees nothing to add.
  if (readOnly && !text) return null
  if (!open) {
    return text ? (
      <button ref={cardRef} type="button" onClick={() => setOpen(true)} aria-expanded="false"
              className="block w-full text-left bg-raised rounded-xl px-3 py-2.5 hover:ring-1 hover:ring-brand/40 transition">
        <span className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-[0.14em] text-mist">Notes</span>
          <span className="text-[11px] font-semibold text-brand">Read all ▾</span>
        </span>
        {/* No `block` on the text: line-clamp sets its own display, and `block`
            beat it — the preview showed all 22 lines of a long invite instead of
            three. The *button* is block, though: left inline, iPhone lines it up
            by the last line of its text — the eighth, hidden one — and left the
            room for the hidden lines as an empty band under the card (found on the
            iOS simulator, 2026-09-13). The max-height is the backstop: three
            lines at this line height, whatever an engine does with the clamp. */}
        <span className="text-sm leading-relaxed whitespace-pre-line line-clamp-3 overflow-hidden"
              style={{ maxHeight: '4.875em' }}>{preview}</span>
      </button>
    ) : (
      <button ref={cardRef} type="button" onClick={() => { typeNow.current = true; setOpen(true) }}
              className="block w-full text-left bg-raised rounded-xl px-3 py-2.5 text-sm text-mist hover:text-white transition">
        + Add trip notes — permits, who's driving, what to book first
      </button>
    )
  }

  return (
    <div className="bg-raised rounded-xl">
      <div className="flex items-center justify-between px-3 pt-2.5">
        <span className="text-[10px] uppercase tracking-[0.14em] text-mist">Notes</span>
        <button type="button" onClick={fold} aria-expanded="true"
                className="text-[11px] font-semibold text-brand px-1 -mr-1">{readOnly ? 'Close ▴' : 'Done ▴'}</button>
      </div>
      <textarea
        ref={ref} value={value} rows={5} readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Trip notes — permits, who's driving, what to book first…"
        className={`${className} bg-transparent w-full min-h-28 resize-none leading-relaxed overflow-y-auto focus:ring-0`}
      />
    </div>
  )
}

/**
 * A date input that says so when it is empty. iPhone draws an empty date field
 * as a blank box — no placeholder, nothing to suggest it can be tapped — so a
 * new trip showed two empty grey boxes under From and To (simulator,
 * 2026-09-13). The hint sits on top and lets taps through to the real input.
 * iPhone also gives a date input a minimum width of its own, which pushed "To"
 * off the right edge; appearance-none and min-w-0 let it fit its column.
 */
function DateField({ value, onChange, className, disabled = false }) {
  return (
    <span className="relative block min-w-0">
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
             className={`${className} block w-full min-w-0 min-h-10 appearance-none text-left [&::-webkit-date-and-time-value]:text-left ${value ? '' : 'text-transparent'}`} />
      {!value && (
        <span aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-mist">
          {disabled ? 'Not set' : 'Add date'}
        </span>
      )}
    </span>
  )
}
