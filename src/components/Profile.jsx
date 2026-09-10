import { useState } from 'react'
import { deletePost, getPlace, resetAll, selectMyPosts, selectSavedPlaces, selectTrips, useStore } from '../lib/store'
import { TrashIcon, Wordmark } from './Icons'
import Account from './Account'
import Media from './Media'
import ProfileEditor from './ProfileEditor'

export default function Profile({ onPost, onAuth }) {
  const [confirmReset, setConfirmReset] = useState(false)
  const [editing, setEditing] = useState(false)
  const profile = useStore((s) => s.profile)
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

      <Account onAuth={onAuth} />

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
            Reset demo data
          </button>
        )}
      </div>
    </>
  )
}
