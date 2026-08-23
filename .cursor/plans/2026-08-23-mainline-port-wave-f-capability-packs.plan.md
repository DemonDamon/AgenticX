# Wave F / G2：能力包整链回灌

Planned-with: Cursor Grok 4.6

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把企业「能力包」整链（schema → admin CRUD → portal 有效能力 → 用户关闭 → 用户组 → 网关撤销 → Desktop 同步 → 平台功能 → 扫描结论）回灌主线 Enterprise，fresh install 只建最终表，不建过渡表。

**Architecture:** 不 merge 交付分支，不 `git cherry-pick` 整 commit。在 `feat/mainline-port-wave-c`（`74a94595`）上新开 `feat/mainline-port-wave-f`（**不要**叠在 `feat/mainline-port-g1` 上）。Phase 0 必须先补 Desktop 登录/bootstrap 骨架，否则能力下发没有入口。Phase 1 起按最终态写新迁移编号。

**Tech Stack:** Drizzle PG/MySQL、`@agenticx/iam-core`、`@agenticx/config`、Next.js admin-console / web-portal、Go gateway `mcphost`、Electron Desktop。

---

## Suggested-Impl-Model

| 子规划 | 推荐模型 | 理由 |
|---|---|---|
| Phase 0 Desktop 登录 + bootstrap 骨架 | `gpt-5.6-sol-medium` | 鉴权/设备码/PAT 序列敏感 |
| Phase 1 schema + config + iam-core | `gpt-5.6-sol-medium` | 双方言迁移 + 编号守卫 |
| Phase 2–5 CRUD / reader / opt-out / groups | `composer-2.5` | 以 TS store/route 样板为主，跟交付源对照即可 |
| Phase 6 Gateway entitlement | `gpt-5.6-sol-medium` | fail-closed / missing-relation，错一次会误拦或漏拦 |
| Phase 7 Desktop electron 同步 | `gpt-5.6-sol-medium` | 主进程 IPC，禁止整文件覆盖 `main.ts` |
| Phase 8–11 Admin UI / 平台功能 / 扫描 / 组绑定 | `composer-2.5` | 组件接线；导航只手工合入 wave-a IA |

Suggested-Impl-Model: `gpt-5.6-sol-medium`（整波次默认）

---

## 0. 实施者必须先读的基线

| 项 | 值 |
|---|---|
| 源（只读） | `/Users/damon/myWork/AgenticX` 分支 `hc-0818` |
| 实施 worktree | `/Users/damon/myWork/AgenticX-wave-a` |
| 基线 commit | `74a94595`（Wave C 末） |
| 禁止 | `git merge origin/hc-0818`；整 commit cherry-pick；整文件覆盖 `desktop/electron/main.ts` / `AppShell.tsx` / `server.py` |
| Wave C 已摘 | `enterprise/apps/skill-registry/` — **不要再摘一遍** |
| 本波次不做 | Wave D 群聊 TurnPlan；Wave E 检索质量（独立分支） |

对照源（只读，在交付树）：

```bash
git -C /Users/damon/myWork/AgenticX show 3a918b9b --stat
git -C /Users/damon/myWork/AgenticX show 1dd7ed89 --stat
git -C /Users/damon/myWork/AgenticX show 06c788f6 --stat
```

---

## 1. 根因与证据

wave-a **完全没有**：

- 能力包表 / `@agenticx/config` 的 capability-id
- `/api/desktop/**`（`desktop-auth.ts` 也不存在）
- gateway `EntitlementChecker`
- `desktop/electron/enterprise-capabilities.ts`

wave-a **已有、必须复用**：

- `enterprise/packages/iam-core/src/pat-service.ts`（`verifyPat` / `createPat`）
- `enterprise/packages/db-schema/src/schema/desktop-device-auth.ts` + PG `0030` / MySQL `0002`
- `enterprise/apps/web-portal/src/lib/admin-providers-reader.ts`（`listAvailableModelsForUser`）
- `desktop/src/utils/enterprise-capability-policy.ts`（renderer 自助锁；无 electron 同步）
- `enterprise/apps/skill-registry/`（搜索/扫描服务，无 DB）

因此能力包 **不能**从 schema 单独起跑：bootstrap 鉴权链缺失。Phase 0 是硬前置。

交付侧最终表（fresh install 只建这些）：

- `enterprise_skills`
- `enterprise_capability_packs`
- `enterprise_capability_pack_members`
- `enterprise_capability_assignments`
- `enterprise_user_opt_outs`
- `enterprise_user_groups`
- `enterprise_user_group_members`

**永不创建：** `enterprise_capability_opt_outs`、`enterprise_feature_assignments`。也不写 DROP 这两张表的迁移。

wave-a 当前迁移末号：

- PG：`0045_portal_request_logs_session_idx` → 从 **0046** 起
- MySQL：`0019_portal_request_logs_session_idx` → 从 **0020** 起

MySQL 手写迁移必须内联 `70bb0a0d` 规则（**不要** cherry-pick 该 commit 的 `drizzle-mysql/0027_*` 文件）：

1. 每个顶层语句后 `--> statement-breakpoint`
2. **禁止** `DEFAULT CHARSET` / `COLLATE`（与 `tenants.id` collation 不一致会 FK errno 3780）
3. 显式 FK 约束名
4. 更新 `schema-parity.test.ts` / `migration-inventory.test.ts`

---

## 2. In scope / Out of scope

### In scope

- Phase 0：Desktop PAT + 设备码 + bootstrap **骨架**（`capabilities: []` 可先空）
- Phase 1–11：能力包最终态整链（见 Task）
- 平台功能 `feature:web_search` / `feature:deep_research` 走 pack 成员（不是独立 assignment 表）
- 门户 `chat/completions` 同期接 `isPlatformFeatureAllowed*`
- Skill **扫描结论落库**（admin `recordSkillScan`）；扫描执行继续调已有 skill-registry

### Out of scope

- `/api/desktop/v1/web-search`、`/api/desktop/v1/chat/completions` 托管代理（可后续 PR）
- `desktop-inference-base.ts` / gateway-forward 整链
- `attachment-routing-policy.ts` 整链（注释可保留，route 不在本波次新建也可）
- skill-registry 服务本体再移植
- admin `AppShell` 五域大重构；只手工加一条「能力」导航
- marketplace / registry search UI（17 列表外）
- 交付品牌页、客户定价、客户 org
- 计算器、Wave E 检索、Wave D 群聊
- `agenticx/studio/server.py`（本波次不应改）

**no-scope-creep：** 每个改动追溯到本 plan 一个 Phase。觉得「顺手把托管推理代理也接上」必须先问用户。

---

## 3. 品牌与提交约束

- commit / PR **禁止**客户名、交付产品名、第三方对标措辞
- PAT 默认名用中性「Desktop · {deviceName}」，不要交付产品前缀
- i18n 只摘 capability / user-group 相关 key，中性化后合入 wave-a `messages/*.json`
- 对 staged diff 做品牌泄漏检索，零命中才提交
- trailer：`Plan-Id` / `Plan-File` / `Plan-Model` / `Impl-Model` / `Made-with: Damon Li`
- Plan-Id: `2026-08-23-mainline-port-wave-f-capability-packs`
- 实施前把本文件从 `.cursor/plans/pending/` **移回** `.cursor/plans/`

测试约定：

```bash
cd /Users/damon/myWork/AgenticX-wave-a
# 缺 node_modules 时只建指向原仓库的符号链接，禁止 git add
pnpm --filter @agenticx/config exec vitest run src/__tests__/capability-id
pnpm --filter @agenticx/db-schema exec vitest run src/__tests__/schema-parity src/__tests__/migration-inventory
# portal / admin 按各 Phase AC 列出的文件跑
cd enterprise/apps/gateway && go test ./internal/mcphost/ ./internal/database/ -count=1
```

---

## Phase 0: Desktop 登录链 + bootstrap 骨架

Suggested-Impl-Model: `gpt-5.6-sol-medium`

**源（交付树只读对照，不要整 commit pick）：** 早于 `3a918b9b` 的 desktop 登录文件 + `06c788f6` 的 bootstrap 外壳。

**wave-a Before：** 无 `desktop-auth.ts`；无 `/api/desktop/*`；`desktop_device_auth` 表已在，但无 service / route。

**After 意图：**

```ts
// resolveDesktopIdentity(req) → Bearer PAT → verifyPat → { tenantId, userId, scopes }
// POST /api/desktop/auth/token        账密签发 PAT（含 desktop:managed 若策略允许）
// POST /api/desktop/auth/device/init  → startDesktopDeviceAuth
// POST /api/desktop/auth/device/poll  → 领取 PAT
// POST /api/desktop/auth/device/approve / cancel
// GET  /api/desktop/bootstrap         user + models + policy；capabilities 先返回 []
```

**Files:**

- Create: `enterprise/packages/iam-core/src/desktop-device-auth-service.ts`（对照交付同名文件；方言 repo 一并补 `repos/mysql/desktop-device-auth.ts` 若 PG 侧已有入口）
- Create: `enterprise/apps/web-portal/src/lib/desktop-auth.ts`
- Create: `enterprise/apps/web-portal/src/lib/desktop-token-policy.ts`
- Create: `enterprise/apps/web-portal/src/lib/desktop-device-auth.ts`
- Create: `enterprise/apps/web-portal/src/app/api/desktop/auth/token/route.ts` 及 `device/{init,poll,approve,cancel}/route.ts`
- Create: `enterprise/apps/web-portal/src/app/auth/desktop/page.tsx`（设备批准页；文案中性）
- Create: `enterprise/apps/web-portal/src/app/api/desktop/bootstrap/route.ts`（Phase 0 不读能力包表）
- Create tests listed in AC-F0
- Modify: `enterprise/packages/iam-core` 导出 barrel（若有 `index.ts`，只加导出名）

**禁止：** 本 Phase 不要建 `/api/desktop/v1/*` 代理。不要改 `server.py`。

**AC-F0:**

1. `desktop-auth.test.ts` + 5 个 auth route 测试 + `desktop-device-auth-service.test.ts` PASS
2. `GET /api/desktop/bootstrap` 无有效 PAT → 401；有 PAT → 200，`capabilities` 为 `[]` 或省略均可，但必须有 `user` + `models`
3. 设备流：init → approve → poll 能领到 PAT（单测 mock store 即可）
4. 未登录本地 Desktop（无企业 PAT）行为与现在一致：不锁 Skills

---

## Phase 1: Schema + config + iam-core

Suggested-Impl-Model: `gpt-5.6-sol-medium`

**源：** `3a918b9b` + `c266392e` + `2c7534c7` 的 schema/config/repo；MySQL 规则来自 `70bb0a0d` 机制。

**Files:**

- Create: `enterprise/packages/config/src/capability-id.ts`（`parseCapabilityId` / `featureCapabilityId` / `PLATFORM_FEATURES`）
- Create: `enterprise/packages/config/src/capability-state.ts`、`opt-out-subject.ts`、`desktop-capability-policy.ts`（对照交付；去掉品牌字符串）
- Create: 对应 `__tests__/`（见第 5 节清单）
- Create: `enterprise/packages/db-schema/src/schema/capability-packs.ts`
- Create: `enterprise/packages/db-schema/src/schema/user-opt-outs.ts`
- Create: `enterprise/packages/db-schema/src/schema/user-groups.ts`
- Create: MySQL 镜像 `enterprise/packages/db-schema/src/mysql-schema/{capability-packs,user-opt-outs,user-groups}.ts`
- Create PG:
  - `enterprise/packages/db-schema/drizzle/0046_enterprise_capability_packs.sql` — skills（**含 scan_* 列**）+ packs + members + assignments
  - `enterprise/packages/db-schema/drizzle/0047_enterprise_user_groups.sql`
  - `enterprise/packages/db-schema/drizzle/0048_enterprise_user_opt_outs.sql` — **无 INSERT 过渡段**
- Create MySQL:
  - `0020_enterprise_capability_packs.sql` / `0021_enterprise_user_groups.sql` / `0022_enterprise_user_opt_outs.sql`
  - 每个顶层语句后 `--> statement-breakpoint`；无 CHARSET/COLLATE
- Modify: `drizzle/meta/_journal.json`、`drizzle-mysql/meta/_journal.json`
- Modify: schema barrel 导出
- Create: `enterprise/packages/iam-core/src/repos/user-opt-outs.ts`（`setUserOptOut`；fresh install **不要** `migrateLegacyModelExclusionsIfNeeded` 的 SQL 过渡，函数可留空实现或直接读新表）
- Create: `enterprise/packages/iam-core/src/repos/user-groups.ts`（`groupAssignmentKey` / `listUserGroupIdsForUser`）
- Create: `enterprise/packages/iam-core/src/repos/assignment-keys.ts`（`resolveAssignmentKeysForUser` — **单一 assignment 解析源**）

**Before：** journal 末条 PG 0045 / MySQL 0019。  
**After：** 末条 PG 0048 / MySQL 0022；parity 测试计入新表。

**AC-F1:**

1. `capability-id*.test.ts` / `capability-state.test.ts` / `opt-out-subject.test.ts` / `desktop-capability-policy.test.ts` PASS
2. `schema-parity.test.ts` + `migration-inventory.test.ts` PASS（含 MySQL 顶层语句计数守卫）
3. SQL 文件内 **零** `enterprise_capability_opt_outs` / `enterprise_feature_assignments` / `DEFAULT CHARSET`
4. `enterprise_skills` 在 0046/0020 **一次建全** scan 列，不要再写 0049 ALTER

---

## Phase 2: Admin CRUD API

Suggested-Impl-Model: `composer-2.5`

**源：** `1dd7ed89`（store 部分可预留 `recordSkillScan` 空实现，真正接线在 Phase 10）

**Files:**

- Create: `enterprise/apps/admin-console/src/lib/db-stores/postgresql/capability-packs-store.ts`
- Create: `enterprise/apps/admin-console/src/lib/db-stores/mysql/capability-packs-store.ts`
- Create: `enterprise/apps/admin-console/src/lib/capability-packs-store.ts`（门面，按方言分发）
- Create: `enterprise/apps/admin-console/src/app/api/admin/capability-packs/route.ts` + `[id]/route.ts`
- Create: `enterprise/apps/admin-console/src/app/api/admin/skills/route.ts` + `[id]/route.ts`
- Create: `__tests__/capability-packs-store.test.ts`

**After 意图：** `createCapabilityPack` / `listSkills` / 更新成员与 assignments 真写 PG/MySQL，禁止伪成功。

**AC-F2:** store 单测 PASS；未起 PG 时接口明确报错，不返回 200 空成功。

---

## Phase 3: Portal reader + bootstrap 完整

Suggested-Impl-Model: `composer-2.5`

**源：** `06c788f6` + `5578ac05`

**Files:**

- Create: `enterprise/apps/web-portal/src/lib/capability-tables.ts` — `dialectCapabilityTables`
- Create: `enterprise/apps/web-portal/src/lib/capability-packs-reader.ts`
  - `listAvailableCapabilitiesForUser`
  - `loadUserCapabilityView`
  - `isPlatformFeatureAllowedForUser` / `isPlatformFeatureAllowedOnSurface`（Phase 9 会用；本 Phase 可先实现交集判定）
- Modify: `bootstrap/route.ts` — 并行拉 capabilities；表未迁移 `.catch(() => [])` **仅**缺表放行
- Create: `capability-packs-reader.test.ts` + `capability-packs-reader.feature-auth.test.ts`
- Create: `bootstrap/__tests__/route.test.ts`

**授权判定（必须按这个，`5578ac05` 修过反了的逻辑）：**

```ts
// 用户有效 assignment keys = resolveAssignmentKeysForUser(user)
// pack 对用户生效 iff pack.assignments ∩ keys 非空
// 平台功能允许 iff 存在生效 pack 且 members 含 feature:<id>
```

**AC-F3:** reader 单测 + bootstrap 测试 PASS；缺表时 bootstrap 仍 200 且 capabilities=[]。

---

## Phase 4: 用户 opt-out API

Suggested-Impl-Model: `composer-2.5`

**源：** `afd6bb9a` + `c266392e` 接线

**Files:**

- Create: `enterprise/apps/web-portal/src/lib/capability-opt-outs-store.ts` — `setUserCapabilityPreference`
- Create: `enterprise/apps/web-portal/src/app/api/desktop/capabilities/route.ts` — GET/PATCH
- Create: `capabilities/__tests__/route.test.ts`
- Modify: reader 合并 opt-out subject（`mcp:` / `skill:` / `model:`）

**AC-F4:** PATCH 关闭后 `listAvailableCapabilitiesForUser` 不再包含该 subject；GET 回显。

---

## Phase 5: 用户组

Suggested-Impl-Model: `composer-2.5`

**源：** `2c7534c7`

**Files:**

- Create: `enterprise/apps/admin-console/src/lib/user-groups-store.ts`
- Create: `enterprise/apps/admin-console/src/app/api/admin/user-groups/route.ts` + `[id]/route.ts`
- Modify: `assignment-keys.ts` 已含 `group:<ulid>`（Phase 1）；本 Phase 保证 admin 建组后 reader 能命中组分配
- Create: `user-groups/[id]/__tests__/route.test.ts`、`user-groups-store.deleted-members.test.ts`

**AC-F5:** 用户加入组后，组上绑定的 pack 出现在有效能力里；删组员后不再命中。

---

## Phase 6: Gateway entitlement

Suggested-Impl-Model: `gpt-5.6-sol-medium`

**源：** `7db942e3` + `073f80be` + `bebc0359` + `d2b72095`

**Files:**

- Create: `enterprise/apps/gateway/internal/mcphost/entitlement.go` — `EntitlementChecker.Check` / `mcpCapabilityID`
- Create: `enterprise/apps/gateway/internal/database/missing_relation.go` — `IsMissingRelation`
- Modify: `enterprise/apps/gateway/internal/mcphost/host.go` — MCP 调用前 Check
- Modify: `scopes.go` / `mcp_handlers.go` 仅接线必需行
- Create: `entitlement_test.go` / `entitlement_schema_test.go` / `entitlement_chain_test.go` / `missing_relation_test.go`
- 可选：`secret_envelope_test.go` 仅当本 Phase 真的碰到 envelope 代码

**Before：** host 无 entitlement。  
**After：**

```go
// 表不存在 → unmigrated 放行
// 其它 DB 错误 → fail-closed 拒绝
// 已迁移且用户无 pack 成员 mcp:<id> 或已 opt-out → 拒绝
// 不要查询 enterprise_feature_assignments
```

**AC-F6:** 上述 Go 测试 PASS；schema 测试锁定**没有** feature_assignments 表名查询。

---

## Phase 7: Desktop Electron 同步

Suggested-Impl-Model: `gpt-5.6-sol-medium`

**源：** `3f8b284d` + `d2b72095` 的 desktop 边界

**Files:**

- Create: `desktop/electron/enterprise-capabilities.ts` — `normalizeEnterpriseCapabilities` / `applyEnterpriseCapabilities`
- Create: `desktop/tests/enterprise-capabilities.test.ts`
- Create: `enterprise/apps/web-portal/src/lib/desktop-capability-endpoints.ts` — `withGatewayMcpEndpoints`
- Modify: `desktop/electron/main.ts` — **只**加 bootstrap 调度调用，禁止整段替换
- Modify: `desktop/electron/preload.ts` + `desktop/src/global.d.ts` — 只加本 Phase IPC 类型
- 已有 `desktop/src/utils/enterprise-capability-policy.ts` 对齐 bootstrap `policy.capabilities` 字段名

**AC-F7:** `enterprise-capabilities.test.ts` PASS；无企业 PAT 时不改本地 mcp/skills；有 PAT 时按 capabilities 写 managed 列表。`main.ts` diff 可人工读完（目标 <80 行净增）。

---

## Phase 8: Admin 能力控制台 UI

Suggested-Impl-Model: `composer-2.5`

**源：** `a44110ef` 组件；**不要** port `c2439d48` 单体页。

**Files:**

- Create: `enterprise/apps/admin-console/src/app/admin/capabilities/page.tsx`
- Create: `enterprise/apps/admin-console/src/components/capabilities/{CapabilityPacksPanel,SkillsPanel,McpServersPanel,CapabilityChoiceList}.tsx`
- Create: `use-capability-catalog.ts`
- Modify: wave-a `AppShell` / 侧栏 — **只加一条**指向 `/admin/capabilities` 的导航项，不要换整份信息架构
- Modify: `messages/en.json` / `zh.json` — 只摘中性 key

**AC-F8:** 页面能列 pack / skill；保存走 Phase 2 API；侧栏高亮跟随路由。无交付产品名。

---

## Phase 9: 平台功能入包

Suggested-Impl-Model: `composer-2.5`

**源：** `76cf30b6` + `5578ac05`

**Files:**

- Modify: `capability-id.ts` — `feature` kind（若 Phase 1 已含可跳过）
- Create: `enterprise/apps/admin-console/src/lib/default-capability-pack.ts` — `DEFAULT_PACK_INPUT`（中性默认包，含 `feature:web_search` / `feature:deep_research`）
- Modify: `enterprise/apps/web-portal/src/app/api/chat/completions/route.ts` — 走 `isPlatformFeatureAllowed*`
- 不要新建 `enterprise_feature_assignments`
- Create/modify: `portal-capabilities.test.ts`、`me/web-search/__tests__/route.test.ts` 仅当现有测试因判定变化需要更新
- **不要**本 Phase 新建 `desktop/v1/web-search`

**AC-F9:** 未分配 `feature:web_search` 的用户，门户联网搜索入口按现有产品语义拒绝或隐藏（跟交付 reader 测试断言对齐，文案用主线产品词）。feature-auth 测试 PASS。

---

## Phase 10: Skill 扫描结论落库

Suggested-Impl-Model: `composer-2.5`

**源：** `59dff30d`（只写库，不移植扫描服务）

**Files:**

- Modify: capability-packs-store — `recordSkillScan`
- Create: `enterprise/apps/admin-console/src/app/api/admin/skills/[id]/scan/route.ts`
- Create: `scan/__tests__/route.test.ts`
- Modify: SkillsPanel / CapabilityMarketPanel（若 Phase 8 已建）展示 verdict

**AC-F10:** PUT scan 后 `enterprise_skills.scan_verdict` 可回读；扫描 HTTP 仍指向已有 skill-registry。不改 `enterprise/apps/skill-registry/**`。

---

## Phase 11: 用户组侧绑定能力包

Suggested-Impl-Model: `composer-2.5`

**源：** `148ff2f5`

**Files:**

- Modify: `enterprise/apps/admin-console/src/components/iam/UserGroupsPanel.tsx` — 增加 pack 绑定（若 wave-a 尚无该文件，按交付组件**中性化**新建，不要换整份 IAM 页）
- Modify: `capability-pack-form.ts` 组绑定 helpers
- Create: `__tests__/group-pack-binding.test.ts`

**AC-F11:** 从组卡片绑定 pack 后，该组成员 `listAvailableCapabilitiesForUser` 含该 pack；解绑后消失。

---

## 4. 必须 port 的测试（汇总）

按 Phase 完成后跑对应子集；整链结束再全跑：

- config：`capability-id.test.ts`、`capability-id-feature.test.ts`、`capability-state.test.ts`、`opt-out-subject.test.ts`、`desktop-capability-policy.test.ts`
- db-schema：`schema-parity.test.ts`、`migration-inventory.test.ts`
- iam-core：`desktop-device-auth-service.test.ts`
- portal：`desktop-auth.test.ts`、`capability-packs-reader.test.ts`、`capability-packs-reader.feature-auth.test.ts`、bootstrap/capabilities/auth route tests
- admin：`capability-packs-store.test.ts`、`capability-pack-form.test.ts`、`group-pack-binding.test.ts`、user-groups / skills-scan route tests
- gateway：`entitlement_*.go`、`missing_relation_test.go`
- desktop：`desktop/tests/enterprise-capabilities.test.ts`

**可延后：** `desktop/v1/web-search`、`desktop/v1/chat/completions`、`desktop-inference-base`、`gateway-forward`。

---

## 5. 禁止清单（再读一遍再动手）

- 不要 cherry-pick：`70bb0a0d` 文件、`c2439d48` 单体页、`a44110ef` 整份 AppShell、`884d1e6e`、`0055`/`0029`/`0058`/`0032` 过渡/DROP 迁移
- 不要重复摘 `enterprise/apps/skill-registry/`
- 不要创建 `enterprise_capability_opt_outs` / `enterprise_feature_assignments`
- 不要把 Wave F 和 G1 / Wave E 捆进同一个 PR
- 不要改 `agenticx/studio/server.py`；若误碰必须隔离 HOME 冷启动 `/api/session` `/api/avatars` `/api/sessions` = 200

---

## 6. 总验收

| ID | 断言 |
|---|---|
| AC-F-G1 | `git log 74a94595..HEAD --format=%s` 无交付产品名、无对标措辞 |
| AC-F-G2 | staged/committed diff 品牌泄漏检索零命中 |
| AC-F-G3 | 第 4 节「必须 port」测试全绿 |
| AC-F-G4 | fresh migrate 后只有最终 7 张表，无过渡表 |
| AC-F-G5 | 无企业 PAT 的本地 Desktop：MCP/Skills 行为与 Wave C 一致 |
| AC-F-G6 | 有 PAT：bootstrap 下发 capabilities；opt-out 生效；网关对未授权 MCP fail-closed；缺表 fail-open |
| AC-F-G7 | 未改 `server.py` |

每个 Phase 单独 commit（Phase 0/1 尤其不可和 UI 揉在一起）。实施顺序必须 0→11，禁止先做 UI 后补表。
