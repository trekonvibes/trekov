import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPost, getPlace, meId, selectPlaceSearch, selectPlaces, upsertPlace, useStore } from '../lib/store'
import {
  FIX_MAX_AGE_MS, NEW_PIN_RADIUS_M, PHOTO_RADIUS_M, formatMetres, getFix, gpsMessage, metresBetween,
} from '../lib/gps'
import { CameraIcon, CloseIcon, Logo, SearchIcon } from './Icons'
import Camera from './Camera'
import PinMap from './PinMap'
import Portal from './Portal'
import { useMembership } from '../lib/membership'

const field = 'w-full bg-raised rounded-xl px-3.5 py-2.5 text-sm outline-none placeholder:text-mist focus:ring-2 focus:ring-brand/50'
const round5 = (n) => Math.round(n * 1e5) / 1e5

export default function Composer({ onClose, onPosted, onNewPlace, onPlans }) {
  const membership = useMembership()
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [shooting, setShooting] = useState(true)   // open straight into the camera
  const [mode, setMode] = useState('existing')     // 'existing' | 'new'
  const [placeId, setPlaceId] = useState('')
  const [q, setQ] = useState('')
  const [fresh, setFresh] = useState({ name: '', region: '', country: 'India', bestTime: '', lat: null, lng: null })
  const [caption, setCaption] = useState('')
  const [tags, setTags] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Location is compulsory: a photo posts only with a fresh fix that puts you
  // at the place. 'getting' | 'ok' | 'denied' | 'timeout' | 'unavailable'
  const [fix, setFix] = useState(null)
  const [gps, setGps] = useState('getting')
  const request = useRef(0)
  const locate = useCallback(() => {
    const id = ++request.current
    setGps('getting')
    getFix()
      .then((f) => { if (id === request.current) { setFix(f); setGps('ok') } })
      .catch((e) => { if (id === request.current) setGps(e.code ?? 'unavailable') })
  }, [])
  useEffect(() => { locate() }, [locate])

  const matches = useStore((s) => selectPlaceSearch(s, q)).slice(0, 6)
  const places = useStore(selectPlaces)
  const chosen = useStore((s) => (placeId ? s.places[placeId] : null))

  const away = (p) => (fix ? metresBetween(fix, p) : null)
  const nearby = useMemo(() => {
    if (!fix) return []
    return places
      .map((p) => ({ p, d: metresBetween(fix, p) }))
      .filter((x) => x.d <= PHOTO_RADIUS_M)
      .sort((a, b) => a.d - b.d)
      .slice(0, 6)
  }, [fix, places])

  // A new place starts where you're standing.
  useEffect(() => {
    if (fix && fresh.lat == null) setFresh((f) => ({ ...f, lat: round5(fix.lat), lng: round5(fix.lng) }))
  }, [fix, fresh.lat])

  useEffect(() => {
    if (!file) return setPreview('')
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const chosenAway = chosen ? away(chosen) : null
  const tooFar = mode === 'existing' && chosenAway != null && chosenAway > PHOTO_RADIUS_M
  const placeReady = mode === 'existing' ? !!placeId && !tooFar : fresh.name.trim() && fresh.region.trim() && fresh.lat != null
  const ready = file && placeReady && gps === 'ok' && fix

  function movePin(lat, lng) {
    if (fix && metresBetween(fix, { lat, lng }) > NEW_PIN_RADIUS_M) {
      setError(`Keep the pin within ${formatMetres(NEW_PIN_RADIUS_M)} of where you're standing.`)
      setFresh((f) => ({ ...f }))            // re-render snaps the pin back
      return
    }
    setError('')
    setFresh((f) => ({ ...f, lat: round5(lat), lng: round5(lng) }))
  }

  async function submit(e) {
    e.preventDefault()
    if (!ready || busy) return
    // Posts are shared with everyone, so once paid plans are on they need an active account.
    if (membership?.paywallOn && !membership.isMember) {
      onClose()
      return onPlans?.('rider')
    }
    // A fix from long ago doesn't prove where the photo was taken.
    if (Date.now() - Date.parse(fix.at) > FIX_MAX_AGE_MS) {
      setError('Checking your location again — post once it confirms.')
      return locate()
    }
    const target = mode === 'existing' ? chosen : { lat: fresh.lat, lng: fresh.lng }
    const distanceM = Math.round(metresBetween(fix, target))
    if (mode === 'existing' && distanceM > PHOTO_RADIUS_M) {
      return setError(`You're ${formatMetres(distanceM)} from ${chosen.name}. Photos have to be taken there.`)
    }
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
        located: { at: fix.at, distanceM, accuracyM: fix.accuracy },
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
          // A fresh fix at the moment of the shot is the one that proves it.
          onCapture={(f) => { setFile(f); setError(''); setShooting(false); locate() }}
          onCancel={() => (file ? setShooting(false) : onClose())}
        />
      </Portal>
    )
  }

  const placeRow = (p, d) => {
    const far = d != null && d > PHOTO_RADIUS_M
    return (
      <li key={p.id}>
        <button type="button" onClick={() => !far && setPlaceId(p.id)} disabled={far}
                className="w-full text-left px-3.5 py-2.5 text-sm hover:bg-raised disabled:opacity-40 disabled:hover:bg-transparent flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate">{p.name} <span className="text-mist text-xs">· {p.region}</span></span>
          {d != null && <span className={`text-[11px] tabular-nums ${far ? 'text-rose' : 'text-mist'}`}>{formatMetres(d)}</span>}
        </button>
      </li>
    )
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[1200] bg-black flex justify-center">
        <div className="tk-shell h-full bg-ink flex flex-col sm:border-x sm:border-line pt-safe px-safe">
        <header className="flex items-center justify-between px-4 h-14 border-b border-line shrink-0">
          <button onClick={onClose} className="-ml-2 grid place-items-center size-10 text-mist hover:text-white" aria-label="Cancel"><CloseIcon size={22} /></button>
          <span className="flex items-center gap-2 font-semibold"><Logo size={18} /> New photo</span>
          <button form="composer" type="submit" disabled={!ready || busy}
                  className="text-sm font-semibold text-brand disabled:text-mist disabled:opacity-50">
            {busy ? 'Posting…' : 'Post'}
          </button>
        </header>

        <form id="composer" onSubmit={submit}
              className="flex-1 overflow-y-auto p-4 space-y-4 pb-[max(1rem,env(safe-area-inset-bottom))] max-w-2xl mx-auto w-full">
          <button type="button" onClick={() => setShooting(true)}
                  className="w-full aspect-[4/5] max-h-[38vh] supports-[height:1dvh]:max-h-[38dvh] rounded-2xl border border-dashed border-line bg-surface
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

          <LocationStatus gps={gps} fix={fix} onRetry={locate} />

          {error && <p className="text-sm text-rose">{error}</p>}

          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-mist mb-2">Where was this?</p>
            <div className="flex gap-1 mb-3">
              {[['existing', 'Existing place'], ['new', 'New place']].map(([id, label]) => (
                <button key={id} type="button" onClick={() => { setMode(id); setError('') }}
                        className={`px-3 py-1.5 rounded-full text-sm transition
                                    ${mode === id ? 'bg-raised text-white font-semibold' : 'text-mist hover:text-white'}`}>
                  {label}
                </button>
              ))}
            </div>

            {mode === 'existing' ? (
              <>
                {chosen ? (
                  <>
                    <div className={`flex items-center gap-2 bg-raised rounded-xl px-3.5 py-2.5 ${tooFar ? 'ring-1 ring-rose/60' : ''}`}>
                      <Logo size={16} />
                      <span className="text-sm font-medium truncate flex-1">{chosen.name}</span>
                      {chosenAway != null && <span className="text-xs text-mist tabular-nums">{formatMetres(chosenAway)} away</span>}
                      <button type="button" onClick={() => { setPlaceId(''); setQ('') }}
                              className="text-mist hover:text-white" aria-label="Change place">
                        <CloseIcon size={16} />
                      </button>
                    </div>
                    {tooFar && (
                      <p className="text-xs text-rose mt-2">
                        You're too far from {chosen.name} — photos must be taken within {formatMetres(PHOTO_RADIUS_M)} of it.
                        Pick a place near you, or add this spot as a new place.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 bg-raised rounded-xl px-3.5 py-2.5">
                      <SearchIcon size={17} className="text-mist shrink-0" />
                      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search places…"
                             className="bg-transparent flex-1 text-sm outline-none placeholder:text-mist min-w-0" />
                    </div>
                    {!q.trim() && fix && (
                      <p className="text-[11px] uppercase tracking-[0.14em] text-mist mt-3 mb-1">Near you</p>
                    )}
                    <ul className="mt-2 rounded-xl border border-line divide-y divide-line overflow-hidden">
                      {q.trim()
                        ? matches.map((p) => placeRow(p, away(p)))
                        : nearby.map(({ p, d }) => placeRow(p, d))}
                      {(q.trim() ? matches.length === 0 : nearby.length === 0) && (
                        <li className="px-3.5 py-3 text-sm text-mist">
                          {q.trim() || !fix ? 'Nothing matches — add it as a new place.'
                            : `No Trekov places within ${formatMetres(PHOTO_RADIUS_M)} — add this one as a new place.`}
                        </li>
                      )}
                    </ul>
                  </>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
                  <input className={field} placeholder="Place name *" value={fresh.name}
                         onChange={(e) => setFresh({ ...fresh, name: e.target.value })} />
                  <input className={field} placeholder="Region *" value={fresh.region}
                         onChange={(e) => setFresh({ ...fresh, region: e.target.value })} />
                </div>
                <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
                  <input className={field} placeholder="Country" value={fresh.country}
                         onChange={(e) => setFresh({ ...fresh, country: e.target.value })} />
                  <input className={field} placeholder="Best time (Nov–Feb)" value={fresh.bestTime}
                         onChange={(e) => setFresh({ ...fresh, bestTime: e.target.value })} />
                </div>
                {fresh.lat == null ? (
                  <p className="text-xs text-mist">The pin appears at your location once it's confirmed.</p>
                ) : (
                  <>
                    <p className="text-xs text-mist">
                      Pinned where you're standing. Tap to fine-tune — up to {formatMetres(NEW_PIN_RADIUS_M)} away.
                    </p>
                    <PinMap lat={fresh.lat} lng={fresh.lng} onMove={movePin} />
                    <p className="text-xs text-mist tabular-nums">{fresh.lat}, {fresh.lng}</p>
                  </>
                )}
              </div>
            )}
          </div>

          <textarea className={`${field} min-h-24 resize-none`} value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="What should someone know before they go?" />
          <input className={field} placeholder="tags, comma, separated" value={tags}
                 onChange={(e) => setTags(e.target.value)} />

          <p className="text-xs text-mist leading-relaxed">
            Every photo is taken in the app and checked against your location, so it's from where you
            actually stood. Others see that it was taken on location — not your exact spot. Yours becomes
            the place's featured banner until someone posts a newer one.
          </p>
        </form>
        </div>
      </div>
    </Portal>
  )
}

function LocationStatus({ gps, fix, onRetry }) {
  if (gps === 'ok' && fix) {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-brand/10 border border-brand/30 px-3.5 py-2.5 text-sm text-brand">
        <span aria-hidden>●</span> Location confirmed <span className="text-xs text-brand/70 tabular-nums">±{fix.accuracy} m</span>
      </p>
    )
  }
  if (gps === 'getting') {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-raised px-3.5 py-2.5 text-sm text-mist">
        <span className="size-2 rounded-full bg-sun animate-pulse" aria-hidden /> Confirming your location…
      </p>
    )
  }
  return (
    <div className="rounded-xl border border-rose/40 bg-rose/10 px-3.5 py-2.5">
      <p className="text-sm text-rose">{gpsMessage(gps)}</p>
      <button type="button" onClick={onRetry} className="mt-1.5 text-xs font-semibold text-white hover:underline">
        Try again
      </button>
    </div>
  )
}
