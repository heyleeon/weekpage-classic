//! macOS menu bar "overdue steps" dot.
//!
//! The status item's image is a template (AppKit tints it for the menu bar's light / dark look),
//! which cannot carry colour. So the dot is a view of its own: a 6 pt red circle (`NSBox`, custom
//! type, `systemRedColor`) added to the status item's button over the top-right corner of the
//! glyph. tray-icon puts its click-target view on the same button, so the dot goes BELOW the
//! existing subviews and every click still reaches the tray target. It is found again for
//! removal by its class (tray-icon adds no `NSBox`). Everything runs on the main thread through
//! `with_inner_tray_icon`.

use objc2::rc::Retained;
use objc2::runtime::NSObjectProtocol;
use objc2::{ClassType, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSBox, NSBoxType, NSColor, NSStatusBarButton, NSTitlePosition,
    NSView, NSWindowOrderingMode,
};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use tauri::Runtime;
use tauri::tray::TrayIcon;

use crate::error::AppError;

/// Dot diameter in points.
const DOT: f64 = 6.0;
/// How far the dot pokes out of the glyph's top-right corner, in points.
const OUTSET: f64 = 1.0;

/// Adds (`on`) or removes the dot. Errors when the status item is gone (hidden by the system).
pub fn set_badge<R: Runtime>(tray: &TrayIcon<R>, on: bool) -> Result<(), AppError> {
    let applied = tray.with_inner_tray_icon(move |inner| {
        let mtm = MainThreadMarker::new()?;
        let item = inner.ns_status_item()?;
        let button = item.button(mtm)?;
        apply(&button, on, mtm);
        Some(())
    })?;
    applied.ok_or_else(|| AppError::platform("menu bar status item is not available"))
}

fn dots(button: &NSStatusBarButton) -> Vec<Retained<NSView>> {
    button
        .subviews()
        .iter()
        .filter(|v| v.isKindOfClass(NSBox::class()))
        .collect()
}

fn apply(button: &NSStatusBarButton, on: bool, mtm: MainThreadMarker) {
    let existing = dots(button);
    if !on {
        for dot in existing {
            dot.removeFromSuperview();
        }
        return;
    }
    if !existing.is_empty() {
        return;
    }
    let flipped = button.isFlipped();
    let dot = NSBox::initWithFrame(NSBox::alloc(mtm), dot_frame(button, flipped));
    dot.setBoxType(NSBoxType::Custom);
    dot.setTitlePosition(NSTitlePosition::NoTitle);
    dot.setBorderWidth(0.0);
    dot.setCornerRadius(DOT / 2.0);
    dot.setFillColor(&NSColor::systemRedColor());
    // Keep the distance to the top and right edges when the button is resized.
    let top_fixed = if flipped {
        NSAutoresizingMaskOptions::ViewMaxYMargin
    } else {
        NSAutoresizingMaskOptions::ViewMinYMargin
    };
    dot.setAutoresizingMask(NSAutoresizingMaskOptions::ViewMinXMargin | top_fixed);
    button.addSubview_positioned_relativeTo(&dot, NSWindowOrderingMode::Below, None);
}

/// The dot's frame in the button's coordinates: a DOT × DOT square over the top-right corner of
/// the rect the image is drawn in, poking OUTSET out of it like an app badge, kept inside the
/// button's bounds.
fn dot_frame(button: &NSStatusBarButton, flipped: bool) -> NSRect {
    let bounds = button.bounds();
    let image = button
        .cell()
        .map(|cell| cell.imageRectForBounds(bounds))
        .filter(|r| r.size.width >= DOT && r.size.height >= DOT)
        .unwrap_or(bounds);
    let (min_x, max_x) = (bounds.origin.x, bounds.origin.x + bounds.size.width - DOT);
    let (min_y, max_y) = (bounds.origin.y, bounds.origin.y + bounds.size.height - DOT);
    let x = image.origin.x + image.size.width - DOT + OUTSET;
    let y = if flipped {
        image.origin.y - OUTSET
    } else {
        image.origin.y + image.size.height - DOT + OUTSET
    };
    NSRect::new(
        NSPoint::new(
            x.clamp(min_x, max_x.max(min_x)).round(),
            y.clamp(min_y, max_y.max(min_y)).round(),
        ),
        NSSize::new(DOT, DOT),
    )
}
