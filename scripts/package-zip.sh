#!/bin/sh
# Build the app and pack it for the install script on a work Mac: release/ax-kit-desktop.zip (ax-kit.app inside),
# plus release/ax-kit-desktop.json {build, versionName, builtAt, sha256, size} for the GitHub release.
#   npm run package-zip
# The build runs inside the shared heavy-build lock (/tmp/huyeor-heavy-build.lock); don't wrap this in lockf again.
# Signed ad hoc (tauri.conf.json signingIdentity "-") like the installed copy: the install script must remove the
# quarantine flag (xattr -dr com.apple.quarantine) after unzipping.
set -eu
cd "$(dirname "$0")/.."
LOCK=/tmp/huyeor-heavy-build.lock
if [ "${AXKIT_HEAVY_LOCKED:-}" != 1 ]; then
  exec env AXKIT_HEAVY_LOCKED=1 /usr/bin/lockf -k "$LOCK" sh "$0" "$@"
fi

[ -d /opt/homebrew/opt/rustup/bin ] && PATH="/opt/homebrew/opt/rustup/bin:$PATH"
command -v cargo >/dev/null || { echo "cargo를 찾지 못했어요. Rust(rustup)를 먼저 설치해 주세요."; exit 1; }

echo "필요한 것 설치 중…"
npm ci --no-audit --no-fund >/dev/null
echo "빌드 중… (몇 분 걸려요)"
npm run tauri build -- --bundles app >/dev/null
BUILT="src-tauri/target/release/bundle/macos/ax-kit.app"
[ -d "$BUILT" ] || { echo "빌드한 앱을 찾지 못했어요: $BUILT"; exit 1; }
codesign --verify --deep "$BUILT" || { echo "앱 서명이 맞지 않아요."; exit 1; }

# Not in dist/: Vite empties dist/ on every build, which would delete the zip.
OUT="release/ax-kit-desktop.zip"
mkdir -p release
rm -f "$OUT"
ditto -c -k --keepParent "$BUILT" "$OUT"
ID=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$BUILT/Contents/Info.plist")
VERSION=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$BUILT/Contents/Info.plist")
BUILD=$(git rev-list --count HEAD)
# What the app reads from the GitHub release (releases/latest/download/ax-kit-desktop.json) to offer this build.
node -e '
const fs = require("fs"), crypto = require("crypto");
const [zip, out, build] = process.argv.slice(1);
const bytes = fs.readFileSync(zip);
const info = { build: Number(build), versionName: `0.1.${build}`, builtAt: new Date().toISOString(), sha256: crypto.createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
fs.writeFileSync(out, JSON.stringify(info, null, 2) + "\n");
' "$OUT" "release/ax-kit-desktop.json" "$BUILD"
echo "만들었어요: $OUT ($(du -h "$OUT" | cut -f1 | tr -d ' '), ax-kit.app · $ID · 버전 $VERSION · 빌드 $BUILD · $(git rev-parse --short HEAD))"
