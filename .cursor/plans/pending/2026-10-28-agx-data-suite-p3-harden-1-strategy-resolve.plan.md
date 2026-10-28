# AGX Data Suite P3-Harden-1 — Strategy resolve helpers

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p3-harden-index.plan.md`

**Goal:** Pure helpers so runtimes pick a strategy id and merge `resolveEndpoints` into OIDC config blobs.

## File map

| Path | Responsibility |
|------|----------------|
| `enterprise/packages/auth/src/strategies/resolve.ts` | `resolveAuthStrategyId`, `applyStrategyEndpoints` |
| `enterprise/packages/auth/src/strategies/index.ts` | Re-export |
| `enterprise/packages/auth/src/strategies/__tests__/resolve.test.ts` | Unit tests |

## Interfaces

```ts
export function resolveAuthStrategyId(input: {
  strategyId?: string | null;
  protocol?: string | null;
  providerId?: string | null;
}): string;
// precedence: explicit strategyId → protocol saml → providerId contains "keycloak" → "oidc"

export function applyStrategyEndpoints(
  strategy: AuthStrategy,
  config: Record<string, unknown>,
): Record<string, unknown>;
// if strategy.resolveEndpoints → merge issuer/authorizationUrl (issuer wins when newly set and config.issuer empty)
```

### Task 1

- [ ] Failing tests for precedence + keycloak merge.
- [ ] Implement resolve.ts + exports.
- [ ] Commit: `feat(auth): resolve helpers to apply AuthStrategy endpoints`
