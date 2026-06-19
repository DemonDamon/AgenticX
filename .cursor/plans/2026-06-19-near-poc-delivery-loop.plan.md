# Near 桌面端「客户物料 → POC/MVP」一键交付 Loop 工程化落地

Planned-with: claude-opus-4.7

> 背景：用户希望以 Near 桌面端为入口，把客户需求文档/物料喂进去，通过预置的「智能体 + 子智能体 + Skills + 指令 + MCP + RAG」组合，由 Loop 工程自动产出一份具备「领先视觉 + 自动化测试闭环」的前端 POC/MVP。本 plan 在不动 AgenticX Core 既有正确逻辑的前提下，**只补足距离该愿景仍缺失的能力**，分阶段、可验收。

## 一、对齐现状（不重复造轮子）

仓库里已经具备的、本 plan 直接复用、不再开发的能力：

- **Loop 工程底座**：`agenticx/runtime/agent_runtime.py`、`team_manager.py`、`task_scheduler.py`、`hooks/legacy_event_bridge_hook.py`、`loop_detector.py`，含心跳、子智能体、归档、tool 序列清洗。
- **分身 / 子智能体 / 群聊**：`agenticx/avatar/registry.py`、`group_chat.py`、`group_router.py`、`runtime/meta_tools.py`（`spawn_subagent` / `delegate_to_avatar` 已支持 `taskspaces`/`context_files` 同步）。
- **Skills 体系**：`agenticx/skills/`（`guard.py`、`fuzzy_patch.py`、`versioning.py`、`skill_condition_filter.py` 等）+ Desktop 设置面板的 Skills/Hooks Tab，已支持来源标注、全局/分身级启停、扫描路径配置。
- **本地知识库（RAG）**：`agenticx/studio/kb/`、`/api/kb/*`、`knowledge_search` 工具、`LiteParseAdapter`、Desktop 设置「知识库」Tab，含三态自动检索开关。
- **MCP 体系**：`agenticx/tools/mcp_sync_tool.py`、`fallback_chain.py`、`resolvers/MCPConnectorResolver`、Desktop MCP Marketplace（含「已添加」状态识别）。
- **CC 桥接 / Computer Use / Bash**：`agenticx/cc_bridge/`、`agenticx/embodiment/tools/desktop_adapter.py`，已能驱动外部本机 CLI/浏览器。
- **Desktop**：多窗格、工作区面板、嵌入终端、`automation:*` 定时任务、SSE 流、token 计量、断点续开。

> 结论：**愿景里的"模块 1/2/3 大半已存在"**。当前主要缺口在：①「设计 Skill 套件 + Figma/视觉 MCP」②「Playwright 自动化测试 MCP + 视觉回归」③「面向交付的"项目级 plan.mdc + Worktree 沙箱"调度器」④「Near 端的"交付任务面板"UI 入口」。本 plan 只做这 4 块。

## 二、范围与非目标

**In scope**
- 在 Near 桌面端新增"交付任务（POC/MVP）"模式入口与可视面板。
- 新增 4 个分身预设 + 配套 Skills（需求拆解 / UI 设计 / 前端开发 / 测试审计）。
- 接入 2 个外部 MCP：Figma（设计读写）、Playwright（自动化测试 + 截图）。
- 新增"交付任务调度器"：基于现有 `automation` + `team_manager`，按阶段串起子 Loop，状态写入项目 `plan.mdc`，使用 git worktree 做沙箱。
- 自带最小可演示样例（输入一份 demo 需求文档，跑通 5 阶段，产出可预览的前端工程 + Playwright 报告）。

**Out of scope（明确不做）**
- 不改 AgenticX Core Loop / Runtime / TeamManager 的内部行为，只在外围扩展工具与分身预设。
- 不重写 Skills/MCP/RAG 子系统。
- 不做 Enterprise 网关 / 策略 / 审计 / 后台管理改造。
- 不做"对客户交付级"的设计自动化，只做 POC/MVP 程度的可演示效果。
- 不做新的视觉重塑、不动 Desktop 既有主题与窗格布局。

## 三、需求 (FR / NFR / AC)

### FR-1 交付任务入口（Near 桌面端）
- FR-1.1：新增"交付任务"侧栏入口（与现有"工作区/Spawns/历史"并列），不替换现有 toolbar。
- FR-1.2：交付任务列表 + 新建表单：项目名、需求文件（多选，含 Word/PDF/MD/图片）、目标产物（POC / MVP）、可选行业模板。
- FR-1.3：任务详情页：左侧 5 阶段进度（需求 / 设计 / 开发 / 测试 / 审计），中部当前阶段子智能体面板（复用 `subagent` 状态卡），右侧产物文件树（指向 `./output/<task>/`）。
- AC-1：从"新建任务 → 跑通到第 5 阶段完成"全流程在 demo 物料下可重现。

### FR-2 项目级 plan.mdc 与 Worktree 沙箱
- FR-2.1：每个交付任务自动 `git worktree add .agenticx/deliveries/<slug>`，独立分支 `delivery/<slug>`。
- FR-2.2：阶段状态、阻塞点、产物路径写入 `<worktree>/plan.mdc`，Desktop 解析渲染。
- FR-2.3：心跳/续跑沿用现有 `agent_runtime`，不新增持久化层。
- AC-2：杀掉 Near 主进程后重启，未完成阶段从 `plan.mdc` 恢复且不丢上下文。

### FR-3 四个分身预设 + 配套 Skills
- FR-3.1：分身 `delivery-analyst`（需求拆解）、`delivery-designer`（UI/UX）、`delivery-frontend`（前端开发）、`delivery-qa`（自动化测试 + 审计）。
- FR-3.2：分身配置随仓库提供（`examples/agenticx-for-delivery/avatars/*.yaml` 或等价 JSON），首次启动通过现有 bundle/installer 注入到 `~/.agenticx/avatars/`。
- FR-3.3：每个分身绑定专属 Skills（`requirement-decompose`、`b2b-desktop-design-system`、`scaffold-vite-react`、`playwright-uitest`），均落在 `~/.agenticx/skills/` 并被现有 Skills Tab 识别。
- AC-3：群聊里 `@delivery-frontend` 真实路由到该分身、Skills Tab 可见 4 个新 skill 且来源 = `bundle`。

### FR-4 Figma + Playwright MCP 接入
- FR-4.1：在 MCP Marketplace 提供两条预置：`figma-mcp`（社区版 stdio）、`playwright-mcp`（官方 `@playwright/mcp`）。
- FR-4.2：`delivery-designer` 默认绑定 `figma-mcp`；`delivery-qa` 默认绑定 `playwright-mcp`。
- FR-4.3：失败/未配置 token 时给出可读错误（沿用现有 MCP 错误透传规则），**不**改既有 MCP 通用代码。
- AC-4：在 demo 任务里，设计阶段产出一个 Figma 文件链接（或本地 SVG fallback），测试阶段产出 Playwright HTML 报告 + 至少 5 张交互截图。

### FR-5 交付任务调度器（薄编排层）
- FR-5.1：新增 `agenticx/delivery/orchestrator.py`，基于现有 `team_manager` + `task_scheduler` 串 5 阶段；不引入新 Loop 框架。
- FR-5.2：阶段间产物以文件落盘 + `plan.mdc` 索引方式传递，不引入新 IPC。
- FR-5.3：每阶段含独立校验 sub-call（复用 `delivery-qa` 做轻量校验），不达标回流上一阶段，最多 2 轮，超出则在 UI 标红等待用户介入。
- AC-5：日志可在 Desktop 终端面板查看；卡住时 UI 给出明确"待人工"状态而非静默挂起。

### NFR
- NFR-1：不引入新的全局依赖；新增 npm/pip 包仅限 `delivery-frontend` 分身的工作产物（前端工程内）与 Playwright MCP（运行时按需 npx）。
- NFR-2：交付任务运行不阻塞 Meta-Agent 主聊天窗格，复用 `automation:*` 的会话隔离规则。
- NFR-3：所有新增设置项写入 `~/.agenticx/config.yaml` 的 `delivery:` 节，可被现有设置面板编辑（最少必要字段：`worktree_root`、`figma_token`、`playwright_browsers`）。

## 四、实施分解（建议按 commit 切分）

### Phase 0：脚手架 & 样例物料（0.5 天）
- 新建 `examples/agenticx-for-delivery/`：含一份脱敏 demo 需求 md、参考截图、`avatars/*.yaml`、`skills/*/SKILL.md` 占位。
- 新建 `agenticx/delivery/__init__.py`、`orchestrator.py`（仅骨架 + 单测）。
- Commit 1：`feat(delivery): scaffold delivery orchestrator and demo bundle`

### Phase 1：4 个分身预设 + Skills（1 天）
- 写 `b2b-desktop-design-system/SKILL.md`（含色彩/栅格/分层信息架构 checklist + 引用主流设计系统的链接，**不内置任何受版权保护的资源**）。
- 写 `requirement-decompose`、`scaffold-vite-react`、`playwright-uitest` 三个 SKILL.md。
- 通过 `extensions/installer.py` 已有逻辑安装到 `~/.agenticx/`。
- Commit 2：`feat(delivery): add four delivery avatars and skill bundle`

### Phase 2：MCP 预置（0.5 天）
- Marketplace 配置增加 `figma-mcp`、`playwright-mcp` 两条 curated 项（仅 manifest，不改 marketplace 通用代码）。
- 在分身 yaml 中以 `mcp_servers` 字段声明默认绑定。
- Commit 3：`feat(delivery): preset figma and playwright mcp for delivery avatars`

### Phase 3：调度器 + plan.mdc + Worktree（1.5 天）
- `orchestrator.py` 实现 `start_delivery(task_spec) -> task_id`：建 worktree → 写初始 `plan.mdc` → 顺序调用 5 个分身（设计/开发/测试阶段允许并行子任务）。
- 阶段状态以 `update_plan_section(stage, status, artifacts)` 写回 `plan.mdc`。
- 暴露 REST：`POST /api/delivery/tasks`、`GET /api/delivery/tasks`、`GET /api/delivery/tasks/{id}`、`POST /api/delivery/tasks/{id}/resume`，由 `agenticx/studio/server.py` 注册路由（仅新增 router，不动既有路由）。
- Commit 4：`feat(delivery): orchestrator with worktree sandbox and plan.mdc state`

### Phase 4：Desktop 入口 + 任务面板（1.5 天）
- `desktop/src/components/delivery/DeliveryPanel.tsx`：新建任务表单 + 任务列表 + 详情页。
- 接入 `/api/delivery/*`，复用现有 `subagent` 状态卡组件展示阶段内子任务。
- 在 toolbar 增加"交付任务"按钮（图标：`Boxes` 或 `Workflow`）；遵循现有图标按钮规范，hover tooltip 中文。
- Commit 5：`feat(desktop): delivery task panel and toolbar entry`

### Phase 5：端到端冒烟 + 文档（0.5 天）
- `tests/test_smoke_delivery_loop.py`：mock 分身 LLM 调用，断言 5 阶段状态推进与 `plan.mdc` 写入。
- `docs/guides/near-delivery-loop.md`：操作手册 + demo 跑法 + 已知限制。
- Commit 6：`docs(delivery): smoke tests and operator guide`

## 五、风险与回退

- **风险 R1**：Figma/Playwright MCP 在用户机器无 token / 无浏览器时失败。**对策**：UI 在新建任务时检测并降级为"本地 SVG + 静态截图"模式，不阻塞 5 阶段流转。
- **风险 R2**：Worktree 在用户主仓库脏工作区时创建失败。**对策**：detect dirty → 提示用户先 stash，禁止自动 stash。
- **风险 R3**：调度器阶段回流形成死循环。**对策**：硬上限 2 轮 + 写 `plan.mdc` 标 `awaiting_user`，符合"严重倒退"规避偏好。
- **回退**：每个 commit 独立可回退；功能由 `delivery.enabled=false`（默认 true）一键关闭，不影响 Meta-Agent 与既有面板。

## 六、与用户偏好的对齐

- 严格遵守 `no-scope-creep`：不动 Core/Runtime、不动 Enterprise、不重塑 Desktop 视觉、不引入新 Loop 框架。
- 中文 UI 文案；toolbar 图标化；分身名/会话隔离；group chat 默认隐式包含 Meta-Agent。
- 每个 commit 含 `Plan-Id: 2026-06-19-near-poc-delivery-loop` / `Plan-File` / `Plan-Model` / `Impl-Model` / `Made-with: Damon Li`。

## 七、验收 Demo 场景

输入：`examples/agenticx-for-delivery/sample-rfp.md`（一份 demo 招标式需求）。
预期输出（`./output/<task>/` 下）：
1. `requirement-breakdown.md`（需求拆解）；
2. `design/` 含 Figma 链接或本地 SVG 设计稿 + `design-system.md`；
3. `frontend/` 一个可 `pnpm dev` 起来的 Vite + React 工程（基于 `scaffold-vite-react`）；
4. `qa/playwright-report/`（HTML 报告 + 截图）；
5. `delivery-summary.md`（审计 Agent 出具的产物清单与差距列表）。
