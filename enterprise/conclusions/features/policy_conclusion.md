# @agenticx/feature-policy 模块总结

> 结论再生时间：2026-07-21（基于 `enterprise/features/policy` 源码重写）

> 说明：本文档描述**敏感规则配置 feature 包**（`@agenticx/feature-policy`），由 `apps/admin-console` 在 policy 页面消费，发布产物（`PolicySnapshot`）经 admin-console 的 `/api/internal/policy-snapshot` 或本地 `.runtime/admin/policy-snapshot.json` 被 Go 网关 `apps/gateway` 热加载，喂给 `policy-engine` 做运行时评估。本包只管"配置侧"，**不做运行时评估**。

## 模块定位

`@agenticx/feature-policy` 是 **policy 规则管理端（配置侧）**。职责边界：

- **做**：规则/Pack 的 PG/MySQL 持久化、草稿/发布/回滚、快照写入、内置 moderation 规则自动装载、规则测试预览、policy 审计事件写入。
- **不做**：运行时请求/响应评估（由 Go `policy-engine` 执行）、网关审计哈希链（policy 审计用占位 checksum，不进 Blake2b 链）。

支持两种方言：`postgresql`（`PgPolicyStore`）与 `mysql`（`MysqlPolicyStore`），由 `createPolicyStore()` 按 `resolveDatabaseConfig().dialect` 分发。两个 Store 实现镜像，API 表面一致。

## 目录结构

```
features/policy/
├── package.json                     # @agenticx/feature-policy v0.1.0
├── README.md
├── tests/
│   ├── rule-utils.test.ts           # 3 case：normalize/findRuleMatches
│   └── snapshot-writer.test.ts       # 4 case：写/读/CAS/坏文件（均走 legacy 文件路径）
└── src/
    ├── index.ts                     # barrel：types/audit/snapshot/services
    ├── types.ts                     # 全部类型定义
    ├── audit.ts                     # insertPolicyAuditEvent（PG + MySQL）
    ├── services/
    │   ├── factory.ts                # createPolicyStore() 按 dialect 分发
    │   ├── mysql-database.ts         # getPolicyMysqlDb() 连接池
    │   ├── pg-store.ts               # PgPolicyStore（922 行）
    │   ├── mysql-store.ts            # MysqlPolicyStore（919 行，镜像 PG）
    │   └── rule-utils.ts             # 纯函数：normalize/findRuleMatches
    └── snapshot/
        └── writer.ts                # 快照读/写/迁移/CAS/网关 bundle（209 行）
```

## 核心类型（`types.ts`）

- `PolicyRuleKind`：`keyword | regex | pii | field`（4 种，**注意 `field` 在 Store 侧不可达**，见"诚实缺口"）。
- `PolicyRuleAction`：`block | redact | warn`。
- `PolicyRuleSeverity`：`low | medium | high | critical`。
- `PolicyRuleStatus`：`draft | active | disabled`。
- `PolicyPackSource`：`builtin | custom`。
- `PolicyPublishStatus`：`published | rolled_back`。
- `PolicyStage`：`request | response`。
- `PolicyAppliesTo`：`version/departmentIds/departmentRecursive/roleCodes/userIds/userExcludeIds/clientTypes/stages`。
- `PolicySnapshot`：`tenantId/version/publishId/publishedAt/publisher/deptIndex/packs[]`。
- `PolicyPublishEvent`：含完整 `snapshot` + `summary` + `status`。
- `PublishResult`：`{ event, snapshotPath }`。

## Store API（`PgPolicyStore` / `MysqlPolicyStore` 一致）

### Pack 管理
- `listPacks/getPack/createPack/updatePack/deletePack`。
- `builtin` 包可启停、可改 description/appliesTo，**不可改名、不可删除**（`updatePack`/`deletePack` 显式抛错）。
- `ensureBuiltinSeed(tenantId)`：扫描 `enterprise/plugins/moderation-*/manifest.yaml`，按 `(tenantId, code)` upsert builtin pack 与 rule，幂等（进程内 `builtinSeeded` Set 缓存）。

### Rule 管理
- `listRules(filter)` / `upsertRule` / `deleteRule` / `setRuleStatus`。
- `upsertRule`：同包 `code` 唯一性校验；命中已停用编码会提示"恢复或换编码"；`normalizeRulePayload` 按 kind 校验。
- `setRuleStatus`：`draft/active/disabled` 三态切换。

### 测试预览
- `testRules(tenantId, ruleIds, sampleText, stage, previewByRuleId?)`：把规则在样本文本上跑命中，`block` 置 `blocked=true`，`redact` 把命中片段替换为 `[REDACTED]`，`warn` 只记 hit。
- `previewByRuleId` 支持合并**未保存的表单改动**再跑测试（admin-console `/api/policy/test` 用）。

### 发布与回滚
- `listPublishes(tenantId, limit=20)`：按 `publishedAt desc` 列历史发布事件。
- `publish(tenantId, actor, { activateDraftRuleIds? })`：单事务内 → 可选批量激活草稿规则 → 取 `max(version)+1` → 取 `enabled=true` 的 pack 与 `status=active` 的 rule 组装 `PolicySnapshot` → 为每条 active rule append `policy_rule_versions` 版本快照 → `writeSnapshotWithCas(snapshot, previousPublishId)` → 写 `policy_publish_events`。事务失败时若快照已写则尝试回退到旧快照。事后 best-effort 写 `policy_publish` 审计事件。
- `rollback(tenantId, eventId, actor)`：取历史 event 的 snapshot，**作为新版本再发布一次**（不覆写旧 event，源 event 标记 `rolled_back`），写新 publish event 与审计。
- `recordRuleChange(actor, detail)`：写 `policy_rule_change` 审计事件（由 admin-console 在 CRUD 后调用）。

## 快照持久化（`snapshot/writer.ts`）

- `resolveSnapshotPath()`：`ENTERPRISE_POLICY_SNAPSHOT_FILE` → `GATEWAY_POLICY_SNAPSHOT_FILE` → `<enterpriseRoot>/.runtime/admin/policy-snapshot.json`。
- `migrateLegacySnapshotFileOnce()`：进程内一次性把 legacy 文件的 `tenants` 灌入 `enterprise_runtime_policy_snapshots` 表（仅当表无行时；模块级 `legacyFileMigrated` flag 防重入）。
- `replaceTenantSnapshot(tenantId, snapshot|null, { expectedCurrentPublishId? })`：PG `onConflictDoUpdate` / MySQL `onDuplicateKeyUpdate`；`snapshot=null` 时删行；带 `expectedCurrentPublishId` 时先读当前 `publishId` 比对，不符抛 `snapshot CAS mismatch`。
- `writeSnapshot` / `writeSnapshotWithCas` / `readTenantSnapshot`：上层的薄封装。
- `buildPolicySnapshotBundleForGateway()`：聚合全量租户快照为 `{ updatedAt, tenants }` 结构（与 legacy 文件同形），供 admin-console `/api/internal/policy-snapshot` 直接回吐给网关。

## 审计（`audit.ts`）

- `insertPolicyAuditEvent(actor, "policy_publish"|"policy_rule_change", detail)`：写 `gateway_audit_events`（与网关审计**同表**但 `prevChecksum/checksum` 硬编码为 `"admin-policy"`，**不进 Blake2b 哈希链**），按 dialect 走 PG 或 MySQL。

## 纯函数（`services/rule-utils.ts`）

- `normalizeAppliesTo`：缺省 `departmentIds:["*"]` / `departmentRecursive:true` / `roleCodes:["*"]` / `clientTypes:["*"]` / `stages:["request","response"]`。
- `normalizeRulePayload`：keyword 需 ≥1 关键词；regex 需 `pattern`；**field 需 `jsonPath+target+fieldAction`**；pii 需 `piiType`。
- `findRuleMatches`：keyword 子串命中；regex 支持 `(?i)` 前缀转大小写不敏感；pii 走 5 个内置 regex。
- PII 白名单：`mobile / email / id-card / bank-card / api-key`。

## 公共导出（`index.ts`）

`types` / `insertPolicyAuditEvent` / `snapshot/writer`（read/replace/writeSnapshot/writeSnapshotWithCas/buildPolicySnapshotBundleForGateway/resolveSnapshotPath） / `PgPolicyStore` / `MysqlPolicyStore` / `createPolicyStore` / `PolicyStore`。

## 依赖

| 依赖 | 用途 |
|---|---|
| `@agenticx/db-schema` | `policyRulePacks/policyRules/policyRuleVersions/policyPublishEvents/enterpriseRuntimePolicySnapshots/gatewayAuditEvents`（PG + MySQL 双 schema） |
| `@agenticx/iam-core` | `getIamDb()` / `resolveDatabaseConfig()` |
| `drizzle-orm ^0.45` | 查询 builder |
| `mysql2 ^3` | MySQL 驱动 |
| `ulid ^3` | 规则/发布 ID |
| `yaml ^2` | 解析 builtin moderation manifest |
| `vitest ^3` | 测试 |

## 与 admin-console 的关系（配置侧消费者）

- `apps/admin-console/src/lib/policy-store.ts`：进程内单例 `store = createPolicyStore()`，封装 `listPolicyPacks/createPolicyPack/updatePolicyPack/deletePolicyPack/listPolicyRules/upsertPolicyRule/deletePolicyRule/setPolicyRuleStatus/testPolicyRules/publishPolicy/listPolicyPublishes/rollbackPolicyPublish/buildPolicyActor`，并在每次 CRUD 后调 `recordRuleChange` 写审计。
- `/api/policy/{rules,packs,publishes,test}` 路由消费上述封装；`/api/policy/test` 用 `PolicyRuleTestPreview` 类型支持未保存预览。
- `/api/internal/policy-snapshot` 路由：受 `isGatewayInternalAuthorized` 保护，直接调 `buildPolicySnapshotBundleForGateway()` 回吐 bundle。
- **admin-console `upsertPolicyRule` 入参 `kind` 限定为 `keyword | regex | pii`**（不含 `field`），即 admin UI 不暴露 field 规则。

## 与 gateway 的关系（运行时执行端）

- Go 网关 `apps/gateway` 在 `buildPolicyEngine` 时通过 `loadPolicySnapshot` 读取快照：优先 `GATEWAY_REMOTE_POLICY_SNAPSHOT_URL`（指向 admin-console `/api/internal/policy-snapshot`），回退 `GATEWAY_POLICY_SNAPSHOT_FILE`，再回退 quota 配置旁的 `policy-snapshot.json`。
- `snapshotManifestsFromRaw` 把 bundle 的每个 pack 映射为 `policyengine.RulePackManifest`，每条 rule 映射为 `policyengine.Rule`，按 `kind` 取 `keywords/pattern/piiType/jsonPath+target+fieldAction`。
- 网关 `reloadPolicyIfNeeded()` 基于文件 mtime 热重载（文件模式）；remote URL 模式按需重拉。
- **网关支持 4 种 kind（含 `field`）**，与 TS Store 侧的 3 种（不含 field）不对称。
- 网关 `extends` 在 Go loader 中为单字符串（数组 manifest 会失败），只识别 `keyword/regex/pii`（无 `keyword-list`），17 种密钥检测留在 AgenticX Python 框架、**未进 Go 网关**。

## 诚实缺口与风险（重要）

1. **`field` 规则不可达**：`types.ts` 声明 `field` kind，`rule-utils.ts` 与 Go 网关都支持，但 `PgPolicyStore`/`MysqlPolicyStore` 内部 `normalizeRulePayload` 只处理 keyword/regex/pii（field 会落到 pii 分支抛"PII 规则缺少 piiType"），且 admin-console `upsertPolicyRule` 入参 kind 也限定三选。结论：field 规则在 admin UI 与 Store 侧均不可达，仅网关能评估（若手工灌库）。
2. **Store 代码重复**：`pg-store.ts` 与 `mysql-store.ts` 各 ~920 行，`normalizeAppliesTo/normalizeRulePayload/findMatches/PIIPatterns` 在两份文件里各抄一份；共享的 `services/rule-utils.ts` 存在但 Store 不引用它。漂移风险（上述 field 缺口在两份 Store 里完全一致即为例证）。
3. **`deptIndex` 永远为空**：`buildSnapshot` 与 `publish` 都硬编码 `deptIndex: {}`，从未填充。按部门 scope 路由在快照层未接线，部门级命中只能靠 `appliesTo.departmentIds` 在网关侧逐规则判断。
4. **CAS 是应用级而非 DB 级**：`replaceTenantSnapshot` 先 `select` 当前 `publishId` 比对、再 `onConflictDoUpdate`/`onDuplicateKeyUpdate`，中间存在 TOCTOU 窗口；并非真正的 `UPDATE ... WHERE publish_id = $expected` 原子 CAS。极端并发下仍可能覆盖。
5. **`rollback` 不还原 rule 行**：回滚只把历史 snapshot 作为新版本再发布，并把源 event 标 `rolled_back`，但**不回写 `policy_rules`/`policy_rule_packs` 行**到历史状态。下一次 `publish` 仍从当前 PG 行重建快照，而非回滚后的快照。即"回滚"只影响喂给网关的快照，不影响可编辑规则行。
6. **legacy 迁移只跑一次**：`legacyFileMigrated` 是模块级 flag，进程生命周期内只迁移一次；若 DB 已有行则永远不再读 legacy 文件，即使 legacy 文件后续变化也不会再迁移。
7. **policy 审计不进哈希链**：`insertPolicyAuditEvent` 写 `prevChecksum/checksum` 硬编码 `"admin-policy"`、`signature=null`，与网关审计的 Blake2b 哈希链是两套语义，admin-console 审计查询需注意区分。
8. **builtin seed 静默吞错**：`ensureBuiltinSeed` 读 `plugins/` 失败时 `catch` 后直接 `add(tenantId)` 返回，builtin 规则可能悄无声息地不装载。
9. **测试覆盖薄**：仅 7 个 case，且 `snapshot-writer.test.ts` 全部通过 `ENTERPRISE_POLICY_SNAPSHOT_FILE` 指向 tmpdir 走 **legacy 文件路径**，**未覆盖 PG/MySQL 写入与 DB 级 CAS**；Store 的 publish/rollback/testRules/upsertRule 等核心路径**无单测**。
10. **redact 顺序敏感**：`testRules` 用 `redactedText.split(item).join("[REDACTED]")` 逐条替换，重叠/嵌套匹配可能重复替换或顺序依赖，预览结果不保证幂等。
11. **`migrateLegacySnapshotFileOnce` 在 MySQL 路径下用 `getPolicyMysqlDb()`，PG 路径下用 `getIamDb()`，但二者共享同一 `legacyFileMigrated` flag**：若进程内先以方言 A 触发迁移、再切方言 B，flag 已置位，方言 B 不会再迁移（理论上同进程切换方言极少见）。

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/admin-console` | **主消费者** | `/policy/*` 页面 + `/api/policy/{rules,packs,publishes,test}` + `/api/internal/policy-snapshot` |
| `apps/gateway`（Go） | **运行时执行端** | 拉 `PolicySnapshot` bundle → `policy-engine` 评估；支持含 `field` 在内 4 种 kind |
| `packages/policy-engine` | **Go 引擎** | 真正的请求/响应/流式三通道策略评估 |
| `packages/db-schema` | **schema 依赖** | 全部 policy 表（PG + MySQL 双 schema） |
| `packages/iam-core` | **运行时依赖** | `getIamDb()` / `resolveDatabaseConfig()` |
| `plugins/moderation-*` | **内置规则源** | `ensureBuiltinSeed` 扫这些目录的 `manifest.yaml` |
