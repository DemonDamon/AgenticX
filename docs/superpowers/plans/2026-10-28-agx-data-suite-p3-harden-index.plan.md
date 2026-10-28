# AGX Data Suite P3-Harden — S2 Index (A7 route wiring first)

> **Parent roadmap:** `.cursor/plans/pending/2026-10-28-agx-data-suite-after-a8-roadmap.plan.md` (Track 2)
> **Depends on:** A7 AuthStrategyRegistry already on main (#140). Branch from current spine tip.
> Sequential: S2-1 → S2-3. Do **not** open A1 channel expansion or A9 in this track.

**Goal:** SSO start/config paths resolve IdP via `AuthStrategyRegistry` (oidc / saml / keycloak / fake), so Keycloak realm endpoints come from strategy plugins — not hard-coded in routes.

**Scope (this slice):**
1. Shared resolve helpers in `@agenticx/auth` strategies.
2. Admin + portal `*-sso-runtime` apply strategy when building OIDC config (env `STRATEGY` / `BASE_URL`+`REALM`).
3. OIDC/SAML start routes assert `strategy.protocol` matches the route.

**Out of scope:** rewriting claim mapping, new IdP protocols, B-layer customer IAM plugins, A1 JDBC/Kafka.

## Subplan order

| # | Path | Done when |
|---|------|-----------|
| S2-1 | `2026-10-28-agx-data-suite-p3-harden-1-strategy-resolve.plan.md` | resolve helpers + vitest green in auth package |
| S2-2 | `2026-10-28-agx-data-suite-p3-harden-2-admin-runtime.plan.md` | admin-sso-runtime uses registry; keycloak env path green |
| S2-3 | `2026-10-28-agx-data-suite-p3-harden-3-portal-routes.plan.md` | portal runtime + start routes protocol guard green |

## E2E gate

1. `pnpm --filter @agenticx/auth test` (or package vitest) includes new resolve tests.
2. Admin + portal runtime unit tests for keycloak baseUrl+realm → issuer.
3. Existing oidc/saml start tests still pass.

## Status

- **Plans:** done
- **Impl:** S2-1…S2-3 landed on `feat/agx-data-suite-p3-spine`
- **Gate:** auth resolve vitest + admin/portal sso-runtime strategy tests
