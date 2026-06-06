---
name: session-history-spinner-and-summary-bloat-fix
overview: 根治「会话切换有时间差、停止后历史侧栏/主区一直转圈」的三条实测根因。A：前端 stopCurrentRun 中断成功后立即清除 sessionHistoryHints 乐观 running 标记，侧栏秒停转圈不等轮询；B：后端 session_summaries 只增不删（~4 万行）拖慢 list_sessions 自连接（冷查 2.8s），改为按 session upsert 覆盖式写入 + 建索引 + 一次性 prune 历史版本；C：running 分支「终态」判定过严，接受可见正文非空为终态，消除假转圈。
date: 2026-06-06
status: proposed
owner: Damon Li
tags: [desktop, backend, session-history, performance, regression-hardening]
todos:
  - id: a-frontend-clear-hint
    content: stopCurrentRun interrupt 成功后 clearSessionHistoryHint(sid)
    status: pending
  - id: b1-upsert-summary
    content: _save_session_summary_sync 改为按 session_id 覆盖式 upsert（保留单行最新）
    status: pending
  - id: b2-index
    content: session_summaries 建 (session_id, created_at) 索引；schema 初始化处补 CREATE INDEX
    status: pending
  - id: b3-prune-data
    content: 备份 sessions.sqlite 后一次性 prune 历史版本（每 session 仅留最新），VACUUM
    status: pending
  - id: c-running-terminal-parity
    content: _normalize running 分支接受可见正文非空为终态（与 idle 口径统一）
    status: pending
  - id: verify
    content: list_sessions 冷查 <0.3s；lint/类型干净；后端冒烟保持绿
    status: pending
isProject: false
---

# 会话历史转圈与 summary 膨胀修复

**Plan-Id**: 2026-06-06-session-history-spinner-and-summary-bloat-fix
**Plan-File**: `.cursor/plans/2026-06-06-session-history-spinner-and-summary-bloat-fix.plan.md`
**Owner**: Damon Li
**Made-with**: Damon Li

## 背景 / 实测证据

- 并发打 4 个接口同时 1.78s 一起返回；`/api/session` 冷调用 2.82s、温调用 0.06s。
- `~/.agenticx/memory/sessions.sqlite` 329MB，`session_summaries` 39,975 行（~360 会话）。
- `_save_session_summary_sync`（session_store.py:247）纯 INSERT，从不去重；`_list_latest_sessions_sync`（:739）对全表 GROUP BY+MAX 自连接 → 冷查尖峰。
- 前端 `stopCurrentRun`（ChatPane.tsx:4838）不清 `sessionHistoryHints` running，侧栏靠 1.5s 轮询追平，轮询又被上面拖慢 → 转圈滞留。
- `_normalize_execution_state_for_listing`（session_manager.py:318）running 分支只认 sq/followups 为终态。

## 需求

- FR-A: 用户点停止、后端 interrupt 成功后，前端立即清除该 sid 的乐观 running hint。
- FR-B1: 同一 session 的 summary 写入为覆盖式（库中每 session 至多一行最新）。
- FR-B2: `session_summaries` 有 `(session_id, created_at)` 索引。
- FR-B3: 现存历史版本一次性 prune，仅保留每 session 最新行；备份后 VACUUM。
- FR-C: listing 的 running 分支与 idle 分支「完成」口径统一（可见正文非空亦视为终态）。
- NFR: list_sessions 返回结构不变；不改 execution_state 语义；不动对话主流程。
- AC-1: prune 后 `list_sessions` 冷查 <0.3s。
- AC-2: 点停止后侧栏 spinner 立即消失（不等轮询）。
- AC-3: 后端 hermes/openharness 冒烟测试保持绿；前端 lint/类型干净。

## 范围与排除

- 只改：`desktop/src/components/ChatPane.tsx`、`agenticx/memory/session_store.py`、`agenticx/studio/session_manager.py`，及一次性数据 prune 脚本（不入库）。
- 不动：SSE 解析、send-lock（前序 plan）、对话落盘主链路。
- 遵循 no-scope-creep。
