#!/bin/sh
# Startet die entpackte Linux-App (Raspberry Pi). Kein Chromium nötig.
set -e
DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
BIN="$DIR/steeldart-counter"
if [ ! -f "$BIN" ]; then
  echo "steeldart-counter nicht gefunden in: $DIR" >&2
  echo "Ordner so lassen, wie electron-builder ihn erzeugt hat (linux-arm64-unpacked)." >&2
  exit 1
fi
chmod +x "$BIN" 2>/dev/null || true
exec "$BIN" "$@"
