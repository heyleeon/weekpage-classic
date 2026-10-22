//! Tasks (任务) write repository.
//!
//! Repository contract (architecture §6.2): `fn(tx, op, clock, …) -> Result<Option<String>, AppError>`;
//! call `op.capture(tx, table, &id)?` before changing a row and `op.created(tx, table, &id)?`
//! after inserting one; INSERT writes `created_at = updated_at = clock.now_ms()`, UPDATE writes
//! `updated_at`; deletes are soft (`deleted_at`). Return the id of the created / changed row.
//!
//! Each board column is its own ordered list (`board_column`, `sort_key`). Every write that
//! changes what the task is records history; moves and deletes have no history type in the DDL.

use rusqlite::types::Value;
use rusqlite::{OptionalExtension, Transaction, params};
use serde_json::json;

use crate::clock::Clock;
use crate::error::AppError;
use crate::model::{NewTaskInput, Task, TaskStatus};

use super::events::repo::{self, Scope};
use super::{Op, history, key_points, snapshot};

/// Max characters of a task title (DDL CHECK).
pub const TITLE_MAX: usize = 200;
/// Max characters of an archive summary (DDL CHECK).
pub const SUMMARY_MAX: usize = 100;

fn column_scope(column: u8) -> Scope {
    Scope::filtered("tasks", "board_column", Value::Integer(i64::from(column)))
}

fn check_column(column: u8) -> Result<u8, AppError> {
    if column <= 2 {
        Ok(column)
    } else {
        Err(AppError::invalid(format!(
            "board column must be 0, 1 or 2, got {column}"
        )))
    }
}

/// A live task, or `not_found`.
fn load(tx: &Transaction<'_>, id: &str) -> Result<Task, AppError> {
    tx.query_row(
        "SELECT * FROM tasks WHERE id = ?1 AND deleted_at IS NULL",
        [id],
        snapshot::task,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found(format!("task {id} not found")))
}

fn check_dates(start: &str, due: Option<&str>) -> Result<(), AppError> {
    match due {
        Some(d) if d < start => Err(AppError::invalid(format!(
            "due date {d} is before start date {start}"
        ))),
        _ => Ok(()),
    }
}

/// `create_task`: top of `input.column`; creates key points; history `created` (payload carries `fromInbox`); with `from_inbox_id`, soft-delete that inbox item in the same transaction.
pub fn create(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    input: NewTaskInput,
) -> Result<Option<String>, AppError> {
    let title = repo::text(&input.title, "title", TITLE_MAX)?;
    let start = repo::date(&input.start_date, "start date")?;
    let due = repo::opt_date(input.due_date, "due date")?;
    check_dates(&start, due.as_deref())?;
    let column = check_column(input.column)?;
    let kps = input
        .key_points
        .into_iter()
        .map(|k| key_points::validate(clock, k))
        .collect::<Result<Vec<_>, _>>()?;
    let from_inbox = input.from_inbox_id;
    if let Some(inbox_id) = from_inbox.as_deref() {
        super::inbox::take(tx, op, clock, inbox_id)?;
    }

    let key = column_scope(column).before_first(tx)?;
    let id = super::new_id();
    let now = clock.now_ms();
    tx.execute(
        "INSERT INTO tasks (id, title, status, start_date, due_date, remind_day_before,
                            board_column, sort_key, created_at, updated_at)
         VALUES (?1, ?2, 'active', ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![
            id,
            title,
            start,
            due,
            input.remind_day_before,
            column,
            key,
            now
        ],
    )?;
    op.created(tx, "tasks", &id)?;

    let kp_scope = key_points::scope(&id);
    for row in &kps {
        let k = kp_scope.after_last(tx)?;
        key_points::insert(tx, op, clock, &id, row, &k)?;
    }
    history::record(
        tx,
        op,
        clock,
        &id,
        "created",
        json!({
            "title": title,
            "startDate": start,
            "dueDate": due,
            "keyPoints": kps.len(),
            "fromInbox": from_inbox.is_some(),
        }),
    )?;
    Ok(Some(id))
}

/// `rename_task`: history `renamed`.
pub fn rename(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    id: String,
    title: String,
) -> Result<Option<String>, AppError> {
    let task = load(tx, &id)?;
    let title = repo::text(&title, "title", TITLE_MAX)?;
    op.capture(tx, "tasks", &id)?;
    tx.execute(
        "UPDATE tasks SET title = ?1, updated_at = ?2 WHERE id = ?3",
        params![title, clock.now_ms(), id],
    )?;
    history::record(
        tx,
        op,
        clock,
        &id,
        "renamed",
        json!({ "from": task.title, "to": title }),
    )?;
    Ok(Some(id))
}

/// `set_task_status`: `done` writes `done_at / done_date`, other values clear them; history `status`.
///
/// Setting the status it already has changes nothing (a done task keeps its completion day) and
/// records no history.
pub fn set_status(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    id: String,
    status: TaskStatus,
) -> Result<Option<String>, AppError> {
    let task = load(tx, &id)?;
    op.capture(tx, "tasks", &id)?;
    let now = clock.now_ms();
    if task.status == status {
        tx.execute(
            "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        return Ok(Some(id));
    }
    if status == TaskStatus::Done {
        tx.execute(
            "UPDATE tasks SET status = 'done', done_at = ?1, done_date = ?2, updated_at = ?1
             WHERE id = ?3",
            params![now, clock.today(), id],
        )?;
    } else {
        tx.execute(
            "UPDATE tasks SET status = ?1, done_at = NULL, done_date = NULL, updated_at = ?2
             WHERE id = ?3",
            params![status.as_str(), now, id],
        )?;
    }
    history::record(
        tx,
        op,
        clock,
        &id,
        "status",
        json!({ "from": task.status.as_str(), "to": status.as_str() }),
    )?;
    Ok(Some(id))
}

/// `set_task_dates`: validate due >= start; clearing the due date stores it in `last_due_date`; clears `remind_notified_at`; history `dates`.
pub fn set_dates(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    id: String,
    start_date: String,
    due_date: Option<String>,
) -> Result<Option<String>, AppError> {
    let task = load(tx, &id)?;
    let start = repo::date(&start_date, "start date")?;
    let due = repo::opt_date(due_date, "due date")?;
    check_dates(&start, due.as_deref())?;
    let last_due = match (&due, &task.due_date) {
        (None, Some(old)) => Some(old.clone()),
        _ => task.last_due_date.clone(),
    };
    op.capture(tx, "tasks", &id)?;
    tx.execute(
        "UPDATE tasks SET start_date = ?1, due_date = ?2, last_due_date = ?3,
                          remind_notified_at = NULL, updated_at = ?4
         WHERE id = ?5",
        params![start, due, last_due, clock.now_ms(), id],
    )?;
    history::record(
        tx,
        op,
        clock,
        &id,
        "dates",
        json!({
            "from": { "startDate": task.start_date, "dueDate": task.due_date },
            "to": { "startDate": start, "dueDate": due },
        }),
    )?;
    Ok(Some(id))
}

/// `set_task_remind`: clears `remind_notified_at`; history `remind`.
pub fn set_remind(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    id: String,
    remind_day_before: bool,
) -> Result<Option<String>, AppError> {
    let task = load(tx, &id)?;
    op.capture(tx, "tasks", &id)?;
    tx.execute(
        "UPDATE tasks SET remind_day_before = ?1, remind_notified_at = NULL, updated_at = ?2
         WHERE id = ?3",
        params![remind_day_before, clock.now_ms(), id],
    )?;
    history::record(
        tx,
        op,
        clock,
        &id,
        "remind",
        json!({ "from": task.remind_day_before, "to": remind_day_before }),
    )?;
    Ok(Some(id))
}

/// Board neighbours must be live, unarchived cards of the target column.
fn check_board_neighbour(
    tx: &Transaction<'_>,
    id: Option<&str>,
    column: u8,
) -> Result<(), AppError> {
    let Some(id) = id else { return Ok(()) };
    let ok: Option<i64> = tx
        .query_row(
            "SELECT 1 FROM tasks WHERE id = ?1 AND deleted_at IS NULL AND archived_at IS NULL
                                   AND board_column = ?2",
            params![id, column],
            |r| r.get(0),
        )
        .optional()?;
    ok.map(|_| ()).ok_or_else(|| {
        AppError::not_found(format!(
            "neighbour task {id} is not a card of column {column}"
        ))
    })
}

/// `move_task`: cross-column / in-column move.
pub fn move_task(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    id: String,
    column: u8,
    prev_id: Option<String>,
    next_id: Option<String>,
) -> Result<Option<String>, AppError> {
    let task = load(tx, &id)?;
    if task.archived_at.is_some() {
        return Err(AppError::invalid("an archived task is not on the board"));
    }
    let column = check_column(column)?;
    check_board_neighbour(tx, prev_id.as_deref(), column)?;
    check_board_neighbour(tx, next_id.as_deref(), column)?;
    let key = column_scope(column).move_key(tx, &id, prev_id.as_deref(), next_id.as_deref())?;
    op.capture(tx, "tasks", &id)?;
    tx.execute(
        "UPDATE tasks SET board_column = ?1, sort_key = ?2, updated_at = ?3 WHERE id = ?4",
        params![column, key, clock.now_ms(), id],
    )?;
    Ok(Some(id))
}

/// `archive_task`: write `archived_at / archived_date`; history `archived`.
pub fn archive(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    id: String,
    summary: Option<String>,
) -> Result<Option<String>, AppError> {
    let task = load(tx, &id)?;
    if task.archived_at.is_some() {
        return Err(AppError::invalid(format!("task {id} is already archived")));
    }
    let summary = repo::opt_text(summary, "summary", SUMMARY_MAX)?;
    op.capture(tx, "tasks", &id)?;
    let now = clock.now_ms();
    tx.execute(
        "UPDATE tasks SET archived_at = ?1, archived_date = ?2, summary = ?3, updated_at = ?1
         WHERE id = ?4",
        params![now, clock.today(), summary, id],
    )?;
    history::record(
        tx,
        op,
        clock,
        &id,
        "archived",
        json!({ "summary": summary, "status": task.status.as_str() }),
    )?;
    Ok(Some(id))
}

/// `restore_task`: clear archive fields, top of `column`; history `restored`.
///
/// The status is kept (a done task comes back done); the summary is kept too and is replaced on
/// the next archive.
pub fn restore(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    id: String,
    column: u8,
) -> Result<Option<String>, AppError> {
    let task = load(tx, &id)?;
    if task.archived_at.is_none() {
        return Err(AppError::invalid(format!("task {id} is not archived")));
    }
    let column = check_column(column)?;
    let key = column_scope(column).before_first(tx)?;
    op.capture(tx, "tasks", &id)?;
    tx.execute(
        "UPDATE tasks SET archived_at = NULL, archived_date = NULL, board_column = ?1,
                          sort_key = ?2, updated_at = ?3
         WHERE id = ?4",
        params![column, key, clock.now_ms(), id],
    )?;
    history::record(
        tx,
        op,
        clock,
        &id,
        "restored",
        json!({ "column": column, "archivedDate": task.archived_date }),
    )?;
    Ok(Some(id))
}

/// `delete_task`: soft delete together with its key points.
pub fn delete(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    id: String,
) -> Result<Option<String>, AppError> {
    load(tx, &id)?;
    let kp_ids: Vec<String> = {
        let mut stmt =
            tx.prepare("SELECT id FROM key_points WHERE task_id = ?1 AND deleted_at IS NULL")?;
        stmt.query_map([&id], |r| r.get(0))?
            .collect::<Result<_, _>>()?
    };
    for kp_id in &kp_ids {
        repo::soft_delete(tx, op, clock, "key_points", kp_id)?;
    }
    repo::soft_delete(tx, op, clock, "tasks", &id)?;
    Ok(Some(id))
}
