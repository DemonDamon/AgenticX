# Memory Graph Rebuild-Delete (Kuzu DELETE SIGSEGV Workaround)

Plan-Id: 2026-06-15-memory-graph-rebuild-delete

## 背景 / 根因（已硬证实）

记忆图谱 Episode 删除一直失败，最初表现为「无法连接 agx serve」。逐层排查后定位真根因：

- Kuzu **0.11.3** 对当前 `~/.agenticx/memory/graph.kuzu`（约 83MB）库执行 `DELETE n`（删 `Episodic` 节点）时 **SIGSEGV（exit 139）**，连不带 `DETACH` 的纯 `DELETE n` 也崩。
- 分步诊断：`MATCH (n:Episodic {uuid}) RETURN size(n.entity_edges), count(MENTIONS)` 正常（元数据完好）；删 `MENTIONS` 边正常；**`DELETE n` 必崩**；`CHECKPOINT` 后仍崩；副本上 raw kuzu 同样崩 → 纯 Kuzu 引擎层缺陷，上层逻辑无法绕过。
- 之前的「子进程隔离删除」让 `agx serve` 不再整体崩溃（返回结构化 `failed[]`），但**数据仍删不掉**。

## 已验证的可行路线（COPY 重建）

Kuzu **读取/COPY 不崩**，只有 `DELETE` 节点崩。利用这点做「重建式删除」：导出要保留的数据到 parquet（导出时用 `WHERE` 排除要删的 Episodic 及其关联边）→ 新建空库 → `COPY FROM` 回填 → 原子替换旧库。

副本端到端验证已通过：
- 节点表 `COPY (MATCH (n:T) WHERE … RETURN n.col…) TO 'x.parquet'` + 新库 `COPY T FROM 'x.parquet'`：**含 `FLOAT[]` 向量列无损往返**，过滤项被正确排除。
- 关系表 `CALL show_connection('R')` → `[src_tbl, dst_tbl, src_pk, dst_pk]`；`COPY (MATCH (a:src)-[r:R]->(b:dst) WHERE … RETURN a.pk, b.pk, r.prop…) TO` + `COPY R FROM`：**无损往返**，跨被删端点的边被正确排除。

Schema（graphiti/kuzu）：
- NODE: `Episodic, Entity, Community, RelatesToNode_, Saga`
- REL: `MENTIONS, RELATES_TO, HAS_MEMBER, HAS_EPISODE, NEXT_EPISODE`
- `Entity.name_embedding FLOAT[]`（HNSW 向量索引）；新库 schema 用 graphiti `build_indices_and_constraints()` 初始化以保证一致。

## 需求

- FR-1: 提供 `rebuild_graph_excluding_episodes(delete_uuids, cfg)`，重建 kuzu 库并丢弃指定 Episodic 节点及其悬挂边，其余图谱数据无损保留。
- FR-2: 重建前自动备份旧库（`graph.kuzu.bak-<ts>` + `.wal`），失败可回滚。
- FR-3: 新库 schema 由 graphiti 初始化（含向量/FTS 索引），COPY 顺序为先节点后关系。
- FR-4: `MemoryGraphStore.delete_episodes_bulk` 在 isolated 逐条删除全部因 SIGSEGV 失败时，回退到重建式删除（或单独入口），最终真正删掉目标。
- FR-5: 前端：批量删除若走重建，UI 给出「重建中，请勿退出」明确进度提示；完成后刷新列表。
- NFR-1: 重建必须独占写锁——执行前 `store.reset_runtime()` 释放父锁，并确保无第二个 `agx serve`。
- AC-1: 对真库副本执行重建删 `979be7a2`、`65b7752f`，新库 episode 数 = 旧 - 2，其余 episode/entity/边数量与内容（含向量）保持；新库可正常被 graphiti 打开与检索。

## 待验证风险

- `COPY FROM` 到 graphiti 已建 HNSW 向量索引/ FTS 的表是否冲突；若冲突，改为「建表无索引 → COPY → 再建索引」。
- 真库 83MB 全表重建耗时；UI 需进度提示。

## 实施步骤

1. `agenticx/memory/graph/graph_rebuild.py`：导出/重建核心（read_only 读旧库 → parquet → graphiti 初始化新库 → COPY FROM → 原子替换 + 备份）。
2. `store.py`：`rebuild_excluding()` 方法 + `delete_episodes_bulk` SIGSEGV 回退。
3. `routes.py`：`POST /api/memory/graph/rebuild`（或在 bulk-delete 内回退）。
4. CLI：`agx memory-graph rebuild --exclude <uuid>…`（离线兜底）。
5. 前端：重建进度提示与完成刷新。
6. `tests/`：小库重建 smoke + 真库副本端到端验证。
