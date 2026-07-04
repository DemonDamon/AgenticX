# 后端冷启动一分钟空窗根治：FTS backfill 幂等 + SQLite 锁争用

Plan-Id: 2026-07-04-backend-cold-start-fts-lock
Plan-File: .cursor/plans/2026-07-04-backend-cold-start-fts-lock.plan.md
Planned-with: Claude Opus 4.8 (Cursor)

## 背景 / 现象（用户报告，已复现 + 实测证据）

大数据量本机（`~/.agenticx/sessions` 466 个会话、messages.json 共 34.4MB）**完整重启 Near（npm run dev）后**：分身/群聊/历史/工作区全空，约 **1 分钟**后才加载出来，体验极差。用户强调「之前没这么慢、越来越慢」。

前一轮已确认：`markStudioReady` 广播 + 前端 studio-ready 补取（`2026-07-04-desktop-studio-ready-refetch`）与会话列表 O(n) 读盘优化（`2026-07-04-backend-session-list-perf`）均已落地，但**补取只能在后端 ready 之后触发、缩短不了后端就绪耗时**；本 plan 解决的正是那两个 plan 备注里明确「另开 track」的**后端冷启动就绪本身慢**。

## 根因（本机零风险只读实测，已 100% 坐实）

实测数据（热磁盘缓存下）：
- Python `import agenticx.studio.server` ≈ 2.1s；`create_studio_app()` 同步构造 ≈ 0.12s；`scan_interrupted_sessions()` ≈ 0.03s；`wechat_adapter.start()` 为 `asyncio.create_task` 后台化不阻塞 —— **这些都不是瓶颈**。
- `SessionManager.__init__` → `_schedule_fts_backfill()` 后台 `asyncio.to_thread` 跑 `_backfill_from_sessions_root_sync`。
- SQLite `~/.agenticx/memory/sessions.sqlite`：`journal_mode = delete`（**非 WAL**），`busy_timeout = 5000`。
- FTS `session_messages` 仅索引 **282 / 466** 会话；`session_summaries` 有 464。
- 每次启动 `backfill(overwrite=False)` 实测 **indexed=182, skipped=284**（热缓存 0.325s；**冷缓存会显著放大**）。

### 确切 bug 链（三层叠加）

1. **FTS backfill 幂等失效（治本点）**：
   `_backfill_from_sessions_root_sync`（`session_store.py:628`）用 `already_indexed_ids = SELECT DISTINCT session_id FROM session_messages` 判定是否跳过。
   `_index_session_messages_sync`（`session_store.py:463`）对每个会话先 `DELETE FROM session_messages WHERE session_id=?` 再 `INSERT`，但 **`if rows:` 才 INSERT**。
   → messages.json 为空 / 无有效 dict 消息的 **182 个会话**索引后**不产生任何 FTS 行** → 永远进不了 `already_indexed_ids` → **每次重启都被重新处理**，且每个都执行一次 `DELETE + commit`（写事务）。

2. **SQLite delete-journal 模式锁争用（治标高收益点）**：
   `_connect()`（`session_store.py:68`）只 `sqlite3.connect`，未开 WAL。`delete` 模式下写事务锁全库，读被排斥。
   → backfill 后台线程连续 182 次写事务（DELETE+commit）持锁，前端 `/api/sessions`（`list_sessions` → `_list_latest_sessions_sync` / `_max_message_timestamps_sync` / `_recover_activity_from_summaries_bulk_sync`）与 `/api/session` 的 **SQLite 读被反复阻塞**（busy_timeout 5s 反复等待/重试）。

3. **冷磁盘缓存放大器**：
   重启后首次读 466 个 messages.json（34MB）+ SQLite 冷缓存，把上面锁窗口从「零点几秒」放大到「数十秒~一分钟」。

## 目标

后端冷启动就绪后，前端首批核心数据（分身/群聊/历史）在**数秒内**可用（不再受 backfill 写锁牵连）；FTS 检索功能与数据一致性不回退；不改会话列表语义（已由 `backend-session-list-perf` 保证）。

## 范围（严格限定，遵守 no-scope-creep）

**改（候选，需 FR-1 实测后择优，不必全做）**：
- `agenticx/memory/session_store.py`：backfill 幂等修复（FR-2）、SQLite 连接 pragma 统一开 WAL（FR-3）。
- `agenticx/studio/session_manager.py`：`_schedule_fts_backfill` 调度时机/优先级（FR-4，仅在 FR-2+FR-3 不足时）。

**不改（明确排除）**：
- `list_sessions` / 会话列表活跃时间语义（已由 `2026-07-04-backend-session-list-perf` 优化，勿回退）。
- 前端 splash / studio-ready 补取（已完成，行为不动）。
- `agx serve` 启动流程主干、lifespan 其他初始化（wechat/supervisor/longrun/MCP）——实测均非本瓶颈。
- FTS 检索的查询侧逻辑（`_search_session_messages_sync` 等）。
- Python import 冷启动加速（dev 模式源码 + 大依赖，属打包/依赖精简的独立议题）。

## 需求

### FR-1 冷缓存实测优先（阻塞后续，拿证据再改）
- 在**冷缓存或隔离实测**下量化：backfill 期间前端 `/api/sessions`、`/api/session` 的实际阻塞时长；WAL 切换前后对比。
- 隔离实测须安全：备份并复原 `~/.agenticx/serve.port` / `serve.token`，用独立端口、测毕 kill 进程组、清理可能的孤儿 MCP 子进程。
- 结论写回本 plan「实施记录」区，据此决定 FR-2/3/4 做哪些。

### FR-2 backfill 幂等修复（治本）
- 让"已处理过"的会话（**含索引后 0 行的空会话**）不再每次重扫重写。候选方案（择一，实施时评估）：
  - a) 持久化"backfill 完成"标记（如 `PRAGMA user_version` 或单独 meta 表），完整跑一次后整体跳过；增量索引交由正常写入路径（新消息经 `index_session_messages` 实时写）。
  - b) 用"已尝试 backfill 的 session_id 集合"持久表，`already_indexed_ids` 改为并集判断。
- 必须保证：新增/更新会话消息仍能被 FTS 检索到（不破坏检索正确性）。

### FR-3 SQLite WAL 模式（治标、收益大、需风险评估）
- `_connect()` / `_ensure_schema` 统一设 `PRAGMA journal_mode=WAL`（+ 保留 `busy_timeout`、评估 `synchronous=NORMAL`），使 backfill 写与前端读并发不互斥。
- **风险与前置确认（实施时必须核对）**：
  - WAL 是持久化设置（写入库文件头），会产生 `-wal`/`-shm` 伴随文件；确认 DMG/PyInstaller 打包与首启迁移无碍。
  - 枚举所有连 `sessions.sqlite` 的进程/线程（agx serve 主进程、lifespan 内 adapter、cc-bridge 等是否共库），确认 WAL 多连接安全。
  - 提供失败回退（切换异常时 fallback 到原模式，不致启动失败）。

### FR-4（可选，仅当 FR-2+FR-3 仍不足）backfill 调度降优先级
- 将 `_schedule_fts_backfill` 延后到首批 API 就绪之后，或分批 + `await asyncio.sleep(0)`/小睡让路，降低与冷启动首批请求的资源争用。

## 验收标准

- AC-1：冷启动（或等价隔离实测）下，后端 ready 后前端首批分身/群聊/历史在**数秒内**出现，不再受 backfill 牵连（对比当前 ~1min 显著下降）。
- AC-2：重复重启时 backfill 不再每次 `indexed=182`；稳定后应 `indexed≈0`（幂等生效）。
- AC-3：FTS 会话检索（`session_search` / `search_session_messages`）功能与结果不回退；对新写入消息可检索。
- AC-4：SQLite 数据一致，无锁超时报错刷屏；WAL 伴随文件在正常退出后可清理/合并，不损坏库。
- AC-5：`pytest tests/test_session_manager_persistence.py` 及 FTS/session_store 相关测试全绿（预存 flaky `test_list_sessions_recovers_activity_from_summary_history` 除外）。
- AC-6：不回退 `list_sessions` 已有优化与语义；无新增噪音日志。

## 实施步骤

1. FR-1 隔离/冷缓存实测（含 WAL 前后对比），结论写回本 plan。
2. 实施 FR-2 幂等修复 + FR-3 WAL（按实测取舍），必要时 FR-4。
3. 幂等回归：连续两次重启，第二次 `indexed≈0`。
4. 功能回归：FTS 检索命中新旧消息；跑测试（AC-5）。
5. 冷启动实测复测前端首批数据耗时（AC-1）。

## 提交约定

- trailer 顺序：`Plan-Id` → `Plan-File` → `Plan-Model` → `Impl-Model` → `Made-with: Damon Li`。
- `Plan-Model` / `Impl-Model` 由用户提供，未提供须询问，禁止编造。
- 只 `git add` 本任务直接改动文件（`session_store.py`，必要时 `session_manager.py`）+ 本 plan。

## 备注

- 本 plan 聚焦「后端就绪后仍被 backfill 锁牵连」的一分钟空窗；dev 模式 vite/tsc 编译本次实测仅 ~2s，非主因；Python 冷缓存 import 若仍偏慢，属打包/依赖精简的独立 track。
