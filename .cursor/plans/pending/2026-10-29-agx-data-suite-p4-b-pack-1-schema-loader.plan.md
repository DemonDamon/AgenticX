# AGX Data Suite P4-B-Pack-1 — Pack schema + loader

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-data-suite-p4-b-pack-index.plan.md`

**Goal:** Define the delivery-pack manifest and a pure loader that reads a pack directory into typed objects (no side effects yet).

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/pack/__init__.py` | Export PackManifest, LoadedPack, load_pack, PackError |
| `agenticx/data_suite/pack/manifest.py` | Dataclasses |
| `agenticx/data_suite/pack/loader.py` | `load_pack(root: Path) -> LoadedPack` |
| `tests/data_suite/fixtures/mini_pack/pack.yaml` | Minimal fixture |
| `tests/data_suite/test_pack_loader.py` | TDD |

## Interfaces

```python
class PackError(ValueError): ...

@dataclass(frozen=True)
class PackManifest:
    id: str
    version: str
    display_name: str
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
    sections: dict[str, object]  # parsed YAML/JSON per section; {} if absent
```

### Task 1

- [ ] Failing test: empty dir → PackError (missing pack.yaml).
- [ ] Mini fixture + implement loader → green.
- [ ] Commit: `feat(data-suite): delivery pack manifest and loader`
