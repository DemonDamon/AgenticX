# AGX Data Suite H2 — Hive / Spark Thrift channel

> **Parent:** `.cursor/plans/pending/2026-10-30-data-suite-p3-harden.plan.md`  
> **Branch:** `feat/agx-data-suite-h2-hive-channel`  
> **Depends on:** H1 FileChannel merged; JDBC/ClickHouse probe/query/write_rows shape.  
> **Main-repo gate:** 通用湖仓连接器 only；禁止现场拓扑 / 客户库表命名进引擎。

**Goal:** Real `HiveChannel` implementing `DataChannel` for HiveServer2 / Spark Thrift SQL. Same `SELECT * FROM <table>` / grant-gated `write_rows` contract as JDBC/ClickHouse. Unit tests use an **injectable cursor/connection** or SQLite-shaped fake thrift client — **no live Hive required for CI**. Optional live pyhive/thrift wiring deferred (probe ok=False with clear error if endpoint set but lib missing), mirroring Kafka/File.

**Out of scope:** File channel changes; compute pushdown / vectorized fetch; Kerberos deep wiring beyond cfg passthrough; admin UI; customer schemas; A9.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/channels/hive.py` | `HiveChannel` + injectable transport/connection |
| `agenticx/data_suite/channels/credentials.py` | kind=hive routing: host/url/thrift_uri → HiveChannel; tables-only → Fake |
| `agenticx/data_suite/channels/__init__.py` | Export `HiveChannel` |
| `tests/data_suite/test_channels_hive.py` | Unit tests |
| `tests/data_suite/test_channels_credentials.py` | Factory routing |
| `examples/data_suite/golden_path/README.md` | Note Hive variant (Fake/tables or memory); don't break Fake path |

## Interfaces

```python
@dataclass
class InMemoryHiveTransport:
    """table -> list[dict]; list_tables / execute_query / execute_write for CI."""
    ...

@dataclass
class HiveChannel:
    name: str
    transport: Any = None  # duck: list_tables(); query(sql, limit)->(cols, rows); write(table, rows)->int
    grants: Optional[WriteGrantStore] = None
    dialect: str = "hive"
    _cfg: Dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_dict(cls, name, cfg, *, grants=None, transport=None) -> "HiveChannel":
        # cfg: host | thrift_uri | url | port | database | username | password
        # no endpoint → seed InMemoryHiveTransport from cfg tables

    def probe(self) -> ChannelProbeResult:  # dialect=hive; tables=; ok=False on connect error
    def query(self, statement, *, limit=200) -> ChannelQueryResult:
        # Prefer read-only gate (reuse check_read_only_sql if statement is SQL);
        # at minimum SELECT * FROM <ident> like Kafka for memory transport
    def write_rows(self, table, rows, *, grant_id) -> int  # default deny without grant
```

`build_channel` for `kind == "hive"` (and optionally `spark` / `sparksql` alias):
- If `host` / `thrift_uri` / `url` present → `HiveChannel.from_dict`
- Else if `tables` only → `FakeChannel(kind="hive")`
- Else → empty memory `HiveChannel`

Default: **read-only**; writes only with grant (same as other channels). No topology assumptions (no hardcoded ZK quorum / dual-DC).

## Tasks

### Task 1 — Tests + HiveChannel (in-memory) TDD
- [x] `tests/data_suite/test_channels_hive.py`: probe, query+truncate, reject non-SELECT (or write SQL), write grant deny/allow, from_dict seed, endpoint without lib → probe ok=False
- [x] Implement `hive.py`
- [x] Commit: `feat(data-suite): add HiveChannel with in-memory transport + grants`

### Task 2 — Factory + exports
- [x] Wire credentials `build_channel`; export; credential tests
- [x] Commit: `feat(data-suite): route hive configs to HiveChannel factory`

### Task 3 — Gate + PR
- [x] golden_path README note (desensitized)
- [x] `pytest tests/data_suite/test_channels_hive.py tests/data_suite/test_channels_credentials.py tests/data_suite/test_golden_path_probe.py -v --override-ini='addopts='` green
- [x] `pytest tests/data_suite/ -v --override-ini='addopts='` green
- [x] Mark plan checkboxes; push; `gh pr create` to main
- [x] Do **not** start H3 on this branch

## Done when
1. HiveChannel probe/query/write_rows green on in-memory transport
2. Factory: endpoint → HiveChannel; tables-only hive → FakeChannel
3. Full `tests/data_suite/` green; no customer names
4. A1 five channel kinds now have real modules: clickhouse/jdbc/kafka/file/hive (Fake still for offline fixtures)

## Gate before H3
Only after this PR merged (or user says stack) — H3 is governance admin, separate branch from main tip.
