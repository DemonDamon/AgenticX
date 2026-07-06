# ADR: Multi-Brain Knowledge Architecture

**Plan-Id**: 2026-05-20-multi-brain-knowledge-architecture  
**Status**: Accepted (OQ-1=B, OQ-2=B)

## Context

Machi previously exposed one global `knowledge_base` (KBManager singleton) and a separate global `code_index`. Avatars could not mount different retrieval corpora.

## Decision

Introduce **Brain** as a first-class instance:

| Field | Values |
|-------|--------|
| `type` | `docs` \| `code` |
| `scope` | `global` \| `private` (+ `owner_avatar_id`) |
| Storage | `~/.agenticx/brains/<id>/` or `~/.agenticx/avatars/<id>/brains/<brain_id>/` |

- **Mount**: `AvatarConfig.brains_enabled` = `null` (global only) \| `"*"` \| `[brain_id, ...]`
- **Search merge (OQ-2=B)**: `knowledge_search` / `code_search` return `by_brain[]` blocks plus flattened `hits` for backward compatibility.
- **Scope immutability (OQ-1=B)**: `scope` cannot change after creation; share by creating a new global brain.

## Layout

```
~/.agenticx/brains/<brain_id>/brain.yaml
~/.agenticx/brains/registry.json          # index of brain ids
~/.agenticx/avatars/<avatar_id>/brains/<brain_id>/...
```

Default docs brain bootstrapped from legacy `knowledge_base:` without moving chroma paths.

## API

- `GET/POST /api/brains`, `GET/PATCH/DELETE /api/brains/{id}`
- Type-specific: `/api/brains/{id}/materials`, `/search`, `/index`, `/preload`
- Legacy `/api/kb/*` delegates to default docs brain (deprecation shim).

## Consequences

- Each docs brain owns a `KBRuntime(registry_dir=…)` instance.
- Each code brain maps to one `codebase_path` in `CodeIndexManager`.
- Deleting an avatar cascades private brains under `avatars/<id>/brains/`.
