import { useEffect, useState } from 'react'
import { Logo } from './Icons'

// The camera step, shown once after location (App.jsx: sign-in → location →
// camera → app). Photos on Trekov are taken in the app, at the place itself,
// so this asks for the camera up front — but it can be skipped: store review
// rejects apps that force a permission before the feature needs it, and the
// camera screen (Camera.jsx) asks again when someone first takes a photo.

const DONE = 'trekov.cameraStep'
const isDone = () => { try { return localStorage.getItem(DONE) === '1' } catch { return false } }
const markDone = () => { try { localStorage.setItem(DONE, '1') } catch { /* ignore */ } }

async function cameraPermission() {
  try { return (await navigator.permissions?.query({ name: 'camera' }))?.state ?? null } catch { return null }
}

export default function CameraStep({ children }) {
  // checking | ask | asking | blocked | done
  const [state, setState] = useState(() => (isDone() || !navigator.mediaDevices?.getUserMedia ? 'done' : 'checking'))

  useEffect(() => {
    if (state !== 'checking') return
    cameraPermission().then((p) => {
      // Already allowed, or already refused (the camera screen explains how
      // to turn it on when it's needed): nothing to ask here.
      if (p === 'granted' || p === 'denied') { markDone(); setState('done') } else setState('ask')
    })
  }, [state])

  async function allow() {
    setState('asking')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      stream.getTracks().forEach((t) => t.stop())      // only asking — the camera goes straight off
      finish()
    } catch (e) {
      // No camera on this device: nothing to set up.
      if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return finish()
      markDone()
      setState('blocked')
    }
  }
  function finish() { markDone(); setState('done') }

  if (state === 'done') return children
  if (state === 'checking') return <div className="h-full bg-ink" />

  return (
    <div className="h-full flex justify-center bg-black">
      <div className="tk-shell h-full w-full flex flex-col bg-ink sm:border-x sm:border-line pt-safe px-safe">
        <div className="flex-1 overflow-y-auto">
          <div className="min-h-full flex flex-col justify-center px-6 py-10 max-w-md mx-auto w-full">
            <Logo size={40} />
            <h1 className="mt-6 text-2xl font-semibold leading-tight">
              {state === 'blocked' ? 'Camera is off for now' : 'Allow the camera'}
            </h1>
            {state === 'blocked' ? (
              <p className="mt-3 text-sm text-mist leading-relaxed">
                That's fine — everything else works. When you want to post a photo, Trekov will show you how to
                turn the camera on in your settings.
              </p>
            ) : (
              <p className="mt-3 text-sm text-mist leading-relaxed">
                Photos on Trekov are taken in the app, at the place itself — that's what shows a photo really was
                taken there. The camera is only used when you open it to take a photo.
              </p>
            )}
            {state === 'blocked' ? (
              <button onClick={finish}
                      className="mt-8 w-full min-h-12 rounded-full bg-brand text-ink py-3 text-sm font-semibold">
                Continue
              </button>
            ) : (
              <>
                <button onClick={allow} disabled={state === 'asking'}
                        className="mt-8 w-full min-h-12 rounded-full bg-brand text-ink py-3 text-sm font-semibold disabled:opacity-50">
                  {state === 'asking' ? 'Waiting for your phone…' : 'Allow camera'}
                </button>
                <button onClick={finish} disabled={state === 'asking'}
                        className="mt-2 w-full min-h-12 rounded-full text-sm font-semibold text-mist hover:text-white disabled:opacity-50">
                  Not now
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
