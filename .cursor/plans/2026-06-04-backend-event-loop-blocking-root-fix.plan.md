---
name: Root-fix backend event-loop blocking (settings/hooks/usage/memory-graph all hang)
overview: 从根上消除本机 agx serve 单事件循环被同步 SQLite 写入、同步扫盘与记忆图谱 Kuzu 调用阻塞，导致「钩子/Token 看板/记忆图谱状态」等设置类请求集体卡在「加载中…」的问题。
todos:
  - id: t1-audit-persist
    content: 审计并卸载所有事件循环上的同步 manager.persist() 调用点
    status: completed
  - id: t2-persist-async-helper
    content: SessionManager 增加 persist_async（to_thread 封装），异步路径统一改 await
    status: completed
  - id: t3-hooks-offload
    content: /api/hooks 的磁盘扫描 + YAML 解析卸载到 asyncio.to_thread
    status: completed
  - id: t4-memory-graph-kuzu-probe
    content: 确认 Graphiti add_episode/get_overview 是否在事件循环上同步调用 Kuzu，必要时 to_thread 隔离
    status: completed
  - id: t5-status-poll-light
    content: memory graph status 轮询路径降负载（避免每 2s 同步读 YAML/JSON 叠加阻塞）
    status: completed
  - id: t6-verify
    content: 构建记忆图谱进行中，并发探测设置类接口均 <1s 返回
    status: completed
isProject: false
---

# 后端事件循环阻塞根因修复

**Plan-Id**: 2026-06-04-backend-event-loop-blocking-root-fix
**Plan-File**: `.cursor/plans/2026-06-04-backend-event-loop-blocking-root-fix.plan.md`
**Owner**: Damon
**Made-with**: Damon Li

## 背景 / 证据

用户现象：记忆图谱在「关联写入 78%」长时间构建期间，**钩子 Tab 卡在「正在加载钩子配置…」、Token 看板停在「加载中…」显示 0、记忆图谱状态也转圈**。

本机探测（运行中的 `agx serve`，端口取自 `~/.agenticx/serve.port`）：
- `/api/memory/graph/status`、`/api/hooks`、`/api/usage/meta` **5s 内均无响应（超时）**。
- `~/.agenticx/memory/graph_ingest.json` 最近一次 `last_error = "Request timed out."`。
- `~/.agenticx/memory/sessions.sqlite` ≈ **270MB**。

根因：Near Desktop 的设置/钩子/Token/记忆图谱共用**同一个本机 `agx serve`（单进程、单 asyncio 事件循环）**。当事件循环被某个同步重任务占住时，所有并发 REST 请求一起超时。已定位的阻塞源：

1. **同步 `manager.persist()` 仍散落在多个 async 路由 / SSE `finally`**。`persist` → `_persist_session_state` 会做 `session_summaries` upsert + `_index_session_messages_sync`（对 270MB 库做 FTS 重建）+ 多个快照写盘，全部同步。
   - 已修复（保持不动）：`_finalize_chat_runtime`（行 ~343 已 `await asyncio.to_thread(manager.persist, ...)`）；`/api/usage/*` 已 `to_thread`。
   - 仍同步（本 plan 处理）：`agenticx/studio/server.py` 约 1830 / 1990 / 2041 / 2370 / 2885 / 2910 / 3148 / 4872 / 4979 等；`agenticx/studio/supervisor.py` 185 / 279；`agenticx/studio/voice_endpoints.py` 682。
2. **`/api/hooks` 在事件循环上同步扫盘**：`discover_declarative_hooks` / `build_hook_search_paths` / bundled 目录遍历 + `yaml.safe_load` 遍历 `~/.cursor/plugins`、`~/.claude/plugins` 等，无 `to_thread`。这是「正在加载钩子配置…」直接卡住的原因。
3. **记忆图谱 Kuzu 调用可能阻塞事件循环**（需确认）：`MemoryGraphStore._bootstrap_graphiti_sync` 已 `run_in_executor`，但 `add_episode` / `get_overview` / `retrieve_episodes` / `get_nodes_and_edges_by_episode` 内部对 Kuzu（C 扩展）的查询若是同步调用，会在 ingest worker 协程里阻塞事件循环（而非仅占网络 I/O）。
4. **status 轮询叠加**：前端每 2s 调 `/api/memory/graph/status`，该端点 `refresh_config()`（读 YAML）+ `_status.read()`（读 JSON）+ `resolve_effective_models` 均在事件循环上同步执行；构建期叠加放大阻塞。

## 需求

- FR-1: 任何对话/会话写操作的持久化都不得在事件循环上同步执行。
- FR-2: `/api/hooks` 的磁盘扫描与 YAML 解析不得在事件循环上同步执行。
- FR-3: 记忆图谱 ingest（含 Kuzu 查询）不得阻塞事件循环；若上游为同步调用须隔离到线程池。
- FR-4: 记忆图谱 status 轮询路径在构建进行中仍保持轻量（同步文件读卸载或缓存）。
- NFR-1: 不改变记忆图谱开关语义、不改 ingest 业务逻辑、不动已修复的 `_finalize_chat_runtime` / `/api/usage/*`。
- AC-1: 记忆图谱构建进行中（pending/active），并发请求 `/api/hooks`、`/api/usage/meta`、`/api/memory/graph/status`、`/api/session` 均在 **1s 内**返回。
- AC-2: 连续多轮对话 + 记忆图谱开启时，设置面板各 Tab 不再出现长时间「加载中…」。
- AC-3: 现有 `tests/test_smoke_memory_graph_graphiti.py`、`tests/test_smoke_openharness_features.py`（hooks）保持绿。

## 改动范围（严格）

1. `agenticx/studio/session_manager.py`
   - 新增 `async def persist_async(session_id)`：内部 `await asyncio.to_thread(self.persist, session_id)`。同步 `persist` 保留供 sync 调用点（如纯同步函数、后台线程）使用。

2. `agenticx/studio/server.py`
   - 逐一审计所有 `manager.persist(...)` 调用点：处于 `async def` 路由体或 async SSE 生成器 `finally` 中的，改为 `await manager.persist_async(...)`。
   - 明确不动：行 ~343 `_finalize_chat_runtime`（已正确）。
   - `/api/hooks` (`list_hooks`)：把 bundled 遍历 + `discover_declarative_hooks` + `build_hook_search_paths` + YAML 解析整体抽成一个同步函数，路由内 `await asyncio.to_thread(...)` 调用，返回结构不变。

3. `agenticx/studio/supervisor.py` / `agenticx/studio/voice_endpoints.py`
   - 若调用点在 async 上下文：改 `await manager.persist_async(...)`；若在同步线程上下文：保留 `persist`（注明原因）。

4. `agenticx/memory/graph/store.py`（仅在 t4 确认阻塞后才动）
   - 若 Kuzu 查询为同步 C 调用：将 `add_episode` 后的 `get_overview`、`retrieve_episodes`+`get_nodes_and_edges_by_episode` 等同步段 `await asyncio.to_thread(...)` 隔离；不改 ingest 队列与进度语义。

5. `agenticx/memory/graph/routes.py`（t5）
   - `memory_graph_status`：将 `refresh_config()` / `_status.read()` / `resolve_effective_models` 的同步读卸载到 `to_thread`，或对 status 读做短 TTL（如 1s）内存缓存，降低 2s 轮询叠加。

不动：记忆图谱 enable/auto 开关、`config.yaml` schema、Desktop 前端轮询间隔（除非 t5 证明必须）、`sessions.sqlite` 既有索引（已存在 `idx_ss_session_created`）。

## 验证步骤

1. 重启后端（完全退出 Near / `pkill -f 'agx serve'` 后重开，避免多进程争 Kuzu 锁）。
2. 触发一轮对话使记忆图谱进入构建（`graph_ingest.json` 出现 `job_active` 或 `pending_jobs>0`）。
3. 构建进行中，用 Python urllib 并发探测 `/api/hooks`、`/api/usage/meta`、`/api/memory/graph/status`、`/api/session`，确认全部 <1s（对照 AC-1）。
4. 跑 `pytest tests/test_smoke_memory_graph_graphiti.py tests/test_smoke_openharness_features.py -q` 保持绿（AC-3）。

## 回滚

- 各改动均为「同步 → to_thread」语义等价封装，回滚即恢复同步调用；不涉及数据格式变更。
