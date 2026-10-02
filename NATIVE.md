# Trekov on Android and iOS

The native apps are the same web app in a Capacitor shell — one codebase, no
rewrite. `npm run deploy` still ships the website; the commands below build
the apps.

## Build

    npm run android                    # debug APK -> android/app/build/outputs/apk/debug/app-debug.apk
    ./scripts/android-release.sh apk   # release APK, signed with the upload key
    ./scripts/android-release.sh       # .aab for Google Play
    npm run ios                        # opens Xcode

The debug APK installs on any phone with "install unknown apps" allowed, and is
the one to hand around for testing. The release APK is the same build signed
with your own key — that is what a phone outside Play should get, because every
later version has to be signed with the same key to install over it.

## The upload key (yours, not Trekov's)

It exists: `android-keys/trekov-upload.jks`, alias `trekov-upload`, created
2026-09-12 — with its own notes in `android-keys/README.md`. That folder,
`android/keystore.properties` and anything `*.jks` are git-ignored, because this
repo is public and the key is what proves an update really comes from Trekov.
**Back it up off this Mac**: without the key (and its password) no later build
can update an installed Trekov.

Certificate `CN=Trekov, O=Trekov, C=IN`, package `com.trekov.app`,
SHA-1 `1D:8B:90:57:19:1B:28:DE:A3:76:FB:3D:69:4F:24:61:AB:83:C0:DF` — that pair
is what a Google Maps *Android* key is restricted to, and what Play shows as
the upload certificate.

Builds land in `releases/` (git-ignored: `trekov-<version>-release.apk` and
`-play.aab`).

## Icons and the launch screen

`android/app/src/main/res` carries Trekov's own artwork, generated from
`brand/`: the green mark on ink as the launcher icon at every density, an
adaptive icon (mark in the foreground, ink `ic_launcher_background`), a
monochrome layer for Android 13 themed icons, and splash screens on ink for
every size. The app window, status bar and navigation bar are ink too
(`values/styles.xml`, `capacitor.config.json` `backgroundColor`), so opening it
never flashes white.

Android needs **JDK 21**. The machine default is JDK 25 and Gradle rejects it
with "Unsupported class file major version 69", which reads like a corrupt
file rather than a version mismatch. `scripts/android.sh` pins it.

iOS needs **Xcode** (26.6 here) *and* its iOS platform: the SDK ships with
Xcode but the simulator runtime does not, and until `xcodebuild -downloadPlatform
iOS` has run, every destination is rejected with "iOS 26.5 is not installed".

The iOS icon and launch image are their own renders — `brand/render/ios-icon.html`
and `ios-splash.html` — because App Store Connect refuses an icon with any
transparency, and `brand/app-icon.svg` bakes its rounded corners in. iOS rounds
the corners itself, so the icon it gets is a square, opaque 1024.

    xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator \
      -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build CODE_SIGNING_ALLOWED=NO

Building for a real device or TestFlight needs the Apple Developer Program and a
signing team set in Xcode.

## Why the WebView pretends to be trekov.com

`capacitor.config.json` sets `server.hostname` to `trekov.com`. The Google
Maps key is restricted to that domain, so without it every map, route and
search would be refused inside the app. The alternative is separate native
keys restricted by package name and bundle id, which is tidier and worth doing
before release.

## What the app does natively

One codebase still serves the website and both apps, but inside the app these
go through the phone rather than the web view (`src/lib/native.js`, and each is
a no-op in a browser, imported only when the app uses it):

- **Location** — `@capacitor/geolocation` asks with the system permission dialog
  and gives navigation a better fix (`lib/gps.js`: `getFix`, `watchFix`; the
  browser path is unchanged on the web).
- **Screen stays on** — `@capacitor-community/keep-awake`, instead of the Wake
  Lock API and the silent-video trick iPhones need on the web.
- **Back button** — Android's Back closes whatever is open and walks back to the
  map; it only leaves the app from there, so it can't drop a rider out of a live
  trip (`App.jsx`).
- **Haptics** — `@capacitor/haptics` on the STOP / WAIT / LET'S GO alerts and on
  push-to-talk, for gloved hands.
- **Share** — `@capacitor/share` opens the phone's share sheet for a trip link.
- **System bars** — `@capacitor/status-bar` paints them Trekov ink.

- **Trekov links open Trekov** — a trip invite shared in WhatsApp opens the app,
  not a browser tab (Android App Links: the `autoVerify` intent-filter in
  AndroidManifest.xml for `trekov.com/app/` and `/i/`, checked against
  `public/.well-known/assetlinks.json`, which carries this app's signing
  fingerprint; `public/.nojekyll` is what makes GitHub Pages serve that folder).
  `App.jsx` opens whatever the link points at.
- **Full screen while riding** — navigation hides the status bar and gives the
  map the whole screen.

Haptics adds the VIBRATE permission; nothing else new is requested.

**If you ever move to Play App Signing**, Google re-signs the app with its own
key, so add that certificate's SHA-256 to `assetlinks.json` as a second
fingerprint or the links stop opening the app.

**The map is still the web one.** `@capacitor/google-maps` draws a real native
map, but its markers are images only: no HTML, no name labels, no rotation. The
live group map is rotating vehicles with riders' names over them, so moving it
across would make the main feature worse. The Map tab could go native on its own
(pins and clusters rendered to images) — navigation needs a custom native layer
first. That also means an Android-restricted Maps key is not possible yet: the
Maps JavaScript API only supports website restrictions, which is why
`server.hostname` is trekov.com (below).

## What is not wired yet

The web build's service worker still handles offline tiles. Inside the app
there is no browser storage cap, so deliberate region download belongs here
rather than in the service worker.

Permissions are declared but only exercised on a device: camera capture and
microphone in particular go through the WebView rather than a Capacitor
plugin, and that path is worth testing early on both platforms.

## Store rules already built in

- **Account deletion** is in the app (You → account → Delete account) and on
  the web at `https://trekov.com/app/?delete-account` — the URL Google Play's
  Data safety form asks for. It is confirmed by email: the app sends a sign-in
  link, and `supabase/functions/delete-account` refuses unless the session
  came from an emailed link in the last 15 minutes (the token's `amr` claim).
- **No plan sales in the apps.** Both stores require their own billing for
  digital purchases, so `src/lib/platform.js` (`isNativeApp`) hides every price
  and pay button, and the apps don't say where to buy. Before the paywall is
  switched on, the apps need Apple In-App Purchase / Google Play Billing.
- **No background modes.** The app only uses location while it is open, so
  iOS asks "while using" only (no UIBackgroundModes) and Android declares no
  foreground service. Adding either back invites review questions.
- **iPhone only** (TARGETED_DEVICE_FAMILY = 1), so no iPad screenshots are
  needed. Landscape is supported on iPhone.

## Live updates

The apps update their web code by themselves: `./deploy.sh` also publishes
`https://trekov.com/updates/latest.json` and a zip of the app
(`scripts/build-update.mjs`), and `src/lib/liveUpdate.js` downloads it in the
background with `@capgo/capacitor-updater` (manual mode, self-hosted, no
Capgo account) and switches over the next time the app opens. A bundle that
fails to start is rolled back automatically (`notifyAppReady`).

Native changes — plugins, permissions, Info.plist, AndroidManifest — cannot
travel this way. Bump `versionName`/`versionCode` (and the iOS version), ship
the new app, and only then raise `NATIVE_MIN` in build-update.mjs if the web
code depends on it. Android users of the website download see a "new version
of the app" notice when `versionName` is ahead of theirs.

## Location is required

`src/components/LocationGate.jsx` keeps the app on a welcome screen until
location is allowed and switched on. The camera is asked for only when a photo
is taken (Camera.jsx) — demanding it up front gets apps rejected.

## Google Play release signing

The upload key is created and kept by the app's owner — never by an
assistant, and never committed:

    mkdir -p ~/.android-keys
    keytool -genkeypair -v -keystore ~/.android-keys/trekov-upload.jks \
      -alias trekov-upload -keyalg RSA -keysize 2048 -validity 10000 \
      -dname "CN=Trekov, O=Trekov, C=IN"

Then put the password you chose into `android/keystore.properties`
(`storePassword` and `keyPassword`, the same value; the file is git-ignored)
and build:

    ./scripts/android-release.sh   # -> android/app/build/outputs/bundle/release/app-release.aab

Enrol in **Play App Signing** when creating the app: Google keeps the key
that signs what users install, and this one is only the *upload* key — if it
is lost, Play support can reset it. Back up the .jks and the password anyway,
somewhere other than this Mac. Bump `versionCode` in android/app/build.gradle
for every upload.

## Publishing

Needs accounts I cannot create: Apple Developer ($99/yr) and Google Play
Console ($25 once). Signing keys are yours. Everything up to the upload —
icons, splash, version codes, release builds — is buildable here.
