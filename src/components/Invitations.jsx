import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../lib/store'
import { myInvites, respondInvite } from '../lib/people'
import { syncNow } from '../lib/sync'

/**
 * Trips you've been invited to, waiting for your answer. Accepting opens the
 * trip (it arrives with the next sync); declining tells whoever invited you.
 * Nobody can put you on a trip without you saying yes — supabase/trip-invites.sql.
 */
export default function Invitations({ onOpen }) {
  const account = useStore((s) => s.account)
  const [invites, setInvites] = useState([])
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => { if (account) myInvites().then(setInvites) }, [account])
  useEffect(() => {
    load()
    const timer = setInterval(() => { if (!document.hidden) load() }, 5_000)
    const onVisible = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  if (!invites.length) return null

  async function answer(invite, accept) {
    setBusy(invite.trip_id)
    setError('')
    try {
      await respondInvite(invite.trip_id, accept)
      setInvites((list) => list.filter((i) => i.trip_id !== invite.trip_id))
      if (accept) {
        await syncNow(account.id)
        onOpen?.(invite.trip_id)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="mx-4 mt-4 rounded-2xl border border-brand/40 bg-brand/10 p-4" aria-label="Trip invitations">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand">Invitations · {invites.length}</p>
      <ul className="mt-2 space-y-2">
        {invites.map((invite) => (
          <li key={invite.trip_id} className="rounded-xl bg-ink/60 border border-line p-3">
            <p className="text-sm font-semibold truncate">{invite.title}</p>
            <p className="text-[11px] text-mist">@{invite.owner_handle ?? 'someone'} invited you to ride together</p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => answer(invite, true)} disabled={busy === invite.trip_id}
                      className="flex-1 min-h-10 rounded-full bg-brand text-ink text-xs font-semibold disabled:opacity-50">
                {busy === invite.trip_id ? 'One moment…' : 'Accept'}
              </button>
              <button onClick={() => answer(invite, false)} disabled={busy === invite.trip_id}
                      className="flex-1 min-h-10 rounded-full border border-line text-xs font-semibold hover:border-rose hover:text-rose disabled:opacity-50">
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-rose mt-2">{error}</p>}
    </section>
  )
}
