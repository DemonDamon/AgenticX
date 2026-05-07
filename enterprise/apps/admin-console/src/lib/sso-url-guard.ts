import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** SSRF guard: shared between issuer and redirect_uri hostname resolution (FR-A1 / FR-A2). */

const DNS_LOOKUP_TIMEOUT_MS = 5000;
const ISSUER_DNS_CACHE_MAX = 64;
const ISSUER_DNS_CACHE_TTL_MS = 60 * 1000;

type DnsCacheEntry = {
  expiresAt: number;
  addresses: { family: number; address: string }[];
};

const issuerDnsCache = new Map<string, DnsCacheEntry>();
const issuerDnsInsertOrder: string[] = [];

function touchDnsCacheOrder(host: string): void {
  const idx = issuerDnsInsertOrder.indexOf(host);
  if (idx >= 0) issuerDnsInsertOrder.splice(idx, 1);
  issuerDnsInsertOrder.push(host);
}

function pruneIssuerDnsCacheIfNeeded(): void {
  while (issuerDnsInsertOrder.length > ISSUER_DNS_CACHE_MAX) {
    const oldest = issuerDnsInsertOrder.shift();
    if (oldest) issuerDnsCache.delete(oldest);
  }
}

/** Clear cached DNS for a hostname after issuer / redirect host changes (FR-A2.3). */
export function invalidateIssuerDnsCacheForHost(host: string): void {
  const key = host.trim().toLowerCase();
  issuerDnsCache.delete(key);
  const idx = issuerDnsInsertOrder.indexOf(key);
  if (idx >= 0) issuerDnsInsertOrder.splice(idx, 1);
}

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

function normalizeIpLiteral(ip: string): string {
  const normalized = ip.trim().toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

function decodeMappedIpv6ToIpv4(ipv6: string): string | null {
  if (!ipv6.startsWith("::ffff:")) return null;
  const mapped = ipv6.slice("::ffff:".length);
  if (!mapped) return null;
  if (isIP(mapped) === 4) return mapped;

  const parts = mapped.split(":");
  if (parts.length === 2 && parts.every((part) => /^[0-9a-f]{1,4}$/i.test(part))) {
    const high = Number.parseInt(parts[0]!, 16);
    const low = Number.parseInt(parts[1]!, 16);
    return `${(high >>> 8) & 0xff}.${high & 0xff}.${(low >>> 8) & 0xff}.${low & 0xff}`;
  }
  if (parts.length === 1 && /^[0-9a-f]{1,8}$/i.test(parts[0]!)) {
    const value = Number.parseInt(parts[0]!, 16);
    return `${(value >>> 24) & 0xff}.${(value >>> 16) & 0xff}.${(value >>> 8) & 0xff}.${value & 0xff}`;
  }
  return null;
}

function isLoopbackOrPrivateIPv6(ip: string): boolean {
  const normalized = normalizeIpLiteral(ip);
  const mappedIpv4 = decodeMappedIpv6ToIpv4(normalized);
  if (mappedIpv4 && isLoopbackOrPrivateIPv4(mappedIpv4)) return true;
  if (normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80:")) return true;
  return false;
}

function parseUrl(raw: string, fieldName: string): URL {
  try {
    return new URL(raw);
  } catch {
    throw new Error(`invalid_${fieldName}`);
  }
}

async function lookupWithTimeout(hostname: string): Promise<{ family: number; address: string }[]> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error("issuer_dns_timeout"));
    }, DNS_LOOKUP_TIMEOUT_MS);
  });
  const result = await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    timeout,
  ]);
  return result.map((r) => ({ family: r.family, address: r.address }));
}

function assertResolvedAddressesSafe(
  resolved: { family: number; address: string }[],
  fieldName: string
): void {
  if (!resolved.length) {
    throw new Error(`${fieldName}_dns_resolution_failed`);
  }
  for (const entry of resolved) {
    if (entry.family === 4 && isLoopbackOrPrivateIPv4(entry.address)) {
      throw new Error(`${fieldName}_host_not_allowed`);
    }
    if (entry.family === 6 && isLoopbackOrPrivateIPv6(entry.address)) {
      throw new Error(`${fieldName}_host_not_allowed`);
    }
  }
}

async function resolveHostnameAddresses(host: string): Promise<{ family: number; address: string }[]> {
  const key = host.trim().toLowerCase();
  const now = Date.now();
  const cached = issuerDnsCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.addresses;
  }

  const addresses = await lookupWithTimeout(key);
  issuerDnsCache.set(key, { addresses, expiresAt: now + ISSUER_DNS_CACHE_TTL_MS });
  touchDnsCacheOrder(key);
  pruneIssuerDnsCacheIfNeeded();
  return addresses;
}

export async function assertSafeIssuerUrl(raw: string): Promise<void> {
  const parsed = parseUrl(raw, "issuer");
  if (parsed.protocol !== "https:") {
    throw new Error("issuer_must_be_https");
  }

  const host = parsed.hostname.trim().toLowerCase();
  if (!host || host === "localhost") {
    throw new Error("issuer_host_not_allowed");
  }

  const directIpHost = normalizeIpLiteral(host);
  const directIpType = isIP(directIpHost);
  if (directIpType === 4 && isLoopbackOrPrivateIPv4(directIpHost)) {
    throw new Error("issuer_host_not_allowed");
  }
  if (directIpType === 6 && isLoopbackOrPrivateIPv6(directIpHost)) {
    throw new Error("issuer_host_not_allowed");
  }

  if (directIpType === 0) {
    const resolved = await resolveHostnameAddresses(host);
    assertResolvedAddressesSafe(resolved, "issuer");
  }
}

function parseOriginAllowlist(raw: string | undefined): Set<string> {
  const set = new Set<string>();
  const source = raw?.trim();
  if (!source) return set;
  for (const item of source.split(",")) {
    const o = item.trim().replace(/\/$/, "");
    if (o) set.add(o);
  }
  return set;
}

function normalizeOrigin(url: URL): string {
  return `${url.protocol}//${url.host}`.replace(/\/$/, "");
}

function isDevLocalhostHttp(parsed: URL): boolean {
  if (parsed.protocol !== "http:") return false;
  const h = parsed.hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

/**
 * Redirect URI: HTTPS in production; HTTP only on localhost / allowlist in dev.
 * Resolves DNS for hostnames and rejects private/loopback (FR-A1.2).
 */
export async function assertSafeRedirectUri(raw: string, options?: { issuerUrl?: string }): Promise<void> {
  const parsed = parseUrl(raw, "redirect_uri");
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("redirect_uri_protocol_invalid");
  }

  const nodeEnv = process.env.NODE_ENV ?? "development";
  const isProd = nodeEnv === "production";
  const isDevHttpLoopback = !isProd && isDevLocalhostHttp(parsed);

  if (isProd && parsed.protocol !== "https:") {
    throw new Error("redirect_uri_https_required");
  }

  if (!isProd && parsed.protocol === "http:") {
    if (isDevHttpLoopback) {
      /* OK */
    } else {
      const allow = parseOriginAllowlist(process.env.SSO_DEV_INSECURE_REDIRECT_ALLOWLIST);
      if (!allow.has(normalizeOrigin(parsed))) {
        throw new Error("redirect_uri_http_not_allowed");
      }
    }
  }

  const originAllow = parseOriginAllowlist(process.env.NEXT_PUBLIC_SSO_REDIRECT_ORIGIN_ALLOWLIST);
  if (originAllow.size > 0) {
    const ro = normalizeOrigin(parsed);
    if (!originAllow.has(ro)) {
      throw new Error("redirect_uri_origin_not_in_allowlist");
    }
  }

  if (options?.issuerUrl?.trim() && process.env.SSO_REDIRECT_REQUIRE_ISSUER_ORIGIN_MATCH === "true") {
    const issuer = new URL(options.issuerUrl);
    if (normalizeOrigin(issuer) !== normalizeOrigin(parsed)) {
      throw new Error("redirect_uri_issuer_origin_mismatch");
    }
  }
  if (isDevHttpLoopback) {
    return;
  }

  const host = parsed.hostname.trim().toLowerCase();
  if (!host) {
    throw new Error("redirect_uri_host_invalid");
  }

  const directIpHost = normalizeIpLiteral(host);
  const directIpType = isIP(directIpHost);
  if (directIpType === 4 && isLoopbackOrPrivateIPv4(directIpHost)) {
    throw new Error("redirect_uri_host_not_allowed");
  }
  if (directIpType === 6 && isLoopbackOrPrivateIPv6(directIpHost)) {
    throw new Error("redirect_uri_host_not_allowed");
  }

  if (directIpType === 0 && host !== "localhost") {
    const resolved = await resolveHostnameAddresses(host);
    assertResolvedAddressesSafe(resolved, "redirect_uri");
  }
}
