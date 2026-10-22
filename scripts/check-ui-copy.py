#!/usr/bin/env python3
"""check-ui-copy.py — UI copy lives in the i18n resources, never inline (architecture §9).

The source language is Chinese, so CJK text in code (not in comments) is copy that skipped the
resources: an English user would see it untranslated.

Checked (comments blanked out first, string and JSX text kept):
  - frontend/src/**/*.ts(x), except the resources, tests, fixtures and RECOGNITION below;
  - backend/src/**/*.rs minus `#[cfg(test)]` items (the attribute through the brace that closes
    the item, so code after a test module is still checked), except i18n.rs (the backend's own
    copy) and seed.rs (demo data).
RECOGNITION: files whose CJK is input-matching rules (keywords, patterns), not text shown to the
user; each entry says why. Add to it only for that reason. A single such line elsewhere is marked
with a `// not-ui-copy: <why>` comment on it or on the line directly above.
Exit code 1 and a ✗ line per hit.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend" / "src"
BACKEND = ROOT / "backend" / "src"
CJK = re.compile(r"[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]")

FRONTEND_SKIP_DIRS = ("i18n/locales/", "__fixtures__/", "lib/holidays-data/")
RECOGNITION = {
    "lib/parseTime.ts": "time words typed by the user (「下午」「点」「半」)",
    "lib/keyPoint.ts": "key-point classification keywords (「等」「确认」)",
    "lib/stepInput.ts": "date words typed in a step (「明天」「下周五」)",
    "lib/holidays.ts": "trims chinese-days' holiday names (「节」) before they reach the resources",
}
BACKEND_SKIP = ("i18n.rs", "seed.rs")


def string_end(src: str, i: int) -> int:
    """Index just past the string literal that opens at src[i] (backslash escapes honoured)."""
    j = i + 1
    while j < len(src) and src[j] != src[i]:
        j += 2 if src[j] == "\\" else 1
    return j + 1


def blank(out: list[str], start: int, end: int) -> None:
    for k in range(start, min(end, len(out))):
        if out[k] != "\n":
            out[k] = " "


def strip_comments(src: str, quotes: str) -> str:
    """Blank out // and /* */ comments (keeps offsets and line numbers), string-aware."""
    out = list(src)
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c in quotes:
            i = string_end(src, i)
        elif src.startswith("//", i):
            j = src.find("\n", i)
            j = n if j < 0 else j
            blank(out, i, j)
            i = j
        elif src.startswith("/*", i):
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            blank(out, i, j)
            i = j
        else:
            i += 1
    return "".join(out)


def strip_cfg_test(src: str) -> str:
    """Blank out each `#[cfg(test)]` item: from the attribute to the `}` that closes its body, or
    to its `;` when it has none (`mod contracts;`). `src` must have its comments blanked already."""
    out = list(src)
    for m in re.finditer(r"#\[cfg\(test\)\]", src):
        i, depth = m.end(), 0
        while i < len(src):
            c = src[i]
            if c == '"':
                i = string_end(src, i)
                continue
            if c in "([{":
                depth += 1
            elif c in ")]}":
                depth -= 1
            if depth == 0 and c in ";}":
                break
            i += 1
        blank(out, m.start(), i + 1)
    return "".join(out)


LINE_OPT_OUT = "not-ui-copy:"


def hits_in(path: Path, raw: str, src: str) -> list[str]:
    hits = []
    raw_lines = raw.splitlines()
    for no, line in enumerate(src.splitlines(), 1):
        marked = any(LINE_OPT_OUT in raw_lines[i] for i in (no - 2, no - 1) if i >= 0)
        if CJK.search(line) and not marked:
            hits.append(f"{path.relative_to(ROOT)}:{no}: {line.strip()[:80]}")
    return hits


def frontend_files() -> list[Path]:
    files = []
    for p in sorted([*FRONTEND.rglob("*.ts"), *FRONTEND.rglob("*.tsx")]):
        rel = p.relative_to(FRONTEND).as_posix()
        if rel.startswith(FRONTEND_SKIP_DIRS) or rel in RECOGNITION:
            continue
        if ".test." in p.name or p.name == "test-setup.ts":
            continue
        files.append(p)
    return files


def main() -> int:
    hits: list[str] = []
    for p in frontend_files():
        raw = p.read_text(encoding="utf-8")
        hits += hits_in(p, raw, strip_comments(raw, "\"'`"))
    for p in sorted(BACKEND.rglob("*.rs")):
        if p.name in BACKEND_SKIP:
            continue
        raw = p.read_text(encoding="utf-8")
        hits += hits_in(p, raw, strip_cfg_test(strip_comments(raw, '"')))
    for h in hits:
        print(f"✗ UI copy outside the i18n resources: {h}")
    if hits:
        return 1
    print("✓ no inline UI copy (frontend/src, backend/src)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
