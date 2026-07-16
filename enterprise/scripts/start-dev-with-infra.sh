#!/usr/bin/env bash
# 一条命令：先启动本地中间件（Postgres|MySQL + Redis），再启动 enterprise 应用。
#
# 用法：
#   bash scripts/start-dev-with-infra.sh
#   bash scripts/start-dev-with-infra.sh --db=mysql
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
DB_DIALECT="postgresql"
APP_ARGS=()

print_help() {
  cat <<'EOF'
start-dev-with-infra.sh — 本地开发一键启动（中间件 + 应用）

用法：
  bash scripts/start-dev-with-infra.sh [选项]

选项：
  --db=postgresql|mysql  选择业务数据库（默认 postgresql）
  --all                  透传给 start-dev.sh（enterprise + customers）
  --ui=tui|stream        透传给 start-dev.sh
  --infra-only           仅启动所选数据库 + Redis，不启动应用
  --skip-infra           跳过中间件启动，直接启动应用
  --down                 仅关闭中间件（不启动应用）
  -h, --help             显示帮助
EOF
}

for arg in "$@"; do
  case "$arg" in
    --db=postgresql|--db=postgres) DB_DIALECT="postgresql" ;;
    --db=mysql) DB_DIALECT="mysql" ;;
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

if [[ "$DB_DIALECT" != "postgresql" && "$DB_DIALECT" != "mysql" ]]; then
  echo "[start-dev-with-infra] 非法 --db=$DB_DIALECT（仅 postgresql|mysql）" >&2
  exit 2
fi

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "[start-dev-with-infra] 未找到 docker CLI，请先安装 Docker Desktop。" >&2
    exit 1
  fi
  local pid i exit_code=1
  env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
    docker info >/dev/null 2>&1 &
  pid=$!
  for i in $(seq 1 20); do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid"
      exit_code=$?
      if [ "$exit_code" -eq 0 ]; then
        return 0
      fi
      echo "[start-dev-with-infra] docker daemon 不可用（docker info 退出 $exit_code）。" >&2
      _docker_fail_hints
      exit 1
    fi
    sleep 1
  done
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  echo "[start-dev-with-infra] docker daemon 20s 内无响应。" >&2
  _docker_fail_hints
  exit 1
}

_docker_fail_hints() {
  echo "[start-dev-with-infra] 详见 enterprise/docs/development/troubleshooting.md" >&2
}

docker_cmd() {
  env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
    docker "$@"
}

compose_up_db_service() {
  if [ "$DB_DIALECT" = "mysql" ]; then
    echo "mysql"
  else
    echo "postgres"
  fi
}

if [ "$DOWN_ONLY" -eq 1 ]; then
  require_docker
  echo "[start-dev-with-infra] stopping middleware containers..."
  docker_cmd compose -f "$COMPOSE_FILE" --profile postgresql --profile mysql down
  echo "[start-dev-with-infra] done."
  exit 0
fi

if [ "$SKIP_INFRA" -eq 0 ]; then
  require_docker
  DB_SERVICE="$(compose_up_db_service)"
  echo "[start-dev-with-infra] booting middleware (db=$DB_DIALECT service=$DB_SERVICE + redis)..."
  docker_cmd compose --progress plain -f "$COMPOSE_FILE" --profile "$DB_DIALECT" up -d "$DB_SERVICE" redis

  if [ "$DB_DIALECT" = "mysql" ]; then
    echo "[start-dev-with-infra] waiting mysql health..."
    for i in $(seq 1 90); do
      state="$(docker_cmd inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' agenticx-mysql-dev 2>/dev/null || true)"
      if [ "$state" = "healthy" ]; then
        echo "[start-dev-with-infra] mysql ready"
        break
      fi
      if [ "$i" -eq 90 ]; then
        echo "[start-dev-with-infra] mysql not ready after 90s" >&2
        exit 1
      fi
      sleep 1
    done
    export DATABASE_DIALECT=mysql
    export DATABASE_URL="${DATABASE_URL:-mysql://agenticx:agenticx@127.0.0.1:3306/agenticx}"
  else
    echo "[start-dev-with-infra] waiting postgres health..."
    for i in $(seq 1 60); do
      state="$(docker_cmd inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' agenticx-postgres-dev 2>/dev/null || true)"
      if [ "$state" = "healthy" ]; then
        echo "[start-dev-with-infra] postgres ready"
        break
      fi
      if [ "$i" -eq 60 ]; then
        echo "[start-dev-with-infra] postgres not ready after 60s" >&2
        exit 1
      fi
      sleep 1
    done
    export DATABASE_DIALECT=postgresql
    export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/agenticx}"
  fi

  echo "[start-dev-with-infra] waiting redis health..."
  for i in $(seq 1 60); do
    redis_state="$(docker_cmd inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' agenticx-redis-dev 2>/dev/null || true)"
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
  echo "[start-dev-with-infra] infra-only mode done (DATABASE_DIALECT=${DATABASE_DIALECT:-unset})."
  exit 0
fi

echo "[start-dev-with-infra] starting application stack..."
exec bash "$ENTERPRISE_DIR/scripts/start-dev.sh" ${APP_ARGS[@]+"${APP_ARGS[@]}"}
