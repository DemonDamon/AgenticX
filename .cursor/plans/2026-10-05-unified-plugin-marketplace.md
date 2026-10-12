# 统一插件市场规划：以「插件」统一管理 MCP / Skills / Agents / Commands

> 状态：方案规划（待用户确认后进入开发）
> 日期：2026-10-05

## 1. 背景与目标

用户观察到 Cursor 的「插件」是一个统一抽象：插件下面可以是 MCP、Skills、Agents、Commands 等具体实例。希望 Near 的插件市场参考这种模式，把各类能力扩展统一管理起来。

目标：
- 插件市场成为所有能力扩展的统一入口（发现 + 安装 + 管理）
- MCP / 技能 / 数字专家（Agents）/ 指令（Commands）在同一市场体系下呈现与操作
- 保持现有 MCP 与技能功能的连续性，不破坏已上线的市场/管理页

## 2. Cursor 调研结论

### 2.1 官方体系（文档实证，cursor.com/docs/plugins）

**Plugin = 分发单元（bundle）**，一个插件可打包以下组件的任意组合：

| 组件 | Agent Plugins | Cursor Plugins | 说明 |
|---|---|---|---|
| Rules | - | ✅ | 持久 AI 指引（.mdc） |
| Skills | ✅ | ✅ | 专项能力（SKILL.md） |
| Agents | - | ✅ | 自定义 agent 配置 |
| Commands | - | ✅ | agent 可执行命令文件 |
| MCP Servers | ✅ | ✅ | MCP 集成 |
| Hooks | - | ✅ | 事件触发自动化脚本 |

两种格式并存：
- **Agent Plugins**（开放标准 agent-plugins.org）：`plugin.json` manifest，仅打包 skills + MCP servers
- **Cursor Plugins**：`.cursor-plugin/plugin.json` manifest，支持全组件 + variables

分发渠道：Cursor Marketplace（官方，Git 仓库分发 + 人工审核）、Customize 页（安装管理入口）、Team marketplaces（团队内分发，Dashboard → Plugins & MCPs 管理）、cursor.directory（社区）。

### 2.2 本地实证（~/.cursor/ 文件系统）

分类型独立存储 + 统一 UI 入口：
- MCP → `mcp.json`（mcpServers 对象，stdio/http/streamable-http/sse 四种 transport）
- Commands → `commands/*.md`（纯 Markdown，文档即命令，`/<name>` 调用）
- Skills → `skills/<name>/`（SKILL.md + commands/ 子目录；内置 27 个在 skills-cursor/）
- Agents → `agents/` 目录
- Rules → `rules/*.mdc`（frontmatter: description/globs/alwaysApply）
- Extensions → `extensions/`（VSIX）

### 2.3 UI 层（待补）

两次 GUI 调研均因 macOS 屏幕锁定未能截图（扩展面板/Customize 页的卡片字段与安装交互）。方案不依赖此项，待用户解锁屏幕后补充验证。

## 3. Near 现状盘点

| 资产 | 现状 | 管理入口 |
|---|---|---|
| MCP | 插件市场「插件」tab + 管理页 MCP 行 | ✅ 已在市场 |
| 技能 | 市场「技能」tab（ClawHub + 本地）+ 管理页技能行（开关） | ✅ 已在市场 |
| 数字专家（≈Agents） | AvatarItem{id, name, role, system_prompt, tools_enabled, skills_enabled...} | ❌ 独立画廊视图（AvatarGalleryView），不在市场 |
| 指令（≈Commands） | StoredCommand{id, name, description, instructions}，scope: builtin/session/avatar/group/room/global，输入框 `/` 菜单调用 | ❌ 设置页 CommandsSettings，不在市场 |

市场页现状：两 tab（插件 = MCP 连接器 + 精选工具 / 技能）+ 精选推荐三卡 + 筛选 chips；管理页：MCP 行（连接状态）+ 技能行（全局开关 + 体验）。

## 4. 方案设计

### 4.1 核心抽象：kind 化统一条目（暂不引入 bundle）

```ts
type MarketItemKind = "mcp" | "skill" | "agent" | "command" | "tool";
type MarketplaceItem = {
  id: string;
  kind: MarketItemKind;
  name: string;
  description: string;
  icon?: string;          // 沿用现有品牌图标链
  author?: string;
  installed: boolean;
  source: "modelscope" | "clawhub" | "builtin" | "local";
  // kind 特有字段按需扩展
};
```

不引入 bundle 的理由：
- Near 的上游（ModelScope MCP、ClawHub 技能）均为单一类型条目，无 bundle 格式上游
- bundle 需要新的 manifest 规范、分发格式与安装器，复杂度高；统一市场管理的价值可先落地
- 演进路径：未来若需要「一个包带多个能力」，可按 Agent Plugins 开放标准补 bundle 层，kind 模型天然兼容

### 4.2 市场页信息架构

- 顶栏 tab 调整为：`全部 / MCP / 技能 / 专家 / 指令`（保留「插件」语义为全部）
  - 备选：维持两 tab + kind 筛选 chips，改动更小
- 统一卡片组件：kind badge（连接器/技能/专家/指令）+ 图标（沿用品牌图标链）+ 名称/作者/简介 + 安装状态与 CTA
- 精选推荐三卡保留，可增加「精选专家」「精选指令」位

### 4.3 管理页统一

四类行统一在同一列表（或按 kind 分组）：
- MCP 行：现有（连接状态 + 工具数 + 体验）
- 技能行：现有（全局开关 + 体验）
- 专家行（新增）：头像 + 角色 + 启停 + 编辑（跳画廊）
- 指令行（新增）：`/name` + 描述 + scope badge + 编辑/删除/置顶

### 4.4 专家与指令的市场化来源

- 专家：本地 avatars 全量呈现 + 内置专家模板（精选推荐）起步；未来接专家共享市场
- 指令：builtin commands + 用户自定义 commands 呈现；市场 tab 提供内置推荐指令模板（一键创建）

## 5. 分阶段实施

| 阶段 | 内容 | 交付物 |
|---|---|---|
| P1 | 统一条目模型 + 市场页 kind 框架（tab/筛选/统一卡片） | model 层 + 市场页改造 + 测试 |
| P2 | 管理页接入专家行、指令行 | ManageView 扩展 + 测试 |
| P3 | 市场 tab 接入专家/指令条目（本地 + 内置模板起步） | 数据源接入 + 测试 |
| P4（未来） | bundle 分发格式（参考 Agent Plugins 开放标准） | 另立规划 |

## 6. 验收标准

- AC-1: 市场页能在统一入口下浏览 MCP/技能/专家/指令四类条目，kind 标识清晰
- AC-2: 管理页能对四类条目执行各自的管理操作（MCP 连接、技能开关、专家启停/编辑、指令编辑/删除）
- AC-3: 现有 MCP 安装、技能安装/开关行为不回归（市场套件全绿）
- AC-4: 品牌图标链对新 kind 条目同样生效

## 7. 开放问题（待用户确认）

1. 市场页 tab 形态：四 tab（全部/MCP/技能/专家/指令）还是两 tab + 筛选 chips？
2. 专家与指令先入管理页（P2）还是先入市场 tab（P3）——影响交付顺序
3. 指令市场是否需要内置推荐模板起步（还是仅展示本机已有）
