//! Calendar day order write repository (`calendar_day_orders`, one row per day).
//!
//! Repository contract (architecture §6.2): `fn(tx, op, clock, …) -> Result<Option<String>, AppError>`;
//! call `op.capture(tx, table, &id)?` before changing a row and `op.created(tx, table, &id)?`
//! after inserting one; INSERT writes `created_at = updated_at = clock.now_ms()`, UPDATE writes
//! `updated_at`; deletes are soft (`deleted_at`). Return the id of the created / changed row.

use rusqlite::{OptionalExtension, Transaction, params};

use crate::clock::Clock;
use crate::error::AppError;

use super::Op;
use super::events::repo;

/// Max length of one item key (`kind:` + a 36-char id, with room to spare).
const ITEM_KEY_MAX: usize = 100;

/// `set_day_order`: upsert the manual order of one day (whole-day replace).
///
/// `date` is UNIQUE in the table, tombstones included, so a row that an undo tombstoned is
/// revived (and captured) instead of inserting a second row for the same day. Blank keys are
/// rejected; repeated keys keep their first position.
pub fn set_day_order(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    date: String,
    item_keys: Vec<String>,
) -> Result<Option<String>, AppError> {
    let date = repo::date(&date, "date")?;
    let mut keys: Vec<String> = Vec::with_capacity(item_keys.len());
    for raw in item_keys {
        let k = repo::text(&raw, "item key", ITEM_KEY_MAX)?;
        if !k.contains(':') {
            return Err(AppError::invalid(format!(
                "item key {k:?} must look like kind:id"
            )));
        }
        if !keys.contains(&k) {
            keys.push(k);
        }
    }
    let json = serde_json::to_string(&keys)?;
    let now = clock.now_ms();
    let existing: Option<String> = tx
        .query_row(
            "SELECT id FROM calendar_day_orders WHERE date = ?1",
            [&date],
            |r| r.get(0),
        )
        .optional()?;
    match existing {
        Some(id) => {
            op.capture(tx, "calendar_day_orders", &id)?;
            tx.execute(
                "UPDATE calendar_day_orders SET item_keys = ?1, updated_at = ?2, deleted_at = NULL
                 WHERE id = ?3",
                params![json, now, id],
            )?;
            Ok(Some(id))
        }
        None => {
            let id = super::new_id();
            tx.execute(
                "INSERT INTO calendar_day_orders (id, date, item_keys, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?4)",
                params![id, date, json, now],
            )?;
            op.created(tx, "calendar_day_orders", &id)?;
            Ok(Some(id))
        }
    }
}
