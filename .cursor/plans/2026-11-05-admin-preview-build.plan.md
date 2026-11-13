# Admin preview production type fixes

Planned-with: gpt-6.1-sol
Suggested-Impl-Model: gpt-6.1-sol

## Evidence and scope

Baseline a680b0663 contains nine production type errors in the administrative app: an invalid relative type import, two unresolved database dialect unions, a required override marker, and five inferred fallback/dynamic-row access errors. This is a locally confirmed compiler issue; it is not a confirmed diagnosis of any external preview provider status.

## Implementation

1. `src/lib/platform-catalog-distribution.ts`: import GrantStatus/RevokePolicy through the existing same-directory platform-catalog-store facade.
2. `src/lib/db-stores/mysql/ecp-tenant-settings-store.ts`: narrow resolved configuration to mysql before createMysqlDb, sharing the small typed database helper between get/update. The public facade uses the existing resolveDatabaseConfig rather than DATABASE_DIALECT-only branching, preserving supported URL inference and configuration validation.
3. `src/lib/graph-store.ts`: mark FileGraphStore.backendName as an override; retain the same value and persistence behavior.
4. `src/lib/idmapping-store.ts`: annotate merge fallback as Partial<IdMapProfileRecord['merge']> and merged output rows as Record<string, unknown>. Retain all normalization, conflict and merge semantics.

## Acceptance and boundaries

- Run existing idmapping, graph and platform distribution/expert-package tests; add a narrow facade regression for URL-only mysql/postgresql inference and incompatible configuration.
- Run the production-source type gate and an actual administrative next build. Use only disposable synthetic build configuration when needed, and distinguish compilation from runtime/deployment validation.
- Missing evaluation test APIs and other baseline test errors are outside scope. Do not suppress type errors, delete tests, edit real environment files or change production behavior beyond correct dialect resolution.
- Commit only this isolated build fix, its scoped regression and this plan. Leave the existing permissions and identity branches unchanged.

## Validation results

- Five targeted test files pass 21 cases, including real dialect inference, direct wrong-dialect refusal, ID mapping merge/conflict behavior, file graph persistence and catalog distribution behavior.
- A temporary production-source TypeScript gate reports no errors; its test-file exclusions were not committed.
- An actual `pnpm build` using Next 15.5.29 exits 0, performs type validation and completes all 136 page generations, optimization and tracing with the original build configuration. No `ignoreBuildErrors` setting or test deletion was introduced.
- Build inputs were disposable: a synthetic tenant ID and a database URL targeting closed loopback port 1. No real deployment environment was used, and this build does not validate database access, authentication or deployed runtime behavior.
- External preview failure logs remain unavailable; this local correction is not asserted to be the confirmed remote failure cause.
- Full-project `tsc --noEmit` still reports exactly three pre-existing test-only diagnostics: the missing evaluation test API import, the test Error subclass override, and the test fixture optional access. These are unchanged and outside this PR; the nine production diagnostics are gone.

## Automated production-build regression gate

- `.github/workflows/admin-production-build.yml` runs on relevant admin app, shared enterprise package/feature, workspace configuration and workflow changes. Pull requests have no base-branch restriction; push events are limited to main/master, and manual dispatch is supported.
- A clean hosted runner installs the existing workspace and explicitly runs these five suites (21 current cases): `ecp-tenant-settings-dialect`, `idmapping-store`, `graph-store`, `platform-catalog-distribution.integration`, `ecp-e4-expert-package.integration`.
- The next step runs the real `pnpm --filter @agenticx/app-admin-console build` with normal production type validation. There is no continue-on-error, type-error suppression or alternate build configuration.
- Only the build step receives disposable tenant and closed-loopback database inputs; they do not leak into unit tests or dependency installation. No repository secrets or external deployment credentials are read.
- CI acceptance: the scoped regressions and complete optimized production build both exit zero. A missing or failing test file, compilation/type error, or failed build makes the job fail. The run validates compilation and bundling, not database connectivity, authentication, deployed behavior or an external preview provider's diagnosis.
- Validate workflow syntax and action expressions with the official actionlint tool before publishing. The independent PR remains isolated from prior authorization and identity contribution branches.
- Local workflow review passes official actionlint 1.7.12, YAML trigger/environment checks and shell syntax checks. The exact scoped CI command passes all 21 cases, and a disposable fixture with four present files and one missing file exits 1 before invoking the test runner. Hosted execution remains a separate result to observe after push.
