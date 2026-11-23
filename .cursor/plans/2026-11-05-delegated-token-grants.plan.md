# Delegated token grant boundaries

Planned-with: gpt-6.1-sol
Suggested-Impl-Model: gpt-6.1-terra

## Dependency and evidence

This PR is stacked on `2026-11-05-administrative-grant-boundaries`: it reuses the explicit AdministrativeActor and shared scope/tenant checks. At baseline a680b0663, token issuance accepts arbitrary target user/department and unvalidated non-managed scopes; admin listing/revocation also uses the deployment default tenant instead of the signed session tenant.

## Scope and implementation

- `enterprise/packages/iam-core/src/pat-service.ts::createPat`: require explicit same-tenant actor; allow current managed-agent PAT scopes plus chat/desktop capabilities; load current target and actor accounts, reject inactive users and grant ceilings, derive dept from the target row and createdBy from the actor. Validate target department membership so legacy foreign-department data cannot be copied into new tokens.
- `assertActorMayManagePatUser`: shared current-user/scope boundary for token visibility and revocation. Self-service remains available; delegation requires user:update and target privilege coverage.
- Admin collection and token-id routes use the authenticated session tenant, server-derived actor, the shared target boundary, and safe forbidden responses. Do not accept actor or tenant from JSON.
- Existing self-service and authenticated device-token callers pass explicit user actor; provisioning uses explicit system purpose. The current managed-agent scope definitions remain usable.

## Acceptance

- `api/admin/api-tokens/__tests__/route.test.ts`: known managed-agent scopes accepted, arbitrary scopes rejected, session tenant wins over deployment defaults/JSON, forbidden delegation returns 403.
- `repos/__tests__/pat-grant-boundaries.real-db.test.ts` in both databases: target-derived dept/creator, cross-tenant/higher-privilege target refusal, current managed-agent scopes, excessive target scope and legacy foreign department rejection before write.
- Existing desktop/device token tests must pass. IAM typecheck and targeted route/guard tests must pass; whole-application baseline failures are reported separately.

## Out of scope

Historical token post-issuance revocation semantics, a new permission registry/product policy, deployment and production data are not changed.
