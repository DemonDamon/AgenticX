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

if [ -z "${DATABASE_URL:-}" ]; then
  export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/agenticx'
  echo "[start-dev] DATABASE_URL 未设置，回退到默认本地地址: $DATABASE_URL"
fi

# 2) PEM -> 环境变量（PEM 多行不能直接写进 .env.local）
if [ -n "${AUTH_JWT_PRIVATE_KEY_FILE:-}" ] && [ -f "$AUTH_JWT_PRIVATE_KEY_FILE" ]; then
  AUTH_JWT_PRIVATE_KEY="$(cat "$AUTH_JWT_PRIVATE_KEY_FILE")"; export AUTH_JWT_PRIVATE_KEY
fi
if [ -n "${AUTH_JWT_PUBLIC_KEY_FILE:-}" ] && [ -f "$AUTH_JWT_PUBLIC_KEY_FILE" ]; then
  AUTH_JWT_PUBLIC_KEY="$(cat "$AUTH_JWT_PUBLIC_KEY_FILE")"; export AUTH_JWT_PUBLIC_KEY
fi

# 3) Gateway internal token（与 admin internal API 共用，不落盘到 .env.local 明文）
if [ -n "${GATEWAY_INTERNAL_TOKEN_FILE:-}" ] && [ -f "$GATEWAY_INTERNAL_TOKEN_FILE" ]; then
  GATEWAY_INTERNAL_TOKEN="$(cat "$GATEWAY_INTERNAL_TOKEN_FILE")"; export GATEWAY_INTERNAL_TOKEN
elif [ -n "${GATEWAY_INTERNAL_TOKEN:-}" ]; then
  export GATEWAY_INTERNAL_TOKEN
fi

if [ -z "${AUTH_JWT_PRIVATE_KEY:-}" ] || [ -z "${AUTH_JWT_PUBLIC_KEY:-}" ]; then
  echo "[start-dev] 缺少 AUTH_JWT_PRIVATE_KEY / AUTH_JWT_PUBLIC_KEY，请检查 .env.local 与 .local-secrets/" >&2
  exit 1
fi

if [ -z "${GATEWAY_INTERNAL_TOKEN:-}" ] || [ -z "${GATEWAY_REMOTE_PROVIDERS_URL:-}" ]; then
  echo "[start-dev] 警告：未配置 GATEWAY_INTERNAL_TOKEN（或 GATEWAY_INTERNAL_TOKEN_FILE）/ GATEWAY_REMOTE_PROVIDERS_URL；" >&2
  echo "          gateway 将无法从 admin PG 读取模型厂商配置（前台聊天会回退 mock）。" >&2
  echo "          请重新运行：bash scripts/bootstrap.sh" >&2
fi

# 3) 可选自动迁移：仅本地 DB 默认开启，避免共享库被意外改 schema。
AUTO_MIGRATE="${AGX_AUTO_DB_MIGRATE:-1}"
if [[ "$AUTO_MIGRATE" = "1" ]]; then
  if [[ "$DATABASE_URL" == *"127.0.0.1"* || "$DATABASE_URL" == *"localhost"* ]]; then
    echo "[start-dev] running local database migrations ..."
    (
      cd "$ENTERPRISE_DIR"
      pnpm --filter @agenticx/db-schema db:migrate
      pnpm migrate:legacy-runtime
    )
  else
    echo "[start-dev] skip auto migration (non-local DATABASE_URL)."
  fi
else
  echo "[start-dev] skip auto migration (AGX_AUTO_DB_MIGRATE=$AUTO_MIGRATE)."
fi

# 4) 子进程管理（Ctrl+C 须能一次退出；turbo/next 会起多层子进程，只 kill 父 PID 不够）
PIDS=()
SHUTTING_DOWN=0

kill_process_tree() {
  local pid="$1"
  local child
  kill -0 "$pid" 2>/dev/null || return 0
  while IFS= read -r child; do
    [ -n "$child" ] && kill_process_tree "$child"
  done < <(pgrep -P "$pid" 2>/dev/null || true)
  kill -TERM "$pid" 2>/dev/null || true
}

force_kill_process_tree() {
  local pid="$1"
  local child
  kill -0 "$pid" 2>/dev/null || return 0
  while IFS= read -r child; do
    [ -n "$child" ] && force_kill_process_tree "$child"
  done < <(pgrep -P "$pid" 2>/dev/null || true)
  kill -KILL "$pid" 2>/dev/null || true
}

cleanup() {
  if [ "$SHUTTING_DOWN" -eq 1 ]; then
    for pid in "${PIDS[@]:-}"; do
      force_kill_process_tree "$pid"
    done
    exit 130
  fi
  SHUTTING_DOWN=1
  trap - INT TERM EXIT
  echo
  echo "[start-dev] stopping services... (再按一次 Ctrl+C 强制结束)"
  for pid in "${PIDS[@]:-}"; do
    kill_process_tree "$pid"
  done
  sleep 0.5
  for pid in "${PIDS[@]:-}"; do
    force_kill_process_tree "$pid"
  done
  wait 2>/dev/null || true
  exit 130
}
trap cleanup INT TERM

wait_for_http() {
  local label="$1"
  local url="$2"
  local max_attempts="${3:-60}"
  for i in $(seq 1 "$max_attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "[start-dev] $label ready"
      return 0
    fi
    sleep 1
  done
  echo "[start-dev] $label not ready after ${max_attempts}s" >&2
  return 1
}

# 5) 先拉起 Next 应用（gateway 依赖 admin internal API，须 admin 就绪后再启 gateway）
# 用 pnpm --parallel + --filter，不用 turbo run dev：本机若 clone 了 customers/*，
# pnpm workspace 会链到 enterprise 目录外，turbo 2.9+ discovery 会直接失败。
PNPM_DEV_FILTERS=(
  --filter=@agenticx/app-web-portal
  --filter=@agenticx/app-admin-console
)
if [ "$ALL_APPS" -eq 0 ]; then
  SCOPE="enterprise only (web-portal :3000 + admin-console :3001)"
else
  PNPM_DEV_FILTERS+=(
    --filter=@customer-hechuang/portal
    --filter=@customer-hechuang/admin
  )
  SCOPE="ALL workspace apps (enterprise + customers/*)"
fi

echo "[start-dev] booting Next apps → $SCOPE"
if [ "$TURBO_UI" = "tui" ]; then
  echo "[start-dev] 提示：pnpm parallel 无 Turbo TUI；要看纯日志可加 --ui=stream（行为相同）。"
fi
(
  cd "$ENTERPRISE_DIR"
  exec pnpm "${PNPM_DEV_FILTERS[@]}" --parallel dev
) &
PIDS+=("$!")

# 根路径 / 会 307 重定向，curl -f 可能判失败；用稳定 200 页面探活
wait_for_http "admin-console" "http://127.0.0.1:3001/login" 90 || true
wait_for_http "web-portal" "http://127.0.0.1:3000/auth" 90 || true

# 6) admin 就绪后再拉起 gateway（避免 policy/providers 远程拉取 connection refused）
# Go 访问 https 上游时优先读 HTTP_PROXY/HTTPS_PROXY（大写）。macOS/Clash 常把大写指到
# 7890、shell 小写指到 7897，导致 proxyconnect 127.0.0.1:7890 connection refused。
# 仅对 gateway 子进程去掉失效的大写代理，保留小写 http_proxy/https_proxy（7897）。
echo "[start-dev] booting gateway (:8088) ..."
(
  cd "$ENTERPRISE_DIR/apps/gateway"
  exec env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY go run ./cmd/gateway
) &
PIDS+=("$!")

if ! wait_for_http "gateway" "${GATEWAY_BASE_URL:-http://127.0.0.1:8088}/healthz" 45; then
  echo "[start-dev] 警告：gateway 未在 45s 内就绪，前台聊天会报 Gateway request failed。" >&2
  echo "[start-dev] 请检查上方 gateway 日志（常见：admin internal 401 / 上游模型配置）。" >&2
fi

echo
echo "[start-dev] all services launching. Ctrl+C 结束（约 1s 内退出；卡住可再按一次强制杀进程树）。"
echo "  - web-portal    http://localhost:3000"
echo "  - admin-console http://localhost:3001"
echo "  - gateway       ${GATEWAY_BASE_URL:-http://127.0.0.1:8088}/healthz"
if [ -n "${GATEWAY_REMOTE_PROVIDERS_URL:-}" ]; then
  echo "    providers ← ${GATEWAY_REMOTE_PROVIDERS_URL}"
fi
if [ "$ALL_APPS" -eq 1 ]; then
  echo "  - hechuang portal  http://localhost:3100"
  echo "  - hechuang admin   http://localhost:3101"
fi
echo "  (UI: $TURBO_UI)  ← 默认 tui 可上下键切任务；卡顿可改 --ui=stream"
wait
