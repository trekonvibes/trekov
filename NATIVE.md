# Trekov on Android and iOS

The native apps are the same web app in a Capacitor shell — one codebase, no
rewrite. `npm run deploy` still ships the website; the commands below build
the apps.

## Build

    npm run android          # APK -> android/app/build/outputs/apk/debug/app-debug.apk
    npm run ios              # opens Xcode

Android needs **JDK 21**. The machine default is JDK 25 and Gradle rejects it
with "Unsupported class file major version 69", which reads like a corrupt
file rather than a version mismatch. `scripts/android.sh` pins it.

iOS needs **Xcode** from the App Store — Command Line Tools alone are not
enough, and that is the current state of this machine.

## Why the WebView pretends to be trekov.com

`capacitor.config.json` sets `server.hostname` to `trekov.com`. The Google
Maps key is restricted to that domain, so without it every map, route and
search would be refused inside the app. The alternative is separate native
keys restricted by package name and bundle id, which is tidier and worth doing
before release.

## What is not wired yet

The web build's service worker still handles offline tiles. Inside the app
there is no browser storage cap, so deliberate region download belongs here
rather than in the service worker.

Permissions are declared but only exercised on a device: camera capture and
microphone in particular go through the WebView rather than a Capacitor
plugin, and that path is worth testing early on both platforms.

## Publishing

Needs accounts I cannot create: Apple Developer ($99/yr) and Google Play
Console ($25 once). Signing keys are yours. Everything up to the upload —
icons, splash, version codes, release builds — is buildable here.
