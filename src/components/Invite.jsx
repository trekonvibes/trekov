import { useEffect, useState } from 'react'
import { addMember, removeMember, selectMembers, useStore } from '../lib/store'
import { grantTripAccess, inviteLinks, searchProfiles } from '../lib/people'
import { encodeTrip } from '../lib/share'
import { CloseIcon, SearchIcon } from './Icons'

const CHANNELS = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'sms',      label: 'Message' },
  { id: 'email',    label: 'Email' },
]

/** Who is coming, and how to ask them. */
export default function Invite({ trip }) {
  const places = useStore((s) => s.places)
  const members = useStore((s) => selectMembers(s, trip.id))
  const [q, setQ] = useState('')
  const [found, setFound] = useState([])
  const [searching, setSearching] = useState(false)
  const [note, setNote] = useState('')

  const links = inviteLinks(trip.title, encodeTrip(trip, places))

  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return }
    setSearching(true)
    const timer = setTimeout(() => {
      searchProfiles(q).then((people) => { setFound(people); setSearching(false) })
    }, 350)
    return () => clearTimeout(timer)
  }, [q])

  async function invite(person) {
    addMember(trip.id, { id: person.id, handle: person.handle, name: person.name || person.handle })
    setQ(''); setFound([])
    // Adding them locally is only half of it — without this they cannot open
    // the trip at all once it lives on the server.
    const res = await grantTripAccess(trip.id, person.id)
    setNote(res.ok
      ? `@${person.handle} can now open this trip`
      : `@${person.handle} added on this device. They will get access once you are both signed in.`)
    setTimeout(() => setNote(''), 4000)
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs uppercase tracking-[0.14em] text-mist">
          Travelling with{members.length > 0 && ` · ${members.length}`}
        </h2>
      </div>

      {members.length > 0 && (
        <ul className="space-y-1.5 mb-3">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-2 bg-surface border border-line rounded-xl px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">
                @{m.handle}{m.name && m.name !== m.handle && <span className="text-mist"> · {m.name}</span>}
              </span>
              <button onClick={() => removeMember(trip.id, m.id)}
                      className="text-mist hover:text-rose p-1" aria-label={`Remove ${m.handle}`}>
                <CloseIcon size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 bg-raised rounded-xl px-3 py-2.5">
        <SearchIcon size={16} className="text-mist shrink-0" />
        <input value={q} onChange={(e) => setQ(e.target.value)}
               placeholder="Find someone by their handle…"
               className="bg-transparent flex-1 text-sm outline-none placeholder:text-mist min-w-0" />
      </div>

      {q.trim().length >= 2 && (
        <ul className="mt-2 rounded-xl border border-line divide-y divide-line overflow-hidden">
          {searching && <li className="px-3 py-2.5 text-xs text-mist">Searching…</li>}
          {!searching && found.length === 0 && (
            <li className="px-3 py-2.5 text-xs text-mist">
              Nobody found. Send them a link instead — they can join without an account.
            </li>
          )}
          {found.map((person) => (
            <li key={person.id}>
              <button onClick={() => invite(person)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-raised">
                {person.avatar && <img src={person.avatar} alt="" className="size-7 rounded-full object-cover" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm truncate">@{person.handle}</span>
                  {person.name && person.name !== person.handle && (
                    <span className="block text-[11px] text-mist truncate">{person.name}</span>
                  )}
                </span>
                <span className="text-xs text-brand font-semibold shrink-0">Invite</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {note && <p className="text-[11px] text-brand mt-2">{note}</p>}

      <p className="text-[10px] uppercase tracking-[0.14em] text-mist mt-4 mb-2">Send an invite</p>
      <div className="flex gap-2">
        {CHANNELS.map((c) => (
          <a key={c.id} href={links[c.id]} target="_blank" rel="noreferrer"
             className="flex-1 text-center rounded-full border border-line py-2 text-xs font-semibold
                        hover:border-brand hover:text-brand">
            {c.label}
          </a>
        ))}
      </div>
      <p className="text-[11px] text-mist mt-2 leading-relaxed">
        Opens your own app with the message ready — nothing is sent for you, and
        Trekov never reads your contacts. The link carries the whole itinerary,
        so they can open it without an account: in Trekov if they have it, and
        offering the install if they don't.
      </p>
    </section>
  )
}
