# AGX Data Suite P1-A5-1 — Tag Catalog / Metamodel

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p1-a5-index.plan.md`

**Goal:** YAML tag catalog with 3-level layering, four-elements metadata, owner, and same-name-different-meaning rejection.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/tags/__init__.py` | Exports |
| `agenticx/data_suite/tags/catalog.py` | `TagDef`, `TagCatalog` |
| `tests/data_suite/fixtures/sample_tags.yaml` | Core tags fixture |
| `tests/data_suite/test_tags_catalog.py` | Load / conflict / list |

## Interfaces

```python
@dataclass(frozen=True)
class TagDef:
    name: str
    layer: str  # L1|L2|L3
    business_def: str
    calc_logic: str
    update_freq: str
    owner: str
    meaning_key: str  # disambiguator; same name+meaning_key conflicts

class TagCatalog:
    def load(self, path: str | Path) -> None: ...
    def get(self, name: str, *, meaning_key: str | None = None) -> TagDef: ...
    def list_tags(self, *, layer: str | None = None) -> list[TagDef]: ...
```

### Task 1

- [x] Tests: load sample; list by layer; duplicate name with different meaning_key allowed as two entries keyed by meaning_key; duplicate name+meaning_key raises `TagConflictError`.
- [x] Implement + commit: `feat(data-suite): tag catalog metamodel with layer and four elements`
