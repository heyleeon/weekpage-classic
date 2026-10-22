//! Every `#[tauri::command]` (architecture §8). Thin entry points: reads go to `db::snapshot` /
//! `db::history` / `db::settings`, writes are one-line delegations through `Db::with_op`, window
//! commands go to `shell::`.
//!
//! Signatures are a shared contract (architecture §8): after changing one, regenerate the bindings
//! with `bash scripts/gen-contracts.sh`. `frontend/src/types/bindings.ts` is generated from this file.

use tauri::{AppHandle, Runtime, State};
use tauri_specta::{ErrorHandlingMode, collect_commands, collect_events};

use crate::AppState;
use crate::db::{self, history, journal, settings, snapshot};
use crate::error::AppError;
use crate::model::{
    AppInfo, DayChangedPayload, EventInput, HiddenPayload, KeyPointInput, Mutation,
    NavigatePayload, NewTaskInput, Settings, SettingsApplied, SettingsPatch, ShortcutStatus,
    ShownPayload, Snapshot, TaskEvent, TaskStatus, TodoInput, TrackpadPayload,
};
use crate::{platform, shell};

/// Development identity = identifier ends with `.dev` (README, "开发身份与正式身份").
pub fn is_dev<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.config().identifier.ends_with(".dev")
}

/// Settings defaults for this platform and identity.
pub fn settings_defaults<R: Runtime>(app: &AppHandle<R>) -> Settings {
    settings::defaults(platform::current(), is_dev(app))
}

// ── read / general ───────────────────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn app_info(app: AppHandle, state: State<'_, AppState>) -> Result<AppInfo, AppError> {
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        platform: platform::current(),
        is_dev: is_dev(&app),
        clock_offset_ms: state.clock.offset_ms(),
        vibrancy: platform::vibrancy_available(),
        shortcut: shell::shortcut::status(&app),
    })
}

#[tauri::command]
#[specta::specta]
pub fn load_snapshot(app: AppHandle, state: State<'_, AppState>) -> Result<Snapshot, AppError> {
    let defaults = settings_defaults(&app);
    state.db.with_conn(|c| snapshot::load(c, &defaults))
}

#[tauri::command]
#[specta::specta]
pub fn list_task_history(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Vec<TaskEvent>, AppError> {
    state.db.with_conn(|c| history::list(c, &task_id))
}

#[tauri::command]
#[specta::specta]
pub fn undo(state: State<'_, AppState>, op_ids: Vec<String>) -> Result<(), AppError> {
    let now = state.clock.now_ms();
    state.db.with_tx(|tx| journal::undo(tx, &op_ids, now))
}

#[tauri::command]
#[specta::specta]
pub fn get_cache(state: State<'_, AppState>, key: String) -> Result<Option<String>, AppError> {
    state.db.with_conn(|c| settings::get_cache(c, &key))
}

#[tauri::command]
#[specta::specta]
pub fn set_cache(state: State<'_, AppState>, key: String, value: String) -> Result<(), AppError> {
    let now = state.clock.now_ms();
    state
        .db
        .with_conn(|c| settings::set_cache(c, &key, &value, now))
}

// ── window and settings (the work happens in shell::*) ──────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn window_ready(app: AppHandle) -> Result<(), AppError> {
    shell::window::ready(&app)
}

#[tauri::command]
#[specta::specta]
pub fn window_hide(app: AppHandle) -> Result<(), AppError> {
    shell::window::hide(&app)
}

#[tauri::command]
#[specta::specta]
pub fn set_blur_guard(app: AppHandle, active: bool) -> Result<(), AppError> {
    shell::window::set_blur_guard(&app, active)
}

#[tauri::command]
#[specta::specta]
pub fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: SettingsPatch,
) -> Result<SettingsApplied, AppError> {
    let defaults = settings_defaults(&app);
    let now = state.clock.now_ms();
    let (old, new) = state
        .db
        .with_tx(|tx| settings::merge(tx, &defaults, &patch, now))?;
    let shortcut = shell::settings_apply::apply(&app, &old, &new);
    // apply() may roll the stored shortcut back when the new one fails to register, so return
    // what is actually persisted rather than the merged patch.
    let settings = state
        .db
        .with_conn(|c| settings::get(c, &defaults))
        .unwrap_or(new);
    Ok(SettingsApplied { settings, shortcut })
}

#[tauri::command]
#[specta::specta]
pub fn quit_app(app: AppHandle) -> Result<(), AppError> {
    shell::quit(&app);
    Ok(())
}

// ── data writes (db::*) ────────────────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn create_event(state: State<'_, AppState>, input: EventInput) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::events::create(tx, op, &state.clock, input))
}

#[tauri::command]
#[specta::specta]
pub fn update_event(
    state: State<'_, AppState>,
    id: String,
    input: EventInput,
) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::events::update(tx, op, &state.clock, id, input))
}

#[tauri::command]
#[specta::specta]
pub fn delete_event(state: State<'_, AppState>, id: String) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::events::delete(tx, op, &state.clock, id))
}

#[tauri::command]
#[specta::specta]
pub fn set_day_order(
    state: State<'_, AppState>,
    date: String,
    item_keys: Vec<String>,
) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::calendar::set_day_order(tx, op, &state.clock, date, item_keys))
}

#[tauri::command]
#[specta::specta]
pub fn create_todo(
    state: State<'_, AppState>,
    input: TodoInput,
    from_inbox_id: Option<String>,
) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::todos::create(tx, op, &state.clock, input, from_inbox_id))
}

#[tauri::command]
#[specta::specta]
pub fn update_todo(
    state: State<'_, AppState>,
    id: String,
    input: TodoInput,
) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::todos::update(tx, op, &state.clock, id, input))
}

#[tauri::command]
#[specta::specta]
pub fn set_todo_done(
    state: State<'_, AppState>,
    id: String,
    done: bool,
) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::todos::set_done(tx, op, &state.clock, id, done))
}

#[tauri::command]
#[specta::specta]
pub fn restore_todo(state: State<'_, AppState>, id: String) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::todos::restore(tx, op, &state.clock, id))
}

#[tauri::command]
#[specta::specta]
pub fn move_todo(
    state: State<'_, AppState>,
    id: String,
    prev_id: Option<String>,
    next_id: Option<String>,
) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::todos::move_todo(tx, op, &state.clock, id, prev_id, next_id))
}

#[tauri::command]
#[specta::specta]
pub fn delete_todo(state: State<'_, AppState>, id: String) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::todos::delete(tx, op, &state.clock, id))
}

#[tauri::command]
#[specta::specta]
pub fn create_inbox_item(state: State<'_, AppState>, text: String) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::inbox::create(tx, op, &state.clock, text))
}

#[tauri::command]
#[specta::specta]
pub fn update_inbox_item(
    state: State<'_, AppState>,
    id: String,
    text: String,
) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::inbox::update(tx, op, &state.clock, id, text))
}

#[tauri::command]
#[specta::specta]
pub fn delete_inbox_item(state: State<'_, AppState>, id: String) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::inbox::delete(tx, op, &state.clock, id))
}

#[tauri::command]
#[specta::specta]
pub fn create_task(state: State<'_, AppState>, input: NewTaskInput) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::tasks::create(tx, op, &state.clock, input))
}

#[tauri::command]
#[specta::specta]
pub fn rename_task(
    state: State<'_, AppState>,
    id: String,
    title: String,
) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::tasks::rename(tx, op, &state.clock, id, title))
}

#[tauri::command]
#[specta::specta]
pub fn set_task_status(
    state: State<'_, AppState>,
    id: String,
    status: TaskStatus,
) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::tasks::set_status(tx, op, &state.clock, id, status))
}

#[tauri::command]
#[specta::specta]
pub fn set_task_dates(
    state: State<'_, AppState>,
    id: String,
    start_date: String,
    due_date: Option<String>,
) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::tasks::set_dates(tx, op, &state.clock, id, start_date, due_date))
}

#[tauri::command]
#[specta::specta]
pub fn set_task_remind(
    state: State<'_, AppState>,
    id: String,
    remind_day_before: bool,
) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::tasks::set_remind(tx, op, &state.clock, id, remind_day_before))
}

#[tauri::command]
#[specta::specta]
pub fn move_task(
    state: State<'_, AppState>,
    id: String,
    column: u8,
    prev_id: Option<String>,
    next_id: Option<String>,
) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::tasks::move_task(tx, op, &state.clock, id, column, prev_id, next_id))
}

#[tauri::command]
#[specta::specta]
pub fn archive_task(
    state: State<'_, AppState>,
    id: String,
    summary: Option<String>,
) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::tasks::archive(tx, op, &state.clock, id, summary))
}

#[tauri::command]
#[specta::specta]
pub fn restore_task(
    state: State<'_, AppState>,
    id: String,
    column: u8,
) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::tasks::restore(tx, op, &state.clock, id, column))
}

#[tauri::command]
#[specta::specta]
pub fn delete_task(state: State<'_, AppState>, id: String) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::tasks::delete(tx, op, &state.clock, id))
}

#[tauri::command]
#[specta::specta]
pub fn add_key_point(
    state: State<'_, AppState>,
    task_id: String,
    input: KeyPointInput,
) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::key_points::add(tx, op, &state.clock, task_id, input))
}

#[tauri::command]
#[specta::specta]
pub fn update_key_point(
    state: State<'_, AppState>,
    id: String,
    input: KeyPointInput,
) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::key_points::update(tx, op, &state.clock, id, input))
}

#[tauri::command]
#[specta::specta]
pub fn set_key_point_done(
    state: State<'_, AppState>,
    id: String,
    done: bool,
) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::key_points::set_done(tx, op, &state.clock, id, done))
}

#[tauri::command]
#[specta::specta]
pub fn move_key_point(
    state: State<'_, AppState>,
    id: String,
    prev_id: Option<String>,
    next_id: Option<String>,
) -> Result<Mutation, AppError> {
    state.db.with_op(|tx, op| {
        db::key_points::move_key_point(tx, op, &state.clock, id, prev_id, next_id)
    })
}

#[tauri::command]
#[specta::specta]
pub fn delete_key_point(state: State<'_, AppState>, id: String) -> Result<Mutation, AppError> {
    state
        .db
        .with_op(|tx, op| db::key_points::delete(tx, op, &state.clock, id))
}

/// The tauri-specta builder: every command and event. Used by `run()` for the invoke handler and
/// by the contract tests to generate `frontend/src/types/bindings.ts`.
pub fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            // read / general
            app_info,
            load_snapshot,
            list_task_history,
            undo,
            get_cache,
            set_cache,
            // window and settings
            window_ready,
            window_hide,
            set_blur_guard,
            update_settings,
            quit_app,
            // data writes (27)
            create_event,
            update_event,
            delete_event,
            set_day_order,
            create_todo,
            update_todo,
            set_todo_done,
            restore_todo,
            move_todo,
            delete_todo,
            create_inbox_item,
            update_inbox_item,
            delete_inbox_item,
            create_task,
            rename_task,
            set_task_status,
            set_task_dates,
            set_task_remind,
            move_task,
            archive_task,
            restore_task,
            delete_task,
            add_key_point,
            update_key_point,
            set_key_point_done,
            move_key_point,
            delete_key_point,
        ])
        .events(collect_events![
            ShownPayload,
            HiddenPayload,
            NavigatePayload,
            ShortcutStatus,
            DayChangedPayload,
            TrackpadPayload
        ])
        .typ::<AppError>()
        .error_handling(ErrorHandlingMode::Throw)
        .dangerously_cast_bigints_to_number()
}
