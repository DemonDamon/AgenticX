export type SsoProviderOption = {
  id: string;
  name: string;
};

export function parseSsoProviders(raw: string | undefined): SsoProviderOption[] {
  const source = raw?.trim();
  if (!source) return [];
  return source
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [id, ...rest] = item.split(":");
      const providerId = id?.trim() ?? "";
      const name = rest.join(":").trim() || providerId;
      return providerId ? { id: providerId, name } : null;
    })
    .filter((item): item is SsoProviderOption => Boolean(item));
}

export function getPortalSsoProviderOptions(): SsoProviderOption[] {
  return parseSsoProviders(process.env.NEXT_PUBLIC_SSO_PROVIDERS);
}
