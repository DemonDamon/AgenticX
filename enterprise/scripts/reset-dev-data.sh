#!/usr/bin/env bash
# 一键清空本地开发数据（聊天历史 + 用量记录 + gateway 本地usage日志）
#
# 用法：
#   bash scripts/reset-dev-data.sh
#   bash scripts/reset-dev-data.sh --yes
#   bash scripts/reset-dev-data.sh --with-seed
#   bash scripts/reset-dev-data.sh --with-seed --yes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTERPRISE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ENTERPRISE_DIR/.env.local"

AUTO_YES=0
WITH_SEED=0
WITH_IAM_SEED=0

print_help() {
  cat <<'EOF'
reset-dev-data.sh — 清空本地开发数据

用法：
  bash scripts/reset-dev-data.sh [选项]

选项：
  --yes        跳过确认，直接执行
  --with-seed      清空后执行 db:seed，恢复默认租户/用户种子
  --with-iam-seed  在 --with-seed 之后额外执行 IAM 演示数据脚本（多级部门 + 4 角色 + 10 演示用户）
  -h, --help   显示帮助
EOF
}

for arg in "$@"; do
  case "$arg" in
    --yes) AUTO_YES=1 ;;
    --with-seed) WITH_SEED=1 ;;
    --with-iam-seed) WITH_IAM_SEED=1 ;;
    -h|--help) print_help; exit 0 ;;
    *)
      echo "[reset-dev-data] 未知参数: $arg" >&2
      exit 2
      ;;
  esac
done

if [ "$WITH_IAM_SEED" -eq 1 ] && [ "$WITH_SEED" -ne 1 ]; then
  echo "[reset-dev-data] --with-iam-seed 需同时指定 --with-seed（先恢复基础租户与 owner）" >&2
  exit 2
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "[reset-dev-data] $ENV_FILE 不存在，请先执行：bash scripts/bootstrap.sh" >&2
  exit 1
fi

# 载入 .env.local
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/agenticx"
  echo "[reset-dev-data] DATABASE_URL 未设置，回退到默认本地地址: $DATABASE_URL"
fi

if [ "$AUTO_YES" -ne 1 ]; then
  echo "[reset-dev-data] 将清空以下数据："
  echo "  - chat_messages"
  echo "  - chat_sessions"
  echo "  - usage_records"
  echo "  - apps/gateway/.runtime/usage.jsonl"
  echo "  - apps/gateway/.runtime/gateway/quota-usage.json"
  read -r -p "确认继续？输入 YES 继续: " answer
  if [ "$answer" != "YES" ]; then
    echo "[reset-dev-data] 已取消。"
    exit 0
  fi
fi

echo "[reset-dev-data] truncating postgres tables..."
pnpm --filter @agenticx/app-web-portal exec node -e '
  const { Client } = require("pg");
  (async () => {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const before = await c.query(
      "select (select count(*) from chat_messages)::bigint as chat_messages, " +
      "(select count(*) from chat_sessions)::bigint as chat_sessions, " +
      "(select count(*) from usage_records)::bigint as usage_records"
    );
    console.log("[reset-dev-data] before:", before.rows[0]);
    await c.query("truncate table chat_messages, chat_sessions, usage_records");
    const after = await c.query(
      "select (select count(*) from chat_messages)::bigint as chat_messages, " +
      "(select count(*) from chat_sessions)::bigint as chat_sessions, " +
      "(select count(*) from usage_records)::bigint as usage_records"
    );
    console.log("[reset-dev-data] after:", after.rows[0]);
    await c.end();
  })().catch((error) => {
    console.error("[reset-dev-data] database reset failed:", error);
    process.exit(1);
  });
'

echo "[reset-dev-data] removing gateway local usage snapshots..."
rm -f \
  "$ENTERPRISE_DIR/apps/gateway/.runtime/usage.jsonl" \
  "$ENTERPRISE_DIR/apps/gateway/.runtime/gateway/quota-usage.json"

if [ "$WITH_SEED" -eq 1 ]; then
  echo "[reset-dev-data] re-seeding default tenant/user..."
  pnpm --filter @agenticx/db-schema db:seed
fi

if [ "$WITH_IAM_SEED" -eq 1 ]; then
  echo "[reset-dev-data] running IAM demo seed (departments + roles + demo users)..."
  pnpm --filter @agenticx/db-schema run db:seed:iam
fi

echo "[reset-dev-data] done."
