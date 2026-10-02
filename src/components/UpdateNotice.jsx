import { useSyncExternalStore } from 'react'
import { dismissRelease, nativeRelease, subscribeRelease } from '../lib/liveUpdate'
import { applyWebRelease, dismissWebRelease, subscribeWebRelease, webRelease } from '../lib/webUpdate'
import { CloseIcon } from './Icons'

/**
 * "A new version is out".
 *
 * Android/iOS app: for changes live updates can't carry (see lib/liveUpdate.js).
 * The link is on www.trekov.com on purpose: inside the app trekov.com itself is
 * served from the bundled files, while another host opens in the phone's
 * browser, which downloads the APK.
 *
 * Web app: a release came out while the app was open (see lib/webUpdate.js);
 * one tap reloads into it, whenever it suits the rider.
 */
export default function UpdateNotice() {
  const native = useSyncExternalStore(subscribeRelease, nativeRelease)
  const web = useSyncExternalStore(subscribeWebRelease, webRelease)
  if (!native && !web) return null
  return (
    <div className="fixed inset-x-0 top-0 z-[1500] flex justify-center pt-safe px-safe pointer-events-none">
      <div className="pointer-events-auto m-3 w-full max-w-md rounded-2xl border border-brand/40 bg-ink/95 backdrop-blur-xl shadow-xl
                      p-3 pl-4 flex items-center gap-2" role="status">
        <p className="flex-1 text-xs leading-relaxed">
          {native ? 'A new version of the Trekov app is out.' : 'A new version of Trekov is ready.'}
        </p>
        {native ? (
          <a href={native.url} className="rounded-full bg-brand text-ink px-3.5 py-2 text-xs font-semibold">Download</a>
        ) : (
          <button onClick={applyWebRelease} className="rounded-full bg-brand text-ink px-3.5 py-2 text-xs font-semibold">Refresh</button>
        )}
        <button onClick={native ? dismissRelease : dismissWebRelease} aria-label="Later"
                className="grid place-items-center size-10 text-mist hover:text-white">
          <CloseIcon size={16} />
        </button>
      </div>
    </div>
  )
}
