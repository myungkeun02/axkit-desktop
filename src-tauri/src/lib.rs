//! ax-kit desktop: a window onto the ax-kit server running on this Mac.
//! Every server call goes through these commands so the token stays in this process.

mod attention;
mod files;
mod live;
pub mod conn;
pub mod remote;
pub mod update;
pub mod sse;
mod stream;
pub mod token;
mod widget;

use conn::{is_safe_path, Connection, Info};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use stream::Streamer;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

struct AppState {
    conn: Arc<Connection>,
    streamer: Arc<Streamer>,
    /// Becomes true once the first connection choice is made (the Keychain may ask the owner first).
    ready: tokio::sync::watch::Receiver<bool>,
    /// Files this app saved to Downloads; only these may be previewed or shown in Finder.
    saved: std::sync::Mutex<std::collections::HashSet<std::path::PathBuf>>,
    live: live::LiveStreamer,
}

#[derive(Serialize)]
struct Saved {
    path: String,
    name: String,
}

#[derive(Serialize)]
struct ApiReply {
    status: u16,
    /// Parsed JSON body, or null when the body was not JSON.
    body: serde_json::Value,
}

/// Headers the webview may set on uploads (`POST share`, recording chunks). Never `Authorization`.
const UPLOAD_HEADERS: &[&str] = &["x-file-name", "x-chunk-total", "x-started-at", "x-duration-sec"];

/// Headers for an upload. Tauri's raw invoke sets its own `Content-Type: application/octet-stream`, so the page
/// sends the real type as `x-content-type` and it goes to the Mac as `content-type` (§30 needs audio/mp4).
fn upload_headers(get: impl Fn(&str) -> Option<String>) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = UPLOAD_HEADERS.iter().filter_map(|h| get(h).map(|v| (h.to_string(), v))).collect();
    let kind = get("x-content-type").filter(|v| !v.is_empty() && v.len() < 128 && !v.contains(['\r', '\n']));
    out.push(("content-type".into(), kind.unwrap_or_else(|| "application/octet-stream".into())));
    out
}

async fn ready(state: &AppState) {
    let mut rx = state.ready.clone();
    let _ = rx.wait_for(|r| *r).await;
}

/// Every window is told when the app talks to another server, so none keeps showing the old one.
#[derive(Serialize, Clone)]
struct ServerChanged {
    mode: &'static str,
}

/// An `axkit://pair` link macOS opened us with (install script or a click), waiting for the main window to take it:
/// at a cold start the page is not listening yet, so it asks with `take_pair_link` once it is up.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct PairLink {
    link: String,
    host: String,
    problem: Option<String>,
}

static PAIR_LINK: std::sync::Mutex<Option<PairLink>> = std::sync::Mutex::new(None);

fn opened_urls(app: &AppHandle, urls: &[url::Url]) {
    let Some(url) = urls.iter().find(|u| u.scheme() == "axkit") else { return };
    let link = match remote::opened_link(url.as_str()) {
        Ok((link, host)) => PairLink { link, host, problem: None },
        Err(why) => PairLink { problem: Some(why.to_string()), ..Default::default() },
    };
    if let Ok(mut slot) = PAIR_LINK.lock() {
        *slot = Some(link.clone());
    }
    attention::show_main(app);
    let _ = app.emit_to("main", "ax://pair-link", link);
}

#[tauri::command]
fn take_pair_link() -> Option<PairLink> {
    PAIR_LINK.lock().ok().and_then(|mut slot| slot.take())
}

fn server_changed(app: &AppHandle, info: &Info) {
    let _ = app.emit("ax://server-changed", ServerChanged { mode: info.mode });
}

#[tauri::command]
async fn connection(state: State<'_, AppState>) -> Result<Info, String> {
    ready(&state).await;
    Ok(state.conn.info().await)
}

/// Re-read the token file (the "다시 연결" button).
#[tauri::command]
async fn reconnect(state: State<'_, AppState>) -> Result<Info, String> {
    Ok(match state.conn.source().await {
        Some(conn::Source::Mock(base)) => state.conn.use_mock(&base).await?,
        Some(conn::Source::Remote) => state.conn.use_remote().await,
        _ => state.conn.use_token_file().await,
    })
}

/// Development builds only: talk to the iOS repo's mock Mac instead.
#[tauri::command]
async fn use_mock(app: AppHandle, state: State<'_, AppState>, base_url: String) -> Result<Info, String> {
    let info = state.conn.use_mock(&base_url).await?;
    server_changed(&app, &info);
    Ok(info)
}

#[tauri::command]
async fn use_local(app: AppHandle, state: State<'_, AppState>) -> Result<Info, String> {
    let info = state.conn.use_token_file().await;
    server_changed(&app, &info);
    Ok(info)
}

/// "다른 맥의 비서에 연결": the `axkit://pair?…` link, or address + code + 연결 id typed by hand.
/// The code goes to that Mac once; the token it gives back goes to the Keychain and never to the webview.
#[tauri::command]
async fn pair_remote(app: AppHandle, state: State<'_, AppState>, link: Option<String>, address: Option<String>, code: Option<String>, nonce: Option<String>) -> Result<Info, String> {
    let pairing = match link.filter(|l| !l.trim().is_empty()) {
        Some(l) => remote::parse_link(&l),
        None => remote::parse_manual(address.as_deref().unwrap_or(""), code.as_deref().unwrap_or(""), nonce.as_deref().unwrap_or("")),
    }
    .map_err(str::to_string)?;
    // Only a pairing that worked touches the stream: a wrong code leaves the current connection running.
    let info = state.conn.pair_remote(&pairing).await?;
    state.streamer.stop().await;
    server_changed(&app, &info);
    Ok(info)
}

/// Stop using the other Mac (it is told to drop this device) and go back to this Mac's ax-kit.
#[tauri::command]
async fn forget_remote(app: AppHandle, state: State<'_, AppState>) -> Result<Info, String> {
    state.streamer.stop().await;
    let info = state.conn.forget_remote().await;
    server_changed(&app, &info);
    Ok(info)
}

#[tauri::command]
async fn api(
    state: State<'_, AppState>,
    method: String,
    path: String,
    query: Option<HashMap<String, String>>,
    body: Option<serde_json::Value>,
) -> Result<ApiReply, String> {
    ready(&state).await;
    if !is_safe_path(&path) || !matches!(method.as_str(), "GET" | "POST") {
        return Err("잘못된 요청이에요.".into());
    }
    let mut headers = vec![];
    let bytes = match body {
        Some(b) => {
            headers.push(("content-type".to_string(), "application/json".to_string()));
            Some(serde_json::to_vec(&b).map_err(|e| e.to_string())?)
        }
        None => None,
    };
    let reply = state.conn.call(&method, &path, &query.unwrap_or_default(), &headers, bytes).await.map_err(|e| e.words())?;
    let body = serde_json::from_slice(&reply.bytes).unwrap_or(serde_json::Value::Null);
    Ok(ApiReply { status: reply.status, body })
}

/// Raw bytes up: `invoke('upload', bytes, { headers: { 'x-ax-path': 'share', … } })`.
#[tauri::command]
async fn upload(state: State<'_, AppState>, request: Request<'_>) -> Result<ApiReply, String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("보낼 내용이 없어요.".into()) };
    let path = request.headers().get("x-ax-path").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let allowed = path == "share" || path == "dictation" || (path.starts_with("recordings/") && path.contains("/chunks/"));
    if !allowed || !is_safe_path(&path) {
        return Err("잘못된 요청이에요.".into());
    }
    let headers = upload_headers(|h| request.headers().get(h).and_then(|v| v.to_str().ok()).map(str::to_string));
    let no_query = HashMap::new();
    let call = state.conn.call("POST", &path, &no_query, &headers, Some(bytes.clone()));
    let reply = if path == "dictation" {
        // §30: pressing the button again while the Mac is writing drops the request itself (the connection closes).
        cancellable_dictation(call).await.map_err(str::to_string)?
    } else {
        call.await
    }
    .map_err(|e| e.words())?;
    let body = serde_json::from_slice(&reply.bytes).unwrap_or(serde_json::Value::Null);
    Ok(ApiReply { status: reply.status, body })
}

/// §32 바꾸기: fetch the Mac's build of this app, check it, hand the swap to a helper, and quit. Any problem before
/// the swap comes back as words and the running app stays as it is.
#[tauri::command]
async fn install_update(app: AppHandle, state: State<'_, AppState>, sha256: String) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|_| "앱이 있는 곳을 찾지 못했어요.".to_string())?;
    let dest = update::running_bundle(&exe).ok_or_else(|| "개발 중인 앱은 이렇게 바꿀 수 없어요.".to_string())?;
    let reply = state.conn.call("GET", "app-updates/desktop.zip", &HashMap::new(), &[], None).await.map_err(|e| e.words())?;
    match reply.status {
        200 => {}
        404 => return Err("맥에 아직 새 버전 파일이 없어요.".into()),
        401 => return Err("맥이 이 앱의 연결을 받지 않아요. 다시 연결해 주세요.".into()),
        _ => return Err("새 버전을 받지 못했어요. 조금 뒤에 다시 해 주세요.".into()),
    }
    let ready = tauri::async_runtime::spawn_blocking(move || update::prepare(&reply.bytes, &sha256, dest)).await.map_err(|_| "새 버전을 확인하지 못했어요.".to_string())??;
    update::hand_over(&ready)?;
    // Give the page a moment to say "다시 여는 중", then quit; the helper waits for this process to end.
    let quit = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        quit.exit(0);
    });
    Ok(())
}

/// The public release's description (`releases/latest/download/ax-kit-desktop.json`); the page compares its build.
#[tauri::command]
async fn check_release() -> Result<update::ReleaseInfo, String> {
    update::latest_release().await
}

/// 바꾸기 from GitHub: the json is read again (so the zip matches what is latest now), the zip must have its size
/// and sha256, then the same check-and-swap as `install_update`.
#[tauri::command]
async fn install_release(app: AppHandle, build: u64) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|_| "앱이 있는 곳을 찾지 못했어요.".to_string())?;
    let dest = update::running_bundle(&exe).ok_or_else(|| "개발 중인 앱은 이렇게 바꿀 수 없어요.".to_string())?;
    let (info, zip) = update::download_release(build).await?;
    let ready = tauri::async_runtime::spawn_blocking(move || update::prepare(&zip, &info.sha256, dest)).await.map_err(|_| "새 버전을 확인하지 못했어요.".to_string())??;
    update::hand_over(&ready)?;
    let quit = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        quit.exit(0);
    });
    Ok(())
}

const DICTATION_CANCELLED: &str = "받아쓰기를 그만뒀어요.";
static DICTATION_CANCEL: std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>> = std::sync::Mutex::new(None);

/// Runs the dictation request until it ends or `cancel_dictation` is called (dropping it closes the connection).
/// A new dictation replaces, and so cancels, an older one still waiting.
async fn cancellable_dictation<T>(call: impl std::future::Future<Output = T>) -> Result<T, &'static str> {
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    if let Ok(mut slot) = DICTATION_CANCEL.lock() {
        *slot = Some(tx);
    }
    tokio::select! {
        r = call => Ok(r),
        _ = rx => Err(DICTATION_CANCELLED),
    }
}

#[tauri::command]
fn cancel_dictation() {
    if let Some(tx) = DICTATION_CANCEL.lock().ok().and_then(|mut s| s.take()) {
        let _ = tx.send(());
    }
}

/// `files/<id>` bytes (attachments, bot pictures) — the webview turns them into a blob URL (§7.5).
#[tauri::command]
async fn get_file(state: State<'_, AppState>, path: String) -> Result<Response, String> {
    if !path.starts_with("files/") || !is_safe_path(&path) {
        return Err("잘못된 요청이에요.".into());
    }
    let reply = state.conn.call("GET", &path, &HashMap::new(), &[], None).await.map_err(|e| e.words())?;
    if reply.status != 200 {
        return Err(format!("파일을 받지 못했어요 ({}).", reply.status));
    }
    Ok(Response::new(reply.bytes))
}

/// The owner clicked an https link in a message. Never called on its own (§6: links are not opened automatically).
#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| "주소가 이상해요.".to_string())?;
    if parsed.scheme() != "https" {
        return Err("https 주소만 열 수 있어요.".into());
    }
    std::process::Command::new("/usr/bin/open").arg(parsed.as_str()).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// §19: fetch `files/<id>` and save it to ~/Downloads (never overwriting). "gone" = the Mac deleted it (24h).
#[tauri::command]
async fn save_file(state: State<'_, AppState>, path: String, name: String) -> Result<Saved, String> {
    if !path.starts_with("files/") || !is_safe_path(&path) {
        return Err("잘못된 요청이에요.".into());
    }
    let reply = state.conn.call("GET", &path, &HashMap::new(), &[], None).await.map_err(|e| e.words())?;
    if reply.status == 404 || reply.status == 410 {
        return Err("gone".into());
    }
    if reply.status != 200 {
        return Err(format!("파일을 받지 못했어요 ({}).", reply.status));
    }
    let dir = files::downloads_dir().ok_or("다운로드 폴더를 찾지 못했어요.")?;
    let file = files::free_path(&dir, &files::safe_name(&name));
    std::fs::write(&file, &reply.bytes).map_err(|_| "다운로드 폴더에 저장하지 못했어요.".to_string())?;
    state.saved.lock().unwrap().insert(file.clone());
    Ok(Saved { path: file.display().to_string(), name: file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default() })
}

fn saved_file(state: &State<'_, AppState>, path: &str) -> Result<std::path::PathBuf, String> {
    let p = std::path::PathBuf::from(path);
    if state.saved.lock().unwrap().contains(&p) && p.exists() { Ok(p) } else { Err("이 앱이 받은 파일만 열 수 있어요.".into()) }
}

/// Quick Look preview (shows, never runs the file).
#[tauri::command]
fn preview_file(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let p = saved_file(&state, &path)?;
    std::process::Command::new("/usr/bin/qlmanage").arg("-p").arg(&p)
        .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
        .spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Finder, with the file selected.
#[tauri::command]
fn reveal_file(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let p = saved_file(&state, &path)?;
    std::process::Command::new("/usr/bin/open").arg("-R").arg(&p).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Open 결재 count → Dock badge and the number next to the menu bar icon.
#[tauri::command]
fn set_attention(app: AppHandle, count: u32) {
    attention::set_count(&app, count);
}

/// A Mac notification (the webview decides when: window not focused, rate-limited).
#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    // The 결재 context is a sentence or two the owner should read whole; macOS shows more when the banner opens.
    attention::notify(&app, &attention::clean(&title, 80), &attention::clean(&body, 1000))
}

/// §22: open the browser-live picture stream while that screen is shown.
#[tauri::command]
async fn live_start(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.live.start(app, state.conn.clone()).await;
    Ok(())
}

/// §22 fallback when the stream keeps failing: one picture (`GET browser-live/frame`, JPEG). "gone" = no page open.
#[tauri::command]
async fn live_frame(state: State<'_, AppState>) -> Result<Response, String> {
    let reply = state.conn.call("GET", "browser-live/frame", &HashMap::new(), &[], None).await.map_err(|e| e.words())?;
    if reply.status == 404 {
        return Err("gone".into());
    }
    if reply.status != 200 {
        return Err(format!("화면을 받지 못했어요 ({}).", reply.status));
    }
    Ok(Response::new(reply.bytes))
}

#[tauri::command]
async fn live_stop(state: State<'_, AppState>) -> Result<(), String> {
    state.live.stop().await;
    Ok(())
}

#[tauri::command]
async fn stream_start(app: AppHandle, state: State<'_, AppState>, after: u64, reset: Option<bool>) -> Result<(), String> {
    state.streamer.start(app, state.conn.clone(), after, reset == Some(true)).await;
    Ok(())
}

/// Focus, waking from sleep, a network change: retry or restart the stream now.
#[tauri::command]
async fn stream_nudge(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.streamer.nudge(app, state.conn.clone()).await;
    Ok(())
}

/// The widget window: share the stream the main window keeps open (start it only if none runs).
#[tauri::command]
async fn stream_ensure(app: AppHandle, state: State<'_, AppState>, after: u64) -> Result<(), String> {
    state.streamer.ensure(app, state.conn.clone(), after).await;
    Ok(())
}

/// "고정": the widget stays on top on every Space and no longer hides when it loses focus.
#[tauri::command]
fn widget_pin(app: AppHandle, pinned: bool) {
    widget::set_pinned(&app, pinned);
}

#[tauri::command]
fn widget_hide(app: AppHandle) {
    widget::hide(&app);
}

/// Screens the widget may open in the main window.
const WIDGET_SECTIONS: &[&str] = &["home", "approvals", "calendar", "work"];

/// A line in the widget was clicked: bring the main window up on that screen.
#[tauri::command]
fn widget_open_main(app: AppHandle, section: Option<String>) -> Result<(), String> {
    attention::show_main(&app);
    if let Some(s) = section {
        let Some(known) = WIDGET_SECTIONS.iter().find(|k| **k == s) else { return Err("잘못된 요청이에요.".into()) };
        let _ = app.emit_to("main", "ax://navigate", attention::Navigate { section: known });
    }
    if !widget::pinned(&app) {
        widget::hide(&app);
    }
    Ok(())
}

#[tauri::command]
async fn stream_stop(state: State<'_, AppState>) -> Result<(), String> {
    state.streamer.stop().await;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = Arc::new(Connection::new());
    let start = conn.clone();
    let streamer = Arc::new(Streamer::default());
    let (ready_tx, ready_rx) = tokio::sync::watch::channel(false);
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        // The page may use the microphone (meeting recording, 녹음과 회의록); macOS still asks the owner once.
        // Camera and everything else: no.
        .on_permission_request(|_webview, kind| match kind {
            tauri::webview::PermissionKind::Microphone => tauri::webview::PermissionResponse::Allow,
            _ => tauri::webview::PermissionResponse::Deny,
        })
        .manage(widget::WidgetState::default())
        .manage(AppState { conn, streamer: streamer.clone(), ready: ready_rx, saved: Default::default(), live: Default::default() })
        .on_window_event(|window, event| {
            // Closing hides the window: the stream, badge and notifications keep working. ⌘Q quits.
            match event {
                WindowEvent::CloseRequested { api, .. } if window.label() == "main" || window.label() == widget::LABEL => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                WindowEvent::Focused(false) if window.label() == widget::LABEL => widget::blurred(window.app_handle()),
                _ => {}
            }
        })
        .setup(move |app| {
            if let Err(e) = attention::build_tray(app.handle()) {
                eprintln!("tray: {e}");
            }
            if let Err(e) = widget::build(app.handle()) {
                eprintln!("widget: {e}");
            }
            // Development: `AXKIT_DEV_MOCK=http://127.0.0.1:47790 npm run tauri dev` talks to the mock Mac.
            let mock = if cfg!(debug_assertions) { std::env::var("AXKIT_DEV_MOCK").ok().filter(|s| !s.is_empty()) } else { None };
            // Not on the main thread: reading the Keychain may wait for the owner to answer its dialog.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match mock {
                    Some(base) => {
                        if let Err(e) = start.use_mock(&base).await {
                            eprintln!("mock: {e}");
                            start.use_token_file().await;
                        }
                    }
                    None => {
                        start.start().await;
                    }
                }
                let _ = ready_tx.send(true);
                // A paired Mac: a new token every 80 days. Checked now and once a day; the stream reopens with it.
                loop {
                    if start.rotate_if_due().await {
                        streamer.restart(handle.clone(), start.clone()).await;
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(24 * 3600)).await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![connection, reconnect, use_mock, use_local, api, upload, get_file, open_link, set_attention, notify, save_file, preview_file, reveal_file, live_start, live_stop, live_frame, stream_start, stream_stop, stream_ensure, stream_nudge, widget_pin, widget_hide, widget_open_main, pair_remote, forget_remote, take_pair_link, cancel_dictation, install_update, check_release, install_release])
        .build(tauri::generate_context!())
        .expect("error while building ax-kit")
        .run(|app, event| match event {
            // Clicking the Dock icon brings a hidden window back.
            tauri::RunEvent::Reopen { .. } => attention::show_main(app),
            // `open 'axkit://pair?…'`: at launch or while running (macOS sends it to the running app).
            tauri::RunEvent::Opened { urls } => opened_urls(app, &urls),
            _ => {}
        });
}

#[cfg(test)]
mod upload_tests {
    #[tokio::test]
    async fn cancelling_dictation_stops_the_request() {
        let waiting = tokio::spawn(super::cancellable_dictation(std::future::pending::<()>()));
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        super::cancel_dictation();
        let r = tokio::time::timeout(std::time::Duration::from_secs(1), waiting).await.expect("stopped").unwrap();
        assert_eq!(r, Err(super::DICTATION_CANCELLED));
        assert_eq!(super::cancellable_dictation(async { 7 }).await, Ok(7));
    }

    #[test]
    fn upload_sends_the_real_content_type() {
        let h = super::upload_headers(|k| match k {
            "x-content-type" => Some("audio/mp4".into()),
            "content-type" => Some("application/octet-stream".into()),
            "x-file-name" => Some("a.m4a".into()),
            _ => None,
        });
        assert!(h.contains(&("content-type".into(), "audio/mp4".into())));
        assert!(h.contains(&("x-file-name".into(), "a.m4a".into())));
        assert_eq!(h.iter().filter(|(k, _)| k == "content-type").count(), 1);
        let none = super::upload_headers(|_| None);
        assert_eq!(none, vec![("content-type".to_string(), "application/octet-stream".to_string())]);
    }
}
