#!/usr/bin/env bash
# sync-agent-config.sh — keep the Claude Code view (.claude/) and the Codex view
# (.agents/) as ONE physical source via symlinks.
#
# .agents/ holds the real files; .claude/ is just symlinks pointing into it, so
# editing a skill or the doc from either tool writes through to the same inode and
# the two views cannot drift. The only thing that can break this is a tool/editor
# that does "replace on save" on a link, turning it back into a standalone file.
# This script creates the links (and their targets), detects that breakage
# (--check), and repairs it in place (--heal), folding any clobbered content back
# into the canonical .agents/ source.
#
#   sync-agent-config.sh            # create missing links + their targets
#   sync-agent-config.sh --check    # verify only; non-zero exit on drift (CI)
#   sync-agent-config.sh --heal     # repair broken/clobbered links in place
set -euo pipefail

# Resolve repo root from the script's own location (works with or without git,
# and regardless of the caller's cwd). Script always lives at <root>/scripts/.
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# link | target (relative to the link's own dir) | type (file|dir)
LINKS=(
  ".claude/CLAUDE.md|../.agents/AGENTS.md|file"
  ".claude/skills|../.agents/skills|dir"
  ".claude/rules|../.agents/rules|dir"
)

mode="${1:-create}"   # create | --check | --heal
drift=0

ensure_target() {   # $1=resolved target path  $2=type
  case "$2" in
    dir)  [ -e "$1" ] || mkdir -p "$1" ;;
    file) [ -e "$1" ] || { mkdir -p "$(dirname "$1")"; : > "$1"; } ;;
  esac
}

for entry in "${LINKS[@]}"; do
  IFS='|' read -r link target type <<<"$entry"
  dir="$(dirname "$link")"
  resolved="$dir/$target"   # where the link should point

  if [ -L "$link" ]; then
    # Already a symlink — confirm it points where we expect and resolves.
    if [ "$(readlink "$link")" = "$target" ] && [ -e "$link" ]; then
      echo "ok    $link -> $target"
    else
      echo "BROKEN $link -> $(readlink "$link") (want $target)"; drift=1
      [ "$mode" = "--heal" ] && { ensure_target "$resolved" "$type"; rm "$link"; ln -s "$target" "$link"; echo "healed $link"; }
    fi
  elif [ -e "$link" ]; then
    # A real file/dir sits where a symlink should be: a tool clobbered the link.
    echo "CLOBBERED $link is a real $( [ -d "$link" ] && echo dir || echo file ) (want link -> $target)"; drift=1
    if [ "$mode" = "--heal" ]; then
      ensure_target "$resolved" "$type"
      if [ -d "$link" ]; then
        cp -R "$link"/. "$resolved"/ 2>/dev/null || true; rm -rf "$link"
      else
        cp "$link" "$resolved"; rm -f "$link"
      fi
      ln -s "$target" "$link"; echo "healed $link (content folded into $resolved)"
    fi
  else
    # Missing entirely.
    if [ "$mode" = "--check" ]; then
      echo "MISSING $link"; drift=1
    else
      ensure_target "$resolved" "$type"; mkdir -p "$dir"; ln -s "$target" "$link"; echo "created $link -> $target"
    fi
  fi
done

if [ "$mode" = "--check" ] && [ "$drift" -ne 0 ]; then
  echo "drift detected — run: scripts/sync-agent-config.sh --heal" >&2
  exit 1
fi
echo "done."
