//! Where the app connects and with which token. The token stays here; the webview only gets `Info`.

use crate::remote::{self, PairCode, Vault};
use crate::token::{self, Credentials};
use reqwest::StatusCode;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::RwLock;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Source {
    /// The normal case: the ax-kit server on this Mac, via its token file.
    TokenFile(PathBuf),
    /// Development only: the iOS repo's mock Mac (paired with its fixed dev code).
    Mock(String),
    /// The ax-kit server on another Mac (Tailscale), paired once; the token is in the Keychain.
    Remote,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    /// "local" | "mock" | "remote"
    pub mode: &'static str,
    pub connected: bool,
    /// "127.0.0.1:47617"
    pub host: Option<String>,
    /// Plain Korean when not connected.
    pub problem: Option<String>,
    /// The token file path we read (for the settings screen).
    pub token_file: Option<String>,
    /// Whether this build can talk to the dev mock.
    pub dev_build: bool,
    /// Remote: the name the other Mac gave this device ("작업용 맥북").
    pub device_name: Option<String>,
    /// Whether this Mac has its own ax-kit (a token file exists), so the first screen can say so.
    pub local_available: bool,
}

pub struct Connection {
    source: RwLock<Option<Source>>,
    creds: RwLock<Option<Credentials>>,
    problem: RwLock<Option<String>>,
    vault: Box<dyn Vault>,
    /// The Keychain is read once (each read can ask the owner after an update); later reads use this.
    saved: RwLock<Option<remote::Saved>>,
    device_name: RwLock<Option<String>>,
    pub http: reqwest::Client,
    pub stream_http: reqwest::Client,
}

#[derive(Debug)]
pub enum CallError {
    NotConnected(String),
    Offline,
}

impl CallError {
    pub fn words(&self) -> String {
        match self {
            CallError::NotConnected(why) => why.clone(),
            CallError::Offline => "맥의 ax-kit에 닿지 않아요. ax-kit가 켜져 있는지 확인해 주세요.".into(),
        }
    }
}

pub struct Reply {
    pub status: u16,
    pub bytes: Vec<u8>,
}

impl Connection {
    pub fn new() -> Self {
        Self::with_vault(Box::new(remote::Keychain))
    }

    pub fn with_vault(vault: Box<dyn Vault>) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(25))
            .connect_timeout(Duration::from_secs(5))
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("http client");
        let stream_http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("stream client");
        Self { source: RwLock::new(None), creds: RwLock::new(None), problem: RwLock::new(None), vault, saved: RwLock::new(None), device_name: RwLock::new(None), http, stream_http }
    }

    pub async fn source(&self) -> Option<Source> {
        self.source.read().await.clone()
    }

    pub async fn credentials(&self) -> Option<Credentials> {
        self.creds.read().await.clone()
    }

    pub async fn info(&self) -> Info {
        let source = self.source().await;
        let creds = self.credentials().await;
        Info {
            mode: match source {
                Some(Source::Mock(_)) => "mock",
                Some(Source::Remote) => "remote",
                _ => "local",
            },
            connected: creds.is_some(),
            host: creds.as_ref().map(|c| c.display_host()),
            problem: self.problem.read().await.clone(),
            token_file: match &source {
                Some(Source::TokenFile(p)) => Some(p.display().to_string()),
                _ => token::default_path().map(|p| p.display().to_string()),
            },
            dev_build: cfg!(debug_assertions),
            device_name: if source == Some(Source::Remote) { self.device_name.read().await.clone() } else { None },
            local_available: token::default_path().is_some_and(|p| p.exists()),
        }
    }

    /// At start: the other Mac when one was paired, else this Mac's token file. A Keychain that says no is shown,
    /// not quietly replaced by this Mac.
    pub async fn start(&self) -> Info {
        match self.load_saved().await {
            Ok(Some(_)) => self.apply_remote().await,
            Ok(None) => self.use_token_file().await,
            Err(e) => self.remote_problem(e).await,
        }
    }

    async fn load_saved(&self) -> Result<Option<remote::Saved>, String> {
        let s = self.vault.load()?;
        *self.saved.write().await = s.clone();
        Ok(s)
    }

    async fn remote_problem(&self, words: String) -> Info {
        *self.source.write().await = Some(Source::Remote);
        *self.creds.write().await = None;
        *self.problem.write().await = Some(words);
        self.info().await
    }

    /// "다시 연결": the paired Mac (reads the Keychain again only if it said no before).
    pub async fn use_remote(&self) -> Info {
        if self.saved.read().await.is_none() {
            if let Err(e) = self.load_saved().await {
                return self.remote_problem(e).await;
            }
        }
        self.apply_remote().await
    }

    async fn apply_remote(&self) -> Info {
        *self.source.write().await = Some(Source::Remote);
        let saved = self.saved.read().await.clone();
        match saved.and_then(|s| Some((remote::allowed_base(&s.base_url).ok()?, s))) {
            Some((base, s)) => {
                *self.creds.write().await = Some(Credentials { base, token: s.token });
                *self.device_name.write().await = Some(s.device_name).filter(|n| !n.is_empty());
                *self.problem.write().await = None;
            }
            None => {
                *self.creds.write().await = None;
                *self.problem.write().await = Some("저장된 연결이 없어요. 다른 맥에서 짝 맞추기를 다시 해 주세요.".into());
            }
        }
        self.info().await
    }

    /// Pair with the other Mac (the code is used once), keep the token in the Keychain, and switch to it.
    pub async fn pair_remote(&self, code: &PairCode) -> Result<Info, String> {
        let saved = remote::pair(&self.http, code).await?;
        self.vault.save(&saved)?;
        *self.saved.write().await = Some(saved);
        Ok(self.apply_remote().await)
    }

    /// "이 맥의 비서로 바꾸기": tell the other Mac to drop this device (best effort), forget it, use this Mac.
    pub async fn forget_remote(&self) -> Info {
        if let Some(s) = self.saved.read().await.clone() {
            if let Some(url) = remote::allowed_base(&s.base_url).ok().and_then(|b| b.join("m/v1/app/unpair").ok()) {
                let _ = self.http.post(url).bearer_auth(&s.token).timeout(Duration::from_secs(5)).send().await;
            }
        }
        self.vault.forget();
        *self.saved.write().await = None;
        *self.device_name.write().await = None;
        self.use_token_file().await
    }

    /// §2: a new token every 80 days (the old one keeps working for 7 days on the server). Returns true when it changed,
    /// so the stream can reopen with the new one.
    pub async fn rotate_if_due(&self) -> bool {
        if self.source().await != Some(Source::Remote) {
            return false;
        }
        let Some(mut s) = self.saved.read().await.clone() else { return false };
        if remote::now_secs().saturating_sub(s.rotated_at) < remote::ROTATE_AFTER_SECS {
            return false;
        }
        let Ok(reply) = self.call("POST", "rotate", &HashMap::new(), &[], None).await else { return false };
        if reply.status != 200 {
            return false;
        }
        let token = serde_json::from_slice::<serde_json::Value>(&reply.bytes).ok().and_then(|v| v.get("token")?.as_str().map(str::to_string));
        let Some(token) = token.filter(|t| !t.trim().is_empty() && !t.contains(char::is_whitespace)) else { return false };
        s.token = token;
        s.rotated_at = remote::now_secs();
        if self.vault.save(&s).is_err() {
            return false;
        }
        *self.saved.write().await = Some(s);
        self.apply_remote().await;
        true
    }

    /// Use the token file (again). Called at start, by "다시 연결" and after a 401.
    pub async fn use_token_file(&self) -> Info {
        self.use_token_file_at(token::default_path()).await
    }

    pub async fn use_token_file_at(&self, path: Option<PathBuf>) -> Info {
        let Some(path) = path else {
            *self.problem.write().await = Some("홈 폴더를 찾지 못했어요.".into());
            return self.info().await;
        };
        *self.source.write().await = Some(Source::TokenFile(path.clone()));
        self.reload_token_file(&path).await;
        self.info().await
    }

    async fn reload_token_file(&self, path: &PathBuf) -> bool {
        match token::read(path) {
            Ok(c) => {
                let changed = self.creds.read().await.as_ref() != Some(&c);
                *self.creds.write().await = Some(c);
                *self.problem.write().await = None;
                changed
            }
            Err(e) => {
                *self.creds.write().await = None;
                *self.problem.write().await = Some(e.words().to_string());
                false
            }
        }
    }

    /// Development: pair with the mock Mac (`node ../ax-kit-ios/dev/mock-server.mjs`, nonce `dev`, code `123456`).
    pub async fn use_mock(&self, base: &str) -> Result<Info, String> {
        if !cfg!(debug_assertions) {
            return Err("개발용 빌드에서만 쓸 수 있어요.".into());
        }
        let url = token::normalize_base(base).filter(token::is_loopback).ok_or("가짜 맥 주소는 이 맥(127.0.0.1)이어야 해요.")?;
        let pair = url.join("m/p/dev/app").map_err(|e| e.to_string())?;
        let res = self
            .http
            .post(pair)
            .json(&serde_json::json!({ "code": "123456" }))
            .send()
            .await
            .map_err(|_| "가짜 맥에 닿지 않아요. `npm run mock`을 먼저 켜 주세요.".to_string())?;
        let body: serde_json::Value = res.json().await.map_err(|_| "가짜 맥의 답을 읽지 못했어요.".to_string())?;
        let token = body.get("token").and_then(|t| t.as_str()).ok_or("가짜 맥이 토큰을 주지 않았어요.")?;
        *self.source.write().await = Some(Source::Mock(url.to_string()));
        *self.creds.write().await = Some(Credentials { base: url, token: token.to_string() });
        *self.problem.write().await = None;
        Ok(self.info().await)
    }

    /// After a 401 from the Mac: a restarted server wrote a new token. Returns true when the token changed.
    pub async fn refresh_after_401(&self) -> bool {
        match self.source().await {
            Some(Source::TokenFile(path)) => self.reload_token_file(&path).await,
            // Another Mac: no file to re-read; the token is good until the owner pairs again.
            Some(Source::Remote) => false,
            Some(Source::Mock(base)) => {
                let before = self.credentials().await;
                self.use_mock(&base).await.is_ok() && self.credentials().await != before
            }
            None => false,
        }
    }

    pub async fn mark_unauthorized(&self) {
        let words = if self.source().await == Some(Source::Remote) {
            "그 맥이 이 기기의 연결을 받지 않아요. 연결이 끊겼을 수 있어요. 그 맥에서 짝 맞추기를 다시 해 주세요."
        } else {
            "맥이 이 앱의 연결을 받지 않아요. ax-kit를 다시 켜 주세요."
        };
        *self.problem.write().await = Some(words.into());
    }

    /// One call to `{base}/m/v1/app/<path>`, retried once with a re-read token after a 401.
    pub async fn call(
        &self,
        method: &str,
        path: &str,
        query: &HashMap<String, String>,
        headers: &[(String, String)],
        body: Option<Vec<u8>>,
    ) -> Result<Reply, CallError> {
        for attempt in 0..2 {
            let creds = self.credentials().await.ok_or_else(|| {
                CallError::NotConnected("맥의 ax-kit에 아직 연결되지 않았어요.".into())
            })?;
            let mut url = creds.base.join(&format!("m/v1/app/{path}")).map_err(|_| CallError::NotConnected("주소가 이상해요.".into()))?;
            if !query.is_empty() {
                let mut pairs: Vec<_> = query.iter().collect();
                pairs.sort();
                url.query_pairs_mut().extend_pairs(pairs);
            }
            let method = reqwest::Method::from_bytes(method.as_bytes()).unwrap_or(reqwest::Method::GET);
            let mut req = self.http.request(method, url).bearer_auth(&creds.token);
            // §30: whisper.cpp on the Mac takes a while for a few minutes of speech.
            if path == "dictation" {
                req = req.timeout(Duration::from_secs(120));
            }
            // §32: a few MB of app over Tailscale.
            if path.starts_with("app-updates/") {
                req = req.timeout(Duration::from_secs(300));
            }
            for (k, v) in headers {
                req = req.header(k, v);
            }
            if let Some(b) = &body {
                req = req.body(b.clone());
            }
            let res = req.send().await.map_err(|_| CallError::Offline)?;
            let status = res.status();
            let bytes = res.bytes().await.map_err(|_| CallError::Offline)?.to_vec();
            if status == StatusCode::UNAUTHORIZED && attempt == 0 && self.refresh_after_401().await {
                continue;
            }
            if status == StatusCode::UNAUTHORIZED {
                self.mark_unauthorized().await;
            }
            return Ok(Reply { status: status.as_u16(), bytes });
        }
        unreachable!()
    }
}

/// App paths only: letters, digits and `_ - . : % /`, no `..`, no leading slash, no scheme.
pub fn is_safe_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 512
        && !path.starts_with('/')
        && !path.split('/').any(|seg| seg.is_empty() || seg == "." || seg == "..")
        && path.chars().all(|c| c.is_ascii_alphanumeric() || "_-.:%/".contains(c))
        && !path.contains("%2e%2e")
        && !path.to_ascii_lowercase().contains("%2f")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tiny loopback "server": 200 for the current token, 401 (JSON) for anything else.
    async fn fake_server(good: &'static str) -> u16 {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let (mut sock, _) = listener.accept().await.unwrap();
                let mut buf = vec![0u8; 4096];
                let n = sock.read(&mut buf).await.unwrap();
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let ok = req.lines().any(|l| l.eq_ignore_ascii_case(&format!("authorization: Bearer {good}")));
                let (status, body) = if ok { ("200 OK", r#"{"ok":true,"lastSeq":7}"#) } else { ("401 Unauthorized", r#"{"ok":false}"#) };
                let resp = format!("HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
                let _ = sock.write_all(resp.as_bytes()).await;
            }
        });
        port
    }

    #[tokio::test]
    async fn rereads_the_token_file_after_a_401() {
        let port = fake_server("new-token").await;
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("desktop.token");
        let write = |t: &str| std::fs::write(&file, format!(r#"{{"v":1,"baseUrl":"http://127.0.0.1:{port}","token":"{t}"}}"#)).unwrap();
        write("old-token");
        let conn = Connection::new();
        let info = conn.use_token_file_at(Some(file.clone())).await;
        assert!(info.connected);
        assert_eq!(info.host.as_deref(), Some(format!("127.0.0.1:{port}").as_str()));
        // The server restarted and wrote a new token: the call retries once with it.
        write("new-token");
        let reply = conn.call("GET", "status", &HashMap::new(), &[], None).await.unwrap();
        assert_eq!(reply.status, 200);
        // A file that changed but still holds a wrong token: the 401 comes back and the app says so.
        write("stale-1");
        let stale = Connection::new();
        stale.use_token_file_at(Some(file.clone())).await;
        write("stale-2");
        let reply = stale.call("GET", "status", &HashMap::new(), &[], None).await.unwrap();
        assert_eq!(reply.status, 401);
        assert!(stale.info().await.problem.is_some());
    }

    #[tokio::test]
    async fn no_file_means_not_connected() {
        let dir = tempfile::tempdir().unwrap();
        let conn = Connection::new();
        let info = conn.use_token_file_at(Some(dir.path().join("desktop.token"))).await;
        assert!(!info.connected);
        assert!(info.problem.unwrap().contains("켜지지"));
        assert!(conn.call("GET", "status", &HashMap::new(), &[], None).await.is_err());
    }

    #[tokio::test]
    async fn uses_the_paired_mac_and_forgets_it() {
        let port = fake_server("remote-token").await;
        let vault = remote::Memory::default();
        vault.save(&remote::Saved { v: 1, base_url: format!("http://127.0.0.1:{port}/"), token: "remote-token".into(), device_id: "d_1".into(), device_name: "작업용 맥북".into(), rotated_at: remote::now_secs() }).unwrap();
        let conn = Connection::with_vault(Box::new(vault));
        let info = conn.start().await;
        assert_eq!((info.mode, info.connected, info.device_name.as_deref()), ("remote", true, Some("작업용 맥북")));
        assert_eq!(conn.call("GET", "status", &HashMap::new(), &[], None).await.unwrap().status, 200);
        // A 401 from the other Mac: no file to re-read, the app says to pair again.
        assert!(!conn.refresh_after_401().await);
        conn.mark_unauthorized().await;
        assert!(conn.info().await.problem.unwrap().contains("짝 맞추기"));
        let info = conn.forget_remote().await;
        assert_eq!(info.mode, "local");
        assert!(conn.vault.load().unwrap().is_none());
    }

    #[test]
    fn safe_paths() {
        for ok in ["status", "views/calendar", "views/calendar/add", "cards/org%3Ad%3A1", "files/abc", "recordings/r_ab-1/chunks/0"] {
            assert!(is_safe_path(ok), "{ok}");
        }
        for bad in ["", "/status", "../m/p/x", "views/../../x", "views//x", "http://evil", "views/a?b=c", "a%2F..%2Fb", "x y"] {
            assert!(!is_safe_path(bad), "{bad}");
        }
    }
}
