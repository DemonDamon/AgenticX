import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import type { IncomingMessage, ClientRequest } from "node:http";
import { request, type RequestOptions } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

export const SKILL_BUNDLE_MAX_BYTES = 24_000;
export type SkillAddressLookup = (hostname: string) => Promise<readonly LookupAddress[]>;
export type SkillHttpsRequest = (
  url: URL,
  options: RequestOptions,
  onResponse: (response: IncomingMessage) => void,
) => ClientRequest;

const reserved = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) reserved.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 96], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48],
  ["100::", 64], ["2001::", 32], ["2001:2::", 48], ["2001:db8::", 32],
  ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) reserved.addSubnet(address, prefix, "ipv6");

const optInPrivate = new BlockList();
for (const [address, prefix] of [
  ["10.0.0.0", 8], ["127.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16],
] as const) optInPrivate.addSubnet(address, prefix, "ipv4");
optInPrivate.addAddress("::1", "ipv6");
optInPrivate.addSubnet("fc00::", 7, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const mappedV4 = new BlockList();
mappedV4.addSubnet("0.0.0.0", 0, "ipv4");
const metadataV6 = new BlockList();
metadataV6.addAddress("fd00:ec2::254", "ipv6");
metadataV6.addAddress("fd20:ce::254", "ipv6");

/** Metadata/link-local addresses remain blocked even for explicitly private sources. */
export function isAllowedSkillAddress(address: string, allowPrivate = false): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  const type = family === 4 ? "ipv4" : "ipv6";
  if (metadataV6.check(address, type)) return false;
  const routable = family === 4 || globalV6.check(address, type) || mappedV4.check(address, type);
  return (allowPrivate && optInPrivate.check(address, type)) || (routable && !reserved.check(address, type));
}

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("skill download aborted"));
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

export async function downloadSkillBytes(
  url: URL,
  signal: AbortSignal,
  options: {
    allowPrivate?: boolean;
    resolveAddresses?: SkillAddressLookup;
    requestImpl?: SkillHttpsRequest;
  } = {},
): Promise<Buffer> {
  signal.throwIfAborted();
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await withAbort((options.resolveAddresses ?? ((host) => lookup(host, { all: true })))(hostname), signal);
  signal.throwIfAborted();
  if (addresses.length === 0 || addresses.some((entry) =>
    entry.family !== isIP(entry.address) || !isAllowedSkillAddress(entry.address, options.allowPrivate))) {
    throw new Error("skill download address rejected");
  }

  const pinnedLookup: LookupFunction = (host, lookupOptions, callback) => {
    queueMicrotask(() => {
      if (host.toLowerCase() !== hostname.toLowerCase()) {
        callback(new Error("unexpected skill lookup host"), "", 0); return;
      }
      const family = lookupOptions.family === "IPv4" ? 4 : lookupOptions.family === "IPv6" ? 6 : lookupOptions.family;
      const candidates = family ? addresses.filter((entry) => entry.family === family) : addresses;
      if (!candidates.length) { callback(new Error("no validated skill address"), "", 0); return; }
      if (lookupOptions.all) callback(null, [...candidates]);
      else callback(null, candidates[0]!.address, candidates[0]!.family);
    });
  };

  return new Promise((resolve, reject) => {
    const req = (options.requestImpl ?? request)(url, {
      method: "GET", agent: false, lookup: pinnedLookup, signal,
      // The URL/hostname remains unchanged: TLS certificate and Host use the original name.
      rejectUnauthorized: true,
      headers: { "accept-encoding": "identity" },
    }, (response) => {
      response.on("error", reject);
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.destroy(); reject(new Error("skill download status rejected")); return;
      }
      const encoding = response.headers["content-encoding"];
      const length = response.headers["content-length"];
      if ((encoding && encoding !== "identity") || (length && Number(length) > SKILL_BUNDLE_MAX_BYTES)) {
        response.destroy(); reject(new Error("skill download body rejected")); return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > SKILL_BUNDLE_MAX_BYTES) {
          response.destroy(new Error("skill download body too large")); return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (!response.complete) { reject(new Error("incomplete skill download")); return; }
        resolve(Buffer.concat(chunks, bytes));
      });
      response.on("aborted", () => reject(new Error("skill download interrupted")));
    });
    req.on("error", reject);
    req.end();
  });
}
