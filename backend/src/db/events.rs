//! Events (日程) write repository, plus [`repo`]: input validation and sort-key placement shared by
//! all the write repositories (`events / todos / inbox / tasks / key_points / calendar`).
//!
//! Repository contract (architecture §6.2): `fn(tx, op, clock, …) -> Result<Option<String>, AppError>`;
//! call `op.capture(tx, table, &id)?` before changing a row and `op.created(tx, table, &id)?`
//! after inserting one; INSERT writes `created_at = updated_at = clock.now_ms()`, UPDATE writes
//! `updated_at`; deletes are soft (`deleted_at`). New ids come from `super::new_id()`, sort keys
//! from `super::sort_key::between`. Return the id of the created / changed row.

use rusqlite::{Transaction, params};

use crate::clock::Clock;
use crate::error::AppError;
use crate::model::EventInput;

use super::Op;

/// Max characters of an event title (DDL CHECK).
pub const TITLE_MAX: usize = 200;

struct EventRow {
    date: String,
    time: Option<String>,
    end_time: Option<String>,
    title: String,
}

fn validate(input: EventInput) -> Result<EventRow, AppError> {
    let date = repo::date(&input.date, "date")?;
    let time = repo::opt_time(input.time, "time")?;
    let end_time = repo::opt_time(input.end_time, "end time")?;
    if end_time.is_some() && time.is_none() {
        return Err(AppError::invalid("end time needs a start time"));
    }
    let title = repo::text(&input.title, "title", TITLE_MAX)?;
    Ok(EventRow {
        date,
        time,
        end_time,
        title,
    })
}

/// `create_event`: insert an event; validates date / time / title.
pub fn create(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    input: EventInput,
) -> Result<Option<String>, AppError> {
    let row = validate(input)?;
    let id = super::new_id();
    tx.execute(
        "INSERT INTO events (id, date, time, end_time, title, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![
            id,
            row.date,
            row.time,
            row.end_time,
            row.title,
            clock.now_ms()
        ],
    )?;
    op.created(tx, "events", &id)?;
    Ok(Some(id))
}

/// `update_event`: replace title / date / time / end time.
pub fn update(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    id: String,
    input: EventInput,
) -> Result<Option<String>, AppError> {
    repo::ensure_live(tx, "events", &id)?;
    let row = validate(input)?;
    op.capture(tx, "events", &id)?;
    tx.execute(
        "UPDATE events SET date = ?1, time = ?2, end_time = ?3, title = ?4, updated_at = ?5
         WHERE id = ?6",
        params![
            row.date,
            row.time,
            row.end_time,
            row.title,
            clock.now_ms(),
            id
        ],
    )?;
    Ok(Some(id))
}

/// `delete_event`: soft delete.
pub fn delete(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    id: String,
) -> Result<Option<String>, AppError> {
    repo::soft_delete(tx, op, clock, "events", &id)?;
    Ok(Some(id))
}

/// Shared helpers of the write repositories: trimmed / length-checked text, strict dates and
/// times, live-row checks, soft delete, and collision-free sort-key placement.
///
/// Sort keys are placed against **every** row of the scope, soft-deleted ones included: an undo
/// can bring a tombstoned row back with its old key, so a new key must never reuse it (two equal
/// keys would make a later `between(prev, next)` fail with "out of order").
pub(crate) mod repo {
    use chrono::{NaiveDate, NaiveTime};
    use rusqlite::types::Value;
    use rusqlite::{OptionalExtension, Transaction, params_from_iter};

    use crate::clock::Clock;
    use crate::db::{Op, sort_key};
    use crate::error::AppError;

    /// Trims `raw` and checks it has 1..=`max` characters.
    pub fn text(raw: &str, field: &str, max: usize) -> Result<String, AppError> {
        let t = raw.trim();
        if t.is_empty() {
            return Err(AppError::invalid(format!("{field} must not be empty")));
        }
        let n = t.chars().count();
        if n > max {
            return Err(AppError::invalid(format!(
                "{field} is too long ({n} > {max} characters)"
            )));
        }
        Ok(t.to_string())
    }

    /// Like [`text`] but optional: `None` or blank → `None`.
    pub fn opt_text(
        raw: Option<String>,
        field: &str,
        max: usize,
    ) -> Result<Option<String>, AppError> {
        match raw {
            Some(s) if !s.trim().is_empty() => text(&s, field, max).map(Some),
            _ => Ok(None),
        }
    }

    /// A real calendar date written exactly as `YYYY-MM-DD`.
    pub fn date(raw: &str, field: &str) -> Result<String, AppError> {
        let t = raw.trim();
        let ok = t.len() == 10 && NaiveDate::parse_from_str(t, "%Y-%m-%d").is_ok();
        if !ok {
            return Err(AppError::invalid(format!(
                "{field} must be a YYYY-MM-DD date, got {raw:?}"
            )));
        }
        Ok(t.to_string())
    }

    /// Optional [`date`]: `None` or blank → `None`.
    pub fn opt_date(raw: Option<String>, field: &str) -> Result<Option<String>, AppError> {
        match raw {
            Some(s) if !s.trim().is_empty() => date(&s, field).map(Some),
            _ => Ok(None),
        }
    }

    /// A wall time written exactly as `HH:MM` (00:00–23:59).
    pub fn time(raw: &str, field: &str) -> Result<String, AppError> {
        let t = raw.trim();
        let ok = t.len() == 5 && NaiveTime::parse_from_str(t, "%H:%M").is_ok();
        if !ok {
            return Err(AppError::invalid(format!(
                "{field} must be a HH:MM time, got {raw:?}"
            )));
        }
        Ok(t.to_string())
    }

    /// Optional [`time`]: `None` or blank → `None`.
    pub fn opt_time(raw: Option<String>, field: &str) -> Result<Option<String>, AppError> {
        match raw {
            Some(s) if !s.trim().is_empty() => time(&s, field).map(Some),
            _ => Ok(None),
        }
    }

    /// `not_found` unless `table` has a non-deleted row `id`.
    pub fn ensure_live(tx: &Transaction<'_>, table: &str, id: &str) -> Result<(), AppError> {
        let found: Option<i64> = tx
            .query_row(
                &format!("SELECT 1 FROM {table} WHERE id = ?1 AND deleted_at IS NULL"),
                [id],
                |r| r.get(0),
            )
            .optional()?;
        match found {
            Some(_) => Ok(()),
            None => Err(AppError::not_found(format!("{table} row {id} not found"))),
        }
    }

    /// Captures and soft-deletes a live row (`deleted_at = updated_at = now`).
    pub fn soft_delete(
        tx: &Transaction<'_>,
        op: &mut Op,
        clock: &Clock,
        table: &str,
        id: &str,
    ) -> Result<(), AppError> {
        ensure_live(tx, table, id)?;
        op.capture(tx, table, id)?;
        tx.execute(
            &format!("UPDATE {table} SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2"),
            rusqlite::params![clock.now_ms(), id],
        )?;
        Ok(())
    }

    /// The rows sort keys are ordered within: a whole table (todos, inbox) or the rows whose
    /// `column` equals a value (tasks: one board column; key points: one task).
    pub struct Scope {
        table: &'static str,
        filter: Option<(&'static str, Value)>,
    }

    impl Scope {
        pub fn table(table: &'static str) -> Self {
            Scope {
                table,
                filter: None,
            }
        }

        pub fn filtered(table: &'static str, column: &'static str, value: Value) -> Self {
            Scope {
                table,
                filter: Some((column, value)),
            }
        }

        fn where_sql(&self, param_no: usize) -> String {
            match &self.filter {
                Some((col, _)) => format!(" AND {col} = ?{param_no}"),
                None => String::new(),
            }
        }

        fn params(&self, mut lead: Vec<Value>) -> Vec<Value> {
            if let Some((_, v)) = &self.filter {
                lead.push(v.clone());
            }
            lead
        }

        fn taken(&self, tx: &Transaction<'_>, key: &str) -> Result<bool, AppError> {
            let sql = format!(
                "SELECT 1 FROM {} WHERE sort_key = ?1{} LIMIT 1",
                self.table,
                self.where_sql(2)
            );
            let hit: Option<i64> = tx
                .query_row(
                    &sql,
                    params_from_iter(self.params(vec![Value::Text(key.to_string())])),
                    |r| r.get(0),
                )
                .optional()?;
            Ok(hit.is_some())
        }

        fn edge(&self, tx: &Transaction<'_>, agg: &str) -> Result<Option<String>, AppError> {
            let sql = format!(
                "SELECT {agg}(sort_key) FROM {} WHERE 1 = 1{}",
                self.table,
                self.where_sql(1)
            );
            Ok(tx.query_row(&sql, params_from_iter(self.params(vec![])), |r| r.get(0))?)
        }

        /// A key after every row ever stored in the scope (append to the end).
        pub fn after_last(&self, tx: &Transaction<'_>) -> Result<String, AppError> {
            let last = self.edge(tx, "max")?;
            self.free_between(tx, last, None)
        }

        /// A key before every row ever stored in the scope (insert at the top).
        pub fn before_first(&self, tx: &Transaction<'_>) -> Result<String, AppError> {
            let first = self.edge(tx, "min")?;
            self.free_between(tx, None, first.as_deref())
        }

        /// A key strictly between `prev` and `next` that no row of the scope uses yet.
        pub fn free_between(
            &self,
            tx: &Transaction<'_>,
            prev: Option<String>,
            next: Option<&str>,
        ) -> Result<String, AppError> {
            let mut lo = prev;
            loop {
                let k = sort_key::between(lo.as_deref(), next)?;
                if !self.taken(tx, &k)? {
                    return Ok(k);
                }
                lo = Some(k);
            }
        }

        /// The key of move neighbour `id`: a live row of this scope other than the moved row.
        fn neighbour_key(
            &self,
            tx: &Transaction<'_>,
            id: Option<&str>,
            moved: &str,
            which: &str,
        ) -> Result<Option<String>, AppError> {
            let Some(id) = id else { return Ok(None) };
            if id == moved {
                return Err(AppError::invalid(format!(
                    "{which} neighbour cannot be the moved row itself"
                )));
            }
            let sql = format!(
                "SELECT sort_key FROM {} WHERE id = ?1 AND deleted_at IS NULL{}",
                self.table,
                self.where_sql(2)
            );
            let key: Option<String> = tx
                .query_row(
                    &sql,
                    params_from_iter(self.params(vec![Value::Text(id.to_string())])),
                    |r| r.get(0),
                )
                .optional()?;
            key.map(Some).ok_or_else(|| {
                AppError::not_found(format!(
                    "{which} neighbour {id} is not a live row of the same list"
                ))
            })
        }

        /// New key for moving `moved` between neighbours `prev_id` / `next_id`
        /// (`invalid` when the neighbours are out of order).
        pub fn move_key(
            &self,
            tx: &Transaction<'_>,
            moved: &str,
            prev_id: Option<&str>,
            next_id: Option<&str>,
        ) -> Result<String, AppError> {
            let prev = self.neighbour_key(tx, prev_id, moved, "previous")?;
            let next = self.neighbour_key(tx, next_id, moved, "next")?;
            self.free_between(tx, prev, next.as_deref())
        }
    }
}
