# Enterprise 中英文 i18n 统一改造（admin-console + web-portal）

- Plan-Id: 2026-05-23-enterprise-i18n-zh-en
- Owner: Damon Li
- Scope: `enterprise/apps/admin-console`, `enterprise/apps/web-portal`, `enterprise/packages/ui`
- 不涉及：`apps/gateway`、`apps/edge-agent`、`packages/policy-engine` 等纯后端 / Go 代码
- 目标语言：`zh-CN`（默认）、`en`

## 背景与问题

现状是「半成品」i18n，可观察到三类问题（见 2026-05-23 用户截图）：

1. **字典覆盖不全**：`AppShell.tsx` 内置 `NAV_GROUP_LABELS` / `NAV_ITEM_LABELS` / `SHELL_COPY` 是手抄硬编码字典，
 - `observability` 分组（错误聚类、性能分析）整组未注册 → 切 English 后仍显示中文；
 - `platform` 组的「AI 缓存 / MCP 托管 / Wasm 插件」未注册；
 - 缺少机器化校验，PR 加新页面时几乎一定漏译。

2. **SSR / 首屏闪烁**：`packages/ui/src/branding/locale.tsx` 用 `useLayoutEffect` 从 `localStorage` 读，服务端渲染默认 `zh`，客户端再 hydrate；
 - 用户切到 English 刷新页面，第一帧仍是中文；
 - 没有 cookie 驱动的初始 locale，SSR 与客户端结果天然不一致。

3. **页面正文硬编码**：admin-console 各页面（`/admin/perf`, `/admin/errors`, `/admin/plugins`, `/iam/*`, `/policy/*`, `/metering/*` 等）和 web-portal 工作台（`WorkspaceShell.tsx` 等）页面级标题、描述、空态、按钮文案绝大部分是字面量中文 / 字面量英文混杂；
 - `portal-copy.ts` 只覆盖 ≈30 条登录与少量设置文案，远不足以 cover 工作台。
 - 即便完美的 LocaleProvider 也无法翻译这些字面量。

结论：**必须引入正经的 i18n 框架 + 集中消息目录 + 全量替换硬编码文案**，不再继续用「手抄字典 + 散落 copy 对象」。

---

## 技术决策

### 1. 选型：`next-intl`

- 与 Next 15 App Router 一等公民集成（RSC / Server Components 直接 `getTranslations()`，Client Components `useTranslations()`）。
- 支持 cookie / 中间件驱动 locale，SSR 首帧即可正确渲染，无 hydrate 闪烁。
- ICU 消息格式（变量、复数、性别）是社区标准；后续接日语 / 中文繁体扩展自然。
- 与现有 `@agenticx/ui` 的 `LocaleProvider` 兼容：在 next-intl 之上保留 `useLocale()` 作为业务侧 API（薄壳），避免一次性大爆炸式改动。
- 不选 `react-i18next`：在 RSC 场景需要额外胶水，且与 Next App Router 配合不如 next-intl 顺滑。
- 不选自研：当前手抄字典就是教训。

### 2. 路由策略：cookie-based，不开启 `/en/...` 子路径

- 不引入 `[locale]` 动态段，避免一次性改动所有现有 `app/` 路由结构（破坏性大、CI 风险高）。
- 用 next-intl 的 `localePrefix: "never"` + cookie 持久化（`NEXT_LOCALE`）。
- middleware 仅负责：读取 cookie / `Accept-Language`，标准化到 `zh` 或 `en`，写入 request header 供 `getRequestConfig` 使用。
- 切换语言时同步写 cookie + 触发软导航刷新（`router.refresh()`），保证 SSR 内容跟着切。

### 3. 消息目录布局

```
enterprise/
├── apps/admin-console/
│   ├── messages/
│   │   ├── zh.json
│   │   └── en.json
│   └── src/i18n/
│       ├── request.ts   # next-intl getRequestConfig
│       └── routing.ts   # 常量、locale list
├── apps/web-portal/
│   ├── messages/{zh,en}.json
│   └── src/i18n/{request.ts, routing.ts}
└── packages/ui/
    └── src/branding/locale.tsx   # 改为 next-intl 的薄壳，保留 useLocale() 兼容签名
```

- 两个 app 各自维护自己的 messages（admin / portal 关注点不同）；
- 公共 UI 组件文案（如 PageHeader、EmptyState）通过 prop 由消费方传入翻译后的字符串，不依赖 next-intl，保持 `@agenticx/ui` 纯净（无运行时框架耦合）。
- 命名空间按页面 / 组件分组：`shell.nav.platform.policy`, `pages.perf.title`, `common.actions.save`。

### 4. 消息键约束（lint）

- 所有 .tsx 中**禁止字面量中文 / 英文长句**（≥4 个汉字 或 ≥3 个英文单词且非品牌名）。
- 用 ESLint 规则 `@intlify/eslint-plugin-vue-i18n` 不适用 → 改用社区 `eslint-plugin-i18next` 的 `no-literal-string` 子集 + 自写允许列表（品牌名 `Machi / AgenticX / Pyroscope` 等）。
- 仅对 `apps/admin-console/src/**` 和 `apps/web-portal/src/**` 启用，避免污染其它包。
- CI 中 `pnpm lint` 任一硬编码中文将红灯，强制 PR 走 messages.json。

---

## 实施分段

按「基础设施 → admin-console → web-portal → 验收」四段，每段独立 commit、独立 typecheck/build 绿；遵循用户偏好「一次大 PR + 多段可验收 commit」的工作流。

### Stage 1 — i18n 基础设施（commit `enterprise-i18n-foundation`）

**FR-1.1** 安装 `next-intl@^3` 到 `apps/admin-console` 与 `apps/web-portal` 的 `package.json`。
**FR-1.2** 在两个 app 内新建：
- `src/i18n/routing.ts`：导出 `locales = ["zh", "en"] as const`，`defaultLocale = "zh"`。
- `src/i18n/request.ts`：`getRequestConfig` 从 cookie `NEXT_LOCALE` / `Accept-Language` 派生 locale，加载 `messages/${locale}.json`。
- `src/middleware.ts`：用 `createMiddleware`（`localePrefix: "never"`），仅做 cookie 标准化。
- `next.config.ts`：注入 `createNextIntlPlugin("./src/i18n/request.ts")`。

**FR-1.3** `RootLayout` 用 `NextIntlClientProvider` 包裹，`<html lang>` 由 server 端 locale 决定（`getLocale()`）。

**FR-1.4** 重构 `enterprise/packages/ui/src/branding/locale.tsx`：
- `LocaleProvider` 改为内部消费 next-intl 的 locale（通过 prop 注入），不再读 localStorage。
- `useLocale()` 签名保留：`{ locale, setLocale, isZh }`，但 `setLocale` 改为：写 cookie `NEXT_LOCALE` + 调用 `router.refresh()`。
- 现有 `useLocale()` 调用点（AppShell、portal-copy 等）无需改 API，平滑迁移。

**FR-1.5** 初始化空骨架 messages：
- `apps/admin-console/messages/{zh,en}.json` 仅含 `shell.*` 命名空间。
- `apps/web-portal/messages/{zh,en}.json` 仅含 `auth.*` 命名空间。
- 后续 stage 增量补齐。

**AC-1.1** `pnpm -C enterprise/apps/admin-console build` / `pnpm -C enterprise/apps/web-portal build` 双绿。
**AC-1.2** 在浏览器 DevTools 切 cookie `NEXT_LOCALE=en` 后**强制刷新**，`<html lang>` 即为 `en`、首屏文案不闪烁（用现有 SHELL_COPY 路径验证）。
**AC-1.3** 对应 commit 仅修改基础设施 + locale 包，不动任何业务页面。

### Stage 2 — admin-console 全量本地化（commit `enterprise-i18n-admin`）

**FR-2.1** 把 `AppShell.tsx` 中三张手抄字典（`NAV_GROUP_LABELS` / `NAV_ITEM_LABELS` / `SHELL_COPY`）下沉到 `messages/{zh,en}.json` 的 `shell.nav.*` 与 `shell.copy.*` 命名空间，删除 .tsx 内的字典常量。

**FR-2.2** 补齐目前漏译的导航项：
- `observability.errors`（错误聚类 / Error Clustering）
- `observability.perf`（性能分析 / Performance Profiling）
- `platform.cache`（AI 缓存 / AI Cache）
- `platform.mcpServers`（MCP 托管 / MCP Hosting）
- `platform.plugins`（Wasm 插件 / Wasm Plugins）
- `platform.channels`（Channel 管理 / Channel Management，已存在但确认）
- `observability` 分组标题（可观测 / Observability）

**FR-2.3** 逐页迁移硬编码文案到 messages，按页面命名空间组织：
- `/dashboard`: `pages.dashboard.*`
- `/iam/{users,departments,roles,bulk-import}`: `pages.iam.{users,departments,roles,bulkImport}.*`
- `/audit`, `/metering`, `/metering/quota`: `pages.ops.*`
- `/policy/*`: `pages.policy.*`
- `/admin/{models,channels,cache,api-tokens,mcp-servers,plugins,errors,perf}`: `pages.admin.*`
- 包括：PageHeader title/description、Card title、Badge 文案、空态、按钮、表单 label/placeholder、toast 提示、确认弹窗。

**FR-2.4** 公共组件复用 `common.*`：actions（save/cancel/delete/refresh/upload）、states（loading/empty/error）、time（lastUpdated）、status（enabled/disabled/healthy/degraded/offline）、validation。

**FR-2.5** 健康徽章 `healthLabel()` 接 `useTranslations("shell.health")`，移除函数内 zh/en 分支。

**AC-2.1** 启 `eslint-plugin-i18next` 的 `no-literal-string` 仅对 `apps/admin-console/src/**` 跑 `pnpm lint`，零中文字面量违规（允许列表：Machi/AgenticX/HTTP 错误码/正则/技术常量）。
**AC-2.2** `pnpm -C enterprise/apps/admin-console build` typecheck + build 绿。
**AC-2.3** 手工回归 ≥10 个页面（含截图 3 中复现的 `/admin/perf`），中→英切换后整页无中文残留；英→中切换后整页无英文残留。

### Stage 3 — web-portal 全量本地化（commit `enterprise-i18n-portal`）

**FR-3.1** 把 `apps/web-portal/src/lib/portal-copy.ts` 的 `copy` 对象迁到 `messages/{zh,en}.json` 的 `portal.*` 命名空间，`usePortalCopy()` 改为薄壳调用 `useTranslations("portal")`，保留 hook 名以减少 diff。

**FR-3.2** 全面扫描 `apps/web-portal/src/**/*.tsx`，把硬编码文案迁出：
- `auth/page.tsx`：登录注册表单
- `WorkspaceShell.tsx`：侧栏、顶栏、设置、历史会话面板
- `ChatPane`/`InputArea` 等聊天组件：状态 chip、空态、合规拦截卡片、引用块、错误 toast
- 所有 `app/(workspace)/**` 页面

**FR-3.3** 与 admin-console 共享的「通用组件文案」（如 ConfirmDialog、ErrorBoundary fallback）：通过 prop 注入翻译后字符串，不在 `@agenticx/ui` 内调用 next-intl，保持 UI 包通用。

**AC-3.1** `eslint-plugin-i18next` 对 `apps/web-portal/src/**` 零违规。
**AC-3.2** `pnpm -C enterprise/apps/web-portal build` typecheck + build 绿。
**AC-3.3** 手工回归 `/auth`、`/workspace`、`/workspace/chat/[id]`、`/workspace/settings/*`、`/workspace/history`，中英切换全文一致。

### Stage 4 — 视觉回归与文档（commit `enterprise-i18n-verify`）

**FR-4.1** 扩展 `enterprise/scripts/e2e-visual-tour.ts`：每页同时截 `zh` / `en` 两版截图，输出至 `enterprise/docs/visuals/i18n/{page}-{locale}.png`。
**FR-4.2** 新增 PR 描述模板段「i18n 验收」：列出 13 页 × 2 主题 × 2 语言 = 52 张截图链接。
**FR-4.3** `enterprise/README.md` 与 `enterprise/docs/architecture/` 增补 i18n 章节：
- 如何加新 messages key（约定 + 命名空间）
- 如何在 RSC / Client Component 取翻译
- 如何切换 locale（cookie / 顶栏菜单）
- ESLint 规则与允许列表维护方式

**AC-4.1** `pnpm visual-tour:i18n` 跑通生成 52 张图。
**AC-4.2** 翻阅截图，无中英混排残留。
**AC-4.3** 翻文档可独立支撑后续协作者新增页面时正确接 i18n。

---

## 非目标 / 范围外

- 不引入第三种语言（日 / 繁中等留待后续 plan）。
- 不动 gateway / edge-agent / Go 端文案（这两端目前只对接 Machi Desktop 与 admin-console，UI 文案不归它们出）。
- 不改后端 API 返回的中文消息（如 toast 里展示的 `code`/`message`）。后端国际化是另一条线（更高复杂度，暂不打开），admin / portal 仅通过前端 fallback 兜底（按 code 查 message map，命中就替换；不命中显示原文）。
- 不替换 `@agenticx/ui` 已有原语组件 API。

## 风险与缓解

- **风险 A：硬编码迁移工作量超预期**。
  - 缓解：用 `rg --pcre2 "[一-龥]{4,}" enterprise/apps/{admin-console,web-portal}/src` 扫出所有候选位置，先做工作量评估再切 stage 颗粒度。
- **风险 B：ESLint 规则误伤注释 / 测试 fixture / Markdown 字符串**。
  - 缓解：规则配置 `markupOnly: false` + 仅 .tsx/.ts、排除 `*.test.ts(x)` / `*.stories.tsx` / `**/__fixtures__/**`，并加白名单。
- **风险 C：next-intl 与 Next 15.5.x 兼容**。
  - 缓解：Stage 1 完成后先在 admin-console 端到端跑一遍（含 SSR / 命令面板 / 切换 cookie 刷新），出现兼容问题在 Stage 1 收敛，避免污染 Stage 2/3。
- **风险 D：cookie 与现有 `agenticx-ui-locale` localStorage 双写漂移**。
  - 缓解：迁移期 `setLocale` 同时写 cookie 与 localStorage（向后兼容已使用过 localStorage 的存量用户），下个版本删 localStorage 路径。

## 验收清单（Definition of Done）

- [ ] Stage 1–4 共 4 个 commit，每个独立 typecheck + build 绿。
- [ ] admin-console / web-portal `eslint-plugin-i18next` 零违规。
- [ ] 截图 3 复现路径（`/admin/perf` 等）切英文后无中文残留。
- [ ] 截图 1 的导航分组（observability、platform 后段）切英文后全部翻译。
- [ ] `<html lang>` SSR 首帧与 cookie 一致（无闪烁）。
- [ ] 文档落到 `enterprise/docs/architecture/i18n.md`（或等价路径）。
- [ ] 单一 PR，标题 `feat(enterprise): unify zh-CN / en i18n across admin & portal`，commit 顺序 1→2→3→4，PR body 含「i18n 验收」段落与 52 张截图链接。

## 工作量估算

- Stage 1：≈0.5 天（基础设施 + locale 包重构）
- Stage 2：≈1.5 天（admin-console 13 页 × ~30 条文案 / 页）
- Stage 3：≈1.0 天（web-portal 工作台 + 设置 + 聊天）
- Stage 4：≈0.5 天（截图脚本 + 文档）
- 合计：≈3.5 天

