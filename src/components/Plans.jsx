import { useState } from 'react'
import { useStore } from '../lib/store'
import { buyPlan, refreshMembership, useMembership } from '../lib/membership'
import { CloseIcon } from './Icons'
import { isNativeApp } from '../lib/platform'

const PLANS = {
  rider: { title: 'Rider', points: ['Your trips, saves and photos on your account', 'Live group trips — one map, alerts and voice',
    'Post GPS-verified live photos', 'No usage limits'] },
  business: { title: 'Business', points: ['Everything in Rider', 'Unlimited business listings shown to riders nearby',
    'Unlimited products and services with prices', 'Tap-to-call and directions to your door'] },
}
const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** The two yearly plans, paid with Razorpay. */
export default function Plans({ initial = 'rider', onClose, onAuth }) {
  const account = useStore((s) => s.account)
  const m = useMembership()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  // Store billing rules: the apps neither sell plans nor say where to buy one.
  if (isNativeApp) {
    return (
      <div className="fixed inset-0 z-[1300] bg-black flex justify-center" role="dialog" aria-label="Trekov account">
        <div className="relative tk-shell h-full w-full flex flex-col bg-ink sm:border-x sm:border-line pt-safe px-safe">
          <header className="flex items-center gap-3 px-3 h-14 border-b border-line shrink-0">
            <button onClick={onClose} aria-label="Close" className="grid place-items-center size-10 text-mist hover:text-white"><CloseIcon size={20} /></button>
            <h1 className="text-base font-semibold">Your Trekov account</h1>
          </header>
          <div className="p-5 space-y-3 text-sm text-mist leading-relaxed">
            <p>This feature isn't included in your account yet.</p>
            <p>The map, places, trip planning and navigation keep working on this phone either way.</p>
          </div>
        </div>
      </div>
    )
  }
  const price = (p) => (p === 'business' ? m?.businessPrice ?? 499 : m?.riderPrice ?? 99)

  async function pay(plan) {
    if (!account) return onAuth?.('signup')
    setBusy(plan); setError(''); setDone('')
    try {
      const until = await buyPlan(plan, { name: account.name || account.handle, email: account.email })
      await refreshMembership()
      setDone(`Paid — your ${PLANS[plan].title.toLowerCase()} plan runs till ${fmt(until)}.`)
    } catch (e) {
      setError(e.message)
    } finally { setBusy(null) }
  }

  return (
    <div className="fixed inset-0 z-[1300] bg-black flex justify-center" role="dialog" aria-label="Trekov plans">
      <div className="relative tk-shell h-full w-full flex flex-col bg-ink sm:border-x sm:border-line pt-safe px-safe">
        <header className="flex items-center gap-3 px-3 h-14 border-b border-line shrink-0">
          <button onClick={onClose} aria-label="Close" className="p-2 text-mist hover:text-white"><CloseIcon size={20} /></button>
          <h1 className="text-base font-semibold">Trekov plans</h1>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 max-w-2xl mx-auto w-full">
          <p className="text-sm text-mist leading-relaxed">
            The map, places, trip planning and navigation work on your phone without an account. A plan adds everything
            shared with other people and kept on your account — for a year, with no usage limits.
          </p>
          {done && <p className="rounded-xl bg-brand/10 border border-brand/30 text-brand text-sm px-3 py-2">{done}</p>}
          {error && <p className="rounded-xl bg-rose/10 border border-rose/30 text-rose text-sm px-3 py-2">{error}</p>}
          {['rider', 'business'].map((id) => (
            <div key={id} className={`rounded-2xl border p-4 ${id === initial ? 'border-brand bg-brand/5' : 'border-line bg-surface'}`}>
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-semibold">{PLANS[id].title}</p>
                <p><span className="text-2xl font-bold">₹{price(id)}</span><span className="text-xs text-mist"> / year</span></p>
              </div>
              <ul className="mt-2 space-y-1 text-xs text-mist">
                {PLANS[id].points.map((t) => <li key={t} className="flex gap-2"><span className="text-brand">✓</span>{t}</li>)}
              </ul>
              <button onClick={() => pay(id)} disabled={Boolean(busy)}
                      className="mt-3 w-full rounded-full bg-brand text-ink py-2.5 text-sm font-semibold disabled:opacity-50">
                {busy === id ? 'Opening payment…' : account ? `Pay ₹${price(id)}` : 'Sign up to continue'}
              </button>
            </div>
          ))}
          <p className="text-[11px] text-mist leading-relaxed">
            One payment for a year — no auto-renewal. Payments by Razorpay (UPI, cards, net banking); Trekov never sees your
            card details. One device at a time: signing in elsewhere signs you out here.
          </p>
        </div>
      </div>
    </div>
  )
}
