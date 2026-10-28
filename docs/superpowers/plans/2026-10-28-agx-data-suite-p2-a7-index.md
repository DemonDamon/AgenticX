# AGX Data Suite P2-A7 — Security Enhancements Index

> **Parent:** `.cursor/plans/pending/2026-10-27-agx-data-suite.plan.md`
> **P2 index:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p2-index.plan.md`
> Execute only after P1 Done. Sequential A7-1 → A7-5.

**Goal:** Field-level masking by sensitivity×role, global page watermark, and pluggable auth strategies so a new IdP is one strategy plugin — A-layer only.

**Architecture:**
1. Python `MaskingEngine` (config-driven) in `agenticx/data_suite/masking/`.
2. Hook into dashboard binder / DatasetStore so board queries see masked rows.
3. React `PageWatermark` shared pattern in admin + web-portal layouts.
4. TS `AuthStrategyRegistry` over existing OIDC/SAML handlers + Keycloak profile + FakeCustomerIam for tests (real customer IAM stays B-layer).

**Tech Stack:** Python pytest/PyYAML; Next.js + Vitest + Playwright; `@agenticx/auth`.

## Subplan order

| # | Path | Done when |
|---|------|-----------|
| A7-1 | `2026-10-28-agx-data-suite-p2-a7-1-masking.plan.md` | Engine + fixtures green |
| A7-2 | `2026-10-28-agx-data-suite-p2-a7-2-mask-bind.plan.md` | Masked bind_widget path green |
| A7-3 | `2026-10-28-agx-data-suite-p2-a7-3-watermark.plan.md` | Component + layout mount + vitest |
| A7-4 | `2026-10-28-agx-data-suite-p2-a7-4-auth-strategy.plan.md` | Registry + Keycloak + FakeCustomerIam tests |
| A7-5 | `2026-10-28-agx-data-suite-p2-a7-5-admin-e2e.plan.md` | Admin data-security + e2e green |

## E2E gate (whole A7)

1. `pytest tests/data_suite/test_masking_*.py tests/data_suite/test_dashboard_*.py` green.
2. Auth package vitest for strategy registry.
3. Playwright `e2e:data-security`: login → `/admin/data-security` → sample masked field shown + watermark node present.

## Status

- **A7:** in progress (plans written).
