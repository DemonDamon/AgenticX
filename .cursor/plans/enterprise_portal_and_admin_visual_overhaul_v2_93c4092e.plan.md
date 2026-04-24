---
name: enterprise portal and admin visual overhaul v2
overview: v1 只做了"能看"的 shadcn 裸装，本轮是"好看"的视觉重构。以 vue-vben-admin v5 的视觉配方为参考（不移植代码，只抄设计 token、密度、图表和表格调教），把 enterprise/apps/{admin-console, web-portal} 与 @agenticx/ui 升级到可以当白标企业后台用的水平；同时修复当前主题切换根本不工作的隐患，完成暗色+亮色双主题，IAM 用户模块顺手接通真实 API。
todos:
  - id: v2-t0-theme-bugfix
    content: 修复 useUiTheme / machi.css / globals.css 三端 selector 不对齐导致亮色主题从未生效的 bug
    status: completed
  - id: v2-t1-tokens
    content: 重写 @agenticx/ui/themes - 引入 oklch 语义色阶（primary indigo/success/warning/danger/info 各 50-950）、Card 三层 elevation、chart 配色面板、Tailwind v4 @theme 绑定
    status: completed
  - id: v2-t2-primitives
    content: 新增 UI 原语：DataTable、StatCard、PageHeader、EmptyState、Breadcrumb、Command(cmdk)、Sonner Toast 适配
    status: completed
  - id: v2-t3-charts
    content: @agenticx/ui/charts - 封装 recharts 主题一致化的 <LineCard/> <AreaCard/> <BarCard/> <DonutCard/> <SparkLine/>
    status: completed
  - id: v2-t4-admin-shell
    content: admin-console AppShell v2 - 侧栏分组+二级菜单+活跃指示条+折叠过渡、顶栏加面包屑+Cmd+K 全局搜索+通知+主题切换、整站 p-4
    status: completed
  - id: v2-t5-admin-dashboard
    content: admin-console Dashboard 重做 - WelcomeBanner + 4 张 StatCard（带 icon/trend/spark）+ 主图区（调用趋势+时间范围）+ 副图区（策略命中 donut + 部门×模型 bar）+ 审计时间线 + Top 用户榜
    status: completed
  - id: v2-t6-admin-iam-users-api
    content: 新增 admin-console 后端 - GET/POST /api/admin/users 与 PATCH/DELETE /api/admin/users/[id]，复用 provisionUserFromAdmin 和 drizzle users schema；前端 IAM users 页接入
    status: completed
  - id: v2-t7-admin-iam-dept-role
    content: admin-console 部门（左树右详情）+ 角色（权限矩阵 PermissionMatrix）+ 批量导入（3 步 Stepper）按 vben 配方重塑
    status: completed
  - id: v2-t8-admin-audit-metering
    content: 审计页加时间轴 + 高级筛选 Popover + 详情抽屉 JSON 高亮；计量页顶部 chip 筛选 + 主视图切换 + 导出按钮组
    status: completed
  - id: v2-t9-portal-auth
    content: web-portal /auth 升级 - 左侧品牌故事区加动态渐变+特性列表；右侧登录卡加 SSO 占位+第三方按钮组+切换动画
    status: completed
  - id: v2-t10-portal-workspace
    content: web-portal /workspace 侧栏重构 - 历史会话按日期分组、hover 出 rename/delete、用户卡带订阅 badge
    status: completed
  - id: v2-t11-portal-chat
    content: 聊天主区 - 欢迎态 Machi 品牌卡 + 3 个 suggestion chip；输入框胶囊 + 工具栏 toggle（附件/web search/deep research）；assistant 消息加 copy/regen/feedback；合规拦截卡加强
    status: completed
  - id: v2-t12-settings-panel
    content: SettingsPanel 六 Tab 改左侧纵向 nav + 每 setting 项 icon+描述+分区、ModelProvider 加 logo 网格、开关顶部高亮条
    status: completed
  - id: v2-t13-e2e-screenshots
    content: 更新 e2e-visual-tour.ts 截所有新页面（暗+亮双主题都要截），产出 enterprise/docs/visuals/v2/*.png
    status: completed
  - id: v2-t14-verify-build
    content: pnpm 全量 build+typecheck 绿、bootstrap+start-dev 跑通、并排截图对比旧 vs 新
    status: completed
isProject: false
---

# Enterprise 视觉重构 v2

## 与 v1 的关系
v1（`enterprise_portal_and_admin_visual_overhaul_93c4092e.plan.md`）交付了"能看"的 shadcn-admin 裸装，所有 todos 已 completed。v2 是在 v1 基础上的**视觉工程化升级**，不推翻任何架构决策，只替换：设计 tokens、密度、高阶组件、图表风格、交互细节。

## 用户决策（已确认）
1. **合入方式**：一条 feature 分支上分三段提交（ui-foundation / admin-revamp / portal-revamp），每段可独立跑通并截图验收；最终一次大 PR 合入
2. **品牌色**：引入 vben-like **indigo/violet primary**，替代现在的 sky blue；中性色保持 Machi 基底
3. **主题范围**：**暗色 + 亮色双主题都做**（前置：修现有 useUiTheme 主题切换 bug）
4. **数据源**：IAM 用户模块顺手接真实 API（新建 `/api/admin/users` GET/POST + `[id]` PATCH/DELETE），其他页面保留 mock

## 参考源与"抄法"
- **主要参考**：`vue-vben-admin` 5.x + [www.vben.pro](https://www.vben.pro) demo 站截图（只抄视觉配方：颜色语义、密度、布局比例、表格工具条、面包屑、Cmd+K、权限矩阵、图表调教）
- **严禁**：拉取 `.vue` SFC、Pinia store、`@vben/*` 包代码；enterprise 是 React/Next.js，**不能直接移植代码**
- **原有 Machi 品牌元素**（MachiAvatar、GridBackdrop）保留作为"白标 fallback"，客户白标场景由 `@agenticx/config/brand.yaml` 读取覆盖

## 关键架构决策

### 主题系统统一（v2-t0 + v2-t1）
现状有三套互不对齐的 token 系统：
- `machi.css` 用 `:root` + `:root.machi-light`
- `default.css` 用 `:root` + `.theme-dark`
- `admin-console/globals.css` 硬编码 dark 并写死 `color-scheme: dark`
- `useUiTheme` 实际切换的却是 `<html class="dark">`

v2 统一为 **Tailwind v4 标准** `<html class="dark">` + 默认亮色，所有 token 通过 CSS vars 配合 `@theme` 指令注入。

### Token 分层
```
@agenticx/ui/themes/
  base.css          ← 所有 app 必须引入（tailwind v4 @theme + 语义 token）
    - Brand: --primary / --primary-foreground（default = indigo 500/50）
    - Neutral: --background / --foreground / --muted / --border（Machi 基底）
    - Semantic: --success / --warning / --danger / --info
    - Surface: --surface-subtle / --surface / --surface-elevated（三层）
    - Chart: --chart-1 ~ --chart-7（柔和调色板）
  machi-overrides.css  ← Machi 品牌覆盖（当前默认）
  runtime-brand.ts     ← 客户白标运行时覆盖
```

### 高阶原语（v2-t2）
`@agenticx/ui` 除了已有 shadcn 原语，新增：
- `DataTable`：列定义驱动的封装，内置工具条（搜索+筛选 chip+列显隐 dropdown+密度切换 segmented+导出+分页）
- `StatCard`：icon + 标签 + 大号数值 + delta 百分比 + 迷你 sparkline
- `PageHeader`：面包屑 + 标题区 + 副标题 + 右侧动作按钮组
- `EmptyState`：icon + 标题 + 描述 + 动作按钮
- `Breadcrumb` + `Command` (cmdk) + `Sonner Toast`

### 图表调教（v2-t3）
所有 recharts 包成卡片高阶组件，强制用：
- `CartesianGrid` 用 `var(--border)` 虚线
- Axis `stroke: var(--muted)`
- Tooltip 深色主题 + 圆角边框
- Line/Area 统一用 `linearGradient fill`，色板从 `--chart-*` 取
- 动画 `animationDuration: 800ms`

### IAM Users 真实 API 接入（v2-t6）
现状：
- web-portal 有 `POST /api/admin/users`（创建用户）
- admin-console 没有任何 `/api/admin/users` 路由
- admin-console IAM 用户页用的是 3 条硬编码 mock

本期新增：
```
enterprise/apps/admin-console/src/app/api/admin/users/
  route.ts           GET  (list with filters: q/dept/status + pagination)
                     POST (create user, 复用 provisionUserFromAdmin)
  [id]/route.ts      PATCH  (update displayName/dept/status)
                     DELETE (soft delete via softDeleteColumns)
```
权限校验：session scope 必须包含 `user:read` (GET) / `user:create` (POST) / `user:update` (PATCH) / `user:delete` (DELETE)。

## 阶段拆解与提交策略

### Commit 1：ui-foundation（v2-t0 + v2-t1 + v2-t2 + v2-t3）
产出可验收：`pnpm --filter @agenticx/ui build` 全绿，Storybook-like demo 页（放在 admin-console `/dev/ui-preview` 临时路由）展示所有新原语的 dark + light 两种状态。

### Commit 2：admin-revamp（v2-t4 + v2-t5 + v2-t6 + v2-t7 + v2-t8）
产出可验收：admin-console 跑起来后所有页面都用上新 tokens 和原语，用户页走真实 API。

### Commit 3：portal-revamp（v2-t9 + v2-t10 + v2-t11 + v2-t12）
产出可验收：web-portal 登录/工作区/设置视觉一体化。

### 最终验收（v2-t13 + v2-t14）
同一条分支上跑 `enterprise/scripts/e2e-visual-tour.ts`，产出 `enterprise/docs/visuals/v2/` 新旧对比截图，再开大 PR。

## 预估节奏
- Commit 1 ui-foundation：1.5 天
- Commit 2 admin-revamp：2.5-3 天（+用户 API 接入 0.5 天）
- Commit 3 portal-revamp：2 天
- 双主题调教：贯穿全程 +0.5-1 天
- 验收/截图/对比：0.5 天
- **合计：7-9 个工作日**

## 风险
- Tailwind v4 `@theme` 语法与现有 `tailwindcss-animate` 等旧插件兼容性：需要用 `@plugin` 显式声明
- 真实 `/api/admin/users` GET 返回的数据结构可能和前端预设不一致，需要定义 `UserListItem` 类型到 `@agenticx/core-api`
- 亮色主题下 `GridBackdrop` 点阵效果可能太跳：需要提供 light variant（更浅的点）
- `customers/hechuang/apps/admin` 继承 admin-console 的 layout/AppShell，需要验证不破坏客户侧

## 不在本期范围
- 国际化文案扩展（保留现有中英）
- 无障碍审计（a11y 验收留到下一轮）
- 后端 Go Gateway 改动
- 桌面端（desktop）视觉
