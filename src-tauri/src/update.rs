//! §32 앱 업데이트 without a store: the assistant's Mac builds this app and hands the zip to paired apps. The owner
//! presses 바꾸기; we fetch `app-updates/desktop.zip` with the device token, check its sha256, unpack it, check it is
//! this app, and leave the swap to a small shell helper that waits for us to quit, replaces the bundle, clears the
//! quarantine flag and opens the new one. Anything wrong before the swap: the old app stays as it is. The connection
//! lives in the Keychain and the app data folder, which the swap does not touch.

use std::path::{Path, PathBuf};
use std::process::Command;

pub const BUNDLE_ID: &str = "dev.axkit.desktop";

/// The `.app` this process runs from (`…/ax-kit.app/Contents/MacOS/ax-kit-desktop` → `…/ax-kit.app`).
pub fn running_bundle(exe: &Path) -> Option<PathBuf> {
    let bundle = exe.parent()?.parent()?.parent()?;
    let macos = exe.parent()?;
    (macos.file_name()? == "MacOS" && bundle.extension()? == "app").then(|| bundle.to_path_buf())
}

/// sha256 written as the server does (lower-case hex), compared without caring about case or spaces.
pub fn same_sha(expected: &str, actual: &str) -> bool {
    let e = expected.trim().to_ascii_lowercase();
    e.len() == 64 && e.chars().all(|c| c.is_ascii_hexdigit()) && e == actual.trim().to_ascii_lowercase()
}

fn sha256_of(file: &Path) -> Result<String, String> {
    let out = Command::new("/usr/bin/shasum").args(["-a", "256"]).arg(file).output().map_err(|_| "받은 파일을 확인하지 못했어요.".to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    text.split_whitespace().next().map(str::to_string).filter(|s| s.len() == 64).ok_or_else(|| "받은 파일을 확인하지 못했어요.".into())
}

fn plist_value(app: &Path, key: &str) -> Option<String> {
    let out = Command::new("/usr/libexec/PlistBuddy").args(["-c", &format!("Print {key}")]).arg(app.join("Contents/Info.plist")).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// The shell helper: wait for the old app to quit, swap the bundle (keeping the old one until the new one is in
/// place), clear quarantine, open it. If the swap fails the old app is put back and opened.
pub fn helper_script() -> &'static str {
    r#"#!/bin/sh
# ax-kit 앱 바꾸기 도우미: $1 = 기다릴 앱 pid, $2 = 새 ax-kit.app, $3 = 바꿀 자리, $4 = 지울 임시 폴더
PID="$1"; NEW="$2"; DEST="$3"; TMP="$4"
i=0
while kill -0 "$PID" 2>/dev/null && [ $i -lt 60 ]; do sleep 0.5; i=$((i+1)); done
OLD="$DEST.old-$$"
if ditto "$NEW" "$DEST.new-$$" && mv "$DEST" "$OLD" && mv "$DEST.new-$$" "$DEST"; then
  xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
  rm -rf "$OLD"
else
  rm -rf "$DEST.new-$$"
  [ -d "$OLD" ] && [ ! -d "$DEST" ] && mv "$OLD" "$DEST"
fi
open "$DEST"
rm -rf "$TMP"
"#
}

/// Everything up to the swap. Returns the unpacked new app, its folder, and where it goes.
pub struct Ready {
    pub new_app: PathBuf,
    pub tmp: PathBuf,
    pub dest: PathBuf,
}

/// Checks the downloaded zip and unpacks it next to it.
pub fn prepare(zip_bytes: &[u8], sha256: &str, dest: PathBuf) -> Result<Ready, String> {
    let tmp = std::env::temp_dir().join(format!("axkit-update-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|_| "임시 폴더를 만들지 못했어요.".to_string())?;
    let fail = |why: &str| {
        let _ = std::fs::remove_dir_all(&tmp);
        why.to_string()
    };
    let zip = tmp.join("ax-kit-desktop.zip");
    std::fs::write(&zip, zip_bytes).map_err(|_| fail("받은 파일을 저장하지 못했어요."))?;
    if !same_sha(sha256, &sha256_of(&zip).map_err(|e| fail(&e))?) {
        return Err(fail("받은 파일이 맥이 알려 준 것과 달라요. 다시 받아 볼게요."));
    }
    let out = tmp.join("unpacked");
    let ok = Command::new("/usr/bin/ditto").args(["-x", "-k"]).arg(&zip).arg(&out).status().map(|s| s.success()).unwrap_or(false);
    let new_app = out.join("ax-kit.app");
    if !ok || !new_app.join("Contents/Info.plist").exists() {
        return Err(fail("받은 파일을 풀지 못했어요."));
    }
    if plist_value(&new_app, "CFBundleIdentifier").as_deref() != Some(BUNDLE_ID) {
        return Err(fail("받은 파일이 이 앱이 아니에요."));
    }
    let signed = Command::new("/usr/bin/codesign").args(["--verify", "--deep"]).arg(&new_app).status().map(|s| s.success()).unwrap_or(false);
    if !signed {
        return Err(fail("받은 앱의 서명이 맞지 않아요."));
    }
    let parent = dest.parent().ok_or_else(|| fail("앱이 있는 곳을 찾지 못했어요."))?;
    let probe = parent.join(format!(".axkit-write-test-{}", std::process::id()));
    if std::fs::write(&probe, b"").is_err() {
        return Err(fail("앱을 바꿀 권한이 없어요. 응용 프로그램 폴더에 쓸 수 있는 계정으로 해 주세요."));
    }
    let _ = std::fs::remove_file(probe);
    Ok(Ready { new_app, tmp, dest })
}

/// Starts the helper (it outlives this process); the caller quits right after.
pub fn hand_over(ready: &Ready) -> Result<(), String> {
    let script = ready.tmp.join("swap.sh");
    std::fs::write(&script, helper_script()).map_err(|_| "바꾸기 도우미를 만들지 못했어요.".to_string())?;
    Command::new("/bin/sh")
        .arg(&script)
        .arg(std::process::id().to_string())
        .arg(&ready.new_app)
        .arg(&ready.dest)
        .arg(&ready.tmp)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|_| "바꾸기 도우미를 띄우지 못했어요.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_running_bundle() {
        assert_eq!(running_bundle(Path::new("/Applications/ax-kit.app/Contents/MacOS/ax-kit-desktop")), Some(PathBuf::from("/Applications/ax-kit.app")));
        assert_eq!(running_bundle(Path::new("/Users/me/dev/ax-kit-desktop/src-tauri/target/debug/ax-kit-desktop")), None);
    }

    #[test]
    fn compares_sha256() {
        let s = "a".repeat(64);
        assert!(same_sha(&s, &s.to_uppercase()));
        assert!(!same_sha(&s, &"b".repeat(64)));
        assert!(!same_sha("", ""));
        assert!(!same_sha("xyz", "xyz"));
    }

    /// The helper swaps a bundle, and puts the old one back when the new one can't be copied.
    #[test]
    fn helper_swaps_and_keeps_the_old_app_on_failure() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("swap.sh");
        std::fs::write(&script, helper_script().replace("open \"$DEST\"", "touch \"$DEST.opened\"")).unwrap();
        let dest = dir.path().join("ax-kit.app");
        let new_app = dir.path().join("new/ax-kit.app");
        std::fs::create_dir_all(dest.join("Contents")).unwrap();
        std::fs::write(dest.join("Contents/v"), "old").unwrap();
        std::fs::create_dir_all(new_app.join("Contents")).unwrap();
        std::fs::write(new_app.join("Contents/v"), "new").unwrap();
        let tmp = dir.path().join("tmp");
        std::fs::create_dir_all(&tmp).unwrap();
        let run = |new: &Path| Command::new("/bin/sh").arg(&script).arg("999999").arg(new).arg(&dest).arg(&tmp).status().unwrap();
        assert!(run(&new_app).success());
        assert_eq!(std::fs::read_to_string(dest.join("Contents/v")).unwrap(), "new");
        assert!(dir.path().join("ax-kit.app.opened").exists());
        assert!(!tmp.exists());
        // a new app that isn't there: the current one stays
        std::fs::create_dir_all(&tmp).unwrap();
        run(&dir.path().join("missing.app"));
        assert_eq!(std::fs::read_to_string(dest.join("Contents/v")).unwrap(), "new");
        let leftovers: Vec<_> = std::fs::read_dir(dir.path()).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| n.contains(".old-") || n.contains(".new-")).collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
    }
}
