# AGX Data Suite P1 — Subplan Index

> **Parent:** `.cursor/plans/pending/2026-10-27-agx-data-suite.plan.md`
> **For agentic workers:** Execute subplans **in order**. Do not start A5 until A4 Done criteria pass; do not start A6 until A5 Done criteria pass.
> **Execution owner:** agx 开发 — sequential, one subplan at a time; optional cloud agent per task inside a subplan.

**Goal:** Ship P1 reusable product capabilities: data governance (A4) → tag & audience (A5) → configurable BI dashboard framework (A6), all A-layer (config-driven, no project logic in trunk).

**Architecture:** Library first under `agenticx/data_suite/governance|tags|audience/`; Enterprise surfaces in `admin-console` (数据治理域) and `web-portal` (dashboard module) only after each library vertical slice is green. Reuse P0 channels / DataFlow / lineage / ID-Mapping — do not reimplement.

**Tech Stack:** Python 3.10+, pytest, PyYAML; Next.js admin-console / web-portal for UI slices; no customer lakehouse in-process.

## Global Constraints

- A/B discipline: if a project need can be expressed as YAML/config, it stays out of the engine.
- Compute stays on customer side; AGX connects, orchestrates, governs config, runs agents.
- Default channel writes still require grant + audit (P0).
- Do not mix with Near connector market or OpenConnector gateway workstreams.
- Prefer TDD; commit after each green task.
- P1 person-month estimate is aggressive: each subplan ships a **vertical slice**, not production-hard every vendor path.

## Subplan order

| # | Subplan | Path | Done when |
|---|---------|------|-----------|
| 1 | A4-1 Field dictionary | `.cursor/plans/pending/2026-10-28-agx-data-suite-p1-a4-1-dictionary.plan.md` | YAML field catalog load/query; four elements; pytest green |
| 2 | A4-2 Cleaning rules | `.cursor/plans/pending/2026-10-28-agx-data-suite-p1-a4-2-cleaning.plan.md` | Rule templates + apply + quarantine + audit trail on FakeChannel rows |
| 3 | A4-3 Trust grades | `.cursor/plans/pending/2026-10-28-agx-data-suite-p1-a4-3-trust.plan.md` | Configurable S/A/B/C arbitration; conflict samples resolved by config |
| 4 | A4-4 Quality metrics | `.cursor/plans/pending/2026-10-28-agx-data-suite-p1-a4-4-quality.plan.md` | Config metrics + daily rollup store + DataFlow hook |
| 5 | A4-5 Lineage + admin stub | `.cursor/plans/pending/2026-10-28-agx-data-suite-p1-a4-5-lineage-admin.plan.md` | Table-level lineage graph from job logs + admin-console 数据治理 page listing dictionary |
| 6 | A5 Tag & audience | `.cursor/plans/pending/2026-10-28-agx-data-suite-p1-a5-index.plan.md` | Define→compute→audience DSL on synthetic fixtures |
| 7 | A6 Dashboard framework | `.cursor/plans/pending/2026-10-28-agx-data-suite-p1-a6-index.plan.md` | One business board fully from config (admin data-boards + library) |

## Cross-subplan contracts (lock these names)

```python
# agenticx/data_suite/governance/dictionary.py
@dataclass
class FieldDef:
    name: str
    business_def: str
    calc_logic: str
    update_freq: str
    owner: str

class DictionaryCatalog:
    def load(self, path: str | Path) -> None: ...
    def get(self, field: str) -> FieldDef: ...
    def list_fields(self) -> list[FieldDef]: ...

# agenticx/data_suite/governance/cleaning.py
class CleaningEngine:
    def apply(self, rows: list[dict], *, ruleset_id: str) -> CleanResult: ...

# agenticx/data_suite/governance/trust.py
class TrustArbiter:
    def grade(self, record: dict, *, profile_id: str) -> TrustDecision: ...

# agenticx/data_suite/governance/quality.py
class QualityRollup:
    def compute_day(self, day: str, *, metric_ids: list[str]) -> QualitySnapshot: ...
```

## Out of scope for P1-A4 first slices

- A5/A6 full product polish (tracked in later plans).
- A7 masking/watermark (P2; pull forward only if bid-critical).
- Replacing customer CDP / lakehouse.
- Field-level SQL lineage parser completeness (table-level first; field-level progressive).

## After A4

Update parent plan status; open A5 index only when A4-1…A4-5 Done criteria are evidenced by tests (and admin stub smoke).

## Status

- **P0 (A1–A3):** merged to `main` via PR #137 (`ff2ba8d0`).
- **P1-A4:** done (merged via PR #138).
- **P1-A5:** done (merged via PR #138).
- **P1-A6:** merged to `main` via PR #139 (`bb90dfb5`).
