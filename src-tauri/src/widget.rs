//! The widget: a small window with 오늘 일정·할 일, 결재 대기, 최근 알림, 비서 상태 and a quick message box.
//! Click the menu bar icon and it drops down under the icon, then hides when it loses focus.
//! Pin it ("고정") and it stays on top as a floating window you can drag anywhere, on every Space.
//! It is the same web page as the main window (label "widget"); every server call still goes through Rust.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, PhysicalPosition, Rect, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const LABEL: &str = "widget";
const WIDTH: f64 = 340.0;
const HEIGHT: f64 = 560.0;
/// Points between the menu bar icon and the widget, and from the screen edges.
const GAP: f64 = 6.0;

#[derive(Default)]
pub struct WidgetState {
    pinned: AtomicBool,
    /// When focus loss hid it: a click on the icon right after must not open it again (it is the click that hid it).
    hidden_at: Mutex<Option<Instant>>,
}

/// Made hidden at start, so it opens at once and already holds today's data.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("ax-kit 위젯")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .shadow(true)
        .build()
}

/// Where the widget's top-left goes (physical pixels): centered under the icon, inside the screen's work area.
pub fn place(icon: (f64, f64, f64, f64), window: (f64, f64), area: (f64, f64, f64, f64), gap: f64) -> (f64, f64) {
    let (ix, iy, iw, ih) = icon;
    let (ww, wh) = window;
    let (ax, ay, aw, ah) = area;
    let x = (ix + iw / 2.0 - ww / 2.0).clamp(ax + gap, (ax + aw - ww - gap).max(ax + gap));
    let y = (iy + ih + gap).clamp(ay + gap, (ay + ah - wh - gap).max(ay + gap));
    (x.round(), y.round())
}

fn window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(LABEL)
}

pub fn pinned<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.state::<WidgetState>().pinned.load(Ordering::SeqCst)
}

fn show<R: Runtime>(w: &WebviewWindow<R>) {
    let _ = w.show();
    let _ = w.set_focus();
}

/// Under the menu bar icon (unless pinned: then it stays where the owner put it).
fn show_under<R: Runtime>(app: &AppHandle<R>, w: &WebviewWindow<R>, rect: Option<Rect>) {
    if !pinned(app) {
        if let Some(rect) = rect {
            let scale = w.scale_factor().unwrap_or(2.0);
            let p = rect.position.to_physical::<f64>(scale);
            let s = rect.size.to_physical::<f64>(scale);
            let size = w.outer_size().map(|s| (s.width as f64, s.height as f64)).unwrap_or((WIDTH * scale, HEIGHT * scale));
            if let Ok(Some(m)) = w.monitor_from_point(p.x + s.width / 2.0, p.y + s.height / 2.0) {
                let a = m.work_area();
                let area = (a.position.x as f64, a.position.y as f64, a.size.width as f64, a.size.height as f64);
                let (x, y) = place((p.x, p.y, s.width, s.height), size, area, GAP * scale);
                let _ = w.set_position(PhysicalPosition::new(x, y));
            }
        }
    }
    show(w);
}

/// A left click on the menu bar icon: open it under the icon, or put it away.
pub fn toggle<R: Runtime>(app: &AppHandle<R>, rect: Option<Rect>) {
    let Some(w) = window(app) else { return };
    let just_hid = app.state::<WidgetState>().hidden_at.lock().unwrap().take().is_some_and(|t| t.elapsed() < Duration::from_millis(400));
    if just_hid {
        return;
    }
    if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    show_under(app, &w, rect);
}

/// From the menu bar menu ("위젯 열기").
pub fn open<R: Runtime>(app: &AppHandle<R>) {
    let rect = app.tray_by_id(crate::attention::TRAY_ID).and_then(|t| t.rect().ok().flatten());
    if let Some(w) = window(app) {
        show_under(app, &w, rect);
    }
}

/// Focus went elsewhere: a drop-down widget goes away, a pinned one stays.
pub fn blurred<R: Runtime>(app: &AppHandle<R>) {
    if pinned(app) {
        return;
    }
    if let Some(w) = window(app) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            *app.state::<WidgetState>().hidden_at.lock().unwrap() = Some(Instant::now());
        }
    }
}

pub fn set_pinned<R: Runtime>(app: &AppHandle<R>, on: bool) {
    app.state::<WidgetState>().pinned.store(on, Ordering::SeqCst);
    if let Some(w) = window(app) {
        let _ = w.set_visible_on_all_workspaces(on);
        if on {
            show(&w);
        }
    }
}

pub fn hide<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = window(app) {
        let _ = w.hide();
    }
}

#[cfg(test)]
mod tests {
    use super::place;

    #[test]
    fn drops_down_centered_under_the_icon() {
        // A 2x screen 3024x1890 with the menu bar (74 px) taken off the work area.
        let area = (0.0, 74.0, 3024.0, 1816.0);
        assert_eq!(place((2000.0, 0.0, 60.0, 74.0), (680.0, 1120.0), area, 12.0), (1690.0, 86.0));
    }

    #[test]
    fn stays_on_screen_near_the_edge() {
        let area = (0.0, 74.0, 3024.0, 1816.0);
        // Icon at the far right: the widget is pushed left so it fits.
        assert_eq!(place((2980.0, 0.0, 40.0, 74.0), (680.0, 1120.0), area, 12.0), (2332.0, 86.0));
        // A second monitor to the left (negative x).
        assert_eq!(place((-1900.0, 0.0, 40.0, 50.0), (680.0, 1120.0), (-1920.0, 50.0, 1920.0, 1030.0), 12.0), (-1908.0, 62.0));
    }
}
