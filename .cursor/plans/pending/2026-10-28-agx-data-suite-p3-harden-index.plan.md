# AGX Data Suite P3-Harden — S2 Index (A7 route wiring first)

> **Parent roadmap:** `.cursor/plans/pending/2026-10-28-agx-data-suite-after-a8-roadmap.plan.md` (Track 2)
> **Depends on:** A7 AuthStrategyRegistry already on main (#140). Branch from current spine tip.
> Sequential: S2-1 → S2-4. Do **not** open A9 compute in this track.

**Goal:** (1) SSO start/config paths resolve IdP via `AuthStrategyRegistry`; (2) expand A1 with a real JDBC/SQL channel.

**Scope:**
1. Shared resolve helpers in `@agenticx/auth` strategies.
2. Admin + portal `*-sso-runtime` apply strategy when building OIDC config (env `STRATEGY` / `BASE_URL`+`REALM`).
3. OIDC/SAML start routes assert `strategy.protocol` matches the route.
4. **S2-4:** real `JdbcChannel` (SQLAlchemy; sqlite unit tests); Kafka stays Fake.

**Out of scope:** rewriting claim mapping, new IdP protocols, B-layer customer IAM plugins, Kafka/Hive/file real drivers, A9.

## Subplan order

| # | Path | Done when |
|---|------|-----------|
| S2-1 | `2026-10-28-agx-data-suite-p3-harden-1-strategy-resolve.plan.md` | resolve helpers + vitest green in auth package |
| S2-2 | `2026-10-28-agx-data-suite-p3-harden-2-admin-runtime.plan.md` | admin-sso-runtime uses registry; keycloak env path green |
| S2-3 | `2026-10-28-agx-data-suite-p3-harden-3-portal-routes.plan.md` | portal runtime + start routes protocol guard green |
| S2-4 | `2026-10-28-agx-data-suite-p3-harden-4-jdbc-channel.plan.md` | JdbcChannel + factory + data_suite pytest green |

## E2E gate

1. `pnpm --filter @agenticx/auth test` (or package vitest) includes new resolve tests.
2. Admin + portal runtime unit tests for keycloak baseUrl+realm → issuer.
3. Existing oidc/saml start tests still pass.
4. `pytest tests/data_suite/ --override-ini='addopts='` includes JdbcChannel sqlite tests.

## Status

- **Plans:** done
- **Impl:** S2-1…S2-4 landed on `feat/agx-data-suite-p3-spine` (JdbcChannel + factory; Kafka stays Fake)
- **Gate:** auth resolve vitest + admin/portal sso-runtime strategy tests; `tests/data_suite/` green (JdbcChannel sqlite)
