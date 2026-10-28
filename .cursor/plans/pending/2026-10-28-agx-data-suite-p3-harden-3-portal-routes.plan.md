# AGX Data Suite P3-Harden-3 — Portal runtime + gate

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p3-harden-index.plan.md`

**Goal:** Mirror admin wiring in web-portal `sso-runtime` + oidc/saml start protocol guards; update harden index / roadmap status.

## File map

| Path | Responsibility |
|------|----------------|
| `enterprise/apps/web-portal/src/lib/sso-runtime.ts` | Same strategy apply as admin |
| `enterprise/apps/web-portal/src/lib/__tests__/sso-runtime-strategy.test.ts` | New or extend existing |
| Portal oidc/saml start routes | protocol assert via registry |
| Plans status | Mark S2 done |

### Task 1

- [ ] Portal keycloak env issuer test green.
- [ ] Existing SSO tests still green.
- [ ] Commit: `feat(portal): wire SSO runtime to AuthStrategyRegistry`
- [ ] Update harden index + after-a8 Track 2 status.
