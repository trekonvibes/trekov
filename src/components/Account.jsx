import { useEffect, useRef, useState } from 'react'
import { hasSupabase, sendMagicLink, signOut } from '../lib/auth'
import { useStore } from '../lib/store'
import { syncNow } from '../lib/sync'

// The landing page's Sign up / Sign in buttons open the app at
// /app/?auth=signup#profile. Both are the same magic link underneath —
// Supabase creates the account on first use — so only the wording differs.
const COPY = {
  signup: { title: 'Create your account', body: "Enter your email and we'll send a one-time link — no password to set. Anything you've already made on this device comes with you." },
  signin: { title: 'Sign in', body: "We'll email you a one-time link — there's no password." },
  sync:   { title: 'Sign in to sync', body: "Everything you've already made stays and uploads on first sign-in. We email a one-time link — there's no password to set." },
}
const arrivedFor = () => {
  const mode = new URLSearchParams(location.search).get('auth')
  return COPY[mode] ? mode : null
}

const STATUS = {
  idle:    { text: 'Not synced yet', tone: 'text-mist' },
  syncing: { text: 'Syncing…',        tone: 'text-brand' },
  synced:  { text: 'Synced',          tone: 'text-brand' },
  error:   { text: 'Sync failed',     tone: 'text-rose' },
}

export default function Account() {
  const account = useStore((s) => s.account)
  const sync = useStore((s) => s.sync)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode] = useState(arrivedFor)
  const card = useRef(null)
  const input = useRef(null)

  // Arriving from Sign up / Sign in: bring the form into view and put the cursor in it.
  useEffect(() => {
    if (!mode || account) return
    card.current?.scrollIntoView({ block: 'center' })
    input.current?.focus({ preventScroll: true })
  }, [mode, account])

  if (!hasSupabase) {
    return (
      <div className="mx-5 rounded-2xl border border-line bg-surface p-4">
        <p className="text-sm font-semibold">This device only</p>
        <p className="text-xs text-mist leading-relaxed mt-1">
          Your photos, trips and saved places live on this device. Add Supabase
          credentials to sync them across devices and share trips with other people.
        </p>
      </div>
    )
  }

  async function send(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      await sendMagicLink(email)
      setSent(true)
    } catch (err) {
      setError(err.message ?? 'Could not send the link.')
    } finally {
      setBusy(false)
    }
  }

  if (!account) {
    const copy = COPY[mode ?? 'sync']
    return (
      <div ref={card} className={`mx-5 rounded-2xl border bg-surface p-4 ${mode ? 'border-brand/60' : 'border-line'}`}>
        <p className="text-sm font-semibold">{copy.title}</p>
        <p className="text-xs text-mist leading-relaxed mt-1 mb-3">{copy.body}</p>
        {sent ? (
          <p className="text-sm text-brand">Check {email} for the link.</p>
        ) : (
          <form onSubmit={send} className="flex gap-2">
            <input ref={input} type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                   placeholder="you@email.com" autoComplete="email"
                   className="flex-1 min-w-0 bg-raised rounded-xl px-3.5 py-2.5 text-sm outline-none
                              placeholder:text-mist focus:ring-2 focus:ring-brand/50" />
            <button type="submit" disabled={busy || !email.trim()}
                    className="rounded-xl bg-brand text-ink font-semibold text-sm px-4 disabled:opacity-40">
              {busy ? 'Sending…' : 'Send link'}
            </button>
          </form>
        )}
        {error && <p className="text-xs text-rose mt-2">{error}</p>}
      </div>
    )
  }

  const status = STATUS[sync.status] ?? STATUS.idle
  return (
    <div className="mx-5 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">@{account.handle}</p>
          <p className="text-xs text-mist truncate">{account.email}</p>
        </div>
        <span className={`text-[11px] font-semibold ${status.tone}`}>{status.text}</span>
      </div>
      {sync.error && <p className="text-xs text-rose mt-2">{sync.error}</p>}
      <div className="flex gap-2 mt-3">
        <button onClick={() => syncNow(account.id)} disabled={sync.status === 'syncing'}
                className="flex-1 rounded-full border border-line py-2 text-xs font-semibold hover:border-brand disabled:opacity-50">
          Sync now
        </button>
        <button onClick={signOut} className="flex-1 rounded-full border border-line py-2 text-xs font-semibold hover:border-rose hover:text-rose">
          Sign out
        </button>
      </div>
      <p className="text-[11px] text-mist mt-2 leading-relaxed">
        Signing out leaves everything on this device — it does not delete anything.
      </p>
    </div>
  )
}
