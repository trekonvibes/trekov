import { CalendarIcon, Logo } from './Icons'
import Portal from './Portal'

/** Someone sent you a trip link. Show it before it joins your own trips. */
export default function SharedTrip({ trip, onAccept, onDismiss }) {
  const places = Object.fromEntries((trip.places ?? []).map((p) => [p.id, p]))
  const stops = (trip.stops ?? []).map((s) => places[s.placeId]).filter(Boolean)

  return (
    <Portal>
      <div className="fixed inset-0 z-[1300] bg-black flex justify-center" role="dialog" aria-label="Shared trip">
        <div className="tk-shell h-full bg-ink flex flex-col sm:border-x sm:border-line pt-safe px-safe">
        <header className="flex items-center gap-2 px-4 h-14 border-b border-line shrink-0">
          <Logo size={20} />
          <span className="font-semibold">Shared with you</span>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <h1 className="text-2xl font-semibold leading-tight">{trip.title}</h1>
            {(trip.start || trip.end) && (
              <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-sun/90 bg-sun/10 rounded-full px-2.5 py-1">
                <CalendarIcon size={13} /> {trip.start || '?'} → {trip.end || '?'}
              </p>
            )}
            <p className="text-sm text-mist mt-2">{stops.length} stop{stops.length === 1 ? '' : 's'}</p>
          </div>

          {trip.notes && <p className="text-sm text-white/85 leading-relaxed">{trip.notes}</p>}

          <ol className="space-y-2.5">
            {stops.map((p, i) => (
              <li key={p.id} className="flex items-start gap-3 bg-surface border border-line rounded-2xl p-3">
                <span className="grid place-items-center size-7 rounded-full bg-brand/15 text-brand
                                 text-xs font-bold shrink-0 tabular-nums">{i + 1}</span>
                <div className="min-w-0">
                  <p className="font-semibold leading-tight truncate">{p.name}</p>
                  <p className="text-xs text-mist truncate">{p.region} · {p.country}</p>
                  {trip.stops[i]?.note && <p className="text-xs text-white/80 mt-1">{trip.stops[i].note}</p>}
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="p-4 flex gap-2 border-t border-line shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button onClick={onDismiss} className="flex-1 rounded-full border border-line py-3 text-sm font-semibold hover:text-white">
            Not now
          </button>
          <button onClick={onAccept} className="flex-1 rounded-full bg-brand text-ink py-3 text-sm font-semibold">
            Save to my trips
          </button>
        </div>
        </div>
      </div>
    </Portal>
  )
}
