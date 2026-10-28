# AGX Data Suite P2 — Subplan Index

> **Parent:** `.cursor/plans/pending/2026-10-27-agx-data-suite.plan.md`
> **For agentic workers:** Execute A7 subplans **in order**. Do not start A8 until A7 Done criteria pass.
> **Execution owner:** agx 开发 — sequential, one subplan at a time.

**Goal:** Ship P2 reusable security + agent templates: A7 (masking / watermark / auth strategy plugins) → A8 (Data Agent templates), all A-layer.

**Architecture:** Masking library under `agenticx/data_suite/masking/`; watermark UI in web-portal (and smoke-host in admin for e2e); auth strategy registry in `enterprise/packages/auth` extending existing `SsoProtocolHandler` / provider factory — no customer IAM code in trunk.

**Tech Stack:** Python 3.10+, pytest, PyYAML; Next.js admin-console / web-portal + Vitest + Playwright; `@agenticx/auth` TypeScript.

## Global Constraints

- A/B discipline: sensitivity labels, role→policy bindings, Keycloak realm URLs, customer IAM endpoints stay config / B-layer plugins.
- Masking applies at query/board bind time (row dicts), not by rewriting customer lakehouse.
- Auth: adding a provider = implement one strategy + register; do not fork route handlers per customer.
- Prefer TDD; commit after each green task.
- Desensitize docs/commits: no customer company names.

## Subplan order

| # | Subplan | Path | Done when |
|---|---------|------|-----------|
| 1 | A7-1 Field masking engine | `2026-10-28-agx-data-suite-p2-a7-1-masking.plan.md` | YAML policy load; mask strategies; role×sensitivity apply on rows |
| 2 | A7-2 Board/query masking hook | `2026-10-28-agx-data-suite-p2-a7-2-mask-bind.plan.md` | DatasetStore/binder path can apply MaskingEngine before series |
| 3 | A7-3 Page watermark | `2026-10-28-agx-data-suite-p2-a7-3-watermark.plan.md` | Reusable watermark component; mounted on admin + portal layout smoke |
| 4 | A7-4 Auth strategy registry | `2026-10-28-agx-data-suite-p2-a7-4-auth-strategy.plan.md` | Registry + Keycloak OIDC profile + FakeCustomerIam strategy; unit tests |
| 5 | A7-5 Admin surface + e2e | `2026-10-28-agx-data-suite-p2-a7-5-admin-e2e.plan.md` | `/admin/data-security` stub + Playwright: mask sample + watermark visible |

## After A7

A7 merged to main as `#140` / `0af5c6c7`. Proceed to A8 subplans in order.

## A8 order

| # | Subplan | Path |
|---|---------|------|
| 1 | Template kit | `2026-10-28-agx-data-suite-p2-a8-1-template-kit.plan.md` |
| 2 | Quality patrol | `2026-10-28-agx-data-suite-p2-a8-2-quality-patrol.plan.md` |
| 3 | Dictionary drift | `2026-10-28-agx-data-suite-p2-a8-3-dict-drift.plan.md` |
| 4 | NL2SQL read-only | `2026-10-28-agx-data-suite-p2-a8-4-nl2sql.plan.md` |
| 5 | Examples + e2e | `2026-10-28-agx-data-suite-p2-a8-5-examples-e2e.plan.md` |

Index: `2026-10-28-agx-data-suite-p2-a8-index.plan.md`

## Status

- **P0 / P1:** merged (`#137`–`#139`).
- **P2-A7:** merged `#140` (`0af5c6c7`).
- **P2-A8:** plans written; implementation next.
