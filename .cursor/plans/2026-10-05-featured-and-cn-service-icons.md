# 插件市场图标质量第二轮迭代：精选卡重设计 + 国产服务官方图标

## 背景与问题

第一轮图标系统（渐变底座 + 行业 glyph + 24 个国际品牌 CDN 矢量）上线后，用户反馈两处图标「看起来像 AI 生成的」：

1. **精选推荐三张卡**（办公创作 / 连接常用工具 / 专业工具集）：用的是 lucide 通用 glyph（FileText/Plug/Wrench）+ 重渐变底座，观感模板化。
2. **国产服务**（博查、飞书、12306、百度地图、秘塔等）：这些服务官方都有品牌图标，但市场里显示的是渐变 fallback。

### 根因诊断（已实证）

- **管理页 MCP 行 logo 断链**：行的 logo 只能从 `mcpEntries`（市场前 20 条 + verified+hosted 过滤 + 详情富化）按 server 名匹配。本机已配置但不在该集合里的 server（如 `12306-mcp`，上游未通过认证；`bocha-search-mcp`、`feishu-mcp`、`lark-mcp`、`metaso-search`、`mineru-docparser`）全部落到渐变。ManageView 后台拉的全量 100 条列表**没有 `server_config` 字段**，`extractMcpServerNames` 恒为空，logo 索引合并不进任何条目——这段代码实际无效。
- **品牌规则缺国产服务**：`BRAND_RULES`（icon-model.ts）只有 24 个国际品牌，且全部走 `cdn.simpleicons.org`（国内访问不稳定）。
- **精选卡**：`FEATURED_CARDS`（marketplace-config.ts）`icon: LucideIcon` + `gradient`，渲染为渐变方块 + 单色 glyph。

### 上游数据事实（已实测）

- ModelScope MCP 市场 API（PUT `/openapi/v1/mcp/servers`）：列表条目无 `is_verified/is_hosted/server_config`，详情才有；`search` 参数可用，按 server 配置名搜索第一条即官方条目（如搜 `12306-mcp` → `@Joooook/12306-mcp`，detail server_names=["12306-mcp"]，有 logo）。
- 上游 `logo_url`（resources.modelscope.cn，阿里云 CDN）可用率 40/40，质量良好（市场网格里的 Fetch/高德/必应/Jina 已证明）。

## 方案

### 1. 品牌图标层多源化（icon-model + 新增 brand-assets）

- `pickBrandIcon(name)` 返回值从 `{ slug }` 改为 `{ brand }`（brand key）。
- 新增 `marketplace/brand-assets.ts`：`BRAND_ICON_SRC: Record<string, string>`，key → 图标 URL。本地打包资产用 vite import，24 个国际品牌维持 CDN URL。
- **国产服务图标全部本地打包**（`src/assets/marketplace/brands/`），来源与 connector-catalog 同风格注明：
  - LobeHub `@lobehub/icons-static-svg`（MIT）color 变体：bocha、tencent、qwen、zhipu、kimi、doubao、hunyuan、minimax、baichuan
  - Simple Icons（品牌官方矢量）：baidu、zhihu、bilibili、qq、taobao、xiaohongshu、meituan、kuaishou
  - 官方站点 favicon（转 PNG）：metaso（metaso.cn，128px）、mineru（mineru.net，48px）
  - 飞书/Lark 复用现有 `assets/connectors/feishu.svg`（同一鸟形标）
- 新增品牌关键词规则（中文 + 英文 + 常见 server 名片段），规则顺序先具体后一般。
- MarketIcon 优先级链不变：iconSrc → 品牌 → 上游 logo → 渐变。

### 2. 精选卡手绘图标（assets/marketplace/）

- 新增 `featured-office.svg`、`featured-connectors.svg`、`featured-toolkit.svg`：24×24 双色/三色手绘 SVG（主色 + 浅色层次 + 点缀色），构图：
  - 办公创作：折角文档 + 文本行 + 斜置笔 + 星形点缀（蓝系）
  - 连接常用工具：中心枢纽节点 + 三向连线 + 卫星节点（紫系）
  - 专业工具集：交叉扳手与螺丝刀 + 螺母点缀（绿系）
- `FeaturedCardDef.icon: LucideIcon` + `gradient` → `iconSrc: string`（import URL）+ `tint`（淡色底座 tailwind 类）；渲染从渐变方块改为淡色底座 + 双色 SVG img。

### 3. 管理页 MCP 行 logo 搜索补全（manage-model + ManageView）

- `manage-model.ts` 新增纯函数（TDD）：
  - `findUnmatchedServerNames(servers, entries)`：筛出没有 logo 匹配的本机 server 名。
  - `matchServerLogoEntry(candidates, serverName)`：从「detail 富化后的候选」里按 server 名归一化匹配出带 logo 的条目。
- `ManageView.tsx`：后台对未匹配 server（上限 8 个）逐个 `mcpMarketplaceList({ search: serverName, pageSize: 5 })` → 取有 logo 的前 3 条拉 detail → `matchServerLogoEntry` 命中则并入 `logoEntries`。失败静默，不挡首屏。

## 不做项

- 不改市场网格的 verified+hosted 过滤与 pageSize=20（内容策略另议）。
- 不为无官方图标来源的服务（xiniudata、basic-web-crawler 等）强造品牌图标，维持渐变。
- 不做 dingtalk（官方 favicon 仅 16×16，质量不达标；上游条目有 logo 可走搜索补全）。
- 不动 24 个国际品牌的 CDN 方案（避免无谓回归；CDN 失败本就有渐变兜底）。
- 不新增后端接口。

## 阶段与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| P1 计划 | 本文档 | 落盘 `.cursor/plans/` |
| P2 品牌层 | 资产下载打包 + icon-model/brand-assets/MarketIcon 改造 | icon-model 测试新增国产品牌用例全绿 |
| P3 精选卡 | 三个手绘 SVG + config/FeaturedCards 改造 | MarketplaceView 测试绿；截图不再出现 lucide glyph |
| P4 管理页 | manage-model 纯函数 + ManageView 搜索补全 | manage-model 新用例绿 |
| P5 收口 | `npx vitest run`（市场套件全绿，全量失败数 ≤ 存量基线 8）+ CDP 截图对比 + 提交 | 截图中博查/飞书/12306/百度等行显示官方图标 |

## 提交拆分

1. `docs(desktop): icon quality iteration plan` —— 计划文档
2. `feat(desktop): bundled CN brand icons for marketplace` —— P2
3. `feat(desktop): handcrafted featured card icons` —— P3
4. `feat(desktop): resolve manage-view MCP logos via marketplace search` —— P4
