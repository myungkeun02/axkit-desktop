//! `GET stream` (SSE) kept open in Rust, so the token never reaches the webview.
//! Events go to the window as `ax://event` (raw JSON text); connection changes as `ax://stream`.
//! Reconnects with `Last-Event-ID` = the newest seq seen, backing off from 2 s to 60 s (§3.1).

use crate::conn::Connection;
use crate::sse::SseParser;
use futures_util::StreamExt;
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, Notify};
use tokio::task::JoinHandle;

/// Keepalives come every 25 s; no bytes for this long means the connection is dead.
const SILENCE: Duration = Duration::from_secs(40);
/// A nudge (focus, wake, network change) restarts a stream that has been quiet this long.
const QUIET: Duration = Duration::from_secs(30);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StreamState {
    /// "connecting" | "live" | "waiting" | "unauthorized" | "stopped"
    pub state: &'static str,
    pub retry_in_sec: Option<u64>,
}

#[derive(Serialize, Clone)]
pub struct StreamEvent {
    pub data: String,
}

/// One stream for the whole app (main window and widget). Every change to the task happens under `task`'s lock,
/// so two windows asking at once can never leave two streams running.
#[derive(Default)]
pub struct Streamer {
    task: Mutex<Option<JoinHandle<()>>>,
    last_seq: Arc<AtomicU64>,
    /// Unix ms of the last bytes from the server.
    last_bytes: Arc<AtomicU64>,
    /// Wakes a stream that is waiting to retry.
    kick: Arc<Notify>,
}

pub fn next_backoff(current: u64) -> u64 {
    (current * 2).clamp(2, 60)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

impl Streamer {
    /// (Re)open the stream from `after`; `reset` = the webview started over (a server whose log restarted), so the
    /// newest seq may go down.
    pub async fn start(&self, app: AppHandle, conn: Arc<Connection>, after: u64, reset: bool) {
        let mut task = self.task.lock().await;
        if let Some(h) = task.take() {
            h.abort();
        }
        if reset {
            self.last_seq.store(after, Ordering::SeqCst);
        } else {
            self.last_seq.fetch_max(after, Ordering::SeqCst);
        }
        *task = Some(self.spawn(app, conn));
    }

    fn spawn(&self, app: AppHandle, conn: Arc<Connection>) -> JoinHandle<()> {
        let (last, bytes, kick) = (self.last_seq.clone(), self.last_bytes.clone(), self.kick.clone());
        bytes.store(now_ms(), Ordering::SeqCst);
        tokio::spawn(async move { run(app, conn, last, bytes, kick).await })
    }

    /// The widget window: open the stream only if nothing keeps it open yet, else tell everyone where it stands.
    pub async fn ensure(&self, app: AppHandle, conn: Arc<Connection>, after: u64) {
        let mut task = self.task.lock().await;
        if task.as_ref().is_some_and(|h| !h.is_finished()) {
            let (state, retry) = *LAST.lock().unwrap();
            let _ = app.emit("ax://stream", StreamState { state, retry_in_sec: retry });
        } else {
            self.last_seq.fetch_max(after, Ordering::SeqCst);
            *task = Some(self.spawn(app, conn));
        }
    }

    /// Focus, waking from sleep, a network change: retry now instead of after the backoff, and restart a stream
    /// that has been quiet longer than a keepalive (a dead socket after sleep looks open).
    pub async fn nudge(&self, app: AppHandle, conn: Arc<Connection>) {
        let mut task = self.task.lock().await;
        let running = task.as_ref().is_some_and(|h| !h.is_finished());
        if !running {
            return; // never started (or stopped on purpose): the webview starts it
        }
        let (state, _) = *LAST.lock().unwrap();
        let quiet = now_ms().saturating_sub(self.last_bytes.load(Ordering::SeqCst)) > QUIET.as_millis() as u64;
        if state == "live" && quiet {
            if let Some(h) = task.take() {
                h.abort();
            }
            *task = Some(self.spawn(app, conn));
        } else if state != "live" {
            self.kick.notify_one();
        }
    }

    /// Reopen a running stream (new token after a rotation), keeping where it was.
    pub async fn restart(&self, app: AppHandle, conn: Arc<Connection>) {
        let mut task = self.task.lock().await;
        if let Some(h) = task.take() {
            h.abort();
            *task = Some(self.spawn(app, conn));
        }
    }

    pub async fn stop(&self) {
        if let Some(h) = self.task.lock().await.take() {
            h.abort();
        }
    }
}

/// The newest state sent, so a window opened later can be told.
static LAST: std::sync::Mutex<(&'static str, Option<u64>)> = std::sync::Mutex::new(("connecting", None));

fn emit_state(app: &AppHandle, state: &'static str, retry: Option<u64>) {
    *LAST.lock().unwrap() = (state, retry);
    let _ = app.emit("ax://stream", StreamState { state, retry_in_sec: retry });
}

/// Sleep, unless nudged.
async fn pause(secs: u64, kick: &Notify) {
    tokio::select! {
        _ = tokio::time::sleep(Duration::from_secs(secs)) => {}
        _ = kick.notified() => {}
    }
}

async fn run(app: AppHandle, conn: Arc<Connection>, last: Arc<AtomicU64>, bytes: Arc<AtomicU64>, kick: Arc<Notify>) {
    let mut backoff = 0u64;
    loop {
        emit_state(&app, "connecting", None);
        let (outcome, was_live) = once(&app, &conn, &last, &bytes).await;
        // A stream that was live and then dropped (sleep, Wi-Fi) tries again soon, not after the last long wait.
        if was_live {
            backoff = 0;
        }
        match outcome {
            Outcome::Ended | Outcome::Failed => {}
            Outcome::Unauthorized => {
                if conn.refresh_after_401().await {
                    continue;
                }
                conn.mark_unauthorized().await;
                emit_state(&app, "unauthorized", Some(10));
                // The server rewrites the token file when it restarts; look again in a while.
                pause(10, &kick).await;
                let _ = conn.refresh_after_401().await;
                continue;
            }
        }
        backoff = next_backoff(backoff);
        emit_state(&app, "waiting", Some(backoff));
        pause(backoff, &kick).await;
        if conn.credentials().await.is_none() {
            let _ = conn.refresh_after_401().await;
        }
    }
}

enum Outcome {
    /// Was live, then the server closed it.
    Ended,
    Failed,
    Unauthorized,
}

async fn once(app: &AppHandle, conn: &Connection, last: &AtomicU64, bytes: &AtomicU64) -> (Outcome, bool) {
    let Some(creds) = conn.credentials().await else { return (Outcome::Failed, false) };
    let Ok(url) = creds.base.join("m/v1/app/stream") else { return (Outcome::Failed, false) };
    let seq = last.load(Ordering::SeqCst);
    let res = conn
        .stream_http
        .get(url)
        .bearer_auth(&creds.token)
        .header("Accept", "text/event-stream")
        .header("Last-Event-ID", seq.to_string())
        .send()
        .await;
    let Ok(res) = res else { return (Outcome::Failed, false) };
    if res.status().as_u16() == 401 {
        return (Outcome::Unauthorized, false);
    }
    if !res.status().is_success() {
        return (Outcome::Failed, false);
    }
    emit_state(app, "live", None);
    bytes.store(now_ms(), Ordering::SeqCst);
    let mut parser = SseParser::new();
    let mut body = res.bytes_stream();
    loop {
        match tokio::time::timeout(SILENCE, body.next()).await {
            Ok(Some(Ok(chunk))) => {
                bytes.store(now_ms(), Ordering::SeqCst);
                for ev in parser.push(&chunk) {
                    if let Some(id) = ev.id.as_deref().and_then(|i| i.parse::<u64>().ok()) {
                        last.fetch_max(id, Ordering::SeqCst);
                    }
                    let _ = app.emit("ax://event", StreamEvent { data: ev.data });
                }
            }
            Ok(Some(Err(_))) | Err(_) => return (Outcome::Failed, true),
            Ok(None) => return (Outcome::Ended, true),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::next_backoff;

    #[test]
    fn backoff_doubles_from_two_to_sixty() {
        let mut b = 0;
        let mut seen = vec![];
        for _ in 0..8 {
            b = next_backoff(b);
            seen.push(b);
        }
        assert_eq!(seen, vec![2, 4, 8, 16, 32, 60, 60, 60]);
    }
}
