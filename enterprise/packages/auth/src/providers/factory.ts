import { AuthService } from "../services/auth";
import { OidcProvider } from "./oidc-provider";
import { PasswordProvider } from "./password-provider";
import { SamlProvider } from "./saml-provider";
import type { AuthProvider, AuthProviderKind } from "./types";

export function createAuthProvider(kind: AuthProviderKind, authService: AuthService): AuthProvider {
  switch (kind) {
    case "password":
      return new PasswordProvider(authService);
    case "oidc":
      return new OidcProvider();
    case "saml":
      return new SamlProvider();
    default:
      return new PasswordProvider(authService);
  }
}

