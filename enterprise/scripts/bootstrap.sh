#!/usr/bin/env bash
# AgenticX Enterprise — 一键环境初始化
# 适用于本机开发（macOS/Linux）与企业服务器（Linux）
#
# 用法：
#   bash scripts/bootstrap.sh                   # 默认 local 模式（启 docker + 生成开发密钥）
#   bash scripts/bootstrap.sh --mode=server     # server 模式（不起 docker，要求外部提供 DATABASE_URL / 密钥 / 密码）
#   bash scripts/bootstrap.sh --reset-db        # 清库后重建（危险，仅限开发）
#   bash scripts/bootstrap.sh --skip-docker     # 即使 local 模式也不起 docker（本地已有 pg）
#
# 运行后仍需启动服务：
#   bash scripts/start-dev.sh

set -euo pipefail

#################################
# 0. 参数解析 & 路径
#################################
MODE="local"
RESET_DB=0
SKIP_DOCKER=0
for arg in "$@"; do
  case "$arg" in
    --mode=local)  MODE="local" ;;
    --mode=server) MODE="server" ;;
    --reset-db)    RESET_DB=1 ;;
    --skip-docker) SKIP_DOCKER=1 ;;
    -h|--help)
      sed -n '1,20p' "$0"; exit 0 ;;
    *)
      echo "[bootstrap] unknown arg: $arg" >&2; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTERPRISE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$ENTERPRISE_DIR/.." && pwd)"
ENV_FILE="$ENTERPRISE_DIR/.env.local"
SECRETS_DIR="$ENTERPRISE_DIR/.local-secrets"
COMPOSE_FILE="$ENTERPRISE_DIR/deploy/docker-compose/dev.yml"

#################################
# 1. 工具函数
#################################
C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'
C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_BLUE=$'\033[34m'

# 所有用户提示一律走 stderr，避免被 $(...) 捕获污染返回值
log()  { printf "%s==>%s %s\n" "$C_BLUE" "$C_RESET" "$*" >&2; }
ok()   { printf "%s✓%s %s\n" "$C_GREEN" "$C_RESET" "$*" >&2; }
warn() { printf "%s!%s %s\n" "$C_YELLOW" "$C_RESET" "$*" >&2; }
err()  { printf "%s✗%s %s\n" "$C_RED" "$C_RESET" "$*" >&2; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { err "missing dependency: $1"; exit 1; }
}

# 判断是否可以交互：直接看 /dev/tty 是否可读可写
# 这样即便函数在 $(...) 里被调用（stdout 被管道替换），依然能正确识别
has_tty() { [ -r /dev/tty ] && [ -w /dev/tty ]; }

prompt_secret() {
  local var_name="$1" label="$2" min_len="${3:-14}"
  if ! has_tty; then
    err "$var_name is required (non-interactive). Please export $var_name and re-run."
    exit 1
  fi
  local value value2
  while :; do
    printf "%s%s%s: " "$C_BOLD" "$label" "$C_RESET" > /dev/tty
    IFS= read -r -s value < /dev/tty
    printf '\n' > /dev/tty
    if [ "${#value}" -lt "$min_len" ]; then
      warn "至少需要 ${min_len} 位，重试"
      continue
    fi
    if ! printf '%s' "$value" | grep -q '[a-z]' \
      || ! printf '%s' "$value" | grep -q '[A-Z]' \
      || ! printf '%s' "$value" | grep -q '[0-9]' \
      || ! printf '%s' "$value" | grep -q '[^A-Za-z0-9]'; then
      warn "需同时包含大写/小写/数字/符号，重试"
      continue
    fi
    printf "%s再输一次%s: " "$C_BOLD" "$C_RESET" > /dev/tty
    IFS= read -r -s value2 < /dev/tty
    printf '\n' > /dev/tty
    [ "$value" = "$value2" ] && break
    warn "两次不一致，重试"
  done
  # 仅此一条写到 stdout，供 $(...) 捕获
  printf '%s' "$value"
}

random_hex() {
  # 生成指定字节数的 hex（默认 32 字节 = 64 hex）
  local n="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$n"
  else
    head -c "$((n*2))" /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c "$((n*2))"
  fi
}

#################################
# 2. 预检
#################################
log "Mode: $C_BOLD$MODE$C_RESET   Enterprise dir: $ENTERPRISE_DIR"

need_cmd node
need_cmd pnpm
need_cmd go
need_cmd openssl
if [ "$MODE" = "local" ] && [ "$SKIP_DOCKER" -eq 0 ]; then
  need_cmd docker
  docker compose version >/dev/null 2>&1 || { err "需要 docker compose v2"; exit 1; }
fi

NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+)\..*/\1/')"
[ "$NODE_MAJOR" -ge 20 ] || { err "Node.js ≥ 20 required, got $(node -v)"; exit 1; }
ok "preflight passed"

#################################
# 3. 处理 .env.local
#################################
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR" 2>/dev/null || true

# 如存在就源之，便于增量补齐
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
  ok "loaded existing $ENV_FILE"
else
  log "$ENV_FILE not found, creating..."
fi

# --- 3.1 DATABASE_URL ---
if [ -z "${DATABASE_URL:-}" ]; then
  if [ "$MODE" = "local" ]; then
    DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/agenticx'
    ok "default DATABASE_URL = $DATABASE_URL"
  else
    err "server 模式必须外部提供 DATABASE_URL（例如云上 Postgres 连接串）"
    exit 1
  fi
fi

# --- 3.2 ADMIN_CONSOLE_SESSION_SECRET ---
if [ -z "${ADMIN_CONSOLE_SESSION_SECRET:-}" ]; then
  generated_session_secret="$(random_hex 32)"
  printf -v ADMIN_CONSOLE_SESSION_SECRET "%s" "$generated_session_secret"
  unset generated_session_secret
  ok "generated ADMIN_CONSOLE_SESSION_SECRET (64 hex)"
fi

# --- 3.3 ADMIN_CONSOLE_LOGIN_EMAIL / PASSWORD ---
: "${ADMIN_CONSOLE_LOGIN_EMAIL:=owner@agenticx.local}"

if [ -z "${ADMIN_CONSOLE_LOGIN_PASSWORD:-}" ]; then
  warn "未设置 ADMIN_CONSOLE_LOGIN_PASSWORD（后台管理员登录密码）"
  echo "    建议规则：≥14 位，且包含大写 / 小写 / 数字 / 符号" >&2
  prompted_admin_password="$(prompt_secret ADMIN_CONSOLE_LOGIN_PASSWORD '后台登录密码' 14)"
  printf -v ADMIN_CONSOLE_LOGIN_PASSWORD "%s" "$prompted_admin_password"
  unset prompted_admin_password
fi

# --- 3.4 前台 dev bootstrap 种子账号密码 ---
if [ "$MODE" = "local" ]; then
  : "${ENABLE_DEV_BOOTSTRAP:=true}"
  : "${DEFAULT_TENANT_ID:=01J00000000000000000000001}"
  : "${DEFAULT_DEPT_ID:=01J00000000000000000000003}"
  if [ -z "${AUTH_DEV_OWNER_PASSWORD:-}" ]; then
    warn "未设置 AUTH_DEV_OWNER_PASSWORD（前台种子 owner 密码）"
    echo "    可与后台登录密码不同；同样要求 ≥14 位 + 四类字符" >&2
    prompted_owner_password="$(prompt_secret AUTH_DEV_OWNER_PASSWORD '前台种子 owner 密码' 14)"
    printf -v AUTH_DEV_OWNER_PASSWORD "%s" "$prompted_owner_password"
    unset prompted_owner_password
  fi
else
  : "${ENABLE_DEV_BOOTSTRAP:=false}"
fi

# --- 3.5 JWT 密钥对 ---
if [ -z "${AUTH_JWT_PRIVATE_KEY:-}" ] || [ -z "${AUTH_JWT_PUBLIC_KEY:-}" ]; then
  if [ "$MODE" = "local" ]; then
    if [ ! -f "$SECRETS_DIR/auth_private.pem" ] || [ ! -f "$SECRETS_DIR/auth_public.pem" ]; then
      log "generating RSA-2048 keypair at $SECRETS_DIR/"
      openssl genpkey -algorithm RSA -out "$SECRETS_DIR/auth_private.pem" -pkeyopt rsa_keygen_bits:2048 >/dev/null 2>&1
      openssl rsa -pubout -in "$SECRETS_DIR/auth_private.pem" -out "$SECRETS_DIR/auth_public.pem" >/dev/null 2>&1
      chmod 600 "$SECRETS_DIR/auth_private.pem"
      ok "keypair generated"
    else
      ok "keypair already exists"
    fi
    # 注意：PEM 多行不适合直接塞进 .env，这里改用 *_FILE 机制由 start-dev.sh 读入
    AUTH_JWT_PRIVATE_KEY_FILE="$SECRETS_DIR/auth_private.pem"
    AUTH_JWT_PUBLIC_KEY_FILE="$SECRETS_DIR/auth_public.pem"
  else
    err "server 模式必须外部提供 AUTH_JWT_PRIVATE_KEY / AUTH_JWT_PUBLIC_KEY（挂载的 PEM 内容）"
    exit 1
  fi
fi

# --- 3.6 网关地址 ---
: "${GATEWAY_BASE_URL:=http://127.0.0.1:8088}"
: "${GATEWAY_COMPLETIONS_URL:=http://127.0.0.1:8088/v1/chat/completions}"

#################################
# 4. 落盘 .env.local（不含 PEM 内容，仅存文件路径）
#################################
cat > "$ENV_FILE" <<EOF
# Generated by scripts/bootstrap.sh — 可手动增补，但 secrets 不建议提交到 git
# Mode: $MODE
DATABASE_URL='$DATABASE_URL'

ADMIN_CONSOLE_LOGIN_EMAIL='$ADMIN_CONSOLE_LOGIN_EMAIL'
ADMIN_CONSOLE_LOGIN_PASSWORD='$ADMIN_CONSOLE_LOGIN_PASSWORD'
ADMIN_CONSOLE_SESSION_SECRET='$ADMIN_CONSOLE_SESSION_SECRET'

DEFAULT_TENANT_ID='${DEFAULT_TENANT_ID:-}'
DEFAULT_DEPT_ID='${DEFAULT_DEPT_ID:-}'
ENABLE_DEV_BOOTSTRAP='${ENABLE_DEV_BOOTSTRAP}'
AUTH_DEV_OWNER_PASSWORD='${AUTH_DEV_OWNER_PASSWORD:-}'

AUTH_JWT_PRIVATE_KEY_FILE='${AUTH_JWT_PRIVATE_KEY_FILE:-}'
AUTH_JWT_PUBLIC_KEY_FILE='${AUTH_JWT_PUBLIC_KEY_FILE:-}'

GATEWAY_BASE_URL='$GATEWAY_BASE_URL'
GATEWAY_COMPLETIONS_URL='$GATEWAY_COMPLETIONS_URL'
EOF
chmod 600 "$ENV_FILE"
ok "wrote $ENV_FILE (chmod 600)"

#################################
# 5. pnpm install
#################################
log "pnpm install (workspace root)"
(cd "$ENTERPRISE_DIR" && pnpm install)
ok "pnpm install done"

#################################
# 6. docker compose（仅 local & 未 skip）
#################################
if [ "$MODE" = "local" ] && [ "$SKIP_DOCKER" -eq 0 ]; then
  if [ "$RESET_DB" -eq 1 ]; then
    warn "--reset-db: 即将销毁 postgres 数据卷"
    (cd "$(dirname "$COMPOSE_FILE")" && docker compose -f "$(basename "$COMPOSE_FILE")" down -v)
  fi
  log "starting postgres + redis via docker compose"
  (cd "$(dirname "$COMPOSE_FILE")" && docker compose -f "$(basename "$COMPOSE_FILE")" up -d postgres redis)

  # 等 pg 就绪
  log "waiting for postgres healthy..."
  for i in $(seq 1 60); do
    if docker exec agenticx-postgres-dev pg_isready -U postgres -d agenticx >/dev/null 2>&1; then
      ok "postgres is ready"
      break
    fi
    sleep 1
    if [ "$i" -eq 60 ]; then err "postgres 启动超时"; exit 1; fi
  done
else
  warn "skip docker compose step (mode=$MODE, skip-docker=$SKIP_DOCKER)"
fi

#################################
# 7. db:migrate + db:seed
#################################
export DATABASE_URL
log "running db:migrate"
(cd "$ENTERPRISE_DIR" && pnpm --filter @agenticx/db-schema db:migrate)
ok "db:migrate done"

log "running db:seed"
(cd "$ENTERPRISE_DIR" && pnpm --filter @agenticx/db-schema db:seed)
ok "db:seed done"

#################################
# 8. 结尾提示
#################################
echo
ok "bootstrap 完成"
cat <<EOF

下一步启动三端：

  ${C_BOLD}方式 A（推荐，一条命令起全部）${C_RESET}
    bash scripts/start-dev.sh

  ${C_BOLD}方式 B（分终端手动起）${C_RESET}
    # 终端 1 — 网关
    set -a; source .env.local; set +a
    export AUTH_JWT_PRIVATE_KEY="\$(cat \$AUTH_JWT_PRIVATE_KEY_FILE)"
    export AUTH_JWT_PUBLIC_KEY="\$(cat \$AUTH_JWT_PUBLIC_KEY_FILE)"
    (cd apps/gateway && go run ./cmd/gateway)

    # 终端 2 — 前后台
    set -a; source .env.local; set +a
    export AUTH_JWT_PRIVATE_KEY="\$(cat \$AUTH_JWT_PRIVATE_KEY_FILE)"
    export AUTH_JWT_PUBLIC_KEY="\$(cat \$AUTH_JWT_PUBLIC_KEY_FILE)"
    pnpm dev

访问：
  - web-portal   http://localhost:3000
  - admin-console http://localhost:3001 （账号 ${ADMIN_CONSOLE_LOGIN_EMAIL}）
  - gateway      http://127.0.0.1:8088/healthz
EOF
