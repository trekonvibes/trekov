# Trekov

**trekov.com** (canonical) · trekov.in redirects to it

A map of places worth going. Zoom into anywhere, see what people actually shot
there, save the place to your To Visit list, and build a trip you can send to
whoever is coming with you.

The map is the feed. Photos live at the coordinates they were taken, not in a
chronological timeline.

## Two pages, one build

| Path | What it is |
|---|---|
| `/` | Marketing site (`index.html`, hand-written CSS, no framework) |
| `/app/` | The app (`app/index.html` → React + Leaflet) |

## What works today

| Screen | Behaviour |
|---|---|
| **Search** | Trekov's own places first, then anywhere in the world via the Geocoding API — a geocoded hit flies there and drops a pin, but only becomes a place once someone photographs it |
| **Solo / group trips** | A trip is one or the other. A group trip takes companions — invited by handle inside the app, or by a link sent over WhatsApp, Messages or email — and shares live position while everyone navigates |
| **Group trips** | Companions share live position over Supabase Realtime; each appears as their own vehicle, in their colour, pointing the way they are driving, with their name above it |
| **Multi-stop routing** | A trip routes through every remaining stop with per-leg distance, duration and arrival time |
| **Map** | Satellite map with a marker per place, thumbnail and photo count. Markers cluster at low zoom and split as you zoom in. Search flies to a place. |
| **Place sheet** | Tap a marker: blurb, best season, Maps link, the featured banner (newest photo, credited), every earlier photo beneath it, Save place, Add to trip |
| **Photo** | Full view with author, caption, tags, like and comments |
| **Trips** | Create a trip, add stops from the map, reorder them, per-stop notes, dates, trip notes, delete |
| **Share** | A trip encodes into a link. Opening it shows the itinerary and offers to save it — no backend, no account |
| **Discover** | Attraction of the month, most-visited ranking, recently-added places and the alert feed |
| **Reviews** | Rate a place on view, cleanliness, ease of access, safety and facilities, plus practical facts (best way in, food, water, camping) shown under every photo |
| **Trips** | Your To Visit shortlist, trips built from it, and the transport and stays for each |
| **Navigate** | In-app turn-by-turn to any place: live GPS, route line, next instruction, distance and ETA, off-route warning, and a bearing compass that works with no network |
| **Offline** | Service worker keeps the app openable with no connection; "Save map offline" caches satellite tiles along the route; routes are cached and replay offline |
| **Travelling together** | Everyone navigating the same trip sees each other live on the map with distance apart |
| **Post** | Take a photo in the app against an existing place, or a new one you pin on a map — yours takes the banner. There is no gallery or file upload anywhere |
| **You** | Your photos, counts, delete, reset demo data |

Records live in `localStorage`; uploaded media lives in IndexedDB (too large for
`localStorage`). Nothing leaves the device.

## Run it

```bash
npm install
npm run dev
```

## Deploy

```bash
npm run deploy
```

Builds and force-pushes `dist/` to the `gh-pages` branch, which GitHub Pages
serves. `public/CNAME` pins the custom domain to `trekov.com`.

GitHub Actions would be tidier, but pushing a workflow file needs the `workflow`
token scope. To switch later:

```bash
gh auth refresh -s workflow
```

then restore a `.github/workflows/deploy.yml` that runs `npm ci && npm run build`
and uploads `dist` as a Pages artifact.

### DNS

At GoDaddy, on `trekov.com`:

```
A     @     185.199.108.153
A     @     185.199.109.153
A     @     185.199.110.153
A     @     185.199.111.153
CNAME www   airotorac.github.io
```

`trekov.in` is a registrar-level forward to `https://trekov.com`, so the `.com`
is the only domain GitHub Pages serves.

## Architecture

```
index.html        marketing site
app/index.html    app entry
src/
  lib/store.js    all reads + writes, memoised selectors, useSyncExternalStore
  lib/media.js    IndexedDB blob storage for uploads
  lib/share.js    trip <-> link encoding
  lib/geo.js      tile maths, great-circle distance and bearing
  lib/route.js    OSRM routing with an offline cache
  lib/offline.js  satellite tile download into Cache Storage
  lib/party.js    live location sharing, pluggable transport
  lib/vehicleArt.js  car/bike SVG artwork as strings, eight colour presets
  lib/gmaps.js    Google Maps script loader
  lib/mapDrivers/ one interface, two engines: google.js, leaflet.js
  lib/seed.js     demo places, posts and users
  components/     MapView, PlaceSheet, PhotoViewer, Trips, TripDetail,
                  SharedTrip, Saved, Profile, Composer, PinMap, TabBar,
                  Navigate
```

**A place is the primary record**; posts hang off it, and both the saved list and
a trip's stops are just ordered lists of place ids. `store.js` is the only module
that touches storage, so a real backend (Supabase fits: Postgres + auth + object
storage) replaces that one file without touching a component.

Two implementation notes worth keeping:

- Selectors are memoised against state identity. They build new arrays, and
  `useSyncExternalStore` compares snapshots by identity — unmemoised, the app
  re-renders forever.
- Overlays render through `Portal`. The card entrance animation leaves a
  `transform` behind, which makes that element the containing block for
  `position: fixed` children and pins sheets to the card instead of the viewport.

## Photos: a banner worth taking, camera only

**The newest photo holds the place's banner**; everything shot there before it
stays, credited, in the list beneath. That is the competitive loop — the banner
is won by turning up more recently, not by deleting anyone's work. An earlier
build replaced the previous photo outright; keeping them costs a little storage
and is worth it, because a place with one photo has no history and nothing to
compete for.

Every photo carries **who took it and when** — handle, absolute timestamp and
relative age — because an undated photo of a place says nothing useful about
whether the road is open.

**Capture happens in the app.** `Camera.jsx` uses `getUserMedia` and paints a
frame to a canvas; there is no `<input type="file">` anywhere in the codebase,
which is the only way to actually rule out gallery uploads — `capture` on a
file input is a hint that desktop browsers ignore. This needs a secure context,
so it works on trekov.com and localhost but not over plain http on a LAN IP.
Front-camera captures are un-mirrored on the way to the canvas.

## Discovery, reviews and bookings

**Most visited** ranks by how many *different people* have photographed a
place. Photos can only be taken in the app, at the place, so a distinct
photographer is the nearest thing to a verified visit — far more honest than
counting saves, which are only intent.

**Attraction of the month** is the place with the most photos posted inside the
current calendar month, tie-broken on likes, falling back to the most
photographed overall when the month is still empty. Deterministic, and it
rotates on its own.

**New places** are announced through `lib/notify.js`, which has the same
pluggable transport as `party.js` and the same honest limit: BroadcastChannel
reaches other tabs on this machine, not other people's phones. A backend (or
web-push, for delivery when the app is closed) makes it real; nothing above
that layer changes.

**Reviews** are one per person per place, scored on five categories, plus
practical facts — best way in, food nearby, drinking water, camping. Facts are
single-choice, so a place's answer is simply what most people reported, shown
as "3 of 4 agree" rather than a bare yes.

**Bookings** record transport and stays against a trip and link out to each
provider's public search. There is deliberately **no live inventory and no
price we invented**: no partner APIs exist yet, so the app tracks what you
booked elsewhere. When partnerships land, `SEARCH` in `Bookings.jsx` becomes an
API call per provider and the rest of the component is unchanged.

## Nearby businesses, and how they are ranked

The Discover tab shows what is around you across seven categories, entered
through cards rather than a chip row: stays, restaurants, street food, bike,
car, rentals and other attractions. Two sources, deliberately ordered:

1. **Partner listings** from the `listings` table — businesses paying to be
   listed. Marked, and always first.
2. **Google Places** — so a category is never empty in a town nobody has
   signed up in yet.

That ordering *is* the product: the subscription buys placement above
commodity data, not the existence of a result. Nothing is ever invented; an
empty category shows as empty and says so.

`subscribed_until` is enforced in the read policy, so a lapsed listing stops
being served without anyone remembering to delete it. Billing state is
deliberately not writable by the business — `manage_own_listing` lets them
edit their details, not mark themselves paid or verified.

Search uses Places **Text Search**, not `includedTypes`: Google has no type for
"bike repair" or "street food stall", and those are exactly the categories a
travel app in India needs. Results are cached per category and rounded
location — Places is billed per request and costs more than Geocoding.

**This adds a third Google API.** If you restrict the key, the allowed list
must include Maps JavaScript, Directions, Geocoding *and* Places, or Discover
goes quiet.

## Supabase: accounts and sync

Set two env vars in `.env.local` and the app gains accounts, cross-device sync
and shared trips. Leave them out and it is exactly what it was — local-first,
offline-capable, no account. **That fallback is load-bearing**: offline
navigation and the tile cache depend on the app working with no network and no
session, so remote is a mirror of local, never a prerequisite.

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

### Setup

1. Create a project at [supabase.com](https://supabase.com) (free tier is plenty).
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**.
   It is idempotent, so re-running is safe.
3. **Project Settings → API** → copy the Project URL and the `anon` public key
   into `.env.local`. The anon key is meant to be public — row level security
   is what protects the data, which is why every table has policies.
4. **Authentication → URL Configuration** → add `https://trekov.com/app/` and
   `http://localhost:5173/app/` as redirect URLs, or magic links will bounce.

### What the schema does

Ids are `text`, not `uuid`, because the client generates them — a row created
offline keeps its id when it syncs. Public tables (places, posts, reviews) are
world-readable so the map is browsable without an account; writes are limited
to your own rows. **Saves are private** — a wishlist is nobody else's business.
Trips are visible to their owner and to invited companions via `trip_members`.
Photos go to a public `photos` bucket under `<user-id>/`, so nobody can write
into anyone else's folder.

### Sync model

`lib/sync.js` pushes what you own, pulls a snapshot, and merges. Anything of
yours not yet on the server survives the merge — a photo taken in a tunnel must
not vanish because the pull that followed did not include it. Conflicts are
last-write-wins per row, which is right for photos, reviews and a personal
trip; genuinely collaborative trip editing would need revisiting.

Sign-in is an emailed magic link. No password is ever typed into this app.

## Navigation, offline and live sharing

**Routing** prefers Google Directions (car: `DRIVING` with live-traffic ETA;
bike: `TWO_WHEELER`, falling back to a car route with an on-screen note where
Google does not offer it) and drops to the public OSRM demo server when there
is no Google key. OSRM's demo only carries the driving profile — it silently
returns the same route for every mode — and is not for production traffic.
Every route is cached, so one fetched with signal still guides you without.

**Vehicle** — car or bike, in eight colours, chosen on the navigation screen
and remembered. It is the rotating marker on the map. The artwork lives in
`src/lib/vehicleArt.js` as SVG strings so both map engines can use it; preview
every colour by copying `brand/render/vehicles.html` into `public/` while the
dev server runs (delete it before deploying).

**Offline** has two halves. `public/sw.js` caches the app shell so it opens with
no connection, and serves map tiles cache-first. "Save map offline" downloads
satellite tiles along the whole route at several zoom levels into Cache Storage.
With the radio off you keep: the app, the saved tiles, the cached route, your
GPS position, and the bearing compass. GPS itself needs no network.

**Live sharing** between people on one trip needs a server, and there isn't one
yet. `src/lib/party.js` defines the transport interface and ships a
`BroadcastChannel` implementation that genuinely works across tabs and windows
on one machine — enough to build and test the whole UI. Swapping in Supabase
Realtime is roughly fifteen lines; the shape is documented at the top of that
file. Until then, two people on two phones will **not** see each other.

## Maps: Google online, Leaflet offline

Every map goes through `src/lib/mapDrivers/`, which exposes one small interface
(`setView`, `htmlMarker`, `polyline`, `fitBounds`, `offsetLatLng`, …) with two
implementations:

- **Google Maps** (`google.js`) when `VITE_GOOGLE_MAPS_KEY` is set, the key is
  accepted, and the device is online. Brings live traffic, the roadmap /
  satellite / hybrid / terrain views, and Google Directions — including
  `TWO_WHEELER` routing for bikes where Google offers it (India does).
- **Leaflet + Esri imagery** (`leaflet.js`) otherwise. This is also the only
  engine that can run offline: Google's script cannot load without a network,
  and its terms forbid caching tiles, so "Save map offline" always downloads
  Esri tiles for this engine regardless of which one is on screen.

The choice is made per map in `createMap()`; screens never branch on engine
except to hide Google-only controls.

### Setting up Google Maps

1. In Google Cloud, enable **Maps JavaScript API** and **Directions API** on a
   project with billing attached (Google requires it even inside the free tier).
2. Create an API key. Restrict it — **Application restrictions → HTTP
   referrers**: `https://trekov.com/*`, `https://www.trekov.com/*`,
   `http://localhost:5173/*`; **API restrictions**: the two APIs above.
   An unrestricted key in a public repo is somebody else's bill on your card.
3. Put it in `.env.local` (gitignored):

   ```
   VITE_GOOGLE_MAPS_KEY=...
   VITE_GOOGLE_MAPS_MAP_ID=...   # optional, see 3D below
   ```

   Vite inlines it at build time, so it ships in the bundle — which is fine for
   a referrer-restricted browser key, and why the restriction matters.

**Map matching.** The vehicle is snapped to the nearest point on the route
(`snapToPath` in `lib/geo.js`, projecting onto each segment rather than to the
nearest vertex) whenever it is within 60 m. Consumer GPS is routinely tens of
metres out, which otherwise parks the vehicle in the buildings beside the road.
The snapped segment's own bearing also drives the heading — far steadier than
one derived from consecutive fixes. Past 150 m it stops pretending and warns
that you are off-route.

**3D view.** The navigation screen has a 2D/3D toggle that tilts the map to 45°
and rotates it to your heading (in 3D the vehicle stays pointing up the screen
and the map turns underneath; in 2D the map is north-up and the vehicle turns).

Verified: with only an API key Google serves *raster* tiles and the map stays
flat — `setTilt(45)` is accepted and `getTilt()` reads back 45, but nothing
renders, because raster tilt needs 45° aerial imagery that most cities lack.
Tilt and heading only render on vector maps. Create a **Map ID** (Google Cloud → Google Maps
Platform → Map management → Create Map ID, type **JavaScript**, rendering
**Vector**, with tilt and rotation enabled) and set `VITE_GOOGLE_MAPS_MAP_ID`.
The driver switches to vector rendering automatically and `supports3D()` starts
reporting true everywhere; without it, the toggle only appears on satellite and
hybrid, where raster tilt has a chance of working.

Without a key the app runs entirely on Leaflet, which is what the Leaflet
tests exercise.

Esri's keyless services provide the offline imagery — World Imagery for the
base, World Boundaries and Places for labels. Attribution is rendered on the
map. CARTO's dark basemap was tried first and watermarks "API KEY REQUIRED".

## Before this is real

- **Replace the demo imagery.** `seed.js` pulls neutral placeholder photos that do
  *not* depict the places named. Substitute your own aerial stills.
- **Backend.** Auth, a `places` / `posts` / `saves` / `trips` schema, object storage.
- **Share links are unsigned and public.** Anyone with the URL sees the itinerary.
- **Live sharing is single-device only** until a realtime backend is wired in.
- **Routing runs on OSRM's demo server** — fine for a prototype, not for traffic.
- **No voice guidance or automatic rerouting** — the route is fetched once per
  navigation session.
- **Video** uploads work, but there's no transcoding or thumbnailing.
- **Moderation and reporting** before any public launch.
- **Wire up the early-access form.** `index.html` has a `FORM_ENDPOINT` constant;
  until it's set the form hands off to the visitor's mail client.

## Brand

`brand/` holds the mark: a map pin whose negative space is a two-peak range —
the save and the trek in one shape.

- `mark.svg` — gradient, primary
- `mark-mono.svg` — single colour, inherits `currentColor`
- `app-icon.svg` — 512×512 rounded-square for the app stores
- `preview.html` — open in a browser to see every size and lockup

Brand green `#00C08B` (light `#3DDC97`, deep `#0E9F6E`), ink `#0B0F0E`,
accent sun `#FFB33E`. Wordmark is Outfit 600, tracking `-0.035em`, lowercase.

## Brand assets (rendered)

`brand/render/` holds the HTML sources; the PNGs are rendered from them with
headless Chrome so the Outfit wordmark rasterises with the real font:

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --window-size=1200,630 --virtual-time-budget=6000 \
  --screenshot=brand/og.png "file://$PWD/brand/render/og.html"
ffmpeg -y -i brand/og.png -q:v 3 public/og.jpg && cp brand/og.png public/og.png
```

- `brand/og.png` (1200×630) — social share card ("Ride together, live." over a
  frame of the ad's convoy b-roll, `brand/render/og-bg.jpg`). The pages point at
  `public/og.jpg`: WhatsApp drops preview images over ~300 KB, and the PNG is ~600 KB.
  A new file name also makes apps fetch the new card instead of a cached one.
- `brand/avatar-lockup.png` (512×512) — stacked lockup, for profile pictures
- `brand/avatar-mark.png` (512×512) — mark only; use this wherever the avatar
  renders below ~100px, where a wordmark turns to mush
- `public/icon-192.png` / `icon-512.png` — PWA icons, from `brand/app-icon.svg`

To eyeball the vehicle icons at several sizes, copy `brand/render/vehicles.html`
into `public/` while the dev server is running and open `/vehicles.html`; it
imports `src/lib/vehicleArt.js` directly. Delete it before deploying — it is a
dev aid, not part of the app.
