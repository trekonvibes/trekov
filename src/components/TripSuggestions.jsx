import { useEffect, useState } from 'react'
import { alongRoute, attractionsNear, staysNear, tripTolls } from '../lib/suggest'
import { getTripRoute } from '../lib/route'
import { BedIcon, CarIcon, MotorcycleIcon, MountainIcon, PhoneIcon, StarIcon } from './Icons'

const money = (t) =>
  t?.currency ? new Intl.NumberFormat(navigator.language || 'en-IN',
    { style: 'currency', currency: t.currency, maximumFractionDigits: 0 }).format(t.amount)
    : null

/**
 * What a planner would want to know about the trip they have just built:
 * what the road costs, what is on it, and where to sleep at the far end.
 *
 * Everything here is fetched, not guessed. Nothing is shown as a suggestion
 * that the app cannot point at a source for — an empty section says so rather
 * than filling itself in.
 */
export default function TripSuggestions({ trip, places, onOpenPlace }) {
  const stops = trip.stops.map((s) => places[s.placeId]).filter(Boolean)
  const [tolls, setTolls] = useState(null)
  const [onTheWay, setOnTheWay] = useState([])
  const [stays, setStays] = useState(null)
  const [seeThere, setSeeThere] = useState([])
  const [state, setState] = useState('idle')

  const last = stops.at(-1)

  useEffect(() => {
    if (stops.length === 0) return
    let live = true
    setState('loading')

    const work = [
      // Tolls need two points; a single-stop trip has no road between stops.
      stops.length >= 2 ? tripTolls(stops).then((t) => live && setTolls(t)) : null,
      staysNear(last).then((s) => live && setStays(s)),
      attractionsNear(last).then((a) => live && setSeeThere(a)),
      stops.length >= 2
        ? getTripRoute(stops[0], stops.slice(1), 'car')
            .then((r) => (r?.coordinates ? alongRoute(r.coordinates) : []))
            .then((g) => live && setOnTheWay(g))
        : null,
    ].filter(Boolean)

    Promise.allSettled(work).then(() => live && setState('ready'))
    return () => { live = false }
    // Re-run when the itinerary itself changes, not on every render.
  }, [trip.stops.map((s) => s.placeId).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  if (stops.length === 0) return null

  const carToll = money(tolls?.car)
  // "No price came back" and "this road is free" are different answers, and
  // Google gives the same empty tollInfo for both — it has no toll pricing at
  // all for some regions. Two-wheelers are only called exempt when the car on
  // the same route was priced: that comparison is evidence, a lone blank is
  // not, and telling a rider a tolled road is free is the worse mistake.
  const priced = Boolean(carToll)
  const bikeExempt = priced && tolls?.bike && !tolls.bike.amount

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xs uppercase tracking-[0.14em] text-mist">Planning help</h2>
        <p className="text-[11px] text-mist mt-0.5 leading-snug">
          Pulled from live routing, Places and Trekov's own partners — not written by a model.
        </p>
      </div>

      {state === 'loading' && <p className="text-sm text-mist py-2">Working it out…</p>}

      {/* ------------------------------------------------------------ tolls */}
      {tolls && (
        <div className="rounded-2xl border border-line bg-surface p-3">
          <h3 className="text-[11px] uppercase tracking-[0.12em] text-mist mb-2">Tolls</h3>
          <div className="space-y-1.5">
            <p className="flex items-center gap-2 text-sm">
              <CarIcon size={16} className="text-mist shrink-0" />
              {carToll
                ? <span>About <b>{carToll}</b> by car</span>
                : <span className="text-mist">No toll estimate for this route</span>}
            </p>
            <p className="flex items-center gap-2 text-sm">
              <MotorcycleIcon size={16} className="text-mist shrink-0" />
              {tolls.bike?.amount
                ? <span>About <b>{money(tolls.bike)}</b> by bike</span>
                : bikeExempt
                  ? <span className="text-brand">Free by bike — two-wheelers are exempt</span>
                  : <span className="text-mist">No toll estimate for this route</span>}
            </p>
          </div>
          <p className="text-[10px] text-mist mt-2 leading-snug">
            {priced
              ? "Google's estimate for this route. Local passes and night rates can change it."
              : 'Google has no toll pricing for this route — that is not the same as it being free.'}
          </p>
        </div>
      )}

      {/* ------------------------------------------------------- on the way */}
      {onTheWay.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface p-3">
          <h3 className="text-[11px] uppercase tracking-[0.12em] text-mist mb-2">On the way</h3>
          {onTheWay.map((group) => (
            <div key={group.id} className="mb-2 last:mb-0">
              <p className="text-xs font-semibold mb-1">{group.label}</p>
              <ul className="space-y-1">
                {group.results.slice(0, 3).map((r) => (
                  <li key={r.id} className="flex items-center gap-2 text-[12px]">
                    {r.partner && <span className="text-[9px] font-bold text-brand shrink-0">PARTNER</span>}
                    <span className="truncate">{r.name}</span>
                    {r.rating != null && (
                      <span className="flex items-center gap-0.5 text-sun shrink-0">
                        <StarIcon size={9} filled />{r.rating.toFixed(1)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-[10px] text-mist mt-1 leading-snug">
            Sampled at points along the route, not a full sweep of it.
          </p>
        </div>
      )}

      {/* ----------------------------------------------------------- stays */}
      {stays && (stays.partners.length > 0 || stays.others.length > 0) && (
        <div className="rounded-2xl border border-line bg-surface p-3">
          <h3 className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-mist mb-2">
            <BedIcon size={13} /> Stays near {last.name}
          </h3>

          {stays.partners.map((p) => (
            <div key={p.id} className="rounded-xl border border-brand/50 bg-brand/5 p-2.5 mb-1.5">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-brand text-ink text-[9px] font-bold uppercase
                                 tracking-[0.1em] px-1.5 py-0.5 shrink-0">
                  {p.verified ? 'Verified partner' : 'Partner'}
                </span>
                <span className="text-sm font-semibold truncate">{p.name}</span>
              </div>
              {p.detail && <p className="text-[11px] text-mist mt-0.5 truncate">{p.detail}</p>}
              {p.phone && (
                <a href={`tel:${p.phone.replace(/\s+/g, '')}`}
                   className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand mt-1">
                  <PhoneIcon size={11} /> Call
                </a>
              )}
            </div>
          ))}

          {stays.others.map((o) => (
            <div key={o.id} className="flex items-center gap-2 py-1 text-[12px]">
              <span className="truncate flex-1">{o.name}</span>
              {o.rating != null && (
                <span className="flex items-center gap-0.5 text-sun shrink-0">
                  <StarIcon size={9} filled />{o.rating.toFixed(1)}
                </span>
              )}
              {o.phone && (
                <a href={`tel:${o.phone.replace(/\s+/g, '')}`} className="text-brand shrink-0">
                  <PhoneIcon size={12} />
                </a>
              )}
            </div>
          ))}

          {stays.partners.length === 0 && (
            <p className="text-[10px] text-mist mt-1.5 leading-snug">
              No Trekov partners here yet. These come from Google.
            </p>
          )}
        </div>
      )}

      {/* ----------------------------------------------------- attractions */}
      {seeThere.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface p-3">
          <h3 className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-mist mb-2">
            <MountainIcon size={13} /> Also worth seeing near {last.name}
          </h3>
          <ul className="space-y-1">
            {seeThere.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-[12px]">
                <span className="truncate flex-1">{a.name}</span>
                {a.rating != null && (
                  <span className="flex items-center gap-0.5 text-sun shrink-0">
                    <StarIcon size={9} filled />{a.rating.toFixed(1)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {state === 'ready' && !tolls && onTheWay.length === 0 && !stays?.others.length && seeThere.length === 0 && (
        <p className="text-sm text-mist leading-relaxed">
          Nothing to suggest for this itinerary yet. Add a second stop and the road between
          them can be costed and searched.
        </p>
      )}
    </section>
  )
}
