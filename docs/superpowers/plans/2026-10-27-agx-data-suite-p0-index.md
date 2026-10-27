# AGX Data Suite P0 — Subplan Index

> **Parent:** `.cursor/plans/pending/2026-10-27-agx-data-suite.plan.md`
> **For agentic workers:** Execute subplans **in order**. Do not start P1 (A4–A6) until this index’s Done criteria pass.
> **Execution owner:** agx 开发 — sequential, one subplan at a time; optional cloud agent per task inside a subplan.

**Goal:** Ship the P0 hard gate: connect → declare a job → run OneID-style ID mapping with snapshot replay, without building a customer-side lakehouse.

**Architecture:** New package `agenticx/data_suite/` owns job DSL, ID-Mapping, and channel abstractions. Big-data channels plug into `agenticx/data_suite/channels/` (not Near SaaS connectors / Enterprise OpenConnector gateway). Reuse `credential_store` patterns, `flow` progress semantics, and `studio/automation_scheduler` only as a timer hook — DataFlow has its own runner.

**Tech Stack:** Python 3.10+, pytest, PyYAML, existing `agenticx` package layout; optional `clickhouse-connect` behind extras; no Spark cluster in-process.

## Global Constraints

- Compute stays on customer side; AGX only connects, orchestrates, governs config, and runs agents.
- Default channel mode is **read-only**; writes require explicit grant + audit event.
- No project-specific ID types, dictionaries, or brand logic in trunk — YAML/config only.
- Do not mix with `desktop/` Near connector market or `enterprise` OpenConnector gateway workstreams.
- `customers/` may hold B-layer fixtures later; P0 tests use synthetic fixtures under `tests/data_suite/`.
- Prefer TDD; commit after each green task.
- P0 person-month estimate is aggressive: each subplan ships a **vertical slice**, not production-hard every vendor driver.

## Subplan order

| # | Subplan | Path | Done when |
|---|---------|------|-----------|
| 1 | A1 Channels v2 (slice) | `.cursor/plans/pending/2026-10-27-agx-data-suite-p0-a1-channels.plan.md` | Channel protocol + credential binding + ClickHouse probe + authorized write stub + fake JDBC/Kafka/Hive adapters green in pytest |
| 2 | A2 DataFlow jobs | `.cursor/plans/pending/2026-10-27-agx-data-suite-p0-a2-dataflow.plan.md` | YAML job DSL runs extract→clean→transform→load→snapshot with lineage log + schedule hook |
| 3 | A3 ID-Mapping | `.cursor/plans/pending/2026-10-27-agx-data-suite-p0-a3-idmapping.plan.md` | Configurable two-ID merge with conflict policy + snapshot replay; plugs into A2 as a transform node |

## Cross-subplan contracts (lock these names)

```python
# agenticx/data_suite/channels/base.py
class ChannelProbeResult: ...
class ChannelQueryResult: ...
class DataChannel(Protocol):
    name: str
    def probe(self) -> ChannelProbeResult: ...
    def query(self, statement: str, *, limit: int = 200) -> ChannelQueryResult: ...
    def write_rows(self, table: str, rows: list[dict], *, grant_id: str) -> int: ...

# agenticx/data_suite/jobs/dsl.py
def load_job(path: str | Path) -> JobSpec: ...
async def run_job(spec: JobSpec, *, channels: ChannelRegistry, idmaps: IdMapRegistry) -> JobRunResult: ...

# agenticx/data_suite/idmapping/engine.py
class IdMappingEngine:
    def merge(self, records: list[dict], *, as_of: str | None = None) -> MergeResult: ...
    def replay(self, snapshot_id: str) -> MergeResult: ...
```

## Out of scope for P0

- A4 governance UI, A5 tags/audience, A6 configurable BI, A7 masking/watermark (pull forward only if bid-critical — separate plan), A8 Managed Agent templates.
- Replacing customer CDP / lakehouse.
- Production Hive metastore / Kerberos hardening (interface + fake + one real CH path only).

## After P0

Update parent plan status; open P1 index only when A1–A3 Done criteria are evidenced by tests in CI/local.
