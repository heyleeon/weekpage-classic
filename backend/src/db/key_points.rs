//! Key points and notes (关键点 / 记一笔) write repository.
//!
//! Repository contract (architecture §6.2): `fn(tx, op, clock, …) -> Result<Option<String>, AppError>`;
//! call `op.capture(tx, table, &id)?` before changing a row and `op.created(tx, table, &id)?`
//! after inserting one; INSERT writes `created_at = updated_at = clock.now_ms()`, UPDATE writes
//! `updated_at`; deletes are soft (`deleted_at`). Return the id of the created / changed row.
//!
//! Key points and notes share one timeline order (`sort_key` within a task). Dated key points
//! keep that order chronological: adding one or changing its date puts it into place
//! (`date_slot`), and only undated key points can be moved by hand. Every write records task
//! history (`kp_added / note_added / kp_edited / kp_done / kp_undone / kp_deleted`); moving has
//! no history type in the DDL and records nothing. "Current" is derived in the frontend (first
//! open step); `is_current` / `current_since` and old `kp_current` history rows stay readable but
//! nothing writes them any more.

use rusqlite::types::Value;
use rusqlite::{OptionalExtension, Transaction, params};
use serde_json::json;

use crate::clock::Clock;
use crate::error::AppError;
use crate::model::{KeyPoint, KeyPointInput, KeyPointKind, NoteWho};

use super::events::repo::{self, Scope};
use super::{Op, history, snapshot};

/// Max characters of a key point / note (DDL CHECK).
pub const TEXT_MAX: usize = 200;

/// A validated key point input, ready to store.
pub(super) struct KpRow {
    pub kind: KeyPointKind,
    pub text: String,
    pub date: Option<String>,
    pub who: Option<NoteWho>,
}

/// Trims and checks the input. Notes get `who = them` and `date = today` when missing;
/// `who` is dropped for the other kinds (the DDL only allows it on notes).
pub(super) fn validate(clock: &Clock, input: KeyPointInput) -> Result<KpRow, AppError> {
    let text = repo::text(&input.text, "key point text", TEXT_MAX)?;
    let date = repo::opt_date(input.date, "key point date")?;
    Ok(if input.kind == KeyPointKind::Note {
        KpRow {
            kind: input.kind,
            text,
            date: Some(date.unwrap_or_else(|| clock.today())),
            who: Some(input.who.unwrap_or(NoteWho::Them)),
        }
    } else {
        KpRow {
            kind: input.kind,
            text,
            date,
            who: None,
        }
    })
}

pub(super) fn scope(task_id: &str) -> Scope {
    Scope::filtered("key_points", "task_id", Value::Text(task_id.to_string()))
}

/// Inserts one row with `sort_key` (no history; callers record it).
pub(super) fn insert(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    task_id: &str,
    row: &KpRow,
    sort_key: &str,
) -> Result<String, AppError> {
    let id = super::new_id();
    tx.execute(
        "INSERT INTO key_points (id, task_id, kind, text, date, who, sort_key, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![
            id,
            task_id,
            row.kind.as_str(),
            row.text,
            row.date,
            row.who.map(NoteWho::as_str),
            sort_key,
            clock.now_ms()
        ],
    )?;
    op.created(tx, "key_points", &id)?;
    Ok(id)
}

/// A live key point, or `not_found`.
fn load(tx: &Transaction<'_>, id: &str) -> Result<KeyPoint, AppError> {
    tx.query_row(
        "SELECT * FROM key_points WHERE id = ?1 AND deleted_at IS NULL",
        [id],
        snapshot::key_point,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found(format!("key point {id} not found")))
}

/// Where a new note goes: just before the first open (not done) non-note key point, or `None`
/// when there is none (then it is appended).
fn note_slot(
    tx: &Transaction<'_>,
    task_id: &str,
) -> Result<Option<(Option<String>, String)>, AppError> {
    let next: Option<String> = tx
        .query_row(
            "SELECT sort_key FROM key_points
             WHERE task_id = ?1 AND deleted_at IS NULL AND kind <> 'note' AND done_date IS NULL
             ORDER BY sort_key, id LIMIT 1",
            [task_id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(next) = next else { return Ok(None) };
    let prev: Option<String> = tx
        .query_row(
            "SELECT sort_key FROM key_points
             WHERE task_id = ?1 AND deleted_at IS NULL AND sort_key < ?2
             ORDER BY sort_key DESC, id DESC LIMIT 1",
            params![task_id, next],
            |r| r.get(0),
        )
        .optional()?;
    Ok(Some((prev, next)))
}

/// Neighbour keys to insert between: (prev, next), `None` = open end.
type Slot = (Option<String>, Option<String>);

/// Where a key point dated `date` has to go so that no dated key point before it is later and
/// none after it is earlier; `None` when its place already fits. `own` = its id and current key
/// (`None` for a new row, which would be appended). Undated key points don't constrain the order;
/// notes don't either, unless `notes` is set (a note being redated lines up with every dated row). A misplaced row goes just before the first later dated key point, else just after
/// the last dated one.
fn date_slot(
    tx: &Transaction<'_>,
    task_id: &str,
    own: Option<(&str, &str)>,
    date: &str,
    notes: bool,
) -> Result<Option<Slot>, AppError> {
    let mut stmt = tx.prepare(
        "SELECT id, sort_key, CASE WHEN ?2 OR kind <> 'note' THEN date END FROM key_points
         WHERE task_id = ?1 AND deleted_at IS NULL
         ORDER BY sort_key, id",
    )?;
    let rows = stmt
        .query_map(params![task_id, notes], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let rows: Vec<(String, Option<String>)> = rows
        .into_iter()
        .filter(|(id, _, _)| own.is_none_or(|(own_id, _)| id != own_id))
        .map(|(_, key, date)| (key, date))
        .collect();
    let before = |key: &str| own.is_none_or(|(_, own_key)| key < own_key);
    let fits = rows.iter().all(|(key, d)| match d.as_deref() {
        Some(d) if before(key) => d <= date,
        Some(d) => d >= date,
        None => true,
    });
    if fits {
        return Ok(None);
    }
    let key_at = |i: usize| rows.get(i).map(|(key, _)| key.clone());
    if let Some(i) = rows
        .iter()
        .position(|(_, d)| d.as_deref().is_some_and(|d| d > date))
    {
        let prev = i.checked_sub(1).and_then(key_at);
        return Ok(Some((prev, key_at(i))));
    }
    let last = rows.iter().rposition(|(_, d)| d.is_some()).unwrap_or(0);
    Ok(Some((key_at(last), key_at(last + 1))))
}

fn summary(kp: &KeyPoint) -> serde_json::Value {
    json!({ "kpId": kp.id, "kind": kp.kind.as_str(), "text": kp.text, "date": kp.date })
}

fn touch(tx: &Transaction<'_>, clock: &Clock, id: &str) -> Result<(), AppError> {
    tx.execute(
        "UPDATE key_points SET updated_at = ?1 WHERE id = ?2",
        params![clock.now_ms(), id],
    )?;
    Ok(())
}

/// `add_key_point`: key points append at the end, a dated one goes into date order; a `note` goes before the first open key point (else at the end), `who` defaults to `them`, `date` to today; history `kp_added` / `note_added`.
pub fn add(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    task_id: String,
    input: KeyPointInput,
) -> Result<Option<String>, AppError> {
    repo::ensure_live(tx, "tasks", &task_id)?;
    let row = validate(clock, input)?;
    let scope = scope(&task_id);
    let slot = match (row.kind, row.date.as_deref()) {
        (KeyPointKind::Note, _) => note_slot(tx, &task_id)?.map(|(prev, next)| (prev, Some(next))),
        (_, Some(date)) => date_slot(tx, &task_id, None, date, false)?,
        (_, None) => None,
    };
    let key = match slot {
        Some((prev, next)) => scope.free_between(tx, prev, next.as_deref())?,
        None => scope.after_last(tx)?,
    };
    let id = insert(tx, op, clock, &task_id, &row, &key)?;
    let (kind, payload) = if row.kind == KeyPointKind::Note {
        (
            "note_added",
            json!({ "kpId": id, "text": row.text, "date": row.date,
                    "who": row.who.map(NoteWho::as_str) }),
        )
    } else {
        (
            "kp_added",
            json!({ "kpId": id, "kind": row.kind.as_str(), "text": row.text, "date": row.date }),
        )
    };
    history::record(tx, op, clock, &task_id, kind, payload)?;
    Ok(Some(id))
}

/// `update_key_point`: history `kp_edited`.
///
/// Whole-input replace of kind / text / date / who. Turning a key point into a note clears its
/// done / current state (a note is never done or current); turning a note into a key point drops
/// `who`. A key point (or note) whose date changed moves into date order when its place no longer fits.
pub fn update(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    id: String,
    input: KeyPointInput,
) -> Result<Option<String>, AppError> {
    let before = load(tx, &id)?;
    let row = validate(clock, input)?;
    op.capture(tx, "key_points", &id)?;
    let is_note = row.kind == KeyPointKind::Note;
    let redate = !is_note && (before.date != row.date || before.kind == KeyPointKind::Note);
    // A note whose date changed also moves into date order (among notes and key points alike).
    let note_redate = is_note && before.kind == KeyPointKind::Note && before.date != row.date;
    let new_key = match row.date.as_deref() {
        Some(date) if redate || note_redate => {
            match date_slot(
                tx,
                &before.task_id,
                Some((&id, &before.sort_key)),
                date,
                note_redate,
            )? {
                Some((prev, next)) => {
                    Some(scope(&before.task_id).free_between(tx, prev, next.as_deref())?)
                }
                None => None,
            }
        }
        _ => None,
    };
    tx.execute(
        "UPDATE key_points SET kind = ?1, text = ?2, date = ?3, who = ?4,
           done_date = CASE WHEN ?5 THEN NULL ELSE done_date END,
           is_current = CASE WHEN ?5 THEN 0 ELSE is_current END,
           sort_key = COALESCE(?6, sort_key),
           updated_at = ?7
         WHERE id = ?8",
        params![
            row.kind.as_str(),
            row.text,
            row.date,
            row.who.map(NoteWho::as_str),
            is_note,
            new_key,
            clock.now_ms(),
            id
        ],
    )?;
    let after = load(tx, &id)?;
    history::record(
        tx,
        op,
        clock,
        &before.task_id,
        "kp_edited",
        json!({ "kpId": id, "from": summary(&before), "to": summary(&after) }),
    )?;
    Ok(Some(id))
}

/// `set_key_point_done`: done writes `done_date` and clears `is_current` but KEEPS `current_since`; history `kp_done` / `kp_undone`.
pub fn set_done(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    id: String,
    done: bool,
) -> Result<Option<String>, AppError> {
    let kp = load(tx, &id)?;
    if kp.kind == KeyPointKind::Note {
        return Err(AppError::invalid("a note cannot be checked off"));
    }
    op.capture(tx, "key_points", &id)?;
    if done {
        if kp.done_date.is_none() {
            tx.execute(
                "UPDATE key_points SET done_date = ?1, is_current = 0, updated_at = ?2
                 WHERE id = ?3",
                params![clock.today(), clock.now_ms(), id],
            )?;
        } else {
            touch(tx, clock, &id)?;
        }
    } else {
        tx.execute(
            "UPDATE key_points SET done_date = NULL, updated_at = ?1 WHERE id = ?2",
            params![clock.now_ms(), id],
        )?;
    }
    let kind = if done { "kp_done" } else { "kp_undone" };
    history::record(
        tx,
        op,
        clock,
        &kp.task_id,
        kind,
        json!({ "kpId": id, "text": kp.text }),
    )?;
    Ok(Some(id))
}

/// `move_key_point`: timeline drag in the detail view. Only undated key points move by hand;
/// dated ones and notes (always dated) follow their date.
pub fn move_key_point(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    id: String,
    prev_id: Option<String>,
    next_id: Option<String>,
) -> Result<Option<String>, AppError> {
    let kp = load(tx, &id)?;
    if kp.date.is_some() {
        return Err(AppError::invalid(
            "a dated key point follows its date; change the date to move it",
        ));
    }
    let key = scope(&kp.task_id).move_key(tx, &id, prev_id.as_deref(), next_id.as_deref())?;
    op.capture(tx, "key_points", &id)?;
    tx.execute(
        "UPDATE key_points SET sort_key = ?1, updated_at = ?2 WHERE id = ?3",
        params![key, clock.now_ms(), id],
    )?;
    Ok(Some(id))
}

/// `delete_key_point`: soft delete; history `kp_deleted`.
pub fn delete(
    tx: &Transaction<'_>,
    op: &mut Op,
    clock: &Clock,
    id: String,
) -> Result<Option<String>, AppError> {
    let kp = load(tx, &id)?;
    repo::soft_delete(tx, op, clock, "key_points", &id)?;
    history::record(tx, op, clock, &kp.task_id, "kp_deleted", summary(&kp))?;
    Ok(Some(id))
}
