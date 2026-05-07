export type SsoProviderOption = {
  id: string;
  name: string;
  protocol: "oidc" | "saml";
};

export function pickPreferredSsoProvider(
  providers: readonly SsoProviderOption[]
): SsoProviderOption | undefined {
  return providers.find((provider) => provider.protocol === "oidc") ?? providers[0];
}

export function parseSsoProviders(raw: string | undefined): SsoProviderOption[] {
  const source = raw?.trim();
  if (!source) return [];
  return source
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const segments = item.split(":");
      const id = segments.shift();
      const providerId = id?.trim() ?? "";
      if (!providerId) return null;

      const maybeProtocol = segments[segments.length - 1]?.trim().toLowerCase();
      const protocol =
        maybeProtocol === "saml" || maybeProtocol === "oidc"
          ? (segments.pop()!.trim().toLowerCase() as "oidc" | "saml")
          : "oidc";
      const name = segments.join(":").trim() || providerId;
      return { id: providerId, name, protocol };
    })
    .filter((item): item is SsoProviderOption => Boolean(item));
}

export function getAdminSsoProviderOptions(): SsoProviderOption[] {
  return parseSsoProviders(process.env.NEXT_PUBLIC_SSO_PROVIDERS);
}
