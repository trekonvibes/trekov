import { useState } from 'react'
import useBackClose from '../lib/useBackClose'
import ReportSheet from './ReportSheet'
import {
  FACT_FIELDS, RATING_CATEGORIES, getUser, selectMyReviewAt, selectReviewsAt, upsertReview, useStore,
} from '../lib/store'
import { ago } from '../lib/format'
import { CloseIcon } from './Icons'
import Portal from './Portal'

const SCORES = [1, 2, 3, 4, 5]

export default function ReviewSheet({ place, onClose }) {
  const mine = useStore((s) => selectMyReviewAt(s, place.id))
  const [reporting, setReporting] = useState(null)
  const account = useStore((s) => s.account)
  useBackClose(onClose, !reporting)
  const reviews = useStore((s) => selectReviewsAt(s, place.id))
  const [ratings, setRatings] = useState(() => mine?.ratings ?? {})
  const [note, setNote] = useState(mine?.note ?? '')
  const [facts, setFacts] = useState(() => mine?.facts ?? {})
  const [saved, setSaved] = useState(false)

  const rated = RATING_CATEGORIES.filter((c) => ratings[c.id]).length
                + FACT_FIELDS.filter((f) => facts[f.id]).length

  function save() {
    upsertReview(place.id, { ratings, note, facts })
    setSaved(true)
    setTimeout(onClose, 700)
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[1250] flex items-end justify-center" role="dialog" aria-label={`Rate ${place.name}`}>
        <button className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} aria-label="Close" />
        <div className="sheet-up relative tk-shell max-h-[85vh] supports-[height:1dvh]:max-h-[85dvh] px-safe flex flex-col rounded-t-3xl border-t border-line bg-ink">
          <header className="flex items-center justify-between px-5 py-4 border-b border-line shrink-0">
            <div className="min-w-0">
              <h2 className="font-semibold truncate">Rate {place.name}</h2>
              <p className="text-xs text-mist">{mine ? 'Updating your review' : 'One review per person'}</p>
            </div>
            <button onClick={onClose} className="text-mist hover:text-white p-1" aria-label="Close">
              <CloseIcon size={22} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {RATING_CATEGORIES.map((c) => (
              <div key={c.id}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-sm font-medium">{c.label}</span>
                  <span className="text-xs text-mist tabular-nums">
                    {ratings[c.id] ? `${ratings[c.id]}/5` : 'not rated'}
                  </span>
                </div>
                <div className="flex gap-1.5" role="radiogroup" aria-label={c.label}>
                  {SCORES.map((n) => (
                    <button key={n} role="radio" aria-checked={ratings[c.id] === n} aria-label={`${c.label} ${n} of 5`}
                            onClick={() => setRatings((r) => ({ ...r, [c.id]: n }))}
                            className={`flex-1 rounded-lg py-2 text-sm font-semibold border transition
                                        ${ratings[c.id] >= n
                                          ? 'bg-brand/20 border-brand text-brand'
                                          : 'border-line text-mist hover:border-mist'}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <div className="pt-1">
              <p className="text-xs uppercase tracking-[0.14em] text-mist mb-2">Practicalities</p>
              <div className="space-y-3">
                {FACT_FIELDS.map((f) => (
                  <div key={f.id}>
                    <p className="text-sm font-medium mb-1.5">{f.label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {f.options.map(([id, label]) => (
                        <button key={id} type="button" aria-pressed={facts[f.id] === id}
                                onClick={() => setFacts((v) => ({ ...v, [f.id]: v[f.id] === id ? undefined : id }))}
                                className={`rounded-full px-3 py-1.5 text-xs border transition
                                            ${facts[f.id] === id
                                              ? 'bg-brand text-ink border-brand font-semibold'
                                              : 'border-line text-mist hover:text-white'}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <textarea value={note} onChange={(e) => setNote(e.target.value)}
                      placeholder="Anything worth knowing before someone goes? Permits, timings, what to skip…"
                      className="w-full bg-raised rounded-xl px-3.5 py-2.5 text-sm outline-none min-h-24 resize-none
                                 placeholder:text-mist focus:ring-2 focus:ring-brand/50" />

            {reviews.length > 0 && (
              <div>
                <h3 className="text-xs uppercase tracking-[0.14em] text-mist mb-2">
                  {reviews.length} review{reviews.length === 1 ? '' : 's'}
                </h3>
                <ul className="space-y-3">
                  {reviews.map((r) => {
                    const u = getUser(r.userId)
                    const vals = RATING_CATEGORIES.map((c) => r.ratings?.[c.id]).filter(Boolean)
                    const avg = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—'
                    return (
                      <li key={r.id} className="flex gap-3">
                        <img src={u.avatar} alt="" className="size-8 rounded-full object-cover shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">
                            <span className="font-semibold">@{u.handle}</span>{' '}
                            <span className="text-xs text-mist">{ago(r.createdAt)} · {avg}/5</span>
                            {account && r.userId !== account.id && r.userId !== 'u_me' && (
                              <button onClick={() => setReporting({ kind: 'review', targetId: r.id, userId: r.userId, handle: u.handle })}
                                      className="ml-2 text-[11px] text-mist hover:text-rose">Report</button>
                            )}
                          </p>
                          {r.note && <p className="text-sm text-white/85 break-words">{r.note}</p>}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-line shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button onClick={save} disabled={rated === 0 || saved}
                    className="w-full rounded-full bg-brand text-ink py-3 text-sm font-semibold disabled:opacity-40">
              {saved ? 'Saved' : rated === 0 ? 'Rate or report at least one thing' : mine ? 'Update review' : 'Post review'}
            </button>
          </div>
        </div>
      </div>
      {reporting && <ReportSheet {...reporting} onClose={() => setReporting(null)} />}
    </Portal>
  )
}
