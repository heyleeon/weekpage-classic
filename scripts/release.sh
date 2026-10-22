#!/usr/bin/env bash
# release.sh — build the macOS release DMG locally: universal binary, Developer ID signature,
# notarized and stapled (.app and DMG). It stops at the DMG; publishing is `gh release create`.
#
#   scripts/release.sh                 # signed + notarized if the credentials are there, else says why not
#   scripts/release.sh --publishable   # fail instead of falling back (use this for a real release)
#
# Credentials are environment variables. If $WEEKPAGE_RELEASE_ENV (default
# ~/.config/weekpage/release.env) exists it is sourced first; keep it chmod 600, outside the repo.
#   APPLE_SIGNING_IDENTITY   "Developer ID Application: <name> (<team id>)"; unset = ad-hoc signed
#   notarization, either set:
#     APPLE_ID / APPLE_PASSWORD (app-specific password) / APPLE_TEAM_ID
#     APPLE_API_KEY / APPLE_API_ISSUER / APPLE_API_KEY_PATH   (App Store Connect API key)
#
# Tauri signs and notarizes the .app; it does not notarize the DMG. A downloaded DMG gets the
# quarantine flag and Gatekeeper judges the DMG file itself, so this script notarizes and staples
# the DMG too. Stapling changes the bytes: the sha256 is printed after it.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo=$PWD

if [ -d "$HOME/.cargo/bin" ]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi

publishable=0
case "${1:-}" in
  "") ;;
  --publishable) publishable=1 ;;
  *)
    echo "usage: $0 [--publishable]" >&2
    exit 2
    ;;
esac

die() { echo "release: $*" >&2; exit 1; }
note() { echo "· $*"; }

env_file="${WEEKPAGE_RELEASE_ENV:-$HOME/.config/weekpage/release.env}"
if [ -f "$env_file" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a
  note "credentials loaded from $env_file"
fi
# This app has no updater; never hand an updater key to the build.
unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD

version=$(sed -n 's/^version = "\(.*\)"/\1/p' backend/Cargo.toml | head -1)
[ -n "$version" ] || die "no version in backend/Cargo.toml"
target=universal-apple-darwin
note "WeekPage $version, $target"

for t in aarch64-apple-darwin x86_64-apple-darwin; do
  libdir=$(cd backend && rustc --print target-libdir --target "$t" 2>/dev/null || true)
  compgen -G "$libdir/libcore-*.rlib" >/dev/null || die "no Rust standard library for $t: run (cd backend && rustup target add $t)"
done

has_apple_id=0
has_api_key=0
[ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ] && has_apple_id=1
[ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_ISSUER:-}" ] && [ -n "${APPLE_API_KEY_PATH:-}" ] && has_api_key=1

if [ -z "${APPLE_SIGNING_IDENTITY:-}" ] || [ "$APPLE_SIGNING_IDENTITY" = "-" ]; then
  [ "$publishable" -eq 0 ] || die "--publishable needs APPLE_SIGNING_IDENTITY (Developer ID Application)"
  export APPLE_SIGNING_IDENTITY="-"
  level=adhoc
  note "no APPLE_SIGNING_IDENTITY: ad-hoc signed, Gatekeeper will block it on other Macs"
elif [ "$has_apple_id" -eq 1 ] || [ "$has_api_key" -eq 1 ]; then
  level=notarized
else
  [ "$publishable" -eq 0 ] || die "--publishable needs notarization credentials (APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID or APPLE_API_KEY/APPLE_API_ISSUER/APPLE_API_KEY_PATH)"
  level=signed
  note "no notarization credentials: signed but not notarized, Gatekeeper will block the download"
fi
note "level: $level"

# bundle_dmg.sh mounts a volume named after the product; a leftover /Volumes/WeekPage (a DMG you
# opened to check) makes it mount "WeekPage 1" and fail at the very end.
for v in /Volumes/WeekPage /Volumes/WeekPage\ *; do
  [ -d "$v" ] || continue
  note "detaching leftover mount $v"
  hdiutil detach "$v" >/dev/null 2>&1 || echo "  warning: could not detach $v" >&2
done

# The front end is built by a whole npm toolchain; it never needs the signing credentials.
without_secrets() {
  env -u APPLE_ID -u APPLE_PASSWORD -u APPLE_TEAM_ID -u APPLE_SIGNING_IDENTITY \
    -u APPLE_API_KEY -u APPLE_API_ISSUER -u APPLE_API_KEY_PATH "$@"
}
without_secrets pnpm -C frontend install --frozen-lockfile
without_secrets pnpm -C frontend build

# beforeBuildCommand is dropped (null) so the CLI does not rebuild the front end with credentials.
(cd backend && ../frontend/node_modules/.bin/tauri build --target "$target" --bundles app,dmg \
  --config tauri.release.conf.json --config '{"build":{"beforeBuildCommand":null}}' -- --locked)

bundle="$repo/backend/target/$target/release/bundle"
app="$bundle/macos/WeekPage.app"
dmg="$bundle/dmg/WeekPage_${version}_universal.dmg"
[ -d "$app" ] || die "expected $app"
[ -f "$dmg" ] || die "expected $dmg"

if [ "$level" = notarized ]; then
  note "notarizing the DMG"
  if [ "$has_apple_id" -eq 1 ]; then
    auth=(--apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID")
  else
    auth=(--key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER")
  fi
  # `submit --wait` can exit 0 on Invalid, so read the status from the JSON.
  result=$(xcrun notarytool submit "$dmg" "${auth[@]}" --wait --timeout 60m --output-format json) || {
    echo "$result" >&2
    die "notarytool submit failed"
  }
  status=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))' <<<"$result")
  if [ "$status" != "Accepted" ]; then
    id=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))' <<<"$result")
    [ -n "$id" ] && xcrun notarytool log "$id" "${auth[@]}" >&2 || true
    die "DMG notarization status: ${status:-unknown}"
  fi
  xcrun stapler staple "$dmg"
fi

note "verifying"
archs=$(lipo -archs "$app/Contents/MacOS/weekpage")
for a in arm64 x86_64; do
  [[ " $archs " == *" $a "* ]] || die "expected a universal binary, got: $archs"
done
codesign --verify --deep --strict "$app" || die "codesign --verify failed"
if [ "$level" != adhoc ]; then
  sig=$(codesign -dvv "$app" 2>&1)
  grep -q '^Authority=Developer ID Application' <<<"$sig" || die "not signed with a Developer ID"
  grep -q 'flags=.*runtime' <<<"$sig" || die "hardened runtime is off"
fi
if [ "$level" = notarized ]; then
  xcrun stapler validate "$app" >/dev/null || die "the .app has no stapled ticket"
  xcrun stapler validate "$dmg" >/dev/null || die "the DMG has no stapled ticket"
  spctl -a -t exec "$app" || die "Gatekeeper rejects the .app"
  spctl -a -t open --context context:primary-signature "$dmg" || die "Gatekeeper rejects the DMG"
fi

echo
echo "level $level, archs: $archs"
shasum -a 256 "$dmg"
