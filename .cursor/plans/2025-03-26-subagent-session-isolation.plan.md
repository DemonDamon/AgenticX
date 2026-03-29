# 子智能体跨会话串线修复

## 根因

`AgentTeamManager.collect_global_statuses(session_id=...)` 在本会话无子任务时会把 `restrict_sid` **放宽到全进程所有 TeamManager**，导致：

- `/api/subagents/status` 在 `team_manager is None` 或本地列表为空时把 **其他会话** 的 spawn 列给用户；
- `meta_agent._build_active_subagents_context` 与 `query_subagent_status` 的全局 fallback 把 **A 分身的子任务** 注入 **B 会话** 的系统提示 / 工具结果。

## 修复

- `collect_global_statuses` 增加 `allow_cross_session_fallback`（默认 `False`），**默认禁止**跨会话合并。
- 不修改 `lookup_global_status`（按 `agent_id` 精确查找时的跨会话兜底仍保留，与列表 UI 无关）。

## Requirements

- FR-1: 按 `session_id` 列举子智能体时，仅包含 `owner_session_id` 匹配的 manager。
- AC-1: 单测：两会话各一 spawn，`collect_global_statuses(sess-a)` 不含 B 的名称。

Plan-Id: 2025-03-26-subagent-session-isolation  
Made-with: Damon Li
