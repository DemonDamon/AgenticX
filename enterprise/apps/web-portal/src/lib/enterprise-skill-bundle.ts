import { createHash } from "node:crypto";
import { downloadSkillBytes, type SkillAddressLookup, type SkillHttpsRequest } from "./skill-bundle-transport";

export function skillBundleAllowlist(): Set<string> {
  const raw = process.env.ENTERPRISE_SKILL_BUNDLE_HOST_ALLOWLIST ?? "";
  return new Set(
    raw
      .split(",")
      .map((host) => host.trim().toLowerCase().replace(/:\d+$/, ""))
      .filter(Boolean),
  );
}

export async function loadSkillBody(
  bundleUri: string | null,
  options: {
    expectedDigest?: string | null;
    resolveAddresses?: SkillAddressLookup;
    requestImpl?: SkillHttpsRequest;
  } = {},
): Promise<string | null> {
  if (!bundleUri || bundleUri.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(bundleUri);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
  const host = url.hostname.toLowerCase();
  if (!skillBundleAllowlist().has(host)) return null;
  const rawDigest = options.expectedDigest?.trim();
  const digest = rawDigest?.toLowerCase().replace(/^sha256:/, "");
  if (rawDigest && !/^[a-f0-9]{64}$/.test(digest ?? "")) return null;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error("skill download deadline")), 2500);
  let bytes: Buffer;
  try {
    bytes = await downloadSkillBytes(url, controller.signal, {
      allowPrivate: process.env.ENTERPRISE_SKILL_BUNDLE_ALLOW_PRIVATE_NETWORK === "true",
      resolveAddresses: options.resolveAddresses,
      requestImpl: options.requestImpl,
    });
    if (digest && createHash("sha256").update(bytes).digest("hex") !== digest) return null;
  } catch {
    return null;
  } finally {
    clearTimeout(deadline);
  }
  const text = bytes.toString("utf8");
  if (!text.startsWith("---")) return text;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return text;
  return text.slice(end + 4).replace(/^\n/, "");
}
