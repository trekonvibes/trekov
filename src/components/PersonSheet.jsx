import { useEffect, useState } from 'react'
import useBackClose from '../lib/useBackClose'
import { personProfile } from '../lib/people'
import { CloseIcon } from './Icons'
import Portal from './Portal'
import ReportSheet from './ReportSheet'
import { block } from '../lib/safety'
import { useStore } from '../lib/store'

/**
 * Somebody else's profile, to look at.
 *
 * View only: their handle, name, bio and the photos they've posted. There is
 * nothing to change here and nothing private in it — no email, no trips, no
 * saved places, no location. Opened from a rider's name anywhere they appear.
 */
export default function PersonSheet({ userId, handle, onClose }) {
  const [person, setPerson] = useState(null)
  const [state, setState] = useState('loading')
  const [open, setOpen] = useState(null)   // a photo blown up
  const [reporting, setReporting] = useState(false)
  useBackClose(onClose, !reporting)
  const account = useStore((s) => s.account)
  const blockedIds = useStore((s) => s.blocked ?? [])
  const theirId = person?.id ?? userId
  const isMe = Boolean(account && theirId === account.id)
  const blocked = Boolean(theirId && blockedIds.includes(theirId))

  useEffect(() => {
    let live = true
    setState('loading')
    personProfile({ userId, handle }).then((p) => {
      if (!live) return
      setPerson(p)
      setState(p ? 'ready' : 'missing')
    })
    return () => { live = false }
  }, [userId, handle])

  return (
    <Portal>
      <div className="fixed inset-0 z-50 bg-ink/80 backdrop-blur-sm flex items-end sm:items-center justify-center"
           onClick={onClose}>
        <section onClick={(e) => e.stopPropagation()}
                 className="w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl
                            bg-surface border border-line p-5 pb-[calc(2rem+env(safe-area-inset-bottom))]">
          <div className="flex items-start gap-3">
            <img src={person?.avatar || ''} alt=""
                 className="size-16 rounded-full object-cover bg-raised ring-2 ring-brand/30 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold truncate">@{person?.handle ?? handle ?? '…'}</p>
              {person?.name && person.name !== person.handle && (
                <p className="text-sm text-mist truncate">{person.name}</p>
              )}
              {person?.bio && <p className="text-[13px] text-mist leading-snug mt-1">{person.bio}</p>}
            </div>
            <button onClick={onClose} className="text-mist hover:text-white p-1 shrink-0" aria-label="Close">
              <CloseIcon size={18} />
            </button>
          </div>

          {state === 'loading' && <p className="text-xs text-mist mt-5">Looking them up…</p>}
          {state === 'missing' && (
            <p className="text-xs text-mist mt-5">
              No profile to show — they may have signed up on another app, or deleted their account.
            </p>
          )}

          {state === 'ready' && (
            <>
              <p className="text-[10px] uppercase tracking-[0.14em] text-mist mt-5 mb-2">
                Photos{person.photos.length > 0 && ` · ${person.photos.length}`}
              </p>
              {person.photos.length === 0 ? (
                <p className="text-xs text-mist">Nothing posted yet.</p>
              ) : (
                <ul className="grid grid-cols-3 gap-1.5">
                  {person.photos.map((photo) => (
                    <li key={photo.id}>
                      <button onClick={() => setOpen(photo)} className="block w-full aspect-square">
                        <img src={photo.src} alt={photo.caption || ''} loading="lazy"
                             className="size-full object-cover rounded-lg bg-raised" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[10px] text-mist mt-3 leading-relaxed">
                What they've posted publicly. Their trips, saved places and location are not shown to anyone.
              </p>
              {account && !isMe && theirId && (
                <div className="mt-5 flex gap-2">
                  <button onClick={() => setReporting(true)}
                          className="flex-1 min-h-10 rounded-full border border-line text-xs text-mist hover:text-rose hover:border-rose">
                    Report profile
                  </button>
                  <button onClick={() => block(theirId, !blocked)}
                          className={`flex-1 min-h-10 rounded-full border text-xs ${blocked ? 'border-brand text-brand' : 'border-line text-mist hover:text-rose hover:border-rose'}`}>
                    {blocked ? `Unblock @${person.handle}` : `Block @${person.handle}`}
                  </button>
                </div>
              )}
              {blocked && (
                <p className="text-[10px] text-mist mt-2 leading-relaxed">
                  You won't see their photos, comments or reviews, and they can't add you to a trip.
                </p>
              )}
            </>
          )}
        </section>
      </div>

      {open && (
        <div className="fixed inset-0 z-[60] bg-ink/95 flex flex-col" onClick={() => setOpen(null)}>
          <button className="self-end m-4 text-mist hover:text-white" aria-label="Close photo">
            <CloseIcon size={22} />
          </button>
          <img src={open.src} alt={open.caption || ''} className="flex-1 min-h-0 w-full object-contain" />
          {open.caption && <p className="p-4 text-sm text-mist">{open.caption}</p>}
        </div>
      )}
      {reporting && (
        <ReportSheet kind="profile" targetId={theirId} userId={theirId} handle={person?.handle}
                     onClose={() => setReporting(false)} />
      )}
    </Portal>
  )
}
