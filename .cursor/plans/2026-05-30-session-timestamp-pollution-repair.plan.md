---
name: session-timestamp-pollution-repair
overview: 修复历史会话因时间戳批量回写污染导致全部挤进「最近七天」、最近30天/更早分组消失的问题；并止血防止 message_timestamp_backfill 再次把旧会话锚定到当下。
todos:
  - id: fix-code
    content: 止血 — load_session_bounds_ms 的 end_ms 优先用已有真实消息时间戳，不再回退被污染的 metadata.updated_at
    status: completed
  - id: repair-module
    content: 新增 timestamp_pollution_repair 模块 + CLI（检测 bulk-anchor 簇 → 回退到前一条真实时间戳，先备份）
    status: completed
  - id: reindex-fts
    content: 修复后同步重写该会话 messages.json 与 session_messages FTS 时间戳
    status: completed
  - id: verify
    content: 真实数据 dry-run 校验分组恢复（预期约 13 个元会话回到最近30天/更早）
    status: completed
  - id: tests
    content: 冒烟测试覆盖止血逻辑与修复检测
    status: completed
isProject: false
---

# 会话时间戳污染修复

## 问题（已用真实数据验证）

元智能体面板 56 个会话中 49 个被挤进「最近7天」，且这 49 个只有 5 个不同时间戳、集中在 2026-05-28 05:05 前后 3 小时窗口 —— 证明是批量回写污染。按倒数第二条真实时间戳重新分组：35 个仍属最近7天、12 个应在最近30天、1 个应在更早。

## 根因

1. taskspace 同步 / 会话加载等「非消息触碰」把 `metadata.updated_at` 刷成近期。
2. `message_timestamp_backfill.spread_missing_timestamps_ms` 对缺时间戳的「最后一条消息」用 `end_ms`（取自被污染的 `metadata.updated_at`）锚定，把磁盘消息时间戳也写成近期。
3. `list_sessions` 的 `_resolve_list_activity_at` 以消息时间戳为准 → 旧会话被算成最近活跃。

## 方案

### FR-1 止血（`load_session_bounds_ms`）
- `end_ms` 优先级：**transcript 中已存在的最大真实消息时间戳** > `metadata.last_activity_at`/`updated_at` > 文件 mtime。
- `start_ms` 优先级：transcript 最小真实消息时间戳 > `metadata.created_at`。
- 即：当会话本身已有真实时间戳时，绝不把合成锚点推到比真实数据更晚。

### FR-2 数据修复（一次性，先整目录备份）
- 扫描所有会话「最后一条消息时间戳」，按秒聚类；被 ≥3 个独立会话共享的秒值判定为 **bulk-anchor 污染簇**（真实独立会话不可能最后活跃时间精确相同）。
- 对最后一条消息落在污染簇、且存在更早真实时间戳的会话：把尾部被锚定的消息回退到「前一条真实时间戳 + 递增」，保持单调。
- 同步重写 `messages.json` 与 `session_messages` FTS 表时间戳，避免 `_resolve_list_activity_at` 的 `max(indexed, disk)` 仍取到污染值。
- 默认 dry-run；`--apply` 才落盘，且落盘前 `cp -r` 整目录备份到 `~/.agenticx/sessions.bak-<ts>`。

## 验收（AC）
- AC-1 止血：对「已有真实时间戳 + 末条缺时间戳」的会话，backfill 后末条时间戳不晚于已有最大真实时间戳。
- AC-2 修复 dry-run：报告约 13 个元会话将从最近7天迁出（最近30天/更早）。
- AC-3 修复 apply 后重启 Near：历史面板出现「最近30天 / 更早」分组。
- AC-4 不误伤：未落在污染簇的会话时间戳不变。

## 非目标
- 不重构 `list_sessions` / 前端分组逻辑（经验证其本身正确）。
- 不尝试恢复完全无任何真实时间戳的纯 legacy 会话的精确时间（无数据来源）。
