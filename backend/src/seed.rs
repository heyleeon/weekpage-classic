//! Demo data (the only seed; this file is its source of truth). "Today" is 2026-09-30, demo clock 10:00.
//!
//! Fully deterministic so `frontend/src/lib/__fixtures__/demo-snapshot.json` can be regenerated
//! byte for byte: ids come from [`sid`], every timestamp is [`SEED_TS`] plus a
//! fixed offset (no DDL defaults, no wall clock), and dates are floating date literals.
//!
//! Written by `WEEKPAGE_SEED=demo` (debug builds, empty database only) and by
//! `test_support::seeded_db()`.

use rusqlite::{Connection, params};

use crate::db::{settings, sort_key};
use crate::error::AppError;
use crate::model::Settings;

/// 2026-09-30T02:00:00Z (10:00 in UTC+8).
pub const SEED_TS: i64 = 1_790_733_600_000;
const MINUTE: i64 = 60_000;
const DAY: i64 = 24 * 60 * MINUTE;

/// Deterministic UUIDv7-shaped id: `01900000-0000-7000-8000-00000000000n` (hex).
pub fn sid(n: u64) -> String {
    format!("01900000-0000-7000-8000-{n:012x}")
}

/// SEED_TS shifted by whole days and minutes.
fn at(days: i64, minutes: i64) -> i64 {
    SEED_TS + days * DAY + minutes * MINUTE
}

/// UTC ms of 20:00 local-ish on `day` (day offset from 9/30); used for done / archive moments.
fn evening(days: i64) -> i64 {
    at(days, 10 * 60)
}

struct EventRow {
    date: &'static str,
    time: Option<&'static str>,
    title: &'static str,
}

const EVENTS: &[EventRow] = &[
    EventRow {
        date: "2026-09-28",
        time: Some("10:00"),
        title: "周会",
    },
    EventRow {
        date: "2026-09-29",
        time: Some("14:00"),
        title: "看房",
    },
    EventRow {
        date: "2026-09-30",
        time: Some("15:00"),
        title: "演唱会",
    },
    EventRow {
        date: "2026-09-30",
        time: Some("19:30"),
        title: "和朋友约饭",
    },
    EventRow {
        date: "2026-10-01",
        time: Some("15:00"),
        title: "和供应商吃饭，聊下季度订单",
    },
    EventRow {
        date: "2026-10-02",
        time: None,
        title: "收拾去上海的行李",
    },
    EventRow {
        date: "2026-10-02",
        time: Some("18:00"),
        title: "飞上海 CA1519",
    },
    EventRow {
        date: "2026-10-03",
        time: Some("09:30"),
        title: "展会 · 国家会展中心 2 号馆",
    },
    EventRow {
        date: "2026-10-09",
        time: Some("10:30"),
        title: "牙医复查",
    },
    EventRow {
        date: "2026-10-14",
        time: Some("20:00"),
        title: "orbit 内测群分享",
    },
    EventRow {
        date: "2026-10-16",
        time: Some("14:00"),
        title: "和律师电话会，过 LLC 条款",
    },
];

struct TodoRow {
    title: &'static str,
    remind_date: Option<&'static str>,
    remind_time: Option<&'static str>,
    created_date: &'static str,
    /// (done_date, day offset of the done moment from 9/30)
    done: Option<(&'static str, i64)>,
}

/// In list order (sort keys are assigned in this order).
const TODOS: &[TodoRow] = &[
    // open (「今天」tab, order = importance)
    TodoRow {
        title: "回复房东关于续租的邮件",
        remind_date: Some("2026-09-30"),
        remind_time: Some("18:00"),
        created_date: "2026-09-30",
        done: None,
    },
    TodoRow {
        title: "修复 orbit 托盘图标闪烁 bug",
        remind_date: None,
        remind_time: None,
        created_date: "2026-09-29",
        done: None,
    },
    TodoRow {
        title: "问会计：LLC 每年报什么税",
        remind_date: Some("2026-10-09"),
        remind_time: None,
        created_date: "2026-09-30",
        done: None,
    },
    TodoRow {
        title: "研究 Tauri 全局快捷键",
        remind_date: None,
        remind_time: None,
        created_date: "2026-09-30",
        done: None,
    },
    // done today (「今天完成 1」)
    TodoRow {
        title: "买展会用的名片",
        remind_date: None,
        remind_time: None,
        created_date: "2026-09-30",
        done: Some(("2026-09-30", 0)),
    },
    // done before today = auto-archived (ui-spec §5.7)
    TodoRow {
        title: "寄回 9 月的报销发票",
        remind_date: None,
        remind_time: None,
        created_date: "2026-09-28",
        done: Some(("2026-09-29", -1)),
    },
    TodoRow {
        title: "订国庆回京的车票",
        remind_date: None,
        remind_time: None,
        created_date: "2026-09-28",
        done: Some(("2026-09-29", -1)),
    },
    TodoRow {
        title: "给房东转账 10 月房租",
        remind_date: None,
        remind_time: None,
        created_date: "2026-09-29",
        done: Some(("2026-09-29", -1)),
    },
    TodoRow {
        title: "续费 orbit 域名",
        remind_date: Some("2026-09-26"),
        remind_time: None,
        created_date: "2026-09-24",
        done: Some(("2026-09-27", -3)),
    },
    TodoRow {
        title: "续签健身卡",
        remind_date: None,
        remind_time: None,
        created_date: "2026-09-01",
        done: Some(("2026-09-03", -27)),
    },
    TodoRow {
        title: "给手机换电池",
        remind_date: None,
        remind_time: None,
        created_date: "2026-09-02",
        done: Some(("2026-09-06", -24)),
    },
    TodoRow {
        title: "寄回快递退货",
        remind_date: None,
        remind_time: None,
        created_date: "2026-09-05",
        done: Some(("2026-09-08", -22)),
    },
];

const INBOX: &[&str] = &[
    "看一下 Stripe Atlas 和闲鱼服务商的区别",
    "orbit 官网要不要做英文版",
    "给爸妈买国庆礼物",
];

struct TaskRow {
    title: &'static str,
    status: &'static str,
    start: &'static str,
    due: Option<&'static str>,
    remind_day_before: bool,
    column: u8,
    /// (done_date, day offset)
    done: Option<(&'static str, i64)>,
    /// (archived_date, day offset)
    archived: Option<(&'static str, i64)>,
}

/// Grouped by column; within a column in board order (then the archived ones).
const TASKS: &[TaskRow] = &[
    TaskRow {
        title: "交报销单",
        status: "active",
        start: "2026-09-24",
        due: Some("2026-09-28"),
        remind_day_before: false,
        column: 0,
        done: None,
        archived: None,
    },
    TaskRow {
        title: "注册美卡",
        status: "waiting",
        start: "2026-09-20",
        due: Some("2026-10-31"),
        remind_day_before: false,
        column: 0,
        done: None,
        archived: None,
    },
    TaskRow {
        title: "landing 文案",
        status: "active",
        start: "2026-10-08",
        due: Some("2026-10-16"),
        remind_day_before: false,
        column: 0,
        done: None,
        archived: None,
    },
    TaskRow {
        title: "准备护照扫描件和地址证明",
        status: "done",
        start: "2026-09-24",
        due: Some("2026-09-26"),
        remind_day_before: false,
        column: 0,
        done: Some(("2026-09-26", -4)),
        archived: Some(("2026-09-26", -4)),
    },
    TaskRow {
        title: "课程作业",
        status: "active",
        start: "2026-09-29",
        due: Some("2026-10-02"),
        remind_day_before: true,
        column: 1,
        done: None,
        archived: None,
    },
    TaskRow {
        title: "交会议 PPT",
        status: "active",
        start: "2026-09-30",
        due: Some("2026-10-03"),
        remind_day_before: true,
        column: 1,
        done: None,
        archived: None,
    },
    TaskRow {
        title: "注册美国公司",
        status: "active",
        start: "2026-09-29",
        due: Some("2026-10-31"),
        remind_day_before: false,
        column: 1,
        done: None,
        archived: None,
    },
    TaskRow {
        title: "orbit 软件著作权登记",
        status: "done",
        start: "2026-09-10",
        due: None,
        remind_day_before: false,
        column: 1,
        done: Some(("2026-09-26", -4)),
        archived: Some(("2026-09-26", -4)),
    },
    TaskRow {
        title: "写 Q3 季度总结",
        status: "active",
        start: "2026-09-30",
        due: Some("2026-10-06"),
        remind_day_before: false,
        column: 2,
        done: None,
        archived: None,
    },
    TaskRow {
        title: "orbit 域名备案",
        status: "waiting",
        start: "2026-09-12",
        due: None,
        remind_day_before: false,
        column: 2,
        done: None,
        archived: None,
    },
    TaskRow {
        title: "orbit 美国商标",
        status: "waiting",
        start: "2026-09-15",
        due: None,
        remind_day_before: false,
        column: 2,
        done: None,
        archived: None,
    },
    TaskRow {
        title: "整理 8 月账单",
        status: "done",
        start: "2026-09-01",
        due: Some("2026-09-05"),
        remind_day_before: false,
        column: 2,
        done: Some(("2026-09-04", -26)),
        archived: Some(("2026-09-04", -26)),
    },
];

struct KpRow {
    /// Index into TASKS.
    task: usize,
    kind: &'static str,
    text: &'static str,
    date: Option<&'static str>,
    who: Option<&'static str>,
    done_date: Option<&'static str>,
    is_current: bool,
    current_since: Option<&'static str>,
}

const fn kp(task: usize, kind: &'static str, text: &'static str) -> KpRow {
    KpRow {
        task,
        kind,
        text,
        date: None,
        who: None,
        done_date: None,
        is_current: false,
        current_since: None,
    }
}

const fn done(mut k: KpRow, d: &'static str) -> KpRow {
    k.done_date = Some(d);
    k
}

const fn dated(mut k: KpRow, d: &'static str) -> KpRow {
    k.date = Some(d);
    k
}

const fn current(mut k: KpRow, since: &'static str) -> KpRow {
    k.is_current = true;
    k.current_since = Some(since);
    k
}

const fn since(mut k: KpRow, s: &'static str) -> KpRow {
    k.current_since = Some(s);
    k
}

const fn note_them(mut k: KpRow, d: &'static str) -> KpRow {
    k.date = Some(d);
    k.who = Some("them");
    k
}

const CARD: usize = 1; // 注册美卡
const PPT: usize = 5; // 交会议 PPT
const LLC: usize = 6; // 注册美国公司
const SOFT: usize = 7; // orbit 软件著作权登记
const ICP: usize = 9; // orbit 域名备案
const TM: usize = 10; // orbit 美国商标

/// Timeline order per task (sort keys are assigned in this order within each task).
const KEY_POINTS: &[KpRow] = &[
    done(kp(CARD, "do", "查资料选卡"), "2026-09-20"),
    done(kp(CARD, "do", "准备材料"), "2026-09-22"),
    done(kp(CARD, "do", "提交申请"), "2026-09-24"),
    note_them(
        kp(CARD, "note", "邮件：申请已收到，7–10 个工作日内答复"),
        "2026-09-25",
    ),
    current(
        dated(kp(CARD, "wait", "等审批 · 10/1 查"), "2026-10-01"),
        "2026-09-24",
    ),
    kp(CARD, "do", "激活卡"),
    done(kp(PPT, "do", "列提纲"), "2026-09-30"),
    current(kp(PPT, "do", "做 10 页初稿"), "2026-09-30"),
    dated(kp(PPT, "check", "10/2 检查一遍初稿"), "2026-10-02"),
    kp(PPT, "do", "找同事过一遍"),
    done(kp(LLC, "do", "问 5 家"), "2026-09-29"),
    done(kp(LLC, "wait", "等报价"), "2026-09-30"),
    current(kp(LLC, "do", "选一家付款"), "2026-09-30"),
    kp(LLC, "wait", "等 LLC 注册"),
    kp(LLC, "do", "申请 EIN"),
    done(kp(ICP, "do", "域名实名认证"), "2026-09-13"),
    done(kp(ICP, "do", "提交备案材料"), "2026-09-15"),
    done(kp(ICP, "do", "改名重交"), "2026-09-20"),
    done(kp(ICP, "do", "初审通过"), "2026-09-26"),
    current(
        dated(kp(ICP, "wait", "等管局 · 10/9 查"), "2026-10-09"),
        "2026-09-26",
    ),
    kp(ICP, "do", "管局通过 · 拿备案号"),
    kp(ICP, "do", "网站正式上线"),
    done(kp(TM, "do", "提交 USPTO"), "2026-09-15"),
    current(
        dated(kp(TM, "wait", "等审查意见 · 12/15 查"), "2026-12-15"),
        "2026-09-15",
    ),
    kp(TM, "do", "答复"),
    done(kp(SOFT, "do", "准备材料"), "2026-09-11"),
    done(kp(SOFT, "do", "提交申请"), "2026-09-12"),
    since(done(kp(SOFT, "wait", "等受理"), "2026-09-20"), "2026-09-12"),
    done(kp(SOFT, "do", "补正材料"), "2026-09-23"),
    done(kp(SOFT, "do", "拿到登记证书"), "2026-09-26"),
];

/// Id bases per table (ids are `sid(base + index)`).
const EVENT_BASE: u64 = 1;
const TODO_BASE: u64 = 101;
const INBOX_BASE: u64 = 201;
const TASK_BASE: u64 = 301;
const KP_BASE: u64 = 401;

/// Id of the n-th task in [`TASKS`] (tests and fixtures refer to tasks by it).
pub fn task_id(index: usize) -> String {
    sid(TASK_BASE + index as u64)
}

/// Writes the demo data and `settings` into an empty database.
pub fn demo(conn: &Connection, settings_value: &Settings) -> Result<(), AppError> {
    for (i, e) in EVENTS.iter().enumerate() {
        let ts = at(-7, i as i64);
        conn.execute(
            "INSERT INTO events (id, date, time, end_time, title, location, created_at, updated_at)
             VALUES (?1, ?2, ?3, NULL, ?4, NULL, ?5, ?5)",
            params![sid(EVENT_BASE + i as u64), e.date, e.time, e.title, ts],
        )?;
    }

    let todo_keys = sort_key::sequence(TODOS.len());
    for (i, t) in TODOS.iter().enumerate() {
        let ts = at(-30, i as i64);
        let (done_date, done_at) = match t.done {
            Some((d, off)) => (Some(d), Some(evening(off) + i as i64 * MINUTE)),
            None => (None, None),
        };
        conn.execute(
            "INSERT INTO todos (id, title, sort_key, remind_date, remind_time, created_date,
                                done_at, done_date, remind_notified_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10)",
            params![
                sid(TODO_BASE + i as u64),
                t.title,
                todo_keys[i],
                t.remind_date,
                t.remind_time,
                t.created_date,
                done_at,
                done_date,
                ts,
                done_at.unwrap_or(ts),
            ],
        )?;
    }

    let inbox_keys = sort_key::sequence(INBOX.len());
    for (i, text) in INBOX.iter().enumerate() {
        let ts = at(-1, i as i64);
        conn.execute(
            "INSERT INTO inbox_items (id, text, sort_key, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params![sid(INBOX_BASE + i as u64), text, inbox_keys[i], ts],
        )?;
    }

    for column in 0..3u8 {
        let in_col: Vec<(usize, &TaskRow)> = TASKS
            .iter()
            .enumerate()
            .filter(|(_, t)| t.column == column)
            .collect();
        let keys = sort_key::sequence(in_col.len());
        for ((i, t), key) in in_col.into_iter().zip(keys) {
            let ts = at(-40, i as i64);
            let done_at = t.done.map(|(_, off)| evening(off));
            let archived_at = t.archived.map(|(_, off)| evening(off) + 5 * MINUTE);
            let updated = archived_at.or(done_at).unwrap_or(ts);
            conn.execute(
                "INSERT INTO tasks (id, title, status, start_date, due_date, last_due_date,
                                    remind_day_before, remind_notified_at, board_column, sort_key,
                                    done_at, done_date, archived_at, archived_date, summary,
                                    created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, NULL, ?7, ?8, ?9, ?10, ?11, ?12, NULL, ?13, ?14)",
                params![
                    task_id(i),
                    t.title,
                    t.status,
                    t.start,
                    t.due,
                    i64::from(t.remind_day_before),
                    t.column,
                    key,
                    done_at,
                    t.done.map(|(d, _)| d),
                    archived_at,
                    t.archived.map(|(d, _)| d),
                    ts,
                    updated,
                ],
            )?;
        }
    }

    for task in 0..TASKS.len() {
        let rows: Vec<(usize, &KpRow)> = KEY_POINTS
            .iter()
            .enumerate()
            .filter(|(_, k)| k.task == task)
            .collect();
        let keys = sort_key::sequence(rows.len());
        for ((i, k), key) in rows.into_iter().zip(keys) {
            let ts = at(-40, 30 + i as i64);
            conn.execute(
                "INSERT INTO key_points (id, task_id, kind, text, date, who, sort_key, done_date,
                                         is_current, current_since, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
                params![
                    sid(KP_BASE + i as u64),
                    task_id(k.task),
                    k.kind,
                    k.text,
                    k.date,
                    k.who,
                    key,
                    k.done_date,
                    i64::from(k.is_current),
                    k.current_since,
                    ts,
                ],
            )?;
        }
    }

    settings::put(conn, settings_value, SEED_TS)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{KeyPointKind, TaskStatus};
    use crate::test_support::seeded_db;

    #[test]
    fn sid_is_v7_shaped() {
        assert_eq!(sid(1), "01900000-0000-7000-8000-000000000001");
        assert_eq!(sid(301), "01900000-0000-7000-8000-00000000012d");
        assert_eq!(sid(1).len(), 36);
    }

    #[test]
    fn seed_ts_is_2026_09_30_0200_utc() {
        let dt = chrono::DateTime::from_timestamp_millis(SEED_TS).unwrap();
        assert_eq!(dt.to_rfc3339(), "2026-09-30T02:00:00+00:00");
    }

    #[test]
    fn demo_matches_ui_spec_21() {
        let db = seeded_db();
        let snap = db
            .with_conn(|c| crate::db::snapshot::load(c, &Settings::fixture()))
            .unwrap();
        // events
        assert_eq!(snap.events.len(), 11);
        // todos: 4 open, 1 done today, 7 archived
        let open = snap.todos.iter().filter(|t| t.done_date.is_none()).count();
        let today = snap
            .todos
            .iter()
            .filter(|t| t.done_date.as_deref() == Some("2026-09-30"))
            .count();
        let archived = snap
            .todos
            .iter()
            .filter(|t| t.done_date.as_deref().is_some_and(|d| d < "2026-09-30"))
            .count();
        assert_eq!((open, today, archived), (4, 1, 7));
        let open_titles: Vec<&str> = snap
            .todos
            .iter()
            .filter(|t| t.done_date.is_none())
            .map(|t| t.title.as_str())
            .collect();
        assert_eq!(
            open_titles,
            [
                "回复房东关于续租的邮件",
                "修复 orbit 托盘图标闪烁 bug",
                "问会计：LLC 每年报什么税",
                "研究 Tauri 全局快捷键"
            ]
        );
        // inbox
        assert_eq!(snap.inbox[0].text, "看一下 Stripe Atlas 和闲鱼服务商的区别");
        // tasks: board order per column
        let board: Vec<(u8, &str)> = snap
            .tasks
            .iter()
            .filter(|t| t.archived_at.is_none())
            .map(|t| (t.board_column, t.title.as_str()))
            .collect();
        assert_eq!(
            board,
            [
                (0, "交报销单"),
                (0, "注册美卡"),
                (0, "landing 文案"),
                (1, "课程作业"),
                (1, "交会议 PPT"),
                (1, "注册美国公司"),
                (2, "写 Q3 季度总结"),
                (2, "orbit 域名备案"),
                (2, "orbit 美国商标"),
            ]
        );
        let archived_tasks: Vec<&str> = snap
            .tasks
            .iter()
            .filter(|t| t.archived_at.is_some())
            .map(|t| t.title.as_str())
            .collect();
        assert_eq!(archived_tasks.len(), 3);
        assert!(
            snap.tasks
                .iter()
                .filter(|t| t.archived_at.is_some())
                .all(|t| t.status == TaskStatus::Done)
        );
        // 注册美卡 timeline: 5 key points + 1 note between #3 and #4, #4 current since 9/24
        let card = task_id(CARD);
        let card_kps: Vec<_> = snap
            .key_points
            .iter()
            .filter(|k| k.task_id == card)
            .collect();
        assert_eq!(card_kps.len(), 6);
        assert_eq!(card_kps[3].kind, KeyPointKind::Note);
        assert!(card_kps[4].is_current);
        assert_eq!(card_kps[4].current_since.as_deref(), Some("2026-09-24"));
        // 软著「等受理」: done, not current, current_since kept
        let soft = task_id(SOFT);
        let wait = snap
            .key_points
            .iter()
            .find(|k| k.task_id == soft && k.text == "等受理")
            .unwrap();
        assert!(!wait.is_current);
        assert_eq!(wait.done_date.as_deref(), Some("2026-09-20"));
        assert_eq!(wait.current_since.as_deref(), Some("2026-09-12"));
    }

    #[test]
    fn demo_is_deterministic() {
        let a = seeded_db();
        let b = seeded_db();
        let sa = a
            .with_conn(|c| crate::db::snapshot::load(c, &Settings::fixture()))
            .unwrap();
        let sb = b
            .with_conn(|c| crate::db::snapshot::load(c, &Settings::fixture()))
            .unwrap();
        assert_eq!(sa, sb);
    }
}
