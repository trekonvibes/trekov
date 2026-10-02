import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import {
  addNotification, adoptPlace, getPlace, importTrip, meId, selectSavedPlaces, selectTrip,
  selectUnreadCount, useStore,
} from './lib/store'
import { decodeTripFromHash, fetchTripByCode, tripCodeFromHash } from './lib/share'
import { currentAccount, hasSupabase, onAuthChange, signOutHere } from './lib/auth'
import { checkDevice, claimThisDevice, refreshMembership, watchDevice } from './lib/membership'
import { getState, setAccount } from './lib/store'
import { joinRequestCount, stopWatching, syncNow, watchRemote } from './lib/sync'
import { NEW_PLACE, broadcastTransport } from './lib/notify'
import { onBackButton, onDeepLink, popBackLayer } from './lib/native'
import { startPush, stopPush } from './lib/push'
import AuthScreen from './components/AuthScreen'
import LocationGate from './components/LocationGate'
import CameraStep from './components/CameraStep'
import Business from './components/Business'
import Plans from './components/Plans'
import Composer from './components/Composer'
import Discover from './components/Discover'
import MapView from './components/MapView'
import Navigate from './components/Navigate'
import PlaceSheet from './components/PlaceSheet'
import Profile from './components/Profile'
import SharedTrip from './components/SharedTrip'
import TabBar from './components/TabBar'
import Trips from './components/Trips'
// Only admins open it, so nobody else downloads it.
const Admin = lazy(() => import('./components/Admin'))

const TABS = ['map', 'discover', 'trips', 'profile']

// Read before the Supabase client tidies the URL: an email link lands here
// with the session (or the reason it failed) after the '#'.
const arrival = new URLSearchParams(window.location.hash.slice(1))
const CAME_FROM_LINK = arrival.has('access_token')
const LINK_ERROR = arrival.get('error_description')?.replace(/\+/g, ' ') || ''
// A fresh sign-in (password, sign-up or an email link) takes the account over
// from any other device; a saved session only checks.
let linkTakeover = CAME_FROM_LINK
const takeOver = () => {
  const t = linkTakeover || sessionStorage.getItem('trekov.takeover') === '1'
  linkTakeover = false
  sessionStorage.removeItem('trekov.takeover')
  return t
}
// The landing page's Sign up / Sign in buttons open /app/?auth=signup|signin.
const askedFor = new URLSearchParams(window.location.search).get('auth')
// trekov.com/app/?delete-account — the account-deletion link the stores ask for.
const WANTS_DELETE = new URLSearchParams(window.location.search).has('delete-account')
const INITIAL_AUTH = LINK_ERROR ? 'signin' : (askedFor === 'signup' || askedFor === 'signin' ? askedFor : null)
// The app requires an account (Punit, 2026-09-11). First visit: create one;
// anyone who has signed in on this device before: sign in.
const SIGNED_IN_BEFORE = 'trekov.hasSignedIn'
const defaultAuth = () => { try { return localStorage.getItem(SIGNED_IN_BEFORE) ? 'signin' : 'signup' } catch { return 'signup' } }
const readHash = () => {
  const h = window.location.hash.replace('#', '')
  // trekov.com/app/#business opens the free business listing over Discover.
  if (h === 'business') return 'discover'
  // trekov.com/app/#admin opens the admin screen over the You tab.
  if (h === 'admin') return 'profile'
  return TABS.includes(h) ? h : 'map'
}
const wantsBusiness = () => window.location.hash === '#business'
const wantsAdmin = () => window.location.hash === '#admin'

export default function App() {
  const [tab, setTab] = useState(() => (WANTS_DELETE ? 'profile' : readHash()))
  const [composing, setComposing] = useState(false)
  const [authMode, setAuthMode] = useState(INITIAL_AUTH)
  // Bumped to open Trips on the new-group-trip form.
  const [newGroup, setNewGroup] = useState(0)
  const [place, setPlace] = useState(null)
  const [openTrip, setOpenTrip] = useState(null)
  // { placeId, tripId? } while navigating.
  const [nav, setNav] = useState(null)
  // A trip that arrived over a share link, waiting to be accepted.
  const [incoming, setIncoming] = useState(() => decodeTripFromHash())
  const [business, setBusiness] = useState(wantsBusiness)
  const [adminOpen, setAdminOpen] = useState(wantsAdmin)
  const [plans, setPlans] = useState(null)
  const [notice, setNotice] = useState('')
  // Until the saved session has been read, show nothing rather than a flash of either screen.
  const [authReady, setAuthReady] = useState(!hasSupabase)

  const savedCount = useStore(selectSavedPlaces).length
  const unread = useStore(selectUnreadCount)
  // Riders waiting to be let onto a trip this account hosts, for the Trips badge.
  const [requests, setRequests] = useState(0)
  const notifier = useRef(null)
  const profile = useStore((s) => s.profile)
  const navTrip = useStore((s) => (nav?.tripId ? selectTrip(s, nav.tripId) : null))

  // One identity per tab, so two tabs act as two travellers sharing a trip.
  // With a real backend this becomes the signed-in user's id.
  const account = useStore((s) => s.account)
  useEffect(() => { if (account) setAuthMode(null) }, [account])

  // Checked on opening and every half minute the app is in front; the push
  // notification is what reaches the host when it isn't.
  useEffect(() => {
    if (!account) { setRequests(0); return }
    let live = true
    const check = () => { if (!document.hidden) joinRequestCount().then((n) => live && setRequests(n)) }
    check()
    const timer = setInterval(check, 30_000)
    document.addEventListener('visibilitychange', check)
    return () => { live = false; clearInterval(timer); document.removeEventListener('visibilitychange', check) }
  }, [account?.id])

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
    return account ? { id: account.id, name: handle } : { id, name: `${handle}·${id.slice(-3)}` }
  }, [account, profile.handle])

  // A group trip is one route for everyone: every rider follows its stops from
  // the first, whichever stop they tapped. Otherwise riders on the same trip get
  // different routes — and different traffic (seen 2026-09-11: one phone going
  // via Amritsar, the other straight to Manali). A solo trip starts where you choose.
  const startNavigation = (placeId, tripId) => {
    const trip = tripId ? selectTrip(getState(), tripId) : null
    const group = trip && (trip.kind === 'group' || trip.members?.length > 0 || (trip.ownerId && trip.ownerId !== account?.id))
    setPlace(null)
    setNav({ placeId: group && trip.stops?.[0] ? trip.stops[0].placeId : placeId, tripId })
  }

  // Hash routing keeps the back button working and needs no server rewrites on
  // GitHub Pages.
  useEffect(() => {
    let current = 0
    // A short link's trip lives on the server: fetch it, and ignore the answer
    // if the hash has moved on by the time it arrives.
    const resolveCode = (code) => {
      const mine = ++current
      fetchTripByCode(code).then((trip) => {
        if (mine !== current) return
        if (trip) setIncoming(trip)
        else setNotice('That trip link did not open — ask whoever sent it to share it again.')
      })
    }
    const sync = () => {
      const trip = decodeTripFromHash()
      if (trip) return setIncoming(trip)
      const code = tripCodeFromHash()
      if (code) return resolveCode(code)
      setBusiness(wantsBusiness())
      setAdminOpen(wantsAdmin())
      setTab(readHash())
    }
    // Arriving on a short link, straight from /i/ or a tapped invite.
    const code = tripCodeFromHash()
    if (code) resolveCode(code)
    window.addEventListener('hashchange', sync)
    return () => { current++; window.removeEventListener('hashchange', sync) }
  }, [])

  // Android's back button belongs to the app: it closes whatever is open and
  // walks back to the map, and only leaves from there — dropping a rider out of
  // a live trip because they tapped Back would be its own bug (lib/native.js).
  useEffect(() => onBackButton(() => {
    if (popBackLayer()) return 'closed'
    if (incoming) { setIncoming(null); return 'closed' }
    if (plans) { setPlans(null); return 'closed' }
    if (composing) { setComposing(false); return 'closed' }
    if (nav) { setNav(null); return 'closed' }
    if (place) { setPlace(null); return 'closed' }
    if (adminOpen) { closeAdmin(); return 'closed' }
    if (business) { closeBusiness(); return 'closed' }
    if (tab === 'trips' && openTrip) { setOpenTrip(null); return 'closed' }
    if (tab !== 'map') { go('map'); return 'closed' }
    return 'exit'
  }), [incoming, plans, composing, nav, place, adminOpen, business, tab, openTrip])

  // A Trekov link tapped in another app opens what it points at — a shared
  // trip, the trips tab — instead of dropping the rider on the map.
  useEffect(() => onDeepLink((url) => {
    try {
      const { hash } = new URL(url)
      if (hash) window.location.hash = hash.replace(/^#/, '')
    } catch { /* not a link we can read */ }
  }), [])

  // Sign-in drives sync: pull what is on the server, push what is not, then
  // watch for other people's changes.
  useEffect(() => {
    if (!hasSupabase) return
    let live = true
    let unwatch = () => {}
    // Another device signed in: sign out here and say why.
    const replaced = async () => {
      unwatch(); unwatch = () => {}
      await signOutHere()
      setNotice('You were signed out here because your account signed in on another device. Trekov allows one device at a time.')
      setAuthMode('signin')
    }
    const apply = async (account) => {
      if (!live) return
      setAccount(account)
      setAuthReady(true)
      if (account) { try { localStorage.setItem(SIGNED_IN_BEFORE, '1') } catch { /* ignore */ } }
      unwatch(); unwatch = () => {}
      if (!account) { stopWatching(); stopPush(); refreshMembership(); return }
      if (takeOver()) await claimThisDevice()
      else if (await checkDevice() === 'replaced') return replaced()
      unwatch = watchDevice(replaced)
      // Account features need a plan once the paywall is on; the phone keeps working either way.
      const m = await refreshMembership()
      if (m.isMember) { syncNow(account.id); watchRemote(account.id) }
      // The phone becomes reachable when Trekov is closed: an alert or an
      // invite can still find the rider (lib/push.js; apps only).
      startPush((tripId) => { setOpenTrip(tripId); go('trips') })
      // Straight from the email link: show them the account they just signed in to.
      if (CAME_FROM_LINK) go('profile')
    }
    // Drop ?auth= so a refresh doesn't reopen the sign-in screen.
    if (askedFor) window.history.replaceState(null, '', window.location.pathname + window.location.hash)
    currentAccount().then(apply)
    const off = onAuthChange(apply)
    return () => { live = false; off(); stopWatching(); unwatch() }
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

  // Opening puts #business in the address, so the phone's Back button closes it
  // and returns to the tab it was opened from.
  const cameFrom = useRef('discover')
  const openBusiness = () => { cameFrom.current = tab; window.location.hash = 'business' }
  const closeBusiness = () => { setBusiness(false); go(cameFrom.current) }
  // Same for admin: #admin in the address, Back closes it.
  const openAdmin = () => { window.location.hash = 'admin' }
  const closeAdmin = () => { setAdminOpen(false); go('profile') }

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
    map: <MapView onOpenPlace={setPlace} onNavigate={startNavigation} onNewPlace={(place) => place && announcePlace(place, meId)}
                  onGoLive={(trip) => trip.stops[0] && startNavigation(trip.stops[0].placeId, trip.id)}
                  onOpenTrip={(id) => { setOpenTrip(id); go('trips') }}
                  onStartGroup={() => { setOpenTrip(null); go('trips'); setNewGroup((n) => n + 1) }} />,
    discover: <Discover onOpenPlace={setPlace} onNavigate={startNavigation} onListBusiness={openBusiness} />,
    trips: <Trips onOpenPlace={setPlace} open={openTrip} onOpen={setOpenTrip} onNavigate={startNavigation} newGroup={newGroup} />,
    profile: <Profile onPost={() => setComposing(true)} onAuth={setAuthMode} onListBusiness={openBusiness} onPlans={setPlans}
                      onAdmin={openAdmin} />,
  }

  // Nothing in the app is available before signing in. Builds without an
  // account server (hasSupabase false) stay local-only and open directly.
  if (hasSupabase && !authReady) return <div className="h-full bg-ink" />
  if (hasSupabase && !account) {
    return (
      <AuthScreen required mode={authMode ?? defaultAuth()} notice={notice} linkError={LINK_ERROR}
                  onModeChange={setAuthMode} />
    )
  }

  // Signed in: location next (LocationGate), then the camera step, then the app.
  return (
    <LocationGate>
      <CameraStep>
        <div className="h-full flex justify-center bg-black">
          {/* The map runs up under the status bar and pads its own overlay; the
              other screens start below it. */}
          <div className={`relative tk-shell h-full flex flex-col bg-ink sm:border-x sm:border-line px-safe
                           ${tab === 'map' ? '' : 'pt-safe'}`}>
            {/* The map manages its own height; the other screens scroll. */}
            <main className={`flex-1 min-h-0 ${tab === 'map' ? '' : 'overflow-y-auto'}`}>
              {screens[tab]}
            </main>
            <TabBar tab={tab} onChange={go} savedCount={savedCount} unread={unread} requests={requests} />
          </div>

          {place && (
            <PlaceSheet placeId={place} onClose={() => setPlace(null)} onNavigate={startNavigation}
                        onPost={() => { setPlace(null); setComposing(true) }} />
          )}

          {nav && getPlace(nav.placeId) && (
            <Navigate
              place={getPlace(nav.placeId)}
              trip={navTrip}
              me={me}
              onClose={() => setNav(null)}
              onPlans={setPlans}
            />
          )}

          {composing && (
            <Composer
              onClose={() => setComposing(false)}
              onPosted={(placeId) => { setComposing(false); setPlace(placeId) }}
              onNewPlace={announcePlace}
              onPlans={setPlans}
            />
          )}

          {business && <Business onClose={closeBusiness} onAuth={setAuthMode} onPlans={setPlans} />}

          {adminOpen && (
            <Suspense fallback={<div className="fixed inset-0 z-[1200] bg-ink" />}>
              <Admin onClose={closeAdmin} />
            </Suspense>
          )}

          {plans && <Plans initial={plans} onClose={() => setPlans(null)} onAuth={setAuthMode} />}

          {authMode && !account && (
            <AuthScreen mode={authMode} notice={notice} linkError={LINK_ERROR} onModeChange={setAuthMode} onClose={() => setAuthMode(null)} />
          )}

          {incoming && <SharedTrip trip={incoming} onAccept={acceptTrip} onDismiss={dismissTrip} />}
        </div>
      </CameraStep>
    </LocationGate>
  )
}
