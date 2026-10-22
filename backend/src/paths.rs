//! The only place that decides where data and logs live.
//!
//! - debug builds: `<repo>/data` and `<repo>/logs`, overridable with `WEEKPAGE_DATA_DIR` /
//!   `WEEKPAGE_LOG_DIR`, so development never touches the data of the installed app;
//! - release builds: the OS app data / log directories (already isolated per identifier).

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime};

use crate::error::AppError;

pub const DATA_DIR_ENV: &str = "WEEKPAGE_DATA_DIR";
pub const LOG_DIR_ENV: &str = "WEEKPAGE_LOG_DIR";
/// Still the pre-rename name (the app was called task-desk until 2026-10-01): renaming the file
/// would make WeekPage start on an empty database after the old app data folder is copied into
/// the new identifier's folder as is. Daily backups share the stem (`db::Db::backup_if_needed`).
pub const DB_FILE: &str = "task-desk.db";
pub const BACKUPS_DIR: &str = "backups";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Paths {
    pub data_dir: PathBuf,
    pub log_dir: PathBuf,
}

impl Paths {
    pub fn db_file(&self) -> PathBuf {
        self.data_dir.join(DB_FILE)
    }

    pub fn backups_dir(&self) -> PathBuf {
        self.data_dir.join(BACKUPS_DIR)
    }
}

/// Repository root (the parent of `backend/`), known at compile time.
pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")))
}

/// Resolves the paths for the running app.
pub fn resolve<R: Runtime>(app: &AppHandle<R>) -> Result<Paths, AppError> {
    if cfg!(debug_assertions) {
        Ok(debug_paths(&repo_root(), |k| std::env::var(k).ok()))
    } else {
        Ok(Paths {
            data_dir: app.path().app_data_dir()?,
            log_dir: app.path().app_log_dir()?,
        })
    }
}

/// Debug layout: `<root>/data`, `<root>/logs`, each overridable by a non-empty env var.
pub fn debug_paths(root: &Path, env: impl Fn(&str) -> Option<String>) -> Paths {
    let pick = |key: &str, default: PathBuf| {
        env(key)
            .filter(|v| !v.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or(default)
    };
    Paths {
        data_dir: pick(DATA_DIR_ENV, root.join("data")),
        log_dir: pick(LOG_DIR_ENV, root.join("logs")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_defaults_to_repo_root() {
        let p = debug_paths(Path::new("/repo"), |_| None);
        assert_eq!(p.data_dir, PathBuf::from("/repo/data"));
        assert_eq!(p.log_dir, PathBuf::from("/repo/logs"));
        assert_eq!(p.db_file(), PathBuf::from("/repo/data/task-desk.db"));
        assert_eq!(p.backups_dir(), PathBuf::from("/repo/data/backups"));
    }

    #[test]
    fn env_overrides_win_and_blank_is_ignored() {
        let p = debug_paths(Path::new("/repo"), |k| match k {
            DATA_DIR_ENV => Some("/tmp/wp-data".into()),
            LOG_DIR_ENV => Some("  ".into()),
            _ => None,
        });
        assert_eq!(p.data_dir, PathBuf::from("/tmp/wp-data"));
        assert_eq!(p.log_dir, PathBuf::from("/repo/logs"));
    }

    #[test]
    fn repo_root_is_parent_of_backend() {
        assert!(repo_root().join("backend").join("Cargo.toml").exists());
    }
}
