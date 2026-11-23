#!/bin/bash
set -euo pipefail

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

[[ "$(uname -s)" == Darwin ]] || fail "Tệp này dùng để mở Fabuloki trên macOS."
cd "$(dirname "$0")"
[[ -f package-lock.json && -f start/local.mjs ]] || fail "Hãy mở tệp này trong thư mục mã nguồn Fabuloki."

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export NEXT_TELEMETRY_DISABLED=1

need_brew() {
  if command -v brew >/dev/null; then
    return
  fi

  printf '%s\n' "Đang mở trình cài Homebrew. Hãy xác nhận trong Terminal khi được hỏi."
  local installer
  installer="$(curl --fail --silent --show-error --location https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  /bin/bash -c "$installer"
  command -v brew >/dev/null || fail "Chưa tìm thấy Homebrew sau khi cài."
}

node_ready() {
  command -v node >/dev/null &&
    command -v npm >/dev/null &&
    node --input-type=module -e 'import { nodePatched } from "./start/doctor.mjs"; process.exit(nodePatched(process.versions.node) ? 0 : 1)' 2>/dev/null
}

if ! node_ready; then
  need_brew
  if ! brew list --versions node@24 >/dev/null; then
    brew install node@24
  fi
  export PATH="$(brew --prefix node@24)/bin:$PATH"
  if ! node_ready; then
    brew upgrade node@24
    node_ready || fail "Phiên bản Node.js chưa đáp ứng yêu cầu của Fabuloki."
  fi
fi

if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  need_brew
  brew install ffmpeg
  command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null || fail "Chưa tìm thấy FFmpeg và FFprobe."
fi

browser="${FABULOKI_BROWSER_PATH:-}"
if [[ ! -x "$browser" ]]; then
  for candidate in "/Applications/Google Chrome.app" "$HOME/Applications/Google Chrome.app"; do
    if [[ -x "$candidate/Contents/MacOS/Google Chrome" ]]; then
      browser="$candidate/Contents/MacOS/Google Chrome"
      break
    fi
  done
fi
if [[ ! -x "$browser" ]]; then
  need_brew
  brew install --cask google-chrome
  browser="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  [[ -x "$browser" ]] || fail "Chưa tìm thấy Google Chrome trong Applications."
fi
export FABULOKI_BROWSER_PATH="$browser"

url="$(node --input-type=module -e '
  import { existsSync } from "node:fs";
  if (existsSync(".env")) process.loadEnvFile(".env");
  const port = process.env.WEB_PORT || "6868";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) process.exit(1);
  console.log("http://127.0.0.1:" + port);
')" || fail "Cổng WEB_PORT không hợp lệ."
app_ready() {
  node --input-type=module -e '
    try {
      const res = await fetch(process.argv[1] + "/api/health", { signal: AbortSignal.timeout(2000) });
      const health = await res.json();
      if (!res.ok || health.ok !== true || typeof health.checks?.hyperframes !== "boolean") process.exit(1);
    } catch {
      process.exit(1);
    }
  ' "$url"
}

if app_ready; then
  open "$url"
  exit
fi

mkdir -p .runtime
launch_lock=".runtime/macos-launcher-lock"
mkdir "$launch_lock" 2>/dev/null || fail "Một cửa sổ khác đang chuẩn bị Fabuloki."
app_pid=""
cleanup() {
  if [[ -n "$app_pid" ]]; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  rmdir "$launch_lock"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if app_ready; then
  open "$url"
  exit
fi

stamp=".runtime/macos-launcher-build"
revision="$(git rev-parse HEAD 2>/dev/null || printf '%s' source)"
build_key="$(node -p 'process.version + " " + process.arch') $revision $(shasum -a 256 package-lock.json)"
if [[ ! -d node_modules || ! -f apps/server/dist/index.js || ! -f apps/web/.next/BUILD_ID || ! -f "$stamp" || "$(cat "$stamp")" != "$build_key" ]]; then
  printf '%s\n' "Đang cài thư viện và chuẩn bị Fabuloki. Lần đầu có thể mất vài phút."
  npm ci --include=dev --include=optional --ignore-scripts
  npm run build
  printf '%s\n' "$build_key" > "$stamp"
fi

printf '%s\n' "Đang mở Fabuloki. Giữ cửa sổ Terminal này mở khi sử dụng."
node start/local.mjs &
app_pid=$!

for ((attempt = 0; attempt < 60; attempt++)); do
  kill -0 "$app_pid" 2>/dev/null || fail "Fabuloki đã dừng. Xem lỗi phía trên trong Terminal."
  if app_ready; then
    open "$url"
    wait "$app_pid"
    exit
  fi
  sleep 1
done
fail "Chưa mở được Fabuloki. Xem lỗi phía trên trong Terminal."
