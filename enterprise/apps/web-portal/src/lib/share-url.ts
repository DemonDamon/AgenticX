const PUBLIC_BASE_URL_ENV_KEYS = [
  "WEB_PORTAL_PUBLIC_BASE_URL",
  "PORTAL_PUBLIC_BASE_URL",
  "NEXT_PUBLIC_WEB_PORTAL_PUBLIC_BASE_URL",
] as const;

type ShareUrlEnv = Record<string, string | undefined>;

function configuredPublicBaseUrl(env: ShareUrlEnv): string | null {
  for (const key of PUBLIC_BASE_URL_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return null;
}

function normalizeBaseUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("WEB_PORTAL_PUBLIC_BASE_URL must use http or https");
  }
  return url.toString().replace(/\/$/, "");
}

export function buildShareUrl(path: string, requestUrl: string, env: ShareUrlEnv = process.env): string {
  if (!path.startsWith("/")) throw new Error("share path must be absolute");
  const configured = configuredPublicBaseUrl(env);
  const baseUrl = normalizeBaseUrl(configured ?? new URL(requestUrl).origin);
  return new URL(path, `${baseUrl}/`).toString();
}

/** Browser copy target: always the origin the employee is currently visiting. */
export function buildBrowserShareUrl(path: string, origin: string): string {
  if (!path.startsWith("/")) throw new Error("share path must be absolute");
  return new URL(path, `${normalizeBaseUrl(origin)}/`).toString();
}
