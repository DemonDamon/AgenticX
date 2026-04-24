#!/usr/bin/env bash
# 本机一条命令拉起：gateway + web-portal + admin-console
# 前置：已执行 scripts/bootstrap.sh 至少一次，存在 .env.local + .local-secrets/*.pem
#
# 默认只拉起 enterprise 的 2 个 Next 应用（web-portal + admin-console）。
# 如需同时拉起 customers/*（如 hechuang）请加 --all。
# Ctrl+C 会清理所有子进程。
#
# 用法：
#   bash scripts/start-dev.sh              # 仅 enterprise（推荐日常）
#   bash scripts/start-dev.sh --all        # enterprise + customers/*
#   bash scripts/start-dev.sh --ui=stream  # 关闭 Turbo TUI，输出纯日志
#   bash scripts/start-dev.sh -h           # 帮助

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTERPRISE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ENTERPRISE_DIR/.env.local"

ALL_APPS=0
TURBO_UI="tui"

print_help() {
  cat <<'EOF'
start-dev.sh — 本机启动 enterprise 一条命令

用法：
  bash scripts/start-dev.sh [选项]

选项：
  --all                 同时拉起 customers/* 的客户 app（默认仅 enterprise）
  --ui=tui | --ui=stream
                        Turbo UI 模式：tui（默认，可上下键切任务）
                        或 stream（无交互，纯日志滚动，方便看 Ctrl+C 与日志）
  -h, --help            显示本帮助

端口：
  web-portal     http://localhost:3000
  admin-console  http://localhost:3001
  gateway        http://localhost:8088/healthz
  (--all 时) customer-hechuang portal  :3100
  (--all 时) customer-hechuang admin   :3101
EOF
}

for arg in "$@"; do
  case "$arg" in
    --all) ALL_APPS=1 ;;
    --ui=tui) TURBO_UI="tui" ;;
    --ui=stream) TURBO_UI="stream" ;;
    -h|--help) print_help; exit 0 ;;
    *) echo "[start-dev] 未知参数: $arg (可用 --help 查看)" >&2; exit 2 ;;
  esac
done

if [ ! -f "$ENV_FILE" ]; then
  echo "[start-dev] $ENV_FILE 不存在，先运行：bash scripts/bootstrap.sh" >&2
  exit 1
fi

# 1) 载入 .env.local
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# 2) PEM -> 环境变量（PEM 多行不能直接写进 .env.local）
if [ -n "${AUTH_JWT_PRIVATE_KEY_FILE:-}" ] && [ -f "$AUTH_JWT_PRIVATE_KEY_FILE" ]; then
  AUTH_JWT_PRIVATE_KEY="$(cat "$AUTH_JWT_PRIVATE_KEY_FILE")"; export AUTH_JWT_PRIVATE_KEY
fi
if [ -n "${AUTH_JWT_PUBLIC_KEY_FILE:-}" ] && [ -f "$AUTH_JWT_PUBLIC_KEY_FILE" ]; then
  AUTH_JWT_PUBLIC_KEY="$(cat "$AUTH_JWT_PUBLIC_KEY_FILE")"; export AUTH_JWT_PUBLIC_KEY
fi

if [ -z "${AUTH_JWT_PRIVATE_KEY:-}" ] || [ -z "${AUTH_JWT_PUBLIC_KEY:-}" ]; then
  echo "[start-dev] 缺少 AUTH_JWT_PRIVATE_KEY / AUTH_JWT_PUBLIC_KEY，请检查 .env.local 与 .local-secrets/" >&2
  exit 1
fi

# 3) 子进程管理
PIDS=()
cleanup() {
  echo; echo "[start-dev] stopping services..."
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# 4) 拉起 gateway
echo "[start-dev] booting gateway (:8088) ..."
(
  cd "$ENTERPRISE_DIR/apps/gateway"
  exec go run ./cmd/gateway
) &
PIDS+=("$!")

for i in $(seq 1 30); do
  if curl -fsS "${GATEWAY_BASE_URL:-http://127.0.0.1:8088}/healthz" >/dev/null 2>&1; then
    echo "[start-dev] gateway ready"
    break
  fi
  sleep 1
done

# 5) 拉起 Next 应用（默认仅 enterprise，--all 时含 customers/*）
TURBO_ARGS=(run dev "--ui=$TURBO_UI")
if [ "$ALL_APPS" -eq 0 ]; then
  TURBO_ARGS+=(
    --filter=@agenticx/app-web-portal
    --filter=@agenticx/app-admin-console
  )
  SCOPE="enterprise only (web-portal :3000 + admin-console :3001)"
else
  SCOPE="ALL workspace apps (enterprise + customers/*)"
fi

echo "[start-dev] booting Next apps → $SCOPE"
(
  cd "$ENTERPRISE_DIR"
  exec pnpm exec turbo "${TURBO_ARGS[@]}"
) &
PIDS+=("$!")

echo
echo "[start-dev] all services launching. Ctrl+C 结束。"
echo "  - web-portal    http://localhost:3000"
echo "  - admin-console http://localhost:3001"
echo "  - gateway       ${GATEWAY_BASE_URL:-http://127.0.0.1:8088}/healthz"
if [ "$ALL_APPS" -eq 1 ]; then
  echo "  - hechuang portal  http://localhost:3100"
  echo "  - hechuang admin   http://localhost:3101"
fi
echo "  (UI: $TURBO_UI)  ← 默认 tui 可上下键切任务；卡顿可改 --ui=stream"
wait
