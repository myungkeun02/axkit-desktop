//! "다른 맥의 비서에 연결": the work MacBook talks to the ax-kit server on another Mac (e.g. the Mac mini at home)
//! over Tailscale, paired like the phones (ax-kit `docs/APP-PROTOCOL.md` §1–§2).
//!
//! On that Mac: `ax-kit phone pair --app --platform desktop` prints `링크: axkit://pair?u=<주소>&n=<연결 id>&c=<6자리>`
//! (and the same three values for typing by hand). The app sends the code once to `POST {u}/m/p/<n>/app` and gets a device
//! token, which lives only in the macOS Keychain (never in a file, never in the webview).

use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use url::{Host, Url};

/// How the owner gave us the pairing: the whole link, or the three values typed by hand.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairCode {
    pub base: Url,
    pub nonce: String,
    pub code: String,
}

/// What the Keychain keeps for the other Mac.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub v: u32,
    pub base_url: String,
    pub token: String,
    #[serde(default)]
    pub device_id: String,
    #[serde(default)]
    pub device_name: String,
    /// Unix seconds of the last pairing or token rotation (§2: rotate every 80 days).
    #[serde(default)]
    pub rotated_at: u64,
}

pub const ROTATE_AFTER_SECS: u64 = 80 * 24 * 3600;

/// `https://` anywhere, or `http://` only to a private address (Tailscale 100.64/10, home LAN, this Mac), §1.
/// No user:password, no query. Returns the address with a trailing slash so `join` keeps any path.
pub fn allowed_base(raw: &str) -> Result<Url, &'static str> {
    let mut text = raw.trim().to_string();
    if !text.contains("://") {
        // "100.101.102.103:47617" or "macmini.tail1234.ts.net": guess the usual form.
        let looks_ip = text.split(':').next().is_some_and(|h| h.parse::<IpAddr>().is_ok());
        text = if looks_ip { format!("http://{text}") } else { format!("https://{text}") };
    }
    let url = crate::token::normalize_base(&text).ok_or("주소가 이상해요. 예: https://macmini.tail1234.ts.net")?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("주소에 아이디·비밀번호를 넣을 수 없어요.");
    }
    match url.scheme() {
        "https" if url.host().is_some() => Ok(url),
        "http" if is_private(&url) => Ok(url),
        "http" => Err("http 주소는 Tailscale(100.x)·집 안 주소만 쓸 수 있어요. 아니면 https 주소를 넣어 주세요."),
        _ => Err("https:// 또는 http:// 주소여야 해요."),
    }
}

fn is_private(url: &Url) -> bool {
    match url.host() {
        Some(Host::Ipv4(ip)) => {
            let o = ip.octets();
            ip.is_loopback() || ip.is_private() || (o[0] == 100 && (64..128).contains(&o[1]))
        }
        Some(Host::Ipv6(ip)) => ip.is_loopback() || (ip.segments()[0] & 0xfe00) == 0xfc00,
        Some(Host::Domain(d)) => d.eq_ignore_ascii_case("localhost"),
        None => false,
    }
}

fn six_digits(code: &str) -> Result<String, &'static str> {
    let c: String = code.chars().filter(|c| !c.is_whitespace() && *c != '-').collect();
    if c.len() == 6 && c.chars().all(|c| c.is_ascii_digit()) { Ok(c) } else { Err("코드는 숫자 6자리예요.") }
}

fn nonce_ok(n: &str) -> bool {
    !n.is_empty() && n.len() <= 128 && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// The `axkit://pair?…` link, found anywhere in what was pasted (the CLI prints "링크: axkit://…").
pub fn parse_link(pasted: &str) -> Result<PairCode, &'static str> {
    let start = pasted.find("axkit://pair").ok_or("axkit://pair 로 시작하는 링크를 붙여 넣어 주세요.")?;
    let link = pasted[start..].split_whitespace().next().unwrap_or("");
    let url = Url::parse(link).map_err(|_| "링크가 이상해요. 다시 복사해 주세요.")?;
    let get = |k: &str| url.query_pairs().find(|(key, _)| key == k).map(|(_, v)| v.into_owned());
    let base = allowed_base(&get("u").ok_or("링크에 주소가 없어요.")?)?;
    let nonce = get("n").filter(|n| nonce_ok(n)).ok_or("링크에 연결 id가 없어요.")?;
    let code = six_digits(&get("c").unwrap_or_default())?;
    Ok(PairCode { base, nonce, code })
}

/// A link macOS handed to the app (`open 'axkit://pair?…'` from the install script, or a click). Anything could
/// have opened it, so it must be exactly a pair link to an https address; the page still shows the address before
/// switching away from a working connection. Returns the link and the address to show.
pub fn opened_link(raw: &str) -> Result<(String, String), &'static str> {
    let raw = raw.trim();
    if !raw.starts_with("axkit://pair") {
        return Err("모르는 링크예요.");
    }
    let u = Url::parse(raw).ok().and_then(|url| url.query_pairs().find(|(k, _)| k == "u").map(|(_, v)| v.into_owned()));
    if !u.is_some_and(|u| u.trim().to_ascii_lowercase().starts_with("https://")) {
        return Err("링크로 연결할 때는 https 주소만 쓸 수 있어요.");
    }
    let p = parse_link(raw)?;
    if p.base.scheme() != "https" {
        return Err("링크로 연결할 때는 https 주소만 쓸 수 있어요.");
    }
    let host = p.base.host_str().unwrap_or("").to_string();
    let shown = match p.base.port() {
        Some(port) => format!("{host}:{port}"),
        None => host,
    };
    Ok((raw.to_string(), shown))
}

/// The three values typed by hand ("주소 … · 코드 … · 연결 id …").
pub fn parse_manual(address: &str, code: &str, nonce: &str) -> Result<PairCode, &'static str> {
    let base = allowed_base(address)?;
    let code = six_digits(code)?;
    let nonce = nonce.trim();
    if !nonce_ok(nonce) {
        return Err("연결 id를 확인해 주세요.");
    }
    Ok(PairCode { base, nonce: nonce.to_string(), code })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairReply {
    ok: Option<bool>,
    error: Option<String>,
    attempts_left: Option<u32>,
    device_id: Option<String>,
    device_name: Option<String>,
    #[allow(dead_code)]
    base_url: Option<String>,
    token: Option<String>,
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// `POST {base}/m/p/<nonce>/app {"code"}` (no Authorization). Words for every answer the owner can get.
pub async fn pair(http: &reqwest::Client, p: &PairCode) -> Result<Saved, String> {
    let url = p.base.join(&format!("m/p/{}/app", p.nonce)).map_err(|_| "주소가 이상해요.".to_string())?;
    let res = http.post(url).json(&serde_json::json!({ "code": p.code })).send().await.map_err(|e| unreachable_words(&p.base, &e))?;
    let status = res.status().as_u16();
    let body: PairReply = res.json().await.map_err(|_| "그 주소의 답이 ax-kit 같지 않아요. 주소를 확인해 주세요.".to_string())?;
    match status {
        200 if body.ok == Some(true) => {
            let token = body.token.filter(|t| !t.trim().is_empty() && !t.chars().any(|c| c.is_control() || c == ' ')).ok_or("토큰을 받지 못했어요.")?;
            // Keep the address that just worked. The server's `baseUrl` is its public address, which may not be the one this
            // Mac can reach (e.g. the owner typed the 100.x address because MagicDNS is off).
            let _ = body.base_url;
            let base = p.base.clone();
            Ok(Saved { v: 1, base_url: base.to_string(), token, device_id: body.device_id.unwrap_or_default(), device_name: body.device_name.unwrap_or_default(), rotated_at: now_secs() })
        }
        403 if body.error.as_deref() == Some("wrong") => Err(match body.attempts_left {
            Some(0) | None => "코드가 맞지 않아요.".into(),
            Some(n) => format!("코드가 맞지 않아요. {n}번 더 해 볼 수 있어요."),
        }),
        410 if body.error.as_deref() == Some("burned") => Err("여러 번 틀려서 이 코드는 못 써요. 그 맥에서 짝 맞추기를 다시 해 주세요.".into()),
        410 => Err("코드가 지났거나 이미 썼어요(10분, 한 번만). 그 맥에서 짝 맞추기를 다시 해 주세요.".into()),
        404 => Err("그 주소에서 짝 맞추기를 찾지 못했어요. 주소가 ax-kit인지 확인해 주세요.".into()),
        429 | 423 => Err("너무 여러 번 시도했어요. 잠시 뒤에 다시 해 주세요.".into()),
        _ => Err(format!("짝 맞추기에 실패했어요 ({status}).")),
    }
}

/// Why the other Mac can't be reached, in words that point at Tailscale.
pub fn unreachable_words(base: &Url, e: &reqwest::Error) -> String {
    let host = base.host_str().unwrap_or("그 맥");
    if e.is_timeout() || e.is_connect() {
        format!("{host}에 닿지 않아요. 이 맥과 그 맥 모두 Tailscale이 켜져 있고 같은 계정인지, 그 맥의 ax-kit가 켜져 있는지 확인해 주세요.")
    } else {
        format!("{host}와 안전하게 연결하지 못했어요. 주소(https)를 확인해 주세요.")
    }
}

// ---------- Keychain ----------

const SERVICE: &str = "dev.axkit.desktop";
const ACCOUNT: &str = "other-mac";

/// Where the saved connection lives. The app uses the Keychain; tests use memory.
pub trait Vault: Send + Sync {
    /// `Ok(None)` = nothing saved; `Err` = the Keychain said no (the owner denied access): say so, never fall back quietly.
    fn load(&self) -> Result<Option<Saved>, String>;
    fn save(&self, s: &Saved) -> Result<(), String>;
    fn forget(&self);
}

pub struct Keychain;

pub const KEYCHAIN_DENIED: &str = "키체인 허락이 필요해요. '다시 연결해 보기'를 누르고 키체인 창에서 '항상 허용'을 눌러 주세요.";

impl Vault for Keychain {
    fn load(&self) -> Result<Option<Saved>, String> {
        let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|_| KEYCHAIN_DENIED.to_string())?;
        match entry.get_password() {
            Ok(text) => Ok(serde_json::from_str::<Saved>(&text).ok().filter(|s| s.v == 1 && allowed_base(&s.base_url).is_ok())),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(KEYCHAIN_DENIED.to_string()),
        }
    }
    fn save(&self, s: &Saved) -> Result<(), String> {
        let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
        entry.set_password(&serde_json::to_string(s).map_err(|e| e.to_string())?).map_err(|_| "키체인에 저장하지 못했어요.".to_string())
    }
    fn forget(&self) {
        if let Ok(entry) = keyring::Entry::new(SERVICE, ACCOUNT) {
            let _ = entry.delete_credential();
        }
    }
}

#[derive(Default)]
pub struct Memory(pub std::sync::Mutex<Option<Saved>>);

impl Vault for Memory {
    fn load(&self) -> Result<Option<Saved>, String> { Ok(self.0.lock().unwrap().clone()) }
    fn save(&self, s: &Saved) -> Result<(), String> { *self.0.lock().unwrap() = Some(s.clone()); Ok(()) }
    fn forget(&self) { *self.0.lock().unwrap() = None; }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_link_the_cli_prints() {
        let p = parse_link("링크: axkit://pair?u=https%3A%2F%2Fmacmini.tail1234.ts.net&n=Ab_9-x&c=123456").unwrap();
        assert_eq!(p.base.as_str(), "https://macmini.tail1234.ts.net/");
        assert_eq!((p.nonce.as_str(), p.code.as_str()), ("Ab_9-x", "123456"));
        let p = parse_link("axkit://pair?u=http%3A%2F%2F100.101.1.2%3A47617&n=n1&c=000111\n").unwrap();
        assert_eq!(p.base.as_str(), "http://100.101.1.2:47617/");
        assert!(parse_link("https://example.com").is_err());
        assert!(parse_link("axkit://pair?u=http%3A%2F%2Fevil.com&n=n&c=123456").is_err());
        assert!(parse_link("axkit://pair?u=https%3A%2F%2Fa.ts.net&n=..%2F&c=123456").is_err());
        assert!(parse_link("axkit://pair?u=https%3A%2F%2Fa.ts.net&n=n&c=12345").is_err());
    }

    #[test]
    fn only_https_or_private_http() {
        for ok in ["https://macmini.tail1234.ts.net", "macmini.tail1234.ts.net", "http://100.64.0.1:47617", "100.127.255.1:47617", "http://192.168.0.10:47617", "http://10.0.0.2:47617", "http://127.0.0.1:47617", "http://[fd7a:115c:a1e0::1]:47617"] {
            assert!(allowed_base(ok).is_ok(), "{ok}");
        }
        for bad in ["http://macmini.tail1234.ts.net", "http://8.8.8.8:47617", "http://100.128.0.1", "ftp://a.ts.net", "https://u:p@a.ts.net", ""] {
            assert!(allowed_base(bad).is_err(), "{bad}");
        }
        assert_eq!(allowed_base("100.101.1.2:47617").unwrap().as_str(), "http://100.101.1.2:47617/");
    }

    #[test]
    fn reads_typed_values() {
        let p = parse_manual(" https://macmini.tail1234.ts.net/ ", "123 456", " nonce1 ").unwrap();
        assert_eq!((p.base.as_str(), p.code.as_str(), p.nonce.as_str()), ("https://macmini.tail1234.ts.net/", "123456", "nonce1"));
        assert!(parse_manual("https://a.ts.net", "abcdef", "n").is_err());
        assert!(parse_manual("https://a.ts.net", "123456", "a/b").is_err());
    }

    /// A one-shot pairing server: answers with `status` and `body` and hands back the request it got.
    async fn server(status: &'static str, body: String) -> (u16, tokio::task::JoinHandle<String>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let h = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 8192];
            let n = sock.read(&mut buf).await.unwrap();
            let resp = format!("HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
            sock.write_all(resp.as_bytes()).await.unwrap();
            String::from_utf8_lossy(&buf[..n]).to_string()
        });
        (port, h)
    }

    #[tokio::test]
    async fn pairs_and_keeps_the_token() {
        let (port, h) = server("200 OK", r#"{"ok":true,"deviceId":"d_1","deviceName":"작업용 맥북","baseUrl":"http://127.0.0.1:47617","token":"tok123"}"#.into()).await;
        let p = parse_manual(&format!("http://127.0.0.1:{port}"), "123456", "nn").unwrap();
        let s = pair(&reqwest::Client::new(), &p).await.unwrap();
        assert_eq!((s.base_url, s.token.as_str(), s.device_name.as_str()), (format!("http://127.0.0.1:{port}/"), "tok123", "작업용 맥북"));
        let req = h.await.unwrap();
        assert!(req.starts_with("POST /m/p/nn/app "));
        assert!(req.contains(r#"{"code":"123456"}"#));
        assert!(!req.to_ascii_lowercase().contains("authorization"));
    }

    #[tokio::test]
    async fn says_why_pairing_failed() {
        let (port, _h) = server("403 Forbidden", r#"{"ok":false,"error":"wrong","attemptsLeft":3}"#.into()).await;
        let p = parse_manual(&format!("http://127.0.0.1:{port}"), "123456", "nn").unwrap();
        assert_eq!(pair(&reqwest::Client::new(), &p).await.unwrap_err(), "코드가 맞지 않아요. 3번 더 해 볼 수 있어요.");
        let (port, _h) = server("410 Gone", r#"{"ok":false,"error":"expired"}"#.into()).await;
        let p = parse_manual(&format!("http://127.0.0.1:{port}"), "123456", "nn").unwrap();
        assert!(pair(&reqwest::Client::new(), &p).await.unwrap_err().contains("10분"));
        // The address that worked stays, whatever the server calls itself; a reply without a token is refused.
        let (port, _h) = server("200 OK", r#"{"ok":true,"baseUrl":"http://8.8.8.8","token":"t"}"#.into()).await;
        let p = parse_manual(&format!("http://127.0.0.1:{port}"), "123456", "nn").unwrap();
        assert_eq!(pair(&reqwest::Client::new(), &p).await.unwrap().base_url, format!("http://127.0.0.1:{port}/"));
        let (port, _h) = server("200 OK", r#"{"ok":true,"token":" "}"#.into()).await;
        let p = parse_manual(&format!("http://127.0.0.1:{port}"), "123456", "nn").unwrap();
        assert!(pair(&reqwest::Client::new(), &p).await.is_err());
    }

    #[test]
    fn opened_link_takes_only_https_pair_links() {
        let (link, host) = opened_link("axkit://pair?u=https%3A%2F%2Foffice-mini.tailnet0000.ts.net%3A8443&n=Ab_9&c=123456").unwrap();
        assert!(link.starts_with("axkit://pair?"));
        assert_eq!(host, "office-mini.tailnet0000.ts.net:8443");
        assert_eq!(opened_link("axkit://pair?u=http%3A%2F%2F100.101.1.2%3A47617&n=n1&c=000111").unwrap_err(), "링크로 연결할 때는 https 주소만 쓸 수 있어요.");
        assert!(opened_link("axkit://other?u=https%3A%2F%2Fa.ts.net&n=n1&c=000111").is_err());
        assert!(opened_link("axkit://pair?u=https%3A%2F%2Fa.ts.net&n=bad%20id&c=000111").is_err());
        assert!(opened_link("axkit://pair?u=https%3A%2F%2Fa.ts.net&n=n1&c=12").is_err());
        assert!(opened_link("x axkit://pair?u=https%3A%2F%2Fa.ts.net&n=n1&c=123456").is_err());
    }
}
