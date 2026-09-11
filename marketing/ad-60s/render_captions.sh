#!/bin/sh
# Renders every caption in captions.html to assets/text/tNN.png (1080x1920,
# transparent) in a throwaway headless Chrome, stopping Chrome once each PNG lands.
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for k in t01 t02 t03 t04 t05 t06 t07 t08 t09 t10 t11 t12 t13; do
  PROFILE="${TMPDIR:-/tmp}/trekov-caption-profile"; OUT="$PWD/assets/text/$k.png"
  rm -rf "$PROFILE"; rm -f "$OUT"
  "$CHROME" --headless=new --hide-scrollbars --user-data-dir="$PROFILE" --window-size=1080,1920 \
    --force-device-scale-factor=1 --default-background-color=00000000 --virtual-time-budget=8000 \
    --screenshot="$OUT" "file://$PWD/captions.html#$k" >/dev/null 2>&1 &
  PID=$!
  i=0; while [ ! -s "$OUT" ] && [ $i -lt 30 ]; do sleep 1; i=$((i + 1)); done
  sleep 1; kill $PID 2>/dev/null; wait $PID 2>/dev/null
  rm -rf "$PROFILE"
  [ -s "$OUT" ] && echo "$k ok" || { echo "$k FAILED"; exit 1; }
done
