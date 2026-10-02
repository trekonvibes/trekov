import { useEffect, useState } from 'react'
import { createTrip, getPlace, isCompleted, selectSavedPlaces, selectTrips, toggleSavePlace, useStore } from '../lib/store'
import { CalendarIcon, CloseIcon, DoneIcon, Logo, NavIcon, PlusIcon } from './Icons'
import Media from './Media'
import TripDetail from './TripDetail'
import Invitations from './Invitations'
import OpenRides from './OpenRides'

// "20 Sept – 22 Sept", "20 Sept" for a one-day ride, the year only when it isn't this one.
const day = (d) => {
  const date = new Date(`${d}T00:00`)
  if (Number.isNaN(date.getTime())) return d
  const opts = { day: 'numeric', month: 'short', ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }
  return date.toLocaleDateString(undefined, opts)
}
const dateRange = (t) =>
  t.start && t.end
    ? (t.start === t.end ? day(t.start) : `${day(t.start)} – ${day(t.end)}`)
    : t.start || t.end ? day(t.start || t.end) : 'No dates yet'

export default function Trips({ onOpenPlace, open, onOpen, onNavigate, newGroup = 0 }) {
  const account = useStore((s) => s.account)
  const isGroup = (t) => t.kind === 'group' || t.members?.length > 0 || Boolean(t.ownerId && t.ownerId !== account?.id)
  const trips = useStore(selectTrips)
  const saved = useStore(selectSavedPlaces)
  const [title, setTitle] = useState('')
  const [adding, setAdding] = useState(false)
  // Group trips are what Trekov is for, so a new trip starts as one.
  const [kind, setKind] = useState('group')
  // The map's "Start a group trip" lands here with the form open.
  useEffect(() => { if (newGroup) { setAdding(true); setKind('group') } }, [newGroup])
  const ordered = [...trips].filter((t) => !isCompleted(t)).sort((a, b) => isGroup(b) - isGroup(a))
  // Ridden trips go below, newest finish first (Punit, 2026-09-21).
  const done = trips.filter(isCompleted).sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))

  if (open) {
    const trip = trips.find((t) => t.id === open)
    if (trip) return <TripDetail trip={trip} onBack={() => onOpen(null)} onOpenPlace={onOpenPlace} onNavigate={onNavigate} />
  }

  function submit(e) {
    e.preventDefault()
    if (!title.trim()) return
    const id = createTrip({ title, kind })
    setTitle(''); setAdding(false); onOpen(id)
  }

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between px-4 h-14
                         bg-ink/85 backdrop-blur-xl border-b border-line">
        <h1 className="text-lg font-semibold">Trips</h1>
        <button onClick={() => setAdding((v) => !v)}
                className="flex items-center gap-1.5 text-sm font-semibold text-brand" aria-label="New trip">
          <PlusIcon size={18} /> New
        </button>
      </header>

      <Invitations onOpen={onOpen} />
      <OpenRides />

      {adding && (
        <form onSubmit={submit} className="p-4 space-y-3 border-b border-line">
          <div className="grid grid-cols-2 gap-2">
            {[
              ['solo', 'Solo trip', 'Just you'],
              ['group', 'Group trip', 'Ride together, live'],
            ].map(([id, label, blurb]) => (
              <button key={id} type="button" onClick={() => setKind(id)} aria-pressed={kind === id}
                      className={`rounded-2xl border p-3 text-left transition
                                  ${kind === id ? 'border-brand bg-brand/10' : 'border-line hover:border-mist'}`}>
                <span className={`block text-sm font-semibold ${kind === id ? 'text-brand' : ''}`}>{label}</span>
                <span className="block text-[11px] text-mist">{blurb}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
                   placeholder="Trip name — “Spiti in June”"
                   className="flex-1 bg-raised rounded-xl px-3.5 py-2.5 text-sm outline-none placeholder:text-mist focus:ring-2 focus:ring-brand/50" />
            <button type="submit" disabled={!title.trim()}
                    className="rounded-xl bg-brand text-ink font-semibold text-sm px-4 disabled:opacity-40">
              Create
            </button>
          </div>
        </form>
      )}

      {!adding && !trips.some(isGroup) && (
        <section className="mx-4 mt-4 rounded-2xl border border-brand/40 bg-brand/10 p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand">Group trips</p>
          <h2 className="text-lg font-semibold mt-1">Ride together, live</h2>
          <p className="text-sm text-mist leading-relaxed mt-1">
            Invite your crew, then see everyone on one map while you travel — live locations and
            push-to-talk voice, with the route and stops shared.
          </p>
          <button onClick={() => { setKind('group'); setAdding(true) }}
                  className="mt-3 rounded-full bg-brand text-ink font-semibold text-sm px-5 py-2.5">
            Start a group trip
          </button>
        </section>
      )}

      {/* To Visit lives here: the shortlist and the trips built from it. */}
      {saved.length > 0 && (
        <section className="px-4 pt-4">
          <h2 className="text-xs uppercase tracking-[0.14em] text-mist mb-2">
            To Visit · {saved.length}
          </h2>
          <ul className="flex gap-2 overflow-x-auto no-bar pb-1">
            {saved.map((p) => (
              <li key={p.id} className="shrink-0 w-36">
                <div className="bg-surface border border-line rounded-2xl overflow-hidden">
                  <button onClick={() => onOpenPlace(p.id)} className="block w-full text-left">
                    {p.cover
                      ? <Media media={p.cover} alt={p.name} className="w-full h-20 object-cover" />
                      : <span className="grid place-items-center w-full h-20 bg-raised"><Logo size={18} /></span>}
                    <span className="block px-2.5 pt-2">
                      <span className="block text-xs font-semibold truncate">{p.name}</span>
                      <span className="block text-[10px] text-mist truncate">{p.region}</span>
                    </span>
                  </button>
                  <div className="flex items-center gap-1 px-2.5 pb-2 pt-1.5">
                    {p.bestTime && (
                      <span className="inline-flex items-center gap-1 text-[9px] text-sun/90 bg-sun/10 rounded-full px-1.5 py-0.5">
                        <CalendarIcon size={9} /> {p.bestTime}
                      </span>
                    )}
                    {/* 40px targets; negative margins keep the row and card their size. */}
                    <button onClick={() => onNavigate?.(p.id)} aria-label={`Navigate to ${p.name}`}
                            className="ml-auto -my-3 -mr-1.5 grid place-items-center size-10 text-brand"><NavIcon size={13} filled /></button>
                    <button onClick={() => toggleSavePlace(p.id)} aria-label={`Remove ${p.name}`}
                            className="-my-3 -mr-2.5 grid place-items-center size-10 text-mist hover:text-rose"><CloseIcon size={13} /></button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {trips.length === 0 ? (
        <div className="text-center px-10 py-16 space-y-3">
          <h2 className="text-lg font-semibold">No trips yet</h2>
          <p className="text-sm text-mist leading-relaxed">
            A trip is an ordered list of places with your notes on each one. Build it from
            the map, then send the link to whoever is coming with you.
          </p>
          <button onClick={() => setAdding(true)}
                  className="mt-2 rounded-full bg-brand text-ink font-semibold text-sm px-5 py-2.5">
            Start a trip
          </button>
        </div>
      ) : (
        ordered.length > 0 && <ul className="p-4 space-y-3">
          {ordered.map((t) => <TripCard key={t.id} t={t} group={isGroup(t)} onOpen={onOpen} onNavigate={onNavigate} />)}
        </ul>
      )}

      {done.length > 0 && (
        <section className="px-4 pb-6">
          <h2 className="flex items-center gap-1.5 text-xs uppercase tracking-[0.14em] text-mist mb-2">
            <DoneIcon size={13} /> Completed · {done.length}
          </h2>
          <ul className="space-y-3">
            {done.map((t) => <TripCard key={t.id} t={t} group={isGroup(t)} onOpen={onOpen} onNavigate={onNavigate} />)}
          </ul>
        </section>
      )}
    </>
  )
}

function TripCard({ t, group, onOpen, onNavigate }) {
  const finished = isCompleted(t)
  const covers = t.stops.slice(0, 3).map((s) => getPlace(s.placeId)).filter(Boolean)
  return (
    <li>
      <button onClick={() => onOpen(t.id)}
              className={`rise w-full text-left bg-surface border border-line rounded-2xl p-4 hover:border-brand/50 transition
                          ${finished ? 'opacity-80' : ''}`}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-tight truncate">{t.title}</p>
            {/* The badges sit under the title, with the dates. Beside a long
                title the truncation ate them — "Private" showed as "…"
                (iPhone, 2026-09-14). */}
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-mist">
              {finished && (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand text-ink text-[9px] font-bold
                                 uppercase tracking-[0.1em] px-1.5 py-0.5">
                  <DoneIcon size={10} /> Completed
                </span>
              )}
              {group && (
                <span className="rounded-full bg-brand/15 text-brand text-[9px] font-bold
                                 uppercase tracking-[0.1em] px-1.5 py-0.5">
                  Group{(t.members?.length ?? 0) > 0 ? ` · ${t.members.length}` : ''}
                </span>
              )}
              {/* Whether anyone else can find it, at a glance from the list. */}
              {group && (
                <span className={`rounded-full text-[9px] font-bold uppercase tracking-[0.1em]
                                  px-1.5 py-0.5 border
                                  ${t.visibility === 'public'
                                    ? 'border-brand/50 text-brand'
                                    : 'border-line text-mist'}`}>
                  {t.visibility === 'public' ? 'Public' : 'Private'}
                </span>
              )}
              <span>{dateRange(t)}</span>
            </p>
          </div>
          <span className="text-xs text-mist shrink-0">
            {t.stops.length} stop{t.stops.length === 1 ? '' : 's'}
          </span>
        </div>
        {covers.length > 0 && (
          <p className="mt-3 text-xs text-mist truncate">
            {covers.map((p) => p.name).join(' · ')}
            {t.stops.length > covers.length ? ` +${t.stops.length - covers.length}` : ''}
          </p>
        )}
      </button>
      {/* Start the whole trip: navigation through every stop, from the first.
          Not on a ridden one — it is there to look back on. */}
      {t.stops.length > 0 && !finished && (
        <button onClick={() => onNavigate?.(t.stops[0].placeId, t.id)}
                className="mt-2 w-full min-h-10 flex items-center justify-center gap-2 rounded-full bg-brand text-ink py-2 text-sm font-semibold">
          {group
            ? <><span className="size-2 rounded-full bg-ink animate-pulse" aria-hidden /> Go live with the group</>
            : <><NavIcon size={14} filled /> Start trip</>}
        </button>
      )}
    </li>
  )
}
