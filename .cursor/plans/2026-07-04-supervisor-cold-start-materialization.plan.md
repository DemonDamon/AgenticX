# Supervisor 冷启动全量会话物化阻塞修复

Planned-with: Claude Sonnet 5 Thinking

## 背景

前序 `.cursor/plans/2026-07-04-backend-cold-start-fts-lock.plan.md` 已修复 SQLite 非-WAL
锁争用 + FTS backfill 幂等问题，但用户重启后仍反馈分身/群聊/历史/工作区面板要等超过 1
分钟才显示。复测确认前序修复本身有效，但存在**第二个独立根因**未被覆盖。

## 根因（已用隔离脚本 + 真实数据复现）

`agenticx/studio/supervisor.py` 的 `SessionSupervisor._loop()` 在后台任务启动后**立即**跑
第一次 `_tick()`（不等待 `POLL_INTERVAL_SEC`）。`_tick()` 对 `list_sessions()` 返回的**每一个
历史会话**调用 `self._manager.get(sid, touch=False)`。

冷启动时 `SessionManager._sessions`（进程内存缓存）为空，因此对每一个会话，`get()` 都会
触发完整的 `create()` —— 同步加载 messages.json / todos / scratchpad / agent_messages /
context_refs，并做 taskspace ensure + 全局同步，全部**同步**跑在 asyncio 事件循环上，会
阻塞整个进程直到跑完全部历史会话。

用户环境实测（282 个持久化会话）：
- `list_sessions()`（轻量元数据）：0.068s
- 对全部 282 个会话调用 `get()` 强制物化：**29.768s**（与用户反馈的"超过1分钟"体量吻合，
  实际冷启动时还需与 FTS backfill、MCP 连接等并发竞争 GIL/磁盘，更慢）

`ablation` 测试佐证：屏蔽 `maybe_start_supervisor` 后，`agx serve` 首次可用（`/api/session`
200）耗时从 ~32s 降到 ~2.5s；其余候选根因（memory_graph、wechat 适配器、mcp restore）逐一
排除均无显著影响。

## 修复（FR-1）

无人值守模式（`runtime.unattended`）是**会话级选配**功能，绝大多数历史会话从未启用。
`_session_unattended_enabled()` 只读取 `scratchpad[unattended_enabled]`，无需完整物化即可
判断。

`SessionManager` 新增两个只读辅助方法：
- `get_if_loaded(session_id)`：仅查内存缓存，不触发 `create()`。
- `session_scratchpad_flag(session_id, key)`：单次 SQLite `scratchpad` 表查询（已建
  `PRIMARY KEY(session_id, key)` 索引），不加载 messages/todos/taskspaces。

`SessionSupervisor._tick()` 改为：先查内存缓存，未命中时用一次廉价 scratchpad 读取判断
是否曾经启用过无人值守模式；只有命中时才回退到完整 `get()` 物化。真正处于无人值守状态、
跨重启需要续跑的会话（`scratchpad` 持久化了该标记）行为不变，仍会被正确检测并续跑。

## 验证

- 新逻辑对 282 个真实会话的耗时：**0.038s**（约 800 倍提升），全部正确跳过（用户未使用
  该功能）。
- 端到端 `agx serve` 冷启动复测：端口就绪 32.1s → **2.4s**；`/api/session` 0.29s；
  `/api/sessions`（282 条）0.17s。
- 单测：`tests/test_session_manager_persistence.py` 23/24 通过；唯一失败项
  `test_list_sessions_recovers_activity_from_summary_history` 经 `git stash` 复测确认为
  改动前既存的 flaky 用例，非本次改动引入的回归。
- 新增手写场景验证：模拟"持久化了 unattended 标记但未在内存中"的会话，确认 tick 仍能
  正确物化并触发续跑；未启用该标记的普通会话保持不被物化。

## Requirements

- FR-1: `SessionSupervisor._tick()` 冷启动不得对未启用无人值守模式的历史会话触发完整
  磁盘物化。
- AC-1: 282 会话场景下，supervisor 单次 tick 遍历全部历史会话耗时 < 1s（此前 29.8s）。
- AC-2: 已持久化 `unattended_enabled=true` 但当前不在内存中的会话，仍必须被 tick 正确
  检测并可触发续跑，不得因本次优化而失效。

## 涉及文件

- `agenticx/studio/session_manager.py`：新增 `get_if_loaded()` / `session_scratchpad_flag()`。
- `agenticx/studio/supervisor.py`：`_tick()` 会话物化前置廉价过滤。
