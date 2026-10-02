#!/usr/bin/env bash
# Build the iPhone app for the App Store.
#
#   TEAM_ID=ABCDE12345 ./scripts/ios-release.sh          # archive + .ipa in releases/
#   TEAM_ID=ABCDE12345 ./scripts/ios-release.sh upload   # …and send it to App Store Connect
#
# Needs a paid Apple Developer Program team (the free "Personal Team" cannot
# publish), signed in once in Xcode → Settings → Accounts. TEAM_ID is on
# developer.apple.com → Account → Membership details. Signing is automatic:
# Xcode makes the distribution certificate and profile itself.
#
# Google's navigation needs ios/nav-key.xcconfig (not committed):
#   TREKOV_NAV_KEY = <the iOS-restricted key>
# Every upload needs a higher build number (CURRENT_PROJECT_VERSION in the
# Xcode project, kept equal to Android's versionCode).
set -euo pipefail

cd "$(dirname "$0")/.."
: "${TEAM_ID:?Set TEAM_ID to your Apple Developer team id}"
[ -f ios/nav-key.xcconfig ] || { echo "No ios/nav-key.xcconfig — Google navigation would be off in this build." >&2; exit 1; }
[ -z "${VITE_SIMULATE_NAV:-}${VITE_DEMO_RIDERS:-}" ] || { echo 'Refusing to build a store app with test simulation or demo riders.' >&2; exit 1; }

npm run build:native
npx cap sync ios

VER="$(grep -m1 'MARKETING_VERSION' ios/App/App.xcodeproj/project.pbxproj | sed -E 's/.*= (.*);/\1/')"
BUILD="$(grep -m1 'CURRENT_PROJECT_VERSION' ios/App/App.xcodeproj/project.pbxproj | sed -E 's/.*= (.*);/\1/')"
OUT="$PWD/releases/ios-$VER-$BUILD"
rm -rf "$OUT" && mkdir -p "$OUT"

xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/Trekov.xcarchive" \
  -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic archive

DEST=export
[ "${1:-}" = "upload" ] && DEST=upload
cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$DEST</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST

xcodebuild -exportArchive -archivePath "$OUT/Trekov.xcarchive" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" -exportPath "$OUT" -allowProvisioningUpdates

echo
if [ "$DEST" = upload ]; then
  echo "Uploaded Trekov $VER ($BUILD) — it appears in App Store Connect → TestFlight in 15-30 minutes."
else
  echo "Built $OUT/App.ipa — upload it with Xcode's Organizer or the Transporter app, or run again with 'upload'."
fi
