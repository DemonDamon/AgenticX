/**
 * Validates OIDC redirect_uri before authorization / token exchange (FR-A1).
 * Production: HTTPS only. Development: HTTP allowed only for localhost/127.0.0.1
 * or entries in SSO_DEV_INSECURE_REDIRECT_ALLOWLIST (comma-separated origins).
 */
export class OidcInvalidRedirectError extends Error {
  public constructor(public readonly code: "oidc.invalid_redirect_uri", message: string) {
    super(message);
    this.name = "OidcInvalidRedirectError";
  }
}

function parseAllowlist(raw: string | undefined): Set<string> {
  const set = new Set<string>();
  const source = raw?.trim();
  if (!source) return set;
  for (const item of source.split(",")) {
    const origin = item.trim();
    if (origin) set.add(origin.replace(/\/$/, ""));
  }
  return set;
}

function normalizeOrigin(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

function isDevLocalhostHttp(parsed: URL): boolean {
  if (parsed.protocol !== "http:") return false;
  const h = parsed.hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

export function assertOidcRedirectUriForRuntime(redirectUri: string): void {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new OidcInvalidRedirectError("oidc.invalid_redirect_uri", "redirect_uri is not a valid URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new OidcInvalidRedirectError("oidc.invalid_redirect_uri", "redirect_uri must use http or https.");
  }

  const nodeEnv = process.env.NODE_ENV ?? "development";
  const isProd = nodeEnv === "production";

  if (isProd && parsed.protocol !== "https:") {
    throw new OidcInvalidRedirectError("oidc.invalid_redirect_uri", "Production requires HTTPS redirect_uri.");
  }

  if (!isProd && parsed.protocol === "http:") {
    const insecureAllow = parseAllowlist(process.env.SSO_DEV_INSECURE_REDIRECT_ALLOWLIST);
    const origin = normalizeOrigin(parsed);
    if (isDevLocalhostHttp(parsed)) {
      return;
    }
    if (insecureAllow.has(origin)) {
      return;
    }
    throw new OidcInvalidRedirectError(
      "oidc.invalid_redirect_uri",
      "HTTP redirect_uri outside localhost requires SSO_DEV_INSECURE_REDIRECT_ALLOWLIST."
    );
  }
}
