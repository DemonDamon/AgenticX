import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isLoopbackOrPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function isLoopbackOrPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80:")) return true;
  return false;
}

function parseHttpsUrl(raw: string, fieldName: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`invalid_${fieldName}`);
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error(`invalid_${fieldName}_protocol`);
  }
  return parsed;
}

export async function assertSafeIssuerUrl(raw: string): Promise<void> {
  const parsed = parseHttpsUrl(raw, "issuer");
  if (parsed.protocol !== "https:") {
    throw new Error("issuer_must_be_https");
  }

  const host = parsed.hostname.trim().toLowerCase();
  if (!host || host === "localhost") {
    throw new Error("issuer_host_not_allowed");
  }

  const directIpType = isIP(host);
  if (directIpType === 4 && isLoopbackOrPrivateIPv4(host)) {
    throw new Error("issuer_host_not_allowed");
  }
  if (directIpType === 6 && isLoopbackOrPrivateIPv6(host)) {
    throw new Error("issuer_host_not_allowed");
  }

  const resolved = await lookup(host, { all: true });
  if (!resolved.length) {
    throw new Error("issuer_dns_resolution_failed");
  }
  for (const entry of resolved) {
    if (entry.family === 4 && isLoopbackOrPrivateIPv4(entry.address)) {
      throw new Error("issuer_host_not_allowed");
    }
    if (entry.family === 6 && isLoopbackOrPrivateIPv6(entry.address)) {
      throw new Error("issuer_host_not_allowed");
    }
  }
}

export function assertValidRedirectUri(raw: string): void {
  const parsed = parseHttpsUrl(raw, "redirect_uri");
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("redirect_uri_protocol_invalid");
  }
}
