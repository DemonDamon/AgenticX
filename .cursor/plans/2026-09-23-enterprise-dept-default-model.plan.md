# 部门默认模型

Planned-with: grok-4.7
Suggested-Impl-Model: composer-2.5

> **For implementer:** 只凭本文落地。不要回看规划对话。Master：`.cursor/plans/pending/2026-09-23-enterprise-org-production-master.plan.md`。

**Goal:** 管理员为部门指定一个默认模型；员工新开会话时，在仍可见的前提下用这个默认值，而不是列表里的第一个。

**Architecture:** 可见集合继续由 `computeEffectiveDeptAllowed` 做级联交集。默认模型是该集合上的一个指针，单独一张表，不把「数组第一项」当成优先级。容量配额已在 `/metering/quota` 的 `departments` 规则里，本规划不改配额。

**Tech Stack:** Drizzle 双方言、admin-console 部门模型 API、web-portal `listAvailableModelsForUser`、`@agenticx/feature-chat` 的 `createSession`。

---

## 根因

`enterprise/packages/db-schema/src/schema/runtime-config.ts` 约 L44–L58 的 `enterprise_runtime_user_visible_models` 主键是 `(tenant_id, assignment_key, model_id)`，一行只表示「可见」，没有默认位。

`enterprise/apps/admin-console/src/lib/effective-models.ts` 的 `computeEffectiveDeptAllowed`（约 L33–L44）从根到叶做交集，返回 `string[]`，顺序不稳定，不能当优先级。

`enterprise/apps/web-portal/src/components/WorkspaceShell.tsx` 约 L193 新会话使用 `activeModel || "deepseek-chat"`。部门配了专用模型时，新会话仍可能落到这个硬编码或列表首项。

部门配额（月 token、`poolScope: "dept"`）已经在 `enterprise/apps/admin-console/src/app/metering/quota/page.tsx` 与 `enterprise/apps/gateway/internal/quota/tracker.go` 的 `selectRule` 生效。缺的是「这个部门默认用哪一个模型」，不是再做一套容量。

## In scope / Out of scope

**In scope**

- 新表保存 `dept:<id>` → 一个 `model_id`
- 管理台部门模型编辑处标出一个默认项；保存时默认项必须属于保存后的可见集合
- 前台模型列表 API 返回 `deptDefaultModelId`
- 新会话在用户没有仍有效的当前选择时采用它
- PostgreSQL 与 MySQL 迁移成对

**Out of scope**

- 改配额、计价、TPM/RPM
- 用户个人默认模型（只做部门）
- 改级联收窄语义
- 按项目、按技能改模型
- 云端设备

## 数据

两份 schema 同结构：

- `enterprise/packages/db-schema/src/schema/runtime-config.ts`
- `enterprise/packages/db-schema/src/mysql-schema/runtime-config.ts`

```text
enterprise_runtime_scope_default_models
  tenant_id        varchar(26)  not null
  assignment_key   text         not null   -- 仅允许 "dept:" + 部门 id
  model_id         text         not null   -- "providerId/modelName"
  updated_at       timestamptz / datetime
  primary key (tenant_id, assignment_key)
```

禁止写入 `all`、用户 ulid、`email:`。那些 key 出现在写入路径时返回 400。

## 纯函数（先写测试）

新建 `enterprise/apps/admin-console/src/lib/dept-default-model.ts`，门户侧把同一函数拷到 `enterprise/apps/web-portal/src/lib/dept-default-model.ts`（两份保持字节级同逻辑；不要抽新 package）。

```ts
export function resolveDeptDefaultModel(input: {
  effectiveModelIds: readonly string[];
  /** 从叶到根的部门默认值；先命中且仍在 effective 内的获胜 */
  defaultsLeafToRoot: readonly (string | null | undefined)[];
}): string | null
```

规则：

1. 遍历 `defaultsLeafToRoot`。
2. 第一个 `trim()` 后非空、且包含在 `effectiveModelIds` 里的值获胜。
3. 否则返回 `null`。调用方再沿用今天的回退（当前 activeModel 若仍可见，否则列表第一项）。

**不要**在默认值缺失时发明新的硬编码模型名。

测试文件：`enterprise/apps/admin-console/src/lib/__tests__/dept-default-model.test.ts`

- 叶部门默认值在有效集合内 → 返回叶
- 叶默认值已被父级交集剪掉 → 用父级默认值
- 两级都不在集合内 → `null`
- 空字符串与空白 → 跳过

## 写入

`enterprise/apps/admin-console/src/app/api/admin/departments/[id]/models/route.ts` 现有 PUT 调用 `setDeptModels(id, modelIds)`（约 L37）。

扩展 JSON body：

```json
{ "modelIds": ["openai/gpt-x"], "defaultModelId": "openai/gpt-x" }
```

`defaultModelId` 省略：不改已存默认值，但若它不在本次 `modelIds` 经 `clipToAllowed` 之后的集合里，删除该部门默认行。

`defaultModelId` 为 `""`：删除默认行。

`defaultModelId` 非空：必须属于本次保存后的可见集合，否则 400，正文 `default model is not in the department allow-list`。不部分写入。

Store 新函数放在已有方言文件旁：

- `enterprise/apps/admin-console/src/lib/db-stores/postgresql/dept-models-store.ts` 的 `setDeptModels`（约 L81）
- 同路径 `mysql/dept-models-store.ts`
- 门面 `enterprise/apps/admin-console/src/lib/dept-models-store.ts`

`setDeptDefaultModel(deptId, modelId | null)` 与 `getDeptDefaultModel(deptId)`。key 用现有 `deptKey(deptId)`（该文件已有，形如 `dept:<id>`）。

## 读出到前台

`enterprise/apps/web-portal/src/lib/admin-providers-reader.ts` 的 `listAvailableModelsForUser`（约 L162）在算出 `deptEffective` 之后：

- 用 `listDepartmentAncestorIds` 得到从叶到根的部门 id（该函数现有调用约 L174，链的方向以函数实现为准；若返回根到叶，先 `slice().reverse()` 再交给 `resolveDeptDefaultModel`）
- 批量读这些 `dept:<id>` 的默认行
- 把 `deptDefaultModelId: string | null` 加到返回值。若今天返回的是 `PortalModelOption[]`，改为 `{ models: PortalModelOption[]; deptDefaultModelId: string | null }` **会破坏调用方**。因此保持数组返回，另加函数 `readDeptDefaultModelForUser(userId, email, deptId): Promise<string | null>`，由模型列表路由一并放进 JSON。

找到前台「当前用户可见模型」的 route（搜 `listAvailableModelsForUser` 的 API handler，预期在 `enterprise/apps/web-portal/src/app/api/` 下 `me/models` 一类路径）。响应增加字段：

```json
{ "models": [], "deptDefaultModelId": "openai/gpt-x" }
```

缺省 `null`。旧客户端忽略该字段必须仍能聊天。

## 新会话

`enterprise/apps/web-portal/src/components/WorkspaceShell.tsx` 约 L193 与 L200 的 `createSession({ defaultModel: activeModel || "deepseek-chat" })`。

改为：

```ts
const picked =
  activeModel && models.some((m) => m.id === activeModel)
    ? activeModel
    : deptDefaultModelId && models.some((m) => m.id === deptDefaultModelId)
      ? deptDefaultModelId
      : models[0]?.id || activeModel || "deepseek-chat";
```

用户已经选中且仍可见的模型优先于部门默认。这是为了多会话里不把人正在用的模型换掉。

`MachiChatView.tsx` 约 L490 的「当前模型不在列表里就切走」逻辑保持。切走的目标改为：部门默认值若在列表中，否则列表第一项。不要新增第三套回退。

## 管理台 UI

部门模型勾选 UI 若已调用 `PUT /api/admin/departments/:id/models`，在每个已勾选模型旁加单选「默认」。未勾选的模型不能标默认。保存与可见集合同一个请求。

若页面上还没有部门模型勾选（store 与 route 已存在，UI 可能只在部门详情的某一块），只在**已经编辑 `modelIds` 的那一块**加单选，不要新开一个设置页。

文案用中文「默认模型」。英文用 `Default model`。

## FR / AC

- FR-1: 部门可保存至多一个默认模型，且属于保存后的可见集合。
- FR-2: 父级交集把该模型剪掉后，解析结果不为该模型。
- FR-3: 新会话在无有效 activeModel 时使用解析结果。
- FR-4: 配额页行为不变。

- AC-1: `dept-default-model.test.ts` 四条断言通过。
- AC-2: `dept-models-store.test.ts` 增加：默认值不在 allow-list 时 PUT 不写库（mock db 的 insert 次数为 0）。
- AC-3: 手工：部门只可见模型 B，默认 B；该部门用户新会话模型为 B。用户已选且仍可见的 A 不被覆盖。

## 验证命令

```bash
pnpm -C enterprise exec vitest run \
  apps/admin-console/src/lib/__tests__/dept-default-model.test.ts \
  apps/admin-console/src/lib/__tests__/dept-models-store.test.ts
```

期望：PASS。不要跑全量 enterprise 测试当作本规划的门禁。
