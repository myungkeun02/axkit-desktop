#!/bin/sh
# Update ax-kit on this Mac: latest code → build → replace /Applications/ax-kit.app.
#   npm run install-app            (pull, build, install, open)
#   npm run install-app -- --no-pull --no-open
set -eu
cd "$(dirname "$0")/.."
PULL=1; OPEN=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    --no-open) OPEN=0 ;;
    *) echo "모르는 옵션: $arg"; exit 2 ;;
  esac
done

# Rust from Homebrew's rustup is keg-only; make cargo findable.
[ -d /opt/homebrew/opt/rustup/bin ] && PATH="/opt/homebrew/opt/rustup/bin:$PATH"
command -v cargo >/dev/null || { echo "cargo를 찾지 못했어요. Rust(rustup)를 먼저 설치해 주세요."; exit 1; }

if [ "$PULL" = 1 ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "고친 파일이 있어 최신 코드 받기는 건너뛰어요 (git status 확인)."
  else
    echo "최신 코드 받는 중…"
    git pull --ff-only
  fi
fi

echo "필요한 것 설치 중…"
npm ci --no-audit --no-fund >/dev/null
echo "빌드 중… (몇 분 걸려요)"
npm run tauri build -- --bundles app >/dev/null
BUILT="src-tauri/target/release/bundle/macos/ax-kit.app"
[ -d "$BUILT" ] || { echo "빌드한 앱을 찾지 못했어요: $BUILT"; exit 1; }

DEST="/Applications/ax-kit.app"
# Quit the running copy (it lives on in the menu bar after its window is closed).
pkill -f "$DEST/Contents/MacOS/" 2>/dev/null && sleep 1 || true
rm -rf "$DEST.new"
ditto "$BUILT" "$DEST.new"
rm -rf "$DEST"
mv "$DEST.new" "$DEST"
VERSION=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$DEST/Contents/Info.plist" 2>/dev/null || echo '?')
echo "설치했어요: $DEST (버전 $VERSION, $(git rev-parse --short HEAD))"
[ "$OPEN" = 1 ] && open "$DEST"
exit 0
