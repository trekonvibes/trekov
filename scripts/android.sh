#!/usr/bin/env bash
# Build the Android app.
#
# JAVA_HOME is pinned because the machine's default is JDK 25 and Gradle
# rejects it — "Unsupported class file major version 69", which reads like a
# corrupt file rather than a version mismatch. JDK 21 is the newest that the
# Android Gradle Plugin supports.
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
./gradlew "${1:-assembleDebug}"

echo
echo "APK: android/app/build/outputs/apk/debug/app-debug.apk"
