---
name: ""
overview: ""
todos: []
isProject: false
---

# Plan: GAP-B 收尾 — markdown chunks 检索复合重排 + 访问强化（与 turns 对齐）

> Plan-Id: 2026-06-11-memory-chunks-composite-rerank
> 创建时间：2026-06-11
> 研究依据：`research/codedeepresearch/ruflo/ruflo_agenticx_gap_analysis.md`（GAP-B）、`ruflo_proposal.md`（核心思想 2/3）
> 前序：`.cursor/plans/2026-06-11-ruflo-turn-archive-recall.plan.md`（已落地 GAP-A，并对 `turns` 表做了 recency×frequency 复合重排 + 访问强化）
> 执行模型：composer-2.5（本 plan 提供精确文件路径、行锚点、函数签名、代码骨架、env 开关与可运行验证命令）

---

## 0. 一句话目标

把 turn-archive plan 已在 `turns` 表验证过的「recency×frequency 复合重排 + 命中访问强化」**同样接到 markdown `chunks` 检索路径**（`WorkspaceMemoryStore.search_sync` / `recall.py`），让 `MEMORY.md`/`memory/*.md` 等记忆条目也享受「近期×高频靠前 + 命中即强化」的排序，与 turns 口径一致。默认关闭、可一键回滚。

## 1. 已确认的关键基线（执行前必读，均已源码核验）

| 事实 | 位置 | 说明 |
|------|------|------|
| `chunks` 表无 `access_count`/`last_accessed` 列 | `workspace_memory.py:111-125 _ensure_schema` | 需 idempotent `ALTER TABLE` 迁移老库 |
| `turns` 表已有 `access_count`/`last_accessed` 列与复合重排 | `workspace_memory.py:145-159`、`:702 _rerank_turns_composite` | 本 plan 照此实现 chunks 侧 |
| chunks 检索入口 | `workspace_memory.py:211 search_sync(query, limit, mode)` | hybrid 时 `_merge_ranked(fts, sem[, sub])` 后 `[:n]` 返回 |
| chunks FTS | `workspace_memory.py:_search_fts`（约 L485） | 返回 `_row_to_result(row, score=1.0-idx*0.01)` |
| chunks 语义 | `workspace_memory.py:499 _search_semantic` | 余弦相似度排序 |
| chunks 合并 | `workspace_memory.py:519 _merge_ranked` | 多路 RRF 风格合并，按 score 降序 |
| chunks 行→dict | `workspace_memory.py:535 _row_to_result` | **当前不含 access_count**；需扩展 SELECT 与该方法 |
| turns 复合重排参考实现 | `workspace_memory.py:702 _rerank_turns_composite` | `recency=exp(-0.693*age/halflife)`、`frequency=log2(n+1)+1`、`score=base*recency*frequency` |
| 模块常量 | `workspace_memory.py:22 _TURN_RECALL_HALFLIFE_DAYS=7.0` | 复用；新增 `_CHUNK_RECALL_HALFLIFE_DAYS` |
| turns 命中强化 | `workspace_memory.py:309 reinforce_turns_sync` | 照此写 `reinforce_chunks_sync` |
| recall 并入与强化 | `agenticx/memory/recall.py:search_memory_for_chat` | turns 已在此并入并 fire-and-forget 强化；chunks 强化挂同处 |
| turn-archive 配置门控 | `agenticx/memory/turn_archive_config.py` | 新增 `load_chunk_rerank_config()` 同文件，避免新建文件 |

> 执行第一步务必：`rg "reinforce_turns_sync|search_turns_sync|_rerank_turns_composite" agenticx/memory/recall.py agenticx/memory/workspace_memory.py` 复核 turns 的接线方式，chunks 完全照抄风格。

## 2. 范围与非目标

### 范围（本 plan 实现）
- **FR-1**：`chunks` 表通过 idempotent 迁移新增 `access_count INTEGER DEFAULT 0`、`last_accessed TEXT` 两列（`_ensure_schema` 内 `PRAGMA table_info` 探测后 `ALTER TABLE`，兼容老库）。
- **FR-2**：`_search_fts` / `_search_semantic` 的 SELECT 与 `_row_to_result` 增补 `access_count`（供重排用；缺省 0）。
- **FR-3**：新增 `_rerank_chunks_composite(rows, halflife_days)`（逻辑与 `_rerank_turns_composite` 一致，常量 `_CHUNK_RECALL_HALFLIFE_DAYS=7.0`）。
- **FR-4**：`search_sync` 在 hybrid/fts/semantic **合并后**按开关决定是否套用复合重排（开关关 → 行为与现状完全一致）。
- **FR-5**：新增 `reinforce_chunks_sync(chunk_ids)`（照 `reinforce_turns_sync`）。
- **FR-6**：`recall.py` 在 chunks 命中后 fire-and-forget 调 `reinforce_chunks_sync`（与 turns 同处、同写法）。
- **FR-7**：门控 `memory.chunk_rerank.enabled`（默认 `false`）+ env `AGX_CHUNK_RERANK_ENABLED`；`load_chunk_rerank_config()` 加在 `turn_archive_config.py`。

### 非目标（明确不做）
- ❌ 不改 embedding 算法（沿用 `_embedding_vector` hashing-v1）。
- ❌ 不改 turns 路径任何已有逻辑。
- ❌ 不改 `_merge_ranked` 既有签名/行为（只在其结果之上**可选**再排）。
- ❌ 不做后台衰减清理任务（另立 plan）。
- ❌ 不引入新依赖、不改 Desktop（开关先走 config.yaml/env；如需面板另增量）。
- ❌ 不改 `recall.py` 的 merge 骨架（只加 chunks 命中强化调用）。

## 3. 详细设计

### 3.1 FR-1：chunks 表迁移（idempotent）

在 `workspace_memory.py:_ensure_schema()` 的 chunks 建表之后、`conn.commit()` 之前插入：

```python
            # GAP-B: chunks 复合重排所需列（兼容老库，幂等迁移）
            cols = {r["name"] for r in conn.execute("PRAGMA table_info(chunks)").fetchall()}
            if "access_count" not in cols:
                conn.execute("ALTER TABLE chunks ADD COLUMN access_count INTEGER DEFAULT 0")
            if "last_accessed" not in cols:
                conn.execute("ALTER TABLE chunks ADD COLUMN last_accessed TEXT")
```

### 3.2 FR-2：检索结果带出 access_count

三处 SELECT 与 `_row_to_result` 都改（均已核验确切行）：

- **`_search_fts`（L489）**：把
  ```python
                  SELECT c.id, c.path, c.source, c.start_line, c.end_line, c.model, c.text, c.created_at
  ```
  改为（末尾加 `c.access_count`）：
  ```python
                  SELECT c.id, c.path, c.source, c.start_line, c.end_line, c.model, c.text, c.created_at, c.access_count
  ```
- **`_search_semantic`（L505）**：把
  ```python
                  SELECT id, path, source, start_line, end_line, model, text, embedding, created_at
  ```
  改为（末尾加 `access_count`）：
  ```python
                  SELECT id, path, source, start_line, end_line, model, text, embedding, created_at, access_count
  ```
- **`_search_substring`（其 SELECT 未在本 plan 行锚点内）**：**不强制改**。`_row_to_result` 下面用 `row.keys()` 守护，substring 命中若未取该列则 access_count 落 0（安全降级，不报错）。
- **`_row_to_result`（L535-546）**：在返回 dict 中（`"score"` 行之前）加一行：
  ```python
              "access_count": int(row["access_count"] or 0) if "access_count" in row.keys() else 0,
  ```
  > `sqlite3.Row` 支持 `in row.keys()`，老查询未取该列时安全落 0。

### 3.3 FR-3：复合重排（模块常量 + 方法）

模块顶部（L22 附近）新增：
```python
_CHUNK_RECALL_HALFLIFE_DAYS = 7.0
```
新增方法（紧邻 `_rerank_turns_composite`，逻辑一致，仅默认常量不同）：
```python
    def _rerank_chunks_composite(
        self,
        rows: List[Dict[str, Any]],
        *,
        halflife_days: float = _CHUNK_RECALL_HALFLIFE_DAYS,
    ) -> List[Dict[str, Any]]:
        """recency*frequency composite rerank for markdown chunks (mirror of turns)."""
        now = datetime.now(timezone.utc)
        halflife = max(0.1, float(halflife_days))
        enriched: List[Dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            base = max(float(item.get("score", 0.0)), 0.01)
            created_raw = str(item.get("created_at", "") or "")
            try:
                created = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
            except ValueError:
                created = now
            age_days = max(0.0, (now - created).total_seconds() / 86400.0)
            recency = math.exp(-0.693 * age_days / halflife)
            access_count = int(item.get("access_count", 0) or 0)
            frequency = math.log2(access_count + 1) + 1
            item["score"] = round(base * recency * frequency, 4)
            enriched.append(item)
        enriched.sort(key=lambda item: float(item.get("score", 0.0)), reverse=True)
        return enriched
```
> 注：chunks 的 `created_at` 是「索引时间」（文件变更才重建），作为 recency 代理可接受；作为已知局限记录在风险表。

### 3.4 FR-4：search_sync 接入开关

在 `search_sync`（L211）顶部读取一次开关：
```python
        rerank = _chunk_rerank_enabled()
```
> 每次调用直接读 config（与 `is_turn_archive_enabled` 同策略，**不要**自建缓存层）。`halflife` 统一用模块常量 `_CHUNK_RECALL_HALFLIFE_DAYS`（与 config 默认 7.0 一致）；config 的 `halflife_days` 本期**预留不接线**（避免在 search_sync 里再读一次 config），如需可调留作后续增量。
各分支返回前套用（仅当开启）：
```python
        if mode == "fts":
            res = self._search_fts(q, n)
            return self._rerank_chunks_composite(res)[:n] if rerank else res
        if mode == "semantic":
            res = self._search_semantic(q, n)
            return self._rerank_chunks_composite(res)[:n] if rerank else res
        ...
        merged = self._merge_ranked(fts, sem, sub) if sub else self._merge_ranked(fts, sem)
        if rerank:
            merged = self._rerank_chunks_composite(merged)
        return merged[:n]
```
其中 `_chunk_rerank_enabled` 为模块级小函数（读 config，结果可缓存）：
```python
def _chunk_rerank_enabled() -> bool:
    try:
        from agenticx.memory.turn_archive_config import load_chunk_rerank_config
        return bool(load_chunk_rerank_config().get("enabled", False))
    except Exception:
        return False
```

### 3.5 FR-5：reinforce_chunks_sync

照 `reinforce_turns_sync`（L309）实现：
```python
    def reinforce_chunks_sync(self, chunk_ids: List[str]) -> None:
        """Bump access_count and last_accessed for recalled chunk rows."""
        ids = [str(cid).strip() for cid in chunk_ids if str(cid).strip()]
        if not ids:
            return
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            for chunk_id in ids:
                conn.execute(
                    "UPDATE chunks SET access_count = access_count + 1, last_accessed = ? WHERE id = ?",
                    (now, chunk_id),
                )
            conn.commit()
```

### 3.6 FR-6：recall.py 命中强化

`recall.py` 的 `search_memory_for_chat` 是 `async def`，已有 turns 强化在 **L201-203**（确切现状，照抄风格、紧随其后插入 chunks 版本）：

```python
    turn_ids = [str(item["id"]) for item in merged if item.get("source") == "turn" and item.get("id")]
    if turn_ids:
        asyncio.create_task(asyncio.to_thread(store.reinforce_turns_sync, turn_ids))
    # ↓ 新增：chunks 命中强化（仅在 chunk 复合重排开启时）
    if _chunk_rerank_enabled():
        chunk_ids = [str(item["id"]) for item in merged if item.get("source") == "workspace" and item.get("id")]
        if chunk_ids:
            asyncio.create_task(asyncio.to_thread(store.reinforce_chunks_sync, chunk_ids))
    return MemoryRecallResult(matches=merged, graph_skipped_reason=graph_skipped_reason)
```

要点（均已核验）：
- **本函数在 async 上下文**，直接 `asyncio.create_task`，**不要**加 RuntimeError 同步降级（与 L203 既有写法一致）。
- workspace（markdown chunks）条目的 `source == "workspace"`（见 `recall.py:151, 100`），其 `item["id"]` 即 chunks 表主键 id，与 `reinforce_chunks_sync` 的 `WHERE id = ?` 对应。
- `_chunk_rerank_enabled` 从 `workspace_memory` 导入（`from agenticx.memory.workspace_memory import _chunk_rerank_enabled`，置于函数内或文件顶部 import 区均可；其它 store 调用已在本文件用 `store` 实例，无需额外 import）。

### 3.7 FR-7：配置门控

在 `agenticx/memory/turn_archive_config.py` **末尾追加**（不新建文件，不改现有 `DEFAULTS`/`load_turn_archive_config`）。完整可照抄实现：

```python
CHUNK_RERANK_DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "halflife_days": 7.0,
}


def _load_chunk_rerank_section() -> dict[str, Any]:
    """Load the ``memory.chunk_rerank`` section from ``~/.agenticx/config.yaml``."""
    config_path = Path.home() / ".agenticx" / "config.yaml"
    if not config_path.is_file():
        return {}
    try:
        import yaml  # type: ignore[import-untyped]

        with config_path.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
        if isinstance(data, dict):
            memory = data.get("memory")
            if isinstance(memory, dict):
                section = memory.get("chunk_rerank")
                if isinstance(section, dict):
                    return section
    except Exception:
        logger.debug("Failed to load chunk_rerank config from %s", config_path, exc_info=True)
    return {}


def load_chunk_rerank_config() -> dict[str, Any]:
    """Return merged config: YAML overrides on defaults. Env: AGX_CHUNK_RERANK_ENABLED."""
    merged = dict(CHUNK_RERANK_DEFAULTS)
    section = _load_chunk_rerank_section()
    for key, value in section.items():
        if key not in CHUNK_RERANK_DEFAULTS:
            merged[key] = value
            continue
        expected_type = type(CHUNK_RERANK_DEFAULTS[key])
        try:
            if expected_type is bool:
                if isinstance(value, bool):
                    merged[key] = value
                elif isinstance(value, str):
                    lowered = value.strip().lower()
                    if lowered in {"1", "true", "on", "yes"}:
                        merged[key] = True
                    elif lowered in {"0", "false", "off", "no"}:
                        merged[key] = False
            elif expected_type is float:
                merged[key] = float(value)
            else:
                merged[key] = value
        except (ValueError, TypeError):
            logger.warning("Invalid type for memory.chunk_rerank.%s: %r, using default", key, value)

    env_enabled = os.getenv("AGX_CHUNK_RERANK_ENABLED")
    if env_enabled is not None:
        merged["enabled"] = env_enabled.strip().lower() in {"1", "true", "on", "yes"}
    return merged
```

> `Path`、`os`、`logger`、`Any` 在 `turn_archive_config.py` 顶部已 import，无需新增。

## 4. 实施步骤（TDD：先测试骨架后实现，每步可独立验证）

### Task 1 — chunks 迁移 + 检索带 access_count
- [ ] `_ensure_schema` 幂等 `ALTER TABLE chunks`（FR-1）
- [ ] `_search_fts`/`_search_semantic` SELECT + `_row_to_result` 带出 access_count（FR-2）
- [ ] 测试 `tests/test_workspace_memory_chunk_rerank.py::test_legacy_db_migration`：用无新列的旧库实例化 → 不报错、列已补、旧查询正常

### Task 2 — 复合重排 + 开关
- [ ] 模块常量 `_CHUNK_RECALL_HALFLIFE_DAYS`、`_chunk_rerank_enabled`、`_rerank_chunks_composite`（FR-3/4）
- [ ] `search_sync` 三分支按开关套用（FR-4）
- [ ] 测试：`test_rerank_off_is_identical`（关闭时结果与现状逐条一致）、`test_rerank_orders_by_recency_frequency`（高频+近期靠前）

### Task 3 — 命中强化
- [ ] `reinforce_chunks_sync`（FR-5）
- [ ] 测试：`test_reinforce_increments_access_count`

### Task 4 — 配置门控
- [ ] `load_chunk_rerank_config()`（FR-7）
- [ ] 测试 `tests/test_chunk_rerank_config.py`：默认关闭、env `AGX_CHUNK_RERANK_ENABLED=1` 覆盖

### Task 5 — recall 接线 + 端到端
- [ ] `recall.py` chunks 命中 fire-and-forget 强化（FR-6）
- [ ] 测试 `tests/test_recall_chunk_reinforce.py`：开启后命中 chunk 的 access_count 增长；关闭时不变
- [ ] 回归：`python -m pytest $(rg -l "workspace_memory|recall|turn_archive" tests/ | tr '\n' ' ') -q --no-cov`

## 5. 验收标准（AC）

- **AC-1**：`memory.chunk_rerank.enabled=false`（默认）时，`search_sync` 各 mode 返回与现状**逐条一致**（顺序、score 不变）。
- **AC-2**：开启后，近期且高 `access_count` 的 chunk 排序明显靠前（recency×frequency 生效）。
- **AC-3**：被召回命中的 chunk `access_count` 递增、`last_accessed` 更新。
- **AC-4**：老库（无 `access_count` 列）实例化自动迁移，不报错、旧检索正常。
- **AC-5**：`AGX_CHUNK_RERANK_ENABLED=0` 可强制关闭；turns 路径行为完全不受影响。
- **AC-6**：所有新增测试通过；`workspace_memory`/`recall`/`turn_archive` 相关既有测试不回归。

## 6. 风险与回滚

| 风险 | 缓解 |
|------|------|
| chunks `created_at` 是索引时间非内容时间，recency 偏差 | 记为已知局限；与 turns 同口径，足够区分新旧；后续可加内容时间列 |
| 重排改变既有检索顺序影响召回质量 | 默认关闭；开启需显式配置；关闭时严格等价（AC-1 守护） |
| 老库迁移失败 | `PRAGMA table_info` 探测 + try 包裹；失败不阻塞建表 |
| recall 强化阻塞主流程 | fire-and-forget（create_task + to_thread），异常静默 |
| **回滚** | `memory.chunk_rerank.enabled=false` 或 `AGX_CHUNK_RERANK_ENABLED=0` 即完全回到现状；新增列保留不影响其他路径 |

## 7. 提交规范

- 按 Task 分组或一次性提交，`/commit --spec=.cursor/plans/2026-06-11-memory-chunks-composite-rerank.plan.md` 注入 trailer。
- 每个 commit 必须含 `Made-with: Damon Li`、`Plan-Id: 2026-06-11-memory-chunks-composite-rerank`、`Plan-File: .cursor/plans/2026-06-11-memory-chunks-composite-rerank.plan.md`。
- 遵守 `no-scope-creep`：只改本 plan 列出的文件路径。

## 8. 涉及文件清单（精确）

**新增**：
- `tests/test_workspace_memory_chunk_rerank.py`
- `tests/test_chunk_rerank_config.py`
- `tests/test_recall_chunk_reinforce.py`

**修改**：
- `agenticx/memory/workspace_memory.py`（迁移、检索带 access_count、`_rerank_chunks_composite`、`reinforce_chunks_sync`、`search_sync` 接开关、模块常量与 `_chunk_rerank_enabled`）
- `agenticx/memory/recall.py`（chunks 命中 fire-and-forget 强化）
- `agenticx/memory/turn_archive_config.py`（新增 `load_chunk_rerank_config`）

## 9. 验证命令

```bash
python -m pytest tests/test_workspace_memory_chunk_rerank.py \
  tests/test_chunk_rerank_config.py \
  tests/test_recall_chunk_reinforce.py -q --no-cov

python -m pytest $(rg -l "workspace_memory|recall|turn_archive" tests/ | tr '\n' ' ') -q --no-cov

python -c "import agenticx.memory.workspace_memory, agenticx.memory.recall, agenticx.memory.turn_archive_config; print('import ok')"
```

---

*后续（不在本 plan）：turns/chunks 统一后台衰减清理任务；learning→memory 闭环（GAP-06）；Desktop 暴露 chunk_rerank 开关。*
