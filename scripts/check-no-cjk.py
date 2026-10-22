#!/usr/bin/env python3
"""check-no-cjk.py — outward-facing text stays English (spine ⑬).

Checked:
  - .github/workflows/**: the whole file;
  - backend/src/**/*.rs: the arguments of log macros (log::info!(...), warn!(...), …) and of
    AppError constructors (AppError::invalid(...), AppError::new(...), …).
Not checked: product copy (UI text, tauri.conf.json titles), seed data, comments.
Exit code 1 and a ✗ line per hit when CJK text is found.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CJK = re.compile(r"[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]")
CALL_START = re.compile(
    r"\b(?:log::)?(?:trace|debug|info|warn|error)!\s*\(|\bAppError::[a-z_]+\s*\("
)


def strip_comments(src: str) -> str:
    """Blank out // and /* */ comments (keeps offsets and line numbers), string-aware."""
    out = list(src)
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == '"':
            j = i + 1
            while j < n and src[j] != '"':
                j += 2 if src[j] == "\\" else 1
            i = j + 1
        elif src.startswith("//", i):
            j = src.find("\n", i)
            j = n if j < 0 else j
            for k in range(i, j):
                out[k] = " "
            i = j
        elif src.startswith("/*", i):
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            for k in range(i, j):
                if out[k] != "\n":
                    out[k] = " "
            i = j
        else:
            i += 1
    return "".join(out)


def call_args(src: str, open_paren: int) -> str:
    """Text between the parenthesis at `open_paren` and its match (string-aware)."""
    depth, i, n = 0, open_paren, len(src)
    while i < n:
        c = src[i]
        if c == '"':
            j = i + 1
            while j < n and src[j] != '"':
                j += 2 if src[j] == "\\" else 1
            i = j + 1
            continue
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return src[open_paren + 1 : i]
        i += 1
    return src[open_paren + 1 :]


def check_rust(path: Path) -> list[str]:
    src = strip_comments(path.read_text(encoding="utf-8"))
    hits = []
    for m in CALL_START.finditer(src):
        args = call_args(src, m.end() - 1)
        if CJK.search(args):
            line = src.count("\n", 0, m.start()) + 1
            snippet = " ".join(args.split())[:80]
            hits.append(f"{path.relative_to(ROOT)}:{line}: {m.group(0).strip()}{snippet})")
    return hits


def check_workflow(path: Path) -> list[str]:
    hits = []
    for no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if CJK.search(line):
            hits.append(f"{path.relative_to(ROOT)}:{no}: {line.strip()[:80]}")
    return hits


def main() -> int:
    hits: list[str] = []
    workflows = ROOT / ".github" / "workflows"
    if workflows.is_dir():
        for p in sorted(workflows.rglob("*")):
            if p.is_file():
                hits += check_workflow(p)
    for p in sorted((ROOT / "backend" / "src").rglob("*.rs")):
        hits += check_rust(p)
    for h in hits:
        print(f"✗ CJK in outward-facing text: {h}")
    if hits:
        return 1
    print("✓ no CJK in CI config, Rust log lines or error messages")
    return 0


if __name__ == "__main__":
    sys.exit(main())
