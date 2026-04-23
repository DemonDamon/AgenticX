---
name: enterprise-mvp-4week-implementation
overview: AgenticX Enterprise MVP 四周实施计划 —— W1 前台 Chat 剥离（自研，不抄 Website）· W2 认证+IAM+基础后台 · W3 AI 网关+策略引擎 · W4 审计+四维查询。W4 末形成可演示原型，覆盖端到端：登录→对话→网关路由→敏感拦截→审计落盘→四维查询。
todos:
  - id: W1-T01
    content: W1·D1 · 前台现状盘点：读取 AgenticX-Website 对话组件（ChatWorkspace/ModelServicePanel/FeedbackDialog/settings/*）并产出 enterprise/features/chat/docs/design.md（仅思路借鉴，禁止拷贝代码）
    status: completed
  - id: W1-T02
    content: W1·D1 · packages/ui 交付 shadcn 子集：button/card/input/textarea/scrollarea/tooltip/select 等导出 + 主题 token + utils（cn）
    status: completed
  - id: W1-T03
    content: W1·D2 · packages/config：实现 loadBrand(yamlPath) / loadFeatures(yamlPath) + Zod schema 校验，支持 NEXT_PUBLIC_BRAND_CONFIG env
    status: completed
  - id: W1-T04
    content: W1·D2 · packages/sdk-ts：定义 ChatClient 接口 + Mock 实现（流式 SSE 模拟，不连真 LLM）；暴露 sendMessage/stream/cancel 3 个方法
    status: completed
  - id: W1-T05
    content: W1·D3 · packages/core-api：写死 ChatMessage/ChatSession/ChatRequest/ChatResponse TypeScript 类型（契约冻结后 W2-W4 不再改）
    status: completed
  - id: W1-T06
    content: W1·D3 · features/chat 骨架：Zustand store（messages/status/activeModel）+ ChatWorkspace 根组件 + props(brand/features/rulePacks/client/slots)
    status: completed
  - id: W1-T07
    content: W1·D4 · features/chat 分子组件：MessageList（含 ReasoningBlock / ToolCallCard 占位）+ InputArea（支持 Enter 发送、Shift+Enter 换行）+ ModelSelector
    status: completed
  - id: W1-T08
    content: W1·D4 · features/chat 样式系统：通过 packages/ui 的 token 呈现 brand primary_color，验证 hechuang 蓝色 vs web-portal 默认主题的视觉差异
    status: completed
  - id: W1-T09
    content: W1·D5 · apps/web-portal 组装：Next.js layout + Providers（theme/brand/auth 占位）+ /workspace 路由挂载 ChatWorkspace；Tailwind v4 配置
    status: completed
  - id: W1-T10
    content: W1·D5 · customers/hechuang/apps/portal 组装 + 白标验证：加载 config/brand.yaml + config/features.yaml，确认与 web-portal 同代码、不同品牌
    status: completed
  - id: W1-T11
    content: W1·D5 · 联调 E2E：pnpm dev 同时跑 :3000（web-portal）和 :3100（hechuang/portal），Mock 对话流式输出跑通，截图存档
    status: completed
  - id: W2-T01
    content: W2·D1 · packages/db-schema：Drizzle 多租户 schema（tenants / organizations / departments / users / roles / user_roles），tenant_id 作为强过滤字段；生成初始 migration
    status: completed
  - id: W2-T02
    content: W2·D1 · packages/db-schema 本地开发环境：docker-compose 启 PG 16；pnpm db:migrate 能跑通；seed 默认 tenant + super-admin
    status: completed
  - id: W2-T03
    content: W2·D2 · packages/auth：账密登录 + bcrypt + 非对称 JWT（RS256）+ refresh token；Session middleware for Next.js Route Handlers
    status: completed
  - id: W2-T04
    content: W2·D2 · packages/auth：SSO 接口占位（OIDC/SAML），Provider 抽象层，和创项目本期只实现账密
    status: completed
  - id: W2-T05
    content: W2·D3 · features/iam 用户管理：CRUD + 启用/禁用 + 密码重置 + 审计事件；RBAC 中间件强制 tenant_id 过滤
    status: completed
  - id: W2-T06
    content: W2·D3 · features/iam 部门树：增删改查 + 成员归属 + 上下级层级；前端 Tree 组件
    status: completed
  - id: W2-T07
    content: W2·D4 · features/iam 角色与权限：定义 scope 语法（resource:action）+ 系统角色（owner/admin/member/auditor）+ 绑定 API
    status: completed
  - id: W2-T08
    content: W2·D4 · features/iam 批量开号：CSV 模板 + 上传 + 预检 + 批量创建事务 + 失败重试 + 批处理进度
    status: completed
  - id: W2-T09
    content: W2·D5 · apps/admin-console：登录页 + 主布局（侧栏/顶栏）+ 挂载 IAM 4 个页面（用户/部门/角色/批量导入）
    status: completed
  - id: W2-T10
    content: W2·D5 · apps/web-portal 登录集成：把 mock auth 替换为真实 packages/auth，用 admin 开号 → portal 登录全链路打通
    status: completed
  - id: W3-T01
    content: W3·D1 · apps/gateway 启动：Go module + chi router（或 stdlib mux）+ 配置加载 + 健康检查；严禁照搬 APIPark 代码结构
    status: completed
  - id: W3-T02
    content: W3·D1 · gateway /v1/chat/completions OpenAI 兼容接口：请求/响应结构 + SSE 流式 + 错误统一（不实现模型调用）
    status: completed
  - id: W3-T03
    content: W3·D2 · gateway Provider 抽象层：OpenAI 兼容 Provider 实现（接入 DeepSeek/Moonshot/OpenAI/等任意兼容端点）
    status: completed
  - id: W3-T04
    content: W3·D2 · gateway 三路路由决策：local（Ollama via edge-agent 占位）/ private-cloud（甲方独享云）/ third-party（第三方）；按请求头 + 模型配置匹配
    status: completed
  - id: W3-T05
    content: W3·D3 · packages/policy-engine 规则加载：解析 plugins/moderation-*/manifest.yaml；支持 extends 继承链；统一 Rule 内部表示
    status: completed
  - id: W3-T06
    content: W3·D3 · packages/policy-engine 关键词引擎：Aho-Corasick 自动机（或 trie）+ action=block/redact/warn + 命中事件输出
    status: completed
  - id: W3-T07
    content: W3·D4 · packages/policy-engine 正则 + PII 基线：手机/邮箱/身份证/银行卡/API Key 等通用 PII
    status: completed
  - id: W3-T08
    content: W3·D4 · gateway 集成 policy-engine：入参预检（prompt 拦截）+ 出参后检（response 脱敏）+ 命中触发客户端提示
    status: completed
  - id: W3-T09
    content: W3·D5 · packages/core-api 错误码规范：4xxxx 业务 / 9xxxx 策略拦截；前端 features/chat 识别拦截错误并显示合规文案
    status: completed
  - id: W3-T10
    content: W3·D5 · E2E 拦截测试：准备 3 条含金融敏感词的测试 prompt，验证 gateway 拦截率 100%、客户端收到合规提示、日志留痕
    status: completed
  - id: W4-T01
    content: W4·D1 · features/audit：AuditEvent schema 定稿（按 features/audit/README 草案），写入 packages/core-api
    status: completed
  - id: W4-T02
    content: W4·D1 · gateway 审计写入：SSE 响应结束后生成 AuditEvent；append-only JSON 文件 + blake2b checksum 链；文件权限 0600
    status: completed
  - id: W4-T03
    content: W4·D2 · features/audit 读取与校验：查询 API（按 tenant_id + RBAC，审计员可跨部门）；每次查询校验链完整性
    status: completed
  - id: W4-T04
    content: W4·D2 · admin-console 审计日志页：列表 + 过滤器（人员/模型/时间/策略命中）+ 详情抽屉（显示脱敏后摘要）+ 导出 CSV
    status: completed
  - id: W4-T05
    content: W4·D3 · packages/db-schema：usage_records 表（tenant_id/dept_id/user_id/provider/model/time_bucket/tokens/cost）+ 日级预聚合物化
    status: completed
  - id: W4-T06
    content: W4·D3 · features/metering 四维查询 API：参数（dept_id[] / user_id[] / provider[] / model[] / start / end / group_by）+ 返回透视数据
    status: completed
  - id: W4-T07
    content: W4·D4 · admin-console 四维查询 UI：部门→员工→厂商/模型→时间段 四级联动；表格 + 柱图 + 折线；导出 Excel
    status: completed
  - id: W4-T08
    content: W4·D4 · gateway 消耗上报：SSE 完成后异步写 usage_records（提取 tenant_id/dept_id/user_id from JWT）
    status: completed
  - id: W4-T09
    content: W4·D5 · E2E 端到端演示：开号 → 登录 → 对话 → 敏感拦截 → 审计落盘 → 审计查询 → 四维查询；录屏 + 截图交付
    status: completed
  - id: W4-T10
    content: W4·D5 · MVP 验收 Checklist：对照技术规范书 V20260422 §1.3/§1.4/§1.5，逐条勾选本期达成项
    status: completed
isProject: false
---

# AgenticX Enterprise MVP 4 周实施计划

> **范围**：`enterprise/` 主干 + `customers/hechuang/` 客户层
> **结果**：W4 末拿到端到端可演示原型
> **原则**：不抄开源代码（ADR-0001）· 数据不出域 · 多租户强隔离 · 测试覆盖 ≥ 70%

---

## 总览

### 产出

| 周 | 主线 | 关键产出 | 可演示场景 |
|---|---|---|---|
| **W1** | 前台 Chat 剥离 | `feature-chat` + `web-portal` + `hechuang/portal` | 两个 portal 同代码不同品牌 |
| **W2** | 认证 + IAM + 后台 | `auth` + `feature-iam` + `admin-console` | 开号 → 登录 → RBAC |
| **W3** | AI 网关 + 策略 | `gateway` + `policy-engine` + `plugins/moderation-*` | 三路路由 + 敏感拦截 |
| **W4** | 审计 + 四维 | `feature-audit` + `feature-metering` | 端到端完整闭环 + 报表 |

### 每日节奏

- 每天开工前：**写下当日目标**（todos）
- 每天收工前：**checkpoint**（commit + demo gif/截图）
- 每周末：**回顾 + W+1 微调**

---

## 跨周共享的契约（W1 冻结后不改）

### 0.1 数据库 ID 策略

- 主键统一用 **ULID**（时序可排序 + 26 字符）
- `tenant_id` 出现在所有业务表
- `created_at/updated_at` UTC timestamp with time zone

### 0.2 API 协议

- 后端 API 路径：`/api/v1/<resource>`
- 前端调用：通过 `packages/sdk-ts` 代理，不直接 fetch
- 错误码：`00000` 成功 / `4xxxx` 业务错误 / `5xxxx` 系统错误 / `9xxxx` 策略拦截
- 所有响应：`{ code, message, data? }` 统一信封

### 0.3 鉴权

- JWT 算法：**RS256**（非对称）
- Access token 有效期 ≤ 1 小时
- Refresh token 存 Redis，滑动过期
- 所有 Route Handler 必须经 `withAuth(scope)` 包裹

### 0.4 日志与审计

- 运行日志：pino（TS）/ slog（Go）结构化
- 审计事件：追加 `AuditEvent`，由 `features/audit` 统一处理
- 禁忌：日志不得出现 JWT 原文、API Key、原始 prompt

### 0.5 租户隔离

- ORM 层强制注入 `WHERE tenant_id = ?`（Drizzle middleware）
- 代码 review 时强制 grep 是否有缺失

---

## W1 · 前台 Chat 剥离（5 天）

### W1 目标

- 产出 `@agenticx/feature-chat`（**自研**，不拷 Website 代码）
- 产出 `apps/web-portal`（开源前台）
- 产出 `customers/hechuang/apps/portal`（客户前台）
- E2E：两个 portal 同代码不同品牌，Mock 消息流式跑通

### W1 · D1 · 现状盘点与 UI 底座

**W1-T01**：**前台现状盘点 + design.md**
- 读取：
  - `AgenticX-Website/src/components/agents/ChatWorkspace.tsx`（341 行）
  - `AgenticX-Website/src/components/agents/ModelServicePanel.tsx`（108 行）
  - `AgenticX-Website/src/components/agents/FeedbackDialog.tsx`（193 行）
  - `AgenticX-Website/src/components/agents/settings/SettingsPanel.tsx`（75 行）
  - `AgenticX-Website/src/components/agents/settings/tabs/*.tsx`（6 个 Tab）
- 输出：`enterprise/features/chat/docs/design.md`
  - 现状职责与耦合点（含 Zustand/Context/SWR 使用）
  - **我们的新架构**：分层（shell / store / molecules / atoms）、Props（brand/features/rulePacks/slots/client）、状态模型、可扩展点
  - **借鉴声明**：哪些思路借鉴了 Website，声明"零代码复制"
- 验收：design.md ≥ 200 行，含架构图 + props 表

**W1-T02**：**packages/ui shadcn 子集**
- 从 `AgenticX-Website/src/components/ui/` 选 MVP 必需的 10 个组件（不复制代码，用 shadcn CLI 重新 init）
- 文件：
  - `packages/ui/src/components/ui/button.tsx`
  - `packages/ui/src/components/ui/card.tsx`
  - `packages/ui/src/components/ui/input.tsx`
  - `packages/ui/src/components/ui/textarea.tsx`
  - `packages/ui/src/components/ui/scroll-area.tsx`
  - `packages/ui/src/components/ui/tooltip.tsx`
  - `packages/ui/src/components/ui/select.tsx`
  - `packages/ui/src/components/ui/separator.tsx`
  - `packages/ui/src/components/ui/avatar.tsx`
  - `packages/ui/src/components/ui/dropdown-menu.tsx`
- `packages/ui/src/lib/cn.ts`（tailwind-merge + clsx）
- `packages/ui/src/themes/default.css`
- 验收：`pnpm --filter @agenticx/ui typecheck` 过

### W1 · D2 · 配置与 SDK

**W1-T03**：**packages/config 品牌/功能开关加载器**
- API:
  ```ts
  loadBrand(path: string): Promise<BrandConfig>
  loadFeatures(path: string): Promise<FeatureFlags>
  useBrand(): BrandConfig   // React hook
  useFeatures(): FeatureFlags
  ```
- Zod schema 校验 YAML
- 容错：字段缺失 fallback 到 `plugins/theme-default`
- 验收：单测覆盖 loadBrand 的 happy path + 3 种错误
- 文件：
  - `packages/config/src/schemas.ts`
  - `packages/config/src/loaders.ts`
  - `packages/config/src/react.tsx`
  - `packages/config/src/__tests__/*.test.ts`

**W1-T04**：**packages/sdk-ts ChatClient（Mock 实现）**
- 接口：
  ```ts
  interface ChatClient {
    sendMessage(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk>;
    listSessions(filter?: SessionFilter): Promise<Session[]>;
    createSession(title?: string): Promise<Session>;
  }
  ```
- `MockChatClient`：吐"你好，这是测试消息..."这样的字符流（50ms/字）
- 预留 `HttpChatClient`（W3 接 gateway 时再写）
- 文件：
  - `packages/sdk-ts/src/types.ts`
  - `packages/sdk-ts/src/chat/client.ts`
  - `packages/sdk-ts/src/chat/mock.ts`

### W1 · D3 · features/chat 核心

**W1-T05**：**packages/core-api 类型契约冻结**
- 定义：
  ```ts
  type ChatMessage = { id; role: 'user'|'assistant'|'system'; content; tokens?; ... }
  type ChatSession = { id; tenant_id; user_id; title; created_at; ... }
  type ChatRequest = { session_id; messages; model?; stream?; ... }
  type ChatChunk = { delta?; reasoning?; tool_call?; done?; error? }
  ```
- **W1 末冻结**，W2/W3/W4 只能添加非破坏性字段
- 文件：`packages/core-api/src/chat.ts`

**W1-T06**：**features/chat 骨架与 store**
- `features/chat/src/store.ts`（Zustand）
  - state：sessions / activeSessionId / messages / status / activeModel
  - actions：sendMessage / cancel / switchModel / deleteMessage
- `features/chat/src/ChatWorkspace.tsx`（shell 组件）
  - props：`{ brand, features, rulePacks, client, slots? }`
  - slots：`header / sidebar / footer`
  - 布局：flex 三栏（左 sessions / 中 chat area / 右 tools 占位）
- **禁忌**：任何代码里不得出现"和创" / "hechuang" / 客户专属字符串

### W1 · D4 · features/chat 分子组件

**W1-T07**：**MessageList / InputArea / ModelSelector**
- `MessageList`：
  - 虚拟滚动（`@tanstack/react-virtual`）
  - 流式消息：增量渲染，不整块重渲
  - 子组件：`UserBubble` / `AssistantBubble` / `ReasoningBlock`（折叠）/ `ToolCallCard`（默认折叠）
- `InputArea`：
  - contenteditable（不用 textarea，对标 Machi）
  - Enter 发送 / Shift+Enter 换行
  - 预留 @file 行内 token slot（W2 再做）
- `ModelSelector`：
  - dropdown 展示可用模型
  - 显示上下文窗口 / 推理能力 badge

**W1-T08**：**主题系统联动验证**
- 让 `brand.primary_color` 真正作用到 Tailwind token
- web-portal 默认紫色 vs hechuang 蓝色，视觉对比截图存档
- 文件：`packages/ui/src/themes/runtime-brand.ts`

### W1 · D5 · Apps 组装 + E2E

**W1-T09**：**apps/web-portal Next.js 骨架**
- App router + Tailwind v4 + Providers
- 路由：
  - `/` 首页（占位）
  - `/workspace` 挂 `<ChatWorkspace client={mockClient} brand={defaultBrand} />`
  - `/auth` 占位
- 端口：3000

**W1-T10**：**customers/hechuang/apps/portal 组装**
- 同样挂 `ChatWorkspace`，但加载 `../../config/brand.yaml`
- 传入客户专属 `features` 开关
- 端口：3100

**W1-T11**：**E2E 验收**
- 双 portal 同时跑：`pnpm --filter @agenticx/app-web-portal dev` + `pnpm --filter @customer-hechuang/portal dev`
- 验证：
  - [ ] 两个 portal 都能发消息，流式输出正常
  - [ ] 两个 portal 品牌色不同（紫 vs 蓝）
  - [ ] 两个 portal 的 chat 代码 100% 共享（改一处双生效）
  - [ ] `grep -r "和创\|hechuang" enterprise/features/chat` 为空（通用产品不含客户信息）
- 产出：demo.mp4 + screenshots

### W1 交付清单

- [ ] `enterprise/features/chat/` 生产就绪
- [ ] `enterprise/packages/{ui,config,sdk-ts,core-api}/` 基础完成
- [ ] `enterprise/apps/web-portal/` 跑起
- [ ] `customers/hechuang/apps/portal/` 跑起
- [ ] design.md + demo 视频
- [ ] 单测（features/chat 核心 store + config loaders）

---

## W2 · 认证 + IAM + 基础后台（5 天）

### W2 目标

- 多租户 DB schema 落地
- 账密登录走通
- IAM：用户 / 部门 / 角色 / 批量开号
- admin-console 骨架 + IAM 页面
- E2E：admin 开号 → portal 登录

### W2 · D1 · DB 基础

**W2-T01**：**Drizzle 多租户 schema**
- 表：
  ```
  tenants (id, name, plan, created_at, ...)
  organizations (id, tenant_id, name)
  departments (id, tenant_id, org_id, parent_id, path, ...)
  users (id, tenant_id, email, password_hash, status, ...)
  roles (id, tenant_id, code, name, scopes jsonb)
  user_roles (user_id, role_id, scope_org_id?, scope_dept_id?)
  ```
- `packages/db-schema/src/schema/*.ts`
- 生成 migration：`pnpm db:generate`
- Drizzle RLS plugin（tenant_id 强过滤）

**W2-T02**：**本地开发环境**
- `enterprise/deploy/docker-compose/dev.yml`：PG + Redis
- seed 脚本：`pnpm db:seed` 创建默认 tenant + super admin
- 验收：admin-console 连得上 DB，能看到默认数据

### W2 · D2 · 认证

**W2-T03**：**packages/auth 账密 + JWT**
- 包：`@agenticx/auth`
- 功能：
  - `AuthService.loginWithPassword({ email, password })` → `{ access, refresh }`
  - `AuthService.verifyAccess(token)` → `AuthContext | null`
  - `AuthService.refresh(token)` → new access
- JWT：RS256，私钥从 env/vault 读，公钥嵌二进制
- bcrypt cost = 12
- 文件：
  - `packages/auth/src/services/auth.ts`
  - `packages/auth/src/services/jwt.ts`
  - `packages/auth/src/services/password.ts`
  - `packages/auth/src/middleware/next.ts`
- 安全：
  - 密码字段不出 log
  - 登录失败 5 次 15 分钟锁定
  - 登录事件落审计（W4 实现，此处先埋 hook）

**W2-T04**：**SSO Provider 抽象**
- 接口：`AuthProvider = { login, logout, getClaims }`
- 实现：`PasswordProvider`（本期唯一）
- 占位：`OidcProvider` / `SamlProvider`（V2）
- 配置：`auth.yaml` 切换

### W2 · D3 · IAM 基础

**W2-T05**：**用户管理**
- API：
  - `POST /api/v1/iam/users`
  - `GET /api/v1/iam/users?dept_id=&page=&pageSize=`
  - `PATCH /api/v1/iam/users/:id`
  - `DELETE /api/v1/iam/users/:id`（软删除）
  - `POST /api/v1/iam/users/:id/enable|disable|reset-password`
- 全部 `WHERE tenant_id = currentUser.tenant_id`
- RBAC：仅 admin / auditor 可读写
- features/iam/src/services/user.ts

**W2-T06**：**部门树**
- API：
  - `GET /api/v1/iam/departments?as=tree`
  - `POST /api/v1/iam/departments`
  - `PATCH /api/v1/iam/departments/:id`
  - `DELETE /api/v1/iam/departments/:id`
- 前端：Tree 组件（`packages/ui` 补一个），拖拽调父子级
- 存储：物化路径（`path: /org/dept1/dept2/`），避免 N+1

### W2 · D4 · IAM 权限 + 批量

**W2-T07**：**角色与权限 scope**
- scope 语法：`resource:action`（如 `user:create` / `audit:read`）
- 系统角色（非删）：
  - `super_admin`: 所有 scope
  - `admin`: 本 tenant 管理
  - `auditor`: 只读审计
  - `member`: 默认
- 自定义角色：admin 可创建，但不能超出自己的 scope
- API：
  - `POST /api/v1/iam/roles`
  - `POST /api/v1/iam/users/:id/roles`
  - `DELETE /api/v1/iam/users/:id/roles/:role_id`

**W2-T08**：**批量开号**
- 模板下载：`GET /api/v1/iam/users/import-template`（XLSX）
- 上传：`POST /api/v1/iam/users/import`（multipart）
  - 先预检（列校验、email 查重、部门存在性）
  - 返回 `job_id`
- 进度：`GET /api/v1/iam/jobs/:id`
- 事务分片：每批 100 条，失败行记录原因，成功行落地
- 前端：三步向导（上传 → 预检 → 执行 → 结果导出）
- features/iam/src/services/bulk-import.ts

### W2 · D5 · 后台组装 + 集成

**W2-T09**：**admin-console 骨架**
- 路由：
  - `/auth/login`
  - `/dashboard`（占位）
  - `/iam/users`
  - `/iam/departments`
  - `/iam/roles`
  - `/iam/import`
- 布局：侧栏（Nav）+ 顶栏（User menu / Tenant badge）
- 端口：3001

**W2-T10**：**apps/web-portal 登录集成**
- 登录页：`/auth/login` 接 `AuthService.loginWithPassword`
- middleware：未登录跳转 login；已登录注入 `AuthContext`
- E2E：
  - [ ] admin-console 建号（dept X + user alice）
  - [ ] web-portal 用 alice 登录
  - [ ] hechuang/portal 用 alice 登录
  - [ ] 前台 ChatWorkspace 拿到 `user.id / dept_id`，会话能持久化（若 W2 不做持久化，至少能拿到）

### W2 交付清单

- [ ] `packages/db-schema` + migration 就位
- [ ] `packages/auth` 账密+JWT 完整
- [ ] `features/iam` 四个模块（用户/部门/角色/批量）
- [ ] `admin-console` 骨架 + IAM 页面
- [ ] `web-portal` 登录集成
- [ ] 单测：auth、RBAC middleware、bulk-import

---

## W3 · AI 网关 + 策略引擎（5 天）

### W3 目标

- 自研 Go 网关（不抄 APIPark）
- OpenAI 兼容接口
- 三路路由
- 多层策略拦截（关键词 + 正则 + PII）
- 客户端收到合规提示

### W3 · D1 · 网关骨架

**W3-T01**：**apps/gateway 启动**
- Go 1.22+，chi 或 stdlib `net/http`（不用 Gin，依赖更少）
- 目录：
  ```
  apps/gateway/
  ├── cmd/gateway/main.go
  ├── internal/
  │   ├── api/server.go         HTTP handler
  │   ├── config/loader.go      YAML config
  │   ├── provider/             Provider 抽象
  │   ├── router/               三路路由
  │   ├── policy/               policy-engine adapter
  │   └── audit/                AuditEvent 写出
  └── configs/gateway.dev.yaml
  ```
- 健康检查：`GET /healthz`、`GET /readyz`
- 结构化日志：`log/slog`
- 监听：`127.0.0.1:8080`（生产通过反向代理暴露）

**W3-T02**：**OpenAI 兼容接口**
- `POST /v1/chat/completions`
  - 请求 schema：`{ model, messages, temperature?, stream?, ... }`（严格校验）
  - 非流式：直接 JSON
  - 流式：`text/event-stream`
- 错误统一：`{ error: { code, message, type } }`
- 不做模型实际调用，返回 mock response（D2 再接真下游）

### W3 · D2 · Provider + 路由

**W3-T03**：**Provider 抽象层**
- interface：
  ```go
  type Provider interface {
      Chat(ctx, req) (<-chan Chunk, error)
      Embedding(ctx, req) ([]Vector, error)
      Name() string
      Capabilities() []string
  }
  ```
- 实现：`OpenAICompatibleProvider`（可接 OpenAI/DeepSeek/Moonshot/百炼）
- 配置：
  ```yaml
  providers:
    - name: deepseek
      type: openai-compatible
      base_url: https://api.deepseek.com/v1
      api_key: ${DEEPSEEK_API_KEY}
  ```

**W3-T04**：**三路路由决策**
- 决策树：
  1. 请求带 `X-Route-Hint: local` → 走 edge-agent（W3 先 stub）
  2. 模型名前缀 `@private/` → 私有云 Provider
  3. 否则 → 第三方 Provider
- 路由元信息注入响应头：`X-Agenticx-Route: local|private-cloud|third-party`
- 便于前端识别

### W3 · D3 · Policy Engine

**W3-T05**：**规则加载**
- 解析 `plugins/moderation-*/manifest.yaml`
- 支持 `extends` 继承（客户包继承行业包）
- 内部表示：
  ```ts
  type CompiledRule = {
      id; type: 'keyword'|'regex'|'entity'|'prompt';
      matcher: AhoCorasick | RegExp | ...;
      action: 'allow'|'redact'|'block';
      severity; client_message;
  }
  ```
- 文件：`packages/policy-engine/src/loaders/`

**W3-T06**：**关键词引擎（AC 自动机）**
- 性能目标：10,000 条关键词，O(n) 单遍扫描 < 1ms/KB
- 实现：`packages/policy-engine/src/engines/aho-corasick.ts`
- Benchmark 跑通 100k 条模拟关键词

### W3 · D4 · 正则 + PII + 集成

**W3-T07**：**正则 + PII 基线**
- PII 类型：手机号（大陆/港澳台）/ 邮箱 / 身份证（18位） / 银行卡（Luhn校验）/ 常见 API Key 模式（sk-..、ghp_..）
- 文件：`plugins/moderation-pii-baseline/manifest.yaml`
- 每条 PII 规则单测 10 组正反例

**W3-T08**：**gateway 集成 policy-engine**
- 入参 hook（拦截）：`preRequest(req) → block | redact | allow`
- 出参 hook（脱敏）：`postResponse(chunk) → chunk'`
- 命中：写 `AuditEvent.policies_hit[]`（W4 实现审计写入）
- 客户端返回：`9xxxx` 错误码 + `client_message`

### W3 · D5 · 错误码 + E2E

**W3-T09**：**错误码规范**
- `99001` 关键词拦截
- `99002` 正则拦截
- `99003` PII 拦截
- 前端 `features/chat` 识别：
  - 红色警告条：「内容含【项目代号】，已拒绝发送」
  - 可点击「了解合规规则」跳转客户合规页（客户自定义）

**W3-T10**：**E2E 拦截测试**
- 准备 3 条测试 prompt：
  1. 含"HC-2024-ABC"（客户项目代号）
  2. 含银行卡号模式
  3. 含手机号
- 预期：3/3 全拦截，前端显示具体规则原因
- 录屏存档

### W3 交付清单

- [ ] `apps/gateway` Go 服务（OpenAI 兼容 + 三路路由）
- [ ] `packages/policy-engine`（规则加载 + AC 引擎 + 正则 + PII）
- [ ] `plugins/moderation-pii-baseline/` 内容填充
- [ ] `plugins/moderation-finance/` 骨架 + 示例规则
- [ ] 和创规则库（keywords/*.txt 占位）能被 hechuang 客户加载
- [ ] E2E：拦截率 100%
- [ ] 压测：单机 500 QPS 下延迟 < 50ms

---

## W4 · 审计 + 四维查询（5 天）

### W4 目标

- 审计日志 append-only + checksum 链
- 审计查询 UI
- 四维查询 API + 联动筛选 UI
- 端到端演示

### W4 · D1 · 审计基础

**W4-T01**：**AuditEvent schema 定稿**
- 按 `features/audit/README.md` 草案，写入 `packages/core-api/src/audit.ts`
- W4 不再改字段（破坏性变更推 V2）

**W4-T02**：**gateway 审计写入**
- 每次 `/v1/chat/completions` 结束后：
  - 构建 `AuditEvent`
  - 脱敏 prompt / response（只留 hash + 摘要）
  - append-only 写 `/var/log/agenticx/audit/YYYY-MM-DD.jsonl`
  - `prev_checksum = blake2b(prev.raw || "GENESIS")`
- 文件权限 0600
- 每 1000 条或 5 分钟签一次链尾（Ed25519）
- 崩溃安全：每条 fsync（可配置 batch）

### W4 · D2 · 审计查询

**W4-T03**：**features/audit 查询 API**
- `GET /api/v1/audit/events?user_id=&model=&from=&to=&page=`
- RBAC：
  - `auditor` 可跨部门查（本 tenant）
  - `admin` 同 auditor
  - 其他角色只看自己
- 响应前校验链完整性（本次查询涉及的文件片段）
- 断链 → 返回 5xx + 告警日志

**W4-T04**：**审计日志 UI**
- 路由：`/audit/events`
- 列表：时间 / 用户 / 部门 / 模型 / 路由 / 策略命中 / Tokens / Cost
- 过滤器：时间范围、用户多选、模型多选、命中级别
- 详情抽屉：显示 digest（摘要 + hash），绝不展示原文
- 导出：CSV（导出事件本身写一条 audit，防止导出后删库）

### W4 · D3 · 四维查询

**W4-T05**：**usage_records 表**
- schema：
  ```sql
  usage_records (
      id, tenant_id, dept_id, user_id,
      provider, model, route,
      input_tokens, output_tokens, total_tokens,
      cost_usd, request_count,
      time_bucket(hour), created_at
  )
  ```
- 物化视图：
  - `usage_daily_by_dept_user_model`（部门×员工×模型×天）
  - 每日定时 refresh（pg_cron 或 app-level scheduler）

**W4-T06**：**四维查询 API**
- `POST /api/v1/metering/query`
- 请求：
  ```json
  {
      "dept_ids": ["..."],
      "user_ids": ["..."],
      "providers": ["deepseek"],
      "models": ["deepseek-chat"],
      "time": { "start": "...", "end": "...", "granularity": "day" },
      "group_by": ["dept_id", "provider", "day"]
  }
  ```
- 响应：透视数据（适配 recharts / echarts）
- RBAC：普通用户只能看自己；admin/auditor 可跨

### W4 · D4 · 四维查询 UI + gateway 上报

**W4-T07**：**四维查询 UI**
- 路由：`/metering`
- 组件：
  - 左上：时间范围选择器（快捷：今日/本周/本月/自定义）
  - 左下：部门树 checkbox
  - 右上：厂商/模型多选
  - 右下：员工多选（根据部门联动）
  - 中央：大图 + 数据表
  - 支持切换：总览 / 按部门 / 按员工 / 按模型
  - 导出 Excel

**W4-T08**：**gateway 消耗上报**
- SSE 完成后：
  - 从 JWT 读 `tenant_id/dept_id/user_id`
  - 从下游响应读 `usage`（OpenAI API `usage.prompt_tokens/completion_tokens`）
  - 计算成本（从 `providers/*/pricing.yaml`）
  - 异步写 `usage_records`（redis stream → consumer → PG）

### W4 · D5 · 端到端演示 + 验收

**W4-T09**：**端到端演示**
- 脚本：
  1. admin-console 创建部门「投研部」 + 员工 alice / bob
  2. alice 在 hechuang/portal 登录，发 3 条消息（1 条含敏感词被拦截）
  3. admin 切到「审计日志」，查到 alice 的 3 条记录（含拦截记录）
  4. admin 切到「四维查询」，按「投研部 / alice / deepseek-chat / 今日」查出 tokens 和 cost
- 录屏 5-10 分钟 demo.mp4
- 截图关键节点 10 张

**W4-T10**：**MVP 验收 Checklist**
- 对照 V20260422：
  - [ ] §1.3(1) 桌面/Web 端（前台就绪）
  - [ ] §1.3(2) 自然语言 / 多轮对话（就绪）
  - [ ] §1.4 批量开号（就绪）
  - [ ] §1.4 四维查询（就绪）
  - [ ] §1.5(1) 统一管控网关（就绪）
  - [ ] §1.5(1) 敏感拦截（就绪）
  - [ ] §1.5(2) 三路路由（就绪 / 本地路径通过 edge-agent 占位）
  - [ ] §1.5(3) JSON 本地落盘（就绪）
- 风险项标注：
  - 文档校对助手（W4 不含，P5 做）
  - 水印工具（W4 不含，P5 做）
  - 边缘节点真实部署（W4 不含，P5 做）

### W4 交付清单

- [ ] `features/audit` 完整（写入 + 查询 + UI）
- [ ] `features/metering` 完整（表 + API + UI）
- [ ] gateway 审计 + 消耗上报
- [ ] admin-console 两个新页面
- [ ] 端到端演示视频
- [ ] MVP 验收 Checklist 结果

---

## 横向工作（贯穿 4 周）

### 质量门

- 每天收工：`pnpm typecheck && pnpm lint`
- 每周周末：`pnpm test`（覆盖率 ≥ 70%，核心 auth/policy/audit ≥ 90%）
- PR 必过 CI：typecheck + lint + test + govulncheck + semgrep + gitleaks

### 安全基线（任何一周违反立即返工）

- [ ] 任何 API 必须 `withAuth(scope)` 包裹
- [ ] 任何 DB 查询必须 `WHERE tenant_id`
- [ ] 任何日志不得打印 password/token/apiKey/原始 prompt
- [ ] 任何用户输入必须 Zod/类型校验
- [ ] 任何文件路径必须 sandbox 规范化
- [ ] 任何崩溃栈不得原文返回前端

### 文档同步

- 每个 feature/package 必须维护 README
- 每个 API 必须有 OpenAPI schema（由 core-api 生成）
- 每周末更新：
  - `docs/plans/2026-04-21-agenticx-enterprise-architecture.md`（架构主文档）
  - 本 plan 的 todos 状态

### 客户仓保持同步

- customers/hechuang 的 apps/portal 和 apps/admin 随 enterprise 新能力同步组装
- 新增的 features/* 如需白标/规则，客户仓的 config/rules 同步填充

---

## 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| W1 设计没定就开写 Chat，W2/W3 反复改 props | 🔴 高 | W1-T05 契约冻结，W2-W4 只加不改 |
| policy-engine 关键词匹配性能 | 🟠 中 | AC 自动机；压测目标 1ms/KB |
| 多租户漏查 `WHERE tenant_id` | 🔴 高 | Drizzle middleware + code review grep |
| 审计 checksum 链损坏 | 🟠 中 | 每 1000 条签名 + 查询时校验 + 告警 |
| 四维查询性能（部门/员工数量大）| 🟡 低 | 物化视图 + 索引（tenant_id, day, dept_id）|
| Go / TS 两个语言栈切换成本 | 🟠 中 | W1-W2 只 TS；W3 Go 集中攻关 |
| 4 周交付压力 | 🟠 中 | 每周末严格走 Checklist；不达标立即取舍 |

---

## 时间线（甘特）

```
  Day      1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20
  W1 Chat  ███ ███ ███ ███ ███
  W2 IAM                       ███ ███ ███ ███ ███
  W3 GW                                            ███ ███ ███ ███ ███
  W4 Audit                                                                 ███ ███ ███ ███ ███
```

---

## 出计划后立即执行

- [ ] Damon 审本 plan，给出调整意见
- [ ] 确认 W1-T01 从哪天开始
- [ ] 我按 W1 顺序动手

---

## 参考

- `/docs/plans/2026-04-21-agenticx-enterprise-architecture.md`（主架构 v0.2）
- `/enterprise/docs/adr/0001-oss-foundations-selection.md`（自研策略）
- `/enterprise/docs/guides/enterprise-customers-collaboration.md`（协同机制）
- `/enterprise/SECURITY.md`（安全基线）
- 和创技术规范书 V20260422（`/和创/客户文档0422/...`）
