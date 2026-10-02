import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../lib/store'
import { openRides, requestToJoin, withdrawJoin } from '../lib/people'
import { pushToTrip } from '../lib/push'

/**
 * Rides other people have opened up.
 *
 * A public trip is findable, not open: this list is all a stranger ever reads
 * of it — the title, the dates, where it starts and ends, and how many are
 * going. Asking to join sends the host a request; the notes, the bookings, the
 * live map and the voice channel arrive only if they say yes
 * (supabase/trip-visibility.sql).
 */
export default function OpenRides() {
  const account = useStore((s) => s.account)
  const [rides, setRides] = useState([])
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => { if (account) openRides().then(setRides) }, [account])
  useEffect(() => {
    load()
    const timer = setInterval(() => { if (!document.hidden) load() }, 30_000)
    const onVisible = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  if (!rides.length) return null

  async function ask(ride) {
    setBusy(ride.id)
    setError('')
    const res = await requestToJoin(ride.id)
    if (res.ok) {
      setRides((list) => list.map((r) => (r.id === ride.id ? { ...r, my_status: res.status } : r)))
      // The host hears about it even with Trekov closed. The server writes the
      // words — a stranger cannot put their own text on someone's phone.
      if (res.status === 'requested') {
        pushToTrip({ tripId: ride.id, kind: 'join', title: 'Someone wants to join', body: ride.title })
      }
    } else {
      setError(res.reason === 'local' ? 'Sign in to ask to join a ride.' : res.reason)
    }
    setBusy(null)
  }

  async function unask(ride) {
    setBusy(ride.id)
    setError('')
    const res = await withdrawJoin(ride.id)
    if (res.ok) setRides((list) => list.map((r) => (r.id === ride.id ? { ...r, my_status: 'none' } : r)))
    else setError(res.reason)
    setBusy(null)
  }

  return (
    <section className="px-4 pt-4" aria-label="Open rides">
      <h2 className="text-xs uppercase tracking-[0.14em] text-mist mb-2">Open rides · {rides.length}</h2>
      <ul className="space-y-2">
        {rides.map((ride) => (
          <li key={ride.id} className="rounded-2xl border border-line bg-surface p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{ride.title}</p>
                <p className="text-[11px] text-mist truncate">{route(ride)}</p>
                <p className="text-[11px] text-mist mt-0.5">{when(ride)} · {going(ride.riders)} · @{ride.host}</p>
              </div>
              <JoinButton status={ride.my_status} busy={busy === ride.id}
                          onAsk={() => ask(ride)} onUnask={() => unask(ride)} />
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="text-[11px] text-rose mt-2">{error}</p>}
      <p className="text-[10px] text-mist mt-2 leading-relaxed">
        The host decides who comes. You see the route, the stops and everyone on the live map once they add you.
      </p>
    </section>
  )
}

/** "Jaisalmer → Bikaner", or just the start when the host has only pinned one stop. */
function route(ride) {
  const ends = [ride.starts_at, ride.ends_at].filter(Boolean)
  const line = ends.length === 2 && ends[0] !== ends[1] ? `${ends[0]} → ${ends[1]}` : ends[0]
  return line ? `${line} · ${ride.stops} ${ride.stops === 1 ? 'stop' : 'stops'}` : `${ride.stops} stops`
}

/** Dates as the host set them; a trip without dates simply doesn't say. */
function when(ride) {
  const day = (d) => new Date(`${d}T00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  if (ride.starts_on && ride.ends_on && ride.ends_on !== ride.starts_on) return `${day(ride.starts_on)} – ${day(ride.ends_on)}`
  if (ride.starts_on) return day(ride.starts_on)
  return 'Dates open'
}

const going = (n) => (Number(n) === 1 ? '1 rider' : `${Number(n) || 0} riders`)

function JoinButton({ status, busy, onAsk, onUnask }) {
  // Waiting on the host, and free to change your mind while you wait.
  if (status === 'requested') {
    return (
      <button onClick={onUnask} disabled={busy}
              className="shrink-0 rounded-full border border-sun/60 text-sun text-[11px] font-semibold px-3 py-1.5
                         disabled:opacity-50 hover:border-mist hover:text-mist">
        {busy ? 'Cancelling…' : 'Asked · cancel'}
      </button>
    )
  }
  if (status === 'accepted') {
    return <span className="shrink-0 rounded-full border border-brand/60 text-brand text-[11px] font-semibold px-3 py-1.5">You're on it</span>
  }
  if (status === 'declined') {
    return <span className="shrink-0 text-[11px] text-mist px-2 py-1.5">Full</span>
  }
  return (
    <button onClick={onAsk} disabled={busy}
            className="shrink-0 rounded-full bg-brand text-ink text-[11px] font-semibold px-3.5 py-1.5 disabled:opacity-50">
      {busy ? 'Asking…' : status === 'pending' ? 'Accept invite' : 'Ask to join'}
    </button>
  )
}
