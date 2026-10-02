import { currentVehicle, googleMapsUrl } from '../lib/handoff'
import { CloseIcon, ExternalIcon, MountainIcon, NavIcon } from './Icons'
import Portal from './Portal'

/**
 * Where a Navigate tap goes now that Trekov does not drive itself: Google Maps,
 * with the trip's other stops carried along as waypoints.
 *
 * Mappls used to lead here. It was taken out of the app (Punit, 2026-09-13) —
 * one clear way to navigate rather than a choice between two.
 */
export default function NavigateSheet({ place, stops = [], onClose }) {
  const mode = currentVehicle()
  const rest = stops.filter((s) => s && s.id !== place.id)

  const open = (url) => {
    window.open(url, '_blank', 'noopener')
    onClose()
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[1400] flex items-end justify-center" role="dialog"
           aria-label={`Navigate to ${place.name}`}>
        <button className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-label="Close" />

        <div className="sheet-up relative tk-shell rounded-t-3xl border-t border-line bg-ink p-5"
             style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}>
          <div className="flex items-start gap-3 mb-4">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-[0.14em] text-mist">Navigate to</p>
              <h2 className="text-lg font-semibold leading-tight truncate">{place.name}</h2>
              {place.region && <p className="text-sm text-mist truncate">{place.region}</p>}
            </div>
            <button onClick={onClose} className="text-mist hover:text-white p-1 shrink-0" aria-label="Close">
              <CloseIcon size={22} />
            </button>
          </div>

          <button onClick={() => open(googleMapsUrl(place, rest, mode))}
                  className="w-full flex items-center justify-center gap-2 rounded-full bg-brand text-ink
                             py-3.5 text-sm font-semibold active:scale-[.99] transition">
            <NavIcon size={18} filled /> Navigate with Google Maps
          </button>
          <p className="flex items-center justify-center gap-1 text-[11px] text-mist mt-1.5 text-center leading-snug">
            <ExternalIcon size={11} /> Opens Google Maps with the route ready.
          </p>
          {rest.length > 0 && (
            <p className="flex items-start gap-1.5 text-[11px] text-mist mt-1.5 leading-snug">
              <MountainIcon size={12} className="shrink-0 mt-px" />
              Carries the other {rest.length} stop{rest.length === 1 ? '' : 's'} as waypoints, in trip order.
            </p>
          )}
        </div>
      </div>
    </Portal>
  )
}
