# Workspace 模块结论

## Responsibility
- 管理用户级与主体级（meta / avatar / group）**文件系统工作区**：路径解析、首次 bootstrap、Markdown 人格/记忆文件读写、收藏夹 JSON、结构化 `MEMORY.md` 条目 CRUD。
- 为 Meta-Agent 系统提示、Studio API、运行时 memory 工具与记忆召回提供统一的磁盘上下文来源（默认 `~/.agenticx/workspace`，群聊 `~/.agenticx/groups/<id>/workspace`，分身可配独立目录）。
- Explicit non-responsibilities: 不负责向量索引实现（委托 `WorkspaceMemoryStore`）、会话消息持久化、avatar 注册表业务或群聊路由；仅触发可选的 workspace 索引 hook。

## Entry points and public interfaces
- 包级导出（`agenticx/workspace/__init__.py`）：`ensure_workspace`、`load_workspace_context`。
- `agenticx.workspace.loader` 主要 API：
  - 路径：`resolve_workspace_dir`、`resolve_default_session_workspace_dir`、`resolve_subject_workspace_dir`、`ensure_group_workspace`。
  - Bootstrap / 读取：`ensure_workspace`、`load_workspace_file` / `load_workspace_file_from_dir`、`load_workspace_context`、`load_subject_workspace_context`。
  - 记忆写入：`append_daily_memory`、`append_long_term_memory`、`append_user_global_preference`；`read_memory_entries`、`update_memory_entry`、`delete_memory_entry`、`delete_memory_entries_batch`。
  - 收藏：`load_favorites`、`upsert_favorite`、`delete_favorite`、`update_favorite_tags`、`remove_favorite_memory_note`。
- 允许读取的 Markdown 文件名白名单：`ALLOWED_WORKSPACE_FILES = {IDENTITY.md, USER.md, SOUL.md, MEMORY.md}`。

## Core execution path
- **首次启动 / CLI**：`ensure_workspace` → `resolve_workspace_dir`（读 `ConfigManager.load().workspace_dir`，空则 `~/.agenticx/workspace`）→ 创建 `memory/`、`~/.agenticx/skills/`、默认四文件模板与当日 `memory/YYYY-MM-DD.md` → 可选从 `~/.cursor/mcp.json` 导入 `~/.agenticx/mcp.json` → 可选 `WorkspaceMemoryStore.index_workspace_sync`。
- **按主体注入提示**：`load_subject_workspace_context` → `classify_subject(avatar_id)` → meta 用全局 workspace；group 调 `ensure_group_workspace`；avatar 读 `AvatarRegistry` 或 `~/.agenticx/avatars/<id>/workspace` → 合并 `USER.md`（全局）与主体侧 `IDENTITY/SOUL/MEMORY/daily`。
- **Studio / 工具写记忆**：`append_long_term_memory` 经 `_sanitize_memory_note` 过滤噪声 → 追加或按 `## section` 插入列表项；API 层通过 `read/update/delete_memory_entry*` 做结构化编辑。

## Important classes and functions
- 模板常量：`IDENTITY_TEMPLATE`、`USER_TEMPLATE`、`SOUL_TEMPLATE`、`MEMORY_TEMPLATE`、`GROUP_*_TEMPLATE`、`DAILY_MEMORY_TEMPLATE`。
- `_sanitize_memory_note`：长度上限、噪声正则（含 `<think>`、文件列表等）过滤。
- `_locate_entry_block` / `read_memory_entries`：按 `## section` 与顶层 bullet 索引解析/定位 MEMORY 条目（支持 nested children）。
- `resolve_subject_workspace_dir`：与 `agenticx.memory.graph.group_id.classify_subject` / `parse_group_id_from_avatar` 及 `AvatarRegistry` 协作。

## Data and configuration
- 全局 workspace：`config.yaml` 的 `workspace_dir`（经 `ConfigManager`）；环境变量 `AGX_WORKSPACE_ROOT` 覆盖 session 默认根（在 avatar 未指定时）。
- 磁盘布局：`IDENTITY.md`、`USER.md`、`SOUL.md`、`MEMORY.md`；`memory/<date>.md`；`favorites.json`；群 workspace 位于 `~/.agenticx/groups/<group_id>/workspace`。
- MCP：`ensure_workspace` 可 seed `~/.agenticx/mcp.json`（空 `{}` 或从 Cursor 导入）。

## Dependencies
- Upstream: `agenticx.cli.config_manager.ConfigManager`；`agenticx.memory.graph.group_id`；`agenticx.avatar.registry.AvatarRegistry`（lazy）；`agenticx.cli.studio_mcp.import_mcp_config`（bootstrap 时）；`agenticx.memory.workspace_memory.WorkspaceMemoryStore`（可选索引）。
- Downstream: `agenticx/studio/server.py`（workspace API、favorites、memory CRUD）；`agenticx/runtime/prompts/meta_agent.py`（`load_subject_workspace_context`）；`agenticx/runtime/meta_tools.py`、`agenticx/cli/agent_tools.py`（memory 工具）；`agenticx/memory/recall.py`、`agenticx/memory/graph/forget.py`；`agenticx/avatar/group_chat.py`（群 workspace bootstrap）；`agenticx/cli/studio.py`。

## Tests and operations
- `tests/test_workspace_memory_entries.py`：结构化 MEMORY 读/改/删/批量删。
- `tests/test_workspace_favorites_loader.py`：收藏去重与 CRUD。
- `tests/test_smoke_memory_subject_resolve.py`、`test_smoke_subject_prompt_injection.py`、`test_default_session_workspace.py` 等：主体路径解析与注入。
- `tests/test_smoke_memory_append_routing.py`、`test_smoke_memory_forget.py`：append 路由与 forget 联动。
- 运维：工作区为 Markdown + JSON 明文；多主体隔离依赖 `avatar_id` / `group_id` 目录约定，迁移时需保持路径与 registry 一致。

## Unverified or ambiguous
- `load_workspace_context` 与 `load_subject_workspace_context` 返回字段集合不同（后者含 `global_user`、`subject_label` 等）；调用方须按场景选用，模块内未统一 facade。
