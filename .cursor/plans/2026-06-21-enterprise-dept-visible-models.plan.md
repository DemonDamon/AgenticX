# Enterprise admin-console：按部门批量配置可见模型

Planned-with: claude-opus-4.8

## 背景与现象

当前管理台只支持 **逐用户** 配置可见模型（`/admin/iam/users` → 用户详情 →「可见模型分配」）。部门有几十上百人时，管理员要一个个点开每个用户重复勾同一组模型，极易漏配且无法统一管控。

用户原话：
> 我现在好像看到只有针对每一个用户……分别一个个去为他们配置各种各样的模型，我能否按照部门组织去批量配置可用的模型啊

期望：在 **部门管理** 页能直接为整个部门勾选可见模型，新成员入职自动继承；用户级仍可在部门基线之上 **追加** 个人专属模型。

## 根因（已核实代码锚点）

| 锚点 | 文件 | 现状 |
|---|---|---|
| 表 `enterprise_runtime_user_visible_models` | `enterprise/packages/db-schema/src/schema/runtime-config.ts` L44-L58 | 复合主键 `(tenant_id, assignment_key, model_id)`；`assignment_key` **已经是宽 text**，目前只用 `user-ulid` 与 `email:xxx` 两种值 |
| 解析 key | `enterprise/apps/web-portal/src/lib/admin-providers-reader.ts` L95-L108 `resolveAssignmentKeys(userId, email)` | 只合并 user / email，**不读 deptId** |
| `/api/me/models` | `enterprise/apps/web-portal/src/app/api/me/models/route.ts` | 只传 `session.userId, session.email`；session 实际已带 `deptId` |
| 用户写入 API | `enterprise/apps/admin-console/src/app/api/admin/users/[id]/models/route.ts` PUT | 把 modelIds 同时写到 `userId` 与 `email:xxx` 两条 key |
| 部门 API | `enterprise/apps/admin-console/src/app/api/admin/departments/...` | 仅 CRUD，**无模型相关接口** |
| 部门管理页 | `enterprise/apps/admin-console/src/app/iam/departments/page.tsx` | 仅展示卡片/列表，无模型配置入口 |

→ Schema **已天然支持** 第三种 key（`dept:<deptId>`），主要工作量在「写入 API + 解析合并 + 管理 UI」。

## 目标

### P0（必做）
1. 数据层支持 `assignment_key='dept:<deptId>'` 行；与现有 `user`/`email:xxx` 行 **共存**。
2. 前台 `listAvailableModelsForUser` 把 user / email / **dept** 三个 key 的可见集合 **取并集**。
3. admin-console 新增 API：`GET/PUT /api/admin/departments/{id}/models`（rbac: `dept:update` 写 / `dept:read` 读）。
4. 部门管理页（`/iam/departments`）选中某部门时，详情区/抽屉里嵌入「可见模型分配」面板，UX 与用户详情面板**一致**（同款卡片网格、`已选 X / 可选 Y`）。
5. 用户详情面板的「可见模型分配」上方显示 **「继承自部门 〈部门名〉 的 N 个模型」** chips，底部勾选区只代表「该用户额外添加的模型」。
6. 删除部门时，级联清掉对应 `dept:<id>` 行（避免孤儿数据）。

### P1（同 PR 顺手做）
1. 用户详情面板提供「应用到本部门全员」一键按钮：实质 = 把当前勾选写到 `dept:<userDept>` 而非每个 user 行。
2. 部门面板提供「清空本部门额外模型」按钮（只清 `dept:<id>`，不动用户级）。

## 非目标
- 不实现「部门黑名单」（不允许某部门用某模型）。继承语义只做 union（叠加）。如客户提"减少可见模型"需求，二期再说。
- 不实现「子部门递归继承」。用户的 `deptId` 是哪个，就只应用那个部门的配置。
- 不动 gateway / quota 链路；可见模型本就只在 portal 拦截。
- 不改用户写入 API 的 `email:xxx` 兼容写双份的现状（避免回归）。

## 设计

### 数据模型
**复用现有表**，扩展 `assignment_key` 取值约定：

| key 形态 | 含义 | 已存在 |
|---|---|---|
| `<user ulid>` | 该用户专属可见 | ✅ |
| `email:<lowercase email>` | legacy 邮箱兜底 | ✅ |
| `dept:<dept ulid>` | **新增**：该部门所有成员默认可见 | ❌ |

**合并算法**（portal 解析）：
```
allowed(userId, email, deptId) = U_user ∪ U_email ∪ U_dept
```

→ 用户改部门时，旧 deptId 的模型自动失效；新 deptId 自动继承。无需扫数据。

### RBAC
- 读：`dept:read`（与部门 GET 一致）
- 写：`dept:update`（与部门 PATCH 一致；不引入新 scope）

### UI 信息架构
**部门管理页**（`/iam/departments`）：选中部门后右侧详情区新增 `DeptVisibleModelsCard` 区块；样式与用户详情面板里那块完全一致，只是 PUT 目标换成部门 API。

**用户详情**：保留现有勾选 UI，**前置一行只读 chips** `继承自 部门X：8 个模型`，悬浮显示具体模型 id；用户额外勾选区在下方。

## 实施步骤（给 Composer 2.5）

### Step 1 — 后端：部门可见模型 store
新建 `enterprise/apps/admin-console/src/lib/dept-models-store.ts`：

```ts
import { enterpriseRuntimeUserVisibleModels as uvmTable } from "@agenticx/db-schema";
import { getIamDb } from "@agenticx/iam-core";
import { and, eq } from "drizzle-orm";

const DEPT_PREFIX = "dept:";

function deptKey(deptId: string): string {
  return `${DEPT_PREFIX}${deptId}`;
}

function requiredTenant(): string {
  const t = process.env.DEFAULT_TENANT_ID?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required.");
  return t;
}

export async function getDeptModels(deptId: string): Promise<string[]> {
  const tid = requiredTenant();
  const db = getIamDb();
  const rows = await db
    .select({ modelId: uvmTable.modelId })
    .from(uvmTable)
    .where(and(eq(uvmTable.tenantId, tid), eq(uvmTable.assignmentKey, deptKey(deptId))));
  return [...new Set(rows.map((r) => r.modelId))];
}

export async function setDeptModels(deptId: string, modelIds: string[]): Promise<string[]> {
  const tid = requiredTenant();
  const db = getIamDb();
  const unique = Array.from(new Set(modelIds.map((m) => m.trim()).filter(Boolean)));
  await db.delete(uvmTable).where(and(eq(uvmTable.tenantId, tid), eq(uvmTable.assignmentKey, deptKey(deptId))));
  if (unique.length === 0) return [];
  const rows = unique.map((modelId) => ({ tenantId: tid, assignmentKey: deptKey(deptId), modelId }));
  // 复用 user-models-store 的 chunked 100 写法
  for (let i = 0; i < rows.length; i += 100) {
    await db.insert(uvmTable).values(rows.slice(i, i + 100)).onConflictDoNothing();
  }
  return unique;
}

export async function deleteDeptAssignment(deptId: string): Promise<void> {
  const tid = requiredTenant();
  const db = getIamDb();
  await db.delete(uvmTable).where(and(eq(uvmTable.tenantId, tid), eq(uvmTable.assignmentKey, deptKey(deptId))));
}

export { DEPT_PREFIX, deptKey };
```

> 不引入新表；与 `user-models-store.ts` 并列，关注点分离即可。

### Step 2 — 后端：部门 API 路由
新建 `enterprise/apps/admin-console/src/app/api/admin/departments/[id]/models/route.ts`：

- `GET`：要求 `dept:read`，校验部门归属当前租户，返回 `{ deptId, modelIds: [...] }`。
- `PUT`：要求 `dept:update`，body `{ modelIds: string[] }`，复用 `setDeptModels`，返回 `{ deptId, modelIds: saved }`。
- 部门不存在 → 404，body 非数组 → 400。
- 文件结构对齐 `app/api/admin/users/[id]/models/route.ts`（包括 envelope `{ code, message, data }`）。

部门校验函数：复用 `@agenticx/iam-core` 现有 `getDepartment(tenantId, deptId)`（若不存在则在 iam-core 加一个最小函数：直接 `select().from(departments).where(eq(id) and eq(tenantId)).limit(1)`）。

### Step 3 — 后端：部门删除时级联清理
文件：`enterprise/apps/admin-console/src/app/api/admin/departments/[id]/route.ts` 的 `DELETE` 处理函数（已存在）。
- 在调用部门删除业务函数前后**同事务**或**紧随**调用 `deleteDeptAssignment(deptId)`；幂等写法即可（ON CONFLICT 不会发生因为是 DELETE）。
- 若 iam-core 的 `deleteDepartment` 已抛错，**必须** `await deleteDeptAssignment` 在成功路径之后；失败则不清理（保守）。

### Step 4 — 前台：解析合并 dept key
**关键改动**，必须严格按以下顺序：

1. 修改 `enterprise/apps/web-portal/src/lib/admin-providers-reader.ts`：
   - `resolveAssignmentKeys(userId, email, deptId)` 增加第三个参数；若 `deptId` 非空，向 set 里 add `dept:<deptId>`。
   - `listAvailableModelsForUser(userId, email, deptId)` 同步加第三个参数并向下传。
2. 修改 `enterprise/apps/web-portal/src/app/api/me/models/route.ts`：
   - `listAvailableModelsForUser(session.userId, session.email, session.deptId ?? undefined)`。
3. 既有调用方扫一遍：`enterprise/apps/web-portal/src/app/api/me/models` 是唯一调用点（搜索结果证实）。
4. **不要**改 `email:xxx` 兼容路径，保留 legacy 行为。

### Step 5 — admin UI：部门面板嵌入「可见模型分配」
文件：`enterprise/apps/admin-console/src/app/iam/departments/page.tsx`

1. 在用户详情用过的 `VisibleModelsCard` 拆出 / 抽到 `enterprise/apps/admin-console/src/components/visible-models-card.tsx`（如不存在则现拆，使其同时支持 `target: { kind: "user" | "dept", id: string }`，对内 fetch `/api/admin/users/{id}/models` 或 `/api/admin/departments/{id}/models`）。
2. 选中部门时，在右侧详情区下方挂载 `<VisibleModelsCard target={{ kind: "dept", id: selected.id }} />`。
3. 文案：`勾选后该部门成员默认可见这些模型；用户级配置仍会叠加。`

### Step 6 — admin UI：用户详情显示部门继承
文件：`enterprise/apps/admin-console/src/app/iam/users/page.tsx`（用户详情面板，搜 `visibleModelsHint`）。

1. 在勾选区上方加只读 chips 区：`继承自部门 〈path〉：{deptModelIds.length} 个模型`，hover tooltip 列模型 id。
2. 数据：用户详情打开时多发一次 `GET /api/admin/departments/{user.deptId}/models`（`user.deptId` 已在 detail）。无 deptId（root 用户）→ 不渲染该 chips 行。
3. 不改写入路径。提示文案：`这里勾选的是该用户在部门基线之上额外可见的模型。`

### Step 7 — admin i18n
文件：`enterprise/apps/admin-console/messages/zh.json` 与 `en.json`：
- 新增 `iam.dept.visibleModels.title` `"可见模型分配"` / `"Visible models"`
- 新增 `iam.dept.visibleModels.hint` `"勾选后该部门成员默认可见这些模型；用户级配置仍会叠加。"`
- 新增 `iam.user.detail.inheritedFromDept` `"继承自部门 {dept}：{count} 个"`

### Step 8 — 单测
1. `enterprise/apps/web-portal/src/lib/__tests__/admin-providers-reader.test.ts`：新增 case：mock 数据有 `dept:<id>` 行，调用 `listAvailableModelsForUser(uid, email, deptId)` 应包含部门模型；`deptId` 不传应**不**包含部门模型（向后兼容）。
2. `enterprise/apps/admin-console/src/lib/__tests__/dept-models-store.test.ts`（新建）：`setDeptModels` → `getDeptModels` 往返、覆盖写、清空、`deleteDeptAssignment`。可参考 `quota-plans-store.test.ts` 的 mocking 风格，或直接用现有 IAM 测试 DB fixture。
3. 现有 `admin-providers-reader.test.ts` 不应回归（旧签名兼容）。

### Step 9 — E2E 手测脚本（不强制自动化）
在 plan 完成 PR 描述里附：
1. 进 `/iam/departments` → 选「前端」→ 勾 GLM-5.1 + Kimi-k2.6 → 保存。
2. portal 用 Alice（属前端部门）登录，`/api/me/models` 应包含上面两个；其他模型不可见。
3. admin 切到 Alice 用户详情 → 看到「继承自部门 前端：2 个」chips。
4. Alice 详情勾上 doubao-seed → 保存。Alice 现在应见到 3 个模型。
5. 把 Alice 改到「运营」部门 → portal 重新登录后只剩 doubao-seed（用户额外）+ 运营部门勾的（如果有）。
6. 删除「前端」部门 → `enterprise_runtime_user_visible_models` 中 `assignment_key='dept:前端'` 的行被清掉。

## 验收标准（AC）

- AC-1：部门面板可勾选/保存可见模型，刷新后保留。
- AC-2：portal 用户登录拿到的可见模型 = `用户` ∪ `email` ∪ `部门` 三集合并集，去重。
- AC-3：用户详情上方显示部门继承 chips 与正确数量；用户切部门后 chips 数量随之变。
- AC-4：删除部门后，对应 `dept:<id>` 行从表中消失（直接 SQL 验证）。
- AC-5：写部门可见模型需 `dept:update` scope；权限不足 → 403。
- AC-6：所有现有用户级测试不回归；新增 `dept-models-store` 测试与 `admin-providers-reader` dept case 通过。
- AC-7：`pnpm -C enterprise/apps/web-portal typecheck` 与 `pnpm -C enterprise/apps/admin-console typecheck` 通过。

## 验证命令
```bash
pnpm -C enterprise/apps/admin-console test
pnpm -C enterprise/apps/admin-console typecheck
pnpm -C enterprise/apps/web-portal test
pnpm -C enterprise/apps/web-portal typecheck
# 端到端冒烟（需先 bash enterprise/scripts/start-dev-with-infra.sh）
psql "$DATABASE_URL" -c "select assignment_key, count(*) from enterprise_runtime_user_visible_models group by 1;"
```

## 影响文件清单

### 新增
- `enterprise/apps/admin-console/src/lib/dept-models-store.ts`
- `enterprise/apps/admin-console/src/lib/__tests__/dept-models-store.test.ts`
- `enterprise/apps/admin-console/src/app/api/admin/departments/[id]/models/route.ts`
- `enterprise/apps/admin-console/src/components/visible-models-card.tsx`（从 `iam/users/page.tsx` 抽出，若未抽出过）

### 修改
- `enterprise/apps/web-portal/src/lib/admin-providers-reader.ts`（解析增加 deptId）
- `enterprise/apps/web-portal/src/app/api/me/models/route.ts`（透传 deptId）
- `enterprise/apps/web-portal/src/lib/__tests__/admin-providers-reader.test.ts`（新增 case）
- `enterprise/apps/admin-console/src/app/iam/departments/page.tsx`（嵌入 VisibleModelsCard）
- `enterprise/apps/admin-console/src/app/iam/users/page.tsx`（继承 chips）
- `enterprise/apps/admin-console/src/app/api/admin/departments/[id]/route.ts`（DELETE 级联清理）
- `enterprise/apps/admin-console/messages/zh.json` / `en.json`（i18n）

### 不动（明确）
- DB schema 与 drizzle migrations
- `runtime-legacy-migrate.ts`（旧 JSON 仅 user 维度）
- gateway 任意代码

## 风险与回退

- **风险 1**：解析 union 后用户可见模型变多（向后兼容方向上不算回归）；若客户期望"用户被剥夺"语义，则与本期 union-only 设计冲突——**不接受**，记录到 P2。
- **风险 2**：deptId 为空（root/未分配部门）的用户不会继承任何部门——预期行为；UI 上需保证不渲染 chips（避免显示 `继承自部门 null`）。
- **风险 3**：`assignment_key` 长 text 与 `dept:<26 ulid>` ≈ 31 字节；现有索引/主键足够，不需要长度调整。
- **风险 4**：删除部门 API 若先删了部门再清 dept models，中间事务失败将留孤儿；**接受**——后续 `enterprise/scripts` 出 `cleanup-orphan-dept-models.sql` 兜底脚本即可。
- **回退**：单 commit / Plan-Id revert；schema 无变更，回退即代码 + UI 即可，DB 中残留的 `dept:` 行无害（解析逻辑一并被回退后不会被读到）。

## 提交规范

- `Plan-Id: 2026-06-21-enterprise-dept-visible-models`
- `Plan-File: .cursor/plans/2026-06-21-enterprise-dept-visible-models.plan.md`
- `Plan-Model: <询问用户>`
- `Impl-Model: <询问用户>`
- `Made-with: Damon Li`
