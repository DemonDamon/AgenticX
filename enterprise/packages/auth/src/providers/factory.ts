import { AuthService } from "../services/auth";
import { OidcClientService } from "../services/oidc-client";
import { OidcProvider } from "./oidc-provider";
import { PasswordProvider } from "./password-provider";
import { SamlProvider } from "./saml-provider";
import type { AuthProvider, AuthProviderKind } from "./types";

type CreateAuthProviderOptions = {
  oidcClientService?: OidcClientService;
};

export function createAuthProvider(
  kind: AuthProviderKind,
  authService: AuthService,
  options: CreateAuthProviderOptions = {}
): AuthProvider {
  switch (kind) {
    case "password":
      return new PasswordProvider(authService);
    case "oidc":
      return new OidcProvider(options.oidcClientService);
    case "saml":
      return new SamlProvider();
    default:
      return new PasswordProvider(authService);
  }
}

