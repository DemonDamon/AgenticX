# AGX Data Suite P3-Harden — S2 Index (A7 route wiring first)

> **Parent roadmap:** `.cursor/plans/pending/2026-10-28-agx-data-suite-after-a8-roadmap.plan.md` (Track 2)
> **Depends on:** A7 AuthStrategyRegistry already on main (#140). Branch from current spine tip.
> Sequential: S2-1 → S2-7. Do **not** open A9 compute in this track.

**Goal:** (1) SSO via `AuthStrategyRegistry`; (2) expand A1 with real JDBC + Kafka channels.

**Scope:**
1. Shared resolve helpers in `@agenticx/auth` strategies.
2. Admin + portal `*-sso-runtime` apply strategy when building OIDC config (env `STRATEGY` / `BASE_URL`+`REALM`).
3. OIDC/SAML start routes assert `strategy.protocol` matches the route.
4. **S2-4:** real `JdbcChannel` (SQLAlchemy; sqlite unit tests).
5. **S2-5:** real `KafkaChannel` (in-memory transport + optional live bootstrap); Hive/file stay Fake.
6. **S2-6:** governance/boards minimal writable file API + admin UI wire.
7. **S2-7:** A8 quality/dict-drift patrol schedule + HTTP webhook.

**Out of scope:** rewriting claim mapping, new IdP protocols, B-layer customer IAM plugins, Hive/file real drivers, A9.

## Subplan order

| # | Path | Done when |
|---|------|-----------|
| S2-1 | `2026-10-28-agx-data-suite-p3-harden-1-strategy-resolve.plan.md` | resolve helpers + vitest green in auth package |
| S2-2 | `2026-10-28-agx-data-suite-p3-harden-2-admin-runtime.plan.md` | admin-sso-runtime uses registry; keycloak env path green |
| S2-3 | `2026-10-28-agx-data-suite-p3-harden-3-portal-routes.plan.md` | portal runtime + start routes protocol guard green |
| S2-4 | `2026-10-28-agx-data-suite-p3-harden-4-jdbc-channel.plan.md` | JdbcChannel + factory + data_suite pytest green |
| S2-5 | `2026-10-28-agx-data-suite-p3-harden-5-kafka-channel.plan.md` | KafkaChannel + factory + data_suite pytest green |
| S2-6 | `2026-10-28-agx-data-suite-p3-harden-6-admin-writable.plan.md` | dictionary/boards file API + UI wired |
| S2-7 | `2026-10-28-agx-data-suite-p3-harden-7-a8-schedule.plan.md` | patrol schedule + HttpWebhookSink green |

## E2E gate

1. `pnpm --filter @agenticx/auth test` (or package vitest) includes new resolve tests.
2. Admin + portal runtime unit tests for keycloak baseUrl+realm → issuer.
3. Existing oidc/saml start tests still pass.
4. `pytest tests/data_suite/ --override-ini='addopts='` includes JdbcChannel sqlite + KafkaChannel memory tests.

## Status

- **Plans:** done
- **Impl:** S2-1…S2-7 landed; **Track 2 Harden complete** on spine
- **Gate:** prior gates + admin data-suite-store vitest + file_store/patrol_schedule pytest (36 managed+golden_path passed)
