import { createHash } from "node:crypto";

import { log } from "./observability/logger";

const MAX_BYTES = 24_000;
const MAX_FETCH_BYTES = 256_000;

export function skillBundleAllowlist(): Set<string> {
  const raw = process.env.ENTERPRISE_SKILL_BUNDLE_HOST_ALLOWLIST ?? "";
  return new Set(
    raw
      .split(",")
      .map((host) => host.trim().toLowerCase().replace(/:\d+$/, ""))
      .filter(Boolean),
  );
}

function normalizeExpectedDigest(expectedDigest: string | null): string | null {
  if (expectedDigest == null) return null;
  const trimmed = expectedDigest.trim().toLowerCase();
  if (!trimmed) return null;
  const hex = trimmed.startsWith("sha256:") ? trimmed.slice("sha256:".length) : trimmed;
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

function stripFrontmatter(text: string): string {
  const clipped = text.slice(0, MAX_BYTES);
  if (!clipped.startsWith("---")) return clipped;
  const end = clipped.indexOf("\n---", 3);
  if (end === -1) return clipped;
  return clipped.slice(end + 4).replace(/^\n/, "");
}

export async function loadSkillBody(
  bundleUri: string | null,
  expectedDigest: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!bundleUri) return null;
  let url: URL;
  try {
    url = new URL(bundleUri);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!skillBundleAllowlist().has(host)) return null;
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      redirect: "error",
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_FETCH_BYTES) {
    log("warn", {
      event: "chat.skill_bundle_too_large",
      bundle_host: host,
      byte_length: bytes.byteLength,
    });
    return null;
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  const expected = normalizeExpectedDigest(expectedDigest);
  if (expected && expected !== actual) {
    log("warn", {
      event: "chat.skill_bundle_digest_mismatch",
      bundle_host: host,
      expected_digest: expected,
      actual_digest: actual,
    });
    return null;
  }
  if (!expected) {
    log("warn", {
      event: "chat.skill_bundle_digest_missing",
      bundle_host: host,
    });
  }
  return stripFrontmatter(bytes.toString("utf8"));
}
