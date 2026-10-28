# AGX Data Suite P1-A4-1 — Field Dictionary / Metadata Catalog

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Parent index:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p1-index.plan.md`

**Goal:** Ship a config-driven **field-level data dictionary** (四要素: business definition / calc logic / update frequency / owner) that loads from YAML and supports lookup/list — the foundation for cleaning rules, trust grades, and admin 数据治理 UI.

**Architecture:** New `agenticx/data_suite/governance/` package. Distinct from finance plugin catalog `agenticx/data_sources/catalog.py` (that is plugin discovery, not field metadata). Dictionary is pure config; no project-specific field names in trunk — fixtures under `tests/data_suite/fixtures/`.

**Tech Stack:** Python 3.10+, pytest, PyYAML.

## Global Constraints

(Inherited from P1 index.) Unit tests offline-only. Do not edit `data_sources/catalog.py` for this — leave plugin catalog alone.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/governance/__init__.py` | Public governance exports |
| `agenticx/data_suite/governance/dictionary.py` | `FieldDef`, `DictionaryCatalog` |
| `tests/data_suite/fixtures/sample_dictionary.yaml` | Synthetic fields |
| `tests/data_suite/test_governance_dictionary.py` | Load / get / list / missing field |

---

### Task 1: FieldDef + DictionaryCatalog load/get/list

**Files:**
- Create: `agenticx/data_suite/governance/__init__.py`
- Create: `agenticx/data_suite/governance/dictionary.py`
- Create: `tests/data_suite/fixtures/sample_dictionary.yaml`
- Create: `tests/data_suite/test_governance_dictionary.py`

**Interfaces:**
- Produces: `FieldDef`, `DictionaryCatalog`, `FieldNotFoundError`

- [ ] **Step 1: Write the failing test**

```python
# tests/data_suite/test_governance_dictionary.py
from pathlib import Path
import pytest
from agenticx.data_suite.governance.dictionary import (
    DictionaryCatalog,
    FieldNotFoundError,
)

FIXTURE = Path(__file__).parent / "fixtures" / "sample_dictionary.yaml"

def test_load_and_get_four_elements():
    cat = DictionaryCatalog()
    cat.load(FIXTURE)
    f = cat.get("member_id")
    assert f.name == "member_id"
    assert f.business_def
    assert f.calc_logic
    assert f.update_freq == "daily"
    assert f.owner == "data-platform"

def test_list_fields_sorted():
    cat = DictionaryCatalog()
    cat.load(FIXTURE)
    names = [x.name for x in cat.list_fields()]
    assert names == sorted(names)
    assert "member_id" in names

def test_missing_field_raises():
    cat = DictionaryCatalog()
    cat.load(FIXTURE)
    with pytest.raises(FieldNotFoundError):
        cat.get("does_not_exist")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/data_suite/test_governance_dictionary.py -v`
Expected: FAIL import error `agenticx.data_suite.governance`

- [ ] **Step 3: Write fixture + minimal implementation**

```yaml
# tests/data_suite/fixtures/sample_dictionary.yaml
fields:
  - name: member_id
    business_def: Stable member primary key after OneID merge
    calc_logic: idmapping.merge primary
    update_freq: daily
    owner: data-platform
  - name: mobile_hash
    business_def: Hashed mobile used as ID edge
    calc_logic: sha256(mobile_e164)
    update_freq: daily
    owner: data-platform
```

```python
# agenticx/data_suite/governance/dictionary.py
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Union
import yaml

class FieldNotFoundError(KeyError):
    """Raised when a field name is not in the dictionary."""

@dataclass(frozen=True)
class FieldDef:
    name: str
    business_def: str
    calc_logic: str
    update_freq: str
    owner: str

class DictionaryCatalog:
    def __init__(self) -> None:
        self._fields: Dict[str, FieldDef] = {}

    def load(self, path: Union[str, Path]) -> None:
        data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
        self._fields.clear()
        for row in data.get("fields") or []:
            fd = FieldDef(
                name=str(row["name"]),
                business_def=str(row.get("business_def") or ""),
                calc_logic=str(row.get("calc_logic") or ""),
                update_freq=str(row.get("update_freq") or ""),
                owner=str(row.get("owner") or ""),
            )
            self._fields[fd.name] = fd

    def get(self, field: str) -> FieldDef:
        try:
            return self._fields[field]
        except KeyError as e:
            raise FieldNotFoundError(field) from e

    def list_fields(self) -> List[FieldDef]:
        return [self._fields[k] for k in sorted(self._fields)]
```

```python
# agenticx/data_suite/governance/__init__.py
from agenticx.data_suite.governance.dictionary import (
    DictionaryCatalog,
    FieldDef,
    FieldNotFoundError,
)

__all__ = ["DictionaryCatalog", "FieldDef", "FieldNotFoundError"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/data_suite/test_governance_dictionary.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agenticx/data_suite/governance tests/data_suite/test_governance_dictionary.py tests/data_suite/fixtures/sample_dictionary.yaml
git commit -m "feat(data-suite): field dictionary catalog with four-element metadata"
```

---

### Task 2: Reload replaces previous definitions + empty catalog edge

**Files:**
- Modify: `tests/data_suite/test_governance_dictionary.py`
- Modify: `agenticx/data_suite/governance/dictionary.py` (only if needed)

- [ ] **Step 1: Write failing tests**

```python
def test_reload_replaces_fields(tmp_path):
    p1 = tmp_path / "d1.yaml"
    p1.write_text(
        "fields:\n  - name: a\n    business_def: x\n    calc_logic: y\n"
        "    update_freq: daily\n    owner: o\n",
        encoding="utf-8",
    )
    p2 = tmp_path / "d2.yaml"
    p2.write_text(
        "fields:\n  - name: b\n    business_def: x\n    calc_logic: y\n"
        "    update_freq: weekly\n    owner: o\n",
        encoding="utf-8",
    )
    cat = DictionaryCatalog()
    cat.load(p1)
    cat.load(p2)
    assert [f.name for f in cat.list_fields()] == ["b"]

def test_empty_yaml_lists_nothing(tmp_path):
    p = tmp_path / "empty.yaml"
    p.write_text("fields: []\n", encoding="utf-8")
    cat = DictionaryCatalog()
    cat.load(p)
    assert cat.list_fields() == []
```

- [ ] **Step 2–4:** Run fail → implement if missing → PASS → commit

```bash
git commit -am "test(data-suite): dictionary reload and empty catalog edges"
```

## Done criteria (A4-1)

- [ ] `pytest tests/data_suite/test_governance_dictionary.py -v` green
- [ ] Four elements present on every `FieldDef`
- [ ] No changes to `agenticx/data_sources/catalog.py`
