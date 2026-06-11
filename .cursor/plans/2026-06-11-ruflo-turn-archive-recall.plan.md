# Plan: 内化 Ruflo 对话轮次语义归档与检索复合重排

> Plan-Id: 2026-06-11-ruflo-turn-archive-recall
> 创建时间：2026-06-11
> 研究依据：`research/codedeepresearch/ruflo/ruflo_proposal.md`、`ruflo_agenticx_gap_analysis.md`（含 2026-06-11 源码校验修正章节）
> 目标读者/执行模型：composer-2.5（本 plan 提供精确文件路径、函数签名、代码骨架、验收命令，可直接实施）

---

## 0. 背景（一句话）

Ruflo 的"无限上下文"核心是：每轮主动把对话块归档进可语义检索的记忆库，压缩后再按重要性召回。AgenticX 已有压缩（`ContextCompactor`）、压缩钩子（`on_compaction`）、每轮自动召回（`_build_memory_recall_context`）和成熟的衰减/访问强化逻辑（`memory_decay.py`），**唯一缺口**是：① 对话轮次没有被归档进召回库（召回只覆盖 markdown 文件）；② 召回排序没有 recency×frequency×访问强化。本 plan 只补这两个缺口，不重写已有能力，不引入新依赖。

## 1. 范围与非目标

### 范围（本 plan 实现）
- **FR-1（GAP-A）**：新增 `TurnArchiveHook`，挂在 `on_agent_end`，把每轮新增对话块写入 `WorkspaceMemoryStore` 的新表 `turns`（SHA-256 去重、异步非阻塞）。
- **FR-2（GAP-A）**：扩展 `WorkspaceMemoryStore` 支持归档/检索对话轮次（`turns` 表 + 在 `search_sync` 中并入 turns 结果）。
- **FR-3（GAP-B）**：给 turns 检索结果加入 recency×frequency×访问强化复合重排；命中后异步 `access_count += 1, last_accessed = now`。
- **FR-4（GAP-C）**：在 `on_compaction` 后将"本次压缩了多少轮"的信号用于让下一轮 `_build_memory_recall_context` 临时提升召回 limit（轻量，不新增事件）。
- **FR-5**：全部能力由 `~/.agenticx/config.yaml` 的 `memory.turn_archive` 节 + 环境变量门控，默认 **关闭**（`enabled: false`），可一键回滚。
- **FR-6**：Desktop「设置 → 记忆管理」暴露 `memory.turn_archive` 开关与关键参数（IPC 读写 config.yaml）。

### 非目标（明确不做）
- ❌ 不实现 GOAP A* 规划器（GAP-D，另立独立 ADR/plan）。
- ❌ 不引入 ONNX/外部 embedding（沿用 `WorkspaceMemoryStore` 现有 embedding provider）。
- ❌ 不改 `ContextCompactor` 的压缩算法本身。
- ❌ 不发明新的 hook 事件（复用已存在的 `on_agent_end` / `on_compaction`）。
- ❌ 不改 `MemoryRecord` / `HierarchicalMemoryRecord`（与 runtime 检索无关）。

## 2. 关键事实基线（执行前必读，均已源码核验）

| 事实 | 位置 | 说明 |
|------|------|------|
| `on_agent_end(final_text, session)` 钩子 | `agenticx/runtime/hooks/__init__.py:57` | 归档挂载点；`session` 有 `chat_history`(list[dict])、`workspace_dir`、`scratchpad`、`session_id`、`bound_avatar_id` |
| `on_compaction(compacted_count, summary, session)` 钩子 | `agenticx/runtime/hooks/__init__.py:49` | 已在 `agent_runtime.py:1382, 2045` 调用；只传 count+summary |
| 自动召回注入 | `agenticx/runtime/prompts/meta_agent.py:264 _build_memory_recall_context` | 每轮取最近5条 user 消息→`search_memory_for_chat_sync(mode="hybrid")`→注入系统提示 |
| 召回实现 | `agenticx/memory/recall.py:117 search_memory_for_chat` | 调 `WorkspaceMemoryStore().search_sync()` + 可选图谱；**当前不含对话轮次** |
| runtime 记忆后端 | `agenticx/memory/workspace_memory.py:72 WorkspaceMemoryStore` | SQLite，`chunks`/`chunks_fts`/`files`/`embedding_cache` 表；`search_sync(query, limit, mode)` 用 FTS+semantic RRF 合并 |
| 衰减/访问强化（未接入） | `agenticx/memory/memory_decay.py:34 DecayParameters` | exponential decay + `access_boost` + `recency_window` + `min_decay_factor=0.1`，作用于 HierarchicalMemoryRecord，**未接 WorkspaceMemoryStore** |
| 现有 MemoryHook | `agenticx/runtime/hooks/memory_hook.py:25` | 关键词启发式抽取写 MEMORY.md，非完整轮次归档；可作为 hook 注册写法参考 |
| Hook 注册位置 | 搜索 `HookRegistry()` / `.register(` 在 `agenticx/studio/server.py` | 找到 MemoryHook 注册处，按相同方式注册 TurnArchiveHook |

> 执行第一步务必：`rg "register\(" agenticx/studio/server.py` 与 `rg "MemoryHook" agenticx/studio` 定位 hook 注册点。

## 3. 详细设计

### 3.1 数据存储：`WorkspaceMemoryStore` 新增 `turns` 表

在 `agenticx/memory/workspace_memory.py` 的 `_ensure_schema()` 增加（不破坏现有表）：

```sql
CREATE TABLE IF NOT EXISTS turns (
    id TEXT PRIMARY KEY,            -- turn-<sha256(content)[:16]>
    session_id TEXT NOT NULL,
    avatar_id TEXT,
    turn_index INTEGER,
    role TEXT,                      -- 'user' | 'assistant' | 'pair'
    text TEXT NOT NULL,
    embedding BLOB,
    content_hash TEXT NOT NULL,     -- SHA-256, 去重
    access_count INTEGER DEFAULT 0,
    last_accessed TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_hash ON turns(content_hash);
CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts
    USING fts5(text, session_id UNINDEXED, content='');
```

### 3.2 `WorkspaceMemoryStore` 新增方法

```python
def archive_turn_sync(
    self,
    *,
    session_id: str,
    text: str,
    avatar_id: str = "",
    turn_index: int = 0,
    role: str = "pair",
) -> bool:
    """Archive one conversation chunk. Returns False if duplicate (by content_hash)."""
    # 1. content_hash = sha256(f"{session_id}:{text}")[:16]
    # 2. INSERT OR IGNORE into turns (利用 idx_turns_hash 去重); 同步写 turns_fts
    # 3. embedding 复用 self._get_cached_embedding(conn, chunk_hash, text)
    # 返回是否新插入

def search_turns_sync(
    self,
    query: str,
    limit: int = 5,
    *,
    session_id: str = "",
) -> List[Dict[str, Any]]:
    """Search archived turns with recency*frequency*access composite rerank.

    复合评分（对齐 Ruflo，参数集中在模块常量，便于调优）:
        base       = RRF(fts_rank, semantic_rank)   # 复用现有 _merge_ranked 思路
        recency    = exp(-0.693 * age_days / HALFLIFE_DAYS)   # HALFLIFE_DAYS=7
        frequency  = log2(access_count + 1) + 1
        composite  = base * recency * frequency
    返回按 composite 降序的结果，每条含 source='turn'。
    """

def reinforce_turns_sync(self, turn_ids: List[str]) -> None:
    """命中后强化: access_count += 1, last_accessed = now (异步调用, 失败静默)。"""
```

> 复合重排常量集中定义在 `workspace_memory.py` 顶部：`_TURN_RECALL_HALFLIFE_DAYS = 7.0`。复用现有 `_search_fts` / `_search_semantic` / `_merge_ranked` 私有方法（针对 turns 表做参数化或复制最小逻辑，避免大改现有 chunks 检索）。

### 3.3 `recall.py` 并入 turns 结果

修改 `agenticx/memory/recall.py:search_memory_for_chat()`：
- 新增可选参数 `include_turns: bool = True`、`turns_limit: int = 3`。
- 当 `include_turns` 且 turn-archive 开启时，调用 `store.search_turns_sync(query, turns_limit, session_id=session_id)`，结果标 `source='turn'`，并入 `_merge_recall_results`（turns 与 workspace 同级 RRF，turns 优先级略高于 graph）。
- 命中的 turn_ids 异步 `store.reinforce_turns_sync(ids)`（fire-and-forget，不阻塞）。
- `MemoryRecallResult` 的 matches 中 turn 条目在 `meta_agent.py` 渲染时前缀用 `[历史对话] `（与现有 `[图谱] ` 风格一致）。

### 3.4 `TurnArchiveHook`（新文件）

`agenticx/runtime/hooks/turn_archive_hook.py`：

```python
#!/usr/bin/env python3
"""Archive conversation turns into WorkspaceMemoryStore for semantic recall.

Author: Damon Li
"""
from __future__ import annotations
import asyncio, hashlib, logging
from typing import Any
from agenticx.runtime.hooks import AgentHook

logger = logging.getLogger(__name__)
MIN_CHUNK_CHARS = 40        # 太短的轮次不归档
MAX_CHUNKS_PER_TURN = 3     # 每次 on_agent_end 最多归档 N 个新块（节流）

class TurnArchiveHook(AgentHook):
    """On agent_end, archive new conversation chunks into the recall store."""

    def __init__(self, *, enabled: bool = False) -> None:
        self._enabled = enabled
        self._archived_hashes: set[str] = set()  # 进程内去重快表

    async def on_agent_end(self, final_text: str, session: Any) -> None:
        if not self._enabled:
            return
        try:
            chat_history = list(getattr(session, "chat_history", None) or [])
            session_id = str(getattr(session, "session_id", "") or "")
            if not session_id or len(chat_history) < 2:
                return
            avatar_id = str(getattr(session, "bound_avatar_id", "") or "")
            chunks = self._build_chunks(chat_history)  # 取最近 user+assistant 配对
            asyncio.create_task(
                self._archive(session_id, avatar_id, chunks)
            )
        except Exception:
            logger.debug("TurnArchiveHook.on_agent_end failed silently", exc_info=True)

    async def _archive(self, session_id, avatar_id, chunks) -> None:
        # 用 asyncio.to_thread 调 store.archive_turn_sync(...)，最多 MAX_CHUNKS_PER_TURN
        ...
```

- 归档块构造：把最近一轮 `user` + 对应 `assistant` 文本拼为一个块（`role='pair'`），超长截断（与 micro_compact 类似，保留头尾）。
- 用 `asyncio.create_task` + `asyncio.to_thread` 包 SQLite 同步写，**绝不阻塞主流程**；异常仅 `logger.debug`。

### 3.5 注册 Hook（`agenticx/studio/server.py`）

在现有 `HookRegistry` 注册 `MemoryHook` 的同一处，按配置注册：

```python
from agenticx.runtime.hooks.turn_archive_hook import TurnArchiveHook
from agenticx.memory.turn_archive_config import load_turn_archive_config  # 见 3.6

_ta_cfg = load_turn_archive_config()
if _ta_cfg.get("enabled"):
    hooks.register(TurnArchiveHook(enabled=True), priority=-60)  # 在 memory/summary hook 之后
```

### 3.6 配置门控

新增 `agenticx/memory/turn_archive_config.py`（仿 `learning/config.py` 写法）：
- 读 `~/.agenticx/config.yaml` 的 `memory.turn_archive` 节：`enabled`(默认 false)、`min_chunk_chars`(40)、`max_chunks_per_turn`(3)、`recall_turns_limit`(3)、`halflife_days`(7)。
- 环境变量覆盖：`AGX_TURN_ARCHIVE_ENABLED`。

### 3.7 FR-4：压缩后提升召回 limit（轻量）

- `on_compaction` 时在 `session` 上打标 `session._recall_boost_pending = True`。
- `_build_memory_recall_context` 读取该标记，若为真则本轮 `turns_limit` 临时翻倍（如 3→6），用后清除。
- 这是可选增强，若实现复杂度高可降级为 P1 后续。

## 4. 数据流图

```
每轮对话结束 → run_on_agent_end(final_text, session)
  → MemoryHook(已有, 关键词→MEMORY.md)
  → TurnArchiveHook(新增)
      → _build_chunks(chat_history) → asyncio.create_task
          → to_thread: WorkspaceMemoryStore.archive_turn_sync()
              → sha256 去重 → INSERT OR IGNORE turns + turns_fts + embedding

下一轮系统提示构建 → _build_memory_recall_context(session)
  → search_memory_for_chat_sync(query, mode=hybrid)
      → WorkspaceMemoryStore.search_sync()        [markdown chunks, 已有]
      → WorkspaceMemoryStore.search_turns_sync()   [对话轮次, 新增, 复合重排]
      → 图谱(可选, 已有)
      → _merge_recall_results → 注入"## 相关历史记忆（自动召回）"
      → reinforce_turns_sync(命中ids) [异步, access_count+=1]

上下文超限 → maybe_compact → run_on_compaction
  → session._recall_boost_pending = True (FR-4)
```

## 5. 实施步骤（按顺序，每步可独立验证）

> 遵循 TDD：先写测试骨架再实现。每步完成后跑对应测试。

### Task 1 — `turns` 表与 `WorkspaceMemoryStore` 归档/检索方法
- [x] 在 `_ensure_schema()` 加 `turns` / `turns_fts` 表（3.1）
- [x] 实现 `archive_turn_sync` / `search_turns_sync` / `reinforce_turns_sync`（3.2）
- [x] 复合重排常量与逻辑（recency×frequency×access）
- [x] 测试：`tests/test_workspace_memory_turns.py`（归档→去重→检索→强化→重排顺序）

### Task 2 — 配置门控
- [x] 新增 `agenticx/memory/turn_archive_config.py`（3.6）
- [x] 测试：`tests/test_turn_archive_config.py`（默认关闭、env 覆盖）

### Task 3 — `TurnArchiveHook`
- [x] 新增 `agenticx/runtime/hooks/turn_archive_hook.py`（3.4）
- [x] 块构造、截断、异步归档、异常静默
- [x] 测试：`tests/test_turn_archive_hook.py`（mock session，验证 enabled=False 不归档、enabled=True 调用 store）

### Task 4 — `recall.py` 并入 turns + 强化
- [x] 修改 `search_memory_for_chat` 加 `include_turns`/`turns_limit`，并入 merge，命中异步强化（3.3）
- [x] 测试：`tests/test_recall_with_turns.py`（turns 结果出现在 matches、source='turn'）

### Task 5 — 注册 Hook + 系统提示渲染
- [x] `agenticx/runtime/agent_runtime.py` 按配置注册 `TurnArchiveHook`（源码核验：非 `server.py`）
- [x] `meta_agent.py:_build_memory_recall_context` 对 `source='turn'` 加 `[历史对话] ` 前缀
- [x] FR-4 召回 boost 标记（3.7）

### Task 6 — 端到端冒烟 + Desktop 设置 + 文档
- [x] `tests/test_smoke_turn_archive_e2e.py`：模拟多轮对话→归档→压缩→下一轮系统提示含归档内容
- [x] 新增 9 条 turn_archive 测试全绿；`test_smoke_hermes_agent_*` 既有失败与本次无关
- [x] Desktop「设置 → 记忆管理」`TurnArchiveSettingsPanel` + IPC
- [ ] 更新 `conclusions/*.md`（仓库 gitignore，本地 `/update-conclusion` 维护）

## 6. 验收标准（AC）

- **AC-1**：`memory.turn_archive.enabled=false`（默认）时，行为与现状完全一致，无 turns 写入、召回不变。
- **AC-2**：开启后，连续对话 ≥3 轮，`turns` 表有去重后的归档记录（同内容不重复）。
- **AC-3**：压缩后的下一轮，系统提示"## 相关历史记忆（自动召回）"中出现 `[历史对话] ` 前缀的、来自被压缩轮次的相关内容。
- **AC-4**：被召回命中的 turn 条目 `access_count` 递增；高频+近期条目排序靠前（recency×frequency 生效）。
- **AC-5**：归档不阻塞主对话——单轮响应延迟增量 p99 ≤ 50ms（归档走 create_task）。
- **AC-6**：所有新增测试通过，现有冒烟测试不回归。

## 7. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 归档拖慢主流程 | `asyncio.create_task` + `to_thread`；`MAX_CHUNKS_PER_TURN` 节流 |
| `turns` 表膨胀 | 复用 `memory_decay` 思路，后续加清理任务（`access_count=0` 且超期）；本 plan 先不做自动清理，留接口 |
| embedding 质量低（hashing-v1 默认） | 与现状一致，不在本 plan 改 embedding；turns 与 markdown 同后端，行为可预期 |
| 去重误判 | content_hash 用 `session_id:text` 前缀，跨 session 不误判 |
| SQLite 并发写 | `WorkspaceMemoryStore._connect()` 每次新连接 + WAL；归档与索引均短事务 |
| **回滚** | 全部受 `memory.turn_archive.enabled` 开关控制，置 false 即完全回到现状；`turns` 表保留不影响其他路径 |

## 8. 提交规范

- 按 Task 分组提交，使用 `/commit --spec=.cursor/plans/2026-06-11-ruflo-turn-archive-recall.plan.md` 自动注入 trailer。
- 每个 commit 必须含 `Made-with: Damon Li`、`Plan-Id: 2026-06-11-ruflo-turn-archive-recall`、`Plan-File: .cursor/plans/2026-06-11-ruflo-turn-archive-recall.plan.md`。
- 遵守 `no-scope-creep`：只改本 plan 列出的文件路径，不顺手改无关逻辑。

## 9. 涉及文件清单（精确）

**新增**：
- `agenticx/runtime/hooks/turn_archive_hook.py`
- `agenticx/memory/turn_archive_config.py`
- `desktop/src/components/memory/TurnArchiveSettingsPanel.tsx`
- `tests/test_workspace_memory_turns.py`
- `tests/test_turn_archive_config.py`
- `tests/test_turn_archive_hook.py`
- `tests/test_recall_with_turns.py`
- `tests/test_smoke_turn_archive_e2e.py`

**修改**：
- `agenticx/memory/workspace_memory.py`（`_ensure_schema` + 3 个 turns 方法）
- `agenticx/memory/recall.py`（`search_memory_for_chat` 并入 turns）
- `agenticx/runtime/prompts/meta_agent.py`（`_build_memory_recall_context` 渲染前缀 + 召回 boost）
- `agenticx/runtime/agent_runtime.py`（注册 `TurnArchiveHook`）
- `desktop/electron/main.ts`、`preload.ts`、`global.d.ts`、`SettingsPanel.tsx`（记忆 Tab 设置面板）

---

*后续（不在本 plan）：GAP-D GOAP A* 规划器单独立 plan；turns 表自动清理任务可作为本 plan 稳定后的增量。*
