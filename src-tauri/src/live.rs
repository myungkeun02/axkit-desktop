//! §22 browser-live: the picture of the page the owner takes over. `GET browser-live/stream` (SSE `state` / `frame`,
//! frames are base64 JPEG) is opened here with the token and passed to the window as `ax://live` {event, data}.
//! Only while the screen is open (the server allows 3 streams per device). Reconnects with a short backoff.

use crate::conn::Connection;
use crate::sse::SseParser;
use futures_util::StreamExt;
use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

#[derive(Serialize, Clone)]
pub struct LiveEvent {
    /// "state" | "frame" | "connection" (data "live" | "waiting" | "unauthorized")
    pub event: String,
    pub data: String,
}

#[derive(Default)]
pub struct LiveStreamer {
    task: Mutex<Option<JoinHandle<()>>>,
}

fn emit(app: &AppHandle, event: &str, data: &str) {
    let _ = app.emit("ax://live", LiveEvent { event: event.into(), data: data.into() });
}

impl LiveStreamer {
    pub async fn start(&self, app: AppHandle, conn: Arc<Connection>) {
        self.stop().await;
        let handle = tokio::spawn(async move {
            let mut backoff = 1u64;
            loop {
                match once(&app, &conn).await {
                    Ok(()) => backoff = 1,
                    Err(401) => {
                        if !conn.refresh_after_401().await {
                            emit(&app, "connection", "unauthorized");
                        }
                    }
                    Err(_) => {}
                }
                emit(&app, "connection", "waiting");
                tokio::time::sleep(Duration::from_secs(backoff)).await;
                backoff = (backoff * 2).min(10);
            }
        });
        *self.task.lock().await = Some(handle);
    }

    pub async fn stop(&self) {
        if let Some(h) = self.task.lock().await.take() {
            h.abort();
        }
    }
}

async fn once(app: &AppHandle, conn: &Connection) -> Result<(), u16> {
    let creds = conn.credentials().await.ok_or(0u16)?;
    let url = creds.base.join("m/v1/app/browser-live/stream").map_err(|_| 0u16)?;
    let res = conn.stream_http.get(url).bearer_auth(&creds.token).header("Accept", "text/event-stream").send().await.map_err(|_| 0u16)?;
    let status = res.status().as_u16();
    if status != 200 {
        return Err(status);
    }
    emit(app, "connection", "live");
    let mut parser = SseParser::new();
    let mut body = res.bytes_stream();
    loop {
        match tokio::time::timeout(Duration::from_secs(70), body.next()).await {
            Ok(Some(Ok(chunk))) => {
                for ev in parser.push(&chunk) {
                    emit(app, ev.event.as_deref().unwrap_or("message"), &ev.data);
                }
            }
            Ok(None) => return Ok(()),
            _ => return Err(0),
        }
    }
}
