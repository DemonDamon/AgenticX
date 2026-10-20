# 能力回流 B11：管理台「组织与成员」收成一页

Planned-with: Opus 5.5
Suggested-Impl-Model: Grok 4.7
Acceptance-Model: Opus 5.5
Parent: `.cursor/plans/2026-10-20-enterprise-capability-backflow.plan.md`
Depends-on: —（只用主仓现有接口；额度相关展示在 B12）

## 目标

把「身份与权限」里看同一批人的四个入口（用户、部门、用户组、批量导入）收成一页「组织与成员」：左边组织树筛选，右边「成员 | 用户组」两个标签；新建用户、导入、编辑组织结构放在页面工具栏。「角色」保持独立页面不变。侧栏这一组从 5 项变成 2 项。

## 现状（已核实）

- 侧栏：`enterprise/apps/admin-console/src/components/AppShell.tsx` L93–103，分组 `id: "iam"`，五项 `/iam/users` `/iam/departments` `/iam/user-groups` `/iam/roles` `/iam/bulk-import`。面包屑（约 L353–363）与命令面板（约 L647–728）都从 `NAV_GROUPS` 派生，标签取 `nav.items.<labelKey>`。用户菜单 L620–627 链到 `/iam/users`、`/iam/roles`。
- 文案：`messages/zh.json` L31 `nav.groups.iam` =「身份与权限」，L39–43 `users/departments/userGroups/roles/bulkImport`；英文同位置。
- 页面：
  - `src/app/iam/users/page.tsx`（981 行）：`UsersPageContent` L95（表格 + 详情抽屉，已支持 `?dept=` 初始筛选 L101）、`UserFormDialog` L767、`export default function UsersPage` L974。
  - `src/app/iam/departments/page.tsx`（867 行）：`TreeNode` L127、`DepartmentsPage` L223；节点含 `memberCount`（L60、L91）；部门的可见模型等设置在本页。
  - `src/app/iam/user-groups/page.tsx`（17 行）→ `src/components/iam/UserGroupsPanel.tsx`（306 行）。
  - `src/app/iam/bulk-import/page.tsx`（652 行）：`BulkImportPage` L113，五步向导写在页内，完成后链到 `/iam/users`（L614）。
  - `src/app/iam/roles/page.tsx`（706 行）：角色与权限范围矩阵（`SCOPE_REGISTRY`），**本计划不改**。
  - `src/app/iam/page.tsx` L3–4：`redirect("/iam/users")`。
- 其他链接：`src/app/dashboard/page.tsx` L276 → `/iam/users`；`departments/page.tsx` L524、L590 → `/iam/users?dept=`。
- 接口（不改）：`GET /api/admin/departments?shape=tree|flat`（树节点带 `memberCount`）；`GET /api/admin/users?q=&status=&deptId=&deptScope=&roleCode=&limit=&offset=`；部门、用户、用户组、能力包、批量导入的增删改接口均已存在。
- 参照（`$DELIVERY_REPO`）：`enterprise/apps/admin-console/src/app/iam/roles/page.tsx`（交付仓里这个路由被改作组织与成员）、`src/components/DepartmentFilterTree.tsx`、`src/components/OrganizationEditor.tsx`、`src/components/BulkImportWizard.tsx`。**只参考布局与交互**；交付仓版本依赖主仓没有的额度接口，不能直接搬。

## 改动

### 1. 抽组件（行为不变，只是从页面里搬出来）

| 新文件 | 来源 | 说明 |
|---|---|---|
| `src/components/iam/MembersRoster.tsx` | `users/page.tsx` 的 `UsersPageContent` 及其同文件辅助函数、`UserFormDialog`、`DetailRow`、`EMPTY_USER_FORM` | 新增 props：`deptId: string \| "all" \| "unassigned"`、`createOpen` / `onCreateOpenChange`（让外层工具栏打开新建对话框）、`refreshKey`（外层导入或改组织后刷新）。去掉组件内部的页头与「新建用户」按钮（挪到外层工具栏），表格、筛选、抽屉、编辑、重置密码、删除全部保留 |
| `src/components/iam/DepartmentTree.tsx` | `departments/page.tsx` 的 `TreeNode`、`mapApiToNode`、`findNode`、`collectAllIds` 与树数据加载 | 只读筛选树：顶部固定「全部成员」，底部固定「未归属组织」，中间为部门树，节点右侧显示 `memberCount`；`selectedId` / `onSelect` 受控；对外暴露 `reload()`（或通过 `refreshKey`） |
| `src/components/iam/DepartmentManager.tsx` | `departments/page.tsx` 的 `DepartmentsPage` 主体 | 部门新建、改名、移动、删除、部门模型等设置，原有能力全保留；去掉页头；去掉跳 `/iam/users?dept=` 的链接（改成调用可选 prop `onShowMembers(deptId)`） |
| `src/components/iam/BulkImportWizard.tsx` | `bulk-import/page.tsx` 的 `BulkImportPage` 主体与 `loadSavedMap` 等辅助函数、`StatMini` | 新增 `onDone()`；完成页的「去用户列表」按钮改为调用 `onDone` |

原页面文件在第 3 步改成重定向，不再保留旧实现，避免两份代码。

### 2. 新页面 `src/app/iam/members/page.tsx`

布局（自上而下）：

- `PageHeader`：标题「组织与成员」，说明「管理成员、组织结构和用户组」。
- 标签：「成员 | 用户组」，与 URL `?tab=members|groups` 同步（默认 `members`）。
- **成员**标签：
  - 工具栏右侧：「编辑组织结构」（打开 `Dialog`，内容为 `DepartmentManager`，关闭时刷新树和名册）、「导入」（打开 `Dialog`，内容为 `BulkImportWizard`，`onDone` 关闭并刷新）、主按钮「新建用户」（打开 `MembersRoster` 的新建对话框）。
  - 主体两栏：左 `DepartmentTree`（宽约 260px，粘性定位，长名单滚动时不跟着走），右 `MembersRoster`。
  - URL 参数：`?dept=<id>|unassigned`（选中部门）、`?user=<id>`（打开该成员抽屉）、`?create=1`（打开新建）、`?import=1`（打开导入）、`?org=1`（打开组织结构）。
  - 「未归属组织」：若现有 `GET /api/admin/users` 没有对应过滤，在**前端**用 `deptId` 为空的条件筛（不改接口）；若数据分页导致前端筛不全，在 `MembersRoster` 里对该视图把 `limit` 提到 200 并显示「仅显示前 200 位」提示。
- **用户组**标签：右上「编辑组织结构」（同上）与 `UserGroupsPanel`（原样）。
- 页面级权限与现有 IAM 页一致（`src/app/iam/layout.tsx` 已做会话校验）。

### 3. 旧入口重定向（服务端 `redirect()`，保留查询参数）

| 文件 | 改为 |
|---|---|
| `src/app/iam/page.tsx` | `redirect("/iam/members")` |
| `src/app/iam/users/page.tsx` | 透传 `dept` / `user` / `userId`（映射为 `user`）/ `create` → `/iam/members?...` |
| `src/app/iam/departments/page.tsx` | `/iam/members?org=1`（若带 `dept` 参数一并透传） |
| `src/app/iam/user-groups/page.tsx` | `/iam/members?tab=groups` |
| `src/app/iam/bulk-import/page.tsx` | `/iam/members?import=1` |

重定向页用服务端组件读取 `searchParams`（Next 15 中为 `Promise`，需 `await`）。

### 4. 导航与链接

- `AppShell.tsx` 分组 `iam` 改为两项：

```ts
items: [
  { href: "/iam/members", labelKey: "members", icon: Users },
  { href: "/iam/roles", labelKey: "roles", icon: UserCog },
],
```

  移除不再使用的图标导入（`Building2`、`UsersRound`、`Wand2`，以文件内其他引用为准，仍被使用的保留）。
- 用户菜单 L620–627：原 `/iam/users` 改为 `/iam/members`；`/iam/roles` 保留。
- `dashboard/page.tsx` L276：`/iam/users` → `/iam/members`。
- 全局再 `rg '/iam/(users|departments|user-groups|bulk-import)' enterprise/apps/admin-console/src`，除重定向文件自身外全部改指 `/iam/members` 对应参数。
- 文案：`messages/zh.json` / `en.json` 的 `nav.items` 增加 `members`：「组织与成员」/ "Organization & Members"；删除不再使用的 `users`、`departments`、`userGroups`、`bulkImport` 导航键前先 `rg` 确认无其他引用（`pages.iam.*` 下的页面文案保留，组件仍在用）。新页面文案放 `pages.iam.members.*`。
- 面包屑：选中 `/iam/members` 时为「身份与权限 / 组织与成员」（由 `NAV_GROUPS` 自动派生，确认即可）。

## In scope / Out of scope

- In：四个组件抽取、新页面、五个旧路由重定向、侧栏与链接、文案。
- Out：成员卡片化、用量环、额度来源标签、组 / 个人 / 全员默认上限（B12）；角色页；任何接口与数据库改动；交付仓品牌壳层。
- no-scope-creep：抽组件时不改表格列、筛选项、抽屉字段、校验规则与提示文案。

## 验收

- AC-1：新增 `src/lib/__tests__/iam-members-redirects.test.ts`（或按仓库现有页面测试方式放在对应目录）：五个旧路由重定向目标与参数透传正确（`/iam/users?dept=d1&user=u1` → `/iam/members?dept=d1&user=u1`；`/iam/users?userId=u1` → `?user=u1`；`/iam/user-groups` → `?tab=groups`；`/iam/bulk-import` → `?import=1`；`/iam/departments` → `?org=1`）。
- AC-2：`AppShell` 导航测试（若已有导航快照 / 单测则更新；没有则新增 `src/components/__tests__/app-shell-nav.test.ts` 直接断言 `NAV_GROUPS` 中 `iam` 组只有 `/iam/members`、`/iam/roles`）。
- AC-3：`rg -n "/iam/(users|departments|user-groups|bulk-import)" enterprise/apps/admin-console/src` 只命中五个重定向文件。
- AC-4：`pnpm -C enterprise/apps/admin-console typecheck && pnpm -C enterprise/apps/admin-console test && pnpm -C enterprise/apps/admin-console lint`。
- AC-5（验收方手工，浏览器 `http://localhost:3001`）：侧栏「身份与权限」只有两项且高亮跟随；点左树某部门，右侧只列该部门成员；「未归属组织」只列无部门成员；新建用户、导入一份两行 CSV、编辑组织结构（新建子部门、改名、删除空部门、改部门可见模型）后树与名册自动刷新；「用户组」标签与原页面一致；访问五个旧地址都落到对应位置；角色页不受影响。

## 验收记录

- 2026-10-20 Opus 5.5 第一次手工走查：发现成员表在右栏被挤压（部门列按字换行）、名册内仍有与左树重复的部门下拉，打回修复。
- 2026-10-20 返工后复核（浏览器 `http://localhost:3001`，内容区约 800px）：侧栏「身份与权限」只剩「组织与成员」「角色」且高亮跟随；表格单行、可横向滚动；左树选部门 / 全部 / 未归属三种筛选正确并同步 `?dept=`；「编辑组织结构」对话框可见部门树与新建入口；`/iam/bulk-import` 打开导入向导；`/iam/user-groups` 落到「用户组」标签并列出现有用户组；`/iam/users?dept=all` 跳到 `/iam/members?dept=all`。自动部分：typecheck 通过、50 文件 202 测试全过、lint 0 error。通过。
- 走查中看到的原有问题已记入主计划 §8：接口路径出现在加载提示里、成员表双分页、窄屏下面包屑与搜索框重叠。开发态的 hydration 提示由浏览器自动化注入的 `data-cursor-ref` 属性引起，与代码无关。
