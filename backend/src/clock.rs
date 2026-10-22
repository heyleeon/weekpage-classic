//! The app clock: "now" and "today" for Rust.
//!
//! Only two wall-clock questions are answered in Rust (architecture §3): what is today and
//! what time is it now. `WEEKPAGE_FAKE_NOW=2026-09-30T10:00` (debug builds only) shifts the clock
//! by a fixed offset that keeps ticking, so reminders still fire. Tests use `Clock::fixed`, which
//! does not tick.

use std::sync::RwLock;

use chrono::{NaiveDate, NaiveDateTime, Utc};
use jiff::civil;
use jiff::tz::TimeZone;

const FAKE_NOW_ENV: &str = "WEEKPAGE_FAKE_NOW";
const FORMAT: &str = "%Y-%m-%dT%H:%M";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    /// Wall clock plus an offset in milliseconds.
    Offset(i64),
    /// Frozen at a UTC millisecond timestamp (tests).
    Fixed(i64),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Clock {
    mode: Mode,
}

impl Default for Clock {
    fn default() -> Self {
        Self::system()
    }
}

impl Clock {
    /// The plain wall clock.
    pub fn system() -> Self {
        Clock {
            mode: Mode::Offset(0),
        }
    }

    /// Wall clock shifted by `offset_ms`.
    pub fn with_offset(offset_ms: i64) -> Self {
        Clock {
            mode: Mode::Offset(offset_ms),
        }
    }

    /// Clock from the environment: honours `WEEKPAGE_FAKE_NOW` in debug builds only.
    pub fn from_env() -> Self {
        if !cfg!(debug_assertions) {
            return Self::system();
        }
        match std::env::var(FAKE_NOW_ENV) {
            Ok(raw) if !raw.trim().is_empty() => match local_ms(raw.trim()) {
                Some(fake) => {
                    log::info!("clock: {FAKE_NOW_ENV}={} applied", raw.trim());
                    Self::with_offset(fake - Utc::now().timestamp_millis())
                }
                None => {
                    log::warn!("clock: ignoring {FAKE_NOW_ENV}={raw:?}, expected YYYY-MM-DDTHH:MM");
                    Self::system()
                }
            },
            _ => Self::system(),
        }
    }

    /// A frozen clock at local time `YYYY-MM-DDTHH:MM`. Panics on a malformed literal (tests only).
    pub fn fixed(local: &str) -> Self {
        let ms = local_ms(local).unwrap_or_else(|| panic!("bad fixed clock literal: {local}"));
        Clock {
            mode: Mode::Fixed(ms),
        }
    }

    /// Offset from the wall clock, reported to the frontend (`AppInfo.clockOffsetMs`).
    pub fn offset_ms(&self) -> i64 {
        match self.mode {
            Mode::Offset(o) => o,
            Mode::Fixed(ms) => ms - Utc::now().timestamp_millis(),
        }
    }

    /// Now as UTC milliseconds.
    pub fn now_ms(&self) -> i64 {
        match self.mode {
            Mode::Offset(o) => Utc::now().timestamp_millis() + o,
            Mode::Fixed(ms) => ms,
        }
    }

    /// Now as a local date-time.
    pub fn local_now(&self) -> NaiveDateTime {
        local_from_ms(self.now_ms())
    }

    /// Today as a floating local date `YYYY-MM-DD`.
    pub fn today(&self) -> String {
        self.local_now().format("%Y-%m-%d").to_string()
    }
}

/// The zone chosen in settings; `None` = follow the OS. Process-wide so `Clock` can stay `Copy`
/// and the db layer keeps passing it around by reference.
static ZONE: RwLock<Option<TimeZone>> = RwLock::new(None);

/// "system" or an IANA zone name the bundled tz database knows.
pub fn is_valid_timezone(setting: &str) -> bool {
    setting == "system" || TimeZone::get(setting).is_ok()
}

/// Applies the `timezone` setting: "system" follows the OS, an unknown name falls back to it.
pub fn set_timezone(setting: &str) {
    let zone = if setting == "system" {
        None
    } else {
        match TimeZone::get(setting) {
            Ok(z) => Some(z),
            Err(e) => {
                log::warn!("clock: unknown timezone {setting:?} ({e}), following the system");
                None
            }
        }
    };
    if let Ok(mut slot) = ZONE.write() {
        *slot = zone;
    }
}

fn zone() -> TimeZone {
    ZONE.read()
        .ok()
        .and_then(|z| z.clone())
        .unwrap_or_else(TimeZone::system)
}

/// UTC milliseconds → wall time in `zone`.
fn wall_in(zone: &TimeZone, ms: i64) -> Option<NaiveDateTime> {
    let ts = jiff::Timestamp::from_millisecond(ms).ok()?;
    let dt = zone.to_datetime(ts);
    NaiveDate::from_ymd_opt(i32::from(dt.year()), dt.month() as u32, dt.day() as u32)?.and_hms_opt(
        dt.hour() as u32,
        dt.minute() as u32,
        dt.second() as u32,
    )
}

/// Wall time `YYYY-MM-DDTHH:MM` in `zone` → UTC milliseconds (earliest instant on DST overlaps).
fn ms_in(zone: &TimeZone, local: &str) -> Option<i64> {
    let naive = NaiveDateTime::parse_from_str(local, FORMAT).ok()?;
    let civil = civil::DateTime::new(
        i16::try_from(chrono::Datelike::year(&naive)).ok()?,
        chrono::Datelike::month(&naive) as i8,
        chrono::Datelike::day(&naive) as i8,
        chrono::Timelike::hour(&naive) as i8,
        chrono::Timelike::minute(&naive) as i8,
        0,
        0,
    )
    .ok()?;
    let ts = zone.to_ambiguous_timestamp(civil).earlier().ok()?;
    Some(ts.as_millisecond())
}

/// Converts a UTC millisecond timestamp to wall time in the app's zone.
pub fn local_from_ms(ms: i64) -> NaiveDateTime {
    let zone = zone();
    wall_in(&zone, ms)
        .or_else(|| wall_in(&zone, Utc::now().timestamp_millis()))
        .unwrap_or_default()
}

/// Parses wall time `YYYY-MM-DDTHH:MM` in the app's zone to UTC milliseconds.
pub fn local_ms(local: &str) -> Option<i64> {
    ms_in(&zone(), local)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_clock_reports_local_date_and_time() {
        let c = Clock::fixed("2026-09-30T10:00");
        assert_eq!(c.today(), "2026-09-30");
        assert_eq!(c.local_now().format(FORMAT).to_string(), "2026-09-30T10:00");
        assert_eq!(c.now_ms(), c.now_ms(), "fixed clock does not tick");
    }

    #[test]
    fn offset_clock_ticks_from_the_offset() {
        let target = local_ms("2026-09-30T10:00").unwrap();
        let c = Clock::with_offset(target - Utc::now().timestamp_millis());
        assert!((c.now_ms() - target).abs() < 5_000);
        assert_eq!(c.today(), "2026-09-30");
    }

    #[test]
    fn malformed_literal_is_rejected() {
        assert_eq!(local_ms("2026-09-30 10:00"), None);
        assert_eq!(local_ms("tomorrow"), None);
    }

    #[test]
    fn wall_time_follows_the_zone() {
        let tokyo = TimeZone::get("Asia/Tokyo").unwrap();
        let la = TimeZone::get("America/Los_Angeles").unwrap();
        let ms = ms_in(&tokyo, "2026-10-01T08:30").unwrap();
        assert_eq!(
            wall_in(&tokyo, ms).unwrap().format(FORMAT).to_string(),
            "2026-10-01T08:30"
        );
        // 08:30 in Tokyo (UTC+9) is 16:30 the previous day in Los Angeles (PDT, UTC-7).
        assert_eq!(
            wall_in(&la, ms).unwrap().format(FORMAT).to_string(),
            "2026-09-30T16:30"
        );
    }

    #[test]
    fn timezone_setting_validation() {
        assert!(is_valid_timezone("system"));
        assert!(is_valid_timezone("Asia/Shanghai"));
        assert!(!is_valid_timezone("Mars/Olympus"));
        assert!(!is_valid_timezone(""));
    }

    #[test]
    fn system_clock_has_zero_offset() {
        assert_eq!(Clock::system().offset_ms(), 0);
    }
}
