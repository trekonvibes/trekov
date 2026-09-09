import { useEffect, useState } from 'react'
import { addStop, selectPlaceSearch, useStore } from '../lib/store'
import { searchAnywhere } from '../lib/geocode'
import { adoptHit } from '../lib/adopt'
import { SearchIcon } from './Icons'

/**
 * Add a stop without leaving the trip.
 *
 * Two sources, in the order that is useful: places Trekov already knows —
 * which includes everything on the To Visit list — then anywhere in the world
 * by geocode, so a hotel or a junction that is not a Trekov place yet can
 * still be a stop. World results are adopted on the way in, the same as a map
 * search, so a trip never holds a stop with nothing behind it.
 */
export default function AddStop({ trip, onAdded }) {
  const [q, setQ] = useState('')
  const [world, setWorld] = useState([])
  const [searching, setSearching] = useState(false)

  const known = useStore((s) => selectPlaceSearch(s, q))
  const already = new Set(trip.stops.map((s) => s.placeId))
  const local = known.filter((p) => !already.has(p.id)).slice(0, 6)

  useEffect(() => {
    if (q.trim().length < 3) { setWorld([]); return }
    setSearching(true)
    let live = true
    const timer = setTimeout(() => {
      searchAnywhere(q).then((hits) => {
        if (!live) return
        setWorld(hits)
        setSearching(false)
      })
    }, 350)
    return () => { live = false; clearTimeout(timer) }
  }, [q])

  function add(placeId, name) {
    addStop(trip.id, placeId)
    setQ('')
    setWorld([])
    onAdded?.(name)
  }

  // A place already in the atlas wins over the geocoder's version of it.
  const seen = new Set(local.map((p) => p.name.toLowerCase()))
  const elsewhere = world.filter((h) => !seen.has(h.name.toLowerCase()))

  return (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <div className="flex items-center gap-2 bg-raised rounded-xl px-3 py-2.5">
        <SearchIcon size={16} className="text-mist shrink-0" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
               placeholder="Search a place to add…"
               className="bg-transparent flex-1 text-sm outline-none placeholder:text-mist min-w-0" />
      </div>

      <ul className="mt-2 divide-y divide-line">
        {local.map((p) => (
          <li key={p.id}>
            <button onClick={() => add(p.id, p.name)}
                    className="w-full text-left py-2.5 px-1 hover:bg-raised rounded-lg">
              <span className="block text-sm truncate">{p.name}</span>
              <span className="block text-[11px] text-mist truncate">
                {[p.region, p.country].filter(Boolean).join(' · ')}
              </span>
            </button>
          </li>
        ))}

        {elsewhere.map((h) => (
          <li key={h.id}>
            <button onClick={() => add(adoptHit(h), h.name)}
                    className="w-full text-left py-2.5 px-1 hover:bg-raised rounded-lg">
              <span className="block text-sm truncate">{h.name}</span>
              <span className="block text-[11px] text-mist truncate">{h.detail}</span>
            </button>
          </li>
        ))}
      </ul>

      {searching && <p className="text-[11px] text-mist px-1 pt-1">Searching…</p>}
      {!searching && q.trim().length >= 3 && local.length === 0 && elsewhere.length === 0 && (
        <p className="text-[11px] text-mist px-1 pt-1 leading-relaxed">
          Nothing found{navigator.onLine ? '' : ' — you are offline, so only saved places are searchable'}.
        </p>
      )}
    </div>
  )
}
