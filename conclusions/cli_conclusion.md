# AgenticX CLI 模块总结

> 结论更新时间：2026-05-29（覆盖 2026-04-22 之后的变更）

## 目录路径

`agenticx/cli/`

## 模块概述

CLI 模块是 AgenticX 的命令行入口和 Studio 运行时适配层，分为两类职责：
1. **Studio 执行层**：`StudioSession`、`AgentRuntime` 适配、工具分发、MCP/Skill 集成（核心路径）
2. **传统 CLI 工具**：项目脚手架、部署管理、文档生成等开发者工具链

---

## 目录结构

```
agenticx/cli/
├── __init__.py              # 包入口
├── studio.py                # StudioSession + 交互式 REPL
├── agent_loop.py            # CLI 模式下的 AgentRuntime 适配器
├── agent_tools.py           # STUDIO_TOOLS 定义 + dispatch_tool_async
├── studio_mcp.py            # MCP Hub 集成（连接/断开/工具调用/上下文注入/多源配置合并）
├── mcp_discovery.py         # 本机 AI 工具 MCP 配置品牌扫描（Cursor/Claude/Codex/Zed/...）
├── mcp_schema.json          # MCP `~/.agenticx/mcp.json` 的 Draft2020-12 JSON Schema
├── studio_skill.py          # Skill 发现与摘要（get_all_skill_summaries）
├── config_manager.py        # 配置管理（全局/项目 YAML 合并）
├── config_commands.py       # config 子命令
├── codegen_engine.py        # 代码生成引擎（write_generated_file 等）
├── intent_classifier.py     # 用户意图分类
├── generate_commands.py     # generate 子命令
├── hooks_commands.py        # hooks 子命令
├── skills_commands.py       # skills 子命令
├── volcengine_commands.py   # 火山引擎专属命令
├── log_config.py            # 日志配置
├── main.py                  # Typer CLI 主程序入口
├── client.py                # AgenticXClient / AsyncAgenticXClient SDK
├── debug.py                 # DebugServer 调试工具
├── deploy.py                # DeployManager 部署工具
├── docs.py                  # DocGenerator 文档生成
├── scaffold.py              # ProjectScaffolder 脚手架
└── tools.py                 # 工具注册辅助
```

---

## 核心组件：Studio 执行层

### StudioSession（studio.py）

**功能**：持有单次 Studio 会话的全部运行时状态。

**关键字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `provider_name` / `model_name` | str | 当前 LLM 提供商和模型 |
| `artifacts` | Dict[Path, str] | 已产出的文件内容 |
| `chat_history` | List[Dict] | 用户可见的对话历史 |
| `agent_messages` | List[Dict] | 含工具调用的完整 LLM 消息序列 |
| `context_files` | Dict[str, str] | 注入的上下文文件（路径→内容） |
| `workspace_dir` | str | 当前工作目录 |
| `mcp_hub` | MCPHub | **(NEW，2026-05-06 重构)** 已改为 **read-through property**，委托到进程级 `GlobalMcpManager.singleton().hub`；直接赋值被忽略并发 `DeprecationWarning` |
| `mcp_configs` | Dict | **(NEW)** 同为 read-through property → `GlobalMcpManager`，多 session 共享单一 Hub，不再 per-session 派生子进程 |
| `connected_servers` | set | **(NEW)** 同为 read-through property → `GlobalMcpManager` |
| `session_mode` | str | **(NEW)** Harness 模式：`code_dev`（四层上下文）vs `daily_office`（默认） |
| `current_user_intent` | Optional[str] | **(NEW)** 本会话当前用户意图（不持久化到 messages.json） |
| `mcp_server_ops` | Dict[str, Dict] | 每个 MCP 服务器的最新操作状态（`phase`/`message`/`error`/`updated_at`），供 Desktop MCP 卡片渲染细粒度进度 |
| `todo_manager` | TodoManager | 结构化 Todo 跟踪 |
| `scratchpad` | Dict[str, str] | 跨轮次的临时键值存储 |
| `provider_hard_failure_providers` | Set[str] | Session 级 LLM Provider 硬失败黑名单（计费/鉴权错误后跳过） |

**REPL 功能**（交互模式）：
- 支持 `/mcp`、`/skill`、`/context`、`/snapshot`、`/history` 等斜杠命令
- 自动连接 MCP 服务器（`auto_connect_servers()`）
- 从 `workspace.loader.ensure_workspace()` 初始化工作区

---

### agent_loop.py — CLI 模式适配器

**功能**：将 `AgentRuntime` 的事件流适配为 CLI 终端渲染。

**入口函数**：`run_agent_loop(session, llm, user_input) -> str`

- 创建 `AgentRuntime(llm, SyncConfirmGate(), max_tool_rounds=MAX_TOOL_ROUNDS)`
- 异步迭代 `run_turn()` 事件流，渲染 round 进度、工具调用、token 输出
- `MAX_TOOL_ROUNDS`：优先 `AGX_MAX_TOOL_ROUNDS` 环境变量，回退 config，默认 30（范围 10-120）
- 将事件轨迹写入 `session.last_agent_events` 和 `session.agent_loop_history`

---

### agent_tools.py — 工具注册与分发

**功能**：定义 Studio 全量工具集（`STUDIO_TOOLS`）和异步工具分发器（`dispatch_tool_async`）。

**STUDIO_TOOLS**：OpenAI function schema 格式的工具定义列表，包含：

| 工具分组 | 代表性工具 |
|----------|-----------|
| 文件操作 | `file_read`, `file_write`（**(NEW)** 支持 `from_path`/`from_url` 直读大文件，避免全文走 LLM 上下文）, `file_edit`, `list_files` |
| Shell | `bash_exec` |
| 网络 | `web_search`, `web_fetch`（**(NEW)** 抓取 URL 正文 + 发现页面图片）, `view_image`（**(NEW)** 视觉附件入队 + `is_vision_capable` 守卫） |
| Todo 管理 | `todo_write` |
| Scratchpad | `scratchpad_write`, `scratchpad_read` |
| 记忆 | **(NEW)** `memory_search`, `memory_append`, `session_search`（跨会话 FTS5 检索） |
| 知识/代码索引 | **(NEW)** `knowledge_search`, `code_search`, `code_outline`, `code_index_create` / `code_index_status` / `code_index_cancel` / `code_index_clear` |
| 子智能体 | `spawn_subagent`, `query_subagent_status`, `cancel_subagent`, `send_message_to_subagent`（委派/接力均通过 meta_tools 暴露） |
| MCP | `mcp_call`, **(NEW)** `mcp_connect`, `mcp_import` |
| Skill | `skill_list`, `skill_use`, **(NEW)** `skill_manage`（create/patch/delete + guard 扫描）, `skill_import_repo`（批量从 GitHub 仓库导入） |
| LSP | `lsp_hover`, `lsp_goto_definition`, `lsp_find_references`, `lsp_diagnostics` |
| 文档解析 | `liteparse` |
| 定时/自动化 | **(NEW)** `schedule_task`, `list_scheduled_tasks`, `update_scheduled_task`, `cancel_scheduled_task`, `get_automation_task_logs` |
| 任务经验 | **(NEW)** `task_experience_learn` / `task_experience_retrieve` / `task_experience_clear`（随 routing="team" Workforce 桥接引入） |
| 代码生成 | **(NEW)** `codegen` |
| Claude Code 桥接 | **(NEW)** `cc_bridge_start` / `cc_bridge_send` / `cc_bridge_list` / `cc_bridge_stop` / `cc_bridge_permission` |
| 桌面操控（Computer Use） | **(NEW)** `desktop_screenshot`, `desktop_mouse_click`, `desktop_keyboard_type` |

**dispatch_tool_async(tool_name, arguments, session, confirm_gate, event_callback, team_manager)**：
- 按 tool_name 路由到对应工具实现
- 支持 `event_callback` 异步回调（用于向 Runtime 传递 confirm_required 等中间事件）
- 安全白名单检查：`bash_exec` 等高风险工具经 `ConfirmGate` 确认

---

### studio_mcp.py — MCP 集成

**功能**：管理 MCP（Model Context Protocol）服务器连接、工具调用与本地配置合并，同时服务 CLI REPL 与 Studio FastAPI。

> **(NEW，2026-05-06 重构，commits `83cdf536` / `53137c1f` / `ad4533e7`)**：MCP 生命周期统一收敛到进程级 `agenticx.runtime.global_mcp_manager.GlobalMcpManager`（单例 + last-state restore）。`StudioSession` 的 `mcp_hub` / `mcp_configs` / `connected_servers` 改为 read-through property 委托到该单例；**废弃 per-session auto-connect**，`list_mcps` / `mcp_call` / `connect` / `disconnect` 全部经 `GlobalMcpManager` 统一路由；连接状态变化经 `global_mcp_state.add_to_last_connected` / `remove_from_last_connected` 持久化以便重启恢复。下文列出的 `mcp_connect_async` 等仍是底层连接实现，但调用方已收口到 `GlobalMcpManager`。

**多源配置搜索链**（`all_mcp_config_search_paths()`）：按优先级顺序合并
1. `~/.agenticx/mcp.json`（canonical）
2. `mcp.extra_search_paths` 中的用户附加路径
3. 项目 `.cursor/mcp.json`
4. `~/.cursor/mcp.json`

**Machi 出厂默认条目**（`_DEFAULT_MCP_ENTRIES`）：`browser-use`（`uvx browser-use[cli] --mcp`）与 `firecrawl`（`npx firecrawl-mcp`，默认自托管 `http://127.0.0.1:3002`）。`ensure_default_agenticx_mcp_json()` 在读取前合并缺失条目，不覆盖用户自定义 block。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `load_available_servers()` | 按搜索链读取并合并所有 MCP JSON；同时确保 Machi 默认条目存在 |
| `import_mcp_config(src, dst)` | 从外部 MCP 配置（Cursor 等）导入并合并到 `~/.agenticx/mcp.json`，区分 imported/updated/skipped |
| `ensure_default_agenticx_mcp_json()` | 首次启动创建或补齐默认 MCP JSON，返回是否写入 |
| `preflight_browser_use_install()` | 检测到默认 `browser-use` 配置时自动 `uvx browser-use install`（Chromium/Playwright） |
| `mcp_connect_async(hub, configs, connected, name)` | FastAPI/事件循环安全的连接实现；对 `docker`/`uvx`/`npx` 超时给出差异化中文 hint，支持 `asyncio.CancelledError`（"连接已取消"） |
| `mcp_connect(hub, configs, connected, name)` | 同步 wrapper；检测到正在运行的 event loop 时切到子线程 |
| `auto_connect_servers_async(..., auto_connect_list)` | 批量连接入口，`auto_connect_list=None` 表示连全部 |
| `mcp_disconnect_async` / `mcp_disconnect` | 断开 + 刷新路由表 |
| `mcp_call_tool_async(hub, tool_name, args_json)` | 异步工具调用；未连接/未知工具/参数 JSON 非法时返回 `ERROR: mcp_call: ...`（bounded 到 2000 字符，并通过 `__cause__` 展开嵌套异常链）；对 `list_tools`/`tools/list` 等虚拟名称返回"已连接工具目录"而非错误 |
| `build_mcp_tools_context(hub)` | 序列化已连接 MCP 工具供系统提示注入；按 `mcp.disabled_tools` 配置过滤（使用原始 tool 名，避免路由别名混淆） |
| `get/set_mcp_extra_search_paths_config` | 读写 `~/.agenticx/config.yaml` 中的 `mcp.extra_search_paths`（去重 + 屏蔽 canonical 路径） |
| `append/remove_mcp_auto_connect_name` | 维护 `mcp.auto_connect` 白名单，支持 `"all"` 旧值迁移 |
| `get/set_mcp_disabled_tools_config` | 维护 `{server_name: [disabled_tool_names]}`，对 UI 单独禁用 MCP 工具 |
| `agenticx_home_mcp_path()` | `~/.agenticx/mcp.json` 规范路径 |

**错误语义**：所有面向 agent/UI 的失败走 `_format_mcp_call_error()`（统一前缀 `ERROR: mcp_call:` + 长度上限），避免调用方因空响应误判成功或上下文爆炸。

---

### mcp_discovery.py — 本机 MCP 配置品牌扫描

**功能**：扫描本机常见 AI 工具的 MCP 配置文件，供 Desktop `设置 → MCP → 发现` 面板一次性导入。

**覆盖品牌**（`_CATEGORY_SPECS`）：AgenticX、Cursor、Claude Desktop、Claude Code、Trae、OpenClaw、Hermes、Codex CLI、Windsurf、Continue（JSON/YAML 双格式）、Cline、Zed、VS Code、Gemini CLI、Cherry Studio（仅探测目录存在）。

**核心数据模型**：
- `DiscoveredServer`：`name / command / args / env / url / headers / timeout`
- `BrandHit`：`brand / display_name / icon / path / format / exists / parse_ok / server_count / servers / parse_error`

**关键函数**：
- `detect_all(cwd=None) -> List[BrandHit]`：对每个品牌按路径候选顺序挑首个存在的文件读取（`json`/`json5`/`yaml`/`toml`），解析失败时保留 `parse_error` 供 UI 呈现
- `_expand_path` / `_load_raw` / `_extract_servers` / `_coerce_server`：路径变量展开（`{CWD}` / `%APPDATA%` / `~`）、多格式解析、不同品牌 key path（`mcpServers` / `mcp.servers` / `mcp_servers` / `context_servers` / `mcpServers_or_root`）的归一化

**端到端**：被 Studio `GET /api/mcp/discover` 调用；桌面前端展示为"发现到的品牌列表"并允许一键合并到 `~/.agenticx/mcp.json`。

---

### studio_skill.py — Skill 发现

**功能**：扫描 `~/.agenticx/skills/` 目录下的 SKILL.md 文件，提供摘要供 Agent 系统提示注入。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `get_all_skill_summaries()` | 返回 `[{name, description}]` 列表，最多 120 条 |
| `skill_list(session)` | CLI 展示所有 Skills |
| `skill_search(session, query)` | 搜索 Skill |
| `skill_use(session, name)` | 激活/使用 Skill |
| `skill_info(session, name)` | 查看 Skill 详情 |

---

### config_manager.py — 配置管理

**功能**：两级 YAML 配置合并（全局 `~/.agenticx/config.yaml` + 项目级 `./agenticx.yaml`）。

**关键接口**：
- `ConfigManager.load()`：返回合并后的 `AgenticXConfig` dataclass
- `ConfigManager.get_value(key)`：点分路径取值（如 `"runtime.max_tool_rounds"`）
- `ConfigManager._deep_merge(global_data, project_data)`：项目配置覆盖全局配置

**配置项说明**：
- `workspace_dir`：Meta-Agent workspace 目录
- `runtime.max_tool_rounds`：工具调用最大轮数
- `runtime.llm_invoke_timeout_seconds`：LLM 调用超时
- `active_provider` / `active_model`：Desktop 持久化当前选中模型
- `mcp.extra_search_paths`：`~/.agenticx/mcp.json` 之外的附加 MCP JSON 搜索路径
- `mcp.auto_connect`：Studio/Desktop 启动时自动连接的 MCP 服务器名单（支持 `"all"` 旧值）
- `mcp.disabled_tools`：`{server_name: [tool_names]}` 形式的 MCP 工具禁用表，由 UI 管理
- **(NEW)** `web_search`：内置 Web 搜索配置（DuckDuckGo 默认 + 可选 API providers）；导出时对 `providers.*.api_key` 做掩码（参见 Studio `web_search` 路由）
- **(NEW)** `longrun`（`LongRunSettings`）：Symphony 风格长任务编排开关——`enabled` / `workspace_root`（默认 `~/.agenticx/task-workspaces`）/ `stall_threshold_sec`（300s）/ `poll_interval_sec`（30s）/ `worker_session_id` / `linear_api_key` / `linear_team_ids`

---

## 传统 CLI 工具链

### main.py — Typer CLI 主程序

基于 Typer 框架，提供命令组：
- `project`：create、info
- `agent`：create、list
- `workflow`：create、list
- `deploy`：prepare、docker、k8s
- `monitor`：start、status
- `docs`：generate、serve
- `studio`：启动 Studio 服务
- `config`：配置管理（来自 config_commands.py）
- `generate`：代码生成（来自 generate_commands.py）
- `skills`：Skill 管理（来自 skills_commands.py）

### scaffold.py — 项目脚手架

- 模板：basic、multi_agent、enterprise
- Agent 模板：basic、researcher、analyst、writer
- 工作流模板：sequential、parallel、conditional

### deploy.py — 部署管理

- 支持 Docker / Kubernetes / Docker Compose / Serverless 部署
- 自动生成 Dockerfile、k8s YAML、compose 文件

### client.py — SDK 客户端

- `AgenticXClient`（同步）/ `AsyncAgenticXClient`（异步）
- 支持工作流执行、配置验证、测试运行、Agent 发现

---

## 模块间关系

```
main.py (Typer)
    ├─ studio 命令 → agenticx/studio/server.py（Studio HTTP 服务）
    └─ interactive REPL → studio.py → agent_loop.py
                                          ↓
                                    AgentRuntime
                                    (agenticx/runtime/)
                                          ↓
                                    dispatch_tool_async
                                    (agent_tools.py)
                                          ├─ MCP → studio_mcp.py
                                          └─ Skill → studio_skill.py
```

---

## 关键设计

1. **双路径执行**：CLI 交互模式（`run_agent_loop`）和 Studio 服务模式（`server.py`）共享同一 `AgentRuntime`，行为一致
2. **延迟导入**：main.py 使用延迟导入提升 CLI 启动速度
3. **session 作为状态容器**：`StudioSession` 贯穿所有工具调用，持有消息历史、artifacts、MCP 状态和 Todo
4. **工具安全机制**：`bash_exec` 等高风险工具通过 `ConfirmGate` 拦截，子智能体使用 `AutoApproveConfirmGate`；**(NEW)** agent 系统提示与 `mcp_connect` / `mcp_import` 工具描述明确拒绝在对话中收集 API Key，引导走「设置 → MCP」环境变量配置
5. **Near 品牌默认（NEW，2026-05-24，commit `9a3100bb`）**：meta-agent 兜底标签、群聊 mention 旧别名（`@machi` 仍路由到 meta leader）、CLI/agent_tools 用户提示统一对齐 Desktop 的 Machi → Near 重命名（`DEFAULT_META_PRODUCT_LABEL`）
