---
name: enterprise portal and admin visual overhaul
overview: 把 AgenticX-Website /agents 与 /auth 的 Machi 风格完整克隆到 enterprise/apps/web-portal（改接自研 JWT 与网关 SSE），并把 admin-console 升级为带 dashboard 的 shadcn-admin 视觉，让前台 + 后台 + AI 网关的联动有完整可感知的视觉效果。
todos:
  - id: p0-ui-foundation
    content: 扩展 @agenticx/ui：新增 shadcn 原语、Machi 主题 tokens、MachiAvatar、LocaleProvider、useUiTheme
    status: completed
  - id: p1-web-auth-page
    content: 把 AgenticX-Website /auth 双栏登录页搬进 enterprise/apps/web-portal，改接 /api/auth/login 与 /api/admin/users
    status: completed
  - id: p1-web-workspace-shell
    content: 用 WorkspaceShell 替换现有 workspace 页面，实现侧栏折叠/New chat/Deep research/历史会话/用户下拉菜单
    status: completed
  - id: p1-web-chat-view
    content: 聊天主区视觉对齐 /agents ChatWorkspace，沿用 @agenticx/feature-chat store 与 HttpChatClient，合规错误渲染为卡片
    status: completed
  - id: p1-web-settings-panel
    content: 克隆 SettingsPanel 六个 Tab（General/ModelProvider/DefaultModels/WebSearch/DocumentParser/ChatSettings）到前台
    status: completed
  - id: p2-admin-appshell
    content: 为 admin-console 建 AppShell（顶栏 + 可折叠侧栏 + 网关健康 chip + 主题/语言切换）
    status: completed
  - id: p2-admin-dashboard
    content: 新增 admin-console dashboard 首页：KPI 卡 + 网关实时曲线 + 策略命中分布 + 审计流 + 四维小图
    status: completed
  - id: p2-admin-iam-audit-metering-reskin
    content: 重塑现有 IAM/审计/四维查询页为 shadcn-admin 风格（表格/抽屉/向导/recharts）
    status: completed
  - id: p3-interaction-visuals
    content: 前台显式呈现路由 badge 与合规拦截卡；后台 dashboard 与网关/审计/计量联动实时刷新
    status: completed
  - id: p3-e2e-tour-script
    content: 新增 enterprise/scripts/e2e-visual-tour.ts playwright 脚本，产出新截图替换 w4-* 归档
    status: completed
  - id: p4-verify-build
    content: typecheck/build 全量通过；更新 mvp-acceptance-checklist 指向新产物
    status: completed
isProject: false
---

# Enterprise 前台 + 后台 视觉完整化实施计划

## 目标
- 前台：克隆 `[AgenticX-Website/src/app/agents/page.tsx](AgenticX-Website/src/app/agents/page.tsx)` + `[AgenticX-Website/src/app/auth/page.tsx](AgenticX-Website/src/app/auth/page.tsx)` 的 Machi 外观到 `[enterprise/apps/web-portal](enterprise/apps/web-portal)`，认证改走 `@agenticx/auth`，对话改走 `/api/chat/completions → gateway` SSE。
- 后台：给 `[enterprise/apps/admin-console](enterprise/apps/admin-console)` 套 shadcn-admin 外壳（顶栏 + 可折叠侧栏），新增 `dashboard` 首页（KPI + 网关实时曲线 + 审计流 + 四维小图），现有 IAM / 审计 / 四维页全部按新主题重塑。
- 在前台 chat 与后台 dashboard 上显式呈现前→后→网关联动：网关健康 chip、合规拦截提示卡、审计流实时刷新。

## 关键架构决策
- 保留 enterprise 自研认证与网关，不引入 Supabase；所有 `supabase-js` 引用统一换成 `fetch('/api/auth/...')` 与 `cookies()` 会话。
- 复用已有 `@agenticx/feature-chat` store，把 `[AgenticX-Website/src/components/agents/ChatWorkspace.tsx](AgenticX-Website/src/components/agents/ChatWorkspace.tsx)` 改写为薄视图层（状态来自 `@agenticx/feature-chat`）。
- 把通用装饰元素（MachiAvatar、grid 背景、i18n/主题 hook）统一沉淀到 `[enterprise/packages/ui](enterprise/packages/ui)`，让 customers 侧之后也能复用。

## 架构示意

```mermaid
flowchart LR
  subgraph WebPortal[web-portal 新增/重写]
    authPage[auth page]
    workspacePage[workspace page]
    sideBar[sidebar + user menu]
    chatWs[ChatWorkspace view]
    settingsPanel[SettingsPanel]
  end

  subgraph AdminConsole[admin-console 升级]
    appShell[AppShell topbar+sidebar]
    dashboard[dashboard home]
    iamPages[IAM pages]
    auditPage[audit page]
    meteringPage[metering page]
  end

  subgraph UI[@agenticx/ui 扩展]
    machiTheme[machi theme tokens]
    extraShadcn[tabs label dialog badge table alert sheet skeleton]
    branding[MachiAvatar + i18n + useUiTheme]
  end

  subgraph Backend[enterprise 自研]
    authApi["/api/auth/login /session /logout"]
    chatApi["/api/chat/completions"]
    auditApi["/api/audit/query"]
    meteringApi["/api/metering/query"]
    gateway[Go Gateway SSE]
  end

  WebPortal --> UI
  AdminConsole --> UI
  authPage --> authApi
  chatWs --> chatApi --> gateway
  dashboard --> meteringApi
  dashboard --> auditApi
  dashboard -. healthz poll .-> gateway
```

## 阶段拆解

### Phase 0 · 设计系统扩展（`@agenticx/ui`）
- 新增 shadcn 原语（仅补缺）：`tabs` / `label` / `dialog` / `badge` / `table` / `alert` / `sheet` / `skeleton`，沿用当前的 radix + cva 方案。
- 新增 Machi 主题 tokens：
  - 在 `[enterprise/packages/ui/src/themes](enterprise/packages/ui/src/themes)` 加 `machi.css`（深色 `#0a0a0a`/`#141414`/`#1a1a1a` 三层灰 + 近纯白前景；浅色白底 + `#fafafa` 侧栏）。
  - 提供 `GridBackdrop` 辅助组件（对应 `/auth` 里的点阵网格 + 椭圆 mask）。
- 从 AgenticX-Website 搬通用件到 `@agenticx/ui/branding`：
  - `MachiAvatar`（拷贝 `public/machi-avatar.*` 资源到 `[enterprise/apps/web-portal/public](enterprise/apps/web-portal/public)` 与 `[enterprise/apps/admin-console/public](enterprise/apps/admin-console/public)`）。
  - `LocaleProvider` + `useUiTheme` hook（剥离 Supabase 耦合，不依赖任何后端）。
- 新增依赖：`sonner`、`lucide-react`、`recharts`（仅 admin-console 用）、`@radix-ui/react-tabs`、`@radix-ui/react-label`、`@radix-ui/react-dialog`。

### Phase 1 · 前台完整克隆（`enterprise/apps/web-portal`）
- 目录：
  - 新：`src/app/(marketing)/page.tsx` 替换当前 `[enterprise/apps/web-portal/src/app/page.tsx](enterprise/apps/web-portal/src/app/page.tsx)`，作为入口跳转页（根据 session 去 /workspace 或 /auth，与 `/agents` 的检测逻辑一致但改用 `/api/auth/session`）。
  - 改：`src/app/auth/page.tsx` → 1:1 搬迁 `[AgenticX-Website/src/app/auth/page.tsx](AgenticX-Website/src/app/auth/page.tsx)` 双栏结构，把 Supabase 的 `signInWithPassword` / `signUp` 换成：
    - 登录 → `POST /api/auth/login`
    - 注册 → `POST /api/admin/users`（当前已有；先用 admin token 开号的逻辑保持；注册 Tab 复用邮箱 + 用户名 + 密码 + 确认密码字段）
    - `onWechatMock` 保留「即将上线」提示
    - 去掉 `desktop` / `device_id` 桌面绑定分支（企业端不需要）
  - 改：`src/app/workspace/page.tsx` → 替换当前 `[enterprise/apps/web-portal/src/app/workspace/page.tsx](enterprise/apps/web-portal/src/app/workspace/page.tsx)` 逻辑：
    - Server 侧用 `getSessionFromCookies()` 守卫；未登录 redirect `/auth`
    - 渲染 `<WorkspaceShell>` 客户端组件（下述）
  - 新：`src/components/WorkspaceShell.tsx` → 克隆 `AgentsHomePageInner`：
    - 左侧折叠栏（含品牌块、New chat、Deep research toggle、History sessions、底部用户菜单：Settings / Theme / Language / Feedback / About / Sign out）
    - 主区 `chat` ↔ `settings` 切换
    - `Sign out` → `POST /api/auth/logout` 后 `router.replace('/auth')`
    - 历史会话保持客户端状态即可（与 /agents 同步，本期不做服务端持久化）
- 聊天视图：
  - 改：`src/components/WorkspaceClient.tsx` 删除或内联到 Shell，主区聊天区用 `@agenticx/feature-chat` 的 `ChatWorkspace` / `MessageList` / `InputArea` / `ModelSelector` 组件；视觉按 `[AgenticX-Website/src/components/agents/ChatWorkspace.tsx](AgenticX-Website/src/components/agents/ChatWorkspace.tsx)` 对齐（中央 Machi 水印 + 底部胶囊输入框）。
  - 维持 `HttpChatClient` 指向 `/api/chat/completions`，SSE 错误码 `9xxxx` 按 `@agenticx/core-api/errors` 的 `toComplianceMessage` 展示为合规红色卡片。
- 设置面板：
  - 克隆 `[AgenticX-Website/src/components/agents/settings/SettingsPanel.tsx](AgenticX-Website/src/components/agents/settings/SettingsPanel.tsx)` 与 6 个 Tab（General / ModelProvider / DefaultModels / WebSearch / DocumentParser / ChatSettings），视觉 1:1。
  - 数据来源先用本地 `localStorage` / 空态；后续再接入 `@agenticx/feature-settings`。此 PR 只保证 UI 交互可用。
- 删除当前前台里「W2 占位登录页」「Workspace 占位」等字样。

### Phase 2 · 后台 shadcn-admin 升级（`enterprise/apps/admin-console`）
- 新：`src/components/AppShell.tsx`
  - 顶栏：logo + 环境标识 badge + 网关健康 chip（定时 `GET /healthz` → 绿/黄/红）+ 主题切换 + 用户菜单
  - 左侧可折叠 sidebar：`Dashboard` / `IAM（用户·部门·角色·批量导入）` / `审计日志` / `四维消耗` / `策略规则` / `模型服务`
  - 使用与前台同一套 Machi tokens，保持观感一致
- 新：`src/app/dashboard/page.tsx`
  - KPI 卡（4 张）：今日调用量、今日消耗（USD）、命中合规事件数、活跃用户
  - 网关实时曲线（`recharts` line）：按 `usage_records` 按 1 分钟 bucket 聚合，轮询 5s
  - 策略命中分布（area）：按 `audit.policies_hit` 拉取最近 1h
  - 最近审计事件表（latest 20）：实时刷新，含策略命中图标 badge + 详情抽屉复用 `[enterprise/apps/admin-console/src/app/audit/page.tsx](enterprise/apps/admin-console/src/app/audit/page.tsx)` 现有 drawer 组件
  - 四维小图：按部门 × 模型 stacked bar
- 改：`src/app/login/page.tsx` → 复制前台 `/auth` 视觉并只保留「管理员登录」Tab，接 `POST /api/auth/login`（若需要管理员专用接口，可复用同一路由）；去除 `W2 占位登录页：W2-T10 将替换为真实 auth 服务。` 占位文案。
- 改：`src/app/iam/layout.tsx` → 接入 `AppShell`，删除独立 IAM 左栏，使用全站统一布局。
- 重塑页面（保留 API 不变，仅换 UI）：
  - `src/app/iam/users/page.tsx` → shadcn `Table` + 工具条 + 筛选 + 详情抽屉
  - `src/app/iam/departments/page.tsx` → 左树右详情二栏
  - `src/app/iam/roles/page.tsx` → 角色列表 + 权限矩阵
  - `src/app/iam/bulk-import/page.tsx` → 3 步向导（Upload / Precheck / Submit+Progress），使用 `Tabs` / `Stepper` 视觉
  - `src/app/audit/page.tsx` → 顶部筛选工具条 + 数据表 + 右侧详情抽屉 + `Export CSV` 按钮右上
  - `src/app/metering/page.tsx` → 顶部四维筛选 + 上方 `recharts` 柱/折线 + 下方透视表 + `Export Excel`

### Phase 3 · 前后台 + 网关联动的可视化证据
- 前台聊天：
  - 底部输入区新增「路由：local | private-cloud | third-party」小 badge，读自每次请求 header / 响应元数据。
  - 收到 `9xxxx` 合规错误时，渲染黄/红警告卡并列出命中规则；对普通错误渲染灰色系 toast。
- 后台仪表盘：
  - KPI 卡右上角小点与网关 `/healthz` 状态联动。
  - 审计流中命中策略的事件顶部加红点，点击进 `/audit?event_id=...` 预筛选详情。
- 新：`enterprise/scripts/e2e-visual-tour.ts`（playwright）
  - 跑：登录 → 对话（普通消息 + 金融敏感拦截消息） → 查看 admin dashboard 的 KPI 变化与审计流 → 打开 metering 页导出
  - 产出新截图替换 `[enterprise/w4-e2e-01-portal-auth.png](enterprise/w4-e2e-01-portal-auth.png)` 等，放入 `enterprise/docs/visuals/` 用于验收。

### Phase 4 · 校验与验收
- `pnpm --filter @agenticx/ui build && pnpm --filter @agenticx/ui typecheck`
- `pnpm --filter @agenticx/app-web-portal typecheck && build`
- `pnpm --filter @agenticx/app-admin-console typecheck && build`
- 本地拉起：`pnpm dev`（web-portal :3000 / admin-console :3001 / hechuang 3100·3101 / gateway :8088）
- 运行 `enterprise/scripts/e2e-visual-tour.ts`，截图归档
- 更新 `[enterprise/docs/mvp-acceptance-checklist-v20260422.md](enterprise/docs/mvp-acceptance-checklist-v20260422.md)` 的「本期验证产物」段落指向新截图集

## 风险与注意事项
- AgenticX-Website 原代码耦合 `sonner` / `lucide-react` / `next-themes` / `@supabase/supabase-js`：前两个要在 workspace 补齐依赖；Supabase 必须全部替换，避免把 Supabase 引入 enterprise 产物。
- Tailwind v4：web-portal 已有 `@tailwindcss/postcss`；admin-console 需要补同一套 `postcss.config.mjs` + `globals.css`（已存在，需扩展 machi theme 变量）。
- Next 版本：AgenticX-Website 用 `next@16`，enterprise 现在是 `next@^15.1.0`；本 PR 保持 `next@15`，搬迁时只抽取 JSX/tailwind，不带入 next 16 特定 API。
- 视觉迁移要避免把 AgenticX-Website 的营销文案（Machi、"Think clearly, finish locally"）硬塞进客户白标场景：文案与 logo 一律从 `@agenticx/config` 的 `brand.yaml` 读，默认 fallback 才用 Machi 品牌。
- `customers/hechuang/apps/admin/next.config.ts` 需要同步扩展 `transpilePackages`，新增 `@agenticx/feature-settings` 等包引用时不要遗漏。

## 预估节奏
- Phase 0 设计系统：0.5 天
- Phase 1 前台克隆：2~3 天
- Phase 2 后台升级：2 天
- Phase 3 联动可视化 & 截图：0.5 天
- Phase 4 校验：0.5 天
- 合计约 1 个工作周，出一次 PR 或拆成 3 个 PR（ui-foundation / web-portal / admin-console）。