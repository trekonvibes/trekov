import { useState } from 'react'
import { PASSWORD_MIN, deleteAccount, hasSupabase, sendDeletionLink, setPassword, signOut } from '../lib/auth'
import { useStore } from '../lib/store'
import { syncNow } from '../lib/sync'
import { offerLastDay, useMembership } from '../lib/membership'
import { isNativeApp } from '../lib/platform'

// trekov.com/app/?delete-account opens the deletion option straight away:
// Google Play asks for a web link where people can delete their account.
const ASKED_TO_DELETE = new URLSearchParams(window.location.search).has('delete-account')
// Back from the confirmation email (see sendDeletionLink).
const CONFIRMED_BY_EMAIL = ASKED_TO_DELETE && new URLSearchParams(window.location.search).get('confirm') === '1'
const JUST_DELETED = (() => { try { return sessionStorage.getItem('trekov.deleted') === '1' } catch { return false } })()

const STATUS = {
  idle:    { text: 'Not synced yet', tone: 'text-mist' },
  syncing: { text: 'Syncing…',        tone: 'text-brand' },
  synced:  { text: 'Synced',          tone: 'text-brand' },
  error:   { text: 'Sync failed',     tone: 'text-rose' },
}

export default function Account({ onAuth, onPlans }) {
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
        {JUST_DELETED && <p className="text-xs text-brand mb-3">Your Trekov account has been deleted.</p>}
        {ASKED_TO_DELETE && !JUST_DELETED && (
          <p className="text-xs text-sun mb-3">Sign in to the account you want to delete — the option is under your account.</p>
        )}
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
      <OfferNote />
      <PlanStatus onPlans={onPlans} />
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
      <DeleteAccount handle={account.handle} email={account.email} />
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

const fmtDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** Plan status — shown only once paid plans are switched on. */
function PlanStatus({ onPlans }) {
  const m = useMembership()
  if (!m || !m.paywallOn || m.signedOut) return null
  const until = [m.memberUntil, m.businessUntil].filter(Boolean).sort().pop()
  return (
    <div className="mt-3 rounded-xl border border-line p-3 text-xs leading-relaxed">
      {m.founding ? (
        <p><span className="text-brand font-semibold">Founding member</span> — your account stays free.</p>
      ) : m.isMember ? (
        <p>Account active till <b>{fmtDate(until)}</b>{m.businessUntil && m.isBusiness ? ' · Business plan' : ''}</p>
      ) : (
        <p className="text-sun">Your account isn't active — sync, live group trips and posting need a plan.</p>
      )}
      {!m.founding && !isNativeApp && (
        <button onClick={() => onPlans?.(m.isMember ? 'business' : 'rider')}
                className="mt-2 rounded-full bg-brand text-ink px-3 py-1.5 font-semibold">
          {m.isMember ? 'Plans' : `Activate — ₹${m.riderPrice}/year`}
        </button>
      )}
    </div>
  )
}

function DeleteAccount({ handle, email }) {
  const [open, setOpen] = useState(ASKED_TO_DELETE)
  // type → sent → confirmed. The server only deletes after a fresh email sign-in.
  const [stage, setStage] = useState(CONFIRMED_BY_EMAIL ? 'confirmed' : 'type')
  const [typed, setTyped] = useState('')
  const [state, setState] = useState({ busy: false, error: '' })
  const matches = typed.trim().replace(/^@/, '').toLowerCase() === handle.toLowerCase()
  const clearLink = () => window.history.replaceState(null, '', window.location.pathname + window.location.hash)

  async function sendLink(e) {
    e?.preventDefault()
    if ((stage === 'type' && !matches) || state.busy) return
    setState({ busy: true, error: '' })
    try {
      await sendDeletionLink(email)
      setStage('sent')
      setState({ busy: false, error: '' })
    } catch (err) {
      setState({ busy: false, error: err.message })
    }
  }

  async function remove() {
    if (state.busy) return
    setState({ busy: true, error: '' })
    try {
      await deleteAccount()
      clearLink()
      window.location.reload()
    } catch (err) {
      if (err.needsEmail) setStage('type')
      setState({ busy: false, error: err.needsEmail ? 'That confirmation has expired — type your username and we will email a new link.' : err.message })
    }
  }

  function cancel() { setOpen(false); setTyped(''); setStage('type'); clearLink() }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-2 w-full py-2 text-[11px] text-mist hover:text-rose">
        Delete account
      </button>
    )
  }
  return (
    <div className="mt-3 rounded-xl border border-rose/40 bg-rose/5 p-3 space-y-2">
      <p className="text-xs font-semibold text-rose">
        {stage === 'confirmed' ? 'Email confirmed — delete your account?' : 'Delete your account for good'}
      </p>
      <p className="text-[11px] text-mist leading-relaxed">
        This removes your profile, photos, posts, reviews, trips, saved places, business listings and plan from
        Trekov, and signs you out everywhere. It cannot be undone. Places you added stay on the map without your
        name. What is saved on this device stays here until you clear it.
      </p>

      {stage === 'type' && (
        <form onSubmit={sendLink} className="space-y-2">
          <p className="text-[11px] leading-relaxed">
            To make sure it's you, we'll email a link to <b className="break-all">{email}</b>. Open it within
            15 minutes to finish.
          </p>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="none"
                 placeholder={`Type @${handle} to confirm`} aria-label="Type your username to confirm"
                 className="w-full bg-raised rounded-xl px-3.5 py-2.5 text-sm outline-none placeholder:text-mist focus:ring-2 focus:ring-rose/50" />
          <div className="flex gap-2">
            <button type="submit" disabled={!matches || state.busy}
                    className="flex-1 min-h-10 rounded-full bg-rose text-white py-2 text-xs font-semibold disabled:opacity-40">
              {state.busy ? 'Sending…' : 'Email me a confirmation link'}
            </button>
            <button type="button" onClick={cancel} className="flex-1 min-h-10 rounded-full border border-line py-2 text-xs font-semibold">
              Cancel
            </button>
          </div>
        </form>
      )}

      {stage === 'sent' && (
        <div className="space-y-2">
          <p className="text-[11px] leading-relaxed">
            Check your inbox — we sent a link to <b className="break-all">{email}</b>. Open it within 15 minutes and
            you'll come back here to confirm. It can take a minute; check spam if it doesn't show.
          </p>
          <div className="flex gap-2">
            <button onClick={() => sendLink()} disabled={state.busy}
                    className="flex-1 min-h-10 rounded-full border border-line py-2 text-xs font-semibold disabled:opacity-40">
              {state.busy ? 'Sending…' : 'Send again'}
            </button>
            <button onClick={cancel} className="flex-1 min-h-10 rounded-full border border-line py-2 text-xs font-semibold">
              Cancel
            </button>
          </div>
        </div>
      )}

      {stage === 'confirmed' && (
        <div className="flex gap-2">
          <button onClick={remove} disabled={state.busy}
                  className="flex-1 min-h-10 rounded-full bg-rose text-white py-2 text-xs font-semibold disabled:opacity-40">
            {state.busy ? 'Deleting…' : `Delete @${handle} for good`}
          </button>
          <button onClick={cancel} className="flex-1 min-h-10 rounded-full border border-line py-2 text-xs font-semibold">
            Keep my account
          </button>
        </div>
      )}
      {state.error && <p className="text-xs text-rose">{state.error}</p>}
    </div>
  )
}

/** Founding members, and the pre-release offer while it runs. */
function OfferNote() {
  const m = useMembership()
  if (!m || m.signedOut) return null
  if (m.founding) {
    return <p className="mt-3 text-xs text-brand leading-relaxed">Founding member — Trekov stays free for you.</p>
  }
  if (!m.offerActive) return null
  return (
    <p className="mt-3 rounded-xl border border-brand/30 bg-brand/5 px-3 py-2 text-xs leading-relaxed">
      <span className="text-brand font-semibold">Pre-release offer:</span> everything is free until {offerLastDay(m.offerEndsAt)}.
      Nothing to pay.
    </p>
  )
}
