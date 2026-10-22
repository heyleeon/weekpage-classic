//! Undo of every Toast action (architecture §6.2, ui-spec §15.3): delete event, delete todo,
//! the four inbox triages, archive, restore task, restore todo, delete key point; merged triage
//! undo; history cleanup; `updated_at` after undo; soft-deleted rows stay out of the snapshot.

mod common;

use common::*;
use weekpage::db::{events, inbox, key_points, tasks, todos};
use weekpage::model::{NewTaskInput, Snapshot, TaskEventType, TodoInput};

fn todo_input(title: &str, date: Option<&str>) -> TodoInput {
    TodoInput {
        title: title.into(),
        remind_date: date.map(Into::into),
        remind_time: None,
    }
}

fn task_from_inbox(title: &str, inbox_id: &str, column: u8) -> NewTaskInput {
    NewTaskInput {
        title: title.into(),
        start_date: TODAY.into(),
        due_date: None,
        remind_day_before: false,
        column,
        key_points: vec![],
        from_inbox_id: Some(inbox_id.into()),
    }
}

/// The snapshot with every `updated_at` blanked (undo writes now, not the old value).
fn content(mut s: Snapshot) -> Snapshot {
    s.events.iter_mut().for_each(|r| r.updated_at = 0);
    s.todos.iter_mut().for_each(|r| r.updated_at = 0);
    s.inbox.iter_mut().for_each(|r| r.updated_at = 0);
    s.tasks.iter_mut().for_each(|r| r.updated_at = 0);
    s.key_points.iter_mut().for_each(|r| r.updated_at = 0);
    s.day_orders.iter_mut().for_each(|r| r.updated_at = 0);
    s
}

#[test]
fn undo_delete_event() {
    let db = seeded();
    let before = snap(&db);
    let id = before.events[3].id.clone();
    let (op, _) = ok(&db, &clock(), |tx, op, c| {
        events::delete(tx, op, c, id.clone())
    });
    assert_eq!(snap(&db).events.len(), 10);
    undo(&db, &[op], &later());
    assert_eq!(content(snap(&db)), content(before));
}

#[test]
fn undo_delete_todo() {
    let db = seeded();
    let before = snap(&db);
    let id = open_todos(&before)[1].clone();
    let (op, _) = ok(&db, &clock(), |tx, op, c| {
        todos::delete(tx, op, c, id.clone())
    });
    undo(&db, &[op], &later());
    assert_eq!(content(snap(&db)), content(before));
}

#[test]
fn undo_inbox_to_today() {
    let db = seeded();
    let before = snap(&db);
    let item = before.inbox[0].id.clone();
    let (op, todo) = ok(&db, &clock(), |tx, op, c| {
        todos::create(
            tx,
            op,
            c,
            todo_input("看一下 Stripe Atlas", None),
            Some(item.clone()),
        )
    });
    undo(&db, &[op], &later());
    assert_eq!(content(snap(&db)), content(before));
    assert!(raw::<Option<i64>>(&db, "todos", "deleted_at", &todo).is_some());
}

#[test]
fn undo_inbox_scheduled() {
    let db = seeded();
    let before = snap(&db);
    let item = before.inbox[2].id.clone();
    let (op, _) = ok(&db, &clock(), |tx, op, c| {
        todos::create(
            tx,
            op,
            c,
            todo_input("给爸妈买国庆礼物", Some("2026-10-05")),
            Some(item.clone()),
        )
    });
    undo(&db, &[op], &later());
    assert_eq!(content(snap(&db)), content(before));
}

#[test]
fn undo_inbox_to_task() {
    let db = seeded();
    let before = snap(&db);
    let item = before.inbox[1].id.clone();
    let (op, task) = ok(&db, &clock(), |tx, op, c| {
        tasks::create(tx, op, c, task_from_inbox("orbit 官网做英文版", &item, 2))
    });
    undo(&db, &[op], &later());
    assert_eq!(content(snap(&db)), content(before));
    assert!(history_of(&db, &task).is_empty());
}

#[test]
fn undo_inbox_deleted() {
    let db = seeded();
    let before = snap(&db);
    let item = before.inbox[1].id.clone();
    let (op, _) = ok(&db, &clock(), |tx, op, c| {
        inbox::delete(tx, op, c, item.clone())
    });
    undo(&db, &[op], &later());
    assert_eq!(content(snap(&db)), content(before));
}

#[test]
fn undo_inbox_triage_merged() {
    let db = seeded();
    let before = snap(&db);
    let ids: Vec<String> = before.inbox.iter().map(|i| i.id.clone()).collect();
    let c = clock();
    let (op1, _) = ok(&db, &c, |tx, op, c| {
        todos::create(
            tx,
            op,
            c,
            todo_input("a", Some("2026-10-05")),
            Some(ids[0].clone()),
        )
    });
    let (op2, _) = ok(&db, &c, |tx, op, c| {
        tasks::create(tx, op, c, task_from_inbox("b", &ids[1], 0))
    });
    let (op3, _) = ok(&db, &c, |tx, op, c| {
        inbox::delete(tx, op, c, ids[2].clone())
    });
    let mid = snap(&db);
    assert!(mid.inbox.is_empty());
    // the Toast hands all three op ids to one undo
    undo(&db, &[op1, op2, op3], &later());
    let after = snap(&db);
    assert_eq!(
        after.inbox.iter().map(|i| i.id.clone()).collect::<Vec<_>>(),
        ids
    );
    assert_eq!(content(after), content(before));
}

#[test]
fn undo_archive_removes_history() {
    let db = seeded();
    let before = snap(&db);
    let id = task_id_by_title(&before, "注册美卡");
    let (op, _) = ok(&db, &clock(), |tx, op, c| {
        tasks::archive(tx, op, c, id.clone(), Some("批了".into()))
    });
    assert!(history_kinds(&db, &id).contains(&TaskEventType::Archived));
    undo(&db, &[op], &later());
    assert!(!history_kinds(&db, &id).contains(&TaskEventType::Archived));
    assert_eq!(content(snap(&db)), content(before));
}

#[test]
fn undo_restore_task() {
    let db = seeded();
    let before = snap(&db);
    let id = before
        .tasks
        .iter()
        .find(|t| t.archived_at.is_some())
        .unwrap()
        .id
        .clone();
    let (op, _) = ok(&db, &clock(), |tx, op, c| {
        tasks::restore(tx, op, c, id.clone(), 0)
    });
    undo(&db, &[op], &later());
    assert_eq!(content(snap(&db)), content(before));
    assert!(!history_kinds(&db, &id).contains(&TaskEventType::Restored));
}

#[test]
fn undo_restore_todo() {
    let db = seeded();
    let before = snap(&db);
    let id = before
        .todos
        .iter()
        .find(|t| t.done_date.as_deref().is_some_and(|d| d < TODAY))
        .unwrap()
        .id
        .clone();
    let (op, _) = ok(&db, &clock(), |tx, op, c| {
        todos::restore(tx, op, c, id.clone())
    });
    undo(&db, &[op], &later());
    assert_eq!(content(snap(&db)), content(before));
}

#[test]
fn undo_delete_key_point() {
    let db = seeded();
    let before = snap(&db);
    let card = task_id_by_title(&before, "注册美卡");
    let kp = kp_id_by_text(&before, "邮件：申请已收到，7–10 个工作日内答复");
    let (op, _) = ok(&db, &clock(), |tx, op, c| {
        key_points::delete(tx, op, c, kp.clone())
    });
    undo(&db, &[op], &later());
    assert_eq!(content(snap(&db)), content(before));
    assert!(!history_kinds(&db, &card).contains(&TaskEventType::KpDeleted));
}

#[test]
fn undo_delete_task_brings_key_points_back() {
    let db = seeded();
    let before = snap(&db);
    let id = task_id_by_title(&before, "orbit 域名备案");
    let (op, _) = ok(&db, &clock(), |tx, op, c| {
        tasks::delete(tx, op, c, id.clone())
    });
    undo(&db, &[op], &later());
    assert_eq!(content(snap(&db)), content(before));
}

#[test]
fn undo_writes_updated_at_now() {
    let db = seeded();
    let before = snap(&db);
    let ev = before.events[0].id.clone();
    let todo = open_todos(&before)[0].clone();
    let (op1, _) = ok(&db, &clock(), |tx, op, c| {
        events::delete(tx, op, c, ev.clone())
    });
    let (op2, _) = ok(&db, &clock(), |tx, op, c| {
        todos::set_done(tx, op, c, todo.clone(), true)
    });
    let l = later();
    undo(&db, &[op1, op2], &l);
    let s = snap(&db);
    assert_eq!(
        s.events.iter().find(|e| e.id == ev).unwrap().updated_at,
        l.now_ms()
    );
    let t = s.todos.iter().find(|t| t.id == todo).unwrap();
    assert_eq!(t.updated_at, l.now_ms());
    assert_eq!(t.done_date, None);
    // created_at is untouched
    assert_eq!(
        t.created_at,
        before
            .todos
            .iter()
            .find(|x| x.id == todo)
            .unwrap()
            .created_at
    );
}

#[test]
fn soft_deleted_rows_never_reach_the_snapshot() {
    let db = seeded();
    let c = clock();
    let s = snap(&db);
    let ev = s.events[0].id.clone();
    let todo = open_todos(&s)[0].clone();
    let item = s.inbox[0].id.clone();
    let task = task_id_by_title(&s, "交会议 PPT");
    let kps = timeline(&s, &task);
    let card_note = kp_id_by_text(&s, "邮件：申请已收到，7–10 个工作日内答复");
    ok(&db, &c, |tx, op, c| events::delete(tx, op, c, ev.clone()));
    ok(&db, &c, |tx, op, c| todos::delete(tx, op, c, todo.clone()));
    ok(&db, &c, |tx, op, c| inbox::delete(tx, op, c, item.clone()));
    ok(&db, &c, |tx, op, c| tasks::delete(tx, op, c, task.clone()));
    ok(&db, &c, |tx, op, c| {
        key_points::delete(tx, op, c, card_note.clone())
    });
    let after = snap(&db);
    assert!(after.events.iter().all(|e| e.id != ev));
    assert!(after.todos.iter().all(|t| t.id != todo));
    assert!(after.inbox.iter().all(|i| i.id != item));
    assert!(after.tasks.iter().all(|t| t.id != task));
    assert!(
        after
            .key_points
            .iter()
            .all(|k| !kps.contains(&k.id) && k.id != card_note)
    );
    // the rows are still in the database as tombstones
    assert_eq!(
        raw::<Option<i64>>(&db, "events", "deleted_at", &ev),
        Some(c.now_ms())
    );
    assert_eq!(
        raw::<Option<i64>>(&db, "inbox_items", "deleted_at", &item),
        Some(c.now_ms())
    );
}
