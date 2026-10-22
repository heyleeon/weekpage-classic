#!/usr/bin/env bash
# check-boundaries.sh — layering rules that grep can enforce (architecture §3).
#
#   1. Tauri IPC (invoke( / listen( / @tauri-apps/*) only in frontend/src/lib/api.ts and the
#      generated frontend/src/types/bindings.ts.
#   2. Colour literals (#hex, rgb(, rgba(, hsl(, hsla() only in
#      frontend/src/design/tokens/primitive.css.
#   3. target_os (cfg / cfg!) only under backend/src/platform/.
#   4. No tauri-plugin-sql anywhere (the only write path is Rust, architecture §3).
#   5. No localeCompare (sort keys compare with plain <, see sort_key.rs).
#
# Comment-only lines are ignored. Exits non-zero with ✗ lines on any violation.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail=0

# report <rule> <grep output>: drops comment-only lines (// … , /* … , * … , # …).
report() {
  local rule="$1" hits="$2" line
  hits="$(printf '%s\n' "$hits" | grep -Ev '^[^:]+:[0-9]+:[[:space:]]*(//|/\*|\*|#)' || true)"
  if [ -n "$hits" ]; then
    fail=1
    while IFS= read -r line; do
      echo "✗ [$rule] $line"
    done <<<"$hits"
  fi
}

FRONT_SRC=frontend/src
FRONT_EXCLUDES=(--exclude-dir=node_modules --exclude-dir=__fixtures__ --exclude-dir=holidays-data)

# 1. IPC only in api.ts / bindings.ts
hits="$(grep -rnE "(^|[^A-Za-z0-9_])(invoke|listen)\(|@tauri-apps/" "${FRONT_EXCLUDES[@]}" \
  --include='*.ts' --include='*.tsx' "$FRONT_SRC" \
  | grep -vE "^$FRONT_SRC/(lib/api\.ts|types/bindings\.ts):" || true)"
report "ipc outside lib/api.ts" "$hits"

# 2. colour literals only in primitive.css
hits="$(grep -rnE "#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(rgba?|hsla?)\(" \
  "${FRONT_EXCLUDES[@]}" --include='*.css' --include='*.ts' --include='*.tsx' \
  "$FRONT_SRC" frontend/index.html \
  | grep -vE "^$FRONT_SRC/design/tokens/primitive\.css:" || true)"
report "colour literal outside primitive.css" "$hits"

# 3. target_os only in backend/src/platform/
hits="$(grep -rn "target_os" --include='*.rs' backend/src | grep -v "^backend/src/platform/" || true)"
report "target_os outside backend/src/platform/" "$hits"

# 4. no tauri-plugin-sql
hits="$(grep -rnE "tauri-plugin-sql|plugin-sql|tauri_plugin_sql" \
  backend/Cargo.toml backend/src frontend/package.json "${FRONT_EXCLUDES[@]}" "$FRONT_SRC" || true)"
report "tauri-plugin-sql is not allowed" "$hits"

# 5. no localeCompare
hits="$(grep -rn "localeCompare" "${FRONT_EXCLUDES[@]}" --include='*.ts' --include='*.tsx' \
  "$FRONT_SRC" || true)"
report "localeCompare is not allowed (compare sort keys with <)" "$hits"

if [ "$fail" -ne 0 ]; then
  echo "boundary check failed" >&2
  exit 1
fi
echo "✓ boundaries ok"
