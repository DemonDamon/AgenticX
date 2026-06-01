---
name: Fix event-loop blocking persist (chat/usage/memory-graph all timeout)
overview: 修复每轮对话结束时在 asyncio 事件循环上同步执行大 SQLite 写入/读取导致后端整体卡死（聊天发不出、Token 看板与记忆图谱一直加载）的线上事故。
todos:
  - id: t1-finalize-offload
    content: "_finalize_chat_runtime 改为 async，将 manager.persist 卸载到线程池"
    status: pending
  - id: t2-summary-index
    content: "session_summaries 增加 (session_id, created_at) 索引，消除排序全表扫描"
    status: pending
  - id: t3-usage-offload
    content: "/api/usage/* 同步 SQLite 查询卸载到线程池"
    status: pending
  - id: t4-verify
    content: "重启后端验证 /api/session、/api/usage/meta、/api/memory/graph/status 秒回"
    status: pending
isProject: false
---

# 事件循环阻塞型 persist 修复

**Plan-Id**: 2026-06-01-event-loop-blocking-persist-fix
**Plan-File**: `.cursor/plans/2026-06-01-event-loop-blocking-persist-fix.plan.md`
**Owner**: Damon
**Made-with**: Damon Li

## 背景 / 证据

用户反馈：发「你好」发不出去、Token 消耗看板一直「加载中」、记忆图谱全为 0，怀疑被记忆图谱搞崩。

对运行中的 `agx serve`（PID 抽样）采样：2279/2424 采样停在
`com.apple.main-thread → _asyncio task_step → pysqlite_connection_execute →
sqlite3_step → sqlite3BtreeNext / readDbPage / vdbeSorterSort`，即**事件循环主线程在同步执行一个大表扫描+排序的 SQLite 查询**。`~/.agenticx/memory/sessions.sqlite` 约 119MB。

链路：每轮对话结束 `_finalize_chat_runtime`（`agenticx/studio/server.py` 的 async SSE 生成器 `finally` 中，行 2542 / 2639）**同步**调用 `manager.persist()` → `SessionManager._persist_session_state` → `_save_session_summary_sync` / `_index_session_messages_sync`，跑在事件循环上，阻塞期间所有并发请求（`/api/chat`、`/api/usage/*`、`/api/memory/graph/*`）全部超时。

记忆图谱开启 + auto-ingest 是放大器（吃 CPU/网络），但**主阻塞是 persist 在事件循环上同步执行**。

## 需求

- FR-1: 对话结束的持久化不得阻塞事件循环。
- FR-2: `session_summaries` 的「取某会话最新元数据」查询不得全表扫描+排序。
- FR-3: Token 看板 `/api/usage/*` 查询不得在事件循环上同步执行。
- AC-1: 后端重启后，`/api/session`、`/api/usage/meta`、`/api/memory/graph/status` 在 1s 内返回。
- AC-2: 连续多轮对话期间，看板与记忆图谱面板仍可正常加载。

## 改动范围（严格）

1. `agenticx/studio/server.py`
   - `_finalize_chat_runtime` 改 async；`manager.persist(session_id)` 用 `await asyncio.to_thread(...)`。
   - 两处调用点（2542 / 2639）改为 `await`。
   - `/api/usage/*` 6 个端点的 `*_sync` 调用改 `await asyncio.to_thread(...)`。
2. `agenticx/memory/session_store.py`
   - `_ensure_schema` 增加 `CREATE INDEX IF NOT EXISTS idx_ss_session_created ON session_summaries(session_id, created_at)`。

不动记忆图谱开关、不改 ingest 逻辑、不动其它 persist 调用点（属后续优化）。
