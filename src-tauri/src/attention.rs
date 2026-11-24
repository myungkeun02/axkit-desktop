//! What pulls the owner back: the Dock badge (open 결재), the menu bar icon, and Mac notifications.
//! Closing the window only hides it, so the stream keeps running and notifications keep coming.

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_notification::NotificationExt;

pub const TRAY_ID: &str = "main";

#[derive(Serialize, Clone)]
pub struct Navigate {
    pub section: &'static str,
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// The menu bar icon: click = the widget drops down; menu = 위젯 / 열기 / 결재 보기 / 끝내기.
pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let widget = MenuItem::with_id(app, "widget", "위젯 열기", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "ax-kit 열기", true, None::<&str>)?;
    let approvals = MenuItem::with_id(app, "approvals", "결재 보기", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "끝내기", true, Some("CmdOrCtrl+Q"))?;
    let menu = Menu::with_items(app, &[&widget, &open, &approvals, &PredefinedMenuItem::separator(app)?, &quit])?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .tooltip("ax-kit")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "widget" => crate::widget::open(app),
            "open" => show_main(app),
            "approvals" => {
                show_main(app);
                let _ = app.emit("ax://navigate", Navigate { section: "approvals" });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
                crate::widget::toggle(tray.app_handle(), Some(rect));
            }
        })
        .build(app)?;
    Ok(())
}

/// Text next to the menu bar icon ("3" when 결재 wait) and the Dock badge.
pub fn set_count<R: Runtime>(app: &AppHandle<R>, count: u32) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_title(if count > 0 { Some(count.to_string()) } else { None });
        let _ = tray.set_tooltip(Some(if count > 0 { format!("ax-kit · 결재 {count}개") } else { "ax-kit".to_string() }));
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_badge_count(if count > 0 { Some(count as i64) } else { None });
    }
}

pub fn notify<R: Runtime>(app: &AppHandle<R>, title: &str, body: &str) -> Result<(), String> {
    app.notification().builder().title(title).body(body).show().map_err(|e| e.to_string())
}

/// Plain text only: no markdown marks, spaces folded, at most `max` characters (a safety cap, not a summary).
pub fn clean(text: &str, max: usize) -> String {
    let plain: String = text.replace("**", "").replace('`', "").replace('#', "").split_whitespace().collect::<Vec<_>>().join(" ");
    if plain.chars().count() > max { format!("{}…", plain.chars().take(max).collect::<String>()) } else { plain }
}

#[cfg(test)]
mod tests {
    use super::clean;

    #[test]
    fn notification_text_is_plain_and_short() {
        assert_eq!(clean("**원두**가  `떨어져요`\n## 주문할까요?", 120), "원두가 떨어져요 주문할까요?");
        assert_eq!(clean(&"가".repeat(130), 120).chars().count(), 121);
    }
}
