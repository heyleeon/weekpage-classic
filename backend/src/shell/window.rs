//! Main window show / hide / focus behaviour (architecture §4).
//!
//! Pure parts (unit tested): which monitor the cursor is on ([`pick_monitor`]), where the window
//! goes on it ([`place`]), what the toggle shortcut does ([`toggle_action`]) and whether a focus
//! loss hides the window ([`blur_hides`]).

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalPosition, Position, Runtime,
    WebviewWindow, Window, WindowEvent,
};

use super::{ShellState, lock};
use crate::error::AppError;
use crate::model::{HiddenPayload, ShownPayload, ShownReason};
use crate::platform;

pub const MAIN_LABEL: &str = "main";

/// Default window size (logical points) and the "work area too small" ratio (ui-spec §1.1).
pub const DEFAULT_SIZE: (f64, f64) = (1280.0, 860.0);
pub const MIN_SIZE: (f64, f64) = (1100.0, 680.0);
pub const SMALL_SCREEN_RATIO: f64 = 0.92;
/// Focus loss is re-checked after this long (Windows focus events are noisy, architecture §4).
pub const BLUR_DEBOUNCE_MS: u64 = 150;
/// A focus loss this soon after a show is ignored.
pub const SHOW_GRACE_MS: u64 = 300;

pub fn main_window<R: Runtime>(app: &AppHandle<R>) -> Result<WebviewWindow<R>, AppError> {
    app.get_webview_window(MAIN_LABEL)
        .ok_or_else(|| AppError::platform("main window not found"))
}

// ── Pure: monitor choice and placement ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    fn contains(&self, px: f64, py: f64) -> bool {
        px >= self.x && px < self.x + self.w && py >= self.y && py < self.y + self.h
    }

    fn scaled(&self, by: f64) -> Rect {
        Rect {
            x: self.x / by,
            y: self.y / by,
            w: self.w / by,
            h: self.h / by,
        }
    }
}

/// One monitor as Tauri reports it: frame and work area in "physical" units, plus its scale.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MonitorInfo {
    pub frame: Rect,
    pub work: Rect,
    pub scale: f64,
}

/// Index of the monitor under the cursor; falls back to the primary monitor (then the first one)
/// when the cursor is unknown or outside every monitor. `logical_desktop`: see
/// `platform::logical_desktop` (macOS compares in points, Windows in physical pixels).
pub fn pick_monitor(
    cursor: Option<(f64, f64)>,
    primary_scale: f64,
    monitors: &[MonitorInfo],
    primary: Option<usize>,
    logical_desktop: bool,
) -> Option<usize> {
    if let Some((cx, cy)) = cursor {
        let hit = monitors.iter().position(|m| {
            if logical_desktop {
                let s = if primary_scale > 0.0 {
                    primary_scale
                } else {
                    1.0
                };
                m.frame.scaled(m.scale).contains(cx / s, cy / s)
            } else {
                m.frame.contains(cx, cy)
            }
        });
        if hit.is_some() {
            return hit;
        }
    }
    primary
        .filter(|&i| i < monitors.len())
        .or(if monitors.is_empty() { None } else { Some(0) })
}

/// Where the window goes on a monitor.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placement {
    /// Window size in logical points.
    pub size: (f64, f64),
    /// Top-left of the work area (to move onto the screen before resizing), desktop units.
    pub anchor: (f64, f64),
    /// Final top-left, centred in the work area, desktop units.
    pub position: (f64, f64),
}

fn fit(default: f64, min: f64, available: f64) -> f64 {
    if available >= default {
        default
    } else {
        (available * SMALL_SCREEN_RATIO)
            .max(min.min(available))
            .floor()
    }
}

/// Default size (92 % of the work area when it is smaller), centred in the work area.
/// Desktop units are logical points when `logical_desktop`, physical pixels otherwise.
pub fn place(m: &MonitorInfo, logical_desktop: bool) -> Placement {
    let scale = if m.scale > 0.0 { m.scale } else { 1.0 };
    let work_l = m.work.scaled(scale);
    let w = fit(DEFAULT_SIZE.0, MIN_SIZE.0, work_l.w);
    let h = fit(DEFAULT_SIZE.1, MIN_SIZE.1, work_l.h);
    let (anchor, position) = if logical_desktop {
        (
            (work_l.x, work_l.y),
            (
                (work_l.x + (work_l.w - w) / 2.0).round(),
                (work_l.y + (work_l.h - h) / 2.0).round(),
            ),
        )
    } else {
        (
            (m.work.x, m.work.y),
            (
                (m.work.x + (m.work.w - w * scale) / 2.0).round(),
                (m.work.y + (m.work.h - h * scale) / 2.0).round(),
            ),
        )
    };
    Placement {
        size: (w, h),
        anchor,
        position,
    }
}

// ── Pure: toggle and blur ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToggleAction {
    Show,
    Hide,
    Focus,
}

/// Hidden → show; visible and focused → hide; visible but not focused (pinned) → focus.
pub fn toggle_action(visible: bool, focused: bool) -> ToggleAction {
    match (visible, focused) {
        (false, _) => ToggleAction::Show,
        (true, true) => ToggleAction::Hide,
        (true, false) => ToggleAction::Focus,
    }
}

/// Everything the debounced blur check looks at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BlurCheck {
    /// `settings.hideOnBlur` (false = pinned).
    pub hide_on_blur: bool,
    /// Blur guard reference count.
    pub guard: i32,
    /// Milliseconds between the last show and the focus loss (None = never shown).
    pub ms_since_shown_at_blur: Option<u64>,
    /// No focus change happened during the debounce wait.
    pub still_current: bool,
    /// Window state after the debounce wait.
    pub visible: bool,
    pub focused: bool,
}

/// True when a focus loss should hide the window (after the 150 ms debounce).
pub fn blur_hides(c: &BlurCheck) -> bool {
    c.hide_on_blur
        && c.guard <= 0
        && c.still_current
        && c.visible
        && !c.focused
        && c.ms_since_shown_at_blur
            .is_none_or(|ms| ms >= SHOW_GRACE_MS)
}

// ── Effects ──────────────────────────────────────────────────────────────────────────────────

fn monitor_info(m: &tauri::Monitor) -> MonitorInfo {
    let pos = m.position();
    let size = m.size();
    let work = m.work_area();
    MonitorInfo {
        frame: Rect {
            x: f64::from(pos.x),
            y: f64::from(pos.y),
            w: f64::from(size.width),
            h: f64::from(size.height),
        },
        work: Rect {
            x: f64::from(work.position.x),
            y: f64::from(work.position.y),
            w: f64::from(work.size.width),
            h: f64::from(work.size.height),
        },
        scale: m.scale_factor(),
    }
}

fn desktop_position(logical: bool, (x, y): (f64, f64)) -> Position {
    if logical {
        Position::Logical(LogicalPosition::new(x, y))
    } else {
        Position::Physical(PhysicalPosition::new(x.round() as i32, y.round() as i32))
    }
}

/// Moves the window onto the cursor's monitor, sizes it there, centres it in the work area.
fn position_on_cursor_monitor<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) {
    let monitors = match app.available_monitors() {
        Ok(m) if !m.is_empty() => m,
        Ok(_) => {
            log::warn!("show: no monitors reported, keeping the current position");
            return;
        }
        Err(e) => {
            log::warn!("show: listing monitors failed ({e}), keeping the current position");
            return;
        }
    };
    let infos: Vec<MonitorInfo> = monitors.iter().map(monitor_info).collect();
    let primary = app.primary_monitor().ok().flatten();
    let primary_scale = primary.as_ref().map_or(1.0, |p| p.scale_factor());
    let primary_index = primary.as_ref().and_then(|p| {
        let pi = monitor_info(p);
        infos.iter().position(|m| m.frame == pi.frame)
    });
    let cursor = app.cursor_position().ok().map(|p| (p.x, p.y));
    let logical = platform::logical_desktop();
    let Some(index) = pick_monitor(cursor, primary_scale, &infos, primary_index, logical) else {
        log::warn!("show: no monitor found, keeping the current position");
        return;
    };
    if cursor.is_none_or(|(x, y)| {
        pick_monitor(Some((x, y)), primary_scale, &infos, None, logical).is_none()
    }) {
        log::warn!("show: cursor is not on any monitor, falling back to the primary monitor");
    }
    let p = place(&infos[index], logical);
    // Move first, then size (mixed scale factors: sizing on the old screen would jump).
    let _ = window.set_position(desktop_position(logical, p.anchor));
    let _ = window.set_size(LogicalSize::new(p.size.0, p.size.1));
    let _ = window.set_position(desktop_position(logical, p.position));
    log::debug!(
        "show: monitor {index} scale {} -> size {:?} at {:?}",
        infos[index].scale,
        p.size,
        p.position
    );
}

/// Shows and focuses the main window on the cursor's monitor, then emits `shell://shown`.
/// Before the first frame the request is remembered and served by `window_ready`.
pub fn show_main<R: Runtime>(app: &AppHandle<R>, reason: ShownReason) -> Result<(), AppError> {
    if let Some(s) = app.try_state::<ShellState>()
        && !s.ready.load(Ordering::SeqCst)
    {
        *lock(&s.pending_show) = Some(reason);
        log::info!("show ({reason:?}) requested before the first frame: deferred");
        return Ok(());
    }
    let window = main_window(app)?;
    position_on_cursor_monitor(app, &window);
    platform::show_panel(&window)?;
    if let Some(s) = app.try_state::<ShellState>() {
        *lock(&s.shown_at) = Some(Instant::now());
        s.focus_seq.fetch_add(1, Ordering::SeqCst);
    }
    log::info!("main window shown ({reason:?})");
    super::emit(app, ShownPayload { reason });
    super::shortcut::refresh_conflict(app);
    Ok(())
}

/// Command `window_ready`: the first frame is rendered. Shows the window unless launched by the
/// login item (`--autostart`); a show requested earlier wins over that.
pub fn ready<R: Runtime>(app: &AppHandle<R>) -> Result<(), AppError> {
    let Some(s) = app.try_state::<ShellState>() else {
        return show_main(app, ShownReason::Launch);
    };
    if s.ready.swap(true, Ordering::SeqCst) {
        log::debug!("window_ready again (webview reload): ignored");
        return Ok(());
    }
    let pending = lock(&s.pending_show).take();
    match pending {
        Some(reason) => show_main(app, reason),
        None if s.autostart_launch => {
            log::info!("first frame ready; autostart launch stays hidden");
            Ok(())
        }
        None => show_main(app, ShownReason::Launch),
    }
}

/// Command `window_hide`: last Esc layer, Cmd+W; also tray / shortcut toggles and blur. Emits
/// `shell://hidden` (the page resets while nobody sees it), then refreshes the tray's overdue dot
/// (a step ticked or dated just before hiding shows at once).
pub fn hide<R: Runtime>(app: &AppHandle<R>) -> Result<(), AppError> {
    platform::hide_panel(&main_window(app)?)?;
    super::emit(app, HiddenPayload {});
    super::tray::refresh_badge_soon(app);
    Ok(())
}

/// The global shortcut / tray left click: show, hide or focus (see [`toggle_action`]).
pub fn toggle<R: Runtime>(app: &AppHandle<R>, reason: ShownReason) -> Result<(), AppError> {
    let window = main_window(app)?;
    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    match toggle_action(visible, focused) {
        ToggleAction::Show => show_main(app, reason),
        ToggleAction::Hide => {
            log::info!("toggle: hiding the main window");
            hide(app)
        }
        ToggleAction::Focus => {
            log::info!("toggle: focusing the visible main window");
            platform::show_panel(&window)
        }
    }
}

/// Command `set_blur_guard`: reference-counted "do not hide on blur".
pub fn set_blur_guard<R: Runtime>(app: &AppHandle<R>, active: bool) -> Result<(), AppError> {
    let Some(s) = app.try_state::<ShellState>() else {
        return Ok(());
    };
    let now = if active {
        s.blur_guard.fetch_add(1, Ordering::SeqCst) + 1
    } else {
        let prev = s
            .blur_guard
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |v| Some((v - 1).max(0)))
            .unwrap_or(0);
        (prev - 1).max(0)
    };
    log::debug!("blur guard {} -> {now}", if active { "up" } else { "down" });
    Ok(())
}

/// Window events: debounced hide on blur, CloseRequested → hide.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if window.label() != MAIN_LABEL {
        return;
    }
    let app = window.app_handle();
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            if let Err(e) = hide(app) {
                log::warn!("close request: hide failed: {e}");
            }
        }
        WindowEvent::Focused(true) => {
            if let Some(s) = app.try_state::<ShellState>() {
                s.focus_seq.fetch_add(1, Ordering::SeqCst);
            }
        }
        WindowEvent::Focused(false) => schedule_blur_check(app),
        _ => {}
    }
}

fn schedule_blur_check<R: Runtime>(app: &AppHandle<R>) {
    let Some(s) = app.try_state::<ShellState>() else {
        return;
    };
    let seq = s.focus_seq.fetch_add(1, Ordering::SeqCst) + 1;
    let since_shown = s.ms_since_shown();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(BLUR_DEBOUNCE_MS)).await;
        let Some(s) = app.try_state::<ShellState>() else {
            return;
        };
        let Ok(window) = main_window(&app) else {
            return;
        };
        let check = BlurCheck {
            hide_on_blur: s.hide_on_blur.load(Ordering::SeqCst),
            guard: s.blur_guard.load(Ordering::SeqCst),
            ms_since_shown_at_blur: since_shown,
            still_current: s.focus_seq.load(Ordering::SeqCst) == seq,
            visible: window.is_visible().unwrap_or(false),
            focused: window.is_focused().unwrap_or(true),
        };
        if blur_hides(&check) {
            log::info!("focus lost: hiding the main window");
            if let Err(e) = hide(&app) {
                log::warn!("blur hide failed: {e}");
            }
        } else {
            log::debug!("focus lost, kept visible: {check:?}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mon(x: f64, y: f64, w: f64, h: f64, menu: f64, scale: f64) -> MonitorInfo {
        MonitorInfo {
            frame: Rect { x, y, w, h },
            work: Rect {
                x,
                y: y + menu,
                w,
                h: h - menu,
            },
            scale,
        }
    }

    /// macOS: Retina built-in (2x, 1512×982 pt) as primary at the origin, a 1x 1920×1080 screen
    /// to its right. tao: monitor "physical" = points × own scale, cursor = points × primary scale.
    fn mac_pair() -> Vec<MonitorInfo> {
        vec![
            // Secondary first so a naive physical test would pick it by mistake.
            mon(1512.0, 0.0, 1920.0, 1080.0, 25.0, 1.0),
            mon(0.0, 0.0, 3024.0, 1964.0, 74.0, 2.0),
        ]
    }

    #[test]
    fn mac_mixed_scale_picks_the_screen_under_the_cursor() {
        let mons = mac_pair();
        // Cursor at (1000, 100) pt on the Retina screen → physical (2000, 200) by primary scale.
        assert_eq!(
            pick_monitor(Some((2000.0, 200.0)), 2.0, &mons, Some(1), true),
            Some(1)
        );
        // The naive physical test would have matched the secondary (1512..3432).
        assert_eq!(
            pick_monitor(Some((2000.0, 200.0)), 2.0, &mons, Some(1), false),
            Some(0)
        );
        // Cursor at (2000, 500) pt on the 1x screen → physical (4000, 1000).
        assert_eq!(
            pick_monitor(Some((4000.0, 1000.0)), 2.0, &mons, Some(1), true),
            Some(0)
        );
    }

    #[test]
    fn windows_mixed_scale_uses_physical_pixels() {
        let mons = vec![
            mon(0.0, 0.0, 1920.0, 1080.0, 0.0, 1.0),
            mon(1920.0, 0.0, 3840.0, 2160.0, 0.0, 1.5),
        ];
        assert_eq!(
            pick_monitor(Some((2500.0, 300.0)), 1.0, &mons, Some(0), false),
            Some(1)
        );
        assert_eq!(
            pick_monitor(Some((100.0, 100.0)), 1.0, &mons, Some(0), false),
            Some(0)
        );
    }

    #[test]
    fn cursor_outside_every_monitor_falls_back_to_primary() {
        let mons = mac_pair();
        assert_eq!(
            pick_monitor(Some((-500.0, -500.0)), 2.0, &mons, Some(1), true),
            Some(1)
        );
        assert_eq!(pick_monitor(None, 2.0, &mons, Some(1), true), Some(1));
        assert_eq!(pick_monitor(None, 2.0, &mons, None, true), Some(0));
        assert_eq!(pick_monitor(None, 1.0, &[], None, false), None);
    }

    #[test]
    fn placement_centres_in_logical_points_on_mac() {
        let mons = mac_pair();
        // Retina: work area 1512×945 pt starting at y=37 pt (74 px / 2).
        let p = place(&mons[1], true);
        assert_eq!(p.size, (1280.0, 860.0));
        assert_eq!(p.anchor, (0.0, 37.0));
        assert_eq!(p.position, (116.0, 80.0)); // (1512-1280)/2, 37 + (945-860)/2 = 79.5 → 80
        // 1x screen to the right: x offset 1512 pt.
        let q = place(&mons[0], true);
        assert_eq!(q.position, (1832.0, 123.0)); // 1512 + 320, 25 + (1055-860)/2 = 122.5 → 123
    }

    #[test]
    fn placement_centres_in_physical_pixels_on_windows() {
        let m = MonitorInfo {
            frame: Rect {
                x: 1920.0,
                y: 0.0,
                w: 3840.0,
                h: 2160.0,
            },
            work: Rect {
                x: 1920.0,
                y: 0.0,
                w: 3840.0,
                h: 2112.0,
            },
            scale: 1.5,
        };
        let p = place(&m, false);
        assert_eq!(p.size, (1280.0, 860.0));
        assert_eq!(p.anchor, (1920.0, 0.0));
        assert_eq!(p.position, (2880.0, 411.0)); // 1920 + (3840-1920)/2, (2112-1290)/2
    }

    #[test]
    fn small_work_area_uses_92_percent() {
        // 1366×768 laptop at 1x with a 40 px taskbar: work area 1366×728.
        let m = mon(0.0, 0.0, 1366.0, 768.0, 40.0, 1.0);
        let p = place(&m, false);
        assert_eq!(p.size, (1280.0, 680.0)); // width fits; 728 × 0.92 = 669.8 < min 680 → 680
        let tiny = mon(0.0, 0.0, 1000.0, 600.0, 0.0, 1.0);
        let q = place(&tiny, false);
        assert_eq!(q.size, (1000.0, 600.0)); // smaller than the minimum: whole work area
        let mid = mon(0.0, 0.0, 1250.0, 840.0, 0.0, 1.0);
        assert_eq!(place(&mid, false).size, (1150.0, 772.0)); // 92 %
    }

    #[test]
    fn toggle_matrix() {
        assert_eq!(toggle_action(false, false), ToggleAction::Show);
        assert_eq!(toggle_action(false, true), ToggleAction::Show);
        assert_eq!(toggle_action(true, true), ToggleAction::Hide);
        assert_eq!(toggle_action(true, false), ToggleAction::Focus);
    }

    fn blur() -> BlurCheck {
        BlurCheck {
            hide_on_blur: true,
            guard: 0,
            ms_since_shown_at_blur: Some(2_000),
            still_current: true,
            visible: true,
            focused: false,
        }
    }

    #[test]
    fn blur_debounce_state_machine() {
        assert!(blur_hides(&blur()));
        assert!(blur_hides(&BlurCheck {
            ms_since_shown_at_blur: None,
            ..blur()
        }));
        // Pinned.
        assert!(!blur_hides(&BlurCheck {
            hide_on_blur: false,
            ..blur()
        }));
        // Blur guard held (drag, dialog, recording).
        assert!(!blur_hides(&BlurCheck { guard: 1, ..blur() }));
        // Within 300 ms of a show.
        assert!(!blur_hides(&BlurCheck {
            ms_since_shown_at_blur: Some(299),
            ..blur()
        }));
        assert!(blur_hides(&BlurCheck {
            ms_since_shown_at_blur: Some(300),
            ..blur()
        }));
        // Focus came back (or another focus change) during the 150 ms wait.
        assert!(!blur_hides(&BlurCheck {
            still_current: false,
            ..blur()
        }));
        assert!(!blur_hides(&BlurCheck {
            focused: true,
            ..blur()
        }));
        // Already hidden.
        assert!(!blur_hides(&BlurCheck {
            visible: false,
            ..blur()
        }));
    }
}
