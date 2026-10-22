//! Logging: tauri-plugin-log writing to file + stdout + webview console.
//!
//! The file name carries the launch date (`weekpage-YYYYMMDD.log`) and rotates at 5 MB keeping
//! 7 files. This approximates "one file per day" (spine ⑧), which the plugin cannot do.
//! Log text is English only (spine ⑬, enforced by scripts/check-no-cjk.py).

use tauri::{AppHandle, Runtime};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

use crate::error::AppError;
use crate::paths::Paths;

const MAX_FILE_BYTES: u128 = 5 * 1024 * 1024;
const KEEP_FILES: usize = 7;

/// Log file stem for a launch on `date_yyyymmdd`, e.g. `weekpage-20260930`.
pub fn file_stem(date_yyyymmdd: &str) -> String {
    format!("weekpage-{date_yyyymmdd}")
}

/// Level from `RUST_LOG` (a plain level name such as `debug`); defaults to info.
pub fn level_from_env(raw: Option<&str>) -> log::LevelFilter {
    match raw.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("off") => log::LevelFilter::Off,
        Some("error") => log::LevelFilter::Error,
        Some("warn") => log::LevelFilter::Warn,
        Some("debug") => log::LevelFilter::Debug,
        Some("trace") => log::LevelFilter::Trace,
        _ => log::LevelFilter::Info,
    }
}

/// Registers the log plugin on a running app (called first thing in `setup`, once paths are known).
pub fn init<R: Runtime>(app: &AppHandle<R>, paths: &Paths) -> Result<(), AppError> {
    let stem = file_stem(&chrono::Local::now().format("%Y%m%d").to_string());
    let level = level_from_env(std::env::var("RUST_LOG").ok().as_deref());
    let plugin = tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets([
            Target::new(TargetKind::Folder {
                path: paths.log_dir.clone(),
                file_name: Some(stem),
            }),
            Target::new(TargetKind::Stdout),
            Target::new(TargetKind::Webview),
        ])
        .level(level)
        .max_file_size(MAX_FILE_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(KEEP_FILES))
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .build();
    app.plugin(plugin)?;
    log::info!("logging to {} (level {level})", paths.log_dir.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_stem_has_launch_date() {
        assert_eq!(file_stem("20260930"), "weekpage-20260930");
    }

    #[test]
    fn level_defaults_to_info() {
        assert_eq!(level_from_env(None), log::LevelFilter::Info);
        assert_eq!(level_from_env(Some("nonsense")), log::LevelFilter::Info);
        assert_eq!(level_from_env(Some("DEBUG")), log::LevelFilter::Debug);
    }
}
