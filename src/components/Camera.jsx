import { useEffect, useRef, useState } from 'react'
import { CameraIcon, CloseIcon } from './Icons'

/**
 * In-app capture. Photos must be taken here and now — a file input can always
 * reach the gallery, so there isn't one anywhere in the app.
 *
 * getUserMedia needs a secure context: fine on trekov.com and on localhost,
 * dead over plain http on a LAN address.
 */
export default function Camera({ onCapture, onCancel }) {
  const video = useRef(null)
  const stream = useRef(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [facing, setFacing] = useState('environment')

  useEffect(() => {
    let cancelled = false

    async function start() {
      setReady(false)
      stream.current?.getTracks().forEach((t) => t.stop())
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return }
        stream.current = s
        if (video.current) {
          video.current.srcObject = s
          await video.current.play().catch(() => {})
        }
        setReady(true)
      } catch (e) {
        if (cancelled) return
        setError(
          e.name === 'NotAllowedError' ? 'Camera permission denied. Allow it to post a photo.'
          : e.name === 'NotFoundError' ? 'No camera on this device.'
          : !window.isSecureContext ? 'The camera needs a secure connection (https).'
          : 'Could not start the camera.',
        )
      }
    }

    start()
    return () => { cancelled = true; stream.current?.getTracks().forEach((t) => t.stop()) }
  }, [facing])

  function shoot() {
    const v = video.current
    if (!v?.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    const ctx = canvas.getContext('2d')
    // A selfie preview is mirrored; un-mirror it so the saved photo matches
    // what the lens actually saw.
    if (facing === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1) }
    ctx.drawImage(v, 0, 0)
    canvas.toBlob(
      (blob) => blob && onCapture(new File([blob], `trekov-${Date.now()}.jpg`, { type: 'image/jpeg' })),
      'image/jpeg',
      0.9,
    )
  }

  return (
    <div className="fixed inset-0 z-[1500] bg-black flex justify-center" role="dialog" aria-label="Take a photo">
      <div className="tk-shell h-full flex flex-col bg-black">
        <header className="flex items-center justify-between px-4 h-14 shrink-0">
          <button onClick={onCancel} className="text-white/80 hover:text-white" aria-label="Cancel">
            <CloseIcon size={22} />
          </button>
          <span className="text-sm font-semibold text-white/90">Take a photo</span>
          <button onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
                  className="text-xs font-semibold text-white/80 hover:text-white" aria-label="Switch camera">
            Flip
          </button>
        </header>

        <div className="relative flex-1 min-h-0 bg-black">
          <video ref={video} playsInline muted
                 className={`absolute inset-0 size-full object-cover ${facing === 'user' ? 'scale-x-[-1]' : ''}`} />
          {!ready && !error && (
            <p className="absolute inset-0 grid place-items-center text-sm text-white/70">Starting camera…</p>
          )}
          {error && (
            <div className="absolute inset-0 grid place-items-center px-8 text-center">
              <div>
                <CameraIcon size={30} className="mx-auto text-white/50" />
                <p className="mt-3 text-sm text-white/85">{error}</p>
                <p className="mt-2 text-xs text-white/50">
                  Photos on Trekov are taken in the app, so there's no upload from your gallery.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 grid place-items-center py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <button onClick={shoot} disabled={!ready} aria-label="Capture"
                  className="size-16 rounded-full border-4 border-white/90 grid place-items-center
                             disabled:opacity-40 active:scale-95 transition">
            <span className="size-12 rounded-full bg-white" />
          </button>
        </div>
      </div>
    </div>
  )
}
