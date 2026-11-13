#!/usr/bin/env bash
# SP6 · remove the local dev NM host registration written by
# scripts/install-extension-dev.sh (all browsers at once, missing files OK).
# Does NOT touch the desktop's ~/.agenticx sockets/logs — only NM host files.
#
# Usage: scripts/uninstall-extension-dev.sh
#
# Author: Damon Li
set -euo pipefail

HOST_NAME="com.agenticx.bridge"
AGX_HOME_DIR="${HOME}/.agenticx"

removed=0

for target in \
  "${AGX_HOME_DIR}/agx-nm-bridge-host.sh" \
  "${AGX_HOME_DIR}/agx-nm-bridge-host.cmd" \
  "${AGX_HOME_DIR}/nm-hosts/${HOST_NAME}.json" \
  "${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts/${HOST_NAME}.json" \
  "${HOME}/Library/Application Support/Microsoft/Edge/NativeMessagingHosts/${HOST_NAME}.json" \
  "${HOME}/Library/Application Support/Chromium/NativeMessagingHosts/${HOST_NAME}.json" \
  "${HOME}/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/${HOST_NAME}.json"; do
  if [ -e "${target}" ]; then
    rm -f "${target}"
    echo "[uninstall-extension-dev] removed ${target}"
    removed=$((removed + 1))
  fi
done

if [ "${removed}" -eq 0 ]; then
  echo "[uninstall-extension-dev] nothing to remove (NM host not registered)"
else
  echo "[uninstall-extension-dev] done (${removed} file(s) removed)"
fi

echo
echo "别忘了在 Chrome 的 chrome://extensions 里移除已加载的解压扩展（AGX Bridge）。"
echo "Windows 生产安装的注册表键（HKCU\\...\\NativeMessagingHosts\\${HOST_NAME}）由桌面端 uninstallNmHost() 清理。"
