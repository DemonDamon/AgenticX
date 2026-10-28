import { fakeCustomerIamStrategy } from "./fake-customer-iam-strategy";
import { keycloakStrategy } from "./keycloak-strategy";
import { oidcStrategy } from "./oidc-strategy";
import { samlStrategy } from "./saml-strategy";
import type { AuthStrategy } from "./types";

export class AuthStrategyRegistry {
  private readonly strategies = new Map<string, AuthStrategy>();

  register(strategy: AuthStrategy): void {
    this.strategies.set(strategy.id, strategy);
  }

  get(id: string): AuthStrategy {
    const found = this.strategies.get(id);
    if (!found) {
      throw new Error(`unknown auth strategy: ${id}`);
    }
    return found;
  }

  list(): AuthStrategy[] {
    return [...this.strategies.values()];
  }
}

export function createDefaultAuthStrategyRegistry(): AuthStrategyRegistry {
  const registry = new AuthStrategyRegistry();
  for (const strategy of [oidcStrategy, samlStrategy, keycloakStrategy, fakeCustomerIamStrategy]) {
    registry.register(strategy);
  }
  return registry;
}
