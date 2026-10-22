//! Trackpad finger phases for the webview (ui-spec §1.3「左右滑动换页」, §10.14).
//!
//! The page sees a two-finger swipe only as wheel events, and WebKit keeps the zero-delta events
//! that carry the scroll phase away from it: the page cannot tell fingers resting on the trackpad
//! from fingers lifted. A local event monitor reads the phase of every scroll event the app
//! receives and reports fingers down (MayBegin / Began) and up (Ended / Cancelled), a few calls
//! per swipe. Momentum events and mouse wheels carry no phase and report nothing. The event goes
//! on to WebKit untouched.

use std::ptr::NonNull;

use block2::RcBlock;
use objc2_app_kit::{NSEvent, NSEventMask, NSEventPhase};

/// Installs the monitor for the app's lifetime. Main thread (setup).
pub fn watch(on_change: impl Fn(bool) + 'static) {
    let handler = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        // SAFETY: AppKit hands the monitor a live event for the duration of the call.
        let phase = unsafe { event.as_ref() }.phase();
        if phase.intersects(NSEventPhase::MayBegin | NSEventPhase::Began) {
            on_change(true);
        } else if phase.intersects(NSEventPhase::Ended | NSEventPhase::Cancelled) {
            on_change(false);
        }
        event.as_ptr()
    });
    // SAFETY: the handler returns the event it was given (never null), so AppKit dispatches it on
    // as usual.
    let monitor = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::ScrollWheel, &handler)
    };
    match monitor {
        // Kept for the app's lifetime: dropping it would leave AppKit holding the only reference.
        Some(m) => std::mem::forget(m),
        None => log::warn!("trackpad phases: event monitor not installed"),
    }
}
