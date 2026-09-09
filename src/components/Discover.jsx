import { useEffect, useState } from 'react'
import {
  getPlace, getUser, markNotificationsRead, selectAttractionOfMonth, selectMostVisited,
  selectNewPlaces, selectNotifications, toggleSavePlace, useStore,
} from '../lib/store'
import { ago, timeAgo } from '../lib/format'
import { CalendarIcon, Logo, NavIcon, SaveIcon, StarIcon } from './Icons'
import Media from './Media'
import Nearby from './Nearby'

const MONTH = new Date().toLocaleString(undefined, { month: 'long' })

function Thumb({ place, className = 'size-16 rounded-xl' }) {
  return place.cover
    ? <Media media={place.cover} alt={place.name} className={`${className} object-cover shrink-0 bg-raised`} />
    : <span className={`${className} grid place-items-center bg-raised shrink-0`}><Logo size={18} /></span>
}

export default function Discover({ onOpenPlace, onNavigate }) {
  // Prefer the traveller's own position; fall back to the month's attraction
  // so the section is useful before location permission is granted.
  const [gps, setGps] = useState(null)
  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.getCurrentPosition(
      (p) => setGps({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { maximumAge: 300000, timeout: 8000 },
    )
    return () => id && navigator.geolocation.clearWatch?.(id)
  }, [])
  const attraction = useStore(selectAttractionOfMonth)
  const mostVisited = useStore(selectMostVisited)
  const newPlaces = useStore(selectNewPlaces)
  const notifications = useStore(selectNotifications)
  const here = gps ?? (attraction ? { lat: attraction.lat, lng: attraction.lng } : null)
  const hereName = gps ? 'you' : attraction?.name

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between px-4 h-14
                         bg-ink/85 backdrop-blur-xl border-b border-line">
        <h1 className="text-lg font-semibold">Discover</h1>
        {notifications.some((n) => !n.read) && (
          <button onClick={markNotificationsRead} className="text-xs text-brand font-semibold">
            Mark all read
          </button>
        )}
      </header>

      <div className="p-4 space-y-8">
        {/* ---------------------------------------- attraction of the month */}
        {attraction && (
          <section>
            <h2 className="text-xs uppercase tracking-[0.14em] text-sun mb-3">
              Attraction of {MONTH}
            </h2>
            <button onClick={() => onOpenPlace(attraction.id)}
                    className="w-full text-left rounded-2xl overflow-hidden border border-sun/40 bg-surface">
              <div className="relative">
                <Thumb place={attraction} className="w-full aspect-[16/10] rounded-none" />
                <span className="absolute top-3 left-3 flex items-center gap-1 rounded-full bg-sun text-ink
                                 text-[10px] font-bold uppercase tracking-[0.1em] px-2.5 py-1">
                  <StarIcon size={11} filled /> {MONTH}
                </span>
              </div>
              <div className="p-4">
                <p className="font-semibold leading-tight">{attraction.name}</p>
                <p className="text-xs text-mist">{attraction.region} · {attraction.country}</p>
                {attraction.blurb && (
                  <p className="text-sm text-white/85 leading-snug mt-2">{attraction.blurb}</p>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-3 text-[11px]">
                  {attraction.bestTime && (
                    <span className="inline-flex items-center gap-1.5 text-sun/90 bg-sun/10 rounded-full px-2.5 py-1">
                      <CalendarIcon size={12} /> Best {attraction.bestTime}
                    </span>
                  )}
                  <span className="text-mist">
                    {attraction.monthPhotos ?? 0} photo{attraction.monthPhotos === 1 ? '' : 's'} this month
                  </span>
                </div>
              </div>
            </button>
            <div className="flex gap-2 mt-2">
              <button onClick={() => toggleSavePlace(attraction.id)}
                      className={`flex-1 flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold border transition
                                  ${attraction.saved ? 'bg-brand/15 text-brand border-brand' : 'border-line hover:border-brand'}`}>
                <SaveIcon size={17} filled={attraction.saved} />
                {attraction.saved ? 'On your list' : 'Save place'}
              </button>
              <button onClick={() => onNavigate(attraction.id)}
                      className="flex-1 flex items-center justify-center gap-2 rounded-full bg-brand text-ink py-2.5 text-sm font-semibold">
                <NavIcon size={16} filled /> Navigate
              </button>
            </div>
          </section>
        )}

        {/* ------------------------------------------------- most visited */}
        {mostVisited.length > 0 && (
          <section>
            <h2 className="text-xs uppercase tracking-[0.14em] text-mist mb-1">Most visited</h2>
            <p className="text-[11px] text-mist mb-3">
              Ranked by how many different people have photographed the place — and photos
              can only be taken there, in the app.
            </p>
            <ul className="flex gap-2.5 overflow-x-auto no-bar pb-1 -mx-4 px-4">
              {mostVisited.slice(0, 10).map((p, i) => (
                <li key={p.id} className="shrink-0 w-40">
                  <button onClick={() => onOpenPlace(p.id)}
                          className="w-full text-left bg-surface border border-line rounded-2xl overflow-hidden
                                     hover:border-brand/50 transition">
                    <span className="relative block">
                      <Thumb place={p} className="w-full h-24 rounded-none" />
                      <span className="absolute top-2 left-2 grid place-items-center size-6 rounded-full
                                       bg-ink/85 text-brand text-[11px] font-bold tabular-nums">{i + 1}</span>
                    </span>
                    <span className="block p-2.5">
                      <span className="block text-sm font-semibold truncate">{p.name}</span>
                      <span className="block text-[11px] text-mist truncate">{p.region}</span>
                      <span className="block text-[11px] text-brand mt-1 tabular-nums">
                        {p.visitors} visitor{p.visitors === 1 ? '' : 's'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Around wherever the traveller is, or the month's attraction. */}
        <Nearby centre={here} centreName={hereName} onNavigate={onNavigate} />

        {/* --------------------------------------------------- new places */}
        <section>
          <h2 className="text-xs uppercase tracking-[0.14em] text-mist mb-3">Recently added</h2>
          {newPlaces.length === 0 ? (
            <p className="text-sm text-mist leading-relaxed">
              No new places yet. Add one from the camera screen and everyone gets told.
            </p>
          ) : (
            <ul className="flex gap-2.5 overflow-x-auto no-bar pb-1 -mx-4 px-4">
              {newPlaces.map((p) => (
                <li key={p.id} className="shrink-0 w-40">
                  <button onClick={() => onOpenPlace(p.id)}
                          className="w-full text-left bg-surface border border-line rounded-2xl overflow-hidden
                                     hover:border-brand/50 transition">
                    <Thumb place={p} className="w-full h-24 rounded-none" />
                    <span className="block p-2.5">
                      <span className="block text-sm font-semibold truncate">{p.name}</span>
                      <span className="block text-[11px] text-mist truncate">{p.region}</span>
                      <span className="block text-[11px] text-mist mt-1 truncate">
                        {ago(p.addedAt)} · @{getUser(p.addedBy).handle}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* -------------------------------------------------- alert feed */}
        {notifications.length > 0 && (
          <section>
            <h2 className="text-xs uppercase tracking-[0.14em] text-mist mb-3">Alerts</h2>
            <ul className="grid grid-cols-2 gap-2">
              {notifications.map((n) => {
                const place = getPlace(n.placeId)
                return (
                  <li key={n.id}>
                    <button onClick={() => place && onOpenPlace(place.id)}
                            className={`w-full h-full text-left rounded-2xl border p-3 transition
                                        ${n.read
                                          ? 'border-line bg-surface text-mist hover:border-mist'
                                          : 'border-brand/50 bg-brand/10 text-white'}`}>
                      <span className="flex items-center gap-1.5">
                        {!n.read && <span className="size-1.5 rounded-full bg-brand shrink-0" />}
                        <span className="text-[10px] uppercase tracking-[0.1em] text-mist truncate">
                          {timeAgo(n.at)}
                        </span>
                      </span>
                      <span className="block text-sm font-semibold truncate mt-1">
                        {place?.name ?? 'A new place'}
                      </span>
                      <span className="block text-[11px] text-mist truncate">
                        added by @{getUser(n.by).handle}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>
    </>
  )
}
