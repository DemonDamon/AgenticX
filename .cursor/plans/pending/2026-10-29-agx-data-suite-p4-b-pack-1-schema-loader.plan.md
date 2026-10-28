# AGX Data Suite P4-B-Pack-1 — Pack schema + loader

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-data-suite-p4-b-pack-index.plan.md`

**Goal:** Define the delivery-pack manifest and a pure loader that reads a pack directory into typed objects (no side effects yet).

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/pack/__init__.py` | Export PackManifest, load_pack |
| `agenticx/data_suite/pack/manifest.py` | Dataclasses: PackManifest, PackPaths |
| `agenticx/data_suite/pack/loader.py` | `load_pack(root: Path) -> LoadedPack` |
| `tests/data_suite/test_pack_loader.py` | TDD: missing pack.yaml fails; minimal pack loads |

## Interfaces

```python
@dataclass(frozen=True)
class PackManifest:
    id: str
    version: str
    display_name: str
    # relative paths inside pack root
    channels: str | None = "channels"
    dictionary: str | None = "dictionary"
    quality: str | None = "quality"
    tags: str | None = "tags"
    boards: str | None = "boards"
    idmapping: str | None = "idmapping"
    iam: str | None = "iam"

@dataclass
class LoadedPack:
    root: Path
    manifest: PackManifest
    # raw parsed YAML/JSON payloads keyed by section (empty dict if section absent)
    sections: dict[str, dict | list]
```

### Task 1

- [ ] Failing test: `load_pack` on empty dir raises `FileNotFoundError` / `PackError` for missing `pack.yaml`.
- [ ] Minimal fixture pack under `tests/data_suite/fixtures/mini_pack/` with `pack.yaml` only.
- [ ] Implement manifest + loader; green tests.
- [ ] Commit: `feat(data-suite): delivery pack manifest and loader`
