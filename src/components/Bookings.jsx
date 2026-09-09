import { useState } from 'react'
import { addBooking, removeBooking, selectBookings, useStore } from '../lib/store'
import { CloseIcon, ExternalIcon, PlusIcon } from './Icons'

/**
 * Trip bookings.
 *
 * This records what you have booked and links out to each provider's own
 * search. It does NOT sell anything: there are no partner APIs behind it, so
 * there is no live availability and no price here that we made up. When
 * partnerships exist, `SEARCH` becomes an API call per provider and the rest
 * of this component is unchanged.
 */

const MODES = [
  { id: 'train',  label: 'Train',  kind: 'transport' },
  { id: 'bus',    label: 'Bus',    kind: 'transport' },
  { id: 'flight', label: 'Flight', kind: 'transport' },
  { id: 'car',    label: 'Car',    kind: 'transport' },
  { id: 'bike',   label: 'Bike',   kind: 'transport' },
  { id: 'stay',   label: 'Stay',   kind: 'stay' },
]

/** Real public search pages — never affiliate or checkout links. */
const SEARCH = {
  train:  (q) => `https://www.google.com/search?q=${encodeURIComponent(`train tickets ${q}`)}`,
  bus:    (q) => `https://www.google.com/search?q=${encodeURIComponent(`bus tickets ${q}`)}`,
  flight: (q) => `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`,
  car:    (q) => `https://www.google.com/search?q=${encodeURIComponent(`car rental ${q}`)}`,
  bike:   (q) => `https://www.google.com/search?q=${encodeURIComponent(`bike rental ${q}`)}`,
  stay:   (q) => `https://www.google.com/travel/search?q=${encodeURIComponent(q)}`,
}

const field = 'bg-raised rounded-xl px-3 py-2 text-sm outline-none placeholder:text-mist focus:ring-2 focus:ring-brand/50'
const blank = { mode: 'train', provider: '', ref: '', from: '', to: '', start: '', end: '', cost: '', notes: '' }

export default function Bookings({ trip, destination }) {
  const bookings = useStore((s) => selectBookings(s, trip.id))
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(blank)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const mode = MODES.find((m) => m.id === form.mode) ?? MODES[0]
  const query = [form.from, form.to || destination].filter(Boolean).join(' to ') || destination || trip.title

  function submit(e) {
    e.preventDefault()
    addBooking(trip.id, { ...form, kind: mode.kind, cost: form.cost.trim() })
    setForm(blank)
    setAdding(false)
  }

  const total = bookings
    .map((b) => Number(String(b.cost).replace(/[^\d.]/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0)
    .reduce((a, b) => a + b, 0)

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs uppercase tracking-[0.14em] text-mist">
          Transport &amp; stays{bookings.length > 0 && ` · ${bookings.length}`}
        </h2>
        <button onClick={() => setAdding((v) => !v)} className="flex items-center gap-1 text-xs font-semibold text-brand">
          <PlusIcon size={14} /> Add
        </button>
      </div>

      {bookings.length === 0 && !adding && (
        <p className="text-sm text-mist leading-relaxed">
          Nothing booked yet. Add a train, bus, flight, rental or stay to keep the
          whole trip in one place.
        </p>
      )}

      {adding && (
        <form onSubmit={submit} className="space-y-2 bg-surface border border-line rounded-2xl p-3 mb-3">
          <div className="flex gap-1.5 overflow-x-auto no-bar">
            {MODES.map((m) => (
              <button key={m.id} type="button" onClick={() => setForm((f) => ({ ...f, mode: m.id }))}
                      aria-pressed={form.mode === m.id}
                      className={`shrink-0 rounded-full px-3 py-1.5 text-xs border transition
                                  ${form.mode === m.id ? 'bg-brand text-ink border-brand font-semibold' : 'border-line text-mist hover:text-white'}`}>
                {m.label}
              </button>
            ))}
          </div>

          {mode.kind === 'transport' ? (
            <div className="grid grid-cols-2 gap-2">
              <input className={field} placeholder="From" value={form.from} onChange={set('from')} />
              <input className={field} placeholder={`To${destination ? ` — ${destination}` : ''}`} value={form.to} onChange={set('to')} />
            </div>
          ) : (
            <input className={field + ' w-full'} placeholder="Where you're staying" value={form.to} onChange={set('to')} />
          )}

          <div className="grid grid-cols-2 gap-2">
            <input className={field} placeholder="Operator / hotel" value={form.provider} onChange={set('provider')} />
            <input className={field} placeholder="Booking ref" value={form.ref} onChange={set('ref')} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.1em] text-mist">
              {mode.kind === 'stay' ? 'Check in' : 'Departs'}
              <input type="date" className={field} value={form.start} onChange={set('start')} />
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.1em] text-mist">
              {mode.kind === 'stay' ? 'Check out' : 'Arrives'}
              <input type="date" className={field} value={form.end} onChange={set('end')} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input className={field} placeholder="Cost (₹)" inputMode="decimal" value={form.cost} onChange={set('cost')} />
            <input className={field} placeholder="Note" value={form.notes} onChange={set('notes')} />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button type="submit" className="rounded-full bg-brand text-ink px-4 py-2 text-sm font-semibold">Save</button>
            <button type="button" onClick={() => { setAdding(false); setForm(blank) }}
                    className="rounded-full border border-line px-4 py-2 text-sm">Cancel</button>
            <a href={SEARCH[form.mode](query)} target="_blank" rel="noreferrer"
               className="ml-auto flex items-center gap-1 text-xs text-brand font-semibold">
              Search {mode.label.toLowerCase()} <ExternalIcon size={12} />
            </a>
          </div>
        </form>
      )}

      <ul className="space-y-2">
        {bookings.map((b) => {
          const label = MODES.find((m) => m.id === b.mode)?.label ?? b.mode
          return (
            <li key={b.id} className="bg-surface border border-line rounded-2xl p-3">
              <div className="flex items-start gap-2">
                <span className="rounded-full bg-brand/15 text-brand text-[10px] font-bold uppercase
                                 tracking-[0.1em] px-2 py-1 shrink-0">{label}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-tight truncate">
                    {b.kind === 'stay' ? (b.to || b.provider || 'Stay') : `${b.from || '—'} → ${b.to || '—'}`}
                  </p>
                  <p className="text-xs text-mist truncate">
                    {[b.provider, b.ref && `ref ${b.ref}`, [b.start, b.end].filter(Boolean).join(' → ')]
                      .filter(Boolean).join(' · ') || 'No details yet'}
                  </p>
                  {b.notes && <p className="text-xs text-white/80 mt-1">{b.notes}</p>}
                </div>
                {b.cost && <span className="text-sm tabular-nums shrink-0">₹{b.cost}</span>}
                <button onClick={() => removeBooking(trip.id, b.id)} className="text-mist hover:text-rose p-1 shrink-0"
                        aria-label="Remove booking">
                  <CloseIcon size={15} />
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {total > 0 && (
        <p className="text-xs text-mist mt-2 text-right tabular-nums">
          Recorded so far: ₹{total.toLocaleString('en-IN')}
        </p>
      )}

      {bookings.length > 0 && (
        <p className="text-[11px] text-mist mt-2 leading-relaxed">
          Trekov records what you've booked elsewhere and links to each provider's search.
          Booking inside the app will arrive with partner integrations.
        </p>
      )}
    </section>
  )
}
