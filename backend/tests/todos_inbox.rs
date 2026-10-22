//! Todos and inbox: one positive and at least one negative case per command, plus the reminder
//! and ordering rules of architecture §6.2.

mod common;

use common::*;
use weekpage::db::{inbox, todos};
use weekpage::error::ErrorCode;
use weekpage::model::TodoInput;
use weekpage::test_support::fixed_clock;

fn todo(title: &str, date: Option<&str>, time: Option<&str>) -> TodoInput {
    TodoInput {
        title: title.into(),
        remind_date: date.map(Into::into),
        remind_time: time.map(Into::into),
    }
}

fn notified(db: &weekpage::db::Db, id: &str, at: i64) {
    db.with_tx(|tx| {
        tx.execute(
            "UPDATE todos SET remind_notified_at = ?1 WHERE id = ?2",
            rusqlite::params![at, id],
        )?;
        Ok(())
    })
    .unwrap();
}

#[test]
fn create_todo_appends_with_created_date_today() {
    let db = seeded();
    let c = clock();
    let (_, id) = ok(&db, &c, |tx, op, c| {
        todos::create(tx, op, c, todo(" 买牛奶 ", Some("2026-10-05"), None), None)
    });
    let s = snap(&db);
    let t = s.todos.iter().find(|t| t.id == id).unwrap();
    assert_eq!(t.title, "买牛奶");
    assert_eq!(t.created_date, TODAY);
    assert_eq!(open_todos(&s).last(), Some(&id));
    assert!(
        s.todos
            .iter()
            .all(|o| o.id == id || o.sort_key < t.sort_key),
        "after done and archived todos too"
    );
}

#[test]
fn create_todo_from_inbox_removes_the_item_in_the_same_op() {
    let db = seeded();
    let c = clock();
    let item = snap(&db).inbox[0].id.clone();
    ok(&db, &c, |tx, op, c| {
        todos::create(tx, op, c, todo("x", None, None), Some(item.clone()))
    });
    let s = snap(&db);
    assert_eq!(s.inbox.len(), 2);
    assert!(s.inbox.iter().all(|i| i.id != item));
}

#[test]
fn create_todo_rejects_bad_input_and_rolls_back() {
    let db = seeded();
    let c = clock();
    let before = snap(&db);
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        todos::create(tx, op, c, todo(" ", None, None), None)
    });
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        todos::create(tx, op, c, todo("x", None, Some("18:00")), None)
    });
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        todos::create(tx, op, c, todo("x", None, None), Some("missing".into()))
    });
    assert_eq!(snap(&db), before);
}

#[test]
fn update_todo_clears_notified_only_when_the_reminder_changes() {
    let db = empty();
    let c = clock();
    let (_, id) = ok(&db, &c, |tx, op, c| {
        todos::create(
            tx,
            op,
            c,
            todo("a", Some("2026-10-01"), Some("09:00")),
            None,
        )
    });
    notified(&db, &id, 1);
    ok(&db, &c, |tx, op, c| {
        todos::update(
            tx,
            op,
            c,
            id.clone(),
            todo("b", Some("2026-10-01"), Some("09:00")),
        )
    });
    assert_eq!(
        raw::<Option<i64>>(&db, "todos", "remind_notified_at", &id),
        Some(1)
    );
    ok(&db, &c, |tx, op, c| {
        todos::update(
            tx,
            op,
            c,
            id.clone(),
            todo("b", Some("2026-10-01"), Some("10:00")),
        )
    });
    assert_eq!(
        raw::<Option<i64>>(&db, "todos", "remind_notified_at", &id),
        None
    );
    notified(&db, &id, 2);
    ok(&db, &c, |tx, op, c| {
        todos::update(tx, op, c, id.clone(), todo("b", None, None))
    });
    assert_eq!(
        raw::<Option<i64>>(&db, "todos", "remind_notified_at", &id),
        None
    );
    assert_eq!(snap(&db).todos[0].title, "b");
}

#[test]
fn update_todo_rejects_missing_and_too_long() {
    let db = empty();
    let c = clock();
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        todos::update(tx, op, c, "nope".into(), todo("x", None, None))
    });
    let (_, id) = ok(&db, &c, |tx, op, c| {
        todos::create(tx, op, c, todo("a", None, None), None)
    });
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        todos::update(tx, op, c, id.clone(), todo(&"长".repeat(201), None, None))
    });
}

#[test]
fn set_todo_done_writes_and_clears_done_fields() {
    let db = empty();
    let c = clock();
    let (_, id) = ok(&db, &c, |tx, op, c| {
        todos::create(tx, op, c, todo("a", None, None), None)
    });
    ok(&db, &c, |tx, op, c| {
        todos::set_done(tx, op, c, id.clone(), true)
    });
    let t = &snap(&db).todos[0];
    assert_eq!(
        (t.done_at, t.done_date.as_deref()),
        (Some(c.now_ms()), Some(TODAY))
    );
    // checking again keeps the first completion moment
    ok(&db, &later(), |tx, op, c| {
        todos::set_done(tx, op, c, id.clone(), true)
    });
    assert_eq!(snap(&db).todos[0].done_at, Some(c.now_ms()));
    ok(&db, &c, |tx, op, c| {
        todos::set_done(tx, op, c, id.clone(), false)
    });
    let t = &snap(&db).todos[0];
    assert_eq!((t.done_at, t.done_date.clone()), (None, None));
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        todos::set_done(tx, op, c, "nope".into(), true)
    });
}

#[test]
fn unchecking_keeps_position_and_clears_a_past_reminder_only() {
    let db = empty();
    let day1 = fixed_clock("2026-09-28T10:00");
    let mut ids = vec![];
    for (title, date) in [
        ("a", Some("2026-09-28")),
        ("b", Some("2026-10-05")),
        ("c", None),
    ] {
        ids.push(
            ok(&db, &day1, |tx, op, c| {
                todos::create(tx, op, c, todo(title, date, None), None)
            })
            .1,
        );
    }
    for id in &ids {
        ok(&db, &day1, |tx, op, c| {
            todos::set_done(tx, op, c, id.clone(), true)
        });
    }
    let c = clock(); // two days later
    for id in &ids {
        ok(&db, &c, |tx, op, c| {
            todos::set_done(tx, op, c, id.clone(), false)
        });
    }
    let s = snap(&db);
    assert_eq!(open_todos(&s), ids, "original order kept");
    assert_eq!(s.todos[0].remind_date, None, "9/28 reminder is over");
    assert_eq!(s.todos[1].remind_date.as_deref(), Some("2026-10-05"));
}

#[test]
fn restore_todo_goes_last_and_clears_a_past_reminder() {
    let db = seeded();
    let c = clock();
    let s = snap(&db);
    let archived = s
        .todos
        .iter()
        .find(|t| t.done_date.as_deref().is_some_and(|d| d < TODAY))
        .unwrap()
        .clone();
    ok(&db, &c, |tx, op, c| {
        todos::restore(tx, op, c, archived.id.clone())
    });
    let s2 = snap(&db);
    assert_eq!(open_todos(&s2).last(), Some(&archived.id));
    let t = s2.todos.iter().find(|t| t.id == archived.id).unwrap();
    assert_eq!((t.done_at, t.done_date.clone()), (None, None));
    if archived.remind_date.as_deref().is_some_and(|d| d < TODAY) {
        assert_eq!(t.remind_date, None);
    }
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        todos::restore(tx, op, c, "nope".into())
    });
}

#[test]
fn restore_todo_keeps_a_future_reminder_and_clears_a_past_one() {
    let db = empty();
    let c = clock();
    let (_, past) = ok(&db, &c, |tx, op, c| {
        todos::create(
            tx,
            op,
            c,
            todo("past", Some("2026-09-29"), Some("09:00")),
            None,
        )
    });
    let (_, future) = ok(&db, &c, |tx, op, c| {
        todos::create(tx, op, c, todo("future", Some("2026-10-09"), None), None)
    });
    for id in [&past, &future] {
        ok(&db, &c, |tx, op, c| {
            todos::set_done(tx, op, c, id.clone(), true)
        });
        ok(&db, &c, |tx, op, c| todos::restore(tx, op, c, id.clone()));
    }
    let s = snap(&db);
    let p = s.todos.iter().find(|t| t.id == past).unwrap();
    let f = s.todos.iter().find(|t| t.id == future).unwrap();
    assert_eq!((p.remind_date.clone(), p.remind_time.clone()), (None, None));
    assert_eq!(f.remind_date.as_deref(), Some("2026-10-09"));
}

#[test]
fn move_todo_between_neighbours() {
    let db = seeded();
    let c = clock();
    let open = open_todos(&snap(&db));
    // last → between first and second
    ok(&db, &c, |tx, op, c| {
        todos::move_todo(
            tx,
            op,
            c,
            open[3].clone(),
            Some(open[0].clone()),
            Some(open[1].clone()),
        )
    });
    assert_eq!(
        open_todos(&snap(&db)),
        [
            open[0].clone(),
            open[3].clone(),
            open[1].clone(),
            open[2].clone()
        ]
    );
}

#[test]
fn move_todo_rejects_bad_neighbours() {
    let db = seeded();
    let c = clock();
    let open = open_todos(&snap(&db));
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        todos::move_todo(
            tx,
            op,
            c,
            open[0].clone(),
            Some(open[3].clone()),
            Some(open[1].clone()),
        )
    });
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        todos::move_todo(tx, op, c, open[0].clone(), Some(open[0].clone()), None)
    });
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        todos::move_todo(tx, op, c, open[0].clone(), Some("ghost".into()), None)
    });
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        todos::move_todo(tx, op, c, "ghost".into(), None, None)
    });
}

#[test]
fn delete_todo_soft_and_once() {
    let db = seeded();
    let c = clock();
    let id = open_todos(&snap(&db))[0].clone();
    ok(&db, &c, |tx, op, c| todos::delete(tx, op, c, id.clone()));
    assert!(snap(&db).todos.iter().all(|t| t.id != id));
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        todos::delete(tx, op, c, id.clone())
    });
}

#[test]
fn create_inbox_item_goes_on_top() {
    let db = seeded();
    let c = clock();
    let (_, id) = ok(&db, &c, |tx, op, c| {
        inbox::create(tx, op, c, "  新想法 ".into())
    });
    let s = snap(&db);
    assert_eq!(s.inbox.len(), 4);
    assert_eq!(
        (s.inbox[0].id.as_str(), s.inbox[0].text.as_str()),
        (id.as_str(), "新想法")
    );
}

#[test]
fn create_inbox_item_rejects_blank_and_too_long() {
    let db = empty();
    let c = clock();
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        inbox::create(tx, op, c, "\n ".into())
    });
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        inbox::create(tx, op, c, "字".repeat(501))
    });
    ok(&db, &c, |tx, op, c| {
        inbox::create(tx, op, c, "字".repeat(500))
    });
}

#[test]
fn update_inbox_item_edits_text() {
    let db = seeded();
    let c = clock();
    let id = snap(&db).inbox[1].id.clone();
    ok(&db, &c, |tx, op, c| {
        inbox::update(tx, op, c, id.clone(), "改过".into())
    });
    assert_eq!(snap(&db).inbox[1].text, "改过");
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        inbox::update(tx, op, c, id.clone(), "".into())
    });
    ok(&db, &c, |tx, op, c| inbox::delete(tx, op, c, id.clone()));
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        inbox::update(tx, op, c, id.clone(), "x".into())
    });
}

#[test]
fn delete_inbox_item_soft_and_once() {
    let db = seeded();
    let c = clock();
    let id = snap(&db).inbox[2].id.clone();
    ok(&db, &c, |tx, op, c| inbox::delete(tx, op, c, id.clone()));
    assert_eq!(snap(&db).inbox.len(), 2);
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        inbox::delete(tx, op, c, id.clone())
    });
}
