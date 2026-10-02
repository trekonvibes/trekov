#!/usr/bin/env bash
# Build the Android release.
#
#   ./scripts/android-release.sh          # .aab for Google Play
#   ./scripts/android-release.sh apk      # .apk to install or share directly
#
# Signed with the upload key when android/keystore.properties has its
# passwords (see NATIVE.md); otherwise the bundle is built unsigned, which is
# useful for checking the build but will be rejected by Play.
#
# Every upload to Play needs a higher versionCode (android/app/build.gradle).
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME="${JAVA_HOME_21:-/opt/homebrew/opt/openjdk@21}"
if [ ! -x "$JAVA_HOME/bin/java" ]; then
  echo "No JDK 21 at $JAVA_HOME — install it with: brew install openjdk@21" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
npm run build:native
npx cap sync android
cd android
WHAT="${1:-aab}"
# VITE_SIMULATE_NAV=1 makes a desk-testing build that drives the route by itself.
GRADLE_EXTRA=""
[ "${VITE_SIMULATE_NAV:-}" = "1" ] && GRADLE_EXTRA="-PtrekovSimulate"
if [ "$WHAT" = "apk" ]; then
  ./gradlew assembleRelease $GRADLE_EXTRA
  OUT="$PWD/app/build/outputs/apk/release/app-release.apk"
  [ -f "$OUT" ] || OUT="$PWD/app/build/outputs/apk/release/app-release-unsigned.apk"
else
  [ -n "$GRADLE_EXTRA" ] && { echo 'Refusing to build a Play bundle that can simulate driving.' >&2; exit 1; }
  ./gradlew bundleRelease
  OUT="$PWD/app/build/outputs/bundle/release/app-release.aab"
fi
AAB="$OUT"
echo
# apksigner, not `keytool -printcert -jarfile`: that only sees the old JAR
# signature, which modern builds (minSdk 24+) don't carry — so a properly
# signed APK was reported as unsigned (2026-09-12).
APKSIGNER="$(ls "$ANDROID_HOME"/build-tools/*/apksigner 2>/dev/null | tail -1)"
if [ "${AAB##*.}" = "apk" ] && [ -x "$APKSIGNER" ]; then
  if "$APKSIGNER" verify --print-certs "$AAB" >/dev/null 2>&1; then
    echo "Signed release build: $AAB"
    "$APKSIGNER" verify --print-certs "$AAB" | grep -E "certificate DN|certificate SHA-256" | head -2
  else
    echo "UNSIGNED release build (no upload key configured — see NATIVE.md): $AAB"
  fi
elif "$JAVA_HOME/bin/keytool" -printcert -jarfile "$AAB" 2>/dev/null | grep -q "Owner:"; then
  echo "Signed release build: $AAB"
  "$JAVA_HOME/bin/keytool" -printcert -jarfile "$AAB" | grep -E "Owner:|SHA256:" | head -2
else
  echo "UNSIGNED release build (no upload key configured — see NATIVE.md): $AAB"
fi

# Keep a copy of every release in the project, named by version.
VER="$(grep -m1 versionName ../android/app/build.gradle 2>/dev/null | sed -E 's/.*"(.*)".*/\1/')"
[ -n "$VER" ] || VER="$(grep -m1 versionName app/build.gradle | sed -E 's/.*"(.*)".*/\1/')"
mkdir -p ../releases
case "$AAB" in
  *.apk) cp "$AAB" "../releases/trekov-$VER-release.apk"; echo "Copied to releases/trekov-$VER-release.apk" ;;
  *.aab) cp "$AAB" "../releases/trekov-$VER-play.aab";    echo "Copied to releases/trekov-$VER-play.aab" ;;
esac
