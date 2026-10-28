# AGX Data Suite P3-Harden-5 — Kafka channel

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p3-harden-index.plan.md`  
> **Branch:** `feat/agx-data-suite-p3-spine`  
> **Depends on:** S2-4 JdbcChannel pattern (injectable client / offline CI).

**Goal:** Real `KafkaChannel` implementing `DataChannel`. Topics map to probe `tables`. `query` keeps the Fake/JDBC-compatible `SELECT * FROM <topic>` shape so DataFlow jobs do not need a second DSL. Unit tests use an in-memory / injected transport — **no live Kafka required**. Optional live bootstrap via injectable admin/producer later; do not hard-require `confluent-kafka` for CI.

**Out of scope:** Hive/file real drivers; consumer-group offset commit UX; schema registry; admin UI; A9.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/channels/kafka.py` | `KafkaChannel` + small in-memory transport |
| `agenticx/data_suite/channels/credentials.py` | kind=kafka + bootstrap/topics endpoint → KafkaChannel; tables-only → Fake |
| `agenticx/data_suite/channels/__init__.py` | Export `KafkaChannel` |
| `tests/data_suite/test_channels_kafka.py` | Unit tests |
| `tests/data_suite/test_channels_credentials.py` | Factory routing test |

## Interfaces

```python
@dataclass
class KafkaChannel:
    name: str
    transport: Any = None   # duck type: list_topics() -> list[str]; read(topic, limit) -> list[dict]; write(topic, rows) -> int
    grants: Optional[WriteGrantStore] = None
    dialect: str = "kafka"
    _cfg: Dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_dict(cls, name, cfg, *, grants=None) -> "KafkaChannel":
        # cfg: bootstrap_servers | bootstrap | servers; optional topics: list[str] or seed tables/dict
        # If no transport injected and no bootstrap → InMemoryKafkaTransport seeded from cfg tables/topics

    def probe(self) -> ChannelProbeResult:  # dialect=kafka; tables=topic names; ok=False on transport error
    def query(self, statement, *, limit=200) -> ChannelQueryResult:  # only SELECT * FROM <topic>
    def write_rows(self, table, rows, *, grant_id) -> int:  # grant then transport.write
```

`build_channel` for `kind == "kafka"`:
- If `bootstrap_servers` / `bootstrap` / `servers` present → `KafkaChannel.from_dict` (live cfg; transport may still be memory until a live client is wired — acceptable if probe documents missing client as ok=False **or** memory fallback only when explicitly `mode: memory`)
- Prefer: bootstrap present → KafkaChannel with lazy live client **or** injectable; if live lib missing, probe ok=False with clear error (mirror ClickHouse missing clickhouse-connect)
- Else if `tables` only (offline fixture) → keep `FakeChannel(kind="kafka")` for golden_path compat
- Else → `KafkaChannel` empty / memory

**Recommended S2 transport split:**
1. `InMemoryKafkaTransport` — always available; seed from `tables`/`topics`
2. Optional live: if bootstrap set, try import `confluent_kafka` or `kafka` (kafka-python); if missing, probe ok=False. Do **not** add a hard pyproject dependency unless adding optional extra `data-suite-kafka`. Prefer optional extra stub in plan note; unit tests never need it.

## Tasks

### Task 1 — Tests + KafkaChannel (in-memory)

- [x] `tests/data_suite/test_channels_kafka.py`:
  - probe lists seeded topics
  - query `SELECT * FROM events` returns rows / truncated
  - query non-SELECT raises
  - write_rows denied without grant; allowed with grant appends
  - from_dict with tables seeds memory transport
- [x] Implement `kafka.py`
- [x] Commit: `feat(data-suite): add KafkaChannel with in-memory transport + grants`

### Task 2 — Factory + exports

- [x] Wire `build_channel` kafka routing (bootstrap → KafkaChannel; tables-only → Fake)
- [x] Export; credential test `test_build_kafka_with_bootstrap_returns_kafka_channel` (may probe ok=False without lib — still isinstance KafkaChannel). Also keep tables-only kafka → Fake if any such test exists / add one.
- [x] Commit: `feat(data-suite): route kafka bootstrap configs to KafkaChannel factory`

### Task 3 — Gate

- [x] `pytest tests/data_suite/ -v --override-ini='addopts='` green
- [x] Update harden index + after-a8 Track 2; mark plan checkboxes
- [x] Commit: `docs(plans): mark S2-5 Kafka channel slice complete`

## Done when

1. KafkaChannel probe/query/write_rows green on in-memory transport
2. Factory: bootstrap → KafkaChannel; tables-only kafka → FakeChannel
3. Full data_suite non-integration suite green
4. No customer names; no push
