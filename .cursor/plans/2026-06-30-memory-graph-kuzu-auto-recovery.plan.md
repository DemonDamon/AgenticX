# Memory Graph Kuzu Auto-Recovery

Plan-Id: 2026-06-30-memory-graph-kuzu-auto-recovery
Planned-with: composer-2.5-fast

## What & Why

Kuzu `graph.kuzu` can corrupt during abnormal shutdown or engine bugs, surfacing raw IO errors and blocking the memory graph panel. Non-technical users must not manually cp backups or run terminal commands.

## Requirements

- FR-1: Probe Kuzu DB on cold init; quarantine corrupt file and restore latest `*.bak-*` or recreate empty schema.
- FR-2: Expose `POST /api/memory/graph/recover` and `MemoryGraphStore.repair_database()` for UI-triggered repair.
- FR-3: Desktop panel auto-invokes recover on corruption; humanize all user-visible errors (no IO exception / pkill / cp).
- AC-1: Corrupt DB is auto-recovered on init or panel open without user terminal steps.
- AC-2: User sees progress/warning copy in Chinese; refresh retries repair.
