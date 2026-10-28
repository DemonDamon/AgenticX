# AGX Data Suite P0-A1 — Channels v2 (Connectors slice)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Parent index:** `.cursor/plans/pending/2026-10-27-agx-data-suite-p0-index.plan.md`

**Goal:** Introduce a big-data **channel** abstraction (probe / read / explicitly granted write) with ClickHouse as the first real driver and fake adapters for JDBC/Hive/Kafka/file so A2 can depend on a stable registry.

**Architecture:** New `agenticx/data_suite/channels/` package. Distinct from Near SaaS connectors (`agenticx/connectors/`) and finance `data_sources` plugins. Credentials read via a thin binder over `ConfigManager` (same privacy rules as `data_sources/credential_store.py`: never log secret values). Default deny writes unless `grant_id` resolves to an allow entry.

**Tech Stack:** Python 3.10+, pytest, PyYAML; `clickhouse-connect` optional extra; fakes for offline CI.

## Global Constraints

(Inherited from P0 index.) Plus: no dependency on Electron/desktop; unit tests must pass without a live ClickHouse (real driver tests mark `@pytest.mark.integration` and skip unless `AGX_CH_URL` set).

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/__init__.py` | Package export |
| `agenticx/data_suite/channels/__init__.py` | Public channel API |
| `agenticx/data_suite/channels/base.py` | Protocols + result dataclasses |
| `agenticx/data_suite/channels/credentials.py` | Bind channel creds from config |
| `agenticx/data_suite/channels/grants.py` | Write-grant registry + audit hook |
| `agenticx/data_suite/channels/registry.py` | Name → channel factory |
| `agenticx/data_suite/channels/clickhouse.py` | ClickHouse driver |
| `agenticx/data_suite/channels/fake.py` | In-memory fake for JDBC/Hive/Kafka/file shapes |
| `tests/data_suite/test_channels_base.py` | Protocol + grant tests |
| `tests/data_suite/test_channels_clickhouse.py` | Fake + optional live CH |
| `pyproject.toml` | Optional extra `data-suite-ch` |

---

### Task 1: Package skeleton + channel protocol

**Files:**
- Create: `agenticx/data_suite/__init__.py`
- Create: `agenticx/data_suite/channels/__init__.py`
- Create: `agenticx/data_suite/channels/base.py`
- Create: `tests/data_suite/test_channels_base.py`

**Interfaces:**
- Produces: `ChannelProbeResult`, `ChannelQueryResult`, `DataChannel`, `WriteDeniedError`

- [ ] **Step 1: Write the failing test**

```python
# tests/data_suite/test_channels_base.py
import pytest
from agenticx.data_suite.channels.base import (
    ChannelProbeResult,
    ChannelQueryResult,
    WriteDeniedError,
)

def test_probe_result_to_dict():
    r = ChannelProbeResult(channel="ch", ok=True, dialect="clickhouse", tables=["t1"])
    assert r.to_dict()["tables"] == ["t1"]

def test_query_result_truncated_flag():
    q = ChannelQueryResult(columns=["a"], rows=[[1]], truncated=True)
    assert q.truncated is True

def test_write_denied_is_runtime_error():
    with pytest.raises(WriteDeniedError):
        raise WriteDeniedError("missing grant")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/data_suite/test_channels_base.py -v`
Expected: FAIL import error `agenticx.data_suite`

- [ ] **Step 3: Write minimal implementation**

```python
# agenticx/data_suite/__init__.py
"""AGX Data Suite — enterprise data intelligence building blocks."""

__all__ = ["channels"]

# agenticx/data_suite/channels/__init__.py
from agenticx.data_suite.channels.base import (
    ChannelProbeResult,
    ChannelQueryResult,
    DataChannel,
    WriteDeniedError,
)

__all__ = [
    "ChannelProbeResult",
    "ChannelQueryResult",
    "DataChannel",
    "WriteDeniedError",
]

# agenticx/data_suite/channels/base.py
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol, runtime_checkable

class WriteDeniedError(RuntimeError):
    """Raised when write_rows is called without a valid grant."""

@dataclass
class ChannelProbeResult:
    channel: str
    ok: bool
    dialect: str = ""
    tables: List[str] = field(default_factory=list)
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "channel": self.channel,
            "ok": self.ok,
            "dialect": self.dialect,
            "tables": list(self.tables),
            "error": self.error,
        }

@dataclass
class ChannelQueryResult:
    columns: List[str]
    rows: List[List[Any]]
    truncated: bool = False

@runtime_checkable
class DataChannel(Protocol):
    name: str

    def probe(self) -> ChannelProbeResult: ...

    def query(self, statement: str, *, limit: int = 200) -> ChannelQueryResult: ...

    def write_rows(self, table: str, rows: list[dict], *, grant_id: str) -> int: ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/data_suite/test_channels_base.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agenticx/data_suite tests/data_suite/test_channels_base.py
git commit -m "feat(data-suite): add channel protocol skeleton for P0-A1"
```

---

### Task 2: Write grants + audit hook

**Files:**
- Create: `agenticx/data_suite/channels/grants.py`
- Modify: `tests/data_suite/test_channels_base.py`

**Interfaces:**
- Produces: `WriteGrantStore.has_grant(grant_id, channel, table) -> bool`, `WriteGrantStore.record_write(...)`

- [ ] **Step 1: Write the failing test**

```python
from agenticx.data_suite.channels.grants import WriteGrantStore

def test_grant_store_denies_unknown():
    store = WriteGrantStore(grants={"g1": {"channel": "ch", "table": "events"}})
    assert store.has_grant("g1", "ch", "events") is True
    assert store.has_grant("g1", "ch", "other") is False
    assert store.has_grant("missing", "ch", "events") is False

def test_grant_store_records_audit():
    store = WriteGrantStore(grants={"g1": {"channel": "ch", "table": "events"}})
    store.record_write(grant_id="g1", channel="ch", table="events", row_count=3)
    assert store.audit[-1]["row_count"] == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/data_suite/test_channels_base.py::test_grant_store_denies_unknown -v`
Expected: FAIL import `WriteGrantStore`

- [ ] **Step 3: Write minimal implementation**

```python
# agenticx/data_suite/channels/grants.py
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List

@dataclass
class WriteGrantStore:
    grants: Dict[str, Dict[str, str]] = field(default_factory=dict)
    audit: List[Dict[str, Any]] = field(default_factory=list)

    def has_grant(self, grant_id: str, channel: str, table: str) -> bool:
        g = self.grants.get(grant_id)
        if not g:
            return False
        return g.get("channel") == channel and g.get("table") == table

    def record_write(self, *, grant_id: str, channel: str, table: str, row_count: int) -> None:
        self.audit.append({
            "ts": datetime.now(timezone.utc).isoformat(),
            "grant_id": grant_id,
            "channel": channel,
            "table": table,
            "row_count": row_count,
        })
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/data_suite/test_channels_base.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agenticx/data_suite/channels/grants.py tests/data_suite/test_channels_base.py
git commit -m "feat(data-suite): add write grant store with audit log"
```

---

### Task 3: Fake channel + registry

**Files:**
- Create: `agenticx/data_suite/channels/fake.py`
- Create: `agenticx/data_suite/channels/registry.py`
- Create: `tests/data_suite/test_channels_registry.py`

**Interfaces:**
- Produces: `FakeChannel`, `ChannelRegistry.register/get/probe_all`
- Consumes: `WriteGrantStore`, `DataChannel`

- [ ] **Step 1: Write the failing test**

```python
# tests/data_suite/test_channels_registry.py
import pytest
from agenticx.data_suite.channels.fake import FakeChannel
from agenticx.data_suite.channels.grants import WriteGrantStore
from agenticx.data_suite.channels.registry import ChannelRegistry
from agenticx.data_suite.channels.base import WriteDeniedError

def test_fake_probe_and_query():
    ch = FakeChannel(name="jdbc_demo", tables={"users": [{"id": 1, "n": "a"}]})
    assert ch.probe().ok is True
    q = ch.query("SELECT * FROM users", limit=10)
    assert q.columns == ["id", "n"]
    assert q.rows == [[1, "a"]]

def test_fake_write_requires_grant():
    grants = WriteGrantStore(grants={"g1": {"channel": "jdbc_demo", "table": "users"}})
    ch = FakeChannel(name="jdbc_demo", tables={"users": []}, grants=grants)
    with pytest.raises(WriteDeniedError):
        ch.write_rows("users", [{"id": 2}], grant_id="nope")
    assert ch.write_rows("users", [{"id": 2}], grant_id="g1") == 1

def test_registry_get():
    reg = ChannelRegistry()
    reg.register(FakeChannel(name="hive_demo", tables={}))
    assert reg.get("hive_demo").name == "hive_demo"
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/data_suite/test_channels_registry.py -v`
Expected: FAIL missing modules

- [ ] **Step 3: Implement FakeChannel + ChannelRegistry**

Implement `FakeChannel` with in-memory tables; `query` supports only `SELECT * FROM <table>` for P0; `write_rows` checks grants. `ChannelRegistry` holds `dict[str, DataChannel]`.

- [ ] **Step 4: Tests pass**

Run: `pytest tests/data_suite/test_channels_registry.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agenticx/data_suite/channels/fake.py agenticx/data_suite/channels/registry.py tests/data_suite/test_channels_registry.py
git commit -m "feat(data-suite): fake channels and registry for P0"
```

---

### Task 4: ClickHouse driver (optional live)

**Files:**
- Create: `agenticx/data_suite/channels/clickhouse.py`
- Create: `tests/data_suite/test_channels_clickhouse.py`
- Modify: `pyproject.toml` (optional dependency group if present; else document env install)

**Interfaces:**
- Produces: `ClickHouseChannel.from_env()` / `from_dict(cfg)`
- Consumes: `WriteGrantStore`

- [ ] **Step 1: Write unit test with monkeypatched client**

```python
# tests/data_suite/test_channels_clickhouse.py
from agenticx.data_suite.channels.clickhouse import ClickHouseChannel
from agenticx.data_suite.channels.grants import WriteGrantStore

class _FakeClient:
    def query(self, sql):
        class R:
            column_names = ["x"]
            result_rows = [[1]]
        return R()
    def command(self, sql):
        return None
    def insert(self, table, rows, column_names):
        self.last = (table, rows, column_names)

def test_clickhouse_query_with_fake_client():
    ch = ClickHouseChannel(name="ch", client=_FakeClient(), grants=WriteGrantStore())
    q = ch.query("SELECT 1", limit=10)
    assert q.rows == [[1]]
```

- [ ] **Step 2: Fail then implement ClickHouseChannel**

Use lazy import of `clickhouse_connect`; if missing, `probe()` returns `ok=False` with error `clickhouse-connect not installed`. Enforce read-only SQL gate similar to `agenticx/connectors/database.py` (`SELECT/WITH/SHOW/DESCRIBE/EXPLAIN` only) for `query`. `write_rows` requires grant then `client.insert`.

- [ ] **Step 3: Optional integration test**

```python
import os, pytest

@pytest.mark.integration
@pytest.mark.skipif(not os.getenv("AGX_CH_URL"), reason="AGX_CH_URL not set")
def test_live_clickhouse_probe():
    ch = ClickHouseChannel.from_env()
    assert ch.probe().ok is True
```

- [ ] **Step 4: Commit**

```bash
git add agenticx/data_suite/channels/clickhouse.py tests/data_suite/test_channels_clickhouse.py
git commit -m "feat(data-suite): ClickHouse channel with grant-gated writes"
```

---

### Task 5: Credential binder + catalog entry for channel kinds

**Files:**
- Create: `agenticx/data_suite/channels/credentials.py`
- Create: `tests/data_suite/test_channels_credentials.py`

**Interfaces:**
- Produces: `load_channel_config(name) -> dict`, `build_channel(name) -> DataChannel`

- [ ] Read config key `data_suite.channels.<name>` from `ConfigManager` (mirror `get_plugin_config` style; never log password/token).
- [ ] Factory maps `kind: clickhouse|fake|jdbc|hive|kafka|file` → class (`jdbc/hive/kafka/file` → `FakeChannel` with kind tag for P0).
- [ ] Tests cover missing config and fake kind build.
- [ ] Commit: `feat(data-suite): channel credential binder and factory`

---

### Task 6: A1 Done gate

- [ ] Run: `pytest tests/data_suite/ -v`
- [ ] Expected: all non-integration tests PASS
- [ ] Update parent index checkbox / note in commit message
- [ ] Commit docs-only note if needed: `docs(plans): mark P0-A1 channels slice complete`

**A1 Done criteria:** protocol + grants + registry + fake multi-kind + ClickHouse unit path green; live CH optional.
