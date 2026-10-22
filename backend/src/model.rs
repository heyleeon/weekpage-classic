//! All IPC-facing types: entities, inputs, results and event payloads.
//!
//! These structs are the single source of truth for the domain shape; `frontend/src/types/bindings.ts`
//! is generated from them (scripts/gen-contracts.sh). Field names are camelCase on the wire.
//! Dates are floating local dates `YYYY-MM-DD`, times are `HH:MM`, timestamps are UTC milliseconds.

use serde::{Deserialize, Serialize};
use specta::Type;

// ── Enums ────────────────────────────────────────────────────────────────────────────────────

/// Stored task status. "Not started" and "overdue" are derived on the TS side (ui-spec §0.5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Active,
    Waiting,
    Done,
}

impl TaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            TaskStatus::Active => "active",
            TaskStatus::Waiting => "waiting",
            TaskStatus::Done => "done",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "active" => Some(TaskStatus::Active),
            "waiting" => Some(TaskStatus::Waiting),
            "done" => Some(TaskStatus::Done),
            _ => None,
        }
    }
}

/// `do` = I do it, `wait` = waiting on someone, `check` = checkpoint, `note` = a log entry ("记一笔").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum KeyPointKind {
    Do,
    Wait,
    Check,
    Note,
}

impl KeyPointKind {
    pub fn as_str(self) -> &'static str {
        match self {
            KeyPointKind::Do => "do",
            KeyPointKind::Wait => "wait",
            KeyPointKind::Check => "check",
            KeyPointKind::Note => "note",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "do" => Some(KeyPointKind::Do),
            "wait" => Some(KeyPointKind::Wait),
            "check" => Some(KeyPointKind::Check),
            "note" => Some(KeyPointKind::Note),
            _ => None,
        }
    }
}

/// Who a note is about: the other party ("对方") or me ("我").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum NoteWho {
    Them,
    Me,
}

impl NoteWho {
    pub fn as_str(self) -> &'static str {
        match self {
            NoteWho::Them => "them",
            NoteWho::Me => "me",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "them" => Some(NoteWho::Them),
            "me" => Some(NoteWho::Me),
            _ => None,
        }
    }
}

/// Task history entry type (`task_events.type`, DDL CHECK list).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TaskEventType {
    Created,
    Renamed,
    Status,
    Dates,
    Remind,
    KpAdded,
    KpEdited,
    KpDone,
    KpUndone,
    KpCurrent,
    KpDeleted,
    NoteAdded,
    Archived,
    Restored,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    System,
    Light,
    Dark,
}

/// UI language, a BCP 47 tag by script (`zh-Hans`, not the region tag `zh-CN`). `system` follows
/// the OS preferred languages (first Simplified Chinese or English one; Traditional is skipped; see
/// ui-spec §0.8). v0.1 stored `zh-CN`: `db::settings::get` reads it as `zh-Hans` (no serde alias:
/// it would split the TS bindings into separate serialize / deserialize types).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum Language {
    #[serde(rename = "system")]
    System,
    #[serde(rename = "zh-Hans")]
    ZhHans,
    #[serde(rename = "en")]
    En,
}

/// Which week the calendar's first row shows when the window opens and on "back to today".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum CalendarFirstRow {
    ThisWeek,
    LastWeek,
}

/// Page remembered across launches. The archive page is never remembered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum LastPage {
    Calendar,
    Tasks,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Platform {
    Macos,
    Windows,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum ShownReason {
    Launch,
    Shortcut,
    Tray,
    Reopen,
    SecondInstance,
    Notification,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum NavigateTarget {
    Calendar,
    Tasks,
    Settings,
}

// ── Entities (rows of the snapshot; soft-deleted rows never appear) ─────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub date: String,
    pub time: Option<String>,
    pub end_time: Option<String>,
    pub title: String,
    pub location: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: String,
    pub title: String,
    pub sort_key: String,
    pub remind_date: Option<String>,
    pub remind_time: Option<String>,
    pub created_date: String,
    pub done_at: Option<i64>,
    pub done_date: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    pub id: String,
    pub text: String,
    pub sort_key: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub status: TaskStatus,
    pub start_date: String,
    pub due_date: Option<String>,
    pub last_due_date: Option<String>,
    pub remind_day_before: bool,
    /// 0, 1 or 2.
    pub board_column: u8,
    pub sort_key: String,
    pub done_at: Option<i64>,
    pub done_date: Option<String>,
    pub archived_at: Option<i64>,
    pub archived_date: Option<String>,
    pub summary: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct KeyPoint {
    pub id: String,
    pub task_id: String,
    pub kind: KeyPointKind,
    pub text: String,
    pub date: Option<String>,
    pub who: Option<NoteWho>,
    pub sort_key: String,
    pub done_date: Option<String>,
    pub is_current: bool,
    pub current_since: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Manual order of calendar items within one day (`calendar_day_orders`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DayOrder {
    pub id: String,
    pub date: String,
    /// Item keys like `event:<id>`, `todo:<id>`, `kp:<id>`, `start:<taskId>`, `due:<taskId>`.
    pub item_keys: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Local, non-synced settings (`settings` row `app`). See architecture §6.3.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Tauri accelerator, e.g. "Control+Alt+Space".
    pub shortcut: String,
    pub theme: Theme,
    /// false = pinned: the window stays on top when it loses focus.
    pub hide_on_blur: bool,
    pub autostart: bool,
    /// 2, 3 or 4.
    pub calendar_weeks: u8,
    pub last_page: LastPage,
    pub todo_done_collapsed: bool,
    pub onboarding_shortcut_hint_seen: bool,
    pub language: Language,
    pub calendar_first_row: CalendarFirstRow,
    /// "system" (follow the OS) or an IANA zone name such as "Asia/Tokyo". Decides what "today"
    /// and the clock times mean; independent of `language`.
    pub timezone: String,
}

impl Settings {
    /// Fixed, platform-independent settings used by the demo fixture and tests.
    pub fn fixture() -> Self {
        Settings {
            shortcut: "Control+Alt+Space".to_string(),
            theme: Theme::System,
            hide_on_blur: true,
            autostart: false,
            calendar_weeks: 3,
            last_page: LastPage::Calendar,
            todo_done_collapsed: false,
            onboarding_shortcut_hint_seen: false,
            language: Language::System,
            calendar_first_row: CalendarFirstRow::ThisWeek,
            timezone: "system".to_string(),
        }
    }

    /// Returns a copy with every field present in `patch` replaced.
    pub fn apply(&self, patch: &SettingsPatch) -> Settings {
        let mut s = self.clone();
        if let Some(v) = &patch.shortcut {
            s.shortcut = v.clone();
        }
        if let Some(v) = patch.theme {
            s.theme = v;
        }
        if let Some(v) = patch.hide_on_blur {
            s.hide_on_blur = v;
        }
        if let Some(v) = patch.autostart {
            s.autostart = v;
        }
        if let Some(v) = patch.calendar_weeks {
            s.calendar_weeks = v;
        }
        if let Some(v) = patch.last_page {
            s.last_page = v;
        }
        if let Some(v) = patch.todo_done_collapsed {
            s.todo_done_collapsed = v;
        }
        if let Some(v) = patch.onboarding_shortcut_hint_seen {
            s.onboarding_shortcut_hint_seen = v;
        }
        if let Some(v) = patch.language {
            s.language = v;
        }
        if let Some(v) = patch.calendar_first_row {
            s.calendar_first_row = v;
        }
        if let Some(v) = &patch.timezone {
            s.timezone = v.clone();
        }
        s
    }
}

/// Partial settings update; only the present fields change (architecture §6.3).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub shortcut: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub theme: Option<Theme>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub hide_on_blur: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub autostart: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub calendar_weeks: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub last_page: Option<LastPage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub todo_done_collapsed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub onboarding_shortcut_hint_seen: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub language: Option<Language>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub calendar_first_row: Option<CalendarFirstRow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub timezone: Option<String>,
}

/// Everything the UI reads: all non-deleted rows, each array totally ordered.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub events: Vec<Event>,
    pub todos: Vec<Todo>,
    pub inbox: Vec<InboxItem>,
    pub tasks: Vec<Task>,
    pub key_points: Vec<KeyPoint>,
    pub day_orders: Vec<DayOrder>,
    pub settings: Settings,
}

/// One task history row (`task_events`), newest first in `list_task_history`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvent {
    pub id: String,
    pub task_id: String,
    #[serde(rename = "type")]
    pub kind: TaskEventType,
    /// JSON object as a string, e.g. `{"from":"waiting","to":"done"}`.
    pub payload: String,
    pub at: i64,
}

// ── Command results ──────────────────────────────────────────────────────────────────────────

/// Result of every write command: the undo handle plus the id of the created / changed row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Mutation {
    pub op_id: String,
    pub id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
#[tauri_specta(event_name = "shell://shortcut-status")]
pub struct ShortcutStatus {
    pub accelerator: String,
    pub registered: bool,
    pub error: Option<String>,
    /// An enabled system shortcut on the same combo (macOS `com.apple.symbolichotkeys`), e.g.
    /// `input-source-next` for ⌃⌥Space: registering "succeeds" but the system gets the key first.
    #[serde(default)]
    #[specta(optional)]
    pub conflict: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub platform: Platform,
    pub is_dev: bool,
    /// Offset of the app clock from the wall clock (WEEKPAGE_FAKE_NOW, debug builds only).
    pub clock_offset_ms: i64,
    pub vibrancy: bool,
    pub shortcut: ShortcutStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SettingsApplied {
    pub settings: Settings,
    pub shortcut: ShortcutStatus,
}

// ── Command inputs ───────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EventInput {
    pub date: String,
    #[serde(default)]
    #[specta(optional)]
    pub time: Option<String>,
    #[serde(default)]
    #[specta(optional)]
    pub end_time: Option<String>,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TodoInput {
    pub title: String,
    #[serde(default)]
    #[specta(optional)]
    pub remind_date: Option<String>,
    #[serde(default)]
    #[specta(optional)]
    pub remind_time: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct KeyPointInput {
    pub kind: KeyPointKind,
    pub text: String,
    #[serde(default)]
    #[specta(optional)]
    pub date: Option<String>,
    /// Only for `note`; defaults to `them`.
    #[serde(default)]
    #[specta(optional)]
    pub who: Option<NoteWho>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NewTaskInput {
    pub title: String,
    pub start_date: String,
    #[serde(default)]
    #[specta(optional)]
    pub due_date: Option<String>,
    pub remind_day_before: bool,
    /// 0, 1 or 2; the task goes to the top of this column.
    pub column: u8,
    pub key_points: Vec<KeyPointInput>,
    #[serde(default)]
    #[specta(optional)]
    pub from_inbox_id: Option<String>,
}

// ── Event payloads (Rust → TS) ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
#[tauri_specta(event_name = "shell://shown")]
pub struct ShownPayload {
    pub reason: ShownReason,
}

/// The main window was just hidden (any path: blur, shortcut / tray toggle, Esc, Cmd+W). The page
/// resets to the bare calendar / tasks page while hidden, so the next show paints that at once
/// instead of the old detail panel first (ui-spec §1.1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
#[tauri_specta(event_name = "shell://hidden")]
pub struct HiddenPayload {}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
#[tauri_specta(event_name = "shell://navigate")]
pub struct NavigatePayload {
    pub page: NavigateTarget,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
#[tauri_specta(event_name = "clock://day-changed")]
pub struct DayChangedPayload {
    pub today: String,
}

/// Fingers down on / lifted off the trackpad (macOS scroll phases; nothing on other platforms).
/// The page cannot see this in wheel events; two-finger swipes act on the lift (ui-spec §1.3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
#[tauri_specta(event_name = "input://trackpad")]
pub struct TrackpadPayload {
    pub touching: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_patch_serializes_only_present_fields() {
        let patch = SettingsPatch {
            last_page: Some(LastPage::Tasks),
            ..Default::default()
        };
        assert_eq!(
            serde_json::to_string(&patch).unwrap(),
            r#"{"lastPage":"tasks"}"#
        );
        let back: SettingsPatch = serde_json::from_str(r#"{"calendarWeeks":4}"#).unwrap();
        assert_eq!(back.calendar_weeks, Some(4));
        assert_eq!(back.shortcut, None);
    }

    #[test]
    fn settings_apply_changes_only_patched_fields() {
        let base = Settings::fixture();
        let patch = SettingsPatch {
            theme: Some(Theme::Dark),
            calendar_weeks: Some(4),
            ..Default::default()
        };
        let next = base.apply(&patch);
        assert_eq!(next.theme, Theme::Dark);
        assert_eq!(next.calendar_weeks, 4);
        assert_eq!(next.shortcut, base.shortcut);
        assert_eq!(next.hide_on_blur, base.hide_on_blur);
    }

    #[test]
    fn language_and_first_row_wire_names() {
        assert_eq!(
            serde_json::to_string(&Language::System).unwrap(),
            r#""system""#
        );
        assert_eq!(
            serde_json::to_string(&Language::ZhHans).unwrap(),
            r#""zh-Hans""#
        );
        assert_eq!(serde_json::to_string(&Language::En).unwrap(), r#""en""#);
        assert_eq!(
            serde_json::to_string(&CalendarFirstRow::ThisWeek).unwrap(),
            r#""thisWeek""#
        );
        assert_eq!(
            serde_json::to_string(&CalendarFirstRow::LastWeek).unwrap(),
            r#""lastWeek""#
        );
        let patch: SettingsPatch =
            serde_json::from_str(r#"{"language":"en","calendarFirstRow":"lastWeek"}"#).unwrap();
        assert_eq!(patch.language, Some(Language::En));
        assert_eq!(patch.calendar_first_row, Some(CalendarFirstRow::LastWeek));
        assert!(serde_json::from_str::<SettingsPatch>(r#"{"language":"fr"}"#).is_err());
    }

    #[test]
    fn settings_apply_patches_language_and_first_row() {
        let base = Settings::fixture();
        assert_eq!(base.language, Language::System);
        assert_eq!(base.calendar_first_row, CalendarFirstRow::ThisWeek);
        let next = base.apply(&SettingsPatch {
            language: Some(Language::ZhHans),
            ..Default::default()
        });
        assert_eq!(next.language, Language::ZhHans);
        assert_eq!(next.calendar_first_row, CalendarFirstRow::ThisWeek);
        let next = next.apply(&SettingsPatch {
            calendar_first_row: Some(CalendarFirstRow::LastWeek),
            ..Default::default()
        });
        assert_eq!(next.language, Language::ZhHans);
        assert_eq!(next.calendar_first_row, CalendarFirstRow::LastWeek);
    }

    #[test]
    fn task_event_uses_type_on_the_wire() {
        let ev = TaskEvent {
            id: "x".into(),
            task_id: "t".into(),
            kind: TaskEventType::KpDone,
            payload: "{}".into(),
            at: 1,
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert!(json.contains(r#""type":"kp_done""#), "{json}");
    }

    #[test]
    fn shown_reason_is_kebab_case() {
        let json = serde_json::to_string(&ShownReason::SecondInstance).unwrap();
        assert_eq!(json, r#""second-instance""#);
    }
}
