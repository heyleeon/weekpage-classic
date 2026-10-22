//! Helpers shared by the integration tests (each test crate uses a subset).
#![allow(dead_code)]

use rusqlite::Transaction;
use weekpage::clock::Clock;
use weekpage::db::{Db, Op, history, journal, snapshot};
use weekpage::error::{AppError, ErrorCode};
use weekpage::model::{Mutation, Settings, Snapshot, TaskEvent, TaskEventType};
use weekpage::test_support::{fixed_clock, open_memory_db, seeded_db};

/// The demo "now": 2026-09-30 10:00 local (the seed's clock).
pub const NOW: &str = "2026-09-30T10:00";
pub const TODAY: &str = "2026-09-30";

pub fn clock() -> Clock {
    fixed_clock(NOW)
}

pub fn later() -> Clock {
    fixed_clock("2026-09-30T10:05")
}

pub fn seeded() -> Db {
    seeded_db()
}

pub fn empty() -> Db {
    open_memory_db()
}

/// Runs one repository call as a business write (`Db::with_op`) with `clock`.
pub fn run(
    db: &Db,
    clock: &Clock,
    f: impl FnOnce(&Transaction<'_>, &mut Op, &Clock) -> Result<Option<String>, AppError>,
) -> Result<Mutation, AppError> {
    db.with_op(|tx, op| f(tx, op, clock))
}

/// Like [`run`] but unwraps; returns `(op_id, id)`.
pub fn ok(
    db: &Db,
    clock: &Clock,
    f: impl FnOnce(&Transaction<'_>, &mut Op, &Clock) -> Result<Option<String>, AppError>,
) -> (String, String) {
    let m = run(db, clock, f).expect("write should succeed");
    (m.op_id, m.id.expect("write returns the row id"))
}

/// Like [`run`] but expects an error with `code`; returns the message.
pub fn fails(
    db: &Db,
    clock: &Clock,
    code: ErrorCode,
    f: impl FnOnce(&Transaction<'_>, &mut Op, &Clock) -> Result<Option<String>, AppError>,
) -> String {
    let err = run(db, clock, f).expect_err("write should fail");
    assert_eq!(err.code, code, "unexpected error: {}", err.message);
    err.message
}

pub fn snap(db: &Db) -> Snapshot {
    db.with_conn(|c| snapshot::load(c, &Settings::fixture()))
        .unwrap()
}

pub fn undo(db: &Db, op_ids: &[String], clock: &Clock) {
    let now = clock.now_ms();
    db.with_tx(|tx| journal::undo(tx, op_ids, now)).unwrap();
}

pub fn history_of(db: &Db, task_id: &str) -> Vec<TaskEvent> {
    db.with_conn(|c| history::list(c, task_id)).unwrap()
}

pub fn history_kinds(db: &Db, task_id: &str) -> Vec<TaskEventType> {
    history_of(db, task_id)
        .into_iter()
        .map(|e| e.kind)
        .collect()
}

/// Raw column value of any row, deleted ones included.
pub fn raw<T: rusqlite::types::FromSql>(db: &Db, table: &str, col: &str, id: &str) -> T {
    db.with_conn(|c| {
        Ok(c.query_row(
            &format!("SELECT {col} FROM {table} WHERE id = ?1"),
            [id],
            |r| r.get(0),
        )?)
    })
    .unwrap()
}

pub fn task_id_by_title(s: &Snapshot, title: &str) -> String {
    s.tasks
        .iter()
        .find(|t| t.title == title)
        .unwrap_or_else(|| panic!("task {title}"))
        .id
        .clone()
}

pub fn todo_id_by_title(s: &Snapshot, title: &str) -> String {
    s.todos
        .iter()
        .find(|t| t.title == title)
        .unwrap_or_else(|| panic!("todo {title}"))
        .id
        .clone()
}

pub fn kp_id_by_text(s: &Snapshot, text: &str) -> String {
    s.key_points
        .iter()
        .find(|k| k.text == text)
        .unwrap_or_else(|| panic!("key point {text}"))
        .id
        .clone()
}

/// Ids of the open todos in list order.
pub fn open_todos(s: &Snapshot) -> Vec<String> {
    s.todos
        .iter()
        .filter(|t| t.done_date.is_none())
        .map(|t| t.id.clone())
        .collect()
}

/// Ids of the unarchived cards of `column`, top to bottom.
pub fn column(s: &Snapshot, column: u8) -> Vec<String> {
    s.tasks
        .iter()
        .filter(|t| t.archived_at.is_none() && t.board_column == column)
        .map(|t| t.id.clone())
        .collect()
}

/// Ids of a task's timeline (key points and notes) in order.
pub fn timeline(s: &Snapshot, task_id: &str) -> Vec<String> {
    s.key_points
        .iter()
        .filter(|k| k.task_id == task_id)
        .map(|k| k.id.clone())
        .collect()
}

/// Tiny deterministic PRNG (no extra crate).
pub struct Lcg(pub u64);

impl Lcg {
    pub fn next(&mut self, bound: usize) -> usize {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        ((self.0 >> 33) as usize) % bound
    }
}
