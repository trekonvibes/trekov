import { useEffect, useRef, useState } from 'react'
import { createPost, getPlace, meId, selectPlaceSearch, upsertPlace, useStore } from '../lib/store'
import { CameraIcon, CloseIcon, Logo, SearchIcon } from './Icons'
import Camera from './Camera'
import PinMap from './PinMap'
import Portal from './Portal'

const field = 'w-full bg-raised rounded-xl px-3.5 py-2.5 text-sm outline-none placeholder:text-mist focus:ring-2 focus:ring-brand/50'

export default function Composer({ onClose, onPosted, onNewPlace }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [shooting, setShooting] = useState(true)   // open straight into the camera
  const [mode, setMode] = useState('existing')     // 'existing' | 'new'
  const [placeId, setPlaceId] = useState('')
  const [q, setQ] = useState('')
  const [fresh, setFresh] = useState({ name: '', region: '', country: 'India', bestTime: '', lat: 22.6, lng: 79.0 })
  const [caption, setCaption] = useState('')
  const [tags, setTags] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const matches = useStore((s) => selectPlaceSearch(s, q)).slice(0, 6)
  const chosen = useStore((s) => (placeId ? s.places[placeId] : null))

  useEffect(() => {
    if (!file) return setPreview('')
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])


  const placeReady = mode === 'existing' ? !!placeId : fresh.name.trim() && fresh.region.trim()
  const ready = file && placeReady

  async function submit(e) {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    try {
      let announced = null
      const id = mode === 'existing'
        ? placeId
        : upsertPlace({
            name: fresh.name.trim(), region: fresh.region.trim(),
            country: fresh.country.trim() || 'Elsewhere',
            lat: fresh.lat, lng: fresh.lng, bestTime: fresh.bestTime.trim(), blurb: '',
          })
      if (mode === 'new') announced = id
      await createPost({
        file, placeId: id, caption: caption.trim(),
        tags: tags.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean),
      })
      // Announce only genuinely new places — not every photo.
      if (announced) onNewPlace?.(getPlace(announced), meId)
      onPosted(id)
    } catch (err) {
      console.error(err)
      setError('Could not save that photo. Try a smaller file.')
      setBusy(false)
    }
  }

  if (shooting) {
    return (
      <Portal>
        <Camera
          onCapture={(f) => { setFile(f); setError(''); setShooting(false) }}
          onCancel={() => (file ? setShooting(false) : onClose())}
        />
      </Portal>
    )
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[1200] bg-black flex justify-center">
        <div className="tk-shell h-full bg-ink flex flex-col sm:border-x sm:border-line">
        <header className="flex items-center justify-between px-4 h-14 border-b border-line shrink-0">
          <button onClick={onClose} className="text-mist hover:text-white" aria-label="Cancel"><CloseIcon size={22} /></button>
          <span className="flex items-center gap-2 font-semibold"><Logo size={18} /> New photo</span>
          <button form="composer" type="submit" disabled={!ready || busy}
                  className="text-sm font-semibold text-brand disabled:text-mist disabled:opacity-50">
            {busy ? 'Posting…' : 'Post'}
          </button>
        </header>

        <form id="composer" onSubmit={submit}
              className="flex-1 overflow-y-auto p-4 space-y-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={() => setShooting(true)}
                  className="w-full aspect-[4/5] max-h-[38vh] rounded-2xl border border-dashed border-line bg-surface
                             overflow-hidden flex flex-col items-center justify-center gap-3 text-mist hover:border-brand transition">
            {preview
              ? <img src={preview} alt="" className="size-full object-cover" />
              : (
                <>
                  <CameraIcon size={30} />
                  <span className="text-sm">Take a photo</span>
                  <span className="text-xs">Camera only — no gallery uploads</span>
                </>
              )}
          </button>
          {preview && (
            <button type="button" onClick={() => setShooting(true)}
                    className="text-xs text-brand font-semibold">Retake</button>
          )}

          {error && <p className="text-sm text-rose">{error}</p>}

          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-mist mb-2">Where was this?</p>
            <div className="flex gap-1 mb-3">
              {[['existing', 'Existing place'], ['new', 'New place']].map(([id, label]) => (
                <button key={id} type="button" onClick={() => setMode(id)}
                        className={`px-3 py-1.5 rounded-full text-sm transition
                                    ${mode === id ? 'bg-raised text-white font-semibold' : 'text-mist hover:text-white'}`}>
                  {label}
                </button>
              ))}
            </div>

            {mode === 'existing' ? (
              <>
                {chosen ? (
                  <div className="flex items-center gap-2 bg-raised rounded-xl px-3.5 py-2.5">
                    <Logo size={16} />
                    <span className="text-sm font-medium truncate flex-1">{chosen.name}</span>
                    <span className="text-xs text-mist truncate">{chosen.region}</span>
                    <button type="button" onClick={() => { setPlaceId(''); setQ('') }}
                            className="text-mist hover:text-white" aria-label="Change place">
                      <CloseIcon size={16} />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 bg-raised rounded-xl px-3.5 py-2.5">
                      <SearchIcon size={17} className="text-mist shrink-0" />
                      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search places…"
                             className="bg-transparent flex-1 text-sm outline-none placeholder:text-mist min-w-0" />
                    </div>
                    <ul className="mt-2 rounded-xl border border-line divide-y divide-line overflow-hidden">
                      {matches.map((p) => (
                        <li key={p.id}>
                          <button type="button" onClick={() => setPlaceId(p.id)}
                                  className="w-full text-left px-3.5 py-2.5 text-sm hover:bg-raised">
                            {p.name} <span className="text-mist text-xs">· {p.region}</span>
                          </button>
                        </li>
                      ))}
                      {matches.length === 0 && <li className="px-3.5 py-3 text-sm text-mist">Nothing matches — add it as a new place.</li>}
                    </ul>
                  </>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <input className={field} placeholder="Place name *" value={fresh.name}
                         onChange={(e) => setFresh({ ...fresh, name: e.target.value })} />
                  <input className={field} placeholder="Region *" value={fresh.region}
                         onChange={(e) => setFresh({ ...fresh, region: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input className={field} placeholder="Country" value={fresh.country}
                         onChange={(e) => setFresh({ ...fresh, country: e.target.value })} />
                  <input className={field} placeholder="Best time (Nov–Feb)" value={fresh.bestTime}
                         onChange={(e) => setFresh({ ...fresh, bestTime: e.target.value })} />
                </div>
                <p className="text-xs text-mist">Tap the map to place the pin where it is.</p>
                <PinMap lat={fresh.lat} lng={fresh.lng}
                        onMove={(lat, lng) => setFresh((f) => ({ ...f, lat, lng }))} />
                <p className="text-xs text-mist tabular-nums">{fresh.lat}, {fresh.lng}</p>
              </div>
            )}
          </div>

          <textarea className={`${field} min-h-24 resize-none`} value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="What should someone know before they go?" />
          <input className={field} placeholder="tags, comma, separated" value={tags}
                 onChange={(e) => setTags(e.target.value)} />

          <p className="text-xs text-mist leading-relaxed">
            Photos are taken in the app, so every one is from where you actually
            stood. Yours becomes the place's featured banner until someone posts a
            newer one; earlier photos stay in the list beneath it. Media stays on
            this device; nothing is uploaded to a server yet.
          </p>
        </form>
        </div>
      </div>
    </Portal>
  )
}
