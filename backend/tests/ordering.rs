//! Sort keys: random moves keep every list strictly ordered; new keys never reuse a key that an
//! undo could bring back; todo uncheck / restore positions.

mod common;

use common::*;
use weekpage::db::{inbox, key_points, tasks, todos};
use weekpage::model::{KeyPointInput, KeyPointKind, NewTaskInput, TodoInput};

fn strictly_sorted(keys: &[String]) {
    for w in keys.windows(2) {
        assert!(w[0] < w[1], "{:?} < {:?}", w[0], w[1]);
    }
}

#[test]
fn hundred_random_task_moves_keep_columns_strictly_ordered() {
    let db = seeded();
    let c = clock();
    let mut rng = Lcg(7);
    for _ in 0..100 {
        let s = snap(&db);
        let cards: Vec<_> = s.tasks.iter().filter(|t| t.archived_at.is_none()).collect();
        let moved = cards[rng.next(cards.len())].id.clone();
        let target = rng.next(3) as u8;
        let mut col: Vec<String> = column(&s, target)
            .into_iter()
            .filter(|id| *id != moved)
            .collect();
        let pos = rng.next(col.len() + 1);
        let prev = if pos == 0 {
            None
        } else {
            Some(col[pos - 1].clone())
        };
        let next = col.get(pos).cloned();
        ok(&db, &c, |tx, op, c| {
            tasks::move_task(tx, op, c, moved.clone(), target, prev, next)
        });
        col.insert(pos, moved.clone());
        let s = snap(&db);
        assert_eq!(column(&s, target), col, "landed where asked");
        for k in 0..3u8 {
            let keys: Vec<String> = s
                .tasks
                .iter()
                .filter(|t| t.archived_at.is_none() && t.board_column == k)
                .map(|t| t.sort_key.clone())
                .collect();
            strictly_sorted(&keys);
        }
    }
    assert_eq!(
        snap(&db)
            .tasks
            .iter()
            .filter(|t| t.archived_at.is_none())
            .count(),
        9
    );
}

#[test]
fn hundred_random_todo_and_key_point_moves_stay_strictly_ordered() {
    let db = seeded();
    let c = clock();
    let mut rng = Lcg(2026);
    let card = task_id_by_title(&snap(&db), "orbit 域名备案");
    for i in 0..100 {
        let s = snap(&db);
        // Any todo moves; of the key points only undated ones do (dated ones follow their date).
        let (list, movable, is_todo) = if i % 2 == 0 {
            let ids = s.todos.iter().map(|t| t.id.clone()).collect::<Vec<_>>();
            (ids.clone(), ids, true)
        } else {
            let undated = s
                .key_points
                .iter()
                .filter(|k| k.task_id == card && k.date.is_none())
                .map(|k| k.id.clone())
                .collect::<Vec<_>>();
            (timeline(&s, &card), undated, false)
        };
        let moved = movable[rng.next(movable.len())].clone();
        let mut rest: Vec<String> = list.into_iter().filter(|id| *id != moved).collect();
        let pos = rng.next(rest.len() + 1);
        let prev = if pos == 0 {
            None
        } else {
            Some(rest[pos - 1].clone())
        };
        let next = rest.get(pos).cloned();
        if is_todo {
            ok(&db, &c, |tx, op, c| {
                todos::move_todo(tx, op, c, moved.clone(), prev, next)
            });
        } else {
            ok(&db, &c, |tx, op, c| {
                key_points::move_key_point(tx, op, c, moved.clone(), prev, next)
            });
        }
        rest.insert(pos, moved);
        let s = snap(&db);
        if is_todo {
            assert_eq!(
                s.todos.iter().map(|t| t.id.clone()).collect::<Vec<_>>(),
                rest
            );
        } else {
            assert_eq!(timeline(&s, &card), rest);
        }
        strictly_sorted(
            &s.todos
                .iter()
                .map(|t| t.sort_key.clone())
                .collect::<Vec<_>>(),
        );
        strictly_sorted(
            &s.key_points
                .iter()
                .filter(|k| k.task_id == card)
                .map(|k| k.sort_key.clone())
                .collect::<Vec<_>>(),
        );
    }
}

#[test]
fn new_keys_never_collide_with_tombstoned_rows() {
    let db = seeded();
    let c = clock();
    // delete the last todo, append a new one, undo the delete: keys must stay unique
    let last = snap(&db).todos.last().unwrap().id.clone();
    let (del, _) = ok(&db, &c, |tx, op, c| todos::delete(tx, op, c, last.clone()));
    ok(&db, &c, |tx, op, c| {
        todos::create(
            tx,
            op,
            c,
            TodoInput {
                title: "new".into(),
                remind_date: None,
                remind_time: None,
            },
            None,
        )
    });
    undo(&db, &[del], &later());
    let keys: Vec<String> = snap(&db).todos.iter().map(|t| t.sort_key.clone()).collect();
    strictly_sorted(&keys);
    // same for the inbox top and a board column top
    let first = snap(&db).inbox[0].id.clone();
    let (del, _) = ok(&db, &c, |tx, op, c| inbox::delete(tx, op, c, first.clone()));
    ok(&db, &c, |tx, op, c| inbox::create(tx, op, c, "top".into()));
    undo(&db, &[del], &later());
    strictly_sorted(
        &snap(&db)
            .inbox
            .iter()
            .map(|i| i.sort_key.clone())
            .collect::<Vec<_>>(),
    );
    let top = column(&snap(&db), 0)[0].clone();
    let (del, _) = ok(&db, &c, |tx, op, c| tasks::delete(tx, op, c, top.clone()));
    ok(&db, &c, |tx, op, c| {
        tasks::create(
            tx,
            op,
            c,
            NewTaskInput {
                title: "t".into(),
                start_date: TODAY.into(),
                due_date: None,
                remind_day_before: false,
                column: 0,
                key_points: vec![KeyPointInput {
                    kind: KeyPointKind::Do,
                    text: "k".into(),
                    date: None,
                    who: None,
                }],
                from_inbox_id: None,
            },
        )
    });
    undo(&db, &[del], &later());
    let s = snap(&db);
    strictly_sorted(
        &s.tasks
            .iter()
            .filter(|t| t.archived_at.is_none() && t.board_column == 0)
            .map(|t| t.sort_key.clone())
            .collect::<Vec<_>>(),
    );
}

#[test]
fn restore_todo_is_last_of_open_and_uncheck_returns_to_place() {
    let db = seeded();
    let c = clock();
    let s = snap(&db);
    let open = open_todos(&s);
    // uncheck from "today done": back between its old neighbours
    let done_today = s
        .todos
        .iter()
        .find(|t| t.done_date.as_deref() == Some(TODAY))
        .unwrap()
        .clone();
    let mut expect: Vec<(String, String)> = s
        .todos
        .iter()
        .filter(|t| t.done_date.is_none() || t.id == done_today.id)
        .map(|t| (t.sort_key.clone(), t.id.clone()))
        .collect();
    expect.sort();
    ok(&db, &c, |tx, op, c| {
        todos::set_done(tx, op, c, done_today.id.clone(), false)
    });
    let s2 = snap(&db);
    assert_eq!(
        open_todos(&s2),
        expect.into_iter().map(|(_, id)| id).collect::<Vec<_>>()
    );
    assert_eq!(
        s2.todos
            .iter()
            .find(|t| t.id == done_today.id)
            .unwrap()
            .sort_key,
        done_today.sort_key,
        "sort key kept"
    );
    // check one open todo and uncheck it again: same position
    ok(&db, &c, |tx, op, c| {
        todos::set_done(tx, op, c, open[1].clone(), true)
    });
    ok(&db, &c, |tx, op, c| {
        todos::set_done(tx, op, c, open[1].clone(), false)
    });
    assert_eq!(open_todos(&snap(&db)), open_todos(&s2));
    // restore from the archive: last of the open list
    let archived = s
        .todos
        .iter()
        .find(|t| t.done_date.as_deref().is_some_and(|d| d < TODAY))
        .unwrap()
        .id
        .clone();
    ok(&db, &c, |tx, op, c| {
        todos::restore(tx, op, c, archived.clone())
    });
    let open3 = open_todos(&snap(&db));
    assert_eq!(open3.last(), Some(&archived));
    assert_eq!(open3.len(), open_todos(&s2).len() + 1);
}
