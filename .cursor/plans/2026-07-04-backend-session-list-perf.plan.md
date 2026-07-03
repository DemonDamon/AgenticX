# 后端会话列表大数据量慢查询优化（冷启动 O(n) 读盘）

Plan-Id: 2026-07-04-backend-session-list-perf
Plan-File: .cursor/plans/2026-07-04-backend-session-list-perf.plan.md
Planned-with: Claude Opus 4.8 (Cursor)

## 背景 / 现象（已复现证据）

大数据量本机（`~/.agenticx/sessions` 下 469 个会话、1095 个 taskspace 目录）下：
- 重启 Near 后历史对话 / 分身 / 群聊「要等很久」才加载出来；
- 后端**已 ready 状态**下直接 curl 实测：
  - `/api/avatars` ≈ 0.1s、`/api/groups` ≈ 0.4s（快）；
  - `/api/session`（GET session state）**≈ 3.1s**（慢）。
- 现象与前端 studio-ready 补取改动无关；纯后端端点耗时。

## 根因（已初步定位，含需进一步 profile 项）

### R-1 会话列表逐会话读盘（已定位，主嫌疑）
`agenticx/studio/session_manager.py:list_sessions()`（~753）：
- 第 786 行遍历 `_list_persisted_sessions()`（读全部持久化会话元数据）；
- 第 809–827 行对每个会话计算 `updated_at`，其中对**无内存 managed 的会话**调 `_last_message_activity_from_disk(sid)`（~2143）。
- 该方法有 `_disk_activity_cache`（按 mtime 缓存），但**冷启动时缓存为空** → 469 个会话首次列表 = 469 次 `_load_messages_snapshot` 读 `messages.json` → O(n) 磁盘 I/O。
- `_max_message_timestamps_sync` / `_recover_activity_from_summaries_bulk_sync` 已是批量，非主瓶颈。

### R-2 `/api/session` GET 首次 3.1s（需 profile 确认）
`server.py:` GET `/api/session`（~1723）本体只做 `cleanup_expired()`（仅遍历内存，不慢）+ 单会话 get/create。3.1s 疑似来自：
- SessionManager 懒加载 / 首次 `backfill_from_sessions_root`（~456）；
- `ensure_workspace()` bootstrap；
- 首次访问触发的全量 restore。
→ **实施第一步必须先 profile 精确定位**，不凭猜测改。

## 目标

在**不改变会话列表语义**（排序、lazy-create 隐藏空壳、活跃时间回溯正确性）的前提下，把大数据量下会话列表与首个 session state 端点的冷启动耗时降到可接受范围（目标：`/api/session` 首次 < 1s、会话列表首次 < 1s，数据量继续增长时增速亚线性）。

## 范围（严格限定，遵守 no-scope-creep）

**改（候选，需 profile 后择优，不全做）**：
- `agenticx/studio/session_manager.py`：会话列表活跃时间计算的 I/O 优化（见 FR-1/FR-2）。
- 可能涉及 `agenticx/memory/session_store.py`：若批量索引可覆盖磁盘回退则减少逐文件读。

**不改（明确排除）**：
- 前端 `App.tsx` / splash / studio-ready 补取（已在另一 plan 完成，行为不动）。
- 会话列表返回字段结构、排序规则、lazy-create 语义。
- Desktop 打包、MCP、FTS 写入触发器逻辑（除非 profile 明确指向）。
- 时间戳回溯正确性相关的既有修复（勿回退历史 bugfix）。

## 需求

### FR-1 profile 优先（阻塞后续）
- 用 `time`/`cProfile` 或端点级计时，分别测 `/api/session` GET 与会话列表端点在当前数据量下的耗时构成，定位 R-1/R-2 真实占比。
- 产出 profile 结论写入本 plan「实施记录」区，再决定改哪几处。

### FR-2 会话列表磁盘 I/O 收敛（若 profile 确认 R-1）
- 冷启动时用**一次批量**读取（或复用已有 FTS/索引的 `_max_message_timestamps_sync` 结果）覆盖 `_last_message_activity_from_disk` 的逐会话读盘；
- 仅当批量源缺该会话数据时才回退单文件读；
- 保持 `_resolve_list_activity_at` 的入参与结果一致，不改活跃时间语义。

### FR-3 首个 session state 加速（若 profile 确认 R-2）
- 依 profile 结论定向优化（如 backfill 改后台 fire-and-forget 不阻塞首个请求 / bootstrap 幂等短路），最小改动。

## 验收标准

- AC-1：大数据量实测 `/api/session` GET 首次耗时较基线（3.1s）显著下降（目标 < 1s）。
- AC-2：会话列表端点首次耗时较基线显著下降；二次调用（缓存命中）不劣化。
- AC-3：会话列表返回内容（数量、排序、pinned、updated_at 回溯、空壳隐藏）与优化前**逐条一致**（用同一数据快照 diff 校验）。
- AC-4：`pytest tests/test_session_manager_persistence.py` 及相关会话测试全绿（预存 flaky `test_list_sessions_recovers_activity_from_summary_history` 除外，需单独确认非本次引入）。
- AC-5：无新增噪音日志；无回退既有时间戳修复。

## 实施步骤

1. 先 profile（FR-1），把结论写回本 plan。
2. 按结论实施 FR-2 / FR-3 中被确认的项。
3. 用优化前后同数据快照做会话列表 diff（AC-3）。
4. 跑测试（AC-4）+ 大数据量实测耗时（AC-1/AC-2）。

## 提交约定

- trailer 顺序：`Plan-Id` → `Plan-File` → `Plan-Model` → `Impl-Model` → `Made-with: Damon Li`。
- `Plan-Model` / `Impl-Model` 由用户提供，未提供须询问，禁止编造。
- 只 add 本任务直接改动文件。

## 备注

- 本 plan 只解决**后端就绪后端点仍慢**；「后端整体冷启动就绪时间」若还有额外瓶颈，profile 若指向别处再评估是否扩范围。
