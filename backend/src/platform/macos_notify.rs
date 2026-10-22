//! macOS notifications through UNUserNotificationCenter (see architecture §11).
//!
//! - A process without a real `.app` bundle (`tauri dev`, `target/debug/weekpage`) must never
//!   touch UNUserNotificationCenter: it throws `NSInternalInconsistencyException` ("bundleProxy
//!   ForCurrentProcess is nil") and takes the whole process down. We only log a warning there
//!   (debug builds can opt into an `osascript` fallback with `WEEKPAGE_OSASCRIPT_NOTIFY=1`).
//! - Authorization is requested lazily, right before the first real notification (not at setup):
//!   ad-hoc signed builds lose TCC grants between builds.
//! - A delegate makes banners show even while our app is active and turns a click into
//!   "show the window" (ui-spec §16.1, P2).

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{ClassType, define_class, msg_send};
use objc2_foundation::{NSBundle, NSError, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification,
    UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse,
    UNNotificationSound, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};

use crate::error::AppError;

const OSASCRIPT_ENV: &str = "WEEKPAGE_OSASCRIPT_NOTIFY";

static AUTH_REQUESTED: AtomicBool = AtomicBool::new(false);
static DELEGATE_INSTALLED: AtomicBool = AtomicBool::new(false);
static WARNED_NO_BUNDLE: AtomicBool = AtomicBool::new(false);
static ON_CLICK: OnceLock<Box<dyn Fn() + Send + Sync>> = OnceLock::new();

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "WeekPageNotificationDelegate"]
    struct NotificationDelegate;

    unsafe impl NSObjectProtocol for NotificationDelegate {}

    unsafe impl UNUserNotificationCenterDelegate for NotificationDelegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            handler.call((UNNotificationPresentationOptions::Banner
                | UNNotificationPresentationOptions::List
                | UNNotificationPresentationOptions::Sound,));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            _response: &UNNotificationResponse,
            handler: &block2::DynBlock<dyn Fn()>,
        ) {
            if let Some(cb) = ON_CLICK.get() {
                cb();
            }
            handler.call(());
        }
    }
);

/// Registers what a click on one of our notifications does (first call wins).
pub fn set_click_handler(f: Box<dyn Fn() + Send + Sync>) {
    let _ = ON_CLICK.set(f);
}

/// True when this process runs from a real `.app` bundle with an identifier.
pub fn has_app_bundle() -> bool {
    let bundle = NSBundle::mainBundle();
    bundle.bundleIdentifier().is_some() && bundle.bundlePath().to_string().ends_with(".app")
}

fn install_delegate(center: &UNUserNotificationCenter) {
    if DELEGATE_INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }
    // SAFETY: plain `+new` on an NSObject subclass without ivars.
    let delegate: Retained<NotificationDelegate> =
        unsafe { msg_send![NotificationDelegate::class(), new] };
    center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    // The center keeps a weak reference: keep the delegate alive for the process lifetime.
    std::mem::forget(delegate);
}

fn add_request(center: &UNUserNotificationCenter, request: &UNNotificationRequest) {
    let done = RcBlock::new(|err: *mut NSError| {
        if err.is_null() {
            log::info!("notification delivered to the notification center");
        } else {
            // SAFETY: non-null NSError pointer handed to the completion handler.
            let desc = unsafe { (*err).localizedDescription() };
            log::warn!("notification request failed: {desc}");
        }
    });
    center.addNotificationRequest_withCompletionHandler(request, Some(&done));
}

fn applescript_quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Debug-only fallback for unbundled runs (`tauri dev`): `osascript display notification`.
fn osascript_fallback(title: &str, body: &str) -> bool {
    if !cfg!(debug_assertions) || std::env::var(OSASCRIPT_ENV).map_or(true, |v| v.trim() != "1") {
        return false;
    }
    let script = format!(
        "display notification {} with title {}",
        applescript_quote(body),
        applescript_quote(title)
    );
    match std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .status()
    {
        Ok(s) if s.success() => true,
        Ok(s) => {
            log::warn!("notify: osascript fallback exited with {s}");
            false
        }
        Err(e) => {
            log::warn!("notify: osascript fallback failed: {e}");
            false
        }
    }
}

/// Sends one immediate notification (see module docs for the no-bundle and authorization rules).
pub fn send(title: &str, body: &str) -> Result<(), AppError> {
    if !has_app_bundle() {
        if osascript_fallback(title, body) {
            log::info!("notify: no app bundle, sent through the osascript fallback");
        } else if !WARNED_NO_BUNDLE.swap(true, Ordering::SeqCst) {
            log::warn!(
                "notify: process has no app bundle identifier (tauri dev / bare binary), \
                 skipping UNUserNotificationCenter; notifications are dropped in this run"
            );
        } else {
            log::warn!("notify: no app bundle, notification dropped");
        }
        return Ok(());
    }

    let center = UNUserNotificationCenter::currentNotificationCenter();
    install_delegate(&center);

    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(title));
    content.setBody(&NSString::from_str(body));
    content.setSound(Some(&UNNotificationSound::defaultSound()));
    let id = NSString::from_str(&crate::db::new_id());
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&id, &content, None);

    if AUTH_REQUESTED.swap(true, Ordering::SeqCst) {
        add_request(&center, &request);
        return Ok(());
    }
    // First notification of this process: ask for permission, then deliver from the callback.
    let center_for_cb = center.clone();
    let on_auth = RcBlock::new(move |granted: Bool, err: *mut NSError| {
        if !err.is_null() {
            // SAFETY: non-null NSError pointer handed to the completion handler.
            let desc = unsafe { (*err).localizedDescription() };
            log::warn!("notification authorization error: {desc}");
        }
        if granted.as_bool() {
            log::info!("notification authorization granted");
            add_request(&center_for_cb, &request);
        } else {
            log::warn!("notification authorization denied; reminders will not show banners");
        }
    });
    center.requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
        &on_auth,
    );
    Ok(())
}
