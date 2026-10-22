//! Todos (待办) write repository.
//!
//! Repository contract (architecture §6.2): `fn(tx, op, clock, …) -> Result<Option<String>, AppError>`;
//! call `op.capture(tx, table, &id)?` before changing a row and `op.created(tx, table, &id)?`
//! after inserting one; INSERT writes `created_at = updated_at = clock.now_ms()`, UPDATE writes
//! `updated_at`; deletes are soft (`deleted_at`). Return the id of the created / changed row.
//!
//! One `sort_key` order covers open and done todos: unchecking a todo keeps its key, so it goes
//! back to where it was; restoring one from the archive gives it a key after every todo.

use rusqlite::{OptionalExtension, Transaction, params};

use crate::clock::Clock;
use crate::error::AppError;
use crate::model::TodoInput;

use super::Op;
use super::events::repo::{self, Scope};

/// Max characters of a todo title (DDL CHECK).
pub const TITLE_MAX: usize = 200;

struct Reminder {
    date: Option<String>,
    time: Option<String>,
}

fn validate(input: TodoInput) -> Result<(String, Reminder), AppError> {
    let title = repo::text(&input.title, "title", TITLE_MAX)?;
    let date = repo::opt_date(input.remind_date, "remind date")?;
    let time = repo::opt_time(input.remind_time, "remind time")?;
    if time.is_some() && date.is_none() {
        return Err(AppError::invalid("remind time needs a remind date"));
    }
    Ok((title, Reminder { date, time }))
}

fn scope() -> Scope {
    Scope::table("todos")
}

/// `(remind_date, done_date)` of a live todo, or `not_found`.
fn current(tx: &Transaction<'_>, id: &str) -> Result<(Option<String>, Option<String>), AppError> {
    tx.query_row(
        "SELECT remind_date, done_date FROM todos WHERE id = ?1 AND deleted_at IS NULL",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()?
    .ok_or_else(|| AppError::not_found(format!("todo {id} not found")))
}

/// Clears the reminder when its day is already over (unchecking / restoring an old todo must not
/// show an overdue bell or fire a stale notification).
fn clear_past_reminder(
    tx: &Transaction<'_>,
    clock: &Clock,
    id: &str,
    remind_date: Option<&str>,
) -> Result<(), AppError> {
    if remind_date.is_some_and(|d| d < clock.today().as_str()) {
        tx.execute(
            "UPDATE todos SET remind_date = NULL, remind_time = NULL, remind_notified_at = NULL,
                              updated_at = ?1
             WHERE id = ?2",
            params![clock.now_ms(), id],
        )?;
    }
    Ok(())
}

/// `create_todo`: append to the open list; with `from_inbox_id`, soft-delete that inbox item in the same transaction.
pub fn create(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    input: TodoInput,
    from_inbox_id: Option<String>,
) -> Result<Option<String>, AppError> {
    let (title, reminder) = validate(input)?;
    if let Some(inbox_id) = from_inbox_id.as_deref() {
        super::inbox::take(tx, op, clock, inbox_id)?;
    }
    let key = scope().after_last(tx)?;
    let id = super::new_id();
    tx.execute(
        "INSERT INTO todos (id, title, sort_key, remind_date, remind_time, created_date,
                            created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            id,
            title,
            key,
            reminder.date,
            reminder.time,
            clock.today(),
            clock.now_ms()
        ],
    )?;
    op.created(tx, "todos", &id)?;
    Ok(Some(id))
}

/// `update_todo`: title / reminder; a changed reminder clears `remind_notified_at`.
pub fn update(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    id: String,
    input: TodoInput,
) -> Result<Option<String>, AppError> {
    current(tx, &id)?;
    let (title, reminder) = validate(input)?;
    op.capture(tx, "todos", &id)?;
    tx.execute(
        "UPDATE todos SET
           remind_notified_at = CASE
             WHEN remind_date IS ?2 AND remind_time IS ?3 THEN remind_notified_at ELSE NULL END,
           title = ?1, remind_date = ?2, remind_time = ?3, updated_at = ?4
         WHERE id = ?5",
        params![title, reminder.date, reminder.time, clock.now_ms(), id],
    )?;
    Ok(Some(id))
}

/// `set_todo_done`: write / clear `done_at` + `done_date` (today); undone keeps its `sort_key`; a past reminder is cleared.
pub fn set_done(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    id: String,
    done: bool,
) -> Result<Option<String>, AppError> {
    let (remind_date, done_date) = current(tx, &id)?;
    op.capture(tx, "todos", &id)?;
    let now = clock.now_ms();
    if done {
        // Checking an already checked todo keeps its original completion time.
        if done_date.is_none() {
            tx.execute(
                "UPDATE todos SET done_at = ?1, done_date = ?2, updated_at = ?1 WHERE id = ?3",
                params![now, clock.today(), id],
            )?;
        } else {
            tx.execute(
                "UPDATE todos SET updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )?;
        }
    } else {
        tx.execute(
            "UPDATE todos SET done_at = NULL, done_date = NULL, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        clear_past_reminder(tx, clock, &id, remind_date.as_deref())?;
    }
    Ok(Some(id))
}

/// `restore_todo`: archive page "restore": clear done fields, move to the end of the open list, clear a past reminder.
pub fn restore(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    id: String,
) -> Result<Option<String>, AppError> {
    let (remind_date, _) = current(tx, &id)?;
    op.capture(tx, "todos", &id)?;
    let key = scope().after_last(tx)?;
    tx.execute(
        "UPDATE todos SET done_at = NULL, done_date = NULL, sort_key = ?1, updated_at = ?2
         WHERE id = ?3",
        params![key, clock.now_ms(), id],
    )?;
    clear_past_reminder(tx, clock, &id, remind_date.as_deref())?;
    Ok(Some(id))
}

/// `move_todo`: new `sort_key = between(prev, next)`.
pub fn move_todo(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    id: String,
    prev_id: Option<String>,
    next_id: Option<String>,
) -> Result<Option<String>, AppError> {
    current(tx, &id)?;
    let key = scope().move_key(tx, &id, prev_id.as_deref(), next_id.as_deref())?;
    op.capture(tx, "todos", &id)?;
    tx.execute(
        "UPDATE todos SET sort_key = ?1, updated_at = ?2 WHERE id = ?3",
        params![key, clock.now_ms(), id],
    )?;
    Ok(Some(id))
}

/// `delete_todo`: soft delete.
pub fn delete(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    id: String,
) -> Result<Option<String>, AppError> {
    repo::soft_delete(tx, op, clock, "todos", &id)?;
    Ok(Some(id))
}
