---
name: gateway-audit-production
overview: Gateway 审计 PG 主写 + JSONL 兜底 + Admin PgAuditStore 真 RBAC；迁移 gateway_audit_events；回灌与 runbook。
todos: []
isProject: false
---

# Gateway 审计日志生产化

**Plan-Id**: `2026-05-04-gateway-audit-production`

## 范围

- `enterprise/packages/db-schema`：`gateway_audit_events` + migration
- `enterprise/apps/gateway/internal/audit`：DualWriter / PgWriter / Backfill / server 接线
- `enterprise/features/audit`：`PgAuditStore`、链校验、导出自审计
- `enterprise/apps/admin-console`：`/api/audit/*`、`audit-service`、限流
- `enterprise/docs/runbooks/audit-pg-backfill.md`
- `enterprise/packages/iam-core`：scope `audit:read:all` / `audit:read:dept`、系统角色种子

## 验收摘要

- JSONL 写入失败则请求失败；PG 失败不阻塞，`.pg-pending` + 启动回灌
- Admin 查询强制 `tenant_id` + 三档 RBAC；`chain-verify` 仅 `audit:read:all`
- 导出限流 3/min/user；`audit_export` 写入 PG

（详细设计见实现代码与 `enterprise/features/audit/README.md`。）
