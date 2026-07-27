/**
 * Helpers for Near Desktop → Enterprise Portal browser device login.
 * Pure functions stay free of Electron so unit tests can cover security checks.
 */

export function normalizePortalOrigin(raw: string): string {
  return String(raw || "").trim().replace(/\/+$/, "");
}

export type PortalOriginValidation =
  | { ok: true; origin: string }
  | { ok: false; error: string };

/**
 * Production org URLs must be HTTPS. Localhost / 127.0.0.1 may use HTTP for dev.
 */
export function validatePortalOriginForBrowserLogin(raw: string): PortalOriginValidation {
  const origin = normalizePortalOrigin(raw);
  if (!origin) {
    return { ok: false, error: "请填写组织地址" };
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return { ok: false, error: "组织地址格式无效" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "组织地址仅支持 http/https" };
  }
  const host = parsed.hostname.toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  if (parsed.protocol === "http:" && !isLocal) {
    return { ok: false, error: "生产环境组织地址必须使用 https://" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "组织地址不能包含用户名或密码" };
  }
  return { ok: true, origin: `${parsed.protocol}//${parsed.host}` };
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

export function isVerificationUrlSameOrigin(portalOrigin: string, verificationUrl: string): boolean {
  try {
    const portal = new URL(normalizePortalOrigin(portalOrigin));
    const verify = new URL(String(verificationUrl || "").trim());
    if (!verify.pathname.startsWith("/auth/desktop")) return false;
    if (portal.origin === verify.origin) return true;
    // Local org URLs often mix localhost vs 127.0.0.1; treat loopback hosts as equivalent.
    return (
      portal.protocol === verify.protocol &&
      portal.port === verify.port &&
      isLoopbackHostname(portal.hostname) &&
      isLoopbackHostname(verify.hostname)
    );
  } catch {
    return false;
  }
}

export function computePollMaxTicks(expiresInSeconds: number, pollIntervalMs: number): number {
  const ttl = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 600;
  const interval =
    Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 2500;
  return Math.max(1, Math.ceil((ttl * 1000) / interval) + 2);
}

export type DeviceInitResponse = {
  deviceId: string;
  deviceSecret: string;
  verificationUrl: string;
  expiresIn: number;
  pollIntervalMs: number;
};

export function parseDeviceInitPayload(data: unknown): DeviceInitResponse | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const deviceId = String(d.deviceId ?? "").trim();
  const deviceSecret = String(d.deviceSecret ?? "").trim();
  const verificationUrl = String(d.verificationUrl ?? "").trim();
  const expiresIn = Number(d.expiresIn ?? 600);
  const pollIntervalMs = Number(d.pollIntervalMs ?? 2500);
  if (!deviceId || !deviceSecret || !verificationUrl) return null;
  return { deviceId, deviceSecret, verificationUrl, expiresIn, pollIntervalMs };
}
