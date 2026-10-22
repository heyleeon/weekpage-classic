//! Inbox (收件箱) write repository.
//!
//! Repository contract (architecture §6.2): `fn(tx, op, clock, …) -> Result<Option<String>, AppError>`;
//! call `op.capture(tx, table, &id)?` before changing a row and `op.created(tx, table, &id)?`
//! after inserting one; INSERT writes `created_at = updated_at = clock.now_ms()`, UPDATE writes
//! `updated_at`; deletes are soft (`deleted_at`). Return the id of the created / changed row.
//!
//! Triage ("今天" / "定日期" / "变成任务") lives in `todos::create` / `tasks::create`, which call
//! [`take`] in the same transaction; "删掉" is [`delete`].

use rusqlite::{Transaction, params};

use crate::clock::Clock;
use crate::error::AppError;

use super::Op;
use super::events::repo::{self, Scope};

/// Max characters of an inbox item (DDL CHECK).
pub const TEXT_MAX: usize = 500;

/// `create_inbox_item`: insert at the top (`between(None, first)`).
pub fn create(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    text: String,
) -> Result<Option<String>, AppError> {
    let text = repo::text(&text, "text", TEXT_MAX)?;
    let key = Scope::table("inbox_items").before_first(tx)?;
    let id = super::new_id();
    tx.execute(
        "INSERT INTO inbox_items (id, text, sort_key, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, text, key, clock.now_ms()],
    )?;
    op.created(tx, "inbox_items", &id)?;
    Ok(Some(id))
}

/// `update_inbox_item`: edit the text.
pub fn update(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    id: String,
    text: String,
) -> Result<Option<String>, AppError> {
    repo::ensure_live(tx, "inbox_items", &id)?;
    let text = repo::text(&text, "text", TEXT_MAX)?;
    op.capture(tx, "inbox_items", &id)?;
    tx.execute(
        "UPDATE inbox_items SET text = ?1, updated_at = ?2 WHERE id = ?3",
        params![text, clock.now_ms(), id],
    )?;
    Ok(Some(id))
}

/// `delete_inbox_item`: soft delete ("删掉").
pub fn delete(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    id: String,
) -> Result<Option<String>, AppError> {
    take(tx, op, clock, &id)?;
    Ok(Some(id))
}

/// Removes an inbox item as part of a triage write (soft delete; undo puts it back in place
/// because its `sort_key` is kept). `not_found` when the item is missing or already triaged.
pub fn take(tx: &Transaction<'_>, op: &mut Op, clock: &Clock, id: &str) -> Result<(), AppError> {
    repo::soft_delete(tx, op, clock, "inbox_items", id)
}
