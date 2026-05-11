#!/usr/bin/env bash
# 将本机 enterprise 暴露到公网（演示用）。请先在本机终端配置 ngrok authtoken（仅需一次）：
#   ngrok config add-authtoken <YOUR_AUTHTOKEN>
# 配置文件默认路径（macOS）：~/Library/Application Support/ngrok/ngrok.yml
# 然后另开终端启动 enterprise：bash scripts/start-dev.sh
# 再运行本脚本。
#
# 用法：
#   bash scripts/ngrok-demo.sh           # 仅穿透 web-portal（3000），兼容免费档单隧道
#   bash scripts/ngrok-demo.sh --all     # 同时穿透前台 3000 + 后台 3001（需账号支持多 endpoint）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v ngrok >/dev/null 2>&1; then
  echo "[ngrok-demo] 未找到 ngrok。请先安装：brew install ngrok/ngrok/ngrok" >&2
  exit 1
fi

MODE="${1:-}"

case "${MODE}" in
  -h|--help|"")
    if [[ "${MODE}" == "-h" ]] || [[ "${MODE}" == "--help" ]]; then
      sed -n '2,12p' "$0" | sed 's/^# //'
      exit 0
    fi
    echo "[ngrok-demo] 启动单隧道 → 127.0.0.1:3000（web-portal）"
    exec ngrok http 3000
    ;;
  --all)
    echo "[ngrok-demo] 按 ~/Library/Application Support/ngrok/ngrok.yml 启动全部 endpoint（若无权限会报错，请改单隧道或升级 ngrok）"
    exec ngrok start --all
    ;;
  *)
    echo "[ngrok-demo] 未知参数: ${MODE}（可用 --all 或 --help）" >&2
    exit 2
    ;;
esac
