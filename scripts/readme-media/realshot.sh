#!/bin/bash
# Real-app screenshots (macOS): start a throwaway debug instance with demo data and a fixed
# clock, capture only its window (system shadow, transparent corners).
# Usage: bash realshot.sh  → window-light / window-dark / tasks-light / tasks-dark / calendar-en (.png)
# Needs: `pnpm -C frontend tauri:build:debug` done (backend/target/debug/weekpage) and
# Screen Recording permission for your terminal.
set -eu
cd "$(dirname "$0")"
ROOT=$(cd ../.. && pwd)
BIN="$ROOT/backend/target/debug/weekpage"
[ -x "$BIN" ] || { echo "missing $BIN: run pnpm -C frontend tauri:build:debug first"; exit 1; }
swiftc -O -o winbounds winbounds.swift && swiftc -O -o warp warp.swift
export WEEKPAGE_SEED=demo WEEKPAGE_FAKE_NOW=2026-09-30T10:00
export WEEKPAGE_DATA_DIR=$(mktemp -d) WEEKPAGE_LOG_DIR=$(mktemp -d)
DB="$WEEKPAGE_DATA_DIR/task-desk.db"
"$BIN" >/dev/null 2>&1 & PID=$!; sleep 4; kill $PID; sleep 1      # first run only seeds the demo data
# Dismiss the first-run hint bar; Chinese UI
sqlite3 "$DB" "update settings set value = json_set(value, '\$.onboardingShortcutHintSeen', json('true'), '\$.language', 'zh-Hans') where key='app'"
shot() { # $1 = file name, $2 = json_set arguments
  sqlite3 "$DB" "update settings set value = json_set(value, $2) where key='app'"
  "$BIN" >/dev/null 2>&1 & PID=$!; sleep 4.5
  ./warp 1500 975                                                  # move the mouse away: no hover state in the shot
  WID=$(./winbounds weekpage | awk '{print $1; exit}')
  screencapture -x -l "$WID" "$1.png"
  kill $PID; sleep 1; echo "$1.png"
}
shot window-light "'\$.theme', 'light', '\$.lastPage', 'calendar'"
shot window-dark  "'\$.theme', 'dark'"
shot tasks-dark   "'\$.lastPage', 'tasks'"
shot tasks-light  "'\$.theme', 'light'"
shot calendar-en  "'\$.lastPage', 'calendar', '\$.language', 'en'"
echo "done: copy the PNGs to docs/media/"
