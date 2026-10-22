//! Tasks and key points: one positive and at least one negative case per command, plus the
//! history, "current" (legacy columns, architecture §6.1) and timeline-order rules of
//! `db/key_points.rs`.

mod common;

use common::*;
use serde_json::Value;
use weekpage::db::{Db, inbox, key_points, tasks};
use weekpage::error::ErrorCode;
use weekpage::model::{
    KeyPointInput, KeyPointKind, NewTaskInput, NoteWho, TaskEventType, TaskStatus,
};

fn kpi(kind: KeyPointKind, text: &str, date: Option<&str>) -> KeyPointInput {
    KeyPointInput {
        kind,
        text: text.into(),
        date: date.map(Into::into),
        who: None,
    }
}

fn new_task(title: &str, start: &str, due: Option<&str>, column: u8) -> NewTaskInput {
    NewTaskInput {
        title: title.into(),
        start_date: start.into(),
        due_date: due.map(Into::into),
        remind_day_before: false,
        column,
        key_points: vec![],
        from_inbox_id: None,
    }
}

fn payload(db: &Db, task: &str, kind: TaskEventType) -> Value {
    let e = history_of(db, task)
        .into_iter()
        .find(|e| e.kind == kind)
        .unwrap_or_else(|| panic!("no {kind:?} history"));
    serde_json::from_str(&e.payload).unwrap()
}

// ── create_task ──────────────────────────────────────────────────────────────────────────

#[test]
fn create_task_goes_to_the_top_of_its_column_with_key_points_in_order() {
    let db = seeded();
    let c = clock();
    let before = column(&snap(&db), 1);
    let mut input = new_task("  新任务 ", TODAY, Some("2026-10-10"), 1);
    input.remind_day_before = true;
    input.key_points = vec![
        kpi(KeyPointKind::Do, "第一步", None),
        kpi(KeyPointKind::Note, "对方说好", None),
        kpi(KeyPointKind::Check, "10/5 检查", Some("2026-10-05")),
    ];
    let (_, id) = ok(&db, &c, |tx, op, c| tasks::create(tx, op, c, input));
    let s = snap(&db);
    let mut expect = vec![id.clone()];
    expect.extend(before);
    assert_eq!(column(&s, 1), expect);
    let t = s.tasks.iter().find(|t| t.id == id).unwrap();
    assert_eq!(t.title, "新任务");
    assert_eq!(t.status, TaskStatus::Active);
    assert!(t.remind_day_before);
    assert_eq!((t.created_at, t.updated_at), (c.now_ms(), c.now_ms()));
    let kps: Vec<_> = s.key_points.iter().filter(|k| k.task_id == id).collect();
    let texts: Vec<&str> = kps.iter().map(|k| k.text.as_str()).collect();
    assert_eq!(texts, ["第一步", "对方说好", "10/5 检查"]);
    assert_eq!(kps[1].who, Some(NoteWho::Them));
    assert_eq!(kps[1].date.as_deref(), Some(TODAY));
    assert!(kps.iter().all(|k| !k.is_current && k.done_date.is_none()));
    let p = payload(&db, &id, TaskEventType::Created);
    assert_eq!(p["fromInbox"], Value::Bool(false));
    assert_eq!(p["keyPoints"], 3);
}

#[test]
fn create_task_from_inbox_is_one_op() {
    let db = seeded();
    let c = clock();
    let item = snap(&db).inbox[1].id.clone();
    let mut input = new_task("orbit 官网做英文版", "2026-10-08", None, 2);
    input.from_inbox_id = Some(item.clone());
    let (op_id, id) = ok(&db, &c, |tx, op, c| tasks::create(tx, op, c, input));
    assert!(snap(&db).inbox.iter().all(|i| i.id != item));
    assert_eq!(
        payload(&db, &id, TaskEventType::Created)["fromInbox"],
        Value::Bool(true)
    );
    undo(&db, &[op_id], &later());
    let s = snap(&db);
    assert_eq!(s.inbox.len(), 3);
    assert_eq!(s.inbox[1].id, item, "inbox item back in place");
    assert!(s.tasks.iter().all(|t| t.id != id));
    assert!(history_of(&db, &id).is_empty());
}

#[test]
fn create_task_rejects_bad_input_atomically() {
    let db = seeded();
    let c = clock();
    let before = snap(&db);
    let item = before.inbox[0].id.clone();
    let cases = vec![
        new_task("", TODAY, None, 0),
        new_task("x", TODAY, Some("2026-09-29"), 0),
        new_task("x", "2026-13-01", None, 0),
        new_task("x", TODAY, None, 3),
        NewTaskInput {
            key_points: vec![kpi(KeyPointKind::Do, "  ", None)],
            from_inbox_id: Some(item.clone()),
            ..new_task("x", TODAY, None, 0)
        },
    ];
    for input in cases {
        fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
            tasks::create(tx, op, c, input)
        });
    }
    ok(&db, &c, |tx, op, c| inbox::delete(tx, op, c, item.clone()));
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        tasks::create(
            tx,
            op,
            c,
            NewTaskInput {
                from_inbox_id: Some(item.clone()),
                ..new_task("x", TODAY, None, 0)
            },
        )
    });
    assert_eq!(snap(&db).tasks, before.tasks);
}

// ── rename / status / dates / remind ─────────────────────────────────────────────────────

#[test]
fn rename_task_records_from_and_to() {
    let db = seeded();
    let c = clock();
    let id = task_id_by_title(&snap(&db), "注册美卡");
    ok(&db, &c, |tx, op, c| {
        tasks::rename(tx, op, c, id.clone(), "注册美卡（Capital One）".into())
    });
    assert_eq!(
        snap(&db).tasks.iter().find(|t| t.id == id).unwrap().title,
        "注册美卡（Capital One）"
    );
    let p = payload(&db, &id, TaskEventType::Renamed);
    assert_eq!(
        (p["from"].as_str(), p["to"].as_str()),
        (Some("注册美卡"), Some("注册美卡（Capital One）"))
    );
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        tasks::rename(tx, op, c, id.clone(), " ".into())
    });
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        tasks::rename(tx, op, c, "ghost".into(), "x".into())
    });
}

#[test]
fn set_task_status_writes_and_clears_done_fields() {
    let db = seeded();
    let c = clock();
    let id = task_id_by_title(&snap(&db), "注册美卡");
    ok(&db, &c, |tx, op, c| {
        tasks::set_status(tx, op, c, id.clone(), TaskStatus::Done)
    });
    let t = snap(&db).tasks.into_iter().find(|t| t.id == id).unwrap();
    assert_eq!(
        (t.status, t.done_at, t.done_date.as_deref()),
        (TaskStatus::Done, Some(c.now_ms()), Some(TODAY))
    );
    let p = payload(&db, &id, TaskEventType::Status);
    assert_eq!(
        (p["from"].as_str(), p["to"].as_str()),
        (Some("waiting"), Some("done"))
    );
    ok(&db, &c, |tx, op, c| {
        tasks::set_status(tx, op, c, id.clone(), TaskStatus::Active)
    });
    let t = snap(&db).tasks.into_iter().find(|t| t.id == id).unwrap();
    assert_eq!(
        (t.status, t.done_at, t.done_date),
        (TaskStatus::Active, None, None)
    );
    // same status again: no new history row
    let n = history_of(&db, &id).len();
    ok(&db, &c, |tx, op, c| {
        tasks::set_status(tx, op, c, id.clone(), TaskStatus::Active)
    });
    assert_eq!(history_of(&db, &id).len(), n);
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        tasks::set_status(tx, op, c, "ghost".into(), TaskStatus::Done)
    });
}

#[test]
fn set_task_dates_validates_and_keeps_last_due() {
    let db = seeded();
    let c = clock();
    let id = task_id_by_title(&snap(&db), "交会议 PPT");
    db.with_tx(|tx| {
        tx.execute(
            "UPDATE tasks SET remind_notified_at = 5 WHERE id = ?1",
            [&id],
        )?;
        Ok(())
    })
    .unwrap();
    ok(&db, &c, |tx, op, c| {
        tasks::set_dates(tx, op, c, id.clone(), "2026-09-30".into(), None)
    });
    let t = snap(&db).tasks.into_iter().find(|t| t.id == id).unwrap();
    assert_eq!(
        (t.due_date, t.last_due_date.as_deref()),
        (None, Some("2026-10-03"))
    );
    assert_eq!(
        raw::<Option<i64>>(&db, "tasks", "remind_notified_at", &id),
        None
    );
    let p = payload(&db, &id, TaskEventType::Dates);
    assert_eq!(p["from"]["dueDate"].as_str(), Some("2026-10-03"));
    assert!(p["to"]["dueDate"].is_null());
    ok(&db, &c, |tx, op, c| {
        tasks::set_dates(
            tx,
            op,
            c,
            id.clone(),
            "2026-09-28".into(),
            Some("2026-10-05".into()),
        )
    });
    let t = snap(&db).tasks.into_iter().find(|t| t.id == id).unwrap();
    assert_eq!(
        (t.start_date.as_str(), t.due_date.as_deref()),
        ("2026-09-28", Some("2026-10-05"))
    );
    assert_eq!(t.last_due_date.as_deref(), Some("2026-10-03"));
}

#[test]
fn set_task_dates_due_before_start_is_invalid() {
    let db = seeded();
    let c = clock();
    let id = task_id_by_title(&snap(&db), "交会议 PPT");
    let msg = fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        tasks::set_dates(
            tx,
            op,
            c,
            id.clone(),
            "2026-10-05".into(),
            Some("2026-10-04".into()),
        )
    });
    assert!(msg.contains("before"), "{msg}");
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        tasks::set_dates(tx, op, c, id.clone(), "tomorrow".into(), None)
    });
    let t = snap(&db).tasks.into_iter().find(|t| t.id == id).unwrap();
    assert_eq!(t.due_date.as_deref(), Some("2026-10-03"), "unchanged");
}

#[test]
fn set_task_remind_clears_notified() {
    let db = seeded();
    let c = clock();
    let id = task_id_by_title(&snap(&db), "注册美国公司");
    db.with_tx(|tx| {
        tx.execute(
            "UPDATE tasks SET remind_notified_at = 5 WHERE id = ?1",
            [&id],
        )?;
        Ok(())
    })
    .unwrap();
    ok(&db, &c, |tx, op, c| {
        tasks::set_remind(tx, op, c, id.clone(), true)
    });
    assert!(
        snap(&db)
            .tasks
            .iter()
            .find(|t| t.id == id)
            .unwrap()
            .remind_day_before
    );
    assert_eq!(
        raw::<Option<i64>>(&db, "tasks", "remind_notified_at", &id),
        None
    );
    assert_eq!(
        payload(&db, &id, TaskEventType::Remind)["to"],
        Value::Bool(true)
    );
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        tasks::set_remind(tx, op, c, "ghost".into(), true)
    });
}

// ── move / archive / restore / delete ────────────────────────────────────────────────────

#[test]
fn move_task_within_and_across_columns() {
    let db = seeded();
    let c = clock();
    let s = snap(&db);
    let (c0, c2) = (column(&s, 0), column(&s, 2));
    // within column 0: last → first
    ok(&db, &c, |tx, op, c| {
        tasks::move_task(tx, op, c, c0[2].clone(), 0, None, Some(c0[0].clone()))
    });
    assert_eq!(
        column(&snap(&db), 0),
        [c0[2].clone(), c0[0].clone(), c0[1].clone()]
    );
    // column 0 → column 2 between its first and second card
    ok(&db, &c, |tx, op, c| {
        tasks::move_task(
            tx,
            op,
            c,
            c0[0].clone(),
            2,
            Some(c2[0].clone()),
            Some(c2[1].clone()),
        )
    });
    let s = snap(&db);
    assert_eq!(column(&s, 0), [c0[2].clone(), c0[1].clone()]);
    assert_eq!(
        column(&s, 2),
        [c2[0].clone(), c0[0].clone(), c2[1].clone(), c2[2].clone()]
    );
    // to the bottom of an empty-ended list
    ok(&db, &c, |tx, op, c| {
        tasks::move_task(
            tx,
            op,
            c,
            c0[1].clone(),
            1,
            Some(column(&s, 1)[2].clone()),
            None,
        )
    });
    assert_eq!(column(&snap(&db), 1).last(), Some(&c0[1]));
}

#[test]
fn move_task_rejects_bad_column_and_neighbours() {
    let db = seeded();
    let c = clock();
    let s = snap(&db);
    let (c0, c1) = (column(&s, 0), column(&s, 1));
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        tasks::move_task(tx, op, c, c0[0].clone(), 3, None, None)
    });
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        tasks::move_task(tx, op, c, c0[0].clone(), 0, Some(c1[0].clone()), None)
    });
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        tasks::move_task(
            tx,
            op,
            c,
            c0[0].clone(),
            0,
            Some(c0[2].clone()),
            Some(c0[1].clone()),
        )
    });
    let archived = s
        .tasks
        .iter()
        .find(|t| t.archived_at.is_some())
        .unwrap()
        .id
        .clone();
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        tasks::move_task(tx, op, c, archived.clone(), 0, None, None)
    });
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        tasks::move_task(tx, op, c, c0[0].clone(), 0, Some(archived.clone()), None)
    });
}

#[test]
fn archive_task_writes_archive_fields_and_history() {
    let db = seeded();
    let c = clock();
    let id = task_id_by_title(&snap(&db), "注册美卡");
    ok(&db, &c, |tx, op, c| {
        tasks::archive(tx, op, c, id.clone(), Some("  批了 ".into()))
    });
    let s = snap(&db);
    let t = s.tasks.iter().find(|t| t.id == id).unwrap();
    assert_eq!(
        (
            t.archived_at,
            t.archived_date.as_deref(),
            t.summary.as_deref()
        ),
        (Some(c.now_ms()), Some(TODAY), Some("批了"))
    );
    assert!(!column(&s, 0).contains(&id));
    assert_eq!(
        payload(&db, &id, TaskEventType::Archived)["summary"].as_str(),
        Some("批了")
    );
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        tasks::archive(tx, op, c, id.clone(), None)
    });
}

#[test]
fn archive_task_summary_limit_and_blank() {
    let db = seeded();
    let c = clock();
    let s = snap(&db);
    let a = task_id_by_title(&s, "课程作业");
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        tasks::archive(tx, op, c, a.clone(), Some("字".repeat(101)))
    });
    ok(&db, &c, |tx, op, c| {
        tasks::archive(tx, op, c, a.clone(), Some("   ".into()))
    });
    assert_eq!(
        snap(&db).tasks.iter().find(|t| t.id == a).unwrap().summary,
        None
    );
    let b = task_id_by_title(&s, "交报销单");
    ok(&db, &c, |tx, op, c| {
        tasks::archive(tx, op, c, b.clone(), Some("字".repeat(100)))
    });
}

#[test]
fn restore_task_goes_to_the_top_of_the_given_column_keeping_status() {
    let db = seeded();
    let c = clock();
    let s = snap(&db);
    let archived = s
        .tasks
        .iter()
        .find(|t| t.archived_at.is_some())
        .unwrap()
        .clone();
    ok(&db, &c, |tx, op, c| {
        tasks::restore(tx, op, c, archived.id.clone(), 2)
    });
    let s2 = snap(&db);
    assert_eq!(column(&s2, 2)[0], archived.id);
    let t = s2.tasks.iter().find(|t| t.id == archived.id).unwrap();
    assert_eq!((t.archived_at, t.archived_date.clone()), (None, None));
    assert_eq!(t.status, archived.status);
    assert_eq!(
        payload(&db, &archived.id, TaskEventType::Restored)["column"],
        2
    );
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        tasks::restore(tx, op, c, archived.id.clone(), 0)
    });
}

#[test]
fn restore_task_rejects_bad_column() {
    let db = seeded();
    let c = clock();
    let archived = snap(&db)
        .tasks
        .iter()
        .find(|t| t.archived_at.is_some())
        .unwrap()
        .id
        .clone();
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        tasks::restore(tx, op, c, archived.clone(), 5)
    });
}

#[test]
fn delete_task_takes_its_key_points_along() {
    let db = seeded();
    let c = clock();
    let s = snap(&db);
    let id = task_id_by_title(&s, "注册美卡");
    let kps = timeline(&s, &id);
    assert_eq!(kps.len(), 6);
    ok(&db, &c, |tx, op, c| tasks::delete(tx, op, c, id.clone()));
    let s2 = snap(&db);
    assert!(s2.tasks.iter().all(|t| t.id != id));
    assert!(timeline(&s2, &id).is_empty());
    for k in &kps {
        assert_eq!(
            raw::<Option<i64>>(&db, "key_points", "deleted_at", k),
            Some(c.now_ms())
        );
    }
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        tasks::delete(tx, op, c, id.clone())
    });
}

// ── key points ───────────────────────────────────────────────────────────────────────────

#[test]
fn add_key_point_appends_and_note_goes_before_the_first_open_one() {
    let db = seeded();
    let c = clock();
    let s = snap(&db);
    let card = task_id_by_title(&s, "注册美卡");
    let before = timeline(&s, &card); // 3 done, note, current wait, open do
    let (_, kp) = ok(&db, &c, |tx, op, c| {
        key_points::add(
            tx,
            op,
            c,
            card.clone(),
            kpi(KeyPointKind::Do, "绑定 Apple Pay", None),
        )
    });
    let (_, note) = ok(&db, &c, |tx, op, c| {
        key_points::add(
            tx,
            op,
            c,
            card.clone(),
            kpi(KeyPointKind::Note, "对方：补交地址证明", None),
        )
    });
    let after = timeline(&snap(&db), &card);
    let mut expect = before.clone();
    expect.insert(4, note.clone());
    expect.push(kp.clone());
    assert_eq!(after, expect);
    let n = snap(&db)
        .key_points
        .into_iter()
        .find(|k| k.id == note)
        .unwrap();
    assert_eq!(
        (n.who, n.date.as_deref()),
        (Some(NoteWho::Them), Some(TODAY))
    );
    let kinds = history_kinds(&db, &card);
    assert!(kinds.contains(&TaskEventType::KpAdded) && kinds.contains(&TaskEventType::NoteAdded));
}

#[test]
fn note_without_open_key_points_is_appended_and_keeps_given_who_and_date() {
    let db = seeded();
    let c = clock();
    let soft = task_id_by_title(&snap(&db), "orbit 软件著作权登记");
    let (_, note) = ok(&db, &c, |tx, op, c| {
        key_points::add(
            tx,
            op,
            c,
            soft.clone(),
            KeyPointInput {
                who: Some(NoteWho::Me),
                ..kpi(KeyPointKind::Note, "寄出证书复印件", Some("2026-09-27"))
            },
        )
    });
    let s = snap(&db);
    assert_eq!(timeline(&s, &soft).last(), Some(&note));
    let n = s.key_points.iter().find(|k| k.id == note).unwrap();
    assert_eq!(
        (n.who, n.date.as_deref()),
        (Some(NoteWho::Me), Some("2026-09-27"))
    );
}

#[test]
fn add_key_point_rejects_missing_task_and_bad_text() {
    let db = seeded();
    let c = clock();
    let card = task_id_by_title(&snap(&db), "注册美卡");
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        key_points::add(tx, op, c, "ghost".into(), kpi(KeyPointKind::Do, "x", None))
    });
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        key_points::add(tx, op, c, card.clone(), kpi(KeyPointKind::Do, " ", None))
    });
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        key_points::add(
            tx,
            op,
            c,
            card.clone(),
            kpi(KeyPointKind::Check, "x", Some("10/4")),
        )
    });
}

#[test]
fn update_key_point_replaces_and_records_from_to() {
    let db = seeded();
    let c = clock();
    let s = snap(&db);
    let card = task_id_by_title(&s, "注册美卡");
    let kp = kp_id_by_text(&s, "激活卡");
    ok(&db, &c, |tx, op, c| {
        key_points::update(
            tx,
            op,
            c,
            kp.clone(),
            kpi(KeyPointKind::Check, "10/8 激活卡", Some("2026-10-08")),
        )
    });
    let k = snap(&db)
        .key_points
        .into_iter()
        .find(|k| k.id == kp)
        .unwrap();
    assert_eq!(
        (k.kind, k.text.as_str(), k.date.as_deref()),
        (KeyPointKind::Check, "10/8 激活卡", Some("2026-10-08"))
    );
    let p = payload(&db, &card, TaskEventType::KpEdited);
    assert_eq!(
        (p["from"]["text"].as_str(), p["to"]["text"].as_str()),
        (Some("激活卡"), Some("10/8 激活卡"))
    );
    // a done current-less key point turned into a note loses its done state
    let done = kp_id_by_text(&s, "提交申请");
    ok(&db, &c, |tx, op, c| {
        key_points::update(
            tx,
            op,
            c,
            done.clone(),
            kpi(KeyPointKind::Note, "提交了", None),
        )
    });
    let k = snap(&db)
        .key_points
        .into_iter()
        .find(|k| k.id == done)
        .unwrap();
    assert_eq!(
        (k.kind, k.done_date, k.who),
        (KeyPointKind::Note, None, Some(NoteWho::Them))
    );
}

#[test]
fn update_key_point_rejects_missing_and_bad_date() {
    let db = seeded();
    let c = clock();
    let kp = kp_id_by_text(&snap(&db), "激活卡");
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        key_points::update(tx, op, c, "ghost".into(), kpi(KeyPointKind::Do, "x", None))
    });
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        key_points::update(
            tx,
            op,
            c,
            kp.clone(),
            kpi(KeyPointKind::Do, "x", Some("2026-02-29")),
        )
    });
}

#[test]
fn done_keeps_current_since() {
    let db = seeded();
    let c = clock();
    let s = snap(&db);
    let wait = kp_id_by_text(&s, "等审批 · 10/1 查");
    let k = s.key_points.iter().find(|k| k.id == wait).unwrap();
    assert!(k.is_current);
    assert_eq!(k.current_since.as_deref(), Some("2026-09-24"));
    ok(&db, &c, |tx, op, c| {
        key_points::set_done(tx, op, c, wait.clone(), true)
    });
    assert_eq!(raw::<i64>(&db, "key_points", "is_current", &wait), 0);
    assert_eq!(
        raw::<Option<String>>(&db, "key_points", "current_since", &wait).as_deref(),
        Some("2026-09-24")
    );
    assert_eq!(
        raw::<Option<String>>(&db, "key_points", "done_date", &wait).as_deref(),
        Some(TODAY)
    );
    let card = task_id_by_title(&s, "注册美卡");
    assert_eq!(
        payload(&db, &card, TaskEventType::KpDone)["text"].as_str(),
        Some("等审批 · 10/1 查")
    );
    // unchecking clears done_date only
    ok(&db, &c, |tx, op, c| {
        key_points::set_done(tx, op, c, wait.clone(), false)
    });
    let k = snap(&db)
        .key_points
        .into_iter()
        .find(|k| k.id == wait)
        .unwrap();
    assert_eq!(
        (k.done_date, k.is_current, k.current_since.as_deref()),
        (None, false, Some("2026-09-24"))
    );
    assert!(history_kinds(&db, &card).contains(&TaskEventType::KpUndone));
}

#[test]
fn set_key_point_done_rejects_notes_and_missing() {
    let db = seeded();
    let c = clock();
    let note = kp_id_by_text(&snap(&db), "邮件：申请已收到，7–10 个工作日内答复");
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        key_points::set_done(tx, op, c, note.clone(), true)
    });
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        key_points::set_done(tx, op, c, "ghost".into(), true)
    });
}

#[test]
fn move_key_point_within_its_task_only() {
    let db = seeded();
    let c = clock();
    let s = snap(&db);
    let card = task_id_by_title(&s, "注册美卡");
    let ppt = task_id_by_title(&s, "交会议 PPT");
    let tl = timeline(&s, &card);
    ok(&db, &c, |tx, op, c| {
        key_points::move_key_point(
            tx,
            op,
            c,
            tl[5].clone(),
            Some(tl[0].clone()),
            Some(tl[1].clone()),
        )
    });
    let after = timeline(&snap(&db), &card);
    assert_eq!(after[1], tl[5]);
    assert_eq!(after.len(), 6);
    let other = timeline(&s, &ppt)[0].clone();
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        key_points::move_key_point(tx, op, c, tl[0].clone(), Some(other.clone()), None)
    });
}

#[test]
fn move_key_point_rejects_dated_ones_and_notes() {
    let db = seeded();
    let c = clock();
    let s = snap(&db);
    let ppt = task_id_by_title(&s, "交会议 PPT");
    let tl = timeline(&s, &ppt);
    let check = kp_id_by_text(&s, "10/2 检查一遍初稿");
    let note = kp_id_by_text(&s, "邮件：申请已收到，7–10 个工作日内答复");
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        key_points::move_key_point(tx, op, c, check.clone(), None, Some(tl[0].clone()))
    });
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        key_points::move_key_point(tx, op, c, note.clone(), None, None)
    });
    assert_eq!(timeline(&snap(&db), &ppt), tl);
}

/// Owned ids for comparing against `timeline`.
fn ids(v: &[&String]) -> Vec<String> {
    v.iter().map(|s| (*s).clone()).collect()
}

#[test]
fn dated_key_points_keep_date_order_on_add_and_redate() {
    let db = seeded();
    let c = clock();
    let s = snap(&db);
    let ppt = task_id_by_title(&s, "交会议 PPT");
    // 列提纲 (done), 做 10 页初稿 (current), 10/2 检查一遍初稿 (10/2), 找同事过一遍
    let [outline, draft, check, review] = timeline(&s, &ppt).try_into().unwrap();
    let add = |text: &str, date: Option<&str>| {
        ok(&db, &c, |tx, op, c| {
            key_points::add(tx, op, c, ppt.clone(), kpi(KeyPointKind::Do, text, date))
        })
        .1
    };
    // Earlier than 10/2 → just before it; later than every dated one → appended; undated →
    // appended.
    let fix = add("10/1 改稿", Some("2026-10-01"));
    let send = add("10/3 交稿", Some("2026-10-03"));
    let thanks = add("谢谢同事", None);
    assert_eq!(
        timeline(&snap(&db), &ppt),
        ids(&[&outline, &draft, &fix, &check, &review, &send, &thanks])
    );
    // A date that no longer fits moves the row: after the last dated one (10/3 交稿).
    let (op_id, _) = ok(&db, &c, |tx, op, c| {
        key_points::update(
            tx,
            op,
            c,
            fix.clone(),
            kpi(KeyPointKind::Do, "改稿", Some("2026-10-05")),
        )
    });
    assert_eq!(
        timeline(&snap(&db), &ppt),
        ids(&[&outline, &draft, &check, &review, &send, &fix, &thanks])
    );
    // Undo puts it back.
    undo(&db, &[op_id], &c);
    assert_eq!(
        timeline(&snap(&db), &ppt),
        ids(&[&outline, &draft, &fix, &check, &review, &send, &thanks])
    );
    // A date that still fits, a text edit and clearing the date don't move it.
    for date in [Some("2026-10-02"), Some("2026-10-02"), None] {
        ok(&db, &c, |tx, op, c| {
            key_points::update(
                tx,
                op,
                c,
                fix.clone(),
                kpi(KeyPointKind::Do, "改稿 v2", date),
            )
        });
        assert_eq!(
            timeline(&snap(&db), &ppt),
            ids(&[&outline, &draft, &fix, &check, &review, &send, &thanks])
        );
    }
    // Dating an undated row puts it into place: 9/30 goes before 10/2.
    ok(&db, &c, |tx, op, c| {
        key_points::update(
            tx,
            op,
            c,
            thanks.clone(),
            kpi(KeyPointKind::Do, "谢谢同事", Some("2026-09-30")),
        )
    });
    assert_eq!(
        timeline(&snap(&db), &ppt),
        ids(&[&outline, &draft, &fix, &thanks, &check, &review, &send])
    );
}

#[test]
fn redated_note_moves_into_date_order() {
    let db = seeded();
    let c = clock();
    let s = snap(&db);
    let ppt = task_id_by_title(&s, "交会议 PPT");
    let [outline, draft, check, review] = timeline(&s, &ppt).try_into().unwrap();
    // A note lands before the first open key point (draft), dated today.
    let (_, note) = ok(&db, &c, |tx, op, c| {
        key_points::add(
            tx,
            op,
            c,
            ppt.clone(),
            KeyPointInput {
                kind: KeyPointKind::Note,
                text: "对方回了".into(),
                date: Some("2026-09-30".into()),
                who: Some(NoteWho::Them),
            },
        )
    });
    assert_eq!(
        timeline(&snap(&db), &ppt),
        ids(&[&outline, &note, &draft, &check, &review])
    );
    // Moving it to 10/9 puts it after 检查一遍初稿 (10/2), the last dated key point.
    ok(&db, &c, |tx, op, c| {
        key_points::update(
            tx,
            op,
            c,
            note.clone(),
            KeyPointInput {
                kind: KeyPointKind::Note,
                text: "对方回了".into(),
                date: Some("2026-10-09".into()),
                who: Some(NoteWho::Them),
            },
        )
    });
    assert_eq!(
        timeline(&snap(&db), &ppt),
        ids(&[&outline, &draft, &check, &note, &review])
    );
}

#[test]
fn delete_key_point_soft_with_history() {
    let db = seeded();
    let c = clock();
    let s = snap(&db);
    let card = task_id_by_title(&s, "注册美卡");
    let kp = kp_id_by_text(&s, "激活卡");
    ok(&db, &c, |tx, op, c| {
        key_points::delete(tx, op, c, kp.clone())
    });
    assert!(snap(&db).key_points.iter().all(|k| k.id != kp));
    assert_eq!(
        payload(&db, &card, TaskEventType::KpDeleted)["text"].as_str(),
        Some("激活卡")
    );
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        key_points::delete(tx, op, c, kp.clone())
    });
}
