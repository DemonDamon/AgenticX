# AGX Data Suite P3-Harden-4 — JDBC / SQL channel (real driver)

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p3-harden-index.plan.md`  
> **Branch:** `feat/agx-data-suite-p3-spine` (continue; no new branch)  
> **Choice:** JDBC over Kafka — same `probe/query/write_rows` SQL shape as ClickHouse; Kafka needs a different consume model.

**Goal:** Replace P0 “kind=jdbc → FakeChannel” with a real `JdbcChannel` when a SQLAlchemy URL (or dialect+host) is present. Unit tests use in-memory SQLite — no live DB required. Kafka stays Fake for now.

**Out of scope:** Hive, Kafka, file channel real drivers; admin UI; Java JDBC bridges (jaydebeapi); A9 compute.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/channels/jdbc.py` | `JdbcChannel` (SQLAlchemy engine) |
| `agenticx/data_suite/channels/credentials.py` | `build_channel`: kind=jdbc + url/engine → JdbcChannel; tables-only jdbc still Fake |
| `agenticx/data_suite/channels/__init__.py` | Export `JdbcChannel` |
| `tests/data_suite/test_channels_jdbc.py` | SQLite unit tests + grant gates |
| `tests/data_suite/test_channels_credentials.py` | Factory routes jdbc+url → JdbcChannel |

## Interfaces

```python
@dataclass
class JdbcChannel:
    name: str
    engine: Any = None          # sqlalchemy Engine (injectable for tests)
    grants: Optional[WriteGrantStore] = None
    dialect: str = "jdbc"
    _cfg: Dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_dict(cls, name, cfg, *, grants=None) -> "JdbcChannel": ...
    # cfg keys: url | (dialect, host, port, database, username/user, password)
    # preferred url examples: sqlite+pysqlite:///:memory:, postgresql+psycopg2://...

    def probe(self) -> ChannelProbeResult: ...
    # inspector.get_table_names(); ok=False if sqlalchemy missing or connect fails

    def query(self, statement: str, *, limit: int = 200) -> ChannelQueryResult: ...
    # check_read_only_sql; append LIMIT if absent (best-effort); return columns/rows

    def write_rows(self, table: str, rows: list[dict], *, grant_id: str) -> int: ...
    # grant check → INSERT via SQLAlchemy text/core; audit like ClickHouse
```

`build_channel` rule for `kind in {"jdbc","sql","postgres","postgresql","mysql","sqlite"}`:
- If `url` or (`host`/`path`/`database`) present → `JdbcChannel.from_dict`
- Else if `tables` present (offline fixture) → keep `FakeChannel` with kind tag (backward compatible with golden_path / existing tests)
- `kind: jdbc` without url and without tables → `JdbcChannel` with empty cfg (probe ok=False)

Reuse `agenticx.connectors.database.check_read_only_sql`. Do **not** log passwords (reuse `redact_secrets` if logging).

## Tasks

### Task 1 — Failing tests + JdbcChannel (sqlite memory)

- [x] Create `tests/data_suite/test_channels_jdbc.py`:
  - `test_jdbc_probe_and_query_sqlite`: create table via engine, probe lists it, `SELECT *` returns rows
  - `test_jdbc_query_rejects_write_sql`: `DELETE` / `INSERT` via `query` raises ValueError (read-only gate)
  - `test_jdbc_write_requires_grant`: WriteDeniedError without grant; with grant inserts and returns count
  - `test_jdbc_from_dict_sqlite_url`: `from_dict(..., {"url": "sqlite+pysqlite:///:memory:"})` works
  - `test_jdbc_probe_missing_sqlalchemy`: if import fails path — optional; or monkeypatch engine connect error → ok=False
- [x] Implement `agenticx/data_suite/channels/jdbc.py`
- [x] Run: `pytest tests/data_suite/test_channels_jdbc.py -v --override-ini='addopts='`
- [x] Commit: `feat(data-suite): add JdbcChannel with SQLAlchemy + grant-gated writes`

### Task 2 — Factory + exports + credential tests

- [x] Wire `build_channel` for real jdbc when url/host present; keep Fake for tables-only
- [x] Export from `__init__.py`
- [x] Extend `test_channels_credentials.py`:
  - `test_build_jdbc_with_url_returns_jdbc_channel`
  - existing `test_build_fake_kind_from_cfg` (tables-only jdbc) must still pass
- [x] Run: `pytest tests/data_suite/test_channels_jdbc.py tests/data_suite/test_channels_credentials.py tests/data_suite/test_channels_registry.py -v --override-ini='addopts='`
- [x] Commit: `feat(data-suite): route jdbc url configs to JdbcChannel factory`

### Task 3 — Gate

- [x] Run: `pytest tests/data_suite/ -v --override-ini='addopts='` (non-integration green)
- [x] Update harden index status + after-a8 Track 2 note
- [x] Commit: `docs(plans): mark S2-4 JDBC channel slice complete`

## E2E / Done when

1. `JdbcChannel` probe/query/write_rows green on sqlite:///:memory:
2. `build_channel(kind=jdbc, url=...)` → JdbcChannel; tables-only jdbc → FakeChannel
3. Full `tests/data_suite/` non-integration suite still green
4. No customer names in code/commits
