#!/usr/bin/env bash
# 一键清空本地开发数据（聊天历史 / 用量记录 / 网关本地 usage 日志）。
# 使用 --full 还可顺便清掉网关审计、IAM 操作审计、策略命中与已发布快照。
#
# 用法：
#   bash scripts/reset-dev-data.sh
#   bash scripts/reset-dev-data.sh --yes
#   bash scripts/reset-dev-data.sh --full
#   bash scripts/reset-dev-data.sh --full --yes
#   bash scripts/reset-dev-data.sh --with-seed
#   bash scripts/reset-dev-data.sh --with-seed --with-iam-seed --yes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTERPRISE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ENTERPRISE_DIR/.env.local"

AUTO_YES=0
WITH_SEED=0
WITH_IAM_SEED=0
WITH_FULL=0

print_help() {
  cat <<'EOF'
reset-dev-data.sh — 清空本地开发数据

用法：
  bash scripts/reset-dev-data.sh [选项]

选项：
  --yes            跳过确认，直接执行
  --full           额外清理网关审计 / IAM 审计 / 策略命中与已发布快照
                   （strictly 痕迹类，不会删策略规则定义、配额配置或主数据）
  --with-seed      清空后执行 db:seed，恢复默认租户/用户种子
  --with-iam-seed  在 --with-seed 之后额外执行 IAM 演示数据脚本
                   （多级部门 + 4 角色 + 10 演示用户）
  -h, --help       显示帮助

默认清单：
  - PG: chat_messages / chat_sessions / usage_records
  - 文件: enterprise/apps/gateway/.runtime/usage.jsonl（旧布局兼容）
          enterprise/.runtime/gateway/quota-usage.json
          enterprise/.runtime/gateway/quota-usage.json.lock

--full 额外清单：
  - PG: gateway_audit_events / audit_events / policy_publish_events
  - 文件: enterprise/.runtime/admin/policy-snapshot.json
          enterprise/.runtime/admin/policy-overrides.json
          enterprise/apps/gateway/.runtime/audit/*.jsonl
          enterprise/apps/gateway/.runtime/audit/seals/*
          enterprise/apps/gateway/.runtime/audit/.pg-pending（如存在）

--full 后注意：
  - 策略已发布快照被清，admin-console 需重新点"发布"才能让网关启用最新规则
  - 网关进程如仍在跑，建议重启 apps/gateway，避免内存里的旧快照/旧计数残留
EOF
}

for arg in "$@"; do
  case "$arg" in
    --yes) AUTO_YES=1 ;;
    --full) WITH_FULL=1 ;;
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
  echo "  - chat_messages / chat_sessions / usage_records (PG)"
  echo "  - apps/gateway/.runtime/usage.jsonl"
  echo "  - .runtime/gateway/quota-usage.json (+ .lock)"
  if [ "$WITH_FULL" -eq 1 ]; then
    echo
    echo "  [--full 额外清理]"
    echo "  - gateway_audit_events / audit_events / policy_publish_events (PG)"
    echo "  - .runtime/admin/policy-snapshot.json"
    echo "  - .runtime/admin/policy-overrides.json"
    echo "  - apps/gateway/.runtime/audit/*.jsonl"
    echo "  - apps/gateway/.runtime/audit/seals/*"
    echo "  - apps/gateway/.runtime/audit/.pg-pending (如存在)"
    echo
    echo "  注意：策略规则定义、配额配置、用户/角色等主数据不会被清。"
    echo "        --full 后请到 admin-console 重新发布策略，并重启 apps/gateway。"
  fi
  echo "  使用的 DATABASE_URL=$DATABASE_URL"
  read -r -p "确认继续？输入 YES 继续: " answer
  if [ "$answer" != "YES" ]; then
    echo "[reset-dev-data] 已取消。"
    exit 0
  fi
fi

echo "[reset-dev-data] truncating postgres tables..."
WITH_FULL_FOR_NODE="$WITH_FULL" pnpm --filter @agenticx/app-web-portal exec node -e '
  const { Client } = require("pg");
  const withFull = process.env.WITH_FULL_FOR_NODE === "1";
  (async () => {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();

    const baseTables = ["chat_messages", "chat_sessions", "usage_records"];
    const fullExtraTables = ["gateway_audit_events", "audit_events", "policy_publish_events"];
    const tables = withFull ? [...baseTables, ...fullExtraTables] : baseTables;

    const ident = (t) => `"${t.replace(/"/g, "")}"`;
    const countSql = (cols) =>
      "select " +
      cols.map((t) => `(select count(*) from ${ident(t)})::bigint as ${ident(t)}`).join(", ");
    const before = await c.query(countSql(tables));
    console.log("[reset-dev-data] before:", before.rows[0]);

    await c.query(`truncate table ${tables.map(ident).join(", ")}`);

    const after = await c.query(countSql(tables));
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
  "$ENTERPRISE_DIR/.runtime/gateway/quota-usage.json" \
  "$ENTERPRISE_DIR/.runtime/gateway/quota-usage.json.lock" \
  "$ENTERPRISE_DIR/apps/gateway/.runtime/gateway/quota-usage.json" \
  "$ENTERPRISE_DIR/apps/gateway/.runtime/gateway/quota-usage.json.lock"

if [ "$WITH_FULL" -eq 1 ]; then
  echo "[reset-dev-data] removing audit + policy local artifacts (--full)..."
  rm -f \
    "$ENTERPRISE_DIR/.runtime/admin/policy-snapshot.json" \
    "$ENTERPRISE_DIR/.runtime/admin/policy-overrides.json" \
    "$ENTERPRISE_DIR/apps/gateway/.runtime/audit/.pg-pending"

  AUDIT_DIR="$ENTERPRISE_DIR/apps/gateway/.runtime/audit"
  if [ -d "$AUDIT_DIR" ]; then
    find "$AUDIT_DIR" -maxdepth 1 -type f -name "audit-*.jsonl" -print -delete || true
    if [ -d "$AUDIT_DIR/seals" ]; then
      find "$AUDIT_DIR/seals" -maxdepth 1 -type f -name "seal-*.json" -print -delete || true
    fi
  fi
fi

if [ "$WITH_SEED" -eq 1 ]; then
  echo "[reset-dev-data] re-seeding default tenant/user..."
  pnpm --filter @agenticx/db-schema db:seed
fi

if [ "$WITH_IAM_SEED" -eq 1 ]; then
  echo "[reset-dev-data] running IAM demo seed (departments + roles + demo users)..."
  pnpm --filter @agenticx/db-schema run db:seed:iam
fi

echo "[reset-dev-data] done."
if [ "$WITH_FULL" -eq 1 ]; then
  echo "[reset-dev-data] --full 已清审计/策略快照；如网关在跑请重启它，并在 admin-console 重新发布策略。"
fi
