# Gateway 审计：PostgreSQL 双写、回灌与排障

## 架构简述

- **JSONL**（`.runtime/audit/audit-YYYYMMDD.jsonl`）：Gateway 本地 **必须成功** 的 append-only 兜底；Blake2b 链在写入文件前已算好。
- **PostgreSQL**（`gateway_audit_events`）：`DATABASE_URL` 存在时 **best-effort** 异步插入；失败时追加 `.runtime/audit/.pg-pending`。
- **回灌**：进程启动时异步 `RunBackfill`，扫描最近 `GATEWAY_AUDIT_BACKFILL_DAYS` 天（默认 7，最大 90）的 JSONL，将 PG 中缺失的 `id` 通过 `INSERT ... ON CONFLICT DO NOTHING` 补齐。

## 运维检查

1. **迁移**：部署后执行  
   `pnpm --filter @agenticx/db-schema db:migrate`  
   确认存在表 `gateway_audit_events`。

2. **Gateway 环境变量**  
   - `DATABASE_URL`：与 Enterprise IAM 共用库时可指向同一 PG。  
   - `GATEWAY_AUDIT_BACKFILL_DAYS`：可调回灌窗口。

3. **Admin 查询**  
   - 列表/导出走 `PgAuditStore`，强制 `tenant_id`，并按 scope 限制可见域：  
     `audit:read:all`（及 `*` / `audit:manage`）全租户；`audit:read:dept` 本部门；其余（仅 `audit:read` 等）仅本人。  
   - 全表链校验：`GET /api/audit/chain-verify`，需 **`audit:read:all`**（超级管理员 `*` 亦可）。

## `.pg-pending` 排障

- 文件路径：`{auditDir}/.pg-pending`（与 `FileWriter` 目录一致）。
- 含义：某次异步 PG 写入失败时的待回灌线索；成功回灌后由 `RunBackfill` 尝试 `clearPgPending` 清理。
- 若 **长期堆积** 且 PG 已恢复：重启 Gateway 触发 backfill，或确认 `DATABASE_URL` 网络/权限与迁移已就绪。

## 链校验失败

- 管理台「全表链校验」返回首个断链 `id` 与 `reason`（`prev_checksum_mismatch` / `checksum_mismatch` 等）。
- **`client_type = admin-console`** 的导出自审计行 **不参与** 链计算（checksum 占位），勿与网关链混验。
- 调查顺序：对应租户 JSONL 原始行 → 是否与 PG 行一致 → 是否有人为改文件/PG。

## 已有租户角色升级说明

系统内置角色通过 `ensureSystemRoles` **仅在新角色代码首次出现时插入**；已存在的 `owner`/`admin`/`auditor` 若仍为旧版 `audit:read`，需在库内 **手动更新** `roles.scopes` 为含 `audit:read:all`（及所需的 `audit:export`），或按需新建 `dept_admin` 角色行。新建租户会使用仓库内最新种子。

## 导出自审计与限流

- 每次 CSV 导出成功后向 `gateway_audit_events` 写入 `event_type = audit_export`（`client_type: admin-console`）。
- 同一用户导出 **每分钟 ≤ 3 次**（admin-console 进程内内存桶；多实例需后续换 Redis 等）。
