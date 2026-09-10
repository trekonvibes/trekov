import { hasSupabase, signOut } from '../lib/auth'
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
      <p className="text-[11px] text-mist mt-2 leading-relaxed">
        Signing out leaves everything on this device — it does not delete anything.
      </p>
    </div>
  )
}
