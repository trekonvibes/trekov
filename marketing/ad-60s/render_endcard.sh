#!/bin/sh
# Renders endcard.html to assets/text/endcard.png at 1080x1920 in a separate
# headless Chrome (throwaway profile), so the card uses the real logo and Outfit.
# Headless Chrome can linger after writing the screenshot, so it is stopped as
# soon as the file lands (or after 30 s).
cd "$(dirname "$0")"
PROFILE="${TMPDIR:-/tmp}/trekov-endcard-profile"; OUT="$PWD/assets/text/endcard.png"
rm -rf "$PROFILE"; rm -f "$OUT"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --user-data-dir="$PROFILE" --window-size=1080,1920 --force-device-scale-factor=1 \
  --virtual-time-budget=8000 --screenshot="$OUT" "file://$PWD/endcard.html" >/dev/null 2>&1 &
PID=$!
i=0; while [ ! -s "$OUT" ] && [ $i -lt 30 ]; do sleep 1; i=$((i + 1)); done
sleep 1; kill $PID 2>/dev/null; wait $PID 2>/dev/null
rm -rf "$PROFILE"
[ -s "$OUT" ] && sips -g pixelWidth -g pixelHeight "$OUT" | tail -2 || { echo "render failed"; exit 1; }
