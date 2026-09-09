import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addNotification, adoptPlace, getPlace, importTrip, meId, selectSavedPlaces, selectTrip,
  selectUnreadCount, useStore,
} from './lib/store'
import { decodeTripFromHash } from './lib/share'
import { currentAccount, hasSupabase, onAuthChange } from './lib/auth'
import { setAccount } from './lib/store'
import { stopWatching, syncNow, watchRemote } from './lib/sync'
import { NEW_PLACE, broadcastTransport } from './lib/notify'
import Composer from './components/Composer'
import Discover from './components/Discover'
import MapView from './components/MapView'
import Navigate from './components/Navigate'
import PlaceSheet from './components/PlaceSheet'
import Profile from './components/Profile'
import SharedTrip from './components/SharedTrip'
import TabBar from './components/TabBar'
import Trips from './components/Trips'

const TABS = ['map', 'discover', 'trips', 'profile']
const readHash = () => {
  const h = window.location.hash.replace('#', '')
  return TABS.includes(h) ? h : 'map'
}

export default function App() {
  const [tab, setTab] = useState(readHash)
  const [composing, setComposing] = useState(false)
  const [place, setPlace] = useState(null)
  const [openTrip, setOpenTrip] = useState(null)
  // { placeId, tripId? } while navigating.
  const [nav, setNav] = useState(null)
  // A trip that arrived over a share link, waiting to be accepted.
  const [incoming, setIncoming] = useState(() => decodeTripFromHash())

  const savedCount = useStore(selectSavedPlaces).length
  const unread = useStore(selectUnreadCount)
  const notifier = useRef(null)
  const profile = useStore((s) => s.profile)
  const navTrip = useStore((s) => (nav?.tripId ? selectTrip(s, nav.tripId) : null))

  // One identity per tab, so two tabs act as two travellers sharing a trip.
  // With a real backend this becomes the signed-in user's id.
  const account = useStore((s) => s.account)

  const me = useMemo(() => {
    let id = sessionStorage.getItem('trekov.memberId')
    if (!id) {
      id = `m_${Math.random().toString(36).slice(2, 9)}`
      sessionStorage.setItem('trekov.memberId', id)
    }
    // Companions are labelled by handle, not by the profile name — that
    // defaults to "You", so a whole group showed up on each other's maps as
    // "You". Signed out, a short id keeps two anonymous riders apart.
    const handle = account?.handle ?? profile.handle ?? 'traveller'
    return { id, name: account ? handle : `${handle}·${id.slice(-3)}` }
  }, [account, profile.handle])

  const startNavigation = (placeId, tripId) => { setPlace(null); setNav({ placeId, tripId }) }

  // Hash routing keeps the back button working and needs no server rewrites on
  // GitHub Pages.
  useEffect(() => {
    const sync = () => {
      const trip = decodeTripFromHash()
      if (trip) return setIncoming(trip)
      setTab(readHash())
    }
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  // Sign-in drives sync: pull what is on the server, push what is not, then
  // watch for other people's changes.
  useEffect(() => {
    if (!hasSupabase) return
    let live = true
    const apply = (account) => {
      if (!live) return
      setAccount(account)
      if (account) { syncNow(account.id); watchRemote(account.id) } else { stopWatching() }
    }
    currentAccount().then(apply)
    const off = onAuthChange(apply)
    return () => { live = false; off(); stopWatching() }
  }, [])

  // Announcements of new places. Cross-tab today; the same interface reaches
  // every user once there is a backend behind it.
  useEffect(() => {
    const transport = broadcastTransport()
    const leave = transport.join((msg) => {
      if (msg?.type !== NEW_PLACE || !msg.place) return
      adoptPlace(msg.place)
      addNotification(
        { id: msg.id, type: NEW_PLACE, placeId: msg.place.id, by: msg.by, at: msg.at },
        { incoming: true },
      )
    })
    notifier.current = transport
    return () => { leave(); notifier.current = null }
  }, [])

  function announcePlace(place, by) {
    const note = addNotification({ type: NEW_PLACE, placeId: place.id, by })
    notifier.current?.send({ type: NEW_PLACE, id: note.id, place, by, at: note.at })
  }

  function go(next) {
    if (next === 'post') return setComposing(true)
    window.location.hash = next
    setTab(next)
  }

  function acceptTrip() {
    // Land on the trip that just arrived, not on whatever was open before.
    setOpenTrip(importTrip(incoming))
    setIncoming(null)
    go('trips')
  }

  function dismissTrip() {
    setIncoming(null)
    go('map')
  }

  const screens = {
    map: <MapView onOpenPlace={setPlace} onNewPlace={(place) => place && announcePlace(place, meId)} />,
    discover: <Discover onOpenPlace={setPlace} onNavigate={startNavigation} />,
    trips: <Trips onOpenPlace={setPlace} open={openTrip} onOpen={setOpenTrip} onNavigate={startNavigation} />,
    profile: <Profile onPost={() => setComposing(true)} />,
  }

  return (
    <div className="h-full flex justify-center bg-black">
      <div className="relative tk-shell h-full flex flex-col bg-ink sm:border-x sm:border-line">
        {/* The map manages its own height; the other screens scroll. */}
        <main className={`flex-1 min-h-0 ${tab === 'map' ? '' : 'overflow-y-auto'}`}>
          {screens[tab]}
        </main>
        <TabBar tab={tab} onChange={go} savedCount={savedCount} unread={unread} />
      </div>

      {place && (
        <PlaceSheet placeId={place} onClose={() => setPlace(null)} onNavigate={startNavigation} />
      )}

      {nav && getPlace(nav.placeId) && (
        <Navigate
          place={getPlace(nav.placeId)}
          trip={navTrip}
          me={me}
          onClose={() => setNav(null)}
        />
      )}

      {composing && (
        <Composer
          onClose={() => setComposing(false)}
          onPosted={(placeId) => { setComposing(false); setPlace(placeId) }}
          onNewPlace={announcePlace}
        />
      )}

      {incoming && <SharedTrip trip={incoming} onAccept={acceptTrip} onDismiss={dismissTrip} />}
    </div>
  )
}
