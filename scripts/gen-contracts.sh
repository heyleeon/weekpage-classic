#!/usr/bin/env bash
# gen-contracts.sh — regenerate the two files the frontend gets from Rust:
#   frontend/src/types/bindings.ts                    (tauri-specta: commands, events, types)
#   frontend/src/lib/__fixtures__/demo-snapshot.json  (seeded demo snapshot, backend/src/seed.rs)
# Both are committed; `cargo test` (contracts::export_bindings / demo_fixture) fails when they
# are stale. Output is deterministic: running this twice leaves `git diff` empty.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -d "$HOME/.cargo/bin" ]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi

cargo test --manifest-path backend/Cargo.toml --lib -- --ignored --exact \
  contracts::write_bindings contracts::write_demo_fixture

echo
echo "regenerated:"
echo "  frontend/src/types/bindings.ts"
echo "  frontend/src/lib/__fixtures__/demo-snapshot.json"
