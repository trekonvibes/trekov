import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import UpdateNotice from './components/UpdateNotice'
import InstallBanner from './components/InstallBanner'
import { startLiveUpdates } from './lib/liveUpdate'
import { watchWebReleases } from './lib/webUpdate'
import { paintSystemBars } from './lib/native'
import { keepScreenOn } from './lib/wakeLock'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <InstallBanner />
    <UpdateNotice />
  </StrictMode>,
)

// Android/iOS apps: the system bars wear Trekov's ink, and new versions are
// fetched in the background.
paintSystemBars()
startLiveUpdates()
// Web app: pick up new releases even when the page has been open for days.
watchWebReleases()

// The screen stays on while the app is open and in front.
keepScreenOn()

// Offline support: the worker caches the app shell and serves downloaded map
// tiles. Registered after load so it never competes with first paint.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('Trekov: SW failed', e))
  })
}
