//! `load_snapshot`: every non-deleted row, each array in a total, deterministic order
//! (architecture §3; the demo fixture depends on this order being stable).

use rusqlite::{Connection, Row};

use crate::error::AppError;
use crate::model::{
    DayOrder, Event, InboxItem, KeyPoint, KeyPointKind, NoteWho, Settings, Snapshot, Task,
    TaskStatus, Todo,
};

use super::settings;

fn bad(col: &str, value: &str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        format!("unexpected {col} value {value:?}").into(),
    )
}

fn event(r: &Row<'_>) -> rusqlite::Result<Event> {
    Ok(Event {
        id: r.get("id")?,
        date: r.get("date")?,
        time: r.get("time")?,
        end_time: r.get("end_time")?,
        title: r.get("title")?,
        location: r.get("location")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

fn todo(r: &Row<'_>) -> rusqlite::Result<Todo> {
    Ok(Todo {
        id: r.get("id")?,
        title: r.get("title")?,
        sort_key: r.get("sort_key")?,
        remind_date: r.get("remind_date")?,
        remind_time: r.get("remind_time")?,
        created_date: r.get("created_date")?,
        done_at: r.get("done_at")?,
        done_date: r.get("done_date")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

fn inbox_item(r: &Row<'_>) -> rusqlite::Result<InboxItem> {
    Ok(InboxItem {
        id: r.get("id")?,
        text: r.get("text")?,
        sort_key: r.get("sort_key")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

/// Maps a `tasks` row. Public so repositories and the reminder heartbeat can reuse it.
pub fn task(r: &Row<'_>) -> rusqlite::Result<Task> {
    let status: String = r.get("status")?;
    Ok(Task {
        id: r.get("id")?,
        title: r.get("title")?,
        status: TaskStatus::parse(&status).ok_or_else(|| bad("status", &status))?,
        start_date: r.get("start_date")?,
        due_date: r.get("due_date")?,
        last_due_date: r.get("last_due_date")?,
        remind_day_before: r.get::<_, i64>("remind_day_before")? != 0,
        board_column: r.get("board_column")?,
        sort_key: r.get("sort_key")?,
        done_at: r.get("done_at")?,
        done_date: r.get("done_date")?,
        archived_at: r.get("archived_at")?,
        archived_date: r.get("archived_date")?,
        summary: r.get("summary")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

/// Maps a `key_points` row. Public so repositories can reuse it.
pub fn key_point(r: &Row<'_>) -> rusqlite::Result<KeyPoint> {
    let kind: String = r.get("kind")?;
    let who: Option<String> = r.get("who")?;
    Ok(KeyPoint {
        id: r.get("id")?,
        task_id: r.get("task_id")?,
        kind: KeyPointKind::parse(&kind).ok_or_else(|| bad("kind", &kind))?,
        text: r.get("text")?,
        date: r.get("date")?,
        who: match who {
            None => None,
            Some(w) => Some(NoteWho::parse(&w).ok_or_else(|| bad("who", &w))?),
        },
        sort_key: r.get("sort_key")?,
        done_date: r.get("done_date")?,
        is_current: r.get::<_, i64>("is_current")? != 0,
        current_since: r.get("current_since")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

fn day_order(r: &Row<'_>) -> rusqlite::Result<DayOrder> {
    let keys: String = r.get("item_keys")?;
    Ok(DayOrder {
        id: r.get("id")?,
        date: r.get("date")?,
        item_keys: serde_json::from_str(&keys).map_err(|_| bad("item_keys", &keys))?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

fn all<T>(
    conn: &Connection,
    sql: &str,
    map: fn(&Row<'_>) -> rusqlite::Result<T>,
) -> Result<Vec<T>, AppError> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], map)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Loads the full snapshot. `defaults` fills in settings that were never stored.
pub fn load(conn: &Connection, defaults: &Settings) -> Result<Snapshot, AppError> {
    Ok(Snapshot {
        events: all(
            conn,
            "SELECT * FROM events WHERE deleted_at IS NULL ORDER BY date, id",
            event,
        )?,
        todos: all(
            conn,
            "SELECT * FROM todos WHERE deleted_at IS NULL ORDER BY sort_key, id",
            todo,
        )?,
        inbox: all(
            conn,
            "SELECT * FROM inbox_items WHERE deleted_at IS NULL ORDER BY sort_key, id",
            inbox_item,
        )?,
        tasks: all(
            conn,
            "SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY board_column, sort_key, id",
            task,
        )?,
        key_points: all(
            conn,
            "SELECT * FROM key_points WHERE deleted_at IS NULL ORDER BY task_id, sort_key, id",
            key_point,
        )?,
        day_orders: all(
            conn,
            "SELECT * FROM calendar_day_orders WHERE deleted_at IS NULL ORDER BY date, id",
            day_order,
        )?,
        settings: settings::get(conn, defaults)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn empty_db_gives_empty_snapshot_with_defaults() {
        let db = Db::open_in_memory().unwrap();
        let snap = db.with_conn(|c| load(c, &Settings::fixture())).unwrap();
        assert!(snap.events.is_empty() && snap.todos.is_empty() && snap.tasks.is_empty());
        assert_eq!(snap.settings, Settings::fixture());
    }

    #[test]
    fn deleted_rows_are_filtered_and_order_is_total() {
        let db = Db::open_in_memory().unwrap();
        db.with_tx(|tx| {
            tx.execute_batch(
                "INSERT INTO inbox_items (id, text, sort_key, created_at, updated_at, deleted_at) VALUES
                   ('b', 'second', 'V', 1, 1, NULL),
                   ('a', 'same key, lower id', 'V', 1, 1, NULL),
                   ('c', 'first', 'G', 1, 1, NULL),
                   ('d', 'gone', 'A', 1, 1, 5);
                 INSERT INTO calendar_day_orders (id, date, item_keys, created_at, updated_at)
                   VALUES ('o1', '2026-10-09', '[\"todo:x\",\"event:y\"]', 1, 1);",
            )?;
            Ok(())
        })
        .unwrap();
        let snap = db.with_conn(|c| load(c, &Settings::fixture())).unwrap();
        let ids: Vec<&str> = snap.inbox.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, ["c", "a", "b"]);
        assert_eq!(snap.day_orders[0].item_keys, ["todo:x", "event:y"]);
    }

    #[test]
    fn seeded_snapshot_has_demo_counts() {
        let db = crate::test_support::seeded_db();
        let snap = db.with_conn(|c| load(c, &Settings::fixture())).unwrap();
        assert_eq!(snap.events.len(), 11);
        assert_eq!(snap.inbox.len(), 3);
        assert_eq!(
            snap.tasks
                .iter()
                .filter(|t| t.archived_at.is_none())
                .count(),
            9
        );
        assert_eq!(
            snap.tasks
                .iter()
                .filter(|t| t.archived_at.is_some())
                .count(),
            3
        );
    }
}
