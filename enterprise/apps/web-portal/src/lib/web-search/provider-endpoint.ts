import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const MAX_WEB_SEARCH_ENDPOINT_CHARS = 2_048;

export class WebSearchEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebSearchEndpointError";
  }
}

export type ResolvedWebSearchUrl = {
  url: string;
  hostname: string;
  address: string;
};

function configuredPrivateHostAllowlist(): Set<string> {
  return new Set(
    (process.env.WEB_SEARCH_CUSTOM_ENDPOINT_HOSTS ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase().replace(/\.$/, ""))
      .filter(Boolean),
  );
}

function isExplicitlyAllowed(hostname: string): boolean {
  return configuredPrivateHostAllowlist().has(hostname.toLowerCase().replace(/\.$/, ""));
}

function ipv4Number(address: string): number | null {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return (((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!) >>> 0;
}

function inIpv4Cidr(address: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) === (base & mask);
}

function isBlockedIpv4(address: string): boolean {
  const value = ipv4Number(address);
  if (value === null) return true;
  const ranges: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];
  return ranges.some(([base, prefix]) => inIpv4Cidr(value, ipv4Number(base)!, prefix));
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  const mappedIpv4 = /^(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)?.[1];
  if (mappedIpv4) return isBlockedIpv4(mappedIpv4);
  // IPv4-compatible/mapped forms can spell loopback or private IPv4 in hex.
  // They are not needed for provider endpoints, so reject the whole compact
  // transition range instead of trying to enumerate textual variants.
  if (normalized.startsWith("::")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe")) return true;
  if (normalized.startsWith("ff")) return true;
  if (normalized.startsWith("64:ff9b:")) return true;
  if (normalized.startsWith("2001:")) {
    const second = normalized.split(":")[1] ?? "";
    if (["", "0", "0000", "2", "0002", "10", "0010", "20", "0020", "db8"].includes(second)) {
      return true;
    }
  }
  if (normalized.startsWith("2002:")) return true;
  return false;
}

export function isBlockedWebSearchAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host === "metadata.google.internal" ||
    host === "instance-data" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa")
  );
}

function normalizedUrlHostname(parsed: URL): string {
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

/**
 * Normalize the exact protocol endpoint saved in provider options.
 * This synchronous layer rejects literal/internal targets at write time; DNS
 * answers are checked again immediately before every custom-endpoint request.
 */
export function normalizeWebSearchEndpoint(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new WebSearchEndpointError("搜索服务 API 地址不能为空");
  }
  const value = raw.trim();
  if (value.length > MAX_WEB_SEARCH_ENDPOINT_CHARS) {
    throw new WebSearchEndpointError("搜索服务 API 地址过长");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WebSearchEndpointError("搜索服务 API 地址格式无效");
  }
  if (parsed.protocol !== "https:") {
    throw new WebSearchEndpointError("搜索服务 API 地址必须使用 HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new WebSearchEndpointError("搜索服务 API 地址不能包含账号或密码");
  }
  if (parsed.hash) {
    throw new WebSearchEndpointError("搜索服务 API 地址不能包含片段标识");
  }

  const hostname = normalizedUrlHostname(parsed);
  if (!hostname) throw new WebSearchEndpointError("搜索服务 API 地址缺少主机名");
  if (!isExplicitlyAllowed(hostname)) {
    if (isBlockedHostname(hostname)) {
      throw new WebSearchEndpointError("搜索服务 API 地址不能指向本机或内部域名");
    }
    if (isIP(hostname) && isBlockedWebSearchAddress(hostname)) {
      throw new WebSearchEndpointError("搜索服务 API 地址不能指向私有或保留地址");
    }
  }
  parsed.hostname = isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  return parsed.toString();
}

function normalizePublicWebUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new WebSearchEndpointError("网页地址不能为空");
  }
  if (raw.trim().length > 8_192) {
    throw new WebSearchEndpointError("网页地址过长");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new WebSearchEndpointError("网页地址格式无效");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WebSearchEndpointError("网页地址协议无效");
  }
  if (parsed.username || parsed.password) {
    throw new WebSearchEndpointError("网页地址不能包含账号或密码");
  }
  const hostname = normalizedUrlHostname(parsed);
  if (!hostname || isBlockedHostname(hostname)) {
    throw new WebSearchEndpointError("网页地址不能指向本机或内部域名");
  }
  if (isIP(hostname) && isBlockedWebSearchAddress(hostname)) {
    throw new WebSearchEndpointError("网页地址不能指向私有或保留地址");
  }
  parsed.hostname = isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  parsed.hash = "";
  return parsed.toString();
}

/** Synchronous policy used to discard unsafe provider-returned links. */
export function normalizeWebSearchResultUrl(raw: unknown): string {
  return normalizePublicWebUrl(raw);
}

async function resolveSafeUrl(
  url: string,
  allowPrivateHostname: boolean,
): Promise<ResolvedWebSearchUrl> {
  const hostname = normalizedUrlHostname(new URL(url));
  if (isIP(hostname)) {
    return { url, hostname, address: hostname };
  }

  let answers: Array<{ address: string; family: number }>;
  try {
    answers = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new WebSearchEndpointError("无法解析搜索服务或网页地址");
  }
  if (
    answers.length === 0 ||
    (!allowPrivateHostname && answers.some(({ address }) => isBlockedWebSearchAddress(address)))
  ) {
    throw new WebSearchEndpointError("地址解析到了私有或保留地址");
  }
  const selected = answers.find(({ family }) => family === 4) ?? answers[0];
  if (!selected) throw new WebSearchEndpointError("地址没有可用的解析结果");
  return { url, hostname, address: selected.address };
}

/** Resolve and pin a custom provider endpoint before sending tenant credentials. */
export async function resolveSafeWebSearchEndpoint(
  raw: unknown,
): Promise<ResolvedWebSearchUrl> {
  const endpoint = normalizeWebSearchEndpoint(raw);
  const hostname = normalizedUrlHostname(new URL(endpoint));
  return resolveSafeUrl(endpoint, isExplicitlyAllowed(hostname));
}

/** Resolve and pin an untrusted search-result URL before server-side fetching. */
export async function resolveSafeWebSearchResultUrl(
  raw: unknown,
): Promise<ResolvedWebSearchUrl> {
  return resolveSafeUrl(normalizePublicWebUrl(raw), false);
}

/** Backwards-compatible assertion helper for callers that only need the URL. */
export async function assertSafeWebSearchEndpoint(raw: unknown): Promise<string> {
  return (await resolveSafeWebSearchEndpoint(raw)).url;
}
