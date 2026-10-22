//! Reminder heartbeat (architecture §11–§12): every 30 s (and once right away) send due
//! todo / task reminders and the daily step digest, refresh the tray's overdue dot, detect a local
//! day change (`clock://day-changed`) and run the daily backup on it.
//!
//! - Todo: `remind_date` + `remind_time` both set, not done, not deleted, not notified yet;
//!   fires at that local date-time → 「提醒：{title}」.
//! - Task: `remind_day_before = 1`, has a due date, status ≠ done, not archived, not deleted,
//!   not notified yet; fires the day before the due date at 09:00 → 「「{title}」明天截止」.
//! - A trigger older than now − 2 min was missed (app not running, asleep): all missed ones are
//!   merged into one 「错过 N 条提醒：a、b…」.
//! - After sending, one transaction stamps `remind_notified_at` (write commands clear it when
//!   the reminder changes, so an edited reminder fires again).
//! - Steps (key points of kind do / wait / check, never `note`) with a date: a step is overdue
//!   when it is dated before today and due today when dated today, provided it is not done or
//!   deleted and its task is not done, archived or deleted ([`due_steps`]).
//! - Daily step digest: once per local day, at the first beat at or after 09:00, one
//!   notification lists the overdue steps and the steps due today (overdue line first, then the
//!   due-today line; 「2 步逾期：任务 · 步骤、…」「今天到期 1 步：任务 · 步骤」, at most two names
//!   per line, then 「…」), ordered by date, task board position, step order. Nothing to list →
//!   nothing sent. The day is stamped in the settings cache ([`STEP_DIGEST_KEY`]) even when
//!   there was nothing to send or sending failed, so it runs once a day; started after 09:00 on
//!   a day not stamped yet → the first beat sends it.
//! - Every beat also refreshes the tray's overdue dot (`shell::tray::refresh_badge`).
//! - Text follows `settings.language` at send time (`crate::i18n`; English: "Reminder: {title}",
//!   "“{title}” is due tomorrow", "Missed N reminders: a, b…", "2 steps overdue: a, b",
//!   "1 step due today: a").
//!
//! Wall-clock based (the app clock), so waking from sleep catches up on the next beat.

use std::time::Duration;

use chrono::{Duration as ChronoDuration, NaiveDate, NaiveDateTime, NaiveTime};
use rusqlite::{Connection, params};
use tauri::{AppHandle, Manager, Runtime};

use crate::AppState;
use crate::db::settings;
use crate::error::AppError;
use crate::i18n::{self, Lang, Text};
use crate::model::DayChangedPayload;

/// Heartbeat period.
pub const BEAT: Duration = Duration::from_secs(30);
/// Triggers older than this are "missed" and merged into one notification.
pub const MISSED_AFTER_MINUTES: i64 = 2;
/// Task reminders fire at this local time on the day before the due date; the daily step digest
/// goes out at the first beat at or after it.
pub const TASK_REMIND_TIME: (u32, u32) = (9, 0);
/// Settings cache key holding the local day (`YYYY-MM-DD`) the step digest last ran.
pub const STEP_DIGEST_KEY: &str = "cache:reminders-step-digest-day";
/// Steps named per digest line; more are summed up by the count and a trailing 「…」.
pub const STEP_DIGEST_NAMES: usize = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DueKind {
    Todo,
    Task,
}

/// One reminder whose trigger time has come and that was not sent yet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DueItem {
    pub kind: DueKind,
    pub id: String,
    pub title: String,
    /// Local trigger time.
    pub fire_at: NaiveDateTime,
}

/// A notification to send: (title, body).
pub type Notice = (String, String);

fn parse_local(date: &str, time: &str) -> Option<NaiveDateTime> {
    let d = NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
    let t = NaiveTime::parse_from_str(time, "%H:%M").ok()?;
    Some(d.and_time(t))
}

fn task_fire_at(due_date: &str) -> Option<NaiveDateTime> {
    let d = NaiveDate::parse_from_str(due_date, "%Y-%m-%d").ok()?;
    let t = NaiveTime::from_hms_opt(TASK_REMIND_TIME.0, TASK_REMIND_TIME.1, 0)?;
    Some((d - ChronoDuration::days(1)).and_time(t))
}

/// Pure query: every reminder due at `now_local` that was not sent yet, oldest first.
pub fn due_items(conn: &Connection, now_local: NaiveDateTime) -> Result<Vec<DueItem>, AppError> {
    let mut out = Vec::new();

    let mut stmt = conn.prepare(
        "SELECT id, title, remind_date, remind_time FROM todos
          WHERE remind_date IS NOT NULL AND remind_time IS NOT NULL
            AND done_at IS NULL AND deleted_at IS NULL AND remind_notified_at IS NULL",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
        ))
    })?;
    for row in rows {
        let (id, title, date, time) = row?;
        match parse_local(&date, &time) {
            Some(fire_at) if fire_at <= now_local => out.push(DueItem {
                kind: DueKind::Todo,
                id,
                title,
                fire_at,
            }),
            Some(_) => {}
            None => log::warn!("reminders: todo {id} has an unreadable reminder time"),
        }
    }

    let mut stmt = conn.prepare(
        "SELECT id, title, due_date FROM tasks
          WHERE remind_day_before = 1 AND due_date IS NOT NULL AND status <> 'done'
            AND archived_at IS NULL AND deleted_at IS NULL AND remind_notified_at IS NULL",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })?;
    for row in rows {
        let (id, title, due) = row?;
        match task_fire_at(&due) {
            Some(fire_at) if fire_at <= now_local => out.push(DueItem {
                kind: DueKind::Task,
                id,
                title,
                fire_at,
            }),
            Some(_) => {}
            None => log::warn!("reminders: task {id} has an unreadable due date"),
        }
    }

    out.sort_by(|a, b| a.fire_at.cmp(&b.fire_at).then_with(|| a.id.cmp(&b.id)));
    Ok(out)
}

fn on_time_body(item: &DueItem, lang: Lang) -> String {
    match item.kind {
        DueKind::Todo => i18n::todo_due(lang, &item.title),
        DueKind::Task => i18n::task_due_tomorrow(lang, &item.title),
    }
}

fn missed_label(item: &DueItem, lang: Lang) -> String {
    match item.kind {
        DueKind::Todo => item.title.clone(),
        DueKind::Task => i18n::task_due(lang, &item.title),
    }
}

/// Pure: turns due items into notifications in `lang`. On-time items get one each; missed ones
/// (older than now − 2 min) are merged into a single 「错过 N 条提醒：a、b…」 placed first.
pub fn plan(items: &[DueItem], now_local: NaiveDateTime, lang: Lang) -> Vec<Notice> {
    let cutoff = now_local - ChronoDuration::minutes(MISSED_AFTER_MINUTES);
    let (missed, on_time): (Vec<&DueItem>, Vec<&DueItem>) =
        items.iter().partition(|i| i.fire_at < cutoff);
    let title = Text::AppName.get(lang);
    let mut out = Vec::new();
    if !missed.is_empty() {
        let names: Vec<String> = missed
            .iter()
            .take(2)
            .map(|i| missed_label(i, lang))
            .collect();
        out.push((
            title.to_string(),
            i18n::missed(lang, missed.len(), &names, missed.len() > 2),
        ));
    }
    out.extend(
        on_time
            .iter()
            .map(|i| (title.to_string(), on_time_body(i, lang))),
    );
    out
}

/// Stamps `remind_notified_at` on every item (one transaction, by the caller).
pub fn mark_notified(conn: &Connection, items: &[DueItem], now_ms: i64) -> Result<(), AppError> {
    for item in items {
        let sql = match item.kind {
            DueKind::Todo => "UPDATE todos SET remind_notified_at = ?1 WHERE id = ?2",
            DueKind::Task => "UPDATE tasks SET remind_notified_at = ?1 WHERE id = ?2",
        };
        conn.execute(sql, params![now_ms, item.id])?;
    }
    Ok(())
}

// ── Steps: overdue / due today, daily digest ─────────────────────────────────────────────────

/// A dated, open step on a live, unfinished task, due today or earlier.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DueStep {
    pub task_title: String,
    pub text: String,
    /// Local date `YYYY-MM-DD`.
    pub date: String,
}

/// Open dated steps (`kp`) on live, unfinished tasks (`t`); callers add the date condition.
const OPEN_DATED_STEPS: &str = "FROM key_points kp JOIN tasks t ON t.id = kp.task_id
     WHERE kp.kind <> 'note' AND kp.date IS NOT NULL AND kp.done_date IS NULL
       AND kp.deleted_at IS NULL
       AND t.status <> 'done' AND t.archived_at IS NULL AND t.deleted_at IS NULL";

fn local_day(now_local: NaiveDateTime) -> String {
    now_local.format("%Y-%m-%d").to_string()
}

/// Pure query: the overdue steps and those due `today`, ordered by date, then the task's board
/// position (column, order in the column), then the step's order in the task.
pub fn due_steps(conn: &Connection, today: &str) -> Result<Vec<DueStep>, AppError> {
    let sql = format!(
        "SELECT t.title, kp.text, kp.date {OPEN_DATED_STEPS} AND kp.date <= ?1
          ORDER BY kp.date, t.board_column, t.sort_key, t.id, kp.sort_key, kp.id"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([today], |r| {
        Ok(DueStep {
            task_title: r.get(0)?,
            text: r.get(1)?,
            date: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Pure query: at least one step is overdue on `today` (drives the tray's red dot).
pub fn has_overdue_steps(conn: &Connection, today: &str) -> Result<bool, AppError> {
    let sql = format!("SELECT EXISTS (SELECT 1 {OPEN_DATED_STEPS} AND kp.date < ?1)");
    Ok(conn.query_row(&sql, [today], |r| r.get(0))?)
}

/// Whether the step digest runs at `now_local`: at or after 09:00 and not run yet that day.
pub fn step_digest_due(conn: &Connection, now_local: NaiveDateTime) -> Result<bool, AppError> {
    let Some(at) = NaiveTime::from_hms_opt(TASK_REMIND_TIME.0, TASK_REMIND_TIME.1, 0) else {
        return Ok(false);
    };
    if now_local.time() < at {
        return Ok(false);
    }
    let ran = settings::get_cache(conn, STEP_DIGEST_KEY)?;
    Ok(ran.as_deref() != Some(local_day(now_local).as_str()))
}

/// Stamps `day` as the day the step digest ran.
pub fn mark_step_digest(conn: &Connection, day: &str, now_ms: i64) -> Result<(), AppError> {
    settings::set_cache(conn, STEP_DIGEST_KEY, day, now_ms)
}

fn step_line(
    steps: &[&DueStep],
    lang: Lang,
    text: fn(Lang, usize, &[String], bool) -> String,
) -> Option<String> {
    if steps.is_empty() {
        return None;
    }
    let names: Vec<String> = steps
        .iter()
        .take(STEP_DIGEST_NAMES)
        .map(|s| i18n::step_label(&s.task_title, &s.text))
        .collect();
    Some(text(
        lang,
        steps.len(),
        &names,
        steps.len() > STEP_DIGEST_NAMES,
    ))
}

/// Pure: the step digest for `today` in `lang` — the overdue line, then the due-today line, one
/// per line; None when neither has a step. Steps dated after `today` are ignored.
pub fn plan_step_digest(steps: &[DueStep], today: &str, lang: Lang) -> Option<Notice> {
    let (overdue, due_today): (Vec<&DueStep>, Vec<&DueStep>) = steps
        .iter()
        .filter(|s| s.date.as_str() <= today)
        .partition(|s| s.date.as_str() < today);
    let lines: Vec<String> = [
        step_line(&overdue, lang, i18n::steps_overdue),
        step_line(&due_today, lang, i18n::steps_due_today),
    ]
    .into_iter()
    .flatten()
    .collect();
    if lines.is_empty() {
        return None;
    }
    Some((Text::AppName.get(lang).to_string(), lines.join("\n")))
}

/// The daily step digest, when due (see the module doc). `ran` is the day it last ran in this
/// process: a failed stamp must not turn into a digest every 30 seconds either.
fn step_digest<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
    now_local: NaiveDateTime,
    ran: &mut Option<String>,
) {
    let day = local_day(now_local);
    if ran.as_deref() == Some(day.as_str()) {
        return;
    }
    match state.db.with_conn(|c| step_digest_due(c, now_local)) {
        Ok(true) => {}
        Ok(false) => return,
        Err(e) => {
            log::warn!("reminders: step digest check failed: {e}");
            return;
        }
    }
    let steps = match state.db.with_conn(|c| due_steps(c, &day)) {
        Ok(steps) => steps,
        Err(e) => {
            log::warn!("reminders: step digest query failed: {e}");
            return;
        }
    };
    let lang = i18n::for_settings(&crate::shell::read_settings(app));
    match plan_step_digest(&steps, &day, lang) {
        Some((title, body)) => {
            log::info!("reminders: step digest for {day}: {} step(s)", steps.len());
            if let Err(e) = crate::platform::notify(app, &title, &body) {
                log::warn!("reminders: step digest notify failed: {e}");
            }
        }
        None => log::info!("reminders: step digest for {day}: nothing overdue or due today"),
    }
    // Stamped even when there was nothing to send or sending failed (see `beat`).
    let now_ms = state.clock.now_ms();
    if let Err(e) = state.db.with_tx(|tx| mark_step_digest(tx, &day, now_ms)) {
        log::warn!("reminders: stamping the step digest failed: {e}");
    }
    *ran = Some(day);
}

// ── Heartbeat ────────────────────────────────────────────────────────────────────────────────

/// What the heartbeat remembers between beats.
#[derive(Debug, Default)]
struct Memo {
    /// Local date the previous beat saw (day-change detection).
    last_day: Option<String>,
    /// Local date the step digest last ran in this process.
    digest_day: Option<String>,
}

/// One heartbeat.
fn beat<R: Runtime>(app: &AppHandle<R>, memo: &mut Memo) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let now_local = state.clock.local_now();
    let today = state.clock.today();

    match state.db.with_conn(|c| due_items(c, now_local)) {
        Ok(items) if !items.is_empty() => {
            let lang = i18n::for_settings(&crate::shell::read_settings(app));
            let notices = plan(&items, now_local, lang);
            log::info!(
                "reminders: {} due, sending {} notification(s)",
                items.len(),
                notices.len()
            );
            for (title, body) in &notices {
                if let Err(e) = crate::platform::notify(app, title, body) {
                    log::warn!("reminders: notify failed: {e}");
                }
            }
            // Marked even when sending failed: a broken notification channel must not turn
            // into a notification every 30 seconds.
            let now_ms = state.clock.now_ms();
            if let Err(e) = state.db.with_tx(|tx| mark_notified(tx, &items, now_ms)) {
                log::warn!("reminders: marking as notified failed: {e}");
            }
        }
        Ok(_) => {}
        Err(e) => log::warn!("reminders: query failed: {e}"),
    }
    step_digest(app, &state, now_local, &mut memo.digest_day);

    if let Some(prev) = memo.last_day.as_deref()
        && prev != today
    {
        log::info!("day changed: {prev} -> {today}");
        crate::shell::emit(
            app,
            DayChangedPayload {
                today: today.clone(),
            },
        );
        match crate::paths::resolve(app) {
            Ok(paths) => match state
                .db
                .backup_if_needed(&paths.backups_dir(), &state.clock)
            {
                Ok(Some(p)) => log::info!("backup written: {}", p.display()),
                Ok(None) => {}
                Err(e) => log::warn!("backup failed: {e}"),
            },
            Err(e) => log::warn!("backup skipped, paths unavailable: {e}"),
        }
    }
    crate::shell::tray::refresh_badge(app);
    memo.last_day = Some(today);
}

/// Starts the heartbeat on the async runtime (first beat immediately).
pub fn start<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        let mut memo = Memo::default();
        loop {
            beat(&app, &mut memo);
            tokio::time::sleep(BEAT).await;
        }
    });
    log::info!("reminder heartbeat started ({}s)", BEAT.as_secs());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{fixed_clock, open_memory_db};

    const TITLE: &str = "WeekPage";

    fn at(local: &str) -> NaiveDateTime {
        fixed_clock(local).local_now()
    }

    fn add_todo(conn: &Connection, id: &str, title: &str, date: &str, time: Option<&str>) {
        conn.execute(
            "INSERT INTO todos (id, title, sort_key, remind_date, remind_time, created_date,
                                created_at, updated_at)
             VALUES (?1, ?2, ?1, ?3, ?4, '2026-09-30', 1, 1)",
            params![id, title, date, time],
        )
        .unwrap();
    }

    fn add_task(conn: &Connection, id: &str, title: &str, due: &str, remind: bool) {
        conn.execute(
            "INSERT INTO tasks (id, title, start_date, due_date, remind_day_before, board_column,
                                sort_key, created_at, updated_at)
             VALUES (?1, ?2, '2026-09-01', ?3, ?4, 0, ?1, 1, 1)",
            params![id, title, due, i64::from(remind)],
        )
        .unwrap();
    }

    fn ids(items: &[DueItem]) -> Vec<&str> {
        items.iter().map(|i| i.id.as_str()).collect()
    }

    #[test]
    fn not_due_before_the_trigger_time() {
        let db = open_memory_db();
        db.with_conn(|c| {
            add_todo(c, "t1", "交房租", "2026-09-30", Some("18:00"));
            add_task(c, "k1", "课程作业", "2026-10-02", true);
            assert!(due_items(c, at("2026-09-30T17:59"))?.is_empty());
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn due_at_the_trigger_time() {
        let db = open_memory_db();
        db.with_conn(|c| {
            add_todo(c, "t1", "交房租", "2026-09-30", Some("18:00"));
            add_task(c, "k1", "课程作业", "2026-10-01", true);
            // Task: day before the due date at 09:00 → 2026-09-30 09:00.
            let items = due_items(c, at("2026-09-30T18:00"))?;
            assert_eq!(ids(&items), ["k1", "t1"]);
            assert_eq!(items[0].kind, DueKind::Task);
            let notices = plan(&items, at("2026-09-30T18:00"), Lang::ZhHans);
            // The task fired at 09:00, long before 18:00 → missed; the todo is on time.
            assert_eq!(
                notices,
                [
                    (
                        TITLE.to_string(),
                        "错过 1 条提醒：「课程作业」截止".to_string()
                    ),
                    (TITLE.to_string(), "提醒：交房租".to_string()),
                ]
            );
            let on_time = plan(&items[..1], at("2026-09-30T09:00"), Lang::ZhHans);
            assert_eq!(on_time[0].1, "「课程作业」明天截止");
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn sent_once_only() {
        let db = open_memory_db();
        db.with_conn(|c| add_todo_ok(c, "t1", "交房租", "2026-09-30", "18:00"))
            .unwrap();
        let now = at("2026-09-30T18:00");
        let items = db.with_conn(|c| due_items(c, now)).unwrap();
        assert_eq!(items.len(), 1);
        db.with_tx(|tx| mark_notified(tx, &items, 123)).unwrap();
        assert!(db.with_conn(|c| due_items(c, now)).unwrap().is_empty());
        assert!(
            db.with_conn(|c| due_items(c, at("2026-10-01T09:00")))
                .unwrap()
                .is_empty()
        );
    }

    fn add_todo_ok(
        c: &Connection,
        id: &str,
        title: &str,
        d: &str,
        t: &str,
    ) -> Result<(), AppError> {
        add_todo(c, id, title, d, Some(t));
        Ok(())
    }

    #[test]
    fn changed_time_fires_again() {
        let db = open_memory_db();
        db.with_conn(|c| add_todo_ok(c, "t1", "交房租", "2026-09-30", "18:00"))
            .unwrap();
        let items = db
            .with_conn(|c| due_items(c, at("2026-09-30T18:00")))
            .unwrap();
        db.with_tx(|tx| mark_notified(tx, &items, 1)).unwrap();
        // update_todo clears remind_notified_at when the reminder changes.
        db.with_conn(|c| {
            c.execute(
                "UPDATE todos SET remind_time = '20:00', remind_notified_at = NULL WHERE id = 't1'",
                [],
            )?;
            Ok(())
        })
        .unwrap();
        assert!(
            db.with_conn(|c| due_items(c, at("2026-09-30T19:59")))
                .unwrap()
                .is_empty()
        );
        let again = db
            .with_conn(|c| due_items(c, at("2026-09-30T20:00")))
            .unwrap();
        assert_eq!(ids(&again), ["t1"]);
    }

    #[test]
    fn missed_ones_are_merged() {
        let db = open_memory_db();
        db.with_conn(|c| {
            add_todo(c, "t1", "交房租", "2026-09-29", Some("18:00"));
            add_todo(c, "t2", "取快递", "2026-09-30", Some("08:00"));
            add_todo(c, "t3", "给妈妈打电话", "2026-09-30", Some("09:30"));
            add_todo(c, "t4", "现在这条", "2026-09-30", Some("09:59"));
            Ok(())
        })
        .unwrap();
        let now = at("2026-09-30T10:00");
        let items = db.with_conn(|c| due_items(c, now)).unwrap();
        assert_eq!(ids(&items), ["t1", "t2", "t3", "t4"]);
        let notices = plan(&items, now, Lang::ZhHans);
        assert_eq!(
            notices,
            [
                (
                    TITLE.to_string(),
                    "错过 3 条提醒：交房租、取快递…".to_string()
                ),
                (TITLE.to_string(), "提醒：现在这条".to_string()),
            ]
        );
        // Exactly two minutes late still counts as on time.
        let edge = plan(&items[3..], at("2026-09-30T10:01"), Lang::ZhHans);
        assert_eq!(edge[0].1, "提醒：现在这条");
    }

    #[test]
    fn english_notifications() {
        let db = open_memory_db();
        db.with_conn(|c| {
            add_todo(c, "t1", "Pay rent", "2026-09-30", Some("18:00"));
            add_task(c, "k1", "Essay", "2026-10-01", true);
            Ok(())
        })
        .unwrap();
        let items = db
            .with_conn(|c| due_items(c, at("2026-09-30T18:00")))
            .unwrap();
        assert_eq!(
            plan(&items, at("2026-09-30T18:00"), Lang::En),
            [
                (
                    "WeekPage".to_string(),
                    "Missed 1 reminder: “Essay” is due".to_string()
                ),
                ("WeekPage".to_string(), "Reminder: Pay rent".to_string()),
            ]
        );
        assert_eq!(
            plan(&items[..1], at("2026-09-30T09:00"), Lang::En),
            [(
                "WeekPage".to_string(),
                "“Essay” is due tomorrow".to_string()
            )]
        );
    }

    #[test]
    fn english_missed_summary_is_plural() {
        let db = open_memory_db();
        db.with_conn(|c| {
            add_todo(c, "t1", "Pay rent", "2026-09-29", Some("18:00"));
            add_todo(c, "t2", "Pick up parcel", "2026-09-30", Some("08:00"));
            add_todo(c, "t3", "Call mom", "2026-09-30", Some("09:30"));
            Ok(())
        })
        .unwrap();
        let now = at("2026-09-30T10:00");
        let items = db.with_conn(|c| due_items(c, now)).unwrap();
        assert_eq!(
            plan(&items, now, Lang::En),
            [(
                "WeekPage".to_string(),
                "Missed 3 reminders: Pay rent, Pick up parcel…".to_string()
            )]
        );
        assert_eq!(
            plan(&items[1..], now, Lang::En)[0].1,
            "Missed 2 reminders: Pick up parcel, Call mom"
        );
    }

    #[test]
    fn excluded_rows_never_fire() {
        let db = open_memory_db();
        db.with_conn(|c| {
            // Date only (no time): calendar only, no notification (requirement §2.2).
            add_todo(c, "date-only", "只选日子", "2026-09-30", None);
            add_todo(c, "done", "已完成", "2026-09-30", Some("08:00"));
            c.execute(
                "UPDATE todos SET done_at = 1, done_date = '2026-09-30' WHERE id = 'done'",
                [],
            )?;
            add_todo(c, "deleted", "已删", "2026-09-30", Some("08:00"));
            c.execute("UPDATE todos SET deleted_at = 1 WHERE id = 'deleted'", [])?;
            add_task(c, "no-remind", "不提醒", "2026-10-01", false);
            add_task(c, "task-done", "做完了", "2026-10-01", true);
            c.execute(
                "UPDATE tasks SET status = 'done', done_at = 1, done_date = '2026-09-30'
                  WHERE id = 'task-done'",
                [],
            )?;
            add_task(c, "archived", "归档了", "2026-10-01", true);
            c.execute(
                "UPDATE tasks SET archived_at = 1, archived_date = '2026-09-30' WHERE id = 'archived'",
                [],
            )?;
            add_task(c, "task-deleted", "删了", "2026-10-01", true);
            c.execute("UPDATE tasks SET deleted_at = 1 WHERE id = 'task-deleted'", [])?;
            c.execute(
                "INSERT INTO tasks (id, title, start_date, due_date, remind_day_before,
                                    board_column, sort_key, created_at, updated_at)
                 VALUES ('no-due', '没截止', '2026-09-01', NULL, 1, 0, 'x', 1, 1)",
                [],
            )?;
            assert!(due_items(c, at("2026-10-05T10:00"))?.is_empty());
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn waiting_tasks_still_remind() {
        let db = open_memory_db();
        db.with_conn(|c| {
            add_task(c, "w", "等审批", "2026-10-03", true);
            c.execute("UPDATE tasks SET status = 'waiting' WHERE id = 'w'", [])?;
            assert!(due_items(c, at("2026-10-02T08:59"))?.is_empty());
            assert_eq!(ids(&due_items(c, at("2026-10-02T09:00"))?), ["w"]);
            Ok(())
        })
        .unwrap();
    }

    // ── Steps ────────────────────────────────────────────────────────────────────────────────

    const TODAY: &str = "2026-10-02";

    fn add_board_task(conn: &Connection, id: &str, title: &str, column: i64, sort_key: &str) {
        conn.execute(
            "INSERT INTO tasks (id, title, start_date, board_column, sort_key, created_at,
                                updated_at)
             VALUES (?1, ?2, '2026-09-01', ?3, ?4, 1, 1)",
            params![id, title, column, sort_key],
        )
        .unwrap();
    }

    fn add_step(
        conn: &Connection,
        id: &str,
        task: &str,
        kind: &str,
        text: &str,
        date: Option<&str>,
        sort_key: &str,
    ) {
        let who = (kind == "note").then_some("them");
        conn.execute(
            "INSERT INTO key_points (id, task_id, kind, text, date, who, sort_key, created_at,
                                     updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, 1)",
            params![id, task, kind, text, date, who, sort_key],
        )
        .unwrap();
    }

    fn step(task: &str, text: &str, date: &str) -> DueStep {
        DueStep {
            task_title: task.to_string(),
            text: text.to_string(),
            date: date.to_string(),
        }
    }

    fn texts(steps: &[DueStep]) -> Vec<&str> {
        steps.iter().map(|s| s.text.as_str()).collect()
    }

    #[test]
    fn overdue_and_today_steps_only_on_live_open_tasks() {
        let db = open_memory_db();
        db.with_conn(|c| {
            add_board_task(c, "k", "交会议 PPT", 0, "a");
            add_step(c, "over", "k", "do", "逾期", Some("2026-10-01"), "a");
            add_step(c, "today", "k", "check", "今天", Some(TODAY), "b");
            add_step(c, "future", "k", "wait", "明天", Some("2026-10-03"), "c");
            add_step(c, "undated", "k", "do", "没日子", None, "d");
            add_step(c, "done", "k", "do", "做完了", Some("2026-09-30"), "e");
            c.execute(
                "UPDATE key_points SET done_date = '2026-10-01' WHERE id = 'done'",
                [],
            )?;
            add_step(c, "note", "k", "note", "记一笔", Some("2026-09-30"), "f");
            add_step(c, "deleted", "k", "do", "删了", Some("2026-09-30"), "g");
            c.execute(
                "UPDATE key_points SET deleted_at = 1 WHERE id = 'deleted'",
                [],
            )?;

            add_board_task(c, "w", "等审批", 1, "a");
            c.execute("UPDATE tasks SET status = 'waiting' WHERE id = 'w'", [])?;
            add_step(c, "waiting", "w", "wait", "等回复", Some("2026-09-29"), "a");

            add_board_task(c, "task-done", "做完的任务", 2, "a");
            c.execute(
                "UPDATE tasks SET status = 'done', done_at = 1, done_date = '2026-10-01'
                  WHERE id = 'task-done'",
                [],
            )?;
            add_step(
                c,
                "on-done",
                "task-done",
                "do",
                "x",
                Some("2026-09-30"),
                "a",
            );
            add_board_task(c, "archived", "归档的任务", 0, "b");
            c.execute(
                "UPDATE tasks SET archived_at = 1, archived_date = '2026-10-01'
                  WHERE id = 'archived'",
                [],
            )?;
            add_step(
                c,
                "on-archived",
                "archived",
                "do",
                "y",
                Some("2026-09-30"),
                "a",
            );
            add_board_task(c, "task-deleted", "删掉的任务", 0, "c");
            c.execute(
                "UPDATE tasks SET deleted_at = 1 WHERE id = 'task-deleted'",
                [],
            )?;
            add_step(
                c,
                "on-deleted",
                "task-deleted",
                "do",
                "z",
                Some("2026-09-30"),
                "a",
            );

            let steps = due_steps(c, TODAY)?;
            assert_eq!(texts(&steps), ["等回复", "逾期", "今天"]);
            assert_eq!(steps[0].task_title, "等审批");
            assert!(has_overdue_steps(c, TODAY)?);
            // A day earlier: 「逾期」 is due that day, only the waiting task's step is overdue.
            assert_eq!(texts(&due_steps(c, "2026-10-01")?), ["等回复", "逾期"]);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn steps_due_today_alone_raise_no_dot() {
        let db = open_memory_db();
        db.with_conn(|c| {
            add_board_task(c, "k", "注册美卡", 0, "a");
            add_step(c, "s1", "k", "do", "去查审批", Some(TODAY), "a");
            add_step(c, "s2", "k", "do", "下周", Some("2026-10-09"), "b");
            assert!(!has_overdue_steps(c, TODAY)?);
            assert!(has_overdue_steps(c, "2026-10-03")?);
            add_step(c, "s0", "k", "do", "昨天", Some("2026-10-01"), "0");
            assert!(has_overdue_steps(c, TODAY)?);
            c.execute(
                "UPDATE key_points SET done_date = '2026-10-02' WHERE id = 's0'",
                [],
            )?;
            assert!(!has_overdue_steps(c, TODAY)?);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn steps_order_by_date_then_board_then_step_order() {
        let db = open_memory_db();
        db.with_conn(|c| {
            add_board_task(c, "a", "A", 1, "a");
            add_board_task(c, "b", "B", 0, "z");
            add_board_task(c, "cc", "C", 0, "b");
            add_step(c, "a2", "a", "do", "A2", Some("2026-09-30"), "b");
            add_step(c, "b1", "b", "do", "B1", Some("2026-09-30"), "b");
            add_step(c, "b2", "b", "do", "B2", Some("2026-09-30"), "a");
            add_step(c, "c1", "cc", "do", "C1", Some("2026-09-30"), "a");
            add_step(c, "a1", "a", "do", "A1", Some("2026-09-29"), "a");
            add_step(c, "c0", "cc", "do", "C0", Some(TODAY), "0");
            assert_eq!(
                texts(&due_steps(c, TODAY)?),
                ["A1", "C1", "B2", "B1", "A2", "C0"]
            );
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn step_digest_runs_once_a_day_from_nine() {
        let db = open_memory_db();
        let due = |local: &str| db.with_conn(|c| step_digest_due(c, at(local))).unwrap();
        assert!(!due("2026-10-02T08:59"));
        assert!(due("2026-10-02T09:00"));
        // Started later in the day without a stamp: the first beat sends it.
        assert!(due("2026-10-02T18:30"));
        db.with_tx(|tx| mark_step_digest(tx, TODAY, 1)).unwrap();
        assert!(!due("2026-10-02T09:00"));
        assert!(!due("2026-10-02T23:59"));
        assert!(!due("2026-10-03T08:59"));
        assert!(due("2026-10-03T09:00"));
        assert_eq!(
            db.with_conn(|c| settings::get_cache(c, STEP_DIGEST_KEY))
                .unwrap()
                .as_deref(),
            Some(TODAY)
        );
    }

    #[test]
    fn step_digest_chinese() {
        let db = open_memory_db();
        db.with_conn(|c| {
            add_board_task(c, "ppt", "交会议 PPT", 0, "a");
            add_board_task(c, "icp", "orbit 域名备案", 0, "b");
            add_board_task(c, "card", "注册美卡", 1, "a");
            add_step(
                c,
                "s1",
                "ppt",
                "do",
                "找同事过一遍",
                Some("2026-09-30"),
                "a",
            );
            add_step(c, "s2", "icp", "wait", "管局通过", Some("2026-10-01"), "a");
            add_step(c, "s3", "card", "check", "去查审批", Some(TODAY), "a");
            Ok(())
        })
        .unwrap();
        let steps = db.with_conn(|c| due_steps(c, TODAY)).unwrap();
        assert_eq!(
            plan_step_digest(&steps, TODAY, Lang::ZhHans),
            Some((
                TITLE.to_string(),
                "2 步逾期：交会议 PPT · 找同事过一遍、orbit 域名备案 · 管局通过\n\
                 今天到期 1 步：注册美卡 · 去查审批"
                    .to_string()
            ))
        );
        // Only one kind: one line.
        assert_eq!(
            plan_step_digest(&steps[..1], TODAY, Lang::ZhHans)
                .unwrap()
                .1,
            "1 步逾期：交会议 PPT · 找同事过一遍"
        );
        assert_eq!(
            plan_step_digest(&steps[2..], TODAY, Lang::ZhHans)
                .unwrap()
                .1,
            "今天到期 1 步：注册美卡 · 去查审批"
        );
    }

    #[test]
    fn step_digest_names_two_steps_per_line() {
        let steps = [
            step("A", "a", "2026-09-28"),
            step("B", "b", "2026-09-29"),
            step("C", "c", "2026-10-01"),
            step("D", "d", TODAY),
            step("E", "e", TODAY),
            step("F", "f", TODAY),
        ];
        assert_eq!(
            plan_step_digest(&steps, TODAY, Lang::ZhHans).unwrap().1,
            "3 步逾期：A · a、B · b…\n今天到期 3 步：D · d、E · e…"
        );
        assert_eq!(
            plan_step_digest(&steps, TODAY, Lang::En).unwrap().1,
            "3 steps overdue: A · a, B · b…\n3 steps due today: D · d, E · e…"
        );
    }

    #[test]
    fn step_digest_english() {
        let steps = [
            step("Slides", "Review with a colleague", "2026-09-30"),
            step("Domain", "Approval", "2026-10-01"),
            step("Card", "Check status", TODAY),
        ];
        assert_eq!(
            plan_step_digest(&steps, TODAY, Lang::En),
            Some((
                TITLE.to_string(),
                "2 steps overdue: Slides · Review with a colleague, Domain · Approval\n\
                 1 step due today: Card · Check status"
                    .to_string()
            ))
        );
        assert_eq!(
            plan_step_digest(&steps[1..2], TODAY, Lang::En).unwrap().1,
            "1 step overdue: Domain · Approval"
        );
        assert_eq!(
            plan_step_digest(&steps[2..], TODAY, Lang::En).unwrap().1,
            "1 step due today: Card · Check status"
        );
    }

    #[test]
    fn nothing_to_list_sends_nothing() {
        assert_eq!(plan_step_digest(&[], TODAY, Lang::ZhHans), None);
        // A future step (never returned by `due_steps`) is ignored rather than listed.
        let future = [step("A", "a", "2026-10-03")];
        assert_eq!(plan_step_digest(&future, TODAY, Lang::En), None);
    }
}
