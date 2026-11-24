//! The Mac-local token file (ax-kit `docs/APP-PROTOCOL.md` §1).
//!
//! ax-kit writes `~/.ax-kit/desktop.token` every time the server starts:
//! `{"v":1,"baseUrl":"http://127.0.0.1:47617","token":"…","issuedAt":"…"}`.
//! The token only works from loopback, so we refuse any other address. The token never leaves this process
//! (the webview only ever sees the host name).

use serde::Deserialize;
use std::path::{Path, PathBuf};
use url::{Host, Url};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Credentials {
    pub base: Url,
    pub token: String,
}

impl Credentials {
    /// "127.0.0.1:47617" — safe to show.
    pub fn display_host(&self) -> String {
        match (self.base.host_str(), self.base.port()) {
            (Some(h), Some(p)) => format!("{h}:{p}"),
            (Some(h), None) => h.to_string(),
            _ => self.base.to_string(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenFile {
    v: Option<u32>,
    base_url: String,
    token: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum TokenError {
    /// No file: the ax-kit server has not run on this Mac yet (or is another user's).
    Missing,
    Unreadable,
    /// Not JSON, an unknown version, or an empty token.
    Malformed,
    /// The file names an address that is not this Mac.
    NotLoopback,
}

impl TokenError {
    /// Plain Korean for the screen.
    pub fn words(&self) -> &'static str {
        match self {
            TokenError::Missing => "맥의 ax-kit가 아직 켜지지 않았어요. ax-kit를 켜면 바로 붙어요.",
            TokenError::Unreadable => "연결 파일을 읽지 못했어요. 파일 권한을 확인해 주세요.",
            TokenError::Malformed => "연결 파일 내용이 이상해요. ax-kit를 다시 켜 주세요.",
            TokenError::NotLoopback => "연결 파일의 주소가 이 맥이 아니에요. 안전을 위해 붙지 않았어요.",
        }
    }
}

/// `~/.ax-kit/desktop.token`, or `AXKIT_TOKEN_FILE` when set. A Mac that runs ax-hq instead of ax-kit writes the same
/// file under `~/.ax-hq/`; it is used when there is no ax-kit one.
pub fn default_path() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("AXKIT_TOKEN_FILE") {
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    let home = dirs::home_dir()?;
    let kit = home.join(".ax-kit").join("desktop.token");
    let hq = home.join(".ax-hq").join("desktop.token");
    Some(if !kit.exists() && hq.exists() { hq } else { kit })
}

/// Only this Mac: 127.0.0.0/8, ::1 or localhost, over http or https.
pub fn is_loopback(url: &Url) -> bool {
    if url.scheme() != "http" && url.scheme() != "https" {
        return false;
    }
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    match url.host() {
        Some(Host::Ipv4(ip)) => ip.is_loopback(),
        Some(Host::Ipv6(ip)) => ip.is_loopback(),
        Some(Host::Domain(d)) => d.eq_ignore_ascii_case("localhost"),
        None => false,
    }
}

/// Base URL with a trailing slash so `join("m/v1/app/…")` keeps any path prefix.
pub fn normalize_base(raw: &str) -> Option<Url> {
    let mut url = Url::parse(raw.trim()).ok()?;
    url.set_query(None);
    url.set_fragment(None);
    if !url.path().ends_with('/') {
        let p = format!("{}/", url.path());
        url.set_path(&p);
    }
    Some(url)
}

pub fn parse(text: &str) -> Result<Credentials, TokenError> {
    let file: TokenFile = serde_json::from_str(text).map_err(|_| TokenError::Malformed)?;
    if let Some(v) = file.v {
        if v != 1 {
            return Err(TokenError::Malformed);
        }
    }
    let token = file.token.trim().to_string();
    if token.is_empty() || token.chars().any(|c| c.is_control() || c == ' ') {
        return Err(TokenError::Malformed);
    }
    let base = normalize_base(&file.base_url).ok_or(TokenError::Malformed)?;
    if !is_loopback(&base) {
        return Err(TokenError::NotLoopback);
    }
    Ok(Credentials { base, token })
}

pub fn read(path: &Path) -> Result<Credentials, TokenError> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(TokenError::Missing),
        Err(_) => return Err(TokenError::Unreadable),
    };
    parse(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_good_file() {
        let c = parse(r#"{"v":1,"baseUrl":"http://127.0.0.1:47617","token":"abc123","issuedAt":"2026-11-19T00:00:00Z"}"#).unwrap();
        assert_eq!(c.base.as_str(), "http://127.0.0.1:47617/");
        assert_eq!(c.token, "abc123");
        assert_eq!(c.display_host(), "127.0.0.1:47617");
        assert_eq!(c.base.join("m/v1/app/status").unwrap().as_str(), "http://127.0.0.1:47617/m/v1/app/status");
    }

    #[test]
    fn accepts_ipv6_and_localhost() {
        assert!(parse(r#"{"baseUrl":"http://[::1]:47617","token":"t"}"#).is_ok());
        assert!(parse(r#"{"baseUrl":"http://localhost:47617","token":"t"}"#).is_ok());
    }

    #[test]
    fn refuses_other_hosts() {
        for base in ["http://192.168.0.2:47617", "https://mac.ts.net", "http://100.64.0.1:47617", "http://127.0.0.1.evil.com", "file:///etc/passwd", "http://user:pw@127.0.0.1:1"] {
            let json = format!(r#"{{"v":1,"baseUrl":"{base}","token":"t"}}"#);
            assert!(parse(&json).is_err(), "{base} should be refused");
        }
    }

    #[test]
    fn refuses_bad_shapes() {
        assert_eq!(parse("nope"), Err(TokenError::Malformed));
        assert_eq!(parse(r#"{"v":2,"baseUrl":"http://127.0.0.1:1","token":"t"}"#), Err(TokenError::Malformed));
        assert_eq!(parse(r#"{"v":1,"baseUrl":"http://127.0.0.1:1","token":"  "}"#), Err(TokenError::Malformed));
        assert_eq!(parse(r#"{"v":1,"baseUrl":"http://127.0.0.1:1","token":"a\nb"}"#), Err(TokenError::Malformed));
    }

    #[test]
    fn missing_file_is_its_own_case() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read(&dir.path().join("desktop.token")), Err(TokenError::Missing));
        std::fs::write(dir.path().join("desktop.token"), r#"{"v":1,"baseUrl":"http://127.0.0.1:9","token":"x"}"#).unwrap();
        assert!(read(&dir.path().join("desktop.token")).is_ok());
    }
}
