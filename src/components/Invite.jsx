import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addMember, captainOf, isPublic, removeMember, selectMembers, selectSharing, setCaptain, setSharing,
  setVisibility, toggleSharingWith, useStore,
} from '../lib/store'
import {
  answerJoin, inviteLinks, inviteToTrip, removeFromTrip, searchProfiles, tripInvites,
} from '../lib/people'
import { syncNow } from '../lib/sync'
import { buzz, notifyLocal } from '../lib/native'
import PersonSheet from './PersonSheet'
import { pushToTrip } from '../lib/push'
import { encodeTrip, shortTripLink } from '../lib/share'
import { CloseIcon, SearchIcon } from './Icons'

const CHANNELS = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'sms',      label: 'Message' },
  { id: 'email',    label: 'Email' },
]

/** Who is coming, and how to ask them. */
export default function Invite({ trip }) {
  const places = useStore((s) => s.places)
  const localMembers = useStore((s) => selectMembers(s, trip.id))
  const sharing = useStore((s) => selectSharing(s, trip.id))
  const [q, setQ] = useState('')
  const [found, setFound] = useState([])
  const [searching, setSearching] = useState(false)
  const [note, setNote] = useState('')
  const account = useStore((s) => s.account)
  // Where each invite stands, from the server: pending, accepted or declined.
  const [statuses, setStatuses] = useState({})
  // Whose profile is open, and which requests this screen has already announced.
  const [showPerson, setShowPerson] = useState(null)
  const announced = useRef(null)
  const refresh = useCallback(() => {
    tripInvites(trip.id).then((next) => {
      setStatuses(next)
      // Whatever was already waiting when this screen opened is the baseline —
      // the host has seen it. Only what arrives afterwards is worth a buzz.
      if (!announced.current) {
        announced.current = new Set(Object.entries(next)
          .filter(([, v]) => v.status === 'requested').map(([id]) => id))
      }
    })
  }, [trip.id])
  useEffect(() => {
    refresh()
    const timer = setInterval(() => { if (!document.hidden) refresh() }, 5_000)
    const onVisible = () => { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [refresh])

  // A new request is worth interrupting for: the phone buzzes, and if Trekov
  // isn't the screen in front, it raises a notification. The first poll after
  // opening only takes stock — it doesn't re-announce what was already waiting.
  useEffect(() => {
    const waiting = Object.entries(statuses).filter(([, v]) => v.status === 'requested').map(([id]) => id)
    const seen = announced.current
    if (!seen) return                                  // the first answer hasn't landed yet
    announced.current = new Set(waiting)
    const fresh = waiting.filter((id) => !seen.has(id))
    if (!fresh.length || !isHost) return
    const who = statuses[fresh[0]]?.handle ?? 'Someone'
    buzz('alert')
    if (document.hidden) notifyLocal({ title: `@${who} wants to join`, body: trip.title })
  }, [statuses])

  const users = useStore((s) => s.users)
  const profile = useStore((s) => s.profile)
  // The host is the trip's owner — whoever made it. A trip that hasn't reached
  // the server yet has no owner recorded, so it belongs to this phone.
  const hostId = trip.ownerId ?? account?.id ?? null
  const isHost = !trip.ownerId || trip.ownerId === account?.id
  // Until someone is named, the host leads. A trip made a moment ago has no
  // owner recorded yet either, and the header read "Captain · @rider" with a
  // Make captain button on the host's own row (Android, 2026-09-13).
  const captainId = captainOf(trip) ?? hostId
  // The signed-in account, then anyone the app knows, then this device's own
  // handle for a trip that has never left it.
  const handleOf = (id) => (id && id === account?.id ? account.handle
    : users[id]?.handle ?? statuses[id]?.handle ?? (id === hostId && isHost ? profile.handle : 'rider'))

  // The buttons carry the long link until the short one arrives from the
  // server, so tapping early still shares something that works.
  const [url, setUrl] = useState(() => encodeTrip(trip, places))
  useEffect(() => {
    let alive = true
    shortTripLink(trip, places).then((u) => { if (alive) setUrl(u) })
    return () => { alive = false }
  }, [trip.id, trip.title, trip.stops, account?.id])
  const links = inviteLinks(trip.title, url)
  // Everyone invited, as the server knows it — this phone's own list can be
  // missing people (older versions lost it on sync, or another device invited them).
  const members = [
    ...localMembers,
    ...Object.entries(statuses)
      .filter(([id, v]) => v.handle && v.status !== 'requested' && !localMembers.some((m) => m.id === id))
      .map(([id, v]) => ({ id, handle: v.handle, name: v.name || v.handle })),
  ].filter((m) => statuses[m.id]?.status !== 'requested')

  // Riders who found the trip under Open rides and asked to come along. The
  // host answers each one, exactly as they would an invite they sent.
  const requests = Object.entries(statuses)
    .filter(([, v]) => v.status === 'requested')
    .map(([id, v]) => ({ id, handle: v.handle || 'rider', name: v.name || '', avatar: v.avatar || '' }))

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
    setNote(`Sending an invite to @${person.handle}…`)
    // The trip has to be on the server before anyone can be invited to it.
    if (account) await syncNow(account.id)
    const res = await inviteToTrip(trip.id, person.id)
    // Their phone hears about it even with Trekov closed.
    if (res.ok) {
      pushToTrip({
        tripId: trip.id, kind: 'invite', toUserId: person.id,
        title: `@${handleOf(hostId)} invited you on a trip`,
        body: trip.title,
      })
    }
    // Refused by the server (one of you has blocked the other): take them back
    // off the list rather than showing a rider who will never be invited.
    // It used to say "added on this device" (testing, 2026-09-14).
    const refused = !res.ok && /cannot be added|row-level security|violates/i.test(res.reason ?? '')
    if (refused) removeMember(trip.id, person.id)
    setNote(res.ok
      ? `Invite sent to @${person.handle} — it shows as pending until they accept.`
      : refused
        ? `@${person.handle} can't be added to this trip.`
        : `@${person.handle} added on this device. The invite is sent once your trip has synced.`)
    refresh()
    setTimeout(() => setNote(''), 5000)
  }

  async function resend(m) {
    const res = await inviteToTrip(trip.id, m.id)
    setNote(res.ok ? `Invite sent to @${m.handle} again.` : 'Could not resend the invite — try again in a moment.')
    refresh()
    setTimeout(() => setNote(''), 4000)
  }

  async function assignCaptain(personId) {
    setCaptain(trip.id, personId)
    setNote(personId === account?.id ? 'You lead this trip now.' : `@${handleOf(personId)} leads this trip now.`)
    if (account) await syncNow(account.id)
    setTimeout(() => setNote(''), 4000)
  }

  async function answer(person, accept) {
    setNote(accept ? `Adding @${person.handle}…` : `Turning down @${person.handle}…`)
    const res = await answerJoin(trip.id, person.id, accept)
    if (res.ok && accept) {
      addMember(trip.id, { id: person.id, handle: person.handle, name: person.name || person.handle })
      pushToTrip({
        tripId: trip.id, kind: 'invite', toUserId: person.id,
        title: `@${handleOf(hostId)} added you to the ride`,
        body: trip.title,
      })
    }
    setNote(res.ok
      ? (accept ? `@${person.handle} is coming along.` : `@${person.handle} was turned down.`)
      : 'Could not answer that just now — try again in a moment.')
    refresh()
    setTimeout(() => setNote(''), 4000)
  }

  async function openUp(next) {
    setVisibility(trip.id, next ? 'public' : 'private')
    setNote(next
      ? 'Listed under Open rides. Riders can ask to join; you decide who comes.'
      : 'Back to invite only. It is off the list, and anyone already on the trip stays.')
    if (account) await syncNow(account.id)
    setTimeout(() => setNote(''), 5000)
  }

  function remove(m) {
    removeMember(trip.id, m.id)
    removeFromTrip(trip.id, m.id).then(refresh)
  }

  const Face = ({ id, handle: h, size = 'size-8' }) => {
    // The server's picture first: the local profile can still hold a picture
    // from an account signed in earlier on this phone.
    const src = statuses[id]?.avatar || users[id]?.avatar || (id === account?.id ? profile.avatar : '')
    return src
      ? <img src={src} alt="" className={`${size} rounded-full object-cover bg-raised shrink-0`} />
      : <span className={`${size} rounded-full bg-raised grid place-items-center text-[11px] text-mist shrink-0`}>
          {(h ?? '?').slice(0, 1).toUpperCase()}
        </span>
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs uppercase tracking-[0.14em] text-mist">
          Travelling with{members.length > 0 && ` · ${members.length}`}
        </h2>
        <span className="text-[10px] text-mist truncate max-w-[55%]">
          Captain · @{handleOf(captainId)}{captainId === hostId && ' (host)'}
        </span>
      </div>

      <ul className="space-y-1.5 mb-3">
        <li className="flex items-center gap-2 bg-surface border border-line rounded-xl px-3 py-2">
          {/* A rider can open the host's profile too — it is where Report and
              Block are, and the host was the one person on a trip nobody could
              block (testing, 2026-09-14). */}
          <button onClick={() => !isHost && hostId && setShowPerson({ userId: hostId, handle: handleOf(hostId) })}
                  disabled={isHost} aria-label={isHost ? undefined : `See @${handleOf(hostId)}'s profile`}>
            <Face id={hostId} handle={handleOf(hostId)} />
          </button>
          <button onClick={() => !isHost && hostId && setShowPerson({ userId: hostId, handle: handleOf(hostId) })}
                  disabled={isHost} className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm">
              @{handleOf(hostId)}{isHost && <span className="text-mist"> · you</span>}
            </span>
            <span className="block text-[11px] text-mist">Host — adds and removes riders, names the captain</span>
          </button>
          <CaptainTag isCaptain={captainId === hostId} canAssign={isHost && captainId !== hostId}
                      onAssign={() => assignCaptain(hostId)} />
        </li>
        {members.map((m) => {
            const hidden = sharing.hiddenFrom.includes(m.id)
            return (
              <li key={m.id} className="flex items-center gap-2 bg-surface border border-line rounded-xl px-3 py-2">
                <button onClick={() => setShowPerson({ userId: m.id, handle: m.handle })}
                        aria-label={`See @${m.handle}'s profile`}>
                  <Face id={m.id} handle={m.handle} />
                </button>
                <span className="min-w-0 flex-1">
                  {/* Handle on one line, the name under it, each cut with an
                      ellipsis. On one line a long name ran under the Sharing
                      and Make captain buttons — a button does not shrink to its
                      column unless it is told to (w-full min-w-0). */}
                  <button onClick={() => setShowPerson({ userId: m.id, handle: m.handle })}
                          className="block w-full min-w-0 text-left">
                    <span className="block truncate text-sm">@{m.handle}</span>
                    {m.name && m.name !== m.handle && (
                      <span className="block truncate text-[11px] text-mist">{m.name}</span>
                    )}
                  </button>
                  <InviteStatus status={statuses[m.id]?.status} onResend={() => resend(m)} />
                </span>

                {/* Per-person, so one awkward companion does not cost you the
                    whole group map. Disabled while sharing is off entirely —
                    there is nothing to hide from anyone. */}
                <button onClick={() => toggleSharingWith(trip.id, m.id)}
                        disabled={!sharing.on}
                        aria-pressed={!hidden}
                        title={hidden ? `${m.handle} cannot see your location` : `${m.handle} can see your location`}
                        className={`text-[10px] font-semibold rounded-full px-2 py-1 border shrink-0 disabled:opacity-40
                                    ${hidden ? 'border-line text-mist' : 'border-brand/60 text-brand'}`}>
                  {hidden ? 'Hidden' : 'Sharing'}
                </button>

                {/* Only a rider who has accepted can lead. */}
                <CaptainTag isCaptain={captainId === m.id}
                            canAssign={isHost && captainId !== m.id && statuses[m.id]?.status === 'accepted'}
                            onAssign={() => assignCaptain(m.id)} />

                {isHost && (
                  <button onClick={() => remove(m)}
                          className="text-mist hover:text-rose p-1" aria-label={`Remove ${m.handle}`}>
                    <CloseIcon size={15} />
                  </button>
                )}
              </li>
            )
        })}
      </ul>

      {isHost && requests.length > 0 && (
        <div className="rounded-xl border border-sun/50 bg-sun/5 px-3 py-2.5 mb-3">
          <p className="text-xs font-semibold text-sun mb-2">
            {requests.length === 1 ? 'Someone wants to come along' : `${requests.length} riders want to come along`}
          </p>
          <ul className="space-y-1.5">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <button onClick={() => setShowPerson({ userId: r.id, handle: r.handle })}
                        aria-label={`See @${r.handle}'s profile`}>
                  <Face id={r.id} handle={r.handle} size="size-9" />
                </button>
                <button onClick={() => setShowPerson({ userId: r.id, handle: r.handle })}
                        className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm">@{r.handle}</span>
                  {r.name && r.name !== r.handle && (
                    <span className="block text-[11px] text-mist truncate">{r.name}</span>
                  )}
                  <span className="block text-[10px] text-mist">Tap to see their photos</span>
                </button>
                <button onClick={() => answer(r, true)}
                        className="shrink-0 rounded-full bg-brand/15 border border-brand text-brand
                                   text-[11px] font-semibold px-3 py-1">
                  Add
                </button>
                <button onClick={() => answer(r, false)}
                        className="shrink-0 rounded-full border border-line text-mist text-[11px] font-semibold px-3 py-1
                                   hover:border-rose hover:text-rose">
                  No
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-mist mt-2 leading-relaxed">
            They see the trip, the live map and the voice channel only once you add them.
          </p>
        </div>
      )}

      {/* Who can find the ride. Public lists it; it opens nothing else. */}
      {isHost && (
        <div className="flex items-start gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 mb-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Open ride</p>
            <p className="text-[11px] text-mist leading-snug mt-0.5">
              {isPublic(trip)
                ? 'Other riders can find this trip and ask to join. They see the title, the dates, where it starts and ends, and how many are going — never your notes, bookings or anyone\'s location.'
                : 'Invite only. Nobody else can see that this trip exists.'}
            </p>
          </div>
          <button onClick={() => openUp(!isPublic(trip))}
                  aria-pressed={isPublic(trip)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border transition
                              ${isPublic(trip) ? 'bg-brand/15 text-brand border-brand' : 'border-line text-mist'}`}>
            {isPublic(trip) ? 'Public' : 'Private'}
          </button>
        </div>
      )}

      {/* The master switch. Off means nothing is broadcast at all. */}
      <div className="flex items-start gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 mb-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Share my live location</p>
          <p className="text-[11px] text-mist leading-snug mt-0.5">
            {sharing.on
              ? 'The others see you move on the map while you navigate.'
              : 'Nothing leaves your phone. You still see everyone else.'}
          </p>
        </div>
        <button onClick={() => setSharing(trip.id, !sharing.on)}
                aria-pressed={sharing.on}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border transition
                            ${sharing.on ? 'bg-brand/15 text-brand border-brand' : 'border-line text-mist'}`}>
          {sharing.on ? 'On' : 'Off'}
        </button>
      </div>

      {sharing.on && sharing.hiddenFrom.length > 0 && (
        <p className="text-[10px] text-mist mb-3 leading-relaxed">
          Hidden from {sharing.hiddenFrom.length} {sharing.hiddenFrom.length === 1 ? 'person' : 'people'}.
          Their app is asked not to show you — switching sharing off is the one that sends nothing at all.
        </p>
      )}

      {isHost ? (
        <>
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
        </>
      ) : (
        <p className="text-[11px] text-mist leading-relaxed">
          Only the host — @{handleOf(hostId)} — adds or removes riders and names the captain.
        </p>
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
      {showPerson && (
        <PersonSheet userId={showPerson.userId} handle={showPerson.handle} onClose={() => setShowPerson(null)} />
      )}

      <p className="text-[11px] text-mist mt-2 leading-relaxed">
        Opens your own app with the message ready — nothing is sent for you, and
        Trekov never reads your contacts. The link carries the whole itinerary,
        so they can open it without an account: in Trekov if they have it, and
        offering the install if they don't.
      </p>
    </section>
  )
}

const STATUS_LOOK = {
  pending:  { label: 'Invite sent · pending', tone: 'text-sun' },
  accepted: { label: 'Accepted',              tone: 'text-brand' },
  declined: { label: 'Declined',              tone: 'text-rose' },
  requested:{ label: 'Asked to join',         tone: 'text-sun' },
}

/** Where an invite stands. Nothing is shown for companions only on this device. */
function InviteStatus({ status, onResend }) {
  const look = STATUS_LOOK[status]
  if (!look) return null
  return (
    <span className={`flex items-center gap-2 text-[11px] font-semibold ${look.tone}`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {look.label}
      {status === 'declined' && (
        <button onClick={onResend} className="text-mist font-semibold underline underline-offset-2 hover:text-white">Resend</button>
      )}
    </span>
  )
}

/**
 * Who leads the ride. The host can hand it to any rider who has accepted, or
 * keep it; everyone else just sees who it is (supabase/trip-roles.sql).
 */
function CaptainTag({ isCaptain, canAssign, onAssign }) {
  if (isCaptain) {
    return (
      <span className="shrink-0 rounded-full border border-brand/60 bg-brand/10 text-brand text-[10px] font-semibold px-2 py-1">
        Captain
      </span>
    )
  }
  if (!canAssign) return null
  return (
    <button onClick={onAssign}
            className="shrink-0 rounded-full border border-line text-mist text-[10px] font-semibold px-2 py-1
                       hover:border-brand hover:text-brand">
      Make captain
    </button>
  )
}
