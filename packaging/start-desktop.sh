#!/bin/sh
# Autostart-Helfer für Raspberry Pi: Electron-App, nicht Chromium.
set -e
cd "$(dirname "$0")/.."
export STEELDART_MODE="${STEELDART_MODE:-offline}"
export STEELDART_KIOSK="${STEELDART_KIOSK:-1}"
export DISPLAY="${DISPLAY:-:0}"

if [ -x "./release/linux-arm64-unpacked/steeldart-counter" ]; then
  exec ./release/linux-arm64-unpacked/steeldart-counter
fi
if [ -x "./release/linux-arm64/steeldart-counter" ]; then
  exec ./release/linux-arm64/steeldart-counter
fi
if [ -x "./release/linux-armv7l-unpacked/steeldart-counter" ]; then
  exec ./release/linux-armv7l-unpacked/steeldart-counter
fi
if [ -x "./release/linux-armv7l/steeldart-counter" ]; then
  exec ./release/linux-armv7l/steeldart-counter
fi
if [ -x "./node_modules/.bin/electron" ]; then
  exec ./node_modules/.bin/electron dist/electron.cjs
fi

echo "Weder gepackte Electron-Binary noch node_modules/.bin/electron gefunden." >&2
echo "Auf dem Pi: npm install && npm run build && npm run electron" >&2
exit 1
