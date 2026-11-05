# Administrative grant boundaries

Planned-with: gpt-6.1-sol
Suggested-Impl-Model: gpt-6.1-terra

## Evidence and scope

At baseline a680b0663, administrative user/role writes accept target privileges without comparing them with the authenticated administrator. The implementation must enforce these decisions in shared repositories/services for both database dialects, preserve current managed-agent scopes, and explicitly identify trusted bootstrap/SSO/provisioning callers.

## Interfaces and implementation

- Add `src/repos/privilege-guard.ts`: `AdministrativeActor` is a discriminated user/system union; user carries tenantId/userId/scopes; system carries tenantId/purpose. Missing actor or tenant mismatch is denied, and role:manage alone does not grant arbitrary privilege. User actors cannot grant or manage a scope they lack.
- Preserve wildcard identity during role aggregation in `src/scope-registry.ts`, and register current managed-agent PAT scopes. Scope comparisons must not silently discard unknown target scopes.
- Add required actor to user mutation inputs and role mutation inputs in `repos/contracts.ts`, PostgreSQL and MySQL implementations. Check action capability, existing target privilege and requested roles before writes, including restore, role copy and bulk upsert. Reject unknown roles before writing. Password reset/delete also check the target.
- Update authenticated admin routes to pass server-derived actor. Bootstrap/SSO role assignment uses explicit system actor and purpose. Do not read actor from request JSON.
- Token-service integration is isolated in the stacked plan `2026-11-05-delegated-token-grants.plan.md`; this PR supplies the shared actor and grant decisions.

## Acceptance

- `repos/__tests__/privilege-guard.test.ts`: missing/cross-tenant actor denied; scope wildcard preserved; role:manage cannot mint wildcard; unknown scopes fail closed; managed-agent scopes retained.
- `repos/__tests__/privilege-guard-user-writes.test.ts`: PG and MySQL create/restore/update/delete/reset/bulk/role copy reject exceeding privileges before mutation, valid lower-privilege writes pass.
- `api/admin/api-tokens/__tests__/route.test.ts` and PAT service tests: cross-tenant target denied, disabled/missing user denied, submitted department ignored, legal managed-agent grant passes, arbitrary scope fails, createdBy is actor.
- Run targeted Vitest and IAM typecheck, then database-backed tests when local PG/MySQL fixtures are available. No production data or deployment changes.

## Commit split

1. Shared actor/guard, scope aggregation, user/role repositories and administrative/system callers.
2. Stacked PR: PAT authorization service, token routes and token issuance callers/tests, owned by `2026-11-05-delegated-token-grants.plan.md`.

## Implementation validation

- Shared guard, active-account guard and token route contract tests pass (19 cases).
- Repository, active-account guard, token route, and existing device-login regression selection: 174 passed; opt-in real-database cases skipped in the default run.
- Opt-in PostgreSQL and MySQL suites each pass 10 cases using migrated disposable databases. They cover refusal before insert, create-only import rejection on existing accounts, higher-privilege update/reset/delete/restore, role duplication, target-derived token metadata and current managed-agent scopes.
- IAM package `tsc --noEmit` passes. Whole-application typechecks report unrelated baseline errors and require separate baseline comparison; they are not reported as green.
- Historical bulk-import HTTP routing remains PostgreSQL-specific; both public repository upsert paths are protected and database-tested. Replacing the entire department-import pipeline is outside this authorization change.

- Administrative scope guards additionally reject disabled, locked, missing and deleted actors despite a still-valid signed session, using the current account row and scopes. Six explicit guard cases pass.

- Department membership is checked before user create/update/restore/bulk-upsert and explicit role-assignment writes in both dialects; nullable departments remain valid. The stacked token PR also rejects copying legacy foreign departments into new tokens.
