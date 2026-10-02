// Route animator: the trip, animated into a video a rider can post.
//
// Everything renders on the phone. No upload, no account beyond the trip
// itself, and nothing about the route leaves the device — the same promise the
// rest of the app makes about where a rider has been.
//
// The controls are the ones a rider actually reaches for, in the order they
// reach for them: the vehicle first, then the path, then the frame. Each choice
// is remembered, because nobody wants to pick a line colour twice.

import { useEffect, useRef, useState } from 'react'
import { getPlace, useStore } from '../lib/store'
import { getTripRoute } from '../lib/route'
import { MODELS, baseOf, pickableVehicle } from '../lib/vehicleArt'
import { spriteHtml } from '../lib/vehicleSprites'
import { buzz, saveVideo, shareVideo } from '../lib/native'
import {
  ANGLES, LABEL_SIZES, MODEL_SIZES, PATH_COLOURS, PATH_STYLES, SHAPES, STYLES, WIDTHS,
  canMakeMp4, directPath, distanceIn, renderRouteVideo,
} from '../lib/routeVideo'
import { CloseIcon } from './Icons'

const REMEMBER = 'trekov.reel'
const load = () => { try { return JSON.parse(localStorage.getItem(REMEMBER) || '{}') } catch { return {} } }
const save = (o) => { try { localStorage.setItem(REMEMBER, JSON.stringify(o)) } catch { /* private mode */ } }
const lastVehicle = () => { try { return localStorage.getItem('trekov.vehicle') || 'hatchback' } catch { return 'hatchback' } }

const LENGTHS = [10, 15, 20, 30]

/** dd Mon — the date line over the title card. */
const when = (trip) => {
  const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  if (trip.start && trip.end && trip.start !== trip.end) return `${fmt(trip.start)} – ${fmt(trip.end)}`
  return trip.start ? fmt(trip.start) : ''
}

export default function RouteVideo({ trip, onClose }) {
  const places = useStore((s) => s.places)
  const saved = useRef(load()).current

  // Every control, with whatever was chosen last time.
  const [vehicle, setVehicle] = useState(() => pickableVehicle(saved.vehicle || lastVehicle()))
  const [modelSize, setModelSize] = useState(saved.modelSize || 'medium')
  const [shape, setShape] = useState(saved.shape || 'reel')
  const [quality, setQuality] = useState(saved.quality || 'hd')
  const [seconds, setSeconds] = useState(saved.seconds || 15)
  const [style, setStyle] = useState(saved.style || 'dark')
  const [pathStyle, setPathStyle] = useState(saved.pathStyle || 'solid')
  const [pathColour, setPathColour] = useState(saved.pathColour || PATH_COLOURS[0].hex)
  const [pathWidth, setPathWidth] = useState(saved.pathWidth || 'medium')
  const [angle, setAngle] = useState(saved.angle || 'tilted')
  // 2D: flat, from straight above. 3D: tilted, with the hills standing up.
  const [view, setView] = useState(saved.view || '3d')
  const [follow, setFollow] = useState(saved.follow ?? true)
  const [showDistance, setShowDistance] = useState(saved.showDistance ?? true)
  const [showLabels, setShowLabels] = useState(saved.showLabels ?? true)
  const [labelSize, setLabelSize] = useState(saved.labelSize || 'medium')
  const [unit, setUnit] = useState(saved.unit || 'km')

  const [tab, setTab] = useState('vehicle')
  const [road, setRoad] = useState(null)              // the routed road, when we have it
  const [state, setState] = useState('loading')       // loading | ready | rendering | done | error
  const [progress, setProgress] = useState(0)
  const [video, setVideo] = useState(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const cancel = useRef(null)

  const stops = trip.stops.map((s) => getPlace(s.placeId)).filter(Boolean)

  useEffect(() => {
    save({ vehicle, modelSize, shape, quality, seconds, style, pathStyle, pathColour, pathWidth, angle, view, follow, showDistance, showLabels, labelSize, unit })
  }, [vehicle, modelSize, shape, quality, seconds, style, pathStyle, pathColour, pathWidth, angle, view, follow, showDistance, showLabels, labelSize, unit])

  // The road itself. Only needed when the rider wants the navigation path —
  // straight lines between stops need no network at all.
  useEffect(() => {
    let live = true
    if (stops.length < 2) { setState('error'); setError('Add at least two stops to make a reel.'); return undefined }
    if (!follow) { setState('ready'); return undefined }
    if (road) { setState('ready'); return undefined }
    setState('loading')
    getTripRoute(
      { lat: stops[0].lat, lng: stops[0].lng },
      stops.slice(1).map((p) => ({ lat: p.lat, lng: p.lng })),
      baseOf(vehicle),
    )
      .then((r) => {
        if (!live) return
        if (!r?.coordinates?.length) { setState('ready'); setFollow(false); setNote('No road route — using straight lines between stops.'); return }
        setRoad(r)
        setState('ready')
      })
      .catch(() => { if (live) { setFollow(false); setState('ready'); setNote('Could not fetch the road — using straight lines between stops.') } })
    return () => { live = false }
  }, [trip.id, trip.stops.length, follow, vehicle])

  useEffect(() => () => { if (video?.url) URL.revokeObjectURL(video.url) }, [video])

  const coordinates = follow && road?.coordinates?.length ? road.coordinates : directPath(stops)
  const totalDistance = follow && road ? road.distance : null

  async function make() {
    setState('rendering')
    setProgress(0)
    setError('')
    const controller = new AbortController()
    cancel.current = controller
    try {
      const { blob } = await renderRouteVideo({
        coordinates,
        stops: stops.map((p) => ({ name: p.name, lat: p.lat, lng: p.lng })),
        title: trip.title,
        when: when(trip),
        vehicle, modelSize,
        distance: totalDistance ?? 0,
        duration: follow && road ? road.duration : 0,
        shape, quality, seconds, style, pathStyle, pathColour, pathWidth, angle, view,
        showDistance, showLabels, labelSize, unit,
        signal: controller.signal,
        onProgress: setProgress,
      })
      setVideo({ url: URL.createObjectURL(blob), blob })
      setState('done')
      buzz('success')
    } catch (e) {
      if (/cancel/i.test(e?.message ?? '')) { setState('ready'); return }
      setState('error')
      setError(e?.message || 'The reel could not be made.')
    } finally {
      cancel.current = null
    }
  }

  // Named for the trip and the minute it was made, so a second reel doesn't
  // write over the first.
  const fileName = () => {
    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
    return `${trip.title.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'trekov-ride'}-${stamp}.mp4`
  }
  const say = (text, ms = 3200) => { setNote(text); if (text) setTimeout(() => setNote(''), ms) }

  async function saveToPhone() {
    if (!video) return
    const { result, where } = await saveVideo(video.blob, { name: fileName(), title: trip.title })
    say(result === 'saved' ? (where ? `Saved — ${where}` : 'Saved.')
      : result === 'cancelled' ? '' : 'Could not save the reel — try Share instead.', 5000)
  }

  async function send() {
    if (!video) return
    const result = await shareVideo(video.blob, { name: fileName(), title: trip.title })
    say(result === 'shared' ? 'Sent.' : result === 'saved' ? 'Saved.'
      : result === 'cancelled' ? '' : 'Could not share the reel — try Save instead.')
  }

  const pill = (on) => `min-h-9 rounded-full border px-3 text-xs font-semibold transition shrink-0 ${
    on ? 'border-brand bg-brand/15 text-brand' : 'border-line text-mist'}`
  const row = 'flex gap-2 overflow-x-auto no-bar pb-0.5'
  const heading = 'text-[11px] font-semibold text-mist tracking-wide uppercase mb-2'

  const TABS = [
    ['vehicle', 'Vehicle'],
    ['path', 'Path'],
    ['map', 'Map'],
    ['labels', 'Labels'],
    ['frame', 'Frame'],
  ]

  return (
    <div className="fixed inset-0 z-[1600] bg-ink/95 backdrop-blur-xl flex flex-col px-safe pt-safe">
      <header className="flex items-center gap-2 px-3 h-14 border-b border-line shrink-0">
        <button onClick={onClose} className="grid place-items-center size-10 -ml-1.5 text-mist hover:text-white" aria-label="Close">
          <CloseIcon size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight truncate">Route animator</p>
          <p className="text-xs text-mist truncate">{trip.title}</p>
        </div>
        <span className="text-[11px] font-semibold text-mist shrink-0">
          {quality === 'uhd' ? '4K' : '1080p'} · MP4
        </span>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5">
        {/* What they will get. */}
        <div className="mx-auto w-full max-w-[250px]">
          <div className={`relative rounded-2xl overflow-hidden border border-line bg-raised ${
            shape === 'reel' ? 'aspect-[9/16]' : shape === 'post' ? 'aspect-square' : 'aspect-video'}`}>
            {video ? (
              <video src={video.url} className="size-full object-cover" controls autoPlay loop playsInline />
            ) : (
              <div className="size-full grid place-items-center text-center px-4">
                {state === 'loading' && <p className="text-sm text-mist">Finding the road…</p>}
                {state === 'ready' && (
                  <div>
                    <div className="mx-auto w-fit" dangerouslySetInnerHTML={{ __html: spriteHtml(vehicle, { size: 74 }) }} />
                    <p className="text-sm font-semibold mt-1">{trip.title}</p>
                    <p className="text-xs text-mist mt-1">
                      {stops.length} stops{totalDistance ? ` · ${distanceIn(totalDistance, unit)}` : ''} · {seconds}s
                    </p>
                  </div>
                )}
                {state === 'rendering' && (
                  <div className="w-full px-5">
                    <p className="text-sm font-semibold">{Math.round(progress * 100)}%</p>
                    <div className="mt-2 h-1.5 rounded-full bg-line overflow-hidden">
                      <div className="h-full bg-brand transition-[width]" style={{ width: `${progress * 100}%` }} />
                    </div>
                    <p className="text-[11px] text-mist mt-2">Drawing your ride, frame by frame.</p>
                  </div>
                )}
                {state === 'error' && <p className="text-sm text-sun px-3">{error}</p>}
              </div>
            )}
          </div>
        </div>

        {!video && state !== 'rendering' && (
          <>
            {/* The first choice, so it sits above the tabs rather than in one. */}
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="View">
              {[
                ['2d', '2D', 'Flat map, from above'],
                ['3d', '3D', 'Tilted, hills and buildings'],
              ].map(([id, label, blurb]) => (
                <button key={id} role="radio" aria-checked={view === id} onClick={() => setView(id)}
                        className={`rounded-2xl border px-3 py-2 text-left transition
                                    ${view === id ? 'border-brand bg-brand/10' : 'border-line'}`}>
                  <span className={`block text-sm font-bold ${view === id ? 'text-brand' : ''}`}>{label}</span>
                  <span className="block text-[11px] text-mist">{blurb}</span>
                </button>
              ))}
            </div>
            <div className={row} role="tablist">
              {TABS.map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={pill(tab === id)}>
                  {label}
                </button>
              ))}
            </div>

            {tab === 'vehicle' && (
              <>
                <div>
                  <p className={heading}>Vehicle</p>
                  <div className="grid grid-cols-4 gap-2">
                    {MODELS.map((m) => (
                      <button key={m.id} onClick={() => setVehicle(m.id)} aria-pressed={vehicle === m.id}
                              className={`rounded-xl border p-1.5 flex flex-col items-center gap-0.5 transition ${
                                vehicle === m.id ? 'border-brand bg-brand/10' : 'border-line'}`}>
                        <span dangerouslySetInnerHTML={{ __html: spriteHtml(m.id, { size: 40 }) }} />
                        <span className="text-[10px] text-mist leading-tight text-center">{m.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <Choice label="Model size" value={modelSize} onChange={setModelSize} options={Object.keys(MODEL_SIZES)} pill={pill} row={row} heading={heading} />
              </>
            )}

            {tab === 'path' && (
              <>
                <div>
                  <p className={heading}>Line</p>
                  <div className={row}>
                    {Object.entries(PATH_STYLES).map(([id, s]) => (
                      <button key={id} onClick={() => setPathStyle(id)} aria-pressed={pathStyle === id} className={pill(pathStyle === id)}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                <Choice label="Thickness" value={pathWidth} onChange={setPathWidth} options={Object.keys(WIDTHS)} pill={pill} row={row} heading={heading} />
                <div>
                  <p className={heading}>Colour</p>
                  <div className={row}>
                    {PATH_COLOURS.map((c) => (
                      <button key={c.id} onClick={() => setPathColour(c.hex)} aria-label={c.id} aria-pressed={pathColour === c.hex}
                              className={`size-9 rounded-full shrink-0 border-2 transition ${
                                pathColour === c.hex ? 'border-white scale-110' : 'border-transparent'}`}
                              style={{ background: c.hex }} />
                    ))}
                  </div>
                </div>
                <Toggle label="Follow the road" hint="Off draws smooth curves between stops — and needs no signal."
                        on={follow} onChange={setFollow} />
              </>
            )}

            {tab === 'map' && (
              <>
                <div>
                  <p className={heading}>Map style</p>
                  <div className={row}>
                    {Object.entries(STYLES).map(([id, s]) => (
                      <button key={id} onClick={() => setStyle(id)} aria-pressed={style === id} className={pill(style === id)}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* A 2D reel looks straight down; the angle is a 3D choice. */}
                {view === '3d' && (
                  <Choice label="Camera angle" value={angle === 'flat' ? 'tilted' : angle} onChange={setAngle}
                          options={Object.keys(ANGLES).filter((a) => a !== 'flat')} pill={pill} row={row} heading={heading} />
                )}
              </>
            )}

            {tab === 'labels' && (
              <>
                <Toggle label="Place labels" hint="The name of each stop, pinned where it is on the map."
                        on={showLabels} onChange={setShowLabels} />
                {showLabels && (
                  <Choice label="Label size" value={labelSize} onChange={setLabelSize} options={Object.keys(LABEL_SIZES)} pill={pill} row={row} heading={heading} />
                )}
                <Toggle label="Distance counter" hint="Counts up as the line draws." on={showDistance} onChange={setShowDistance} />
                <Choice label="Units" value={unit} onChange={setUnit} options={['km', 'mi']} pill={pill} row={row} heading={heading} />
              </>
            )}

            {tab === 'frame' && (
              <>
                <div>
                  <p className={heading}>Shape</p>
                  <div className={row}>
                    {Object.entries(SHAPES).map(([id, s]) => (
                      <button key={id} onClick={() => setShape(id)} aria-pressed={shape === id} className={pill(shape === id)}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className={heading}>Resolution</p>
                  <div className={row}>
                    {[['hd', '1080p'], ['uhd', '4K']].map(([id, label]) => (
                      <button key={id} onClick={() => setQuality(id)} aria-pressed={quality === id} className={pill(quality === id)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {quality === 'uhd' && (
                    <p className="text-[11px] text-mist mt-2">
                      4K is four times the work — a 30-second reel can take several minutes on a phone.
                    </p>
                  )}
                </div>
                <div>
                  <p className={heading}>Length</p>
                  <div className={row}>
                    {LENGTHS.map((l) => (
                      <button key={l} onClick={() => setSeconds(l)} aria-pressed={seconds === l} className={pill(seconds === l)}>
                        {l}s
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-mist mt-2">
                    The whole ride fits the length you pick, so a shorter reel simply rides faster.
                  </p>
                </div>
              </>
            )}
          </>
        )}

        {note && <p className="text-xs text-brand" role="status">{note}</p>}
        {!canMakeMp4() && (
          <p className="text-xs text-sun">This device cannot make an MP4. Update the app or its browser.</p>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-3 pb-safe space-y-2">
        {state === 'rendering' ? (
          <button onClick={() => cancel.current?.abort()}
                  className="w-full min-h-12 rounded-2xl border border-line font-semibold text-mist">
            Stop
          </button>
        ) : video ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={saveToPhone} className="min-h-12 rounded-2xl bg-brand text-ink font-semibold">
                Save to phone
              </button>
              <button onClick={send} className="min-h-12 rounded-2xl border border-brand/60 text-brand font-semibold">
                Share…
              </button>
            </div>
            <button onClick={() => { URL.revokeObjectURL(video.url); setVideo(null); setState('ready') }}
                    className="w-full min-h-11 rounded-2xl border border-line text-sm font-semibold text-mist">
              Change something
            </button>
          </>
        ) : (
          <button onClick={make} disabled={state !== 'ready' || !canMakeMp4()}
                  className="w-full min-h-12 rounded-2xl bg-brand text-ink font-semibold disabled:opacity-40">
            {state === 'loading' ? 'Finding the road…' : 'Create the reel'}
          </button>
        )}
        <p className="text-[11px] text-mist text-center">Made on your phone · map © OpenStreetMap</p>
      </div>
    </div>
  )
}

/** One row of mutually exclusive choices. */
function Choice({ label, value, onChange, options, pill, row, heading }) {
  return (
    <div>
      <p className={heading}>{label}</p>
      <div className={row}>
        {options.map((o) => (
          <button key={o} onClick={() => onChange(o)} aria-pressed={value === o} className={pill(value === o)}>
            {o === 'km' ? 'Kilometres' : o === 'mi' ? 'Miles' : o[0].toUpperCase() + o.slice(1)}
          </button>
        ))}
      </div>
    </div>
  )
}

function Toggle({ label, hint, on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} aria-pressed={on}
            className="w-full flex items-start gap-3 text-left">
      <span className={`mt-0.5 w-11 h-6 rounded-full shrink-0 transition relative ${on ? 'bg-brand' : 'bg-line'}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-[11px] text-mist leading-snug mt-0.5">{hint}</span>}
      </span>
    </button>
  )
}
