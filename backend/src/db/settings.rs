//! Local settings (`settings` table): the `app` JSON, `device_id`, and `cache:*` entries.
//!
//! Settings are only ever written through a patch ([`merge`]): read old → apply → persist, so
//! two quick writes (switching page, then weeks) never overwrite each other (architecture §6.3).

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;

use crate::error::AppError;
use crate::model::{
    CalendarFirstRow, Language, LastPage, Platform, Settings, SettingsPatch, Theme,
};

pub const APP_KEY: &str = "app";
pub const DEVICE_ID_KEY: &str = "device_id";
pub const CACHE_PREFIX: &str = "cache:";

/// Defaults for a fresh install. `is_dev` = the identifier ends with `.dev`:
/// development builds use a different global shortcut and never enable autostart, so they
/// cannot fight with the installed release build.
pub fn defaults(platform: Platform, is_dev: bool) -> Settings {
    // Same combo on both platforms (user decision D4, 2026-09-30): ⌃⌥Space / Ctrl+Alt+Space.
    // Alt+Space alone is the Windows system menu and is often taken by ChatGPT on macOS.
    let _ = platform;
    let shortcut = if is_dev {
        "Control+Alt+Shift+Space"
    } else {
        "Control+Alt+Space"
    };
    Settings {
        shortcut: shortcut.to_string(),
        theme: Theme::System,
        hide_on_blur: true,
        autostart: !is_dev,
        calendar_weeks: 3,
        last_page: LastPage::Calendar,
        todo_done_collapsed: false,
        onboarding_shortcut_hint_seen: false,
        language: Language::System,
        calendar_first_row: CalendarFirstRow::ThisWeek,
        timezone: "system".to_string(),
    }
}

fn read_raw(conn: &Connection, key: &str) -> Result<Option<String>, AppError> {
    Ok(conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()?)
}

fn write_raw(conn: &Connection, key: &str, json: &str, now_ms: i64) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, json, now_ms],
    )?;
    Ok(())
}

/// Stored values written by older builds, renamed since: v0.1 stored the language as the region
/// tag `zh-CN`; it is `zh-Hans` now (a script tag). The next write stores the new value.
fn upgrade_stored(key: &str, value: &Value) -> Value {
    match (key, value.as_str()) {
        ("language", Some("zh-CN")) => Value::from("zh-Hans"),
        _ => value.clone(),
    }
}

/// Stored settings laid over `defaults`: fields missing from an older stored JSON keep their
/// defaults, unknown keys are ignored, and a stored value that no longer parses (an enum variant
/// this build does not know, a wrong type) falls back to its default without touching the others.
pub fn get(conn: &Connection, defaults: &Settings) -> Result<Settings, AppError> {
    let mut base = serde_json::to_value(defaults)?;
    let Some(raw) = read_raw(conn, APP_KEY)? else {
        return Ok(defaults.clone());
    };
    let stored: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("settings: stored value unreadable ({e}), using defaults");
            return Ok(defaults.clone());
        }
    };
    let (Some(base_obj), Some(stored_obj)) = (base.as_object_mut(), stored.as_object()) else {
        log::warn!("settings: stored value is not an object, using defaults");
        return Ok(defaults.clone());
    };
    for (k, v) in stored_obj {
        if !base_obj.contains_key(k) {
            continue;
        }
        let v = upgrade_stored(k, v);
        let previous = base_obj.insert(k.clone(), v);
        if serde_json::from_value::<Settings>(Value::Object(base_obj.clone())).is_err() {
            log::warn!("settings: stored {k} is not valid, using its default");
            if let Some(p) = previous {
                base_obj.insert(k.clone(), p);
            }
        }
    }
    match serde_json::from_value::<Settings>(base) {
        Ok(s) => Ok(s),
        Err(e) => {
            log::warn!("settings: stored value unreadable ({e}), using defaults");
            Ok(defaults.clone())
        }
    }
}

/// Persists the whole settings object.
pub fn put(conn: &Connection, settings: &Settings, now_ms: i64) -> Result<(), AppError> {
    write_raw(conn, APP_KEY, &serde_json::to_string(settings)?, now_ms)
}

/// First launch: stores `defaults` if nothing is stored yet; returns the effective settings.
pub fn ensure(conn: &Connection, defaults: &Settings, now_ms: i64) -> Result<Settings, AppError> {
    if read_raw(conn, APP_KEY)?.is_none() {
        put(conn, defaults, now_ms)?;
    }
    get(conn, defaults)
}

fn validate(patch: &SettingsPatch) -> Result<(), AppError> {
    if let Some(w) = patch.calendar_weeks
        && !(2..=4).contains(&w)
    {
        return Err(AppError::invalid(format!(
            "calendarWeeks must be 2, 3 or 4, got {w}"
        )));
    }
    if let Some(s) = &patch.shortcut
        && s.trim().is_empty()
    {
        return Err(AppError::invalid("shortcut must not be empty"));
    }
    if let Some(tz) = &patch.timezone
        && !crate::clock::is_valid_timezone(tz)
    {
        return Err(AppError::invalid(format!(
            "timezone must be \"system\" or an IANA zone name, got {tz:?}"
        )));
    }
    Ok(())
}

/// Applies `patch` on top of the stored settings and persists the result. Returns `(old, new)`
/// so the caller can run side effects only for fields that actually changed.
pub fn merge(
    conn: &Connection,
    defaults: &Settings,
    patch: &SettingsPatch,
    now_ms: i64,
) -> Result<(Settings, Settings), AppError> {
    validate(patch)?;
    let old = get(conn, defaults)?;
    let new = old.apply(patch);
    put(conn, &new, now_ms)?;
    Ok((old, new))
}

/// This install's device id (created on first call; used later as the LWW tie-breaker).
pub fn device_id(conn: &Connection, now_ms: i64) -> Result<String, AppError> {
    if let Some(raw) = read_raw(conn, DEVICE_ID_KEY)? {
        return Ok(serde_json::from_str(&raw)?);
    }
    let id = super::new_id();
    write_raw(conn, DEVICE_ID_KEY, &serde_json::to_string(&id)?, now_ms)?;
    Ok(id)
}

fn check_cache_key(key: &str) -> Result<(), AppError> {
    if key.starts_with(CACHE_PREFIX) && key.len() > CACHE_PREFIX.len() {
        Ok(())
    } else {
        Err(AppError::invalid(format!(
            "cache key must start with {CACHE_PREFIX:?}, got {key:?}"
        )))
    }
}

/// Reads a `cache:*` entry (opaque string, e.g. downloaded holiday JSON).
pub fn get_cache(conn: &Connection, key: &str) -> Result<Option<String>, AppError> {
    check_cache_key(key)?;
    match read_raw(conn, key)? {
        None => Ok(None),
        Some(raw) => Ok(Some(serde_json::from_str(&raw)?)),
    }
}

/// Writes a `cache:*` entry.
pub fn set_cache(conn: &Connection, key: &str, value: &str, now_ms: i64) -> Result<(), AppError> {
    check_cache_key(key)?;
    write_raw(conn, key, &serde_json::to_string(value)?, now_ms)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn defaults_by_platform_and_identity() {
        let mac_rel = defaults(Platform::Macos, false);
        assert_eq!(mac_rel.shortcut, "Control+Alt+Space");
        assert!(mac_rel.autostart);
        let mac_dev = defaults(Platform::Macos, true);
        assert_eq!(mac_dev.shortcut, "Control+Alt+Shift+Space");
        assert!(!mac_dev.autostart);
        assert_eq!(
            defaults(Platform::Windows, false).shortcut,
            "Control+Alt+Space"
        );
        assert_eq!(
            defaults(Platform::Windows, true).shortcut,
            "Control+Alt+Shift+Space"
        );
        let rest = Settings {
            shortcut: "Control+Alt+Space".into(),
            autostart: false,
            ..mac_rel
        };
        assert_eq!(
            rest,
            Settings::fixture(),
            "everything else matches the fixture"
        );
    }

    #[test]
    fn ensure_writes_once_and_merge_patches() {
        let db = Db::open_in_memory().unwrap();
        let d = defaults(Platform::Macos, true);
        let s = db.with_conn(|c| ensure(c, &d, 1)).unwrap();
        assert_eq!(s, d);
        let (old, new) = db
            .with_conn(|c| {
                merge(
                    c,
                    &d,
                    &SettingsPatch {
                        last_page: Some(LastPage::Tasks),
                        ..Default::default()
                    },
                    2,
                )
            })
            .unwrap();
        assert_eq!(old.last_page, LastPage::Calendar);
        assert_eq!(new.last_page, LastPage::Tasks);
        // A second patch keeps the first one (no lost update).
        let (_, newer) = db
            .with_conn(|c| {
                merge(
                    c,
                    &d,
                    &SettingsPatch {
                        calendar_weeks: Some(4),
                        ..Default::default()
                    },
                    3,
                )
            })
            .unwrap();
        assert_eq!(newer.last_page, LastPage::Tasks);
        assert_eq!(newer.calendar_weeks, 4);
        // ensure() does not reset stored settings.
        let again = db.with_conn(|c| ensure(c, &d, 4)).unwrap();
        assert_eq!(again, newer);
    }

    #[test]
    fn merge_rejects_invalid_patch() {
        let db = Db::open_in_memory().unwrap();
        let d = Settings::fixture();
        let err = db
            .with_conn(|c| {
                merge(
                    c,
                    &d,
                    &SettingsPatch {
                        calendar_weeks: Some(5),
                        ..Default::default()
                    },
                    1,
                )
            })
            .unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::Invalid);
    }

    #[test]
    fn old_stored_json_missing_fields_keeps_defaults() {
        let db = Db::open_in_memory().unwrap();
        db.with_conn(|c| {
            write_raw(c, APP_KEY, r#"{"theme":"dark","unknownField":1}"#, 1)?;
            Ok(())
        })
        .unwrap();
        let s = db.with_conn(|c| get(c, &Settings::fixture())).unwrap();
        assert_eq!(s.theme, Theme::Dark);
        assert_eq!(s.calendar_weeks, 3);
    }

    #[test]
    fn old_stored_json_without_new_fields_gets_their_defaults() {
        let db = Db::open_in_memory().unwrap();
        // Shape written by v0.1 (before language / calendarFirstRow existed).
        db.with_conn(|c| {
            write_raw(
                c,
                APP_KEY,
                r#"{"shortcut":"Control+Alt+Space","theme":"light","hideOnBlur":false,"autostart":true,"calendarWeeks":4,"lastPage":"tasks","todoDoneCollapsed":true,"onboardingShortcutHintSeen":true}"#,
                1,
            )?;
            Ok(())
        })
        .unwrap();
        let s = db.with_conn(|c| get(c, &Settings::fixture())).unwrap();
        assert_eq!(s.theme, Theme::Light);
        assert_eq!(s.calendar_weeks, 4);
        assert_eq!(s.last_page, LastPage::Tasks);
        assert_eq!(s.language, Language::System);
        assert_eq!(s.calendar_first_row, CalendarFirstRow::ThisWeek);
    }

    #[test]
    fn v0_1_language_zh_cn_reads_as_zh_hans() {
        let db = Db::open_in_memory().unwrap();
        db.with_conn(|c| {
            write_raw(c, APP_KEY, r#"{"language":"zh-CN"}"#, 1)?;
            Ok(())
        })
        .unwrap();
        let s = db.with_conn(|c| get(c, &Settings::fixture())).unwrap();
        assert_eq!(s.language, Language::ZhHans);
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains(r#""language":"zh-Hans""#), "{json}");
    }

    #[test]
    fn unknown_stored_values_fall_back_per_field() {
        let db = Db::open_in_memory().unwrap();
        db.with_conn(|c| {
            write_raw(
                c,
                APP_KEY,
                r#"{"theme":"dark","language":"fr","calendarFirstRow":"nextWeek","calendarWeeks":4}"#,
                1,
            )?;
            Ok(())
        })
        .unwrap();
        let s = db.with_conn(|c| get(c, &Settings::fixture())).unwrap();
        assert_eq!(s.theme, Theme::Dark, "valid fields survive a bad neighbour");
        assert_eq!(s.calendar_weeks, 4);
        assert_eq!(s.language, Language::System);
        assert_eq!(s.calendar_first_row, CalendarFirstRow::ThisWeek);
    }

    #[test]
    fn non_object_stored_json_uses_defaults() {
        let db = Db::open_in_memory().unwrap();
        db.with_conn(|c| {
            write_raw(c, APP_KEY, "[1,2]", 1)?;
            Ok(())
        })
        .unwrap();
        let d = Settings::fixture();
        assert_eq!(db.with_conn(|c| get(c, &d)).unwrap(), d);
    }

    #[test]
    fn merge_patches_language_and_first_row() {
        let db = Db::open_in_memory().unwrap();
        let d = defaults(Platform::Macos, true);
        db.with_conn(|c| ensure(c, &d, 1)).unwrap();
        let (_, a) = db
            .with_conn(|c| {
                merge(
                    c,
                    &d,
                    &SettingsPatch {
                        language: Some(Language::En),
                        ..Default::default()
                    },
                    2,
                )
            })
            .unwrap();
        assert_eq!(a.language, Language::En);
        let (_, b) = db
            .with_conn(|c| {
                merge(
                    c,
                    &d,
                    &SettingsPatch {
                        calendar_first_row: Some(CalendarFirstRow::LastWeek),
                        ..Default::default()
                    },
                    3,
                )
            })
            .unwrap();
        assert_eq!(b.language, Language::En, "the first patch is kept");
        assert_eq!(b.calendar_first_row, CalendarFirstRow::LastWeek);
        assert_eq!(db.with_conn(|c| get(c, &d)).unwrap(), b);
    }

    #[test]
    fn device_id_is_stable() {
        let db = Db::open_in_memory().unwrap();
        let a = db.with_conn(|c| device_id(c, 1)).unwrap();
        let b = db.with_conn(|c| device_id(c, 2)).unwrap();
        assert_eq!(a, b);
        assert_eq!(a.len(), 36);
    }

    #[test]
    fn cache_only_accepts_cache_prefix() {
        let db = Db::open_in_memory().unwrap();
        db.with_conn(|c| set_cache(c, "cache:holidays", "{\"2026\":[]}", 1))
            .unwrap();
        assert_eq!(
            db.with_conn(|c| get_cache(c, "cache:holidays"))
                .unwrap()
                .as_deref(),
            Some("{\"2026\":[]}")
        );
        assert_eq!(
            db.with_conn(|c| get_cache(c, "cache:missing")).unwrap(),
            None
        );
        assert!(db.with_conn(|c| get_cache(c, "app")).is_err());
        assert!(db.with_conn(|c| set_cache(c, "device_id", "x", 1)).is_err());
    }
}
