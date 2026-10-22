//! macOS NSPanel conversion and window level (see architecture §4).
//!
//! Tauri creates the main window as a plain NSWindow. At setup we swap its class in place
//! (`object_setClass`) to a NSPanel subclass with no ivars, then turn it into a non-activating
//! floating panel: it can become key (we need typing) but never main, showing it does not
//! activate the app (the previous app stays active), it joins every Space and floats over
//! full-screen apps (`FullScreenAuxiliary`; without it the level alone silently does nothing).
//! Show = `makeKeyAndOrderFront`, hide = `orderOut`, always on the main thread.

use objc2::runtime::AnyObject;
use objc2::{ClassType, MainThreadOnly, define_class};
use objc2_app_kit::{
    NSFloatingWindowLevel, NSPanel, NSWindowCollectionBehavior, NSWindowStyleMask, NSWorkspace,
};
use tauri::{Runtime, WebviewWindow};

use crate::error::AppError;

define_class!(
    #[unsafe(super(NSPanel))]
    #[thread_kind = MainThreadOnly]
    #[name = "WeekPagePanel"]
    struct WeekPagePanel;

    impl WeekPagePanel {
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key_window(&self) -> bool {
            true
        }

        #[unsafe(method(canBecomeMainWindow))]
        fn can_become_main_window(&self) -> bool {
            false
        }
    }
);

/// The window's NSWindow viewed as a NSPanel. Only call on the main thread, after `convert`.
fn panel_of<R: Runtime>(window: &WebviewWindow<R>) -> Option<&'static NSPanel> {
    let ptr = window.ns_window().ok()?;
    if ptr.is_null() {
        return None;
    }
    // SAFETY: the pointer is the live NSWindow owned by tao; the main window is never destroyed
    // while the app runs, and after `convert` its class is a NSPanel subclass.
    Some(unsafe { &*(ptr as *const NSPanel) })
}

/// Swaps the class and applies the panel flags. Must run on the main thread (setup does).
pub fn convert<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), AppError> {
    let ptr = window.ns_window()?;
    if ptr.is_null() {
        return Err(AppError::platform("main window has no NSWindow"));
    }
    // SAFETY: WeekPagePanel adds no ivars, so swapping the class of a live NSWindow in place is
    // layout-compatible (same technique as tauri-nspanel).
    unsafe {
        let obj: &AnyObject = &*(ptr as *const AnyObject);
        AnyObject::set_class(obj, WeekPagePanel::class());
    }
    let panel = panel_of(window).ok_or_else(|| AppError::platform("panel conversion failed"))?;
    panel.setStyleMask(panel.styleMask() | NSWindowStyleMask::NonactivatingPanel);
    panel.setFloatingPanel(true);
    panel.setBecomesKeyOnlyIfNeeded(false);
    panel.setHidesOnDeactivate(false);
    panel.setWorksWhenModal(true);
    // NSFloatingWindowLevel is enough to cover full-screen apps (docs/memory/lessons.md, the
    // entry on the non-activating panel over full-screen apps). Do not raise it to
    // NSStatusWindowLevel without checking that IME candidate windows stay above the panel.
    panel.setLevel(NSFloatingWindowLevel);
    panel.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    log::info!("main window converted to a non-activating NSPanel (floating level)");
    Ok(())
}

/// `makeKeyAndOrderFront` on the main thread.
pub fn show<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), AppError> {
    let w = window.clone();
    window.run_on_main_thread(move || match panel_of(&w) {
        Some(panel) => panel.makeKeyAndOrderFront(None),
        None => {
            let _ = w.show();
            let _ = w.set_focus();
        }
    })?;
    Ok(())
}

/// `orderOut` on the main thread.
pub fn hide<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), AppError> {
    let w = window.clone();
    window.run_on_main_thread(move || match panel_of(&w) {
        Some(panel) => panel.orderOut(None),
        None => {
            let _ = w.hide();
        }
    })?;
    Ok(())
}

/// True when the user turned on "Reduce transparency" (the frontend then paints a solid ring).
pub fn reduce_transparency() -> bool {
    NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceTransparency()
}
