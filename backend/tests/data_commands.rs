//! End to end over the demo seed: every one of the 27 write repositories (see backend/src/commands.rs) is
//! called once through `Db::with_op`, and its effect is read back from `load_snapshot`.

mod common;

use common::*;
use weekpage::db::{calendar, events, inbox, key_points, tasks, todos};
use weekpage::model::{
    EventInput, KeyPointInput, KeyPointKind, NewTaskInput, NoteWho, TaskEventType, TaskStatus,
    TodoInput,
};

#[test]
fn all_27_write_commands_end_to_end() {
    let db = seeded();
    let c = clock();
    let s0 = snap(&db);
    let mut called = 0;

    // ── events (3) ──
    let (_, ev) = ok(&db, &c, |tx, op, c| {
        events::create(
            tx,
            op,
            c,
            EventInput {
                date: "2026-10-05".into(),
                time: Some("15:00".into()),
                end_time: Some("17:00".into()),
                title: "  看展  ".into(),
            },
        )
    });
    called += 1;
    let e = snap(&db).events.into_iter().find(|e| e.id == ev).unwrap();
    assert_eq!(
        (e.title.as_str(), e.time.as_deref(), e.end_time.as_deref()),
        ("看展", Some("15:00"), Some("17:00"))
    );
    assert_eq!((e.created_at, e.updated_at), (c.now_ms(), c.now_ms()));

    ok(&db, &c, |tx, op, c| {
        events::update(
            tx,
            op,
            c,
            ev.clone(),
            EventInput {
                date: "2026-10-06".into(),
                time: None,
                end_time: None,
                title: "看展（改期）".into(),
            },
        )
    });
    called += 1;
    let e = snap(&db).events.into_iter().find(|e| e.id == ev).unwrap();
    assert_eq!((e.date.as_str(), e.time), ("2026-10-06", None));

    ok(&db, &c, |tx, op, c| events::delete(tx, op, c, ev.clone()));
    called += 1;
    assert!(snap(&db).events.iter().all(|e| e.id != ev));

    // ── calendar (1) ──
    let keys = vec!["todo:a".to_string(), "event:b".to_string()];
    ok(&db, &c, |tx, op, c| {
        calendar::set_day_order(tx, op, c, "2026-10-09".into(), keys.clone())
    });
    called += 1;
    assert_eq!(snap(&db).day_orders[0].item_keys, keys);

    // ── todos (7) ──
    let (_, todo) = ok(&db, &c, |tx, op, c| {
        todos::create(
            tx,
            op,
            c,
            TodoInput {
                title: "买牛奶".into(),
                remind_date: None,
                remind_time: None,
            },
            None,
        )
    });
    called += 1;
    assert_eq!(open_todos(&snap(&db)).last(), Some(&todo));

    ok(&db, &c, |tx, op, c| {
        todos::update(
            tx,
            op,
            c,
            todo.clone(),
            TodoInput {
                title: "买牛奶和面包".into(),
                remind_date: Some("2026-10-01".into()),
                remind_time: Some("08:00".into()),
            },
        )
    });
    called += 1;
    let t = snap(&db).todos.into_iter().find(|t| t.id == todo).unwrap();
    assert_eq!(t.remind_date.as_deref(), Some("2026-10-01"));

    let first = open_todos(&snap(&db))[0].clone();
    ok(&db, &c, |tx, op, c| {
        todos::move_todo(tx, op, c, todo.clone(), None, Some(first.clone()))
    });
    called += 1;
    assert_eq!(open_todos(&snap(&db))[0], todo);

    ok(&db, &c, |tx, op, c| {
        todos::set_done(tx, op, c, todo.clone(), true)
    });
    called += 1;
    let t = snap(&db).todos.into_iter().find(|t| t.id == todo).unwrap();
    assert_eq!(t.done_date.as_deref(), Some(TODAY));

    let archived = todo_id_by_title(&s0, "寄回 9 月的报销发票");
    ok(&db, &c, |tx, op, c| {
        todos::restore(tx, op, c, archived.clone())
    });
    called += 1;
    assert_eq!(open_todos(&snap(&db)).last(), Some(&archived));

    ok(&db, &c, |tx, op, c| todos::delete(tx, op, c, todo.clone()));
    called += 1;
    assert!(snap(&db).todos.iter().all(|t| t.id != todo));

    // ── inbox (3) ──
    let (_, item) = ok(&db, &c, |tx, op, c| {
        inbox::create(tx, op, c, "申请海外学校（UCL / 港大）".into())
    });
    called += 1;
    let s = snap(&db);
    assert_eq!((s.inbox.len(), s.inbox[0].id.as_str()), (4, item.as_str()));

    ok(&db, &c, |tx, op, c| {
        inbox::update(tx, op, c, item.clone(), "申请海外学校".into())
    });
    called += 1;
    assert_eq!(snap(&db).inbox[0].text, "申请海外学校");

    let other = s.inbox[1].id.clone();
    ok(&db, &c, |tx, op, c| inbox::delete(tx, op, c, other.clone()));
    called += 1;
    assert_eq!(snap(&db).inbox.len(), 3);

    // ── tasks (9) ──
    let (_, task) = ok(&db, &c, |tx, op, c| {
        tasks::create(
            tx,
            op,
            c,
            NewTaskInput {
                title: "申请海外学校".into(),
                start_date: TODAY.into(),
                due_date: Some("2026-12-01".into()),
                remind_day_before: true,
                column: 2,
                key_points: vec![
                    KeyPointInput {
                        kind: KeyPointKind::Do,
                        text: "准备文书".into(),
                        date: None,
                        who: None,
                    },
                    KeyPointInput {
                        kind: KeyPointKind::Wait,
                        text: "等推荐信 · 10/20 查".into(),
                        date: Some("2026-10-20".into()),
                        who: None,
                    },
                ],
                from_inbox_id: Some(item.clone()),
            },
        )
    });
    called += 1;
    let s = snap(&db);
    assert_eq!(column(&s, 2)[0], task);
    assert_eq!(timeline(&s, &task).len(), 2);
    assert!(s.inbox.iter().all(|i| i.id != item));

    ok(&db, &c, |tx, op, c| {
        tasks::rename(tx, op, c, task.clone(), "申请海外学校（UCL / 港大）".into())
    });
    called += 1;
    ok(&db, &c, |tx, op, c| {
        tasks::set_status(tx, op, c, task.clone(), TaskStatus::Waiting)
    });
    called += 1;
    ok(&db, &c, |tx, op, c| {
        tasks::set_dates(tx, op, c, task.clone(), "2026-10-01".into(), None)
    });
    called += 1;
    ok(&db, &c, |tx, op, c| {
        tasks::set_remind(tx, op, c, task.clone(), false)
    });
    called += 1;
    let t = snap(&db).tasks.into_iter().find(|t| t.id == task).unwrap();
    assert_eq!(t.title, "申请海外学校（UCL / 港大）");
    assert_eq!(t.status, TaskStatus::Waiting);
    assert_eq!(
        (
            t.start_date.as_str(),
            t.due_date,
            t.last_due_date.as_deref()
        ),
        ("2026-10-01", None, Some("2026-12-01"))
    );
    assert!(!t.remind_day_before);

    let col0_top = column(&snap(&db), 0)[0].clone();
    ok(&db, &c, |tx, op, c| {
        tasks::move_task(tx, op, c, task.clone(), 0, None, Some(col0_top.clone()))
    });
    called += 1;
    assert_eq!(column(&snap(&db), 0)[0], task);

    // ── key points (5) ──
    let (_, kp) = ok(&db, &c, |tx, op, c| {
        key_points::add(
            tx,
            op,
            c,
            task.clone(),
            KeyPointInput {
                kind: KeyPointKind::Check,
                text: "11/1 检查材料".into(),
                date: Some("2026-11-01".into()),
                who: None,
            },
        )
    });
    called += 1;
    // Clears the date: only undated key points can be moved by hand (below).
    ok(&db, &c, |tx, op, c| {
        key_points::update(
            tx,
            op,
            c,
            kp.clone(),
            KeyPointInput {
                kind: KeyPointKind::Check,
                text: "检查材料".into(),
                date: None,
                who: None,
            },
        )
    });
    called += 1;
    let first_kp = timeline(&snap(&db), &task)[0].clone();
    ok(&db, &c, |tx, op, c| {
        key_points::move_key_point(tx, op, c, kp.clone(), None, Some(first_kp.clone()))
    });
    called += 1;
    assert_eq!(timeline(&snap(&db), &task)[0], kp);
    ok(&db, &c, |tx, op, c| {
        key_points::set_done(tx, op, c, kp.clone(), true)
    });
    called += 1;
    let k = snap(&db)
        .key_points
        .into_iter()
        .find(|k| k.id == kp)
        .unwrap();
    assert_eq!(
        (
            k.done_date.as_deref(),
            k.is_current,
            k.current_since.as_deref()
        ),
        (Some(TODAY), false, None)
    );
    ok(&db, &c, |tx, op, c| {
        key_points::delete(tx, op, c, kp.clone())
    });
    called += 1;
    assert!(snap(&db).key_points.iter().all(|k| k.id != kp));

    // archive → restore → delete
    ok(&db, &c, |tx, op, c| {
        tasks::archive(tx, op, c, task.clone(), Some("  拿到 offer  ".into()))
    });
    called += 1;
    let t = snap(&db).tasks.into_iter().find(|t| t.id == task).unwrap();
    assert_eq!(
        (t.archived_date.as_deref(), t.summary.as_deref()),
        (Some(TODAY), Some("拿到 offer"))
    );
    ok(&db, &c, |tx, op, c| {
        tasks::restore(tx, op, c, task.clone(), 1)
    });
    called += 1;
    assert_eq!(column(&snap(&db), 1)[0], task);
    ok(&db, &c, |tx, op, c| tasks::delete(tx, op, c, task.clone()));
    called += 1;
    let s = snap(&db);
    assert!(s.tasks.iter().all(|t| t.id != task));
    assert!(s.key_points.iter().all(|k| k.task_id != task));

    // a note too (still key_points::add, not counted twice)
    let card = task_id_by_title(&s, "注册美卡");
    let (_, note) = ok(&db, &c, |tx, op, c| {
        key_points::add(
            tx,
            op,
            c,
            card.clone(),
            KeyPointInput {
                kind: KeyPointKind::Note,
                text: "我：电话催了一下".into(),
                date: None,
                who: Some(NoteWho::Me),
            },
        )
    });
    assert!(snap(&db).key_points.iter().any(|k| k.id == note));

    assert_eq!(called, 27, "every write repository was called");

    // History of the deleted task still lists everything that happened to it.
    let kinds = history_kinds(&db, &task);
    for k in [
        TaskEventType::Created,
        TaskEventType::Renamed,
        TaskEventType::Status,
        TaskEventType::Dates,
        TaskEventType::Remind,
        TaskEventType::KpAdded,
        TaskEventType::KpEdited,
        TaskEventType::KpDone,
        TaskEventType::KpDeleted,
        TaskEventType::Archived,
        TaskEventType::Restored,
    ] {
        assert!(kinds.contains(&k), "history has {k:?}: {kinds:?}");
    }
}
