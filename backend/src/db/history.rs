//! Task history (`task_events`, append-only).
//!
//! Every write that touches a task or its key points calls [`record`]. New history rows are
//! registered with the op (`op.created`), so undoing e.g. an archive also tombstones its
//! "archived" history row and "view history" never shows it (architecture §6.2).

use rusqlite::{Connection, Transaction, params};
use serde_json::Value;

use crate::clock::Clock;
use crate::error::AppError;
use crate::model::{TaskEvent, TaskEventType};

use super::Op;

/// Appends one history row; `kind` is a `task_events.type` value such as `"kp_done"`.
/// Returns the new row id.
pub fn record(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    task_id: &str,
    kind: &str,
    payload: Value,
) -> Result<String, AppError> {
    if !payload.is_object() {
        return Err(AppError::invalid("history payload must be a JSON object"));
    }
    let id = super::new_id();
    let now = clock.now_ms();
    tx.execute(
        "INSERT INTO task_events (id, task_id, type, payload, at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5)",
        params![id, task_id, kind, payload.to_string(), now],
    )?;
    op.created(tx, "task_events", &id)?;
    Ok(id)
}

/// History of one task, newest first, tombstoned rows excluded.
pub fn list(conn: &Connection, task_id: &str) -> Result<Vec<TaskEvent>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, type, payload, at FROM task_events
         WHERE task_id = ?1 AND deleted_at IS NULL ORDER BY at DESC, id DESC",
    )?;
    let rows = stmt
        .query_map([task_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(id, task_id, kind, payload, at)| {
            let kind: TaskEventType = serde_json::from_value(Value::String(kind))?;
            Ok(TaskEvent {
                id,
                task_id,
                kind,
                payload,
                at,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{Db, journal};
    use serde_json::json;

    fn insert_task(db: &Db) {
        db.with_tx(|tx| {
            tx.execute(
                "INSERT INTO tasks (id, title, start_date, board_column, sort_key, created_at, updated_at)
                 VALUES ('t1', 'task', '2026-09-30', 0, 'V', 1, 1)",
                [],
            )?;
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn record_and_list_newest_first() {
        let db = Db::open_in_memory().unwrap();
        insert_task(&db);
        let c1 = Clock::fixed("2026-09-30T10:00");
        let c2 = Clock::fixed("2026-09-30T11:00");
        db.with_op(|tx, op| {
            record(tx, op, &c1, "t1", "created", json!({}))?;
            Ok(None)
        })
        .unwrap();
        db.with_op(|tx, op| {
            record(
                tx,
                op,
                &c2,
                "t1",
                "status",
                json!({"from": "active", "to": "waiting"}),
            )?;
            Ok(None)
        })
        .unwrap();
        let h = db.with_conn(|c| list(c, "t1")).unwrap();
        assert_eq!(h.len(), 2);
        assert_eq!(h[0].kind, TaskEventType::Status);
        assert_eq!(h[0].at, c2.now_ms());
        assert_eq!(h[1].kind, TaskEventType::Created);
    }

    #[test]
    fn undo_removes_history_row_from_list() {
        let db = Db::open_in_memory().unwrap();
        insert_task(&db);
        let clock = Clock::fixed("2026-09-30T10:00");
        let m = db
            .with_op(|tx, op| {
                record(tx, op, &clock, "t1", "archived", json!({"summary": null}))?;
                Ok(Some("t1".into()))
            })
            .unwrap();
        assert_eq!(db.with_conn(|c| list(c, "t1")).unwrap().len(), 1);
        db.with_tx(|tx| journal::undo(tx, &[m.op_id], clock.now_ms()))
            .unwrap();
        assert!(db.with_conn(|c| list(c, "t1")).unwrap().is_empty());
    }

    #[test]
    fn rejects_unknown_type_and_non_object_payload() {
        let db = Db::open_in_memory().unwrap();
        insert_task(&db);
        let clock = Clock::fixed("2026-09-30T10:00");
        assert!(
            db.with_op(|tx, op| {
                record(tx, op, &clock, "t1", "exploded", json!({}))?;
                Ok(None)
            })
            .is_err()
        );
        assert!(
            db.with_op(|tx, op| {
                record(tx, op, &clock, "t1", "created", json!([1]))?;
                Ok(None)
            })
            .is_err()
        );
    }
}
