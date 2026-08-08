# AgenticX Studio 模块总结

> 结论更新时间：2026-05-29（覆盖 2026-04-22 之后的变更）

## 目录路径

`agenticx/studio/`

## 模块概述

Studio 模块是 AgenticX Desktop 的后端服务层，提供基于 FastAPI 的 SSE 流式 API，支持多会话管理、子智能体编排、Avatar/Session/Group CRUD，以及 Taskspace 文件系统操作。它是 Desktop Electron 前端与 Runtime 引擎的桥接层。

---

## 目录结构

```
agenticx/studio/
├── __init__.py            # 包入口
├── protocols.py           # 协议常量与类型定义
├── server.py              # FastAPI Studio Server（主路由集合）
├── session_manager.py     # SessionManager + ManagedSession 会话生命周期管理
├── continuation.py        # (NEW) 无人值守续跑的提示构建与去重/轮次记账
├── supervisor.py          # (NEW) 后台 SessionSupervisor：停滞轮询 + 自动续跑
├── session_event_hub.py   # (NEW) 单会话 SSE 事件 pub-sub + 环形缓冲，支撑「断流重连」
├── references.py          # (NEW) web_search/knowledge_search 引用编号与来源卡片 payload
├── voice_endpoints.py     # (NEW) 语音焦点模式：设置 / 实时桥 / PTT 流式转写 / 工具桥
├── doubao_sauc_asr.py     # (NEW) 火山 bigmodel 流式 ASR（sauc）二进制协议帧编解码
├── code_index/            # (NEW) 代码索引 HTTP 路由（config/status，serve 期模型预载）
├── web_search/            # (NEW) 内置 Web 搜索子包（contracts/providers/service/routes）
└── kb/                    # 本地知识库（manager/runtime/routes）
```

---

## 核心组件分析

### SessionManager（session_manager.py）

**功能**：内存 + 文件双层会话管理，支持创建、获取、持久化、删除、克隆、归档等完整生命周期。

#### ManagedSession

会话运行时单元，包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| `session_id` | str | 唯一标识（UUID） |
| `studio_session` | StudioSession | CLI 层 session 对象（含消息、artifacts 等） |
| `confirm_gate` | AsyncConfirmGate | Meta-Agent 确认门 |
| `sub_confirm_gates` | Dict[str, AsyncConfirmGate] | 每个子智能体的独立确认门 |
| `team_manager` | AgentTeamManager | 子智能体团队管理器（懒创建） |
| `avatar_id` / `avatar_name` | str | 关联的 Avatar |
| `session_name` | str | 会话显示名称（支持自动从首条消息截取 30 字） |
| `pinned` / `archived` | bool | 置顶/归档状态 |
| `taskspaces` | list[dict] | 绑定的 Taskspace 列表（最多 5 个） |

**关键方法**：
- `get_confirm_gate(agent_id)`：按 agent_id 分发确认门，`"meta"` 返回主确认门
- `get_or_create_team(llm_factory, event_emitter, summary_sink)`：懒创建 `AgentTeamManager`，复用时更新 factory 和 emitter

#### SessionManager 核心操作

**持久化体系**：

| 持久化内容 | 文件路径 | 说明 |
|------------|----------|------|
| Chat 消息快照 | `~/.agenticx/sessions/<sid>/messages.json` | 全量 chat_history |
| Agent 消息快照 | `~/.agenticx/sessions/<sid>/agent_messages.json` | 最近 40 条，含工具调用序列 |
| Context file 引用 | `~/.agenticx/sessions/<sid>/context_files_refs.json` | 文件路径列表（重载时重读文件内容） |
| Todo / Scratchpad | SessionStore（SQLite） | 通过 `SessionStore._save_*_sync()` 持久化 |
| 元数据 | SessionStore summary | provider、model、session_name、avatar_id、pinned、archived、taskspaces |

**恢复流程**（`_restore_persisted_state`）：
1. 从 SessionStore 加载 todos、scratchpad
2. 加载 chat 消息快照（messages.json）
3. 加载 agent_messages 快照，并通过 `_sanitize_context_messages()` 清洗
4. 加载 context_files_refs，重读磁盘文件内容

**会话操作汇总**：
- `create(provider, model, session_id)`：创建 + 恢复持久化状态 + 初始化默认 Taskspace
- `get(session_id, touch)`：内存找不到时自动从持久化恢复
- `persist(session_id)`：主动写入持久化
- `delete(session_id)`：内存 + DB + 文件系统三层删除，关闭 TeamManager
- `fork_session(session_id)`：深拷贝 chat_history / agent_messages / context_files / scratchpad / artifacts
- `archive_sessions_before(session_id)`：将同一 Avatar 下早于指定会话的所有会话标记为 archived
- `rename_session` / `pin_session` / `auto_title_session`：元数据更新 + 持久化
- `set_session_model(session_id, provider, model)`：由 Desktop 模型选择器触发，落盘当前 session 的 `provider_name`/`model_name`，使冷启动后能够回显"上次用的模型"
- `list_sessions(avatar_id)`：合并内存活跃会话 + 持久化历史，按 pinned-first + updated_at 排序；每行附带 `provider`、`model`、`execution_state`
- `search_sessions_by_message_text(query)`：先走 SQLite FTS，失败时回退到 LIKE 扫描，返回 `session_id + snippet`
- `archive_sessions_before(session_id)`：将同一 Avatar 下早于指定会话的所有会话标记为 `archived`
- `cleanup_expired()`：TTL 过期的会话先 persist 再从内存移除
- **(NEW)** 历史分组按真实消息时间：`_resolve_list_activity_at()` 在存在消息活动（`message_based>0`）时直接返回消息时间戳，`touch_at` 仅作无消息时兜底；`add_taskspace`/`remove_taskspace` 不再批量改写同 scope 会话的 `updated_at`，修复「增删工作区文件夹后老会话被冲进 TODAY」的污染问题（commit `e32b6950`/`85dad862`）

#### Taskspace 管理

每个会话最多关联 5 个 Taskspace，每个 Taskspace 为一个文件系统目录。

| 方法 | 说明 |
|------|------|
| `list_taskspaces(session_id)` | 返回 Taskspace 列表 |
| `add_taskspace(session_id, path, label)` | 添加 Taskspace，不指定 path 时默认 `~/.agenticx/taskspaces/<sid>/default` |
| `remove_taskspace(session_id, taskspace_id)` | 移除，移除后自动补充默认 Taskspace |
| `list_taskspace_files(session_id, taskspace_id, rel_path)` | 列出目录内容（文件名、类型、大小、修改时间） |
| `read_taskspace_file(session_id, taskspace_id, rel_path)` | 读取文件内容（max_bytes=512KB），路径越界时抛出 ValueError |

---

### Studio Server（server.py）

**技术栈**：FastAPI + Server-Sent Events（SSE）+ asyncio

**启动入口**：通过 `agenticx studio` CLI 命令启动，监听 `AGX_STUDIO_HOST`（默认 `127.0.0.1`）/ `AGX_STUDIO_PORT`（默认 `7899`）。

#### API 路由分组

**对话与执行**：

| 路由 | 方法 | 说明 |
|------|------|------|
| `/chat` | POST | SSE 流式对话，触发 AgentRuntime 执行 |
| `/stop` | POST | 中断当前对话 |
| `/confirm` | POST | 向确认门提交 approve/deny 决策 |
| `/sessions/<sid>/subagents/<aid>/status` | GET | 查询子智能体状态 |
| `/sessions/<sid>/subagents/<aid>/cancel` | POST | 取消子智能体 |
| `/sessions/<sid>/subagents/<aid>/retry` | POST | 重试子智能体 |
| `/sessions/<sid>/subagents/<aid>/confirm` | POST | 子智能体确认门 |
| `/api/sessions/<sid>/continue` | POST | **(NEW)** 统一续跑入口：`source` ∈ `desktop_manual`/`desktop_auto_nudge`/`supervisor`，running 时先 interrupt 再续；走 `continuation.prepare_continue()` |
| `/api/sessions/<sid>/stream` | GET | **(NEW)** 只读 SSE「断流重连」：从 `SessionEventHub` 回放环形缓冲并续接实时事件，`live_reattach_enabled()` 关闭时返回 disabled |

**会话管理**：

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/sessions` | GET | 列出会话（支持 avatar_id 过滤） |
| `/api/sessions` | POST | 创建新会话 |
| `/api/sessions/<sid>` | DELETE | 删除会话 |
| `/api/sessions/<sid>/rename` | POST | 重命名 |
| `/api/sessions/<sid>/pin` | POST | 置顶/取消置顶 |
| `/api/sessions/<sid>/fork` | POST | 克隆会话 |
| `/api/sessions/<sid>/model` | POST | 持久化该会话当前选中的 provider/model（Machi 模型记忆） |
| `/api/sessions/<sid>/messages` | GET | 获取历史消息 |
| `/api/sessions/<sid>/messages` | DELETE | 清空消息 |
| `/api/sessions/archive-before` | POST | 批量归档指定会话之前的历史 |

`list_sessions()` 返回字段在会话元数据之外还包含 `provider`、`model`、`execution_state`（`idle`/`running`/`interrupted`），供 Desktop 前端在冷启动后回显"上次用的模型"并恢复运行状态徽标。

**Taskspace**：

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/sessions/<sid>/taskspaces` | GET | 列出 Taskspaces |
| `/api/sessions/<sid>/taskspaces` | POST | 添加 Taskspace |
| `/api/sessions/<sid>/taskspaces/<tsid>` | DELETE | 删除 Taskspace |
| `/api/sessions/<sid>/taskspaces/<tsid>/files` | GET | 列出文件 |
| `/api/sessions/<sid>/taskspaces/<tsid>/files/read` | GET | 读取文件内容 |

**Avatar & Group**：

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/avatars` | GET/POST | 列出/创建 Avatar |
| `/api/avatars/<id>` | GET/PATCH/DELETE | 读取/更新/删除 Avatar |
| `/api/groups` | GET/POST | 列出/创建 GroupChat |
| `/api/groups/<id>` | GET/PATCH/DELETE | 读取/更新/删除 GroupChat |

**配置与 MCP**：

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/config` | GET/POST | 获取/更新全局配置 |
| `/api/providers` | GET | 列出支持的 LLM providers |
| `/api/mcp/servers` | GET | 列出会话作用域下的 MCP 服务器（含 `op_phase`/`op_message`/`tool_count`/`tool_names`/`connection_state`） |
| `/api/mcp/settings` | GET/PUT | 读写 `mcp.extra_search_paths` 与 `mcp.disabled_tools` |
| `/api/mcp/connect` | POST | 连接 MCP 服务器；连接过程中再次 POST `/disconnect` 可取消握手（`asyncio.CancelledError` 路径） |
| `/api/mcp/disconnect` | POST | 断开；若存在在途 connect 任务则取消握手并回落到 idle |
| `/api/mcp/import` | POST | 从外部 MCP 配置文件导入并合并到 `~/.agenticx/mcp.json` |
| `/api/mcp/discover` | GET | 扫描本机 Cursor/Claude/Codex/Zed 等 15+ 品牌 MCP 配置，返回 `BrandHit[]`（来自 `agenticx/cli/mcp_discovery.py`） |
| `/api/mcp/raw` | GET/PUT | 桌面 Monaco 编辑器直读/直写 MCP JSON，PUT 前端会经过 `Draft2020-12` JSON Schema 校验（`agenticx/cli/mcp_schema.json`），仅允许写入 `~/.agenticx/mcp.json` 与 `mcp.extra_search_paths` 白名单路径 |
| `/api/mcp/marketplace` | GET | ModelScope MCP 市场列表（支持 `category`/`search`/`page`/`is_hosted`/`is_verified`，5 分钟内存缓存） |
| `/api/mcp/marketplace/<id>` | GET | 市场条目详情（含 `server_config`） |
| `/api/mcp/marketplace/install` | POST | 将市场条目安装进本地 MCP 配置（env 覆盖 + 自动加入 `mcp.auto_connect`） |

所有 MCP 管理端点通过 `_check_mcp_admin_token` 校验 `X-Agx-Desktop-Token`，桌面端启动 Studio 时会注入该 token。每个 MCP 连接/断开/失败事件都会更新 `StudioSession.mcp_server_ops[name]` 的 `phase`（`preparing`/`connecting`/`healthy`/`failed`/`disconnecting`/`idle`）与 `message`，Desktop MCP 卡片据此显示细粒度进度。

**其他**：

| 路由 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/api/workspace/context` | GET | 获取 workspace 上下文（IDENTITY/USER/SOUL/MEMORY） |
| `/api/skills` | GET | 列出可用 Skills |
| `/api/usage/summary` | GET | **(NEW)** 按时间范围聚合 LLM token 用量（读 `runtime.usage_store`） |
| `/api/usage/breakdown` | GET | **(NEW)** token 用量按模型/会话维度拆分 |
| `/api/web-search/*` | GET/POST | **(NEW)** 内置 Web 搜索（`web_search/routes.py:register_web_search_routes`） |
| `/api/code-index/config`、`/api/code-index/status` | GET/POST | **(NEW)** 代码索引配置与状态（`code_index/routes.py`） |
| `/api/voice/transcribe`、`/ws/voice/*` | POST/WS | **(NEW)** 语音转写与实时桥（`voice_endpoints.py:register_voice_endpoints`） |

#### SSE 流式协议

`/chat` 端点返回 `text/event-stream`，每条 SSE 数据为 JSON：
```
data: {"type": "token", "data": {"text": "..."}, "agent_id": "meta"}
data: {"type": "tool_call", "data": {"name": "bash_exec", "arguments": {...}}, "agent_id": "meta"}
data: {"type": "subagent_started", "data": {"agent_id": "sa-xxx", ...}, "agent_id": "sa-xxx"}
data: {"type": "final", "data": {"text": "..."}, "agent_id": "meta"}
```

所有 `RuntimeEvent.type` 均直接透传，Desktop 前端按 `agent_id` 路由到对应分身窗格。

**Server 端 MCP 辅助函数**（`server.py` 顶部）：

- `_get_mcp_server_ops(studio_session)` / `_set_mcp_server_op(...)`：维护每个 session 下 `{server_name -> {phase, message, error, updated_at}}` 的状态字典；`connect_mcp_server`/`disconnect_mcp_server` 在每一步（preparing → connecting → healthy / failed / disconnecting → idle）写入，供 `GET /api/mcp/servers` 回显
- `_get_mcp_connect_tasks(studio_session)` / `_get_mcp_connect_cancelled(studio_session)`：保存在途 `asyncio.create_task(mcp_connect_async)` 与用户取消标记；`disconnect_mcp_server` 检测到任务未完成时会 `task.cancel()` 实现"连接中即时取消"
- `_validate_json_mcp_payload(payload)`：用 `Draft202012Validator` 校验 `agenticx/cli/mcp_schema.json`，失败时返回结构化错误（`$.path: message`），PUT `/api/mcp/raw` 返回 400 含行列号
- `_normalize_mcp_path_for_edit(path_text)`：白名单校验编辑路径必须位于 `~/.agenticx/mcp.json` 或 `mcp.extra_search_paths` 中
- `_marketplace_cache_get/set`：MCP 市场响应的内存 TTL 缓存（默认 300s）

**Avatar Session 分支逻辑**（`is_avatar_session`）：

当 `/chat` 识别到当前 session 绑定了非群聊 Avatar 时：
- 系统提示改用 `_build_avatar_direct_prompt()` 构建分身专属 prompt（含身份、角色、规则、workspace 路径），而非 Meta-Agent 的 `build_meta_agent_system_prompt()`
- 工具集从 `META_AGENT_TOOLS` 中过滤掉 `delegate_to_avatar`（该工具仅 Meta-Agent 可用）
- session 对象上挂载 `_session_manager` 引用，供 `delegate_to_avatar` 等工具查找/创建 avatar session

---

### protocols.py

定义 Studio 协议常量和请求/响应类型，供 server.py 和 Desktop IPC 共用。

---

### 无人值守续跑 — continuation.py + supervisor.py（NEW）

支撑「任务停滞 / 轮次耗尽 / 中断后自动续跑」链路（Plan：`2026-05-29-stall-resume-and-action-button-fix`）：

- **continuation.py**：定义 `ContinuationReason`（`stall`/`interrupted`/`exhausted`/`rate_limit`/`manual`）与 `ContinuationSource`（`desktop_manual`/`desktop_auto_nudge`/`supervisor`）；`prepare_continue()` 构建续跑提示并做去重（`DEDUP_WINDOW_SEC=60s`，写 scratchpad `__continuation_last__`/`__continuation_round__`）；`format_continuation_notice()` 生成中文提示（停滞/中断/轮次耗尽…）。`desktop_manual` 续跑跳过 dedupe。
- **supervisor.py**：后台 `SessionSupervisor`，`POLL_INTERVAL_SEC=30s` 轮询会话停滞状态（复用 `runtime/stall_policy.py` 的 `evaluate_stall_for_continuation` 与 todo 完成判定），对开启 `unattended_enabled` 的会话自动触发续跑；运行日志落 `~/.agenticx/logs/supervisor/`。`maybe_start_supervisor(app, manager, _internal_continue)` 在 server 启动时挂起。

### 断流重连事件总线 — session_event_hub.py（NEW）

`SessionEventHub`：单会话级别的内存 pub-sub + 环形缓冲（`buffer_maxlen=400`，`MAX_SUBSCRIBERS=8`），为每条 `RuntimeEvent` 分配单调 `seq`。当 Desktop 切走再切回、或网络抖动导致 SSE 断开时，`/api/sessions/<sid>/stream` 可从缓冲回放未消费事件（SSE `id:` 携带 seq）并续接实时流，避免「切回后输出丢失」。由 `live_reattach_enabled()` 配置开关；run loop 结束以 `BufferedEvent(event=None)` 标记收尾。

### 搜索引用 — references.py（NEW）

为 `web_search` / `knowledge_search` 工具结果生成结构化引用：`reset_turn_references()` 每轮清零计数，`_assign_reference_ids()` 跨 web/kb 共享递增编号，`extract_domain()` / `snippet_trim()` 产出来源卡片字段。配合 SSE `structured.references` 透出与 `messages.json` 持久化，Desktop 渲染 ReferencesCard 与正文 `[N]` 角标。

### 语音链路 — voice_endpoints.py + doubao_sauc_asr.py（NEW）

- **doubao_sauc_asr.py**：火山 bigmodel 流式 ASR（`volc.bigasr.sauc.duration`，`wss://openspeech.bytedance.com/api/v3/sauc/bigmodel`）的二进制线协议帧编解码（gzip + struct header），供 PTT 流式转写复用。
- **voice_endpoints.py**：注册语音焦点模式端点——设置读写、OpenAI Realtime / 豆包端到端实时对话桥、`/ws/voice/stream-transcribe` PTT 流式识别、`/api/voice/transcribe` 录音转写，以及把语音轮次桥接到 `STUDIO_TOOLS` 工具调用的代理。

### 内置 Web 搜索 — web_search/（NEW）

子包 `contracts.py`（`WebSearchRuntimeConfig` / `WebSearchResult` / 结果上限 `WEB_SEARCH_MAX_RESULTS_CAP`）、`providers.py`（API provider + DuckDuckGo Lite 回退）、`service.py`（`WebSearchService.from_config()` 路由与格式化）、`routes.py`（`register_web_search_routes`）。对话侧 `web_search` 工具经 `agent_tools.py` 调用本服务。

### 代码索引路由 — code_index/（NEW）

`code_index/routes.py:register_code_index_routes` 暴露 `/api/code-index/config`（含 `enabled`/`backend`/`preload_model`/`max_index_memory_mb`）与状态查询，供 Desktop 设置面板与 serve 期模型预载使用。

---

## Workspace 模块（agenticx/workspace/loader.py）

**功能**：初始化并加载 Meta-Agent 的 workspace 上下文文件。

**默认 workspace**：`~/.agenticx/workspace/`，可通过配置 `workspace_dir` 覆盖。

**初始化文件**（`ensure_workspace()`）：

| 文件 | 用途 |
|------|------|
| `IDENTITY.md` | Meta-Agent 身份（name / role / vibe） |
| `USER.md` | 用户信息（name / timezone / preferences） |
| `SOUL.md` | 行为原则与边界 |
| `MEMORY.md` | 长期记忆锚点 |
| `memory/<today>.md` | 当日 daily memory |

**附加初始化**：
- 创建 `~/.agenticx/skills/` 目录
- 若 `~/.agenticx/mcp.json` 不存在，自动从 `~/.cursor/mcp.json` 导入，否则写入空配置
- 若 `index_memory=True`，调用 `WorkspaceMemoryStore.index_workspace_sync(workspace_dir)` 索引记忆

**加载接口**：
- `load_workspace_context()`：返回 `{identity, user, soul, memory, daily_memory, workspace_dir}` 字典
- `load_workspace_file(name)`：安全读取单个允许文件（ALLOWED_WORKSPACE_FILES 白名单 + 路径遍历防护）
- `append_daily_memory(workspace_dir, note)` / `append_long_term_memory(workspace_dir, note)`：运行时写入记忆

---

## 架构关系

```
Desktop (Electron) ←IPC→ Studio Server (FastAPI)
                              ↓ SSE /chat
                         SessionManager
                              ↓
                         AgentRuntime (meta)
                              ├─ HookRegistry → MemoryHook
                              ├─ ContextCompactor
                              ├─ AgentTeamManager
                              │    └─ AgentRuntime (subagent sa-xxx)
                              └─ dispatch_tool_async / meta_tools
                         SessionManager.persist()
                              └─ ~/.agenticx/sessions/<sid>/
                                   ├─ messages.json
                                   ├─ agent_messages.json
                                   └─ context_files_refs.json
```
