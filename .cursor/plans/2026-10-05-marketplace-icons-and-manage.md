# 插件市场:图标系统与管理视图(2026-10-05)

## 背景

市场主视图已完成并冒烟通过。本轮按用户提供的 4 张参考图补齐两块体验:

1. 卡片图标不够好看——参考图里每个插件都有高辨识度的彩色图标,我们的 MCP 卡是统一紫色渐变底座、技能卡是首字母 fallback。
2. 缺管理入口——参考图市场头部右上角有「管理」按钮,点开是管理视图(返回按钮 + 带*计数*的 Tab + 搜索 + 行式列表),每行右侧有操作组(体验/开关等)。

约束:实现上借鉴参考图的交互骨架,视觉细节做自己的风格(渐变底座 + 内描边,确定性 hash 选色);**任何规划/代码/commit 不提及参考产品的来源**。

## 能力盘点(已探查)

| 能力 | 现状 | 结论 |
|------|------|------|
| MCP 市场图标 | 上游条目 `logo_url` 字段,81/100 有值 | 可用,无值走 fallback |
| 技能开关 | `putSkillSettings.disabledSkills` + PUT 后 invalidate 列表缓存 | 可做 |
| 技能卸载 | 无 API | 本轮不做 |
| MCP server 级开关 | 无后端能力(`/api/mcp/settings` 只有 disabled_tools 等) | 本轮不做 |
| MCP 断开 | `disconnectMcp` 需要 sessionId(市场视图无此链路) | 本轮不做 |
| 体验(回聊天预填) | 已有 `newMetaTask(useDraft)` 模式 | 复用 |

## 阶段 1:图标系统

新组件 `marketplace/MarketIcon.tsx` + 纯函数(放同文件或 `icon-model.ts`,可单测):

- `hashName(name)`:确定性字符串 hash(djb2),同名稳定。
- `pickGradientFor(name)`:8 组品牌感渐变(Tailwind class),按 hash 取,加内描边 `ring-1 ring-white/10`。
- `pickMarketIconGlyph(name)`:中英文关键词 → lucide 行业图标(地图→Map、搜索→Search、视频→Video、图片/画→Image、文档→FileText、代码/前端→Code2、数据→Database、邮件→Mail、聊天→MessageSquare、浏览器→Globe、git→GitBranch、音乐→Music、翻译→Languages,默认→Sparkles)。
- `MarketIcon`:props `{ name, logoUrl?, iconSrc? }`;优先真实图片(onError 回退),否则渐变底座 + 行业图标。

接入:
- `MarketMcpEntry` 增加 `logoUrl?`,`useMarketplaceData` 从 `raw.logo_url` 提取;`PluginGrid` MCP 卡与工具卡统一走 `MarketIcon`(替换原紫色渐变 Plug 底座)。
- `SkillGrid` 的 `SkillIcon` 替换为 `MarketIcon`(推荐位 icon_src 优先,registry/本地技能走渐变 fallback)。

## 阶段 2:管理视图

- `MarketplaceView` 内部 `view: "market" | "manage"` 状态;市场头部搜索框左侧加「管理」pill 按钮(Settings2 图标)。
- 新组件 `marketplace/ManageView.tsx`:
  - 顶部「← 返回市场」;标题「管理」+ 副标题;Tab:插件(已配置 MCP 数)/ 技能(本地技能数);右侧搜索框。
  - 行式列表:MarketIcon + 名称 + 来源/描述 + 右侧操作组。
  - 插件 Tab 数据:`loadMcpStatus("")` servers(name/connected/tool_count),logo 从市场条目按 server 名匹配(匹配不到走 fallback)。
  - 技能 Tab 数据:`loadSkills` 全量(name/description/source/globally_disabled)。
- 行操作组:
  - 技能行:绿色 toggle(开关 = putSkillSettings.disabledSkills 增删,成功后 loadSkills 刷新)+「体验」图标按钮(title 提示)。
  - MCP 行:连接状态徽标(healthy/error/disconnected)+「体验」。
  - 「体验」= 回聊天预填 useDraft(复用 newMetaTask 回调,由 MarketplaceView 注入)。
- i18n:`marketplace.json` 增加 `manage.*` keys(zh/en)。

## 阶段 3:测试与提交

- 纯函数测试:`hashName` 稳定性、`pickGradientFor` 分布与稳定性、`pickMarketIconGlyph` 中英文映射;管理行拼装 `buildManageRows`(过滤/计数)测试。
- 组件测试:renderToStaticMarkup 冒烟(zh/en),沿用现有模式。
- 全量 `npx vitest run` 与存量基线一致(8 failed 为存量)。
- commit 划分(一个功能点一个 commit):
  - A: `feat(desktop): add marketplace icon system with gradient fallbacks`
  - B: `feat(desktop): add marketplace manage view with skill toggles`

## 明确不做(后端能力缺失,留后续)

- 技能卸载(无 API)、MCP server 开关(无配置项)、MCP 断开(市场视图无 session 链路)。
- 后续若做,需要后端新增:`DELETE /api/skills/{name}`、MCP server 级 enabled 配置、无 session 版 disconnect。
