#!/usr/bin/env bash
# check.sh — the single quality gate, run before every commit and by CI.
#
#   scripts/check.sh        # everything: shared checks + frontend + backend
#   scripts/check.sh fe     # shared checks + frontend (steps 1-6)
#   scripts/check.sh be     # shared checks + backend (steps 1-3, 7-9)
#   scripts/check.sh win    # only: cargo check for x86_64-pc-windows-gnu (SKIP when no toolchain)
#
# `win` is an early signal that the cfg(windows) branches compile; it does not replace a real
# Windows build (CI on windows-latest, or a manual run on a real Windows machine, see docs/roadmap.md).
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Prefer rustup's proxies (they honour rust-toolchain.toml) over e.g. a Homebrew rustc on PATH.
if [ -d "$HOME/.cargo/bin" ]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi

mode="${1:-all}"
case "$mode" in
  all | fe | be | win) ;;
  *)
    echo "usage: $0 [fe|be|win]" >&2
    exit 2
    ;;
esac

MANIFEST=backend/Cargo.toml
WIN_TARGET=x86_64-pc-windows-gnu

step() {
  echo
  echo "── $* ──"
}

if [ "$mode" = win ]; then
  if ! command -v rustup >/dev/null 2>&1 \
    || ! rustup target list --installed 2>/dev/null | grep -qx "$WIN_TARGET"; then
    echo "SKIP: windows cross-check needs: rustup target add $WIN_TARGET"
    exit 0
  fi
  if ! command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1; then
    echo "SKIP: windows cross-check needs x86_64-w64-mingw32-gcc (macOS: brew install mingw-w64)"
    exit 0
  fi
  step "cargo check --target $WIN_TARGET"
  cargo check --manifest-path "$MANIFEST" --target "$WIN_TARGET" --all-targets
  echo
  echo "✓ windows cross-check passed"
  exit 0
fi

step "1. agent config mirror (scripts/sync-agent-config.sh --check)"
bash scripts/sync-agent-config.sh --check

step "2. CJK: none in CI config / Rust logs / errors; UI copy only in the i18n resources"
# Windows runners ship `python` but not always a working `python3`.
PYTHON=python3
if ! python3 -c "" >/dev/null 2>&1; then
  PYTHON=python
fi
"$PYTHON" scripts/check-no-cjk.py
"$PYTHON" scripts/check-ui-copy.py

step "3. boundaries"
bash scripts/check-boundaries.sh

if [ "$mode" = all ] || [ "$mode" = fe ]; then
  if [ ! -d frontend/node_modules ]; then
    echo "frontend/node_modules is missing: run pnpm -C frontend install --frozen-lockfile" >&2
    exit 1
  fi
  step "4. biome ci"
  pnpm -C frontend exec biome ci .

  step "5. tsc --noEmit"
  pnpm -C frontend exec tsc --noEmit

  step "6. vitest"
  pnpm -C frontend test --run
fi

if [ "$mode" = all ] || [ "$mode" = be ]; then
  step "7. cargo fmt --check"
  cargo fmt --manifest-path "$MANIFEST" --check

  step "8. cargo clippy -D warnings"
  cargo clippy --manifest-path "$MANIFEST" --all-targets -- -D warnings

  step "9. cargo test (includes bindings / demo fixture contract checks)"
  cargo test --manifest-path "$MANIFEST"
fi

echo
echo "✓ all checks passed ($mode)"
