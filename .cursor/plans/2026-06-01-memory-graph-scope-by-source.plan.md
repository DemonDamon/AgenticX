# 记忆图谱作用域改为「分身 / 元智能体 / 群聊」

> Plan-Id: 2026-06-01-memory-graph-scope-by-source

## What & Why

记忆图谱当前作用域为「本会话 / 分身 / Meta 全局」。用户反馈：**所有会话都来自三类主体（分身、元智能体、群聊）**，「本会话」是冗余的细粒度分区，应去掉。改为：

- 分身（avatar）
- 元智能体（meta，原「Meta 全局」）
- 群聊（group，新增）

并让 ingest 按会话天然归属自动路由到对应分区，否则「群聊」分区永远为空。

## 关键事实（已核实）

- 群聊 session 的 `managed.avatar_id` 存为 `group:<gid>`（`server.py:814`）。
- 分身 session：普通 `avatar_id`；Meta session：`avatar_id` 为空。
- 前端 pane：群聊 `pane.avatarId = "group:<gid>"`，分身为普通 id，Meta 为空。
- 现有 ingest 用单一 `cfg.default_scope`（当前为 meta）→ 所有记忆都进 `meta:default`，群聊/分身分区拿不到数据。

## Requirements

- FR-1: 前端 scope 选择器展示三项：分身 / 元智能体 / 群聊（去掉「本会话」）。
- FR-2: 后端 `derive_group_id` 支持 `group` 作用域；`group:<gid>` 前缀的 avatar_id 在 group 作用域下直接作为 group_id。
- FR-3: ingest（`schedule_turn_ingest_from_session` 与 `enqueue_favorite`）按会话 avatar_id 天然归属路由：`group:*`→group，非空普通→avatar，空→meta，不再统一进 default_scope。
- FR-4: `MemoryGraphPanel` 按当前 pane 类型派生 `initialScope`（群聊→group，分身→avatar，否则 meta）。
- FR-5: 配置 `default_scope` 校验集合加入 `group`，默认值改为 `meta`；UI 默认展示范围下拉去掉「本会话」。
- AC-1: `pnpm -C desktop typecheck` 与现有 memory graph 测试通过。
- AC-2: 群聊窗格打开记忆图谱默认看群聊分区；普通对话/分身/群聊产生的记忆分别落到 meta/avatar/group 分区。

## 非目标

- 不删除历史 `session:*` 分区数据（仅不再暴露入口/不再新写）；`derive_group_id` 保留 legacy session 映射以兼容旧调用。
- 不修复 Kuzu 多进程锁问题（属另一线问题，已有中文提示）。
