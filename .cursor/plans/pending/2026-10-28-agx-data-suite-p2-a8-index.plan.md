# AGX Data Suite P2-A8 — Data Agent Templates Index

> **Parent:** `.cursor/plans/pending/2026-10-27-agx-data-suite.plan.md`
> **P2 index:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p2-index.plan.md`
> Execute only after A7 merged to main. Sequential A8-1 → A8-5.

**Goal:** Three reusable Managed Agent templates that plug into Data Suite governance/boards: quality patrol, dictionary/口径 drift patrol, and read-only NL2SQL Q&A — A-layer only.

**Architecture:**
1. Shared template kit under `agenticx/managed/templates/data_suite/` (manifest stubs, schedule trigger helper, webhook notifier, write-guard policy).
2. Quality patrol calls `QualityRollup` on sample rows and posts `QualityEvent` via webhook when thresholds fail.
3. 口径 patrol diffs `DictionaryCatalog` expectations vs observed row stats → `GovernanceTodo` list + webhook.
4. NL2SQL agent exposes a read-only SQL tool over FakeChannel / ChannelRegistry; write tools denied by write guards.
5. `examples/managed/` YAML apply specs + pytest gate prove instantiate-from-config.

**Tech Stack:** Python 3.10+, pytest, PyYAML; existing `agenticx/managed` + `agenticx/data_suite/{governance,channels}`.

## Subplan order

| # | Path | Done when |
|---|------|-----------|
| A8-1 | `2026-10-28-agx-data-suite-p2-a8-1-template-kit.plan.md` | Template kit + webhook sink + write-guard helpers green |
| A8-2 | `2026-10-28-agx-data-suite-p2-a8-2-quality-patrol.plan.md` | Quality patrol runner + threshold webhook green |
| A8-3 | `2026-10-28-agx-data-suite-p2-a8-3-dict-drift.plan.md` | 口径 drift detector → GovernanceTodo green |
| A8-4 | `2026-10-28-agx-data-suite-p2-a8-4-nl2sql.plan.md` | Read-only NL2SQL tool path + write denied green |
| A8-5 | `2026-10-28-agx-data-suite-p2-a8-5-examples-e2e.plan.md` | examples YAML + full A8 pytest gate |

## E2E gate (whole A8)

1. `pytest tests/managed/templates/ tests/data_suite/test_agent_*.py` green.
2. Three example apply YAMLs under `examples/managed/data_suite/` validate via `validate_manifest`.
3. Fake schedule tick for quality + drift emits webhook payloads; NL2SQL rejects writes.

## Status

- **A8:** implemented on `feat/agx-data-suite-p2-a8` (kit + patrols + nl2sql + examples); PR next.
