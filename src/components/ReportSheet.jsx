import { useState } from 'react'
import useBackClose from '../lib/useBackClose'
import { REASONS, block, report } from '../lib/safety'
import Portal from './Portal'

/**
 * Report something someone posted, and optionally block them.
 * kind: post | comment | review | profile | ride.
 */
export default function ReportSheet({ kind, targetId, userId, handle, onClose, onBlocked }) {
  const [reason, setReason] = useState(null)
  const [note, setNote] = useState('')
  const [alsoBlock, setAlsoBlock] = useState(false)
  const [state, setState] = useState('idle')   // idle | sending | sent | error
  const [msg, setMsg] = useState('')
  useBackClose(onClose)
  const what = { post: 'photo', comment: 'comment', review: 'review', profile: 'profile', ride: 'ride' }[kind] ?? 'post'

  async function send() {
    if (!reason) return
    setState('sending')
    const r = await report({ kind, targetId, reason, note })
    if (!r.ok) { setState('error'); setMsg(r.reason); return }
    if (alsoBlock && userId) { await block(userId, true); onBlocked?.() }
    setState('sent')
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[1500] bg-ink/80 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={onClose}>
        <section role="dialog" aria-label={`Report this ${what}`} onClick={(e) => e.stopPropagation()}
                 className="w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-surface border border-line p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {state === 'sent' ? (
            <>
              <h2 className="text-lg font-semibold">Thanks — we'll take a look</h2>
              <p className="mt-2 text-sm text-mist leading-relaxed">
                Trekov reviews every report. {alsoBlock && handle ? `You won't see @${handle} any more.` : "The person you reported isn't told who reported them."}
              </p>
              <button onClick={onClose} className="mt-5 w-full min-h-11 rounded-full bg-brand text-ink font-semibold">Done</button>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold">Report this {what}</h2>
              <p className="mt-1 text-xs text-mist">What's wrong with it? The person isn't told who reported them.</p>
              <ul className="mt-4 space-y-1.5" role="radiogroup">
                {REASONS.map(([id, label]) => (
                  <li key={id}>
                    <button role="radio" aria-checked={reason === id} onClick={() => setReason(id)}
                            className={`w-full text-left rounded-xl border px-3 py-2.5 text-sm transition
                                        ${reason === id ? 'border-brand bg-brand/10 text-brand' : 'border-line hover:border-mist'}`}>
                      {label}
                    </button>
                  </li>
                ))}
              </ul>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2}
                        placeholder="Anything we should know (optional)"
                        className="mt-3 w-full rounded-xl bg-raised border border-line px-3 py-2 text-sm outline-none focus:border-brand" />
              {userId && handle && (
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} className="size-4 accent-[#00C08B]" />
                  Also block @{handle}
                </label>
              )}
              {state === 'error' && <p className="mt-3 text-xs text-rose">{msg}</p>}
              <div className="mt-5 flex gap-2">
                <button onClick={onClose} className="flex-1 min-h-11 rounded-full border border-line text-sm">Cancel</button>
                <button onClick={send} disabled={!reason || state === 'sending'}
                        className="flex-1 min-h-11 rounded-full bg-rose text-white text-sm font-semibold disabled:opacity-40">
                  {state === 'sending' ? 'Sending…' : 'Send report'}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </Portal>
  )
}
