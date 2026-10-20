# 能力回流 B12：「组织与成员」里看用量、改上限

Planned-with: Opus 5.5
Suggested-Impl-Model: Grok 4.7
Acceptance-Model: Opus 5.5
Parent: `.cursor/plans/2026-10-20-enterprise-capability-backflow.plan.md`
Depends-on: B9a、B9b（分层预算与配置接口）、B10（次数上限配置与用量接口）、B11（组织与成员页）

## 目标

管理员在「组织与成员」一页里就能看清并调整每个人的使用上限，不用再去用量页、额度页来回找：

- 成员以卡片展示：本周期已用 / 个人生效额度的环形进度，额度来源（个人特例 / 用户组 / 每人默认），联网搜索与深度研究的开通与剩余次数；可切换回列表视图。
- 工具栏「全员默认上限」：一个对话框，三个标签「Token / 美元」「联网搜索」「深度研究」，编辑每人默认。
- 成员详情里编辑个人特例（Token / 美元 + 两项次数）。
- 用户组编辑里设「本组每人上限」（Token / 美元 + 两项次数）。
- 组织结构对话框里，每个部门可设部门共享上限（Token / 美元 + 两项次数）。
- 页面上一句话说清继承顺序：「个人特例优先，其次取所在用户组中最严的上限，最后使用全员默认；部门与公司的共享上限同时生效。」

## 现状（已核实，以 B9a / B9b / B10 / B11 完成后为准）

- 页面：`enterprise/apps/admin-console/src/app/iam/members/page.tsx`（B11 新建），组件 `src/components/iam/{MembersRoster,DepartmentTree,DepartmentManager,BulkImportWizard}.tsx`、`UserGroupsPanel.tsx`。
- 预算配置：`GET/PUT /api/metering/budget`（v2，支持局部字段与 `expectedUpdatedAt`，B9b）；个人层解析 `@agenticx/config` 的 `memberSpendingRules`（B9b）。
- 次数配置：`GET/PUT /api/metering/quota` 的 `featureUsage`（B10）；用量 `GET /api/metering/feature-usage`（B10）；解析 `resolveFeatureUsagePolicies`（B10）。
- Token 用量：`usage_records` 表；`enterprise/packages/iam-core/src/quota-remaining.ts` 只有按单一范围查询（`getQuotaWindowUsageForScope` 等），没有批量按用户查。
- 来源（`$DELIVERY_REPO`，界面与聚合层）：`apps/admin-console/src/lib/quota-overview.ts`（`loadUserQuotaOverview` L482）、`src/app/api/admin/users/quota-overview/route.ts`、`src/app/api/admin/user-groups/overview/route.ts`、`src/app/api/admin/users/[id]/quota/route.ts`、`packages/iam-core/src/quota-remaining.ts` 的 `getQuotaWindowUsagesForUsers`（L776）；组件 `QuotaRing.tsx`（70）、`DefaultMemberBudgetCard.tsx`、`metering/UsageLimitEditor.tsx`（30）、`metering/BudgetScopeEditor.tsx`（64）、`metering/SpendingLimitEditor.tsx`、`quota/FeatureUsageLimitEditor.tsx`（129）、`quota/FeatureUsageLimitFields.tsx`、`UserDetailEditor.tsx` 的上限区、`iam/UserGroupsPanel.tsx` 的组上限区（约 L723–L747）。

## 改动

### 1. 聚合接口

- `packages/iam-core/src/quota-remaining.ts` 新增 `getQuotaWindowUsagesForUsers(tenantId, userIds, windows)`：一次查询返回多个用户在日 / 周 / 月窗口的 Token 与费用用量（照搬，按主仓 `usage_records` 列名适配，两种方言）。
- 新文件 `apps/admin-console/src/lib/quota-overview.ts`：`loadUserQuotaOverview(tenantId, userIds)` → 每人 `{ userId, budget: { rule, source, used, periodLabel }, features: { search_provider_calls, deep_research_runs }: { limit, used, remaining, source } }`。只做额度部分；**不做**模型授权来源标签（见「待办」）。
- 新接口 `GET /api/admin/users/quota-overview?userIds=a,b,c`（最多 100 个，`requireAdminScope(["metering:read"])`）。
- 新接口 `GET /api/admin/user-groups/overview`：每组成员数与本组规则摘要。
- 个人特例写入不新增接口：前端用 `PUT /api/metering/budget`（只传 `users`，带 `expectedUpdatedAt`）与 `PUT /api/metering/quota`（只改 `featureUsage.*.users`）。若 B10 的 quota 接口不支持局部字段，则在本计划给 quota `PUT` 增加与 B9b 相同的局部字段合并与 `expectedUpdatedAt` 冲突检测。

### 2. 组件（照搬交付仓并适配主仓 UI 原语）

- `src/components/quota/QuotaRing.tsx`、`src/components/quota/LimitEditor.tsx`（合并交付仓 `UsageLimitEditor` + `BudgetScopeEditor` + `SpendingLimitEditor` + `FeatureUsageLimitEditor` 的能力：三个标签，`scope: "defaults" | "groups" | "users" | "departments"`，Token 与美元二选一、周期日 / 周 / 月、预警阈值、个人层可选到达上限后动作，部门层固定为停止请求）。
- `MembersRoster.tsx`：增加「卡片 | 列表」切换（默认卡片，选择记在 `localStorage`）；卡片内容见「目标」；当前页成员 id 批量调用 quota-overview；卡片「详细编辑」打开现有详情抽屉并定位到上限区。
- 成员详情抽屉增加「使用上限」区：`LimitEditor scope="users"`，说明「只限制这个人，优先于用户组和全员默认；部门与公司共享上限仍生效。关闭后恢复继承。」
- 页面工具栏增加「全员默认上限」按钮 → 对话框 `LimitEditor scope="defaults"`。
- `UserGroupsPanel.tsx` 编辑抽屉增加「本组每人上限」区：`LimitEditor scope="groups"`；组卡片上显示「本组每人上限」摘要或「继承上级」。
- `DepartmentManager.tsx` 部门设置里增加「部门共享上限」：`LimitEditor scope="departments"`。
- 页面顶部说明一句继承顺序（见目标）。界面不出现表名、接口路径、环境变量。

## In scope / Out of scope

- In：批量用量查询、额度总览接口、组总览接口、上述组件与四处编辑入口、卡片视图。
- Out：模型授权来源标签（「部门继承」类芯片）；批量调部门、批量建组（交付仓 `MemberBatchBar`）；公司月度上限与组织共享上限的编辑位置（仍在 B9b 的 `/metering/quota`）；用量与成本页重构。

## 待办（本计划不做）

- 成员卡上的「可用模型 + 来源」芯片（需要聚合个人特批、用户组、部门可见模型与能力包，主仓还没有聚合层）。
- 交付仓的批量操作栏。

## 验收

- AC-1：`packages/iam-core` 新增 `getQuotaWindowUsagesForUsers` 测试（多用户、多窗口、空用户列表）。
- AC-2：`apps/admin-console`：`lib/__tests__/quota-overview.test.ts`（来源判定：特例 / 组 / 默认 / 无；次数剩余计算）；`api/admin/users/quota-overview/__tests__/route.test.ts`（超过 100 个 id 400；无权限 403）；`api/admin/user-groups/overview` 路由测试。
- AC-3：组件测试：`LimitEditor` 切换 Token / 美元互斥、部门层动作固定、保存时只提交对应 scope 的局部字段。
- AC-4：`pnpm -C enterprise/packages/iam-core test && typecheck`；`pnpm -C enterprise/apps/admin-console typecheck && test && lint`。
- AC-5（验收方手工，`http://localhost:3001/iam/members`）：成员卡显示用量环与来源；设全员默认 100 万 Token / 月 → 无特例成员卡片显示「每人默认」；给某用户组设 50 万 → 组内成员显示「用户组」且额度为 50 万；给某人设特例 → 显示「个人特例」；给部门设联网搜索每日 3 次后，门户里该部门第 4 次搜索被拒（与 B10 联动）；两个标签同时改默认上限，后保存的出现冲突提示。

## 验收记录

2026-10-20 验收：通过（Impl：grok 4.7；验收：claude opus 5.5）。

- 自动化：iam-core vitest 55/55、admin-console vitest 240/240；两包 `tsc --noEmit` 均 0 错误。
- 批量用量：`GET /api/admin/users/quota-overview` 返回的本月已用（38276）与卡片「3.8 万」一致；卡片 / 列表切换正常。
- 全员默认：对话框内设 100 万 Token/月并保存，`defaults.limit=1000000` 落库，6 张卡片来源均显示「每人默认」，环为「已用 / 100 万」。
- 三层来源：个人特例 50 万（alice2）→ 卡片「个人特例 / 50 万」；用户组「测试」每人 20 万 → 两名成员「用户组 / 20 万」，比全员默认更严时优先生效。
- 部门共享上限：组织结构 → 部门「模型配置」抽屉内设联网搜索每日 3 次，落库仅 `searchCallsPerDay: 3`；开关自动预填的「每月 0」被后端规范化为不限，不会产生零额度。
- 冲突：预算与次数接口带过期 `expectedUpdatedAt` 均返回 409，提示为中文。
- 测试数据已清理：defaults.limit=0，users/groups/departments 与 featureUsage 各层均为空。

遗留（记入主计划 §8，非阻塞）：
- 次数上限开关打开时「每月」框预填 0，易被误读为「每月 0 次」，宜改为留空 + 占位提示。
- 部门共享上限挂在「模型配置」图标抽屉内，入口可发现性差。
- 全员默认对话框复用「关闭后恢复继承」文案，对最底层的全员默认不准确。
- 暗色主题下 Switch 打开态对比度过低，视觉上像关闭（共享 UI 组件）。
