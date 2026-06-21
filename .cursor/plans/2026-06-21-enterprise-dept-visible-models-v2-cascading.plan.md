# Enterprise admin-console：可见模型分配 v2 — 抽屉化 + 厂商分组 + 级联收窄

Planned-with: claude-opus-4.8

## 背景与现象

v1（commit `4bcc5e08` + `cb413e45`）已落地按部门配置可见模型，但用户验收后提了两条改动：

1. **UX 不合理**：部门页把「可见模型分配」直接平铺在详情区下方，所有厂商的模型混在一个网格里，视觉很挤；用户希望像「编辑用户」那样，点「配置可见模型」按钮后弹出右侧抽屉（Sheet），抽屉内**按厂商分组**编辑。
2. **语义不对**：v1 用的是 union（用户 ∪ 部门 ∪ 上级部门），导致父部门「研发」配 8 个模型时，子部门「前端」自动可见 8 个；用户期望反过来——**父部门是上限，子部门只能在父部门已勾的子集里再筛**。例：根部门 = ABC，中间部门 = AB（在 ABC 里筛），叶子部门 = B（在 AB 里筛）；用户级也只能在叶子部门集合里筛。

> 用户原话：「最顶级的部门它配置完之后，比方说我现在有 ABC 模型，那我在部门在这个成绩，我配置 AB 模型，那在这个部门下面的子级下面，他也只能够看到 B 模型」。

这两点叠加，需要一个连贯的 plan 让 Composer 2.5 一次实施落地。

## 与 v1 的关系（重要）

- v1 plan：`.cursor/plans/2026-06-21-enterprise-dept-visible-models.plan.md`（不删、不改）。
- v1 已落库 schema、API、store、portal 解析 union 三件套；本 plan **只反转语义、改造 UI**，不动表结构、不动 API path。
- 本 plan 完成后，原 v1 的 union 行为彻底替换为级联收窄（cascading restriction）。

## 根因（已核实代码锚点）

| 锚点 | 文件 | 现状 |
|---|---|---|
| Portal 解析 union | `enterprise/apps/web-portal/src/lib/admin-providers-reader.ts` `resolveAssignmentKeys` | 把 user / email / dept-chain 三套 key 并集 → 需要改成级联交集 |
| 部门可见模型 store | `enterprise/apps/admin-console/src/lib/dept-models-store.ts` | `getInheritedDeptModels` 是上级链 union → 改成 effective-set（递归交集） |
| 用户 models GET | `enterprise/apps/admin-console/src/app/api/admin/users/[id]/models/route.ts` | 当前返回 `inheritedDeptModelIds` 是 union；需改返回 `effectiveAllowedIds`（用户在 UI 里能勾的可选集） |
| 部门页 UI | `enterprise/apps/admin-console/src/app/iam/departments/page.tsx` | 现内嵌 `<VisibleModelsCard target="dept" />`；需删除内嵌，改为「配置可见模型」按钮 + Sheet |
| 用户页 UI | `enterprise/apps/admin-console/src/app/iam/users/page.tsx` | 当前用户详情 Sheet 里直接平铺 VisibleModelsCard；保留 Sheet 但内部模型区改为按厂商分组 |
| 共享组件 | `enterprise/apps/admin-console/src/components/visible-models-card.tsx` | 当前是平铺 grid；需重写为：按 provider 分组、可选集由 props 传入（不再硬性使用全集） |
| Sheet 组件 | `@agenticx/ui` 已导出 `Sheet/SheetContent/...` | ✅ 直接用 |

## 设计

### 核心语义：cascading restriction（级联收窄）

定义递归函数 `effective(scope)`：

```
effective(root_dept) = isConfigured(root_dept) ? root_dept.set : ALL_ENABLED_MODELS
effective(dept)      = isConfigured(dept) ? (dept.set ∩ effective(parent)) : effective(parent)
effective(user)      = isConfigured(user) ? (user.set ∩ effective(user.dept)) : effective(user.dept)
```

其中：
- `isConfigured(scope)` ≡ 该 scope 在 `enterprise_runtime_user_visible_models` 里**至少有一行**。空配置 = 透传父级（不收窄）。
- `ALL_ENABLED_MODELS` = 启用的 `provider × model` 全集，由 `readProviders()` 计算。
- `user.dept` 沿用 v1 的 `listDepartmentAncestorIds`，但语义改为级联交集。

**保存约束**（admin UI 写入时）：
- 部门保存时：写入 `dept.set`，但 UI 上能勾选的候选 = `effective(parent)`。后端写入时**也强制裁剪**到 `effective(parent)`，避免用户绕过 UI 直接 PUT。
- 用户保存时同理：候选 = `effective(user.dept)`，后端裁剪。

**清理副作用**：父部门收窄时，子部门/用户已保存的 set 可能出现「被孤立」的 model（不再属于父集合）。两种处理方案：
- **方案 A（推荐，本期采用）**：**不主动清理** DB；读时按 effective() 现算，孤立 model 自然不生效。读 API 多返回一个 `prunedModelIds` 让 UI 提示「以下模型已超出父部门允许范围，将不生效」。
- 方案 B：父保存时递归裁剪所有子部门/用户行 → 复杂、可能 race，本期不做。

### UX：抽屉化 + 厂商分组

**部门页**（`/iam/departments`）：
- 移除 `currentNode` 卡片下的 `<VisibleModelsCard ... />` 内嵌区。
- 在 `currentNode` 卡片操作行（编辑 / 移动 / 删除）**最左侧**新增按钮 **「配置可见模型」**（图标用 `Sparkles`）。
- 点击 → 打开右侧 `<Sheet side="right" className="sm:max-w-xl">`，内部承载新的 `VisibleModelsEditor` 组件。

**用户页**（`/iam/users`）：
- 用户详情 Sheet 内的「可见模型分配」原本平铺 → 改为一行紧凑摘要 + **「配置」按钮**：摘要文案 `已选 X / 父部门允许 Y`；点击「配置」打开**第二层 Sheet**（嵌套）或就地展开。两层 Sheet 视觉容易混乱，**采用就地展开**：用 `<details>` 风格或一个内联可折叠区块。
- 折中方案：用户编辑用 EditDialog，可见模型仍在用户详情 Sheet 内，但**默认折叠**为一行摘要，点击展开后才显示厂商分组。

### `VisibleModelsEditor` 组件（新）

替换现有 `VisibleModelsCard`：

```ts
type Target =
  | { kind: "user"; id: string; deptId: string | null }
  | { kind: "dept"; id: string };

type Props = {
  target: Target;
  onClose?: () => void;          // 部门 Sheet 用
  variant?: "sheet" | "inline";  // dept 用 sheet，user 用 inline 折叠
};
```

内部行为：
1. 加载 `/api/admin/{target.kind}s/{id}/models` → `{ modelIds, parentAllowedIds, parentSourceLabel, prunedModelIds }`。
2. 加载 providers 全集（启用项），按 `provider.id` 分组。每组：
   - Header：`<provider.displayName>` + `已选 X / 可选 Y` + 全选/反选按钮（仅作用于本厂商内）
   - Body：模型 `<button>` 网格（沿用 v1 单卡样式），但**不在父集合内的模型置灰 + tooltip「已超出父部门允许范围」**，禁止勾选。
   - 默认折叠 / 展开第一组（避免一屏全开）。
3. 顶部一行 chip：`继承上限：{parentSourceLabel}（{parentAllowedIds.length} 个）`，hover 列出具体 id。
4. 底部 `<SheetFooter>`：保存 / 取消（user 内联模式可省略，每次 toggle 即时保存沿用 v1 节奏）。
5. 部门 Sheet 模式：批量勾选后点保存才写库（避免每点一下来一次 PUT）。

### 后端改动

- `dept-models-store.ts`：
  - 删除 `getInheritedDeptModels`（union 语义）。
  - 新增 `getEffectiveDeptAllowed(deptId, allEnabledIds)`：递归计算 effective set；空配置 = 透传父级；根部门空配置 = `allEnabledIds`。
  - 新增 `setDeptModels` 内部强制裁剪到 `effective(parent)`。
- `user-models-store.ts`：保留现有签名，但 `setUserModels` 强制裁剪到 `effective(user.dept)`。
- `/api/admin/departments/[id]/models` GET：返回 `{ modelIds, parentAllowedIds, parentLabel }`；PUT 后端再次裁剪。
- `/api/admin/users/[id]/models` GET：返回 `{ modelIds, parentAllowedIds, parentLabel, prunedModelIds }`；PUT 同上。
- `/api/admin/providers` GET：UI 在 dept Sheet 中需获取「启用模型全集」用作根部门候选 → 现接口已返回，无需改动。

### Portal 解析（`admin-providers-reader.ts`）

- 完全删除 `resolveAssignmentKeys` 的 union 集合行为。
- 新写法：

```ts
async function listAvailableModelsForUser(userId, email, deptId) {
  const allEnabled = readProvidersAndFlatten();      // ALL_ENABLED_MODELS
  const userMap = await readUserModels();            // 全表 key → modelIds[]

  const effectiveDept = computeEffectiveDept(deptId, userMap, allEnabled);
  const userKey = pickUserKey(userId, email);        // 兼容 user-id / email:xxx / legacy
  const userSet = userMap[userKey] ?? null;

  const effective =
    userSet === null ? effectiveDept : intersect(userSet, effectiveDept);

  return allEnabled.filter(m => effective.has(m.id));
}
```

- `computeEffectiveDept(deptId)`：递归走 `listDepartmentAncestorIds`，从根开始按公式合并；任一层级 `userMap[dept:<id>]` 不存在 = 透传。
- 保留 legacy email key 兼容：作为「user 配置」的另一来源（与 user-id 合并取并集，再交集 effective dept）。

## 实施步骤（给 Composer 2.5）

### Step 1 — 后端：effective-set 工具
- 新建 `enterprise/apps/admin-console/src/lib/effective-models.ts`（admin-console 与 portal 共享，先放 admin-console 下，portal 端复制实现或抽到 `@agenticx/iam-core`；为最小改动，**放 admin-console** 并在 portal 内同名落一份共享 helper，复制粘贴可接受，单测分别覆盖）。
  - `computeEffectiveDeptAllowed(deptId, ctx): { allowedIds: Set<string>, parentLabel: string }`
  - `ctx = { allEnabledIds, userVisibleMap, ancestorChainResolver }`
- 单测：根空 → 全集；根=AB,子空 → AB；根=AB,子=BC → B；根=AB,子=CD → ∅。

### Step 2 — 后端：`dept-models-store` 重构
- 删除 `getInheritedDeptModels`。
- `setDeptModels(deptId, modelIds)`：保存前用 `computeEffectiveDeptAllowed(parentId)` 裁剪。
- 新增 `readDeptEditPayload(deptId)`：返回 `{ modelIds, parentAllowedIds, parentLabel }`。

### Step 3 — 后端：用户 store 与 API 同步
- `setUserModels` 加裁剪：`computeEffectiveDeptAllowed(user.deptId)`。
- `/api/admin/users/[id]/models` GET → `{ userId, modelIds, parentAllowedIds, parentLabel, prunedModelIds }`；保留旧字段 `inheritedDeptModelIds` 暂时镜像 `parentAllowedIds`（兼容已部署前端缓存），下个 sprint 删。

### Step 4 — 后端：portal 解析重写
- `admin-providers-reader.ts`：删除 union；按上面伪码实现 effective + intersect。
- 单测：扩 `admin-providers-reader.test.ts`：
  - 父=AB、子空、用户空 → AB
  - 父=AB、子=B、用户空 → B
  - 父=AB、子=B、用户=AB → B（被夹回）
  - 父=AB、子=CD、用户=任意 → ∅

### Step 5 — UI：`VisibleModelsEditor` 组件
- 新建 `enterprise/apps/admin-console/src/components/visible-models-editor.tsx`。
- 删除旧 `visible-models-card.tsx`（或保留为薄 wrapper 给可能的兼容；倾向直接删）。
- 内部按 provider 分组渲染；置灰超出父集合项；提供「全选本厂商 / 反选本厂商」。
- props：`target`、`variant`、`onSaved`。
- 数据加载：复用现有 endpoints（GET 含 parentAllowedIds）。

### Step 6 — UI：部门页改抽屉
- `iam/departments/page.tsx`：
  - 移除 `currentNode` Card 下的内联 `<VisibleModelsCard />`。
  - 在 `currentNode` 操作 Toolbar 最左侧加 `「配置可见模型」` Button（`Sparkles` 图标）。
  - 新 state `modelEditorOpen`，控制 `<Sheet>` 打开。
  - Sheet 内 `<VisibleModelsEditor target={{ kind: "dept", id: currentNode.id }} variant="sheet" onSaved={...} />`。

### Step 7 — UI：用户页内联折叠
- `iam/users/page.tsx`：
  - 用户详情 Sheet 内原 `<VisibleModelsCard />` 区域：默认折叠为一行摘要 chip + 「配置」按钮（无需第二层 Sheet）。
  - 展开后挂 `<VisibleModelsEditor target={{ kind: "user", id, deptId }} variant="inline" />`。
  - 顶部继承 chips 文案改：`父部门允许 N 个模型（点开查看）`，配合 effective 语义，避免再误导成「继承自部门的可见数」。

### Step 8 — i18n
- `messages/zh.json` / `en.json`：
  - 删除 v1 新增的 `inheritedFromDept` / `inheritedFromDeptEmpty`（及 en 对应）。
  - 新增：
    - `iam.dept.visibleModels.openEditor` / `iam.dept.visibleModels.sheetTitle`
    - `iam.dept.visibleModels.parentAllowed` `"父部门允许：{count}"`
    - `iam.dept.visibleModels.providerSelectAll` / `providerClear`
    - `iam.dept.visibleModels.outOfParent` `"已超出父部门允许范围"`
    - `iam.user.detail.visibleModelsSummary` `"已选 {selected} / 父部门允许 {parentAllowed}"`
    - `iam.user.detail.visibleModelsConfigure` `"配置"`
    - `iam.user.detail.prunedHint` `"以下模型已超出父部门允许范围，将不生效"`

### Step 9 — 单测 / 类型检查
- `enterprise/apps/admin-console/src/lib/__tests__/effective-models.test.ts`（新）
- `enterprise/apps/admin-console/src/lib/__tests__/dept-models-store.test.ts`（更新：union → 级联）
- `enterprise/apps/web-portal/src/lib/__tests__/admin-providers-reader.test.ts`（更新 4 个 case）
- `pnpm -C enterprise/apps/admin-console test && typecheck`
- `pnpm -C enterprise/apps/web-portal test && typecheck`

### Step 10 — 手测脚本（PR 描述附）
1. 根「总部」不配置 → 任何用户可见 = 全集。
2. 根配 ABC，中间「研发」配 AB，叶子「前端」配 B：
   - 进研发抽屉，模型选项里 C 置灰带 tooltip。
   - 进前端抽屉，A 置灰，仅 B 可勾。
   - Alice（前端用户）登录 portal `/api/me/models` 仅 B。
3. 父收窄：把研发改成 A，再开前端抽屉 → 之前选的 B 进入 `prunedModelIds` 红字提示「将不生效」；不主动清库。
4. 用户绕过 UI 直接 PUT 不在父集合的 model → 后端裁剪后保存为 ∅，返回 `prunedModelIds` 反馈。

## 验收标准（AC）

- AC-1：部门页「配置可见模型」按钮打开右侧 Sheet，模型按厂商分组、置灰超出父集合项。
- AC-2：父部门收窄后，子部门 / 用户 portal 可见集合**自动收窄**（无需手动点子部门）。
- AC-3：根部门未配置 → 子部门候选 = 全集；任一层未配置 = 透传父级。
- AC-4：portal `/api/me/models` 完全反映级联交集，不再出现 union 现象。
- AC-5：admin POST/PUT 写入越权模型（不在父集合）一律被后端裁剪，返回 200 + `prunedModelIds`，不抛错（避免双端 UI 状态死循环）。
- AC-6：所有单测通过；不再保留 `getInheritedDeptModels` 等 union 语义命名。
- AC-7：`pnpm -C enterprise/apps/admin-console typecheck` / `web-portal typecheck` 全绿。

## 影响文件清单

### 新增
- `enterprise/apps/admin-console/src/lib/effective-models.ts`
- `enterprise/apps/admin-console/src/lib/__tests__/effective-models.test.ts`
- `enterprise/apps/admin-console/src/components/visible-models-editor.tsx`

### 修改
- `enterprise/apps/admin-console/src/lib/dept-models-store.ts`（删 union，新增 cascading 裁剪）
- `enterprise/apps/admin-console/src/lib/user-models-store.ts`（写入加裁剪）
- `enterprise/apps/admin-console/src/lib/__tests__/dept-models-store.test.ts`（语义更新）
- `enterprise/apps/admin-console/src/app/api/admin/departments/[id]/models/route.ts`（GET 多返 parentAllowedIds）
- `enterprise/apps/admin-console/src/app/api/admin/users/[id]/models/route.ts`（GET 多返 parentAllowedIds + prunedModelIds）
- `enterprise/apps/admin-console/src/app/iam/departments/page.tsx`（移除内联，加 Sheet 入口）
- `enterprise/apps/admin-console/src/app/iam/users/page.tsx`（内联折叠 + Editor 替换）
- `enterprise/apps/admin-console/messages/zh.json` / `en.json`
- `enterprise/apps/web-portal/src/lib/admin-providers-reader.ts`（union → effective intersect）
- `enterprise/apps/web-portal/src/lib/__tests__/admin-providers-reader.test.ts`

### 删除
- `enterprise/apps/admin-console/src/components/visible-models-card.tsx`（被 editor 取代）

### 不动
- DB schema、drizzle migrations
- gateway / quota / 路由审计任意代码
- v1 plan 文件

## 风险与回退

- **风险 1**：用户现有 v1 配置在新语义下「视觉上突然变少」（因为 union 改成 intersect）。需在升级 release notes 明示，并提供后端 migration 脚本输出统计：哪些 dept/user 的当前 set 不被父集合容纳。
- **风险 2**：根部门空配置 = 全集，可能让首次使用客户「打开 portal 啥都看见」。这是预期行为；admin-console 顶部加一条提示「未配置根部门 → 默认放行所有启用模型」即可。
- **风险 3**：Sheet 在窄屏 < 640px 下抽屉会盖满，移动端体验需测；本期不专门优化。
- **回退**：单 commit / Plan-Id revert；DB 没改、API path 没改，回退即代码。已写入的越权 model 不影响数据完整性（读时被 effective 过滤）。

## 提交规范

- `Plan-Id: 2026-06-21-enterprise-dept-visible-models-v2-cascading`
- `Plan-File: .cursor/plans/2026-06-21-enterprise-dept-visible-models-v2-cascading.plan.md`
- `Plan-Model: claude-opus-4.8`
- `Impl-Model: composer-2.5-fast`（待用户确认）
- `Made-with: Damon Li`
