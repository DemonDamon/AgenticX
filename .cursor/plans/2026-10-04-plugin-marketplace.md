# 插件市场全屏视图实现计划

## 背景与目标

Near 桌面端目前对技能/MCP 连接器的发现与安装都藏在「设置 → 技能」页里，发现性差、没有浏览体验。本任务在桌面端新增一个**全屏「插件市场」主视图**：统一承载技能与插件（MCP 连接器 + 精选第三方工具）的浏览、搜索、筛选、安装与使用，并配套首次进入引导弹窗。

**核心原则：零后端改动。** 所有数据与安装链路复用 studio server 已有端点，本次为纯前端新增。

## 产品形态

1. **页头**：标题「插件市场」+ 副标题 + 右上「管理」按钮（打开设置页技能分区）
2. **双 Tab + 搜索**：「插件」Tab（MCP 连接器 + 精选第三方工具混合网格，来源徽标区分）/「技能」Tab（注册源技能 + 官方推荐）；右侧搜索框
3. **三张精选类目大卡**：静态配置，点击跳对应 Tab 并应用筛选
4. **横向筛选标签行**：可滚动、选中态高亮（插件 Tab：全部/MCP 连接器/精选工具；技能 Tab：全部/官方推荐/企业官方/第三方/类目）
5. **卡片网格**：图标 + 名称 + 一句话描述 + 操作按钮；未装「+ 安装」、已装「使用」
6. **首次引导弹窗**：hero 区 + 标题 + 4 条价值点 +「我知道了」，localStorage 记忆已读

## 已确认的设计决策

| 决策点 | 结论 |
|---|---|
| 插件 Tab 内容 | **两者混合**：MCP marketplace（首页 ~20 条）+ `RECOMMENDED_SKILLS` 中 `cta="install"` 的工具，网格内用来源徽标区分；允许个别条目与技能 Tab 重复出现（视角不同） |
| 实施节奏 | **五阶段一次做完**，每阶段可独立验收 |
| 后端 | 不加聚合端点，前端 `Promise.all` 并行拉取（registry 搜索 + 本地技能列表 + MCP 市场列表） |
| 安装链路 | 不重构 SettingsPanel（9767 行），市场页自建 `useSkillInstall.ts` 复制其状态机模式 |
| i18n | 新 namespace `marketplace`；`nav.market` 进 sidebar |

## 阶段 1：路由与骨架

- [store.ts](file:///Users/damon/myWork/AgenticX/desktop/src/store.ts) `MainView` 类型加 `"market"`（`setMainView` 快照逻辑对非 chat 视图通用，无需改）
- [AvatarSidebar.tsx](file:///Users/damon/myWork/AgenticX/desktop/src/components/AvatarSidebar.tsx#L42-L58)：`NAV_ENTRY_DEFS` + `NAV_LABEL_KEY` 加条目（lucide `Store` 图标）
- [App.tsx](file:///Users/damon/myWork/AgenticX/desktop/src/App.tsx#L2684-L2688)：加 `{mainView === "market" ? <MarketplaceView /> : null}`
- 新增 `desktop/src/components/marketplace/MarketplaceView.tsx`：页头 + 管理按钮（`openSettings("skills")`，[store.ts:L1026](file:///Users/damon/myWork/AgenticX/desktop/src/store.ts#L1026) 已支持）+ 双 Tab + 搜索框骨架
- i18n：`desktop/locales/{zh,en}/marketplace.json` 新建；`sidebar.json` 加 `nav.market`；[i18n.ts](file:///Users/damon/myWork/AgenticX/desktop/src/i18n/i18n.ts) 注册 ns；`message-parity.test.ts` 的 NAMESPACES 同步 +1

## 阶段 2：数据层与技能网格

- 新增 `desktop/src/data/marketplace-config.ts`：`FeaturedCardDef`（三张精选卡：类目名、描述、配图引用、目标 tab+筛选值）、筛选标签定义；参照 [recommended-skills.ts](file:///Users/damon/myWork/AgenticX/desktop/src/data/recommended-skills.ts) 模式，图标复用 `assets/recommended/` 现有 SVG
- 新增 `desktop/src/components/marketplace/model.ts`（纯函数，TDD 主战场）：

```ts
export type MarketSkillItem = { key: string; origin: "recommended" | "registry"; name: string;
  description: string; provider: string; iconSrc?: string; category: string;
  tier?: "enterprise" | "third_party"; cta: "install" | "official_site";
  installed: boolean; installing: boolean };
export type MarketPluginItem = { key: string; kind: "mcp" | "tool"; name: string;
  description: string; serverNames: string[]; iconSrc?: string; installed: boolean };
export function normalizeSkillName(n: string): string;        // 小写归一
export function isSkillInstalled(name: string, local: Set<string>): boolean;
export function isMcpInstalled(serverNames: string[], configured: Set<string>): boolean;
export function filterSkills(items: MarketSkillItem[], tag: string, query: string): MarketSkillItem[];
export function mergePluginItems(mcp: MarketPluginItem[], tools: MarketPluginItem[], tag: string): MarketPluginItem[];
```

- 新增 `useMarketplaceData.ts`：并行 `Promise.all([searchRegistry(""), loadSkills(), mcpMarketplaceList({page:1,pageSize:20})])`，竞态 seq 防护照抄 [SettingsPanel.tsx:L3003](file:///Users/damon/myWork/AgenticX/desktop/src/components/SettingsPanel.tsx#L3003) 的 stale 模式
- 已装判定：技能侧 `loadSkills()` 建 `Set<normalizeSkillName>`；MCP 侧 store 的 `mcpServers` 名册求交集
- 新增 `useSkillInstall.ts`：复制 [SettingsPanel.tsx:L3003-L3171](file:///Users/damon/myWork/AgenticX/desktop/src/components/SettingsPanel.tsx#L3003-L3171) 的 preview → scan → confirm（`non_high_risk_confirm_required` / `high_risk_confirm_required` 两态）→ install 状态机（含 429 重试、安装队列）
- UI：`FeaturedCards.tsx`、`FilterChips.tsx`（横向滚动）、`SkillGrid.tsx`

## 阶段 3：插件 Tab

- `PluginGrid.tsx`：MCP 分页聚合+去重+enrich 照抄 [SettingsPanel.tsx:L6691](file:///Users/damon/myWork/AgenticX/desktop/src/components/SettingsPanel.tsx#L6691) 模式（只取首页不追页）+ 精选工具（`RECOMMENDED_SKILLS` 过滤 `cta==="install"`）
- MCP 安装：无 required env 一键装；有 required 弹 env 表单，复制 `handleInstallMarketplaceMcp`（[SettingsPanel.tsx:L6776](file:///Users/damon/myWork/AgenticX/desktop/src/components/SettingsPanel.tsx#L6776)）模式
- 精选工具「安装」：复用 [onRecommendedSkillInstall](file:///Users/damon/myWork/AgenticX/desktop/src/components/SettingsPanel.tsx#L2950) 的 Meta-Agent 安装流（`buildOfficeCliInstallPrompt` / `buildArchscribeInstallPrompt` + `runInstallPromptInMetaAgent`，实施时把 prompt builder 提为可导出纯函数或复制）
- `PluginDetailModal.tsx`：`mcpMarketplaceDetail` 详情浮层（工具清单 + env 说明 + 前往配置）
- `InstallConfirmBar.tsx`：安全扫描确认条，文案 key 对齐 SettingsPanel L3700-3720

## 阶段 4：引导弹窗与「使用」行为

- `MarketOnboardingModal.tsx`：hero 区用 CSS 渐变 + lucide 图标组合（不引入位图）；localStorage key `agenticx.market.onboarding.v1.dismissed`；遮罩结构参照 [QrConnectModal.tsx](file:///Users/damon/myWork/AgenticX/desktop/src/components/QrConnectModal.tsx)
- 技能「使用」→ `usePaneNavigation().newMetaTask(...)`（[usePaneNavigation.ts:L254](file:///Users/damon/myWork/AgenticX/desktop/src/hooks/usePaneNavigation.ts#L254)）回 chat 并预填 `请使用技能「X」…`
- MCP「使用」→ 打开 `PluginDetailModal`；外链类推荐（`cta==="official_site"`）→ `window.open(official_url)`

## 阶段 5：测试（先写验收再实现，TDD）

先确认 desktop 测试基建：`npm test` = vitest；组件测试先例 `ConfirmDialog.test.tsx`（`renderToStaticMarkup + I18nextProvider`）。

| 测试文件 | 覆盖 |
|---|---|
| `model.test.ts` | 名称归一匹配（`OfficeCLI`↔`officecli`）、已装判定、筛选/搜索过滤、插件合并去重、Tab 数据不串 |
| `MarketOnboardingModal.test.tsx` | 首次渲染、`dismissed=1` 不渲染、点击后写 key（mock localStorage） |
| `MarketplaceView.test.tsx` | 页头/双 Tab/精选卡文案渲染（i18n key 输出） |
| `message-parity.test.ts` | zh/en 新 namespace 对齐 |

## 验收标准

1. 侧栏出现「插件市场」导航；进入全屏视图，离开再回 chat 状态正常（快照恢复）
2. 首屏 ≤3 个并行请求渲染出精选卡 + 双 Tab 网格；已装显示「使用」，未装显示「+ 安装」
3. 技能安装走 preview → 扫描 → 确认 → install，高危必经确认；装完卡片自动变「使用」
4. 「使用」技能回 chat 且 composer 预填；「管理」打开设置技能分区；MCP 安装含 env 表单流程
5. 首次进入弹引导，关闭后永久消失；`npm test` 全绿；中英文案齐备

## 约束与红线

- 方案、代码、commit 中使用自有产品语境描述，不引用任何外部产品名称
- 不修改 SettingsPanel 内部逻辑（只读复制模式）；不动后端
- commit 按轨道惯例带 `Made-with: Damon Li` trailer
- 开工前将本计划落盘到 `.cursor/plans/2026-10-04-plugin-marketplace.md`（项目惯例）
