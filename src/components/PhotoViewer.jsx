import { useState } from 'react'
import {
  addComment, FACT_FIELDS, getPlace, getUser, selectFactsAt, toggleLike, useStore,
} from '../lib/store'
import { compact, timeAgo } from '../lib/format'
import { CloseIcon, CommentIcon, HeartIcon, Logo, SendIcon } from './Icons'
import Media from './Media'
import Portal from './Portal'

/** A single photo opened from a place, with its author, likes and comments. */
export default function PhotoViewer({ postId, onClose }) {
  const post = useStore((s) => s.posts.find((p) => p.id === postId))
  const [text, setText] = useState('')
  const [burst, setBurst] = useState(false)
  const facts = useStore((s) => (post ? selectFactsAt(s, post.placeId) : null))

  if (!post) return null
  const author = getUser(post.authorId)
  const place = getPlace(post.placeId)

  function like() {
    if (!post.likedByMe) { setBurst(true); setTimeout(() => setBurst(false), 340) }
    toggleLike(post.id)
  }

  function submit(e) {
    e.preventDefault()
    addComment(post.id, text)
    setText('')
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[1100] bg-black flex justify-center" role="dialog" aria-label="Photo">
        <div className="tk-shell h-full bg-ink flex flex-col sm:border-x sm:border-line">
        <header className="flex items-center gap-3 px-4 h-14 border-b border-line shrink-0">
          <button onClick={onClose} className="text-mist hover:text-white" aria-label="Close"><CloseIcon size={22} /></button>
          <img src={author.avatar} alt="" className="size-8 rounded-full object-cover" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate leading-tight">{author.name}</p>
            <p className="text-xs text-mist truncate">@{author.handle} · {timeAgo(post.createdAt)}</p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <Media media={post.media} alt={place?.name ?? ''} className="w-full max-h-[62vh] object-contain bg-black" />

          <div className="px-4 py-3 space-y-3">
            {place && (
              <p className="flex items-center gap-2 text-sm">
                <Logo size={15} />
                <span className="font-medium">{place.name}</span>
                <span className="text-mist">· {place.region}</span>
              </p>
            )}
            <p className="text-[15px] leading-snug text-white/90">{post.caption}</p>

            {/* What you actually need to know before going, reported by the
                people who went. Counts are shown because "3 of 4 say" is
                honest where a bare "yes" is not. */}
            <div className="rounded-2xl border border-line bg-surface p-3">
              <p className="text-[10px] uppercase tracking-[0.14em] text-mist mb-2">Before you go</p>
              {!facts ? (
                <p className="text-xs text-mist">
                  Nobody has reported the practicalities here yet — rate the place to add them.
                </p>
              ) : (
                <ul className="grid grid-cols-2 gap-2">
                  {FACT_FIELDS.filter((f) => facts[f.id]).map((f) => {
                    const hit = facts[f.id]
                    const warn = ['none', 'carry', 'no', '4x4'].includes(hit.value)
                    return (
                      <li key={f.id} className="rounded-xl bg-raised px-2.5 py-2">
                        <p className="text-[10px] uppercase tracking-[0.1em] text-mist">{f.label}</p>
                        <p className={`text-sm font-semibold leading-tight ${warn ? 'text-sun' : 'text-white'}`}>
                          {hit.label}
                        </p>
                        <p className="text-[10px] text-mist tabular-nums">{hit.agree} of {hit.of} agree</p>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-mist">
              {post.tags.map((t) => <span key={t}>#{t}</span>)}
            </div>

            <div className="flex items-center gap-4 pt-1">
              <button onClick={like} aria-pressed={post.likedByMe}
                      aria-label={post.likedByMe ? 'Unlike' : 'Like'}
                      className={`flex items-center gap-1.5 ${post.likedByMe ? 'text-rose' : 'text-white/80 hover:text-white'}`}>
                <span className={burst ? 'pop' : ''}><HeartIcon size={23} filled={post.likedByMe} /></span>
                <span className="text-sm tabular-nums">{compact(post.likes)}</span>
              </button>
              <span className="flex items-center gap-1.5 text-white/80">
                <CommentIcon size={22} />
                <span className="text-sm tabular-nums">{post.comments.length}</span>
              </span>
            </div>

            <ul className="space-y-3 pt-2">
              {post.comments.map((c) => {
                const u = getUser(c.userId)
                return (
                  <li key={c.id} className="flex gap-3">
                    <img src={u.avatar} alt="" className="size-8 rounded-full object-cover shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm"><span className="font-semibold">{u.handle}</span>{' '}
                        <span className="text-mist text-xs">{timeAgo(c.createdAt)}</span></p>
                      <p className="text-sm text-white/90 break-words">{c.text}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        <form onSubmit={submit} className="flex items-center gap-3 p-3 border-t border-line shrink-0
                                           pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment…"
                 className="flex-1 bg-raised rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-mist focus:ring-2 focus:ring-brand/50" />
          <button type="submit" disabled={!text.trim()} aria-label="Post comment"
                  className="text-brand disabled:text-mist disabled:opacity-50 p-1"><SendIcon size={22} /></button>
        </form>
        </div>
      </div>
    </Portal>
  )
}
