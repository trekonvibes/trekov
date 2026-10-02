import { useEffect, useState } from 'react'
import useBackClose from '../lib/useBackClose'
import { deletePost, getPlace, resetAll, selectMyPosts, selectSavedPlaces, selectTrips, useStore } from '../lib/store'
import { amIAdmin } from '../lib/admin'
import { CloseIcon, TrashIcon, Wordmark } from './Icons'
import Account from './Account'
import Media from './Media'
import ProfileEditor from './ProfileEditor'
import RiderId from './RiderId'
import Portal from './Portal'

export default function Profile({ onPost, onAuth, onListBusiness, onPlans, onAdmin }) {
  const [confirmReset, setConfirmReset] = useState(false)
  const [legal, setLegal] = useState(null)   // '/privacy/' | '/terms/' | '/delete-account/'
  useBackClose(() => setLegal(null), Boolean(legal))
  const [editing, setEditing] = useState(false)
  const profile = useStore((s) => s.profile)
  const account = useStore((s) => s.account)
  // The Admin entry shows only for admins; the server checks again on every call.
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    if (!account) return setIsAdmin(false)
    let live = true
    amIAdmin().then((ok) => live && setIsAdmin(ok)).catch(() => {})
    return () => { live = false }
  }, [account?.id])
  const mine = useStore(selectMyPosts)
  const saved = useStore(selectSavedPlaces)
  const trips = useStore(selectTrips)

  const stats = [['Photos', mine.length], ['Saved', saved.length], ['Trips', trips.length]]

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between px-4 h-14
                         bg-ink/85 backdrop-blur-xl border-b border-line">
        <h1 className="text-lg font-semibold">@{profile.handle}</h1>
        <Wordmark size={16} />
      </header>

      <div className="p-5 flex items-center gap-4">
        <button onClick={() => setEditing(true)} className="shrink-0" aria-label="Edit profile photo">
          <img src={profile.avatar} alt=""
               className="size-20 rounded-full object-cover ring-2 ring-brand/40" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold leading-tight">{profile.name}</p>
          <p className="text-sm text-mist leading-snug mt-0.5">{profile.bio}</p>
        </div>
        <button onClick={() => setEditing(true)}
                className="shrink-0 self-start rounded-full border border-line px-3.5 py-1.5
                           text-xs font-semibold hover:border-brand hover:text-brand">
          Edit
        </button>
      </div>

      {editing && <ProfileEditor onClose={() => setEditing(false)} />}

      <Account onAuth={onAuth} onPlans={onPlans} />

      <RiderId />

      {isAdmin && onAdmin && (
        <button onClick={onAdmin}
                className="mx-5 mt-3 w-[calc(100%-2.5rem)] flex items-center gap-3 rounded-2xl border border-brand/40 bg-brand/5 px-4 py-3 text-left hover:border-brand">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Admin</span>
            <span className="block text-xs text-mist mt-0.5">Sign-ups, activity, users and app settings</span>
          </span>
          <span className="text-brand text-xs font-semibold shrink-0">Open</span>
        </button>
      )}

      {onListBusiness && (
        <button onClick={onListBusiness}
                className="mx-5 mt-3 w-[calc(100%-2.5rem)] flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left hover:border-brand">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Your business on Trekov</span>
            <span className="block text-xs text-mist mt-0.5">List a stay, dhaba, garage, fuel stop or rental</span>
          </span>
          <span className="text-brand text-xs font-semibold shrink-0">Open</span>
        </button>
      )}

      <div className="grid grid-cols-3 mx-5 mt-4 rounded-2xl border border-line bg-surface divide-x divide-line">
        {stats.map(([label, value]) => (
          <div key={label} className="py-3 text-center">
            <p className="text-lg font-semibold tabular-nums">{value}</p>
            <p className="text-[11px] uppercase tracking-[0.12em] text-mist">{label}</p>
          </div>
        ))}
      </div>

      <h2 className="px-5 pt-7 pb-3 text-xs uppercase tracking-[0.14em] text-mist">Your photos</h2>

      {mine.length === 0 ? (
        <div className="text-center px-10 py-10">
          <p className="text-sm text-mist leading-relaxed">
            Nothing posted yet. Put up somewhere you've actually been — that's what lands on
            someone else's list.
          </p>
          <button onClick={onPost} className="mt-4 rounded-full bg-brand text-ink font-semibold text-sm px-5 py-2.5">
            Post a photo
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-0.5 px-0.5">
          {mine.map((p) => (
            <div key={p.id} className="relative aspect-square">
              <Media media={p.media} alt="" className="size-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 p-1.5 text-[10px] font-medium leading-tight
                               bg-gradient-to-t from-black/80 to-transparent pt-6 truncate block">
                {getPlace(p.placeId)?.name ?? 'Unknown place'}
              </span>
              <button onClick={() => deletePost(p.id)} aria-label="Delete photo"
                      className="absolute top-1.5 right-1.5 rounded-full bg-black/60 p-1.5 text-white/80 hover:text-rose">
                <TrashIcon size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* The policies the app is bound by, one tap from the profile. They ship
          inside the app too, so they open offline (launch polish, 2026-09-14). */}
      <nav className="px-5 pt-8 flex flex-wrap gap-x-4 gap-y-2 text-xs text-mist" aria-label="About Trekov">
        <button onClick={() => setLegal('/privacy/index.html')} className="underline underline-offset-4 hover:text-white">Privacy policy</button>
        <button onClick={() => setLegal('/terms/index.html')} className="underline underline-offset-4 hover:text-white">Terms</button>
        <button onClick={() => setLegal('/delete-account/index.html')} className="underline underline-offset-4 hover:text-white">Deleting your account</button>
        <a href="mailto:trekonvibes@gmail.com?subject=Trekov%20support" className="underline underline-offset-4 hover:text-white">Contact support</a>
      </nav>
      {legal && (
        <Portal>
          <div className="fixed inset-0 z-[1300] bg-ink flex flex-col pt-safe" role="dialog" aria-label="Trekov policy">
            <header className="flex items-center justify-end px-2 h-12 border-b border-line shrink-0">
              <button onClick={() => setLegal(null)} className="grid place-items-center size-10 text-mist hover:text-white" aria-label="Close">
                <CloseIcon size={22} />
              </button>
            </header>
            <iframe src={legal} title="Trekov policy" className="flex-1 w-full bg-ink border-0" />
          </div>
        </Portal>
      )}

      <div className="px-5 py-10">
        {confirmReset ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-mist flex-1">
              Clear your photos, saved places and trips?
            </span>
            <button onClick={() => setConfirmReset(false)}
                    className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold">
              Keep
            </button>
            <button onClick={() => { resetAll(); setConfirmReset(false) }}
                    className="rounded-full bg-rose text-white px-3 py-1.5 text-xs font-semibold">
              Reset
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmReset(true)}
                  className="text-xs text-mist underline underline-offset-4 hover:text-rose">
            Clear data on this device
          </button>
        )}
      </div>
    </>
  )
}
