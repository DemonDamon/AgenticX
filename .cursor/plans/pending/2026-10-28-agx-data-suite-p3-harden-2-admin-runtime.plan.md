# AGX Data Suite P3-Harden-2 — Admin SSO runtime wiring

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p3-harden-index.plan.md`

**Goal:** `admin-sso-runtime` loads strategy from registry; Keycloak can be configured via `BASE_URL`+`REALM` (+ optional `STRATEGY=keycloak`) without hand-built issuer.

## File map

| Path | Responsibility |
|------|----------------|
| `enterprise/apps/admin-console/src/lib/admin-sso-runtime.ts` | `getAdminAuthStrategy`, apply endpoints in env/db OIDC config builders |
| `enterprise/apps/admin-console/src/lib/__tests__/admin-sso-runtime.test.ts` | keycloak env path; unknown strategy throws |
| `enterprise/apps/admin-console/src/app/api/auth/sso/oidc/start/route.ts` | Assert strategy.protocol === "oidc" before start |
| `enterprise/apps/admin-console/src/app/api/auth/sso/saml/start/route.ts` | Assert strategy.protocol === "saml" |

Env keys (additive, desensitized):
- `SSO_OIDC_<ID>_STRATEGY` — e.g. `keycloak`
- `SSO_OIDC_<ID>_BASE_URL` + `SSO_OIDC_<ID>_REALM` — fed to `resolveEndpoints`

### Task 1

- [ ] Tests: STRATEGY=keycloak + BASE_URL+REALM produces realm issuer; start guards.
- [ ] Wire runtime + start routes.
- [ ] Commit: `feat(admin): wire SSO runtime to AuthStrategyRegistry`
