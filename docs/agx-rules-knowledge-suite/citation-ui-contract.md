# Citation UI contract (K1-3)

Shared JSON view-model for **citation / conflict display** in web-portal and admin-console.
Produced by `agenticx.retrieval.citation_view.to_citation_view(EvidenceBundle)`.

UI pixel work is out of scope for P0; consumers bind to this shape.

## Top-level object

| Field | Type | Notes |
|-------|------|--------|
| `entity_id` | `string` | Object the evidence is about (synthetic ids in fixtures) |
| `citations` | `Citation[]` | Ordered like the bundle (confidence / time) |
| `conflicts` | `Conflict[]` | Disagreeing values for the same identity |
| `missing` | `string[]` | Required kinds / attrs not present (`ledger_attr`, `attr:status`, …) |
| `summary` | `string` | Optional human-readable assemble summary |

## `Citation`

| Field | Type | Notes |
|-------|------|--------|
| `label` | `string` | Short display label, e.g. `Ledger attribute: status` |
| `kind` | `string` | `ledger_attr` | `related_record` | `graph_edge` | `document_clause` |
| `source_type` | `string` | `structured` | `graph` | `document` | `inference` |
| `source_id` | `string` | Opaque source identifier |
| `excerpt` | `string` | Truncated text / value for inline citation |
| `confidence` | `number | null` | In `[0, 1]` when set |
| `data_time` | `string | null` | ISO-8601 when known |
| `context_ptr` | `string | null` | Chunk / row / edge pointer |

## `Conflict`

| Field | Type | Notes |
|-------|------|--------|
| `identity` | `string` | Group key, e.g. `ledger_attr:attr:status` or `attr:status` |
| `kind` | `string` | Kind of the first disagreeing item (informational) |
| `values` | `ConflictValue[]` | Distinct disagreeing values with provenance |

### `ConflictValue`

| Field | Type |
|-------|------|
| `value` | any |
| `source_id` | `string` |
| `source_type` | `string` |
| `confidence` | `number | null` |
| `data_time` | `string | null` |

## Consumer notes (portal / admin)

1. Render `citations` as a list/chips; show `label` + `excerpt`, tooltip with `source_id` / `confidence`.
2. When `conflicts.length > 0`, show a warning panel listing each `identity` and its `values`.
3. When `missing.length > 0`, show a soft hint (not a hard error) for incomplete evidence.
4. Do not hard-code customer / company names; fixtures use synthetic ids only.

## Python entry

```python
from agenticx.retrieval import assemble_evidence, to_citation_view

bundle = assemble_evidence(entity_id, sources, policy=...)
view = to_citation_view(bundle)
```
