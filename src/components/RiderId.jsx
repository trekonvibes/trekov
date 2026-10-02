// Rider ID: the details a stranger needs if they find a rider hurt, and the
// two ways Android will show them on a locked phone (lib/riderId.js).

import { useState } from 'react'
import { selectSafety, setRiderSafety, useStore } from '../lib/store'
import { syncNow } from '../lib/sync'
import {
  BLOOD_GROUPS, canShowOnLockScreen, clearLockCard, hasRiderId, setLockCard,
} from '../lib/riderId'
import { isNativeApp, platform } from '../lib/platform'

export default function RiderId() {
  const safety = useStore(selectSafety)
  const profile = useStore((s) => s.profile)
  const account = useStore((s) => s.account)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')

  const field = 'bg-raised rounded-xl px-3 py-2.5 text-sm outline-none placeholder:text-mist focus:ring-2 focus:ring-brand/50'
  const say = (text, ms = 4000) => { setNote(text); if (text) setTimeout(() => setNote(''), ms) }

  const set = (patch) => {
    setRiderSafety(patch)
    // Straight to the rider's own row; nobody else can read it.
    if (account) syncNow(account.id)
  }

  async function useAsLockScreen() {
    try {
      await setLockCard(profile, safety)
      say('Lock screen set. Lock your phone to see it.', 6000)
    } catch (e) {
      say(e?.message === 'no-lock-wallpaper'
        ? 'This phone is too old to set the lock screen on its own.'
        : 'The lock screen could not be set.')
    }
  }

  async function putBack() {
    try {
      await clearLockCard()
      say('Your own lock screen is back.')
    } catch {
      say('That could not be undone here — set a wallpaper in Settings.')
    }
  }

  const ready = hasRiderId(safety)

  return (
    <section className="mx-5 mt-3 rounded-2xl border border-line bg-surface p-4">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 text-left" aria-expanded={open}>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Rider ID</span>
          <span className="block text-xs text-mist mt-0.5">
            {ready
              ? `${safety.bloodGroup || 'No blood group'} · ${safety.emergencyPhone || 'no contact'}`
              : 'Blood group and an emergency contact, for whoever reaches you first'}
          </span>
        </span>
        <span className="text-xs font-semibold text-brand shrink-0">{open ? 'Done' : ready ? 'Edit' : 'Add'}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-mist mb-2">Blood group</p>
            <div className="flex gap-1.5 overflow-x-auto no-bar pb-0.5">
              {BLOOD_GROUPS.map((g) => (
                <button key={g} onClick={() => set({ bloodGroup: safety.bloodGroup === g ? '' : g })}
                        aria-pressed={safety.bloodGroup === g}
                        className={`shrink-0 min-h-9 rounded-full border px-3.5 text-xs font-semibold transition
                                    ${safety.bloodGroup === g ? 'border-brand bg-brand/15 text-brand' : 'border-line text-mist'}`}>
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-mist mb-2">Emergency contact</p>
            <div className="grid grid-cols-2 gap-2">
              <input value={safety.emergencyName} onChange={(e) => set({ emergencyName: e.target.value.slice(0, 40) })}
                     placeholder="Name — “Riya (wife)”" className={field} />
              <input value={safety.emergencyPhone} onChange={(e) => set({ emergencyPhone: e.target.value.replace(/[^\d+ ]/g, '').slice(0, 20) })}
                     type="tel" inputMode="tel" placeholder="Phone number" className={field} />
            </div>
          </div>

          <button onClick={() => set({ insured: !safety.insured })} aria-pressed={safety.insured}
                  className="w-full flex items-start gap-3 text-left">
            <span className={`mt-0.5 w-11 h-6 rounded-full shrink-0 transition relative ${safety.insured ? 'bg-brand' : 'bg-line'}`}>
              <span className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${safety.insured ? 'left-[22px]' : 'left-0.5'}`} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Insured</span>
              <span className="block text-[11px] text-mist leading-relaxed">
                Tells a hospital there is a policy to find. The number itself stays with you.
              </span>
            </span>
          </button>

          {canShowOnLockScreen() ? (
            <div className="rounded-2xl border border-line p-3 space-y-2">
              <p className="text-xs text-mist leading-relaxed">
                While you're riding, Trekov shows this on your lock screen, with a button
                that dials your contact. For a phone that hides notifications when locked,
                put it on the lock screen wallpaper as well.
              </p>
              <div className="flex gap-2">
                <button onClick={useAsLockScreen} disabled={!ready}
                        className="flex-1 min-h-10 rounded-full bg-brand text-ink text-xs font-semibold disabled:opacity-40">
                  Use as lock screen
                </button>
                <button onClick={putBack}
                        className="flex-1 min-h-10 rounded-full border border-line text-xs font-semibold hover:border-brand">
                  Put mine back
                </button>
              </div>
              <p className="text-[11px] text-mist">Your home screen wallpaper is left alone.</p>
            </div>
          ) : (
            <p className="text-xs text-mist leading-relaxed rounded-2xl border border-line p-3">
              {isNativeApp && platform === 'ios'
                ? 'An iPhone lets no app write to its lock screen. Put the same details in Health → Medical ID and turn on “Show When Locked”; anyone can then reach them from the Emergency screen.'
                : 'On a phone, the Trekov app shows this on your lock screen while you ride. Here in the browser it is kept for when you install the app.'}
            </p>
          )}

          {note && <p className="text-xs text-brand" role="status">{note}</p>}

          <p className="text-[11px] text-mist leading-relaxed">
            Kept in your account and shown only on your own phone — never to other riders,
            not even the host of a ride you're on.
          </p>
        </div>
      )}
    </section>
  )
}
