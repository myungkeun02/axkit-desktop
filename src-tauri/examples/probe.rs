//! Talks to a real ax-kit server with the app's own connection code — no window.
//!   AXKIT_TOKEN_FILE=/path/desktop.token cargo run --example probe [-- "보낼 말"]
//! Prints what the app would see: capabilities, status, the last events, a message round trip and live stream events.

use axkit_desktop_lib::conn::Connection;
use axkit_desktop_lib::remote;
use axkit_desktop_lib::sse::SseParser;
use futures_util::StreamExt;
use std::collections::HashMap;
use std::time::Duration;

fn summary(bytes: &[u8]) -> String {
    let s = String::from_utf8_lossy(bytes);
    if s.len() > 300 { format!("{}…", &s[..s.char_indices().nth(300).map(|(i, _)| i).unwrap_or(s.len())]) } else { s.into_owned() }
}

fn link_of(l: &Option<String>) -> &str { l.as_deref().unwrap_or("") }

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    // `--update "<link>" <folder>`: §32 — pair, read views/app-updates, fetch desktop.zip, check and unpack it, and run
    // the swap helper on <folder>/ax-kit.app (not the installed app; nothing is opened).
    if std::env::args().nth(1).as_deref() == Some("--update") {
        let link = std::env::args().nth(2).unwrap_or_default();
        let folder = std::path::PathBuf::from(std::env::args().nth(3).expect("folder"));
        let conn = Connection::with_vault(Box::new(remote::Memory::default()));
        conn.pair_remote(&remote::parse_link(&link).expect("link")).await.expect("pair");
        let q = HashMap::new();
        let view = conn.call("GET", "views/app-updates", &q, &[], None).await.expect("view");
        println!("GET views/app-updates → {} {}", view.status, summary(&view.bytes));
        let v: serde_json::Value = serde_json::from_slice(&view.bytes).unwrap_or_default();
        let sha = v["data"]["desktop"]["sha256"].as_str().unwrap_or("").to_string();
        let zip = conn.call("GET", "app-updates/desktop.zip", &q, &[], None).await.expect("zip");
        println!("GET app-updates/desktop.zip → {} {} bytes", zip.status, zip.bytes.len());
        let wrong = axkit_desktop_lib::update::prepare(&zip.bytes, &"0".repeat(64), folder.join("ax-kit.app"));
        println!("wrong sha → {:?}", wrong.err());
        let ready = axkit_desktop_lib::update::prepare(&zip.bytes, &sha, folder.join("ax-kit.app")).expect("prepare");
        println!("unpacked → {}", ready.new_app.display());
        let script = ready.tmp.join("swap-test.sh");
        std::fs::write(&script, axkit_desktop_lib::update::helper_script().replace("open \"$DEST\"", "true")).unwrap();
        let ok = std::process::Command::new("/bin/sh").arg(&script).arg("999999").arg(&ready.new_app).arg(&ready.dest).arg(&ready.tmp).status().unwrap();
        println!("helper → {ok}; tmp left: {}", ready.tmp.exists());
        conn.forget_remote().await;
        return;
    }
    // `--release <folder>`: the GitHub release — read the json, fetch the zip (size), check and unpack it (sha256,
    // bundle id, signature) and run the swap helper on <folder>/ax-kit.app (nothing is opened).
    if std::env::args().nth(1).as_deref() == Some("--release") {
        let folder = std::path::PathBuf::from(std::env::args().nth(2).expect("folder"));
        let info = axkit_desktop_lib::update::latest_release().await.expect("json");
        println!("latest → build {} {} {} bytes", info.build, info.version_name, info.size);
        println!("newer than offered? → {:?}", axkit_desktop_lib::update::download_release(info.build + 1).await.err());
        let (info, zip) = axkit_desktop_lib::update::download_release(info.build).await.expect("zip");
        println!("zip → {} bytes (json said {})", zip.len(), info.size);
        println!("wrong size → {:?}", axkit_desktop_lib::update::same_size(info.size + 1, &zip).err());
        let ready = axkit_desktop_lib::update::prepare(&zip, &info.sha256, folder.join("ax-kit.app")).expect("prepare");
        println!("unpacked → {}", ready.new_app.display());
        let script = ready.tmp.join("swap-test.sh");
        std::fs::write(&script, axkit_desktop_lib::update::helper_script().replace("open \"$DEST\"", "true")).unwrap();
        let ok = std::process::Command::new("/bin/sh").arg(&script).arg("999999").arg(&ready.new_app).arg(&ready.dest).arg(&ready.tmp).status().unwrap();
        println!("helper → {ok}; quarantine: {:?}", std::process::Command::new("/usr/bin/xattr").arg("-p").arg("com.apple.quarantine").arg(&ready.dest).output().map(|o| o.status.success()));
        return;
    }
    // `--pair "<axkit://pair?… link>"`: pair like "다른 맥의 비서에 연결" (token kept in memory, not the Keychain), then probe.
    let pair_link = (std::env::args().nth(1).as_deref() == Some("--pair")).then(|| std::env::args().nth(2).unwrap_or_default());
    let conn = if pair_link.is_some() { Connection::with_vault(Box::new(remote::Memory::default())) } else { Connection::new() };
    let info = match &pair_link {
        Some(link) => {
            let code = remote::parse_link(link).expect("link");
            match conn.pair_remote(&code).await {
                Ok(i) => i,
                Err(e) => { println!("pair failed: {e}"); std::process::exit(1); }
            }
        }
        None => conn.use_token_file().await,
    };
    if pair_link.is_some() {
        println!("paired: mode={} device={:?}", info.mode, info.device_name);
        let q = HashMap::new();
        for path in ["me", "status", "capabilities"] {
            let r = conn.call("GET", path, &q, &[], None).await.expect("call");
            println!("GET {path} → {} {}", r.status, summary(&r.bytes));
        }
        let again = conn.pair_remote(&remote::parse_link(link_of(&pair_link)).unwrap()).await;
        println!("same code again → {:?}", again.err());
        let info = conn.forget_remote().await;
        println!("forgot: mode={}", info.mode);
        return;
    }
    println!("connection: connected={} host={:?} problem={:?}", info.connected, info.host, info.problem);
    if !info.connected { std::process::exit(1); }
    let q = HashMap::new();
    if std::env::args().nth(1).as_deref() == Some("--file") {
        // §19: fetch a document the way the app's save_file does.
        for path in std::env::args().skip(2) {
            let r = conn.call("GET", &path, &q, &[], None).await.expect("call");
            println!("GET {path} → {} {} bytes, starts {:?}", r.status, r.bytes.len(), String::from_utf8_lossy(&r.bytes[..r.bytes.len().min(5)]));
        }
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--rotate") {
        // Keep the old token in memory while the server restarts, then call again: the app must re-read the file.
        let before = conn.call("GET", "status", &q, &[], None).await.expect("call");
        println!("before restart: {}", before.status);
        let path = std::env::var("AXKIT_TOKEN_FILE").unwrap();
        let old = std::fs::read_to_string(&path).unwrap();
        for _ in 0..120 {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if std::fs::read_to_string(&path).map(|t| t != old).unwrap_or(false) { break; }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
        let after = conn.call("GET", "status", &q, &[], None).await.expect("call");
        println!("after restart (old token in memory): {} {}", after.status, summary(&after.bytes));
        return;
    }
    for path in ["capabilities", "status"] {
        let r = conn.call("GET", path, &q, &[], None).await.expect("call");
        println!("GET {path} → {} {}", r.status, summary(&r.bytes));
    }
    let mut ev = HashMap::new();
    ev.insert("after".to_string(), "0".to_string());
    ev.insert("limit".to_string(), "5".to_string());
    let r = conn.call("GET", "events", &ev, &[], None).await.expect("events");
    println!("GET events → {} {}", r.status, summary(&r.bytes));
    for view in ["today", "approvals", "usage", "jobs", "bots", "docgraph", "calendar"] {
        let r = conn.call("GET", &format!("views/{view}"), &q, &[], None).await.expect("view");
        println!("GET views/{view} → {}", r.status);
    }

    // Live stream: open it, then send a message and watch it come back.
    let status = conn.call("GET", "status", &q, &[], None).await.unwrap();
    let last = serde_json::from_slice::<serde_json::Value>(&status.bytes).unwrap()["lastSeq"].as_u64().unwrap_or(0);
    let creds = conn.credentials().await.unwrap();
    let res = conn.stream_http.get(creds.base.join("m/v1/app/stream").unwrap()).bearer_auth(&creds.token)
        .header("Last-Event-ID", last.to_string()).send().await.expect("stream");
    println!("GET stream → {}", res.status());
    let text = std::env::args().nth(1).unwrap_or_else(|| "데스크톱 앱 연결 시험이에요".into());
    let body = serde_json::to_vec(&serde_json::json!({ "text": text, "clientId": format!("probe-{}", std::process::id()) })).unwrap();
    let r = conn.call("POST", "messages", &q, &[("content-type".into(), "application/json".into())], Some(body)).await.expect("send");
    println!("POST messages → {} {}", r.status, summary(&r.bytes));
    let mut parser = SseParser::new();
    let mut stream = res.bytes_stream();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(8);
    let mut got = 0;
    while let Ok(Some(Ok(chunk))) = tokio::time::timeout_at(deadline, stream.next()).await {
        for e in parser.push(&chunk) {
            got += 1;
            println!("stream event {:?} id={:?}: {}", e.event, e.id, summary(e.data.as_bytes()));
        }
    }
    println!("stream events seen: {got}");
}
