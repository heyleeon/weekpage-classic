// The frontend clock: wall clock + offset (architecture §12 "时钟注入").
//
// In the app the offset comes from Rust (`appInfo().clockOffsetMs`, WEEKPAGE_FAKE_NOW in debug
// builds); in the browser preview from `?now=2026-09-30T10:00`. Time keeps ticking from there.
// Wall time follows settings.timezone ("system" = the OS zone; hooks/useTimezone applies it).
// Never use JS timers to detect a day change — the WebView is throttled while hidden; `today` is
// recomputed on `shell://shown` and `clock://day-changed` (hooks/useShellEvents).

let offsetMs = 0;
/** IANA zone from settings; undefined = follow the OS. */
let zone: string | undefined;
const formatters = new Map<string, Intl.DateTimeFormat>();

export function setClockOffset(ms: number): void {
  offsetMs = Number.isFinite(ms) ? ms : 0;
}

export function clockOffset(): number {
  return offsetMs;
}

function formatterFor(name: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(name);
  if (cached) return cached;
  try {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: name,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    formatters.set(name, f);
    return f;
  } catch {
    return null;
  }
}

/** True when the WebView knows `name` as an IANA zone. */
export function isValidTimezone(name: string): boolean {
  return formatterFor(name) !== null;
}

/** Applies settings.timezone: "system" (or an unknown name) follows the OS. */
export function setTimezone(setting: string): void {
  zone = setting !== "system" && isValidTimezone(setting) ? setting : undefined;
}

/** The zone wall times are shown in: the setting, or the OS zone. */
export function activeTimezone(): string {
  return zone ?? systemTimezone();
}

/** The OS zone, e.g. "Asia/Shanghai". */
export function systemTimezone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export type WallTime = { y: number; mo: number; d: number; h: number; mi: number };

/** Wall-clock parts of an instant in the active zone. */
export function wallTime(ms: number): WallTime {
  const f = zone ? formatterFor(zone) : null;
  if (!f) {
    const dt = new Date(ms);
    return {
      y: dt.getFullYear(),
      mo: dt.getMonth() + 1,
      d: dt.getDate(),
      h: dt.getHours(),
      mi: dt.getMinutes(),
    };
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(ms)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute };
}

/** Now as epoch milliseconds. */
export function nowMs(): number {
  return Date.now() + offsetMs;
}

/** 'YYYY-MM-DD' of an instant in the active zone. */
export function dateStrAt(ms: number): string {
  const w = wallTime(ms);
  return `${w.y}-${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}

/** Today as 'YYYY-MM-DD' in the active zone. */
export function todayStr(): string {
  return dateStrAt(nowMs());
}

/** Wall 'YYYY-MM-DDTHH:MM' in the active zone → epoch ms, or null when malformed. */
export function parseLocal(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(asUtc);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  // Wall − instant = zone offset; one refinement step settles it across a DST change.
  const offsetAt = (ms: number) => {
    const w = wallTime(ms);
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - Math.floor(ms / 60_000) * 60_000;
  };
  const first = asUtc - offsetAt(asUtc);
  return asUtc - offsetAt(first);
}

/** Applies `?now=YYYY-MM-DDTHH:MM` (browser preview). Returns true when an offset was set. */
export function initClockFromUrl(search: string): boolean {
  const now = new URLSearchParams(search).get("now");
  if (!now) return false;
  const target = parseLocal(now);
  if (target === null) return false;
  setClockOffset(target - Date.now());
  return true;
}
