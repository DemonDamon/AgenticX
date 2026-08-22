# `agenticx.memory`

API reference for the connected AgenticX memory surfaces: the base backend contract, short-term storage, MCP-backed storage, backend coordination, knowledge-base views, SOP recall, and pre-compaction flush hooks.

The package intentionally does not define a cognitive layer hierarchy. Workspace recall and Studio session persistence are documented separately in [Memory in AgenticX](../concepts/memory.md).

## Public imports

```python
from agenticx.memory import (
    BaseMemory,
    MemoryRecord,
    SearchResult,
    MemoryError,
    ShortTermMemory,
    MCPMemory,
    MemoryComponent,
    KnowledgeBase,
    SOPRegistry,
    SOPItem,
    SOPMode,
    CompactionFlushConfig,
    MemoryFlushHandler,
    DefaultMemoryFlushHandler,
)
```

## `BaseMemory`

`BaseMemory` is the asynchronous, tenant-scoped backend contract in `agenticx.memory.base`.

| Method | Purpose |
|--------|---------|
| `add(content, metadata=None, record_id=None)` | Store a record and return its ID. |
| `search(query, limit=10, metadata_filter=None, min_score=0.0)` | Return ranked `SearchResult` objects. |
| `update(record_id, content=None, metadata=None)` | Update an existing record. |
| `delete(record_id)` | Delete one record. |
| `get(record_id)` | Read one record. |
| `list_all(limit=100, offset=0, metadata_filter=None)` | Page through records. |
| `clear()` | Remove records in this backend and tenant scope. |

`MemoryRecord` carries `id`, `content`, `metadata`, `tenant_id`, `created_at`, and `updated_at`. `SearchResult` contains a `record` and normalized relevance `score`.

## `ShortTermMemory`

`ShortTermMemory` is an in-process store with a bounded record count, optional TTL cleanup, and lightweight content matching. It is appropriate for task-local state and as the fallback used by `MCPMemory` when configured.

```python
memory = ShortTermMemory(tenant_id="team-a", max_records=500, ttl_seconds=3600)
record_id = await memory.add("Decision: ship the narrow fix first")
hits = await memory.search("ship decision")
```

## `MCPMemory`

`MCPMemory` translates `BaseMemory` operations into calls to an MCP-compatible memory service. It discovers the service tools lazily and can fall back to `ShortTermMemory` when the service is unavailable.

Required service tools are `add_memories` and `search_memory`; update, delete, and listing capabilities depend on the connected server.

```python
memory = MCPMemory(
    tenant_id="team-a",
    mcp_client=client,
    fallback_to_short_term=True,
)
```

## `MemoryComponent`

`MemoryComponent` coordinates one primary `BaseMemory` and optional secondary backends. Canonical writes go to the primary and may be mirrored to secondaries. `search_across_memories` merges and deduplicates results by record ID.

When its processing pipeline is enabled, `add_intelligent` performs extraction, related-record retrieval, update reasoning, and persistence before recording an optional operation-history entry.

## `KnowledgeBase`

`KnowledgeBase` presents a scoped view over a `BaseMemory` backend. Use it to group records by name and metadata without introducing another persistence system.

```python
knowledge = KnowledgeBase(
    name="product-docs",
    memory=memory,
    tenant_id="team-a",
)
await knowledge.add("Release checklist", metadata={"kind": "runbook"})
```

## `SOPRegistry`

`SOPRegistry` is a lightweight standard-operating-procedure registry. It uses lexical overlap and thresholds to select `HIGH_MODE`, `COMMON_MODE`, or `NO_SOP_MODE`; it does not require a vector database.

```python
registry = SOPRegistry()
registry.add_sop(
    SOPItem(name="release", description="Release a build", steps=["test", "tag", "publish"])
)
mode, prompt = registry.build_prompt("publish a release")
```

## Pre-compaction flush

`CompactionFlushConfig` defines a soft token threshold and the prompt used before context compaction. `MemoryFlushHandler` is the async protocol; `DefaultMemoryFlushHandler` performs threshold checks and invokes an optional callback.

The default handler does not persist by itself. The caller owns routing the silent flush prompt to a concrete memory surface.

```python
config = CompactionFlushConfig(
    enabled=True,
    soft_threshold_tokens=1000,
    reserve_tokens_floor=2000,
)
handler = DefaultMemoryFlushHandler(on_flush=persist_critical_context)

if await handler.should_flush(current_tokens, max_tokens, config):
    await handler.execute_flush(config)
```

## Related runtime storage

- `agenticx.memory.session_store`: SQLite-backed Studio session and scratchpad persistence.
- `agenticx.memory.workspace_memory`: indexing and retrieval for workspace markdown.
- `agenticx.memory.recall`: recall helpers used by runtime prompt construction.
- `agenticx.memory.turn_archive_config`: configuration for turn-archive behavior.
