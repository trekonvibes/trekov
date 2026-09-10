import { useState } from 'react'
import { PASSWORD_MIN, hasSupabase, setPassword, signOut } from '../lib/auth'
import { useStore } from '../lib/store'
import { syncNow } from '../lib/sync'

const STATUS = {
  idle:    { text: 'Not synced yet', tone: 'text-mist' },
  syncing: { text: 'Syncing…',        tone: 'text-brand' },
  synced:  { text: 'Synced',          tone: 'text-brand' },
  error:   { text: 'Sync failed',     tone: 'text-rose' },
}

export default function Account({ onAuth }) {
  const account = useStore((s) => s.account)
  const sync = useStore((s) => s.sync)

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

  if (!account) {
    return (
      <div className="mx-5 rounded-2xl border border-line bg-surface p-4">
        <p className="text-sm font-semibold">You're not signed in</p>
        <p className="text-xs text-mist leading-relaxed mt-1 mb-3">
          Sign in to keep your trips, places and photos on every device. Everything
          you've already made here comes with you.
        </p>
        <div className="flex gap-2">
          <button onClick={() => onAuth?.('signup')}
                  className="flex-1 rounded-full bg-brand text-ink py-2 text-xs font-semibold">
            Sign up
          </button>
          <button onClick={() => onAuth?.('signin')}
                  className="flex-1 rounded-full border border-line py-2 text-xs font-semibold hover:border-brand hover:text-brand">
            Sign in
          </button>
        </div>
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
      <PasswordSetter handle={account.handle} />
      <p className="text-[11px] text-mist mt-2 leading-relaxed">
        Signing out leaves everything on this device — it does not delete anything.
      </p>
    </div>
  )
}

// Accounts made from an email link have no password yet; this gives them one
// so they can sign in later with @handle or email + password.
function PasswordSetter({ handle }) {
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [state, setState] = useState({ busy: false, error: '', done: false })

  async function save(e) {
    e.preventDefault()
    if (pw.length < PASSWORD_MIN) return setState({ busy: false, error: `Use at least ${PASSWORD_MIN} characters.`, done: false })
    setState({ busy: true, error: '', done: false })
    try {
      await setPassword(pw)
      setPw(''); setOpen(false); setState({ busy: false, error: '', done: true })
    } catch (err) {
      setState({ busy: false, error: err.message || 'Could not save the password.', done: false })
    }
  }

  if (!open) {
    return (
      <div className="mt-2">
        <button onClick={() => { setOpen(true); setState({ busy: false, error: '', done: false }) }}
                className="w-full rounded-full border border-line py-2 text-xs font-semibold hover:border-brand hover:text-brand">
          Set or change password
        </button>
        {state.done && (
          <p className="text-[11px] text-brand mt-2 leading-relaxed">
            Password saved. Next time, sign in with @{handle} or your email and this password.
          </p>
        )}
      </div>
    )
  }
  return (
    <form onSubmit={save} className="mt-3 space-y-2">
      <input type="text" name="username" autoComplete="username" value={handle} readOnly hidden />
      <div className="flex gap-2">
        <input type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus
               autoComplete="new-password" placeholder={`New password (${PASSWORD_MIN}+ characters)`} aria-label="New password"
               className="flex-1 min-w-0 bg-raised rounded-xl px-3.5 py-2.5 text-sm outline-none placeholder:text-mist focus:ring-2 focus:ring-brand/50" />
        <button type="button" onClick={() => setShow((v) => !v)} className="text-xs text-mist px-2 hover:text-white">
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={state.busy || !pw}
                className="flex-1 rounded-full bg-brand text-ink py-2 text-xs font-semibold disabled:opacity-40">
          {state.busy ? 'Saving…' : 'Save password'}
        </button>
        <button type="button" onClick={() => { setOpen(false); setPw('') }}
                className="flex-1 rounded-full border border-line py-2 text-xs font-semibold">
          Cancel
        </button>
      </div>
      {state.error && <p className="text-xs text-rose">{state.error}</p>}
    </form>
  )
}
