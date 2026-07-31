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

/** Flatten Error / cause / code so undici "TypeError: fetch failed" can be classified. */
function collectFetchErrorSignals(err: unknown): string {
  const chunks: string[] = [];
  let cur: unknown = err;
  for (let depth = 0; cur != null && depth < 8; depth += 1) {
    if (typeof cur === "string" || typeof cur === "number" || typeof cur === "boolean") {
      chunks.push(String(cur));
      break;
    }
    if (typeof cur !== "object") break;
    const obj = cur as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    if (typeof obj.name === "string" && obj.name) chunks.push(obj.name);
    if (typeof obj.message === "string" && obj.message) chunks.push(obj.message);
    if (obj.code != null && String(obj.code)) chunks.push(String(obj.code));
    if (Array.isArray(obj.errors)) {
      for (const nested of obj.errors) {
        chunks.push(collectFetchErrorSignals(nested));
      }
    }
    cur = obj.cause;
  }
  return chunks.filter(Boolean).join("\n");
}

/**
 * Map portal fetch failures to actionable Chinese copy.
 * Node/undici often surfaces TLS/timeout only on `error.cause`, with top-level "fetch failed".
 */
export function enterpriseFetchErrorMessage(err: unknown): string {
  const blob = collectFetchErrorSignals(err) || String(err ?? "");

  if (
    /AbortError|TimeoutError|aborted|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|timed out|timeout/i.test(
      blob,
    )
  ) {
    return "连接组织地址超时";
  }

  if (
    /CERT_|UNABLE_TO_VERIFY|ERR_TLS|DEPTH_ZERO_SELF_SIGNED|SELF_SIGNED|certificate|SSL|TLS|hostname.*(?:match|not valid)|altname|self.?signed|unable to verify|doesn't match|does not match/i.test(
      blob,
    )
  ) {
    return "无法连接组织地址：HTTPS 证书无效或与域名不匹配，请联系运维。";
  }

  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|dns/i.test(blob)) {
    return "无法连接组织地址：域名无法解析，请检查组织地址是否填写正确";
  }

  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EPIPE/i.test(blob)) {
    return "无法连接组织地址：网络不通或该端口无服务。请确认 Portal 已启动，或由运维将服务反代到 443";
  }

  if (/fetch failed/i.test(blob)) {
    return "无法连接组织地址：网络或 HTTPS 校验失败。常见原因：证书与域名不匹配、443 未开放、或地址/端口不正确";
  }

  const top =
    err instanceof Error && err.message
      ? err.message
      : blob.split("\n").find((line) => line && line !== "Error" && line !== "TypeError") ||
        String(err ?? "未知错误");
  return `无法连接组织地址：${top}`;
}
