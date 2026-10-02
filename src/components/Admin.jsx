import { useEffect, useRef, useState } from 'react'
import { photoUrl } from '../lib/supabase'
import { useStore } from '../lib/store'
import { ago, formatDateTime } from '../lib/format'
import * as admin from '../lib/admin'
import { BackIcon, CloseIcon, SearchIcon } from './Icons'

// Trekov admin (Punit, 2026-09-11): sign-ups, what people are doing, and the
// tools to run the app — on the web at trekov.com/app/#admin and in the phone
// apps under You → Admin. Only accounts in the server's `admins` table get in;
// every number and every change goes through the admin_* functions in
// supabase/admin.sql, which check that on the server and log each change.

const SECTIONS = [
  ['overview', 'Overview'], ['users', 'Users'], ['activity', 'Activity'],
  ['reports', 'Reports'], ['content', 'Content'], ['settings', 'Settings'], ['log', 'Admin log'],
]
const field = 'w-full bg-raised rounded-xl px-3.5 py-2.5 text-sm outline-none placeholder:text-mist focus:ring-2 focus:ring-brand/50 [color-scheme:dark]'
const pill = 'rounded-full border border-line px-3 py-1.5 text-xs font-semibold hover:border-brand hover:text-brand disabled:opacity-40'
const num = (n) => Number(n ?? 0).toLocaleString('en-IN')
const inr = (paise) => `₹${Math.round((paise ?? 0) / 100).toLocaleString('en-IN')}`
// Dates as YYYY-MM-DD in India time, which is how the server keeps plan dates.
const istDate = (ms = Date.now()) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const fmtDay = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '')
const isBanned = (u) => Boolean(u?.banned_until) && Date.parse(u.banned_until) > Date.now()

export default function Admin({ onClose }) {
  const account = useStore((s) => s.account)
  const [access, setAccess] = useState({ state: 'checking', error: '' })
  const [section, setSection] = useState('overview')
  // The account open in detail, over whichever section it was opened from.
  const [userId, setUserId] = useState(null)
  // After an account is deleted: say so, and reload the lists (keyed remount).
  const [notice, setNotice] = useState('')
  const [fresh, setFresh] = useState(0)
  const deleted = (handle) => { setUserId(null); setNotice(`@${handle}'s account was deleted.`); setFresh((n) => n + 1) }

  useEffect(() => {
    admin.amIAdmin()
      // An admin still has to pass two-step sign-in (TwoStep) before anything loads.
      .then((ok) => setAccess({ state: ok ? 'twostep' : 'no', error: '' }))
      .catch((e) => setAccess({ state: 'error', error: e.message }))
  }, [account?.id])

  const openUser = (id) => { if (id) setUserId(id) }
  const pages = {
    overview: <Overview onGo={setSection} />,
    users: <Users onOpen={openUser} />,
    activity: <Activity onOpenUser={openUser} />,
    reports: <Reports />,
    content: <Content onOpenUser={openUser} />,
    settings: <Settings />,
    log: <Log onOpenUser={openUser} />,
  }

  return (
    <div className="fixed inset-0 z-[1200] bg-ink flex flex-col pt-safe px-safe" role="dialog" aria-label="Trekov admin">
      <header className="flex items-center gap-3 px-3 h-14 border-b border-line shrink-0">
        <button onClick={userId ? () => setUserId(null) : onClose} aria-label={userId ? 'Back' : 'Close admin'}
                className="p-2 text-mist hover:text-white">
          {userId ? <BackIcon size={20} /> : <CloseIcon size={20} />}
        </button>
        <h1 className="text-base font-semibold flex-1">Trekov admin</h1>
        {account && <span className="text-xs text-mist truncate max-w-[40%]">@{account.handle}</span>}
      </header>

      {access.state === 'checking' ? (
        <p className="p-5 text-sm text-mist">Checking access…</p>
      ) : access.state === 'error' ? (
        <p className="p-5 text-sm text-rose">Couldn't reach the server: {access.error}</p>
      ) : access.state === 'twostep' ? (
        <TwoStep onDone={() => setAccess({ state: 'ok', error: '' })} />
      ) : access.state === 'no' ? (
        <div className="p-5 max-w-md">
          <p className="text-base font-semibold">Admins only</p>
          <p className="text-sm text-mist mt-1 leading-relaxed">
            This area is for the people who run Trekov. Your account doesn't have admin access.
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          <nav aria-label="Admin sections"
               className="shrink-0 flex md:flex-col gap-1 overflow-x-auto px-3 py-2 md:py-4 md:w-52 border-b md:border-b-0 md:border-r border-line">
            {SECTIONS.map(([id, label]) => (
              <button key={id} onClick={() => { setSection(id); setUserId(null); setNotice('') }}
                      aria-current={section === id && !userId ? 'page' : undefined}
                      className={`shrink-0 rounded-full md:rounded-xl px-3.5 py-2 text-sm font-semibold text-left whitespace-nowrap
                                  ${section === id && !userId ? 'bg-brand text-ink' : 'text-mist hover:text-white hover:bg-raised'}`}>
                {label}
              </button>
            ))}
          </nav>
          <main className="flex-1 min-h-0 overflow-y-auto pb-safe">
            <div className="max-w-5xl mx-auto p-4 md:p-6">
              {userId && <UserDetail id={userId} onOpenUser={openUser} onDeleted={deleted} />}
              {/* Kept mounted under the detail view, so Back returns to the same list. */}
              <div hidden={Boolean(userId)} key={fresh} className="space-y-3">
                {notice && <Note note={{ text: notice }} />}
                {pages[section]}
              </div>
            </div>
          </main>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ two-step sign-in

/**
 * Admin's second step: a 6-digit code from an authenticator app. The first
 * time, it sets the app up with a QR code. The server refuses admin calls
 * until this session is confirmed, so this screen is the way in, not the lock.
 */
function TwoStep({ onDone }) {
  const [mode, setMode] = useState('checking')   // checking | challenge | enroll
  const [setup, setSetup] = useState(null)        // { factorId, qr, secret } while adding the app
  const [code, setCode] = useState('')
  const [state, setState] = useState({ busy: false, error: '' })

  useEffect(() => {
    admin.twoStepStatus()
      .then((s) => (s === 'ok' ? onDone() : setMode(s)))
      .catch((e) => setState({ busy: false, error: e.message }))
  }, [])
  useEffect(() => {
    if (mode !== 'enroll' || setup) return
    admin.startTwoStep().then(setSetup).catch((e) => setState({ busy: false, error: e.message }))
  }, [mode])

  async function verify(e) {
    e.preventDefault()
    if (code.length !== 6 || state.busy) return
    setState({ busy: true, error: '' })
    try {
      await admin.verifyTwoStep(code, setup?.factorId)
      onDone()
    } catch (err) {
      setState({ busy: false, error: err.message })
      setCode('')
    }
  }

  if (mode === 'checking') return state.error ? <div className="p-5"><Problem text={state.error} /></div> : <p className="p-5 text-sm text-mist">Checking two-step sign-in…</p>
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-5 max-w-sm mx-auto w-full space-y-4">
        <div>
          <p className="text-base font-semibold">{mode === 'enroll' ? 'Set up two-step sign-in' : 'Two-step sign-in'}</p>
          <p className="text-sm text-mist mt-1 leading-relaxed">
            {mode === 'enroll'
              ? 'Admin needs a second step. Scan this with an authenticator app — Google Authenticator, Microsoft Authenticator, 1Password or Authy — then type the 6-digit code it shows.'
              : 'Type the 6-digit code from your authenticator app.'}
          </p>
        </div>
        {mode === 'enroll' && (setup ? (
          <div className="space-y-2">
            <div className="rounded-2xl bg-white p-3 w-fit mx-auto">
              <img src={setup.qr} alt="QR code to scan with your authenticator app" className="size-44" />
            </div>
            <p className="text-[11px] text-mist leading-relaxed break-all">
              Setting up on this phone, or can't scan? Add it in the app with this key:{' '}
              <span className="font-mono text-white select-all">{setup.secret}</span>
            </p>
          </div>
        ) : !state.error && <p className="text-sm text-mist">Preparing…</p>)}
        <form onSubmit={verify} className="space-y-2">
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                 inputMode="numeric" autoComplete="one-time-code" autoFocus placeholder="000000" aria-label="6-digit code"
                 className={`${field} text-center text-2xl font-semibold tracking-[0.4em]`} />
          <button type="submit" disabled={code.length !== 6 || state.busy || (mode === 'enroll' && !setup)}
                  className="w-full rounded-full bg-brand text-ink py-3 text-sm font-semibold disabled:opacity-40">
            {state.busy ? 'Checking…' : mode === 'enroll' ? 'Turn on two-step sign-in' : 'Continue'}
          </button>
        </form>
        <Problem text={state.error} />
        <p className="text-[11px] text-mist leading-relaxed">
          {mode === 'enroll'
            ? 'Keep that app on your phone: every time you open admin, it asks for a fresh code.'
            : 'Lost the phone with your authenticator app? It can be reset in the Supabase SQL editor (see supabase/admin.sql).'}
        </p>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ helpers

function useLoad(load, deps) {
  const [state, setState] = useState({ data: null, error: '' })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    load().then((data) => live && setState({ data, error: '' }))
      .catch((e) => live && setState((s) => ({ ...s, error: e.message })))
    return () => { live = false }
  }, [...deps, tick])
  return [state, () => setTick((t) => t + 1)]
}

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

/** A server list with "Load more": fetchPage(offset) -> { total, rows }. */
function usePaged(fetchPage, deps) {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const seq = useRef(0)
  const load = async (offset) => {
    const mine = ++seq.current
    setBusy(true); setError('')
    try {
      const r = await fetchPage(offset)
      if (mine !== seq.current) return
      setTotal(r?.total ?? 0)
      setRows((old) => (offset ? [...old, ...(r?.rows ?? [])] : (r?.rows ?? [])))
    } catch (e) {
      if (mine === seq.current) setError(e.message)
    } finally {
      if (mine === seq.current) setBusy(false)
    }
  }
  useEffect(() => { setRows([]); load(0) }, deps)
  return {
    rows, total, busy, error,
    more: () => load(rows.length),
    drop: (id) => { setRows((old) => old.filter((r) => r.id !== id)); setTotal((t) => Math.max(0, t - 1)) },
    patch: (id, change) => setRows((old) => old.map((r) => (r.id === id ? { ...r, ...change } : r))),
  }
}

/** Two taps for anything that changes or removes something: no dialogs, works the same in the apps. */
function ConfirmButton({ children, confirm = 'Tap again to confirm', onConfirm, danger = false, disabled = false }) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])
  async function click() {
    if (!armed) return setArmed(true)
    setArmed(false); setBusy(true)
    try { await onConfirm() } finally { setBusy(false) }
  }
  return (
    <button onClick={click} disabled={disabled || busy}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold disabled:opacity-40
                        ${armed ? 'bg-rose border-rose text-white'
                                : danger ? 'border-rose/50 text-rose hover:bg-rose/10' : 'border-line hover:border-brand hover:text-brand'}`}>
      {busy ? 'Working…' : armed ? confirm : children}
    </button>
  )
}

const Problem = ({ text }) => (text ? <p className="rounded-xl border border-rose/40 bg-rose/5 text-rose text-sm px-3 py-2">{text}</p> : null)
const Loading = ({ error }) => (error ? <Problem text={error} /> : <p className="text-sm text-mist py-2">Loading…</p>)

function Note({ note }) {
  if (!note?.text) return null
  return (
    <p className={`rounded-xl border text-sm px-3 py-2 ${note.bad ? 'border-rose/40 bg-rose/5 text-rose' : 'border-brand/30 bg-brand/10 text-brand'}`}>
      {note.text}
    </p>
  )
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <label className="flex items-center gap-2 bg-raised rounded-xl px-3.5 focus-within:ring-2 focus-within:ring-brand/50">
      <SearchIcon size={16} className="text-mist shrink-0" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
             autoCapitalize="none" autoComplete="off" className="flex-1 min-w-0 bg-transparent py-2.5 text-sm outline-none placeholder:text-mist" />
    </label>
  )
}

function Chips({ options, value, onChange }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5">
      {options.map(([id, label]) => (
        <button key={id} onClick={() => onChange(id)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border
                            ${value === id ? 'bg-brand border-brand text-ink' : 'border-line text-mist hover:text-white'}`}>
          {label}
        </button>
      ))}
    </div>
  )
}

function Group({ title, children }) {
  return (
    <section>
      <h2 className="text-xs uppercase tracking-[0.14em] text-mist mb-2">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">{children}</div>
    </section>
  )
}

function Stat({ label, value, sub, tone = '' }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3.5 min-w-0">
      <p className={`text-2xl font-semibold tabular-nums leading-tight ${tone}`}>{value}</p>
      <p className="text-[11px] uppercase tracking-[0.1em] text-mist mt-1 leading-snug">{label}</p>
      {sub && <p className="text-[11px] text-brand mt-0.5">{sub}</p>}
    </div>
  )
}

const Initial = ({ handle }) => (
  <span className="size-9 shrink-0 rounded-full bg-raised grid place-items-center text-sm font-semibold text-brand">
    {(handle?.[0] ?? '?').toUpperCase()}
  </span>
)

function Badges({ u }) {
  const today = istDate()
  const list = []
  if (u.is_admin) list.push(['Admin', 'bg-brand text-ink'])
  if (isBanned(u)) list.push(['Banned', 'bg-rose/15 text-rose'])
  if (u.founding) list.push(['Founding', 'bg-brand/15 text-brand'])
  if (u.business_until && u.business_until >= today) list.push(['Business', 'bg-sun/15 text-sun'])
  else if (u.member_until && u.member_until >= today) list.push(['Paid', 'bg-sun/15 text-sun'])
  if (!u.email_confirmed_at) list.push(['Email not confirmed', 'bg-raised text-mist'])
  return list.map(([text, tone]) => (
    <span key={text} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${tone}`}>{text}</span>
  ))
}

const UserLink = ({ id, handle, onOpenUser }) =>
  id ? (
    <button onClick={() => onOpenUser(id)} className="font-semibold hover:text-brand">@{handle ?? 'deleted'}</button>
  ) : (
    <span className="font-semibold text-mist">@{handle ?? 'deleted account'}</span>
  )

function MoreButton({ list }) {
  if (list.rows.length >= list.total) return null
  return (
    <button onClick={list.more} disabled={list.busy}
            className="w-full rounded-full border border-line py-2.5 text-sm font-semibold hover:border-brand disabled:opacity-50">
      {list.busy ? 'Loading…' : `Load more (${num(list.total - list.rows.length)} left)`}
    </button>
  )
}

// ------------------------------------------------------------------ overview

function Overview({ onGo }) {
  const [{ data: o, error }, reload] = useLoad(admin.overview, [])
  // Keep the numbers fresh while the page is open.
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) reload() }, 30_000)
    return () => clearInterval(t)
  }, [])
  if (!o) return <Loading error={error} />
  const s = o.settings ?? {}
  const offerOn = Boolean(s.offer_ends_at) && Date.now() < Date.parse(s.offer_ends_at)

  return (
    <div className="space-y-6">
      <Problem text={error} />
      <Group title="People">
        <Stat label="Total sign-ups" value={num(o.users)} />
        <Stat label="New today" value={num(o.signups_today)} tone={o.signups_today ? 'text-brand' : ''} />
        <Stat label="New · 7 days" value={num(o.signups_7d)} />
        <Stat label="New · 30 days" value={num(o.signups_30d)} />
        <Stat label="Active · 24 hours" value={num(o.active_24h)} />
        <Stat label="Active · 7 days" value={num(o.active_7d)} />
        <Stat label="Founding members" value={num(o.founding)} />
        <Stat label="Banned" value={num(o.banned)} tone={o.banned ? 'text-rose' : ''} />
      </Group>

      <SignupChart days={o.signups_by_day ?? []} />

      <Group title="What people are doing">
        <Stat label="Photos" value={num(o.posts)} sub={o.posts_7d ? `+${num(o.posts_7d)} this week` : ''} />
        <Stat label="Places added" value={num(o.places_added)} sub={o.places_7d ? `+${num(o.places_7d)} this week` : ''} />
        <Stat label="Trips" value={num(o.trips)} />
        <Stat label="Group trips" value={num(o.group_trips)} />
        <Stat label="Invites waiting" value={num(o.pending_invites)} />
        <Stat label="Reviews" value={num(o.reviews)} />
        <Stat label="Comments" value={num(o.comments)} />
        <Stat label="Businesses" value={num(o.listings)} sub={o.listings_hidden ? `${num(o.listings_hidden)} hidden` : ''} />
      </Group>

      <Group title="Money">
        <Stat label="Paid riders" value={num(o.paid_riders)} />
        <Stat label="Paid businesses" value={num(o.paid_business)} />
        <Stat label="Payments" value={num(o.payments)} />
        <Stat label="Revenue" value={inr(o.revenue_paise)} />
      </Group>

      <section className="rounded-2xl border border-line bg-surface p-4 text-sm leading-relaxed">
        <p>
          <span className="text-mist">Pre-release offer: </span>
          {offerOn ? <b className="text-brand">free for everyone till {fmtDate(istDate(Date.parse(s.offer_ends_at) - 1))}</b>
                   : s.offer_ends_at ? 'ended' : 'not set'}
        </p>
        <p>
          <span className="text-mist">Paywall: </span>
          {s.paywall_since ? <b className="text-sun">on since {fmtDate(s.paywall_since)}</b> : <b>off — nobody is asked to pay</b>}
          <span className="text-mist"> · Prices ₹{s.rider_price_inr} rider, ₹{s.business_price_inr} business a year</span>
        </p>
        <button onClick={() => onGo('settings')} className="mt-2 text-xs font-semibold text-brand">Change in Settings →</button>
      </section>
    </div>
  )
}

function SignupChart({ days }) {
  const [picked, setPicked] = useState(null)
  const max = Math.max(1, ...days.map((d) => d.n))
  const total = days.reduce((sum, d) => sum + d.n, 0)
  const shown = picked ?? days[days.length - 1]
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Sign-ups, last 30 days</h2>
        <span className="text-xs text-mist whitespace-nowrap">{num(total)} in all</span>
      </div>
      <p className="text-xs text-mist mt-0.5">
        {shown ? `${fmtDay(shown.day)}: ${num(shown.n)} sign-up${shown.n === 1 ? '' : 's'}` : ''}
      </p>
      <div className="mt-3 flex items-end gap-[3px] h-32" role="img" aria-label={`${total} sign-ups in the last 30 days`}>
        {days.map((d) => (
          <button key={d.day} onClick={() => setPicked(d)} title={`${fmtDay(d.day)}: ${d.n}`}
                  className="flex-1 h-full flex flex-col justify-end" aria-label={`${fmtDay(d.day)}: ${d.n}`}>
            <span className={`block rounded-t ${d.n ? 'bg-brand' : 'bg-line'} ${picked?.day === d.day ? 'ring-2 ring-white/60' : ''}`}
                  style={{ height: `${d.n ? Math.max(6, (d.n / max) * 100) : 3}%` }} />
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-mist mt-1.5">
        <span>{fmtDay(days[0]?.day)}</span><span>Today</span>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ users

const USER_FILTERS = [['all', 'All'], ['founding', 'Founding'], ['paid', 'Paid'], ['banned', 'Banned'], ['admins', 'Admins']]

function Users({ onOpen }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const query = useDebounced(q.trim())
  const list = usePaged((offset) => admin.listUsers(query, filter, offset), [query, filter])

  return (
    <div className="space-y-3">
      <SearchBox value={q} onChange={setQ} placeholder="Search @username, name or email" />
      <Chips options={USER_FILTERS} value={filter} onChange={setFilter} />
      <p className="text-xs text-mist">{list.busy && !list.rows.length ? 'Loading…' : `${num(list.total)} account${list.total === 1 ? '' : 's'}`}</p>
      <Problem text={list.error} />
      {list.rows.length > 0 && (
        <ul className="rounded-2xl border border-line bg-surface divide-y divide-line overflow-hidden">
          {list.rows.map((u) => (
            <li key={u.id}>
              <button onClick={() => onOpen(u.id)} className="w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-raised">
                <Initial handle={u.handle} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-semibold">@{u.handle}</span>
                    <Badges u={u} />
                  </span>
                  <span className="block text-xs text-mist truncate">{u.name && u.name !== u.handle ? `${u.name} · ` : ''}{u.email}</span>
                  <span className="block text-[11px] text-mist">
                    Joined {ago(u.created_at)} · {u.last_sign_in_at ? `signed in ${ago(u.last_sign_in_at)}` : 'never signed in'}
                    {' · '}{num(u.posts)} photos · {num(u.trips)} trips
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <MoreButton list={list} />
    </div>
  )
}

function UserDetail({ id, onOpenUser, onDeleted }) {
  const [{ data, error }, reload] = useLoad(() => admin.getUser(id), [id])
  const me = useStore((s) => s.account)
  const [note, setNote] = useState(null)
  useEffect(() => setNote(null), [id])
  if (!data) return <Loading error={error} />

  const { user: u, counts: c } = data
  const self = me?.id === u.id
  const run = async (fn, done) => {
    setNote(null)
    try { await fn(); setNote({ text: done }); reload() } catch (e) { setNote({ text: e.message, bad: true }) }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-start gap-3">
          <Initial handle={u.handle} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="text-lg font-semibold">@{u.handle}</h2>
              <Badges u={u} />
            </div>
            <p className="text-sm text-mist break-all">{u.name && u.name !== u.handle ? `${u.name} · ` : ''}{u.email}</p>
            {u.bio && <p className="text-sm mt-1">{u.bio}</p>}
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <Row label="Joined" value={formatDateTime(u.created_at)} />
          <Row label="Last sign-in" value={u.last_sign_in_at ? formatDateTime(u.last_sign_in_at) : 'Never'} />
          <Row label="Email" value={u.email_confirmed_at ? `Confirmed ${fmtDate(u.email_confirmed_at)}` : 'Not confirmed'} />
          <Row label="Device" value={u.has_device ? 'Signed in on a phone or browser' : 'None claimed'} />
          {isBanned(u) && <Row label="Banned until" value={formatDateTime(u.banned_until)} tone="text-rose" />}
        </dl>
        <div className="mt-3 grid grid-cols-4 sm:grid-cols-7 gap-2 text-center">
          {[['Photos', c.posts], ['Places', c.places], ['Trips', c.trips], ['Reviews', c.reviews],
            ['Comments', c.comments], ['Saved', c.saves], ['Business', c.listings]].map(([label, n]) => (
            <div key={label} className="rounded-xl bg-raised py-2">
              <p className="text-sm font-semibold tabular-nums">{num(n)}</p>
              <p className="text-[10px] text-mist">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <Note note={note} />

      <section className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        <h3 className="text-sm font-semibold">Plan</h3>
        <div className="flex items-center gap-3">
          <p className="text-sm flex-1">
            Founding member
            <span className="block text-[11px] text-mist">Free for good, whatever the paywall says.</span>
          </p>
          <ConfirmButton onConfirm={() => run(() => admin.setFounding(u.id, !u.founding), u.founding ? 'No longer a founding member.' : 'Now a founding member.')}>
            {u.founding ? 'Remove' : 'Make founding'}
          </ConfirmButton>
        </div>
        <PlanRow label="Rider account" value={u.member_until}
                 onSave={(until) => run(() => admin.setPlan(u.id, 'rider', until), until ? `Rider account active till ${fmtDate(until)}.` : 'Rider plan removed.')} />
        <PlanRow label="Business plan" value={u.business_until}
                 onSave={(until) => run(() => admin.setPlan(u.id, 'business', until), until ? `Business plan active till ${fmtDate(until)}.` : 'Business plan removed.')} />
        {data.payments.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-[0.12em] text-mist mb-1">Payments</p>
            <ul className="text-xs space-y-1">
              {data.payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-2">
                  <span>{fmtDate(p.created_at)} · {p.plan} · {p.status}</span>
                  <span className="tabular-nums">{inr(p.amount_paise)} · till {fmtDate(p.valid_until)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        <h3 className="text-sm font-semibold">Account</h3>
        {self ? (
          <p className="text-xs text-mist">This is your own account — these actions are for other people's.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <ConfirmButton onConfirm={() => run(() => admin.signOutEverywhere(u.id), 'Signed out everywhere.')}>Sign out everywhere</ConfirmButton>
              <ConfirmButton onConfirm={() => run(() => admin.resetDevice(u.id), 'Device reset — they can sign in on a new phone.')}>Reset device</ConfirmButton>
            </div>
            <p className="text-[11px] text-mist leading-relaxed">
              Reset device helps someone who lost or changed phones. Sign out ends every session; a phone that is
              already open keeps working for up to an hour.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {isBanned(u) ? (
                <ConfirmButton onConfirm={() => run(() => admin.ban(u.id, 0), 'Ban lifted.')}>Lift ban</ConfirmButton>
              ) : u.is_admin ? (
                <p className="text-xs text-mist">Admins can't be banned from here.</p>
              ) : (
                <>
                  <span className="text-xs text-mist">Ban:</span>
                  <ConfirmButton danger onConfirm={() => run(() => admin.ban(u.id, 7), 'Banned for 7 days.')}>7 days</ConfirmButton>
                  <ConfirmButton danger onConfirm={() => run(() => admin.ban(u.id, 30), 'Banned for 30 days.')}>30 days</ConfirmButton>
                  <ConfirmButton danger onConfirm={() => run(() => admin.ban(u.id, 36500), 'Banned for good.')}>For good</ConfirmButton>
                </>
              )}
            </div>
            {!u.is_admin && <DeleteUser u={u} onDeleted={onDeleted} />}
          </>
        )}
      </section>

      {data.posts.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-[0.14em] text-mist mb-2">Photos</h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {data.posts.map((p) => (
              <figure key={p.id} className="rounded-xl overflow-hidden border border-line bg-surface">
                <img src={photoUrl(p.photo_path)} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                <figcaption className="p-1.5 space-y-1">
                  <p className="text-[11px] truncate">{p.place}</p>
                  <ConfirmButton danger confirm="Remove?" onConfirm={() => run(() => admin.remove('post', p.id), 'Photo removed.')}>Remove</ConfirmButton>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {data.trips.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-[0.14em] text-mist mb-2">Trips</h3>
          <ul className="rounded-2xl border border-line bg-surface divide-y divide-line">
            {data.trips.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate">{t.title}</span>
                  <span className="block text-[11px] text-mist">{t.stops} stops · {t.members} riders joined · updated {ago(t.updated_at)}</span>
                </span>
                <ConfirmButton danger confirm="Remove for everyone?" onConfirm={() => run(() => admin.remove('trip', t.id), 'Trip removed.')}>Remove</ConfirmButton>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.listings.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-[0.14em] text-mist mb-2">Businesses</h3>
          <ul className="rounded-2xl border border-line bg-surface divide-y divide-line">
            {data.listings.map((l) => (
              <li key={l.id} className="px-3.5 py-2.5 text-sm">
                {l.name} <span className="text-[11px] text-mist">· {l.category}{l.hidden ? ' · hidden' : ''}{l.verified ? ' · verified' : ''}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-mist mt-1">Hide, verify or remove businesses under Content → Businesses.</p>
        </section>
      )}

      {data.log.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-[0.14em] text-mist mb-2">Admin history</h3>
          <ul className="text-xs space-y-1">
            {data.log.map((a, i) => (
              <li key={i}>{ACTIONS[a.action] ?? a.action} <span className="text-mist">by @{a.admin_handle} · {ago(a.at)}{detailText(a.detail) ? ` · ${detailText(a.detail)}` : ''}</span></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

const Row = ({ label, value, tone = '' }) => (
  <div className="flex gap-2"><dt className="text-mist w-24 shrink-0">{label}</dt><dd className={tone}>{value}</dd></div>
)

function PlanRow({ label, value, onSave }) {
  const [v, setV] = useState(value ?? '')
  useEffect(() => setV(value ?? ''), [value])
  const changed = (v || null) !== (value || null)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm flex-1 min-w-[9rem]">
        {label}
        <span className="block text-[11px] text-mist">{value ? `Active till ${fmtDate(value)}` : 'None — gift one by picking an end date'}</span>
      </p>
      <input type="date" value={v} onChange={(e) => setV(e.target.value)} aria-label={`${label} end date`} className={`${field} !w-auto`} />
      <button onClick={() => onSave(v || null)} disabled={!changed || !v} className={pill}>Save</button>
      {value && <ConfirmButton danger confirm="Remove?" onConfirm={() => onSave(null)}>Remove</ConfirmButton>}
    </div>
  )
}

/**
 * Deleting someone's account: type their @username, the same written
 * confirmation as deleting your own. The server checks it again.
 */
function DeleteUser({ u, onDeleted }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [reason, setReason] = useState('')
  const [state, setState] = useState({ busy: false, error: '' })
  const matches = typed.trim().replace(/^@/, '').toLowerCase() === u.handle.toLowerCase()

  async function remove(e) {
    e.preventDefault()
    if (!matches || state.busy) return
    setState({ busy: true, error: '' })
    try {
      await admin.deleteUser(u.id, typed.trim(), reason.trim())
      onDeleted?.(u.handle)
    } catch (err) {
      setState({ busy: false, error: err.message })
    }
  }
  function cancel() { setOpen(false); setTyped(''); setReason(''); setState({ busy: false, error: '' }) }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-1 text-xs font-semibold text-rose hover:underline underline-offset-4">
        Delete this account…
      </button>
    )
  }
  return (
    <form onSubmit={remove} className="mt-2 rounded-xl border border-rose/40 bg-rose/5 p-3 space-y-2">
      <p className="text-sm font-semibold text-rose">Delete @{u.handle} for good</p>
      <p className="text-[11px] text-mist leading-relaxed">
        Removes their sign-in, profile, photos, posts, reviews, comments, trips, saved places, business listings,
        plan and payment records, and signs them out everywhere. It can't be undone. Places they added stay on the
        map without their name. They could sign up again with the same email — to keep someone out, ban them instead.
      </p>
      <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false}
             placeholder={`Type @${u.handle} to confirm`} aria-label="Type their username to confirm" className={field} />
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300}
             placeholder="Reason (optional, kept in the admin log)" aria-label="Reason" className={field} />
      <div className="flex gap-2">
        <button type="submit" disabled={!matches || state.busy}
                className="flex-1 min-h-10 rounded-full bg-rose text-white py-2 text-xs font-semibold disabled:opacity-40">
          {state.busy ? 'Deleting…' : `Delete @${u.handle}`}
        </button>
        <button type="button" onClick={cancel} className="flex-1 min-h-10 rounded-full border border-line py-2 text-xs font-semibold">
          Cancel
        </button>
      </div>
      {state.error && <p className="text-xs text-rose">{state.error}</p>}
    </form>
  )
}

// ------------------------------------------------------------------ activity

const KINDS = {
  signup: ['👋', 'signed up'], post: ['📷', 'posted a photo at'], place: ['📍', 'added a place'],
  trip: ['🧭', 'updated a trip'], invite: ['✉️', 'invited someone to'], review: ['⭐', 'reviewed'],
  comment: ['💬', 'commented'], listing: ['🏪', 'listed a business'], payment: ['💳', 'paid for'],
}
const ACTIVITY_FILTERS = [['all', 'All'], ['signup', 'Sign-ups'], ['post', 'Photos'], ['trip', 'Trips'], ['invite', 'Invites'],
  ['review', 'Reviews'], ['comment', 'Comments'], ['listing', 'Businesses'], ['payment', 'Payments']]
const REMOVABLE = ['post', 'place', 'review', 'comment', 'listing', 'trip']

function Activity({ onOpenUser }) {
  const [items, setItems] = useState([])
  const [state, setState] = useState({ busy: true, error: '', done: false })
  const [filter, setFilter] = useState('all')
  const [note, setNote] = useState(null)
  const paged = useRef(false)

  const load = async (before = null) => {
    setState((s) => ({ ...s, busy: true, error: '' }))
    try {
      const rows = (await admin.activity(before)) ?? []
      paged.current = Boolean(before)
      setItems((old) => (before ? [...old, ...rows] : rows))
      setState({ busy: false, error: '', done: rows.length < admin.PAGE })
    } catch (e) {
      setState((s) => ({ ...s, busy: false, error: e.message }))
    }
  }
  useEffect(() => {
    load()
    // Newest first, refreshed every half minute — unless you've scrolled into older pages.
    const t = setInterval(() => { if (!document.hidden && !paged.current) load() }, 30_000)
    return () => clearInterval(t)
  }, [])

  const shown = filter === 'all' ? items : items.filter((e) => e.kind === filter)
  const remove = async (e) => {
    setNote(null)
    try {
      await admin.remove(e.kind, e.ref)
      setItems((old) => old.filter((x) => !(x.kind === e.kind && x.ref === e.ref)))
      setNote({ text: 'Removed.' })
    } catch (err) { setNote({ text: err.message, bad: true }) }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-sm text-mist flex-1">Everything people do on Trekov, newest first.</p>
        <button onClick={() => load()} disabled={state.busy} className={pill}>{state.busy ? 'Loading…' : 'Refresh'}</button>
      </div>
      <Chips options={ACTIVITY_FILTERS} value={filter} onChange={setFilter} />
      <Problem text={state.error} />
      <Note note={note} />
      {shown.length === 0 && !state.busy && <p className="text-sm text-mist py-4">Nothing here yet.</p>}
      {shown.length > 0 && (
        <ul className="rounded-2xl border border-line bg-surface divide-y divide-line overflow-hidden">
          {shown.map((e) => {
            const [icon, verb] = KINDS[e.kind] ?? ['•', e.kind]
            return (
              <li key={`${e.kind}:${e.ref}:${e.at}`} className="flex items-start gap-3 px-3.5 py-3">
                {e.photo_path ? (
                  <img src={photoUrl(e.photo_path)} alt="" loading="lazy" className="size-12 rounded-lg object-cover shrink-0" />
                ) : (
                  <span className="size-12 rounded-lg bg-raised grid place-items-center text-lg shrink-0" aria-hidden>{icon}</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug">
                    <UserLink id={e.user_id} handle={e.handle} onOpenUser={onOpenUser} />{' '}
                    <span className="text-mist">{verb}</span>{e.title ? <> <b className="font-semibold">{e.title}</b></> : null}
                  </p>
                  {e.body && <p className="text-xs text-mist mt-0.5 line-clamp-2 break-words">{e.body}</p>}
                  <p className="text-[11px] text-mist mt-0.5" title={formatDateTime(e.at)}>{ago(e.at)}</p>
                </div>
                {REMOVABLE.includes(e.kind) && (
                  <ConfirmButton danger confirm="Remove?" onConfirm={() => remove(e)}>Remove</ConfirmButton>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {!state.done && items.length > 0 && (
        <button onClick={() => load(items[items.length - 1].at)} disabled={state.busy}
                className="w-full rounded-full border border-line py-2.5 text-sm font-semibold hover:border-brand disabled:opacity-50">
          {state.busy ? 'Loading…' : 'Older'}
        </button>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ content

const CONTENT = [['posts', 'Photos'], ['places', 'Places'], ['listings', 'Businesses'], ['reviews', 'Reviews'], ['comments', 'Comments'], ['trips', 'Trips']]
const DELETE_KIND = { posts: 'post', places: 'place', listings: 'listing', reviews: 'review', comments: 'comment', trips: 'trip' }

function Content({ onOpenUser }) {
  const [kind, setKind] = useState('posts')
  const [q, setQ] = useState('')
  const query = useDebounced(q.trim())
  const list = usePaged((offset) => admin.content(kind, query, offset), [kind, query])
  const [note, setNote] = useState(null)
  useEffect(() => setNote(null), [kind])

  const act = async (fn, done, after) => {
    setNote(null)
    try { await fn(); after?.(); setNote({ text: done }) } catch (e) { setNote({ text: e.message, bad: true }) }
  }
  const remove = (row) => act(() => admin.remove(DELETE_KIND[kind], row.id), 'Removed.', () => list.drop(row.id))
  const by = (row) => <UserLink id={row.user_id} handle={row.handle} onOpenUser={onOpenUser} />

  return (
    <div className="space-y-3">
      <Chips options={CONTENT} value={kind} onChange={setKind} />
      <SearchBox value={q} onChange={setQ} placeholder="Search" />
      <p className="text-xs text-mist">{list.busy && !list.rows.length ? 'Loading…' : `${num(list.total)} found`}
        {kind === 'places' && ' · places people added (the built-in catalogue isn\'t listed)'}</p>
      <Problem text={list.error} />
      <Note note={note} />

      {kind === 'posts' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {list.rows.map((p) => (
            <figure key={p.id} className="rounded-2xl overflow-hidden border border-line bg-surface">
              <img src={photoUrl(p.photo_path)} alt="" loading="lazy" className="aspect-square w-full object-cover" />
              <figcaption className="p-2.5 space-y-1 text-xs">
                <p className="font-semibold truncate">{p.place}</p>
                <p className="text-mist truncate">{by(p)} · {ago(p.created_at)}</p>
                {p.caption && <p className="line-clamp-2 break-words">{p.caption}</p>}
                {p.located_distance_m != null && <p className="text-[11px] text-mist">Taken {num(p.located_distance_m)} m from the place</p>}
                <ConfirmButton danger confirm="Remove?" onConfirm={() => remove(p)}>Remove</ConfirmButton>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : list.rows.length > 0 && (
        <ul className="rounded-2xl border border-line bg-surface divide-y divide-line overflow-hidden">
          {list.rows.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-3.5 py-3">
              {kind === 'listings' && (r.photo_path
                ? <img src={photoUrl(r.photo_path)} alt="" loading="lazy" className="size-12 rounded-lg object-cover shrink-0" />
                : <span className="size-12 rounded-lg bg-raised grid place-items-center shrink-0" aria-hidden>🏪</span>)}
              <div className="min-w-0 flex-1 text-sm">
                {kind === 'places' && (<>
                  <p className="font-semibold">{r.name}</p>
                  <p className="text-xs text-mist">{[r.region, r.country].filter(Boolean).join(', ')} · {num(r.posts)} photos · by {by(r)} · {ago(r.created_at)}</p>
                </>)}
                {kind === 'listings' && (<>
                  <p className="font-semibold flex items-center gap-1.5 flex-wrap">
                    {r.name}
                    {r.hidden && <span className="rounded-full px-2 py-0.5 text-[10px] bg-rose/15 text-rose">Hidden</span>}
                    {r.verified && <span className="rounded-full px-2 py-0.5 text-[10px] bg-brand/15 text-brand">Verified</span>}
                  </p>
                  <p className="text-xs text-mist">{r.category} · {r.phone || 'no phone'} · by {by(r)} · {ago(r.created_at)}</p>
                  {r.address && <p className="text-xs text-mist truncate">{r.address}</p>}
                  <div className="flex flex-wrap gap-2 mt-2">
                    <ConfirmButton onConfirm={() => act(() => admin.setListing(r.id, { hidden: !r.hidden }), r.hidden ? 'Listing is visible again.' : 'Listing hidden.', () => list.patch(r.id, { hidden: !r.hidden }))}>
                      {r.hidden ? 'Show' : 'Hide'}
                    </ConfirmButton>
                    <ConfirmButton onConfirm={() => act(() => admin.setListing(r.id, { verified: !r.verified }), r.verified ? 'No longer verified.' : 'Marked verified.', () => list.patch(r.id, { verified: !r.verified }))}>
                      {r.verified ? 'Unverify' : 'Verify'}
                    </ConfirmButton>
                  </div>
                </>)}
                {kind === 'reviews' && (<>
                  <p><b className="font-semibold">{r.place}</b> <span className="text-xs text-mist">· {stars(r.ratings)} · by {by(r)} · {ago(r.created_at)}</span></p>
                  {r.note && <p className="text-xs mt-0.5 break-words">{r.note}</p>}
                </>)}
                {kind === 'comments' && (<>
                  <p className="break-words">{r.body}</p>
                  <p className="text-xs text-mist mt-0.5">by {by(r)} · {ago(r.created_at)}</p>
                </>)}
                {kind === 'trips' && (<>
                  <p className="font-semibold">{r.title}</p>
                  <p className="text-xs text-mist">
                    {r.stops} stops · {r.members} riders joined{r.pending ? ` · ${r.pending} invited` : ''}
                    {r.starts_on ? ` · starts ${fmtDate(r.starts_on)}` : ''} · by {by(r)} · updated {ago(r.created_at)}
                  </p>
                </>)}
              </div>
              <ConfirmButton danger
                             confirm={kind === 'places' && r.posts ? `Remove + ${r.posts} photos?` : kind === 'trips' ? 'Remove for everyone?' : 'Remove?'}
                             onConfirm={() => remove(r)}>
                Remove
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}
      <MoreButton list={list} />
    </div>
  )
}

function stars(ratings) {
  const values = Object.values(ratings ?? {}).map(Number).filter(Number.isFinite)
  return values.length ? `★ ${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)}` : 'no rating'
}

// ------------------------------------------------------------------ settings

// The offer is stored as the moment it ends (midnight IST after its last day);
// the form shows and takes the last free day.
const lastFreeDay = (endsAt) => (endsAt ? istDate(Date.parse(endsAt) - 1) : '')
function endsAfter(day) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return `${d.toISOString().slice(0, 10)}T00:00:00+05:30`
}

function Settings() {
  const [{ data: o, error }, reload] = useLoad(admin.overview, [])
  const [form, setForm] = useState(null)
  const [note, setNote] = useState(null)
  const s = o?.settings
  useEffect(() => {
    if (s) setForm({ lastDay: lastFreeDay(s.offer_ends_at), rider: String(s.rider_price_inr), business: String(s.business_price_inr) })
  }, [s?.offer_ends_at, s?.rider_price_inr, s?.business_price_inr])
  if (!o || !form) return <Loading error={error} />

  const save = async (changes, done) => {
    setNote(null)
    try { await admin.saveSettings(changes); setNote({ text: done }); reload() } catch (e) { setNote({ text: e.message, bad: true }) }
  }
  const changed = form.lastDay !== lastFreeDay(s.offer_ends_at) ||
    Number(form.rider) !== s.rider_price_inr || Number(form.business) !== s.business_price_inr
  const offerOn = Boolean(s.offer_ends_at) && Date.now() < Date.parse(s.offer_ends_at)

  return (
    <div className="space-y-5 max-w-xl">
      <Note note={note} />

      <section className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        <h2 className="text-sm font-semibold">Offer and prices</h2>
        <label className="block">
          <span className="block text-[11px] uppercase tracking-[0.14em] text-mist mb-1.5">Free for everyone through (last day, India time)</span>
          <input type="date" value={form.lastDay} onChange={(e) => setForm({ ...form, lastDay: e.target.value })} className={field} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-[11px] uppercase tracking-[0.14em] text-mist mb-1.5">Rider ₹ / year</span>
            <input inputMode="numeric" value={form.rider} onChange={(e) => setForm({ ...form, rider: e.target.value.replace(/\D/g, '') })} className={field} />
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-[0.14em] text-mist mb-1.5">Business ₹ / year</span>
            <input inputMode="numeric" value={form.business} onChange={(e) => setForm({ ...form, business: e.target.value.replace(/\D/g, '') })} className={field} />
          </label>
        </div>
        <p className="text-[11px] text-mist leading-relaxed">
          The website, the ad and the store listings mention the offer date and prices too — change those alongside.
        </p>
        <ConfirmButton disabled={!changed || !form.lastDay || !form.rider || !form.business}
                       confirm="Tap again to save"
                       onConfirm={() => save({
                         offerEndsAt: form.lastDay !== lastFreeDay(s.offer_ends_at) ? endsAfter(form.lastDay) : null,
                         riderPrice: Number(form.rider) !== s.rider_price_inr ? Number(form.rider) : null,
                         businessPrice: Number(form.business) !== s.business_price_inr ? Number(form.business) : null,
                       }, 'Saved.')}>
          Save changes
        </ConfirmButton>
      </section>

      <section className={`rounded-2xl border p-4 space-y-2 ${s.paywall_since ? 'border-sun/50 bg-sun/5' : 'border-line bg-surface'}`}>
        <h2 className="text-sm font-semibold">Paywall</h2>
        <p className="text-sm">
          {s.paywall_since ? <>On since <b>{formatDateTime(s.paywall_since)}</b>.</> : <>Off — nobody is asked to pay.</>}
          {s.paywall_since && offerOn && <> Nobody is charged until the offer ends.</>}
        </p>
        <p className="text-[11px] text-mist leading-relaxed">
          Turn it on only after the Razorpay keys are in Supabase and a test payment has gone through — otherwise new
          riders would be asked to pay with no way to do it. Founding members stay free either way.
        </p>
        <ConfirmButton danger={!s.paywall_since}
                       confirm={s.paywall_since ? 'Tap again: everyone free' : 'Tap again: start charging'}
                       onConfirm={() => save({ paywall: !s.paywall_since }, s.paywall_since ? 'Paywall off.' : 'Paywall on.')}>
          {s.paywall_since ? 'Turn paywall off' : 'Turn paywall on'}
        </ConfirmButton>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">Admins</h2>
        <p className="text-sm mt-1">{num(o.admins)} admin account{o.admins === 1 ? '' : 's'}.</p>
        <p className="text-[11px] text-mist mt-1 leading-relaxed">
          For safety, admins are added or removed only in the Supabase SQL editor (see supabase/admin.sql), never from the app.
        </p>
      </section>
    </div>
  )
}

// ------------------------------------------------------------------ admin log

const ACTIONS = {
  delete_post: 'Removed a photo', delete_place: 'Removed a place', delete_review: 'Removed a review',
  delete_comment: 'Removed a comment', delete_listing: 'Removed a business', delete_trip: 'Removed a trip',
  founding_on: 'Made a founding member', founding_off: 'Removed founding member', set_plan: 'Changed a plan',
  ban: 'Banned', unban: 'Lifted a ban', sign_out: 'Signed out everywhere', reset_device: 'Reset a device',
  listing: 'Changed a business', settings: 'Changed app settings', delete_user: 'Deleted an account',
}
function detailText(d) {
  if (!d) return ''
  return Object.entries(d)
    .filter(([k, v]) => v !== null && v !== '' && !['author', 'owner', 'user', 'added_by', 'place', 'post'].includes(k))
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ')
    .slice(0, 140)
}

const REPORT_REASONS = { spam: 'Spam', abuse: 'Harassment or hate', nudity: 'Nudity', violence: 'Violence', fake: 'Fake', other: 'Other' }

/** What people reported. Remove the content (Content tab or here), then mark it handled. */
function Reports() {
  const [status, setStatus] = useState('open')
  const [{ data, error }, reload] = useLoad(() => admin.reports(status), [status])
  const [busy, setBusy] = useState(null)
  const [note, setNote] = useState('')
  async function act(r, what) {
    setBusy(r.id); setNote('')
    try {
      if (what === 'remove') {
        if (['post', 'comment', 'review'].includes(r.kind)) await admin.remove(r.kind, r.target_id)
        await admin.resolveReport(r.id, 'actioned')
      } else {
        await admin.resolveReport(r.id, what)
      }
      reload()
    } catch (e) { setNote(e.message) } finally { setBusy(null) }
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {['open', 'actioned', 'dismissed'].map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`${pill} ${status === s ? 'border-brand text-brand' : ''}`}>{s[0].toUpperCase() + s.slice(1)}</button>
        ))}
        <span className="flex-1" />
        <button onClick={reload} className={pill}>Refresh</button>
      </div>
      {note && <p className="text-xs text-rose">{note}</p>}
      {!data ? <Loading error={error} /> : data.length === 0 ? (
        <p className="text-sm text-mist py-4">Nothing {status === 'open' ? 'waiting' : status}.</p>
      ) : (
        <ul className="rounded-2xl border border-line bg-surface divide-y divide-line overflow-hidden">
          {data.map((r) => (
            <li key={r.id} className="px-3.5 py-3 text-sm space-y-1.5">
              <p><b className="font-semibold">{REPORT_REASONS[r.reason] ?? r.reason}</b> · {r.kind} <span className="text-mist">{r.target_id}</span></p>
              {r.note && <p className="text-[13px] text-white/85 break-words">“{r.note}”</p>}
              <p className="text-[11px] text-mist">by @{r.reporter ?? 'deleted account'} · {formatDateTime(r.created_at)}</p>
              {status === 'open' && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {['post', 'comment', 'review'].includes(r.kind) && (
                    <button disabled={busy === r.id} onClick={() => act(r, 'remove')} className={`${pill} hover:border-rose hover:text-rose`}>Remove it</button>
                  )}
                  <button disabled={busy === r.id} onClick={() => act(r, 'actioned')} className={pill}>Handled</button>
                  <button disabled={busy === r.id} onClick={() => act(r, 'dismissed')} className={pill}>Dismiss</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-mist">Profiles and rides: find the account under Users to ban it or remove it.</p>
    </div>
  )
}

function Log({ onOpenUser }) {
  const [{ data, error }, reload] = useLoad(admin.auditLog, [])
  if (!data) return <Loading error={error} />
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-sm text-mist flex-1">Every change made from this screen, newest first.</p>
        <button onClick={reload} className={pill}>Refresh</button>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-mist py-4">No admin changes yet.</p>
      ) : (
        <ul className="rounded-2xl border border-line bg-surface divide-y divide-line overflow-hidden">
          {data.map((a) => (
            <li key={a.id} className="px-3.5 py-2.5 text-sm">
              <p>
                <b className="font-semibold">{ACTIONS[a.action] ?? a.action}</b>
                {a.target_handle && <> · <UserLink id={a.target} handle={a.target_handle} onOpenUser={onOpenUser} /></>}
              </p>
              <p className="text-[11px] text-mist break-words">
                by @{a.admin_handle ?? 'removed admin'} · {formatDateTime(a.at)}{detailText(a.detail) ? ` · ${detailText(a.detail)}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
