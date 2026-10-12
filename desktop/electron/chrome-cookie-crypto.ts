import crypto from "node:crypto";

/** Chromium cookie timestamps: microseconds since 1601-01-01 UTC. */
const CHROME_EPOCH_OFFSET_MS = 11_644_473_600_000;

export type CookieSameSite = "unspecified" | "no_restriction" | "lax" | "strict";

export function deriveChromeAesKeyMac(password: string): Buffer {
  return crypto.pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
}

export function deriveChromeAesKeyLinux(password: string): Buffer {
  return crypto.pbkdf2Sync(password, "saltysalt", 1, 16, "sha1");
}

/**
 * Decrypt a Chromium `encrypted_value` blob.
 * macOS/Linux: AES-128-CBC, prefix v10/v11, 32-byte digest prefix after Chrome 80.
 * Windows: AES-256-GCM, prefix v10, 12-byte nonce + tag.
 */
export function decryptChromeCookieValue(
  encrypted: Buffer,
  key: Buffer,
  platform: NodeJS.Platform,
): string {
  if (!encrypted || encrypted.length === 0) return "";
  if (encrypted.length < 4) {
    return encrypted.toString("utf8");
  }
  const prefix = encrypted.subarray(0, 3).toString("utf8");
  if (prefix !== "v10" && prefix !== "v11") {
    const asText = encrypted.toString("utf8");
    if (/^[\x20-\x7e]+$/.test(asText)) return asText;
    return "";
  }
  if (platform === "win32") {
    return decryptWindowsGcm(encrypted.subarray(3), key);
  }
  return decryptMacLinuxCbc(encrypted.subarray(3), key);
}

function decryptMacLinuxCbc(payload: Buffer, key: Buffer): string {
  const iv = Buffer.alloc(16, 0x20);
  const decipher = crypto.createDecipheriv("aes-128-cbc", key.subarray(0, 16), iv);
  const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
  const body = decrypted.length > 32 ? decrypted.subarray(32) : decrypted;
  return stripNul(body.toString("utf8"));
}

function decryptWindowsGcm(payload: Buffer, key: Buffer): string {
  if (payload.length < 12 + 16) return "";
  const nonce = payload.subarray(0, 12);
  const tag = payload.subarray(payload.length - 16);
  const data = payload.subarray(12, payload.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key.subarray(0, 32), nonce);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return stripNul(decrypted.toString("utf8"));
}

function stripNul(text: string): string {
  return text.replace(/\u0000+$/g, "");
}

export function cookieUrlFromHost(hostKey: string, cookiePath: string, secure: boolean): string {
  const host = String(hostKey || "").replace(/^\./, "").trim();
  const rawPath = String(cookiePath || "/").trim() || "/";
  const pathPart = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const scheme = secure ? "https" : "http";
  if (!host) return "";
  return `${scheme}://${host}${pathPart}`;
}

export function chromeExpiryToUnixSeconds(expiresUtc: number): number | undefined {
  if (!Number.isFinite(expiresUtc) || expiresUtc <= 0) return undefined;
  const unixMs = expiresUtc / 1000 - CHROME_EPOCH_OFFSET_MS;
  const unix = Math.floor(unixMs / 1000);
  if (unix <= 0) return undefined;
  return unix;
}

/** Chromium CookieSameSite: -1 unspecified, 0 none, 1 lax, 2 strict. */
export function mapCookieSameSite(value: number | null | undefined): CookieSameSite {
  if (value === 0) return "no_restriction";
  if (value === 1) return "lax";
  if (value === 2) return "strict";
  return "unspecified";
}

export function shouldSkipHostKey(hostKey: string): boolean {
  const host = String(hostKey || "").trim().toLowerCase();
  if (!host) return true;
  if (host.startsWith("chrome-extension")) return true;
  if (host.startsWith("chrome://")) return true;
  if (host.includes("://")) return true;
  return false;
}
