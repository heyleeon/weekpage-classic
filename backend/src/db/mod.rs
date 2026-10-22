//! SQLite storage: the only write path of the app (architecture §3, §6.2).
//!
//! One `Mutex<Connection>` shared by commands and the reminder heartbeat. Every business write
//! runs through [`Db::with_op`]: one transaction, one `op_id`, a before-image of every touched row
//! in `undo_journal` (see [`journal`]), so any Toast action can be undone with `undo(opIds)`.
//!
//! Modules: `journal / sort_key / snapshot / settings / history` are the shared infrastructure;
//! `events / todos / inbox / tasks / key_points / calendar` are the write repositories (their
//! contract: architecture §6.2).

pub mod calendar;
pub mod events;
pub mod history;
pub mod inbox;
pub mod journal;
pub mod key_points;
pub mod settings;
pub mod snapshot;
pub mod sort_key;
pub mod tasks;
pub mod todos;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use include_dir::{Dir, include_dir};
use rusqlite::{Connection, Transaction, TransactionBehavior};
use rusqlite_migration::Migrations;

use crate::clock::Clock;
use crate::error::AppError;
use crate::model::Mutation;

pub use journal::Op;

static MIGRATIONS_DIR: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/migrations");

/// Backups kept in `data/backups/` (one per day).
pub const BACKUPS_KEPT: usize = 7;
/// Undo journal retention.
pub const JOURNAL_RETENTION_MS: i64 = 24 * 60 * 60 * 1000;

/// A new UUIDv7 primary key (36 chars, lowercase, hyphenated).
pub fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

/// All migrations compiled into the binary from `backend/migrations/NNNN-name/up.sql`.
pub fn migrations() -> Result<Migrations<'static>, AppError> {
    Ok(Migrations::from_directory(&MIGRATIONS_DIR)?)
}

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    /// Opens (creating if needed) the database file and migrates it to the latest version.
    pub fn open(path: &Path) -> Result<Db, AppError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        Self::init(conn)
    }

    /// An in-memory database with the full schema (tests, previews).
    pub fn open_in_memory() -> Result<Db, AppError> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(mut conn: Connection) -> Result<Db, AppError> {
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "busy_timeout", 3000)?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        migrations()?.to_latest(&mut conn)?;
        Ok(Db {
            conn: Mutex::new(conn),
        })
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>, AppError> {
        self.conn
            .lock()
            .map_err(|_| AppError::db("database mutex poisoned"))
    }

    /// Read access (no transaction).
    pub fn with_conn<T>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let conn = self.lock()?;
        f(&conn)
    }

    /// A write transaction without undo bookkeeping (settings, cache, undo replay, seed).
    pub fn with_tx<T>(
        &self,
        f: impl FnOnce(&Transaction<'_>) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let mut conn = self.lock()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let out = f(&tx)?;
        tx.commit()?;
        Ok(out)
    }

    /// Runs one business write: transaction → new `op_id` → closure → commit.
    /// The closure returns the id of the created / changed row (becomes `Mutation.id`).
    pub fn with_op(
        &self,
        f: impl FnOnce(&Transaction<'_>, &mut Op) -> Result<Option<String>, AppError>,
    ) -> Result<Mutation, AppError> {
        let mut conn = self.lock()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut op = Op::new();
        let id = f(&tx, &mut op)?;
        tx.commit()?;
        Ok(Mutation {
            op_id: op.id().to_string(),
            id,
        })
    }

    /// True when no business rows exist at all (deleted ones included).
    pub fn is_empty(&self) -> Result<bool, AppError> {
        self.with_conn(|c| {
            let n: i64 = c.query_row(
                "SELECT (SELECT count(*) FROM events) + (SELECT count(*) FROM todos)
                      + (SELECT count(*) FROM inbox_items) + (SELECT count(*) FROM tasks)",
                [],
                |r| r.get(0),
            )?;
            Ok(n == 0)
        })
    }

    /// Writes `backups/task-desk-YYYYMMDD.db` once per local day (`VACUUM INTO`) and keeps the
    /// newest [`BACKUPS_KEPT`]. Returns the path when a backup was written. The stem is the
    /// database file's pre-rename name (`paths::DB_FILE`), so backups copied over from the old
    /// app data folder stay under the same retention.
    pub fn backup_if_needed(
        &self,
        backups_dir: &Path,
        clock: &Clock,
    ) -> Result<Option<PathBuf>, AppError> {
        std::fs::create_dir_all(backups_dir)?;
        let stamp = clock.today().replace('-', "");
        let target = backups_dir.join(format!("task-desk-{stamp}.db"));
        if target.exists() {
            return Ok(None);
        }
        let target_str = target
            .to_str()
            .ok_or_else(|| AppError::platform("backup path is not valid UTF-8"))?;
        self.with_conn(|c| {
            c.execute("VACUUM INTO ?1", [target_str])?;
            Ok(())
        })?;
        prune_backups(backups_dir, BACKUPS_KEPT)?;
        Ok(Some(target))
    }

    /// Drops undo journal entries older than 24 hours of wall-clock time (journal rows are stamped
    /// by the DDL default, i.e. the wall clock, not the possibly faked app clock).
    /// Returns the number of rows removed.
    pub fn prune_journal(&self) -> Result<usize, AppError> {
        let cutoff = chrono::Utc::now().timestamp_millis() - JOURNAL_RETENTION_MS;
        self.with_conn(|c| journal::prune(c, cutoff))
    }
}

/// Keeps the newest `keep` files named `task-desk-YYYYMMDD.db` in `dir`.
fn prune_backups(dir: &Path, keep: usize) -> Result<(), AppError> {
    let mut names: Vec<PathBuf> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("task-desk-") && n.ends_with(".db"))
        })
        .collect();
    names.sort();
    let excess = names.len().saturating_sub(keep);
    for old in names.into_iter().take(excess) {
        std::fs::remove_file(old)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_valid_and_idempotent() {
        migrations().unwrap().validate().unwrap();
        let mut conn = Connection::open_in_memory().unwrap();
        let m = migrations().unwrap();
        m.to_latest(&mut conn).unwrap();
        m.to_latest(&mut conn).unwrap();
        let tables: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name IN
                 ('events','todos','inbox_items','tasks','key_points','task_events',
                  'calendar_day_orders','settings','undo_journal')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tables, 9);
    }

    #[test]
    fn new_ids_are_v7_and_time_ordered() {
        let a = new_id();
        let b = new_id();
        assert_eq!(a.len(), 36);
        assert_eq!(&a[14..15], "7");
        assert!(a < b);
    }

    #[test]
    fn with_op_commits_and_returns_mutation() {
        let db = Db::open_in_memory().unwrap();
        let m = db
            .with_op(|tx, op| {
                tx.execute(
                    "INSERT INTO inbox_items (id, text, sort_key, created_at, updated_at)
                     VALUES ('i1', 'hello', 'V', 1, 1)",
                    [],
                )?;
                op.created(tx, "inbox_items", "i1")?;
                Ok(Some("i1".to_string()))
            })
            .unwrap();
        assert_eq!(m.id.as_deref(), Some("i1"));
        assert_eq!(m.op_id.len(), 36);
        assert!(!db.is_empty().unwrap());
    }

    #[test]
    fn with_op_rolls_back_on_error() {
        let db = Db::open_in_memory().unwrap();
        let r = db.with_op(|tx, _op| {
            tx.execute(
                "INSERT INTO inbox_items (id, text, sort_key, created_at, updated_at)
                 VALUES ('i1', 'hello', 'V', 1, 1)",
                [],
            )?;
            Err(AppError::invalid("boom"))
        });
        assert!(r.is_err());
        assert!(db.is_empty().unwrap());
    }

    #[test]
    fn backup_once_per_day_and_pruned() {
        let dir = std::env::temp_dir().join(format!("td-backup-test-{}", new_id()));
        let db = Db::open(&dir.join("task-desk.db")).unwrap();
        let backups = dir.join("backups");
        std::fs::create_dir_all(&backups).unwrap();
        for d in 1..=8 {
            std::fs::write(backups.join(format!("task-desk-202609{d:02}.db")), b"x").unwrap();
        }
        let clock = Clock::fixed("2026-09-30T10:00");
        let first = db.backup_if_needed(&backups, &clock).unwrap();
        assert!(first.is_some());
        assert!(db.backup_if_needed(&backups, &clock).unwrap().is_none());
        let mut left: Vec<String> = std::fs::read_dir(&backups)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        left.sort();
        assert_eq!(left.len(), BACKUPS_KEPT);
        assert_eq!(left.last().unwrap(), "task-desk-20260930.db");
        assert_eq!(left.first().unwrap(), "task-desk-20260903.db");
        std::fs::remove_dir_all(&dir).ok();
    }
}
