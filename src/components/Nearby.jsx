import { useEffect, useState } from 'react'
import { CATEGORIES, findNearby } from '../lib/nearby'
import { adoptHit } from '../lib/adopt'
import {
  BackIcon, BedIcon, BowlIcon, CarIcon, CutleryIcon, KeyIcon, MotorcycleIcon, MountainIcon,
  PhoneIcon, StarIcon,
} from './Icons'

/** Category id to icon. Kept here rather than in the data, which stays plain. */
const ICONS = {
  hotel: BedIcon,
  food: CutleryIcon,
  street_food: BowlIcon,
  bike_service: MotorcycleIcon,
  car_service: CarIcon,
  rental: KeyIcon,
  attraction: MountainIcon,
}

const RADIUS_KM = 8

/**
 * What is around a place, entered through category cards.
 *
 * The categories are the browse surface — six cards you scan at a glance —
 * and results only appear once you pick one. Showing every category's list at
 * once buried the choice under whichever list happened to load first.
 */
export default function Nearby({ centre, centreName, onNavigate }) {
  const [category, setCategory] = useState(null)
  const [results, setResults] = useState([])
  const [state, setState] = useState('idle')

  useEffect(() => {
    if (!centre || !category) return
    let live = true
    setState('loading')
    setResults([])
    findNearby(category, centre, { radiusKm: RADIUS_KM }).then((hits) => {
      if (!live) return
      setResults(hits)
      setState(hits.length ? 'ready' : 'empty')
    })
    return () => { live = false }
  }, [category, centre?.lat, centre?.lng])

  if (!centre) return null

  const active = CATEGORIES.find((c) => c.id === category)
  const ActiveIcon = active ? (ICONS[active.id] ?? MountainIcon) : MountainIcon

  return (
    <section>
      {!active ? (
        <>
          <h2 className="text-xs uppercase tracking-[0.14em] text-mist mb-1">Around you</h2>
          <p className="text-[11px] text-mist mb-3">Within {RADIUS_KM} km of {centreName || 'here'}</p>

          <ul className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
            {CATEGORIES.map((c) => {
              const CategoryIcon = ICONS[c.id] ?? MountainIcon
              return (
                <li key={c.id}>
                  <button onClick={() => setCategory(c.id)}
                          className="w-full h-full text-left rounded-2xl border border-line bg-surface p-3
                                     hover:border-brand/60 transition group">
                    <CategoryIcon size={22} className="text-brand" />
                    <span className="block text-sm font-semibold mt-2">{c.label}</span>
                    <span className="block text-[11px] text-mist leading-snug">{c.blurb}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3">
            <button onClick={() => { setCategory(null); setState('idle') }}
                    className="text-mist hover:text-white p-1 -ml-1" aria-label="Back to categories">
              <BackIcon size={20} />
            </button>
            <div className="min-w-0">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold truncate">
                <ActiveIcon size={16} className="text-brand shrink-0" /> {active.label}
              </h2>
              <p className="text-[11px] text-mist truncate">
                Within {RADIUS_KM} km of {centreName || 'here'}
              </p>
            </div>
          </div>

          {state === 'loading' && (
            <p className="text-sm text-mist py-3">Looking for {active.label.toLowerCase()}…</p>
          )}
          {state === 'empty' && (
            <p className="text-sm text-mist py-3 leading-relaxed">
              Nothing found near here. Not every road has been mapped — if you know somewhere,
              it belongs on Trekov.
            </p>
          )}

          <ul className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
            {results.map((r) => (
              <li key={r.id}
                  className={`flex flex-col rounded-2xl border p-3 ${r.partner ? 'border-brand/50 bg-brand/5' : 'border-line bg-surface'}`}>
                {r.partner && (
                  <span className="self-start rounded-full bg-brand text-ink text-[9px] font-bold
                                   uppercase tracking-[0.1em] px-1.5 py-0.5 mb-1.5">
                    {r.verified ? 'Verified partner' : 'Partner'}
                  </span>
                )}
                <p className="text-sm font-semibold leading-tight line-clamp-2">{r.name}</p>
                {r.detail && <p className="text-[11px] text-mist line-clamp-2 mt-0.5">{r.detail}</p>}

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-[11px]">
                  {r.rating != null && (
                    <span className="flex items-center gap-1 text-sun">
                      <StarIcon size={11} filled /> {r.rating.toFixed(1)}
                      {r.reviews ? <span className="text-mist">({r.reviews})</span> : null}
                    </span>
                  )}
                  {r.openNow === true && <span className="text-brand">Open</span>}
                  {r.openNow === false && <span className="text-mist">Closed</span>}
                </div>

                {/* Actions pinned to the bottom so a long name does not leave
                    the row ragged.

                    Navigate is the primary one: Trekov has turn-by-turn built
                    in, so sending someone to Google Maps to drive the last
                    8km would be handing off the part we do ourselves. The
                    result is adopted into the atlas on the way, because
                    navigation runs on a place record. "Map" stays as a
                    secondary escape hatch. */}
                <div className="flex items-center gap-3 mt-auto pt-2 text-[11px] font-semibold">
                  {/* A number you can tap is the point of finding a garage on a
                      road you do not know, so it leads rather than trails. */}
                  {r.phone && (
                    <a href={`tel:${r.phone.replace(/\s+/g, '')}`}
                       className="flex items-center gap-1 text-brand" title={r.phone}>
                      <PhoneIcon size={11} /> Call
                    </a>
                  )}
                  {onNavigate && r.lat != null && r.lng != null && (
                    <button onClick={() => onNavigate(adoptHit(r))} className="text-brand">
                      Navigate
                    </button>
                  )}
                  <a href={`https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`}
                     target="_blank" rel="noreferrer"
                     className="text-mist hover:text-white ml-auto">Map</a>
                </div>
              </li>
            ))}
          </ul>

          {state === 'ready' && !results.some((r) => r.partner) && (
            <p className="text-[11px] text-mist mt-3 leading-relaxed">
              These come from Google. Businesses listed with Trekov appear above them —
              <a href="mailto:punit13690@gmail.com?subject=Listing%20on%20Trekov" className="text-brand"> get listed</a>.
            </p>
          )}
        </>
      )}
    </section>
  )
}
