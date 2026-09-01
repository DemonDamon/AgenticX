# AgenticX Studio 模块总结

> 结论更新时间：2026-09-01（覆盖基线 `f3ba65001c29` 之后的变更）

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
├── attachment_routing.py  # (NEW) 企业附件自动路由：文档附件锁定私有部署模型的运行时判定
├── document_pages.py      # (NEW) PDF 页图渲染（PyMuPDF），替代抽文本的有损通路
├── vision_autodescribe.py # (NEW) 纯文本模型下本轮图片的视觉兜底自动解读
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
- `get_or_create_team(llm_factory, event_emitter, summary_sink, confirm_gate_factory)`：懒创建 `AgentTeamManager`，复用时更新 factory 和 emitter；`confirm_gate_factory` 按 agent_id 分发确认门（无人值守轮次由 server 注入 `RiskAwareAutoConfirmGate`）

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
- `list_sessions(avatar_id)`：合并内存活跃会话 + 持久化历史，按 pinned-first + updated_at 排序；每行附带 `provider`、`model`、`execution_state`；avatar 过滤已下推到持久层——`_list_persisted_sessions(avatar_id)` 先按 SQLite 元数据过滤再读 `messages.json`，打开群聊/分身窗格不再全量扫盘
- `search_sessions_by_message_text(query)`：先走 SQLite FTS，失败时回退到 LIKE 扫描，返回 `session_id + snippet`
- `archive_sessions_before(session_id)`：将同一 Avatar 下早于指定会话的所有会话标记为 `archived`
- `cleanup_expired()`：TTL 过期的会话先 persist 再从内存移除
- **(NEW)** 历史分组按真实消息时间：`_resolve_list_activity_at()` 在存在消息活动（`message_based>0`）时直接返回消息时间戳，`touch_at` 仅作无消息时兜底；`add_taskspace`/`remove_taskspace` 不再批量改写同 scope 会话的 `updated_at`，修复「增删工作区文件夹后老会话被冲进 TODAY」的污染问题（commit `e32b6950`/`85dad862`）
- **(NEW)** `apply_session_workspace_dir()`：`group:` 会话的默认工作区落到 `ensure_group_workspace(group_id)` 的群共享目录，而非分身默认目录或 Meta 的每会话隔离目录
- **(NEW)** assistant 消息持久化清洗：`blocks` 字段经 `_sanitize_content_blocks()` 白名单过滤（剔除 data URL 与非绝对路径的图片块）；完成判定把 `interrupted-partial` 与 `llm-init-failed` 归为非答复行（`_NON_REPLY_ASSISTANT_SOURCES`），模型初始化失败的占位行不再被误判为「该轮已完成」

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

**/chat 回合前置钩子（NEW）**：客户端 provider/model 落到 session 之后、`ProviderResolver.resolve` 之前依次执行——

1. `attachment_routing.route_turn(session, filenames=...)`：企业下发的附件路由策略命中文档附件时，把会话锁定到私有部署多模态模型；应锁而应用失败时抛 `AttachmentRoutingUnavailable`，/chat 翻译为 HTTP 503 中止本轮（不回退公网模型）。
2. 锁定生效时 `document_pages.stage_pdf_pages()` 把本轮 PDF 渲染成页图挂到 `PENDING_VISUAL_ATTACHMENTS_KEY`，替代抽文本通路。
3. `reasoning_effort`（Kimi K3 / DeepSeek V4）与 `thinking_enabled`（DeepSeek V4）按轮写入 session 私有属性，缺省时清除，避免上一轮的值串到其他模型。

**确认门与无人值守（NEW）**：`_resolve_confirm_gate(managed, agent_id, unattended=...)` —— `unattended_run=True`（supervisor/auto-nudge 续跑、`automation:*` 会话）时使用 `RiskAwareAutoConfirmGate(unattended=True)`（低风险放行、受保护操作 fail-closed）；全局自动确认改由 `is_global_auto_confirm_mode(run_mode, confirm_strategy, permissions_mode)` 判定（显式 `run_mode`/`confirm_strategy` 优先，legacy `permissions.mode` 兜底），开启时包装为 `RiskAwareAutoConfirmGate(delegate=managed_gate)`。LLM 解析前经 `effective_session_llm_names()` 回填空的 session provider/model；fallback 候选加入 `deepseek`，并跳过设置里已禁用的 provider（`provider_raw_enabled_for_fallback`）。

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
| `/api/graph/runs`、`/api/graph/runs/<rid>`、`/api/graph/runs/<rid>/intervene` | GET/POST | **(NEW)** WorkGraph 运行列表 / GraphRun 快照 + agent projection（God-View UI）/ I1–I6 图干预（乐观版本锁，指令写回所属 session 的 scratchpad） |
| `/api/sessions/<sid>/loop-review` | GET | **(NEW)** 单会话工作流健康巡检：优先读 `sessions/<sid>/loop_review.json` 缓存，`refresh=1` 时经 `learning.loop_review.review_session` 重算 |
| `/api/vision/fallback` | GET | **(NEW)** 查询视觉兜底模型配置（`llms.vision_fallback.resolve_vision_fallback`） |

#### SSE 流式协议

`/chat` 端点返回 `text/event-stream`，每条 SSE 数据为 JSON：
```
data: {"type": "token", "data": {"text": "..."}, "agent_id": "meta"}
data: {"type": "tool_call", "data": {"name": "bash_exec", "arguments": {...}}, "agent_id": "meta"}
data: {"type": "subagent_started", "data": {"agent_id": "sa-xxx", ...}, "agent_id": "sa-xxx"}
data: {"type": "final", "data": {"text": "..."}, "agent_id": "meta"}
```

所有 `RuntimeEvent.type` 均直接透传，Desktop 前端按 `agent_id` 路由到对应分身窗格。

群聊分支（`group_id` 非空）在 `live_reattach_enabled()` 开启时同样改走 `SessionEventHub`：runtime 在后台 task 生产事件、SSE 生成器订阅 hub 消费，客户端断开后 runtime 继续跑、重连可回放；群聊澄清经 `_persist_clarification_prompt(..., agent_id, avatar_name)` 按分身归属持久化，`group_reply`/`group_skipped`/`group_clarification` 事件触发 `incremental_persist`；`should_stop` 改接 `manager.should_interrupt()`，并支持 `image_inputs`/`history_image_attachments` 透传给 `router.run_group_turn()`。

**Server 端 MCP 辅助函数**（`server.py` 顶部）：

- `_get_mcp_server_ops(studio_session)` / `_set_mcp_server_op(...)`：维护每个 session 下 `{server_name -> {phase, message, error, updated_at}}` 的状态字典；`connect_mcp_server`/`disconnect_mcp_server` 在每一步（preparing → connecting → healthy / failed / disconnecting → idle）写入，供 `GET /api/mcp/servers` 回显
- `_get_mcp_connect_tasks(studio_session)` / `_get_mcp_connect_cancelled(studio_session)`：保存在途 `asyncio.create_task(mcp_connect_async)` 与用户取消标记；`disconnect_mcp_server` 检测到任务未完成时会 `task.cancel()` 实现"连接中即时取消"
- `_validate_json_mcp_payload(payload)`：用 `Draft202012Validator` 校验 `agenticx/cli/mcp_schema.json`，失败时返回结构化错误（`$.path: message`），PUT `/api/mcp/raw` 返回 400 含行列号
- `_normalize_mcp_path_for_edit(path_text)`：白名单校验编辑路径必须位于 `~/.agenticx/mcp.json` 或 `mcp.extra_search_paths` 中
- `_marketplace_cache_get/set`：MCP 市场响应的内存 TTL 缓存（默认 300s）

**Avatar Session 分支逻辑**（`is_avatar_session`）：

当 `/chat` 识别到当前 session 绑定了非群聊 Avatar 时：
- 系统提示改用 `_build_avatar_direct_prompt()` 构建分身专属 prompt（含身份、角色、规则、workspace 路径），而非 Meta-Agent 的 `build_meta_agent_system_prompt()`
- 工具集从 `visible_meta_agent_tools()` 中过滤掉 `delegate_to_avatar`（该工具仅 Meta-Agent 可用）
- session 对象上挂载 `_session_manager` 引用，供 `delegate_to_avatar` 等工具查找/创建 avatar session

---

### protocols.py

定义 Studio 协议常量和请求/响应类型，供 server.py 和 Desktop IPC 共用。`ChatRequest` 新增字段：`unattended_run`（无人值守回合：低风险操作可继续、受保护确认 fail-closed）、`reasoning_effort`（Kimi K3 `low/high/max`；DeepSeek V4 thinking `high/max`）、`thinking_enabled`（DeepSeek V4 思考开关，`None` 表示不改动 session 现状）。

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

### 附件自动路由 — attachment_routing.py + document_pages.py + vision_autodescribe.py（NEW）

企业「文档内容不出私有部署」链路的运行时侧。策略唯一出处在企业后台，经 `/api/desktop/bootstrap` 下发到全局配置 `enterprise.attachment_routing`，这里只负责执行：

- **attachment_routing.py**：`read_policy()` 只读全局配置（刻意不走 `ConfigManager.get_value()`，防项目级配置覆盖企业策略）；默认关，取不到目标模型或扩展名清单时整条关闭。`route_turn()` 在解析 LLM **之前**按附件扩展名判定，命中文档即把会话锁到 `document_target` 私有多模态模型（sticky：锁定后本会话不再解锁，目标跟随最新下发）；企业托管会话经 `address_for_session()` 翻译成 `(enterprise, <provider>/<model>)` 寻址。应锁而应用失败抛 `AttachmentRoutingUnavailable`（containment 失败，调用方必须中止本轮）；读不到策略视为未配置放行。
- **document_pages.py**：锁定多模态模型后用 PyMuPDF（`fitz`，已随产品发货）把 PDF 渲染成页图——默认 20 页上限、长边 1600px、单页 PNG 超 1.5MB 降档重渲；页图经 `PENDING_VISUAL_ATTACHMENTS_KEY` 挂入下一轮请求（与 `view_image` 同一通路），`context_files` 正文改写为 `[已作为页图提供]` 前缀防止 hydrate 再抽一遍文本；截断时提示模型调 `document_read_pages(path, start_page)` 续读。渲染不可用（缺 PyMuPDF/加密/损坏）时回落抽文本——此时会话已锁私有模型，文本同样不出部署。
- **vision_autodescribe.py**：当前模型无视觉能力且本轮带新图时，用视觉兜底模型（`llms.vision_fallback.resolve_vision_fallback`，私有部署小模型）并发解读最多 4 张，把描述文本注入回合——替代原来「提示模型自己调 analyze_image」的不保证路径；失败退回原提示，不挡整轮。由 `agent_runtime` 在回合内调用。
- 配合改动：`chat_attachments._needs_document_extraction()` 让 PDF/Office 附件保留占位符交给文档抽取器（未压缩 PDF 可按 utf-8 解码，直接当文本读会把 `%PDF-1.4` 源码灌进上下文）；`chat_attachments` 的 sessions 根目录改为 `agx_home()` 惰性解析（`_sessions_root()` + PEP 562 `__getattr__`，测试重定向 HOME 可生效）；`context_file_keys.disk_path_from_context_file_key()` 从 context_files key（剥离 el-snippet / 行区间后缀后）尽力还原绝对磁盘路径，虚拟 key（`skill:`/`@dir:`/上传去重 key）返回 `None`。

### 上下文占用估算重写 — context_usage.py

`estimate_session_context_usage()` 改为可缓存的只读估算：skill 摘要 45s TTL 进程内缓存；占用结果按 fingerprint（消息数/末条摘要/分身/taskspaces/MCP 工具数/群成员/KB 模式）缓存（上限 48 条）。分类仍走 `meta_agent` 的 block 构建函数，但 system_prompt 格改为静态职责字数（`_STATIC_DUTY_CHARS=18000`）+ 各 block 实测之和，不再每次拼完整系统提示；tools 格按 ToolSearch 投影（`project_tools_for_round`）计价而非全池；messages 格改从压缩后的 `agent_messages`（而非 UI 全量 `chat_history`）估算，并剔除持久化的 data URL。`resolve_usage_window()` 让窗格选中模型优先于空 session model 决定上下文窗口。新增 `load_session_cache_payload()` 从 `runtime.usage_store` 读 per-session 缓存命中统计；`/api/session/context_usage` 增加 `model` query 参数，估算与账本读取经 `asyncio.to_thread` 离事件循环执行，响应附带 `cache` 字段。

### 中断失败提示 — turn_interruption.py

`_last_failure_summary()` 保留 `模型调用失败 (provider/model):` 前缀（卡片可见是哪个模型失败），新增剥离 `litellm.UnsupportedParamsError:`，摘要上限从 120 放宽到 160 字符。

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
