#!/usr/bin/env bash
# 一条命令：先启动本地中间件（Postgres + Redis），再启动 enterprise 应用（gateway + web/admin）。
#
# 用法：
#   bash scripts/start-dev-with-infra.sh
#   bash scripts/start-dev-with-infra.sh --all
#   bash scripts/start-dev-with-infra.sh --ui=stream
#   bash scripts/start-dev-with-infra.sh --infra-only
#   bash scripts/start-dev-with-infra.sh --down

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTERPRISE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$ENTERPRISE_DIR/deploy/docker-compose/dev.yml"

INFRA_ONLY=0
SKIP_INFRA=0
DOWN_ONLY=0
APP_ARGS=()

print_help() {
  cat <<'EOF'
start-dev-with-infra.sh — 本地开发一键启动（中间件 + 应用）

用法：
  bash scripts/start-dev-with-infra.sh [选项]

选项：
  --all                 透传给 start-dev.sh（enterprise + customers）
  --ui=tui|stream       透传给 start-dev.sh
  --infra-only          仅启动 Postgres + Redis，不启动应用
  --skip-infra          跳过中间件启动，直接启动应用
  --down                仅关闭 Postgres + Redis（不启动应用）
  -h, --help            显示帮助
EOF
}

for arg in "$@"; do
  case "$arg" in
    --infra-only) INFRA_ONLY=1 ;;
    --skip-infra) SKIP_INFRA=1 ;;
    --down) DOWN_ONLY=1 ;;
    --all|--ui=tui|--ui=stream) APP_ARGS+=("$arg") ;;
    -h|--help) print_help; exit 0 ;;
    *)
      echo "[start-dev-with-infra] 未知参数: $arg" >&2
      exit 2
      ;;
  esac
done

if [ "$DOWN_ONLY" -eq 1 ]; then
  echo "[start-dev-with-infra] stopping middleware containers..."
  docker compose -f "$COMPOSE_FILE" down
  echo "[start-dev-with-infra] done."
  exit 0
fi

if [ "$SKIP_INFRA" -eq 0 ]; then
  echo "[start-dev-with-infra] booting middleware containers (postgres + redis)..."
  docker compose -f "$COMPOSE_FILE" up -d postgres redis

  echo "[start-dev-with-infra] waiting postgres health..."
  for i in $(seq 1 60); do
    pg_state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' agenticx-postgres-dev 2>/dev/null || true)"
    if [ "$pg_state" = "healthy" ]; then
      echo "[start-dev-with-infra] postgres ready"
      break
    fi
    if [ "$i" -eq 60 ]; then
      echo "[start-dev-with-infra] postgres not ready after 60s" >&2
      exit 1
    fi
    sleep 1
  done

  echo "[start-dev-with-infra] waiting redis health..."
  for i in $(seq 1 60); do
    redis_state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' agenticx-redis-dev 2>/dev/null || true)"
    if [ "$redis_state" = "healthy" ]; then
      echo "[start-dev-with-infra] redis ready"
      break
    fi
    if [ "$i" -eq 60 ]; then
      echo "[start-dev-with-infra] redis not ready after 60s" >&2
      exit 1
    fi
    sleep 1
  done
else
  echo "[start-dev-with-infra] skip infra startup"
fi

if [ "$INFRA_ONLY" -eq 1 ]; then
  echo "[start-dev-with-infra] infra-only mode done."
  exit 0
fi

echo "[start-dev-with-infra] starting application stack..."
# 兼容 bash 的 set -u：APP_ARGS 为空数组时不能直接 "${APP_ARGS[@]}"，
# 用 ${var+expansion} 形式做存在性保护，避免 "unbound variable" 报错。
exec bash "$ENTERPRISE_DIR/scripts/start-dev.sh" ${APP_ARGS[@]+"${APP_ARGS[@]}"}
