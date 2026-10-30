# AGX Data Suite H1 — File channel (SFTP / object storage)

> **Parent:** `.cursor/plans/pending/2026-10-30-data-suite-p3-harden.plan.md`  
> **Branch:** `feat/agx-data-suite-h1-file-channel`  
> **Depends on:** Kafka/JDBC channel pattern (injectable transport / offline CI).  
> **Main-repo gate:** 通用通道积木 only；禁止客户目录规范进引擎。

**Goal:** Real `FileChannel` implementing `DataChannel`. Logical datasets map to probe `tables`. `query` keeps `SELECT * FROM <table>` so DataFlow jobs stay unchanged. Unit tests use an in-memory / local-fs injectable transport — **no live SFTP/OSS required for CI**. Path/partition layout is a **configurable policy** (injected path template); do **not** hardcode `date=YYYYMMDD` in the channel kernel. Example layout only in golden-path / tests.

**Out of scope:** Hive channel (H2); admin UI; live SFTP/OSS SDK hard dependency in CI; customer partition conventions; A9; delivery_pack content.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/channels/file.py` | `FileChannel` + `InMemoryFileTransport` + optional local-fs transport; path policy hook |
| `agenticx/data_suite/channels/credentials.py` | kind=file routing: endpoint/root → FileChannel; tables-only → Fake (compat) |
| `agenticx/data_suite/channels/__init__.py` | Export `FileChannel` |
| `tests/data_suite/test_channels_file.py` | Unit tests (probe/query/write/retry/grants/path policy) |
| `tests/data_suite/test_channels_credentials.py` | Factory routing tests for file |
| `examples/data_suite/golden_path/` | Optional file-channel variant seed + README note (minimal) |

## Interfaces

```python
@dataclass
class PathLayoutPolicy:
    """Injectable path/partition strategy. Engine default: flat `{table}/{name}`."""
    def list_keys(self, table: str) -> list[str]: ...
    def resolve_read(self, table: str, key: str) -> str: ...
    def resolve_write(self, table: str, key: str) -> str: ...

@dataclass
class InMemoryFileTransport:
    # root dict: table -> key -> list[dict] rows (or bytes/json lines as list[dict] for CI)
    def list_tables(self) -> list[str]: ...
    def list_objects(self, table: str) -> list[str]: ...
    def read_rows(self, table: str, *, limit: int = 200) -> list[dict]: ...
    def write_rows(self, table: str, rows: list[dict]) -> int: ...
    # optional: simulate transient failure for retry tests via fail_times

@dataclass
class FileChannel:
    name: str
    transport: Any = None
    grants: Optional[WriteGrantStore] = None
    dialect: str = "file"
    path_policy: Any = None  # optional; transport may embed policy
    _cfg: Dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_dict(cls, name, cfg, *, grants=None, transport=None) -> "FileChannel":
        # cfg keys (neutral): root | base_path | sftp_host | endpoint | bucket
        # optional path_template string for LocalFs later; default flat
        # no bootstrap/endpoint → seed InMemoryFileTransport from cfg tables

    def probe(self) -> ChannelProbeResult:  # dialect=file; tables=logical datasets
    def query(self, statement, *, limit=200) -> ChannelQueryResult:  # SELECT * FROM <table>
    def write_rows(self, table, rows, *, grant_id) -> int
```

`build_channel` for `kind == "file"`:
- If `root` / `base_path` / `sftp_host` / `endpoint` / `bucket` present → `FileChannel.from_dict`
- Else if `tables` only → keep `FakeChannel(kind="file")` for golden_path compat (mirror kafka)
- Else → `FileChannel` empty memory

Retry: transport or channel retries transient `TransientFileError` up to N (cfg `retries` default 2) with simple loop; unit-test with fail-then-succeed transport.

## Tasks

### Task 1 — Tests + FileChannel (in-memory) — TDD
- [x] `tests/data_suite/test_channels_file.py`:
  - probe lists seeded tables
  - query `SELECT * FROM members` + truncated
  - query non-SELECT raises
  - write_rows denied without grant; allowed with grant
  - from_dict tables seeds memory transport
  - path policy injectable: custom policy keys used (assert not hardcoded date=)
  - retry: transport fails once then succeeds on read or write
- [x] Implement `file.py`
- [x] Commit: `feat(data-suite): add FileChannel with in-memory transport + grants`

### Task 2 — Factory + exports
- [x] Wire `build_channel` file routing
- [x] Export `FileChannel`; credential tests for endpoint → FileChannel, tables-only → Fake
- [x] Commit: `feat(data-suite): route file channel configs to FileChannel factory`

### Task 3 — Golden-path touch + gate
- [x] Minimal golden-path note or optional file variant in probe/README (desensitized fake data only); do not break existing Fake golden-path
- [x] `pytest tests/data_suite/test_channels_file.py tests/data_suite/test_channels_credentials.py tests/data_suite/test_golden_path_probe.py -v --override-ini='addopts='` green
- [x] Broader: `pytest tests/data_suite/ -v --override-ini='addopts='` green (or document skips)
- [x] Mark H1 checkboxes in this plan; parent harden plan status note optional
- [x] Commit + push + open PR to main
- [x] Commit: `test(data-suite): FileChannel credentials + golden-path smoke`

## Done when
1. FileChannel probe/query/write_rows green on in-memory transport with grants
2. Path/partition is configurable; no `date=YYYYMMDD` hardcoded in `file.py`
3. Factory: endpoint/root → FileChannel; tables-only file → FakeChannel
4. Full `tests/data_suite/` suite green
5. No customer names; PR opened after local E2E pytest green

## Gate before H2
Only after this PR is green locally (pytest) and pushed/opened — do **not** start H2 on the same branch until H1 is merged or explicitly stacked.
