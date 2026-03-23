# agenticx.memory

English API reference for the AgenticX memory subsystem: layered stores, hybrid retrieval, decay, SOP registry, and intelligence helpers.

!!! tip "Source layout"
    Implementation lives under `agenticx/memory/`. Import concrete types from `agenticx.memory` or submodules as needed.

---

## BaseMemory

Abstract base class for tenant-scoped memory backends.

**Module:** `agenticx.memory.base`

### Constructor

| Parameter   | Description                                      |
|------------|---------------------------------------------------|
| `tenant_id`| Isolates records per tenant; injected into metadata via `_ensure_tenant_isolation`. |

Use `resolve_tenant_id(tenant_id=None)` to resolve an explicit ID or fall back to `TenantContext` / `"_default_"`.

### Async interface

| Method | Signature (conceptual) | Returns |
|--------|------------------------|---------|
| `add` | `add(content, metadata=None, record_id=None)` | `str` (new record id) |
| `search` | `search(query, limit=10, metadata_filter=None, min_score=0.0)` | `List[SearchResult]` |
| `update` | `update(record_id, content=None, metadata=None)` | `bool` |
| `delete` | `delete(record_id)` | `bool` |
| `get` | `get(record_id)` | `Optional[MemoryRecord]` |
| `list_all` | `list_all(limit=100, offset=0, metadata_filter=None)` | `List[MemoryRecord]` |
| `clear` | `clear()` | `int` (records removed) |

!!! note "Tags and `tenant_id` parameters"
    The public API uses **`metadata`** (dict) rather than a separate `tags` argument; store tags as e.g. `metadata["tags"] = ["a", "b"]`. **Tenant** is fixed on the instance (`tenant_id` in `__init__`); per-call `tenant_id` is not passed on these methods—use one `BaseMemory` instance per tenant.

### `MemoryRecord`

| Field        | Type                  | Description        |
|-------------|------------------------|--------------------|
| `id`        | `str`                  | Record identifier |
| `content`   | `str`                  | Main text payload |
| `metadata`  | `Dict[str, Any]`       | Arbitrary metadata (includes enforced `tenant_id`) |
| `tenant_id` | `str`                  | Tenant scope       |
| `created_at`| `datetime`             | Creation time      |
| `updated_at`| `datetime`             | Last update        |

### `SearchResult`

| Field    | Type            | Description                          |
|---------|-----------------|--------------------------------------|
| `record`| `MemoryRecord`  | Matched record                       |
| `score` | `float`         | Relevance in `[0.0, 1.0]` (clamped)  |

!!! info "`highlights`"
    The current `SearchResult` dataclass does **not** include a `highlights` field. Highlight spans are a natural extension for BM25 / hybrid backends; consumers can derive them from `record.content` and query terms if needed.

### Exceptions

- `MemoryError` — base class for memory failures  
- `MemoryNotFoundError`, `MemoryConnectionError` — specialized errors  

```python
from agenticx.memory.base import BaseMemory, MemoryRecord, SearchResult, resolve_tenant_id
```

---

## BaseHierarchicalMemory

Extends `BaseMemory` with hierarchical typing, importance, sensitivity, associations, and an in-memory **event log**.

**Module:** `agenticx.memory.hierarchical`

### Enums

| Enum                 | Role |
|----------------------|------|
| `MemoryType`         | Layer: `CORE`, `EPISODIC`, `SEMANTIC`, `PROCEDURAL`, `RESOURCE`, `KNOWLEDGE` |
| `MemoryImportance`   | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` (numeric `.value`) |
| `MemorySensitivity`  | `PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `SECRET` |

### `HierarchicalMemoryRecord`

Subclass of `MemoryRecord` with extra fields:

| Field            | Description |
|------------------|-------------|
| `memory_type`    | `MemoryType` |
| `importance`     | `MemoryImportance` |
| `sensitivity`    | `MemorySensitivity` |
| `access_count`   | Read/update counter for retrieval analytics |
| `last_accessed`  | Last access time (defaults to `created_at`) |
| `decay_factor`   | Float in `[0, 1]` for lifecycle / ranking |
| `associations`   | List of related record IDs |
| `source`         | Optional provenance string |
| `context`        | Optional extra dict |

### `MemoryEvent`

Operational audit entry: `event_id`, `event_type` (`read` / `write` / `update` / `delete` / `decay`), `memory_type`, `record_id`, `timestamp`, `metadata`.

`get_recent_events(limit=100)` returns the tail of the ring buffer (capped internally).

### `SearchContext`

Optional filters for hierarchical search: `query_type`, `time_range`, `importance_threshold`, `memory_types`, `include_decayed`, `max_age`.

### Public additions

- `add(..., importance=..., sensitivity=..., source=..., context=...)` — builds `HierarchicalMemoryRecord`, calls `_store_record`, logs a `write` event.  
- `search_hierarchical(query, context=None, limit=10, min_score=0.0)` — delegates to `_hierarchical_search`, then bumps access counts.  
- `get_associations`, `add_association` — graph-style links between records.

### Abstract hooks

| Hook | Responsibility |
|------|----------------|
| `_store_record(record: HierarchicalMemoryRecord)` | Persist / index the record |
| `_hierarchical_search(query, context, limit, min_score)` | Layer-specific retrieval + scoring |
| `_update_access_count(record_id)` | Update `access_count`, `last_accessed`, optional `decay_factor` |

```python
from agenticx.memory.hierarchical import (
    BaseHierarchicalMemory,
    HierarchicalMemoryRecord,
    MemoryType,
    MemoryImportance,
    MemorySensitivity,
    MemoryEvent,
    SearchContext,
)
```

---

## CoreMemory

**Core** layer: agent identity, persistent key–value context, and state timelines.

**Module:** `agenticx.memory.core_memory`

| Method | Description |
|--------|-------------|
| `set_agent_identity(name, role, description, personality=None, capabilities=None)` | Upserts `agent_identity` metadata |
| `get_agent_identity()` | Returns `identity_data` dict or `None` |
| `set_persistent_context(key, value, description=None)` | Upserts typed `persistent_context` |
| `get_persistent_context(key)` | Value for one key |
| `get_all_context()` | All persistent context keys |
| `update_agent_state(state_data, description=None)` | Appends `agent_state` snapshot |
| `get_recent_states(limit=5)` | Recent state dicts sorted by time |

Constructor: `CoreMemory(tenant_id, agent_id, **kwargs)`.

---

## EpisodicMemory

**Episodic** layer: time-ordered events grouped into **episodes**.

**Module:** `agenticx.memory.episodic_memory`

### Dataclasses

**`EpisodeEvent`:** `event_id`, `timestamp`, `event_type`, `content`, `metadata`, `importance`.

**`Episode`:** `episode_id`, `title`, `start_time`, `end_time`, `events`, `summary`, `tags`, `importance`; methods `add_event`, `get_duration`, `to_dict`.

### Key methods

| Method | Description |
|--------|-------------|
| `add_event(event_type, content, timestamp=None, metadata=None, ...)` | Attach event; auto-assign episode via gap threshold |
| `create_episode(title, start_time=None, tags=None, importance=...)` | Explicit episode |
| `get_episodes_by_time_range(start_time, end_time)` | Filter overlapping episodes |
| `get_recent_episodes`, `get_timeline`, `search_events_by_type` | Convenience queries |

### Automatic segmentation and summarization

- **`episode_gap_threshold`** (`timedelta`, default 2h): new events attach to the latest episode if within the gap; otherwise a new episode is created (`_find_or_create_episode`).  
- **`auto_summarize_threshold`** (default 10 events): when an episode grows large, `_update_episode_summary` builds a compact string summary and refreshes the episode record.

---

## SemanticMemory

**Semantic** layer: concepts, triples, and knowledge records.

**Module:** `agenticx.memory.semantic_memory`

### `Concept`

`concept_id`, `name`, `description`, `category`, `attributes`, `relationships`, `synonyms`, `confidence`.

### `KnowledgeTriple`

`triple_id`, `subject`, `predicate`, `object`, `confidence`, `source`, `evidence`.

### Key methods

| Method | Description |
|--------|-------------|
| `add_knowledge(content, knowledge_type="fact", category=None, concepts=None, ...)` | Stores knowledge; extracts concepts / triples when configured |
| `add_concept(name, description, category="general", ...)` | Registers or updates a concept |

### Concept similarity merge

Constructor kwargs include `concept_similarity_threshold` (default `0.7`) and `auto_merge_similar_concepts` (default `True`). Similar names / embeddings (when used) can be merged via internal `_create_or_update_concept` logic.

---

## ShortTermMemory

In-process **sliding window** with optional TTL and LRU eviction.

**Module:** `agenticx.memory.short_term`

| Parameter       | Description |
|----------------|-------------|
| `max_records`  | Capacity; oldest-by-access evicted (`deque` + LRU) |
| `ttl_seconds`  | If set, background task removes stale rows |

Search uses a lightweight content index and substring / word overlap scoring.

### `flush_to_long_term`

!!! warning "Not a built-in method"
    `ShortTermMemory` does **not** currently expose `flush_to_long_term()`. A typical integration is: `for r in await stm.list_all(limit=..., offset=0): await long_term.add(r.content, metadata=r.metadata); await stm.delete(r.id)` (or batch), possibly with deduplication and importance mapping.

---

## MemoryComponent

High-level **orchestrator** over one primary and optional secondary `BaseMemory` backends.

**Module:** `agenticx.memory.component`

### Multi-backend coordination

- **`primary_memory`**: canonical writes and primary search.  
- **`secondary_memories`**: mirrored `add` and optional `search_across_memories` (failures on secondaries are logged, not fatal).

### Four-step pipeline (`add_intelligent`)

When `enable_pipeline=True`, `add_intelligent` runs:

1. **Extract** — `_extract_key_information`  
2. **Retrieve** — `_retrieve_related_memories`  
3. **Reason** — `_reason_about_updates`  
4. **Update** — `_apply_updates`  

Then the processed payload is written to primary (and secondaries).

### Other APIs

| Method | Description |
|--------|-------------|
| `search_across_memories(query, limit=10, metadata_filter=None, min_score=0.0, include_secondary=True)` | Merges, dedupes by `record.id`, sorts by `score` |
| `add_intelligent(...)` | Pipeline + history + optional auto-consolidation |

### `MemoryOperation` history

When `enable_history=True`, operations append structured records: `operation_id`, `operation_type` (`add` / `update` / `delete` / `search`), `tenant_id`, `record_id`, `content`, `metadata`, `timestamp`, `result`, `error`. Ring size controlled by `history_limit`.

```python
from agenticx.memory.component import MemoryComponent, MemoryOperation
```

---

## HybridSearch

Combines **lexical (BM25-style)** and **vector** signals with **structured filters**.

**Module:** `agenticx.memory.hybrid_search`

### `SearchQuery`

| Field              | Description |
|--------------------|-------------|
| `text`             | Query string |
| `query_type`       | `"bm25"`, `"vector"`, or `"hybrid"` |
| `filters`          | Dict for boolean / metadata-style gating on records |
| `boost_fields`     | Per-field score multipliers |
| `time_decay`       | Prefer fresher hits when `True` |
| `importance_boost` | Weight by hierarchical importance when `True` |

### Flow

1. Tokenize / embed query per backend.  
2. BM25: AND → OR → substring fallback tiers; apply `filters` on `HierarchicalMemoryRecord`.  
3. Vector: cosine (when `numpy` / embeddings available; optional extra install).  
4. Fuse scores into `SearchCandidate.hybrid_score` and emit `SearchResult`-compatible flows via coordinator classes in the same module.

!!! note "Dependencies"
    Vector paths expect optional deps (see package extras, e.g. `pip install "agenticx[memory]"`). Without `numpy`, some branches degrade gracefully.

---

## memory_decay

Lifecycle scoring for hierarchical records.

**Module:** `agenticx.memory.memory_decay`

### `MemoryDecayService`

| API | Role |
|-----|------|
| `calculate_decay_factor(record, current_time=None)` | Computes decay in `[min_decay_factor, max_decay_factor]` using age, **importance**, **access_count** / access pattern, **last_accessed** recency window, and **memory_type** multipliers |
| `update_decay_factors(records, current_time=None)` | Batch write-back to `record.decay_factor` |
| `analyze_decay`, `get_decaying_records`, `suggest_cleanup_candidates` | Analytics and housekeeping |

### `apply_decay(memory)`

!!! note "Naming"
    There is no top-level function named `apply_decay(memory)`. The operational equivalent is **`MemoryDecayService.calculate_decay_factor`** (read) or **`update_decay_factors`** (persist). `DecayParameters` and `DecayStrategy` (`EXPONENTIAL`, `LINEAR`, `LOGARITHMIC`, `CUSTOM`) tune the curve.

---

## SOPRegistry

Lightweight **standard operating procedure** registry inspired by JoyAgent-style plan SOPs: no external vector DB; **bag-of-words / Jaccard-style** overlap plus mode selection.

**Module:** `agenticx.memory.sop_registry`

### `SOPItem`

| Field         | Description |
|---------------|-------------|
| `name`        | Short title |
| `description` | Longer text |
| `steps`       | Ordered steps |
| `sop_id`      | Optional stable id for dedup |
| `vector_hint` | Reserved for future embedding hooks |

### Matching modes (`SOPMode` string)

| Mode            | Condition |
|-----------------|-----------|
| `HIGH_MODE`     | Top recall score ≥ `high_threshold` (default `0.75`) |
| `COMMON_MODE`   | Between `low_threshold` and `high_threshold` |
| `NO_SOP_MODE`   | No hits or top score below `low_threshold` (default `0.30`) |

### `build_prompt(query) -> Tuple[SOPMode, str]`

Runs `recall(query)` → `choose_mode` → formatted planner string (strict SOP for `HIGH_MODE`, multi-SOP reference for `COMMON_MODE`, free-planning hint for `NO_SOP_MODE`).

Other helpers: `add_sop`, `list_sops`, `get_sop`, LRU `recall` cache (`cache_stats`).

```python
from agenticx.memory.sop_registry import SOPRegistry, SOPItem
```

---

## MemoryIntelligence subsystem

**Package:** `agenticx.memory.intelligence`

| Component | Class | Role |
|-----------|--------|------|
| Cache | `IntelligentCacheManager` | Tiered cache strategies, invalidation hooks |
| Engine | `MemoryIntelligenceEngine` | Metrics, optimization loop, access-pattern tracking |
| Patterns | `MemoryPatternAnalyzer` | Detects hot spots / usage regimes |
| Retrieval | `AdaptiveRetrievalOptimizer` | Tunes retrieval parameters from feedback |

Shared **models** (`MemoryAccessPattern`, `RetrievalContext`, `CacheStrategy`, `MemoryMetrics`, `OptimizationResult`, etc.) live in `agenticx.memory.intelligence.models`.

```python
from agenticx.memory.intelligence import (
    MemoryIntelligenceEngine,
    AdaptiveRetrievalOptimizer,
    MemoryPatternAnalyzer,
    IntelligentCacheManager,
)
```

---

## Related types

`HierarchicalMemoryManager` in `hierarchical.py` registers layers by `MemoryType` and routes `search_all_layers` using built-in `query_type` rules (`default`, `temporal`, `factual`, ...).

For workspace-integrated file memory and Studio hooks, see `agenticx.memory.workspace_memory`, runtime `MemoryHook`, and collaboration modules—outside the scope of this core API surface.
