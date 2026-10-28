# AGX Data Suite P2-A7-4 — Auth Strategy Registry

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p2-a7-index.plan.md`

**Goal:** Register auth strategies by id; ship `oidc`, `saml`, `keycloak` (OIDC profile defaults), and `fake-customer-iam` for tests. New IdP = new strategy module + registry entry.

## File map

| Path | Responsibility |
|------|----------------|
| `enterprise/packages/auth/src/strategies/types.ts` | `AuthStrategy` interface |
| `enterprise/packages/auth/src/strategies/registry.ts` | `AuthStrategyRegistry` |
| `enterprise/packages/auth/src/strategies/oidc-strategy.ts` | Wrap existing OIDC handler |
| `enterprise/packages/auth/src/strategies/saml-strategy.ts` | Wrap existing SAML handler |
| `enterprise/packages/auth/src/strategies/keycloak-strategy.ts` | OIDC + Keycloak discovery URL helper |
| `enterprise/packages/auth/src/strategies/fake-customer-iam-strategy.ts` | Test double |
| `enterprise/packages/auth/src/strategies/__tests__/registry.test.ts` | Resolve / unknown / keycloak profile |
| `enterprise/packages/auth/src/index.ts` | Export |

## Interfaces

```ts
export type AuthStrategyId = "oidc" | "saml" | "keycloak" | "fake-customer-iam" | (string & {});

export interface AuthStrategy {
  readonly id: AuthStrategyId;
  /** Protocol family used by routes */
  readonly protocol: "oidc" | "saml" | "custom";
  /** Optional discovery / authorize URL builder from config blob */
  resolveEndpoints?(config: Record<string, unknown>): { issuer?: string; authorizationUrl?: string };
}

export class AuthStrategyRegistry {
  register(strategy: AuthStrategy): void;
  get(id: string): AuthStrategy;
  list(): AuthStrategy[];
}

export function createDefaultAuthStrategyRegistry(): AuthStrategyRegistry;
```

Do **not** rewrite all SSO routes in this slice — registry + unit tests only; routes can adopt later. Customer-specific IAM implementations stay B-layer plugins that `register()` at startup.

### Task 1

- [ ] Tests: default registry has oidc/saml/keycloak/fake; unknown throws; keycloak resolveEndpoints builds from realm.
- [ ] Implement strategies + registry.
- [ ] Commit: `feat(auth): pluggable auth strategy registry with keycloak profile`
