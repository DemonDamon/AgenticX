# @agenticx/feature-policy

策略规则中心服务层（PG 主存储 + 草稿/发布 + 快照落盘）。

## 能力概览

- **规则包管理**：支持 builtin/custom 两类规则包，builtin 可启停但不可删除。
- **规则管理**：支持 `keyword` / `regex` / `pii` 三种规则，状态分为 `draft` / `active` / `disabled`。
- **适用范围**：`applies_to` 支持部门、角色、用户白名单/黑名单、客户端、阶段（request/response）。
- **发布流程**：`publish()` 生成租户快照并写入 `policy_publish_events`，同时写磁盘快照供 Gateway 热加载。
- **回滚流程**：`rollback()` 以历史快照再发布一个新版本，不直接覆写旧版本。
- **自审计**：规则变更与发布通过 `gateway_audit_events` 记录 `policy_rule_change` / `policy_publish` 事件。

## 导出 API

```ts
import {
  PgPolicyStore,
  writeSnapshot,
  readTenantSnapshot,
  insertPolicyAuditEvent,
} from "@agenticx/feature-policy";
```

## 快照文件

- 默认路径：`enterprise/.runtime/admin/policy-snapshot.json`
- 可通过环境变量覆盖：`ENTERPRISE_POLICY_SNAPSHOT_FILE`
- 文件结构：
  - `updatedAt`
  - `tenants.<tenantId>.version`
  - `tenants.<tenantId>.packs[]`（包含 pack/rules/appliesTo）

## 内置规则种子

`PgPolicyStore.ensureBuiltinSeed(tenantId)` 会扫描 `enterprise/plugins/moderation-*/manifest.yaml`，
并将其导入 PG（`source='builtin'`）。

## 测试

```bash
pnpm --filter @agenticx/feature-policy test
pnpm --filter @agenticx/feature-policy typecheck
```
