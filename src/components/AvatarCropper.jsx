import { useEffect, useRef, useState } from 'react'
import { AVATAR_PX, renderAvatar } from '../lib/profile'
import Portal from './Portal'

/** Viewport side in CSS pixels. The crop is always square. */
const BOX = 264
const MAX_ZOOM = 4

/**
 * Position a photo inside the avatar circle before it is saved.
 *
 * A centre crop is right often enough to be the default but wrong often
 * enough to need overriding — faces are rarely in the middle of a photo, and
 * a portrait held sideways loses whoever is in it. Drag to move, slider or
 * wheel to zoom.
 *
 * The preview and the final render share one transform, so what is inside the
 * circle is exactly what gets saved.
 */
export default function AvatarCropper({ file, onCancel, onDone }) {
  const [img, setImg] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [error, setError] = useState('')
  const drag = useRef(null)

  useEffect(() => {
    // Revoking on cleanup aborts a load still in flight, and under StrictMode
    // the first, discarded pass would then report a failure the real load has
    // already recovered from. Only the live pass may set state.
    let live = true
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => { if (live) { setImg(image); setError('') } }
    image.onerror = () => {
      // Phones hand over formats the canvas cannot decode, HEIC most often,
      // with no warning until the decode fails.
      if (live) setError('That image could not be read. Try another, or take a photo.')
    }
    image.src = url
    return () => { live = false; URL.revokeObjectURL(url) }
  }, [file])

  // Smallest scale that still fills the square — the floor for zooming out,
  // so the circle can never show empty corners.
  const cover = img ? Math.max(BOX / img.width, BOX / img.height) : 1
  const scale = cover * zoom
  const shownW = img ? img.width * scale : 0
  const shownH = img ? img.height * scale : 0

  /** Keep the photo covering the square, whatever the drag or zoom did. */
  const clamp = (p, w = shownW, h = shownH) => ({
    x: Math.min(0, Math.max(BOX - w, p.x)),
    y: Math.min(0, Math.max(BOX - h, p.y)),
  })

  // Recentre when the image or zoom changes, keeping the middle of the crop
  // fixed so zooming does not walk the subject out of frame.
  useEffect(() => {
    if (!img) return
    setPos((p) => {
      const w = img.width * cover * zoom
      const h = img.height * cover * zoom
      return clamp(p, w, h)
    })
  }, [img, zoom]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (img) setPos(clamp({ x: (BOX - shownW) / 2, y: (BOX - shownH) / 2 }))
  }, [img]) // eslint-disable-line react-hooks/exhaustive-deps

  function down(e) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
  }
  function move(e) {
    if (!drag.current) return
    setPos(clamp({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }))
  }
  const up = () => { drag.current = null }

  function wheel(e) {
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(1, z - e.deltaY * 0.002)))
  }

  function done() {
    // Viewport coordinates back to source pixels: the crop is the BOX-sized
    // window over the scaled image, so dividing by the scale lands on it.
    onDone(renderAvatar(img, {
      sx: -pos.x / scale,
      sy: -pos.y / scale,
      size: BOX / scale,
    }))
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[1300] flex items-center justify-center p-5"
           role="dialog" aria-label="Position your photo">
        <button className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onCancel} aria-label="Cancel" />

        <div className="relative w-full max-w-[340px] rounded-3xl border border-line bg-ink p-5">
          <h2 className="font-semibold mb-1">Position your photo</h2>
          <p className="text-[11px] text-mist mb-4">Drag to move, slide to zoom.</p>

          {error ? (
            <p className="text-sm text-sun leading-relaxed py-8">{error}</p>
          ) : (
            <>
              <div className="relative mx-auto overflow-hidden rounded-2xl bg-raised touch-none select-none
                              cursor-grab active:cursor-grabbing"
                   style={{ width: BOX, height: BOX, maxWidth: '100%' }}
                   onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
                   onWheel={wheel}>
                {img && (
                  <img src={img.src} alt="" draggable={false}
                       style={{
                         position: 'absolute',
                         left: pos.x, top: pos.y, width: shownW, height: shownH,
                         maxWidth: 'none',
                       }} />
                )}
                {/* The circle is a mask, not a border: everything outside it is
                    dimmed so the saved area is obvious without hiding context. */}
                <div className="pointer-events-none absolute inset-0"
                     style={{
                       background: 'rgba(11,15,14,.62)',
                       WebkitMaskImage: 'radial-gradient(circle at 50% 50%, transparent 49.5%, #000 50%)',
                       maskImage: 'radial-gradient(circle at 50% 50%, transparent 49.5%, #000 50%)',
                     }} />
                <div className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-white/25" />
              </div>

              <label className="flex items-center gap-3 mt-4">
                <span className="text-[10px] uppercase tracking-[0.14em] text-mist">Zoom</span>
                <input type="range" min="1" max={MAX_ZOOM} step="0.01" value={zoom}
                       onChange={(e) => setZoom(Number(e.target.value))}
                       className="flex-1 accent-brand" aria-label="Zoom" />
              </label>
            </>
          )}

          <div className="flex gap-2 mt-5">
            <button onClick={onCancel}
                    className="flex-1 rounded-full border border-line py-2.5 text-sm font-semibold">
              Cancel
            </button>
            <button onClick={done} disabled={!img}
                    className="flex-1 rounded-full bg-brand text-ink py-2.5 text-sm font-semibold disabled:opacity-40">
              Use photo
            </button>
          </div>
        </div>
      </div>
    </Portal>
  )
}

export { AVATAR_PX }
