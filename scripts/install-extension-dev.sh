#!/usr/bin/env bash
# SP6 · local dev install for the AGX browser extension (Chrome/Edge/Chromium/Brave, macOS user-level).
#
# What this does (idempotent — safe to re-run):
#   1. writes the NM host wrapper  ~/.agenticx/agx-nm-bridge-host.sh
#      (execs a system node on the in-repo scripts/nm-bridge-shim.mjs — same
#      bytes desktop/electron/native-messaging-host.ts produces in "dev"
#      mode, so the two paths never fight over the files);
#   2. writes the NM host manifest  com.agenticx.bridge.json into the chosen
#      browser's NativeMessagingHosts dir, path = wrapper, allowed_origins =
#      the fixed unpacked extension ID (locked by "key" in extension/manifest.json);
#   3. optional shim self-test via scripts/e2e/test-nm-shim.mjs (skipped when
#      the desktop bridge already owns the socket — the test binds its own
#      echo server on that path and must not shoot down a live bridge);
#   4. prints the Chrome developer-mode load steps.
#
# Usage:
#   scripts/install-extension-dev.sh                # Chrome (default)
#   scripts/install-extension-dev.sh --browser edge # edge | chromium | brave
#   scripts/install-extension-dev.sh --no-self-test
#
# Author: Damon Li
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

HOST_NAME="com.agenticx.bridge"
EXTENSION_ID="kajgkmohjdflaidencpfmebbjibfieka" # locked by manifest "key" (SP1 plan §5.1)
BROWSER="chrome"
SELF_TEST="1"

for arg in "$@"; do
  case "${arg}" in
    --browser)
      ;;
    --browser=*)
      BROWSER="${arg#--browser=}"
      ;;
    chrome | edge | chromium | brave)
      # tolerate the space-separated form: --browser chrome
      BROWSER="${arg}"
      ;;
    --no-self-test)
      SELF_TEST="0"
      ;;
    *)
      echo "unknown option: ${arg}" >&2
      exit 2
      ;;
  esac
done

case "${BROWSER}" in
  chrome)
    NM_DIR="${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    BROWSER_LABEL="Google Chrome"
    ;;
  edge)
    NM_DIR="${HOME}/Library/Application Support/Microsoft/Edge/NativeMessagingHosts"
    BROWSER_LABEL="Microsoft Edge"
    ;;
  chromium)
    NM_DIR="${HOME}/Library/Application Support/Chromium/NativeMessagingHosts"
    BROWSER_LABEL="Chromium"
    ;;
  brave)
    NM_DIR="${HOME}/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    BROWSER_LABEL="Brave"
    ;;
  *)
    echo "unsupported browser: ${BROWSER} (chrome | edge | chromium | brave)" >&2
    exit 2
    ;;
esac

# --- resolve a system node (NM host runs it; no bundled runtime in dev mode) ---
NODE_BIN="$(command -v node || true)"
if [ -z "${NODE_BIN}" ]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "${candidate}" ]; then
      NODE_BIN="${candidate}"
      break
    fi
  done
fi
if [ -z "${NODE_BIN}" ]; then
  echo "ERROR: node not found — install Node.js first (brew install node)." >&2
  exit 1
fi

SHIM_PATH="${REPO_ROOT}/scripts/nm-bridge-shim.mjs"
if [ ! -f "${SHIM_PATH}" ]; then
  echo "ERROR: NM shim missing: ${SHIM_PATH}" >&2
  exit 1
fi

AGX_HOME_DIR="${HOME}/.agenticx"
WRAPPER_PATH="${AGX_HOME_DIR}/agx-nm-bridge-host.sh"
NM_SOCKET="${AGX_HOME_DIR}/nm-bridge.sock"

# --- 1. NM host wrapper (path target of the manifest; must be executable) ---
mkdir -p "${AGX_HOME_DIR}"
printf '#!/bin/sh\nexec "%s" "%s" "$@"\n' "${NODE_BIN}" "${SHIM_PATH}" >"${WRAPPER_PATH}"
chmod 755 "${WRAPPER_PATH}"
echo "[install-extension-dev] wrapper   ${WRAPPER_PATH}"
echo "[install-extension-dev]            -> node ${NODE_BIN}"
echo "[install-extension-dev]            -> shim  ${SHIM_PATH}"

# --- 2. NM host manifest (allowed_origins = fixed unpacked extension ID) ---
mkdir -p "${NM_DIR}"
MANIFEST_PATH="${NM_DIR}/${HOST_NAME}.json"
cat >"${MANIFEST_PATH}" <<EOF
{
  "name": "${HOST_NAME}",
  "description": "AgenticX browser extension bridge",
  "path": "${WRAPPER_PATH}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://${EXTENSION_ID}/"
  ]
}
EOF
echo "[install-extension-dev] manifest  ${MANIFEST_PATH}"

# --- 3. shim self-test (echo server; skipped when a live bridge owns the socket) ---
if [ "${SELF_TEST}" = "1" ]; then
  if [ -S "${NM_SOCKET}" ]; then
    echo "[install-extension-dev] self-test skipped: ${NM_SOCKET} is live (desktop bridge running?)"
  else
    echo "[install-extension-dev] running shim frame-protocol self-test..."
    if node "${REPO_ROOT}/scripts/e2e/test-nm-shim.mjs"; then
      echo "[install-extension-dev] self-test OK (shim speaks the NM frame protocol)"
    else
      echo "[install-extension-dev] WARN: shim self-test failed — see output above" >&2
    fi
  fi
fi

# --- 4. developer-mode load steps ---
EXTENSION_DIR="${REPO_ROOT}/extension"
cat <<EOF

AGX 浏览器扩展（本地开发模式）已注册 NM host，接下来在 ${BROWSER_LABEL} 里加载扩展：

  1. 打开 chrome://extensions
  2. 右上角打开「开发者模式」
  3. 点「加载已解压的扩展程序」，选择目录：
       ${EXTENSION_DIR}
  4. 固定扩展到工具栏，打开 AGX 桌面端（bridge 会随 desktop 启动）：
       cd "${REPO_ROOT}/desktop" && npm run dev
  5. 点扩展图标 → 「连接 AGX 桌面端」测试 NM 通道（RTT 应 < 50ms）
  6. 右键扩展图标 → 「选项」：
       - 用「划词发给 AGX」时按站点授权注入；
       - 需要 AGX 截图能力时点「启用浏览器截图」（可选 <all_urls> 授权，可随时关闭）。

提示：extension/ 目录改动后回 chrome://extensions 点扩展卡片上的刷新 ↻ 即可；
      卸载用 scripts/uninstall-extension-dev.sh。
EOF
