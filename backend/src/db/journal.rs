//! Undo journal: before-images grouped by `op_id` (architecture §6.2).
//!
//! Repositories call [`Op::capture`] before changing a row and [`Op::created`] after inserting one.
//! [`undo`] replays ops newest-first: rows with a before-image are written back whole (but with
//! `updated_at = now`, so a future last-writer-wins sync does not treat the undo as stale); rows
//! created by the op get a `deleted_at` tombstone.

use std::collections::HashSet;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::{Map, Number, Value};

use crate::error::AppError;

/// Tables that may be journaled (all business tables; not `settings` / `undo_journal`).
pub const JOURNALED_TABLES: &[&str] = &[
    "events",
    "todos",
    "inbox_items",
    "tasks",
    "key_points",
    "task_events",
    "calendar_day_orders",
];

fn check_table(table: &str) -> Result<&'static str, AppError> {
    JOURNALED_TABLES
        .iter()
        .find(|t| **t == table)
        .copied()
        .ok_or_else(|| AppError::invalid(format!("table {table} is not journaled")))
}

/// One business operation inside a [`super::Db::with_op`] transaction.
#[derive(Debug)]
pub struct Op {
    op_id: String,
    seen: HashSet<(String, String)>,
}

impl Default for Op {
    fn default() -> Self {
        Self::new()
    }
}

impl Op {
    pub fn new() -> Self {
        Op {
            op_id: super::new_id(),
            seen: HashSet::new(),
        }
    }

    pub fn id(&self) -> &str {
        &self.op_id
    }

    /// Records the current whole row as its before-image. Call before UPDATE / soft delete.
    /// Only the first capture (or creation) of a row within an op counts.
    pub fn capture(&mut self, tx: &Transaction<'_>, table: &str, id: &str) -> Result<(), AppError> {
        let table = check_table(table)?;
        if !self.seen.insert((table.to_string(), id.to_string())) {
            return Ok(());
        }
        let before = row_json(tx, table, id)?
            .ok_or_else(|| AppError::not_found(format!("{table} row {id} not found")))?;
        tx.execute(
            "INSERT INTO undo_journal (op_id, table_name, row_id, before) VALUES (?1, ?2, ?3, ?4)",
            params![self.op_id, table, id, before.to_string()],
        )?;
        Ok(())
    }

    /// Records that this op created the row (undo will tombstone it). Call after INSERT.
    pub fn created(&mut self, tx: &Transaction<'_>, table: &str, id: &str) -> Result<(), AppError> {
        let table = check_table(table)?;
        if !self.seen.insert((table.to_string(), id.to_string())) {
            return Ok(());
        }
        tx.execute(
            "INSERT INTO undo_journal (op_id, table_name, row_id, before) VALUES (?1, ?2, ?3, NULL)",
            params![self.op_id, table, id],
        )?;
        Ok(())
    }
}

/// The whole row as a JSON object (column name → value), or None if it does not exist.
pub fn row_json(conn: &Connection, table: &str, id: &str) -> Result<Option<Value>, AppError> {
    let table = check_table(table)?;
    let mut stmt = conn.prepare(&format!("SELECT * FROM {table} WHERE id = ?1"))?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let row = stmt
        .query_row([id], |r| {
            let mut obj = Map::new();
            for (i, name) in names.iter().enumerate() {
                let v = match r.get_ref(i)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(n) => Value::Number(n.into()),
                    ValueRef::Real(f) => Number::from_f64(f)
                        .map(Value::Number)
                        .unwrap_or(Value::Null),
                    ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
                    ValueRef::Blob(_) => Value::Null,
                };
                obj.insert(name.clone(), v);
            }
            Ok(Value::Object(obj))
        })
        .optional()?;
    Ok(row)
}

fn json_to_sql(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Value::Number(n) => n
            .as_i64()
            .map(SqlValue::Integer)
            .or_else(|| n.as_f64().map(SqlValue::Real))
            .unwrap_or(SqlValue::Null),
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

/// Undoes `op_ids` (last one first). Fails with `conflict` if any op is unknown or expired;
/// nothing is changed in that case. Journal rows of undone ops are removed (undo is one-shot).
pub fn undo(tx: &Transaction<'_>, op_ids: &[String], now_ms: i64) -> Result<(), AppError> {
    if op_ids.is_empty() {
        return Err(AppError::invalid("undo needs at least one op id"));
    }
    for op_id in op_ids {
        let n: i64 = tx.query_row(
            "SELECT count(*) FROM undo_journal WHERE op_id = ?1",
            [op_id],
            |r| r.get(0),
        )?;
        if n == 0 {
            return Err(AppError::conflict(format!(
                "op {op_id} is unknown or expired"
            )));
        }
    }
    for op_id in op_ids.iter().rev() {
        let entries: Vec<(String, String, Option<String>)> = {
            let mut stmt = tx.prepare(
                "SELECT table_name, row_id, before FROM undo_journal WHERE op_id = ?1 ORDER BY seq DESC",
            )?;
            stmt.query_map([op_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
                .collect::<Result<_, _>>()?
        };
        for (table, row_id, before) in entries {
            let table = check_table(&table)?;
            match before {
                None => {
                    tx.execute(
                        &format!(
                            "UPDATE {table} SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2"
                        ),
                        params![now_ms, row_id],
                    )?;
                }
                Some(json) => {
                    let obj: Map<String, Value> = serde_json::from_str(&json)?;
                    let cols: Vec<&String> = obj.keys().filter(|k| k.as_str() != "id").collect();
                    let set = cols
                        .iter()
                        .enumerate()
                        .map(|(i, c)| format!("{c} = ?{}", i + 1))
                        .collect::<Vec<_>>()
                        .join(", ");
                    let mut values: Vec<SqlValue> = cols
                        .iter()
                        .map(|c| {
                            if c.as_str() == "updated_at" {
                                SqlValue::Integer(now_ms)
                            } else {
                                json_to_sql(&obj[c.as_str()])
                            }
                        })
                        .collect();
                    values.push(SqlValue::Text(row_id.clone()));
                    let sql = format!("UPDATE {table} SET {set} WHERE id = ?{}", values.len());
                    tx.execute(&sql, rusqlite::params_from_iter(values.iter()))?;
                }
            }
        }
        tx.execute("DELETE FROM undo_journal WHERE op_id = ?1", [op_id])?;
    }
    Ok(())
}

/// Deletes journal entries created before `cutoff_ms`. Returns the number of rows removed.
pub fn prune(conn: &Connection, cutoff_ms: i64) -> Result<usize, AppError> {
    Ok(conn.execute(
        "DELETE FROM undo_journal WHERE created_at < ?1",
        [cutoff_ms],
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn insert_todo(tx: &Transaction<'_>, id: &str, title: &str, ts: i64) {
        tx.execute(
            "INSERT INTO todos (id, title, sort_key, created_date, created_at, updated_at)
             VALUES (?1, ?2, 'V', '2026-09-30', ?3, ?3)",
            params![id, title, ts],
        )
        .unwrap();
    }

    fn todo(db: &Db, id: &str) -> (String, Option<i64>, i64) {
        db.with_conn(|c| {
            Ok(c.query_row(
                "SELECT title, deleted_at, updated_at FROM todos WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )?)
        })
        .unwrap()
    }

    #[test]
    fn undo_of_create_tombstones_the_row() {
        let db = Db::open_in_memory().unwrap();
        let m = db
            .with_op(|tx, op| {
                insert_todo(tx, "t1", "a", 100);
                op.created(tx, "todos", "t1")?;
                Ok(Some("t1".into()))
            })
            .unwrap();
        db.with_tx(|tx| undo(tx, std::slice::from_ref(&m.op_id), 5_000))
            .unwrap();
        let (_, deleted, updated) = todo(&db, "t1");
        assert_eq!(deleted, Some(5_000));
        assert_eq!(updated, 5_000);
    }

    #[test]
    fn undo_restores_before_image_with_updated_at_now() {
        let db = Db::open_in_memory().unwrap();
        db.with_tx(|tx| {
            insert_todo(tx, "t1", "original", 100);
            Ok(())
        })
        .unwrap();
        let m = db
            .with_op(|tx, op| {
                op.capture(tx, "todos", "t1")?;
                tx.execute(
                    "UPDATE todos SET title = 'changed', updated_at = 200 WHERE id = 't1'",
                    [],
                )?;
                op.capture(tx, "todos", "t1")?; // second capture is ignored
                tx.execute(
                    "UPDATE todos SET title = 'changed twice', updated_at = 300 WHERE id = 't1'",
                    [],
                )?;
                Ok(Some("t1".into()))
            })
            .unwrap();
        let now = 9_999;
        db.with_tx(|tx| undo(tx, std::slice::from_ref(&m.op_id), now))
            .unwrap();
        let (title, deleted, updated) = todo(&db, "t1");
        assert_eq!(title, "original");
        assert_eq!(deleted, None);
        assert_eq!(updated, now, "replay writes now, not the old updated_at");
    }

    #[test]
    fn undo_of_soft_delete_restores_row() {
        let db = Db::open_in_memory().unwrap();
        db.with_tx(|tx| {
            insert_todo(tx, "t1", "keep me", 100);
            Ok(())
        })
        .unwrap();
        let m = db
            .with_op(|tx, op| {
                op.capture(tx, "todos", "t1")?;
                tx.execute(
                    "UPDATE todos SET deleted_at = 200, updated_at = 200 WHERE id = 't1'",
                    [],
                )?;
                Ok(None)
            })
            .unwrap();
        db.with_tx(|tx| undo(tx, &[m.op_id], 300)).unwrap();
        assert_eq!(todo(&db, "t1"), ("keep me".to_string(), None, 300));
    }

    #[test]
    fn multiple_ops_undo_last_first() {
        let db = Db::open_in_memory().unwrap();
        db.with_tx(|tx| {
            insert_todo(tx, "t1", "v0", 100);
            Ok(())
        })
        .unwrap();
        let mut ops = vec![];
        for v in ["v1", "v2", "v3"] {
            let m = db
                .with_op(|tx, op| {
                    op.capture(tx, "todos", "t1")?;
                    tx.execute("UPDATE todos SET title = ?1 WHERE id = 't1'", [v])?;
                    Ok(None)
                })
                .unwrap();
            ops.push(m.op_id);
        }
        db.with_tx(|tx| undo(tx, &ops, 400)).unwrap();
        assert_eq!(todo(&db, "t1").0, "v0");
    }

    #[test]
    fn unknown_or_repeated_undo_is_conflict_and_changes_nothing() {
        let db = Db::open_in_memory().unwrap();
        let m = db
            .with_op(|tx, op| {
                insert_todo(tx, "t1", "a", 100);
                op.created(tx, "todos", "t1")?;
                Ok(None)
            })
            .unwrap();
        let err = db
            .with_tx(|tx| undo(tx, &[m.op_id.clone(), "nope".into()], 1))
            .unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::Conflict);
        assert_eq!(
            todo(&db, "t1").1,
            None,
            "nothing undone when one op is unknown"
        );
        db.with_tx(|tx| undo(tx, std::slice::from_ref(&m.op_id), 1))
            .unwrap();
        let again = db
            .with_tx(|tx| undo(tx, std::slice::from_ref(&m.op_id), 2))
            .unwrap_err();
        assert_eq!(again.code, crate::error::ErrorCode::Conflict);
    }

    #[test]
    fn capture_rejects_unknown_table_and_missing_row() {
        let db = Db::open_in_memory().unwrap();
        let r = db.with_op(|tx, op| {
            op.capture(tx, "settings", "app")?;
            Ok(None)
        });
        assert_eq!(r.unwrap_err().code, crate::error::ErrorCode::Invalid);
        let r = db.with_op(|tx, op| {
            op.capture(tx, "todos", "missing")?;
            Ok(None)
        });
        assert_eq!(r.unwrap_err().code, crate::error::ErrorCode::NotFound);
    }

    #[test]
    fn prune_drops_old_entries() {
        let db = Db::open_in_memory().unwrap();
        db.with_tx(|tx| {
            tx.execute(
                "INSERT INTO undo_journal (op_id, table_name, row_id, before, created_at)
                 VALUES ('old', 'todos', 'x', NULL, 10), ('new', 'todos', 'y', NULL, 1000)",
                [],
            )?;
            Ok(())
        })
        .unwrap();
        let removed = db.with_conn(|c| prune(c, 500)).unwrap();
        assert_eq!(removed, 1);
    }
}
