import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_COOKIE = "admin_console_session";

type AdminSessionPayload = {
  email: string;
  userId: string;
  tenantId: string;
  exp: number;
};

type LegacyPayload = {
  email: string;
  exp: number;
};

function isLegacyPayload(p: unknown): p is LegacyPayload {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return typeof o.email === "string" && typeof o.exp === "number" && !("userId" in o && o.userId);
}

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function fromBase64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function resolveSigningSecret(): string {
  const env = process.env.ADMIN_CONSOLE_SESSION_SECRET?.trim();
  if (env) return env;
  if (process.env.NODE_ENV === "production") {
    throw new Error("ADMIN_CONSOLE_SESSION_SECRET is required in production");
  }
  return "agenticx-admin-dev-secret-change-me";
}

function sign(value: string): string {
  return createHmac("sha256", resolveSigningSecret()).update(value).digest("base64url");
}

function normalizeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function createAdminSessionToken(
  email: string,
  userId: string,
  tenantId: string,
  expiresInSeconds = 60 * 60 * 8
): string {
  const payload: AdminSessionPayload = {
    email,
    userId,
    tenantId,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  };
  const encoded = toBase64Url(JSON.stringify(payload));
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export function verifyAdminSessionToken(token: string | undefined | null): AdminSessionPayload | null {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  if (!normalizeCompare(signature, expected)) return null;

  try {
    const raw = JSON.parse(fromBase64Url(encoded)) as unknown;
    if (isLegacyPayload(raw)) return null;
    const payload = raw as AdminSessionPayload;
    if (!payload.email || typeof payload.exp !== "number") return null;
    if (!payload.userId || !payload.tenantId) return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function resolveAdminCredentials():
  | {
      email: string;
      password: string;
    }
  | null {
  const email = process.env.ADMIN_CONSOLE_LOGIN_EMAIL?.trim() || "admin@agenticx.local";
  const password =
    process.env.ADMIN_CONSOLE_LOGIN_PASSWORD?.trim() ||
    (process.env.NODE_ENV !== "production" ? process.env.AUTH_DEV_OWNER_PASSWORD?.trim() : undefined);
  if (!password) return null;
  return { email, password };
}

