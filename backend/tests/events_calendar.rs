//! Events and calendar day orders: one positive and at least one negative case per command.

mod common;

use common::*;
use weekpage::db::{calendar, events};
use weekpage::error::ErrorCode;
use weekpage::model::EventInput;

fn input(date: &str, time: Option<&str>, end: Option<&str>, title: &str) -> EventInput {
    EventInput {
        date: date.into(),
        time: time.map(Into::into),
        end_time: end.map(Into::into),
        title: title.into(),
    }
}

#[test]
fn create_event_trims_and_stamps_with_the_clock() {
    let db = empty();
    let c = clock();
    let (_, id) = ok(&db, &c, |tx, op, c| {
        events::create(
            tx,
            op,
            c,
            input("2026-10-01", Some("09:30"), None, " 周会 "),
        )
    });
    let s = snap(&db);
    assert_eq!(s.events.len(), 1);
    let e = &s.events[0];
    assert_eq!((e.id.as_str(), e.title.as_str()), (id.as_str(), "周会"));
    assert_eq!((e.created_at, e.updated_at), (c.now_ms(), c.now_ms()));
}

#[test]
fn create_event_rejects_bad_input() {
    let db = empty();
    let c = clock();
    for bad in [
        input("2026-10-01", None, None, "   "),
        input("2026-02-30", None, None, "no such day"),
        input("2026/10/01", None, None, "slashes"),
        input("2026-10-01", Some("24:00"), None, "bad hour"),
        input("2026-10-01", Some("9:30"), None, "one-digit hour"),
        input("2026-10-01", None, Some("17:00"), "end without start"),
        input("2026-10-01", None, None, &"x".repeat(201)),
    ] {
        fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
            events::create(tx, op, c, bad)
        });
    }
    assert!(snap(&db).events.is_empty());
}

#[test]
fn update_event_replaces_the_whole_row() {
    let db = empty();
    let c = clock();
    let (_, id) = ok(&db, &c, |tx, op, c| {
        events::create(
            tx,
            op,
            c,
            input("2026-10-01", Some("15:00"), Some("17:00"), "演唱会"),
        )
    });
    let l = later();
    ok(&db, &l, |tx, op, c| {
        events::update(
            tx,
            op,
            c,
            id.clone(),
            input("2026-10-02", None, None, "改期"),
        )
    });
    let e = &snap(&db).events[0];
    assert_eq!(e.date, "2026-10-02");
    assert_eq!((e.time.clone(), e.end_time.clone()), (None, None));
    assert_eq!(e.title, "改期");
    assert_eq!((e.created_at, e.updated_at), (c.now_ms(), l.now_ms()));
}

#[test]
fn update_event_rejects_missing_row_and_bad_input() {
    let db = empty();
    let c = clock();
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        events::update(
            tx,
            op,
            c,
            "nope".into(),
            input("2026-10-01", None, None, "x"),
        )
    });
    let (_, id) = ok(&db, &c, |tx, op, c| {
        events::create(tx, op, c, input("2026-10-01", None, None, "x"))
    });
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        events::update(
            tx,
            op,
            c,
            id.clone(),
            input("2026-10-01", Some("7pm"), None, "x"),
        )
    });
}

#[test]
fn delete_event_is_soft_and_only_once() {
    let db = seeded();
    let c = clock();
    let id = snap(&db).events[0].id.clone();
    ok(&db, &c, |tx, op, c| events::delete(tx, op, c, id.clone()));
    assert_eq!(snap(&db).events.len(), 10);
    assert_eq!(
        raw::<Option<i64>>(&db, "events", "deleted_at", &id),
        Some(c.now_ms())
    );
    fails(&db, &c, ErrorCode::NotFound, |tx, op, c| {
        events::delete(tx, op, c, id.clone())
    });
}

#[test]
fn set_day_order_upserts_one_row_per_day() {
    let db = empty();
    let c = clock();
    let (_, a) = ok(&db, &c, |tx, op, c| {
        calendar::set_day_order(
            tx,
            op,
            c,
            "2026-10-09".into(),
            vec!["event:1".into(), "todo:2".into(), "event:1".into()],
        )
    });
    let (_, b) = ok(&db, &later(), |tx, op, c| {
        calendar::set_day_order(tx, op, c, "2026-10-09".into(), vec!["todo:2".into()])
    });
    assert_eq!(a, b, "same row for the same day");
    let s = snap(&db);
    assert_eq!(s.day_orders.len(), 1);
    assert_eq!(s.day_orders[0].item_keys, ["todo:2"]);
    assert_eq!(s.day_orders[0].updated_at, later().now_ms());
}

#[test]
fn set_day_order_revives_a_row_tombstoned_by_undo() {
    let db = empty();
    let c = clock();
    let (op1, id) = ok(&db, &c, |tx, op, c| {
        calendar::set_day_order(tx, op, c, "2026-10-09".into(), vec!["event:1".into()])
    });
    undo(&db, &[op1], &c);
    assert!(snap(&db).day_orders.is_empty());
    let (_, again) = ok(&db, &c, |tx, op, c| {
        calendar::set_day_order(tx, op, c, "2026-10-09".into(), vec!["todo:9".into()])
    });
    assert_eq!(again, id);
    assert_eq!(snap(&db).day_orders[0].item_keys, ["todo:9"]);
}

#[test]
fn set_day_order_rejects_bad_date_and_keys() {
    let db = empty();
    let c = clock();
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        calendar::set_day_order(tx, op, c, "10/9".into(), vec![])
    });
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        calendar::set_day_order(tx, op, c, "2026-10-09".into(), vec!["  ".into()])
    });
    fails(&db, &c, ErrorCode::Invalid, |tx, op, c| {
        calendar::set_day_order(tx, op, c, "2026-10-09".into(), vec!["nokind".into()])
    });
}
